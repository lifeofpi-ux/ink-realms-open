// 경기 시뮬레이션 시험(docs/DESIGN.md v2.1) — 규약 · 영웅 움직임 검사 · 던지기 · 잉크 · 캐기 · 랩 · 퍼실리티 · 보석 · 탑 · 상자 · 몬스터 · 컴퓨터
import test from "node:test";
import assert from "node:assert/strict";
import { Game, rectDist, GUARD } from "../server/game.js";
import { createQuizbook } from "../server/quizbook.js";
import { Grid, findPath, nearestFree, lineClear } from "../shared/path.js";
import { encodeSnapshot, decodeSnapshot, PHASE, ANIM, UF, BF, HEAD, SNAP } from "../shared/protocol.js";
import {
  TICK, TILE, UTYPE, INK, HERO, GEM, SITE_STATE, TOWER, WEAPON, UNITS, CORE_MINE, MONSTERS, MONSTER_TIERS, PET, NPC, BLD,
  QUIZ, BOT, CRATE_HP, DRILL, shotInk, flightTime, hatchCost, petHp, START, GOAL, WEAPONS, STACK, stackMax, MAX_TEAMS, MAX_PER_TEAM, BUILD_NEAR,
} from "../shared/constants.js";
import { SEED_SETS } from "../shared/quizseed.js";

const QS = SEED_SETS[0].questions;

// ───────────── 도우미 ─────────────
/** 경기 하나를 세기(3초) 끝까지 돌려 둔다. bots = 자리마다 컴퓨터인가(기본: 모두 사람) · npc = 중립 몬스터를 남기나 */
function setup({ teams = 2, per = 1, bots = null, mode = "arcade", map = "forest", seed = 11, npc = false, minutes = 10 } = {}) {
  const players = [];
  for (let t = 0; t < teams; t++) for (let k = 0; k < per; k++) players.push({ name: `p${t}${k}`, team: t, bot: bots ? !!bots[players.length] : false });
  const inbox = players.map(() => []);
  const box = { ended: null };
  const g = new Game({
    seed, teams, players, minutes, map, mode, questions: mode === "quiz" ? QS : [],
    send: (slot, d) => inbox[slot].push(d), onEnd: (r) => { box.ended = r; },
  });
  // 중립 몬스터를 치운다(캠프 alive 를 그대로 두면 다시 나오지 않는다)
  if (!npc) for (const u of [...g.units.values()]) if (u.type === UTYPE.NPC) g.units.delete(u.id);
  while (g.phase !== PHASE.PLAY) g.step();
  const json = (slot, t) => inbox[slot].filter((m) => !(m instanceof ArrayBuffer) && (!t || m.t === t));
  const fxOf = (slot, k) => json(slot, "fx").flatMap((m) => m.e).filter((e) => !k || e.k === k);
  const run = (sec) => { for (let i = 0, n = Math.round(sec / TICK); i < n && !g.over; i++) g.step(); };
  const clear = () => { for (const q of inbox) q.length = 0; };
  return { g, inbox, json, fxOf, run, clear, box };
}

/** 유닛을 서버 쪽에서 옮긴다(영웅이면 다음 보고의 기준점도) */
function put(g, u, x, y) {
  u.x = x; u.y = y; u.px = x; u.py = y; u.vxe = 0; u.vye = 0; u.path = null;
  if (u.mv) u.mv.at = g.time;
}

/** (x, y) 둘레에서 room 칸 안이 모두 빈 칸 가운데 */
function openSpot(g, x, y, room = 1) {
  const R = Math.ceil(room);
  for (let r = 0; r < 24; r += 0.5)
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const cx = Math.floor(x + Math.cos(a) * r), cy = Math.floor(y + Math.sin(a) * r);
      let ok = true;
      for (let dy = -R; dy <= R && ok; dy++) for (let dx = -R; dx <= R && ok; dx++) if (!g.grid.passable(cx + dx, cy + dy)) ok = false;
      if (ok) return { x: cx + 0.5, y: cy + 0.5 };
    }
  throw new Error("빈 자리가 없어요");
}

/** 두 본진 탑에서 멀리 떨어진 빈 터(맞붙기용) */
function arena(g, room = 3) {
  const b0 = g.map.bases[0], C = g.S / 2;
  const p = openSpot(g, (b0.cx + C) / 2, (b0.cy + C) / 2, room);
  for (const T of g.teams) {
    const tw = g.buildings.get(T.towerId);
    assert.ok(Math.hypot(tw.cx - p.x, tw.cy - p.y) > TOWER.RANGE + 6, "맞붙는 곳은 탑 사거리 밖");
  }
  return p;
}

/** 몸(반 폭 0.3)이 설 수 있는 곳인가 */
const standable = (g, x, y) => [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].every(([dx, dy]) => g.grid.passable(Math.floor(x + dx), Math.floor(y + dy)));

/** 섹션 s 가운데에서 dist 쯤 떨어진, 영웅이 설 수 있는 곳 */
function nearSite(g, s, dist = 3.5) {
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const x = s.x + Math.cos(a) * dist, y = s.y + Math.sin(a) * dist;
    if (standable(g, x, y)) return { x, y };
  }
  throw new Error("섹션 곁에 설 곳이 없어요");
}

/** 건물 b 가장자리에서 gap 칸 떨어진 빈 곳 */
function besideBuilding(g, b, gap = 0.8) {
  const pts = [];
  for (let k = 0; k <= 8; k++) {
    const f = b.tx + 0.3 + ((b.size - 0.6) * k) / 8;
    const e = b.ty + 0.3 + ((b.size - 0.6) * k) / 8;
    pts.push([f, b.ty - gap], [f, b.ty + b.size + gap], [b.tx - gap, e], [b.tx + b.size + gap, e]);
  }
  for (const [x, y] of pts) if (standable(g, x, y)) return { x, y };
  throw new Error("건물 곁에 빈 곳이 없어요");
}

const removeWorkers = (g, slot) => { for (const u of [...g.units.values()]) if (u.type === UTYPE.WORKER && (slot == null || u.owner === slot)) g.units.delete(u.id); };
const unitsOf = (g, slot, type) => [...g.units.values()].filter((u) => u.owner === slot && u.type === type && !u.dead);

// ───────────── 규약 · 길 찾기 · 퀴즈 줄 ─────────────
test("규약: 스냅숏을 담고 풀면 같은 값(1/64칸 안)", () => {
  const s = {
    tick: 1234, timeLeft: 599.2, phase: PHASE.PLAY, teams: 8, scores: [3, 0, 9, 1, 2, 4, 7, 10],
    units: [
      { id: 7, type: UTYPE.HERO, team: 1, owner: 2, sub: 5, info: WEAPON.missile, x: 10.5, y: 20.25, z: 1.3, facing: 1.2, hp: 50, maxHp: 100, anim: ANIM.CHARGE, animT: 0.5, flags: UF.GEM | UF.SQUAD | UF.DOWN },
      { id: 900, type: UTYPE.NPC, team: 255, owner: -1, sub: 2, info: 0, x: 63.9, y: 0.1, z: 0, facing: -2, hp: 900, maxHp: 900, anim: ANIM.WIND, animT: 1, flags: UF.RAGE },
    ],
    buildings: [{ id: 3, kind: 0, team: 1, tx: 12, ty: 40, hp: 1250, maxHp: 2500, progress: 0.4, flags: BF.BUILT | BF.DOWN, level: 2, timer: 17.2 }],
    sites: [{ id: 2, state: SITE_STATE.QUIZ, shield: 0, rock: 1, team: 1, timer: 12.5, value: 2 }],
    gems: [{ id: 2, state: 1, carrier: 7, x: 10.5, y: 20.25, value: 2, timer: 0 }, { id: 0, state: 0, carrier: -1, x: 5, y: 6, value: 1, timer: 29.1 }],
    projs: [{ id: 40000, kind: 105, team: 255, x: 30.2, y: 31.7, dir: 3 }],
    items: [{ id: 5, kind: 2, x: 8.5, y: 9.5 }],
  };
  const buf = encodeSnapshot(s);
  const d = decodeSnapshot(buf);
  assert.equal(SNAP, 3);
  assert.equal(HEAD, 27, "머리 27바이트(팀 점수 8칸)");
  assert.equal(encodeSnapshot({ tick: 1, teams: 2 }).byteLength, HEAD);
  assert.equal(buf.byteLength, HEAD + 2 * 18 + 11 + 8 + 2 * 10 + 9 + 7);
  assert.equal(d.tick, 1234);
  assert.equal(d.timeLeft, 600);
  assert.equal(d.teams, 8);
  assert.deepEqual(d.scores, [3, 0, 9, 1, 2, 4, 7, 10], "팀 점수 8칸");
  assert.equal(decodeSnapshot(encodeSnapshot({ tick: 1, teams: 2, scores: [5, 6] })).scores.length, MAX_TEAMS);
  const [h, m] = d.units;
  assert.equal(h.id, 7); assert.equal(h.owner, 2); assert.equal(h.info, WEAPON.missile); assert.equal(h.flags, UF.GEM | UF.SQUAD | UF.DOWN);
  assert.ok(Math.abs(h.x - 10.5) < 1 / 64 && Math.abs(h.y - 20.25) < 1 / 64);
  assert.ok(Math.abs(h.z - 1.3) < 0.05);
  assert.ok(Math.abs(h.hp - 0.5) < 0.01);
  assert.equal(m.owner, -1); assert.equal(m.team, 255); assert.equal(m.hp, 1);
  assert.equal(d.buildings[0].flags, BF.BUILT | BF.DOWN); assert.equal(d.buildings[0].timer, 18); assert.equal(d.buildings[0].level, 2);
  assert.deepEqual([d.sites[0].state, d.sites[0].team, d.sites[0].value, d.sites[0].timer], [SITE_STATE.QUIZ, 1, 2, 13]);
  assert.equal(d.gems[0].carrier, 7); assert.equal(d.gems[1].carrier, -1); assert.equal(d.gems[1].timer, 30);
  assert.equal(d.projs[0].kind, 105); assert.equal(d.projs[0].id, 40000);
  assert.deepEqual([d.items[0].kind, d.items[0].x, d.items[0].y], [2, 8.5, 9.5]);
});

test("규약: 진짜 경기의 팀 시야 스냅숏이 풀리고, start · me · team 이 규약의 칸을 담는다", () => {
  const { g, json } = setup({ teams: 3 });
  const v = g.viewOf(0);
  const d = decodeSnapshot(encodeSnapshot(v));
  assert.equal(d.units.length, v.units.length);
  assert.equal(d.buildings.length, 12, "팀마다 탑 · 공급소 · 랩 · 퍼실리티");
  assert.equal(d.sites.length, 4);
  assert.ok(d.units.some((u) => u.type === UTYPE.HERO && u.owner === 0));
  assert.ok(!d.units.some((u) => u.type === UTYPE.HERO && u.team === 2), "보이지 않는 적 영웅은 보내지 않는다");
  const st = g.startInfo(1);
  for (const k of ["seed", "teams", "map", "mode", "minutes", "goal", "you", "players", "crates"]) assert.ok(k in st, `start.${k}`);
  assert.equal(st.map, "forest"); assert.equal(st.mode, "arcade"); assert.equal(st.goal, GOAL); assert.equal(st.you, 1);
  assert.ok(st.players.every((p) => Number.isInteger(p.char)));
  const me = json(0, "me").at(-1);
  for (const k of ["hp", "maxHp", "tank", "ink", "w", "cd", "bombCd", "dead", "carry", "kos", "deaths", "delivered", "heroId", "pet", "counts", "queue", "lock", "inv"]) assert.ok(k in me, `me.${k}`);
  assert.equal(me.inv.length, WEAPONS.length);
  assert.ok(me.inv.every((v) => v === 0), "처음 소지품은 비어 있다(기본 잉크는 끝이 없다)");
  assert.equal(me.tank, INK.TANK); assert.equal(me.pet.state, "none"); assert.equal(me.counts.worker, START.workers);
  const team = json(0, "team").at(-1);
  for (const k of ["ink", "gold", "core", "lab", "fac", "supplies", "score", "kos"]) assert.ok(k in team, `team.${k}`);
  assert.deepEqual([team.gold, team.core], [START.gold, START.core]);
  assert.deepEqual(team.lab.unlocked, [0], "처음에는 기본 잉크만");
});

test("길 찾기: 벽을 돌아가고, 네모 목표에는 옆 칸에서 멈춘다", () => {
  const g = new Grid(20);
  for (let y = 0; y < 15; y++) g.block[y * 20 + 10] = 1;
  const path = findPath(g, 2.5, 2.5, { x: 17.5, y: 2.5 });
  const end = path[path.length - 1];
  assert.ok(Math.hypot(end.x - 17.5, end.y - 2.5) < 0.01);
  assert.ok(path.some((p) => p.y > 14), "벽 아래로 돌아간다");
  const rp = findPath(g, 2.5, 18.5, { rect: { tx: 15, ty: 15, size: 3 } });
  const e = rp[rp.length - 1];
  const fx = Math.floor(e.x), fy = Math.floor(e.y);
  assert.ok(fx >= 14 && fx <= 18 && fy >= 14 && fy <= 18 && !(fx >= 15 && fx <= 17 && fy >= 15 && fy <= 17));
  assert.deepEqual(nearestFree(g, 10.5, 3.5), { x: 9.5, y: 3.5 });
});

test("퀴즈 줄: 맞힌 문제는 맨 뒤, 틀린 문제는 두 문제 뒤, 그냥 나오면 맨 앞", () => {
  const book = createQuizbook(QS, 2, () => 0.5);
  const first = book.take(0);
  book.result(0, first, true);
  assert.equal(book.line(0).at(-1), first);
  const second = book.take(0);
  book.result(0, second, false);
  assert.equal(book.line(0)[QUIZ.WRONG_GAP], second);
  const third = book.take(0);
  book.giveBack(0, third);
  assert.equal(book.line(0)[0], third);
  assert.equal(book.line(1).length, QS.length, "팀마다 줄이 따로");
});

// ───────────── 영웅 움직임 검사(§3 · §15) ─────────────
test("영웅 움직임: 걷는 보고는 받고, 순간 이동 · 벽 뚫기는 되돌린다(warp). 대시는 더 멀리 받는다", () => {
  const { g, json, run, clear } = setup();
  const h = g.heroOf(0);
  const p = arena(g, 4);
  put(g, h, p.x, p.y);
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const clearDir = (len) => dirs.find(([dx, dy]) => lineClear(g.grid, h.x, h.y, h.x + dx * len, h.y + dy * len, 0.35));
  run(0.5);
  clear();
  // 0.5초에 1.2칸 — 받는다
  const [dx, dy] = clearDir(1.5);
  const want = { x: h.x + dx * 1.2, y: h.y + dy * 1.2 };
  g.command(0, { t: "mv", x: want.x, y: want.y, z: 0, f: 0, d: 0, c: 0.4 });
  g.step();
  assert.ok(Math.abs(h.x - want.x) < 1e-9 && Math.abs(h.y - want.y) < 1e-9, "걸은 위치를 받는다");
  assert.equal(json(0, "warp").length, 0);
  assert.equal(h.c, 0.4, "충전 정도도 받는다");
  // 순간 이동 — 되돌린다
  const before = { x: h.x, y: h.y };
  g.command(0, { t: "mv", x: h.x + 12, y: h.y, z: 0, f: 0, d: 0 });
  g.step();
  assert.deepEqual({ x: h.x, y: h.y }, before);
  const w = json(0, "warp").at(-1);
  assert.ok(w && Math.abs(w.x - h.x) < 0.01 && Math.abs(w.y - h.y) < 0.01, "서버 위치로 warp");
  // 대시: d=1 이면 걷기 몫 + 대시 몫까지
  run(1);
  put(g, h, p.x, p.y);
  run(0.3);
  const [ex, ey] = clearDir(3.6);
  const far = HERO.SPEED * 0.3 * HERO.SLACK + HERO.PAD + 0.8;
  clear();
  g.command(0, { t: "mv", x: h.x + ex * far, y: h.y + ey * far, z: 0, f: 0, d: 0 });
  g.step();
  assert.equal(json(0, "warp").length, 1, "대시 없이는 너무 멀다");
  run(0.3);
  clear();
  g.command(0, { t: "mv", x: h.x + ex * far, y: h.y + ey * far, z: 0, f: 0, d: 1 });
  g.step();
  assert.equal(json(0, "warp").length, 0, "대시로는 받는다");
  // 벽(우리 탑) 안으로 — 되돌린다
  const tower = g.tower(0);
  const spot = besideBuilding(g, tower, 0.7);
  put(g, h, spot.x, spot.y);
  run(1);
  clear();
  const tx = Math.min(Math.max(h.x, tower.tx + 0.5), tower.tx + tower.size - 0.5), ty = Math.min(Math.max(h.y, tower.ty + 0.5), tower.ty + tower.size - 0.5);
  g.command(0, { t: "mv", x: tx, y: ty, z: 0, f: 0, d: 0 });
  g.step();
  assert.equal(json(0, "warp").length, 1, "건물 안으로는 못 들어간다");
  assert.deepEqual({ x: h.x, y: h.y }, spot);
});

