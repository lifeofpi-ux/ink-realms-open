// "이기는 방법" 카드(U28 · U32) — 경기 전, 모드(아케이드 · 퀴즈)와 팀 수에 맞는 승리 규칙을 보여 준다. 모두 닫으면 모든 팀이 함께 5초를 센다.
// 경기가 시작되면(또는 "알겠어요") 닫힌다. 다시 보고 싶으면 도움말(?)에 같은 내용이 있다.
import "./rules.css";
import { COUNTDOWN, GOAL, GEM, HERO, TICK } from "../../shared/constants.js";
import { PHASE } from "../../shared/protocol.js";


const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** 승리 규칙 줄들 — 화면 카드와 도움말이 함께 쓴다 */
export function winRules({ mode = "arcade", teams = 2, minutes = 15, goal = GOAL, lives = HERO.LIVES } = {}) {
  const quiz = mode === "quiz";
  // 짧게(초등 3~6학년이 한눈에): 이기는 길 셋 + 도움말 둘셋
  return {
    win: [
      { icon: "💎", head: `보석 ${goal}점 먼저 모으기`, text: `가운데 보석은 ${GEM.VALUE.center}점` },
      { icon: "⏱", head: `${minutes}분 끝나면 보석 많은 팀`, text: "" },
      { icon: "🏰", head: teams === 2 ? "상대 탑 부수면 승리" : "끝까지 살아남기", text: teams === 2 ? "" : "탑이 부서진 팀은 탈락" },
    ],
    keep: [
      { icon: "🛡", text: "우리 탑이 부서지면 탈락" },
      { icon: "♥", text: `영웅 목숨 ${lives}개 · 다 쓰면 지휘관` },
      quiz
        ? { icon: "❓", text: "방어막 깨면 퀴즈 · 맞히면 보석" }
        : { icon: "🪨", text: "방어막 → 바위 부수면 보석" },
    ],
  };
}

let open = null; // 열린 카드 { el, onKey, help, onReady }
let wait = null; // 다른 친구들을 기다리는 띠
let count = null; // 모든 팀이 함께 세는 5 · 4 · 3 · 2 · 1 { el, timer }

/**
 * 시작 전 "이기는 방법" 카드(U28 · U32). 학생이 닫을 때까지 떠 있고, 닫으면 onReady()(서버에 ready)를 부른다.
 * 모두 닫거나(또는 BRIEF_MAX 가 지나면) 서버가 count { playTick } 을 보내고 → startCount() 가 모두 같은 틱으로 센다.
 * @param {object} start  서버의 start 메시지({ mode, teams, minutes, goal, lives, phase, brief, playTick })
 * @param {() => object|null} getWorld
 * @param {{ onReady?: () => void }} [hooks]
 */
export function showRules(start, getWorld, hooks = {}) {
  closeRules(true);
  hideWait();
  stopCount();
  if (Number.isInteger(start.phase) && start.phase === PHASE.PLAY) return; // 경기 중에 다시 들어왔다 — 바로 놀이로
  if (start.phase === PHASE.COUNTDOWN && Number.isFinite(start.playTick)) { startCount(start.playTick, getWorld); return; } // 세는 중에 다시 들어왔다
  const r = winRules({ mode: start.mode, teams: start.teams, minutes: start.minutes, goal: start.goal || GOAL, lives: start.lives || HERO.LIVES });
  const el = document.createElement("div");
  el.className = "rules-card";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "이기는 방법");
  el.innerHTML = `<div class="rc-box">
      <div class="rc-head"><h2>이기는 방법</h2><span class="rc-mode ${start.mode === "quiz" ? "quiz" : "arcade"}">${start.mode === "quiz" ? "퀴즈 모드" : "아케이드"}</span><span class="rc-teams">${start.teams}팀 · ${start.minutes}분</span></div>
      <ol class="rc-win">${r.win.map((w) => `<li><i>${w.icon}</i><div><b>${esc(w.head)}</b>${w.text ? `<p>${esc(w.text)}</p>` : ""}</div></li>`).join("")}</ol>
      <ul class="rc-keep">${r.keep.map((k) => `<li><i>${k.icon}</i><span>${esc(k.text)}</span></li>`).join("")}</ul>
      <div class="rc-foot"><span class="rc-count">모두 누르면 <b>${COUNTDOWN}</b>초 뒤 시작</span><button type="button" class="rc-ok">알겠어요</button></div>
    </div>`;
  document.body.appendChild(el);
  // 처음 하는 사람의 조작 도움말(?)이 함께 열렸으면 잠깐 숨겼다가 이 카드를 닫은 뒤 보여 준다(겹치지 않게)
  const help = document.querySelector(".hud .help:not([hidden])");
  if (help) help.hidden = true;
  const ready = () => closeRules();
  el.querySelector(".rc-ok").onclick = ready;
  const onKey = (e) => { if (e.key === "Escape" || e.key === "Enter") ready(); };
  window.addEventListener("keydown", onKey);
  open = { el, onKey, help, onReady: hooks.onReady, brief: start.brief || null };
  el.querySelector(".rc-ok").focus?.();
}

