// 잉크 브로울스 왕국전 v2 「깃발의 탑」 — 브라우저 진입점. 화면 전환(첫 화면 → 대기실 → 세기 → 경기 → 결과)과 메시지 연결.
//
// 모듈 나눔: net(통신) · world(지도 · 스냅숏 보간 · me/team) · hero(내 영웅 몸 · 던지기) · control(마우스 · 키 · 터치 → 명령) ·
//           render/brawlscene(브로울스 렌더러로 그리기) · ui/hud(HUD · 판 · 퀴즈 · 결과) · ui/lobby(첫 화면 · 대기실) · touch(휴대폰 조작부)
import "@fontsource/black-han-sans";
import "./style.css";
import { createNet } from "./net.js";
import { createWorld } from "./world.js";
import { createHero } from "./hero.js";
import { createScene } from "./render/brawlscene.js";
import { createControl } from "./control.js";
import { createTouch } from "./touch.js";
import { createHud } from "./ui/hud.js";
import { createLobby } from "./ui/lobby.js";
import { showRules, closeRules, setBrief, startCount } from "./ui/rules.js";
import { generateMap } from "../shared/map.js";
import { loadQuality, createPerfHud } from "./render/quality.js";
import { createQualityAdvisor } from "./render/qualityadvisor.js";
import { createSettings } from "./ui/settings.js";
import { createGameSound } from "./audio/game.js";

const canvas = document.getElementById("game");
const screens = document.getElementById("screens");
const hudRoot = document.getElementById("hud");

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
let key = store.get("ibr-key");
if (!key) { key = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("ibr-key", key); }
let myName = store.get("ibr-name") || "";

const scene = createScene(canvas);
scene.R.setQuality(loadQuality()); // 화질(자동 · 높음 · 보통 · 낮음 — ⚙ 설정 창에서 바꾼다. 자동은 첫 화면에서 잰 추천 단계로 시작)
const sound = createGameSound(); // 소리 · 음악(src/audio — 첫 누르기에 켜진다)
let world = null;
let hero = null;
let inGame = false;
let lobbyState = null;
let lastStart = null; // 이 경기의 start 메시지(설정 창 "이기는 방법 보기")
// 화질 추천(첫 화면에서 기기를 잰다) · 설정 창(⚙ — 화질 · 소리 · 화면 · 경기)
const isTitle = () => !inGame && !!document.querySelector(".title-screen");
let settings = null;
const advisor = createQualityAdvisor({ R: scene.R, isTitle, inGame: () => inGame, openSettings: () => settings?.open() });
settings = createSettings({
  R: scene.R, advisor, isTitle, inGame: () => inGame,
  onHelp: () => hud?.toggleHelp(),
  rules: () => lastStart && { mode: lastStart.mode, teams: lastStart.teams, minutes: lastStart.minutes, ...(lastStart.goal ? { goal: lastStart.goal } : {}), ...(lastStart.lives ? { lives: lastStart.lives } : {}) },
  onLeave: () => leaveChannel(),
});

const net = createNet({
  onMessage,
  onSnapshot(s) { if (world) world.push(s); },
  onStatus(st) { document.body.classList.toggle("offline", st !== "open"); },
});

const lobby = createLobby(screens, {
  onCreate(name) { setName(name); net.send({ t: "create" }); },
  onJoin(name, code) { setName(name); net.send({ t: "join", code }); },
  onTeam(t) { net.send({ t: "team", team: t }); },
  onSettings(s) { net.send({ t: "settings", ...s }); },
  onBot(m) { net.send({ ...m, t: "bot" }); }, // 방장: 컴퓨터 넣기 · 빼기({ op: "add", team } · { op: "remove", i })
  onStart() { net.send({ t: "start" }); },
  onLeave() { leaveChannel(); },
});

