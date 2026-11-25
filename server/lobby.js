// 채널(대기실)과 경기(docs/DESIGN.md §1). 가입 없이 닉네임 · 채널 코드로 모인다.
//
// 브라우저 → 서버(JSON): hello { name, key } · create · join { code } · team { team } · settings { teams, perTeam, map, quiz, minutes, quizOwner?, quizRev? }
//                        (quiz: "" = 아케이드 · 기본 세트 key 또는 "seed:<key>" · "arc:<id>" = 퀴즈 아카이브 세트 — U25.
//                         arc 는 서버가 아카이브에서 받아 온 뒤에 바뀐다. 못 받으면 error 를 보내고 지난 퀴즈를 그대로 둔다.
//                         quizOwner: 비공개 세트의 소유 키(그 요청에만 쓴다) · quizRev: 세트의 updatedAt(더 새것이면 기억한 것을 버리고 다시 받는다))
//                        (예전 bots · fill 은 받지 않는다 — 컴퓨터는 방장이 명단에서 넣는다, docs/DESIGN.md U24)
//                        · bot { op: "add", team } · bot { op: "remove", i }(방장 · 대기 중만, i = lobby.bots 의 번호)
//                        · start · leave · again, 경기 중에는 Game.handle 이 받는 명령(mv · throw · cmd · place · train · …)
// 서버 → 브라우저: hello { id, sets, maps, teamCounts, perTeamChoices, minutes, defaultMinutes }
//                 · lobby { code, host, settings, quizInfo: { src: "none"|"seed"|"arc", title, count, skipped }, quizPending, members: [{ id, name, team }],
//                           bots: [{ team, name, char }], result, you }
//                 · error { text } · start { … } · 스냅숏(바이너리) · fx · me · note · quiz · end
// 자리: 채널 정원 = 팀 수 × 팀당 최대 인원(perTeam). 사람 + 컴퓨터가 팀마다 perTeam 까지. 저절로 채우는 컴퓨터는 없다.
// 퀴즈 세트를 고르지 않으면(quiz "") 아케이드 모드, 고르면 퀴즈 모드다(docs/DESIGN.md U7 · U9).
import { randomInt } from "node:crypto";
import { MAX_PER_TEAM, TEAM_COUNTS, ROUND_MINUTES, DEFAULT_MINUTES, TICK, MAPS, DEFAULT_MAP } from "../shared/constants.js";
import { SEED_SETS } from "../shared/quizseed.js";
import { Game } from "./game.js";
import { fetchArchiveQuiz, archiveId } from "./quizsource.js";

export const MAX_CHANNELS = Number(process.env.MAX_CHANNELS) || 200; // 채널 수 한도(남용 막기)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// 개발 · 시연용: GAME_SPEED=4 면 한 번에 네 틱씩(경기가 네 배 빨리 흐른다). 기본 1
const SPEED = Math.max(1, Math.min(10, Number(process.env.GAME_SPEED) || 1));
const NAME_MAX = 12;
// 컴퓨터 이름: 미술 도구 말투. "봇"이 든 이름은 쓰지 않는다(잉크봇은 유닛 이름이라 "보석 +1! (잉크봇)"처럼 헷갈린다).
// 32자리를 다 채워도 겹치지 않게 넉넉히 — 그래도 모자라면 뒤에 번호를 붙인다
export const BOT_NAMES = [
  "붓돌이", "먹물이", "물감이", "크레용", "파스텔", "형광이", "연필이", "지우개", "도화지", "팔레트", "색연필", "크레파스",
  "사인펜", "형광펜", "수채화", "스케치", "분필이", "색종이", "찰흙이", "캔버스", "이젤이", "물통이", "붓끝이", "잉크통",
  "스탬프", "매직이", "먹선이", "점토이", "물방울", "목탄이", "스펀지", "마스킹", "유화물감", "콩테",
];