test("영웅 움직임: 세기 중 · 쓰러진 동안의 보고는 무시한다", () => {
  const players = [{ name: "a", team: 0, bot: false }, { name: "b", team: 1, bot: false }];
  const g = new Game({ seed: 3, teams: 2, players, send() {}, onEnd() {} });
  const h = g.heroOf(0);
  const x0 = h.x;
  g.command(0, { t: "mv", x: h.x + 0.5, y: h.y });
  g.step();
  assert.equal(h.x, x0, "세기 중");
  while (g.phase !== PHASE.PLAY) g.step();
  g.kill(h, { team: 1, unit: 0, slot: 1 });
  g.command(0, { t: "mv", x: h.x + 0.5, y: h.y });
  g.step();
  assert.equal(h.x, x0, "쓰러진 동안");
});

// ───────────── 던지기 · 피해 · KO · 부활(§3 · §4) ─────────────
test("던지기: 잉크를 쓰고 · 맞으면 다치고 밀리고(kb) · 쓰러지면 KO 와 부활", () => {
  const { g, json, fxOf, run } = setup();
  const A = g.heroOf(0), B = g.heroOf(1);
  const p = arena(g, 4);
  put(g, A, p.x - 1.5, p.y);
  put(g, B, p.x + 1.5, p.y);
  const tank0 = A.tank;
  assert.equal(g.heroThrow(A, B.x, B.y, false), true);
  assert.equal(A.tank, tank0 - shotInk(0, false), "기본 잉크 한 발 5");
  assert.equal(g.heroThrow(A, B.x, B.y, false), false, "던지기 간격");
  run(flightTime(3, false) + 0.1);
  assert.ok(fxOf(0, "arc").length >= 1, "포물선 사건");
  assert.ok(fxOf(0, "boom").length >= 1, "폭발 사건");
  assert.equal(B.hp, HERO.HP - 16, "직격 = 12 × 1.3");
  const kb = json(1, "kb").at(-1);
  assert.ok(kb && kb.vx > 2 && kb.stun > 0, "맞은 사람에게 넉백을 알린다");
  // 밀려난 만큼은 걷기보다 멀리 가도 받는다(넉백 여유)
  run(0.3);
  const push = HERO.SPEED * 0.3 * HERO.SLACK + HERO.PAD + 1.0;
  assert.ok(lineClear(g.grid, B.x, B.y, B.x + push, B.y, 0.3));
  const nb = json(1, "warp").length;
  g.command(1, { t: "mv", x: B.x + push, y: B.y, z: 0, f: 0, d: 0 });
  const bx = B.x + push;
  g.step();
  assert.equal(json(1, "warp").length, nb, "넉백 여유 안");
  assert.ok(Math.abs(B.x - bx) < 1e-9);
  put(g, B, p.x + 1.5, p.y);
  for (let i = 0; i < 400 && !B.dead; i++) {
    if (A.throwCd <= 0) g.heroThrow(A, B.x, B.y, false);
    g.step();
  }
  assert.ok(B.dead, "쓰러졌다");
  assert.equal(g.teams[0].kos, 1);
  assert.equal(g.players[0].stats.kos, 1);
  assert.equal(g.players[1].stats.deaths, 1);
  assert.ok(fxOf(0, "ko").some((e) => e.id === B.id));
  g.step();
  assert.ok(json(1, "me").at(-1).dead > 0, "me.dead = 부활까지 초");
  run(HERO.RESPAWN);
  assert.ok(!B.dead && B.hp === HERO.HP && B.invuln > 0, "부활 · 무적");
  const base = g.map.bases[1];
  assert.ok(Math.hypot(B.x - base.spawn.x, B.y - base.spawn.y) < 4, "탑 앞에서 다시 나온다");
  assert.ok(json(1, "warp").length >= 1, "부활 자리를 warp 로 알린다");
});

test("던지기: 잉크가 한 발보다 적으면 던질 수 없다 · 대형은 1.8배 · 같은 팀은 다치지 않는다", () => {
  const players = [{ name: "a", team: 0, bot: false }, { name: "b", team: 0, bot: false }, { name: "c", team: 1, bot: false }];
  const g = new Game({ seed: 5, teams: 2, players, send() {}, onEnd() {} });
  for (const u of [...g.units.values()]) if (u.type === UTYPE.NPC) g.units.delete(u.id);
  while (g.phase !== PHASE.PLAY) g.step();
  const A = g.heroOf(0), F = g.heroOf(1);
  const p = arena(g, 3);
  put(g, A, p.x - 1.5, p.y);
  put(g, F, p.x + 1.5, p.y);
  A.tank = 4;
  assert.equal(g.heroThrow(A, F.x, F.y, false), false);
  assert.equal(A.tank, 4);
  A.tank = INK.TANK;
  g.heroThrow(A, F.x, F.y, true);
  assert.equal(A.tank, INK.TANK - shotInk(0, true), "대형은 잉크 × 1.8");
  for (let i = 0; i < 30; i++) g.step();
  assert.equal(F.hp, HERO.HP, "같은 팀은 맞지 않는다");
});

// ───────────── 잉크 채우기(§4) ─────────────
test("잉크(U31): 우리 공급소 곁에서 탱크가 차고 내 잉크를 탱크 2당 1 쓴다 — 내 잉크가 0 이면 팀원에게 잉크가 있어도 안 찬다", () => {
  const { g, run } = setup({ per: 2 });
  removeWorkers(g);
  const h = g.heroOf(0);
  const W = g.players[0], mate = g.players[1]; // 내 지갑 · 팀원 지갑(U31)
  const sup = g.supplies(0, true)[0];
  const spot = besideBuilding(g, sup, INK.REFILL_REACH * 0.5);
  put(g, h, spot.x, spot.y);
  h.tank = 50;
  W.ink = 300;
  mate.ink = 300;
  run(1);
  assert.ok(Math.abs(h.tank - 100) < 1e-6, `1초에 50 찬다(${h.tank})`);
  assert.ok(Math.abs(W.ink - 275) < 1e-6, `내 잉크 25 씀(${W.ink})`);
  assert.equal(mate.ink, 300, "팀원 잉크는 그대로");
  assert.ok(Math.abs(W.spent.ink - 25) < 1e-6, "쓴 잉크(spent)");
  const w = g.wireUnits().find((x) => x.u === h).w;
  assert.ok(w.flags & UF.REFILL, "채우는 중 깃발");
  W.ink = 0;
  run(1);
  assert.ok(Math.abs(h.tank - 100) < 1e-6, "내 잉크가 없으면 안 찬다(팀원 잉크는 쓰지 않는다)");
  assert.equal(mate.ink, 300);
  W.ink = 300;
  // 가장자리에서 REFILL_REACH 를 조금 넘으면 안 찬다(아주 가까이 가야 한다)
  const near = besideBuilding(g, sup, INK.REFILL_REACH + HERO.RADIUS + 0.4);
  put(g, h, near.x, near.y);
  run(1);
  assert.ok(Math.abs(h.tank - 100) < 1e-6, "공급소 바로 곁이 아니면 안 찬다");
  const far = arena(g);
  put(g, h, far.x, far.y);
  run(1);
  assert.ok(Math.abs(h.tank - 100) < 1e-6, "공급소에서 멀면 안 찬다");
});

// ───────────── 일꾼 · 캐기(§5) ─────────────
test("구역(8팀 × 4명): 팀마다 자기 구역에서 일꾼 16까지 — 막히지 않고 캐며, 팀 동료 영웅은 겹치지 않게 나온다", () => {
  const { g, run } = setup({ teams: 8, per: 4, seed: 7 });
  assert.equal(g.nTeams, 8);
  assert.equal(g.S, 124);
  const T = g.teams[0];
  const tower = g.tower(0);
  // 처음: 학생마다 일꾼 2(자기 것) — 모두 자기 구역 안
  for (const p of g.players) {
    const ws = unitsOf(g, p.slot, UTYPE.WORKER);
    assert.equal(ws.length, START.workers);
    const tw = g.tower(p.team);
    for (const w of ws) assert.ok(Math.hypot(w.x - tw.cx, w.y - tw.cy) < 12, "일꾼은 자기 구역에서 시작");
  }
  const heroes = g.players.filter((p) => p.team === 0).map((p) => g.heroOf(p.slot));
  for (let i = 0; i < heroes.length; i++) for (let j = i + 1; j < heroes.length; j++) assert.ok(Math.hypot(heroes[i].x - heroes[j].x, heroes[i].y - heroes[j].y) > 0.5);
  // 팀 0: 4명 × 4 = 16 일꾼 — 골드 8 · 잉크 8(본진 금광 · 연못 하나씩)
  const ws = [];
  for (const p of g.players.filter((q) => q.team === 0)) {
    for (let k = 0; k < 2; k++) g.spawnUnit(UTYPE.WORKER, 0, p.slot, tower.cx, tower.cy + 3);
    ws.push(...unitsOf(g, p.slot, UTYPE.WORKER));
  }
  assert.equal(ws.length, 16);
  ws.forEach((w, k) => {
    const res = k % 2 ? "ink" : "gold";
    const node = g.nodeFor(res, 0);
    w.res = res;
    const at = g.spotNear(tower, node.cx, node.cy);
    put(g, w, at.x, at.y);
    g.setOrder(w, { type: "gather", res, i: node.i, phase: "go" });
  });
  run(10);
  const gold0 = g.teamSum(0, "gold"), ink0 = g.teamSum(0, "ink");
  const stuck = new Map(), trips = new Map(), had = new Map();
  for (let i = 0; i < 60 / TICK; i++) {
    g.step();
    for (const w of ws) {
      if (w.stuckT > 0.6) stuck.set(w.id, (stuck.get(w.id) || 0) + 1);
      if (had.get(w.id) && w.carry === 0) trips.set(w.id, (trips.get(w.id) || 0) + 1);
      had.set(w.id, w.carry > 0);
    }
  }
  for (const w of ws) {
    assert.ok((stuck.get(w.id) || 0) <= 40, `오래 막혀 선 일꾼이 없다(${stuck.get(w.id)}틱)`);
    assert.ok((trips.get(w.id) || 0) >= 5, `모든 일꾼이 꾸준히 나른다(${trips.get(w.id) || 0}번)`);
    assert.equal(w.order.i, g.nodeFor(w.res, 0).i, "맡은 곳을 떠나지 않는다");
  }
  // 1명 몫: 골드 약 109/분 · 잉크 약 193/분 — 8명이면 8배에 가깝게(같은 길을 16명이 나눠 쓴다)
  assert.ok(g.teamSum(0, "gold") - gold0 >= 8 * 109 * 0.75, `골드 1분 ${g.teamSum(0, "gold") - gold0}`);
  assert.ok(g.teamSum(0, "ink") - ink0 >= 8 * 193 * 0.7, `잉크 1분 ${g.teamSum(0, "ink") - ink0}`);
});