// 터치 조작부: 굵은 포인터 기기이거나 손가락으로 한 번이라도 누르면 경기 중에 보인다
let touchOn = !!globalThis.matchMedia?.("(pointer: coarse)")?.matches;
let control = null;
let hud = null;
const touch = createTouch({
  onButton(k) {
    if (!control) return;
    if (k === "weapon") control.cycleWeapon(1);
    else if (k === "dash") control.dash();
    else if (k === "follow") control.toggleFollowAll();
  },
  onCommandMode(on) {
    if (on) hud?.toast("지휘: 누르면 고르기 · 명령");
    else control?.cameraHome(); // 지휘를 끄면 화면이 영웅에게
  },
});
const markTouch = () => document.documentElement.classList.toggle("touchy", touchOn);
window.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch" && !touchOn) { touchOn = true; markTouch(); if (inGame) touch.show(true); }
}, { capture: true });
markTouch();

hud = createHud(hudRoot, {
  send: (m) => net.send(m),
  setWeapon: (w) => control.setWeapon(w),
  selectWorkers: () => control.selectWorkers(),
  toggleFollow: () => control.toggleFollowAll(),
  followSelected: () => control.followSelected(),
  holdSelected: () => control.holdSelected(),
  stopSelected: () => control.stopSelected(),
  startPlacing: () => control.startPlacing(),
  clearSelection: () => control.clearSelection(),
  gather: (res) => control.gatherSelected(res),
  onMinimap: (x, y, button, phase) => control.minimap(x, y, button, phase),
  onAnswer: (i) => net.send({ t: "answer", choice: i }),
  onAgain: () => net.send({ t: "again" }),
  onLook: (x, y) => control.lookAlert(x, y),
  gatherAt: (res, i) => control.gatherAt(res, i),
  attackMode: () => control.startAttackTarget(),
  onAlarm: (x, y) => scene.alarm(x, y),
  cameraHome: () => control.cameraHome(),
  openSettings: () => settings.open(), // ⚙ 설정 창(ui/settings.js)
  prefs: settings.prefs, // 이름표 · 피해 숫자 보이기(설정)
});
control = createControl({ scene, hud, net, canvas, touch });
sound.bind({ scene, control, hud, world: () => world, hero: () => hero });
// 내 일꾼이 한 번 캐기를 마치면 "+8" 처럼 떠오른다(화면이 알려 준다) · 동전 · 종 · 꿀꺽 소리
scene.onPop = (x, y, h, text, color) => { hud.float(x, y, h, text, color, 1.15); sound.pop(color, x, y); };

function setName(n) {
  myName = n || "학생";
  store.set("ibr-name", myName);
  net.setHello({ t: "hello", name: myName, key });
}

function onMessage(m) {
  sound.onMessage(m); // 소리(src/audio/game.js — 화면 · HUD 보다 먼저, 바뀌기 전 상태와 견준다)
  switch (m.t) {
    case "hello": lobby.setHello(m); break;
    case "lobby":
      lobbyState = m;
      net.setRejoin(m.code);
      history.replaceState(null, "", `?c=${m.code}`);
      if (inGame) endGame();
      lobby.room(m);
      break;
    case "error":
      lobby.toast(m.text);
      if (!inGame) lobby.refresh(); // 받지 않은 설정(팀 수 등)을 원래 값으로
      break;
    case "start": startGame(m); break;
    default:
      if (world) onGameMessage(m);
  }
}

/** 경기 중 메시지(shared/protocol.js 머리 주석) */
function onGameMessage(m) {
  switch (m.t) {
    case "brief": setBrief(m); return; // 시작 전: 카드를 닫은 사람 수(U32)
    case "count": world.playTick = m.playTick; startCount(m.playTick, () => world); return; // 모든 팀이 함께 5초
    case "me":
      world.me = m;
      world.meAt = performance.now();
      hero?.onMe(m);
      if (m.teamOut && !world.spectator) { world.eliminate({ team: world.team, reason: "" }); spectate(); } // elim 을 놓쳤어도(다시 들어옴)
      break;
    case "elim": // 한 팀 탈락(U27)
      world.eliminate(m);
      hud.onElim(m, world);
      if (m.team === world.team) spectate();
      break;
    case "team": world.info = m; break;
    case "fx": {
      const view = control.view;
      const hid = world.me?.heroId;
      for (const e of m.e || []) if (e.k === "refill" && e.id === hid) world.heroRefillAt = performance.now();
      scene.onFx(m.e || [], view, world.me?.heroId, world.heroPos);
      hud.onFx(m.e || [], world, view);
      break;
    }
    case "kb": hero?.onKb(m); break;
    case "warp": hero?.onWarp(m); break;
    case "note":
      hud.note(m.text, m.kind, m.at);
      if (m.at) {
        if (m.kind === "alarm") hud.alarm(m.at.x, m.at.y); // 경보: 흰 "!" (팀 레드와 다른 모양)
        else hud.pings.push({ x: m.at.x, y: m.at.y, t: performance.now(), color: "#39ff88" });
      }
      break;
    case "score": hud.score(m, world); break;
    case "quiz": hud.quizOpen(m); break;
    case "quizResult": hud.quizResult(m); break;
    case "quizClose": hud.quizClose(); break;
    case "end": hud.showResult(m, world); break;
  }
}

