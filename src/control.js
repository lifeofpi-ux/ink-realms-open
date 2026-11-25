// 경기 조작(docs/DESIGN.md §2): 내 영웅(WASD · 대시 · 점프 · 겨누기 · 충전 · 던지기 — hero.js) + 작은 전략 층(끌어서 고르기 ·
// 오른쪽 클릭 명령 · 자동 팀 구성 · 공급소 짓기) + 화면(영웅을 따라가며 마우스 쪽으로 조금 앞서 본다 · 휠 확대 · 미니맵 잠깐 보기) + 터치.
//
// 왼쪽 누름을 셋으로 가른다: 내 유닛 위 = 고르기 · 내 건물 위 = 그 건물 판 · 그 밖 = 던지기(누르는 동안 충전). 누른 채 끌면(문턱을 넘으면)
// 던지기를 내려놓고 묶어 고르기가 된다.
import {
  UTYPE, BLD, BUILDINGS, WEAPONS, SQUAD, MISSILE, TILE, POND, MINE as MINE_K, CORE_MINE, GEM, TEAM_COLORS, isSolidTile, canAfford, costText,
  BUILD_NEAR, UNITS, MONSTERS, throwRange,
} from "../shared/constants.js";

export const RES_NAME = { gold: "골드", core: "코어", ink: "잉크" };
const RES_HEX = { gold: 0xffd23f, core: 0xa24bff, ink: 0xff2df0 };
import { rectOnFloor } from "../shared/map.js";
import { UF, BF, PHASE } from "../shared/protocol.js";
import { ZOOM } from "./render/brawlscene.js";
import { rockUp } from "./world.js";
import { WSHORT } from "./ui/hud.js";

const DRAG = 12; // 이만큼(px) 끌면 묶어 고르기
const CHARGE_HOLD = 250; // 이만큼(ms) 넘게 누르고 있었으면 충전 중이다 — 그 뒤 끌기는 고르기가 아니라 조준(폭탄 자리)만 옮긴다
const DOUBLE_TAP = 0.25;
const DIRS = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
const MINE = new Set([UTYPE.WORKER, UTYPE.BOT, UTYPE.PET]);