/** 카드를 닫는다. silent 가 아니면 "준비"를 알리고(서버 ready) 기다리는 띠를 띄운다 */
export function closeRules(silent = false) {
  if (!open) return;
  const o = open;
  open = null;
  window.removeEventListener("keydown", o.onKey);
  o.el.classList.add("out");
  setTimeout(() => o.el.remove(), 260);
  if (silent) return;
  try { o.onReady && o.onReady(); } catch {}
  if (!count) showWait(o.brief);
  // 조작 도움말(처음 하는 사람)은 세기가 끝난 뒤에 보여 준다
  if (o.help) pendingHelp = o.help;
}
let pendingHelp = null;

function showWait(brief) {
  hideWait();
  const el = document.createElement("div");
  el.className = "rules-wait";
  el.setAttribute("role", "status");
  el.innerHTML = `<b>준비 완료!</b><span class="rw-n">${brief ? `다른 친구들을 기다려요 (${brief.ready}/${brief.total})` : "다른 친구들을 기다려요"}</span>`;
  document.body.appendChild(el);
  wait = { el };
}
function hideWait() { if (wait) { wait.el.remove(); wait = null; } }

/** 서버의 brief { ready, total } — 기다리는 띠의 숫자를 고친다 */
export function setBrief(b) {
  if (open) open.brief = b;
  if (wait) wait.el.querySelector(".rw-n").textContent = `친구 기다리는 중 (${b.ready}/${b.total})`;
}

