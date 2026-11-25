// 퀴즈 룸 · 전광판(docs/DESIGN.md §2.6 · §3.6 · docs/CONTRACT.md §4 「퀴즈 룸 · 전광판」).
//
// 월드(3D): 존 고리 · 팀 색 게이지 · 빛 울타리(아래에서 위로 솟는 빛 층 — 세운 벽 조각, 꼭짓점마다 깊이) · 전광판 판(상태 판 —
//           "여기가 퀴즈 룸"이라는 표시이자 다른 팀에게 보이는 상태판). 다른 팀의 정답 폭탄은 층 이미지 스택(quiz/bomb)으로 판까지 난다.
// HD 레이어(기기 해상도):
//   - 전광판 상태 딱지(열림 · 풀이 중 · 완료) — 판 자리에. 화면 아래 HUD 띠에 들어가면 흐려진다(무기 막대와 겹치지 않게).
//   - **풀이 판**(사용자 확정): 우리 팀이 풀이 중이면 문제 띠와 답 카드가 화면 위쪽에 고정되어 크게 뜬다(quizgeom.panelLayout).
//     문제 띠와 카드는 한 덩어리다 — 한 카드 상태(pickPanel)에서 함께 그리고 함께 사라진다. 깊이로 가리지 않는다(무엇에도 가려지지 않는다),
//     안개 · 후처리와 무관하다(합성 뒤에 그린다). 카드를 겨누면 빛나고 손에서 카드까지 포물선 조준선, 정답 폭탄은 손(월드 → 화면)에서
//     그 카드로 날아가(QUIZ.WINDUP 동안) 팀 색 잉크로 터진다. 각자 스스로 푼다(§2.6 — 사용자 확정): 카드에는 **내 잉크만** 묻고,
//     팀원의 폭탄은 특정 카드가 아니라 문제 띠 쪽으로 날아가 "제출" 도장으로 터진다(누가 어느 카드를 골랐는지는 화면에 오지도 않는다).
//   카드 면(글자 · 잉크 두 겹 256×160)과 문제 띠(1024×96)는 사건이 있을 때만 다시 그린다.
// 그리는 순서: main.js 가 프레임마다 drawQuizRoom(room) 으로 상태를 넘기면 모아 두고, renderer.render() 가 emitWorld · emitHD(딱지) ·
// emitPanel(풀이 판 — 말풍선보다 위)로 낸다.
import { PALETTE, QUIZ } from "../shared/constants.js";
import T from "../shared/texts/game.js";
import { SHAPE, MODE } from "./sprites.js";
import { PROJ, SQUASH } from "./camera.js";
import { BOARD, boardLayout, boardPoint, defaultBoardSpot, gaugeRadius, panelLayout, panelCardAt, pickPanel } from "./quizgeom.js";
import { HD, MODE_HD, FONT_POSTER, FONT_BODY, roundRect, wrapText } from "./hd.js";
import { ROOM_COLORS, darkHex, mixHex, cssOf } from "./palette.js";
import { STYLE } from "./style.js";
import { poseFrames } from "./stackatlas.js";
import { drawStack } from "./characters.js";

const hexOf = (i) => (i >= 0 && i < PALETTE.length ? PALETTE[i].hex : 0xb9aee0);
const rgb01 = (hex, a = 1) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, a];
const FENCE_H = 2.6;
const FENCE_SEG = 32;
const BLOOM_T = 0.45; // 풀이 판이 펼쳐지는 시간
const SHATTER_T = 1.0;
const WORLD_BOMB_T = 0.9; // 다른 팀의 폭탄이 판까지 나는 시간(월드)
const PANEL_BOMB_T = QUIZ.WINDUP; // 우리 팀 폭탄이 카드까지 나는 시간 = 준비 동작(확정까지)
const RESULT_KEEP = 1.4; // 판정 뒤 풀이 판을 남겨 두는 시간(성공 빛 · 실패 조각) — 화면의 해설은 그 뒤에 뜬다(ui.js EXPLAIN_DELAY)
const LETTERS = "ABCDE";
const TILT = -Math.asin(SQUASH); // 카메라를 똑바로 보는 판의 x 축 회전
const seeded = (a) => {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ 0x85ebca6b;
  return () => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^= h >>> 15) >>> 0) / 4294967296;
  };
};
/** 그 사람(pid)이 카드 i 에 남기는 얼룩의 자리(카드 안 0..1) — 잉크 층과 날아가는 폭탄이 같은 점을 쓴다 */
function splatSpot(pid, i) {
  const rnd = seeded(pid * 31 + i * 7 + 3);
  return { u: (40 + rnd() * (HD.CARD_W - 80)) / HD.CARD_W, v: (40 + rnd() * (HD.CARD_H - 80)) / HD.CARD_H };
}