export function createControl({ scene, hud, net, canvas, touch }) {
  let world = null;
  let hero = null;
  let view = null;
  const ui = { selected: new Set(), hover: 0, hoverRes: null, place: null, aim: null, followRing: false, rings: [], walk: null, heroSel: false };
  const keys = new Set();
  const mouse = { x: innerWidth / 2, y: innerHeight / 2, inside: false, ground: null };
  let press = null; // 왼쪽 누름 { x0, y0, t0, mode: "charge" | "unit" | "building" | "box" | "place", pick, shift }
  let tpress = null; // 터치 누름(캔버스)
  let placing = false;
  let targeting = false; // 공격 과녁 고르기(공격 단추 · X) — 다음 누르기가 과녁
  let peek = null; // 미니맵을 누르고 있는 동안 볼 곳
  let arrowUntil = 0; // R: 공급소 길 표시
  let followShow = 0; // 따라와 명령 직후 진형 고리를 잠깐
  let lastTap = { dir: "", t: 0 };
  let frame = 0;
  let viaTouch = false;
  // 화면(카메라): 기본은 내 영웅을 따라간다(마우스 쪽으로 조금 앞서). 그 밖의 때:
  //   pan  = 끌어서 옮기는 중(휠 버튼 · Space+왼쪽 끌기 · 터치 지휘 모드 한 손가락) — 잡은 땅이 손가락 · 커서 밑에 그대로 남는다
  //   look = 알림을 눌러 그곳을 잠깐(LOOK_HOLD) 본다 · free = 그 자리에 머문다(쓰러진 동안 · 터치 지휘 모드에서 옮긴 뒤)
  // 끝나면 영웅에게 돌아간다 — 카메라의 따라가기 감속(약 0.35초)이 부드럽게 데려간다. 부활할 때만 곧바로(snap).
  const LOOK_HOLD = 2500;
  const cam = { mode: "hero", x: 0, y: 0, until: 0, how: "", drag: null };
  let wasDead = false;
  let snapHero = false;
  const boxEl = document.createElement("div");
  boxEl.className = "dragbox";
  boxEl.hidden = true;
  document.body.appendChild(boxEl);

  const inGame = () => !!world && !!view;
  const me = () => world?.me;
  const heroAlive = () => !!hero && hero.ready && me() && !(me().dead > 0) && !me().heroOut;
  // 영웅이 없다: 목숨을 다 썼거나(지휘관 — U26) 우리 팀이 탈락했다(구경 — U27). 화면은 자유 시점, WASD · 이동 판 = 화면 옮기기
  const heroOutNow = () => !!me()?.heroOut;
  const freeCamOnly = () => !!world && (world.spectator || heroOutNow());
  const quizOpen = () => hud.quizOpenNow;

  // ── 찾기 ──
  const myUnits = () => (view ? view.units.filter((u) => u.owner === world.you && MINE.has(u.type)) : []);
  const selMine = () => myUnits().filter((u) => ui.selected.has(u.id));

  // ── 누른 것 찾기(화면 점 → 유닛 · 건물 · 보석 · 캐는 곳 · 섹션 · 땅) ──
  // 유닛은 발 → 머리 세로 막대(캡슐)로 잰다: 탑 뒤에 반쯤 가린 일꾼의 머리 · 몸 가장자리를 눌러도 그 일꾼. 내 유닛은 넉넉한 반지름 + 먼저.
  // 건물은 화면에 그려진 몸통(바닥 네모 ~ 지붕 높이)의 상자로 — 높은 평면 투영으로 앞 · 뒤 땅을 탑으로 잘못 집지 않게. 유닛이 늘 먼저다.
  const BLD_TOP = [6.6, 4.2, 5.6, 3.2]; // 건물 몸통 높이(u — 그림과 맞춘 어림)
  const segDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(ax + dx * t - px, ay + dy * t - py);
  };
  function unitTop(u) {
    if (u.type === UTYPE.PET || u.type === UTYPE.NPC) return 1.2 + (MONSTERS[u.sub]?.scale || 1) * 0.9;
    return (u.type === UTYPE.WORKER ? 1.75 : u.type === UTYPE.BOT ? 1.65 : 2.2) + (u.z || 0);
  }
  function unitHalf(u, ppt) {
    if (u.type === UTYPE.PET || u.type === UTYPE.NPC) return (MONSTERS[u.sub]?.radius || 0.4) * ppt * 1.2;
    return ppt * 0.36;
  }
  function pick(sx, sy) {
    if (!view) return { t: "none" };
    // 지금 확대에서 한 칸이 몇 px 인가(가운데 기준)
    const c = scene.camCenter();
    const a0 = scene.project(c.x, c.y, 0), a1 = scene.project(c.x + 1, c.y, 0);
    const ppt = Math.max(4, Math.hypot(a1.x - a0.x, a1.y - a0.y));
    let best = null, bs = Infinity;
    const tryUnit = (o, x, y, top, half, mine) => {
      const f = scene.project(x, y, 0.05), hd = scene.project(x, y, top);
      const d = segDist(sx, sy, f.x, f.y, hd.x, hd.y);
      const r = mine ? Math.max(20, half + 10) : Math.max(14, half + 4); // 내 것은 넉넉하게(최소 20px)
      if (d > r) return;
      const score = d / r - (mine ? 0.3 : 0); // 겹치면 내 유닛을 먼저
      if (score < bs) { bs = score; best = o; }
    };
    for (const u of view.units) {
      if (u.id === me()?.heroId) continue;
      const mine = u.owner === world.you && MINE.has(u.type);
      tryUnit(u, u.x, u.y, unitTop(u), unitHalf(u, ppt), mine);
    }
    // 내 영웅(내 브라우저의 몸) — 눌러서 고른다(U20). 겹치면 곁의 다른 유닛 · 적을 먼저(오른쪽 클릭 공격이 영웅에게 뺏기지 않게)
    if (heroAlive()) {
      const b = hero.body;
      const f = scene.project(b.x, b.y, 0.05 + b.z), hd = scene.project(b.x, b.y, 2.2 + b.z);
      const d = segDist(sx, sy, f.x, f.y, hd.x, hd.y), r = Math.max(18, ppt * 0.4 + 8);
      if (d <= r && d / r + 0.15 < bs) { bs = d / r + 0.15; best = "hero"; }
    }
    if (best === "hero") return { t: "hero", x: hero.body.x, y: hero.body.y };
    if (best) return { t: "unit", o: best };
    // 건물: 화면에 그려진 몸통 상자(앞쪽 = 화면 아래쪽 것이 위에 그려지므로 먼저)
    let bb = null, bFront = -Infinity;
    for (const b of view.buildings) {
      const s = BUILDINGS[b.kind].size;
      const pl = scene.project(b.tx, b.ty + s / 2, 0), pr = scene.project(b.tx + s, b.ty + s / 2, 0);
      const pf = scene.project(b.tx + s / 2, b.ty + s, 0), pt = scene.project(b.tx + s / 2, b.ty + s / 2, BLD_TOP[b.kind] || 4);
      const inset = (pr.x - pl.x) * 0.08;
      if (sx < pl.x + inset || sx > pr.x - inset || sy > pf.y || sy < pt.y) continue;
      if (b.ty + s > bFront) { bFront = b.ty + s; bb = b; }
    }
    if (bb) { const s = BUILDINGS[bb.kind].size; return { t: "building", o: bb, x: bb.tx + s / 2, y: bb.ty + s / 2 }; }
    const k = ZOOM.def / scene.viewTiles;
    const g = scene.screenToGround(sx, sy, 0);
    for (const gm of view.gems) {
      if (gm.state !== 0) continue;
      const p = scene.project(gm.x, gm.y, 0.9);
      if (Math.hypot(p.x - sx, p.y - sy) < 22 * k) return { t: "gem", o: gm, x: gm.x, y: gm.y };
    }
    // 캐는 곳(연못 · 금광 · 코어 금광) — 모델이 서 있어 조금 위 평면에서도 본다
    for (const h of [0, 1]) {
      const q = h ? scene.screenToGround(sx, sy, 1.2) : g;
      for (const [res, list, size] of [["ink", world.map.ponds, POND.SIZE], ["gold", world.map.mines || [], MINE_K.SIZE], ["core", world.map.cores || [], CORE_MINE.SIZE]]) {
        for (let i = 0; i < list.length; i++) {
          const pd = list[i];
          if (q.x >= pd.tx - 0.3 && q.x <= pd.tx + size + 0.3 && q.y >= pd.ty - 0.3 && q.y <= pd.ty + size + 0.3) return { t: "res", res, i, o: pd, x: pd.tx + size / 2, y: pd.ty + size / 2 };
        }
      }
    }
    // 보석 섹션(바닥 판 · 바위 — 판 반지름 안)
    for (const st of world.map.sites) {
      if (Math.hypot(g.x - st.x, g.y - st.y) <= GEM.PAD_R) return { t: "site", o: st, id: st.id, x: st.x, y: st.y };
    }
    return { t: "ground", x: g.x, y: g.y };
  }

  /** 설명 카드를 띄울 것: 캐는 곳(못 지나가는 칸 — 던지지 않는다) · 보석 섹션 · 적 건물(둘은 치는 과녁이라 던지기도 한다) */
  function infoOf(p) {
    if (p.t === "res") return { t: "res", res: p.res, i: p.i };
    if (p.t === "site") return { t: "site", id: p.id };
    if (p.t === "building" && p.o.team !== world.team) return { t: "bld", id: p.o.id };
    return null;
  }
  /** 누른 것이 지금 카드의 것이 아니면 카드를 닫는다(누르기는 그대로 제 할 일을 한다) */
  function infoTouch(p) {
    const inf = infoOf(p);
    if (inf) hud.openInfo(inf);
    else hud.closeInfo();
    return inf;
  }

  // ── 화면 옮기기 ──
  const deadNow = () => !!me() && me().dead > 0;
  function panStart(sx, sy, how) {
    const c = scene.camCenter();
    cam.x = c.x; cam.y = c.y;
    cam.mode = "pan";
    cam.how = how; // "mid" | "space" | "touch"
    cam.drag = { anchor: scene.screenToGround(sx, sy, 0), x: sx, y: sy };
    peek = null;
  }
  function panEnd() {
    if (cam.mode !== "pan") return;
    cam.drag = null;
    // 놓으면 그 자리에 머문다(U13 고침) — WASD · C · 내 영웅으로 · 부활 때만 영웅에게
    cam.mode = "free";
  }
  function camHome(snap = false) {
    if (freeCamOnly()) { lookBase(); return; } // 따라갈 영웅이 없다 → 우리 탑(본진)으로
    cam.mode = "hero";
    cam.drag = null;
    if (snap) snapHero = true;
  }
  /** 알림을 눌렀다: 그곳을 잠깐 보고 돌아온다 */
  /** 그곳으로 부드럽게 옮겨 머문다(1 = 본진 보기 · 미니맵 누르기) */
  function lookStay(x, y) {
    if (!world) return;
    cam.x = Math.max(0, Math.min(world.S, x)); cam.y = Math.max(0, Math.min(world.S, y));
    cam.mode = "free";
    cam.drag = null;
    peek = null;
  }
  function lookBase() {
    const b = world && view?.buildings.find((q) => q.team === world.team && q.kind === BLD.TOWER);
    const base = world?.map.bases[world.team];
    if (b) lookStay(b.tx + BUILDINGS[b.kind].size / 2, b.ty + BUILDINGS[b.kind].size / 2);
    else if (base) lookStay(base.cx, base.cy);
  }
  function lookAlert(x, y) {
    if (!world) return;
    cam.x = x; cam.y = y;
    cam.mode = "look";
    cam.drag = null;
    cam.until = performance.now() + LOOK_HOLD;
    peek = null;
    ring(x, y, 0xffe600, { r0: 0.6, r1: 3, life: 0.9 });
  }

  // ── 명령 ──
  function ring(x, y, hex, o = {}) { ui.rings.push({ x, y, hex, ...o }); }
  function idsOf(list) { return list.map((u) => u.id); }
  function squadIds() { return idsOf(myUnits().filter((u) => u.type === UTYPE.BOT || u.type === UTYPE.PET)); }
  function nearHero(x, y) {
    if (!heroAlive()) return false;
    return Math.hypot(x - hero.body.x, y - hero.body.y) <= SQUAD.ORDER_RIGHT_R;
  }
  function follow(ids) {
    if (!ids.length) { hud.note("따라올 봇 · 몬스터가 없어요", "warn"); return; }
    net.send({ t: "cmd", o: "follow", ids });
    followShow = performance.now() + 1400;
    ring(hero.body.x, hero.body.y, 0x39ff88, { r0: 0.4, r1: SQUAD.ORDER_RIGHT_R * 2, life: 0.6 });
    hud.toast(`${ids.length}마리가 따라와요`);
  }
  /** 오른쪽 클릭 · 지휘 모드 누르기 */
  // ── 공격 과녁 고르기(명령 판의 공격 단추 · X) ──
  const attackable = (p) => (p.t === "unit" && p.o.team !== world.team) || (p.t === "building" && p.o.team !== world.team);
  function startAttackTarget() {
    if (!inGame() || world.spectator) return;
    if (!selMine().length && !heroSelected()) { hud.toast("먼저 내 유닛을 골라요"); return; }
    placing = false; ui.place = null;
    targeting = true; // 안내는 HUD 가 화면 위쪽에 늘 띄운다(tgthint)
  }
  function cancelTarget(msg) {
    if (!targeting) return false;
    targeting = false;
    if (msg) hud.toast(msg);
    return true;
  }
  /** 과녁 고르기 중 누른 곳: 적 유닛 · 중립 몬스터 · 적 건물이면 고른 것 모두 공격, 아니면 그만둔다 */
  function targetAt(sx, sy) {
    targeting = false;
    const p = pick(sx, sy);
    if (!attackable(p)) { hud.toast("적 · 몬스터 · 적 건물을 눌러요"); return; }
    const sel = selMine();
    const tx = p.t === "building" ? p.x : p.o.x, ty = p.t === "building" ? p.y : p.o.y;
    if (sel.length) net.send({ t: "cmd", o: "attack", ids: idsOf(sel), target: p.o.id, x: +tx.toFixed(2), y: +ty.toFixed(2) });
    if (heroSelected()) heroGo(p, tx, ty); // 영웅은 사거리 안까지 걸어간다(던지기는 학생이)
    ring(tx, ty, 0xffffff, { r0: 1.6, r1: 0.4, life: 0.6 });
    hud.toast(`${sel.length ? `${sel.length}마리가 ` : ""}공격하러 가요`);
  }

  /** 내 영웅을 그곳으로 걷게 한다(U20): 적 = 사거리 안까지 · 막힌 칸(광산 · 연못 · 건물) = 바로 옆 칸 · 그 밖 = 그 자리 */
  function heroGo(p, gx, gy) {
    if (!heroAlive() || quizOpen()) return;
    const range = throwRange(world.research()) * 0.85;
    let o;
    if (p.t === "unit" && p.o.team !== world.team) o = { x: p.o.x, y: p.o.y, unitId: p.o.id, range };
    else if (p.t === "building") {
      const size = BUILDINGS[p.o.kind].size;
      o = { rect: { tx: p.o.tx, ty: p.o.ty, size }, range: p.o.team !== world.team ? range : 0 };
    } else if (p.t === "res") o = { rect: { tx: p.o.tx, ty: p.o.ty, size: p.res === "gold" ? MINE_K.SIZE : p.res === "core" ? CORE_MINE.SIZE : POND.SIZE } };
    else o = { x: gx, y: gy };
    hero.walkTo(o);
  }
  function command(p, o = {}) {
    if (!inGame() || world.spectator) return;
    const gx = p.x ?? p.o?.x, gy = p.y ?? p.o?.y;
    if (gx == null) return;
    const sel = selMine();
    const heroSel = heroSelected();
    // 영웅 옆 오른쪽 클릭 = 따라와(다른 유닛을 골랐거나 아무것도 안 골랐을 때 — 영웅만 골랐으면 걷기)
    if (p.t !== "unit" && nearHero(gx, gy) && (sel.length || !heroSel)) {
      const s = sel.filter((u) => u.type !== UTYPE.WORKER);
      follow(s.length ? idsOf(s) : squadIds());
      return;
    }
    // 영웅도 걷는다(U20): 아무것도 안 골랐거나(터치 지휘 모드는 영웅을 골랐을 때만) 고른 것에 영웅이 있으면
    if (heroSel || (!sel.length && !o.touch)) heroGo(p, gx, gy);
    if (!sel.length) {
      if (heroSel || (!o.touch && heroAlive())) ring(gx, gy, 0x39ff88, { r0: 1, r1: 0.2, life: 0.7 });
      else hud.toast("먼저 내 유닛을 골라요");
      return;
    }
    const workers = sel.filter((u) => u.type === UTYPE.WORKER);
    const fighters = sel.filter((u) => u.type !== UTYPE.WORKER);
    const bots = sel.filter((u) => u.type === UTYPE.BOT);
    const used = new Set();
    const send = (o, list, extra) => {
      if (!list.length) return;
      net.send({ t: "cmd", o, ids: idsOf(list), ...extra });
      for (const u of list) used.add(u.id);
    };
    let hex = 0x39ff88;
    // 적 · 중립 몬스터 · 적 건물: 고른 것 모두(일꾼도 — 아주 약하게 친다, U22)
    if (p.t === "unit" && p.o.team !== world.team) {
      send("attack", sel, { target: p.o.id, x: p.o.x, y: p.o.y });
      hex = 0xffffff; // 공격: 흰 고리(팀 레드와 헷갈리지 않게)
    } else if (p.t === "building" && p.o.team !== world.team) {
      send("attack", sel, { target: p.o.id, x: p.x, y: p.y });
      hex = 0xffffff; // 공격: 흰 고리(팀 레드와 헷갈리지 않게)
    } else if (p.t === "building" && p.o.team === world.team && (p.o.flags & BF.BROKEN || p.o.hp < 0.999 || !(p.o.flags & BF.BUILT))) {
      send("repair", workers, { target: p.o.id, x: p.x, y: p.y });
      hex = 0xffd23f;
    } else if (p.t === "res") {
      if (!workers.length && !fighters.length) return;
      send("gather", workers, { target: { res: p.res, i: p.i }, x: p.x, y: p.y });
      if (workers.length) hud.toast(`일꾼 ${workers.length}명이 ${RES_NAME[p.res]}를 캐러 가요`);
      hex = RES_HEX[p.res];
    } else if (p.t === "gem") {
      send("grab", bots, { target: p.o.id, x: p.x, y: p.y });
      hex = 0xffe600;
    }
    const rest = sel.filter((u) => !used.has(u.id));
    if (rest.length) {
      const tx = p.t === "building" ? p.x : gx, ty = p.t === "building" ? p.o.ty + BUILDINGS[p.o.kind].size + 0.8 : gy;
      net.send({ t: "cmd", o: "move", ids: idsOf(rest), x: +tx.toFixed(2), y: +ty.toFixed(2) });
    }
    ring(gx, gy, hex);
  }
  function toggleFollowAll() {
    const sq = myUnits().filter((u) => u.type === UTYPE.BOT || u.type === UTYPE.PET);
    if (!sq.length) { hud.note("따라올 봇 · 몬스터가 없어요", "warn"); return; }
    const following = sq.some((u) => u.flags & UF.SQUAD);
    if (following) {
      net.send({ t: "cmd", o: "hold", ids: idsOf(sq) });
      hud.toast("제자리를 지켜요");
    } else follow(idsOf(sq));
  }

  // ── 고르기 ──
  function selectOnly(ids, add = false) {
    if (!add) ui.selected.clear();
    for (const id of ids) ui.selected.add(id);
    selChanged();
  }
  /** 내 유닛을 골랐다: 건물 판이 열려 있으면 닫는다 — 아래 가운데 명령 판(일꾼 · 봇 · 몬스터)이 곧바로 보이게 */
  function selChanged() {
    if (view && selMine().length && hud.panelOpen) hud.closePanel();
  }
  const heroId = () => me()?.heroId ?? -1;
  const heroSelected = () => heroAlive() && ui.selected.has(heroId());
  function boxSelect(x0, y0, x1, y1, add) {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    const picked = [];
    if (heroAlive()) {
      const p = scene.project(hero.body.x, hero.body.y, 0.6);
      if (p.x >= ax - 6 && p.x <= bx + 6 && p.y >= ay - 6 && p.y <= by + 6) picked.push(heroId());
    }
    for (const u of myUnits()) {
      const p = scene.project(u.x, u.y, 0.6);
      if (p.x >= ax - 6 && p.x <= bx + 6 && p.y >= ay - 6 && p.y <= by + 6) picked.push(u.id);
    }
    if (!picked.length) { if (!add) ui.selected.clear(); return; }
    selectOnly(picked, add);
  }
  function clickUnit(u, add) {
    if (add && ui.selected.has(u.id)) ui.selected.delete(u.id);
    else selectOnly([u.id], add);
  }
  function selectWorkers() {
    const ws = myUnits().filter((u) => u.type === UTYPE.WORKER);
    if (!ws.length) { hud.toast("일꾼이 없어요 · 탑에서 뽑아요"); return; }
    selectOnly(idsOf(ws));
  }

  // ── 공급소 짓기 ──
  function canPlaceSupply(tx, ty) {
    const s = BUILDINGS[BLD.SUPPLY].size;
    if (!rectOnFloor(world.map, tx, ty, s)) return false;
    for (const b of view.buildings) {
      const bs = BUILDINGS[b.kind].size;
      if (tx < b.tx + bs + 1 && tx + s + 1 > b.tx && ty < b.ty + bs + 1 && ty + s + 1 > b.ty) return false;
    }
    for (const st of world.map.sites) if (Math.hypot(tx + s / 2 - st.x, ty + s / 2 - st.y) < GEM.PAD_R + 1.6) return false;
    return true;
  }
  // U18: 공급소는 일꾼 바로 옆에만 — 고른 일꾼(없으면 내 일꾼 모두) 가운데 누군가와 자리(3×3)의 가장자리 거리가 BUILD_NEAR 안(서버와 같은 셈)
  const NEAR_R = BUILD_NEAR + UNITS.worker.radius;
  const rectDist = (x, y, tx, ty, w) => Math.hypot(Math.max(tx - x, 0, x - (tx + w)), Math.max(ty - y, 0, y - (ty + w)));
  function placeWorkers() {
    const sel = selMine().filter((u) => u.type === UTYPE.WORKER);
    return sel.length ? sel : myUnits().filter((u) => u.type === UTYPE.WORKER);
  }
  function nearWorker(tx, ty, ws) {
    const s = BUILDINGS[BLD.SUPPLY].size;
    for (const w of ws) if (rectDist(w.x, w.y, tx, ty, s) <= NEAR_R) return true;
    return false;
  }
  /** 커서 밑 자리 → { tx, ty, ok, why: "" | "far" | "blocked", zones: 허락된 일꾼들 }. 일꾼 곁 빈 자리가 3칸 안이면 그리로 끌어당긴다 */
  function placeAt(sx, sy) {
    const g = scene.screenToGround(sx, sy, 0);
    const s = BUILDINGS[BLD.SUPPLY].size;
    const tx0 = Math.round(g.x - s / 2), ty0 = Math.round(g.y - s / 2);
    const ws = placeWorkers();
    const free = canPlaceSupply(tx0, ty0), near = nearWorker(tx0, ty0, ws);
    if (free && near) return { tx: tx0, ty: ty0, ok: true, why: "", zones: ws };
    let best = null, bd = 10;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const d = dx * dx + dy * dy;
        if (d >= bd || !nearWorker(tx0 + dx, ty0 + dy, ws) || !canPlaceSupply(tx0 + dx, ty0 + dy)) continue;
        bd = d; best = { tx: tx0 + dx, ty: ty0 + dy };
      }
    if (best) return { tx: best.tx, ty: best.ty, ok: true, why: "", zones: ws, snapped: true };
    return { tx: tx0, ty: ty0, ok: false, why: near ? "blocked" : "far", zones: ws };
  }
  const PLACE_WHY = { far: "일꾼 바로 옆에만 지어요", blocked: "여기는 못 지어요" };
  function startPlacing() {
    if (!myUnits().some((u) => u.type === UTYPE.WORKER)) { hud.toast("일꾼이 없어요 · 탑에서 뽑아요"); return; }
    const def = BUILDINGS[BLD.SUPPLY];
    const n = view.buildings.filter((b) => b.team === world.team && b.kind === BLD.SUPPLY).length;
    if (n >= def.max) { hud.note(`공급소는 팀에 최대 ${def.max}곳`, "warn"); return; }
    const wal = world.wallet(); // 내 지갑으로 낸다(U31)
    if (!canAfford(wal, def.build)) { hud.note(`골드 부족(${Math.floor(wal.gold)}/${def.build.gold})`, "warn"); return; }
    placing = true;
    hud.toast("일꾼 바로 옆을 눌러요 · Esc 취소");
  }
  function tryPlace(sx, sy) {
    const p = placeAt(sx, sy);
    if (!p.ok) { hud.toast(PLACE_WHY[p.why] || PLACE_WHY.blocked); return false; } // 빨간 자리는 보내지 않는다
    const ws = selMine().filter((u) => u.type === UTYPE.WORKER);
    net.send({ t: "place", kind: "supply", tx: p.tx, ty: p.ty, ids: idsOf(ws) });
    ring(p.tx + 1.5, p.ty + 1.5, 0x39ff88, { r0: 3, r1: 1, life: 0.5 });
    placing = false;
    ui.place = null;
    return true;
  }

  // ── 무기 ──
  function weaponSlot(i) {
    if (!heroAlive() && heroOutNow()) return;
    const list = world.slots();
    if (i < 0 || i >= list.length) return;
    if (hero.setWeapon(list[i])) hud.flashWeapon();
  }
  function cycleWeapon(d) {
    if (!heroAlive() && heroOutNow()) return;
    const list = world.slots();
    const k = list.indexOf(hero.st.w);
    const n = list[(k + d + list.length) % list.length];
    if (hero.setWeapon(n)) hud.flashWeapon();
  }

  // ── 던지기 ──
  function doPress() {
    const arc = hero.press();
    if (arc && !arc.direct) scene.predictArc(arc, world.team);
    if (hero.st.why) hud.cantThrow(hero.st.why);
  }
  function doRelease() {
    const arc = hero.release();
    if (arc && !arc.direct) scene.predictArc(arc, world.team);
    else if (!arc && hero.st.why) hud.cantThrow(hero.st.why);
  }

  // ── 마우스 ──
  function onPointerDown(e) {
    if (!inGame()) return;
    if (e.pointerType === "touch" || e.pointerType === "pen") { onTouchDown(e); return; }
    viaTouch = false;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true;
    if (e.button === 1) {
      e.preventDefault(); // 브라우저 자동 스크롤을 막는다
      canvas.setPointerCapture?.(e.pointerId);
      panStart(e.clientX, e.clientY, "mid");
      return;
    }
    if (e.button === 2) {
      if (cancelTarget("공격을 그만뒀어요")) return;
      if (placing) { placing = false; ui.place = null; return; }
      command(pick(e.clientX, e.clientY));
      return;
    }
    if (e.button !== 0) return;
    canvas.setPointerCapture?.(e.pointerId);
    if (targeting) { targetAt(e.clientX, e.clientY); return; } // 공격 과녁 — 던지지 않는다
    if (placing) { tryPlace(e.clientX, e.clientY); return; }
    const p = pick(e.clientX, e.clientY);
    press = { x0: e.clientX, y0: e.clientY, t0: performance.now(), shift: e.shiftKey, pick: p, mode: "charge" };
    const inf = infoTouch(p);
    if (p.t === "unit" && p.o.owner === world.you && MINE.has(p.o.type)) press.mode = "unit";
    else if (p.t === "hero") press.mode = "hero";
    else if (p.t === "building" && p.o.team === world.team) press.mode = "building";
    else if (inf && inf.t === "res") press.mode = "info"; // 금광 · 연못 · 코어 금광: 카드만(못 지나가는 칸이라 던지지 않는다)
    else if (e.shiftKey || world.spectator || heroOutNow()) press.mode = "pending"; // 영웅이 없으면 왼쪽 누르기 = 고르기(던지지 않는다)
    else doPress();
  }
  function onPointerMove(e) {
    if (e.pointerType === "touch" || e.pointerType === "pen") { onTouchMove(e); return; }
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.inside = true;
    if (cam.drag) { cam.drag.x = e.clientX; cam.drag.y = e.clientY; }
    if (cam.mode === "pan" && cam.how === "mid" && !(e.buttons & 4)) panEnd(); // 휠 버튼을 창 밖에서 뗐다
    if (press && !(e.buttons & 1)) { onPointerUp(e); return; }
    if (!press) return;
    if (press.mode === "pan") return;
    const d = Math.hypot(e.clientX - press.x0, e.clientY - press.y0);
    const charged = press.mode === "charge" && performance.now() - press.t0 > CHARGE_HOLD;
    const spaceHeld = keys.has("Space");
    // 충전하다 끌면 던질 곳만 따라 옮긴다(묶어 고르기로 바꾸지 않는다 — 사용자 요청). 누르자마자 끌면 고르기
    if (press.mode !== "box" && d > DRAG && (spaceHeld || !charged)) {
      if (press.mode === "charge") hero.cancel();
      if (spaceHeld) {
        // Space + 끌기 = 화면 옮기기(눌렀던 자리의 땅을 잡는다)
        press.mode = "pan";
        boxEl.hidden = true;
        panStart(press.x0, press.y0, "space");
        cam.drag.x = e.clientX; cam.drag.y = e.clientY;
        return;
      }
      press.mode = "box";
    }
    if (press.mode === "box") {
      boxEl.hidden = false;
      Object.assign(boxEl.style, { left: `${Math.min(press.x0, e.clientX)}px`, top: `${Math.min(press.y0, e.clientY)}px`, width: `${Math.abs(e.clientX - press.x0)}px`, height: `${Math.abs(e.clientY - press.y0)}px` });
    }
  }
  function onPointerUp(e) {
    if (e.pointerType === "touch" || e.pointerType === "pen") { onTouchUp(e); return; }
    if (e.button === 1 && cam.mode === "pan" && cam.how === "mid") { panEnd(); return; }
    if (!press) return;
    const p = press;
    press = null;
    boxEl.hidden = true;
    if (!inGame()) return;
    if (p.mode === "pan") { panEnd(); return; }
    if (p.mode === "charge") doRelease();
    else if (p.mode === "box") boxSelect(p.x0, p.y0, e.clientX, e.clientY, p.shift);
    else if (p.mode === "unit") clickUnit(p.pick.o, p.shift);
    else if (p.mode === "hero") clickUnit({ id: heroId() }, p.shift);
    else if (p.mode === "building") { ui.selected.clear(); ui.selected.add(p.pick.o.id); hud.openPanel(p.pick.o.kind, p.pick.o.id); }
    else if (p.mode === "pending" && !p.shift) ui.selected.clear();
  }

  // ── 터치(캔버스) ──
  function onTouchDown(e) {
    viaTouch = true;
    if (tpress) return;
    const p = pick(e.clientX, e.clientY);
    tpress = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), pick: p, mode: "charge" };
    canvas.setPointerCapture?.(e.pointerId);
    if (targeting) { tpress.mode = "target"; return; } // 공격 과녁 — 뗄 때 고른다
    if (placing) { tpress.mode = "place"; ui.place = placeAt(e.clientX, e.clientY); return; }
    if (touch.state.command || world.spectator || heroOutNow()) { tpress.mode = "cmd"; return; } // 영웅이 없으면 늘 지휘
    // 지휘를 켜지 않아도 내 유닛을 누르면 고른다(명령 판이 뜬다) — 던지지 않는다
    if (p.t === "unit" && p.o.owner === world.you && MINE.has(p.o.type)) { tpress.mode = "unit"; return; }
    const inf = infoTouch(p);
    if (inf && inf.t === "res") { tpress.mode = "info"; return; } // 캐는 곳: 카드만
    setAimFromScreen(e.clientX, e.clientY);
    doPress();
  }
  function onTouchMove(e) {
    if (!tpress || e.pointerId !== tpress.id) return;
    tpress.x = e.clientX; tpress.y = e.clientY;
    if (tpress.mode === "charge") setAimFromScreen(e.clientX, e.clientY);
    else if (tpress.mode === "place") ui.place = placeAt(e.clientX, e.clientY);
    else if (tpress.mode === "tpan") { if (cam.drag) { cam.drag.x = e.clientX; cam.drag.y = e.clientY; } }
    else if (tpress.mode === "cmd" || tpress.mode === "box") {
      if (tpress.mode === "cmd" && Math.hypot(e.clientX - tpress.x0, e.clientY - tpress.y0) > 18) {
        const onMine = tpress.pick.t === "unit" && tpress.pick.o.owner === world.you && MINE.has(tpress.pick.o.type);
        if (onMine) tpress.mode = "box";
        else {
          tpress.mode = "tpan";
          panStart(tpress.x0, tpress.y0, "touch");
          cam.drag.x = e.clientX; cam.drag.y = e.clientY;
          return;
        }
      }
      if (tpress.mode === "box") {
        boxEl.hidden = false;
        Object.assign(boxEl.style, { left: `${Math.min(tpress.x0, e.clientX)}px`, top: `${Math.min(tpress.y0, e.clientY)}px`, width: `${Math.abs(e.clientX - tpress.x0)}px`, height: `${Math.abs(e.clientY - tpress.y0)}px` });
      }
    }
  }
  function onTouchUp(e) {
    if (!tpress || e.pointerId !== tpress.id) return;
    const p = tpress;
    tpress = null;
    boxEl.hidden = true;
    if (!inGame()) return;
    if (p.mode === "charge") { setAimFromScreen(p.x, p.y); doRelease(); return; }
    if (p.mode === "target") { targetAt(p.x, p.y); return; }
    if (p.mode === "unit") { clickUnit(p.pick.o, false); return; }
    if (p.mode === "place") { tryPlace(p.x, p.y); return; }
    if (p.mode === "tpan") { panEnd(); return; }
    if (p.mode === "box") { boxSelect(p.x0, p.y0, p.x, p.y, true); return; }
    // 지휘 모드의 누르기: 내 유닛 = 고르기(더하기) · 내 건물 = 판 · 그 밖 = 명령
    const q = p.pick;
    if (p.mode === "info") return;
    if (q.t === "res" && !selMine().some((u) => u.type === UTYPE.WORKER)) { hud.openInfo(infoOf(q)); return; }
    if (q.t !== "res") infoTouch(q);
    if (q.t === "hero") { clickUnit({ id: heroId() }, true); return; }
    if (q.t === "unit" && q.o.owner === world.you && MINE.has(q.o.type)) clickUnit(q.o, true);
    else if (q.t === "building" && q.o.team === world.team && !selMine().some((u) => u.type === UTYPE.WORKER && (q.o.flags & BF.BROKEN || q.o.hp < 0.999))) hud.openPanel(q.o.kind, q.o.id);
    else command(q, { touch: true });
  }
  function setAimFromScreen(x, y) {
    const g = scene.screenToGround(x, y, 0);
    mouse.ground = g;
  }

  function onWheel(e) {
    if (!inGame()) return;
    e.preventDefault(); // 쪽이 굴러가지 않게(그냥 휠은 아무것도 안 한다)
    if (!keys.has("Space")) return;
    // Space + 휠 = 확대 · 축소
    scene.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
  }

  // ── 키보드 ──
  function onKey(e, down) {
    if (e.target.closest?.("input, textarea, select")) return;
    if (!down) {
      keys.delete(e.code);
      if (e.code === "Space" && cam.mode === "pan" && cam.how === "space") { panEnd(); if (press?.mode === "pan") press = null; }
      return;
    }
    if (!inGame()) return;
    const c = e.code;
    if (quizOpen() && /^Digit[1-4]$|^Numpad[1-4]$/.test(c)) { e.preventDefault(); hud.answer(+c.slice(-1) - 1); return; }
    if (c === "Escape") {
      if (cancelTarget("공격을 그만뒀어요")) return;
      if (placing) { placing = false; ui.place = null; }
      else if (hud.infoOpen) hud.closeInfo();
      else if (hud.panelOpen) hud.closePanel();
      else if (!hud.closeHelp()) ui.selected.clear();
      return;
    }
    if (c === "Tab") { e.preventDefault(); selectWorkers(); return; }
    if (e.repeat && (c === "Space" || DIRS[c])) { keys.add(c); return; }
    keys.add(c);
    if (world.spectator) return;
    if (DIRS[c] && heroOutNow()) { if (c.startsWith("Arrow")) e.preventDefault(); return; } // 지휘관: WASD = 화면 옮기기(update 가 한다)
    if (DIRS[c]) {
      if ((cam.mode === "look" || cam.mode === "free") && !deadNow()) camHome(); // 다시 영웅을 움직인다 → 화면도 영웅에게
      const now = performance.now() / 1000;
      const dir = DIRS[c].join(",");
      if (lastTap.dir === dir && now - lastTap.t <= DOUBLE_TAP) { hero.dash(DIRS[c][0], DIRS[c][1]); lastTap.dir = ""; }
      else lastTap = { dir, t: now };
      if (c.startsWith("Arrow")) e.preventDefault();
      return;
    }
    if (c === "Space") { e.preventDefault(); return; } // Space 는 화면 옮기기 · 확대 축소에만 쓴다(점프는 뺐다 — 사용자 요청)
    if (c === "KeyQ") { cycleWeapon(-1); return; }
    if (c === "KeyE") { cycleWeapon(1); return; }
    if (c === "Digit1") { lookBase(); return; } // 1 = 본진(깃발의 탑) 보기 — 그 자리에 머문다
    if (c === "KeyC") { camHome(); return; } // C = 화면을 내 영웅에게
    if (/^Digit[0-9]$/.test(c)) { const n = +c.slice(5); weaponSlot(n === 0 ? 9 : n - 1); return; }
    if (c === "KeyF") { toggleFollowAll(); return; }
    if (c === "KeyB") { startPlacing(); return; }
    if (c === "KeyX") { startAttackTarget(); return; } // X = 공격(A 는 WASD 왼쪽이라 쓰지 않는다)
    if (c === "KeyR") { arrowUntil = performance.now() + 5000; return; }
    if (c === "KeyH" || c === "Slash") { hud.toggleHelp(); return; }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerleave", () => { mouse.inside = false; });
  window.addEventListener("contextmenu", (e) => { if (world && !e.target.closest?.("input, textarea")) e.preventDefault(); });
  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));
  window.addEventListener("blur", () => { keys.clear(); if (press?.mode === "charge") hero?.cancel(); press = null; boxEl.hidden = true; panEnd(); });
  // 휠 버튼 누름의 기본 동작(자동 스크롤 · 붙여넣기)을 막는다
  canvas.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
  canvas.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });

  // ── 매 프레임 ──
  function moveInput() {
    if (touch.state.active && (touch.state.mx || touch.state.my)) return { mx: touch.state.mx, my: touch.state.my };
    let x = 0, y = 0;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
    if (keys.has("KeyW") || keys.has("ArrowUp")) y -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) y += 1;
    const l = Math.hypot(x, y);
    return l > 0 ? { mx: x / l, my: y / l } : { mx: 0, my: 0 };
  }

  /** 미사일 조준선을 처음 막히는 칸까지 자른다 */
  function cutLine(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const S = world.S;
    for (let s = 0.4; s < d; s += 0.25) {
      const x = x0 + ((x1 - x0) * s) / d, y = y0 + ((y1 - y0) * s) / d;
      const tx = Math.floor(x), ty = Math.floor(y);
      if (tx < 0 || ty < 0 || tx >= S || ty >= S) return { x, y };
      const t = world.map.tiles[ty * S + tx];
      if (isSolidTile(t) || (world.blk[ty * S + tx] && t !== TILE.WATER && t !== TILE.POND)) return { x, y };
    }
    return { x: x1, y: y1 };
  }

  function update(dt) {
    if (!world) return;
    frame++;
    view = world.sample();
    if (!view) return;
    const m = me();
    // 겨누기: 마우스(데스크톱) · 누른 손가락(터치)
    if (!viaTouch && mouse.inside) mouse.ground = scene.screenToGround(mouse.x, mouse.y, 0);
    const frozen = quizOpen() || hud.quizShown || (m && m.dead > 0);
    if (hero) {
      const mv = moveInput();
      hero.update(dt, { ...mv, aimX: mouse.ground?.x, aimY: mouse.ground?.y }, frozen);
      if (frozen && hero.st.charging) hero.cancel();
    }
    // 화면
    const dead = deadNow();
    if (freeCamOnly()) {
      // 영웅이 없다(지휘관 · 구경): 늘 자유 시점 — WASD · 화살표 · 이동 판으로 화면을 옮긴다
      if (cam.mode === "hero") { const c = scene.camCenter(); cam.x = c.x; cam.y = c.y; cam.mode = "free"; }
      const mv = moveInput();
      if ((mv.mx || mv.my) && cam.mode !== "pan") {
        if (cam.mode === "look") cam.mode = "free";
        const sp = Math.max(10, scene.viewTiles * 0.8);
        cam.x = Math.max(0, Math.min(world.S, cam.x + mv.mx * dt * sp));
        cam.y = Math.max(0, Math.min(world.S, cam.y + mv.my * dt * sp));
        peek = null;
      }
      wasDead = dead;
    } else if (wasDead && !dead) camHome(true); // 부활: 영웅에게 곧바로
    else if (!dead && cam.mode === "free" && touch.state.active && (touch.state.mx || touch.state.my)) camHome(); // 이동 판을 쓰면 영웅에게
    else if (!wasDead && dead && cam.mode === "hero") { const c = scene.camCenter(); cam.x = c.x; cam.y = c.y; cam.mode = "free"; } // 쓰러짐: 그 자리에 머문 채 자유 화면
    wasDead = dead;
    if (cam.mode === "look" && performance.now() > cam.until) { if (dead) cam.mode = "free"; else camHome(); }
    if (cam.mode === "pan" && cam.drag) {
      // 잡은 땅(anchor)이 커서 밑에 오도록: 지금 카메라 중심 + (잡은 땅 − 지금 커서 밑 땅). 경기장 끝은 카메라가 막는다
      const g = scene.screenToGround(cam.drag.x, cam.drag.y, 0);
      const c = scene.camCenter();
      cam.x = Math.max(0, Math.min(world.S, c.x + cam.drag.anchor.x - g.x));
      cam.y = Math.max(0, Math.min(world.S, c.y + cam.drag.anchor.y - g.y));
      scene.lookAt(cam.x, cam.y);
      scene.snap();
    } else if (peek) scene.lookAt(peek.x, peek.y);
    else if (cam.mode === "look" || cam.mode === "free") scene.lookAt(cam.x, cam.y);
    else if (hero && hero.ready) {
      // 화면은 영웅 가운데에 고정한다 — 마우스 쪽으로 앞당기지 않는다(사용자 요청, U13 고침)
      // 건물 판이 아래를 덮으면 그 높이의 반만큼 화면을 내려(영웅이 판 위 빈 곳에 보이게)
      let dy = 0;
      const cover = hud.coverBottom();
      if (cover > 0) {
        const a = scene.project(hero.body.x, hero.body.y, 0), b = scene.project(hero.body.x, hero.body.y + 1, 0);
        const ppt = Math.max(4, b.y - a.y);
        dy = (cover * 0.5) / ppt;
      }
      scene.follow(hero.body.x, hero.body.y + dy);
      if (snapHero) { scene.snap(); snapHero = false; }
    } else if (world.spectator) {
      const mv = moveInput();
      const c = scene.cam;
      if (mv.mx || mv.my) scene.lookAt(c.x + mv.mx * dt * 14, c.y + mv.my * dt * 14);
    }
    // 가리키는 것
    if (!viaTouch && mouse.inside && frame % 3 === 0 && !press) {
      const p = pick(mouse.x, mouse.y);
      ui.hover = p.o && (p.t === "unit" || p.t === "building") ? p.o.id : 0;
      if (targeting) ui.hover = attackable(p) ? p.o.id : 0; // 공격 과녁: 칠 수 있는 것만 흰 고리
      ui.hoverRes = p.t === "res" && selMine().some((u) => u.type === UTYPE.WORKER) ? { res: p.res, i: p.i } : null;
      const mine = p.t === "unit" && p.o.owner === world.you && MINE.has(p.o.type);
      const myB = p.t === "building" && p.o.team === world.team;
      canvas.style.cursor = targeting ? (attackable(p) ? "crosshair" : "not-allowed") : placing ? "copy" : mine || myB ? "pointer" : "crosshair";
    }
    if (placing && !viaTouch && mouse.inside) ui.place = placeAt(mouse.x, mouse.y);
    else if (!placing) ui.place = null;
    // 조준 표시
    ui.aim = null;
    const aimOn = hero && heroAlive() && !frozen && world.phase === PHASE.PLAY && !placing && (!viaTouch || (tpress && tpress.mode === "charge"));
    if (aimOn && (!press || press.mode === "charge")) {
      const W = WEAPONS[hero.st.w];
      let t = hero.target();
      if (W.direct) t = cutLine(hero.body.x, hero.body.y, t.x, t.y);
      const toW = scene.toW;
      ui.aim = {
        brawl: {
          x: toW(hero.body.x), z: toW(hero.body.y), y0: hero.body.z, tx: toW(t.x), tz: toW(t.y), ty: 0,
          line: W.direct ? MISSILE.HEIGHT + hero.body.z : 0, charge: hero.chargeFrac(), color: world.team, canThrow: !hero.blockReason(),
          splashScale: W.splash || 1, lock: false,
        },
      };
    }
    // 진형 고리: 고른 유닛이 있고 마우스가 영웅 둘레(오른쪽 클릭 = 따라와)
    ui.followRing = false;
    if (heroAlive()) {
      const g = mouse.ground;
      const anySquad = selMine().some((u) => u.type !== UTYPE.WORKER) || (ui.selected.size === 0 && squadIds().length > 0);
      if (!viaTouch && g && anySquad && nearHero(g.x, g.y) && ui.hover === 0) ui.followRing = "hot";
      else if (performance.now() < followShow) ui.followRing = "hot";
      else if (myUnits().some((u) => u.flags & UF.SQUAD)) ui.followRing = "soft";
    }
    // 고른 것 정리(죽은 유닛)
    const hid = heroId();
    for (const id of [...ui.selected]) {
      if (id === hid) { if (!heroAlive()) ui.selected.delete(id); continue; } // 영웅: 쓰러지면 풀린다
      if (!view.byId.has(id) && !view.buildings.some((b) => b.id === id)) ui.selected.delete(id);
    }
    if (targeting && !selMine().length && !heroSelected()) targeting = false;
    // 내 영웅이 걷는 길(화면이 점선 · 끝 표시를 그린다)
    ui.walk = hero && hero.walking ? hero.walk : null;
    ui.heroSel = heroSelected();
    // 공급소 화살표: 잉크가 모자라거나 R 을 눌렀을 때
    let arrow = null;
    if (heroAlive()) {
      const low = hero.tank() < hero.weaponCost(false) || hero.tank() < 20;
      if (low || performance.now() < arrowUntil) {
        const sp = world.nearestSupply(hero.body.x, hero.body.y);
        if (sp) {
          const s = BUILDINGS[BLD.SUPPLY].size / 2;
          arrow = { x: sp.tx + s, y: sp.ty + s, low };
        }
      }
    }
    hud.update({
      world, view, hero, ui, frame, arrow, placing, touch: touch.state.active, command: touch.state.command,
      selected: selMine(), heroSel: ui.heroSel, targeting,
      camAway: !dead && !world.spectator && (cam.mode === "free" || cam.mode === "look" || (cam.mode === "pan" && cam.how === "touch")),
      heroOut: heroOutNow() && !world.spectator,
      dead,
    }, scene);
    if (touch.state.active) {
      const W = WEAPONS[hero?.st.w ?? 0];
      // 무기 단추: 이름 첫 낱말(기본 · 삼발 · 끈끈이 …) — 공간이 좁다
      touch.setWeapon(WSHORT[hero?.st.w ?? 0] || W.name, `#${(TEAM_COLORS[world.team] ?? 0xffffff).toString(16).padStart(6, "0")}`);
    }
  }

  return {
    ui,
    setWorld(w, h) {
      world = w;
      hero = h;
      view = null;
      ui.selected.clear();
      placing = false;
      press = tpress = null;
      peek = null;
      cam.mode = "hero"; cam.drag = null; wasDead = false; snapHero = false;
    },
    clear() { world = null; hero = null; view = null; placing = false; ui.selected.clear(); },
    update,
    get view() { return view; },
    get viaTouch() { return viaTouch; },
    get targeting() { return targeting; }, // [소리] 공격 과녁 고르기 중(src/audio/game.js)
    /** 렌더러에 넘길 내 영웅 모습 */
    heroFrame() {
      if (!hero || !world || world.spectator || me()?.heroOut) return null; // 영웅이 없다(지휘관 · 구경)
      const m = me();
      const b = hero.body;
      return {
        // 쓰러진 동안은 서버 스냅숏의 내 영웅(쓰러지는 모습)을 그린다 — local 은 살아 있을 때만
        id: m?.heroId ?? -1, local: hero.ready && m?.heroId != null && !(m.dead > 0), alive: hero.ready && !!m && !(m.dead > 0),
        x: b.x, y: b.y, z: b.z, facing: hero.st.facing, charging: hero.st.charging, charge: hero.chargeFrac(), dash: b.dashT > 0, slow: b.slow > 0, throwPose: hero.st.throwPose,
      };
    },
    // HUD · 터치에서 부르는 것
    selectUnits(ids) { selectOnly(ids); },
    selectWorkers,
    toggleFollowAll,
    followSelected() {
      const s = selMine().filter((u) => u.type !== UTYPE.WORKER);
      follow(s.length ? idsOf(s) : squadIds());
    },
    holdSelected() {
      const s = selMine();
      if (s.length) net.send({ t: "cmd", o: "hold", ids: idsOf(s) });
    },
    stopSelected() {
      const s = selMine();
      if (s.length) net.send({ t: "cmd", o: "stop", ids: idsOf(s) });
      if (heroSelected()) hero.stopWalk();
    },
    startPlacing,
    /** 고른 일꾼(없으면 내 일꾼 모두)을 그 자원의 가장 가까운 곳으로 */
    gatherSelected(res) {
      let ws = selMine().filter((u) => u.type === UTYPE.WORKER);
      if (!ws.length) ws = myUnits().filter((u) => u.type === UTYPE.WORKER);
      if (!ws.length) { hud.toast("일꾼이 없어요 · 탑에서 뽑아요"); return; }
      net.send({ t: "cmd", o: "gather", ids: idsOf(ws), target: { res } });
      hud.toast(`일꾼 ${ws.length}명이 ${RES_NAME[res]}를 캐러 가요`);
    },
    clearSelection() { ui.selected.clear(); },
    /** 화면 점에서 집히는 것(개발 · 시험) */
    pickAt: (x, y) => pick(x, y),
    /** 설명 카드의 "고른 일꾼 보내기": 고른 내 일꾼을 그 캐는 곳(res, i)으로 */
    gatherAt(res, i) {
      const ws = selMine().filter((u) => u.type === UTYPE.WORKER);
      if (!ws.length) { hud.toast("먼저 일꾼을 골라요"); return; }
      const list = res === "gold" ? world.map.mines : res === "core" ? world.map.cores : world.map.ponds;
      const n = list?.[i];
      const size = res === "gold" ? MINE_K.SIZE : res === "core" ? CORE_MINE.SIZE : POND.SIZE;
      net.send({ t: "cmd", o: "gather", ids: idsOf(ws), target: { res, i }, ...(n ? { x: n.tx + size / 2, y: n.ty + size / 2 } : {}) });
      if (n) ring(n.tx + size / 2, n.ty + size / 2, RES_HEX[res]);
      hud.toast(`일꾼 ${ws.length}명이 ${RES_NAME[res]}를 캐러 가요`);
    },
    lookAlert,
    startAttackTarget,
    /** 화면을 내 영웅에게(내 영웅으로 단추 · 지휘 모드 끄기) */
    cameraHome() { camHome(); },
    /** 화면이 영웅을 떠나 있나(HUD 가 "내 영웅으로" 단추를 보인다) — 쓰러진 동안은 빼고 */
    get cameraAway() { return !!world && !deadNow() && (cam.mode === "free" || cam.mode === "look" || (cam.mode === "pan" && cam.how === "touch")); },
    get cameraMode() { return cam.mode; },
    cycleWeapon, weaponSlot,
    setWeapon(w) { if (hero?.setWeapon(w)) hud.flashWeapon(); },
    jump() { hero?.jump(); },
    dash() {
      if (!hero) return;
      const t = touch.state;
      const dx = t.mx || Math.cos(hero.st.facing), dy = t.my || Math.sin(hero.st.facing);
      hero.dash(dx, dy);
    },
    /** 미니맵: 왼쪽 누름 = 그곳 잠깐 보기(누르는 동안), 오른쪽 = 고른 유닛을 그곳으로 */
    minimap(x, y, button, phase) {
      if (!world) return;
      if (button === 2) { if (phase === "down") command({ t: "ground", x, y }); return; }
      // 왼쪽 누름 · 끌기 = 그곳으로 옮겨 머문다(놓아도 그대로 — WASD · C · 내 영웅으로 · 부활 때만 영웅에게)
      if (phase !== "up") lookStay(x, y);
    },
  };
}
