// 경기 화면 HUD(docs/DESIGN.md §12 — 브로울스 블랙라이트 포스터 말투): 위 띠(팀 보석 점수 · 남은 시간 · 골드 · 코어 · 잉크) ·
// 오른쪽 위 미니맵 · 왼쪽 아래 내 영웅(체력 · 잉크 탱크 200 · 무기 막대 · 상태 딱지) · 아래 가운데 건물 판 / 고른 유닛 띠 ·
// 오른쪽 아래 빠른 명령(일꾼 · 따라와) · 가운데 안내 띠(잉크 부족 · 보석 · 쓰러짐) · 공급소 화살표 · 이름표 · 떠오르는 글자 · 알림 · 퀴즈 창 · 결과 · 도움말.
import {
  HERO, TEAM_COLORS, TEAM_NAMES, WEAPONS, BLD, BUILDINGS, UTYPE, TILE, NEUTRAL, SITE_STATE, INK, ITEMS, MONSTERS, UNITS, QUIZ, shotInk,
  MINE, CORE_MINE, POND, GIVE, GOAL, GEM,
} from "../../shared/constants.js";
import { PHASE, UF, BF, ANIM } from "../../shared/protocol.js";
import { createPanels } from "./panels.js";
import { createInfoCard, besideNode } from "./infocard.js";

