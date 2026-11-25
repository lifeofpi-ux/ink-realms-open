// 경기 한 판(docs/DESIGN.md v2 「깃발의 탑」). 서버 권위 20Hz — 영웅 위치만 학생 브라우저가 정하고 서버가 검사한다(§3 · §15).
//
//   const g = new Game({ seed, teams, players: [{ name, team, bot, char }], minutes, map, mode, questions, quizTitle, send, onEnd })
//   g.command(slot, msg)    — 학생의 명령(JSON). 다음 틱에 처리한다
//   g.step()                — 한 틱(TICK 초) 나아가고 스냅숏 · 사건 · me · team 을 보낸다
//   g.startInfo(slot)       — 들어오는(다시 들어오는) 사람에게 주는 start
//   g.setConnected(slot, b) — 나간 학생의 자리는 컴퓨터가 잇는다
//   send(slot, data)        — data 는 ArrayBuffer(스냅숏) 또는 객체(JSON)
//
// 차례: ① 만들기 ② 명령 ③ 영웅 움직임 검사 ④ 던지기 · 탄 · 폭발 · 피해 ⑤ 건물 · 랩 · 퍼실리티 · 뽑기 ⑥ 보석 섹션 · 퀴즈 · 보석
//       ⑦ 몬스터 · 아이템 ⑧ 움직임 도우미(길 · 밀어내기) ⑨ 시야 · 스냅숏 · 보내기 ⑩ 끝 · 접속
// 유닛 두뇌(일꾼 · 잉크봇 · 몬스터)와 컴퓨터 플레이어는 server/bots.js 에 있다.
import {
  TICK, SNAP_EVERY, ME_EVERY, TEAM_EVERY, COUNTDOWN, NEUTRAL, GOAL, DEFAULT_MINUTES, TEAM_NAMES, MAX_PER_TEAM, mapKey,
  TILE, isSolidTile, CRATE_HP, HERO, DASH, JUMP, INK, THROW, flightTime, WEAPONS, WEAPON, MISSILE, HOMING, FIREWORK, VORTEX,
  DRILL, SLOW, shotInk, throwRange, START, POND, MINE, CORE_MINE, RES_KINDS, UTYPE, UNITS, SQUAD, MONSTERS, MONSTER_TIERS, PET, petScale, petHp, petDmg,
  hatchCost, NPC, ITEMS, ITEM_PICK, ITEM_LIFE, BLD, BUILDINGS, TOWER, REPAIR, LAB, RESEARCH_FX, FACILITY, GEM, SITE_STATE,
  BOT, canAfford, pay, costText, RESEARCH_FX as RFX, stackMax, GIVE,
  BUILD_NEAR,
  BRIEF_MAX,
} from "../shared/constants.js";
import { generateMap, fillBlocked, rectOnFloor } from "../shared/map.js";
import { Grid, findPath, nearestFree, lineClear } from "../shared/path.js";
import { heroStep, slide, unstick, newHeroBody, blockedTile } from "../shared/move.js";
import { encodeSnapshot, PHASE, ANIM, UF, BF } from "../shared/protocol.js";
import { mulberry32 } from "../shared/rng.js";
import { createQuizbook } from "./quizbook.js";
import { unitTick, updateBots, botHeroInput } from "./bots.js";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const CREDIT = 7; // KO 를 마지막으로 맞힌 팀에게 주는 시간 창(초)
const DEAD_SHOW = 1.6; // 쓰러진 영웅을 스냅숏에 남겨 두는 시간(KO 연출)
const HATCH_SHOW = 0.6; // 막 나온 유닛 깃발(UF.HATCH)
const PATH_BUDGET = 40; // 한 틱에 새로 찾는 길의 수(많은 유닛이 한꺼번에 길을 찾아도 틱이 늘어지지 않게)
const MV_MAX_GAP = 0.6; // 영웅 위치 보고 사이로 인정하는 가장 긴 시간(초)
const WARP_QUIET = 0.25; // 되돌린 뒤 이만큼은 보고를 무시한다(브라우저가 warp 를 받기 전의 보고)
const QUEUE_MAX = 5;
const CELL = 4; // 이웃 찾기 칸 크기(칸)
// 섹션 지킴이(U21): 지키는 섹션(방어막 · 바위)을 친 영웅 · 잉크봇 · 몬스터에게 간다 — 평소 어그로 거리 · 끈 밖이어도.
// 끈 = 섹션 가운데에서 방어막 반지름 + 친 팀의 던지기 사거리 + LEASH_PAD. CALM 초 동안 섹션을 아무도 안 치면 돌아간다.
// NEAR = 섹션에서 이만큼 안의 캠프가 지킴이. CENTER_ONLY = 가운데 섹션만(옆 섹션 캠프도 지키게 하려면 false)
export const GUARD = Object.freeze({ CENTER_ONLY: true, NEAR: 6.5, LEASH_PAD: 3, CALM: 8 });

export function rectDist(x, y, tx, ty, w) {
  const dx = Math.max(tx - x, 0, x - (tx + w));
  const dy = Math.max(ty - y, 0, y - (ty + w));
  return Math.hypot(dx, dy);
}
const angDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
const r2 = (v) => Math.round(v * 100) / 100;

/** 이웃 찾기 — 매 틱 다시 담는 칸 바구니 */
class Buckets {
  constructor(S) {
    this.W = Math.ceil(S / CELL);
    this.cells = Array.from({ length: this.W * this.W }, () => []);
    this.out = [];
  }
  clear() { for (const c of this.cells) c.length = 0; }
  add(u) {
    const W = this.W;
    const cx = clamp(Math.floor(u.x / CELL), 0, W - 1), cy = clamp(Math.floor(u.y / CELL), 0, W - 1);
    this.cells[cy * W + cx].push(u);
  }
  /** (x, y) 둘레 r 안에 있을 수 있는 유닛들(정확한 거리는 부르는 쪽이 본다). 돌려주는 배열은 다음 부름에서 다시 쓴다 */
  query(x, y, r, out = this.out) {
    out.length = 0;
    const W = this.W;
    const x0 = clamp(Math.floor((x - r) / CELL), 0, W - 1), x1 = clamp(Math.floor((x + r) / CELL), 0, W - 1);
    const y0 = clamp(Math.floor((y - r) / CELL), 0, W - 1), y1 = clamp(Math.floor((y + r) / CELL), 0, W - 1);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const c = this.cells[cy * W + cx];
      for (let i = 0; i < c.length; i++) out.push(c[i]);
    }
    return out;
  }
}

const circleCache = new Map();
function circle(r) {
  let c = circleCache.get(r);
  if (!c) {
    const pts = [];
    const R = Math.ceil(r);
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) if (x * x + y * y <= r * r + 0.5) pts.push(x, y);
    c = Int16Array.from(pts);
    circleCache.set(r, c);
  }
  return c;
}

export class Game {
  // ───────────── ① 만들기 ─────────────
  constructor(o = {}) {
    this.seed = (o.seed >>> 0) || 1;
    this.rand = mulberry32(this.seed ^ 0x5bd1e995);
    this.kind = mapKey(o.map);
    this.map = generateMap(this.seed, o.teams || 2, this.kind);
    this.S = this.map.size;
    this.nTeams = this.map.teams;
    this.send = o.send || (() => {});
    this.onEnd = o.onEnd || (() => {});
    this.minutes = o.minutes || DEFAULT_MINUTES;
    this.quiz = createQuizbook(o.questions || [], this.nTeams, this.rand);
    this.quizTitle = o.quizTitle || "";
    const wantQuiz = o.mode ? o.mode === "quiz" : this.quiz.size > 0;
    this.mode = wantQuiz && this.quiz.size > 0 ? "quiz" : "arcade";

    this.time = 0;
    this.tickNo = 0;
    // 시작 전(U32): brief 면 모두 "이기는 방법"을 닫을 때까지(최대 BRIEF_MAX 초) 기다린 뒤 모든 팀이 함께 COUNTDOWN 초를 센다
    this.brief = !!o.brief;
    this.phase = this.brief ? PHASE.BRIEF : PHASE.COUNTDOWN;
    this.playAt = this.brief ? Infinity : COUNTDOWN;
    this.endsAt = this.brief ? Infinity : COUNTDOWN + this.minutes * 60;
    this.over = false;
    this.result = null;

    this.nextId = 1;
    this.nextProjId = 1;
    this.nextItemId = 1;
    this.units = new Map();
    this.buildings = new Map();
    this.balloons = []; // 포물선 풍선(브라우저는 arc 사건으로 날린다)
    this.projs = []; // 곧게 나는 것(미사일 · 유도 · 드릴 · 몬스터 먹물) — 스냅숏 projs
    this.vortices = [];
    this.later = []; // 폭죽 둘레 폭발
    this.waves = []; // 몬스터 충격파
    this.zones = []; // 몬스터 폭탄(떨어질 자리)
    this.items = [];
    this.fx = [];
    this.inbox = [];
    this.broken = []; // 깨진 상자 칸 번호(늦게 들어온 사람에게 보낸다)
    this.crateHp = new Map();
    this.pathBudget = PATH_BUDGET;
    this.hash = new Buckets(this.S);
    this.squads = new Map();

    const S = this.S;
    this.blk = new Uint8Array(S * S);
    this.flyBlk = new Uint8Array(S * S);
    this.bldAt = new Int32Array(S * S);
    this.siteAt = new Int16Array(S * S);
    this.grid = new Grid(S);
    this.grid.block = this.blk;
    this.flyGrid = new Grid(S);
    this.flyGrid.block = this.flyBlk;
    this.blkDirty = true;

    // 팀
    this.teams = [];
    for (let t = 0; t < this.nTeams; t++) {
      this.teams.push({
        id: t, score: 0, kos: 0, // 자원은 학생마다 따로(U31 — players[].gold · core · ink). team JSON 의 자원은 팀원 지갑의 합
        lab: { lv: 1, job: null, unlocked: WEAPONS.map((w) => w.tier === 0), research: {} },
        fac: { lv: 1, job: null, research: {}, dex: new Set() },
        towerId: 0, labId: 0, facId: 0,
        out: false, outAt: 0, outReason: "", outBy: -1, // 탈락(U27): 탑이 부서짐 · 영웅이 모두 목숨을 다 씀
        vis: new Uint8Array(S * S), dirty: true, alarmAt: -99,
      });
    }
    // 플레이어
    this.players = (o.players || []).map((p, slot) => ({
      slot, name: String(p.name || `학생 ${slot + 1}`).slice(0, 16), team: clamp(p.team | 0, 0, this.nTeams - 1), bot: !!p.bot,
      char: Number.isInteger(p.char) ? p.char & 7 : slot & 7, connected: !p.bot, humanEver: !p.bot,
      heroId: 0, queue: [], pet: { kind: -1, level: 1, state: "none", t: 0, total: 0, unitId: 0 },
      // 내 지갑(U31): 내 일꾼이 캔 것 · 내가 받은 보상이 들어오고, 내가 누른 것은 내가 낸다. made = 캔 것 + 보상, spent = 쓴 것, given = 보낸 것
      gold: START.gold, core: START.core, ink: START.ink,
      made: { gold: 0, core: 0, ink: 0 }, spent: { gold: 0, core: 0, ink: 0 }, given: { gold: 0, core: 0, ink: 0 }, giveTimes: [],
      lives: HERO.LIVES, heroOut: false, // 영웅 목숨(U26 — 지금 것 포함). 0 이면 영웅은 더 나오지 않고 지휘만 한다
      inv: WEAPONS.map(() => 0), // 소지품(무기마다 남은 개수 — inv[0] 기본 잉크는 끝이 없어 늘 0). 쓰러져도 그대로
      stats: { kos: 0, deaths: 0, delivered: 0, right: 0, wrong: 0, ink: 0, gold: 0, core: 0 },
      lock: {}, meDirty: true, meAt: -99, teamAt: -99, noteAt: {}, needSync: false, brain: null,
    }));

    // 건물(본진마다 탑 · 공급소 · 랩 · 퍼실리티)
    for (const b of this.map.bases) {
      const T = this.teams[b.team];
      T.towerId = this.addBuilding(BLD.TOWER, b.team, b.tower.tx, b.tower.ty, true).id;
      this.addBuilding(BLD.SUPPLY, b.team, b.supply.tx, b.supply.ty, true);
      T.labId = this.addBuilding(BLD.LAB, b.team, b.lab.tx, b.lab.ty, true).id;
      T.facId = this.addBuilding(BLD.FACILITY, b.team, b.facility.tx, b.facility.ty, true).id;
    }
    // 보석 섹션
    this.sites = this.map.sites.map((s) => ({
      id: s.id, x: s.x, y: s.y, tx: s.tx, ty: s.ty, center: s.center, value: s.center ? GEM.VALUE.center : GEM.VALUE.side,
      state: SITE_STATE.SHIELD, shield: GEM.SHIELD_HP, rock: GEM.ROCK_HP, team: -1, timer: 0, hitAt: -99, quizSlot: -1,
    }));
    this.gems = new Map(); // 섹션 번호 → 보석
    // 캐는 곳(잉크 연못 · 금광 · 코어 금광) — 모두 마르지 않는다
    this.nodes = { ink: [], gold: [], core: [] };
    const addNode = (res, i, n, size, amount, time, reach, slots) => {
      this.nodes[res].push({ res, i, tx: n.tx, ty: n.ty, size, cx: n.tx + size / 2, cy: n.ty + size / 2, rich: !!n.rich, team: n.team ?? -1, amount, time, reach, slots, miners: new Set(), safe: true });
    };
    this.map.ponds.forEach((n, i) => addNode("ink", i, n, POND.SIZE, POND.BASE, POND.TIME, POND.REACH, 0));
    (this.map.mines || []).forEach((n, i) => addNode("gold", i, n, MINE.SIZE, n.rich ? MINE.RICH : MINE.BASE, MINE.TIME, MINE.REACH, 0));
    (this.map.cores || []).forEach((n, i) => addNode("core", i, n, CORE_MINE.SIZE, CORE_MINE.AMOUNT, CORE_MINE.TIME, CORE_MINE.REACH, CORE_MINE.SLOTS));
    this.rebuildBlocked();

    // 영웅 · 일꾼
    const perTeam = Array(this.nTeams).fill(0);
    for (const p of this.players) {
      const k = perTeam[p.team]++;
      const sp = this.heroSpawnSpot(p.team, k);
      const h = this.spawnHero(p, sp.x, sp.y);
      p.heroId = h.id;
      // 처음 일꾼은 저절로 일하지 않는다(U17): 우리 팀 존에서 자기 영웅 곁에 모여 명령을 기다린다
      for (let i = 0; i < START.workers; i++) {
        const at = this.workerSpot(p.team, sp.x, sp.y, i);
        const w = this.spawnUnit(UTYPE.WORKER, p.team, p.slot, at.x, at.y);
        w.idleSince = this.playAt; // 컴퓨터는 경기가 시작된 뒤 조금 생각하고 일을 시킨다
      }
    }
    // 중립 몬스터 캠프
    this.camps = this.map.camps.map((c, i) => ({ ...c, kinds: [...c.kinds], i, alive: 0, respawnAt: 0 }));
    for (const c of this.camps) this.spawnCamp(c, false);
    // 섹션마다 지키는 캠프(U21)
    for (const st of this.sites) {
      st.guards = GUARD.CENTER_ONLY && !st.center ? [] : this.camps.filter((c) => Math.hypot(c.x - st.x, c.y - st.y) < GUARD.NEAR).map((c) => c.i);
      st.def = null; // 지키는 중 { until, teams, noted, hits }
    }
    this.rebuildHash();
    this.computeVision();
  }

  newId() {
    for (let k = 0; k < 65000; k++) {
      const id = this.nextId++;
      if (this.nextId > 65000) this.nextId = 1;
      if (!this.units.has(id) && !this.buildings.has(id)) return id;
    }
    return 1;
  }
  newProjId() {
    const id = this.nextProjId++;
    if (this.nextProjId > 65000) this.nextProjId = 1;
    return id;
  }

  addBuilding(kind, team, tx, ty, built) {
    const def = BUILDINGS[kind];
    const b = {
      id: this.newId(), kind, team, tx, ty, size: def.size, cx: tx + def.size / 2, cy: ty + def.size / 2,
      hp: built ? def.hp : Math.max(1, Math.round(def.hp * 0.1)), maxHp: def.hp, built: !!built, progress: built ? 1 : 0,
      builders: 0, broken: false, down: false, downUntil: 0, cd: 1, hitAt: -99, lastHitTeam: -1, lastHitAt: -99, isBuilding: true,
    };
    this.buildings.set(b.id, b);
    this.blkDirty = true;
    return b;
  }