/** 서버의 count { playTick } — 모든 팀이 같은 틱으로 5 · 4 · 3 · 2 · 1(시작! 은 hud 가 띄운다) */
export function startCount(playTick, getWorld) {
  closeRules(true); // 시간이 다 돼 시작한다 — 아직 읽던 카드는 닫는다
  hideWait();
  stopCount();
  const el = document.createElement("div");
  el.className = "rules-count";
  el.setAttribute("aria-live", "assertive");
  el.innerHTML = `<b>${COUNTDOWN}</b><small>모두 함께 시작!</small>`;
  document.body.appendChild(el);
  const num = el.querySelector("b");
  const t0 = performance.now();
  let last = -1;
  const timer = setInterval(() => {
    const w = getWorld && getWorld();
    const tick = w && w.latest && Number.isFinite(w.latest.tick) ? w.latest.tick : null;
    // 남은 초 = (시작 틱 − 지금 틱) × 틱 — 서버 시계로 센다(모든 화면이 같은 순간에 0)
    const leftT = tick != null ? (playTick - tick) * TICK : COUNTDOWN - (performance.now() - t0) / 1000;
    const started = (w && w.phase === PHASE.PLAY) || leftT <= 0;
    // 시작하면 바로 내린다 — "시작!"은 경기 화면(hud)이 한 번만 띄운다(둘이 겹치지 않게)
    if (started) { stopCount(); return; }
    const left = Math.max(1, Math.ceil(leftT));
    if (left !== last) { last = left; num.textContent = String(left); el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
  }, 100);
  count = { el, timer };
}
function stopCount() {
  if (!count) return;
  clearInterval(count.timer);
  count.el.remove();
  count = null;
  if (pendingHelp) { pendingHelp.hidden = false; pendingHelp = null; }
}

// ── 첫 화면의 "게임 설명"(U29) — 심플한 게임 규칙: 이기는 방법 · 한 판의 흐름 · 지키기 · 조작 ──
/**
 * 게임 설명 창을 띄운다(닫기: ✕ · Esc · 바깥 누르기). 이기는 방법은 winRules 와 같은 말을 쓴다.
 */
export function showGuide() {
  closeGuide();
  const el = document.createElement("div");
  el.className = "rules-card guide";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "게임 설명");
  el.innerHTML = `<div class="rc-box">
      <div class="rc-head"><h2>게임 설명</h2><span class="rc-teams">2~8팀 · 팀당 1~4명</span><button type="button" class="rc-x" aria-label="닫기">✕</button></div>
      <p class="gd-lead">잉크 풍선으로 싸우고, <b>일꾼</b>으로 자원을 캐요.</p>
      <h3 class="gd-h">이기는 방법</h3>
      <ol class="rc-win">
        <li><i>💎</i><div><b>보석 ${GOAL}점 먼저 모으기</b><p>보석을 이고 우리 탑으로</p></div></li>
        <li><i>⚔</i><div><b>적 영웅 모두 쓰러뜨리기</b><p>영웅 목숨은 ${HERO.LIVES}개</p></div></li>
        <li><i>🏰</i><div><b>적 탑 모두 부수기</b><p>탑이 부서진 팀은 탈락</p></div></li>
      </ol>
      <h3 class="gd-h">이렇게 해요</h3>
      <ul class="rc-keep">
        <li><i>🛡</i><span>우리 탑을 지켜요 · 일꾼이 고쳐요</span></li>
        <li><i>⛏</i><span>금광 <b>골드</b> · 숲속 금광 <b>코어</b> · 연못 <b>잉크</b></span></li>
        <li><i>👛</i><span>자원은 각자 지갑 · 팀원에게 보내요</span></li>
        <li><i>🛢</i><span>잉크가 없으면 공급소 곁에서 충전</span></li>
        <li><i>🧪</i><span>랩에서 무기 · 퍼실리티에서 몬스터</span></li>
        <li><i>❓</i><span>퀴즈 모드: 맞히면 보석</span></li>
      </ul>
      <h3 class="gd-h">조작</h3>
      <ul class="rc-keep gd-keys">
        <li><i>⌨</i><span><b>WASD · 방향키</b> 이동 · <b>클릭</b> 던지기</span></li>
        <li><i>🖱</i><span><b>오른쪽 클릭</b> 그곳으로 걷기 · 마우스만으로도 돼요</span></li>
        <li><i>👆</i><span><b>끌기</b> 유닛 고르기 → <b>오른쪽 클릭</b> 명령</span></li>
        <li><i>📱</i><span>왼쪽 판 이동 · 누르기 던지기 · <b>지휘</b>로 명령</span></li>
      </ul>
      <div class="rc-foot"><span class="rc-count">보석을 모으거나 끝까지 살아남아요!</span><button type="button" class="rc-ok">알겠어요</button></div>
    </div>`;
  document.body.appendChild(el);
  const close = () => closeGuide();
  el.querySelector(".rc-ok").onclick = close;
  el.querySelector(".rc-x").onclick = close;
  el.addEventListener("click", (e) => { if (e.target === el) close(); });
  const onKey = (e) => { if (e.key === "Escape") close(); };
  window.addEventListener("keydown", onKey);
  guide = { el, onKey };
  el.querySelector(".rc-ok").focus();
}
let guide = null;
export function closeGuide() {
  if (!guide) return;
  window.removeEventListener("keydown", guide.onKey);
  guide.el.remove();
  guide = null;
}