export function createQuizBoard({ hd, fx, addShake, lights }) {
  let rooms = new Map(); // id → { def, state, … }
  let art = null; // 층 아틀라스(정답 폭탄 스택)
  let nameOf = () => "";
  let aim = null; // { c, x, y, z, color } — 내가 겨눈 카드(마우스)
  let panel = null; // 이번 프레임의 풀이 판 { room, lay(CSS px), n, done }
  const bombs = [];
  const shards = []; // 풀이 판 카드 조각(실패)
  const cardHits = []; // 흘러내림 애니메이션
  const splashes = []; // 카드에 터진 잉크 방울(화면)
  const localThrows = new Map(); // pid → { choice, at } 내가 누르자마자 띄운 폭탄(서버 확정 사건이 오면 두 번 띄우지 않는다)
  const now = () => performance.now() / 1000;

  // ------------------------------------------------------------------ 카드 캔버스(글자 · 잉크)
  function drawCardText(ctx, i, label, text, result) {
    const [x, y, w, h] = HD.cardText(i);
    ctx.clearRect(x, y, w, h);
    const ok = result && result.c === i; // 정답 카드(맞힌 팀에게만 온다 — 실패하면 표시하지 않는다)
    roundRect(ctx, x + 6, y + 6, w - 12, h - 12, 18);
    ctx.fillStyle = ok ? "#eafff3" : "#fffdf8";
    ctx.fill();
    ctx.lineWidth = ok ? 12 : 6;
    ctx.strokeStyle = ok ? "#20c46e" : "#b7aad6";
    ctx.stroke();
    if (ok) {
      // 오른쪽 위 "정답 ✓" 딱지
      const label = `${T.answerMark ?? "O"} ✓`;
      ctx.font = `26px ${FONT_POSTER}`;
      const tw = ctx.measureText(label).width + 22;
      roundRect(ctx, x + w - tw - 12, y + 12, tw, 36, 10);
      ctx.fillStyle = "#20c46e";
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x + w - tw / 2 - 12, y + 31);
    }
    // 번호 딱지(숫자 키 1~5 — 보조 단축키)
    ctx.fillStyle = "#6d5a8c";
    ctx.beginPath();
    ctx.arc(x + 32, y + 32, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `28px ${FONT_POSTER}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 32, y + 33);
    // 선택지(길이에 맞춰 글자 크기 — 40자까지 세 줄)
    ctx.fillStyle = "#3a2d55";
    let size = 46;
    let lines;
    for (; size >= 18; size -= 2) {
      ctx.font = `bold ${size}px ${FONT_BODY}`;
      lines = wrapText(ctx, text, w - 40, size > 32 ? 2 : 3);
      if (lines.length * size * 1.15 <= h - 56 && !lines.some((l) => l.endsWith("…"))) break;
    }
    const lh = size * 1.15;
    const top = y + 18 + (h - 18 - lines.length * lh) / 2 + lh / 2;
    lines.forEach((l, k) => ctx.fillText(l, x + w / 2 + 8, top + k * lh));
    hd.dirty(x, y, w, h);
  }

  function splat(ctx, cx, cy, r, color, rnd) {
    ctx.fillStyle = color;
    ctx.beginPath();
    const pts = 11;
    for (let k = 0; k <= pts; k++) {
      const a = (k / pts) * Math.PI * 2;
      const rr = r * (0.7 + rnd() * 0.45);
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr * 0.9;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    for (let k = 0; k < 5; k++) {
      const a = rnd() * Math.PI * 2;
      const d = r * (1.1 + rnd() * 0.7);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.08 + rnd() * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** 잉크 층: 내 표(내가 던진 카드)의 얼룩 + 흘러내리는 줄기. 팀원의 표는 오지 않는다(각자 스스로 푼다) */
  function drawCardInk(ctx, r, i, votes, color, t) {
    const [x, y, w, h] = HD.cardInk(i);
    ctx.clearRect(x, y, w, h);
    ctx.save();
    roundRect(ctx, x + 6, y + 6, w - 12, h - 12, 18);
    ctx.clip();
    const css = cssOf(color);
    const deep = cssOf(darkHex(color, 0.7));
    for (const pid of votes || []) {
      const sp = splatSpot(pid, i);
      const cx = x + sp.u * w;
      const cy = y + sp.v * h;
      const rnd = seeded(pid * 31 + i * 7 + 3);
      rnd();
      rnd();
      splat(ctx, cx, cy, 34 + rnd() * 12, css, rnd);
      // 흘러내리는 줄기: 맞은 지 얼마 안 된 얼룩만 자란다
      const hit = cardHits.find((c) => c.room === r.def.id && c.choice === i && c.pid === pid);
      const age = hit ? Math.min(1, (t - hit.at) / 1.2) : 1;
      ctx.fillStyle = deep;
      for (let k = 0; k < 3; k++) {
        const dx = cx - 20 + rnd() * 40;
        const len = (18 + rnd() * 40) * age;
        ctx.fillRect(dx, cy + 10, 5, len);
        ctx.beginPath();
        ctx.arc(dx + 2.5, cy + 10 + len, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    hd.dirty(x, y, w, h);
  }

  function drawHeader(ctx, text) {
    const [x, y, w, h] = HD.header;
    ctx.clearRect(x, y, w, h);
    roundRect(ctx, x + 4, y + 4, w - 8, h - 8, 22);
    ctx.fillStyle = "#fffdf8";
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#b7aad6";
    ctx.stroke();
    ctx.fillStyle = "#3a2d55";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size = 40;
    let lines;
    for (; size >= 16; size -= 2) {
      ctx.font = `bold ${size}px ${FONT_BODY}`;
      lines = wrapText(ctx, text, w - 60, size > 30 ? 2 : 3);
      if (lines.length * size * 1.12 <= h - 16 && !lines.some((l) => l.endsWith("…"))) break;
    }
    const lh = size * 1.12;
    lines.forEach((l, k) => ctx.fillText(l, x + w / 2, y + h / 2 - ((lines.length - 1) * lh) / 2 + k * lh));
    hd.dirty(x, y, w, h);
  }

  /** 카드 한 벌의 서명(바뀌면 새 카드 — 같은 문제를 다시 풀어도 card.serial 이 달라 새로 펼친다) */
  const cardId = (card) => (card ? (card.serial ?? `q${card.qi}`) : null);

  // ------------------------------------------------------------------ 상태 받기
  const api = {
    setArt(a) {
      art = a;
    },
    /** 이름표(카드의 이름 딱지): pid → 닉네임 */
    setNameOf(fn) {
      nameOf = typeof fn === "function" ? fn : () => "";
    },
    /** 경기 시작 때 한 번: [{ id, x, z, r, board: {x, z}, name? }] */
    setLayout(list) {
      rooms = new Map();
      for (const d of list || []) {
        const board = d.board || defaultBoardSpot(d.x, d.z);
        rooms.set(d.id, { def: { id: d.id, x: d.x, z: d.z, r: d.r || 5, board, name: d.name }, state: null, seen: -1, cardId: null, cardKey: "", inkKey: "", bloomT: -1, shatterT: -1, okT: -1, resultAt: -1 });
      }
      api.clear();
    },
    get layout() {
      return [...rooms.values()].map((r) => r.def);
    },
    /** 위쪽으로 얼마나 더 보여야 하나(화면 u): 판 꼭대기가 경기장 위 끝(돌린 좌표 minRz) 너머로 나가는 만큼 */
    topReach(minRz) {
      let reach = 0;
      const lay = boardLayout(BOARD.MAX_CARDS);
      for (const r of rooms.values()) {
        const rz = r.def.board.x * PROJ.sin + r.def.board.z * PROJ.cos;
        reach = Math.max(reach, (minRz - rz) * SQUASH + lay.topScreen + 0.6);
      }
      return reach;
    },
    /** 매 프레임 룸마다 */
    draw(room, frame) {
      const r = rooms.get(room.id);
      if (!r) return;
      r.state = room;
      r.seen = frame;
      const card = room.card;
      const id = cardId(card);
      if (id !== r.cardId) {
        // 새 카드(새 문제 · 같은 문제 다시 도전): 펼치기부터. 깨진 상태 · 성공 빛 · 판정 시각을 모두 지운다
        r.cardId = id;
        r.bloomT = card ? 0 : -1;
        r.shatterT = -1;
        r.okT = -1;
        r.resultAt = -1;
        r.cardKey = "";
        r.inkKey = "";
      }
      if (card && card.result && r.resultAt < 0) r.resultAt = now();
    },
    /** 내가 겨눈 카드(마우스가 카드 위) — null 이면 없음. a = { c, x, y, z(발 — 월드), color(PALETTE 번호) } */
    setAim(a) {
      aim = a && Number.isInteger(a.c) && a.c >= 0 ? a : null;
    },
    /** 지금 화면 위 풀이 판(CSS px — quizgeom.panelLayout 모양 + room(룸 id) · n(카드 수) · done(판정 남) ), 없으면 null */
    get panel() {
      return panel ? { ...panel.lay, room: panel.room, n: panel.n, done: panel.done } : null;
    },
    /** 화면 자리(CSS px)의 카드 번호(풀이 판이 없거나 판정이 났거나 카드 밖이면 −1) */
    cardAt(px, py, pad = 0) {
      return panel && !panel.done ? panelCardAt(panel.lay, px, py, pad) : -1;
    },
    /** 이 사람이 서 있는 존(열림 · 풀이 중)의 발밑 점등 색(팀 색), 아니면 −1 */
    zoneColorAt(x, z, team) {
      for (const r of rooms.values()) {
        const s = r.state;
        if (!s || s.state === "done") continue;
        if (Math.hypot(x - r.def.x, z - r.def.z) > r.def.r) continue;
        if (s.state === "solve" && s.team !== team) continue;
        return team >= 0 ? hexOf(team) : -1;
      }
      return -1;
    },

    // ---------------------------------------------------------------- 연출(R.fx.* 로 나간다)
    /**
     * 정답 폭탄. 그 룸의 카드가 우리 화면에 떠 있으면(우리 팀) 손 → 화면 위 카드로 QUIZ.WINDUP 동안, 아니면(다른 팀) 손 → 전광판(월드).
     * local = 내가 누르자마자 띄운 것(서버가 확정해 보낸 같은 던지기는 다시 띄우지 않는다).
     */
    answerBomb(x, y, z, roomId, choice, color, pid = -1, local = false) {
      const r = rooms.get(roomId);
      if (!r) return;
      const t = now();
      if (!local && pid >= 0) {
        const lt = localThrows.get(pid);
        if (lt && lt.choice === choice && t - lt.at < 2.5) {
          localThrows.delete(pid);
          return;
        }
      }
      if (local && pid >= 0) localThrows.set(pid, { choice, at: t });
      // 그 룸의 카드가 내 화면에 떠 있으면(우리 팀이 풀이 중) 화면 위 판으로: 내 것은 고른 카드로, 팀원의 것(choice −1)은 문제 띠로
      const onPanel = !!(r.state && r.state.card && !r.state.card.result);
      bombs.push({
        x0: x, y0: y + 1.2, z0: z, room: roomId, choice, color, t: 0, pid, team: PALETTE.findIndex((p) => p.hex === color),
        panel: onPanel, T: onPanel ? PANEL_BOMB_T : WORLD_BOMB_T * (0.8 + Math.random() * 0.35), end: null,
      });
    },
    cardHit(roomId, choice, color, pid = -1) {
      const r = rooms.get(roomId);
      if (!r) return;
      cardHits.push({ room: roomId, choice, at: now(), color, pid });
      if (cardHits.length > 24) cardHits.shift();
      r.inkKey = "";
      addShake(0.12);
    },
    roomResult(roomId, ok, color) {
      const r = rooms.get(roomId);
      if (!r) return;
      const mine = !!(r.state && r.state.card);
      const p = boardPoint(r.def.board, 0, BOARD.ROW_Y);
      const team = PALETTE.findIndex((q) => q.hex === color);
      if (ok) {
        fx.fountain(p.x, p.y, p.z, team, mine ? 46 : 24);
        if (mine) {
          r.okT = 0;
          fx.flash(team, 0.1);
        }
      } else if (mine) {
        r.shatterT = 0;
        const n = r.state.card.choices.length;
        for (let c = 0; c < n; c++) for (let k = 0; k < 6; k++) shards.push({ room: roomId, c, k, t: 0, n, seed: (roomId * 13 + c * 7 + k) | 0 });
        addShake(0.3);
      } else {
        fx.ring(p.x, p.y - 1, p.z, -1, 0.3, 2, 0.4, 0.6);
      }
    },
    clear() {
      bombs.length = 0;
      shards.length = 0;
      cardHits.length = 0;
      splashes.length = 0;
      localThrows.clear();
      panel = null;
      aim = null;
    },

    update(dt) {
      for (const r of rooms.values()) {
        if (r.bloomT >= 0) r.bloomT = r.bloomT + dt > BLOOM_T ? -1 : r.bloomT + dt;
        if (r.shatterT >= 0) r.shatterT = r.shatterT + dt > SHATTER_T ? -2 : r.shatterT + dt; // −2 = 깨져서 없다(다음 카드까지)
        if (r.okT >= 0) r.okT = r.okT + dt > 1.6 ? -1 : r.okT + dt;
      }
      for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        b.t += dt;
        if (b.t < b.T) continue;
        bombs.splice(i, 1);
        const r = rooms.get(b.room);
        if (!r) continue;
        if (b.panel) {
          // 카드에 명중(내 폭탄): 잉크 층 얼룩(표가 오면) + 흘러내림 + 화면에 튀는 방울. 팀원의 폭탄: 문제 띠에 "제출" 도장
          if (b.choice >= 0) api.cardHit(b.room, b.choice, b.color, b.pid);
          if (b.end) splashes.push({ x: b.end.x, y: b.end.y, color: b.color, t: 0, seed: (b.pid * 7 + b.choice) | 0, stamp: b.choice < 0 });
        } else {
          const p = boardPoint(r.def.board, 0, BOARD.ROW_Y);
          fx.ring(p.x, p.y, p.z, -1, 0.2, 1.2, 0.3, 0.7);
          fx.sparks(p.x + (Math.random() - 0.5) * 4, p.y - 0.8, p.z, b.team, 0.5);
        }
      }
      for (let i = shards.length - 1; i >= 0; i--) {
        shards[i].t += dt;
        if (shards[i].t > SHATTER_T) shards.splice(i, 1);
      }
      for (let i = splashes.length - 1; i >= 0; i--) {
        splashes[i].t += dt;
        if (splashes[i].t > (splashes[i].stamp ? 1.1 : 0.45)) splashes.splice(i, 1);
      }
    },

    // ---------------------------------------------------------------- 월드
    /** W = { world(상자), decals, stacks, spheres }, frame = 이번 프레임 번호 */
    emitWorld(W, frame, time, step = 1) {
      const p = { x: 0, y: 0, z: 0 };
      for (const r of rooms.values()) {
        const s = r.state;
        if (!s || r.seen !== frame || r.def.hidden) continue; // 던전 퀴즈의 룸은 보이지 않는다(풀이 판만 — emitPanel)
        const d = r.def;
        const teamHex = s.team >= 0 ? hexOf(s.team) : -1;
        const ringHex = s.state === "solve" ? teamHex : s.state === "done" ? ROOM_COLORS.done : ROOM_COLORS.open;
        // 존 고리(가는 흰 테 + 옅은 속) · 게이지(팀마다 한 줄씩 바깥으로)
        W.decals.push(d.x, 0.02, d.z, d.r * 2, d.r * 2, ringHex, 0.95, SHAPE.RING, 0.035, MODE.FLAT, 0.03, 0.2);
        W.decals.push(d.x, 0.02, d.z, d.r * 2 - 0.2, d.r * 2 - 0.2, ringHex, 0.12, SHAPE.DISC, 0, MODE.FLAT, 0.02);
        let gi = 0;
        (s.gauge || []).forEach((g, team) => {
          if (!(g > 0)) return;
          const gr = gaugeRadius(d.r, gi++);
          W.decals.push(d.x, 0.02, d.z, gr * 2, gr * 2, 0xffffff, 0.35, SHAPE.RING, 0.07, MODE.FLAT, 0.03);
          W.decals.arc(d.x, 0.02, d.z, gr, 0.07, hexOf(team), 1, g, 0.04);
        });
        // 빛 울타리: 둘레 조각마다 세운 벽(꼭짓점마다 깊이) — 층이 아래에서 위로 솟는다
        if (s.fence > 0 && teamHex >= 0) {
          const h = FENCE_H * Math.min(1, s.fence * 1.15);
          for (let k = 0; k < FENCE_SEG; k++) {
            const a0 = (k / FENCE_SEG) * Math.PI * 2;
            const a1 = ((k + 1) / FENCE_SEG) * Math.PI * 2;
            W.decals.wall(d.x + Math.cos(a0) * d.r, d.z + Math.sin(a0) * d.r, d.x + Math.cos(a1) * d.r, d.z + Math.sin(a1) * d.r, 0, h, teamHex, 0.55, 9, s.fence, 0.25);
          }
          if (lights) lights.add(d.x, 1.4, d.z, teamHex, d.r * 2, 0.5);
        }
        // 전광판 판(상태 판): 카메라를 보는 둥근 상자 하나. 문제 · 카드는 판에 붙이지 않는다(우리 팀 화면 위쪽에 고정 — emitPanel)
        boardPoint(d.board, 0, BOARD.ROW_Y, 0, p);
        W.world.box(p.x - PROJ.view[0] * 0.18, p.y - PROJ.view[1] * 0.18, p.z - PROJ.view[2] * 0.18, 9.2, 2.8, 0.3, "panel", s.state === "solve" ? 0.4 : 0, TILT);
      }
      // 다른 팀의 정답 폭탄(월드): 돌며 나는 층 스택(팀 색) + 방울 꼬리(광택 구) — 손에서 전광판까지
      const st = art && art.stacks.get("quiz/bomb");
      for (const bm of bombs) {
        if (bm.panel) continue;
        const r = rooms.get(bm.room);
        if (!r) continue;
        const k = bm.t / bm.T;
        const e = k * k * (3 - 2 * k) * 0.35 + k * 0.65;
        boardPoint(r.def.board, 0, BOARD.ROW_Y, 0, p);
        const x = bm.x0 + (p.x - bm.x0) * e;
        const z = bm.z0 + (p.z - bm.z0) * e;
        const y = bm.y0 + (p.y - bm.y0) * e + 3.2 * 4 * e * (1 - e);
        const scale = 1.25 - 0.55 * e; // 멀어지며 작아진다
        if (st) drawStack(W.stacks, st, poseFrames(st, "spin")[0], x, y - 0.3 * scale, z, time * 9, bm.team, { step, scale, xray: 0 });
        else W.spheres.ball(x, y, z, 0.45 * scale, bm.color, 0.5, STYLE.outline.color);
        for (let j = 1; j <= 5; j++) {
          const kk = Math.max(0, k - j * 0.05);
          const ee = kk * kk * (3 - 2 * kk) * 0.35 + kk * 0.65;
          W.spheres.ball(bm.x0 + (p.x - bm.x0) * ee, bm.y0 + (p.y - bm.y0) * ee + 12.8 * ee * (1 - ee) - j * 0.06, bm.z0 + (p.z - bm.z0) * ee, 0.16 * (1 - j * 0.14) * scale, bm.color, 0.6);
        }
      }
    },

    // ---------------------------------------------------------------- HD 레이어 ① 전광판 상태 딱지
    /** view = { toScreen(x, y, z, out) → 기기 픽셀 · out.depth(창 깊이), zoom(기기 px / u), devW, devH, cssW, cssH, dpr } */
    emitHD(view, frame) {
      const zoom = view.zoom;
      const dpr = view.dpr || 1;
      const sp = { x: 0, y: 0, depth: 0 };
      const p = { x: 0, y: 0, z: 0 };
      // 화면 아래 HUD 띠(무기 막대 · 체력 · 잉크%)와 위 띠(시계 · 팀 띠): 상태 딱지가 이 안으로 들어가면 흐려진다(겹쳐 읽히지 않게)
      const hudBottom = view.devH - Math.min(230, view.devH * 0.3) * dpr; // 이 아래(무기 막대 · 체력)에서는 다 사라진다
      const hudTop = Math.min(150, view.devH * 0.18) * dpr; // 이 위(시계 · 팀 띠)에서는 다 사라진다
      const fadeBand = 90 * dpr;
      for (const r of rooms.values()) {
        const s = r.state;
        if (!s || r.seen !== frame || r.def.hidden) continue;
        const d = r.def;
        boardPoint(d.board, 0, BOARD.ROW_Y, 0, p);
        view.toScreen(p.x, p.y, p.z, sp);
        if (sp.x < -600 || sp.x > view.devW + 600 || sp.y < -300 || sp.y > view.devH + 300) continue;
        const alpha = Math.max(0, Math.min(1, (hudBottom - sp.y) / fadeBand, (sp.y - hudTop) / fadeBand));
        if (alpha <= 0.02 || (panel && sp.y < panel.lay.bottom * dpr + 20 * dpr)) continue; // HUD 띠 · 풀이 판 밑으로 숨는다
        const teamName = s.team >= 0 ? T.teams?.[s.team] ?? "" : "";
        const letter = d.name ?? LETTERS[d.id] ?? String(d.id + 1);
        const left = Math.max(0, Math.ceil(s.left || 0));
        const sig = `${s.state}|${letter}|${s.mine?.left ?? ""}|${s.team}|${left}|${teamName}`;
        const slot = hd.label(`room${d.id}`, sig, true, (ctx, sl) => {
          const solving = s.state === "solve";
          const col = solving ? hexOf(s.team) : s.state === "done" ? ROOM_COLORS.done : 0xffffff;
          roundRect(ctx, sl.x + 4, sl.y + 4, sl.w - 8, sl.h - 8, 26);
          ctx.fillStyle = cssOf(col);
          ctx.fill();
          ctx.lineWidth = 6;
          ctx.strokeStyle = cssOf(STYLE.outline.color);
          ctx.stroke();
          ctx.fillStyle = solving || s.state === "done" ? "#fff" : cssOf(STYLE.outline.color);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = `34px ${FONT_POSTER}`;
          const text = solving ? `${teamName}  ${left}` : s.state === "done" ? `${letter}  ✓` : `${letter}  · ${s.mine?.left ?? ""}`;
          ctx.fillText(text, sl.x + sl.w / 2, sl.y + sl.h / 2 + 2);
        });
        const w = 8 * zoom;
        hd.quad(sp.x, sp.y, w, w / 4, [slot.x, slot.y, slot.x + slot.w, slot.y + slot.h], [1, 1, 1, alpha], MODE_HD.TEX, sp.depth - 0.002);
      }
    },

    // ---------------------------------------------------------------- HD 레이어 ② 풀이 판(화면 위쪽 고정 — 말풍선보다 위)
    emitPanel(view) {
      const dpr = view.dpr || 1;
      const t = now();
      const list = [];
      for (const r of rooms.values()) if (r.state && r.state.card) list.push({ card: r.state.card, r });
      const pr = pickPanel(list, t, (o) => o.r.resultAt, RESULT_KEEP);
      if (!pr) {
        panel = null;
        // 판이 사라졌으면 날던 폭탄 · 조각은 치운다
        for (let i = bombs.length - 1; i >= 0; i--) if (bombs[i].panel) bombs.splice(i, 1);
        shards.length = 0;
        return;
      }
      const r = pr.r;
      const s = r.state;
      const card = s.card;
      const n = card.choices.length;
      const lay = panelLayout(view.cssW, view.cssH, n);
      panel = { room: r.def.id, lay, n, done: !!card.result };
      // 캔버스: 글자(카드가 바뀔 때) · 잉크(표 · 흘러내림이 바뀔 때). 문제 띠와 카드는 같은 카드 상태에서 함께 그린다
      const key = `${r.cardId}|${card.text}|${card.choices.join("\u0001")}|${card.result ? card.result.c : -1}`;
      if (key !== r.cardKey) {
        r.cardKey = key;
        r.inkKey = "";
        drawHeader(hd.ctx, card.text);
        for (let c = 0; c < n; c++) drawCardText(hd.ctx, c, String(c + 1), card.choices[c], card.result);
      }
      const team = s.team >= 0 ? s.team : Number.isInteger(card.team) ? card.team : -1;
      const color = team >= 0 ? hexOf(team) : 0xff8fb8;
      // 내 표: 아직 내 폭탄이 날아가는 중이면 얼룩은 닿을 때까지 숨긴다
      const flying = new Set();
      for (const b of bombs) if (b.panel && b.room === r.def.id && b.choice >= 0) flying.add(b.pid);
      const votes = (card.votes || []).map((v) => (v || []).filter((pid) => !flying.has(pid)));
      const dripping = cardHits.some((c) => c.room === r.def.id && t - c.at < 1.25);
      const inkKey = `${votes.map((v) => v.join(",")).join("|")}|${dripping ? Math.floor(t * 15) : "s"}`;
      if (inkKey !== r.inkKey) {
        r.inkKey = inkKey;
        for (let c = 0; c < n; c++) drawCardInk(hd.ctx, r, c, votes[c], color, t);
      }
      // 펼치기(새 카드): 판이 위에서 내려오며 커지고 카드가 차례로
      const bloom = r.bloomT >= 0 ? r.bloomT / BLOOM_T : 1;
      const ease = (k) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
      const shatter = r.shatterT;
      const gone = shatter === -2;
      const headA = shatter >= 0 ? Math.max(0, 1 - shatter * 2.5) : gone ? 0 : ease(bloom * 1.6);
      // 문제 띠: 뒤판(팀 색 테) + 머리판
      const H = lay.head;
      const hx = (H.x + H.w / 2) * dpr;
      const hy = (H.y + H.h / 2 - (1 - ease(bloom * 1.6)) * 24) * dpr;
      if (headA > 0) {
        hd.quad(hx, hy, (H.w + 10) * dpr, (H.h + 10) * dpr, [0, 0, 1, 1], rgb01(color, 0.95 * headA), MODE_HD.SOLID, -1);
        const [ux, uy, uw, uh] = HD.header;
        hd.quad(hx, hy, H.w * dpr, H.h * dpr, [ux, uy, ux + uw, uy + uh], [1, 1, 1, headA], MODE_HD.TEX, -1);
      }
      // 카드
      const aimC = aim && !card.result ? aim.c : -1;
      for (let c = 0; c < n; c++) {
        if (shatter >= 0 || gone) continue; // 조각이 대신 그린다
        const k = lay.cards[c];
        const g = ease(bloom * 1.8 - c * 0.12);
        if (g <= 0) continue;
        const hot = c === aimC;
        const sc = (0.7 + 0.3 * g) * (hot ? 1.07 : 1);
        const cx = (k.x + k.w / 2) * dpr;
        const cy = (k.y + k.h / 2 + (1 - g) * 18) * dpr;
        const cw = k.w * sc * dpr;
        const ch = k.h * sc * dpr;
        // 겨눈 카드: 팀 색 빛 + 굵은 테
        if (hot) {
          const [gx, gy, gw, gh] = HD.glow;
          const pulse = 0.75 + 0.25 * Math.sin(t * 10);
          hd.quad(cx, cy, cw * 1.5, ch * 1.9, [gx, gy, gx + gw, gy + gh], rgb01(mixHex(color, 0xffffff, 0.3), 0.85 * pulse), MODE_HD.TEX, -1);
          hd.quad(cx, cy, cw + 12 * dpr, ch + 12 * dpr, [0, 0, 1, 1], rgb01(color, 1), MODE_HD.SOLID, -1);
        } else if (card.picked === c && !card.result) {
          hd.quad(cx, cy, cw + 8 * dpr, ch + 8 * dpr, [0, 0, 1, 1], rgb01(mixHex(color, 0xffffff, 0.15), 0.95), MODE_HD.SOLID, -1); // 내가 고른 카드: 팀 색 테
        } else hd.quad(cx, cy + 4 * dpr, cw + 4 * dpr, ch + 4 * dpr, [0, 0, 1, 1], [0.03, 0.02, 0.06, 0.6 * g], MODE_HD.SOLID, -1); // 그림자
        const [tx, ty, tw, th] = HD.cardText(c);
        hd.quad(cx, cy, cw, ch, [tx, ty, tx + tw, ty + th], [1, 1, 1, g], MODE_HD.CARD, -1);
        if (r.okT >= 0 && card.result && card.result.c === c) {
          const pulse = 0.55 + 0.45 * Math.sin(r.okT * 12);
          const [gx, gy, gw, gh] = HD.glow;
          hd.quad(cx, cy, cw * 1.9, ch * 2.2, [gx, gy, gx + gw, gy + gh], rgb01(mixHex(color, 0xffffff, 0.4), 0.75 * pulse * (1 - r.okT / 1.6)), MODE_HD.TEX, -1);
        }
      }
      // 실패 조각: 카드 면을 3×2 로 나눠 떨어뜨린다
      for (const sh of shards) {
        if (sh.room !== r.def.id || sh.c >= lay.cards.length) continue;
        const k = lay.cards[sh.c];
        const col = sh.k % 3, row = Math.floor(sh.k / 3);
        const pw = k.w / 3, ph = k.h / 2;
        const rnd = seeded(sh.seed);
        const vx = (rnd() - 0.5) * 160, vy = -60 - rnd() * 90, spin = (rnd() - 0.5) * 8;
        const sx = (k.x + (col + 0.5) * pw + vx * sh.t) * dpr;
        const sy = (k.y + (row + 0.5) * ph + vy * sh.t + 0.5 * 900 * sh.t * sh.t) * dpr;
        const [ttx, tty] = HD.cardText(sh.c);
        const uv = [ttx + col * (HD.CARD_W / 3), tty + row * (HD.CARD_H / 2), ttx + (col + 1) * (HD.CARD_W / 3), tty + (row + 1) * (HD.CARD_H / 2)];
        const shrink = 1 - 0.45 * Math.min(1, sh.t / SHATTER_T); // 떨어지며 작아지고 빨리 흐려진다(화면을 오래 덮지 않게)
        hd.quad(sx, sy, pw * dpr * shrink, ph * dpr * shrink, uv, [1, 1, 1, Math.max(0, 1 - sh.t / (SHATTER_T * 0.7))], MODE_HD.CARD, -1, spin * sh.t);
      }
      // 손 → 카드 곡선(조준선 · 폭탄이 같은 길): 손 자리는 매 프레임 다시 투영한다(카메라가 움직여도 손에서 나간다)
      const hand = { x: 0, y: 0, depth: 0 };
      const curve = (x0, y0, x1, y1, k, out) => {
        const mx = (x0 + x1) / 2;
        const my = Math.min(y0, y1) - Math.abs(x1 - x0) * 0.18 - 70 * dpr;
        const a = 1 - k;
        out.x = a * a * x0 + 2 * a * k * mx + k * k * x1;
        out.y = a * a * y0 + 2 * a * k * my + k * k * y1;
        return out;
      };
      const q = { x: 0, y: 0 };
      const [dx0, dy0, dw, dh] = HD.drop;
      const dropUV = [dx0, dy0, dx0 + dw, dy0 + dh];
      if (aimC >= 0 && !gone && shatter < 0) {
        view.toScreen(aim.x, aim.y + 1.2, aim.z, hand);
        const k = lay.cards[aimC];
        const ex = (k.x + k.w / 2) * dpr, ey = (k.y + k.h * 0.62) * dpr;
        const ac = hexOf(aim.color);
        const N = 20;
        const flow = (t * 1.6) % 1;
        for (let i = 1; i < N; i++) {
          const kk = (i + flow) / N;
          curve(hand.x, hand.y, ex, ey, kk, q);
          const sz = (10 + 6 * (1 - kk)) * dpr;
          const a = Math.min(1, 0.45 + kk * 3);
          hd.quad(q.x, q.y, sz * 1.45, sz * 1.45, dropUV, rgb01(0x120a24, 0.8 * a), MODE_HD.TEX, -1); // 어두운 테(밝은 바닥 위에서도 보이게)
          hd.quad(q.x, q.y, sz, sz, dropUV, rgb01(mixHex(ac, 0xffffff, 0.2), a), MODE_HD.TEX, -1);
        }
      }
      // 우리 팀 정답 폭탄: 손 → 그 카드의 얼룩 자리
      const [bx, by, bw, bh] = HD.bomb;
      const bombUV = [bx, by, bx + bw, by + bh];
      for (const b of bombs) {
        if (!b.panel || b.room !== r.def.id || b.choice >= lay.cards.length) continue;
        view.toScreen(b.x0, b.y0, b.z0, hand);
        let ex, ey;
        if (b.choice >= 0) {
          // 내 폭탄: 내가 고른 카드의 내 얼룩 자리
          const k = lay.cards[b.choice];
          const spot = splatSpot(b.pid, b.choice);
          ex = (k.x + spot.u * k.w) * dpr;
          ey = (k.y + spot.v * k.h) * dpr;
        } else {
          // 팀원의 폭탄: 어느 카드인지는 모른다 — 문제 띠 쪽(사람마다 다른 자리)으로 날아가 "제출" 도장
          const u = 0.15 + seeded(b.pid * 13 + 5)() * 0.7;
          ex = (H.x + u * H.w) * dpr;
          ey = (H.y + H.h * 0.55) * dpr;
        }
        b.end = { x: ex / dpr, y: ey / dpr };
        const kk = Math.min(1, b.t / b.T);
        const e = kk * (0.6 + 0.4 * kk);
        curve(hand.x, hand.y, ex, ey, e, q);
        const bc = hexOf(b.team);
        const sz = (58 - 16 * e) * dpr;
        const p2 = { x: 0, y: 0 };
        for (let j = 5; j >= 1; j--) {
          curve(hand.x, hand.y, ex, ey, Math.max(0, e - j * 0.035), p2);
          const ds = sz * (0.42 - j * 0.05);
          hd.quad(p2.x, p2.y, ds, ds, dropUV, rgb01(bc, 0.8 - j * 0.12), MODE_HD.TEX, -1);
        }
        hd.quad(q.x, q.y, sz * 1.22, sz * 1.22, bombUV, rgb01(0x1a1030, 1), MODE_HD.TEX, -1, t * 9);
        hd.quad(q.x, q.y, sz, sz, bombUV, rgb01(bc, 1), MODE_HD.TEX, -1, t * 9);
        hd.quad(q.x - sz * 0.14, q.y - sz * 0.06, sz * 0.26, sz * 0.26, dropUV, [1, 1, 1, 0.85], MODE_HD.TEX, -1);
      }
      // 명중 방울: 카드 위로 튀었다 사라진다. 팀원의 제출은 문제 띠 위에 "제출" 도장이 찍혔다 흐려진다
      for (const s2 of splashes) {
        if (s2.stamp) {
          const slot = hd.label("submitStamp", T.submitStamp ?? "SUBMIT", false, (ctx, sl) => {
            ctx.font = `24px ${FONT_POSTER}`;
            const label = T.submitStamp ?? "SUBMIT";
            const tw = Math.min(sl.w - 8, ctx.measureText(label).width + 26);
            roundRect(ctx, sl.x + (sl.w - tw) / 2, sl.y + 2, tw, sl.h - 4, 8);
            ctx.fillStyle = "#ffffff";
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = "#0b0a18";
            ctx.stroke();
            ctx.fillStyle = "#0b0a18";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, sl.x + sl.w / 2, sl.y + sl.h / 2 + 1);
          });
          const k = Math.min(1, s2.t / 0.15);
          const a = s2.t > 0.7 ? Math.max(0, 1 - (s2.t - 0.7) / 0.4) : 1;
          const sc = (1.6 - 0.6 * k) * dpr;
          hd.quad(s2.x * dpr, s2.y * dpr, slot.w * 0.55 * sc, slot.h * 0.95 * sc, [slot.x, slot.y, slot.x + slot.w, slot.y + slot.h], [1, 1, 1, a], MODE_HD.TEX, -1, -0.12);
          const [gx, gy, gw, gh] = HD.glow;
          if (s2.t < 0.3) hd.quad(s2.x * dpr, s2.y * dpr, 120 * dpr, 70 * dpr, [gx, gy, gx + gw, gy + gh], rgb01(s2.color, 0.7 * (1 - s2.t / 0.3)), MODE_HD.TEX, -1);
          continue;
        }
        const rnd = seeded(s2.seed);
        const k = s2.t / 0.45;
        for (let j = 0; j < 9; j++) {
          const a = rnd() * Math.PI * 2;
          const sp2 = (60 + rnd() * 90) * k;
          const x = (s2.x + Math.cos(a) * sp2) * dpr;
          const y = (s2.y + Math.sin(a) * sp2 * 0.8 + 160 * k * k) * dpr;
          const ds = (12 - 7 * k) * dpr * (0.6 + rnd() * 0.6);
          hd.quad(x, y, ds, ds, dropUV, rgb01(s2.color, 1 - k), MODE_HD.TEX, -1);
        }
      }
    },
  };
  return api;
}