/** 우리 팀이 탈락했다: 온 지도가 보이는 구경하기(안개를 걷는다 · 고른 것을 푼다) */
function spectate() {
  scene.R.setVision(null);
  control.clearSelection();
  hud.closePanel();
  touch.setCommand(false);
}

/** 채널에서 나간다(대기실 "나가기" · 설정 창 "채널 나가기") — 경기 중이면 경기를 닫고 첫 화면으로 */
function leaveChannel() {
  net.send({ t: "leave" });
  net.setRejoin(null);
  lobbyState = null;
  history.replaceState(null, "", location.pathname);
  if (inGame) { closeRules(); endGame(); }
  lobby.title(myName);
}

function startGame(m) {
  lastStart = m;
  if (inGame) control.clear();
  world = createWorld(m);
  if (Number.isInteger(m.phase)) world.phase = m.phase;
  hero = world.spectator ? null : createHero(world, net);
  scene.setWorld(world);
  control.setWorld(world, hero);
  lobby.hide();
  hud.show(world);
  world.playTick = Number.isFinite(m.playTick) ? m.playTick : null;
  // 이기는 방법(U28 · U32) — 닫으면 서버에 ready. 모두 닫으면 서버가 count 로 모든 팀이 함께 셀 틱을 알린다
  showRules(m, () => world, { onReady: () => net.send({ t: "ready" }) });
  inGame = true;
  touch.show(touchOn);
  touch.setCommand(false);
  document.body.classList.add("in-game");
}

function endGame() {
  inGame = false;
  hud.hide();
  touch.show(false);
  control.clear();
  scene.dispose();
  world = null;
  hero = null;
  document.body.classList.remove("in-game");
  showBackdrop();
}

// 첫 화면 뒤에 천천히 흘러가는 지도(잉크 숲 · 네 팀)
let backdrop = null;
let driftX = 0;
function showBackdrop() {
  backdrop = generateMap(20261124, 4, "forest");
  scene.setBackdrop(backdrop);
  driftX = 14;
}

let last = performance.now();
let visAcc = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (inGame && world) {
    visAcc += dt;
    if (visAcc > 0.2) { visAcc = 0; world.computeVision(); }
    control.update(dt);
    scene.render({ view: control.view, hero: control.heroFrame(), ui: control.ui, me: world.me });
  } else {
    if (backdrop) {
      driftX += dt * 0.9;
      if (driftX > backdrop.size - 14) driftX = 14;
      scene.lookAt(driftX, backdrop.size / 2 + Math.sin(now / 9000) * 6);
    }
    scene.render(null);
  }
  sound.frame(dt); // 듣는 자리 · 충전음 · 채우기 · 세기 · 음악 강도
}

showBackdrop();
net.setHello({ t: "hello", name: myName || "학생", key });
lobby.title(myName);
const code = new URLSearchParams(location.search).get("c");
if (code && myName) net.send({ t: "join", code: code.toUpperCase() });
loop();

// 개발용 손잡이(콘솔 · 자동 시험) — 개발 서버이거나 주소에 ?debug 가 있을 때만
if (import.meta.env.DEV || new URLSearchParams(location.search).has("debug")) {
  if (new URLSearchParams(location.search).has("debug")) createPerfHud(scene.R); // FPS · 장면 해상도 배율
  window.__realms = { net, scene, control, hud, advisor, settings, get world() { return world; }, get hero() { return hero; }, message: (m) => onMessage(m) };
}