test("일꾼: 캐는 곳 모서리(대각선 칸)에 서 있어도 다가가 캐고, 못 가도 다른 팀 본진 연못으로 가지 않는다", () => {
  const { g, run } = setup({ teams: 8, per: 1, seed: 7 });
  removeWorkers(g, 0);
  const node = g.nodeFor("ink", 0);
  // 연못 오른쪽 아래 모서리 대각선 칸(가장자리에서 0.85 보다 멀다)
  let spot = null;
  for (const [cx, cy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = cx > 0 ? node.tx + node.size + 0.68 : node.tx - 0.68, y = cy > 0 ? node.ty + node.size + 0.98 : node.ty - 0.98;
    if (standable(g, x, y)) { spot = { x, y }; break; }
  }
  assert.ok(spot, "모서리 자리");
  const w = g.spawnUnit(UTYPE.WORKER, 0, 0, spot.x, spot.y);
  w.res = "ink";
  g.setOrder(w, { type: "gather", res: "ink", i: node.i, phase: "go" });
  let mined = false;
  for (let i = 0; i < 3 / TICK; i++) { g.step(); if (w.anim === ANIM.GATHER || w.carry > 0) mined = true; }
  assert.ok(mined, "모서리에서 다가가 캤다");
  // 길을 못 찾아도(fails) 다른 팀 본진 연못을 고르지 않는다 — 잉크는 본진 연못뿐이라 제 연못을 다시 찾는다
  for (let k = 0; k < 5; k++) { w.fails = 9; g.step(); assert.equal(w.order.i, node.i); }
  run(10);
  assert.ok(g.tower(0) && Math.hypot(w.x - g.tower(0).cx, w.y - g.tower(0).cy) < 15, "자기 구역에 있다");
});

test("일꾼(U17): 처음에는 자기 영웅 곁에서 기다리고(UF.IDLE) 팀 골드 · 잉크가 늘지 않는다 — 캐기를 시키면 쌓인다 · 코어 금광으로 보내면 코어", () => {
  const { g, json, run } = setup();
  const T = g.teams[0];
  const W = g.players[0]; // 내 지갑(U31)
  const p = g.players[0];
  const h = g.heroOf(0);
  const ws = unitsOf(g, 0, UTYPE.WORKER);
  assert.equal(ws.length, START.workers);
  for (const w of ws) {
    assert.ok(Math.hypot(w.x - h.x, w.y - h.y) < 1.6, "자기 영웅 곁에 모여 있다");
    assert.equal(w.order.type, "idle");
    assert.equal(w.res, null, "맡은 자원이 없다");
  }
  const snap = decodeSnapshot(encodeSnapshot(g.viewOf(0)));
  for (const w of ws) assert.ok(snap.units.find((u) => u.id === w.id).flags & UF.IDLE, "스냅숏 UF.IDLE(일 시켜주세요!)");
  assert.ok(!(snap.units.find((u) => u.id === h.id).flags & UF.IDLE), "영웅에는 IDLE 이 없다");
  // 시키지 않으면 아무것도 캐지 않고 제자리
  const gold0 = W.gold, ink0 = W.ink;
  const at = ws.map((w) => ({ x: w.x, y: w.y }));
  run(20);
  assert.deepEqual([W.gold, W.ink], [gold0, ink0], "저절로 캐지 않는다");
  ws.forEach((w, i) => assert.ok(Math.hypot(w.x - at[i].x, w.y - at[i].y) < 0.3, "제자리에서 기다린다"));
  // 캐기 명령
  g.command(0, { t: "cmd", o: "gather", ids: [ws[0].id], target: { res: "gold" } });
  g.command(0, { t: "cmd", o: "gather", ids: [ws[1].id], target: { res: "ink" } });
  g.step();
  for (const w of ws) assert.ok(!(g.unitFlags(w) & UF.IDLE), "일이 있으면 IDLE 이 아니다");
  const carried = new Set();
  for (let i = 0; i < 45 / TICK; i++) {
    g.step();
    for (const w of ws) if (w.carry > 0) carried.add(w.carryRes);
  }
  assert.ok(W.gold >= gold0 + 2 * 8, `골드가 쌓인다(${gold0} → ${W.gold})`);
  assert.ok(W.ink >= ink0 + 2 * 10, `잉크가 쌓인다(${ink0} → ${W.ink})`);
  assert.ok(p.stats.gold > 0 && p.stats.ink > 0, "캔 사람의 기록");
  assert.ok(carried.has(1) && carried.has(2), "든 것: 1 잉크 · 2 골드");
  assert.ok(json(0, "team").at(-1).gold > gold0);
  g.command(0, { t: "cmd", o: "gather", ids: ws.map((w) => w.id), target: { res: "core" } });
  run(60);
  assert.ok(W.core >= 2, `코어가 쌓인다(${W.core})`);
  assert.ok(p.stats.core >= 2);
  assert.ok(ws.every((w) => w.res === "core"));
});

test("일꾼(U17): 옮기기 → 닿으면 그 자리에서 기다린다 · 멈추기 · 지키기도 기다리기(IDLE) — 캐던 일로 저절로 돌아가지 않는다", () => {
  const { g, run } = setup();
  const T = g.teams[0];
  const W = g.players[0]; // 내 지갑(U31)
  const [a, b] = unitsOf(g, 0, UTYPE.WORKER);
  g.command(0, { t: "cmd", o: "gather", ids: [a.id, b.id], target: { res: "gold" } });
  run(8);
  const spot = openSpot(g, g.map.bases[0].spawn.x + g.map.bases[0].dir.x * 4, g.map.bases[0].spawn.y + g.map.bases[0].dir.y * 4, 1);
  g.command(0, { t: "cmd", o: "move", ids: [a.id], x: spot.x, y: spot.y });
  run(12);
  assert.equal(a.order.type, "idle");
  assert.ok(Math.hypot(a.x - spot.x, a.y - spot.y) < 0.6, "옮긴 자리");
  assert.ok(g.unitFlags(a) & UF.IDLE);
  const pos = { x: a.x, y: a.y };
  run(10);
  assert.equal(a.order.type, "idle", "캐기로 돌아가지 않는다");
  assert.ok(Math.hypot(a.x - pos.x, a.y - pos.y) < 0.3);
  assert.equal(a.job, null);
  // 멈추기 · 지키기
  g.command(0, { t: "cmd", o: "stop", ids: [b.id] });
  g.step();
  assert.ok(g.unitFlags(b) & UF.IDLE);
  g.command(0, { t: "cmd", o: "gather", ids: [b.id], target: { res: "ink" } });
  g.step();
  assert.ok(!(g.unitFlags(b) & UF.IDLE));
  g.command(0, { t: "cmd", o: "hold", ids: [b.id] });
  g.step();
  assert.ok(g.unitFlags(b) & UF.IDLE, "지키기도 일 시켜주세요");
  const gold = W.gold;
  run(10);
  assert.ok(W.gold - gold <= 8, "기다리는 일꾼은 캐지 않는다(들고 있던 것 하나까지)");
});

test("일꾼(U17): 짓기 · 고치기를 마치면 하던 캐기로 돌아가고, 하던 일이 없으면 기다린다", () => {
  const { g, run } = setup();
  const T = g.teams[0];
  g.players[0].gold = 1000; // 내 지갑(U31)
  const [a, b] = unitsOf(g, 0, UTYPE.WORKER);
  const mine = g.nodeFor("gold", 0);
  g.command(0, { t: "cmd", o: "gather", ids: [a.id], target: { res: "gold", i: mine.i } });
  run(3);
  const tw = g.tower(0);
  let spot = null;
  for (let r = 3; r < 14 && !spot; r++)
    for (let k = 0; k < 16 && !spot; k++) {
      const an = (k / 16) * Math.PI * 2;
      const tx = Math.round(tw.cx + Math.cos(an) * r - 1.5), ty = Math.round(tw.cy + Math.sin(an) * r - 1.5);
      if (g.canPlace(tx, ty, 3)) spot = { tx, ty };
    }
  // 공급소는 일꾼 바로 옆에만(U18) — 두 일꾼을 자리 옆으로 옮겨 둔다(a 는 캐던 일을 그대로 가진 채)
  for (const w of [a, b]) { w.x = spot.tx + 1.5; w.y = spot.ty + 1.5; w.path = null; }
  g.command(0, { t: "place", kind: "supply", tx: spot.tx, ty: spot.ty, ids: [a.id, b.id] });
  g.step();
  assert.equal(a.order.type, "build");
  assert.ok(!(g.unitFlags(a) & UF.IDLE) && !(g.unitFlags(b) & UF.IDLE), "짓는 동안은 일이 있다");
  const sup = g.supplies(0, false).find((x) => x.tx === spot.tx && x.ty === spot.ty);
  for (let i = 0; i < 60 / TICK && !sup.built; i++) g.step();
  assert.ok(sup.built);
  g.step();
  assert.equal(a.order.type, "gather", "캐던 일꾼은 캐기로 돌아간다");
  assert.equal(a.order.res, "gold");
  assert.equal(a.order.i, mine.i);
  assert.equal(b.order.type, "idle", "하던 일이 없던 일꾼은 기다린다");
  assert.ok(g.unitFlags(b) & UF.IDLE);
  // 고치기도 같다
  const lab = g.buildings.get(T.labId);
  g.buildingZero(lab);
  g.command(0, { t: "cmd", o: "repair", ids: [a.id, b.id], target: lab.id });
  for (let i = 0; i < 90 / TICK && lab.broken; i++) g.step();
  assert.ok(!lab.broken);
  g.step();
  assert.equal(a.order.type, "gather");
  assert.equal(a.order.res, "gold");
  assert.equal(b.order.type, "idle");
});

test("컴퓨터(U17): 기다리는 일꾼에게 잠깐 뒤 일을 시키고, 나간 학생의 자리는 학생이 시킨 일을 그대로 둔 채 기다리는 일꾼만 부린다", () => {
  const { g, run } = setup({ bots: [true, false] });
  const cw = unitsOf(g, 0, UTYPE.WORKER);
  assert.ok(cw.every((w) => w.order.type === "idle"), "컴퓨터 일꾼도 처음엔 기다린다");
  run(0.6);
  assert.ok(cw.every((w) => w.order.type === "idle"), "곧바로 시키지 않는다(생각하는 틈)");
  run(4);
  assert.ok(cw.every((w) => w.order.type === "gather"), "잠깐 뒤 일을 시켰다");
  assert.deepEqual(cw.map((w) => w.res).sort(), ["gold", "ink"], "골드 2 : 잉크 1 : 코어 1 꼴의 앞 둘");
  // 사람 자리(1): 하나는 잉크를 시키고 나간다 → 컴퓨터가 잇되 그 일은 그대로, 기다리던 일꾼만 부린다
  const [h1, h2] = unitsOf(g, 1, UTYPE.WORKER);
  g.command(1, { t: "cmd", o: "gather", ids: [h1.id], target: { res: "ink" } });
  run(1);
  assert.equal(unitsOf(g, 1, UTYPE.WORKER).filter((w) => w.order.type === "idle").length, 1);
  g.setConnected(1, false);
  run(5);
  assert.equal(h1.order.type, "gather");
  assert.equal(h1.res, "ink", "학생이 시킨 일은 그대로");
  assert.equal(h2.order.type, "gather", "기다리던 일꾼에게 일을 시켰다");
});

test("코어 금광: 한 번에 일꾼 둘만 캐고 나머지는 기다린다", () => {
  const { g } = setup();
  const W = g.players[0]; // 내 지갑(U31)
  removeWorkers(g, 0);
  const node = g.nodeFor("core", 0);
  const ws = [];
  for (let k = 0; k < 4; k++) {
    const f = nearestFree(g.grid, node.cx + 3, node.cy + (k - 1.5) * 0.4, 6);
    const w = g.spawnUnit(UTYPE.WORKER, 0, 0, f.x, f.y);
    w.res = "core";
    g.setOrder(w, { type: "gather", res: "core", i: node.i, phase: "go" });
    ws.push(w);
  }
  let maxMining = 0, waited = 0;
  for (let i = 0; i < 40 / TICK; i++) {
    g.step();
    const mining = ws.filter((w) => w.anim === ANIM.GATHER).length;
    maxMining = Math.max(maxMining, mining);
    assert.ok(mining <= CORE_MINE.SLOTS, "캐는 일꾼은 둘까지");
    assert.ok(node.miners.size <= CORE_MINE.SLOTS);
    if (ws.some((w) => w.anim !== ANIM.GATHER && w.carry === 0 && Math.hypot(w.x - node.cx, w.y - node.cy) < 2.6)) waited++;
    for (const w of ws) assert.ok(!(g.unitFlags(w) & UF.IDLE), "코어 금광 자리를 기다리는 것도 일이 있는 것");
  }
  assert.equal(maxMining, CORE_MINE.SLOTS);
  assert.ok(waited > 0, "자리가 비기를 기다리는 일꾼이 있었다");
  assert.ok(g.players[0].core >= 4, `코어(${g.players[0].core})`);
});

test("일꾼 뽑기: 골드 50 · 한 사람 4명까지(줄 포함), 새 일꾼은 탑 앞에서 기다린다(IDLE — U17)", () => {
  const { g, json, run } = setup();
  const T = g.teams[0];
  const W = g.players[0]; // 내 지갑(U31)
  W.gold = 500;
  g.command(0, { t: "train", what: "worker" });
  g.command(0, { t: "train", what: "worker" });
  g.command(0, { t: "train", what: "worker" });
  g.step();
  assert.equal(g.players[0].queue.length, 2, "2 + 줄 2 = 4");
  assert.equal(W.gold, 500 - 2 * UNITS.worker.train.gold);
  assert.ok(json(0, "note").some((n) => /일꾼 최대 4명/.test(n.text)));
  run(UNITS.worker.train.time + 0.2);
  const ws = unitsOf(g, 0, UTYPE.WORKER);
  assert.equal(ws.length, 3);
  const nw = ws.find((w) => w.id === Math.max(...ws.map((x) => x.id)));
  const tw = g.tower(0);
  assert.ok(Math.hypot(nw.x - tw.cx, nw.y - tw.cy) < tw.size, "탑 앞에 나왔다");
  assert.equal(nw.order.type, "idle");
  assert.equal(nw.res, null, "저절로 자원을 고르지 않는다");
  assert.ok(g.unitFlags(nw) & UF.IDLE);
  assert.ok(json(0, "note").some((n) => /일을 시켜 주세요/.test(n.text)));
  const at = { x: nw.x, y: nw.y };
  run(8);
  assert.equal(nw.order.type, "idle");
  assert.ok(Math.hypot(nw.x - at.x, nw.y - at.y) < 0.3, "그 자리에서 기다린다");
});

// ───────────── 일꾼 근접 공격(U22) ─────────────
test("일꾼 공격(U22): 공격 명령 → 걸어가 상대 일꾼을 친다(한 번 3, 1.1초마다) · 쓰러뜨리면 하던 캐기로, 하던 일이 없으면 기다린다 · 영웅을 쓰러뜨리면 KO 몫", () => {
  const { g, fxOf, run, clear } = setup();
  const M = UNITS.worker.melee;
  const [a, b] = unitsOf(g, 0, UTYPE.WORKER);
  const [e, f] = unitsOf(g, 1, UTYPE.WORKER);
  const p = arena(g, 4);
  g.command(0, { t: "cmd", o: "gather", ids: [a.id], target: { res: "gold" } });
  run(0.5);
  put(g, a, p.x - 2, p.y);
  put(g, e, p.x + 2, p.y);
  run(0.3);
  clear();
  g.command(0, { t: "cmd", o: "attack", ids: [a.id], target: e.id });
  g.step();
  assert.equal(a.order.type, "attack");
  assert.ok(!(g.unitFlags(a) & UF.IDLE), "공격 중에는 일이 있다");
  let first = 0, sawSwing = false;
  for (let i = 0; i < 8 / TICK && !first; i++) {
    g.step();
    if (a.anim === ANIM.ATTACK) sawSwing = true;
    if (e.hp < UNITS.worker.hp) first = UNITS.worker.hp - e.hp;
  }
  assert.equal(first, M.dmg, "한 번에 3");
  assert.ok(sawSwing, "ATTACK 동작");
  assert.ok(Math.hypot(a.x - e.x, a.y - e.y) < a.radius + e.radius + M.reach + 0.1, "걸어가 붙었다");
  assert.ok(fxOf(1, "hit").some((x) => x.id === e.id && x.dmg === M.dmg), "맞음 사건");
  const hp = e.hp;
  run(M.cd * 2 + 0.05);
  assert.equal(hp - e.hp, 2 * M.dmg, "1.1초마다 한 번");
  run(UNITS.worker.hp / M.dmg * M.cd + 2);
  assert.ok(!g.units.has(e.id), "상대 일꾼이 쓰러졌다");
  g.step();
  assert.equal(a.order.type, "gather", "하던 캐기로 돌아간다");
  assert.equal(a.order.res, "gold");
  // 하던 일이 없던 일꾼은 기다린다
  put(g, b, p.x - 1, p.y + 1);
  put(g, f, p.x + 1, p.y + 1);
  f.hp = M.dmg;
  g.command(0, { t: "cmd", o: "attack", ids: [b.id], target: f.id });
  run(3);
  assert.ok(!g.units.has(f.id));
  assert.equal(b.order.type, "idle");
  assert.ok(g.unitFlags(b) & UF.IDLE);
  // 영웅을 쓰러뜨리면 보통의 KO 몫
  const B = g.heroOf(1);
  put(g, B, p.x + 1.2, p.y - 1);
  B.hp = M.dmg;
  g.command(0, { t: "cmd", o: "attack", ids: [b.id], target: B.id });
  run(3);
  assert.ok(B.dead, "일꾼이 영웅을 쓰러뜨렸다");
  assert.equal(g.teams[0].kos, 1);
  assert.equal(g.players[0].stats.kos, 1);
  run(0.2);
  assert.equal(b.order.type, "idle", "상대가 쓰러지면 그만둔다");
});

test("일꾼 공격(U22): 상대 건물은 × 0.6 · 섹션(방어막 · 바위)은 치지 않는다 · 우리 편은 고를 수 없다 · 12칸 넘게 멀어지면 그만둔다", () => {
  const { g, run } = setup();
  const M = UNITS.worker.melee;
  const [a, b] = unitsOf(g, 0, UTYPE.WORKER);
  // 상대 공급소
  const sup = g.supplies(1, true)[0];
  const spot = besideBuilding(g, sup, 2);
  put(g, a, spot.x, spot.y);
  run(0.2);
  const hp0 = sup.hp;
  g.command(0, { t: "cmd", o: "attack", ids: [a.id], target: sup.id });
  for (let i = 0; i < 6 / TICK && sup.hp === hp0; i++) g.step();
  assert.ok(Math.abs(hp0 - sup.hp - M.dmg * 0.6) < 1e-9, `건물에는 3 × 0.6(${hp0 - sup.hp})`);
  // 섹션 곁의 상대를 쳐도 방어막은 안 다친다
  const s = g.sites.find((x) => !x.center);
  const e = unitsOf(g, 1, UTYPE.WORKER)[0];
  const near = nearSite(g, s, 2.2);
  put(g, e, near.x, near.y);
  put(g, b, near.x + 0.6, near.y);
  const siteHits = [];
  const hs = g.hurtSite.bind(g);
  g.hurtSite = (site, d, src) => { siteHits.push(src.unit); return hs(site, d, src); };
  g.command(0, { t: "cmd", o: "attack", ids: [b.id], target: e.id });
  run(4);
  assert.ok(e.hp < UNITS.worker.hp, "상대 일꾼은 맞았다");
  assert.equal(siteHits.length, 0, "섹션은 치지 않는다");
  assert.equal(s.shield, GEM.SHIELD_HP);
  // 우리 편은 고를 수 없다
  const own = [g.heroOf(0), g.tower(0), b];
  g.setOrder(a, { type: "idle" });
  for (const t of own) {
    g.command(0, { t: "cmd", o: "attack", ids: [a.id], target: t.id });
    g.step();
    assert.equal(a.order.type, "idle", "우리 편 공격은 거절");
  }
  // 12칸 넘게 멀어지면 그만둔다
  g.command(0, { t: "cmd", o: "attack", ids: [b.id], target: e.id });
  g.step();
  const far = g.map.bases[1].spawn;
  put(g, e, far.x, far.y);
  run(0.3);
  assert.equal(b.order.type, "idle", "멀어지면 그만둔다(하던 일이 없으면 기다리기)");
});

test("일꾼 공격(U22): 일꾼은 저절로 싸우지 않는다 — 맞아도 · 적이 곁에 있어도 명령이 없으면 그대로", () => {
  const { g, run } = setup();
  const [a, b] = unitsOf(g, 0, UTYPE.WORKER);
  const e = unitsOf(g, 1, UTYPE.WORKER)[0];
  const B = g.heroOf(1);
  const p = arena(g, 3);
  g.command(0, { t: "cmd", o: "gather", ids: [b.id], target: { res: "gold" } });
  g.step();
  put(g, a, p.x, p.y);
  put(g, e, p.x + 0.5, p.y);
  g.hurtUnit(a, 5, { team: 1, unit: B.id, slot: 1 });
  g.hurtUnit(b, 5, { team: 1, unit: B.id, slot: 1 });
  run(6);
  assert.equal(a.order.type, "idle", "맞아도 기다린다");
  assert.equal(b.order.type, "gather", "캐던 일꾼은 계속 캔다");
  assert.equal(e.hp, UNITS.worker.hp, "곁의 상대 일꾼을 저절로 치지 않는다");
  assert.equal(B.hp, HERO.HP);
});

// ───────────── 개인 지갑(U31) ─────────────
test("지갑(U31): 내 일꾼이 캔 것은 내 지갑으로 — 팀원이 지은 공급소에 내려놓아도 · team JSON 은 팀원 지갑의 합", () => {
  const { g, json, run } = setup({ per: 2 });
  const [p0, p1] = g.players;
  const mine = g.nodeFor("gold", 0);
  // 팀원(1번)이 금광 바로 곁에 지은 공급소
  let spot = null;
  for (let r = 1; r < 8 && !spot; r++)
    for (let k = 0; k < 16 && !spot; k++) {
      const an = (k / 16) * Math.PI * 2;
      const tx = Math.round(mine.cx + Math.cos(an) * (r + 2.5) - 1.5), ty = Math.round(mine.cy + Math.sin(an) * (r + 2.5) - 1.5);
      if (g.canPlace(tx, ty, 3)) spot = { tx, ty };
    }
  const sup = g.addBuilding(BLD.SUPPLY, 0, spot.tx, spot.ty, true);
  sup.by = 1;
  g.step();
  assert.equal(g.dropoff(0, mine.cx, mine.cy), sup, "금광에서 가장 가까운 내려놓는 곳은 팀원의 공급소");
  const [w] = unitsOf(g, 0, UTYPE.WORKER);
  g.command(0, { t: "cmd", o: "gather", ids: [w.id], target: { res: "gold", i: mine.i } });
  const g0 = p0.gold, g1 = p1.gold;
  run(40);
  assert.ok(p0.gold >= g0 + 3 * 8, `내 골드가 쌓인다(${g0} → ${p0.gold})`);
  assert.equal(p1.gold, g1, "공급소를 지은 팀원 지갑은 그대로");
  assert.equal(p0.made.gold, p0.gold - g0, "made = 캔 것");
  const team = json(0, "team").at(-1);
  assert.equal(team.gold, Math.floor(p0.gold + p1.gold), "팀 JSON 은 팀원 지갑의 합");
  const me = json(0, "me").at(-1);
  assert.equal(me.gold, Math.floor(p0.gold));
});

test("지갑(U31): 사는 것은 누른 학생이 낸다 — 일꾼 · 잉크봇 · 몬스터 · 랩 열기(혜택은 팀 모두) · 모자라면 내 지갑을 알려 준다", () => {
  const { g, json, run } = setup({ per: 2 });
  const [p0, p1] = g.players;
  const T = g.teams[0];
  g.command(0, { t: "train", what: "worker" });
  g.step();
  assert.deepEqual([p0.gold, p1.gold], [START.gold - UNITS.worker.train.gold, START.gold], "일꾼은 누른 학생 골드");
  assert.equal(p0.spent.gold, UNITS.worker.train.gold);
  // 코어: 팀원에게 있어도 내 것이 없으면 못 산다
  p0.core = 20;
  g.command(1, { t: "train", what: "bot" });
  g.step();
  assert.equal(p1.queue.length, 0);
  assert.ok(json(1, "note").some((n) => n.text === `코어 부족(0/${UNITS.bot.train.core})`));
  g.command(0, { t: "train", what: "bot" });
  g.command(0, { t: "fac", act: "hatch", key: 0 });
  g.step();
  assert.equal(p0.core, 20 - UNITS.bot.train.core - hatchCost(0, false).core, "잉크봇 · 몬스터는 내 코어");
  // 랩 열기: 누른 학생이 내고, 열린 무기(첫 묶음)는 팀 모두
  p1.gold = 200;
  const g0 = p0.gold;
  g.command(1, { t: "lab", act: "unlock", key: "missile" });
  g.step();
  assert.equal(p1.gold, 200 - WEAPONS[WEAPON.missile].unlock.gold);
  assert.equal(p0.gold, g0, "다른 팀원은 내지 않는다");
  assert.equal(T.lab.job.by, 1);
  assert.ok(json(0, "note").some((n) => /p01: 잉크 미사일 열기 시작/.test(n.text)), "누가 냈는지 팀에 보인다");
  run(WEAPONS[WEAPON.missile].unlock.time + 0.2);
  assert.ok(T.lab.unlocked[WEAPON.missile]);
  assert.equal(p0.inv[WEAPON.missile], WEAPONS[WEAPON.missile].pack.n, "혜택은 팀 모두");
  // 모자라면 내 지갑 숫자
  p0.gold = 40;
  g.command(0, { t: "lab", act: "research", key: "thrift" });
  g.step();
  assert.ok(json(0, "note").some((n) => n.text === "골드 부족(40/180)"));
});

test("보내기(U31): give 는 같은 팀(탈락하지 않은) 다른 학생에게만, 1 ~ 가진 만큼 · 두 사람 모두에게 알림 · 1초에 5번까지 · 영웅이 없는 지휘관도 보낼 수 있다", () => {
  const { g, json, run } = setup({ teams: 3, per: 2 });
  const [p0, p1, p2] = g.players;
  g.command(0, { t: "give", to: 1, res: "gold", amount: 50 });
  g.step();
  assert.deepEqual([p0.gold, p1.gold], [START.gold - 50, START.gold + 50]);
  assert.equal(p0.given.gold, 50);
  assert.ok(json(0, "note").some((n) => n.text === "p01에게 골드 50을 보냈어요."));
  assert.ok(json(1, "note").some((n) => n.text === "p00이(가) 골드 50을 보냈어요."));
  // 거절: 나 자신 · 다른 팀 · 0 · 가진 것보다 많이 · 없는 자원
  const before = [p0.gold, p1.gold, p2.gold];
  for (const m of [{ to: 0, res: "gold", amount: 5 }, { to: 2, res: "gold", amount: 5 }, { to: 1, res: "gold", amount: 0 }, { to: 1, res: "gold", amount: -3 }, { to: 1, res: "gold", amount: 500 }, { to: 1, res: "wood", amount: 5 }, { to: 99, res: "gold", amount: 5 }]) {
    g.command(0, { t: "give", ...m });
    g.step();
  }
  assert.deepEqual([p0.gold, p1.gold, p2.gold], before, "모두 거절");
  assert.ok(json(0, "note").some((n) => n.text === "같은 팀에게만 보내요"));
  assert.ok(json(0, "note").some((n) => n.text === `골드 부족(${START.gold - 50}/500)`));
  // 잉크 · 코어도
  p0.core = 3;
  g.command(0, { t: "give", to: 1, res: "core", amount: 3 });
  g.command(0, { t: "give", to: 1, res: "ink", amount: 12 });
  g.step();
  assert.deepEqual([p0.core, p1.core, p1.ink], [0, 3, START.ink + 12]);
  assert.ok(json(1, "note").some((n) => n.text === "p00이(가) 잉크 12를 보냈어요."), "숫자 끝소리에 맞는 조사");
  // 1초에 5번까지
  run(1.1);
  const g0 = p0.gold;
  for (let k = 0; k < 7; k++) g.command(0, { t: "give", to: 1, res: "gold", amount: 1 });
  g.step();
  assert.equal(g0 - p0.gold, 5, "1초에 5번까지");
  // 영웅이 없는 지휘관(U26)도 보낸다
  run(1.1);
  p0.heroOut = true;
  g.command(0, { t: "give", to: 1, res: "gold", amount: 10 });
  g.step();
  assert.equal(g0 - p0.gold, 15);
  // 탈락한 팀은 보낼 수 없다
  g.eliminate(2, 1, "tower");
  const g4 = g.players[4].gold;
  g.command(4, { t: "give", to: 5, res: "gold", amount: 10 });
  g.step();
  assert.equal(g.players[4].gold, g4, "탈락한 팀은 보낼 수 없다");
});

test("보상(U31): 중립 몬스터는 마지막 한 방을 친 유닛의 주인에게 · 탑 사격이면 팀 학생이 나눈다(버림) · 보석 배달 덤은 배달한 학생에게", () => {
  const { g, json, run } = setup({ npc: true, per: 2 });
  const [p0, p1] = g.players;
  const npcs = () => [...g.units.values()].filter((u) => u.type === UTYPE.NPC && !u.dead);
  const [w1] = unitsOf(g, 1, UTYPE.WORKER);
  const small = npcs().find((u) => MONSTERS[u.kind].tier === 0);
  const g0 = p0.gold, g1 = p1.gold;
  g.hurtUnit(small, 9999, { team: 0, unit: w1.id, slot: 1 });
  assert.deepEqual([p0.gold - g0, p1.gold - g1], [0, MONSTER_TIERS[0].gold], "1번의 일꾼이 쓰러뜨렸다 → 1번 지갑");
  assert.equal(p1.made.gold, MONSTER_TIERS[0].gold, "보상도 made");
  assert.ok(g.teams[0].fac.dex.has(small.kind), "도감은 팀 모두");
  const mid = npcs().find((u) => MONSTERS[u.kind].tier === 1);
  const c0 = p0.core, c1 = p1.core, h0 = p0.gold, h1 = p1.gold;
  g.hurtUnit(mid, 9999, { team: 0, unit: 0, slot: -1 });
  const each = Math.floor(MONSTER_TIERS[1].gold / 2);
  assert.deepEqual([p0.gold - h0, p1.gold - h1], [each, each], "탑 사격 → 팀 학생이 나눈다");
  assert.deepEqual([p0.core - c0, p1.core - c1], [Math.floor(MONSTER_TIERS[1].core / 2), Math.floor(MONSTER_TIERS[1].core / 2)], "나머지는 버림");
  assert.ok(json(0, "note").some((n) => n.text.startsWith(`깃발의 탑이 ${MONSTERS[mid.kind].name} 처치! 모두 골드 +${each}`)));
  // 보석 배달 덤
  for (const u of npcs()) g.units.delete(u.id);
  const H1 = g.heroOf(1);
  const s = g.sites.find((x) => !x.center);
  g.popGem(s, 0);
  g.pickGem(g.gems.get(s.id), H1);
  const spot = besideBuilding(g, g.tower(0), 1.2);
  put(g, H1, spot.x, spot.y);
  const d0 = p0.gold, d1 = p1.gold;
  g.step();
  assert.deepEqual([p0.gold - d0, p1.gold - d1], [0, GEM.DELIVER_GOLD], "배달한 학생에게");
});

test("지갑(U31): me 에 gold · core · ink · made · spent · given, 끝 결과 players 에도 made · spent · given", () => {
  const { g, json, run } = setup({ per: 2 });
  const [p0] = g.players;
  g.command(0, { t: "train", what: "worker" });
  g.command(0, { t: "give", to: 1, res: "ink", amount: 30 });
  run(0.4);
  const me = json(0, "me").at(-1);
  assert.deepEqual([me.gold, me.core, me.ink], [START.gold - UNITS.worker.train.gold, START.core, START.ink - 30]);
  assert.deepEqual(me.made, { gold: 0, core: 0, ink: 0 });
  assert.deepEqual(me.spent, { gold: UNITS.worker.train.gold, core: 0, ink: 0 });
  assert.deepEqual(me.given, { gold: 0, core: 0, ink: 30 });
  g.finish("time");
  const end = json(0, "end").at(-1);
  const row = end.players.find((r) => r.slot === 0);
  assert.deepEqual(row.spent, { gold: UNITS.worker.train.gold, core: 0, ink: 0 });
  assert.deepEqual(row.given, { gold: 0, core: 0, ink: 30 });
  assert.deepEqual(row.made, { gold: 0, core: 0, ink: 0 });
  assert.ok(p0.spent.gold === UNITS.worker.train.gold);
});

// ───────────── 랩(§8) ─────────────
test("랩: 골드로 무기를 사면 팀 모두가 쓴다 · 단계가 모자라면 · 일하는 중이면 거절 · 고장 나면 고칠 때까지 멈춘다", () => {
  const { g, json, run, clear } = setup();
  const T = g.teams[0];
  const W = g.players[0]; // 내 지갑(U31)
  const h = g.heroOf(0);
  W.gold = 1000;
  g.command(0, { t: "weapon", w: WEAPON.missile });
  g.step();
  assert.equal(h.weapon, 0, "열지 않은 무기는 못 고른다");
  g.command(0, { t: "lab", act: "unlock", key: "missile" });
  g.step();
  assert.equal(T.lab.job.kind, "unlock");
  assert.equal(W.gold, 1000 - 150);
  clear();
  g.command(0, { t: "lab", act: "research", key: "thrift" });
  g.command(0, { t: "lab", act: "unlock", key: "mega" });
  g.step();
  assert.equal(W.gold, 850, "일하는 중 · 단계 모자람은 값을 받지 않는다");
  assert.ok(json(0, "note").some((n) => /다른 일/.test(n.text)));
  run(15);
  assert.ok(T.lab.unlocked[WEAPON.missile]);
  assert.equal(T.lab.job, null);
  assert.ok(json(0, "team").at(-1).lab.unlocked.includes(WEAPON.missile));
  g.command(0, { t: "weapon", w: WEAPON.missile });
  g.step();
  assert.equal(h.weapon, WEAPON.missile);
  const tank = h.tank;
  assert.ok(g.heroThrow(h, h.x + 5, h.y, false));
  assert.equal(h.tank, tank - shotInk(WEAPON.missile, false));
  assert.equal(g.projs.length, 1, "미사일은 곧게 나는 탄(스냅숏 projs)");
  assert.equal(g.viewOf(0).projs[0].kind, WEAPON.missile);
  // 고장: 일을 받지 않고, 일꾼이 고치면 돌아온다
  const lab = g.buildings.get(T.labId);
  g.buildingZero(lab);
  assert.ok(lab.broken);
  clear();
  g.command(0, { t: "lab", act: "level" });
  g.step();
  assert.equal(T.lab.job, null);
  assert.ok(json(0, "note").some((n) => /고장/.test(n.text)));
  assert.ok(json(0, "team").at(-1).lab.broken);
  const ws = unitsOf(g, 0, UTYPE.WORKER);
  g.command(0, { t: "cmd", o: "repair", ids: ws.map((w) => w.id), target: lab.id });
  for (let i = 0; i < 90 / TICK && lab.broken; i++) g.step();
  assert.ok(!lab.broken && lab.hp === lab.maxHp, "다 고쳤다");
  g.command(0, { t: "lab", act: "level" });
  g.step();
  assert.equal(T.lab.job && T.lab.job.kind, "level");
});

// ───────────── 소지품(v2.2 — U12) ─────────────
test("소지품: 랩에서 처음 열면 팀 모두에게 한 묶음 · buy 로 곧바로 산다(골드) · 거절: 안 열림 · 최대 · 골드 · 랩 고장 · 폭탄은 3개까지", () => {
  const { g, json, run, clear } = setup({ per: 2 });
  const T = g.teams[0];
  const [p0, p1] = g.players;
  const M = WEAPON.missile, Wm = WEAPONS[M];
  const noted = (slot, re) => json(slot, "note").some((n) => re.test(n.text));
  p0.gold = 1000;
  g.command(0, { t: "buy", w: M });
  g.step();
  assert.equal(p0.inv[M], 0);
  assert.equal(p0.gold, 1000);
  assert.ok(noted(0, /랩에서 먼저 열어요/), "열지 않은 무기는 못 산다");
  // 열기 → 팀 모두에게 한 묶음
  g.command(0, { t: "lab", act: "unlock", key: "missile" });
  run(Wm.unlock.time + 0.2);
  assert.equal(p0.inv[M], Wm.pack.n);
  assert.equal(p1.inv[M], Wm.pack.n, "같은 팀 모두");
  assert.equal(g.players[2].inv[M], 0, "다른 팀은 아니다");
  run(0.3);
  assert.equal(json(1, "me").at(-1).inv[M], Wm.pack.n, "me.inv");
  // 사기: 곧바로(랩 일 줄을 쓰지 않는다)
  const gold = p0.gold;
  g.command(0, { t: "buy", w: M });
  g.step();
  assert.equal(p0.inv[M], 2 * Wm.pack.n);
  assert.equal(p0.gold, gold - Wm.pack.gold, "누른 학생의 골드로(U31)");
  assert.equal(p1.gold, START.gold, "팀원 지갑은 그대로");
  assert.equal(T.lab.job, null);
  g.command(0, { t: "buy", w: "missile" });
  g.step();
  assert.equal(p0.inv[M], STACK.MAX);
  clear();
  g.command(0, { t: "buy", w: M });
  g.step();
  assert.equal(p0.inv[M], STACK.MAX);
  assert.equal(p0.gold, gold - 2 * Wm.pack.gold);
  assert.ok(noted(0, /^최대 30개$/), "최대 30");
  // 골드가 모자라면
  p1.gold = 10;
  g.command(1, { t: "buy", w: M });
  g.step();
  assert.equal(p1.inv[M], Wm.pack.n);
  assert.ok(noted(1, /골드 부족\(10\/45\)/));
  // 랩이 고장 나면
  p1.gold = 1000;
  const lab = g.buildings.get(T.labId);
  g.buildingZero(lab);
  g.command(1, { t: "buy", w: M });
  g.step();
  assert.equal(p1.inv[M], Wm.pack.n);
  assert.equal(p1.gold, 1000);
  assert.ok(noted(1, /랩 고장/));
  lab.broken = false; lab.hp = lab.maxHp;
  // 메가 잉크 폭탄: 묶음 1 · 최대 3
  const B = WEAPON.bomb;
  p0.gold = 1000;
  g.finishLabJob(T, { kind: "unlock", key: B, t: 0, total: 1 });
  assert.equal(p0.inv[B], WEAPONS[B].pack.n);
  g.command(0, { t: "buy", w: B });
  g.command(0, { t: "buy", w: B });
  g.command(0, { t: "buy", w: B });
  g.step();
  assert.equal(p0.inv[B], stackMax(B));
  assert.equal(p0.gold, 1000 - 2 * WEAPONS[B].pack.gold);
  assert.ok(noted(0, /최대 3/));
});

test("소지품: 던질 때마다 1개(삼발 · 대형도 1개) → 0 이 되면 기본 잉크로 · 0 개는 못 든다 · 쓰러져도 그대로", () => {
  const { g, json, fxOf, run, clear } = setup();
  const T = g.teams[0], p = g.players[0], A = g.heroOf(0);
  const TR = WEAPON.triple;
  T.lab.unlocked[TR] = true;
  p.inv[TR] = 2;
  const at = arena(g, 3);
  put(g, A, at.x, at.y);
  g.command(0, { t: "weapon", w: TR });
  g.step();
  assert.equal(A.weapon, TR);
  clear();
  const tank = A.tank;
  assert.ok(g.heroThrow(A, A.x + 3, A.y, false));
  assert.equal(p.inv[TR], 1, "삼발 한 번 = 1개");
  assert.equal(A.tank, tank - shotInk(TR, false), "탱크 잉크도 쓴다");
  g.step();
  assert.equal(fxOf(0, "arc").length, 3, "풍선은 셋");
  run(0.5);
  assert.ok(g.heroThrow(A, A.x + 3, A.y, true), "충전한 대형도 1개");
  assert.equal(p.inv[TR], 0);
  assert.equal(A.weapon, 0, "다 쓰면 기본 잉크로 돌아간다");
  assert.ok(json(0, "note").some((n) => n.text === "삼발 풍선 다 썼어요 · 랩에서 사요"));
  run(0.3);
  const me = json(0, "me").at(-1);
  assert.equal(me.w, 0);
  assert.equal(me.inv[TR], 0);
  // 0 개인 무기는 못 든다 · 기본 잉크는 늘
  g.command(0, { t: "weapon", w: TR });
  g.step();
  assert.equal(A.weapon, 0);
  g.command(0, { t: "weapon", w: 0 });
  g.step();
  assert.equal(A.weapon, 0);
  // 든 무기가 0 개면(어긋났을 때) 기본 잉크로 던진다 — 던지기를 거절하지 않는다
  A.weapon = TR;
  run(0.5);
  const t2 = A.tank;
  assert.ok(g.heroThrow(A, A.x + 3, A.y, false));
  assert.equal(A.tank, t2 - shotInk(0, false));
  assert.equal(A.weapon, 0);
  // 쓰러져도 소지품은 그대로
  p.inv[WEAPON.missile] = 7;
  g.hurtUnit(A, 999, { team: 1, unit: 0, slot: 1 });
  assert.ok(A.dead);
  run(HERO.RESPAWN + 0.3);
  assert.ok(!A.dead);
  assert.equal(p.inv[WEAPON.missile], 7);
  assert.equal(json(0, "me").at(-1).inv[WEAPON.missile], 7);
});

// ───────────── 퍼실리티 · 몬스터 · 잉크봇(§6 · §9) ─────────────
test("퍼실리티: 코어로 몬스터를 사고(도감 할인) · 레벨 업(골드 + 코어) · 쓰러지면 사라져 다시 사야 한다 · 놓아 주기", () => {
  const { g, json, run, clear } = setup();
  const T = g.teams[0];
  const W = g.players[0]; // 내 지갑(U31)
  const p = g.players[0];
  W.core = 0;
  g.command(0, { t: "fac", act: "hatch", key: 0 });
  g.step();
  assert.equal(p.pet.state, "none", "코어가 없으면 못 산다");
  assert.ok(json(0, "note").some((n) => /코어 부족/.test(n.text)));
  W.core = 30; W.gold = 1000;
  g.command(0, { t: "fac", act: "hatch", key: 1 });
  g.step();
  assert.equal(p.pet.state, "none", "중간 급은 퍼실리티 2단계");
  g.command(0, { t: "fac", act: "hatch", key: 0 });
  g.step();
  assert.equal(p.pet.state, "hatching");
  assert.equal(W.core, 30 - hatchCost(0, false).core);
  run(hatchCost(0, false).time + 0.1);
  assert.equal(p.pet.state, "alive");
  const pet = g.units.get(p.pet.unitId);
  assert.ok(pet && pet.type === UTYPE.PET && pet.owner === 0 && pet.order.type === "follow");
  assert.equal(pet.maxHp, petHp(0, 1));
  g.step();
  assert.equal(json(0, "me").at(-1).pet.state, "alive");
  // 레벨 업
  const gold = W.gold, core = W.core;
  g.command(0, { t: "fac", act: "level" });
  g.step();
  assert.equal(p.pet.level, 2);
  assert.equal(W.gold, gold - PET.LEVELS[2].gold);
  assert.equal(W.core, core - PET.LEVELS[2].core);
  assert.equal(pet.info, 2);
  assert.equal(pet.maxHp, petHp(0, 2));
  assert.equal(g.viewOf(0).units.find((u) => u.id === pet.id).info, 2, "스냅숏 info = 레벨");
  assert.equal(pet.perk, null, "특기는 레벨 3 부터");
  W.gold += PET.LEVELS[3].gold; W.core += PET.LEVELS[3].core;
  g.command(0, { t: "fac", act: "level" });
  g.step();
  assert.equal(p.pet.level, 3);
  assert.equal(pet.perk, MONSTERS[0].perk, "레벨 3 특기(슬라임 = 흡혈)");
  pet.hp = 10;
  const E = g.heroOf(1);
  E.invuln = 0;
  g.hurtUnit(E, 20, { team: 0, unit: pet.id, slot: 0 });
  assert.equal(pet.hp, 10 + 20 * 0.3, "흡혈: 준 피해의 30%");
  // 쓰러지면 사라진다(부활 없음 — 레벨도 잃는다)
  clear();
  g.hurtUnit(pet, 9999, { team: 1, unit: 0, slot: 1 });
  run(0.3);
  assert.ok(!g.units.has(pet.id), "몬스터가 사라졌다");
  assert.deepEqual([p.pet.state, p.pet.level, p.pet.unitId], ["none", 1, 0]);
  assert.equal(json(0, "me").at(-1).pet.state, "none");
  assert.ok(json(0, "note").some((n) => /다시 살 수/.test(n.text)));
  // 다시 산다 — 이번에는 도감 할인
  T.fac.dex.add(0);
  const c2 = W.core;
  g.command(0, { t: "fac", act: "hatch", key: 0 });
  g.step();
  assert.equal(W.core, c2 - Math.round(MONSTER_TIERS[0].hatch.core * PET.DEX_DISCOUNT), "도감 할인 × 0.75");
  run(hatchCost(0, true).time + 0.1);
  assert.equal(p.pet.state, "alive");
  const id = p.pet.unitId;
  g.command(0, { t: "fac", act: "release" });
  g.step();
  assert.equal(p.pet.state, "none");
  assert.ok(!g.units.has(id), "놓아 주면 사라진다(돌려받지 않는다)");
});

test("잉크봇: 코어 8 로 사고, 쓰러지면 사라져 코어로 다시 사야 한다", () => {
  const { g, json, run } = setup();
  const T = g.teams[0];
  const W = g.players[0]; // 내 지갑(U31)
  W.core = 0;
  g.command(0, { t: "train", what: "bot" });
  g.step();
  assert.equal(g.players[0].queue.length, 0, "코어가 없으면 못 뽑는다");
  W.core = UNITS.bot.train.core;
  g.command(0, { t: "train", what: "bot" });
  g.step();
  assert.equal(W.core, 0);
  run(UNITS.bot.train.time + 0.2);
  const [bot] = unitsOf(g, 0, UTYPE.BOT);
  assert.ok(bot, "잉크봇이 나왔다");
  assert.equal(bot.tank, INK.BOT_TANK);
  assert.equal(json(0, "me").at(-1).counts.bot, 1);
  g.hurtUnit(bot, 9999, { team: 1, unit: 0, slot: 1 });
  run(0.5);
  assert.ok(!g.units.has(bot.id));
  assert.equal(json(0, "me").at(-1).counts.bot, 0);
  g.command(0, { t: "train", what: "bot" });
  g.step();
  assert.equal(g.players[0].queue.length, 0, "다시 사려면 다시 코어");
});

test("잉크봇: 분대(follow)로 영웅 곁을 따르고, 영웅이 던진 곳의 적을 함께 친다", () => {
  const { g, run } = setup();
  const T = g.teams[0];
  const W = g.players[0]; // 내 지갑(U31)
  W.core = 16;
  g.command(0, { t: "train", what: "bot" });
  g.command(0, { t: "train", what: "bot" });
  run(UNITS.bot.train.time * 2 + 0.5);
  const bots = unitsOf(g, 0, UTYPE.BOT);
  assert.equal(bots.length, 2);
  g.command(0, { t: "cmd", o: "follow", ids: bots.map((b) => b.id) });
  const h = g.heroOf(0), E = g.heroOf(1);
  const p = arena(g, 4);
  put(g, h, p.x, p.y);
  run(12);
  for (const b of bots) assert.ok(Math.hypot(b.x - h.x, b.y - h.y) < 3, "영웅 곁에 모였다");
  put(g, E, h.x + 3.5, h.y);
  run(0.2); // 이웃 바구니 · 시야가 새 자리를 알게
  g.heroThrow(h, E.x, E.y, false);
  run(4);
  assert.ok(E.hp < HERO.HP - 16, `잉크봇도 쳤다(${E.hp})`);
  assert.ok(bots.some((b) => b.tank < INK.BOT_TANK), "잉크봇이 탱크 잉크를 썼다");
});

test("잉크봇: 보석 줍기(grab) 명령 → 머리에 이고 우리 탑으로 가져가 점수", () => {
  const { g, run } = setup();
  const T = g.teams[0];
  const W = g.players[0]; // 내 지갑(U31)
  W.core = 8;
  g.command(0, { t: "train", what: "bot" });
  run(UNITS.bot.train.time + 0.3);
  const [bot] = unitsOf(g, 0, UTYPE.BOT);
  const s = g.sites.find((x) => !x.center);
  g.popGem(s, 0);
  run(0.5);
  g.command(0, { t: "cmd", o: "grab", ids: [bot.id], target: s.id });
  let picked = false;
  for (let i = 0; i < 120 / TICK && T.score === 0; i++) {
    g.step();
    if (bot.gem >= 0) picked = true;
  }
  assert.ok(picked, "잉크봇이 보석을 들었다");
  assert.equal(T.score, s.value, "잉크봇이 배달했다");
  assert.equal(bot.gem, -1);
});

test("일꾼: 잉크 공급소 짓기(골드 150 · 팀에 3곳까지) — 다 지으면 탱크를 채우고 캔 것을 받는다", () => {
  const { g, json, run } = setup();
  const T = g.teams[0];
  const W = g.players[0]; // 내 지갑(U31)
  W.gold = 1000;
  const ws = unitsOf(g, 0, UTYPE.WORKER);
  const tw = g.tower(0);
  // 탑 둘레에서 지을 수 있는 자리
  let spot = null;
  for (let r = 3; r < 14 && !spot; r++)
    for (let k = 0; k < 16 && !spot; k++) {
      const a = (k / 16) * Math.PI * 2;
      const tx = Math.round(tw.cx + Math.cos(a) * r - 1.5), ty = Math.round(tw.cy + Math.sin(a) * r - 1.5);
      if (g.canPlace(tx, ty, 3)) spot = { tx, ty };
    }
  assert.ok(spot, "지을 자리");
  // 일꾼에게서 먼 자리는 거절(U18) — 골드도 그대로
  // 일꾼을 지을 자리에서 가장 먼 우리 본진 쪽(탑 반대편 · 영웅 나오는 자리)으로
  const far = [g.map.bases[0].spawn, { x: tw.cx * 2 - (spot.tx + 1.5), y: tw.cy * 2 - (spot.ty + 1.5) }]
    .sort((p, q) => rectDist(q.x, q.y, spot.tx, spot.ty, 3) - rectDist(p.x, p.y, spot.tx, spot.ty, 3))[0];
  for (const w of ws) { w.x = far.x; w.y = far.y; w.path = null; }
  if (ws.every((w) => rectDist(w.x, w.y, spot.tx, spot.ty, 3) > BUILD_NEAR + 1)) {
    g.command(0, { t: "place", kind: "supply", tx: spot.tx, ty: spot.ty, ids: ws.map((w) => w.id) });
    g.step();
    assert.equal(g.supplies(0, false).length, 1, "일꾼에게서 먼 자리에는 짓지 않는다");
    assert.equal(W.gold, 1000);
    assert.ok(json(0, "note").some((n) => /일꾼 바로 옆에만/.test(n.text)));
  }
  for (const w of ws) { w.x = spot.tx + 1.5; w.y = spot.ty + 1.5; w.path = null; }
  g.command(0, { t: "place", kind: "supply", tx: spot.tx, ty: spot.ty, ids: ws.map((w) => w.id) });
  g.step();
  const b = g.supplies(0, false).find((x) => x.tx === spot.tx && x.ty === spot.ty);
  assert.ok(b && !b.built, "짓기 시작");
  assert.equal(W.gold, 1000 - 150);
  assert.ok(g.blk[spot.ty * g.S + spot.tx], "짓는 자리는 막힌다");
  g.command(0, { t: "place", kind: "supply", tx: spot.tx, ty: spot.ty, ids: ws.map((w) => w.id) });
  g.step();
  assert.equal(W.gold, 850, "겹치는 자리는 거절");
  for (let i = 0; i < 60 / TICK && !b.built; i++) g.step();
  assert.ok(b.built, "다 지었다");
  assert.ok(json(0, "note").some((n) => /완성/.test(n.text)));
  assert.equal(g.supplies(0, true).length, 2);
  // 팀에 3곳까지
  const sp2 = [];
  for (let r = 3; r < 20 && sp2.length < 2; r++)
    for (let k = 0; k < 24 && sp2.length < 2; k++) {
      const a = (k / 24) * Math.PI * 2;
      const tx = Math.round(tw.cx + Math.cos(a) * r - 1.5), ty = Math.round(tw.cy + Math.sin(a) * r - 1.5);
      if (g.canPlace(tx, ty, 3) && !sp2.some((q) => Math.abs(q.tx - tx) < 5 && Math.abs(q.ty - ty) < 5)) sp2.push({ tx, ty });
    }
  for (const q of sp2) { ws[0].x = q.tx + 1.5; ws[0].y = q.ty + 1.5; ws[0].path = null; g.command(0, { t: "place", kind: "supply", tx: q.tx, ty: q.ty, ids: [ws[0].id] }); g.step(); }
  assert.equal(g.supplies(0, false).length, 3);
  assert.ok(json(0, "note").some((n) => /최대 3곳/.test(n.text)));
});

// ───────────── 보석(§10) ─────────────
test("아케이드 보석: 방어막 → 바위 → 보석 · 머리에 이고(던지기 못 함 · 안개 너머로 보임) · 탑에 배달하면 점수와 골드", () => {
  const { g, json, fxOf, run, clear } = setup();
  const A = g.heroOf(0);
  const T = g.teams[0];
  const W = g.players[0]; // 내 지갑(U31)
  const s = g.sites.find((x) => !x.center);
  const at = nearSite(g, s, 3.5);
  put(g, A, at.x, at.y);
  const states = new Set();
  for (let i = 0; i < 90 / TICK && s.state !== SITE_STATE.GEM; i++) {
    if (A.throwCd <= 0) { A.tank = INK.TANK; g.heroThrow(A, s.x, s.y, true); }
    g.step();
    states.add(s.state);
  }
  assert.ok(states.has(SITE_STATE.ROCK), "방어막이 깨지면 바위");
  assert.equal(s.state, SITE_STATE.GEM, "바위가 깨지면 보석");
  g.step();
  assert.ok(fxOf(0, "gem").some((e) => e.ev === "pop"));
  const gem = g.gems.get(s.id);
  assert.ok(gem && gem.state === 0);
  run(0.5);
  put(g, A, gem.x, gem.y);
  g.step();
  assert.equal(gem.state, 1);
  assert.equal(gem.carrier, A.id);
  assert.ok(g.wireUnits().find((x) => x.u === A).w.flags & UF.GEM);
  run(0.3);
  assert.equal(json(0, "me").at(-1).carry, gem.value);
  // 든 동안 던질 수 없다
  clear();
  const tank = A.tank;
  run(0.6);
  assert.equal(g.heroThrow(A, A.x + 3, A.y, false), false);
  assert.equal(A.tank, tank);
  assert.ok(json(0, "note").some((n) => /보석 들면 못 던져요/.test(n.text)));
  // 상대 팀에게도 보인다(안개 예외)
  g.teams[1].vis.fill(0);
  assert.ok(g.viewOf(1).units.some((u) => u.id === A.id), "운반자는 안개 너머로도 보인다");
  // 배달
  const gold = W.gold;
  const spot = besideBuilding(g, g.tower(0), 1.2);
  put(g, A, spot.x, spot.y);
  g.step();
  assert.equal(T.score, gem.value);
  assert.equal(W.gold, gold + GEM.DELIVER_GOLD);
  assert.equal(A.gem, -1);
  assert.equal(g.players[0].stats.delivered, gem.value);
  assert.equal(s.state, SITE_STATE.EMPTY);
  assert.ok(!g.gems.has(s.id));
  assert.ok(json(0, "score").some((m) => m.team === 0 && m.value === gem.value));
  assert.ok(json(1, "score").length >= 1, "모두에게 알린다");
  run(GEM.RESPAWN + 0.2);
  assert.equal(s.state, SITE_STATE.SHIELD, "45초 뒤 다시 선다");
  assert.equal(s.shield, GEM.SHIELD_HP);
});

test("아케이드 보석: 방어막은 8초 동안 안 치면 다시 찬다", () => {
  const { g, run } = setup();
  const A = g.heroOf(0);
  const s = g.sites.find((x) => !x.center);
  const at = nearSite(g, s, 3.5);
  put(g, A, at.x, at.y);
  g.heroThrow(A, s.x, s.y, false);
  run(2);
  assert.ok(s.shield < GEM.SHIELD_HP);
  run(GEM.SHIELD_REGEN_AFTER);
  assert.equal(s.shield, GEM.SHIELD_HP);
});

test("퀴즈 보석: 방어막을 깬 사람에게 문제 — 맞히면 보석, 틀리면 방어막이 다시 서고 그 사람은 잠시 못 받는다", () => {
  const { g, json, run, clear } = setup({ mode: "quiz" });
  assert.equal(g.mode, "quiz");
  const A = g.heroOf(0);
  const p = g.players[0];
  const [s, s2] = g.sites.filter((x) => !x.center);
  const breakShield = (site) => {
    const at = nearSite(g, site, 3.5);
    put(g, A, at.x, at.y);
    for (let i = 0; i < 60 / TICK && site.state === SITE_STATE.SHIELD && !A.quiz; i++) {
      if (A.throwCd <= 0) { A.tank = INK.TANK; g.heroThrow(A, site.x, site.y, true); }
      g.step();
      if (json(0, "note").some((n) => /다시 받을 수/.test(n.text))) break;
    }
  };
  breakShield(s);
  assert.equal(s.state, SITE_STATE.QUIZ, "아케이드와 달리 바위가 아니라 문제");
  assert.equal(s.team, 0, "풀이 중인 팀");
  const q = json(0, "quiz").at(-1);
  assert.ok(q && q.site === s.id && q.q.text && q.q.choices.length >= 2 && q.time === GEM.QUIZ_TIME);
  g.step();
  assert.equal(A.anim, ANIM.QUIZ, "푸는 동안 영웅은 선다");
  // 뜨자마자 누른 답은 받지 않고 문제 창을 다시 연다(잘못 누름 막기)
  g.command(0, { t: "answer", choice: 0 });
  g.step();
  assert.ok(A.quiz, "아직 풀이 중");
  assert.equal(json(0, "quiz").length, 2, "문제 창을 다시 보낸다");
  assert.equal(json(0, "quizResult").length, 0);
  // 다른 팀은 바위를 칠 수 없다 · 푸는 동안 움직임 보고는 무시
  g.explode(s.x, s.y, { team: 1, w: 0, big: true, src: { team: 1, unit: 0, slot: 1 } });
  assert.equal(s.state, SITE_STATE.QUIZ);
  const x0 = A.x;
  g.command(0, { t: "mv", x: A.x + 0.3, y: A.y });
  g.step();
  assert.equal(A.x, x0);
  // 맞히기
  run(0.7);
  const right = A.quiz.order.indexOf(QS[A.quiz.idx].answer);
  g.command(0, { t: "answer", choice: right });
  g.step();
  assert.equal(json(0, "quizResult").at(-1).ok, true);
  assert.equal(s.state, SITE_STATE.GEM, "정답이면 바위가 깨져 보석");
  assert.ok(g.gems.has(s.id));
  assert.equal(p.stats.right, 1);
  // 틀리기
  clear();
  breakShield(s2);
  assert.equal(s2.state, SITE_STATE.QUIZ);
  run(0.7);
  const wrong = (A.quiz.order.indexOf(QS[A.quiz.idx].answer) + 1) % A.quiz.order.length;
  g.command(0, { t: "answer", choice: wrong });
  g.step();
  assert.equal(json(0, "quizResult").at(-1).ok, false);
  assert.equal(s2.state, SITE_STATE.SHIELD);
  assert.equal(s2.shield, GEM.SHIELD_HP, "방어막이 가득 다시 선다");
  assert.ok(p.lock[s2.id] > g.time, "그 섹션 잠깐 못 받는다");
  run(0.3);
  assert.ok(json(0, "me").at(-1).lock[s2.id] > 0);
  assert.equal(p.stats.wrong, 1);
  // 잠긴 동안 다시 깨도 문제가 오지 않는다
  clear();
  breakShield(s2);
  assert.equal(json(0, "quiz").length, 0);
  assert.equal(s2.state, SITE_STATE.SHIELD);
  assert.ok(json(0, "note").some((n) => /다시 받을 수/.test(n.text)));
});

test("퀴즈 보석: 시간이 다하면 틀린 것과 같다", () => {
  const { g, json, run } = setup({ mode: "quiz" });
  const s = g.sites[0];
  g.startQuiz(s, 0);
  assert.equal(s.state, SITE_STATE.QUIZ);
  run(GEM.QUIZ_TIME + 0.2);
  const r = json(0, "quizResult").at(-1);
  assert.ok(r && !r.ok && r.timeout);
  assert.equal(s.state, SITE_STATE.SHIELD);
});

test("퀴즈 보석(U35): 푸는 동안 멈추는 것은 그 영웅 하나 — 다치지도 밀리지도 않고 탑도 노리지 않는다 · 끝나면 다시 맞는다", () => {
  const { g, json, run } = setup({ mode: "quiz" });
  const A = g.heroOf(0), E = g.heroOf(1);
  // 적 탑 사거리 안에 세워 둔다
  const spot = besideBuilding(g, g.tower(1), 1.2);
  put(g, A, spot.x, spot.y);
  g.startQuiz(g.sites[0], 0);
  assert.ok(A.quiz, "문제를 받았다");
  const notes = json(0, "note").map((m) => m.text || "");
  assert.ok(notes.some((t) => /퀴즈 푸는 중/.test(t)) && !notes.some((t) => /지켜 줘요/.test(t)), "팀 알림은 '퀴즈 푸는 중'");
  const hp0 = A.hp;
  assert.equal(g.hurtUnit(A, 40, { team: 1, unit: E.id, slot: 1 }), false, "피해를 막는다");
  g.knock(A, 6, 0, 1, 1);
  assert.ok(!A.kbAcc && A.stun === 0 && A.slow === 0, "밀리지 · 굳지 · 느려지지 않는다");
  assert.ok(g.unitFlags(A) & UF.INVULN, "다른 화면에는 무적처럼 보인다");
  const e0 = E.x;
  run(3);
  assert.equal(A.hp, hp0, "탑이 노리지 않는다");
  assert.ok(A.quiz, "아직 풀이 중");
  assert.ok(g.phase === PHASE.PLAY && g.time > 3, "경기는 그대로 흐른다");
  // 틀리게 답하면 풀이가 끝나고, 탑이 다시 친다
  const wrong = (A.quiz.order.indexOf(QS[A.quiz.idx].answer) + 1) % A.quiz.order.length;
  g.command(0, { t: "answer", choice: wrong });
  g.step();
  assert.equal(A.quiz, null);
  assert.ok(!(g.unitFlags(A) & UF.INVULN));
  run(4);
  assert.ok(A.hp < hp0, "풀이가 끝나면 다시 맞는다");
  assert.equal(E.x, e0);
});

test("퀴즈 보석: 컴퓨터는 잠깐 생각한 뒤 약 65% 맞힌다", () => {
  const { g } = setup({ mode: "quiz", bots: [true, false] });
  const p = g.players[0];
  const h = g.heroOf(0);
  const s = g.sites[0];
  const N = 600;
  for (let i = 0; i < N; i++) {
    p.lock = {};
    s.state = SITE_STATE.SHIELD;
    g.startQuiz(s, 0);
    assert.ok(h.quiz && h.quiz.botAt > g.time + 1, "곧바로 답하지 않는다");
    h.quiz.botAt = g.time;
    g.stepSites();
    assert.equal(h.quiz, null);
  }
  const rate = p.stats.right / N;
  assert.equal(p.stats.right + p.stats.wrong, N);
  assert.ok(Math.abs(rate - BOT.ACCURACY) < 0.06, `정답률 ${rate}`);
});

test("보석: 든 영웅이 쓰러지면 그 자리에 떨어지고 적이 주워 자기 탑에 가져가면 적의 점수 · 30초 동안 안 주우면 섹션으로 돌아간다", () => {
  const { g, fxOf, run } = setup();
  const A = g.heroOf(0), B = g.heroOf(1);
  const s = g.sites.find((x) => !x.center);
  g.popGem(s, 0);
  const gem = g.gems.get(s.id);
  run(0.5);
  put(g, A, gem.x, gem.y);
  g.step();
  assert.equal(gem.carrier, A.id);
  const p = arena(g, 3);
  put(g, A, p.x, p.y);
  run(0.2);
  g.hurtUnit(A, 999, { team: 1, unit: B.id, slot: 1 });
  assert.ok(A.dead);
  assert.equal(gem.state, 0, "떨어졌다");
  assert.ok(Math.hypot(gem.x - p.x, gem.y - p.y) < 1.5);
  g.step();
  assert.ok(fxOf(1, "gem").some((e) => e.ev === "drop"));
  assert.equal(g.teams[1].kos, 1);
  run(0.5);
  put(g, B, gem.x, gem.y);
  g.step();
  assert.equal(gem.carrier, B.id, "적이 주웠다");
  const spot = besideBuilding(g, g.tower(1), 1.2);
  put(g, B, spot.x, spot.y);
  g.step();
  assert.equal(g.teams[1].score, gem.value, "적의 점수");
  assert.equal(g.teams[0].score, 0);
  // 돌아가기
  const s2 = g.sites.find((x) => !x.center && x !== s);
  g.popGem(s2, 0);
  const g2 = g.gems.get(s2.id);
  g.dropGemAt(g2, p.x, p.y);
  run(GEM.DROP_RETURN + 0.2);
  assert.equal(g2.state, 0);
  assert.deepEqual([g2.x, g2.y], [s2.x, s2.y], "섹션 자리로 돌아갔다");
});

// ───────────── 탑(§7) ─────────────
/** 영웅을 한 번 쓰러뜨린다(부활 뒤 무적은 걷어 낸다) */
function ko(g, h, by) {
  h.invuln = 0;
  h.shieldUntil = 0;
  g.hurtUnit(h, 999, { team: by.team, unit: by.id, slot: by.owner });
}

test("탑(U27): 상대가 깃발의 탑을 부수면 그 팀은 곧바로 탈락 — elim 알림 · 유닛 · 건물이 사라지고 든 보석은 떨어진다 · 그 팀은 구경(teamOut · 안개 없음 · 명령 무시) · 마지막 남은 팀이 이긴다(last) · 순위는 남은 팀 → 늦게 탈락한 팀", () => {
  const { g, json, fxOf, run } = setup({ teams: 3 });
  const [T0, T1, T2] = g.teams;
  const A = g.heroOf(0), B = g.heroOf(1);
  // 잉크봇 · 몬스터도 둔다
  g.players[0].core = 40; g.players[0].gold = 500;
  g.command(0, { t: "train", what: "bot" });
  g.command(0, { t: "fac", act: "hatch", key: 0 });
  run(UNITS.bot.train.time + 0.3);
  assert.ok(unitsOf(g, 0, UTYPE.BOT).length === 1 && g.players[0].pet.state === "alive");
  // 다친 탑은 무너지기 전에 일꾼이 고칠 수 있다
  const tw = g.tower(0);
  g.hurtBuilding(tw, 1000, { team: 1, unit: B.id, slot: 1 });
  const hurt = tw.hp;
  g.command(0, { t: "cmd", o: "repair", ids: unitsOf(g, 0, UTYPE.WORKER).map((w) => w.id), target: tw.id });
  run(8);
  assert.ok(tw.hp > hurt, "고친다");
  // 보석을 든 채 탈락
  const s = g.sites.find((x) => !x.center);
  g.popGem(s, 0);
  g.pickGem(g.gems.get(s.id), A);
  T0.score = 5;
  const towerCell = (tw.ty + 1) * g.S + tw.tx + 1;
  g.hurtBuilding(tw, tw.hp + 5, { team: 1, unit: B.id, slot: 1 });
  assert.ok(T0.out, "탈락");
  assert.equal(T0.outReason, "tower");
  assert.ok(!g.over, "두 팀이 남아 경기는 이어진다");
  const elim = json(1, "elim").at(-1);
  assert.deepEqual(elim, { t: "elim", team: 0, by: 1, reason: "tower", left: [1, 2] });
  assert.ok(json(0, "elim").length === 1 && json(2, "elim").length === 1, "모두에게");
  assert.ok(json(2, "note").some((n) => n.text === "핑크 팀 탈락! (탑이 부서졌어요)"));
  assert.equal([...g.units.values()].filter((u) => u.team === 0 && !u.dead).length, 0, "유닛이 모두 사라졌다");
  assert.equal([...g.buildings.values()].filter((b) => b.team === 0).length, 0, "건물이 모두 무너졌다");
  assert.equal(g.gems.get(s.id).state, 0, "든 보석은 떨어진다");
  assert.equal(T0.score, 5, "점수는 남는다");
  g.step();
  assert.ok(fxOf(1, "bdown").filter((e) => e.team === 0).length >= 4, "무너지는 사건");
  assert.equal(g.blk[towerCell], 0, "무너진 자리는 지나갈 수 있다");
  run(0.3);
  const me = json(0, "me").at(-1);
  assert.equal(me.teamOut, true);
  // 구경: 안개 없이 모두 본다 · 명령은 받지 않는다
  const C = g.heroOf(2);
  g.teams[0].vis.fill(0);
  assert.ok(g.viewOf(0).units.some((u) => u.id === C.id), "구경하는 팀은 안개 없이 본다");
  g.players[0].gold = 500;
  g.command(0, { t: "train", what: "worker" });
  g.command(0, { t: "lab", act: "unlock", key: "missile" });
  g.step();
  assert.deepEqual([g.players[0].queue.length, T0.lab.job], [0, null], "명령은 받지 않는다");
  // 다시 들어온 사람: start.out
  assert.deepEqual(g.startInfo(0).out, [0]);
  assert.equal(g.startInfo(0).lives, HERO.LIVES);
  // 하나 더 탈락하면 마지막 남은 팀이 이긴다
  run(1);
  const tw2 = g.tower(2);
  g.hurtBuilding(tw2, tw2.hp + 5, { team: 1, unit: B.id, slot: 1 });
  assert.ok(g.over);
  const end = json(1, "end").at(-1);
  assert.equal(end.reason, "last");
  assert.equal(end.winner, 1);
  assert.deepEqual(end.ranking.map((r) => r.team), [1, 2, 0], "남은 팀 → 늦게 탈락한 팀 → 먼저 탈락한 팀(점수가 높아도)");
  assert.deepEqual(end.ranking.map((r) => r.out), [false, true, true]);
});

test("영웅 목숨(U26): 쓰러질 때마다 me.lives 3 → 2 → 1 → 0, 세 번째에는 다시 나오지 않는다(heroOut) — 지휘(cmd · train · lab · buy)는 되고 mv · throw · weapon 은 무시 · 따라오던 잉크봇은 그 자리를 지킨다", () => {
  const { g, json, run } = setup({ per: 2 });
  const p = g.players[0];
  const A = g.heroOf(0), B = g.heroOf(2);
  const T0 = g.teams[0];
  p.core = 8; p.gold = 2000;
  g.command(0, { t: "train", what: "bot" });
  run(UNITS.bot.train.time + 0.3);
  const [bot] = unitsOf(g, 0, UTYPE.BOT);
  g.command(0, { t: "cmd", o: "follow", ids: [bot.id] });
  run(0.5);
  assert.equal(json(0, "me").at(-1).lives, HERO.LIVES);
  const lives = [];
  for (let k = 0; k < HERO.LIVES; k++) {
    ko(g, A, B);
    run(0.3);
    lives.push(json(0, "me").at(-1).lives);
    if (k < HERO.LIVES - 1) {
      assert.ok(json(0, "note").some((n) => n.text.includes(`부활 · 목숨 ${HERO.LIVES - k - 1}`)));
      run(HERO.RESPAWN);
      assert.ok(!A.dead, "아직 목숨이 있으면 다시 나온다");
    }
  }
  assert.deepEqual(lives, [2, 1, 0]);
  assert.equal(g.teams[1].kos, HERO.LIVES, "쓰러뜨린 팀의 KO");
  assert.ok(p.heroOut);
  assert.ok(json(0, "note").some((n) => n.text === "목숨을 다 썼어요 · 이제 지휘관!"));
  run(HERO.RESPAWN + 5);
  assert.ok(A.dead, "다시 나오지 않는다");
  assert.ok(!g.viewOf(0).units.some((u) => u.id === A.id), "스냅숏에 영웅이 없다");
  const me = json(0, "me").at(-1);
  assert.deepEqual([me.lives, me.heroOut, me.teamOut, me.dead], [0, true, false, 0]);
  assert.equal(bot.order.type, "hold", "따라오던 잉크봇은 그 자리를 지킨다");
  assert.ok(!T0.out, "팀 동료의 영웅이 살아 있으면 팀은 남는다");
  // 지휘는 된다
  const ws = unitsOf(g, 0, UTYPE.WORKER);
  g.command(0, { t: "cmd", o: "gather", ids: ws.map((w) => w.id), target: { res: "gold" } });
  g.command(0, { t: "train", what: "worker" });
  g.command(0, { t: "lab", act: "unlock", key: "missile" });
  g.command(0, { t: "cmd", o: "follow", ids: [bot.id] });
  g.step();
  assert.ok(ws.every((w) => w.order.type === "gather"));
  assert.equal(p.queue.length, 1);
  assert.equal(T0.lab.job.kind, "unlock");
  assert.equal(bot.order.type, "hold", "영웅이 없으면 따라오기 대신 지키기");
  run(16);
  g.command(0, { t: "buy", w: WEAPON.missile });
  g.step();
  assert.equal(p.inv[WEAPON.missile], 2 * WEAPONS[WEAPON.missile].pack.n, "사기도 된다");
  // 영웅 조작은 무시
  const at = { x: A.x, y: A.y, w: A.weapon, tank: A.tank };
  g.command(0, { t: "mv", x: A.x + 0.5, y: A.y });
  g.command(0, { t: "throw", tx: A.x + 3, ty: A.y, big: 0 });
  g.command(0, { t: "weapon", w: WEAPON.missile });
  g.step();
  assert.deepEqual({ x: A.x, y: A.y, w: A.weapon, tank: A.tank }, at);
});

test("팀 탈락(U27): 팀의 영웅이 모두 목숨을 다 쓰면 탈락(heroes) · 두 팀 경기면 남은 팀이 곧 이긴다(last)", () => {
  const three = setup({ teams: 3 });
  const A = three.g.heroOf(0), B = three.g.heroOf(1);
  for (let k = 0; k < HERO.LIVES; k++) { ko(three.g, A, B); three.run(HERO.RESPAWN + 0.2); }
  assert.ok(three.g.teams[0].out);
  assert.deepEqual(three.json(1, "elim").at(-1), { t: "elim", team: 0, by: -1, reason: "heroes", left: [1, 2] });
  assert.ok(three.json(2, "note").some((n) => n.text === "핑크 팀 탈락! (영웅이 모두 쓰러졌어요)"));
  assert.ok(!three.g.over);
  const two = setup();
  const C = two.g.heroOf(1), D = two.g.heroOf(0);
  for (let k = 0; k < HERO.LIVES; k++) { ko(two.g, C, D); if (!two.g.over) two.run(HERO.RESPAWN + 0.2); }
  assert.ok(two.g.over);
  assert.equal(two.box.ended.reason, "last");
  assert.equal(two.box.ended.winner, 0);
});

test("끝(U27): 시간이 다 되면 남은 팀끼리(점수 → KO) — 탈락한 팀은 점수가 높아도 이길 수 없다", () => {
  const a = setup({ teams: 3, minutes: 0.1 });
  a.g.teams[0].score = 9;
  a.g.teams[2].score = 2;
  a.g.eliminate(0, 1, "tower");
  a.run(10);
  assert.equal(a.box.ended.reason, "time");
  assert.equal(a.box.ended.winner, 2);
  assert.deepEqual(a.box.ended.ranking.map((r) => r.team), [2, 1, 0]);
  const b = setup({ teams: 3, minutes: 0.1 });
  b.g.teams[0].score = 9;
  b.g.eliminate(0, 1, "tower");
  b.run(10);
  assert.equal(b.box.ended.winner, -1, "남은 팀이 비기면 무승부(탈락한 팀이 이기지 않는다)");
});

test("탑: 서 있는 탑은 사거리 안의 적 영웅에게 풍선을 던지고, 탑 사격은 건물 · 섹션을 건드리지 않는다", () => {
  const { g, run } = setup();
  const B = g.heroOf(1);
  const tw = g.tower(0);
  const spot = besideBuilding(g, tw, 3);
  put(g, B, spot.x, spot.y);
  const hits = [];
  const hb = g.hurtBuilding.bind(g);
  g.hurtBuilding = (b, d, s) => { hits.push(d); return hb(b, d, s); };
  run(4);
  assert.ok(B.hp < HERO.HP, `탑 사격(${B.hp})`);
  assert.equal(hits.length, 0);
});

// ───────────── 상자 · 드릴(§12 · §4) ─────────────
test("상자: 폭발에 깨지면 바닥이 되고(사건 · 늦게 온 사람의 start.crates) · 드릴 미사일은 상자 셋을 뚫는다", () => {
  const { g, fxOf, run } = setup({ map: "factory" });
  const S = g.S;
  const A = g.heroOf(0);
  // 오른쪽으로 상자 셋 이상이 이어지고 왼쪽 두 칸이 빈 줄(드릴용)
  let row = null;
  for (let y = 3; y < S - 3 && !row; y++)
    for (let x = 4; x < S - 6 && !row; x++) {
      const t = (dx) => g.map.tiles[y * S + x + dx];
      if (t(0) === TILE.CRATE && t(1) === TILE.CRATE && t(2) === TILE.CRATE && !g.blk[y * S + x - 1] && !g.blk[y * S + x - 2] && !g.blk[(y - 1) * S + x - 2] && !g.blk[(y + 1) * S + x - 2]) row = { x, y };
    }
  assert.ok(row, "상자 줄");
  // 다른 상자 하나: 폭발 여러 번에 깨진다
  let ci = -1;
  for (let i = 0; i < S * S && ci < 0; i++) if (g.map.tiles[i] === TILE.CRATE && Math.abs((i % S) - row.x) > 8) ci = i;
  const cx = (ci % S) + 0.5, cy = Math.floor(ci / S) + 0.5;
  let hits = 0;
  while (g.map.tiles[ci] === TILE.CRATE && hits < 20) {
    g.explode(cx, cy, { team: 0, w: 0, big: true, src: { team: 0, unit: A.id, slot: 0 } });
    hits++;
  }
  assert.equal(g.map.tiles[ci], TILE.FLOOR);
  assert.ok(hits > 1 && hits <= Math.ceil(CRATE_HP / (22 * 0.6)), `상자 체력 ${CRATE_HP}(${hits}번)`);
  assert.ok(g.broken.includes(ci));
  assert.ok(g.startInfo(1).crates.includes(ci));
  g.step();
  assert.ok(fxOf(1, "crate").some((e) => e.i === ci), "모두에게 알린다");
  assert.equal(g.blk[ci], 0, "지나갈 수 있다");
  // 드릴
  g.teams[0].lab.unlocked[WEAPON.drill] = true;
  g.players[0].inv[WEAPON.drill] = 6;
  A.weapon = WEAPON.drill;
  put(g, A, row.x - 1.5, row.y + 0.5);
  assert.ok(g.heroThrow(A, A.x + 6, A.y, false));
  run(1.2);
  const broken = [0, 1, 2].filter((dx) => g.map.tiles[row.y * S + row.x + dx] === TILE.FLOOR).length;
  assert.equal(broken, DRILL.PIERCE, "드릴이 상자 셋을 뚫었다");
});

// ───────────── 중립 몬스터 · 아이템(§11) ─────────────
test("중립 몬스터: 쓰러뜨린 팀이 골드(중간 · 큰 급은 코어도) · 도감을 받고, 같은 틱에 두 번 맞아도 한 번만 · 캠프는 120초 뒤 다시", () => {
  const { g, run } = setup({ npc: true });
  const T = g.teams[0];
  const W = g.players[0]; // 내 지갑(U31)
  const A = g.heroOf(0);
  const npcs = () => [...g.units.values()].filter((u) => u.type === UTYPE.NPC && !u.dead);
  const small = npcs().find((u) => MONSTERS[u.kind].tier === 0);
  const gold = W.gold, core = W.core;
  g.hurtUnit(small, 9999, { team: 0, unit: A.id, slot: 0 });
  assert.ok(!g.units.has(small.id));
  assert.equal(W.gold, gold + MONSTER_TIERS[0].gold);
  assert.equal(W.core, core);
  assert.ok(T.fac.dex.has(small.kind), "도감");
  const mid = npcs().find((u) => MONSTERS[u.kind].tier === 1);
  g.hurtUnit(mid, 9999, { team: 0, unit: A.id, slot: 0 });
  assert.equal(W.core, core + MONSTER_TIERS[1].core);
  assert.equal(W.gold, gold + MONSTER_TIERS[0].gold + MONSTER_TIERS[1].gold);
  const camp = g.camps[small.camp];
  const left = npcs().filter((u) => u.camp === camp.i);
  const goldBefore = W.gold;
  for (const u of left) { g.hurtUnit(u, 9999, { team: 0, unit: A.id, slot: 0 }); g.hurtUnit(u, 9999, { team: 0, unit: A.id, slot: 0 }); }
  assert.equal(camp.alive, 0);
  assert.equal(W.gold, goldBefore + left.reduce((a, u) => a + MONSTER_TIERS[MONSTERS[u.kind].tier].gold, 0), "보상은 한 번씩");
  assert.ok(camp.respawnAt > g.time);
  run(NPC.RESPAWN + 1);
  assert.equal(camp.alive, camp.kinds.length, "캠프가 다시 나왔다");
});

test("중립 몬스터: 다가온 영웅을 미리 알리고(warn) 공격한다", () => {
  const { g, fxOf, run } = setup({ npc: true, seed: 21 });
  const A = g.heroOf(0);
  const gob = [...g.units.values()].find((u) => u.type === UTYPE.NPC && u.kind === 4);
  const at = nearestFree(g.grid, gob.x + 2.5, gob.y, 4);
  put(g, A, at.x, at.y);
  run(8);
  assert.ok(fxOf(0, "warn").length >= 1, "공격 예고");
  assert.ok(A.hp < HERO.HP, `맞았다(${A.hp})`);
});

// ───────────── 가운데 보스가 보석을 지킨다(U21) ─────────────
/** 가운데 섹션 · 지킴이만 남긴 경기(다른 중립 몬스터는 치운다) */
function centerSetup(opts = {}) {
  const env = setup({ npc: true, ...opts });
  const { g } = env;
  const center = g.sites.find((s) => s.center);
  for (const u of [...g.units.values()]) if (u.type === UTYPE.NPC && !center.guards.includes(u.camp)) g.units.delete(u.id);
  const guards = [...g.units.values()].filter((u) => u.type === UTYPE.NPC);
  const boss = guards.find((u) => MONSTERS[u.kind].boss);
  // 보스 집에서 가장 먼, 가운데에서 dist 칸 떨어진 설 자리(던지면 사거리 끝에서 방어막에 닿는다)
  const spotAt = (dist) => {
    let best = null, bd = -1;
    for (let k = 0; k < 48; k++) {
      const an = (k / 48) * Math.PI * 2;
      const x = center.x + Math.cos(an) * dist, y = center.y + Math.sin(an) * dist;
      if (!standable(g, x, y)) continue;
      const d = Math.hypot(x - boss.home.x, y - boss.home.y);
      if (d > bd) { bd = d; best = { x, y }; }
    }
    assert.ok(best, "설 자리");
    return best;
  };
  return { ...env, center, guards, boss, spotAt };
}

test("가운데 보스(U21): 사거리 끝에서 가운데 방어막을 친 영웅에게 간다 — 평소 어그로 밖이어도 · 안개 너머로도 보이고(UF.RAGE) · 그 팀에 알림 한 번", () => {
  const { g, json, fxOf, run, center, guards, boss, spotAt } = centerSetup();
  assert.ok(center.guards.length >= 1 && boss, "가운데 캠프가 지킨다");
  assert.ok(g.sites.filter((s) => !s.center).every((s) => s.guards.length === 0), "옆 섹션 캠프는 그대로(지키지 않는다)");
  const A = g.heroOf(0);
  const at = spotAt(8.7);
  put(g, A, at.x, at.y);
  run(0.3);
  const d0 = Math.hypot(boss.x - A.x, boss.y - A.y);
  assert.ok(d0 > NPC.AGGRO + 3, `평소 어그로 밖(${d0.toFixed(1)}칸)`);
  assert.ok(!boss.target);
  const shield = center.shield;
  g.heroThrow(A, center.x, center.y, false);
  run(flightTime(6.5, false) + 0.1);
  assert.ok(center.shield < shield, "방어막을 쳤다");
  assert.ok(boss.defend && boss.defend.target === A.id, "보스가 친 영웅을 노린다");
  assert.ok(guards.every((u) => u.defend && u.defend.target === A.id), "가운데 캠프 모두");
  // 안개 너머로도 보인다(친 팀만)
  g.teams[0].vis.fill(0);
  g.teams[1].vis.fill(0);
  const seen = decodeSnapshot(encodeSnapshot(g.viewOf(0))).units.find((u) => u.id === boss.id);
  assert.ok(seen && seen.flags & UF.RAGE, "친 팀의 스냅숏에 화난 보스");
  assert.ok(!g.viewOf(1).units.some((u) => u.id === boss.id), "치지 않은 팀에게는 안개 그대로");
  const notes = json(0, "note").filter((n) => /가운데 보스가 화났어요! p00에게 가요/.test(n.text));
  assert.equal(notes.length, 1);
  assert.ok(notes[0].at && Number.isFinite(notes[0].at.x), "알림에 자리");
  // 다가와 공격한다(미리 알리는 평소 공격)
  A.tank = INK.TANK;
  g.heroThrow(A, center.x, center.y, false);
  run(3);
  assert.ok(Math.hypot(boss.x - A.x, boss.y - A.y) < d0 - 1.5, "보스가 다가온다");
  for (let i = 0; i < 20 / TICK && A.hp === HERO.HP; i++) {
    if (A.throwCd <= 0 && i % 40 === 0) { A.tank = INK.TANK; g.heroThrow(A, center.x, center.y, false); }
    g.step();
  }
  assert.ok(A.hp < HERO.HP, "지킴이에게 맞았다");
  // 보스의 공격은 평소처럼 미리 알린다: 힘 모으기(WIND) 뒤 경고 고리(warn) 또는 보이는 먹물(projs)
  A.invuln = 999;
  let wound = false, shot = false;
  const warns = fxOf(0, "warn").length;
  for (let i = 0; i < 10 / TICK; i++) {
    if (A.throwCd <= 0 && i % 40 === 0) { A.tank = INK.TANK; g.heroThrow(A, center.x, center.y, false); }
    g.step();
    if (boss.anim === ANIM.WIND) wound = true;
    if (g.projs.some((q) => q.monster && q.src.unit === boss.id)) shot = true;
  }
  assert.ok(boss.defend, "계속 지킨다");
  assert.ok(wound, "공격 전에 힘을 모은다(WIND — 피할 틈)");
  assert.ok(fxOf(0, "warn").length > warns || shot, "경고 고리나 보이는 먹물(projs)로 알린다");
  assert.equal(json(0, "note").filter((n) => /가운데 보스가 화났어요/.test(n.text)).length, 1, "알림은 한 번(지키는 동안)");
});

test("가운데 보스(U21): 상대가 끈 밖으로 가거나 쓰러지거나, 섹션을 한동안 안 치면 집으로 돌아간다 · 다른 상대로는 더 가깝거나 거듭 칠 때만 바꾼다", () => {
  const { g, run, center, boss, spotAt } = centerSetup();
  const A = g.heroOf(0), B = g.heroOf(1);
  const home = { ...boss.home };
  // ① 끈 밖으로
  const at = spotAt(7);
  put(g, A, at.x, at.y);
  g.defendSite(center, A);
  run(2);
  assert.ok(boss.defend);
  const far = g.map.bases[0].spawn;
  put(g, A, far.x, far.y);
  run(0.5);
  assert.equal(boss.defend, null, "끈 밖이면 그만둔다");
  run(20);
  assert.ok(Math.hypot(boss.x - home.x, boss.y - home.y) < 1, "집으로 돌아갔다");
  assert.ok(!boss.target);
  // ② 쓰러지면
  put(g, A, at.x, at.y);
  g.defendSite(center, A);
  run(1);
  g.hurtUnit(A, 999, { team: 1, unit: 0, slot: 1 });
  run(0.5);
  assert.equal(boss.defend, null, "상대가 쓰러지면 그만둔다");
  run(HERO.RESPAWN + 20);
  assert.ok(Math.hypot(boss.x - home.x, boss.y - home.y) < 1);
  // ③ 조용하면(무적인 상대가 끈 안에 그대로 있어도)
  put(g, A, at.x, at.y);
  A.invuln = 999;
  g.defendSite(center, A);
  run(GUARD.CALM - 1);
  assert.ok(boss.defend, "아직 지킨다");
  run(1.5);
  assert.equal(boss.defend, null, `${GUARD.CALM}초 동안 안 치면 그만둔다`);
  // ④ 바꾸기: 더 먼 새 상대가 한 번 친 것으로는 안 바꾸고, 지금 상대가 쉬는 동안 거듭 치면 바꾼다
  run(20);
  put(g, A, at.x, at.y);
  const bt = spotAt(9.5);
  put(g, B, bt.x, bt.y);
  B.invuln = 999;
  g.defendSite(center, A);
  g.step();
  assert.ok(Math.hypot(B.x - boss.x, B.y - boss.y) > Math.hypot(A.x - boss.x, A.y - boss.y), "B 가 더 멀다");
  g.defendSite(center, B);
  assert.equal(boss.defend.target, A.id, "더 먼 상대가 한 번 친 것으로는 바꾸지 않는다");
  run(2);
  g.defendSite(center, B);
  assert.equal(boss.defend.target, B.id, "거듭 치면 바꾼다");
});

test("아이템: 영웅이 닿으면 에너지 · 부스터 · 보호막", () => {
  const { g, run } = setup();
  const A = g.heroOf(0);
  const p = arena(g, 2);
  put(g, A, p.x, p.y);
  A.hp = 40;
  g.dropItem(0, A.x, A.y);
  g.step();
  assert.equal(A.hp, 75);
  assert.equal(g.items.length, 0);
  g.dropItem(1, A.x, A.y);
  g.dropItem(2, A.x, A.y);
  run(0.2);
  assert.ok(A.boostUntil > g.time && A.shieldUntil > g.time);
  const hp = A.hp;
  g.hurtUnit(A, 50, { team: 1, unit: 0, slot: 1 });
  assert.equal(A.hp, hp, "보호막 동안 다치지 않는다");
});

// ───────────── 접속 · 끝 ─────────────
test("접속: 나간 학생의 영웅은 컴퓨터가 잇고, 돌아오면 warp 로 위치를 맞춘다", () => {
  const { g, json, run, clear } = setup();
  const h = g.heroOf(0);
  const x0 = h.x, y0 = h.y;
  g.setConnected(0, false);
  assert.equal(g.players[0].bot, true);
  run(5);
  assert.ok(Math.hypot(h.x - x0, h.y - y0) > 1, "컴퓨터가 움직인다");
  clear();
  g.setConnected(0, true);
  g.step();
  assert.equal(g.players[0].bot, false);
  const w = json(0, "warp").at(-1);
  assert.ok(w && Math.abs(w.x - h.x) < 0.01);
});

test("끝: 목표 점수에 닿으면 곧 이기고 end 에 순위 · 학생별 기록", () => {
  const { g, json, box } = setup();
  g.teams[1].score = GOAL - 1;
  const A = g.heroOf(1);
  const s = g.sites[0];
  g.popGem(s, 1);
  g.pickGem(g.gems.get(s.id), A);
  const spot = besideBuilding(g, g.tower(1), 1.2);
  put(g, A, spot.x, spot.y);
  g.step();
  assert.ok(g.over);
  assert.equal(box.ended.reason, "goal");
  assert.equal(box.ended.winner, 1);
  const end = json(0, "end").at(-1);
  assert.equal(end.winner, 1);
  assert.equal(end.ranking[0].team, 1);
  for (const k of ["kos", "deaths", "delivered", "right", "ink", "gold", "core"]) assert.ok(k in end.players[0], `players.${k}`);
  const t = g.tickNo;
  g.step();
  assert.equal(g.tickNo, t, "끝난 경기는 멈춘다");
});

test("끝: 시간이 다 되면 점수 → 팀 KO → 무승부", () => {
  const a = setup({ minutes: 0.05 });
  a.g.teams[0].kos = 3;
  a.run(5);
  assert.equal(a.box.ended.reason, "time");
  assert.equal(a.box.ended.winner, 0, "점수가 같으면 KO");
  const b = setup({ minutes: 0.05 });
  b.run(5);
  assert.equal(b.box.ended.winner, -1, "모두 같으면 무승부");
});

test("컴퓨터: 공급소가 모두 무너지면 본진에 다시 짓고, 일꾼을 골드 · 잉크 · 코어로 나눠 캔다", () => {
  const { g, run } = setup({ bots: [true, false] });
  const T = g.teams[0];
  g.players[0].gold = 600;
  g.buildingZero(g.supplies(0, true)[0]);
  run(0.2);
  assert.equal(g.supplies(0, false).length, 0, "공급소가 없다");
  run(40);
  assert.ok(g.supplies(0, true).length >= 1, "다시 지었다");
  run(60);
  const res = unitsOf(g, 0, UTYPE.WORKER).map((w) => w.res).sort();
  assert.ok(res.length >= 3, `일꾼을 더 뽑았다(${res.length})`);
  assert.ok(res.includes("gold") && res.includes("ink") && res.includes("core"), `나눠 캔다(${res})`);
});

// ───────────── 컴퓨터만의 경기(§14) ─────────────
function botMatch({ teams, per, map, mode = "arcade", seed, minutes = 10 }) {
  const players = [];
  for (let t = 0; t < teams; t++) for (let k = 0; k < per; k++) players.push({ name: `c${t}${k}`, team: t, bot: true });
  let result = null;
  const g = new Game({ seed, teams, players, minutes, map, mode, questions: mode === "quiz" ? QS : [], send() {}, onEnd: (r) => { result = r; } });
  let pets = 0;
  const facAct = g.facAct.bind(g);
  g.facAct = (p, act, key) => { const st = p.pet.state; facAct(p, act, key); if (act === "hatch" && st === "none" && p.pet.state === "hatching") pets++; };
  let buys = 0, special = 0, bad = 0;
  const buy = g.buy.bind(g);
  g.buy = (p, w) => { const r = buy(p, w); if (r) buys++; return r; };
  const heroThrow = g.heroThrow.bind(g);
  g.heroThrow = (h, x, y, big) => { const w = h.weapon; const r = heroThrow(h, x, y, big); if (r && w) special++; return r; };
  const t0 = Date.now();
  const limit = (minutes * 60 + 10) / TICK;
  for (let i = 0; i < limit && !g.over; i++) {
    g.step();
    // 든 무기는 늘 소지품에 있다(0 개인 무기를 든 채 멈추지 않는다)
    if (i % 20 === 0) for (const p of g.players) { const h = g.heroOf(p.slot); if (h.weapon !== 0 && !(p.inv[h.weapon] > 0)) bad++; }
  }
  const unlocks = g.teams.reduce((a, T) => a + T.lab.unlocked.filter(Boolean).length - 1, 0);
  return { g, result, pets, unlocks, buys, special, bad, ms: Date.now() - t0 };
}

for (const cfg of [
  { teams: 8, per: 4, map: "forest", seed: 7 },
  { teams: 2, per: 2, map: "forest", seed: 7 },
  { teams: 4, per: 1, map: "canal", seed: 3 },
  { teams: 3, per: 2, map: "factory", mode: "quiz", seed: 5 },
]) {
  test(`컴퓨터만: ${cfg.teams}팀 × ${cfg.per} ${cfg.map} ${cfg.mode || "arcade"} — 끝까지 돌고 보석 · 랩 · 소지품 · 몬스터를 쓴다`, () => {
    const { g, result, pets, unlocks, buys, special, bad, ms } = botMatch(cfg);
    assert.ok(g.over && result, "경기가 끝났다");
    assert.ok(["goal", "time", "last"].includes(result.reason), result.reason);
    assert.equal(result.ranking.length, cfg.teams);
    if (result.reason === "goal") assert.ok(g.teams[result.winner].score >= GOAL);
    if (result.reason === "last") assert.deepEqual(g.teams.filter((T) => !T.out).map((T) => T.id), [result.winner], "마지막 남은 팀이 이겼다");
    assert.ok(g.teams.some((T) => T.score > 0), "보석을 배달했다");
    assert.ok(unlocks >= cfg.teams, "랩에서 무기를 샀다");
    assert.ok(pets >= 1, "코어로 몬스터를 샀다");
    assert.ok(buys >= cfg.teams, `소지품 묶음을 샀다(${buys})`);
    assert.ok(special > 0, "산 무기를 던졌다");
    assert.equal(bad, 0, "0 개인 무기를 들고 있지 않다");
    if (cfg.mode === "quiz") assert.ok(result.players.some((p) => p.right > 0), "문제를 맞혔다");
    assert.ok(ms < 20000, `빨리 돈다(${ms}ms)`);
  });
}

// ───────────── 시작 전 읽기(U32) ─────────────
test("시작 전(U32): 모두 '이기는 방법'을 닫으면(ready) 모든 팀이 함께 5초를 세고 동시에 시작 · 다 안 닫아도 BRIEF_MAX 뒤에는 시작", async () => {
  const { BRIEF_MAX, COUNTDOWN } = await import("../shared/constants.js");
  const out = [];
  const mk = () => new Game({
    seed: 3, teams: 2, minutes: 5, map: "forest", mode: "arcade", brief: true,
    players: [{ name: "가", team: 0, bot: false }, { name: "나", team: 1, bot: false }, { name: "컴", team: 1, bot: true }],
    send: (slot, m) => out.push({ slot, m }), onEnd() {},
  });
  const g = mk();
  assert.equal(g.phase, PHASE.BRIEF);
  for (let i = 0; i < 40; i++) g.step();
  assert.equal(g.phase, PHASE.BRIEF, "사람이 다 닫기 전에는 기다린다");
  g.command(0, { t: "ready" }); g.step();
  assert.equal(g.phase, PHASE.BRIEF, "한 사람만 닫았다");
  assert.ok(out.some((o) => o.m.t === "brief" && o.m.ready === 1 && o.m.total === 2));
  g.command(1, { t: "ready" }); g.step(); g.step(); // 명령은 틱 안에서 처리되고, 다음 틱에 세기를 시작한다
  assert.equal(g.phase, PHASE.COUNTDOWN, "모두 닫으면 세기 시작");
  const cnt = out.filter((o) => o.m.t === "count");
  assert.equal(new Set(cnt.map((o) => o.slot)).size, 2, "두 사람 모두 같은 시작 틱을 받는다");
  assert.ok(cnt.every((o) => o.m.playTick === cnt[0].m.playTick));
  const startTick = cnt[0].m.playTick;
  while (g.phase === PHASE.COUNTDOWN) g.step();
  assert.equal(g.phase, PHASE.PLAY);
  assert.equal(g.tickNo, startTick, "알린 틱에 시작");
  assert.ok(Math.abs(g.endsAt - g.playAt - 5 * 60) < 1e-6, "경기 시간은 시작부터");
  // 다 안 닫아도 BRIEF_MAX 뒤에는 시작한다
  const g2 = mk();
  g2.command(0, { t: "ready" });
  for (let i = 0; i < (BRIEF_MAX + 0.2) / TICK; i++) g2.step();
  assert.equal(g2.phase, PHASE.COUNTDOWN);
  for (let i = 0; i < (COUNTDOWN + 0.2) / TICK; i++) g2.step();
  assert.equal(g2.phase, PHASE.PLAY);
  // 닫지 않은 사람이 나가면 기다리지 않는다
  const g3 = mk();
  g3.command(0, { t: "ready" }); g3.step();
  g3.setConnected(1, false); g3.step();
  assert.equal(g3.phase, PHASE.COUNTDOWN, "끊긴 사람은 준비로 친다");
});