export const QUIZ_SETS = SEED_SETS.map((s) => ({ key: s.key, title: s.title, description: s.description, level: s.level, grade: s.grade, subject: s.subject, count: s.questions.length }));

// 팀당 최대 인원으로 고를 수 있는 값(U24 — 1 ~ MAX_PER_TEAM명, 기본 MAX_PER_TEAM). 채널 정원 = 팀 수 × 이 값
export const PER_TEAM_CHOICES = Array.from({ length: MAX_PER_TEAM }, (_, k) => k + 1);

function cleanName(s) {
  const n = String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, NAME_MAX);
  return n || "학생";
}

export class Lobby {
  /** @param {{ quizSource?: { get: (id, opt) => Promise<object> } }} [o]  퀴즈 아카이브(기본: server/quizsource.js — 시험은 가짜 아카이브) */
  constructor(o = {}) {
    this.quizSource = o.quizSource || { get: fetchArchiveQuiz };
    this.channels = new Map();
    this.clients = new Set();
    this.nextClient = 1;
    this.timer = setInterval(() => this.tick(), TICK * 1000);
    this.timer.unref?.();
  }

  close() { clearInterval(this.timer); }

  connect(ws) {
    const c = { id: this.nextClient++, ws, name: "학생", key: "", channel: null };
    this.clients.add(c);
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (msg && typeof msg === "object") this.onMessage(c, msg);
    });
    ws.on("close", () => this.disconnect(c));
    ws.on("error", () => {});
  }

  send(c, data) {
    if (!c || !c.ws || c.ws.readyState !== 1) return;
    if (data instanceof ArrayBuffer) c.ws.send(Buffer.from(data), { binary: true });
    else c.ws.send(JSON.stringify(data));
  }

  onMessage(c, msg) {
    switch (msg.t) {
      case "hello":
        c.name = cleanName(msg.name);
        c.key = String(msg.key || "").slice(0, 64);
        this.send(c, { t: "hello", id: c.id, sets: QUIZ_SETS, maps: MAPS, teamCounts: TEAM_COUNTS, perTeamChoices: PER_TEAM_CHOICES, minutes: ROUND_MINUTES, defaultMinutes: DEFAULT_MINUTES });
        return;
      case "name":
        c.name = cleanName(msg.name);
        if (c.channel) this.pushLobby(c.channel);
        return;
      case "create": return this.create(c);
      case "join": return this.join(c, String(msg.code || "").toUpperCase().trim());
      case "leave": return this.leave(c);
      case "team": return this.setTeam(c, msg.team | 0);
      case "settings": return this.setSettings(c, msg);
      case "bot": return this.bot(c, msg);
      case "start": return this.start(c);
      case "again": return this.again(c);
      default: {
        const ch = c.channel;
        if (ch && ch.game && c.slot != null) ch.game.command(c.slot, msg);
      }
    }
  }

  create(c) {
    // 채널 수 한도(남용 막기) — 한 서버에 MAX_CHANNELS 개까지
    if (this.channels.size >= MAX_CHANNELS) return this.send(c, { t: "error", text: "지금은 열린 채널이 너무 많아요. 잠시 뒤에 다시 만들어 주세요." });
    this.leave(c);
    let code;
    do { code = Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join(""); } while (this.channels.has(code));
    // 처음 설정: 2팀 · 팀당 4명 · 잉크 숲 · 퀴즈 없음(아케이드) · 15분. 컴퓨터는 없다(방장이 명단에서 넣는다 — U24)
    // bots: 대기실 명단의 컴퓨터 [{ team, name, char }](경기가 끝나도 남는다) · botSeq: 다음 컴퓨터의 인형 번호
    const ch = {
      code, host: c.id, members: [], bots: [], botSeq: 0,
      settings: { teams: 2, perTeam: MAX_PER_TEAM, map: DEFAULT_MAP, quiz: "", minutes: DEFAULT_MINUTES },
      arc: null, quizSeq: 0, quizPending: false, // 아카이브 세트(U25): arc = { id, title, questions, total, skipped } · quizSeq = 마지막 고르기 번호
      game: null, slots: null, result: null,
    };
    this.channels.set(code, ch);
    this.addMember(ch, c);
  }

  join(c, code) {
    const ch = this.channels.get(code);
    if (!ch) return this.send(c, { t: "error", text: "그런 채널이 없어요. 코드를 다시 확인해 주세요." });
    if (c.channel === ch) return this.pushLobby(ch);
    if (ch.game) {
      // 경기 중 — 같은 기기(키)로 다시 들어오면 자리를 돌려준다
      const slot = ch.slots?.findIndex((s) => s.key && s.key === c.key && !s.client);
      if (slot == null || slot < 0) return this.send(c, { t: "error", text: "경기가 이미 시작됐어요. 끝나면 들어올 수 있어요." });
      this.leave(c);
      c.channel = ch;
      c.team = ch.game.players[slot]?.team ?? 0; // 경기가 끝나 대기실로 돌아와도 그 팀에
      ch.members.push(c);
      this.bindSlot(ch, c, slot);
      return;
    }
    // 빈자리도 컴퓨터 자리도 없으면(모두 사람) 못 들어온다
    if (!this.seatFor(ch)) return this.send(c, { t: "error", text: "채널이 가득 찼어요." });
    this.leave(c);
    this.addMember(ch, c);
  }

  addMember(ch, c) {
    c.channel = ch;
    c.slot = null;
    c.team = Math.max(0, this.takeSeat(ch)); // (새 채널의 방장은 0팀)
    ch.members.push(c);
    this.pushLobby(ch);
  }

  // ------------------------------------------------------------ 자리(U24): 팀마다 사람 + 컴퓨터가 perTeam 까지

  /** 팀마다 사람 수 · 컴퓨터 수(팀 번호가 팀 수 밖이면 세지 않는다) */
  headcount(ch) {
    const T = ch.settings.teams;
    const humans = Array(T).fill(0);
    const bots = Array(T).fill(0);
    for (const m of ch.members) if (m.team >= 0 && m.team < T) humans[m.team]++;
    for (const b of ch.bots) if (b.team >= 0 && b.team < T) bots[b.team]++;
    return { humans, bots };
  }

  /** 자리가 남은 팀 가운데 인원(사람 + 컴퓨터)이 가장 적은 팀(같으면 앞 팀). 모두 차 있으면 -1 */
  openTeam(ch) {
    const P = ch.settings.perTeam;
    const { humans, bots } = this.headcount(ch);
    let best = -1;
    for (let t = 0; t < humans.length; t++) {
      const n = humans[t] + bots[t];
      if (n < P && (best < 0 || n < humans[best] + bots[best])) best = t;
    }
    return best;
  }

  /**
   * 들어오는 사람의 자리 { team, bot }(고르기만 한다 — 잡는 것은 takeSeat).
   * 자리가 남은 팀이 있으면 그중 인원이 가장 적은 팀(bot -1). 모두 차 있으면 컴퓨터의 자리를 받는다:
   * 컴퓨터가 가장 많은 팀(모든 팀이 perTeam 으로 차 있으니 곧 사람이 가장 적은 팀)에 들어가고 그 팀의 마지막 컴퓨터가 빠진다.
   * 모두 사람이면 null
   */
  seatFor(ch) {
    const open = this.openTeam(ch);
    if (open >= 0) return { team: open, bot: -1 };
    const { bots } = this.headcount(ch);
    let big = -1;
    for (let t = 0; t < bots.length; t++) if (bots[t] > 0 && (big < 0 || bots[t] > bots[big])) big = t;
    if (big < 0) return null;
    return { team: big, bot: ch.bots.findLastIndex((b) => b.team === big) };
  }

  /** seatFor 의 자리를 잡는다(컴퓨터 자리면 그 컴퓨터를 뺀다) → 팀 번호, 자리가 없으면 -1 */
  takeSeat(ch) {
    const seat = this.seatFor(ch);
    if (!seat) return -1;
    if (seat.bot >= 0) ch.bots.splice(seat.bot, 1);
    return seat.team;
  }

  /**
   * 팀 수 · 팀당 인원이 줄었을 때(사람 수 ≤ 팀 수 × perTeam 일 때만 부른다) 자리를 맞춘다.
   * 1) 남은 팀에서 사람 + 컴퓨터가 perTeam 을 넘으면 그 팀의 컴퓨터를 뒤에서부터 뺀다
   * 2) 넘치는 사람(없어진 팀 · perTeam 넘게 — 뒤에 들어온 사람부터)은 자리가 남은 팀으로, 없으면 컴퓨터의 자리를 받는다
   * 3) 없어진 팀의 컴퓨터는 자리가 남은 팀(인원이 가장 적은 팀)으로 옮기고, 자리가 없으면 뺀다
   */
  fitSeats(ch) {
    const { teams: T, perTeam: P } = ch.settings;
    const inTeam = (x) => Number.isInteger(x.team) && x.team >= 0 && x.team < T;
    const { humans, bots } = this.headcount(ch);
    for (let j = ch.bots.length - 1; j >= 0; j--) {
      const b = ch.bots[j];
      if (inTeam(b) && humans[b.team] + bots[b.team] > P) { bots[b.team]--; ch.bots.splice(j, 1); }
    }
    const kept = Array(T).fill(0);
    const moved = [];
    for (const m of ch.members) {
      if (inTeam(m) && kept[m.team] < P) kept[m.team]++;
      else moved.push(m);
    }
    for (const m of moved) m.team = -1; // 자리 셈에서 먼저 빼 두고 한 명씩 앉힌다
    for (const m of moved) m.team = Math.max(0, this.takeSeat(ch));
    for (const b of ch.bots.filter((x) => !inTeam(x))) {
      const t = this.openTeam(ch);
      if (t >= 0) b.team = t;
      else ch.bots.splice(ch.bots.indexOf(b), 1);
    }
  }

  // ------------------------------------------------------------ 컴퓨터(U24 — 잉크 브로울스처럼 방장이 대기실 명단에서 넣는다)

  /**
   * 방장: 컴퓨터 넣기 · 빼기. {t:"bot", op:"add", team} · {t:"bot", op:"remove", i}(i = lobby.bots 의 번호).
   * 방장만 · 대기 중에만. 넣기는 그 팀에 자리가 남았을 때만(사람 + 컴퓨터 < perTeam). 저절로 채우는 컴퓨터는 없다
   */
  bot(c, msg) {
    const ch = c.channel;
    if (!ch) return;
    if (ch.host !== c.id) return this.send(c, { t: "error", text: "방장만 컴퓨터를 넣고 뺄 수 있어요." });
    if (ch.game) return this.send(c, { t: "error", text: "경기 중에는 컴퓨터를 넣거나 뺄 수 없어요." });
    if (msg.op === "add") {
      const team = msg.team;
      if (!Number.isInteger(team) || team < 0 || team >= ch.settings.teams) return;
      const P = ch.settings.perTeam;
      const { humans, bots } = this.headcount(ch);
      if (humans[team] + bots[team] >= P) return this.send(c, { t: "error", text: `그 팀은 가득 찼어요(${P}명).` });
      // 인형 종류(char 0..7)는 넣은 차례대로 돌려 쓴다
      ch.bots.push({ team, name: this.botName(ch), char: ch.botSeq++ % 8 });
    } else if (msg.op === "remove") {
      const i = msg.i;
      if (!Number.isInteger(i) || i < 0 || i >= ch.bots.length) return;
      ch.bots.splice(i, 1);
    } else return;
    this.pushLobby(ch);
  }

  /** 새 컴퓨터 이름: BOT_NAMES 에서 채널의 사람 · 컴퓨터와 겹치지 않는 첫 이름(다 쓰면 뒤에 번호를 붙인다) */
  botName(ch, taken = new Set([...ch.members.map((m) => m.name), ...ch.bots.map((b) => b.name)])) {
    for (let round = 1; ; round++)
      for (const n of BOT_NAMES) {
        const name = round === 1 ? n : `${n}${round}`;
        if (!taken.has(name)) return name;
      }
  }

  /** 사람이 컴퓨터와 같은 이름으로 들어오거나 이름을 바꾸면 그 컴퓨터가 새 이름을 받는다(경기에서 이름이 겹치지 않게) */
  fixBotNames(ch) {
    const seen = new Set(ch.members.map((m) => m.name));
    for (const b of ch.bots) {
      if (seen.has(b.name)) b.name = this.botName(ch, new Set([...seen, ...ch.bots.map((x) => x.name)]));
      seen.add(b.name);
    }
  }

  leave(c) {
    const ch = c.channel;
    if (!ch) return;
    ch.members = ch.members.filter((m) => m !== c);
    if (ch.game && c.slot != null) {
      ch.slots[c.slot].client = null;
      ch.game.setConnected(c.slot, false);
    }
    c.channel = null;
    c.slot = null;
    if (!ch.members.length) {
      this.channels.delete(ch.code);
      return;
    }
    if (ch.host === c.id) ch.host = ch.members[0].id;
    if (!ch.game) this.pushLobby(ch);
  }

  disconnect(c) {
    this.leave(c);
    this.clients.delete(c);
  }

  setTeam(c, team) {
    const ch = c.channel;
    if (!ch || ch.game || team < 0 || team >= ch.settings.teams) return;
    if (c.team === team) return;
    // 가득 찬 팀(사람 + 컴퓨터 = perTeam)에는 못 간다 — 컴퓨터 자리를 비우려면 방장이 그 컴퓨터를 뺀다
    const P = ch.settings.perTeam;
    const { humans, bots } = this.headcount(ch);
    if (humans[team] + bots[team] >= P) return this.send(c, { t: "error", text: `그 팀은 가득 찼어요(${P}명).` });
    c.team = team;
    this.pushLobby(ch);
  }

  setSettings(c, msg) {
    const ch = c.channel;
    if (!ch || ch.game || ch.host !== c.id) return;
    const s = ch.settings;
    // 팀 수 · 팀당 최대 인원(U24): 정원(팀 수 × 팀당 인원)에 사람이 다 앉지 못하면 받지 않고 그대로 둔다.
    // 줄이면 넘치는 컴퓨터가 먼저 빠지고, 넘치는 사람은 자리가 남은 팀으로 옮긴다(fitSeats)
    const teams = TEAM_COUNTS.includes(msg.teams | 0) ? msg.teams | 0 : s.teams;
    const perTeam = PER_TEAM_CHOICES.includes(msg.perTeam | 0) ? msg.perTeam | 0 : s.perTeam;
    if (teams !== s.teams || perTeam !== s.perTeam) {
      const n = ch.members.length;
      if (teams * perTeam < n) {
        this.send(c, { t: "error", text: `지금 ${n}명이라 ${teams}팀 × ${perTeam}명으로는 자리가 모자라요.` });
      } else {
        s.teams = teams;
        s.perTeam = perTeam;
        this.fitSeats(ch);
      }
    }
    if (MAPS.some((m) => m.key === msg.map)) s.map = msg.map;
    if (ROUND_MINUTES.includes(msg.minutes | 0)) s.minutes = msg.minutes | 0;
    this.setQuiz(ch, c, msg);
    this.pushLobby(ch);
  }

  /**
   * 퀴즈 고르기(U25): "" · null = 아케이드, 기본 세트 key · "seed:<key>", "arc:<id>" = 퀴즈 아카이브(잉크 브로울스와 같이 쓰는 곳).
   * 아카이브 세트는 받아 온 뒤에 바꾼다(그동안 quizPending). 그 사이에 다른 것을 고르면 늦게 온 답은 버린다(quizSeq).
   * 못 받으면(없음 · 시간 초과 · 낼 문제 없음 …) 방장에게 error 를 보내고 지난 퀴즈를 그대로 둔다.
   */
  setQuiz(ch, c, msg) {
    if (!("quiz" in msg)) return;
    const s = ch.settings;
    const v = msg.quiz == null ? "" : String(msg.quiz).trim();
    if (!v.startsWith("arc:")) {
      const key = v.replace(/^seed:/, "");
      if (key && !QUIZ_SETS.some((q) => q.key === key)) return; // 없는 세트는 받지 않는다
      s.quiz = key;
      ch.arc = null;
      ch.quizSeq++;
      ch.quizPending = false;
      return;
    }
    const id = archiveId(v);
    if (!id) return this.send(c, { t: "error", text: "퀴즈 번호가 올바르지 않아요." });
    if (s.quiz === `arc:${id}` && ch.arc && !(Number(msg.quizRev) > (ch.arc.updatedAt || 0))) return; // 이미 그 세트(같은 판)
    const seq = ++ch.quizSeq;
    ch.quizPending = true;
    const ownerKey = typeof msg.quizOwner === "string" ? msg.quizOwner : "";
    const updatedAt = Number(msg.quizRev) || undefined;
    Promise.resolve()
      .then(() => this.quizSource.get(id, { ownerKey, updatedAt }))
      .catch(() => ({ ok: false, message: "퀴즈 아카이브에 닿지 못했어요. 잠시 뒤에 다시 골라 주세요." }))
      .then((r) => {
        if (this.channels.get(ch.code) !== ch || ch.quizSeq !== seq) return; // 채널이 닫혔거나 그 뒤에 다른 것을 골랐다
        ch.quizPending = false;
        if (ch.game) return; // 그 사이에 경기가 시작됐다 — 지난 퀴즈로 치른다
        if (r && r.ok) {
          s.quiz = `arc:${id}`;
          ch.arc = { id, title: r.title, questions: r.questions, total: r.total ?? r.questions.length, skipped: (r.skipped || []).length, updatedAt: r.updatedAt || 0 };
        } else {
          const host = ch.members.find((m) => m.id === ch.host) || c;
          this.send(host, { t: "error", text: (r && r.message) || "퀴즈를 불러오지 못했어요." });
        }
        this.pushLobby(ch);
      });
  }

  /** 대기실이 보여 줄 지금 퀴즈 { src, title, count, skipped } */
  quizInfo(ch) {
    const q = ch.settings.quiz;
    if (q.startsWith("arc:") && ch.arc) return { src: "arc", id: ch.arc.id, title: ch.arc.title, count: ch.arc.questions.length, skipped: ch.arc.skipped };
    const set = QUIZ_SETS.find((x) => x.key === q);
    if (set) return { src: "seed", key: set.key, title: set.title, count: set.count, skipped: 0 };
    return { src: "none", title: "", count: 0, skipped: 0 };
  }

  pushLobby(ch) {
    if (!ch.game) this.fixBotNames(ch);
    const view = {
      t: "lobby", code: ch.code, host: ch.host, settings: { ...ch.settings }, quizInfo: this.quizInfo(ch), quizPending: !!ch.quizPending,
      members: ch.members.map((m) => ({ id: m.id, name: m.name, team: m.team })),
      bots: ch.bots.map(({ team, name, char }) => ({ team, name, char })),
      result: ch.result,
    };
    for (const m of ch.members) this.send(m, { ...view, you: m.id });
  }

  start(c) {
    const ch = c.channel;
    if (!ch || ch.game || ch.host !== c.id) return;
    const s = ch.settings;
    this.fitSeats(ch); // (자리는 늘 맞춰 두지만, 어긋난 것이 있어도 경기에 넘치는 팀이 없게)
    this.fixBotNames(ch);
    const byTeam = Array.from({ length: s.teams }, () => ({ humans: [], bots: [] }));
    for (const m of ch.members) byTeam[m.team].humans.push(m);
    for (const b of ch.bots) byTeam[b.team].bots.push(b);
    // 저절로 채우는 컴퓨터는 없다 — 빈 팀이 있으면 방장이 컴퓨터를 넣거나 팀 수를 줄인다
    if (byTeam.some((t) => !t.humans.length && !t.bots.length)) {
      this.pushLobby(ch);
      return this.send(c, { t: "error", text: "빈 팀이 있어요 — 컴퓨터를 넣거나 팀 수를 줄여 주세요." });
    }
    const players = [];
    const slots = [];
    for (let t = 0; t < s.teams; t++) {
      // 팀마다 사람(들어온 차례) → 컴퓨터(명단 차례). 사람의 char(인형 종류 0..7)는 자리 차례대로, 컴퓨터는 명단의 char
      for (const m of byTeam[t].humans) { players.push({ name: m.name, team: t, bot: false, char: players.length % 8 }); slots.push({ key: m.key, client: m }); }
      for (const b of byTeam[t].bots) { players.push({ name: b.name, team: t, bot: true, char: b.char }); slots.push({ key: "", client: null, bot: true }); }
    }
    // 퀴즈: 기본 세트 또는 받아 둔 아카이브 세트(U25). 없으면 아케이드
    const arc = s.quiz.startsWith("arc:") && ch.arc ? ch.arc : null;
    const set = arc || SEED_SETS.find((q) => q.key === s.quiz);
    ch.slots = slots;
    ch.result = null;
    const seed = randomInt(1, 2 ** 31);
    ch.game = new Game({
      brief: true, // 모두 "이기는 방법"을 닫으면 함께 5초 세고 시작(U32)
      seed, teams: s.teams, players, minutes: s.minutes, map: s.map, mode: set ? "quiz" : "arcade",
      questions: set ? set.questions : [], quizTitle: set ? set.title : "",
      send: (slot, data) => this.send(ch.slots[slot]?.client, data),
      onEnd: (r) => this.onEnd(ch, r),
    });
    slots.forEach((sl, i) => { if (sl.client) this.bindSlot(ch, sl.client, i); });
  }

  bindSlot(ch, c, slot) {
    c.slot = slot;
    ch.slots[slot].client = c;
    ch.game.setConnected(slot, true);
    this.send(c, ch.game.startInfo(slot));
  }

  onEnd(ch, r) {
    ch.result = { winner: r.winner, ranking: r.ranking, players: r.players, reason: r.reason, time: r.time };
    // 결과 화면을 보는 동안 경기는 멈춰 있다. 방장이 "다시"를 누르면 대기실로
  }

  again(c) {
    const ch = c.channel;
    if (!ch || !ch.game || !ch.game.over) return;
    ch.game = null;
    ch.slots = null;
    for (const m of ch.members) m.slot = null;
    this.fitSeats(ch); // (경기 중에 나가고 다시 들어온 사람도 제 팀 자리에)
    this.pushLobby(ch);
  }

  tick() {
    for (const ch of this.channels.values()) {
      for (let k = 0; k < SPEED; k++) {
        if (!ch.game || ch.game.over) break;
        try { ch.game.step(); } catch (e) { console.error("경기 오류", ch.code, e); break; }
      }
    }
  }

  stats() {
    let playing = 0;
    for (const ch of this.channels.values()) if (ch.game && !ch.game.over) playing++;
    return { channels: this.channels.size, playing, clients: this.clients.size };
  }
}