  /** 맵 칸 · 건물 · 보석 바위로 막힌 칸 표를 다시 만들고, 막힌 칸에 선 유닛을 꺼낸다 */
  rebuildBlocked() {
    const S = this.S;
    const blds = [...this.buildings.values()];
    fillBlocked(this.map, this.blk, blds, this.sites.map((s) => ({ tx: s.tx, ty: s.ty, rock: this.hasRock(s) })));
    this.bldAt.fill(0);
    for (const b of blds) for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) if (x >= 0 && y >= 0 && x < S && y < S) this.bldAt[y * S + x] = b.id;
    this.siteAt.fill(0);
    for (const s of this.sites) if (this.hasRock(s)) for (let y = s.ty; y < s.ty + GEM.ROCK; y++) for (let x = s.tx; x < s.tx + GEM.ROCK; x++) this.siteAt[y * S + x] = s.id + 1;
    const tiles = this.map.tiles;
    for (let i = 0; i < S * S; i++) this.flyBlk[i] = this.blk[i] && (tiles[i] === TILE.WATER || tiles[i] === TILE.POND) && !this.bldAt[i] && !this.siteAt[i] ? 0 : this.blk[i];
    this.blkDirty = false;
    for (const u of this.units.values()) {
      if (u.dead) continue;
      const r = u.type === UTYPE.HERO ? HERO.RADIUS : this.bodyR(u);
      const p = unstick(u.fly ? this.flyBlk : this.blk, S, u.x, u.y, r);
      if (p.x !== u.x || p.y !== u.y) {
        u.x = p.x; u.y = p.y; u.path = null;
        if (this.isHumanHero(u)) this.warp(u);
      }
    }
  }

  hasRock(s) {
    return s.state === SITE_STATE.SHIELD || s.state === SITE_STATE.ROCK || s.state === SITE_STATE.QUIZ;
  }
  bodyR(u) {
    return Math.min(u.radius, 0.34);
  }

  baseUnit(type, team, owner, x, y) {
    return {
      id: this.newId(), type, team, owner, sub: 0, info: 0, x, y, z: 0, px: x, py: y, vxe: 0, vye: 0, facing: Math.PI / 2,
      hp: 1, maxHp: 1, radius: 0.25, speed: 2, sight: 6, anim: ANIM.SPAWN, animT: 0, dead: false, born: this.time,
      kvx: 0, kvy: 0, stun: 0, slow: 0, slowAt: -99, invuln: 0, shieldUntil: 0, boostUntil: 0,
      order: { type: "idle" }, anchor: { x, y }, path: null, pathKey: "", repathAt: 0, fails: 0, stuckT: 0, want: 0,
      lastHitTeam: -1, lastHitAt: -99, lastHitSlot: -1, lastHitUnit: 0, lastHitUnitAt: -99, hitAt: -99,
      gem: -1, gemAt: 0, fly: false, cd: 0, tank: 0,
    };
  }

  spawnHero(p, x, y) {
    const u = this.baseUnit(UTYPE.HERO, p.team, p.slot, x, y);
    Object.assign(u, newHeroBody(x, y), {
      sub: p.char, hp: HERO.HP, maxHp: HERO.HP, radius: HERO.RADIUS, speed: HERO.SPEED, sight: HERO.SIGHT,
      weapon: 0, tank: INK.TANK, throwCd: 0, bombCd: 0, dead: false, deadAt: -99, deadUntil: 0, quiz: null, c: 0,
      lastThrowAt: -99, movedAt: -99, moveDir: Math.PI / 2, assist: 0, assistAt: -99, input: null, bumped: false,
      mv: { at: 0, kb: 0, kbAt: -99, dashUntil: -99, dashLeft: 0, lastDash: -99, quietUntil: 0, dashing: false },
      kbAcc: null, refillFx: -99, jumpAt: 0,
    });
    u.anim = ANIM.IDLE;
    this.units.set(u.id, u);
    return u;
  }

  spawnUnit(type, team, owner, x, y) {
    const u = this.baseUnit(type, team, owner, x, y);
    const p = this.players[owner];
    if (type === UTYPE.WORKER) {
      const d = UNITS.worker;
      // res = 맡긴 자원(없으면 null) · job = 짓기 · 고치기 뒤 돌아갈 캐기 일 · idleSince = 할 일이 없어진 때
      Object.assign(u, { sub: p ? p.char : 0, hp: d.hp, maxHp: d.hp, radius: d.radius, speed: d.speed, sight: d.sight, carry: 0, carryRes: 0, work: 0, res: null, claim: null, job: null, idleSince: this.time });
    } else if (type === UTYPE.BOT) {
      const d = UNITS.bot;
      Object.assign(u, { sub: p ? p.char : 0, hp: d.hp, maxHp: d.hp, radius: d.radius, speed: d.speed, sight: d.sight, tank: INK.BOT_TANK, cd: 0.5 });
    }
    this.units.set(u.id, u);
    this.fx.push({ k: "spawn", id: u.id, x: u.x, y: u.y, team });
    return u;
  }

  /** 몬스터(중립 또는 내 몬스터) */
  spawnMonster(kind, team, owner, x, y, level = 1) {
    const M = MONSTERS[kind];
    const u = this.baseUnit(team === NEUTRAL ? UTYPE.NPC : UTYPE.PET, team, owner, x, y);
    const pet = team !== NEUTRAL;
    const sc = pet ? petScale(level) : 1;
    const hp = pet ? petHp(kind, level) : M.hp;
    Object.assign(u, {
      sub: kind, kind, info: pet ? level : 0, level, hp, maxHp: hp, radius: M.radius * sc, speed: M.speed, sight: NPC.SIGHT, fly: !!M.fly,
      st: "live", act: null, actSlot: null, t: 0, dashT: 0, dashSpeed: 0, dashHit: null, stunT: 0, gcd: this.time + 0.8, touchCd: 0,
      attacks: [M.atk, M.atk2].filter(Boolean).map((a) => ({ a, at: this.time + 1 + this.rand() * 1.5 })),
      target: 0, home: { x, y }, homing: false, camp: -1, dmgMul: 1, attackAt: -99,
    });
    this.refreshPet(u);
    this.units.set(u.id, u);
    this.fx.push({ k: "spawn", id: u.id, x: u.x, y: u.y, team });
    return u;
  }

  /** 내 몬스터의 레벨 · 연구 · 특기를 수치에 반영한다 */
  refreshPet(u) {
    if (u.type !== UTYPE.PET) return;
    const T = this.teams[u.team];
    u.dmgMul = petDmg(u.level) * (T && T.fac.research.wild ? FACILITY.WILD : 1);
    u.perk = u.level >= PET.PERK_LEVEL ? MONSTERS[u.kind].perk : null;
  }

  spawnCamp(c, announce) {
    c.alive = 0;
    // 가운데 큰 몬스터는 다시 나올 때마다 잉크 대왕 ↔ 거미 여왕(§10 — 번갈아)
    if (announce && c.tier === 2) c.kinds = c.kinds.map((k) => (k === 2 ? 7 : k === 7 ? 2 : k));
    c.kinds.forEach((kind, k) => {
      const a = (k / c.kinds.length) * TAU + 0.4;
      const r = k === 0 ? 0 : 1.4;
      const g = MONSTERS[kind].fly ? this.flyGrid : this.grid;
      const f = nearestFree(g, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, 6) || { x: c.x, y: c.y };
      const m = this.spawnMonster(kind, NEUTRAL, -1, f.x, f.y);
      m.camp = c.i;
      c.alive++;
    });
    if (announce) this.fx.push({ k: "spawn", id: 0, x: c.x, y: c.y, camp: c.i });
  }

  /** 건물 b 둘레의 빈 자리 중 (towardX, towardY) 쪽 */
  spotNear(b, towardX, towardY) {
    let best = null, bd = Infinity;
    for (let ring = 1; ring <= 4 && !best; ring++) {
      for (let y = b.ty - ring; y < b.ty + b.size + ring; y++)
        for (let x = b.tx - ring; x < b.tx + b.size + ring; x++) {
          const onRing = x === b.tx - ring || y === b.ty - ring || x === b.tx + b.size + ring - 1 || y === b.ty + b.size + ring - 1;
          if (!onRing || !this.grid.passable(x, y)) continue;
          let crowd = 0;
          for (const u of this.units.values()) if (!u.dead && Math.abs(u.x - x - 0.5) < 0.7 && Math.abs(u.y - y - 0.5) < 0.7) crowd++;
          const d = (x + 0.5 - towardX) ** 2 + (y + 0.5 - towardY) ** 2 + crowd * 25;
          if (d < bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; }
        }
    }
    return best || nearestFree(this.grid, b.cx, b.cy + b.size, 20) || { x: b.cx, y: b.cy };
  }

  /** 영웅이 나오는 자리: 탑 앞(꺾였으면 공급소 앞). k = 팀 안 차례(겹치지 않게 조금씩 비킨다) */
  heroSpawnSpot(team, k = 0) {
    const base = this.map.bases[team];
    const T = this.teams[team];
    const tower = this.buildings.get(T.towerId);
    let x = base.spawn.x, y = base.spawn.y;
    if (tower && tower.down) {
      const sup = this.supplies(team, true)[0];
      if (sup) { x = sup.cx + base.dir.x * 2.4; y = sup.cy + base.dir.y * 2.4; }
    }
    const off = (k % MAX_PER_TEAM) - (MAX_PER_TEAM - 1) / 2;
    x += base.perp.x * off * 1.2;
    y += base.perp.y * off * 1.2;
    const f = nearestFree(this.grid, x, y, 8) || { x, y };
    return unstick(this.blk, this.S, f.x, f.y, HERO.RADIUS);
  }

  /** 처음 일꾼 i 가 설 자리: 영웅(x, y) 바로 앞(가운데 쪽)에 둘씩 나란히 */
  workerSpot(team, x, y, i) {
    const base = this.map.bases[team];
    const row = 0.8 + Math.floor(i / 2) * 0.6, side = (i % 2 ? 1 : -1) * 0.33;
    const px = x + base.dir.x * row + base.perp.x * side, py = y + base.dir.y * row + base.perp.y * side;
    const f = this.grid.passableAt(px, py) ? { x: px, y: py } : nearestFree(this.grid, px, py, 6) || { x, y };
    return unstick(this.blk, this.S, f.x, f.y, UNITS.worker.radius);
  }

  supplies(team, builtOnly) {
    const out = [];
    for (const b of this.buildings.values()) if (b.team === team && b.kind === BLD.SUPPLY && (!builtOnly || b.built)) out.push(b);
    return out;
  }
  nearestSupply(team, x, y) {
    let best = null, bd = Infinity;
    for (const b of this.buildings.values()) {
      if (b.team !== team || b.kind !== BLD.SUPPLY || !b.built) continue;
      const d = rectDist(x, y, b.tx, b.ty, b.size);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  /** 일꾼이 캔 것을 내려놓을 곳: 가장 가까운 우리 공급소(다 지은 것) 또는 깃발의 탑 */
  dropoff(team, x, y) {
    let best = null, bd = Infinity;
    for (const b of this.buildings.values()) {
      if (b.team !== team || !b.built || (b.kind !== BLD.SUPPLY && b.kind !== BLD.TOWER)) continue;
      const d = rectDist(x, y, b.tx, b.ty, b.size);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  /** 그 팀 본진의 캐는 곳(없으면 가장 가까운 곳) */
  nodeFor(res, team) {
    const base = this.map.bases[team];
    const key = res === "ink" ? "pond" : res === "gold" ? "mine" : "core";
    const n = base && Number.isInteger(base[key]) ? this.nodes[res][base[key]] : null;
    return n || (base ? this.nearestNode(res, base.cx, base.cy) : this.nodes[res][0]);
  }
  /** (x, y) 에서 가장 가까운 그 자원의 캐는 곳. team 을 주면 위험한 곳(중립 몬스터가 지킴)은 멀리 친다 */
  nearestNode(res, x, y, team = -1) {
    let best = null, bd = Infinity;
    for (const n of this.nodes[res]) {
      let d = Math.hypot(n.cx - x, n.cy - y);
      if (team >= 0 && !n.safe) d += 40;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  /** 코어 금광 자리(SLOTS) 잡기 · 놓기 */
  claimSlot(u, node) {
    if (!node.slots) return true;
    if (node.miners.has(u.id)) return true;
    for (const id of node.miners) { const w = this.units.get(id); if (!w || w.dead || w.claim !== node) node.miners.delete(id); }
    if (node.miners.size >= node.slots) return false;
    node.miners.add(u.id);
    u.claim = node;
    return true;
  }
  releaseSlot(u) {
    if (u.claim) u.claim.miners.delete(u.id);
    u.claim = null;
  }

  heroOf(slot) {
    const p = this.players[slot];
    return p ? this.units.get(p.heroId) : null;
  }
  isHumanHero(u) {
    if (!u || u.type !== UTYPE.HERO) return false;
    const p = this.players[u.owner];
    return !!p && !p.bot;
  }
  tower(team) {
    const T = this.teams[team];
    return T ? this.buildings.get(T.towerId) : null;
  }

  // ───────────── ② 명령 ─────────────
  command(slot, msg) {
    if (this.over || !msg || typeof msg !== "object" || !this.players[slot]) return;
    if (this.inbox.length > 2000) return;
    this.inbox.push({ slot, msg });
  }

  handle(slot, msg) {
    const p = this.players[slot];
    if (!p) return;
    if (msg.t === "ready") {
      if (this.phase === PHASE.BRIEF && !p.ready) { p.ready = true; this.broadcastAll({ t: "brief", ...this.briefInfo() }); }
      return;
    }
    if (this.teams[p.team].out) return; // 탈락한 팀은 구경만(U27)
    // 영웅이 목숨을 다 쓴 학생은 지휘만(U26): 움직이기 · 던지기 · 무기 바꾸기는 받지 않는다
    if (p.heroOut && (msg.t === "mv" || msg.t === "throw" || msg.t === "weapon" || msg.t === "answer")) return;
    switch (msg.t) {
      case "mv": return this.onMove(p, msg);
      case "throw": {
        const h = this.heroOf(slot);
        if (h && !p.bot) this.heroThrow(h, +msg.tx, +msg.ty, !!msg.big);
        return;
      }
      case "weapon": return this.setWeapon(p, msg.w);
      case "buy": return this.buy(p, msg.w);
      case "give": return this.give(p, msg);
      case "cmd": return this.onCmd(p, msg);
      case "train": return this.train(p, String(msg.what || ""));
      case "place": return this.place(p, msg);
      case "lab": return this.labAct(p, String(msg.act || ""), msg.key);
      case "fac": return this.facAct(p, String(msg.act || ""), msg.key);
      case "answer": return this.answer(p, msg.choice | 0);
    }
  }

  // ───────────── 내 지갑(U31) ─────────────
  /** 내 지갑으로 낼 수 있나. 모자라면 "골드 부족(40/120)" 알림 */
  afford(p, cost) {
    if (canAfford(p, cost)) return true;
    const miss = [];
    for (const r of GIVE.RES) if ((cost[r] || 0) > p[r]) miss.push(`${RES_KO[r]} 부족(${Math.floor(p[r])}/${cost[r]})`);
    this.note(p.slot, miss.join(" · "), "warn");
    return false;
  }
  /** 내 지갑에서 낸다(혜택이 팀 모두인 일도 누른 학생이 낸다) */
  charge(p, cost) {
    pay(p, cost);
    for (const r of GIVE.RES) if (cost[r]) p.spent[r] += cost[r];
    p.meDirty = true;
    this.teams[p.team].dirty = true;
  }
  /** 내 지갑에 들어온다(내 일꾼이 캔 것 · 보상) */
  earn(p, res, n) {
    if (!p || !n) return;
    p[res] += n;
    p.made[res] += n;
    p.meDirty = true;
    this.teams[p.team].dirty = true;
  }
  /** 팀원 지갑의 합(보기만 — team JSON) */
  teamSum(team, res) {
    let n = 0;
    for (const q of this.players) if (q.team === team) n += q[res];
    return n;
  }

  /** 팀원에게 보내기(U31): give { to, res, amount } — 같은 팀(탈락하지 않은) 다른 학생에게, 1 ~ 가진 만큼(정수), 1초에 5번까지 */
  give(p, msg) {
    const to = Number.isInteger(+msg.to) ? this.players[+msg.to] : null;
    if (!to || to === p || to.team !== p.team) return this.note(p.slot, "같은 팀에게만 보내요", "warn");
    const res = GIVE.RES.includes(msg.res) ? msg.res : null;
    if (!res) return;
    const amount = Math.floor(+msg.amount);
    if (!(amount >= 1)) return this.note(p.slot, "1 이상 보내요", "warn");
    const have = Math.floor(p[res]);
    if (amount > have) return this.note(p.slot, `${RES_KO[res]} 부족(${have}/${amount})`, "warn");
    p.giveTimes = p.giveTimes.filter((t) => t > this.time - 1);
    if (p.giveTimes.length >= 5) return this.warnNote(p, "give", "너무 빨라요 · 잠깐 뒤에");
    p.giveTimes.push(this.time);
    p[res] -= amount;
    to[res] += amount;
    p.given[res] += amount;
    p.meDirty = to.meDirty = true;
    this.teams[p.team].dirty = true;
    const what = `${RES_KO[res]} ${amount}${numJosa(amount, "을", "를")}`;
    this.note(p.slot, `${to.name}에게 ${what} 보냈어요.`, "give");
    this.note(to.slot, `${p.name}${wordJosa(p.name, "이", "가")} ${what} 보냈어요.`, "give");
    return true;
  }

  /** 무기 번호(숫자 또는 key 글자) — 없으면 −1 */
  weaponIndex(w) {
    const i = typeof w === "string" ? (Object.hasOwn(WEAPON, w) ? WEAPON[w] : -1) : Number.isInteger(+w) ? +w : -1;
    return WEAPONS[i] ? i : -1;
  }

  /** 바꿔 들기: 기본 잉크(0)이거나 내 소지품에 1개 이상 있을 때만(v2.2 — U12) */
  setWeapon(p, w) {
    const h = this.heroOf(p.slot);
    if (!h) return;
    const i = this.weaponIndex(w);
    if (i < 0) return;
    if (i !== 0 && !(p.inv[i] > 0)) {
      p.meDirty = true; // 브라우저가 든 무기를 다시 맞추게
      return this.warnNote(p, "noinv", `${WEAPONS[i].name} 없음 · 랩에서 사요`);
    }
    h.weapon = i;
    p.meDirty = true;
  }

  /** 소지품 사기: 랩에서 연 무기 한 묶음을 내 골드로 곧바로(랩의 하는 일 줄을 기다리지 않는다) */
  buy(p, w) {
    const i = this.weaponIndex(w);
    if (i <= 0) return;
    const W = WEAPONS[i];
    const T = this.teams[p.team];
    if (!W.pack) return;
    const lab = this.buildings.get(T.labId);
    if (!T.lab.unlocked[i]) return this.note(p.slot, `${W.name}: 랩에서 먼저 열어요`, "warn");
    if (!lab || lab.broken) return this.note(p.slot, "랩 고장 · 일꾼이 고쳐요", "warn");
    const max = stackMax(i);
    if (p.inv[i] + W.pack.n > max) return this.note(p.slot, `최대 ${max}개`, "warn");
    const cost = { gold: W.pack.gold };
    if (!this.afford(p, cost)) return;
    this.charge(p, cost);
    p.inv[i] += W.pack.n;
    this.note(p.slot, `${W.name} +${W.pack.n} (${p.inv[i]}개)`, "lab");
    return true;
  }

  /** 고른 유닛에게 내리는 명령 — 영웅은 WASD 로 움직이므로 빼고, 내 유닛만 */
  onCmd(p, msg) {
    const ids = Array.isArray(msg.ids) ? msg.ids.slice(0, 60) : [];
    const us = [];
    for (const id of ids) {
      const u = this.units.get(id | 0);
      if (u && !u.dead && u.owner === p.slot && u.type !== UTYPE.HERO && u.type !== UTYPE.NPC) us.push(u);
    }
    const o = String(msg.o || "");
    const x = +msg.x, y = +msg.y;
    const okXY = Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < this.S && y < this.S;
    const fighters = us.filter((u) => u.type === UTYPE.BOT || u.type === UTYPE.PET);
    const workers = us.filter((u) => u.type === UTYPE.WORKER);
    switch (o) {
      case "stop": for (const u of us) this.setOrder(u, { type: "idle" }); return;
      case "hold": for (const u of us) this.setOrder(u, { type: "hold" }); return;
      case "move": if (okXY) this.formation(us, x, y); return;
      case "follow": {
        const list = fighters.length || us.length ? fighters : this.myFighters(p.slot);
        // 영웅이 없으면(U26) 따라갈 수 없다 — 그 자리를 지킨다
        for (const u of list) this.setOrder(u, { type: p.heroOut ? "hold" : "follow" });
        return;
      }
      case "attack": {
        // 상대 유닛 · 중립 몬스터 · 상대 건물(섹션 · 상자는 유닛이 아니라 고를 수 없다). 일꾼도 아주 약한 근접 공격으로 친다(U22)
        const t = this.units.get(msg.target | 0) || this.buildings.get(msg.target | 0);
        if (!t || t.team === p.team || (t.dead && !t.isBuilding)) return;
        for (const u of fighters) this.setOrder(u, { type: "attack", target: t.id });
        for (const u of workers) this.setOrder(u, { type: "attack", target: t.id, seenAt: this.time });
        return;
      }
      case "gather": {
        // target = { res, i } — i 가 없으면 그 자원의 가장 가까운 곳(x, y 를 주면 그 둘레)
        const tg = msg.target && typeof msg.target === "object" ? msg.target : typeof msg.target === "string" ? { res: msg.target } : { res: "ink", i: msg.target };
        const res = RES_KINDS.includes(tg.res) ? tg.res : null;
        if (!res) return;
        for (const u of workers) {
          let node = Number.isInteger(tg.i) ? this.nodes[res][tg.i] : null;
          if (!node) node = okXY ? this.nearestNode(res, x, y) : this.nearestNode(res, u.x, u.y, p.team);
          if (!node) continue;
          u.res = res;
          this.setOrder(u, { type: "gather", res, i: node.i, phase: "go" });
        }
        return;
      }
      case "repair": {
        const b = this.buildings.get(msg.target | 0);
        if (!b || b.team !== p.team) return;
        for (const u of workers) this.setOrder(u, b.built ? { type: "repair", b: b.id } : { type: "build", b: b.id });
        return;
      }
      case "grab": {
        const gem = this.gems.get(msg.target | 0);
        if (!gem) return;
        for (const u of us) if (u.type === UTYPE.BOT) this.setOrder(u, { type: "grab", gem: gem.id });
        return;
      }
    }
  }

  myFighters(slot) {
    const out = [];
    for (const u of this.units.values()) if (u.owner === slot && !u.dead && (u.type === UTYPE.BOT || u.type === UTYPE.PET)) out.push(u);
    return out;
  }

  setOrder(u, o) {
    u.order = o;
    u.path = null;
    u.pathKey = "";
    u.fails = 0;
    u.stuckT = 0;
    if (o.type === "idle" || o.type === "hold") u.anchor = { x: u.x, y: u.y };
    if (u.type === UTYPE.WORKER) {
      u.work = 0;
      if (u.claim && !(o.type === "gather" && o.res === u.claim.res && o.i === u.claim.i)) this.releaseSlot(u);
      // 캐기를 맡기면 기억해 두었다가 짓기 · 고치기 · 공격(U22)을 마치면 돌아간다. 옮기기 · 멈추기 · 지키기는 그 기억을 지운다
      if (o.type === "gather") u.job = { res: o.res, i: o.i };
      else if (o.type !== "build" && o.type !== "repair" && o.type !== "attack") u.job = null;
      if (o.type === "idle" || o.type === "hold") u.idleSince = this.time;
    }
  }

  /** 할 일이 없어 명령을 기다리는 일꾼(머리 위 "일 시켜주세요!", U17). 코어 금광 자리를 기다리는 것은 일이 있는 것 */
  idleWorker(u) {
    return u.type === UTYPE.WORKER && (u.order.type === "idle" || u.order.type === "hold");
  }

  formation(us, x, y) {
    const n = us.length;
    us.forEach((u, k) => {
      let tx = x, ty = y;
      if (n > 1) {
        const ring = Math.ceil(Math.sqrt(k));
        const a = k * 2.399963;
        tx = x + Math.cos(a) * ring * 0.8;
        ty = y + Math.sin(a) * ring * 0.8;
      }
      const f = nearestFree(u.fly ? this.flyGrid : this.grid, tx, ty, 6) || { x: tx, y: ty };
      this.setOrder(u, { type: "move", x: f.x, y: f.y });
    });
  }

  workerCount(slot, what) {
    let n = 0;
    const type = what === "bot" ? UTYPE.BOT : UTYPE.WORKER;
    for (const u of this.units.values()) if (u.owner === slot && u.type === type && !u.dead) n++;
    const p = this.players[slot];
    if (p) for (const q of p.queue) if (q.what === what) n++;
    return n;
  }

  train(p, what) {
    const def = UNITS[what];
    if (!def || !def.train) return;
    const T = this.teams[p.team];
    const tower = this.tower(p.team);
    if (!tower) return;
    if (this.workerCount(p.slot, what) >= def.cap) return this.note(p.slot, `${def.name} 최대 ${def.cap}명`, "warn");
    if (p.queue.length >= QUEUE_MAX) return this.note(p.slot, "뽑기 줄이 꽉 찼어요", "warn");
    if (!this.afford(p, def.train)) return;
    this.charge(p, def.train);
    p.queue.push({ what, t: 0, total: def.train.time });
    if (tower.down) this.note(p.slot, "탑이 꺾여 뽑기가 멈춰요", "warn");
  }

  place(p, msg) {
    if (msg.kind !== "supply" && msg.kind !== BLD.SUPPLY) return;
    const T = this.teams[p.team];
    const def = BUILDINGS[BLD.SUPPLY];
    const tx = msg.tx | 0, ty = msg.ty | 0;
    if (this.supplies(p.team, false).length >= def.max) return this.note(p.slot, `공급소는 팀에 최대 ${def.max}곳`, "warn");
    if (!this.canPlace(tx, ty, def.size)) return this.note(p.slot, "여기는 못 지어요", "warn");
    if (!this.afford(p, def.build)) return;
    // 일꾼 바로 옆에만 짓는다(U18) — 고른 일꾼(없으면 내 일꾼 모두) 가운데 자리 가장자리에서 BUILD_NEAR 칸 안에 있는 일꾼이 짓는다
    let mine = [];
    for (const id of Array.isArray(msg.ids) ? msg.ids.slice(0, 40) : []) {
      const u = this.units.get(id | 0);
      if (u && !u.dead && u.owner === p.slot && u.type === UTYPE.WORKER) mine.push(u);
    }
    if (!mine.length) for (const u of this.units.values()) if (u.owner === p.slot && u.type === UTYPE.WORKER && !u.dead) mine.push(u);
    if (!mine.length) return this.note(p.slot, "일꾼이 있어야 지어요", "warn");
    const ws = mine.filter((u) => rectDist(u.x, u.y, tx, ty, def.size) - u.radius <= BUILD_NEAR);
    if (!ws.length) return this.note(p.slot, "일꾼 바로 옆에만 지어요", "warn");
    this.charge(p, def.build);
    const b = this.addBuilding(BLD.SUPPLY, p.team, tx, ty, false);
    b.by = p.slot;
    this.rebuildBlocked();
    for (const w of ws) this.setOrder(w, { type: "build", b: b.id });
    T.dirty = true;
    this.teamNote(p.team, `${p.name}: 공급소 짓기 시작`, "build", { x: b.cx, y: b.cy });
  }

  /** 칸 (tx, ty) 에서 size 네모를 지을 수 있나 — 빈 바닥이고, 둘레 한 칸에 건물 · 바위 · 연못이 없고, 섹션 바닥 판 밖 */
  canPlace(tx, ty, size) {
    const S = this.S;
    if (!rectOnFloor(this.map, tx, ty, size)) return false;
    for (let y = ty - 1; y <= ty + size; y++)
      for (let x = tx - 1; x <= tx + size; x++) {
        if (x < 0 || y < 0 || x >= S || y >= S) return false;
        const i = y * S + x;
        const t = this.map.tiles[i];
        if (this.bldAt[i] || this.siteAt[i] || t === TILE.POND || t === TILE.GOLD || t === TILE.CORE) return false;
      }
    for (const s of this.sites) if (rectDist(s.x, s.y, tx, ty, size) < GEM.PAD_R + 0.5) return false;
    return true;
  }

  // ───────────── 랩 · 퍼실리티 ─────────────
  labAct(p, act, key) {
    const T = this.teams[p.team];
    const L = T.lab;
    const b = this.buildings.get(T.labId);
    if (!b) return;
    if (b.broken) return this.note(p.slot, "랩 고장 · 일꾼이 고쳐요", "warn");
    if (L.job) return this.note(p.slot, "랩이 다른 일 하는 중", "warn");
    let job = null, cost = null, label = "";
    if (act === "unlock") {
      const w = typeof key === "string" && WEAPON[key] != null ? WEAPON[key] : key | 0;
      const W = WEAPONS[w];
      if (!W || !W.unlock || L.unlocked[w]) return;
      if (W.tier > L.lv) return this.note(p.slot, `랩 ${W.tier}단계 필요`, "warn");
      cost = W.unlock; job = { kind: "unlock", key: w, t: 0, total: W.unlock.time }; label = `${W.name} 열기`;
    } else if (act === "level") {
      const next = LAB.LEVELS[L.lv + 1];
      if (!next) return;
      cost = next; job = { kind: "level", key: L.lv + 1, t: 0, total: next.time }; label = `랩 ${L.lv + 1}단계`;
    } else if (act === "research") {
      const R = LAB.RESEARCH.find((r) => r.key === key);
      if (!R || L.research[R.key]) return;
      if (R.tier > L.lv) return this.note(p.slot, `랩 ${R.tier}단계 필요`, "warn");
      cost = R; job = { kind: "research", key: R.key, t: 0, total: R.time }; label = R.name;
    } else return;
    if (!this.afford(p, cost)) return;
    this.charge(p, cost);
    job.by = p.slot;
    L.job = job;
    T.dirty = true;
    this.teamNote(p.team, `${p.name}: ${label} 시작`, "lab");
  }

  facAct(p, act, key) {
    const T = this.teams[p.team];
    const F = T.fac;
    const b = this.buildings.get(T.facId);
    if (!b) return;
    const pet = p.pet;
    if (act === "release") {
      // 지금 몬스터를 놓아 준다(돌려받지 않는다) — 다른 종류를 사려면 먼저 놓아 준다
      if (pet.state === "none") return;
      const name = MONSTERS[pet.kind] ? MONSTERS[pet.kind].name : "몬스터";
      this.removePet(p, true);
      Object.assign(pet, { kind: -1, level: 1, state: "none", t: 0, total: 0 });
      p.meDirty = true;
      this.note(p.slot, `${name}을(를) 놓아 주었어요.`, "fac");
      return;
    }
    if (b.broken) return this.note(p.slot, "퍼실리티 고장 · 일꾼이 고쳐요", "warn");
    if (act === "hatch") {
      const kind = key | 0;
      const M = MONSTERS[kind];
      if (!M) return;
      if (M.tier > F.lv - 1) return this.note(p.slot, `퍼실리티 ${M.tier + 1}단계 필요`, "warn");
      if (pet.state === "hatching") return this.note(p.slot, "벌써 부화 중", "warn");
      if (pet.state === "alive") return this.note(p.slot, "몬스터는 1마리 · 먼저 놓아 줘요", "warn");
      const cost = hatchCost(kind, F.dex.has(kind));
      if (!this.afford(p, cost)) return;
      this.charge(p, cost);
      Object.assign(pet, { kind, level: 1, state: "hatching", t: cost.time, total: cost.time, unitId: 0 });
      p.meDirty = true; T.dirty = true;
      this.teamNote(p.team, `${p.name}: ${M.name} 부화 중`, "fac");
      return;
    }
    if (act === "level") {
      if (pet.state !== "alive" || pet.kind < 0) return;
      if (pet.level >= PET.MAX_LEVEL) return;
      const cost = PET.LEVELS[pet.level + 1];
      if (!this.afford(p, cost)) return;
      this.charge(p, cost);
      pet.level++;
      const u = this.units.get(pet.unitId);
      if (u && !u.dead) {
        const old = u.maxHp;
        u.level = pet.level; u.info = pet.level;
        u.maxHp = petHp(pet.kind, pet.level);
        u.hp = Math.min(u.maxHp, u.hp + (u.maxHp - old));
        u.radius = MONSTERS[pet.kind].radius * petScale(pet.level);
        this.refreshPet(u);
        this.fx.push({ k: "spawn", id: u.id, x: u.x, y: u.y, team: u.team, lv: pet.level });
      }
      p.meDirty = true; T.dirty = true;
      const perk = pet.level === PET.PERK_LEVEL ? ` 특기 「${PERK_NAME(pet.kind)}」!` : "";
      this.note(p.slot, `${MONSTERS[pet.kind].name} 레벨 ${pet.level}!${perk}`, "fac");
      return;
    }
    if (F.job) return this.note(p.slot, "퍼실리티가 다른 일 하는 중", "warn");
    let job = null, cost = null, label = "";
    if (act === "level-fac") {
      const next = FACILITY.LEVELS[F.lv + 1];
      if (!next) return;
      cost = next; job = { kind: "level", key: F.lv + 1, t: 0, total: next.time }; label = `퍼실리티 ${F.lv + 1}단계`;
    } else if (act === "research") {
      const R = FACILITY.RESEARCH.find((r) => r.key === key);
      if (!R || F.research[R.key]) return;
      if (R.tier > F.lv) return this.note(p.slot, `퍼실리티 ${R.tier}단계 필요`, "warn");
      cost = R; job = { kind: "research", key: R.key, t: 0, total: R.time }; label = R.name;
    } else return;
    if (!this.afford(p, cost)) return;
    this.charge(p, cost);
    job.by = p.slot;
    F.job = job;
    T.dirty = true;
    this.teamNote(p.team, `${p.name}: ${label} 시작`, "fac");
  }

  removePet(p, fx = true) {
    const u = this.units.get(p.pet.unitId);
    if (u) {
      if (fx) this.fx.push({ k: "ko", id: u.id, x: u.x, y: u.y, team: u.team });
      this.units.delete(u.id);
    }
    p.pet.unitId = 0;
  }

  spawnPet(p) {
    const pet = p.pet;
    const T = this.teams[p.team];
    const fac = this.buildings.get(T.facId);
    const h = this.heroOf(p.slot);
    const at = fac ? this.spotNear(fac, h ? h.x : fac.cx, h ? h.y : fac.cy) : { x: h.x, y: h.y };
    const u = this.spawnMonster(pet.kind, p.team, p.slot, at.x, at.y, pet.level);
    pet.unitId = u.id;
    pet.state = "alive";
    pet.t = 0;
    this.setOrder(u, { type: p.heroOut ? "hold" : "follow" }); // 영웅이 없으면(U26) 퍼실리티 앞을 지킨다
    p.meDirty = true;
    return u;
  }

  // ───────────── ③ 영웅 움직임 검사(브라우저가 정한 위치) ─────────────
  onMove(p, msg) {
    const h = this.heroOf(p.slot);
    if (!h || p.bot || h.dead || h.quiz || this.phase !== PHASE.PLAY) return;
    const M = h.mv;
    if (this.time < M.quietUntil) return;
    const x = +msg.x, y = +msg.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const el = clamp(this.time - M.at, TICK, MV_MAX_GAP);
    // 속력 배율: 늘리는 것(부스터)은 바로, 줄이는 것(보석 · 끈끈이)은 브라우저가 알기까지 조금 기다려 준다
    let mul = 1;
    if (h.boostUntil > this.time - 0.6) mul *= ITEMS[1].speed;
    if (h.gem >= 0 && this.time - h.gemAt > 0.6) mul *= HERO.CARRY_SLOW;
    if (h.slow > 0.3 && this.time - h.slowAt > 0.5) mul *= SLOW.FACTOR;
    const normal = HERO.SPEED * mul * el * HERO.SLACK + HERO.PAD;
    if (msg.d && this.time >= M.dashUntil && this.time - M.lastDash >= DASH.COOLDOWN * 0.75) {
      M.lastDash = this.time;
      M.dashUntil = this.time + DASH.TIME + 0.35;
      M.dashLeft = DASH.SPEED * DASH.TIME * 1.25 + 0.2;
      h.bumped = false;
    }
    const dashAllow = this.time < M.dashUntil ? M.dashLeft : 0;
    const dist = Math.hypot(x - h.x, y - h.y);
    let ok = dist <= normal + M.kb + dashAllow && x > 0 && y > 0 && x < this.S && y < this.S;
    if (ok) {
      // 막힌 칸에 들어갔거나 벽을 뚫고 지나가지 않았나
      const r = HERO.RADIUS * 0.92;
      const fix = unstick(this.blk, this.S, x, y, r);
      if (fix.x !== x || fix.y !== y) ok = false;
      else if (dist > 0.6) {
        const s = slide(this.blk, this.S, h.x, h.y, x - h.x, y - h.y, r);
        if (Math.hypot(s.x - x, s.y - y) > 0.35) ok = false;
      }
    }
    if (!ok) {
      this.warp(h);
      return;
    }
    // 넉넉함을 쓴다(넉백 · 대시 몫은 쓴 만큼 줄어든다)
    let over = Math.max(0, dist - normal);
    if (over > 0 && dashAllow) { const k = Math.min(over, M.dashLeft); M.dashLeft -= k; over -= k; }
    if (over > 0) M.kb = Math.max(0, M.kb - over);
    if (dist > 0.01) {
      const vx = (x - h.x) / el, vy = (y - h.y) / el;
      h.vxe = h.vxe * 0.4 + vx * 0.6;
      h.vye = h.vye * 0.4 + vy * 0.6;
      h.movedAt = this.time;
      if (Math.hypot(vx, vy) > 0.6) h.moveDir = Math.atan2(vy, vx);
    }
    h.x = x; h.y = y;
    if (Number.isFinite(+msg.f)) h.facing = +msg.f;
    h.z = clamp(+msg.z || 0, 0, 8);
    h.c = clamp(+msg.c || 0, 0, 1);
    M.dashing = !!msg.d && this.time < M.dashUntil;
    M.at = this.time;
  }

  warp(h) {
    const p = this.players[h.owner];
    h.mv.at = this.time;
    h.mv.quietUntil = this.time + WARP_QUIET;
    if (p && p.connected && !p.bot) this.send(p.slot, { t: "warp", x: r2(h.x), y: r2(h.y) });
  }

  /** 넉백 · 경직 · 느려짐. 사람 영웅은 브라우저에 kb 로 알리고(틱마다 모아서), 나머지는 서버가 민다 */
  knock(u, vx, vy, stun = 0, slow = 0) {
    if (u.dead || u.quiz) return; // 문제를 푸는 영웅은 밀리지 않는다(U35)
    if (this.isHumanHero(u)) {
      const a = u.kbAcc || (u.kbAcc = { vx: 0, vy: 0, stun: 0, slow: 0 });
      a.vx += vx; a.vy += vy;
      a.stun = Math.max(a.stun, stun);
      a.slow = Math.max(a.slow, slow);
      const sp = Math.hypot(vx, vy);
      if (sp > 0) { u.mv.kb += (sp / THROW.KB_DECAY) * 1.2 + 0.3; u.mv.kbAt = this.time; }
      u.stun = Math.max(u.stun, stun);
      if (slow > 0) { if (u.slow <= 0) u.slowAt = this.time; u.slow = Math.max(u.slow, slow); }
      return;
    }
    let m = 1;
    if (u.type === UTYPE.NPC || u.type === UTYPE.PET) m = 1 / Math.max(1, MONSTERS[u.kind].scale * (u.type === UTYPE.PET ? petScale(u.level) : 1));
    u.kvx += vx * m; u.kvy += vy * m;
    u.stun = Math.max(u.stun, stun * (m < 0.5 ? 0.4 : 1));
    if (slow > 0) { if (u.slow <= 0) u.slowAt = this.time; u.slow = Math.max(u.slow, slow); }
  }

  // ───────────── ④ 던지기 · 탄 · 폭발 · 피해 ─────────────
  /** 영웅이 지금 무기로 던진다(사람 · 컴퓨터 같은 길). 던졌으면 true */
  heroThrow(h, tx, ty, big) {
    if (this.phase !== PHASE.PLAY || !h || h.dead || h.quiz) return false;
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
    if (h.throwCd > 0.06) return false;
    const T = this.teams[h.team];
    const p = this.players[h.owner];
    // 든 무기가 소지품에 없으면(다 썼다) 기본 잉크로 던진다
    let w = h.weapon | 0;
    const inv = p ? p.inv : null;
    if (!WEAPONS[w] || (w !== 0 && !(inv && inv[w] > 0))) { w = h.weapon = 0; if (p) p.meDirty = true; }
    const W = WEAPONS[w];
    if (W.direct) big = false;
    if (W.nuke) {
      big = true;
      if (h.bombCd > 0) return false;
    }
    if (h.gem >= 0 && !GEM.CARRY_ATTACK[this.mode]) {
      this.warnNote(p, "carry", "보석 들면 못 던져요 · 탑으로!");
      return false;
    }
    const ink = shotInk(w, big, T.lab.research);
    if (h.tank < ink) {
      this.warnNote(p, "dry", "잉크 부족 · 공급소로!");
      return false;
    }
    h.tank -= ink;
    h.throwCd = W.direct ? MISSILE.CD : THROW.CD;
    if (W.nuke) h.bombCd = W.cooldown || 30;
    h.lastThrowAt = this.time;
    h.c = 0;
    tx = clamp(tx, 0.5, this.S - 0.5);
    ty = clamp(ty, 0.5, this.S - 0.5);
    let dx = tx - h.x, dy = ty - h.y;
    let d = Math.hypot(dx, dy);
    if (d < 1e-3) { dx = Math.cos(h.facing); dy = Math.sin(h.facing); d = 1; }
    const ux = dx / d, uy = dy / d;
    h.facing = Math.atan2(uy, ux);
    const dmgMul = T.lab.research.power ? RESEARCH_FX.power : 1;
    const src = { team: h.team, unit: h.id, slot: h.owner };
    this.fx.push({ k: "throw", id: h.id, x: h.x, y: h.y, team: h.team });
    if (W.direct) {
      const target = W.homing ? this.homingTarget(h.team, h.x, h.y, tx, ty, ux, uy) : 0;
      this.launchMissile(src, w, h.x + ux * 0.3, h.y + uy * 0.3, ux, uy, dmgMul, target, T.lab.research);
    } else {
      const dd = clamp(d, THROW.RANGE_MIN, throwRange(T.lab.research));
      const ex = h.x + ux * dd, ey = h.y + uy * dd;
      const n = W.count > 1 ? W.count : 1;
      for (let i = 0; i < n; i++) {
        let bx = ex, by = ey;
        if (i > 0) {
          const a = Math.ceil(i / 2) * (i % 2 ? -1 : 1) * W.spread;
          const c = Math.cos(a), s = Math.sin(a);
          const rx = ex - h.x, ry = ey - h.y;
          bx = h.x + rx * c - ry * s;
          by = h.y + rx * s + ry * c;
        }
        this.launchArc(src, w, big, h.x, h.y, (h.z || 0) + THROW.HAND, bx, by, { dmgMul });
      }
    }
    this.assistFrom(h, tx, ty);
    // 소지품 1개(삼발 · 대형도 한 번 던지기 = 1개). 0 이 되면 기본 잉크로 돌아간다
    if (w !== 0 && inv) {
      inv[w] = Math.max(0, inv[w] - 1);
      if (inv[w] === 0) {
        h.weapon = 0;
        this.note(p.slot, `${W.name} 다 썼어요 · 랩에서 사요`, "warn");
      }
    }
    if (p) p.meDirty = true;
    return true;
  }

  warnNote(p, key, text) {
    if (!p || p.bot || !p.connected) return;
    if (this.time - (p.noteAt[key] || -99) < 3) return;
    p.noteAt[key] = this.time;
    this.note(p.slot, text, "warn");
  }

  /** 포물선 풍선. 땅에 닿을 때 터진다(날아가는 동안은 아무것도 맞지 않는다 — 벽 너머로도 던진다) */
  launchArc(src, w, big, x0, y0, z0, x1, y1, opt = {}) {
    x1 = clamp(x1, 0.5, this.S - 0.5);
    y1 = clamp(y1, 0.5, this.S - 0.5);
    const d = Math.hypot(x1 - x0, y1 - y0);
    const T = flightTime(d, big);
    const W = WEAPONS[w] || WEAPONS[0];
    const b = { src, team: src.team, w, big, x0, y0, x1, y1, land: this.time + T, dmgMul: opt.dmgMul || 1, spec: opt.spec || null, structMul: opt.structMul, vortex: !!W.vortex && !opt.spec };
    this.balloons.push(b);
    this.fx.push({ k: "arc", x0: r2(x0), y0: r2(y0), z0: r2(z0), x1: r2(x1), y1: r2(y1), t: r2(T), w, big: !!big, team: src.team });
    return b;
  }

  launchMissile(src, w, x, y, ux, uy, dmgMul, target, research) {
    const W = WEAPONS[w];
    const range = W.homing ? HOMING.SPEED * HOMING.LIFE : MISSILE.RANGE * (research && research.long ? RFX.long : 1);
    this.projs.push({
      id: this.newProjId(), kind: w, team: src.team, src, w, x, y, dir: Math.atan2(uy, ux),
      speed: W.homing ? HOMING.SPEED : MISSILE.SPEED, left: range, age: 0, pierced: 0, target: target || 0, dmgMul,
      drill: !!W.drill, homing: !!W.homing, monster: false,
    });
  }

  /** 유도 미사일이 노릴 적: 조준점 둘레 → 없으면 조준 방향 부채꼴 안의 가장 가까운 적 */
  homingTarget(team, x0, y0, tx, ty, ux, uy) {
    let best = 0, bd = HOMING.LOCK_RADIUS;
    for (const u of this.hash.query(tx, ty, HOMING.LOCK_RADIUS + 1)) {
      if (u.dead || u.quiz || u.team === team || !this.seenBy(team, u)) continue;
      const d = Math.hypot(u.x - tx, u.y - ty);
      if (d < bd) { bd = d; best = u.id; }
    }
    if (best) return best;
    bd = HOMING.RANGE;
    const a0 = Math.atan2(uy, ux);
    for (const u of this.hash.query(x0, y0, HOMING.RANGE)) {
      if (u.dead || u.quiz || u.team === team || !this.seenBy(team, u)) continue;
      const d = Math.hypot(u.x - x0, u.y - y0);
      if (d >= bd || d < 0.3) continue;
      if (Math.abs(angDiff(Math.atan2(u.y - y0, u.x - x0), a0)) > HOMING.CONE) continue;
      bd = d; best = u.id;
    }
    return best;
  }

  seenBy(team, u) {
    if (team === NEUTRAL || u.team === team) return true;
    const T = this.teams[team];
    return !!T && !!T.vis[Math.floor(u.y) * this.S + Math.floor(u.x)];
  }

  /** 영웅이 던진 곳 둘레의 적 → 분대가 함께 친다 */
  assistFrom(h, tx, ty) {
    let best = 0, bd = 2.2;
    for (const u of this.hash.query(tx, ty, 3)) {
      if (u.dead || u.quiz || u.team === h.team || !this.seenBy(h.team, u)) continue;
      if (Math.hypot(u.x - h.x, u.y - h.y) > SQUAD.ASSIST + 3) continue;
      const d = Math.hypot(u.x - tx, u.y - ty);
      if (d < bd) { bd = d; best = u.id; }
    }
    if (best) { h.assist = best; h.assistAt = this.time; }
  }

  stepBalloons() {
    for (let i = this.balloons.length - 1; i >= 0; i--) {
      const b = this.balloons[i];
      if (this.time < b.land) continue;
      this.balloons.splice(i, 1);
      const dir = { x: b.x1 - b.x0, y: b.y1 - b.y0 };
      if (b.vortex) {
        this.vortices.push({ b, x: b.x1, y: b.y1, until: this.time + VORTEX.TIME, kbAt: -99 });
        this.fx.push({ k: "pull", x: r2(b.x1), y: r2(b.y1), r: VORTEX.R, t: VORTEX.TIME, team: b.team });
        continue;
      }
      this.explode(b.x1, b.y1, { src: b.src, team: b.team, w: b.w, big: b.big, dmgMul: b.dmgMul, spec: b.spec, structMul: b.structMul, dir });
    }
    for (let i = this.vortices.length - 1; i >= 0; i--) {
      const v = this.vortices[i];
      if (this.time >= v.until) {
        this.vortices.splice(i, 1);
        this.explode(v.x, v.y, { src: v.b.src, team: v.b.team, w: v.b.w, big: v.b.big, dmgMul: v.b.dmgMul });
        continue;
      }
      const kbNow = this.time - v.kbAt >= 0.25;
      if (kbNow) v.kbAt = this.time;
      for (const u of this.hash.query(v.x, v.y, VORTEX.R + 1)) {
        if (u.dead || u.quiz || u.team === v.b.team || u.shieldUntil > this.time) continue;
        const dx = v.x - u.x, dy = v.y - u.y;
        const d = Math.hypot(dx, dy);
        if (d >= VORTEX.R || d < 0.25) continue;
        if (this.isHumanHero(u)) {
          if (kbNow) this.knock(u, (dx / d) * VORTEX.PULL * 0.7, (dy / d) * VORTEX.PULL * 0.7, 0, 0);
          continue;
        }
        const step = Math.min(d - 0.2, VORTEX.PULL * TICK);
        const q = slide(u.fly ? this.flyBlk : this.blk, this.S, u.x, u.y, (dx / d) * step, (dy / d) * step, this.bodyR(u));
        u.x = q.x; u.y = q.y;
      }
    }
    for (let i = this.later.length - 1; i >= 0; i--) {
      const L = this.later[i];
      if (this.time < L.at) continue;
      this.later.splice(i, 1);
      const a0 = Math.atan2(L.dir.y, L.dir.x);
      for (let j = 0; j < FIREWORK.N; j++) {
        const a = a0 + (j * TAU) / FIREWORK.N;
        let px = L.x, py = L.y;
        // 단단한 칸에 막히면 그 앞에서
        for (let s = 0.2; s <= FIREWORK.RING + 1e-6; s += 0.2) {
          const nx = L.x + Math.cos(a) * s, ny = L.y + Math.sin(a) * s;
          if (this.solidAt(nx, ny)) break;
          px = nx; py = ny;
        }
        this.explode(px, py, { src: L.src, team: L.team, w: L.w, big: false, sub: j + 1, dmgMul: L.dmgMul, dir: L.dir });
      }
    }
  }

  solidAt(x, y) {
    if (x < 0 || y < 0 || x >= this.S || y >= this.S) return true;
    return isSolidTile(this.map.tiles[Math.floor(y) * this.S + Math.floor(x)]);
  }

  /**
   * 폭발. o = { src: { team, unit, slot }, team, w, big, sub(폭죽 둘레), dmgMul, spec({ splash, kb, dmg } — 탑 · 잉크봇),
   *             structMul(건물 배율 덮어쓰기), direct(직접 맞은 유닛), cell(직접 맞은 상자), dir(날아온 방향), noStruct(중립) }
   */
  explode(x, y, o) {
    const W = WEAPONS[o.w] || WEAPONS[0];
    const base = o.big ? THROW.BIG : THROW.SMALL;
    const spec = o.spec || (o.sub
      ? { splash: THROW.SMALL.splash * FIREWORK.SPLASH, kb: THROW.SMALL.kb * FIREWORK.KB, dmg: THROW.SMALL.dmg * FIREWORK.DMG }
      : { splash: base.splash * W.splash, kb: base.kb * W.kb, dmg: base.dmg * W.dmg });
    const dmgMul = o.dmgMul || 1;
    const team = o.team;
    const T = this.teams[team];
    const src = o.src || { team, unit: 0, slot: -1 };
    this.fx.push({ k: "boom", x: r2(x), y: r2(y), r: r2(spec.splash), team, w: o.w | 0, big: !!o.big, ...(o.sub ? { sub: o.sub } : {}) });
    let fx = o.dir ? o.dir.x : 1, fy = o.dir ? o.dir.y : 0;
    const fl = Math.hypot(fx, fy) || 1;
    fx /= fl; fy /= fl;
    for (const u of [...this.hash.query(x, y, spec.splash + 1.2)]) {
      if (u.dead || u.team === team) continue;
      const isDirect = u === o.direct;
      if (!isDirect && u.z > JUMP.DODGE_Z) continue; // 뛰어올라 피했다
      const dx = u.x - x, dy = u.y - y;
      const d = Math.hypot(dx, dy);
      const reach = spec.splash + u.radius;
      if (!isDirect && d >= reach) continue;
      const direct = isDirect || d <= THROW.DIRECT_R;
      const falloff = direct ? 1 : 1 - (1 - THROW.FALLOFF_MIN) * (d / reach);
      const dmg = Math.max(1, Math.round(spec.dmg * dmgMul * falloff * (direct ? THROW.DIRECT_DMG : 1)));
      const kb = spec.kb * falloff * (direct ? THROW.DIRECT_KB : 1);
      const nx = d > 0.05 && !isDirect ? dx / d : fx, ny = d > 0.05 && !isDirect ? dy / d : fy;
      if (this.hurtUnit(u, dmg, src)) this.knock(u, nx * kb, ny * kb, THROW.STUN, W.slow && !o.sub && !o.spec ? W.slow : 0);
    }
    const research = T ? T.lab.research : {};
    const structMul = o.structMul ?? THROW.BUILDING_MUL * (research.siege ? RESEARCH_FX.siege : 1) * (o.spec ? 1 : W.siege || 1);
    const sdmg = spec.dmg * dmgMul * structMul;
    // 탑 사격(structMul 0)은 건물 · 섹션 · 상자를 건드리지 않는다(0 피해로 경보 · 탑 꺾기 몫 · 방어막 회복 시간이 바뀌지 않게)
    if (!o.noStruct && sdmg > 0) {
      for (const b of [...this.buildings.values()]) {
        if (b.team === team) continue;
        if (rectDist(x, y, b.tx, b.ty, b.size) <= spec.splash) this.hurtBuilding(b, sdmg, src);
      }
      for (const s of this.sites) {
        if (s.state === SITE_STATE.SHIELD && Math.hypot(s.x - x, s.y - y) <= GEM.SHIELD_R + spec.splash) this.hurtSite(s, sdmg, src);
        else if (s.state === SITE_STATE.ROCK && rectDist(x, y, s.tx, s.ty, GEM.ROCK) <= spec.splash) this.hurtSite(s, sdmg, src);
      }
      // 상자: 칸 가운데가 폭발 안이면(직접 맞은 칸은 늘)
      const S = this.S;
      const R = Math.ceil(spec.splash + 1);
      const cx = Math.floor(x), cy = Math.floor(y);
      for (let ty = cy - R; ty <= cy + R; ty++)
        for (let tx = cx - R; tx <= cx + R; tx++) {
          if (tx < 0 || ty < 0 || tx >= S || ty >= S) continue;
          const i = ty * S + tx;
          if (this.map.tiles[i] !== TILE.CRATE) continue;
          if (i === o.cell || rectDist(x, y, tx, ty, 1) <= spec.splash * 0.85) this.hurtCrate(i, sdmg);
        }
    }
    if (W.firework && !o.sub && !o.spec) this.later.push({ at: this.time + FIREWORK.DELAY, x, y, src, team, w: o.w, dmgMul, dir: { x: fx, y: fy } });
  }

  stepProjs() {
    const S = this.S;
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const pr = this.projs[i];
      pr.age += TICK;
      if (pr.homing && pr.age > HOMING.ARM && pr.target) {
        const t = this.units.get(pr.target);
        if (t && !t.dead) {
          const want = Math.atan2(t.y - pr.y, t.x - pr.x);
          const d = angDiff(want, pr.dir);
          const lim = HOMING.TURN * TICK;
          pr.dir += clamp(d, -lim, lim);
        } else pr.target = 0;
      }
      const ux = Math.cos(pr.dir), uy = Math.sin(pr.dir);
      let move = pr.speed * TICK;
      if (pr.life != null) { pr.life -= TICK; if (pr.life <= 0) move = 0; }
      let end = pr.life != null && pr.life <= 0 ? { x: pr.x, y: pr.y } : null;
      while (!end && move > 1e-6) {
        const seg = Math.min(0.2, move, pr.left);
        const nx = pr.x + ux * seg, ny = pr.y + uy * seg;
        move -= seg;
        pr.left -= seg;
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) { end = { x: pr.x, y: pr.y }; break; }
        const ci = Math.floor(ny) * S + Math.floor(nx);
        const tile = this.map.tiles[ci];
        if (isSolidTile(tile)) {
          if (tile === TILE.CRATE && pr.drill && pr.pierced < DRILL.PIERCE) {
            pr.pierced++;
            this.breakCrate(ci);
          } else { end = { x: nx, y: ny, cell: tile === TILE.CRATE ? ci : -1 }; break; }
        }
        const bid = this.bldAt[ci];
        if (bid) {
          const b = this.buildings.get(bid);
          if (b && b.team !== pr.team) { end = { x: nx, y: ny, bld: b }; break; }
        }
        let hitSite = null;
        if (this.siteAt[ci]) hitSite = this.sites[this.siteAt[ci] - 1];
        else for (const s of this.sites) if (s.state === SITE_STATE.SHIELD && Math.hypot(s.x - nx, s.y - ny) <= GEM.SHIELD_R) { hitSite = s; break; }
        if (hitSite && !pr.monster) { end = { x: nx, y: ny, site: hitSite }; break; }
        // 내 몬스터 먹물은 방어막 · 바위를 친다(중립 먹물은 막에 닿아도 그냥 지나가고, 바위에서 멈춘다)
        if (hitSite && pr.monster && (pr.src.team !== NEUTRAL || this.siteAt[ci])) { end = { x: nx, y: ny, site: pr.src.team !== NEUTRAL ? hitSite : null }; break; }
        let hu = null;
        for (const u of this.hash.query(nx, ny, 1.4)) {
          if (u.dead || u.team === pr.team || u.z > 1.4) continue;
          if (Math.hypot(u.x - nx, u.y - ny) <= u.radius + (pr.r || 0.12)) { hu = u; break; }
        }
        pr.x = nx; pr.y = ny;
        if (hu) { end = { x: nx, y: ny, unit: hu }; break; }
        if (pr.left <= 1e-6) { end = { x: nx, y: ny }; break; }
      }
      if (!end) continue;
      this.projs.splice(i, 1);
      if (pr.monster) {
        const smul = THROW.BUILDING_MUL * (pr.mon && pr.mon.dmgMul ? pr.mon.dmgMul : 1);
        if (end.unit) this.monsterHitUnit(pr.mon, end.unit, pr.dmg, pr.kb, { dir: { x: ux, y: uy }, sticky: pr.sticky, src: pr.src });
        else if (end.bld && pr.src.team !== NEUTRAL) this.hurtBuilding(end.bld, pr.dmg * smul, pr.src);
        else if (end.site) this.hurtSite(end.site, pr.dmg * smul, pr.src);
        this.fx.push({ k: "hit", id: end.unit ? end.unit.id : 0, dmg: 0, x: r2(end.x), y: r2(end.y), pop: pr.kind });
        continue;
      }
      this.explode(end.x, end.y, { src: pr.src, team: pr.team, w: pr.w, big: false, dmgMul: pr.dmgMul, direct: end.unit || null, cell: end.cell, dir: { x: ux, y: uy } });
    }
  }

  /**
   * 유닛이 다친다. src = { team, unit(유닛 id), slot(플레이어) }. 막혔으면(무적 · 보호막 · 문제를 푸는 중 — U35) false
   */
  hurtUnit(u, dmg, src) {
    if (u.dead || this.phase !== PHASE.PLAY) return false;
    if (u.invuln > 0 || u.shieldUntil > this.time || u.quiz) {
      this.fx.push({ k: "hit", id: u.id, dmg: 0, x: r2(u.x), y: r2(u.y), sh: 1 });
      return false;
    }
    dmg = Math.max(1, Math.round(dmg));
    u.hp -= dmg;
    u.hitAt = this.time;
    if (src.team !== NEUTRAL && src.team !== u.team) {
      u.lastHitTeam = src.team;
      u.lastHitAt = this.time;
      u.lastHitSlot = src.slot ?? -1;
    }
    if (src.unit) { u.lastHitUnit = src.unit; u.lastHitUnitAt = this.time; }
    this.fx.push({ k: "hit", id: u.id, dmg, x: r2(u.x), y: r2(u.y) });
    if (u.type === UTYPE.HERO) {
      const p = this.players[u.owner];
      if (p) p.meDirty = true;
      const a = src.unit && this.units.get(src.unit);
      if (a && !a.dead && Math.hypot(a.x - u.x, a.y - u.y) <= SQUAD.ASSIST * 1.6) { u.assist = a.id; u.assistAt = this.time; }
    }
    // 흡혈(내 몬스터 특기)
    const att = src.unit ? this.units.get(src.unit) : null;
    if (att && att.type === UTYPE.PET && att.perk === "leech" && !att.dead) att.hp = Math.min(att.maxHp, att.hp + dmg * MONSTER_PERK_VALUE.leech);
    if (u.type === UTYPE.NPC && att && !att.dead) this.aggro(u, att);
    if (u.hp <= 0) this.kill(u, src);
    return true;
  }

  kill(u, src) {
    if (u.dead) return;
    u.hp = 0;
    // 영웅이 아닌 것은 곧 지운다. 같은 틱의 이웃 바구니에는 아직 남아 있으니 dead 로 막아 두 번 쓰러지지 않게 한다
    if (u.type !== UTYPE.HERO) u.dead = true;
    this.fx.push({ k: "ko", id: u.id, x: r2(u.x), y: r2(u.y), team: u.team });
    if (u.gem >= 0) this.dropGem(u);
    const credit = u.lastHitTeam >= 0 && u.lastHitTeam !== u.team && this.time - u.lastHitAt <= CREDIT ? u.lastHitTeam : -1;
    switch (u.type) {
      case UTYPE.HERO: {
        u.dead = true;
        u.deadAt = this.time;
        u.deadUntil = this.time + HERO.RESPAWN;
        u.kvx = u.kvy = u.vx = u.vy = 0;
        u.kbAcc = null;
        if (u.quiz) this.cancelQuiz(u, "ko");
        const p = this.players[u.owner];
        if (p) {
          p.stats.deaths++;
          p.meDirty = true;
          p.lives = Math.max(0, p.lives - 1);
          if (p.lives > 0) this.note(p.slot, `쓰러졌어요! ${HERO.RESPAWN}초 뒤 부활 · 목숨 ${p.lives}`, "dead");
        }
        if (credit >= 0) {
          const T = this.teams[credit];
          T.kos++;
          T.dirty = true;
          const kp = this.players[u.lastHitSlot];
          if (kp && kp.team === credit) { kp.stats.kos++; kp.meDirty = true; }
          for (const q of this.players) if (q.team !== credit) q.teamDirtyAll = true;
        }
        if (p && p.lives <= 0) this.heroOutOf(p, u);
        return;
      }
      case UTYPE.PET: {
        this.units.delete(u.id);
        const p = this.players[u.owner];
        if (p && p.pet.unitId === u.id) {
          // 부활 없음 — 레벨도 잃고 다시 사야 한다
          Object.assign(p.pet, { kind: -1, level: 1, state: "none", t: 0, total: 0, unitId: 0 });
          p.meDirty = true;
          this.note(p.slot, `${MONSTERS[u.kind].name}이(가) 사라졌어요 · 다시 살 수 있어요`, "dead");
        }
        return;
      }
      case UTYPE.NPC: {
        this.units.delete(u.id);
        const c = this.camps[u.camp];
        if (c && --c.alive <= 0) c.respawnAt = this.time + NPC.RESPAWN;
        const team = u.lastHitTeam;
        if (team >= 0 && team !== NEUTRAL && this.teams[team]) this.reward(team, u, src);
        return;
      }
      default:
        this.units.delete(u.id);
        if (u.type === UTYPE.WORKER || u.type === UTYPE.BOT) {
          const p = this.players[u.owner];
          if (p) {
            p.meDirty = true;
            if (u.type === UTYPE.BOT) this.note(p.slot, "잉크봇이 사라졌어요", "dead");
          }
        }
        if (u.claim) this.releaseSlot(u);
    }
  }

  /** 중립 몬스터를 쓰러뜨린 팀이 받는 것: 잉크 · 코어 · 도감 · 아이템 */
  /**
   * 중립 몬스터를 쓰러뜨린 보상(U31): 마지막 한 방을 친 유닛(영웅 · 일꾼 · 잉크봇 · 몬스터)의 주인 지갑으로.
   * 탑 사격처럼 주인이 없으면 그 팀 학생들이 똑같이 나눈다(나머지는 버림). 도감은 팀 모두
   */
  reward(team, m, src) {
    const T = this.teams[team];
    const M = MONSTERS[m.kind];
    const tier = MONSTER_TIERS[M.tier];
    const core = tier.core >= 1 ? Math.round(tier.core) : this.rand() < (tier.core || 0) ? 1 : 0;
    const killer = src && src.team === team && this.players[src.slot] && this.players[src.slot].team === team ? this.players[src.slot] : null;
    const pays = killer ? [killer] : this.players.filter((q) => q.team === team);
    const gold = Math.floor((tier.gold || 0) / Math.max(1, pays.length)), cores = Math.floor(core / Math.max(1, pays.length));
    for (const q of pays) { this.earn(q, "gold", gold); this.earn(q, "core", cores); }
    T.dirty = true;
    const fresh = !T.fac.dex.has(m.kind);
    T.fac.dex.add(m.kind);
    const parts = [`골드 +${gold}`];
    if (cores) parts.push(`코어 +${cores}`);
    const who = killer ? `${killer.name}: ` : "깃발의 탑이 ";
    this.teamNote(team, `${who}${M.name} 처치! ${killer ? "" : "모두 "}${parts.join(" · ")}${fresh ? ` · 도감 할인!` : ""}`, "hunt", { x: m.x, y: m.y });
    if (this.rand() < NPC.ITEM_DROP) this.dropItem(Math.floor(this.rand() * ITEMS.length), m.x, m.y);
  }

  dropItem(kind, x, y) {
    const f = nearestFree(this.grid, x, y, 4) || { x, y };
    this.items.push({ id: this.nextItemId++ & 0xffff || 1, kind, x: f.x, y: f.y, until: this.time + ITEM_LIFE });
  }

  /** 건물이 다친다(같은 팀 · 꺾인 탑 · 고장 난 랩/퍼실리티는 더 다치지 않는다) */
  hurtBuilding(b, dmg, src) {
    if (b.team === src.team || this.phase !== PHASE.PLAY || !this.buildings.has(b.id)) return;
    if (b.down || b.broken || b.hp <= 0) return;
    b.hp -= dmg;
    b.hitAt = this.time;
    if (src.team !== NEUTRAL) { b.lastHitTeam = src.team; b.lastHitAt = this.time; }
    const T = this.teams[b.team];
    if (T && this.time - T.alarmAt > 12) {
      T.alarmAt = this.time;
      this.teamNote(b.team, `${BUILDINGS[b.kind].name}이(가) 공격받고 있어요!`, "alarm", { x: b.cx, y: b.cy });
    }
    if (b.hp <= 0) this.buildingZero(b);
  }

  buildingZero(b) {
    b.hp = 0;
    const T = this.teams[b.team];
    this.fx.push({ k: "bdown", id: b.id, kind: b.kind, team: b.team, x: b.cx, y: b.cy, all: 1 });
    T.dirty = true;
    if (b.kind === BLD.TOWER) {
      // 깃발의 탑이 부서지면 그 팀은 곧바로 탈락(U27 — 예전의 "꺾였다 30초 뒤 다시 서기 · 점수 1 빼앗기"를 바꾼다)
      const by = b.lastHitTeam >= 0 && b.lastHitTeam !== b.team ? b.lastHitTeam : -1;
      this.eliminate(b.team, by, "tower");
    } else if (b.kind === BLD.SUPPLY) {
      this.buildings.delete(b.id);
      this.blkDirty = true;
      this.teamNote(b.team, "공급소가 무너졌어요", "alarm", { x: b.cx, y: b.cy });
    } else {
      b.broken = true;
      this.teamNote(b.team, `${BUILDINGS[b.kind].name} 고장! 일꾼이 고쳐요`, "alarm", { x: b.cx, y: b.cy });
    }
  }

  hurtCrate(i, dmg) {
    if (this.map.tiles[i] !== TILE.CRATE) return;
    const hp = (this.crateHp.get(i) ?? CRATE_HP) - dmg;
    if (hp <= 0) this.breakCrate(i);
    else this.crateHp.set(i, hp);
  }

  breakCrate(i) {
    if (this.map.tiles[i] !== TILE.CRATE) return;
    this.map.tiles[i] = TILE.FLOOR;
    this.crateHp.delete(i);
    this.broken.push(i);
    this.blkDirty = true;
    this.fx.push({ k: "crate", i, all: 1 });
  }

  // ───────────── ⑤ 건물 · 랩 · 퍼실리티 · 뽑기 ─────────────
  stepBuildings() {
    for (const b of [...this.buildings.values()]) {
      if (!b.built) {
        if (b.builders > 0) {
          const def = BUILDINGS[b.kind];
          const dp = ((1 + 0.5 * (b.builders - 1)) / def.build.time) * TICK;
          b.progress = Math.min(1, b.progress + dp);
          b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * dp);
          if (b.progress >= 1) {
            b.built = true;
            const T = this.teams[b.team];
            T.dirty = true;
            this.teamNote(b.team, "잉크 공급소 완성!", "built", { x: b.cx, y: b.cy });
            this.fx.push({ k: "spawn", id: b.id, x: b.cx, y: b.cy, team: b.team, bld: 1 });
          }
        }
        b.builders = 0;
        continue;
      }
      if (b.broken && b.hp >= b.maxHp) {
        b.broken = false;
        b.hp = b.maxHp;
        this.teams[b.team].dirty = true;
        this.teamNote(b.team, `${BUILDINGS[b.kind].name}을(를) 다 고쳤어요!`, "built", { x: b.cx, y: b.cy });
      }
      if (b.kind === BLD.TOWER) this.towerTick(b);
    }
    for (const T of this.teams) {
      const lab = this.buildings.get(T.labId);
      if (T.lab.job && lab && !lab.broken) {
        const J = T.lab.job;
        J.t += TICK;
        if (J.t >= J.total) this.finishLabJob(T, J);
      }
      const fac = this.buildings.get(T.facId);
      if (T.fac.job && fac && !fac.broken) {
        const J = T.fac.job;
        J.t += TICK;
        if (J.t >= J.total) this.finishFacJob(T, J);
      }
    }
    // 뽑기 · 부화 · 부활
    for (const p of this.players) {
      const T = this.teams[p.team];
      const tower = this.tower(p.team);
      if (p.queue.length && tower && !tower.down) {
        const q = p.queue[0];
        q.t += TICK;
        if (q.t >= q.total) {
          p.queue.shift();
          // 탑 앞(영웅이 나오는 쪽)에 나온다. 새 일꾼은 저절로 일하지 않고 기다린다(U17)
          const base = this.map.bases[p.team];
          const at = this.spotNear(tower, base.spawn.x, base.spawn.y);
          const u = this.spawnUnit(q.what === "bot" ? UTYPE.BOT : UTYPE.WORKER, p.team, p.slot, at.x, at.y);
          if (u.type === UTYPE.BOT && p.bot && !p.heroOut) this.setOrder(u, { type: "follow" });
          this.note(p.slot, q.what === "bot" ? "잉크봇이 나왔어요." : "새 일꾼! 일을 시켜 주세요!", "train", { x: u.x, y: u.y });
          p.meDirty = true;
        }
      }
      const fac = this.buildings.get(T.facId);
      const pet = p.pet;
      if (pet.state === "hatching" && fac && !fac.broken) {
        pet.t -= TICK;
        if (pet.t <= 0) {
          this.spawnPet(p);
          this.note(p.slot, `${MONSTERS[pet.kind].name}이(가) 나왔어요!`, "fac");
        }
      }
    }
  }

  finishLabJob(T, J) {
    T.lab.job = null;
    T.dirty = true;
    if (J.kind === "unlock") {
      T.lab.unlocked[J.key] = true;
      // 처음 열면 팀 모두에게 한 묶음씩(소지품 최대를 넘지 않게)
      const W = WEAPONS[J.key];
      const n = W.pack ? W.pack.n : 0;
      for (const p of this.players) if (p.team === T.id && n) p.inv[J.key] = Math.min(stackMax(J.key), p.inv[J.key] + n);
      this.teamNote(T.id, `${W.name} 열림! 모두 ${n}개씩`, "lab");
    } else if (J.kind === "level") {
      T.lab.lv = J.key;
      this.teamNote(T.id, `잉크 무기 랩 ${J.key}단계!`, "lab");
    } else if (J.kind === "research") {
      T.lab.research[J.key] = true;
      const R = LAB.RESEARCH.find((r) => r.key === J.key);
      this.teamNote(T.id, `연구 완료: ${R ? R.name : J.key}`, "lab");
    }
    for (const p of this.players) if (p.team === T.id) p.meDirty = true;
  }

  finishFacJob(T, J) {
    T.fac.job = null;
    T.dirty = true;
    if (J.kind === "level") {
      T.fac.lv = J.key;
      this.teamNote(T.id, `몬스터 퍼실리티 ${J.key}단계!`, "fac");
    } else if (J.kind === "research") {
      T.fac.research[J.key] = true;
      const R = FACILITY.RESEARCH.find((r) => r.key === J.key);
      this.teamNote(T.id, `연구 완료: ${R ? R.name : J.key}`, "fac");
      for (const u of this.units.values()) if (u.type === UTYPE.PET && u.team === T.id) this.refreshPet(u);
    }
  }

  /** 깃발의 탑: 가까운 적에게 풍선을 던진다(부서지면 팀 탈락 — U27, 꺾였다 다시 서는 것은 없다) */
  towerTick(b) {
    if (this.phase !== PHASE.PLAY) return;
    b.cd -= TICK;
    if (b.cd > 0) return;
    let best = null, bd = TOWER.RANGE;
    for (const u of this.hash.query(b.cx, b.cy, TOWER.RANGE + b.size)) {
      if (u.dead || u.quiz || u.team === b.team) continue;
      if (u.type === UTYPE.NPC) {
        const t = u.target && this.units.get(u.target);
        if (!t || t.team !== b.team) continue;
      }
      const d = rectDist(u.x, u.y, b.tx, b.ty, b.size) - u.radius;
      if (d < bd) { bd = d; best = u; }
    }
    if (!best) return;
    b.cd = TOWER.CD;
    const T = this.teams[b.team];
    const d = Math.hypot(best.x - b.cx, best.y - b.cy);
    const lead = flightTime(d, false) * 0.6;
    const tx = best.x + best.vxe * lead, ty = best.y + best.vye * lead;
    this.launchArc({ team: b.team, unit: 0, slot: -1 }, 0, false, b.cx, b.cy, 4.5, tx, ty, {
      dmgMul: T.lab.research.power ? RESEARCH_FX.power : 1,
      spec: { splash: THROW.SMALL.splash, kb: THROW.SMALL.kb * 0.8, dmg: TOWER.DMG },
      structMul: 0,
    });
  }

  // ───────────── ⑥ 보석 섹션 · 퀴즈 · 보석 ─────────────
  hurtSite(s, dmg, src) {
    if (this.phase !== PHASE.PLAY) return;
    if (src.team === NEUTRAL) return; // 중립의 공격은 섹션을 치지 않는다
    if ((s.state === SITE_STATE.SHIELD || s.state === SITE_STATE.ROCK) && src.unit) this.defendSite(s, this.units.get(src.unit));
    if (s.state === SITE_STATE.SHIELD) {
      s.shield -= dmg;
      s.hitAt = this.time;
      if (s.shield <= 0) this.shieldBroken(s, src);
    } else if (s.state === SITE_STATE.ROCK) {
      s.rock -= dmg;
      s.hitAt = this.time;
      if (s.rock <= 0) this.popGem(s, src.team);
    }
  }

  shieldBroken(s, src) {
    s.shield = 0;
    if (this.mode === "arcade") {
      s.state = SITE_STATE.ROCK;
      s.rock = GEM.ROCK_HP;
      this.fx.push({ k: "gem", ev: "shield", team: src.team, x: s.x, y: s.y, value: s.value, site: s.id, all: 1 });
      return;
    }
    // 퀴즈 모드: 깬 유닛의 주인에게 문제
    const slot = src.slot ?? -1;
    if (slot < 0 || !this.players[slot]) { s.shield = GEM.SHIELD_HP; return; }
    this.startQuiz(s, slot);
  }

  startQuiz(s, slot) {
    const p = this.players[slot];
    const h = this.heroOf(slot);
    const locked = (p.lock[s.id] || 0) > this.time;
    if (!h || h.dead || h.quiz || locked) {
      s.shield = GEM.SHIELD_HP;
      if (locked) this.warnNote(p, "lock" + s.id, `${Math.ceil(p.lock[s.id] - this.time)}초 뒤 다시 받을 수 있어요`);
      else if (h && h.dead) this.warnNote(p, "quizdead", "쓰러져서 문제를 못 받았어요");
      return;
    }
    const idx = this.quiz.take(p.team);
    if (idx < 0) { s.state = SITE_STATE.ROCK; s.rock = GEM.ROCK_HP; return; }
    const { order, view } = this.quiz.present(idx);
    s.state = SITE_STATE.QUIZ;
    s.team = p.team;
    s.quizSlot = slot;
    s.timer = GEM.QUIZ_TIME;
    h.quiz = { site: s.id, idx, order, view, until: this.time + GEM.QUIZ_TIME, lockUntil: this.time + 0.6, botAt: p.bot ? this.time + 2 + this.rand() * 3 : 0 };
    // 문제를 푸는 동안 이 영웅만 그 자리에 서고, 다치지도 밀리지도 않는다 — 누구도 노리지 않는다(U35). 경기는 모두에게 그대로 흐른다
    h.vx = h.vy = 0;
    h.kvx = h.kvy = 0;
    h.kbAcc = null;
    h.input = null;
    if (!p.bot) this.send(slot, { t: "quiz", site: s.id, q: view, time: GEM.QUIZ_TIME });
    this.teamNote(p.team, `${p.name} 퀴즈 푸는 중`, "quiz", { x: s.x, y: s.y });
    p.meDirty = true;
  }

  answer(p, choice) {
    const h = this.heroOf(p.slot);
    if (!h || !h.quiz || p.bot) return;
    if (this.time < h.quiz.lockUntil) {
      // 문제가 뜨자마자 누른 답(무기 숫자 키 등)은 받지 않는다 — 브라우저가 단추를 잠갔을 수 있으니 문제 창을 다시 연다
      this.send(p.slot, { t: "quiz", site: h.quiz.site, q: h.quiz.view, time: r2(Math.max(1, h.quiz.until - this.time)) });
      return;
    }
    this.judge(h, choice);
  }

  judge(h, choice) {
    const L = h.quiz;
    const p = this.players[h.owner];
    const s = this.sites[L.site];
    const q = this.quiz.questions[L.idx];
    const picked = choice >= 0 && choice < L.order.length ? L.order[choice] : -1;
    const ok = picked === q.answer;
    this.quiz.result(h.team, L.idx, ok);
    h.quiz = null;
    s.quizSlot = -1;
    s.team = -1;
    s.timer = 0;
    if (!p.bot) this.send(p.slot, { t: "quizResult", ok, answer: L.order.indexOf(q.answer), picked: choice, explain: q.explanation || "", timeout: choice < 0 });
    p.meDirty = true;
    if (ok) {
      p.stats.right++;
      this.teamNote(h.team, `${p.name}: 정답! 보석이 나와요`, "quiz", { x: s.x, y: s.y });
      this.popGem(s, h.team);
    } else {
      p.stats.wrong++;
      s.state = SITE_STATE.SHIELD;
      s.shield = GEM.SHIELD_HP;
      s.hitAt = this.time;
      p.lock[s.id] = this.time + GEM.QUIZ_LOCKOUT;
    }
  }

  /** 풀이가 끊겼다(쓰러짐 · 끝) — 방어막이 다시 서고 문제는 줄 앞으로 */
  cancelQuiz(h) {
    const L = h.quiz;
    if (!L) return;
    const p = this.players[h.owner];
    const s = this.sites[L.site];
    this.quiz.giveBack(h.team, L.idx);
    h.quiz = null;
    s.state = SITE_STATE.SHIELD;
    s.shield = GEM.SHIELD_HP;
    s.team = -1;
    s.quizSlot = -1;
    s.timer = 0;
    s.hitAt = this.time;
    if (p && !p.bot && p.connected) this.send(p.slot, { t: "quizClose" });
  }

  popGem(s, team) {
    s.state = SITE_STATE.GEM;
    s.rock = 0;
    s.shield = 0;
    s.team = -1;
    this.blkDirty = true;
    const gem = { id: s.id, site: s.id, state: 0, carrier: -1, x: s.x, y: s.y, value: s.value, timer: 0, pickAt: this.time + 0.3 };
    this.gems.set(gem.id, gem);
    this.fx.push({ k: "gem", ev: "pop", team, x: s.x, y: s.y, value: s.value, site: s.id, all: 1 });
  }

  stepSites() {
    for (const s of this.sites) {
      if (s.state === SITE_STATE.SHIELD) {
        if (s.shield < GEM.SHIELD_HP && this.time - s.hitAt >= GEM.SHIELD_REGEN_AFTER) s.shield = GEM.SHIELD_HP;
      } else if (s.state === SITE_STATE.QUIZ) {
        if (s.def) s.def.until = Math.max(s.def.until, this.time + GUARD.CALM); // 푸는 동안은 계속 지킨다
        const h = this.heroOf(s.quizSlot);
        if (!h || !h.quiz || h.quiz.site !== s.id) {
          s.state = SITE_STATE.SHIELD; s.shield = GEM.SHIELD_HP; s.team = -1; s.quizSlot = -1; s.hitAt = this.time;
          continue;
        }
        s.timer = Math.max(0, h.quiz.until - this.time);
      } else if (s.state === SITE_STATE.EMPTY) {
        s.timer -= TICK;
        if (s.timer <= 0) {
          s.state = SITE_STATE.SHIELD;
          s.shield = GEM.SHIELD_HP;
          s.rock = GEM.ROCK_HP;
          s.timer = 0;
          s.hitAt = this.time;
          this.blkDirty = true;
          this.fx.push({ k: "gem", ev: "return", team: -1, x: s.x, y: s.y, value: s.value, site: s.id, respawn: 1, all: 1 });
        }
      }
    }
    // 풀이 중인 영웅: 컴퓨터는 생각한 뒤 답하고, 시간이 다하면 틀린 것으로
    for (const p of this.players) {
      const h = this.heroOf(p.slot);
      if (!h || !h.quiz) continue;
      const L = h.quiz;
      if (p.bot && L.botAt && this.time >= L.botAt) {
        const q = this.quiz.questions[L.idx];
        const right = L.order.indexOf(q.answer);
        let c = right;
        if (this.rand() >= BOT.ACCURACY) c = (right + 1 + Math.floor(this.rand() * (L.order.length - 1))) % L.order.length;
        this.judge(h, c);
      } else if (this.time >= L.until) this.judge(h, -1);
    }
  }

  stepGems() {
    for (const gem of [...this.gems.values()]) {
      if (gem.state === 1) {
        const c = this.units.get(gem.carrier);
        if (!c || c.dead) { this.dropGemAt(gem, gem.x, gem.y); continue; }
        gem.x = c.x; gem.y = c.y;
        const tower = this.tower(c.team);
        if (tower && rectDist(c.x, c.y, tower.tx, tower.ty, tower.size) <= TOWER.DELIVER + c.radius) this.deliver(gem, c);
        continue;
      }
      if (gem.timer > 0) {
        gem.timer -= TICK;
        if (gem.timer <= 0) {
          const s = this.sites[gem.site];
          gem.x = s.x; gem.y = s.y; gem.timer = 0;
          this.fx.push({ k: "gem", ev: "return", team: -1, x: s.x, y: s.y, value: gem.value, site: s.id, all: 1 });
          continue;
        }
      }
      if (this.time < gem.pickAt) continue;
      let best = null, bd = Infinity;
      for (const u of this.hash.query(gem.x, gem.y, GEM.PICK + 1)) {
        if (u.dead || u.gem >= 0 || (u.type !== UTYPE.HERO && u.type !== UTYPE.BOT) || u.quiz) continue;
        const d = Math.hypot(u.x - gem.x, u.y - gem.y);
        if (d <= GEM.PICK + u.radius && d < bd) { bd = d; best = u; }
      }
      if (best) this.pickGem(gem, best);
    }
  }

  pickGem(gem, u) {
    gem.state = 1;
    gem.carrier = u.id;
    gem.timer = 0;
    u.gem = gem.id;
    u.gemAt = this.time;
    this.fx.push({ k: "gem", ev: "pick", team: u.team, x: r2(u.x), y: r2(u.y), value: gem.value, id: u.id, all: 1 });
    const p = this.players[u.owner];
    if (p) p.meDirty = true;
    if (u.type === UTYPE.BOT && u.order.type !== "hold" && u.order.type !== "move") {
      u.prevOrder = u.order.type === "grab" ? { type: p && p.bot ? "follow" : "idle" } : u.order;
      this.setOrder(u, { type: "deliver" });
    }
    if (p) this.teamNote(u.team, `${p.name}${u.type === UTYPE.BOT ? "의 잉크봇" : ""}이(가) 보석! 탑까지 지켜 줘요`, "gem", { x: u.x, y: u.y });
  }

  dropGem(u) {
    const gem = this.gems.get(u.gem);
    u.gem = -1;
    if (gem) this.dropGemAt(gem, u.x, u.y);
  }

  dropGemAt(gem, x, y) {
    const c = this.units.get(gem.carrier);
    if (c && c.gem === gem.id) c.gem = -1;
    const f = nearestFree(this.grid, x, y, 6) || { x, y };
    gem.state = 0;
    gem.carrier = -1;
    gem.x = f.x; gem.y = f.y;
    gem.timer = GEM.DROP_RETURN;
    gem.pickAt = this.time + 0.4;
    this.fx.push({ k: "gem", ev: "drop", team: c ? c.team : -1, x: r2(f.x), y: r2(f.y), value: gem.value, all: 1 });
  }

  deliver(gem, u) {
    const T = this.teams[u.team];
    const s = this.sites[gem.site];
    this.gems.delete(gem.id);
    u.gem = -1;
    T.score += gem.value;
    T.dirty = true;
    const p = this.players[u.owner];
    this.earn(p, "gold", GEM.DELIVER_GOLD); // 배달 덤은 배달한 학생(잉크봇이면 그 주인) 지갑으로(U31)
    if (p) { p.stats.delivered += gem.value; p.meDirty = true; }
    s.state = SITE_STATE.EMPTY;
    s.timer = GEM.RESPAWN;
    s.team = -1;
    this.fx.push({ k: "gem", ev: "score", team: u.team, x: r2(u.x), y: r2(u.y), value: gem.value, all: 1 });
    this.broadcastAll({ t: "score", team: u.team, value: gem.value, by: p ? p.name : "" });
    this.allNote(`${TEAM_NAMES[u.team]} 팀 보석 +${gem.value}! (${p ? p.name : ""})`, "score");
    if (u.type === UTYPE.BOT) this.setOrder(u, u.prevOrder || { type: "idle" });
    this.checkGoal(u.team);
  }

  /**
   * 영웅이 마지막 목숨까지 쓰러졌다(U26): 다시 나오지 않는다(쓰러진 모습이 잠깐 보인 뒤 스냅숏에서 빠진다).
   * 그 학생은 지휘관 — 따라오던 잉크봇 · 몬스터는 그 자리를 지킨다. 팀의 영웅이 모두 그렇게 되면 팀 탈락(U27)
   */
  heroOutOf(p, h) {
    p.heroOut = true;
    p.lives = 0;
    p.meDirty = true;
    h.deadUntil = Infinity;
    for (const u of this.units.values()) if (u.owner === p.slot && !u.dead && u.order.type === "follow") this.setOrder(u, { type: "hold" });
    this.note(p.slot, "목숨을 다 썼어요 · 이제 지휘관!", "dead");
    if (this.players.every((q) => q.team !== p.team || q.heroOut)) this.eliminate(p.team, -1, "heroes");
  }

  /**
   * 팀 탈락(U27): 유닛은 모두 사라지고(든 보석은 떨어진다) 건물은 무너진다(지나갈 수 있게 지운다). 점수는 순위에 남는다.
   * 그 팀 학생은 구경한다(안개 없이 모두 본다 · 명령은 받지 않는다). 한 팀만 남으면 그 팀이 이긴다(reason "last")
   */
  eliminate(team, by, reason) {
    const T = this.teams[team];
    if (!T || T.out || this.over) return;
    T.out = true;
    T.outAt = this.time;
    T.outReason = reason;
    T.outBy = by;
    T.lab.job = null;
    T.fac.job = null;
    T.dirty = true;
    for (const u of [...this.units.values()]) {
      if (u.team !== team) continue;
      if (u.gem >= 0) this.dropGem(u);
      if (u.type === UTYPE.HERO) {
        if (u.quiz) this.cancelQuiz(u);
        if (!u.dead) {
          this.fx.push({ k: "ko", id: u.id, x: r2(u.x), y: r2(u.y), team });
          u.dead = true;
          u.hp = 0;
          u.deadAt = this.time;
        }
        u.deadUntil = Infinity;
        continue;
      }
      if (u.claim) this.releaseSlot(u);
      this.fx.push({ k: "ko", id: u.id, x: r2(u.x), y: r2(u.y), team });
      u.dead = true;
      this.units.delete(u.id);
    }
    for (const b of [...this.buildings.values()]) {
      if (b.team !== team) continue;
      if (b.hp > 0 || b.kind !== BLD.TOWER) this.fx.push({ k: "bdown", id: b.id, kind: b.kind, team, x: b.cx, y: b.cy, all: 1 });
      this.buildings.delete(b.id);
    }
    this.blkDirty = true;
    for (const p of this.players) {
      if (p.team !== team) continue;
      p.queue = [];
      Object.assign(p.pet, { kind: -1, level: 1, state: "none", t: 0, total: 0, unitId: 0 });
      p.meDirty = true;
    }
    const left = this.teams.filter((t) => !t.out).map((t) => t.id);
    this.broadcastAll({ t: "elim", team, by, reason, left });
    this.allNote(`${TEAM_NAMES[team]} 팀 탈락! (${reason === "tower" ? "탑이 부서졌어요" : "영웅이 모두 쓰러졌어요"})`, "alarm");
    if (left.length <= 1) this.finish("last", left.length ? left[0] : -1);
  }

  checkGoal(team) {
    if (this.teams[team].out) return;
    if (this.teams[team].score >= GOAL) this.finish("goal", team);
  }

  // ───────────── ⑦ 몬스터 · 아이템 ─────────────
  /**
   * 섹션 s 를 a(영웅 · 잉크봇 · 몬스터 — 포물선 풍선이면 던진 유닛)가 쳤다(U21): 지킴이 캠프의 중립 몬스터가 a 에게 간다.
   * 이미 다른 상대를 쫓는 중이면, a 가 더 가깝거나 a 가 거듭 치는데 지금 상대는 한동안 안 쳤을 때만 바꾼다
   */
  defendSite(s, a) {
    if (!s.guards || !s.guards.length || !a || a.dead || a.team === NEUTRAL) return;
    if (a.type !== UTYPE.HERO && a.type !== UTYPE.BOT && a.type !== UTYPE.PET) return;
    if (!s.def || this.time > s.def.until) s.def = { until: 0, teams: new Set(), noted: new Set(), hits: new Map() };
    const D = s.def;
    D.until = this.time + GUARD.CALM;
    D.teams.add(a.team);
    const hit = D.hits.get(a.id) || { n: 0, at: 0 };
    hit.n++;
    hit.at = this.time;
    D.hits.set(a.id, hit);
    const leash = GEM.SHIELD_R + throwRange(this.teams[a.team].lab.research) + GUARD.LEASH_PAD;
    let woke = null;
    for (const m of this.units.values()) {
      if (m.type !== UTYPE.NPC || m.dead || !s.guards.includes(m.camp)) continue;
      const cur = m.defend && m.defend.site === s ? this.units.get(m.defend.target) : null;
      if (cur && !cur.dead && cur !== a) {
        const closer = Math.hypot(a.x - m.x, a.y - m.y) < Math.hypot(cur.x - m.x, cur.y - m.y);
        const curHit = D.hits.get(cur.id);
        const again = hit.n >= 2 && (!curHit || this.time - curHit.at > 1.5);
        if (!closer && !again) continue;
      }
      m.defend = { site: s, target: a.id, leash: Math.max(leash, m.defend && m.defend.site === s ? m.defend.leash : 0) };
      m.target = a.id;
      m.homing = false;
      m.path = null;
      if (!woke || MONSTERS[m.kind].boss) woke = m;
    }
    if (woke && !D.noted.has(a.team)) {
      D.noted.add(a.team);
      this.teamNote(a.team, `${s.center ? "가운데 보스" : "섹션 지킴이"}가 화났어요! ${this.unitName(a)}에게 가요`, "alarm", { x: r2(woke.x), y: r2(woke.y) });
    }
  }

  /** 알림에 쓰는 유닛 이름: 영웅 = 학생 이름, 잉크봇 · 몬스터 = "○○의 잉크봇" */
  unitName(u) {
    const p = this.players[u.owner];
    const who = p ? p.name : TEAM_NAMES[u.team] || "";
    if (u.type === UTYPE.HERO) return who;
    if (u.type === UTYPE.BOT) return `${who}의 잉크봇`;
    if (u.type === UTYPE.PET) return `${who}의 ${MONSTERS[u.kind].name}`;
    return who;
  }

  aggro(m, src) {
    if (m.homing) return;
    if (!m.target) m.target = src.id;
    for (const o of this.units.values()) if (o.type === UTYPE.NPC && o.camp === m.camp && !o.dead && !o.target && !o.homing) o.target = src.id;
  }

  /** 몬스터 공격이 유닛을 친다(몸 · 내려찍기 · 먹물 · 폭탄 · 충격파). 다쳤으면 true */
  monsterHitUnit(m, t, dmg, kb, o = {}) {
    const src = o.src || { team: m ? m.team : NEUTRAL, unit: m ? m.id : 0, slot: m ? m.owner : -1 };
    const mul = m && m.dmgMul ? m.dmgMul : 1;
    if (!this.hurtUnit(t, dmg * mul, src)) return false;
    let dx = o.dir ? o.dir.x : t.x - (o.x ?? (m ? m.x : t.x)), dy = o.dir ? o.dir.y : t.y - (o.y ?? (m ? m.y : t.y));
    const l = Math.hypot(dx, dy);
    if (l > 1e-4) { dx /= l; dy /= l; } else { dx = Math.cos(m ? m.facing : 0); dy = Math.sin(m ? m.facing : 0); }
    const perk = m && m.perk;
    const stun = o.stun ?? (perk === "stun" && o.slam ? MONSTER_PERK_VALUE.stun : THROW.STUN);
    const slow = perk === "sticky" && o.sticky ? MONSTER_PERK_VALUE.sticky : 0;
    this.knock(t, dx * kb, dy * kb, stun, slow);
    return true;
  }

  /** 범위 공격(내려찍기 · 휩쓸기 · 폭탄). grounded = 뛰어오른 영웅은 피한다 */
  monsterArea(m, x, y, r, dmg, kb, o = {}) {
    const src = { team: m.team, unit: m.id, slot: m.owner };
    for (const u of [...this.hash.query(x, y, r + 1.5)]) {
      if (u.dead || u.team === m.team) continue;
      if (o.grounded && u.z > JUMP.DODGE_Z) continue;
      if (Math.hypot(u.x - x, u.y - y) > r + u.radius) continue;
      this.monsterHitUnit(m, u, dmg, kb, { x, y, slam: o.slam, sticky: o.sticky, src });
    }
    if (m.team !== NEUTRAL) {
      const smul = THROW.BUILDING_MUL * (m.dmgMul || 1) * (o.siege ? 2 : 1);
      for (const b of [...this.buildings.values()]) if (b.team !== m.team && rectDist(x, y, b.tx, b.ty, b.size) <= r) this.hurtBuilding(b, dmg * smul, src);
      for (const s of this.sites) {
        if (s.state === SITE_STATE.SHIELD && Math.hypot(s.x - x, s.y - y) <= GEM.SHIELD_R + r) this.hurtSite(s, dmg * smul, src);
        else if (s.state === SITE_STATE.ROCK && rectDist(x, y, s.tx, s.ty, GEM.ROCK) <= r) this.hurtSite(s, dmg * smul, src);
      }
    }
  }

  /** 몬스터 경고(내려찍기 · 충격파 · 폭탄 자리). 그 안의 컴퓨터 영웅은 알맞을 때 뛰어오른다 */
  telegraph(x, y, r, t, shape, jump) {
    this.fx.push({ k: "warn", x: r2(x), y: r2(y), r: r2(r), t: r2(t), shape });
    if (!jump) return;
    for (const u of this.hash.query(x, y, r + 1)) {
      if (u.type !== UTYPE.HERO || u.dead || this.isHumanHero(u)) continue;
      if (Math.hypot(u.x - x, u.y - y) <= r + 0.5) u.jumpAt = this.time + Math.max(0, t - 0.2);
    }
  }

  stepWaves() {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.r += w.v * TICK;
      const m = this.units.get(w.mon) || { id: 0, team: w.team, owner: w.owner, dmgMul: w.dmgMul, facing: 0, x: w.x, y: w.y, perk: null };
      for (const u of [...this.hash.query(w.x, w.y, w.r + 1.5)]) {
        if (u.dead || u.team === w.team || w.hit.has(u.id) || u.z > JUMP.DODGE_Z) continue;
        const d = Math.hypot(u.x - w.x, u.y - w.y);
        if (Math.abs(d - w.r) > w.w + u.radius) continue;
        w.hit.add(u.id);
        this.monsterHitUnit(m, u, w.dmg, w.kb, { x: w.x, y: w.y, src: { team: w.team, unit: w.mon, slot: w.owner } });
      }
      if (w.r >= w.max) this.waves.splice(i, 1);
    }
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (this.time < z.at) continue;
      this.zones.splice(i, 1);
      const m = this.units.get(z.mon) || { id: 0, team: z.team, owner: z.owner, dmgMul: z.dmgMul, facing: 0, x: z.pts[0][0], y: z.pts[0][1], perk: null };
      for (const [x, y] of z.pts) {
        this.fx.push({ k: "slam", x: r2(x), y: r2(y), r: r2(z.r), toss: 1 });
        this.monsterArea(m, x, y, z.r, z.dmg, z.kb, { grounded: true });
      }
    }
  }

  stepCamps() {
    for (const c of this.camps) {
      if (c.alive > 0 || !c.respawnAt || this.time < c.respawnAt) continue;
      let busy = false;
      for (const u of this.hash.query(c.x, c.y, 7)) if (!u.dead && u.team !== NEUTRAL && Math.hypot(u.x - c.x, u.y - c.y) < 6) { busy = true; break; }
      if (busy) { c.respawnAt = this.time + 10; continue; }
      c.respawnAt = 0;
      this.spawnCamp(c, true);
    }
  }

  stepItems() {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (this.time >= it.until) { this.items.splice(i, 1); continue; }
      for (const u of this.hash.query(it.x, it.y, ITEM_PICK + 1)) {
        if (u.type !== UTYPE.HERO || u.dead || Math.hypot(u.x - it.x, u.y - it.y) > ITEM_PICK + u.radius) continue;
        const I = ITEMS[it.kind];
        if (I.key === "energy") u.hp = Math.min(u.maxHp, u.hp + I.heal);
        else if (I.key === "boost") u.boostUntil = this.time + I.time;
        else if (I.key === "shield") u.shieldUntil = this.time + I.time;
        this.fx.push({ k: "item", ev: "pick", x: r2(it.x), y: r2(it.y), kind: it.kind, id: u.id });
        const p = this.players[u.owner];
        if (p) { p.meDirty = true; this.note(p.slot, `${I.name}!`, "item"); }
        this.items.splice(i, 1);
        break;
      }
    }
  }

  /** 공급소 곁의 영웅 · 잉크봇 탱크를 팀 잉크로 채운다 */
  stepRefill() {
    for (const u of this.units.values()) {
      u.refilling = false;
      if (u.dead || (u.type !== UTYPE.HERO && u.type !== UTYPE.BOT)) continue;
      const cap = u.type === UTYPE.HERO ? INK.TANK : INK.BOT_TANK;
      if (u.tank >= cap) continue;
      // 어느 우리 공급소에서든 채우지만, 쓰는 잉크는 그 영웅(잉크봇이면 주인)의 지갑에서만(U31)
      const T = this.teams[u.team];
      const owner = this.players[u.owner];
      if (!owner || owner.ink <= 0) continue;
      const sup = this.nearestSupply(u.team, u.x, u.y);
      if (!sup || rectDist(u.x, u.y, sup.tx, sup.ty, sup.size) > INK.REFILL_REACH + u.radius) continue;
      const add = Math.min(INK.REFILL_RATE * TICK, cap - u.tank, owner.ink / INK.REFILL_COST);
      if (add <= 0) continue;
      u.tank += add;
      const used = Math.min(owner.ink, add * INK.REFILL_COST);
      owner.ink -= used;
      owner.spent.ink += used;
      u.refilling = true;
      if (this.time - (u.refillFx || -99) > 0.6) {
        u.refillFx = this.time;
        this.fx.push({ k: "refill", id: u.id, x: r2(u.x), y: r2(u.y), team: u.team });
      }
      owner.meDirty = this.tickNo % 4 === 0 || owner.meDirty;
      if (this.tickNo % 10 === 0) T.dirty = true;
    }
  }

  // ───────────── ⑧ 움직임 도우미 ─────────────
  rebuildHash() {
    this.hash.clear();
    for (const u of this.units.values()) if (!u.dead) this.hash.add(u);
  }

  /** u 를 (dx, dy) 만큼 벽에 미끄러지며 옮긴다 */
  moveBy(u, dx, dy) {
    const q = slide(u.fly ? this.flyBlk : this.blk, this.S, u.x, u.y, dx, dy, this.bodyR(u));
    u.x = q.x; u.y = q.y;
  }

  unitSpeed(u) {
    let s = u.speed;
    if (u.slow > 0) s *= SLOW.FACTOR;
    if (u.gem >= 0) s *= HERO.CARRY_SLOW;
    return s;
  }

  /**
   * (gx, gy) 쪽으로 한 틱 걷는다(길 찾기 · 곧게 가기). goal 이 { rect } 면 그 네모 옆까지. 다 왔으면 true
   * stop = 멈출 거리(점 목표)
   */
  steer(u, gx, gy, stop = 0.25, speedMul = 1, rect = null) {
    const d = rect ? rectDist(u.x, u.y, rect.tx, rect.ty, rect.size) - u.radius : Math.hypot(gx - u.x, gy - u.y);
    if (d <= stop) { u.path = null; return true; }
    const grid = u.fly ? this.flyGrid : this.grid;
    const speed = this.unitSpeed(u) * speedMul;
    u.want = speed * TICK;
    u.anim = ANIM.MOVE;
    // 가깝고 곧게 갈 수 있으면 길 찾기 없이
    if (!rect && d < 7 && lineClear(grid, u.x, u.y, gx, gy, Math.min(0.3, this.bodyR(u)))) {
      this.walkDir(u, gx - u.x, gy - u.y, Math.min(speed * TICK, d));
      u.path = null;
      return false;
    }
    // 네모(연못 · 금광 · 건물) 바로 곁: 칸 길 찾기로는 이미 닿은 칸(대각선 모서리)이라 빈 길이 나와 멈춘다 —
    // 가장 가까운 가장자리 점으로 곧게 다가간다
    if (rect && d < 1.6) {
      const cx = clamp(u.x, rect.tx, rect.tx + rect.size), cy = clamp(u.y, rect.ty, rect.ty + rect.size);
      this.walkDir(u, cx - u.x, cy - u.y, Math.min(speed * TICK, d - stop + 0.02));
      u.path = null;
      return false;
    }
    const key = rect ? `r${rect.tx},${rect.ty}` : `${Math.round(gx * 2)},${Math.round(gy * 2)}`;
    const stale = !u.path || (u.pathKey !== key && this.time >= u.repathAt) || (!u.path.length && this.time >= u.repathAt);
    if (stale) {
      if (this.pathBudget > 0) {
        this.pathBudget--;
        u.path = findPath(grid, u.x, u.y, rect ? { rect: { tx: rect.tx, ty: rect.ty, size: rect.size } } : { x: gx, y: gy }, { radius: Math.min(0.3, this.bodyR(u)), maxNodes: 6000 });
        u.pathKey = key;
        u.repathAt = this.time + 0.6 + this.rand() * 0.4;
        if (!u.path.length) u.fails++;
      } else if (!u.path) {
        this.walkDir(u, (rect ? rect.tx + rect.size / 2 : gx) - u.x, (rect ? rect.ty + rect.size / 2 : gy) - u.y, speed * TICK);
        return false;
      }
    }
    let left = speed * TICK;
    while (left > 1e-4 && u.path && u.path.length) {
      const p = u.path[0];
      const dx = p.x - u.x, dy = p.y - u.y;
      const dd = Math.hypot(dx, dy);
      if (dd <= Math.max(left, 0.08)) {
        this.moveBy(u, dx, dy);
        left -= dd;
        u.path.shift();
      } else {
        this.walkDir(u, dx, dy, left);
        left = 0;
      }
    }
    return false;
  }

  walkDir(u, dx, dy, dist) {
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) return;
    const s = Math.min(dist, l);
    u.facing = Math.atan2(dy, dx);
    this.moveBy(u, (dx / l) * s, (dy / l) * s);
  }

  /** 유닛끼리 겹치지 않게 민다 — 영웅은 밀리지 않고(사람이 정한 위치), 일하는 유닛은 덜 비킨다 */
  separate() {
    const YIELD = { [ANIM.IDLE]: 1, [ANIM.MOVE]: 0.5, [ANIM.GATHER]: 0.15, [ANIM.BUILD]: 0.15, [ANIM.WIND]: 0.1, [ANIM.ATTACK]: 0.2, [ANIM.THROW]: 0.3 };
    const near = [];
    for (const a of this.units.values()) {
      if (a.dead || a.type === UTYPE.HERO) continue;
      this.hash.query(a.x, a.y, a.radius + 1.2, near);
      for (const b of near) {
        if (b === a || b.dead) continue;
        if (b.type !== UTYPE.HERO && b.id < a.id) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = (a.radius + b.radius) * 0.85;
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = d2 > 1e-8 ? dx / d : Math.cos(a.id), ny = d2 > 1e-8 ? dy / d : Math.sin(a.id);
        const over = min - d;
        if (b.type === UTYPE.HERO) {
          this.moveBy(a, -nx * over * 0.5, -ny * over * 0.5);
          continue;
        }
        const wa = (YIELD[a.anim] ?? 0.6) / (a.radius * a.radius), wb = (YIELD[b.anim] ?? 0.6) / (b.radius * b.radius);
        const sa = wa / (wa + wb), sb = 1 - sa;
        const slip = a.anim === ANIM.MOVE || b.anim === ANIM.MOVE ? 0.5 : 0;
        const px = -ny * slip, py = nx * slip;
        this.moveBy(a, -(nx + px) * over * sa * 0.6, -(ny + py) * over * sa * 0.6);
        this.moveBy(b, (nx + px) * over * sb * 0.6, (ny + py) * over * sb * 0.6);
      }
    }
    for (const u of this.units.values()) {
      if (u.dead || u.type === UTYPE.HERO) continue;
      u.x = clamp(u.x, 0.3, this.S - 0.3);
      u.y = clamp(u.y, 0.3, this.S - 0.3);
      if (u.want > 0) {
        const moved = Math.hypot(u.x - u.px, u.y - u.py);
        if (moved < u.want * 0.25) {
          u.stuckT += TICK;
          if (u.stuckT > 1.2) { u.stuckT = 0; u.path = null; u.repathAt = 0; u.fails++; }
        } else u.stuckT = Math.max(0, u.stuckT - TICK);
      }
    }
  }

  // ───────────── 시작 전(U32) ─────────────
  /** 사람은 "이기는 방법"을 닫아야(ready) 준비 — 컴퓨터와 끊긴 사람은 늘 준비 */
  allReady() {
    return this.players.every((p) => p.bot || !p.connected || p.ready);
  }
  briefInfo() {
    const humans = this.players.filter((p) => !p.bot && p.connected);
    return { ready: humans.filter((p) => p.ready).length, total: humans.length };
  }
  beginCountdown() {
    this.phase = PHASE.COUNTDOWN;
    this.playAt = this.time + COUNTDOWN;
    this.endsAt = this.playAt + this.minutes * 60;
    this.playTick = this.tickNo + Math.round(COUNTDOWN / TICK);
    // 컴퓨터 일꾼은 경기가 시작된 뒤 조금 생각하고 일을 시킨다
    for (const u of this.units.values()) if (u.type === UTYPE.WORKER && !Number.isFinite(u.idleSince)) u.idleSince = this.playAt;
    this.broadcastAll({ t: "count", playTick: this.playTick });
  }

  // ───────────── 한 틱 ─────────────
  step() {
    if (this.over) return;
    this.time += TICK;
    this.tickNo++;
    if (this.phase === PHASE.BRIEF && (this.allReady() || this.time >= BRIEF_MAX)) this.beginCountdown();
    // 알린 틱(playTick)에 정확히 시작한다 — 모든 화면이 같은 틱으로 센다(소수 시간 누적의 오차를 피한다)
    if (this.phase === PHASE.COUNTDOWN && (Number.isFinite(this.playTick) ? this.tickNo >= this.playTick : this.time >= this.playAt)) {
      this.phase = PHASE.PLAY;
      this.allNote("시작! 보석을 우리 탑으로!", "start");
    }
    this.pathBudget = PATH_BUDGET;
    this.rebuildHash();
    for (const { slot, msg } of this.inbox.splice(0)) {
      if ((msg.t === "mv" || msg.t === "throw" || msg.t === "cmd") && this.phase !== PHASE.PLAY) continue;
      this.handle(slot, msg);
    }
    for (const p of this.players) if (p.needSync && p.connected) this.syncPlayer(p);
    if (this.phase === PHASE.PLAY) {
      updateBots(this);
      this.squads.clear();
      for (const u of this.units.values()) {
        if (u.dead || u.order.type !== "follow") continue;
        let list = this.squads.get(u.owner);
        if (!list) this.squads.set(u.owner, (list = []));
        list.push(u);
      }
      for (const u of [...this.units.values()]) {
        u.px = u.x; u.py = u.y;
        u.want = 0;
        if (u.type === UTYPE.HERO) this.heroTick(u);
        else this.aiUnitTick(u);
      }
      this.stepBuildings();
      this.rebuildHash();
      this.stepProjs();
      this.stepBalloons();
      this.stepWaves();
      this.stepSites();
      this.stepGems();
      this.stepItems();
      this.stepCamps();
      this.stepRefill();
      this.separate();
      for (const u of this.units.values()) {
        if (u.type === UTYPE.HERO) continue;
        const vx = (u.x - u.px) / TICK, vy = (u.y - u.py) / TICK;
        u.vxe = u.vxe * 0.6 + vx * 0.4;
        u.vye = u.vye * 0.6 + vy * 0.4;
      }
      if (this.blkDirty) this.rebuildBlocked();
      if (this.tickNo % 40 === 0) this.updatePondSafety();
      if (!this.over && this.time >= this.endsAt) this.finish("time");
    }
    if (this.over) return;
    if (this.tickNo % SNAP_EVERY === 0 || this.tickNo < 3) this.computeVision();
    this.broadcast();
  }

  heroTick(h) {
    const p = this.players[h.owner];
    if (h.dead) {
      h.anim = ANIM.KO;
      h.animT = clamp((this.time - h.deadAt) / DEAD_SHOW, 0, 1);
      if (this.time >= h.deadUntil) this.respawnHero(h, p);
      return;
    }
    h.throwCd = Math.max(0, h.throwCd - TICK);
    h.bombCd = Math.max(0, h.bombCd - TICK);
    h.invuln = Math.max(0, h.invuln - TICK);
    const M = h.mv;
    if (this.time - M.kbAt > 1.5) M.kb = Math.max(0, M.kb - 2 * TICK);
    if (h.quiz) {
      h.anim = ANIM.QUIZ;
      h.animT = clamp((h.quiz.until - this.time) / GEM.QUIZ_TIME, 0, 1);
      h.vx = h.vy = 0;
      return;
    }
    if (p && p.bot) {
      // 컴퓨터가 움직이는 영웅: 브라우저와 같은 몸 움직임(shared/move.js)
      const input = botHeroInput(this, p, h) || { mx: 0, my: 0 };
      if (h.jumpAt && this.time >= h.jumpAt) { input.jump = true; h.jumpAt = 0; }
      const mul = (h.boostUntil > this.time ? ITEMS[1].speed : 1) * (h.gem >= 0 ? HERO.CARRY_SLOW : 1);
      const ox = h.x, oy = h.y;
      const wasDash = h.dashT > 0;
      heroStep(h, input, TICK, this.blk, this.S, mul);
      if (h.dashT > 0 && !wasDash) h.bumped = false;
      const vx = (h.x - ox) / TICK, vy = (h.y - oy) / TICK;
      h.vxe = h.vxe * 0.5 + vx * 0.5;
      h.vye = h.vye * 0.5 + vy * 0.5;
      if (Math.hypot(vx, vy) > 0.3) { h.movedAt = this.time; h.moveDir = Math.atan2(vy, vx); }
      M.dashing = h.dashT > 0;
    } else {
      h.stun = Math.max(0, h.stun - TICK);
      h.slow = Math.max(0, h.slow - TICK);
      if (this.time - h.movedAt > 0.3) { h.vxe *= 0.7; h.vye *= 0.7; }
      if (M.dashing && this.time >= M.dashUntil) M.dashing = false;
    }
    if (M.dashing && !h.bumped) this.dashBump(h);
    // 동작
    if (h.stun > 0) h.anim = ANIM.STUN;
    else if (M.dashing) h.anim = ANIM.DASH;
    else if (h.c > 0.04) { h.anim = ANIM.CHARGE; h.animT = h.c; return; }
    else if (this.time - h.lastThrowAt < 0.25) h.anim = ANIM.THROW;
    else if (this.time - h.movedAt < 0.18) h.anim = ANIM.MOVE;
    else h.anim = ANIM.IDLE;
    h.animT = 0;
  }

  /** 대시 박치기: 처음 닿은 적 하나를 밀고 조금 다치게 한다 */
  dashBump(h) {
    const dirx = Math.cos(h.moveDir), diry = Math.sin(h.moveDir);
    for (const u of this.hash.query(h.x, h.y, DASH.BUMP_RANGE + 1.2)) {
      if (u.dead || u.team === h.team || u === h) continue;
      if (Math.hypot(u.x - h.x, u.y - h.y) > DASH.BUMP_RANGE + u.radius) continue;
      h.bumped = true;
      let dx = dirx + (u.x - h.x), dy = diry + (u.y - h.y);
      const l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      if (this.hurtUnit(u, DASH.BUMP_DMG, { team: h.team, unit: h.id, slot: h.owner })) this.knock(u, dx * DASH.BUMP_KB, dy * DASH.BUMP_KB, THROW.STUN, 0);
      this.fx.push({ k: "hit", id: u.id, dmg: 0, x: r2(u.x), y: r2(u.y), bump: h.id });
      return;
    }
  }

  respawnHero(h, p) {
    const tower = this.tower(h.team);
    if (tower && tower.down && !this.supplies(h.team, true).length) { h.deadUntil = this.time + 1; return; } // 탑도 공급소도 없으면 기다린다
    let k = 0;
    for (const q of this.players) { if (q === p) break; if (q.team === h.team) k++; }
    const sp = this.heroSpawnSpot(h.team, k);
    Object.assign(h, newHeroBody(sp.x, sp.y));
    h.dead = false;
    h.hp = h.maxHp;
    h.invuln = HERO.INVULN;
    h.slow = 0; h.stun = 0;
    h.vxe = h.vye = 0;
    h.px = h.x; h.py = h.y;
    h.mv.kb = 0;
    h.input = null;
    h.anim = ANIM.SPAWN;
    this.fx.push({ k: "spawn", id: h.id, x: r2(h.x), y: r2(h.y), team: h.team });
    if (p) { p.meDirty = true; if (!p.bot) this.warp(h); }
  }

  aiUnitTick(u) {
    if (u.dead) return;
    u.invuln = Math.max(0, u.invuln - TICK);
    u.slow = Math.max(0, u.slow - TICK);
    u.cd = Math.max(0, (u.cd || 0) - TICK);
    // 넉백
    if (u.kvx || u.kvy) {
      this.moveBy(u, u.kvx * TICK, u.kvy * TICK);
      const kd = Math.exp(-THROW.KB_DECAY * TICK);
      u.kvx *= kd; u.kvy *= kd;
      if (Math.abs(u.kvx) < 0.05) u.kvx = 0;
      if (Math.abs(u.kvy) < 0.05) u.kvy = 0;
    }
    if (u.stun > 0) {
      u.stun = Math.max(0, u.stun - TICK);
      u.anim = ANIM.STUN;
      return;
    }
    if (this.time - u.born < HATCH_SHOW && u.type !== UTYPE.WORKER && u.type !== UTYPE.BOT) { u.anim = ANIM.SPAWN; return; }
    u.anim = ANIM.IDLE;
    u.animT = 0;
    unitTick(this, u);
  }

  updatePondSafety() {
    for (const res of RES_KINDS) for (const q of this.nodes[res]) {
      q.safe = true;
      for (const u of this.hash.query(q.cx, q.cy, 8)) {
        if (u.type === UTYPE.NPC && !u.dead && Math.hypot(u.home.x - q.cx, u.home.y - q.cy) < 7) { q.safe = false; break; }
      }
    }
  }

  // ───────────── ⑨ 시야 · 스냅숏 · 보내기 ─────────────
  computeVision() {
    const S = this.S;
    for (const T of this.teams) T.vis.fill(0);
    const stamp = (T, x, y, r) => {
      const c = circle(r);
      const cx = Math.floor(x), cy = Math.floor(y);
      const vis = T.vis;
      for (let k = 0; k < c.length; k += 2) {
        const xx = cx + c[k], yy = cy + c[k + 1];
        if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
        vis[yy * S + xx] = 1;
      }
    };
    for (const u of this.units.values()) {
      if (u.dead || u.team === NEUTRAL) continue;
      const T = this.teams[u.team];
      if (T) stamp(T, u.x, u.y, Math.round(u.sight));
    }
    for (const b of this.buildings.values()) {
      const T = this.teams[b.team];
      if (T) stamp(T, b.cx, b.cy, Math.round(BUILDINGS[b.kind].sight + b.size / 2));
    }
  }

  unitFlags(u) {
    let f = 0;
    if (u.gem >= 0) f |= UF.GEM;
    if (u.carry > 0 && u.carryRes === 1) f |= UF.INK;
    if (u.slow > 0) f |= UF.SLOW;
    if (u.shieldUntil > this.time) f |= UF.SHIELD;
    if (u.boostUntil > this.time) f |= UF.BOOST;
    if (u.invuln > 0 || u.quiz) f |= UF.INVULN; // 문제를 푸는 영웅도(U35) — 쳐도 소용없다는 것이 보이게
    if (u.order && u.order.type === "follow") f |= UF.SQUAD;
    if (this.idleWorker(u)) f |= UF.IDLE;
    if (u.type === UTYPE.NPC && u.target) f |= UF.RAGE;
    if (u.refilling) f |= UF.REFILL;
    if (u.type === UTYPE.HERO) {
      const T = this.teams[u.team];
      if (u.tank < shotInk(u.weapon, false, T.lab.research)) f |= UF.DRY;
      if (u.dead) f |= UF.DOWN;
    } else if (u.type === UTYPE.BOT && u.tank < shotInk(0, false)) f |= UF.DRY;
    if (this.time - u.born < HATCH_SHOW && u.type !== UTYPE.HERO) f |= UF.HATCH;
    return f;
  }

  wireUnits() {
    const out = [];
    for (const u of this.units.values()) {
      if (u.dead && !(u.type === UTYPE.HERO && this.time - u.deadAt < DEAD_SHOW)) continue;
      let info = 0;
      if (u.type === UTYPE.HERO) info = u.weapon;
      else if (u.type === UTYPE.WORKER) info = u.carry > 0 ? u.carryRes : 0;
      else if (u.type === UTYPE.PET) info = u.level;
      out.push({
        u,
        w: {
          id: u.id, type: u.type, team: u.team, owner: u.owner, sub: u.sub, info, x: u.x, y: u.y, z: u.z || 0, facing: u.facing,
          hp: Math.max(0, u.hp), maxHp: u.maxHp, anim: u.anim, animT: u.animT || 0, flags: this.unitFlags(u),
        },
      });
    }
    return out;
  }

  viewOf(team, wire = this.wireUnits()) {
    const T = this.teams[team];
    const S = this.S;
    // 탈락한 팀(구경 — U27)은 안개 없이 모두 본다
    const vis = (x, y) => !T || T.out || !!T.vis[clamp(Math.floor(y), 0, S - 1) * S + clamp(Math.floor(x), 0, S - 1)];
    const units = [];
    // 안개 예외: 보석 운반자, 그리고 우리 팀이 친 섹션을 지키러 오는 지킴이(U21)
    const angry = (u) => u.defend && u.defend.site.def && u.defend.site.def.teams.has(team);
    for (const { u, w } of wire) if (!T || u.team === team || u.gem >= 0 || vis(u.x, u.y) || angry(u)) units.push(w);
    const buildings = [];
    for (const b of this.buildings.values()) {
      let progress = 0, level = 0, timer = 0, flags = 0;
      if (!b.built) progress = b.progress;
      if (b.built) flags |= BF.BUILT;
      if (b.broken) flags |= BF.BROKEN;
      if (b.down) { flags |= BF.DOWN; timer = Math.max(0, b.downUntil - this.time); }
      if (this.time - b.hitAt < 0.5) flags |= BF.HIT;
      const BT = this.teams[b.team];
      if (b.kind === BLD.LAB) {
        level = BT.lab.lv;
        if (BT.lab.job) { flags |= BF.BUSY; progress = BT.lab.job.t / BT.lab.job.total; }
      } else if (b.kind === BLD.FACILITY) {
        level = BT.fac.lv;
        if (BT.fac.job) { flags |= BF.BUSY; progress = BT.fac.job.t / BT.fac.job.total; }
      } else if (b.kind === BLD.TOWER) {
        if (this.players.some((p) => p.team === b.team && p.queue.length)) flags |= BF.BUSY;
      }
      buildings.push({ id: b.id, kind: b.kind, team: b.team, tx: b.tx, ty: b.ty, hp: b.hp, maxHp: b.maxHp, progress, flags, level, timer });
    }
    const sites = this.sites.map((s) => ({
      id: s.id, state: s.state, shield: s.state === SITE_STATE.SHIELD ? s.shield / GEM.SHIELD_HP : 0,
      rock: this.hasRock(s) ? (s.state === SITE_STATE.ROCK ? s.rock / GEM.ROCK_HP : 1) : 0,
      team: s.team, timer: s.state === SITE_STATE.QUIZ || s.state === SITE_STATE.EMPTY ? s.timer : 0, value: s.value,
    }));
    const gems = [...this.gems.values()].map((g) => ({ id: g.id, state: g.state, carrier: g.carrier, x: g.x, y: g.y, value: g.value, timer: g.timer }));
    const projs = [];
    for (const p of this.projs) if (p.team === team || vis(p.x, p.y)) projs.push({ id: p.id, kind: p.kind, team: p.team, x: p.x, y: p.y, dir: p.dir });
    const items = [];
    for (const it of this.items) if (vis(it.x, it.y)) items.push({ id: it.id, kind: it.kind, x: it.x, y: it.y });
    return {
      tick: this.tickNo, timeLeft: this.timeLeft(), phase: this.phase, teams: this.nTeams, scores: this.teams.map((t) => t.score),
      units, buildings, sites, gems, projs, items,
    };
  }

  timeLeft() {
    if (this.phase === PHASE.COUNTDOWN || this.phase === PHASE.BRIEF) return this.minutes * 60;
    return Math.max(0, this.endsAt - this.time);
  }

  fxFor(team) {
    const T = this.teams[team];
    const S = this.S;
    const seen = (x, y) => x != null && (T.out || !!T.vis[clamp(Math.floor(y), 0, S - 1) * S + clamp(Math.floor(x), 0, S - 1)]);
    return this.fx.filter((e) => {
      if (e.all || e.team === team) return true;
      if (e.x0 != null) return seen(e.x0, e.y0) || seen(e.x1, e.y1);
      if (e.x == null) return true;
      return seen(e.x, e.y);
    });
  }

  broadcast() {
    const snapNow = this.tickNo % SNAP_EVERY === 0;
    const wire = snapNow ? this.wireUnits() : null;
    const views = new Map();
    const fxBy = new Map();
    for (const p of this.players) {
      if (!p.connected) continue;
      if (snapNow) {
        if (!views.has(p.team)) views.set(p.team, encodeSnapshot(this.viewOf(p.team, wire)));
        this.send(p.slot, views.get(p.team));
      }
      if (this.fx.length) {
        if (!fxBy.has(p.team)) fxBy.set(p.team, this.fxFor(p.team));
        const e = fxBy.get(p.team);
        if (e.length) this.send(p.slot, { t: "fx", e });
      }
      const h = this.units.get(p.heroId);
      if (h && h.kbAcc) {
        const a = h.kbAcc;
        h.kbAcc = null;
        if (!p.bot) this.send(p.slot, { t: "kb", vx: r2(a.vx), vy: r2(a.vy), stun: r2(a.stun), slow: r2(a.slow) });
      }
      if (this.tickNo - p.meAt >= ME_EVERY || (p.meDirty && this.tickNo - p.meAt >= 2)) {
        p.meAt = this.tickNo;
        p.meDirty = false;
        this.send(p.slot, this.meInfo(p));
      }
    }
    for (const T of this.teams) {
      if (!(this.tickNo % TEAM_EVERY === 0 || T.dirty)) continue;
      T.dirty = false;
      const info = this.teamInfo(T);
      for (const p of this.players) if (p.connected && p.team === T.id) this.send(p.slot, info);
    }
    this.fx = [];
  }

  meInfo(p) {
    const h = this.units.get(p.heroId);
    const T = this.teams[p.team];
    const pet = p.pet;
    const pu = pet.unitId ? this.units.get(pet.unitId) : null;
    const lock = {};
    for (const [k, v] of Object.entries(p.lock)) if (v > this.time) lock[k] = Math.ceil(v - this.time);
    let workers = 0, bots = 0;
    for (const u of this.units.values()) {
      if (u.owner !== p.slot || u.dead) continue;
      if (u.type === UTYPE.WORKER) workers++;
      else if (u.type === UTYPE.BOT) bots++;
    }
    const gem = h && h.gem >= 0 ? this.gems.get(h.gem) : null;
    return {
      t: "me",
      hp: h ? Math.max(0, Math.ceil(h.hp)) : 0, maxHp: h ? h.maxHp : HERO.HP, tank: h ? Math.floor(h.tank) : 0, ink: Math.floor(p.ink),
      w: h ? h.weapon : 0, cd: h ? r2(h.throwCd) : 0, bombCd: h ? Math.ceil(h.bombCd) : 0,
      dead: h && h.dead && Number.isFinite(h.deadUntil) ? Math.max(0.1, r2(h.deadUntil - this.time)) : 0, carry: gem ? gem.value : 0,
      slow: h ? r2(h.slow) : 0, stun: h ? r2(h.stun) : 0, boost: h ? r2(Math.max(0, h.boostUntil - this.time)) : 0,
      shield: h ? r2(Math.max(0, h.shieldUntil - this.time)) : 0, invuln: h ? r2(h.invuln) : 0,
      kos: p.stats.kos, deaths: p.stats.deaths, delivered: p.stats.delivered, heroId: p.heroId,
      pet: { kind: pet.kind, level: pet.level, state: pet.state, t: r2(Math.max(0, pet.t)), total: pet.total, hp: pu ? Math.ceil(pu.hp) : 0, maxHp: pu ? pu.maxHp : 0, id: pet.unitId },
      counts: { worker: workers, bot: bots },
      queue: p.queue.map((q) => ({ what: q.what, t: r2(q.t), total: q.total })),
      lock,
      inv: p.inv.map((v, i) => (i === 0 ? 0 : v)),
      lives: p.lives, heroOut: !!p.heroOut, teamOut: !!T.out, // U26 · U27
      gold: Math.floor(p.gold), core: Math.floor(p.core), made: roundRes(p.made), spent: roundRes(p.spent), given: roundRes(p.given), // 내 지갑(U31)
    };
  }

  teamInfo(T) {
    const job = (J) => (J ? { kind: J.kind, key: J.key, t: r2(J.t), total: J.total } : null);
    const lab = this.buildings.get(T.labId), fac = this.buildings.get(T.facId);
    return {
      t: "team",
      ink: Math.floor(this.teamSum(T.id, "ink")), gold: Math.floor(this.teamSum(T.id, "gold")), core: Math.floor(this.teamSum(T.id, "core")), // 팀원 지갑의 합(U31)
      lab: { lv: T.lab.lv, job: job(T.lab.job), unlocked: T.lab.unlocked.map((v, i) => (v ? i : -1)).filter((i) => i >= 0), research: { ...T.lab.research }, broken: !!(lab && lab.broken) },
      fac: { lv: T.fac.lv, job: job(T.fac.job), research: { ...T.fac.research }, broken: !!(fac && fac.broken), dex: [...T.fac.dex].sort((a, b) => a - b) },
      supplies: this.supplies(T.id, false).length,
      score: this.teams.map((t) => t.score), kos: this.teams.map((t) => t.kos),
    };
  }

  note(slot, text, kind = "info", at) {
    const p = this.players[slot];
    if (p && p.connected && !p.bot) this.send(slot, at ? { t: "note", text, kind, at } : { t: "note", text, kind });
  }
  teamNote(team, text, kind = "info", at) {
    for (const p of this.players) if (p.team === team) this.note(p.slot, text, kind, at);
  }
  allNote(text, kind = "info") {
    for (const p of this.players) this.note(p.slot, text, kind);
  }
  broadcastAll(msg) {
    for (const p of this.players) if (p.connected && !p.bot) this.send(p.slot, msg);
  }

  /** 들어오는(다시 들어오는) 사람에게 주는 처음 정보 */
  startInfo(slot) {
    const p = this.players[slot];
    return {
      t: "start", seed: this.seed, teams: this.nTeams, map: this.kind, mode: this.mode, minutes: this.minutes, goal: GOAL,
      you: slot, team: p ? p.team : -1,
      players: this.players.map((q) => ({ name: q.name, team: q.team, bot: q.bot, char: q.char })),
      crates: this.broken.slice(), quizTitle: this.quizTitle, quizCount: this.quiz.size, time: r2(this.time), phase: this.phase,
      brief: this.phase === PHASE.BRIEF ? this.briefInfo() : null, playTick: this.phase === PHASE.COUNTDOWN ? this.playTick : null,
      out: this.teams.filter((T) => T.out).map((T) => T.id), lives: HERO.LIVES, // U26 · U27
    };
  }

  /** 다시 들어온 사람: 서버가 아는 영웅 위치 · 풀던 문제를 다시 보낸다 */
  syncPlayer(p) {
    p.needSync = false;
    const h = this.heroOf(p.slot);
    p.meDirty = true;
    this.teams[p.team].dirty = true;
    if (!h) return;
    h.vx = h.vy = 0;
    h.mv.at = this.time;
    this.warp(h);
    h.mv.quietUntil = this.time;
    if (h.quiz) {
      h.quiz.botAt = 0;
      this.send(p.slot, { t: "quiz", site: h.quiz.site, q: h.quiz.view, time: r2(Math.max(1, h.quiz.until - this.time)) });
    }
  }

  // ───────────── ⑩ 끝 · 접속 ─────────────
  /** 순위: 남은 팀(점수 → KO) 먼저, 그다음 탈락한 팀(늦게 탈락한 팀이 앞 — U27) */
  ranking() {
    const rows = this.teams.map((T) => ({ team: T.id, score: T.score, kos: T.kos, out: T.out, ...(T.out ? { outReason: T.outReason } : {}), at: T.outAt }));
    rows.sort((a, b) => (a.out - b.out) || (a.out && b.at !== a.at ? b.at - a.at : 0) || b.score - a.score || b.kos - a.kos || a.team - b.team);
    return rows.map(({ at, ...r }) => r);
  }

  finish(reason, winner) {
    if (this.over) return;
    const ranking = this.ranking();
    if (winner == null) {
      // 시간: 남은 팀 가운데 점수 → KO. 가장 앞의 둘이 같으면 무승부(탈락한 팀은 이길 수 없다)
      const [a, b] = ranking;
      winner = a.out ? -1 : b && !b.out && a.score === b.score && a.kos === b.kos ? -1 : a.team;
    }
    this.phase = PHASE.END;
    this.fx = [];
    for (const u of this.units.values()) if (u.type === UTYPE.HERO && u.quiz) this.cancelQuiz(u);
    const result = {
      t: "end", reason, winner, ranking,
      players: this.players.map((p) => ({ slot: p.slot, name: p.name, team: p.team, bot: p.bot, char: p.char, ...p.stats, made: roundRes(p.made), spent: roundRes(p.spent), given: roundRes(p.given) })),
      time: Math.round(Math.max(0, this.time - this.playAt)),
    };
    this.result = result;
    // 마지막 모습 한 장 + 결과
    this.computeVision();
    const wire = this.wireUnits();
    const views = new Map();
    for (const p of this.players) {
      if (!p.connected) continue;
      if (!views.has(p.team)) views.set(p.team, encodeSnapshot(this.viewOf(p.team, wire)));
      this.send(p.slot, views.get(p.team));
      this.send(p.slot, result);
    }
    this.over = true;
    this.onEnd(result);
  }

  setConnected(slot, on) {
    const p = this.players[slot];
    if (!p) return;
    p.connected = on;
    if (this.phase === PHASE.BRIEF) queueMicrotask(() => { if (this.phase === PHASE.BRIEF) this.broadcastAll({ t: "brief", ...this.briefInfo() }); }); // 시작 전: 나가거나 들어오면 준비 수가 바뀐다
    if (!p.humanEver && !p.bot) p.humanEver = true;
    const h = this.heroOf(slot);
    if (on) {
      p.bot = false;
      p.humanEver = true;
      p.needSync = true;
      if (h) { h.input = null; h.jumpAt = 0; }
    } else if (p.humanEver) {
      p.bot = true; // 나간 학생의 자리는 컴퓨터가 잇는다
      p.brain = null;
      if (h) {
        h.vx = h.vy = 0;
        h.kbAcc = null;
        if (h.quiz) h.quiz.botAt = this.time + 2 + this.rand() * 3;
      }
    }
  }
}

