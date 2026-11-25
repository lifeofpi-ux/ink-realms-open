// [왕국전] 경기 사건 → 소리. 소리를 내는 곳은 이 파일 하나다(다른 파일에는 몇 줄짜리 훅만):
//   main.js   — sound.onMessage(m)(모든 서버 메시지 · fx 포함) · sound.frame(dt)(매 프레임) · sound.pop(색, x, y)(내 일꾼 "+N")
//               · sound.bind({ scene, control, hud, world(), hero() })
//   설정(끔 · 음량)은 settings.js(getSoundSettings · setSoundSettings · onSoundSettings) — ⚙ 설정 창이 그것을 쓴다
//   brawlscene — scene.onWork(종류, x, y, 내 것?, id): 일꾼 곡괭이 · 망치 · 들통이 닿는 순간(화면 안 일꾼만)
//   control   — control.targeting(공격 과녁 고르기 중)
//
// 듣는 자리 = 화면 가운데(scene.camCenter — 영웅을 따라가면 영웅). 거리 · 좌우 · 너무 먼 소리 버리기는 index.js 가 지도 칸으로 한다.
// 시끄러움 막기(32명 · 유닛 300):
//   · fx 한 묶음(50ms)마다 종류별 예산 — 듣는 자리에서 가까운 것부터 몇 개만(맞음 3 · 터짐 4 · 쓰러짐 2 · 던지기 3 …)
//   · 소리마다 1초에 낼 수 있는 횟수(CAP — 기본 15) · 몇몇은 따로 최소 간격(gate)
//   · 일꾼 소리: 1초에 내 일꾼 9번 · 남의 일꾼 6번까지, 한꺼번에 일하는 일꾼이 많을수록 작게(1/√(n/3))
//   · 엔진(index.js): 같은 이름 동시 발음 · 간격(플램), 전체 발음 수(데스크톱 32 · 휴대폰 14), 우선순위
import { createAudio } from "./index.js";
import { titleToggle } from "./ui.js";
import { getSoundSettings, setSoundSettings, onSoundSettings } from "./settings.js";
import { WEAPONS, UTYPE, BLD, INK, COUNTDOWN, TICK, GOAL, NEUTRAL } from "../../shared/constants.js";
import { PHASE, UF } from "../../shared/protocol.js";
import { ZOOM } from "../render/brawlscene.js";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const now = () => performance.now() / 1000;
const teamCol = (t) => (Number.isInteger(t) && t >= 0 && t < 8 ? t : -1); // 색마다 살짝 다른 음색(sfx.js colorPitch)
// 1초에 낼 수 있는 횟수(이보다 많으면 버린다). 적지 않은 것은 15
const CAP = { hit: 12, burst: 12, throw: 10, throwBig: 6, ko: 6, mko: 5, spawn: 4, msplat: 8, mshoot: 8, launch: 8, homing: 6, drill: 6, deflect: 8, bump: 6, crate: 6, slam: 6, warn: 4, ui: 10, select: 8, bubble: 9, coin: 5, chime: 4, glug: 5 };
// fx 한 묶음에서 종류별로 낼 수(가까운 것부터)
const BUDGET = { arc: 3, boom: 4, hit: 3, ko: 2, warn: 1, slam: 2, crate: 2, gem: 2, spawn: 1, item: 2, big: 3 };
// 일꾼 동작 → 소리
const WORK = { gold: "pick", core: "pickCore", build: "hammer", attack: "pick", scoop: "scoop", splash: "splash" };
// "+N" 글자 색(brawlscene POP_HEX) → 소리
const POP = { "#ffd23f": "coin", "#d9a8ff": "chime", "#ff7df5": "glug" };
const ITEM_SND = ["heal", "boost", "shield"]; // ITEMS 순서(에너지 · 부스터 · 보호막)
const EVENTS = ["pointerdown", "pointerup", "touchend", "click", "keydown"]; // 첫 손짓(iOS 는 touchend · click 이어야 열린다)

