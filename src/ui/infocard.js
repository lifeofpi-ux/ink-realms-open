// 지도 물건 설명 카드(U18): 금광 · 큰 금광 · 코어 금광 · 잉크 연못 · 보석 섹션 · 적 건물을 누르면 뜨는 작은 블랙라이트 포스터 카드.
// 건물 판보다 작고 오른쪽(휴대폰은 위 띠 아래)에 떠서 영웅을 가리지 않는다. 값은 모두 shared/constants.js 에서 읽는다.
//
//   const card = createInfoCard(root, { gatherAt(res, i), onClose() })
//   card.open({ t: "res", res: "gold"|"core"|"ink", i } | { t: "site", id } | { t: "bld", id })  — 같은 것을 다시 열면 그대로
//   card.update(ctx)   — 프레임마다(4프레임에 한 번 다시 그린다 — 바뀐 것이 있을 때만)
import {
  TEAM_COLORS, TEAM_NAMES, MINE, CORE_MINE, POND, GEM, SITE_STATE, BUILDINGS, BLD, UNITS, MONSTER_TIERS, UTYPE, TOWER,
} from "../../shared/constants.js";
import { BF } from "../../shared/protocol.js";

const css = (hex) => "#" + (hex >>> 0).toString(16).padStart(6, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const RES_SIZE = { gold: MINE.SIZE, core: CORE_MINE.SIZE, ink: POND.SIZE };
const RES_HEX = { gold: "#ffd23f", core: "#b46bff", ink: "#ff2df0" };
const pct = (v) => `${Math.round(Math.max(0, Math.min(1, v || 0)) * 100)}%`;

/** 캐는 곳 곁(가장자리 1칸 안)에 선 일꾼인가 — 서버는 캐는 동작을 따로 보내지 않아 곁에 있으면 캐는 중으로 본다 */
export function besideNode(u, node, size) {
  const cx = node.tx + size / 2, cy = node.ty + size / 2;
  return Math.max(Math.abs(u.x - cx), Math.abs(u.y - cy)) < size / 2 + 1.05;
}

export function createInfoCard(root, h) {
  const el = document.createElement("div");
  el.className = "icard";
  el.hidden = true;
  root.appendChild(el);
  let target = null;
  let lastKey = "";
  let tick = 0;

  el.addEventListener("pointerdown", (e) => e.stopPropagation()); // 카드 누르기는 던지기 · 고르기가 아니다
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.a === "x") close();
    else if (b.dataset.a === "send" && target?.t === "res") h.gatherAt?.(target.res, target.i);
  });

  const keyOf = (t) => (t ? `${t.t}:${t.res || ""}:${t.i ?? t.id}` : "");
  function open(t) {
    if (keyOf(t) === keyOf(target) && !el.hidden) return;
    target = t;
    lastKey = "";
    tick = 0;
    el.hidden = false;
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }
  function close() {
    if (!target) return;
    target = null;
    el.hidden = true;
    h.onClose?.();
  }

  const teamLine = (world, team, what) => {
    if (team == null || team < 0 || team >= TEAM_COLORS.length) return "";
    return team === world.team ? `<em class="ours">우리 ${what}</em>` : `<em style="--tc:${css(TEAM_COLORS[team])}">${TEAM_NAMES[team]} 팀 ${what}</em>`;
  };
  const stat = (big, small, cls = "") => `<span class="${cls}"><b>${big}</b><small>${small}</small></span>`;

  function resCard(ctx, res, i) {
    const { world, view } = ctx;
    const list = res === "gold" ? world.map.mines || [] : res === "core" ? world.map.cores || [] : world.map.ponds;
    const node = list[i];
    if (!node) return null;
    const size = RES_SIZE[res];
    let mineN = 0, allN = 0;
    for (const u of view.units) {
      if (u.type !== UTYPE.WORKER || !besideNode(u, node, size)) continue;
      allN++;
      if (u.owner === world.you) mineN++;
    }
    const selW = ctx.selected.filter((u) => u.type === UTYPE.WORKER).length;
    let title, where, stats, body, ico;
    if (res === "gold") {
      ico = "gold";
      title = node.rich ? "큰 금광" : "본진 금광";
      where = node.rich ? teamLine(world, node.team, "쪽") : teamLine(world, node.team, "본진");
      stats = stat(`골드 ${node.rich ? MINE.RICH : MINE.BASE}`, "한 번에", "g") + stat(`${MINE.TIME}초`, "캐는 시간");
      body = `골드로 <b>무기 · 일꾼 · 연구</b>를 사요` + (node.rich ? `<br><span class="warn">몬스터가 지켜요</span>` : "");
    } else if (res === "core") {
      ico = "core";
      title = "코어 금광";
      where = teamLine(world, node.team, "숲");
      const bot = UNITS.bot.train.core;
      const lo = MONSTER_TIERS[0].hatch.core, hi = MONSTER_TIERS[MONSTER_TIERS.length - 1].hatch.core;
      stats = stat(`코어 ${CORE_MINE.AMOUNT}`, "한 번에", "c") + stat(`${CORE_MINE.TIME}초`, "캐는 시간") +
        stat(`${Math.min(allN, CORE_MINE.SLOTS)}/${CORE_MINE.SLOTS}`, "지금 캐는 일꾼", allN >= CORE_MINE.SLOTS ? "full" : "");
      body = `일꾼 <b>${CORE_MINE.SLOTS}명</b>까지 · 코어로 <b>봇 ${bot} · 몬스터 ${lo}~${hi}</b>`;
    } else {
      ico = "ink";
      title = "잉크 연못";
      where = teamLine(world, node.team, "본진");
      stats = stat(`잉크 ${POND.BASE}`, "한 번에", "i") + stat(`${POND.TIME}초`, "긷는 시간");
      body = `<b>탱크 충전</b>에만 써요`;
    }
    const send = selW ? `<button class="ic-send" data-a="send">고른 일꾼 ${selW}명 보내기</button>` : "";
    return {
      hex: RES_HEX[res],
      html: `<div class="ic-head"><i class="ic-ico ${ico}"></i><b>${title}</b>${where}</div>
        <div class="ic-stats">${stats}</div><p>${body}</p>
        <div class="ic-mine">여기서 캐는 <b>내 일꾼 ${mineN}명</b></div>
        <p class="ic-hint">일꾼 고르고 <b>오른쪽 클릭</b> = 캐기</p>${send}`,
    };
  }

  function siteCard(ctx, id) {
    const { world, view } = ctx;
    const m = world.map.sites[id];
    const x = view.sites.find((s) => s.id === id);
    if (!m || !x) return null;
    const value = x.value || (m.center ? GEM.VALUE.center : GEM.VALUE.side);
    const quiz = world.mode === "quiz";
    let state, stats;
    if (x.state === SITE_STATE.SHIELD) {
      state = quiz ? "방어막 깨면 <b>퀴즈</b> · 맞히면 보석" : "방어막 → <b>바위</b> 부수면 보석";
      stats = stat(pct(x.shield), "방어막", "sh");
    } else if (x.state === SITE_STATE.ROCK) {
      state = "<b>바위</b>를 부수면 보석!";
      stats = stat(pct(x.rock), "바위", "rk");
    } else if (x.state === SITE_STATE.QUIZ) {
      const tn = x.team >= 0 ? TEAM_NAMES[x.team] : "";
      state = x.team === world.team ? "<b>우리 팀</b> 퀴즈 중" : `<b>${tn} 팀</b> 퀴즈 중`;
      stats = stat(`${x.timer}초`, "풀이 남은 시간", "q");
    } else if (x.state === SITE_STATE.GEM) {
      state = "<b>보석</b>을 주워 우리 탑으로!";
      stats = stat("💎", "보석", "gm");
    } else {
      state = "곧 다시 생겨요";
      stats = stat(`${x.timer}초`, "다시 서기까지");
    }
    const carry = GEM.CARRY_ATTACK[world.mode] ? "보석 들고도 던져요" : "보석 들면 <b>못 던져요</b>";
    return {
      hex: m.center ? "#ffe600" : "#7df9ff",
      html: `<div class="ic-head"><i class="ic-ico gem${m.center ? " center" : ""}"></i><b>${m.center ? "가운데 보석 섹션" : "보석 섹션"}</b><em class="val">보석 ${value}점</em></div>
        <div class="ic-stats">${stats}${stat(quiz ? "퀴즈" : "아케이드", "모드")}</div>
        <p>${state}</p><p class="ic-hint">${carry}</p>`,
    };
  }

  function bldCard(ctx, id) {
    const { world, view } = ctx;
    const b = view.buildings.find((q) => q.id === id);
    if (!b) return null;
    const def = BUILDINGS[b.kind];
    const hp = Math.ceil(b.hp * def.hp);
    let state = "";
    if (!(b.flags & BF.BUILT)) state = "짓는 중";
    else if (b.flags & BF.DOWN) state = `꺾임 · ${b.timer}초`;
    else if (b.flags & BF.BROKEN) state = "고장 났어요";
    const tip = b.kind === BLD.TOWER ? `부수면 그 팀 탈락 · ${TOWER.RANGE}칸 안은 탑이 쏴요` :
      b.kind === BLD.SUPPLY ? "부수면 잉크 충전이 막혀요" : "부수면 고장 나요";
    return {
      hex: css(TEAM_COLORS[b.team] ?? 0xffffff),
      html: `<div class="ic-head"><i class="ic-ico bld"></i><b>${def.name}</b>${teamLine(world, b.team, "건물")}</div>
        <div class="ic-hp"><i style="width:${pct(b.hp)}"></i><span>${hp} / ${def.hp}</span></div>
        ${state ? `<p><b>${state}</b></p>` : ""}<p class="ic-hint">${tip}</p>`,
    };
  }

  function update(ctx) {
    if (!target || !ctx.view) return;
    if (tick++ % 4) return;
    const c = target.t === "res" ? resCard(ctx, target.res, target.i) : target.t === "site" ? siteCard(ctx, target.id) : bldCard(ctx, target.id);
    if (!c) { close(); return; }
    const key = c.hex + c.html;
    if (key === lastKey) return;
    lastKey = key;
    el.style.setProperty("--c", c.hex);
    el.innerHTML = `<button class="ic-x" data-a="x" title="닫기 (Esc)">✕</button>${c.html}`;
  }

  return {
    el, open, close, update,
    get isOpen() { return !!target; },
    get key() { return keyOf(target); },
    keyOf,
  };
}