// 특기 수치(PERKS) — 이름 · 값
import { PERKS } from "../shared/constants.js";
const MONSTER_PERK_VALUE = { leech: PERKS.leech.value, stun: PERKS.stun.value, sticky: PERKS.sticky.value, siege: PERKS.siege.value };
function PERK_NAME(kind) {
  const k = MONSTERS[kind] && MONSTERS[kind].perk;
  return k && PERKS[k] ? PERKS[k].name : "";
}

// ───────────── 지갑 도우미(U31) ─────────────
const RES_KO = { gold: "골드", core: "코어", ink: "잉크" };
const roundRes = (r) => ({ gold: Math.floor(r.gold), core: Math.floor(r.core), ink: Math.floor(r.ink) });
/** 한글 낱말 끝에 받침이 있으면 a(이 · 을), 없으면 b(가 · 를). 한글이 아니면 "a(b)" */
function wordJosa(word, a, b) {
  const c = String(word).charCodeAt(String(word).length - 1);
  if (!(c >= 0xac00 && c <= 0xd7a3)) return `${a}(${b})`;
  return (c - 0xac00) % 28 ? a : b;
}
/** 수 읽기의 끝소리로 고른 조사(2 · 4 · 5 · 9 로 끝나면 받침 없음 — 이 · 사 · 오 · 구) */
function numJosa(n, a, b) {
  const d = Math.abs(Math.floor(n)) % 10;
  return d === 2 || d === 4 || d === 5 || d === 9 ? b : a;
}
