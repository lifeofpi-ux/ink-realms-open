// 왕국전 화면 = 잉크 브로울스 렌더러 그대로(src/brawls/render — 3D 인형 · 잉크 공장 철판 바닥 · 툰 장애물 · 던전 몬스터 · 바닥 잉크 · 안개 · 후처리).
// 이 파일은 v2 「깃발의 탑」의 지도 · 스냅숏 · 사건을 브로울스 경기장 · 그리기 호출로 옮기는 얇은 층이다.
//
// 좌표: 지도 칸(x, y) ↔ 브로울스 월드(X, Z) = ((x − S/2) · 2, (y − S/2) · 2). 한 칸 = 2u. 높이는 u 그대로(점프 · 풍선).
// 지도 → 경기장: 바닥 = 철판, 숲(TREE) = 나무 블록, 단단한 블록(BLOCK) = 기계 · 탱크 블록, 상자(CRATE) = 부서지는 블록(깨지면 blockChanged),
//               물(WATER) = 잉크 강(다리는 BRIDGE 칸), 연못(POND) = 잉크 강 웅덩이 + 펌프, 본진 둘레 = 팀 홈, 보석 섹션 = 광장(빛 길이 이어진다).
// 건물 · 섹션 · 보석 · 소품은 models.js 의 [왕국전] 모델을 프레임마다 R.model 로, 영웅 · 일꾼 · 잉크봇은 R.drawPlayer, 몬스터는 R.drawMonster.
// 화면 밖(지난 프레임 카메라의 바닥 사각형 + 여유)의 유닛 · 몬스터 · 건물 · 캐는 곳 · 보석 · 섹션은 그리지 않는다(인형 자세 계산 · 모델 넣기 ·
// 그리기를 아낀다 — 8팀 경기에서는 우리 팀 시야가 넓어 화면 밖 것이 화면 안 것보다 훨씬 많다). 건물 · 광산의 그림자는 바닥에 굽는다(R.setCasters).
import { createRenderer } from "../brawls/render/renderer.js";
import { VIEW_USED } from "../brawls/render/camera.js";
import { CELL } from "../brawls/render/grid.js";
import { MODE, SHAPE } from "../brawls/render/sprites.js";
import { MONSTER_KINDS } from "../brawls/render/monsters.js";
import { FLAG } from "../brawls/shared/constants.js";
import {
  TILE, UTYPE, BLD, BUILDINGS, NEUTRAL, TEAM_COLORS, WEAPONS, MONSTERS, ITEMS, GEM, SITE_STATE, POND, MINE, CORE_MINE, MISSILE, SQUAD,
  INK, HERO, UNITS, BUILD_NEAR, flightTime, flightApex, petScale,
} from "../../shared/constants.js";
import { UF, BF, ANIM } from "../../shared/protocol.js";

/** 화면 가로에 담기는 칸 수(휠 · 집기로 바꾼다) */
export const ZOOM = { min: 12, max: 40, def: 22 };