const css = (hex) => "#" + (hex >>> 0).toString(16).padStart(6, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const mmss = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
/** 무기 딱지 색(브로울스 kind-chip 말투) */
export const WCOLOR = ["#f3efff", "#ffe600", "#00ffa3", "#4d8dff", "#ff3b4e", "#ff8a1f", "#ff2d95", "#a24bff", "#00f0ff", "#ff57c8"];
/** 무기 짧은 이름(소지품 칸 · 터치 단추) */
export const WSHORT = ["기본", "삼발", "끈끈이", "미사일", "대왕", "유도", "폭죽", "소용돌이", "드릴", "메가 폭탄"];
const WHY = {
  empty: "다 썼어요 · 기본 잉크로 바꿨어요",
  ink: "🛢 잉크 부족 · 공급소로!",
  carry: "💎 보석 들면 못 던져요",
  bombcd: "메가 폭탄 다시 쓰기 대기",
};

export function createHud(root, h) {
  root.innerHTML = "";
  root.className = "hud";
  root.hidden = true;

  // ── 위 띠 ──
  const top = el("div", "topband");
  top.innerHTML = `<div class="scores"></div>
    <div class="clockbox"><b class="clock">15:00</b><span class="mode"></span></div>
    <div class="res"><button class="r gold" data-res="gold" title="내 골드 · 누르면 팀원에게 보내기"><i></i><b>0</b><small>골드</small><em class="tsum"></em></button>
      <button class="r core" data-res="core" title="내 코어 · 누르면 팀원에게 보내기"><i></i><b>0</b><small>코어</small><em class="tsum"></em></button>
      <button class="r ink" data-res="ink" title="내 잉크 · 누르면 팀원에게 보내기"><i></i><b>0</b><small>잉크</small><em class="tsum"></em></button></div>
    <button class="help-btn" title="조작 도움말 (H)">?</button>${h.openSettings ? `<button class="help-btn set-btn" title="설정 — 화질 · 소리 · 화면">⚙</button>` : ""}`;
  root.appendChild(top);
  const scoresEl = top.querySelector(".scores");
  const clockEl = top.querySelector(".clock");
  const modeEl = top.querySelector(".mode");
  const resEl = { gold: top.querySelector(".gold b"), core: top.querySelector(".core b"), ink: top.querySelector(".ink b") };
  const sumEl = { gold: top.querySelector(".gold .tsum"), core: top.querySelector(".core .tsum"), ink: top.querySelector(".ink .tsum") };
  // ── 팀원에게 보내기(U31): 위 띠의 자원을 누르면 작은 판 ──
  const give = el("div", "givepop");
  give.hidden = true;
  root.appendChild(give);
  let giveRes = "", giveTo = -1, giveWorld = null;
  const RES_KO = { gold: "골드", core: "코어", ink: "잉크" };
  function openGive(res) {
    const w = giveWorld;
    if (!w || w.spectator || !w.wallet().own) return;
    const mates = w.teammates();
    if (!mates.length) { toast("같은 팀에 보낼 사람이 없어요"); return; }
    if (giveRes === res && !give.hidden) { give.hidden = true; return; }
    giveRes = res;
    if (!mates.some((q) => q.slot === giveTo)) giveTo = mates.find((q) => !q.bot)?.slot ?? mates[0].slot;
    drawGive();
    give.hidden = false;
    const r = top.querySelector(`.r.${res}`).getBoundingClientRect();
    give.style.left = `${Math.max(8, Math.min(innerWidth - 268, r.left))}px`;
    give.style.top = `${r.bottom + 6}px`;
  }
  function drawGive() {
    const w = giveWorld;
    const have = Math.floor(w.wallet()[giveRes] || 0);
    const hex = css(TEAM_COLORS[w.team] ?? 0xffffff);
    give.innerHTML = `<div class="gp-head"><b>팀원에게 보내기</b><span class="gp-res ${giveRes}">내 ${RES_KO[giveRes]} ${have}</span><button class="gp-x" data-g="x">✕</button></div>
      <div class="gp-to">${w.teammates().map((q) => `<button data-to="${q.slot}" class="${q.slot === giveTo ? "on" : ""}" style="--tc:${hex}"><i></i>${esc(q.name)}${q.bot ? " 🤖" : ""}</button>`).join("")}</div>
      <div class="gp-amt">${GIVE.STEPS.map((n) => `<button data-amt="${n}" ${have < n ? "disabled" : ""}>+${n}</button>`).join("")}<button data-amt="all" ${have < 1 ? "disabled" : ""}>전부 ${have}</button></div>`;
  }
  give.addEventListener("pointerdown", (e) => e.stopPropagation());
  give.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.g === "x") { give.hidden = true; return; }
    if (b.dataset.to != null) { giveTo = +b.dataset.to; drawGive(); return; }
    if (b.dataset.amt != null) {
      const have = Math.floor(giveWorld.wallet()[giveRes] || 0);
      const amount = b.dataset.amt === "all" ? have : Math.min(have, +b.dataset.amt);
      if (amount < 1 || giveTo < 0) return;
      h.send({ t: "give", to: giveTo, res: giveRes, amount }); // 결과 알림("○○에게 골드 50을 보냈어요")은 서버가 보낸다
      give.hidden = true;
    }
  });
  top.querySelector(".res").addEventListener("click", (e) => {
    const b = e.target.closest("[data-res]");
    if (b) openGive(b.dataset.res);
  });
  top.querySelector(".help-btn").onclick = () => toggleHelp();
  if (h.openSettings) top.querySelector(".set-btn").onclick = () => h.openSettings(); // 설정 창(ui/settings.js)

  // ── 미니맵 ──
  const mmWrap = el("div", "mm");
  const mm = el("canvas", "minimap");
  mm.width = 220; mm.height = 220;
  mmWrap.appendChild(mm);
  root.appendChild(mmWrap);
  const mmBase = document.createElement("canvas");
  let mmData = null;

  // ── 왼쪽 아래: 내 영웅 ──
  const me = el("div", "mebox");
  me.innerHTML = `<div class="m-name"><span class="dot"></span><b></b><span class="m-lives" title="남은 목숨"></span><em class="m-w"></em></div>
    <div class="m-hp"><i></i><span></span></div>
    <div class="m-tank"><i class="fill"></i><i class="cost"></i><span class="lbl">잉크</span><em class="plus">+${INK.REFILL_RATE}/초</em><b class="num"></b><strong class="full">가득!</strong></div>
    <div class="weapons"></div>
    <div class="chips"></div>`;
  root.appendChild(me);
  const livesEl = me.querySelector(".m-lives");
  let livesShown = -1;
  const meName = me.querySelector(".m-name b"), meDot = me.querySelector(".m-name .dot"), meW = me.querySelector(".m-w");
  const hpFill = me.querySelector(".m-hp i"), hpTxt = me.querySelector(".m-hp span");
  const tankEl = me.querySelector(".m-tank"), tankFill = tankEl.querySelector(".fill"), tankCost = tankEl.querySelector(".cost"), tankNum = tankEl.querySelector(".num");
  const weaponsEl = me.querySelector(".weapons");
  const chipsEl = me.querySelector(".chips");
  weaponsEl.addEventListener("pointerdown", (e) => {
    const b = e.target.closest("[data-w]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation(); // 소지품 칸 누르기는 던지기 · 묶어 고르기가 아니다
    h.setWeapon(+b.dataset.w);
  });

  // ── 오른쪽 아래: 빠른 명령(건물 단추는 두지 않는다 — 건물은 그 건물을 눌러 연다, U16) ──
  const dock = el("div", "dock");
  dock.innerHTML = `<button data-q="workers"><i>⛏</i><span>일꾼 <kbd>Tab</kbd></span></button><button data-q="follow"><i>⟲</i><span>따라와 <kbd>F</kbd></span></button>`;
  root.appendChild(dock);
  dock.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.q === "workers") h.selectWorkers();
    else if (b.dataset.q === "follow") h.toggleFollow();
  });

  // ── 아래 가운데: 고른 유닛 띠 · 건물 판 ──
  const selbar = el("div", "selbar");
  selbar.hidden = true;
  root.appendChild(selbar);
  selbar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-s]");
    if (!b) return;
    const k = b.dataset.s;
    if (k === "follow") h.followSelected();
    else if (k === "hold") h.holdSelected();
    else if (k === "stop") h.stopSelected();
    else if (k === "place") h.startPlacing();
    else if (k === "clear") h.clearSelection();
    else if (k.startsWith("g-")) h.gather(k.slice(2));
    else if (k === "attack") h.attackMode?.();
  });
  const tgtHint = el("div", "tgthint", `<i>✕</i>공격할 적을 누르세요 <small>Esc 취소</small>`);
  tgtHint.hidden = true;
  root.appendChild(tgtHint);
  const panels = createPanels(root, {
    send: h.send, note: (t, k) => note(t, k), startPlacing: () => { panels.close(); h.startPlacing(true); }, setWeapon: h.setWeapon, gather: (r) => h.gather(r),
  });

  // 지도 물건 설명 카드(금광 · 코어 금광 · 연못 · 보석 섹션 · 적 건물)
  const card = createInfoCard(root, { gatherAt: (res, i) => h.gatherAt?.(res, i) });

  // ── 가운데 안내 · 화살표 · 이름표 · 글자 ──
  const banner = el("div", "banner");
  banner.hidden = true;
  root.appendChild(banner);
  const big = el("div", "bigsay");
  big.hidden = true;
  root.appendChild(big);
  const arrowEl = el("div", "sarrow", `<i></i><span></span>`);
  arrowEl.hidden = true;
  root.appendChild(arrowEl);
  const tagLayer = el("div", "tags");
  root.appendChild(tagLayer);
  const tagPool = [];
  const floats = el("div", "floats");
  root.appendChild(floats);
  const floatList = [];
  const notes = el("div", "notes");
  root.appendChild(notes);
  const specTag = el("div", "spectag", `<b>구경 중</b><small>WASD · 미니맵으로 둘러봐요</small>`);
  root.appendChild(specTag);
  const homeBtn = el("button", "camhome", `<i>⌖</i>내 영웅으로<kbd>C</kbd>`);
  homeBtn.hidden = true;
  homeBtn.title = "화면을 내 영웅에게";
  homeBtn.onclick = () => h.cameraHome?.();
  root.appendChild(homeBtn);
  const toastEl = el("div", "toast2");
  toastEl.hidden = true;
  root.appendChild(toastEl);
  let toastT = null;

  // ── 퀴즈 · 결과 · 도움말 ──
  const quiz = el("div", "quiz-modal"); // 이름을 quiz 로 두면 다른 .quiz(대기실 모드 표 · 알림 종류)가 이 창의 전체 화면 규칙을 받는다
  quiz.hidden = true;
  root.appendChild(quiz);
  let quizTimer = null;
  let quizLive = false;
  let quizLockUntil = 0; // 문제가 뜬 뒤 QUIZ.LOCK 초 동안은 답을 받지 않는다(서버가 버린다 — 너무 빠른 누르기)
  let quizLockT = null;
  const result = el("div", "result");
  result.hidden = true;
  root.appendChild(result);
  const help = el("div", "help");
  help.hidden = true;
  const K = (k) => k.split(" ").map((x) => `<kbd>${x}</kbd>`).join("");
  help.innerHTML = `<div class="help-box"><h2>어떻게 해요?</h2>
    <div class="hcols"><div><h3>내 영웅</h3><ul class="hk">
      <li><span class="k">${K("W A S D")} <b>방향키</b></span><span class="d">이동 · 두 번 = 대시</span></li>
      <li><span class="k"><b>오른쪽 클릭</b></span><span class="d">그곳으로 걷기(마우스만으로도)</span></li>
      <li><span class="k"><b>클릭</b></span><span class="d">던지기 · 꾹 = 큰 풍선</span></li>
      <li><span class="k">${K("Q E")} ${K("2")}~${K("9")}</span><span class="d">무기 바꾸기</span></li>
      <li><span class="k">${K("R")}</span><span class="d">공급소 길 · 곁에서 잉크 충전</span></li></ul></div>
    <div><h3>유닛</h3><ul class="hk">
      <li><span class="k"><b>끌기</b> · ${K("Tab")}</span><span class="d">고르기 · 일꾼 모두</span></li>
      <li><span class="k"><b>고른 뒤 오른쪽</b></span><span class="d">이동 · 공격 · 캐기</span></li>
      <li><span class="k">${K("X")}</span><span class="d">공격할 적 고르기</span></li>
      <li><span class="k">${K("F")}</span><span class="d">봇 · 몬스터 따라와</span></li>
      <li><span class="k">${K("B")}</span><span class="d">공급소 짓기</span></li>
      <li><span class="k"><b>"일 시켜주세요!"</b></span><span class="d">일꾼에게 일 주기</span></li></ul></div></div>
    <p class="goal">💎 보석 ${GOAL}점 먼저 모으면 승리 · ♥ 목숨 ${HERO.LIVES}개 · 🏰 탑이 부서지면 탈락</p>
    <p class="goal">👛 자원은 각자 지갑 · 위 띠를 누르면 팀원에게 보내요</p>
    <p class="keys">${K("Space")}+<b>휠</b> 확대 · ${K("Space")}+<b>끌기</b> 화면 옮기기 · ${K("C")} 내 영웅 · ${K("1")} 본진 · ${K("H")} 도움말<br>
      📱 왼쪽 판 이동 · 누르기 던지기 · <b>지휘</b>로 명령</p>
    <button class="primary">알겠어요</button></div>`;
  help.querySelector("button").onclick = () => { help.hidden = true; };
  // 화질 · 소리 · 화면은 설정 창(⚙ — ui/settings.js)에서. 도움말에는 그리로 가는 한 줄
  if (h.openSettings) {
    const link = el("button", "help-set", "⚙ 설정 (화질 · 소리)");
    link.type = "button";
    link.onclick = () => { help.hidden = true; h.openSettings(); };
    help.querySelector(".help-box").insertBefore(link, help.querySelector(".help-box > .primary"));
  }
  root.appendChild(help);
  function toggleHelp() { help.hidden = !help.hidden; }

  // ── 미니맵 ──
  let mmState = { S: 64, world: null };
  function mmToMap(e) {
    const r = mm.getBoundingClientRect();
    const S = mmState.S;
    return { x: ((e.clientX - r.left) / r.width) * S, y: ((e.clientY - r.top) / r.height) * S };
  }
  mm.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const p = mmToMap(e);
    const button = e.button ?? 0;
    h.onMinimap(p.x, p.y, button, "down");
    if (button !== 0) return;
    mm.setPointerCapture?.(e.pointerId);
    const move = (ev) => { const q = mmToMap(ev); h.onMinimap(q.x, q.y, 0, "move"); };
    const up = () => { h.onMinimap(0, 0, 0, "up"); mm.removeEventListener("pointermove", move); mm.removeEventListener("pointerup", up); mm.removeEventListener("pointercancel", up); };
    mm.addEventListener("pointermove", move);
    mm.addEventListener("pointerup", up);
    mm.addEventListener("pointercancel", up);
  });
  mm.addEventListener("contextmenu", (e) => e.preventDefault());

  const TILE_RGB = {
    [TILE.FLOOR]: [46, 42, 72], [TILE.TREE]: [34, 104, 62], [TILE.WATER]: [60, 40, 150], [TILE.BLOCK]: [96, 96, 128],
    [TILE.CRATE]: [150, 98, 64], [TILE.POND]: [255, 45, 240], [TILE.GOLD]: [255, 210, 63], [TILE.CORE]: [170, 90, 255],
  };
  function buildMinimap(world) {
    const S = world.S;
    mmState = { S, world };
    mmBase.width = S; mmBase.height = S;
    mmData = mmBase.getContext("2d").createImageData(S, S);
  }
  function drawMinimap(ctx, corners) {
    const { world, view } = ctx;
    const S = world.S;
    if (!mmData) return;
    const d = mmData.data;
    const T = world.map.tiles;
    const homes = new Int8Array(S * S).fill(-1);
    for (const b of world.map.bases) {
      for (let y = Math.max(0, Math.round(b.cy - 7)); y <= Math.min(S - 1, Math.round(b.cy + 6)); y++)
        for (let x = Math.max(0, Math.round(b.cx - 7)); x <= Math.min(S - 1, Math.round(b.cx + 6)); x++) homes[y * S + x] = b.team;
    }
    for (let i = 0; i < S * S; i++) {
      let c = TILE_RGB[T[i]] || TILE_RGB[0];
      if (T[i] === TILE.FLOOR && homes[i] >= 0 && !world.out.has(homes[i])) {
        const tc = TEAM_COLORS[homes[i]];
        c = [46 + (((tc >> 16) & 255) - 46) * 0.25, 42 + (((tc >> 8) & 255) - 42) * 0.25, 72 + ((tc & 255) - 72) * 0.25];
      }
      const m = world.vis[i] ? 1 : world.explored[i] ? 0.55 : 0.28;
      const o = i * 4;
      d[o] = c[0] * m; d[o + 1] = c[1] * m; d[o + 2] = c[2] * m + 10 * (1 - m); d[o + 3] = 255;
    }
    mmBase.getContext("2d").putImageData(mmData, 0, 0);
    const g = mm.getContext("2d");
    const W = mm.width, k = W / S;
    g.imageSmoothingEnabled = false;
    g.drawImage(mmBase, 0, 0, W, W);
    if (!view) return;
    const t = performance.now() / 1000;
    // 섹션
    for (const x of view.sites) {
      const m = world.map.sites[x.id];
      if (!m) continue;
      const col = x.state === SITE_STATE.QUIZ && x.team >= 0 ? css(TEAM_COLORS[x.team]) : x.state === SITE_STATE.EMPTY ? "#5a5480" : m.center ? "#ffe600" : "#7df9ff";
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(m.x * k, m.y * k, 2.5 * k, 0, Math.PI * 2);
      g.stroke();
      if (x.state === SITE_STATE.SHIELD || x.state === SITE_STATE.ROCK) { g.fillStyle = col; g.fillRect(m.x * k - 2, m.y * k - 2, 4, 4); }
    }
    // 건물
    for (const b of view.buildings) {
      const s = BUILDINGS[b.kind].size;
      g.fillStyle = b.flags & (BF.BROKEN | BF.DOWN) ? "#555066" : css(TEAM_COLORS[b.team] ?? 0xffffff);
      g.fillRect(b.tx * k, b.ty * k, s * k, s * k);
      g.strokeStyle = "#05030a";
      g.lineWidth = 1;
      g.strokeRect(b.tx * k, b.ty * k, s * k, s * k);
    }
    // 유닛
    const heroId = world.me?.heroId;
    for (const u of view.units) {
      if (u.id === heroId) continue;
      const mine = u.owner === world.you;
      g.fillStyle = u.team === NEUTRAL ? "#c9a8ff" : mine ? "#ffffff" : css(TEAM_COLORS[u.team] ?? 0xffffff);
      const s = u.type === UTYPE.HERO ? 4 : u.type === UTYPE.NPC ? 3 : 2.4;
      g.fillRect(u.x * k - s / 2, u.y * k - s / 2, s, s);
      if (u.flags & UF.RAGE) {
        // 화난 보스(U21): 빨강 · 흰 고리가 퍼지며 깜빡인다
        const q = (t * 1.5) % 1;
        g.lineWidth = 2;
        g.strokeStyle = Math.floor(t * 6) % 2 ? "#ffffff" : "#ff3b4e";
        g.beginPath(); g.arc(u.x * k, u.y * k, 4 + q * 8, 0, Math.PI * 2); g.stroke();
        g.fillStyle = "#ff3b4e";
        g.fillRect(u.x * k - 2.5, u.y * k - 2.5, 5, 5);
      }
    }
    // 보석(깜빡인다)
    for (const gm of view.gems) {
      const on = Math.sin(t * 8 + gm.id) > -0.3;
      if (!on) continue;
      const u = gm.state === 1 ? view.byId.get(gm.carrier) : null;
      const x = u ? u.x : gm.state === 1 && gm.carrier === heroId && world.heroPos ? world.heroPos.x : gm.x;
      const y = u ? u.y : gm.state === 1 && gm.carrier === heroId && world.heroPos ? world.heroPos.y : gm.y;
      g.fillStyle = gm.value >= 2 ? "#ffe600" : "#7df9ff";
      g.beginPath();
      g.moveTo(x * k, y * k - 4); g.lineTo(x * k + 3.5, y * k); g.lineTo(x * k, y * k + 4); g.lineTo(x * k - 3.5, y * k);
      g.closePath();
      g.fill();
    }
    // 내 영웅
    if (world.heroPos) {
      g.fillStyle = "#ffffff";
      g.strokeStyle = css(TEAM_COLORS[world.team] ?? 0xffffff);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(world.heroPos.x * k, world.heroPos.y * k, 3.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // 탈락한 본진: 회색 판 + ✕
    for (const b of world.map.bases) {
      if (!world.out.has(b.team)) continue;
      const x = b.cx * k, y = b.cy * k, r = 6 * k;
      g.fillStyle = "rgba(20, 16, 34, 0.7)";
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.strokeStyle = "#8a83a8";
      g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(x - r * 0.6, y - r * 0.6); g.lineTo(x + r * 0.6, y + r * 0.6); g.moveTo(x + r * 0.6, y - r * 0.6); g.lineTo(x - r * 0.6, y + r * 0.6); g.stroke();
    }
    // 화면 틀
    if (corners) {
      g.strokeStyle = "rgba(255,255,255,0.85)";
      g.lineWidth = 1.2;
      g.beginPath();
      corners.forEach((c, i) => (i ? g.lineTo(c.x * k, c.y * k) : g.moveTo(c.x * k, c.y * k)));
      g.closePath();
      g.stroke();
    }
    const now = performance.now();
    for (const p of pings) {
      const q = (now - p.t) / 2500;
      if (q > 1) continue;
      if (p.alarm) {
        // 경보: 흰 고리가 검은 테와 번갈아 깜빡이고 가운데에 "!" — 팀 색(레드 등)과 다른 모양
        const on = Math.floor(now / 160) % 2 === 0;
        const r = 5 + (q * 3 % 1) * 9;
        g.lineWidth = 3;
        g.strokeStyle = "#000";
        g.beginPath(); g.arc(p.x * k, p.y * k, r, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 2;
        g.strokeStyle = on ? "#ffffff" : "#ffe600";
        g.beginPath(); g.arc(p.x * k, p.y * k, r, 0, Math.PI * 2); g.stroke();
        g.fillStyle = "#000";
        g.fillRect(p.x * k - 3.5, p.y * k - 6, 7, 12);
        g.fillStyle = on ? "#ffffff" : "#ffe600";
        g.fillRect(p.x * k - 1.2, p.y * k - 5, 2.4, 6.5);
        g.fillRect(p.x * k - 1.2, p.y * k + 2.5, 2.4, 2.4);
        continue;
      }
      g.strokeStyle = p.color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(p.x * k, p.y * k, 4 + q * 14, 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = pings.length - 1; i >= 0; i--) if (now - pings[i].t > 2500) pings.splice(i, 1);
  }
  const pings = [];
  /** 경보(우리 건물이 맞는다 · 무너졌다): 미니맵 흰 "!" 핑 + 경기장의 경보 표시(h.onAlarm — 화면이 그린다) */
  function alarm(x, y) {
    pings.push({ x, y, t: performance.now(), alarm: true });
    h.onAlarm?.(x, y);
  }

  // ── 알림 · 글자 ──
  function note(text, kind = "info", at = null) {
    // 종류는 n- 를 붙여 단다(서버의 kind "quiz" 가 퀴즈 창의 .quiz 와 겹치지 않게)
    const n = el("div", `note n-${String(kind).replace(/[^a-z0-9-]/gi, "")}`, esc(text));
    if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
      // 자리가 있는 알림: 누르면 그곳을 잠깐 본다
      n.classList.add("at");
      n.insertAdjacentHTML("beforeend", `<em class="go">보기 ▸</em>`);
      n.title = "눌러서 그곳 보기";
      n.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); h.onLook?.(at.x, at.y); });
    }
    notes.prepend(n);
    while (notes.children.length > 5) notes.lastChild.remove();
    setTimeout(() => n.classList.add("fade"), 5200);
    setTimeout(() => n.remove(), 6000);
  }
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    toastEl.classList.remove("pop");
    void toastEl.offsetWidth;
    toastEl.classList.add("pop");
    clearTimeout(toastT);
    toastT = setTimeout(() => { toastEl.hidden = true; }, 1800);
  }
  let bigT = null;
  function say(text, cls = "", sub = "", ms = 1600) {
    big.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : "");
    big.className = `bigsay ${cls}`;
    big.style.setProperty("--dur", `${ms}ms`);
    big.hidden = false;
    void big.offsetWidth;
    big.classList.add("pop");
    clearTimeout(bigT);
    bigT = setTimeout(() => { big.hidden = true; }, ms);
  }
  function float(x, y, hU, text, color, size = 1) {
    const f = el("div", "float", esc(text));
    f.style.color = color;
    if (size !== 1) f.style.fontSize = `${Math.round(16 * size)}px`;
    floats.appendChild(f);
    floatList.push({ el: f, x, y, h: hU, t: performance.now() });
    if (floatList.length > 40) { const o = floatList.shift(); o.el.remove(); }
  }

  // ── 매 프레임 ──
  let lastKey = { scores: "", w: "", chips: "", sel: "", res: "", tank: "", hp: "" };
  let cantUntil = 0, cantWhy = "";
  let tankFilling = false, lastFillAt = 0, wasFull = true;
  let cmdrAt = 0;
  const invSeen = [];
  let started = false;
  let wFlash = 0;

  function updateTop(world) {
    const sc = world.scores || [];
    const key = `${world.teams}|${sc.join(",")}|${world.team}|${world.goal}|${[...world.out].join(",")}`;
    if (key !== lastKey.scores) {
      lastKey.scores = key;
      let html = "";
      for (let t = 0; t < world.teams; t++) {
        const v = sc[t] || 0;
        html += `<span class="sc${t === world.team ? " me" : ""}${world.out.has(t) ? " out" : ""}" title="${world.out.has(t) ? `${TEAM_NAMES[t]} 팀 탈락` : ""}" style="--c:${css(TEAM_COLORS[t])}"><i></i><b>${v}</b><em style="width:${Math.min(100, (v / world.goal) * 100)}%"></em></span>`;
      }
      scoresEl.innerHTML = html + `<span class="goal">목표 ${world.goal}</span>`;
      scoresEl.className = `scores${world.teams > 4 ? " many" : ""}`;
    }
    clockEl.textContent = mmss(world.timeLeft);
    clockEl.classList.toggle("low", world.timeLeft < 60 && world.phase === PHASE.PLAY);
    modeEl.textContent = world.mode === "quiz" ? "퀴즈" : "아케이드";
    giveWorld = world;
    const inf = world.info || {};
    const wal = world.wallet(); // 내 지갑(U31) — 팀 합계는 보이지 않는다
    const rk = `${Math.floor(wal.gold)}|${Math.floor(wal.core)}|${Math.floor(wal.ink)}|${Math.floor(inf.gold || 0)}|${Math.floor(inf.core || 0)}|${Math.floor(inf.ink || 0)}|${wal.own}`;
    if (rk !== lastKey.res) {
      lastKey.res = rk;
      top.classList.toggle("wallet", wal.own);
      for (const k of ["gold", "core", "ink"]) {
        sumEl[k].textContent = ""; // 팀 합계는 보이지 않는다(사용자 요청) — 내 지갑만
        const v = Math.floor(wal[k] || 0);
        const e = resEl[k];
        // 늘었으면 숫자가 톡 튄다(일꾼이 내려놓았다)
        if (v > (+e.textContent || 0) && e.textContent !== "0") { const r = e.parentNode; r.classList.remove("bump"); void r.offsetWidth; r.classList.add("bump"); }
        e.textContent = v;
      }
    }
  }

  function updateMe(ctx) {
    const { world, hero } = ctx;
    const m = world.me;
    me.hidden = world.spectator;
    if (world.spectator || !m || !hero) return;
    const team = css(TEAM_COLORS[world.team] ?? 0xffffff);
    me.style.setProperty("--team", team);
    meDot.style.background = team;
    meName.textContent = world.playerName(world.you) || "나";
    // 목숨(U26): 남은 만큼 팀 색 하트 — 줄면 깨지는 연출
    const maxL = world.livesMax || HERO.LIVES;
    const lives = Number.isInteger(m.lives) ? Math.max(0, Math.min(maxL, m.lives)) : maxL;
    if (lives !== livesShown) {
      const lost = livesShown > lives ? livesShown : lives;
      let h = "";
      for (let i = 0; i < maxL; i++) h += `<i class="${i < lives ? "on" : i < lost ? "off break" : "off"}">♥</i>`;
      livesEl.innerHTML = h;
      livesShown = lives;
    }
    me.classList.toggle("cmdr", !!m.heroOut);
    const W = WEAPONS[hero.st.w] || WEAPONS[0];
    meW.textContent = W.name;
    meW.style.color = WCOLOR[hero.st.w];
    const hp = m.dead > 0 ? 0 : m.hp || 0, max = m.maxHp || 100;
    const hk = `${Math.ceil(hp)}|${max}`;
    if (hk !== lastKey.hp) {
      lastKey.hp = hk;
      hpFill.style.width = `${(hp / max) * 100}%`;
      hpFill.className = hp / max < 0.3 ? "low" : "";
      hpTxt.textContent = `${Math.ceil(hp)} / ${max}`;
    }
    let tank = hero.tank();
    const cost = shotInk(hero.st.w, false, world.research());
    // 공급소에서 채우는 중: 막대가 움직이는 줄무늬로 차오르고 "+50/초". 서버의 me 는 띄엄띄엄 오니 그 사이를 앞질러 그린다
    const filling = !(m.dead > 0) && world.heroRefilling() && world.wallet().ink > 0; // 내 잉크로만 찬다(U31)
    if (filling) tank = Math.min(INK.TANK, tank + INK.REFILL_RATE * Math.min(0.4, (performance.now() - (world.meAt || 0)) / 1000));
    if (filling !== tankFilling) { tankFilling = filling; tankEl.classList.toggle("charging", filling); }
    if (filling) lastFillAt = performance.now();
    // 가득 찼다(채우던 중에): "가득!" 한 번
    const full = tank >= INK.TANK - 0.5;
    if (full && !wasFull && performance.now() - lastFillAt < 1500) { tankEl.classList.remove("popfull"); void tankEl.offsetWidth; tankEl.classList.add("popfull"); }
    wasFull = full;
    const tk = `${Math.floor(tank)}|${cost}`;
    if (tk !== lastKey.tank) {
      lastKey.tank = tk;
      tankFill.style.width = `${(tank / INK.TANK) * 100}%`;
      tankCost.style.left = `${Math.min(100, (cost / INK.TANK) * 100)}%`;
      tankNum.textContent = `${Math.floor(tank)}`;
      tankEl.classList.toggle("empty", tank < cost);
      tankEl.classList.toggle("lowish", tank >= cost && tank < cost * 3);
    }
    // 소지품 줄(v2.2 — 브로울스식): 기본 잉크(∞) + 1개 이상 가진 무기. 칸을 누르면 바꿔 든다
    const list = world.slots();
    const res = world.research();
    const wk = `${list.join(",")}|${hero.st.w}|${res.thrift ? 1 : 0}|${ctx.touch ? 1 : 0}`;
    if (wk !== lastKey.w) {
      lastKey.w = wk;
      weaponsEl.innerHTML = list.map((w, i) => {
        const Wi = WEAPONS[w];
        const on = w === hero.st.w;
        const n = w ? hero.invLeft(w) : Infinity;
        return `<button class="wp${on ? " on" : ""}${w ? "" : " basic"}" data-w="${w}" style="--kc:${WCOLOR[w]}" title="${esc(Wi.name)} · 한 발 잉크 ${shotInk(w, false, res)}${w ? ` · ${n}개 남음` : " · 끝이 없어요"}">
          ${ctx.touch || i === 0 ? "" : `<kbd>${i < 9 ? i + 1 : 0}</kbd>`}<i class="wi"></i><span class="wn">${esc(WSHORT[w] || Wi.name)}</span><b class="wc">${w ? `×${n}` : "∞"}</b><em>${shotInk(w, false, res)}</em></button>`;
      }).join("");
      for (const w of list) invSeen[w] = w ? hero.invLeft(w) : Infinity;
    } else {
      // 개수만 바뀌었으면 그 칸의 숫자만 고치고 톡 튄다(샀다 · 썼다)
      for (const w of list) {
        if (!w) continue;
        const n = hero.invLeft(w);
        if (invSeen[w] === n) continue;
        invSeen[w] = n;
        const b = weaponsEl.querySelector(`[data-w="${w}"]`);
        if (!b) continue;
        b.querySelector(".wc").textContent = `×${n}`;
        b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump");
      }
    }
    if (wFlash) { weaponsEl.classList.remove("flash"); void weaponsEl.offsetWidth; weaponsEl.classList.add("flash"); wFlash = 0; }
    // 상태 딱지
    const chips = [];
    if (m.heroOut) chips.push(["cmdr", "지휘관"]);
    else if (m.dead > 0) chips.push(["dead", `부활 ${Math.ceil(m.dead)}초`]);
    if (m.carry > 0) chips.push(["gem", `보석 +${m.carry}`]);
    if (m.slow > 0) chips.push(["slow", `느려짐 ${Math.ceil(m.slow)}`]);
    if (m.stun > 0) chips.push(["stun", "어질어질"]);
    if (m.boost > 0) chips.push(["boost", `부스터 ${Math.ceil(m.boost)}`]);
    if (m.shield > 0) chips.push(["shield", `보호막 ${Math.ceil(m.shield)}`]);
    if (m.invuln > 0) chips.push(["inv", "무적"]);
    if ((m.bombCd || 0) > 0 && list.includes(9)) chips.push(["cd", `폭탄 ${Math.ceil(m.bombCd)}초`]);
    const ck = chips.map((c) => c.join(":")).join("|");
    if (ck !== lastKey.chips) {
      lastKey.chips = ck;
      chipsEl.innerHTML = chips.map(([k, t]) => `<span class="chip ${k}">${esc(t)}</span>`).join("");
    }
  }

  function updateBanner(ctx) {
    const { world, hero } = ctx;
    const m = world.me;
    let text = "", cls = "";
    const now = performance.now();
    if (world.phase === PHASE.BRIEF) { text = "이기는 방법을 읽어요"; cls = "info"; }
    else if (world.phase === PHASE.COUNTDOWN) { text = "곧 시작해요!"; cls = "info"; }
    else if (world.phase === PHASE.END) { text = "경기 끝!"; cls = "info"; }
    else if (world.spectator) { text = ""; }
    else if (m && m.heroOut) {
      // 지휘관(U26): 처음 10초는 길게, 그 뒤엔 짧게
      if (!cmdrAt) cmdrAt = now;
      text = now - cmdrAt < 10000 ? "지휘관 모드 · 유닛에게 명령해요" : "지휘관 모드";
      cls = "cmdr";
    }
    else if (m && m.dead > 0) {
      const L = Number.isInteger(m.lives) ? m.lives : null;
      text = `${Math.ceil(m.dead)}초 뒤 부활${L != null ? ` · 목숨 ${L}` : ""}${L === 1 ? " · 마지막!" : ""}`;
      cls = "dead";
    }
    else if (m && m.carry > 0) { text = world.carryBlocksThrow() ? "💎 우리 탑으로! · 못 던져요" : "💎 우리 탑으로 가져가요!"; cls = "gem"; }
    else if (hero && hero.ready && hero.tank() < hero.weaponCost(false)) { text = "🛢 잉크 부족 · 공급소로!"; cls = "ink"; }
    else if (now < cantUntil && WHY[cantWhy]) { text = WHY[cantWhy]; cls = cantWhy === "ink" ? "ink" : "warn"; }
    if (text) {
      if (banner.textContent !== text) banner.textContent = text;
      banner.className = `banner ${cls}`;
      banner.hidden = false;
    } else banner.hidden = true;
    if (world.phase === PHASE.PLAY && !started) {
      started = true;
      say("시작!", "go");
      // U17: 일꾼은 저절로 일하지 않는다 — 처음 한 번만 알려 준다(서버는 새로 뽑은 일꾼에만 알린다)
      if (!world.spectator) note(ctx.touch ? "⛏ 일꾼을 누르고 캘 곳을 골라요" : "⛏ 일꾼 고르고 금광 · 연못 오른쪽 클릭", "warn");
    }
  }

  function updateArrow(ctx, project) {
    const a = ctx.arrow;
    const hp = ctx.world.heroPos;
    if (!a || !hp) { arrowEl.hidden = true; return; }
    const p0 = project(hp.x, hp.y, 1.0);
    const p1 = project(a.x, a.y, 0);
    const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const dist = Math.hypot(a.x - hp.x, a.y - hp.y);
    if (dist < 3) { arrowEl.hidden = true; return; }
    const r = 62;
    arrowEl.hidden = false;
    arrowEl.classList.toggle("low", !!a.low);
    arrowEl.style.transform = `translate(${p0.x + Math.cos(ang) * r}px, ${p0.y + Math.sin(ang) * r}px)`;
    arrowEl.querySelector("i").style.transform = `translate(-50%, -50%) rotate(${ang}rad)`;
    arrowEl.querySelector("span").textContent = `공급소 ${Math.round(dist)}칸`;
  }

  function updateTags(tags, project) {
    let n = 0;
    const noNames = h.prefs && h.prefs.tags === false; // 설정 "이름표 보이기" 끔: 유닛 · 영웅 이름표를 감춘다(경보 "!" · 안내 글은 남긴다)
    for (const t of tags) {
      if (noNames && t.team >= 0 && !t.alarm) continue;
      const p = project(t.x, t.y, t.h);
      if (p.x < -60 || p.y < -30 || p.x > innerWidth + 60 || p.y > innerHeight + 30) continue;
      let e = tagPool[n];
      if (!e) { e = el("div", "tag", `<b></b><i><s></s></i>`); tagLayer.appendChild(e); tagPool[n] = e; e._k = ""; }
      n++;
      const key = `${t.name}|${t.team}|${t.self}|${t.gem}|${t.color || ""}|${t.alarm ? 1 : 0}|${t.mine ? 1 : 0}|${t.idle ? 1 : 0}`;
      if (e._k !== key) {
        e._k = key;
        e.querySelector("b").textContent = (t.gem ? "💎 " : "") + (t.self ? "나" : t.name);
        e.style.setProperty("--c", t.color || css(TEAM_COLORS[t.team] ?? 0xffffff));
        e.classList.toggle("self", t.self);
        e.classList.toggle("alarm", !!t.alarm);
        e.classList.toggle("mine", !!t.mine); // 내 일꾼 · 봇 · 몬스터: ▼ + 작은 이름
        e.classList.toggle("idle", !!t.idle); // 할 일이 없는 내 일꾼: "일 시켜주세요!" 말풍선
        e.classList.toggle("bare", !t.name); // 묶인 것: ▼ 만
        e.querySelector("i").hidden = t.hp == null; // 체력 막대가 없는 이름표(코어 금광 "2/2")
      }
      if (t.hp != null) e.querySelector("s").style.width = `${Math.max(0, Math.min(1, t.hp)) * 100}%`;
      e.style.transform = `translate(${p.x}px, ${p.y}px)`;
      e.hidden = false;
    }
    for (let i = n; i < tagPool.length; i++) tagPool[i].hidden = true;
  }

  /** 일꾼이 지금 하는 일(한 글자 부호): z 쉼 · g 골드 · c 코어 · i 잉크 · r 나르기 · b 짓기 · a 공격 · m 이동 */
  const JOB_NAME = { z: "쉼", g: "골드", c: "코어", i: "잉크", r: "나르기", b: "짓기", a: "공격", m: "이동" };
  function workerJob(u, world) {
    if (u.flags & UF.IDLE) return "z";
    if (u.anim === ANIM.ATTACK) return "a";
    if (u.anim === ANIM.BUILD) return "b";
    if (u.anim === ANIM.GATHER) {
      const M = world.map;
      for (const n of M.mines || []) if (besideNode(u, n, MINE.SIZE)) return "g";
      for (const n of M.cores || []) if (besideNode(u, n, CORE_MINE.SIZE)) return "c";
      for (const n of M.ponds) if (besideNode(u, n, POND.SIZE)) return "i";
      return "g";
    }
    if (u.info > 0) return "r";
    return "m";
  }
  function updateSel(ctx) {
    if (tgtHint.hidden === !!ctx.targeting) tgtHint.hidden = !ctx.targeting;
    const sel = ctx.selected;
    if (panels.isOpen || (!sel.length && !ctx.heroSel)) { selbar.hidden = true; lastKey.sel = ""; return; }
    const count = { w: 0, b: 0, p: 0 };
    for (const u of sel) {
      if (u.type === UTYPE.WORKER) count.w++;
      else if (u.type === UTYPE.BOT) count.b++;
      else count.p++;
    }
    const pet = sel.find((u) => u.type === UTYPE.PET);
    // 일꾼마다 지금 하는 일(작은 딱지): 쉼 · 골드 · 코어 · 잉크 · 나르기 · 짓기 · 공격 · 이동
    let jobs = "";
    for (const u of sel) if (u.type === UTYPE.WORKER) jobs += workerJob(u, ctx.world);
    const key = `${count.w}|${count.b}|${count.p}|${pet ? pet.sub : ""}|${ctx.command}|${ctx.heroSel ? 1 : 0}|${jobs}|${ctx.targeting ? 1 : 0}`;
    selbar.hidden = false;
    if (key === lastKey.sel) return;
    lastKey.sel = key;
    const parts = [];
    if (ctx.heroSel) parts.push(`<span class="su h">영웅 <b>나</b></span>`);
    if (count.w) parts.push(`<span class="su w">일꾼 <b>${count.w}</b></span><span class="wjobs">${[...jobs].map((j) => `<i class="wj j-${j}" title="${JOB_NAME[j]}">${JOB_NAME[j]}</i>`).join("")}</span>`);
    if (count.b) parts.push(`<span class="su b">잉크봇 <b>${count.b}</b></span>`);
    if (pet) parts.push(`<span class="su p">${esc(MONSTERS[pet.sub]?.name || "몬스터")} <b>Lv${pet.info || 1}</b></span>`);
    const btns = [];
    if (count.w) btns.push(`<button data-s="g-gold" class="big g-gold">● 골드 캐기</button>`, `<button data-s="g-core" class="big g-core">◆ 코어 캐기</button>`, `<button data-s="g-ink" class="big g-ink">💧 잉크 긷기</button>`, `<button data-s="place" class="big">공급소 짓기 <kbd>B</kbd></button>`);
    if (count.b || count.p) btns.push(`<button data-s="follow">따라와 <kbd>F</kbd></button>`, `<button data-s="hold">제자리 지키기</button>`);
    if (sel.length) btns.push(`<button data-s="attack" class="big atk${ctx.targeting ? " on" : ""}">⚔ 공격 <kbd>X</kbd></button>`);
    btns.push(`<button data-s="stop">멈춤</button>`, `<button data-s="clear" class="x">✕</button>`);
    const hint = ctx.touch ? (ctx.command ? "누른 곳으로 명령" : "지휘 켜고 누르면 명령") : ctx.heroSel && !sel.length ? "오른쪽 클릭 = 걷기" : "오른쪽 클릭 = 명령";
    selbar.innerHTML = `<div class="su-list">${parts.join("")}<small>${hint}</small></div><div class="su-btns">${btns.join("")}</div>`;
  }

  function updateFloats(project) {
    const now = performance.now();
    for (let i = floatList.length - 1; i >= 0; i--) {
      const f = floatList[i];
      const k = (now - f.t) / 1200;
      if (k >= 1) { f.el.remove(); floatList.splice(i, 1); continue; }
      const p = project(f.x, f.y, f.h + k * 1.6);
      f.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${1 + (1 - Math.min(1, k * 6)) * 0.4})`;
      f.el.style.opacity = String(1 - k * k);
    }
  }

  let mmAcc = 0;
  function update(ctx, scene) {
    if (homeBtn.hidden === !!ctx.camAway) homeBtn.hidden = !ctx.camAway;
    // 지휘관(영웅 없음): 단추는 "우리 탑으로" · 구경(우리 팀 탈락): 명령 UI 를 숨기고 "구경 중"
    const hk = ctx.heroOut ? "tower" : "hero";
    if (homeBtn._k !== hk) { homeBtn._k = hk; homeBtn.innerHTML = hk === "tower" ? `<i>⚑</i>우리 탑으로<kbd>C</kbd>` : `<i>⌖</i>내 영웅으로<kbd>C</kbd>`; }
    const spec = !!ctx.world.spectator;
    if (spec !== root.classList.contains("spectating")) {
      root.classList.toggle("spectating", spec);
      document.documentElement.classList.toggle("spectating", spec);
      if (spec) { panels.close(); card.close(); }
    }
    document.documentElement.classList.toggle("cmdr", !!ctx.heroOut);
    updateTop(ctx.world);
    updateMe(ctx);
    updateBanner(ctx);
    updateArrow(ctx, scene.project);
    updateTags(scene.tags, scene.project);
    card.update(ctx);
    updateSel(ctx);
    panels.update(ctx.world);
    updateFloats(scene.project);
    mmAcc++;
    if (mmAcc >= 6) { mmAcc = 0; drawMinimap(ctx, scene.viewCorners()); }
  }

  // ── 사건(글자 · 알림) ──
  function onFx(list, world, view) {
    const heroId = world.me?.heroId;
    for (const e of list) {
      if (e.k === "hit") {
        const u = view?.byId?.get(e.id);
        const mine = e.id === heroId;
        const x = mine && world.heroPos ? world.heroPos.x : u?.x ?? e.x, y = mine && world.heroPos ? world.heroPos.y : u?.y ?? e.y;
        if (x == null || !(e.dmg > 0) || (h.prefs && h.prefs.floats === false)) continue; // 설정 "피해 숫자 보이기" 끔
        const col = mine ? "#ff3b4e" : u && u.team === world.team ? "#ffb0c0" : "#ffe600";
        float(x, y, 2.6, `-${Math.round(e.dmg)}`, col, mine ? 1.2 : 1);
      } else if (e.k === "gem") {
        const tn = TEAM_NAMES[e.team] ?? "";
        if (e.ev === "pop") { note(`💎 보석이 나왔어요!${e.value >= 2 ? ` (${e.value}점)` : ""}`, "gem", { x: e.x, y: e.y }); pings.push({ x: e.x, y: e.y, t: performance.now(), color: "#7df9ff" }); }
        else if (e.ev === "pick") note(`${tn} 팀이 보석을 주웠어요`, e.team === world.team ? "good" : "warn");
        else if (e.ev === "steal") note(`${tn} 팀이 보석을 빼앗았어요!`, e.team === world.team ? "good" : "alarm");
        else if (e.ev === "drop") { note("💎 보석이 떨어졌어요!", "warn", { x: e.x, y: e.y }); pings.push({ x: e.x, y: e.y, t: performance.now(), color: "#ffe600" }); }
        else if (e.ev === "return") note("💎 보석이 제자리로 갔어요", "info");
        else if (e.ev === "shield") float(e.x, e.y, 3.2, e.team === world.team ? "방어막 깨짐! 바위를 부숴요" : "방어막 깨짐!", "#7fe3ff", 1.1);
      } else if (e.k === "item" && e.ev === "pick") {
        const it = ITEMS[e.kind];
        if (it) float(e.x, e.y, 2.4, `${it.name}!`, "#a8ff00");
      } else if (e.k === "bdown") {
        const b = view?.buildings.find((q) => q.id === e.id);
        const team = e.team ?? b?.team;
        if (world.out.has(team)) continue; // 탈락한 팀의 건물이 한꺼번에 사라진다 — 알림은 elim 하나로(U27)
        const name = BUILDINGS[e.kind ?? b?.kind]?.name || "건물";
        const at = b ? { x: b.tx + BUILDINGS[b.kind].size / 2, y: b.ty + BUILDINGS[b.kind].size / 2 } : null;
        if (team === world.team) note(`우리 ${name}이(가) ${e.kind === BLD.TOWER ? "부서졌어요!" : e.kind === BLD.SUPPLY ? "무너졌어요!" : "고장 났어요!"}`, "alarm", at);
        else note(`${TEAM_NAMES[team] ?? ""} 팀의 ${name}을(를) 무너뜨렸어요!`, "good", at);
        if (b) {
          if (team === world.team) alarm(b.tx + BUILDINGS[b.kind].size / 2, b.ty + BUILDINGS[b.kind].size / 2);
          else pings.push({ x: b.tx + 1.5, y: b.ty + 1.5, t: performance.now(), color: "#a8ff00" });
        }
      } else if (e.k === "ko" && e.id === heroId && !world.out.has(world.team)) { // 우리 팀 탈락으로 쓰러진 것은 "우리 팀 탈락…" 이 대신한다
        say("KO!", "ko");
      }
    }
  }

  // ── 팀 탈락(U27) ──
  const ELIM_WHY = { tower: "탑이 부서졌어요", heroes: "영웅이 모두 쓰러졌어요" };
  function onElim(m, world) {
    const tn = TEAM_NAMES[m.team] ?? "";
    const why = ELIM_WHY[m.reason] || "";
    // 알림 글은 서버가 모두에게 보낸다("○○ 팀 탈락! (…)") — 여기서는 큰 글자와 미니맵 표시만
    if (m.team === world.team) say("우리 팀 탈락…", "ko out", `${why} · 구경해요`, 3800);
    else {
      const byUs = m.by === world.team && m.reason === "tower";
      say(`${tn} 팀 탈락!`, byUs ? "go" : "bad", byUs ? "우리가 탑을 부쉈어요!" : `${why} · 남은 팀 ${(m.left || []).length}`, 2200);
      const b = world.map.bases[m.team];
      if (b) pings.push({ x: b.cx, y: b.cy, t: performance.now(), color: "#ffffff" });
    }
    lastKey.scores = ""; // 점수 띠를 다시(흐린 딱지)
  }

  // ── 퀴즈 ──
  function quizOpen(m) {
    clearInterval(quizTimer);
    quiz.hidden = false;
    quizLive = true;
    const q = m.q || {};
    quiz.innerHTML = `<div class="q-box"><div class="q-head">💎 보석 문제 <span class="q-time"><i></i></span><b class="q-sec">${Math.ceil(m.time || 20)}</b></div>
      <div class="q-text">${esc(q.text)}</div>
      <div class="q-choices">${(q.choices || []).map((c, i) => `<button class="q-c" data-i="${i}"><kbd>${i + 1}</kbd>${esc(c)}</button>`).join("")}</div>
      <div class="q-foot">맞히면 보석! · 푸는 동안 나는 공격받지 않아요</div></div>`;
    const t0 = performance.now();
    const T = (m.time || 20) * 1000;
    const bar = quiz.querySelector(".q-time i"), sec = quiz.querySelector(".q-sec");
    quizTimer = setInterval(() => {
      const k = Math.max(0, 1 - (performance.now() - t0) / T);
      bar.style.width = `${k * 100}%`;
      sec.textContent = Math.ceil((k * T) / 1000);
      if (k <= 0) clearInterval(quizTimer);
    }, 100);
    quiz.querySelectorAll(".q-c").forEach((b) => (b.onclick = () => answer(+b.dataset.i)));
    // 잠깐 잠금: 단추가 흐리게 시작해 QUIZ.LOCK 뒤 켜진다
    quizLockUntil = performance.now() + QUIZ.LOCK * 1000;
    const box = quiz.querySelector(".q-box");
    box.classList.add("locked");
    clearTimeout(quizLockT);
    quizLockT = setTimeout(() => box.classList.remove("locked"), QUIZ.LOCK * 1000);
  }
  function answer(i) {
    if (!quizLive || performance.now() < quizLockUntil) return;
    quizLive = false;
    h.onAnswer(i);
    quiz.querySelectorAll(".q-c").forEach((b) => { b.disabled = true; if (+b.dataset.i === i) b.classList.add("picked"); });
  }
  function quizResult(r) {
    clearInterval(quizTimer);
    quizLive = false;
    const box = quiz.querySelector(".q-box");
    if (!box) return;
    quiz.querySelectorAll(".q-c").forEach((b) => {
      b.disabled = true;
      const i = +b.dataset.i;
      if (i === r.answer) b.classList.add("right");
      else if (b.classList.contains("picked")) b.classList.add("wrong");
    });
    const foot = quiz.querySelector(".q-foot");
    foot.className = "q-foot " + (r.ok ? "ok" : "no");
    foot.innerHTML = (r.ok ? "정답! 보석이 나와요 💎" : r.timeout ? `시간 끝! ${GEM.QUIZ_LOCKOUT}초 뒤 다시` : `아쉬워요! ${GEM.QUIZ_LOCKOUT}초 뒤 다시`) + (r.explain ? `<div class="q-exp">${esc(r.explain)}</div>` : "");
    setTimeout(() => { if (!quizLive) quiz.hidden = true; }, r.ok ? 1500 : 2600);
  }
  function quizClose() {
    clearInterval(quizTimer);
    if (quiz.querySelector(".q-foot.ok, .q-foot.no")) return; // 결과를 잠깐 보여 준 뒤 닫힌다
    quizLive = false;
    quiz.hidden = true;
  }

  // ── 결과 ──
  function showResult(r, world) {
    result.hidden = false;
    const myTeam = world.team;
    const win = r.winner === myTeam;
    const ranking = (r.ranking || []).map((t) => (typeof t === "number" ? { team: t } : t));
    // 탈락한 팀(U27): 순위 옆에 까닭(탑 · 영웅) — 결과의 out/reason 이 없으면 경기 중에 받은 elim 으로
    const outWhy = (t) => {
      const rs = t.outReason || t.elim || world.outInfo.get(t.team)?.reason || (world.out.has(t.team) ? "?" : "");
      return rs ? `<span class="r-out">탈락 · ${rs === "tower" ? "탑" : rs === "heroes" ? "영웅" : "?"}</span>` : "";
    };
    const rows = ranking.map((t, i) => `<tr class="${t.team === myTeam ? "me" : ""}${outWhy(t) ? " outrow" : ""}"><td>${i + 1}</td><td><span class="dot" style="background:${css(TEAM_COLORS[t.team] ?? 0xffffff)}"></span>${TEAM_NAMES[t.team] ?? "?"} 팀 ${outWhy(t)}</td><td>💎 ${t.score ?? world.scores?.[t.team] ?? 0}</td><td>KO ${t.kos ?? world.info?.kos?.[t.team] ?? 0}</td></tr>`).join("");
    // 개인 지갑(U31): 캔 양 · 쓴 양 · 보낸 양 — 칸마다 ● 골드 ◆ 코어 💧 잉크(0 은 빼고)
    const hasWal = (r.players || []).some((p) => p.made || p.spent || p.given);
    const walCell = (o) => {
      if (!o) return "–";
      const parts = [["gold", "●"], ["core", "◆"], ["ink", "💧"]].filter(([k]) => (o[k] || 0) > 0).map(([k, ic]) => `<span class="w-${k}">${ic}${Math.round(o[k])}</span>`);
      return parts.length ? parts.join(" ") : "0";
    };
    const ps = (r.players || []).slice().sort((a, b) => (a.team - b.team) || ((b.delivered || 0) - (a.delivered || 0))).map((p) =>
      `<tr class="${p.slot === world.you || p.name === world.playerName(world.you) ? "me" : ""}"><td><span class="dot" style="background:${css(TEAM_COLORS[p.team] ?? 0xffffff)}"></span>${esc(p.name)}${p.bot ? " 🤖" : ""}</td><td>${p.delivered ?? 0}</td><td>${p.kos ?? 0}</td><td>${p.deaths ?? 0}</td>${world.mode === "quiz" ? `<td>${p.right ?? 0}/${(p.right ?? 0) + (p.wrong ?? 0)}</td>` : ""}${hasWal ? `<td class="r-wal">${walCell(p.made)}</td><td class="r-wal">${walCell(p.spent)}</td><td class="r-wal">${walCell(p.given)}</td>` : ""}</tr>`).join("");
    const why = r.reason === "goal" ? `보석 ${world.goal}점 먼저 모았어요!` : r.reason === "time" ? "시간 끝 · 보석 많은 팀 승리" : r.reason === "last" ? `${TEAM_NAMES[r.winner] ?? ""} 팀이 끝까지 남았어요!` : r.reason === "draw" ? "비겼어요!" : "";
    result.innerHTML = `<div class="r-box">
      <h1 class="${win ? "win" : "lose"}">${myTeam < 0 ? `${TEAM_NAMES[r.winner] ?? ""} 팀 승리!` : r.winner == null || r.winner < 0 ? "무승부!" : win ? "승리!" : "아쉬워요!"}</h1>
      <p class="r-why">${why}</p>
      <div class="r-scroll">
      <table class="r-teams${ranking.length > 4 ? " many" : ""}">${rows}</table>
      ${ps ? `<table class="r-players"><tr><th>이름</th><th>배달</th><th>KO</th><th>쓰러짐</th>${world.mode === "quiz" ? "<th>정답</th>" : ""}${hasWal ? "<th>캔 양</th><th>쓴 양</th><th>보낸 양</th>" : ""}</tr>${ps}</table>` : ""}
      </div>
      <button class="primary again">대기실로</button></div>`;
    result.querySelector(".again").onclick = () => h.onAgain();
  }

  function openPanel(kind) {
    card.close();
    panels.open(kind);
  }

  return {
    root,
    show(world) {
      root.hidden = false;
      livesShown = -1;
      cmdrAt = 0;
      result.hidden = true;
      quiz.hidden = true;
      quizLive = false;
      notes.innerHTML = "";
      started = false;
      panels.close();
      card.close();
      lastKey = { scores: "", w: "", chips: "", sel: "", res: "", tank: "", hp: "" };
      buildMinimap(world);
      let seen = null;
      try { seen = localStorage.getItem("ibr2-help"); } catch {}
      if (!seen) { help.hidden = false; try { localStorage.setItem("ibr2-help", "1"); } catch {} }
    },
    hide() { root.hidden = true; clearInterval(quizTimer); panels.close(); card.close(); give.hidden = true; },
    update, onFx, note, toast, say, float, onElim,
    pings, alarm,
    openPanel,
    closePanel() { panels.close(); },
    openInfo(t) { if (t) card.open(t); },
    closeInfo() { card.close(); },
    get infoOpen() { return card.isOpen; },
    /** 아래쪽을 덮은 판의 높이(px) — 화면이 영웅을 그 위 빈 곳에 보이게 조금 내려 본다 */
    coverBottom() {
      if (!panels.isOpen) return 0;
      const r = panels.el.getBoundingClientRect();
      return Math.max(0, innerHeight - r.top);
    },
    get panelOpen() { return panels.isOpen; },
    toggleHelp,
    closeHelp() { if (help.hidden) return false; help.hidden = true; return true; },
    flashWeapon() { wFlash = 1; },
    cantThrow(why) {
      if (!WHY[why]) return;
      cantWhy = why;
      cantUntil = performance.now() + 1600;
    },
    score(m, world) {
      const tn = TEAM_NAMES[m.team] ?? "";
      const v = m.value ?? 1;
      if (v < 0) say(`${tn} 팀 −${-v}점`, m.team === world.team ? "bad" : "go");
      else say(`${tn} 팀 +${v}점!`, m.team === world.team ? "go" : "bad");
    },
    quizOpen, quizResult, quizClose, answer,
    get quizOpenNow() { return quizLive && !quiz.hidden; },
    get quizShown() { return !quiz.hidden; },
    showResult,
  };
}