export function createGameSound() {
  const coarse = !!globalThis.matchMedia?.("(pointer: coarse)")?.matches;
  const lite = coarse || (globalThis.navigator?.hardwareConcurrency || 8) <= 4; // 휴대폰 · 약한 기기: 가벼운 모드
  const audio = createAudio({ lite });
  // ── 설정(끔 · 음량): settings.js 하나로 — ⚙ 설정 창 · 첫 화면 단추 · M 키 어디서 바꿔도 여기로 온다 ──
  let set = getSoundSettings();
  const apply = (s) => {
    set = s;
    audio.setVolumes(s);
    audio.setMuted(!!s.mute);
  };
  apply(set);
  onSoundSettings(apply);
  titleToggle();

  // ── 첫 손짓에 켜기(브라우저는 손짓 전에 소리를 막는다). 끊겼으면(iOS 전화 · 다른 앱) 다음 손짓에 다시 ──
  let listening = false;
  function listen(on) {
    if (on === listening) return;
    listening = on;
    for (const ev of EVENTS) {
      if (on) window.addEventListener(ev, tryUnlock, { capture: true, passive: true });
      else window.removeEventListener(ev, tryUnlock, { capture: true });
    }
  }
  let watched = null;
  function tryUnlock() {
    if (!audio.unlock()) return;
    audio.music.start();
    const c = audio.context;
    if (c && c !== watched) {
      watched = c;
      c.addEventListener?.("statechange", () => listen(c.state !== "running"));
    }
    if (c && c.state === "running") listen(false);
  }
  listen(true);

  // 단추 누르기 "딸깍"(첫 화면 · 대기실 · HUD · 판 — 어느 단추든)
  document.addEventListener("click", (e) => {
    const b = e.target?.closest?.("button");
    if (b && !b.disabled) snd("ui", { pitch: b.classList.contains("primary") ? 0.85 : 1 });
  }, true);
  // M = 소리 끄기 · 켜기(글 칸에 쓰는 중이면 아니다)
  window.addEventListener("keydown", (e) => {
    if (e.code !== "KeyM" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    const s = setSoundSettings({ mute: !set.mute });
    if (B?.world?.()) B.hud?.toast?.(s.mute ? "🔇 소리 꺼짐 (M)" : "🔊 소리 켬 (M)");
  });

  // ── 내기 · 세기 ──
  const stat = Object.create(null); // 이름 → { req, played, max(1초 최고), sec, n }
  const win = Object.create(null); // 이름 → { t0, n } — 1초 창
  function snd(name, o) {
    const s = stat[name] || (stat[name] = { req: 0, played: 0, max: 0, sec: -1, n: 0 });
    s.req++;
    if (set.mute) return false;
    const t = now();
    const w = win[name] || (win[name] = { t0: t, n: 0 });
    if (t - w.t0 >= 1) { w.t0 = t; w.n = 0; }
    if (w.n >= (CAP[name] ?? 15)) return false;
    const ok = audio.play(name, o);
    if (!ok) return false;
    w.n++;
    s.played++;
    const sec = Math.floor(t);
    if (sec !== s.sec) { s.sec = sec; s.n = 0; }
    if (++s.n > s.max) s.max = s.n;
    return true;
  }
  const lastAt = Object.create(null);
  /** key 로 gap 초에 한 번만 */
  function gate(key, gap) {
    const t = now();
    if (t - (lastAt[key] ?? -1e9) < gap) return false;
    lastAt[key] = t;
    return true;
  }

  // ── 경기 상태 ──
  let B = null; // { scene, control, hud, world(), hero() }
  const W = () => B?.world?.() || null;
  let lx = 0, ly = 0; // 듣는 자리(지도 칸)
  let heat = 0; // 가까운 싸움(음악 강도)
  let carry = { my: false, team: false, enemy: false };
  let prevMe = null, prevTeam = null;
  let lastSnap = null, seenProj = new Set(), rage = new Set(), towerHp = -1;
  let countLast = -1, playStarted = false, finalOn = false, ended = false;
  let lastSpentT = 0, myThrowAt = -9, chargePrev = 0, prevW = -1;
  let bubbleT = 0, lastFillAt = 0, wasFull = true;
  let selN = 0, panelWas = false, targetWas = false;
  let giveAt = -9, lobbyN = -1;
  const busy = new Map(); // 일꾼 id → 마지막으로 소리 낸 때
  const workWin = { t0: 0, n: 0 };

  function resetMatch(m) {
    prevMe = prevTeam = null;
    lastSnap = null; seenProj = new Set(); rage = new Set(); towerHp = -1;
    countLast = -1; playStarted = Number.isInteger(m?.phase) && m.phase >= PHASE.PLAY; finalOn = false; ended = false;
    lastSpentT = performance.now(); myThrowAt = -9; chargePrev = 0; prevW = -1;
    bubbleT = 0; lastFillAt = 0; wasFull = true;
    selN = 0; panelWas = false; targetWas = false;
    heat = 0; carry = { my: false, team: false, enemy: false };
    busy.clear();
  }

  function heatAt(x, y, amt) {
    if (Math.hypot(x - lx, y - ly) < 14) heat = Math.min(1, heat + amt);
  }

  // ── 서버 메시지 ──
  function onMessage(m) {
    if (!m || typeof m.t !== "string") return;
    try {
      switch (m.t) {
        case "lobby": onLobby(m); break;
        case "error": snd("deny"); break;
        case "start": onStart(m); break;
        case "fx": onFx(m.e || []); break;
        case "me": onMe(m); break;
        case "team": onTeam(m); break;
        case "note": onNote(m); break;
        case "score": onScore(m); break;
        case "quiz": snd("quiz"); break;
        case "quizResult": snd(m.ok ? "right" : "wrong"); break;
        case "elim": onElim(m); break;
        case "end": onEnd(m); break;
      }
    } catch (err) {
      // 소리 때문에 경기가 멈추면 안 된다
      if (!onMessage.warned) { onMessage.warned = true; console.warn("[sound]", err); }
    }
  }

  function onLobby(m) {
    audio.setCharge(0);
    audio.music.setState("menu");
    const n = (m.members?.length || 0) + (m.bots?.length || 0);
    if (lobbyN >= 0 && n > lobbyN) snd("join");
    else if (lobbyN >= 0 && n < lobbyN) snd("leave");
    lobbyN = n;
  }

  function onStart(m) {
    resetMatch(m);
    lobbyN = -1;
    audio.music.setState("play");
    audio.music.setIntensity(0);
    if (!playStarted) snd("open", { pitch: 0.8 }); // 이기는 방법 카드
  }

  /** fx 한 묶음: 후보를 모아 종류별로 가까운 것부터 예산만큼 */
  function onFx(list) {
    const w = W();
    if (!w || !list.length) return;
    const hid = w.me?.heroId;
    const hp = w.heroPos;
    const myTeam = w.team;
    const view = B.control?.view;
    const cands = [];
    const add = (kind, name, o) => cands.push({ kind, name, o, d: Number.isFinite(o.x) ? Math.hypot(o.x - lx, o.z - ly) : 0 });
    let fwk = null;
    const arcFrom = [];
    for (const e of list) {
      switch (e.k) {
        case "arc": {
          const Wp = WEAPONS[e.w] || WEAPONS[0];
          if (Wp.direct) break; // 곧게 나는 것은 스냅숏의 탄으로
          if (Wp.nuke) add("big", "bombFall", { x: e.x1, z: e.y1, power: 1 }); // 메가 폭탄: 떨어질 곳에서 휘파람
          const mine = e.team === myTeam && hp && now() - myThrowAt < 0.9 && Math.hypot(e.x0 - hp.x, e.y0 - hp.y) < 2.2;
          if (mine) break; // 내 던지기는 누른 순간 이미 냈다
          if (arcFrom.some((a) => Math.abs(a[0] - e.x0) < 0.3 && Math.abs(a[1] - e.y0) < 0.3)) break; // 삼발 풍선 셋은 한 번
          arcFrom.push([e.x0, e.y0]);
          add("arc", e.big || Wp.nuke ? "throwBig" : "throw", { x: e.x0, z: e.y0, power: 0.5, color: teamCol(e.team) });
          break;
        }
        case "boom": {
          const Wp = WEAPONS[e.w] || WEAPONS[0];
          heatAt(e.x, e.y, e.big ? 0.08 : 0.05);
          if (Wp.nuke) add("big", "nuke", { x: e.x, z: e.y, power: 1, color: teamCol(e.team) });
          else if (e.sub) { if (!fwk) fwk = { x: e.x, z: e.y }; } // 폭죽 둘레 터짐은 한 소리로
          else add("boom", "burst", { x: e.x, z: e.y, power: e.big ? 1 : Wp.firework ? 0.4 : 0.55, color: teamCol(e.team) });
          break;
        }
        case "hit": {
          const x = e.x, z = e.y;
          if (e.sh) { add("hit", "deflect", { x, z, power: e.id === hid ? 1 : 0.5 }); break; } // 보호막 · 무적이 막았다
          if (e.bump) { add("hit", "bump", { x, z, power: 0.5 }); break; } // 몸으로 밀기
          if (e.pop != null) { add("hit", "msplat", { x, z, power: 0.5 }); break; } // 몬스터 먹물이 닿았다
          if (!(e.dmg > 0)) break;
          if (hid != null && e.id === hid) {
            snd("hitSelf", { power: clamp01(e.dmg / 30) });
            heat = Math.min(1, heat + 0.15);
            break;
          }
          const u = view?.byId?.get(e.id);
          const ty = u?.type;
          const mon = ty === UTYPE.NPC || ty === UTYPE.PET;
          const small = ty === UTYPE.WORKER || ty === UTYPE.BOT;
          add("hit", "hit", { x, z, power: ty === UTYPE.HERO ? 0.45 + Math.min(0.5, e.dmg / 40) : mon ? 0.35 : 0.25, pitch: mon ? 0.75 : small ? 1.2 : 1, gain: small ? 0.7 : 1 });
          heatAt(x, z, 0.03);
          break;
        }
        case "ko": {
          if (hid != null && e.id === hid) {
            snd("koSelf");
            heat = Math.min(1, heat + 0.2);
            break;
          }
          const u = view?.byId?.get(e.id);
          const mon = u ? u.type === UTYPE.NPC || u.type === UTYPE.PET : e.team === NEUTRAL;
          if (mon) add("ko", "mko", { x: e.x, z: e.y, power: u?.type === UTYPE.NPC ? 0.8 : 0.5 });
          else if (u && (u.type === UTYPE.WORKER || u.type === UTYPE.BOT)) add("ko", "ko", { x: e.x, z: e.y, power: 0.4, pitch: 1.35, gain: 0.55 });
          else add("ko", "ko", { x: e.x, z: e.y, power: 1, color: teamCol(e.team) });
          heatAt(e.x, e.y, 0.12);
          break;
        }
        case "warn": add("warn", "warn", { x: e.x, z: e.y, power: clamp01((e.t || 0.8) / 1.6) }); break;
        case "slam": add("slam", "slam", { x: e.x, z: e.y, power: 0.8 }); break;
        case "crate": {
          const S = w.S || 64;
          if (Number.isInteger(e.i)) add("crate", "crate", { x: (e.i % S) + 0.5, z: Math.floor(e.i / S) + 0.5, power: 0.7 });
          break;
        }
        case "bdown": {
          if (w.out.has(e.team)) break; // 탈락한 팀의 건물이 한꺼번에 사라진다 — 탈락 소리 하나로
          if (Number.isFinite(e.x)) add("big", "collapse", { x: e.x, z: e.y, power: 1 });
          if (e.team === myTeam && gate("alarm", 2)) snd("alarm");
          break;
        }
        case "gem": {
          const o = { x: e.x, z: e.y };
          if (e.ev === "shield") add("big", "shieldCrack", { ...o, power: 1 });
          else if (e.ev === "pop") add("big", "gemPop", { ...o, power: e.value >= 2 ? 1 : 0.5 });
          else if (e.ev === "pick") {
            if (hid != null && e.id === hid) snd("gemPick", { power: 1 });
            else add("gem", "gemPick", { ...o, power: e.team === myTeam ? 0.8 : 0.3 });
          } else if (e.ev === "steal") add("gem", e.team === myTeam ? "gemPick" : "gemSteal", { ...o, power: 0.8 });
          else if (e.ev === "drop") add("gem", "gemDrop", { ...o, power: 0.8 });
          else if (e.ev === "return") add("gem", "gemReturn", { ...o, power: 0.6 });
          // score 는 score 메시지가 낸다(한 번)
          break;
        }
        case "spawn": {
          if (hid != null && e.id === hid) { snd("spawn", { power: 1 }); break; } // 내 영웅이 다시 나왔다
          if (e.bld || e.lv || e.camp != null || !e.id) break; // 공급소 완성(우리 팀 알림) · 몬스터 레벨(내 것은 me) · 숲 무리 다시 나옴
          if (Number.isFinite(e.x)) add("spawn", "spawn", { x: e.x, z: e.y, power: 0.3, gain: 0.7 });
          break;
        }
        case "item": {
          const name = ITEM_SND[e.kind] || "heal";
          if (hid != null && e.id === hid) snd(name, { power: 1 });
          else add("item", name, { x: e.x, z: e.y, power: 0.4 });
          break;
        }
        case "pull": add("big", "vortex", { x: e.x, z: e.y, power: 0.8 }); break;
        // throw(던지는 동작 — arc · 탄이 낸다) · refill(내 것은 frame 이) 은 소리 없음
      }
    }
    if (fwk) add("boom", "firework", { x: fwk.x, z: fwk.z, power: 0.8 });
    if (!cands.length) return;
    cands.sort((a, b) => a.d - b.d);
    const used = Object.create(null);
    for (const c of cands) {
      const n = used[c.kind] || 0;
      if (n >= (BUDGET[c.kind] ?? 2)) continue;
      used[c.kind] = n + 1;
      snd(c.name, c.o);
    }
  }

  function onMe(m) {
    const p = prevMe;
    const hasWal = Number.isFinite(m.gold);
    prevMe = {
      heroOut: !!m.heroOut,
      gold: hasWal ? m.gold : null,
      core: hasWal ? m.core || 0 : null,
      pet: m.pet ? { state: m.pet.state, level: m.pet.level | 0 } : null,
    };
    if (!p) return;
    if (m.heroOut && !p.heroOut && !m.teamOut) snd("out"); // 영웅 목숨이 다했다 — 이제 지휘관
    // 내 지갑에서 골드 · 코어가 줄었다 = 샀다(무기 묶음 · 일꾼 · 몬스터 · 랩 · 퍼실리티 · 공급소). 보내기는 give 소리가 했다
    if (hasWal && p.gold != null && (m.gold < p.gold - 0.5 || (m.core || 0) < p.core - 0.5) && now() - giveAt > 1.5 && gate("spend", 0.3)) snd("spend");
    if (m.pet && p.pet) {
      if (p.pet.state === "hatching" && m.pet.state === "alive") snd("hatch");
      else if (m.pet.state === "alive" && p.pet.state === "alive" && (m.pet.level | 0) > p.pet.level) snd("levelUp");
    }
  }

  function onTeam(m) {
    const key = (j) => (j ? `${j.kind}:${j.key}` : "");
    const lab = key(m.lab?.job), fac = key(m.fac?.job);
    const p = prevTeam;
    prevTeam = { lab, fac };
    if (!p) return;
    // 랩 · 퍼실리티 일이 끝났다(고장으로 멈춘 것은 아니다)
    const labDone = p.lab && p.lab !== lab && !m.lab?.broken;
    const facDone = p.fac && p.fac !== fac && !m.fac?.broken && !p.fac.startsWith("hatch");
    if ((labDone || facDone) && gate("fanfare", 0.8)) snd("fanfare");
  }

  function onNote(m) {
    const text = String(m.text || "");
    switch (m.kind) {
      case "warn": if (gate("deny", 0.35)) snd("deny"); break; // 서버가 거절했다
      case "give":
        // 보낸 사람: "○○에게 … 보냈어요" · 받은 사람: "○○이(가) … 보냈어요"
        if (/에게 /.test(text)) { giveAt = now(); snd("give", { power: 0 }); }
        else snd("give", { power: 1 });
        break;
      case "lab": case "fac": if (/놓아/.test(text)) snd("release"); break; // 일 끝 = team · 부화 · 레벨 = me · 산 것 = 지갑
      case "train": snd("ready"); break;
      case "built": snd("built"); break;
      case "hunt": if (gate("hunt", 1)) snd("chime", { power: 0.4 }); break; // 몬스터 처치 — 코어
      case "alarm":
        if (/화났어요/.test(text)) roar(m.at?.x, m.at?.y);
        else if (/공격받고/.test(text)) { if (gate("alarm", 8)) snd("alarm"); }
        break; // 무너짐 · 고장 = bdown · 탈락 = elim
    }
  }

  function roar(x, y) {
    if (!gate("roar", 10)) return; // 8팀이면 지킴이가 자주 화난다 — 10초에 한 번
    snd("roar", Number.isFinite(x) ? { x, z: y, power: 1 } : { power: 1 });
    heat = Math.min(1, heat + 0.25);
  }

  function onScore(m) {
    const w = W();
    if (!w) return;
    const v = m.value ?? 1;
    if (v < 0) snd("gemScoreOther");
    else if (m.team === w.team || w.team < 0) snd("gemScore", { power: v >= 2 ? 1 : 0.5 });
    else snd("gemScoreOther");
    heat = Math.min(1, heat + 0.2);
  }

  function onElim(m) {
    const w = W();
    if (!w) return;
    if (m.team === w.team) { audio.setCharge(0); snd("elimSelf"); }
    else snd("elimOther", { power: m.by === w.team && m.reason === "tower" ? 1 : 0.3 });
  }

  function onEnd(m) {
    ended = true;
    audio.setCharge(0);
    const w = W();
    snd("roundEnd");
    const mine = w && w.team >= 0 ? w.team : null;
    const has = m.winner != null && m.winner >= 0;
    setTimeout(() => {
      if (mine == null || !has) snd(has ? "win" : "roundEnd", { pitch: 1.12 }); // 진행자 · 무승부
      else snd(m.winner === mine ? "win" : "lose");
    }, 900);
    audio.music.setState("results");
  }

  // ── 매 프레임 ──
  function frame(dt) {
    const w = W();
    if (!w) {
      audio.setCharge(0);
      return;
    }
    const sc = B.scene;
    const c = sc.camCenter();
    lx = c.x; ly = c.y;
    audio.setListener(c.x, c.y, (sc.viewTiles || ZOOM.def) / ZOOM.def);
    const hero = B.hero?.() || null;
    const alive = !!hero && !!w.me && !(w.me.dead > 0) && !w.me.heroOut && !w.spectator;
    // 충전음(브로울스와 같다 — 누르고 있는 동안 차오른다)
    const charge = alive && hero.st.charging ? hero.chargeFrac() : 0;
    audio.setCharge(ended ? 0 : charge);
    if (hero) {
      // 내 던지기: 보낸 던지기(spent)가 늘면 곧바로 낸다(서버의 arc 를 기다리지 않는다 — 그 arc 는 onFx 가 건너뛴다)
      for (const s of hero.st.spent) {
        if (!(s.t > lastSpentT)) continue;
        lastSpentT = s.t;
        myThrowAt = now();
        const Wp = WEAPONS[s.w] || WEAPONS[0];
        if (Wp.direct) snd(Wp.drill ? "drill" : Wp.homing ? "homing" : "launch", { power: 1 });
        else snd(Wp.nuke || chargePrev >= 1 ? "throwBig" : "throw", { power: 1, color: teamCol(w.team) });
      }
      // 무기를 바꿨다: "뽁" 장전(무기마다 조금씩 높게)
      if (hero.st.w !== prevW) {
        if (prevW >= 0) snd("ammo", { power: 0.8, pitch: 1 + hero.st.w * 0.05 });
        prevW = hero.st.w;
      }
    }
    chargePrev = charge;
    countdown(w);
    refill(w, hero, alive, dt);
    if (w.latest && w.latest !== lastSnap) {
      lastSnap = w.latest;
      onSnap(w, lastSnap);
    }
    uiFrame();
    musicFrame(w, dt);
  }

  /** 시작 전 세기(8초 — 이기는 방법 카드가 떠 있다): 8~4 째깍, 3 · 2 · 1 삑, 시작 = GO + 나팔 */
  function countdown(w) {
    if (playStarted) return;
    if (w.phase === PHASE.PLAY) {
      playStarted = true;
      snd("go");
      snd("horn");
      return;
    }
    const tick = w.latest?.tick;
    if (w.phase !== PHASE.COUNTDOWN || !Number.isFinite(tick)) return;
    // 모든 팀이 함께 세는 시작 틱(U32 — 서버의 count). 아직 모르면 세지 않는다
    if (!Number.isFinite(w.playTick)) return;
    const left = Math.max(0, Math.ceil((w.playTick - tick) * TICK));
    if (left === countLast || left < 1 || left > COUNTDOWN) return;
    countLast = left;
    if (left <= 3) snd("count", { pitch: 1 + (3 - left) * 0.12 });
    else snd("tick", { pitch: left % 2 ? 1 : 0.84 });
  }

  /** 공급소에서 채우는 동안 꿀렁꿀렁(점점 높게), 가득 차면 "가득!" 딩 */
  function refill(w, hero, alive, dt) {
    if (!hero || !alive) { wasFull = true; return; }
    const filling = w.heroRefilling() && w.wallet().ink > 0;
    let tank = hero.tank();
    // HUD 와 같이 서버의 me 사이를 앞질러 센다(HUD 의 "가득!" 과 같은 때)
    if (filling) tank = Math.min(INK.TANK, tank + INK.REFILL_RATE * Math.min(0.4, (performance.now() - (w.meAt || 0)) / 1000));
    const full = tank >= INK.TANK - 0.5;
    const t = now();
    if (filling && !full) {
      lastFillAt = t;
      bubbleT -= dt;
      if (bubbleT <= 0) {
        bubbleT = 0.12 + Math.random() * 0.12;
        snd("bubble", { power: tank / INK.TANK });
      }
    }
    if (full && !wasFull && t - lastFillAt < 1.5) snd("full");
    wasFull = full;
  }

  /** 스냅숏(10Hz): 새 탄(미사일 · 유도 · 드릴 · 몬스터 먹물) · 화난 보스 · 보석 운반 · 우리 탑 체력 */
  function onSnap(w, s) {
    const myTeam = w.team;
    const hp = w.heroPos;
    const cur = new Set();
    const shots = [];
    for (const p of s.projs) {
      cur.add(p.id);
      if (seenProj.has(p.id)) continue;
      if (p.kind >= 100) { shots.push({ name: "mshoot", o: { x: p.x, z: p.y, power: 0.6 } }); continue; }
      const Wp = WEAPONS[p.kind];
      if (!Wp) continue;
      if (p.team === myTeam && hp && now() - myThrowAt < 0.8 && Math.hypot(p.x - hp.x, p.y - hp.y) < 3) continue; // 내가 쏜 것
      shots.push({ name: Wp.drill ? "drill" : Wp.homing ? "homing" : "launch", o: { x: p.x, z: p.y, power: 0.55 } });
    }
    seenProj = cur;
    if (shots.length) {
      for (const q of shots) q.d = Math.hypot(q.o.x - lx, q.o.z - ly);
      shots.sort((a, b) => a.d - b.d);
      for (const q of shots.slice(0, 3)) snd(q.name, q.o);
    }
    const rageNow = new Set();
    const c = { my: (w.me?.carry || 0) > 0, team: false, enemy: false };
    for (const u of s.units) {
      if (u.flags & UF.RAGE) {
        rageNow.add(u.id);
        if (!rage.has(u.id)) roar(u.x, u.y); // 가운데 보스 · 섹션 지킴이가 화났다
      }
      if (u.flags & UF.GEM) {
        if (u.team === myTeam) c.team = true;
        else c.enemy = true;
      }
    }
    rage = rageNow;
    carry = c;
    const tw = s.buildings.find((b) => b.kind === BLD.TOWER && b.team === myTeam);
    if (tw) {
      if (towerHp >= 0 && tw.hp < towerHp - 0.001 && gate("towerHit", 2.5)) snd("towerHit");
      towerHp = tw.hp;
    }
  }

  /** 고르기 "삑" · 판 열기 "뽁" · 공격 과녁 "삑삑" */
  function uiFrame() {
    const ctl = B.control;
    const n = ctl?.ui?.selected?.size || 0;
    const po = !!B.hud?.panelOpen;
    const tg = !!ctl?.targeting;
    if (po && !panelWas) snd("open");
    else if (n > selN) snd("select", { pitch: n > 1 ? 1.12 : 1 });
    if (tg && !targetWas) snd("target");
    selN = n; panelWas = po; targetWas = tg;
  }

  /** 음악 강도: 가까운 싸움(heat) + 보석 운반 + 점수가 목표에 가까운 정도. 마지막 2분 · 목표 2점 앞 = final */
  function musicFrame(w, dt) {
    heat = Math.max(0, heat - dt * 0.08);
    const goal = w.goal || GOAL;
    let top = 0;
    for (let t = 0; t < (w.teams || 0); t++) top = Math.max(top, w.scores?.[t] || 0);
    const gem = carry.my ? 0.3 : carry.team ? 0.18 : carry.enemy ? 0.12 : 0;
    let I = Math.min(0.6, heat) + gem + 0.3 * Math.min(1, top / goal);
    if (w.phase !== PHASE.PLAY) I = Math.min(I, 0.15);
    audio.music.setIntensity(clamp01(I));
    if (w.phase === PHASE.PLAY && !ended) {
      const fin = (w.timeLeft > 0 && w.timeLeft <= 120) || top >= goal - 2;
      if (fin !== finalOn) {
        finalOn = fin;
        audio.music.setState(fin ? "final" : "play");
      }
    }
  }

  // ── 화면 훅 ──
  /** 일꾼이 곡괭이 · 망치 · 들통으로 친 순간(brawlscene — 화면 안 일꾼만) */
  function work(kind, x, y, mine, id) {
    const name = WORK[kind];
    if (!name || set.mute) return;
    const t = now();
    if (t - workWin.t0 >= 1) { workWin.t0 = t; workWin.n = 0; }
    if (workWin.n >= (mine ? 9 : 6)) return;
    busy.set(id, t);
    let n = 0;
    for (const [k, at] of busy) {
      if (t - at > 1.5) busy.delete(k);
      else n++;
    }
    const p = (mine ? 0.75 : 0.45) / Math.sqrt(Math.max(1, n / 3));
    if (snd(name, { x, z: y, power: p, gain: mine ? 1 : 0.7, pitch: kind === "attack" ? 0.6 : 1 })) workWin.n++;
  }

  /** 내 일꾼이 한 번 캐기를 마쳐 "+N" 이 떴다(색 = 자원) */
  function pop(color, x, y) {
    const name = POP[String(color).toLowerCase()] || "coin";
    if (gate("pop:" + name, 0.15)) snd(name, { x, z: y, power: 0.6, gain: 0.85 });
  }

  /** 못 던짐(HUD 가 띠를 띄우는 그때): 잉크 · 다 씀 = 마른 "틱-턱", 보석 · 폭탄 기다림 = 버저 */
  function cant(why) {
    if (!gate("cant", 0.3)) return;
    if (why === "ink" || why === "empty") snd("empty");
    else if (why === "carry" || why === "bombcd") snd("deny");
  }

  function bind(c) {
    B = c;
    if (c.scene && "onWork" in c.scene) c.scene.onWork = work;
    // HUD 의 cantThrow 를 감싼다(control.js 가 hud.cantThrow 로 부른다)
    const ct = c.hud?.cantThrow;
    if (typeof ct === "function") c.hud.cantThrow = (why) => { cant(why); return ct(why); };
  }

  const api = {
    audio,
    bind,
    onMessage,
    frame,
    pop,
    /** ?debug 확인용: 소리마다 { 부른 횟수, 낸 횟수, 1초 최고 } */
    stats: () => JSON.parse(JSON.stringify(stat)),
  };
  if (new URLSearchParams(location.search).has("debug")) {
    globalThis.__realmsAudio = {
      ...api,
      engine: () => ({ ...audio.stats(), counts: audio.counts(), names: audio.names, lite: audio.lite }),
      offline: (names, o) => import("./debug.js").then((m) => m.offlineCheck(names, o)),
      offlineMusic: (o) => import("./debug.js").then((m) => m.offlineMusic(o)),
      reset() { for (const k in stat) delete stat[k]; },
      getSoundSettings, setSoundSettings,
    };
  }
  return api;
}