const BMODEL = ["realm/flagtower", "realm/supply", "realm/lab", "realm/facility"];
const BHEIGHT = [6.0, 4.1, 5.6, 2.8]; // 모델 키(u) — 체력 막대 · 짓는 중 솟아오르기
const NEUTRAL_COLOR = 10; // 중립(몬스터) 잉크 색(팔레트 번호 — [왕국전] 붙인 연보라 회색. 코랄 레드는 팀 레드와 헷갈려서)
/** 몬스터 공격 예고 색: 빨강 · 흰색이 빠르게 번갈아(팀 레드의 잉크와 다르게 보인다) */
const WARN_HEX = (t) => (Math.floor(t * 7) % 2 ? 0xffffff : 0xff3b4e);
const ALARM_LIFE = 3;
const GEM_HEX = (value) => (value >= 2 ? 0xffe600 : 0x7df9ff);
const DOLL_TOP = 2.15; // 인형 머리 꼭대기(u, 크기 1 · CHAR_SCALE 1.2)
const hexMix = (a, b, k) => {
  const r = ((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k;
  const g = ((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k;
  const bl = (a & 255) * (1 - k) + (b & 255) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};
const teamHex = (t) => (t === NEUTRAL || t == null || t < 0 ? 0xb9aee0 : TEAM_COLORS[t] ?? 0xb9aee0);
// 팀 번호 → 브로울스 PALETTE 번호. 0~5 는 그대로, 6 · 7(블루 · 레드)은 PALETTE 끝에 붙인 8 · 9 번(6 · 7 번은 민트 · 코랄 레드 — 효과 · 중립 몬스터)
const TEAM_PAL = [0, 1, 2, 3, 4, 5, 8, 9];
const teamIdx = (t) => (t === NEUTRAL || t == null || t < 0 || t >= TEAM_PAL.length ? NEUTRAL_COLOR : TEAM_PAL[t]);

export function createScene(canvas) {
  const R = createRenderer(canvas);
  let world = null;
  let map = null;
  let S = 64;
  const toW = (v) => (v - S / 2) * 2;
  const fromW = (v) => v / 2 + S / 2;
  let A = null;
  let viewTiles = ZOOM.def;
  const prev = new Map(); // id → { X, Z, vx, vz, anim } — 걸음 속도 · 동작 바뀜
  const hitAt = new Map(); // id → 맞은 시각(몬스터 번쩍)
  const fireAt = new Map(); // id → 공격이 나간 시각
  const lastMon = new Map(); // id → 마지막으로 그린 몬스터(쓰러짐 연출에 쓴다)
  const dying = []; // { m, t0 }
  const arcs = []; // 날아가는 풍선 { x0, y0, z0, x1, y1, T, t0, w, big, team, local }
  const warns = []; // 몬스터 공격 예고 { X, Z, r, t0, until, shape }
  const pulls = []; // 소용돌이 { X, Z, r, until, team }
  const rings = []; // 잠깐 보이는 고리(명령 표시 등)
  const alarms = []; // 경보 표시 { x, y, X, Z, t0 } — 흰 · 노랑으로 깜빡이는 고리 + "!" (팀 레드와 다른 모양)
  const pendingSpawn = new Map(); // id → 시각(나타남 연출을 유닛이 보일 때)
  const tags = []; // 이번 프레임의 이름표(HUD 가 DOM 으로 그린다)
  let nodes = []; // 캐는 곳 { res, i, cx, cy, half } — 일꾼이 캐는 중인지(곁에 서 있나) 볼 때
  const coreMiners = []; // 코어 금광마다 지금 곁에서 캐는 일꾼 수(이번 프레임)
  const RES_HEX = { ink: 0xff2df0, gold: 0xffd23f, core: 0xb46bff };
  let time = 0;
  // 화면에 드는 바닥(지도 칸) — 프레임 처음에 지난 프레임 카메라로 잰다
  const vrW = { x0: 0, z0: 0, x1: 0, z1: 0 };
  const VR = { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };
  /** (x, y) 칸이 화면 안(+ 여유 pad 칸)인가 — 먼 쪽(화면 위)은 키 큰 것(건물 · 보스)이 솟아 3칸 더 */
  const onScreen = (x, y, pad = 2.5) => x >= VR.x0 - pad && x <= VR.x1 + pad && y >= VR.y0 - pad - 3 && y <= VR.y1 + pad;
  // 바닥에 구울 그림자 주인: 지도에 고정된 광산 · 코어 금광 · 펌프 + 지금 서 있는 건물
  let mapCasters = [];
  let bldSig = -1;
  /** 건물 종류마다 그림자 모양(받침 + 몸 + 위쪽, 월드 u): [반지름, 아래, 위] */
  const BSHADOW = [
    [[3.7, 0, 0.4], [2.3, 0, 4.4], [1.5, 4.4, 6.2]], // 깃발의 탑
    [[2.9, 0, 0.35], [1.9, 0, 3.9]], // 공급소
    [[2.9, 0, 0.35], [2.0, 0, 3.1], [1.0, 3.1, 5.2]], // 랩
    [[2.9, 0, 0.35], [2.2, 0, 2.6]], // 퍼실리티
  ];

  // ── 경기장 ──
  function buildArena(m) {
    map = m;
    S = m.size;
    nodes = [
      ...m.ponds.map((p, i) => ({ res: "ink", i, cx: p.tx + POND.SIZE / 2, cy: p.ty + POND.SIZE / 2, half: POND.SIZE / 2 })),
      ...(m.mines || []).map((p, i) => ({ res: "gold", i, cx: p.tx + MINE.SIZE / 2, cy: p.ty + MINE.SIZE / 2, half: MINE.SIZE / 2 })),
      ...(m.cores || []).map((p, i) => ({ res: "core", i, cx: p.tx + CORE_MINE.SIZE / 2, cy: p.ty + CORE_MINE.SIZE / 2, half: CORE_MINE.SIZE / 2 })),
    ];
    const n = S;
    const tiles = new Uint8Array(n * n);
    const blocks = new Uint8Array(n * n);
    const tree = new Uint8Array(n * n);
    const T = m.tiles;
    const isWater = (x, y) => x >= 0 && y >= 0 && x < n && y < n && (T[y * n + x] === TILE.WATER);
    for (let i = 0; i < n * n; i++) {
      const t = T[i];
      if (t === TILE.TREE) { tiles[i] = CELL.BREAK; blocks[i] = 1; tree[i] = 1; }
      else if (t === TILE.BLOCK) { tiles[i] = CELL.SOLID; blocks[i] = 1; }
      else if (t === TILE.CRATE) { tiles[i] = CELL.BREAK; blocks[i] = 1; }
      else if (t === TILE.WATER) tiles[i] = CELL.RIVER;
      else if (t === TILE.POND) tiles[i] = CELL.FLOOR; // 연못은 둥근 웅덩이로 따로 그린다(강 칸으로 두면 네모 둑이 생긴다 — 사용자 요청)
      else if (t === TILE.GOLD || t === TILE.CORE) tiles[i] = CELL.FLOOR; // 금광 · 코어 금광은 모델이 덮는다(지나갈 수 없는 것은 막힌 칸 표가 안다)
      else {
        // 수로를 가로지르는 바닥 = 다리(양옆 두 칸 안에 물)
        const x = i % n, y = (i / n) | 0;
        const we = (isWater(x - 1, y) || isWater(x - 2, y)) && (isWater(x + 1, y) || isWater(x + 2, y));
        const ns = (isWater(x, y - 1) || isWater(x, y - 2)) && (isWater(x, y + 1) || isWater(x, y + 2));
        tiles[i] = (we || ns) && CELL.BRIDGE >= 0 ? CELL.BRIDGE : CELL.FLOOR;
      }
    }
    const homes = m.bases.map((b) => ({
      id: b.team, c0: Math.max(1, Math.round(b.cx - 7)), r0: Math.max(1, Math.round(b.cy - 7)), c1: Math.min(n - 2, Math.round(b.cx + 6)), r1: Math.min(n - 2, Math.round(b.cy + 6)),
    }));
    const sites = m.sites.slice().sort((a, b) => (a.center ? -1 : b.center ? 1 : 0));
    const quizRooms = sites.slice(0, 9).map((s) => ({ x: toW(s.x), z: toW(s.y), r: GEM.PAD_R * 2 }));
    A = {
      grid: { n, cell: 2, tiles, blocks, tree }, homes, quizRooms, zoneR: GEM.PAD_R * 2, radius: S, shape: "grid", inkExtent: S, scale: 1,
      isOnPlatform: () => true, groundAt: () => 0,
    };
    R.setArena(A);
    R.setHomeColors(homes.map((h) => teamIdx(h.id)));
    mapCasters = [
      ...(m.mines || []).map((p) => ({ x: toW(p.tx + 1.5), z: toW(p.ty + 1.5), rx: 2.5, rz: 2.3, h0: 0, h1: 1.5 })),
      ...(m.cores || []).map((p) => ({ x: toW(p.tx + 1), z: toW(p.ty + 1), rx: 1.8, rz: 1.8, h0: 0, h1: 1.5 })),
      ...m.ponds.map((p) => ({ x: toW(p.tx + POND.SIZE / 2) + 2.4, z: toW(p.ty + POND.SIZE / 2) - 3.3, rx: 0.45, rz: 0.45, h0: 0, h1: 1.9 })),
    ];
    bldSig = -1;
    R.setCasters(mapCasters);
  }
  /** 서 있는 건물이 바뀌었으면(지어짐 · 무너짐) 바닥 그림자를 다시 굽게 한다 */
  function updateCasters(view) {
    let sig = view.buildings.length;
    for (const b of view.buildings) if (b.flags & BF.BUILT) sig = (Math.imul(sig, 31) + b.id * 8 + b.kind + 1) >>> 0;
    if (sig === bldSig) return;
    bldSig = sig;
    const list = mapCasters.slice();
    for (const b of view.buildings) {
      if (!(b.flags & BF.BUILT)) continue;
      const sz = BUILDINGS[b.kind].size;
      const X = toW(b.tx + sz / 2), Z = toW(b.ty + sz / 2);
      for (const [r, h0, h1] of BSHADOW[b.kind] || BSHADOW[1]) list.push({ x: X, z: Z, rx: r, rz: r, h0, h1, ao: h0 === 0 });
    }
    R.setCasters(list);
  }

  /** 화면 너비에 맞춘 처음 확대(세로 휴대폰은 더 당겨서 인형이 손톱만 해지지 않게) */
  function defaultTiles() {
    const w = canvas.clientWidth || innerWidth;
    return Math.max(ZOOM.min, Math.min(ZOOM.def, w / 36));
  }
  function setWorld(w) {
    world = w;
    viewTiles = defaultTiles();
    buildArena(w.map);
    R.setVision(w.spectator ? null : {
      team: w.team, eyes: [], flags: [], home: null,
      test: (X, Z) => {
        const x = Math.floor(fromW(X)), y = Math.floor(fromW(Z));
        return x >= 0 && y >= 0 && x < S && y < S && w.vis[y * S + x] === 1;
      },
    });
    const base = w.map.bases[w.team] || w.map.bases[0];
    lookAt(base.cx, base.cy);
    clearFx();
    R.snap();
  }
  /** 첫 화면 뒤에 천천히 흘러가는 지도(경기 없이) */
  function setBackdrop(m) {
    world = null;
    buildArena(m);
    R.setVision(null);
    clearFx();
    lookAt(m.size / 2, m.size / 2);
    R.snap();
  }
  function clearFx() {
    prev.clear();
    hitAt.clear();
    fireAt.clear();
    lastMon.clear();
    pendingSpawn.clear();
    dying.length = arcs.length = warns.length = pulls.length = rings.length = alarms.length = 0;
  }

  // ── 카메라 · 좌표 ──
  let camX = 32, camY = 32;
  function lookAt(x, y) { camX = x; camY = y; R.lookAt(toW(x), toW(y)); }
  /** 지금 화면 가운데가 보는 곳(지도 칸) — 부드럽게 따라가는 중 · 경기장 끝에서 멈춘 것까지 반영한 실제 카메라 중심.
   *  (YAW 0° — 돌린 좌표 rx = x, rz = z, 화면 세로는 rz × SQUASH) */
  function camCenter() {
    const c = R.camera;
    return { x: fromW(c.cx), y: fromW(c.cy / VIEW_USED.SQUASH) };
  }
  function follow(x, y, ax, ay) { camX = x; camY = y; R.follow(toW(x), toW(y), toW(ax ?? x), toW(ay ?? y)); }
  const out2 = { x: 0, z: 0 };
  /** 화면 점(CSS px — 캔버스가 화면 전체) → 지도 칸. h = 그 높이(u)의 평면 */
  function screenToGround(sx, sy, h = 0) {
    R.screenToGround(sx, sy, out2, h);
    return { x: fromW(out2.x), y: fromW(out2.z) };
  }
  const so = { x: 0, y: 0, visible: false };
  /** 지도 칸(x, y) + 높이 h(u) → 화면 점(CSS px) */
  function project(x, y, h = 0) {
    R.worldToScreen(toW(x), h, toW(y), so);
    return { x: so.x, y: so.y };
  }
  function viewCorners() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    return [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => screenToGround(x, y));
  }
  function setViewTiles(n) {
    viewTiles = Math.max(ZOOM.min, Math.min(ZOOM.max, n));
  }

  // ── 사건 → 연출 ──
  const now = () => performance.now() / 1000;
  /** 화면에 미리 날린 내 풍선(서버의 arc 가 오면 겹치지 않게 지운다) */
  function predictArc(a, team) {
    const d = Math.hypot(a.x1 - a.x0, a.y1 - a.y0);
    arcs.push({ ...a, T: a.direct ? d / MISSILE.SPEED : flightTime(d, a.big), t0: now(), team, local: true });
  }
  function posOfUnit(view, id) {
    const u = view?.byId?.get(id);
    return u ? { x: u.x, y: u.y, u } : null;
  }

  function onFx(list, view, heroId, heroPos) {
    const t = now();
    for (const e of list) {
      switch (e.k) {
        case "throw": R.actor.throwPose(e.id); break;
        case "arc": {
          if (WEAPONS[e.w]?.direct) break; // 곧게 나는 것은 스냅숏의 탄으로 그린다
          // 내가 미리 날린 것과 같은 것이면 버린다
          const k = arcs.findIndex((a) => a.local && t - a.t0 < 0.8 && Math.hypot(a.x1 - e.x1, a.y1 - e.y1) < 0.9 && a.w === e.w);
          if (k >= 0) { arcs[k].local = false; break; }
          const d = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
          arcs.push({ x0: e.x0, y0: e.y0, z0: e.z0 ?? 1.7, x1: e.x1, y1: e.y1, T: e.t > 0 ? e.t : flightTime(d, !!e.big), t0: t, w: e.w | 0, big: !!e.big, team: e.team });
          break;
        }
        case "boom": {
          const W = WEAPONS[e.w] || WEAPONS[0];
          const X = toW(e.x), Z = toW(e.y);
          const col = teamIdx(e.team);
          if (W.nuke) R.fx.nuke(X, 0.3, Z, col, (e.r || 2) * 2);
          else R.fx.burst(X, 0.2, Z, col, !!e.big, 0, 0, W.splash || 1, W.brawl || 0, e.r > 0 ? { r: e.r * 2 } : null);
          break;
        }
        case "hit": {
          hitAt.set(e.id, t);
          R.actor.hit(e.id, Math.min(1, (e.dmg || 10) / 25));
          break;
        }
        case "ko": {
          const X = toW(e.x), Z = toW(e.y);
          const m = lastMon.get(e.id);
          if (m) { dying.push({ m: { ...m }, t0: t }); lastMon.delete(e.id); R.fx.burst(X, 0.3, Z, teamIdx(e.team), true, 0, 0, 1.2); }
          else R.fx.ko(X, Z, teamIdx(e.team));
          break;
        }
        case "warn": warns.push({ X: toW(e.x), Z: toW(e.y), r: (e.r || 1) * 2, t0: t, until: t + (e.t || 0.8), shape: e.shape || "ring" }); break;
        case "slam": {
          const X = toW(e.x), Z = toW(e.y);
          R.fx.ring(X, 0, Z, NEUTRAL_COLOR, 0.4, (e.r || 1.5) * 2, 0.4, 0.9);
          R.fx.sparks(X, 0.1, Z, NEUTRAL_COLOR, 0.8);
          break;
        }
        case "crate": {
          if (!world) break;
          world.breakCrate(e.i);
          break;
        }
        case "bdown": {
          const b = view?.buildings.find((q) => q.id === e.id);
          if (!b) break;
          const s = BUILDINGS[b.kind].size;
          const X = toW(b.tx + s / 2), Z = toW(b.ty + s / 2);
          R.fx.burst(X, 0.4, Z, teamIdx(e.team ?? b.team), true, 0, 0, Math.max(1, s * 0.6));
          R.fx.debris(X, Z, [teamHex(b.team), 0x46528c], 1.6);
          break;
        }
        case "gem": {
          const X = toW(e.x), Z = toW(e.y);
          if (e.ev === "pop") { R.fx.fountain(X, 0.6, Z, 5, 30); R.fx.debris(X, Z, [0x6f659e, 0x7df9ff], 1.2); }
          else if (e.ev === "score") { R.fx.fountain(X, 1.2, Z, teamIdx(e.team), 50); rings.push({ X, Z, hex: GEM_HEX(e.value), r0: 1, r1: 9, life: 0.9, t: 0 }); }
          else if (e.ev === "pick" || e.ev === "steal") R.fx.itemPop(X, Z, true);
          else if (e.ev === "drop") R.fx.itemPop(X, Z, false);
          else if (e.ev === "return") R.fx.swirl(X, Z, 5, true);
          else if (e.ev === "shield") { R.fx.ring(X, 1.2, Z, 1, 1, 7, 0.5, 1); R.fx.sparks(X, 1.6, Z, 1, 1.4); R.fx.debris(X, Z, [0x7fe3ff, 0xbff6ff], 1); }
          break;
        }
        case "spawn": {
          const p = posOfUnit(view, e.id);
          if (p) R.fx.spawn(toW(p.x), toW(p.y), teamIdx(p.u.team));
          else pendingSpawn.set(e.id, t);
          break;
        }
        case "refill": {
          const p = e.id === heroId && heroPos ? heroPos : posOfUnit(view, e.id);
          if (p) R.fx.ring(toW(p.x), 0, toW(p.y), 1, 0.4, 1.4, 0.35, 0.6);
          break;
        }
        case "item": R.fx.itemPop(toW(e.x), toW(e.y), true); break;
        case "pull": pulls.push({ X: toW(e.x), Z: toW(e.y), r: (e.r || 2) * 2, until: t + (e.t || 2), team: e.team }); break;
      }
    }
  }

  // ── 그리기 ──
  let last = performance.now();
  /**
   * 한 프레임. f = null(첫 화면) | { view(world.sample()), hero: { id, x, y, z, vx, vy, facing, charging, charge, dash, slow, alive, throwPose },
   *   ui: { selected:Set, hover, place, aim, followRing, rings:[] }, me, carryId }
   */
  function render(f) {
    const tNow = performance.now();
    const dt = Math.min(0.1, (tNow - last) / 1000);
    last = tNow;
    time = tNow / 1000;
    R.beginFrame(time, dt);
    R.setViewWidth(viewTiles * 2);
    R.viewRectNow(vrW);
    VR.x0 = fromW(vrW.x0); VR.x1 = fromW(vrW.x1); VR.y0 = fromW(vrW.z0); VR.y1 = fromW(vrW.z1);
    tags.length = 0;
    if (world && world.cratesDirty.length) {
      for (const i of world.cratesDirty.splice(0)) {
        if (A) A.grid.blocks[i] = 0;
        R.blockChanged(i, false);
      }
    }
    if (f && world && f.view) {
      updateCasters(f.view);
      drawSites(f.view);
      drawPonds(f.ui?.hoverRes);
      drawBuildings(f.view, f.ui);
      drawRefill(f);
      drawUnits(f.view, f, dt);
      drawGems(f.view, f);
      drawItemsProjs(f.view);
      drawOverlays(f.view, f);
    }
    drawArcs();
    drawMarks(dt);
    R.render();
  }

  const visAt = (x, y) => {
    const tx = Math.floor(x), ty = Math.floor(y);
    return tx >= 0 && ty >= 0 && tx < S && ty < S && !!world.vis[ty * S + tx];
  };
  // (예전: 다섯 점 배열을 부를 때마다 새로 만들었다 — 유닛마다 프레임마다)
  const visible = (x, y, pad = 0.6) => {
    if (!world || world.spectator) return true;
    return visAt(x, y) || visAt(x + pad, y) || visAt(x - pad, y) || visAt(x, y + pad) || visAt(x, y - pad);
  };

  /** 캐는 곳: 잉크 연못(펌프 + 빛 테) · 금광 · 코어 금광. hover = 가리키는 캐는 곳 { res, i } */
  function drawPonds(hover) {
    const hot = (res, i) => hover && hover.res === res && hover.i === i;
    map.ponds.forEach((p, i) => {
      if (!onScreen(p.tx + POND.SIZE / 2, p.ty + POND.SIZE / 2, 4)) return;
      // 펌프: 연못 위쪽 가장자리(화면 안쪽 — 가려지지 않게)
      const X = toW(p.tx + POND.SIZE / 2), Z = toW(p.ty + POND.SIZE / 2);
      const hex = teamHex(p.team);
      R.model("realm/pump", X + 2.4, 0, Z - 3.3, 0, hex, 1);
      // [왕국전] 둥근 잉크 웅덩이 한 장(sprites.js SHAPE.POND — 셰이더가 도는 물결 · 잔물결 · 떠오르는 방울 · 밝은 둑을 그린다.
      //          예전: 어두운 바닥 · 둑 · 빛 둘 · 방울 넷 = 데칼 여덟 장)
      R.decalPond(X, 0.02, Z, 6.5, 0xff2df0, 0.96, (i * 0.37) % 1, 0.018, 0.25);
      R.decal(X, 0.02, Z, 7.4, 7.4, hot("ink", i) ? 0xffffff : 0xff2df0, hot("ink", i) ? 0.9 : 0.35 + 0.12 * Math.sin(time * 2 + p.tx), SHAPE.RING, 0.06, MODE.FLAT, 0.02, 0.6);
    });
    (map.mines || []).forEach((m, i) => {
      if (!onScreen(m.tx + 1.5, m.ty + 1.5, 4)) return;
      const X = toW(m.tx + 1.5), Z = toW(m.ty + 1.5);
      R.model("realm/goldmine", X, 0, Z, m.rich ? Math.PI : 0, m.rich ? 0xffe600 : teamHex(m.team), m.rich ? 1.08 : 0.98);
      R.decal(X, 0.02, Z, 7.6, 7.6, hot("gold", i) ? 0xffffff : 0xffd23f, hot("gold", i) ? 0.9 : 0.3 + 0.1 * Math.sin(time * 2.2 + i), SHAPE.RING, 0.05, MODE.FLAT, 0.02, 0.6);
    });
    (map.cores || []).forEach((c, i) => {
      if (!onScreen(c.tx + 1, c.ty + 1, 3)) return;
      const X = toW(c.tx + 1), Z = toW(c.ty + 1);
      R.model("realm/coremine", X, 0, Z, 0, teamHex(c.team), 1.05);
      R.decal(X, 0.02, Z, 5.6, 5.6, hot("core", i) ? 0xffffff : 0xa24bff, hot("core", i) ? 0.9 : 0.35 + 0.15 * Math.sin(time * 3 + i), SHAPE.RING, 0.06, MODE.FLAT, 0.02, 0.8);
    });
  }

  function drawSites(view) {
    for (const x of view.sites) {
      const m = map.sites[x.id];
      if (!m || !onScreen(m.x, m.y, 6)) continue;
      const X = toW(m.x), Z = toW(m.y);
      const gem = GEM_HEX(x.value || (m.center ? 2 : 1));
      const quiz = x.state === SITE_STATE.QUIZ;
      const padHex = quiz && x.team >= 0 ? teamHex(x.team) : m.center ? 0xffe600 : 0x00f0ff;
      R.model("realm/sitepad", X, 0, Z, 0, padHex, 1);
      const rock = x.state === SITE_STATE.SHIELD || x.state === SITE_STATE.ROCK || quiz;
      if (rock) {
        const k = x.state === SITE_STATE.ROCK ? 0.85 + 0.15 * x.rock : 1;
        R.model("realm/gemrock", X, 0, Z, (m.id * 1.3) % 6.28, gem, 1.15 * k);
      }
      if (x.state === SITE_STATE.SHIELD) {
        // 방어막 돔: 카메라를 보는 반투명 원 + 테두리. 가득할수록 진하다. 바닥에 남은 비율 호
        const d = GEM.SHIELD_R * 4;
        const f = Math.max(0, Math.min(1, x.shield));
        const wob = 1 + 0.015 * Math.sin(time * 3 + m.id);
        R.decal(X, 1.6, Z, d * wob, d * 0.86 * wob, 0x7fe3ff, 0.1 + 0.16 * f, SHAPE.DISC, 0, MODE.FACE, 1.4, 0.4);
        R.decal(X, 1.6, Z, d * wob, d * 0.86 * wob, 0xbff6ff, 0.35 + 0.5 * f, SHAPE.RING, 0.05, MODE.FACE, 1.42, 0.8);
        R.decal(X, 2.4, Z - 0.6, d * 0.35, d * 0.16, 0xffffff, 0.12 + 0.12 * f, SHAPE.DISC, 0, MODE.FACE, 1.45, 0.6);
        R.decalArc(X, 0.06, Z, GEM.SHIELD_R * 2 + 0.5, 0.14, 0x7fe3ff, 0.95, f, 0.03);
      } else if (x.state === SITE_STATE.ROCK) {
        R.decalArc(X, 0.06, Z, GEM.ROCK * 1.4, 0.16, 0xffd23f, 0.95, Math.max(0, x.rock), 0.03);
      } else if (quiz) {
        // 풀이 중: 그 팀 색 빛기둥
        const hex = teamHex(x.team);
        const pulse = 0.75 + 0.25 * Math.sin(time * 5);
        R.decal(X, 7, Z, 3.4, 14, hex, 0.22 * pulse, SHAPE.RECT, 0, MODE.FACE, 0.2, 0.9);
        R.decal(X, 7, Z, 1.2, 14, 0xffffff, 0.3 * pulse, SHAPE.RECT, 0, MODE.FACE, 0.21, 1.2);
        R.decal(X, 0.05, Z, 7, 7, hex, 0.5 * pulse, SHAPE.DISC, 0, MODE.FLAT, 0.02, 0.6);
        if (x.timer > 0) R.decalArc(X, 0.07, Z, GEM.SHIELD_R * 2 + 0.6, 0.12, hex, 0.95, x.timer / GEM.QUIZ_TIME, 0.035);
      } else if (x.state === SITE_STATE.EMPTY && x.timer > 0) {
        R.decalArc(X, 0.06, Z, GEM.SHIELD_R * 2, 0.08, 0x7a6fa0, 0.7, 1 - x.timer / GEM.RESPAWN, 0.03);
      }
    }
  }

  function drawBuildings(view, ui) {
    for (const b of view.buildings) {
      const def = BUILDINGS[b.kind];
      const s = def.size;
      if (!onScreen(b.tx + s / 2, b.ty + s / 2, s / 2 + 2)) continue;
      const X = toW(b.tx + s / 2), Z = toW(b.ty + s / 2);
      const hex = teamHex(b.team);
      const built = b.flags & BF.BUILT;
      const broken = b.flags & BF.BROKEN;
      const down = b.flags & BF.DOWN;
      const name = BMODEL[b.kind] || BMODEL[1];
      const hitFlash = b.flags & BF.HIT ? 0.5 + 0.5 * Math.sin(time * 40) : 0;
      if (!built) {
        const p = Math.max(0.05, b.progress);
        R.model(name, X, -(1 - p) * BHEIGHT[b.kind], Z, 0, hex, 1);
        R.model("realm/scaffold", X, 0, Z, 0, hex, s * 0.98);
        continue;
      }
      const sad = broken || down;
      const tint = sad ? hexMix(hex, 0x2a2638, 0.65) : hitFlash ? hexMix(hex, 0xffffff, hitFlash * 0.5) : hex;
      R.model(name, X, sad ? -0.25 : 0, Z, 0, tint, 1, broken ? 0.05 : 0, broken ? -0.04 : 0);
      if (b.kind === BLD.TOWER) {
        // 깃대: 꺾이면 옆으로 쓰러진다
        if (down) R.model("realm/flagpole", X + 1.2, 4.4, Z + 0.4, 0.3, hexMix(hex, 0x444455, 0.35), 1, 0.15, -1.25);
        else R.model("realm/flagpole", X, 5.2, Z, Math.sin(time * 1.7 + b.id) * 0.12, hex, 1);
      }
      if (sad) {
        for (let k = 0; k < 2; k++) R.model("realm/rubble", X + (k ? -s * 0.75 : s * 0.8), 0, Z + (k ? s * 0.6 : s * 0.7), k * 2.1, 0xffffff, 1.1);
        for (let k = 0; k < 3; k++) {
          const ph = (time * 0.6 + k / 3) % 1;
          R.decal(X + Math.sin(k * 2.3 + time * 0.4) * 1.2, BHEIGHT[b.kind] * 0.6 + ph * 3.5, Z - 0.5, 1.2 + ph * 1.6, 1.2 + ph * 1.6, 0x3a3555, 0.55 * (1 - ph), SHAPE.DISC, 0, MODE.FACE, 0.6);
        }
        if (Math.sin(time * 6) > 0.6) R.decal(X, 0.05, Z, s * 2 + 1.2, s * 2 + 1.2, 0xffffff, 0.6, SHAPE.RING, 0.05, MODE.FLAT, 0.02, 0.8);
      } else if (b.flags & BF.BUSY) {
        // 하는 일(뽑기 · 열기 · 연구 · 부화): 발밑 팀 색 호가 진행만큼 찬다
        R.decalArc(X, 0.05, Z, s + 0.6, 0.1, hex, 0.9, Math.max(0.02, b.progress), 0.03);
      }
    }
  }

  // 인형(영웅 · 일꾼 · 잉크봇)
  function dollChar(u) {
    const base = world.charOf(u.owner >= 0 ? u.owner : 0);
    if (u.type === UTYPE.HERO) return base;
    return (base + (u.type === UTYPE.WORKER ? 3 : 5)) % 8;
  }
  function trackVel(id, X, Z, dt) {
    let p = prev.get(id);
    if (!p) { p = { X, Z, vx: 0, vz: 0, anim: -1, seen: time }; prev.set(id, p); }
    if (dt > 0) {
      const k = 1 - Math.exp(-dt * 12);
      p.vx += ((X - p.X) / dt - p.vx) * k;
      p.vz += ((Z - p.Z) / dt - p.vz) * k;
    }
    p.X = X; p.Z = Z; p.seen = time;
    return p;
  }

  // ── 일꾼 일하는 동작(U19) ──
  // 서버: 캐는 동안 anim = GATHER(animT = 한 번 캐기의 진행 0..1), 짓기 · 고치기 = BUILD. 어느 곳인지는 가장 가까운 캐는 곳으로 안다.
  // 금광 · 코어 금광 = 곡괭이를 한 번 캐기에 몇 번 휘두르고(내리칠 때 돌조각 · 반짝이), 연못 = 들통으로 떠서 들어 올리고(잉크 방울), 짓기 = 망치질(먼지).
  // 한 번 캐기를 마치고 나서면(GATHER → 다른 것, 든 것이 있다) 내 일꾼은 "+8" 처럼 얼마를 캤는지 떠오른다(onPop).
  const hooks = { onPop: null, onWork: null }; // main.js 가 단다 — (x, y, 높이 u, 글, 색) → HUD 떠오르는 글자 · [소리] onWork(종류, x, y, 내 것?, id) → 곡괭이 · 망치 · 들통 소리(src/audio/game.js)
  const SWINGS = { gold: 3, core: 5, ink: 2 }; // 한 번 캐기 동안 휘두르기 · 뜨기 횟수
  const TRIP = { gold: MINE.TIME, core: CORE_MINE.TIME, ink: POND.TIME };
  const CHIP = { gold: 5, core: 4, ink: 0 }; // 튀는 조각 색(PALETTE 번호 — 레몬 · 퍼플 · 핫핑크)
  const POP_HEX = { gold: "#ffd23f", core: "#d9a8ff", ink: "#ff7df5" };
  const ease = (k) => k * k * (3 - 2 * k);
  function workerWork(u, p, prevAnim, X, Z, size, zU, dt) {
    const gathering = u.anim === ANIM.GATHER;
    const building = u.anim === ANIM.BUILD;
    const attacking = u.anim === ANIM.ATTACK; // U22: 곡괭이로 적을 친다(조금 빠르게)
    const n = gathering || u.anim === ANIM.IDLE ? nodeBeside(u) : null;
    // 한 번 캐기를 마쳤다 → 내 일꾼이면 "+N"
    if (prevAnim === ANIM.GATHER && !gathering && u.info > 0 && p.node && u.owner === world.you && hooks.onPop) {
      const nd = p.node;
      const amt = nd.res === "gold" ? (map.mines[nd.i]?.rich ? MINE.RICH : MINE.BASE) : nd.res === "core" ? CORE_MINE.AMOUNT : POND.BASE;
      hooks.onPop(u.x, u.y, DOLL_TOP * size + 1.2, `+${amt}`, POP_HEX[nd.res]);
    }
    if (n && (gathering || u.anim === ANIM.IDLE)) {
      // 발밑에 그 자원 색 고리(맥박)
      const ph = (time * 1.6 + u.id * 0.31) % 1;
      R.decal(X, 0.03, Z, 0.8 + ph * 1.2, 0.8 + ph * 1.2, RES_HEX[n.res], 0.8 * (1 - ph), SHAPE.RING, 0.12, MODE.FLAT, 0.025, 0.9);
      if (n.res === "core") coreMiners[n.i] = (coreMiners[n.i] || 0) + 1;
    }
    if (!gathering && !building && !attacking) { p.node = null; return; }
    if (gathering) p.node = n;
    // 박자: 시간으로 부드럽게 돌리되 서버의 animT 에 천천히 맞춘다(스냅숏이 10Hz 라 animT 만 쓰면 뚝뚝 끊긴다)
    const res = n ? n.res : "gold";
    const free = building || attacking; // 서버 진행(animT)에 맞추지 않는 박자
    const sw = free ? 0 : SWINGS[res];
    const rate = attacking ? 2.6 : building ? 2.2 : sw / TRIP[res];
    if (p.ph == null) p.ph = free ? u.id * 0.37 : (u.animT || 0) * sw;
    p.ph += dt * rate;
    if (!free) {
      let d = (u.animT || 0) * sw - p.ph;
      d -= Math.round(d);
      p.ph += d * Math.min(1, dt * 2);
    }
    const fr = ((p.ph % 1) + 1) % 1;
    const last = p.fr ?? fr;
    p.fr = fr;
    const crossed = (a) => (last < a && fr >= a) || (last > fr && (fr >= a || last < a)); // 이번 프레임에 a 를 지났나(한 바퀴 넘김 포함)
    const cx = Math.cos(u.facing), cz = Math.sin(u.facing);
    const handY = zU + 1.12 * size; // 어깨 높이 — 위에서 내려다봐도 머리에 가리지 않게
    // 내리치는 곳 = 캐는 곳 네모에서 일꾼에게 가장 가까운 점(없으면 바라보는 쪽 앞)
    const hitX = n ? toW(Math.max(n.cx - n.half, Math.min(n.cx + n.half, u.x))) : X + cx * 1.35;
    const hitZ = n ? toW(Math.max(n.cy - n.half, Math.min(n.cy + n.half, u.y))) : Z + cz * 1.35;
    if (free || res !== "ink") {
      // 곡괭이 · 망치: 천천히 들어 올렸다가(0 → 0.6) 빠르게 내리치고(→ 0.72) 돌아온다
      const up = building ? 1.3 : 2.0, low = building ? -0.35 : -0.65;
      let rz;
      if (fr < 0.6) rz = -0.3 + (up + 0.3) * ease(fr / 0.6);
      else if (fr < 0.72) rz = up + (low - up) * ((fr - 0.6) / 0.12);
      else rz = low + (-0.3 - low) * ease((fr - 0.72) / 0.28);
      R.model(building ? "realm/hammer" : "realm/pickaxe", X + cx * 0.38, handY, Z + cz * 0.38, -u.facing, 0xffffff, building ? 1.7 : 1.9, 0, rz);
      if (crossed(0.6)) R.actor.throwPose(u.id); // 팔도 함께 내리친다
      if (crossed(0.72)) {
        const hx = free ? X + cx * 1.5 : hitX, hz = free ? Z + cz * 1.5 : hitZ;
        hooks.onWork?.(building ? "build" : attacking ? "attack" : res, u.x, u.y, u.owner === world.you, u.id); // [소리]
        if (building) R.fx.sparks(hx, -0.55, hz, 10, 0.15);
        else if (attacking) { R.fx.sparks(hx, -0.2, hz, teamIdx(u.team), 0.3, cx * 0.4, cz * 0.4); R.decal(hx, 0.04, hz, 1, 1, 0xffffff, 0.8, SHAPE.RING, 0.15, MODE.FLAT, 0.03, 1.2); }
        else {
          R.fx.sparks(hx, -0.35, hz, res === "core" && (Math.floor(p.ph) & 1) ? 1 : CHIP[res], 0.3, -cx * 0.3, -cz * 0.3);
          R.decal(hx, 0.04, hz, 1.1, 1.1, RES_HEX[res], 0.7, SHAPE.RING, 0.15, MODE.FLAT, 0.03, 1.2);
        }
      }
    } else {
      // 들통: 앞으로 내밀어 연못에 담갔다가(0 → 0.35) 잠깐 머물고 들어 올린다(0.5 → 0.8)
      let reach, y, rz;
      if (fr < 0.35) { const k = ease(fr / 0.35); reach = 0.35 + 0.65 * k; y = handY - 0.65 * k; rz = -0.55 * k; }
      else if (fr < 0.5) { reach = 1.0; y = handY - 0.65 + Math.sin(time * 18 + u.id) * 0.04; rz = -0.55; }
      else if (fr < 0.8) { const k = ease((fr - 0.5) / 0.3); reach = 1.0 - 0.65 * k; y = handY - 0.65 + 0.75 * k; rz = -0.55 + 0.75 * k; }
      else { reach = 0.35; y = handY + 0.1; rz = 0.2; }
      R.model("realm/bucket", X + cx * reach * 1.3, y, Z + cz * reach * 1.3, -u.facing, 0xffffff, 1.6, 0, rz);
      if (crossed(0.02)) R.actor.throwPose(u.id);
      if (crossed(0.35) || crossed(0.5)) {
        const hx = hitX, hz = hitZ;
        hooks.onWork?.(crossed(0.35) ? "scoop" : "splash", u.x, u.y, u.owner === world.you, u.id); // [소리] 담그기 · 들어 올리기
        R.fx.sparks(hx, -0.65, hz, CHIP.ink, 0.22);
        R.decal(hx, 0.04, hz, 1.3, 1.3, RES_HEX.ink, 0.8, SHAPE.RING, 0.12, MODE.FLAT, 0.03, 1.2);
      }
    }
  }

  // ── 내 유닛 표시(▼ + "내 일꾼" · 할 일이 없으면 "일 시켜주세요!") ──
  // 가까이 모인 같은 종류는 하나로 묶어 "내 일꾼 ×3"(나머지는 ▼ 만) — 일꾼 넷이 모여도 어지럽지 않게. 프레임마다 같은 배열을 다시 쓴다
  const MINE_NAME = { [UTYPE.WORKER]: "내 일꾼", [UTYPE.BOT]: "내 봇", [UTYPE.PET]: "내 몬스터" };
  const mineMarks = []; // { u, h, idle } — 이번 프레임
  let mineN = 0;
  function markMine(u, h) {
    let m = mineMarks[mineN];
    if (!m) { m = { u: null, h: 0, idle: false, lead: null, n: 0 }; mineMarks[mineN] = m; }
    mineN++;
    m.u = u; m.h = h; m.idle = u.type === UTYPE.WORKER && !!(u.flags & UF.IDLE); m.lead = null; m.n = 1;
  }
  function flushMine() {
    for (let i = 0; i < mineN; i++) {
      const a = mineMarks[i];
      for (let j = 0; j < i; j++) {
        const b = mineMarks[j];
        if (b.lead || b.u.type !== a.u.type || b.idle !== a.idle) continue;
        if (Math.abs(b.u.x - a.u.x) < 1.6 && Math.abs(b.u.y - a.u.y) < 1.6) { a.lead = b; b.n++; break; }
      }
    }
    const hp = world.heroPos;
    for (let i = 0; i < mineN; i++) {
      const m = mineMarks[i];
      // 내 영웅 곁이면 영웅 이름표("나")와 겹치지 않게 한 층 위로
      if (!m.lead && hp && Math.abs(m.u.x - hp.x) < 1.4 && Math.abs(m.u.y - hp.y) < 1.6) m.h += 2.6;
      const name = m.lead ? "" : m.idle ? (m.n > 1 ? `일 시켜주세요! ×${m.n}` : "일 시켜주세요!") : m.n > 1 ? `${MINE_NAME[m.u.type]} ×${m.n}` : MINE_NAME[m.u.type];
      tags.push({ id: m.u.id, x: m.u.x, y: m.u.y, h: m.h, name, team: m.u.team, self: false, hp: null, gem: false, mine: true, idle: m.idle && !m.lead });
    }
    mineN = 0;
  }

  // ── 공급소 채우는 곳(U18): 서버와 같은 모양 — 공급소 네모 가장자리에서 INK.REFILL_REACH(+ 영웅 반지름) 안 ──
  // 영웅이 다가오면(REACH + 5칸부터) 둥근 네모가 서서히 보이고, 채우는 동안 밝아지며 공급소 꼭대기에서 영웅에게 잉크 방울이 흘러간다.
  // 내 잉크가 0이면 흐린 빨강 + "내 잉크가 없어요"(U31). 바닥 표시(decal)만 쓴다 — 프레임마다 새로 만드는 것이 없다
  const REFILL_R = INK.REFILL_REACH + HERO.RADIUS; // 칸
  const QUAD = [[1, -1, 0], [1, 1, -Math.PI / 2], [-1, 1, -Math.PI], [-1, -1, -Math.PI * 1.5]]; // 모서리(x 쪽, z 쪽, 호 시작각)
  /** 바닥에 누운 둥근 네모(월드 u): 가운데 (Xc, Zc) · 안쪽 네모 반폭 hw · 둥근 반지름 Rr. 채움 + 테두리(네 변 + 네 모서리 호) */
  function roundRect(Xc, Zc, hw, Rr, hex, fillA, lineA, emit, t = 0.16) {
    const W = hw * 2, X0 = Xc - hw, X1 = Xc + hw, Z0 = Zc - hw, Z1 = Zc + hw;
    if (fillA > 0) {
      R.decal(Xc, 0.021, Zc, W + Rr * 2, W, hex, fillA, SHAPE.RECT, 0, MODE.FLAT, 0.015, emit * 0.5);
      R.decal(Xc, 0.021, Zc, W, W + Rr * 2, hex, fillA, SHAPE.RECT, 0, MODE.FLAT, 0.015, emit * 0.5);
    }
    R.decal(Xc, 0.03, Z0 - Rr, W, t, hex, lineA, SHAPE.RECT, 0, MODE.FLAT, 0.02, emit);
    R.decal(Xc, 0.03, Z1 + Rr, W, t, hex, lineA, SHAPE.RECT, 0, MODE.FLAT, 0.02, emit);
    R.decal(X0 - Rr, 0.03, Zc, t, W, hex, lineA, SHAPE.RECT, 0, MODE.FLAT, 0.02, emit);
    R.decal(X1 + Rr, 0.03, Zc, t, W, hex, lineA, SHAPE.RECT, 0, MODE.FLAT, 0.02, emit);
    for (const [qx, qz, st] of QUAD) {
      const cx = qx > 0 ? X1 : X0, cz = qz > 0 ? Z1 : Z0;
      if (fillA > 0) R.decalArc(cx, 0.021, cz, Rr, 1, hex, fillA, 0.25, 0.015, st);
      R.decalArc(cx, 0.03, cz, Rr + t / 2, t / (Rr + t / 2), hex, lineA, 0.25, 0.02, st);
    }
  }
  function drawRefill(f) {
    const h = f.hero;
    if (!h || !h.local || !h.alive || world.spectator) return;
    const sups = world.mySupplies();
    if (!sups.length) return;
    const noInk = world.wallet().ink <= 0; // 탱크는 내 잉크로만 찬다(U31 — 옛 서버는 팀 잉크)
    const filling = !noInk && world.heroRefilling();
    const pulse = 0.5 + 0.5 * Math.sin(time * (filling ? 7 : 3));
    for (const b of sups) {
      const s = BUILDINGS[b.kind].size;
      const dx = Math.max(b.tx - h.x, 0, h.x - (b.tx + s)), dy = Math.max(b.ty - h.y, 0, h.y - (b.ty + s));
      const d = Math.hypot(dx, dy);
      const fade = Math.max(0, Math.min(1, 1 - (d - REFILL_R) / 5));
      if (fade <= 0.02) continue;
      const inside = d <= REFILL_R;
      const hex = noInk ? 0xff3b4e : teamHex(world.team);
      const X0 = toW(b.tx), X1 = toW(b.tx + s), Z0 = toW(b.ty), Z1 = toW(b.ty + s);
      const Xc = (X0 + X1) / 2, Zc = (Z0 + Z1) / 2;
      const fillA = fade * (noInk ? 0.1 : filling && inside ? 0.24 + 0.1 * pulse : 0.07 + 0.05 * pulse);
      const lineA = fade * (noInk ? 0.45 : filling && inside ? 1 : 0.55 + 0.3 * pulse);
      // 안쪽 채움(가운데 겹침은 공급소가 덮는다) + 테두리
      roundRect(Xc, Zc, (X1 - X0) / 2, REFILL_R * 2, hex, fillA, lineA, filling && inside ? 1.4 : 0.6);
      if (noInk) {
        if (fade > 0.3) tags.push({ id: -300 - b.id, x: b.tx + s / 2, y: b.ty + s / 2, h: 4.6, name: world.wallet().own ? "내 잉크 없음 · 연못에서 길어 와요" : "팀 잉크가 없어요", team: -1, color: "#ff8a95", self: false, hp: null, gem: false });
        continue;
      }
      if (filling && inside) {
        // 공급소 꼭대기 → 영웅 가슴으로 잉크 방울이 줄지어 흐른다(포물선)
        const hx = toW(h.x), hz = toW(h.y), hy = (h.z || 0) + 1.2;
        for (let k = 0; k < 7; k++) {
          const q = (time * 1.7 + k / 7) % 1;
          const x = Xc + (hx - Xc) * q, z = Zc + (hz - Zc) * q;
          const y = 3.3 + (hy - 3.3) * q + 2.2 * q * (1 - q);
          const r = 0.32 + 0.12 * Math.sin(k * 1.7 + time * 9);
          R.decal(x, y, z, r * 1.4, r * 1.4, hex, 0.95, SHAPE.DISC, 0, MODE.FACE, 0.4, 1.6);
          R.decal(x, y, z, r * 0.45, r * 0.45, 0xffffff, 0.9, SHAPE.DISC, 0, MODE.FACE, 0.42, 1.8);
        }
        const g = (time * 1.5) % 1;
        R.decal(hx, 0.04, hz, 1.2 + g * 1.4, 1.2 + g * 1.4, hex, 0.9 * (1 - g), SHAPE.RING, 0.12, MODE.FLAT, 0.03, 1.4);
      }
    }
  }

  /** 일꾼이 캐는 곳 곁에 서 있으면 그곳(서버는 캐는 동작을 따로 보내지 않는다 — 곁에 멈춰 있으면 캐는 중으로 본다) */
  function nodeBeside(u) {
    for (const n of nodes) if (Math.max(Math.abs(u.x - n.cx), Math.abs(u.y - n.cy)) < n.half + 1.05) return n;
    return null;
  }
  const seenIds = new Set(); // 이번 프레임에 본 유닛(프레임마다 새로 만들지 않는다)
  const dollV = { id: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, aim: 0, flags: 0, charge: 0, color: 0, team: 0, char: 0, pattern: -1, size: 1, boost: 0, shield: 0, range: 0 };
  const DOLL_OTHER = { self: false };
  function drawUnits(view, f, dt) {
    const myTeam = world.team;
    coreMiners.length = 0;
    const heroId = f.hero?.id;
    const seen = seenIds;
    seen.clear();
    for (const u of view.units) {
      if (u.id === heroId && f.hero?.local) continue;
      const carrying = u.flags & UF.GEM;
      // 보석 운반자 · 화난 가운데 보스(UF.RAGE — 서버가 시야 밖에서도 보낸다, U21)는 안개 속에서도 그린다
      if (u.team !== myTeam && !carrying && !(u.flags & UF.RAGE) && !visible(u.x, u.y)) continue;
      const X = toW(u.x), Z = toW(u.y);
      seen.add(u.id);
      const p = trackVel(u.id, X, Z, dt);
      const animChanged = p.anim !== u.anim;
      const prevAnim = p.anim;
      p.anim = u.anim;
      // 화면 밖: 인형 자세 · 모델 · 데칼 · 이름표를 건너뛴다(속도 · 동작 바뀜은 위에서 따라갔다 — 다시 들어오면 이어서)
      if (!onScreen(u.x, u.y, u.type === UTYPE.NPC ? 4 : 2.5)) { p.node = null; continue; }
      if (pendingSpawn.has(u.id)) { pendingSpawn.delete(u.id); R.fx.spawn(X, Z, teamIdx(u.team)); }
      if (u.type === UTYPE.HERO || u.type === UTYPE.WORKER || u.type === UTYPE.BOT) {
        if (animChanged && u.anim === ANIM.THROW) R.actor.throwPose(u.id);
        const down = u.flags & UF.DOWN || u.anim === ANIM.KO;
        const size = u.type === UTYPE.WORKER ? 0.8 : u.type === UTYPE.BOT ? 0.75 : 1;
        const zU = u.z || 0;
        const flags = (down ? 0 : FLAG.ALIVE) | (u.anim === ANIM.CHARGE ? FLAG.CHARGING : 0) | (u.anim === ANIM.DASH ? FLAG.DASHING : 0) |
          (u.flags & UF.SLOW ? FLAG.SLOWED : 0) | (u.flags & UF.INVULN ? FLAG.INVULN : 0) | (zU <= 0.01 ? FLAG.GROUNDED : 0);
        // 보석 운반자는 안개 속에서도 보인다 — 렌더러의 안개 검사를 우리 팀으로 넘긴다
        // 인형 하나(렌더러는 값을 읽어 옮겨 담을 뿐 이 객체를 들고 있지 않는다 — 프레임마다 새로 만들지 않고 하나를 다시 쓴다)
        const dv = dollV;
        dv.id = u.id; dv.x = X; dv.y = zU; dv.z = Z; dv.vx = p.vx; dv.vz = p.vz; dv.aim = u.facing; dv.flags = flags;
        dv.charge = u.anim === ANIM.CHARGE ? u.animT : 0; dv.color = teamIdx(u.team); dv.team = carrying ? myTeam : u.team;
        dv.char = dollChar(u); dv.size = size; dv.boost = u.flags & UF.BOOST ? 3 : 0; dv.shield = u.flags & UF.SHIELD ? 3 : 0;
        R.drawPlayer(dv, DOLL_OTHER);
        if (!down) {
          const top = DOLL_TOP * size + zU;
          if (u.type === UTYPE.WORKER) workerWork(u, p, prevAnim, X, Z, size, zU, dt);
          if (u.type === UTYPE.WORKER) {
            // 든 것(info): 1 잉크 통 · 2 금 자루 · 3 코어(UF.INK 는 옛 표시 — 잉크로 본다)
            const carry = u.info || (u.flags & UF.INK ? 1 : 0);
            if (carry === 1) R.model("realm/can", X, top - 0.15, Z, time * 0.5 + u.id, teamHex(u.team), 1.25);
            else if (carry === 2) R.model("realm/sack", X, top - 0.15, Z, u.id, 0xffffff, 1.25);
            else if (carry === 3) R.model("realm/core", X, top - 0.05 + Math.sin(time * 5 + u.id) * 0.06, Z, time * 2, 0xffffff, 1.3);
          }
          if (u.type === UTYPE.BOT) R.model("realm/antenna", X - 0.15, top - 0.2, Z, 0, teamHex(u.team), 1.3, 0, Math.sin(time * 5 + u.id) * 0.18);
          if (u.owner === world.you && u.type !== UTYPE.HERO) markMine(u, top + (u.type === UTYPE.WORKER && u.info ? 0.75 : 0.3));
          if (u.type === UTYPE.HERO) tags.push({ id: u.id, x: u.x, y: u.y, h: top + 0.5, name: world.playerName(u.owner), team: u.team, self: false, hp: u.hp, gem: !!carrying });
        }
      } else {
        const kind = Math.max(0, Math.min(7, u.sub | 0));
        const K = MONSTERS[kind] || MONSTERS[0];
        const pet = u.type === UTYPE.PET;
        if (animChanged && u.anim === ANIM.ATTACK) fireAt.set(u.id, time);
        const ft = fireAt.get(u.id);
        const ht = hitAt.get(u.id);
        const scale = MONSTER_KINDS[kind].scale * (pet ? 0.8 * petScale(u.info) : 0.9);
        const m = {
          id: u.id, kind, x: X, z: Z, face: u.facing, scale, hp: u.hp,
          moving: u.anim === ANIM.MOVE ? 1 : 0, windup: u.anim === ANIM.WIND ? Math.max(0, Math.min(1, u.animT)) : -1,
          atk: u.anim === ANIM.WIND ? (u.animT > 0.5 && K.atk2 && (u.id + Math.floor(time / 6)) % 3 === 0 ? K.atk2.type : K.atk.type) : "",
          hit: ht != null ? Math.max(0, 1 - (time - ht) / 0.25) : 0,
          spawn: u.anim === ANIM.SPAWN || u.flags & UF.HATCH ? Math.max(0.05, u.animT) : 1,
          dying: 0, frozen: false, dash: u.anim === ANIM.DASH, stun: u.anim === ANIM.STUN ? 1 : 0,
          fire: ft != null ? Math.max(0, 1 - (time - ft) / 0.35) : 0, air: (u.z || 0), rage: !!(u.flags & UF.RAGE),
        };
        if (u.flags & UF.DOWN || u.anim === ANIM.KO) m.dying = 0.5;
        R.drawMonster(m);
        lastMon.set(u.id, m);
        if (m.rage && !m.dying) {
          // 화난 몬스터(U21): 빨강 · 흰색이 번갈아 깜빡이는 굵은 고리 + 머리 위 "!"(경보 말투)
          const rr = (K.radius || 0.9) * 4 * (scale / (MONSTER_KINDS[kind].scale || 1)) + 1.2;
          const on = Math.floor(time * 6) % 2 === 0;
          R.decal(X, 0.04, Z, rr + 0.4, rr + 0.4, 0x05030a, 0.8, SHAPE.RING, 0.16, MODE.FLAT, 0.03);
          R.decal(X, 0.045, Z, rr, rr, on ? 0xff3b4e : 0xffffff, 0.95, SHAPE.RING, 0.12, MODE.FLAT, 0.031, 1.4);
          const g = (time * 1.2) % 1;
          R.decal(X, 0.04, Z, rr * (1 + g * 0.6), rr * (1 + g * 0.6), 0xff3b4e, 0.7 * (1 - g), SHAPE.RING, 0.06, MODE.FLAT, 0.03, 1.2);
          tags.push({ id: -500 - u.id, x: u.x, y: u.y, h: 1.1 + scale * 1.5, name: "!", team: -1, color: "#ffffff", self: false, hp: null, gem: false, alarm: true });
        }
        if (pet && u.owner === world.you && !m.dying) markMine(u, 1.2 + scale * 1.25);
        if (pet) {
          // 내 몬스터 표시: 발밑 팀 색 고리 + 레벨 점
          const rr = (K.radius || 0.4) * 2 * 2 * petScale(u.info) + 0.4;
          R.decal(X, 0.03, Z, rr, rr, teamHex(u.team), 0.75, SHAPE.RING, 0.08, MODE.FLAT, 0.02, 0.6);
          for (let k = 0; k < (u.info || 1); k++) R.decal(X - ((u.info || 1) - 1) * 0.22 + k * 0.44, 0.04, Z + rr / 2 + 0.25, 0.3, 0.3, teamHex(u.team), 0.95, SHAPE.STAR, 0, MODE.FLAT, 0.03, 0.8);
        }
      }
    }
    flushMine();
    for (const id of prev.keys()) if (!seen.has(id) && prev.get(id).seen < time - 1) prev.delete(id);
    for (const id of lastMon.keys()) if (!seen.has(id) && (prev.get(id)?.seen ?? 0) < time - 0.5) lastMon.delete(id);
    // 코어 금광: 자리(SLOTS)가 다 찼으면 머리 위에 "2/2"
    (map.cores || []).forEach((c, i) => {
      const k = coreMiners[i] || 0;
      if (k >= CORE_MINE.SLOTS && visible(c.tx + 1, c.ty + 1, 1.5)) tags.push({ id: -100 - i, x: c.tx + 1, y: c.ty + 1, h: 3.2, name: `코어 ${Math.min(k, CORE_MINE.SLOTS)}/${CORE_MINE.SLOTS} 가득`, team: -1, color: "#d9a8ff", self: false, hp: null, gem: false });
    });
    // 쓰러지는 몬스터
    for (let i = dying.length - 1; i >= 0; i--) {
      const d = dying[i];
      const k = (time - d.t0) / 0.8;
      if (k >= 1) { dying.splice(i, 1); continue; }
      const dm = d.m;
      dm.dying = k; dm.moving = 0; dm.windup = -1; dm.fire = 0;
      R.drawMonster(dm);
    }
    // 내 영웅(내 브라우저의 몸)
    const h = f.hero;
    if (h && h.local && h.alive) {
      const X = toW(h.x), Z = toW(h.y);
      const p = trackVel(h.id, X, Z, dt);
      if (h.throwPose) R.actor.throwPose(h.id);
      const me = f.me || {};
      const flags = FLAG.ALIVE | (h.charging ? FLAG.CHARGING : 0) | (h.dash ? FLAG.DASHING : 0) | (h.slow ? FLAG.SLOWED : 0) | (me.invuln > 0 ? FLAG.INVULN : 0) | (h.z <= 0.01 ? FLAG.GROUNDED : 0);
      R.drawPlayer({
        id: h.id, x: X, y: h.z, z: Z, vx: p.vx, vy: 0, vz: p.vz, aim: h.facing, flags, charge: h.charge,
        color: teamIdx(world.team), team: world.team, char: world.charOf(world.you), pattern: -1, size: 1,
        boost: me.boost || 0, shield: me.shield || 0, range: 0,
      }, { self: true });
      tags.push({ id: h.id, x: h.x, y: h.y, h: DOLL_TOP + h.z + 0.5, name: world.playerName(world.you), team: world.team, self: true, hp: me.maxHp ? me.hp / me.maxHp : 1, gem: me.carry > 0 });
    }
  }

  function headOf(view, f, id) {
    if (f.hero && id === f.hero.id && f.hero.local) return f.hero.alive ? { x: f.hero.x, y: f.hero.y, h: DOLL_TOP + f.hero.z } : null;
    const u = view.byId.get(id);
    if (!u) return null;
    const size = u.type === UTYPE.BOT ? 0.75 : u.type === UTYPE.WORKER ? 0.8 : 1;
    return { x: u.x, y: u.y, h: DOLL_TOP * size + (u.z || 0) };
  }

  function drawGems(view, f) {
    for (const g of view.gems) {
      const hex = GEM_HEX(g.value);
      if (g.state === 1) {
        const hd = headOf(view, f, g.carrier) || { x: g.x, y: g.y, h: DOLL_TOP };
        const X = toW(hd.x), Z = toW(hd.y);
        R.model("realm/gem", X, hd.h + 0.65 + Math.sin(time * 4 + g.id) * 0.08, Z, time * 2.2, hex, 1.35);
        R.decal(X, hd.h + 0.65, Z, 1.6, 1.6, hex, 0.25 + 0.15 * Math.sin(time * 6), SHAPE.DISC, 0, MODE.FACE, 0.3, 1.2);
      } else {
        if (!onScreen(g.x, g.y) || !visible(g.x, g.y, 1)) continue;
        const X = toW(g.x), Z = toW(g.y);
        const blink = g.timer > 0 && g.timer < 8 && Math.sin(time * 10) < -0.2;
        if (!blink) R.model("realm/gem", X, 0.85 + Math.sin(time * 3 + g.id) * 0.15, Z, time * 1.6 + g.id, hex, 1.6);
        R.decal(X, 0.03, Z, 2.2, 2.2, hex, 0.55 + 0.2 * Math.sin(time * 4), SHAPE.RING, 0.12, MODE.FLAT, 0.02, 0.9);
        R.decal(X, 0.025, Z, 1.6, 1.1, 0x000000, 0.25, SHAPE.DISC, 0, MODE.FLAT, 0.01);
      }
    }
  }

  function drawItemsProjs(view) {
    for (const it of view.items) {
      if (!onScreen(it.x, it.y) || !visible(it.x, it.y)) continue;
      R.drawItem(toW(it.x), toW(it.y), (ITEMS[it.kind] || ITEMS[0]).brawl);
    }
    for (const p of view.projs) {
      if (!onScreen(p.x, p.y) || !visible(p.x, p.y)) continue;
      const X = toW(p.x), Z = toW(p.y);
      const dx = Math.cos(p.dir), dz = Math.sin(p.dir);
      if (p.kind >= 100) R.drawMonsterShot({ x: X, y: 0.9, z: Z, kind: Math.min(7, p.kind - 100), dx, dz, r: 0.45, id: p.id });
      else {
        const W = WEAPONS[p.kind] || WEAPONS[3];
        R.drawBalloon(X, MISSILE.HEIGHT, Z, { big: false, color: teamIdx(p.team), kind: W.brawl, dx, dz });
        if (Math.random() < 0.3) R.fx.drip(X - dx * 0.5, MISSILE.HEIGHT, Z - dz * 0.5, teamIdx(p.team));
      }
    }
  }

  function drawArcs() {
    const t = now();
    for (let i = arcs.length - 1; i >= 0; i--) {
      const a = arcs[i];
      const s = (t - a.t0) / a.T;
      if (s >= 1) { arcs.splice(i, 1); continue; }
      const X = toW(a.x0 + (a.x1 - a.x0) * s), Z = toW(a.y0 + (a.y1 - a.y0) * s);
      const W = WEAPONS[a.w] || WEAPONS[0];
      const color = teamIdx(a.team);
      if (a.direct) {
        R.drawBalloon(X, MISSILE.HEIGHT, Z, { big: false, color, kind: W.brawl, dx: a.x1 - a.x0, dz: a.y1 - a.y0 });
        continue;
      }
      const d = Math.hypot(a.x1 - a.x0, a.y1 - a.y0);
      const y = a.z0 * (1 - s) + 4 * flightApex(d) * s * (1 - s);
      R.drawBalloon(X, y, Z, { big: a.big, color, kind: W.brawl });
      if (W.nuke) R.drawBombMark(toW(a.x1), toW(a.y1), (a.big ? 3.3 : 2.1) * (W.splash || 1), s, color);
    }
  }

  function drawMarks(dt) {
    const t = now();
    for (let i = warns.length - 1; i >= 0; i--) {
      const w = warns[i];
      if (t > w.until) { warns.splice(i, 1); continue; }
      const k = Math.min(1, (t - w.t0) / Math.max(0.05, w.until - w.t0));
      const p = 0.6 + 0.4 * Math.sin(t * 14);
      if (w.shape === "wave") {
        for (let j = 0; j < 2; j++) R.decal(w.X, 0.04, w.Z, w.r * 2 * (0.3 + 0.7 * ((k + j * 0.5) % 1)), w.r * 2 * (0.3 + 0.7 * ((k + j * 0.5) % 1)), WARN_HEX(t), 0.7 * p, SHAPE.RING, 0.05, MODE.FLAT, 0.025, 0.8);
      } else {
        R.decal(w.X, 0.03, w.Z, w.r * 2 * k, w.r * 2 * k, 0xff3b4e, 0.28, SHAPE.DISC, 0, MODE.FLAT, 0.02, 0.5);
        R.decal(w.X, 0.035, w.Z, w.r * 2, w.r * 2, WARN_HEX(t), 0.9 * p, SHAPE.RING, 0.06, MODE.FLAT, 0.025, 0.8);
      }
    }
    // 경보: 검은 테 위에 흰 · 노랑이 번갈아 깜빡이는 고리가 퍼지고, 머리 위에 "!" 이름표
    for (let i = alarms.length - 1; i >= 0; i--) {
      const a = alarms[i];
      const k = t - a.t0;
      if (k > ALARM_LIFE) { alarms.splice(i, 1); continue; }
      const on = Math.floor(k / 0.16) % 2 === 0;
      for (let j = 0; j < 2; j++) {
        const q = (k * 0.9 + j * 0.5) % 1;
        const d = 2 + q * 8;
        R.decal(a.X, 0.05, a.Z, d, d, 0x05030a, 0.85 * (1 - q), SHAPE.RING, 0.2, MODE.FLAT, 0.03);
        R.decal(a.X, 0.055, a.Z, d, d, on ? 0xffffff : 0xffe600, 0.95 * (1 - q), SHAPE.RING, 0.1, MODE.FLAT, 0.031, 1.2);
      }
      tags.push({ id: -200 - i, x: a.x, y: a.y, h: 4.2, name: "!", team: -1, color: "#ffffff", self: false, hp: null, gem: false, alarm: true });
    }
    for (let i = pulls.length - 1; i >= 0; i--) {
      const v = pulls[i];
      if (t > v.until) { pulls.splice(i, 1); continue; }
      R.drawVortex({ x: v.X, z: v.Z, r: v.r, color: teamIdx(v.team ?? 4) });
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { rings.splice(i, 1); continue; }
      const d = (r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k))) * 2;
      R.decal(r.X, 0.05, r.Z, d, d, r.hex, 1 - k, SHAPE.RING, 0.08, MODE.FLAT, 0.03, 0.7);
    }
  }

  function drawOverlays(view, f) {
    const ui = f.ui || {};
    const sel = ui.selected || new Set();
    const myTeam = world.team;
    const hpHex = (v) => (v > 0.6 ? 0x39ff88 : v > 0.3 ? 0xffd23f : 0xff3b4e);
    const bar = (X, Y, Z, w, frac, hex) => {
      R.decal(X, Y, Z, w + 0.14, 0.3, 0x120c22, 0.92, SHAPE.RECT, 0, MODE.FACE, 0.5);
      const fw = Math.max(0.02, w * Math.max(0, Math.min(1, frac)));
      R.decal(X - (w - fw) / 2, Y, Z, fw, 0.18, hex, 1, SHAPE.RECT, 0, MODE.FACE, 0.52, 0.4);
    };
    for (const u of view.units) {
      if (u.id === f.hero?.id && f.hero?.local) continue;
      if (!onScreen(u.x, u.y)) continue;
      if (u.team !== myTeam && !(u.flags & (UF.GEM | UF.RAGE)) && !visible(u.x, u.y)) continue;
      const X = toW(u.x), Z = toW(u.y);
      const on = sel.has(u.id), hov = ui.hover === u.id;
      const monster = u.type === UTYPE.PET || u.type === UTYPE.NPC;
      const rad = monster ? (MONSTERS[u.sub]?.radius || 0.4) * 2 * (u.type === UTYPE.PET ? petScale(u.info) : 1) + 0.5 : u.type === UTYPE.HERO ? 1.2 : 0.95;
      if (on || hov) {
        const hex = hov && !on ? 0xffffff : u.team === myTeam ? (u.owner === world.you ? 0x39ff88 : 0x7fe3ff) : u.team === NEUTRAL ? 0xffe600 : 0xff3b4e;
        R.decal(X, 0.035, Z, rad * 2, rad * 2, hex, 0.95, SHAPE.RING, 0.14, MODE.FLAT, 0.03, 0.6);
      }
      if (u.owner === world.you && u.flags & UF.SQUAD && !on) R.decal(X, 0.035, Z, rad * 1.6, rad * 1.6, 0x39ff88, 0.4, SHAPE.RING, 0.08, MODE.FLAT, 0.03, 0.4);
      // 체력 막대: 몬스터는 몬스터 모델이 직접 그린다. 인형은 다쳤거나 골랐을 때 · 영웅은 이름표(HUD)가 그린다
      if (!monster && u.type !== UTYPE.HERO && (on || hov || u.hp < 0.999)) {
        const size = u.type === UTYPE.WORKER ? 0.8 : 0.75;
        bar(X, DOLL_TOP * size + 0.55 + (u.z || 0), Z, 1.3, u.hp, hpHex(u.hp));
      }
    }
    for (const b of view.buildings) {
      const s = BUILDINGS[b.kind].size;
      if (!onScreen(b.tx + s / 2, b.ty + s / 2, s / 2 + 2)) continue;
      const X = toW(b.tx + s / 2), Z = toW(b.ty + s / 2);
      const on = sel.has(b.id), hov = ui.hover === b.id;
      if (on || hov) R.decal(X, 0.05, Z, s * 2 + 1.4, s * 2 + 1.4, hov && !on ? 0xffffff : b.team === myTeam ? 0x39ff88 : 0xff3b4e, 0.9, SHAPE.RING, 0.06, MODE.FLAT, 0.03, 0.6);
      const built = b.flags & BF.BUILT;
      if (on || hov || b.hp < 0.999 || !built) {
        const Y = BHEIGHT[b.kind] + (b.kind === BLD.TOWER ? 1.4 : 0.9);
        bar(X, Y, Z, s * 1.4, b.hp, b.flags & (BF.BROKEN | BF.DOWN) ? 0x7a6fa0 : hpHex(b.hp));
        if (!built) bar(X, Y - 0.4, Z, s * 1.4, b.progress, 0xffd23f);
      }
    }
    // 놓을 자리(공급소 짓기)
    if (ui.place) {
      const { tx, ty, ok } = ui.place;
      const s = BUILDINGS[BLD.SUPPLY].size;
      // U18: 일꾼 바로 옆(자리 가장자리가 BUILD_NEAR 안)만 — 자리 가운데가 들어갈 수 있는 곳을 일꾼마다 둥근 네모로
      for (const w of ui.place.zones || []) roundRect(toW(w.x), toW(w.y), s, (BUILD_NEAR + UNITS.worker.radius) * 2, 0xa8ff00, 0, 0.6 + 0.3 * Math.sin(time * 4), 0.9, 0.14);
      if (!ok && ui.place.why) tags.push({ id: -400, x: tx + s / 2, y: ty + s / 2, h: 4.4, name: ui.place.why === "far" ? "일꾼 바로 옆에만 지어요" : "여기는 못 지어요", team: -1, color: "#ff8a95", self: false, hp: null, gem: false });
      const X = toW(tx + s / 2), Z = toW(ty + s / 2);
      const hex = ok ? 0x39ff88 : 0xff3b4e;
      // [왕국전] 건물 받침이 둥글어져 놓을 자리 표시도 둥근 판 + 고리
      R.decal(X, 0.03, Z, s * 2, s * 2, hex, 0.3, SHAPE.DISC, 0, MODE.FLAT, 0.02, 0.4);
      R.decal(X, 0.035, Z, s * 2, s * 2, hex, 0.9, SHAPE.RING, 0.05, MODE.FLAT, 0.025, 0.7);
      R.model("realm/supply", X, -1.4, Z, 0, hex, 1);
    }
    // 내 영웅: 골랐으면 발밑 고리 · 걷는 중이면 점선 길과 끝 표시(U20)
    if (f.hero?.alive && f.hero.local) {
      const X = toW(f.hero.x), Z = toW(f.hero.y);
      if (ui.heroSel) R.decal(X, 0.035, Z, 2.4, 2.4, 0x39ff88, 0.95, SHAPE.RING, 0.14, MODE.FLAT, 0.03, 0.6);
      const wk = ui.walk;
      if (wk && wk.path.length) {
        let ax = f.hero.x, ay = f.hero.y, budget = 48;
        const ph = (time * 1.4) % 1; // 점들이 앞으로 흐른다
        for (let i = wk.k; i < wk.path.length && budget > 0; i++) {
          const p = wk.path[i];
          const d = Math.hypot(p.x - ax, p.y - ay);
          for (let s2 = (ph * 0.6) % 0.6 + 0.3; s2 < d && budget > 0; s2 += 0.6, budget--) {
            const q = s2 / d;
            R.decal(toW(ax + (p.x - ax) * q), 0.04, toW(ay + (p.y - ay) * q), 0.26, 0.26, 0x39ff88, 0.7, SHAPE.DISC, 0, MODE.FLAT, 0.03, 0.8);
          }
          ax = p.x; ay = p.y;
        }
        const EX = toW(wk.endX), EZ = toW(wk.endY);
        const g = (time * 1.6) % 1;
        R.decal(EX, 0.04, EZ, 1.6, 1.6, 0x39ff88, 0.9, SHAPE.RING, 0.18, MODE.FLAT, 0.03, 1);
        R.decal(EX, 0.04, EZ, 1.6 + g * 1.6, 1.6 + g * 1.6, 0x39ff88, 0.6 * (1 - g), SHAPE.RING, 0.1, MODE.FLAT, 0.03, 1);
        R.decal(EX, 0.045, EZ, 0.45, 0.45, 0xffffff, 0.95, SHAPE.DISC, 0, MODE.FLAT, 0.032, 1.2);
      }
    }
    // 자동 팀 구성: 내 영웅 둘레 진형 고리(오른쪽 클릭이 "따라와"가 되는 범위)
    if (ui.followRing && f.hero?.alive) {
      const X = toW(f.hero.x), Z = toW(f.hero.y);
      const r = SQUAD.ORDER_RIGHT_R * 2 * 2;
      const hot = ui.followRing === "hot";
      // 시작각은 라디안 — 여덟 토막이 천천히 돈다
      for (let k = 0; k < 8; k++) R.decalArc(X, 0.04, Z, r / 2, 0.08, 0x39ff88, hot ? 0.95 : 0.5, 0.07, 0.03, (k / 8 + time * 0.05) * Math.PI * 2);
      if (hot) R.decal(X, 0.03, Z, r, r, 0x39ff88, 0.12, SHAPE.DISC, 0, MODE.FLAT, 0.02, 0.3);
    }
    // 조준
    if (ui.aim) R.drawAim(ui.aim.brawl);
    for (const r of ui.rings || []) rings.push({ X: toW(r.x), Z: toW(r.y), hex: r.hex, r0: r.r0 ?? 0.9, r1: r.r1 ?? 0.2, life: r.life ?? 0.45, t: 0 });
    if (ui.rings) ui.rings.length = 0;
  }

  return {
    /** 내 일꾼이 한 번 캐기를 마쳤을 때 "+N" 을 띄울 곳(HUD) */
    set onPop(fn) { hooks.onPop = fn; },
    /** [소리] 일꾼 곡괭이 · 망치 · 들통이 닿는 순간(화면 안 일꾼만) — src/audio/game.js 가 단다 */
    set onWork(fn) { hooks.onWork = fn; },
    R,
    setWorld, setBackdrop,
    dispose() { world = null; clearFx(); },
    render, onFx, predictArc,
    /** 경보 표시(우리 건물이 맞는다 · 무너졌다 — 지도 칸) */
    alarm(x, y) {
      if (alarms.length > 6) alarms.shift();
      alarms.push({ x, y, X: toW(x), Z: toW(y), t0: now() });
    },
    screenToGround, project, viewCorners,
    lookAt, follow, camCenter,
    snap: () => R.snap(),
    get viewTiles() { return viewTiles; },
    setViewTiles,
    zoom(k) { setViewTiles(viewTiles * k); },
    get cam() { return { x: camX, y: camY }; },
    /** 이번 프레임에 그린 영웅 이름표(지도 칸 · 머리 높이 u) — HUD 가 DOM 으로 */
    tags,
    toW, fromW,
    teamIdx,
  };
}
