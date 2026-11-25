// 유닛 두뇌와 컴퓨터 플레이어(docs/DESIGN.md §6 · §9 · §11 · §14). server/game.js 가 부른다.
//
//   unitTick(g, u)            — 일꾼 · 잉크봇 · 내 몬스터 · 중립 몬스터 한 틱(넉백 · 경직은 game.js 가 먼저 처리)
//   updateBots(g)             — 컴퓨터 플레이어의 살림(뽑기 · 사기 · 랩 · 퍼실리티 · 일꾼 나누기)
//   botHeroInput(g, p, h)     — 컴퓨터가 움직이는 영웅의 이번 틱 입력({ mx, my, dash }) — 던지기도 여기서 한다
//
// 몬스터 공격(브로울스 던전 몬스터를 줄인 것): lunge · charge(몸통) · slam · spin(발밑 고리) · shoot(곧은 먹물) · toss(폭탄) · wave(충격파).
// 모든 공격은 미리 알린다(동작 WIND + warn 사건). 중립과 내 몬스터가 같은 코드를 쓴다(상대만 다르다).
import {
  TICK, NEUTRAL, INK, THROW, WEAPONS, WEAPON, MISSILE, HOMING, SLOW, shotInk, chargeTime, flightTime, UTYPE, UNITS, SQUAD,
  MONSTERS, MONSTER_TIERS, PET, hatchCost, NPC, BLD, BUILDINGS, TOWER, REPAIR, LAB, FACILITY, GEM, SITE_STATE, BOT, DELIVER_REACH,
  RES_KINDS, CORE_MINE, canAfford, JUMP, DASH, HERO, BUILD_NEAR, stackMax,
} from "../shared/constants.js";
import { ANIM } from "../shared/protocol.js";
import { findPath, lineClear } from "../shared/path.js";

const TOUCH_CD = 1.0;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const RES_INDEX = { ink: 1, gold: 2, core: 3 };
function rectDist(x, y, tx, ty, w) {
  const dx = Math.max(tx - x, 0, x - (tx + w));
  const dy = Math.max(ty - y, 0, y - (ty + w));
  return Math.hypot(dx, dy);
}
/** u 에서 t(유닛 · 건물)까지 가장자리 거리 */
function edgeDist(u, t) {
  if (t.isBuilding) return rectDist(u.x, u.y, t.tx, t.ty, t.size) - u.radius;
  return Math.hypot(t.x - u.x, t.y - u.y) - u.radius - t.radius;
}
const tx_ = (t) => (t.isBuilding ? t.cx : t.x);
const ty_ = (t) => (t.isBuilding ? t.cy : t.y);

export function unitTick(g, u) {
  switch (u.type) {
    case UTYPE.WORKER: return workerTick(g, u);
    case UTYPE.BOT: return botTick(g, u);
    case UTYPE.PET: return petTick(g, u);
    case UTYPE.NPC: return npcTick(g, u);
  }
}

// ───────────── 일꾼 ─────────────
// 일꾼은 저절로 일하지 않는다(U17): 명령이 없으면(idle · hold) 그 자리에서 기다린다(UF.IDLE — "일 시켜주세요!").
// 캐기는 다른 명령이 올 때까지 되풀이, 옮기기는 닿으면 기다리기, 짓기 · 고치기는 마치면 하던 캐기로 돌아간다
function workerTick(g, u) {
  const o = u.order;
  switch (o.type) {
    case "move":
      if (g.steer(u, o.x, o.y, 0.3) || u.fails > 4) g.setOrder(u, { type: "idle" });
      return;
    case "build": return buildTick(g, u, o);
    case "repair": return repairTick(g, u, o);
    case "attack": return workerAttackTick(g, u, o);
    case "gather": return gatherTick(g, u, o);
    default:
      u.anim = ANIM.IDLE; // idle · hold: 명령을 기다린다
  }
}

/**
 * 일꾼의 근접 공격(U22) — 명령으로만. 다가가 닿으면(가장자리 reach 안) cd 마다 dmg(건물은 × BUILDING_MUL).
 * 상대가 쓰러지거나 · 우리 팀 눈에 3초 넘게 안 보이거나 · 12칸 넘게 멀어지면 그만두고 하던 캐기로(없으면 기다리기)
 */
const WORKER_GIVEUP = { UNSEEN: 3, FAR: 12 };
function workerAttackTick(g, u, o) {
  const M = UNITS.worker.melee;
  const t = g.units.get(o.target) || g.buildings.get(o.target);
  const gone = !t || t.team === u.team || (t.isBuilding ? !g.buildings.has(t.id) || t.down || t.broken : t.dead || !g.units.has(t.id));
  if (gone || Math.hypot(tx_(t) - u.x, ty_(t) - u.y) > WORKER_GIVEUP.FAR) { resumeJob(g, u); return; }
  if (!t.isBuilding && t.quiz) { u.path = null; return; } // 문제를 푸는 상대(U35) — 끝날 때까지 기다린다
  if (!t.isBuilding) {
    if (g.seenBy(u.team, t)) o.seenAt = g.time;
    else if (g.time - (o.seenAt ?? g.time) > WORKER_GIVEUP.UNSEEN) { resumeJob(g, u); return; }
  }
  const x = tx_(t), y = ty_(t);
  if (edgeDist(u, t) <= M.reach) {
    u.path = null;
    u.facing = Math.atan2(y - u.y, x - u.x);
    u.anim = ANIM.ATTACK;
    u.animT = clamp(1 - u.cd / M.cd, 0, 1); // 휘두르는 정도
    if (u.cd <= 0) {
      u.cd = M.cd;
      const src = { team: u.team, unit: u.id, slot: u.owner };
      if (t.isBuilding) {
        const dmg = M.dmg * THROW.BUILDING_MUL;
        g.hurtBuilding(t, dmg, src);
        g.fx.push({ k: "hit", id: 0, dmg: Math.round(dmg), x: Math.round(u.x * 100) / 100, y: Math.round(u.y * 100) / 100, bld: t.id });
      } else g.hurtUnit(t, M.dmg, src); // 맞음 사건 · KO 몫은 hurtUnit 이 맡는다
    }
    return;
  }
  if (t.isBuilding) g.steer(u, 0, 0, M.reach * 0.7, 1, t);
  else g.steer(u, x, y, u.radius + t.radius + M.reach * 0.7);
}

/** 짓기 · 고치기를 마쳤다: 맡았던 캐기로 돌아가고, 없으면 기다린다 */
function resumeJob(g, u) {
  const j = u.job;
  if (j && g.nodes[j.res] && g.nodes[j.res][j.i]) g.setOrder(u, { type: "gather", res: j.res, i: j.i, phase: u.carry > 0 ? "back" : "go" });
  else g.setOrder(u, { type: "idle" });
}

/** 캘 곳 고르기: 오가는 길이 짧고(내려놓을 곳까지) 안전한 곳. 코어 금광은 자리가 차 있어도 기다린다.
 *  다른 팀 본진의 연못 · 금광 · 코어 금광은 고르지 않는다(적 탑 곁으로 걸어 들어가 쓰러진다). 바깥 큰 금광은 누구나 */
function pickNode(g, u, res, avoid = -1) {
  let best = null, bs = -Infinity;
  for (const n of g.nodes[res]) {
    if (n.i === avoid) continue;
    if (n.team >= 0 && n.team !== u.team && !n.rich) continue;
    const drop = g.dropoff(u.team, n.cx, n.cy);
    const dd = drop ? rectDist(n.cx, n.cy, drop.tx, drop.ty, drop.size) : 30;
    const dw = Math.hypot(n.cx - u.x, n.cy - u.y);
    let score = n.amount / (n.time + (2 * dd) / u.speed + (dw / u.speed) * 0.3);
    if (!n.safe) score *= 0.15;
    if (n.team >= 0 && n.team !== u.team) score *= 0.5; // 남의 팀 쪽 큰 금광은 덜
    if (score > bs) { bs = score; best = n; }
  }
  return best;
}

function gatherTick(g, u, o) {
  const node = g.nodes[o.res] && g.nodes[o.res][o.i];
  if (!node) { g.setOrder(u, { type: "idle" }); return; }
  const want = RES_INDEX[o.res];
  if (u.carry > 0 && (o.phase === "back" || u.carryRes !== want || u.carry >= node.amount)) o.phase = "back";
  if (o.phase === "back") {
    if (u.carry <= 0) { o.phase = "go"; return; }
    const drop = g.dropoff(u.team, u.x, u.y);
    if (!drop) return;
    if (rectDist(u.x, u.y, drop.tx, drop.ty, drop.size) - u.radius <= DELIVER_REACH) {
      // 캔 것은 일꾼 주인의 지갑으로(U31 — 누가 지은 공급소에 내려놓든)
      const key = RES_KINDS[u.carryRes - 1];
      const p = g.players[u.owner];
      if (p) { g.earn(p, key, u.carry); p.stats[key] += u.carry; }
      u.carry = 0;
      u.carryRes = 0;
      o.phase = "go";
      u.path = null;
      // 더 나은 곳이 생겼으면(전진 공급소 등) 옮긴다
      const better = pickNode(g, u, o.res);
      if (better && better !== node) { o.i = better.i; if (u.job) u.job.i = better.i; }
      return;
    }
    g.steer(u, 0, 0, DELIVER_REACH * 0.8, 1, drop);
    if (u.fails > 6) { u.fails = 0; u.path = null; }
    return;
  }
  const d = rectDist(u.x, u.y, node.tx, node.ty, node.size) - u.radius;
  if (d <= node.reach) {
    u.path = null;
    u.facing = Math.atan2(node.cy - u.y, node.cx - u.x);
    if (!g.claimSlot(u, node)) { u.anim = ANIM.IDLE; u.work = 0; return; } // 코어 금광 자리가 차 있다 — 기다린다
    u.anim = ANIM.GATHER;
    u.work += TICK;
    u.animT = clamp(u.work / node.time, 0, 1);
    if (u.work >= node.time) {
      u.work = 0;
      u.carry = node.amount;
      u.carryRes = want;
      o.phase = "back";
      u.anim = ANIM.IDLE; // 다 캤다 — 같은 틱에 기다리던 일꾼이 자리를 이어받는다
      g.releaseSlot(u);
    }
    return;
  }
  u.work = 0;
  g.steer(u, 0, 0, node.reach * 0.8, 1, node);
  if (u.fails > 4) {
    // 못 가면 다른 곳(우리 것 · 바깥 큰 금광). 없으면 그 자리에서 길을 다시 찾는다(멈추지 않게)
    const other = pickNode(g, u, o.res, node.i);
    if (other) { o.i = other.i; if (u.job) u.job.i = other.i; }
    u.fails = 0; u.path = null;
  }
}

function buildTick(g, u, o) {
  const b = g.buildings.get(o.b);
  if (!b || b.team !== u.team) { resumeJob(g, u); return; }
  if (b.built) { if (b.hp < b.maxHp) g.setOrder(u, { type: "repair", b: b.id }); else resumeJob(g, u); return; }
  if (rectDist(u.x, u.y, b.tx, b.ty, b.size) - u.radius <= REPAIR.REACH) {
    u.path = null;
    u.anim = ANIM.BUILD;
    u.animT = b.progress;
    u.facing = Math.atan2(b.cy - u.y, b.cx - u.x);
    b.builders++;
    return;
  }
  g.steer(u, 0, 0, REPAIR.REACH * 0.8, 1, b);
  if (u.fails > 6) resumeJob(g, u);
}

function repairTick(g, u, o) {
  const b = g.buildings.get(o.b);
  if (!b || b.team !== u.team || b.down || (b.hp >= b.maxHp && !b.broken)) { resumeJob(g, u); return; }
  if (!b.built) { g.setOrder(u, { type: "build", b: b.id }); return; }
  if (rectDist(u.x, u.y, b.tx, b.ty, b.size) - u.radius <= REPAIR.REACH) {
    u.path = null;
    u.anim = ANIM.BUILD;
    u.animT = b.hp / b.maxHp;
    u.facing = Math.atan2(b.cy - u.y, b.cx - u.x);
    b.hp = Math.min(b.maxHp, b.hp + REPAIR.RATE * TICK);
    return;
  }
  g.steer(u, 0, 0, REPAIR.REACH * 0.8, 1, b);
  if (u.fails > 6) resumeJob(g, u);
}

// ───────────── 싸우는 유닛(잉크봇 · 내 몬스터) ─────────────
function validTarget(g, u, t) {
  if (!t) return false;
  if (t.isBuilding) return g.buildings.has(t.id) && t.team !== u.team && !t.down && !t.broken && t.built !== undefined;
  return !t.dead && !t.quiz && g.units.has(t.id) && t.team !== u.team && g.seenBy(u.team, t); // 문제를 푸는 영웅은 노리지 않는다(U35)
}

/** 명령에 따라 칠 상대를 고른다(없으면 null) */
function fighterTarget(g, u) {
  const o = u.order;
  if (o.type === "attack") {
    const t = g.units.get(o.target) || g.buildings.get(o.target);
    if (t && !t.isBuilding && !t.dead && t.quiz) return null; // 문제를 푸는 중(U35) — 명령은 남겨 두고 끝나면 다시 친다
    if (validTarget(g, u, t)) return t;
    g.setOrder(u, { type: "idle" });
    return null;
  }
  if (o.type === "move" || o.type === "grab" || o.type === "deliver") return null;
  // 목표는 0.3초마다 다시 고른다
  if (u.tgtAt && g.time - u.tgtAt < 0.3) {
    const t = u.tgt ? g.units.get(u.tgt) : null;
    if (!u.tgt || validTarget(g, u, t)) return t || null;
  }
  u.tgtAt = g.time;
  u.tgt = 0;
  let t = null;
  if (o.type === "follow") {
    const h = g.heroOf(u.owner);
    if (!h || h.dead) return null;
    const a = h.assist && g.time - h.assistAt < 3 ? g.units.get(h.assist) : null;
    if (validTarget(g, u, a) && Math.hypot(a.x - h.x, a.y - h.y) <= SQUAD.ASSIST + 4) t = a;
    else {
      const b = g.time - u.lastHitUnitAt < 2 ? g.units.get(u.lastHitUnit) : null;
      if (validTarget(g, u, b) && Math.hypot(b.x - u.x, b.y - u.y) <= SQUAD.GUARD) t = b;
    }
  } else {
    // 그냥 두었거나 지키는 중: 자리에서 SQUAD.GUARD 안의 적(중립은 우리를 노리거나 우리를 친 것만)
    if (Math.hypot(u.x - u.anchor.x, u.y - u.anchor.y) > SQUAD.LEASH) return null;
    let bd = SQUAD.GUARD;
    for (const e of g.hash.query(u.x, u.y, SQUAD.GUARD + 1)) {
      if (e.dead || e.quiz || e.team === u.team || !g.seenBy(u.team, e)) continue;
      if (e.type === UTYPE.NPC) {
        const et = e.target && g.units.get(e.target);
        if (!(et && et.team === u.team) && !(u.lastHitUnit === e.id && g.time - u.lastHitUnitAt < 3)) continue;
      }
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d < bd) { bd = d; t = e; }
    }
  }
  if (t) u.tgt = t.id;
  return t;
}

/** 명령대로 움직인다(싸울 상대가 없을 때) */
function moveByOrder(g, u) {
  const o = u.order;
  switch (o.type) {
    case "follow": {
      const h = g.heroOf(u.owner);
      if (!h) { g.setOrder(u, { type: "idle" }); return; }
      const owner = g.players[u.owner];
      if (owner && owner.heroOut) { g.setOrder(u, { type: "hold" }); return; } // 영웅이 다시 나오지 않는다(U26) — 그 자리를 지킨다
      if (h.dead) {
        // 영웅이 쓰러지면 탑으로 돌아가 기다린다
        const base = g.map.bases[u.team];
        g.steer(u, base.spawn.x, base.spawn.y, 1.6);
        return;
      }
      const list = g.squads.get(u.owner) || [u];
      const k = Math.max(0, list.indexOf(u)), n = list.length;
      const back = h.moveDir + Math.PI;
      const spread = n <= 1 ? 0 : Math.min(Math.PI * 0.85, 0.5 * (n - 1));
      const a = back + (n <= 1 ? 0 : -spread / 2 + (spread * k) / (n - 1));
      const ring = 1.25 + 0.55 * Math.floor(k / 5) + u.radius * 0.5;
      const gx = h.x + Math.cos(a) * ring, gy = h.y + Math.sin(a) * ring;
      const far = Math.hypot(h.x - u.x, h.y - u.y);
      g.steer(u, gx, gy, 0.35, far > 3 ? 1.25 : 1);
      if (far < 3 && u.anim !== ANIM.MOVE) u.facing = h.facing;
      return;
    }
    case "move":
      if (g.steer(u, o.x, o.y, 0.3) || u.fails > 4) g.setOrder(u, { type: "hold" });
      return;
    case "grab": {
      const gem = g.gems.get(o.gem);
      if (!gem || gem.state === 1) { g.setOrder(u, { type: "idle" }); return; }
      g.steer(u, gem.x, gem.y, 0.15);
      if (u.fails > 5) g.setOrder(u, { type: "idle" });
      return;
    }
    case "deliver": {
      if (u.gem < 0) { g.setOrder(u, u.prevOrder || { type: "idle" }); return; }
      const tw = g.tower(u.team);
      if (tw) g.steer(u, 0, 0, 0.4, 1, tw);
      return;
    }
    case "attack": {
      const t = g.units.get(o.target);
      if (t && !t.dead && t.quiz) return; // 문제를 푸는 상대(U35) — 그 자리에서 기다린다
      g.setOrder(u, { type: "idle" });
      return;
    }
    default: {
      const d = Math.hypot(u.x - u.anchor.x, u.y - u.anchor.y);
      if (d > 0.6) g.steer(u, u.anchor.x, u.anchor.y, 0.4, 0.9);
    }
  }
}

function botTick(g, u) {
  const o = u.order;
  const T = g.teams[u.team];
  if (u.gem >= 0 && o.type !== "move" && o.type !== "hold" && o.type !== "deliver") {
    u.prevOrder = o.type === "grab" ? { type: "idle" } : o;
    g.setOrder(u, { type: "deliver" });
  }
  // 탱크가 비면 공급소에 다녀온다(붙잡아 둔 동안 · 보석을 든 동안은 빼고)
  const shot = shotInk(0, false, T.lab.research);
  const ownerInk = g.players[u.owner] ? g.players[u.owner].ink : 0; // 잉크봇은 주인 지갑의 잉크로 채운다(U31)
  if (!u.refillTrip && u.tank < shot && o.type !== "hold" && o.type !== "move" && u.gem < 0 && ownerInk > 1) u.refillTrip = true;
  if (u.refillTrip) {
    const sup = g.nearestSupply(u.team, u.x, u.y);
    if (!sup || u.tank >= INK.BOT_TANK * 0.95 || ownerInk <= 1 || u.gem >= 0) u.refillTrip = false;
    else {
      if (!g.steer(u, 0, 0, INK.REFILL_REACH * 0.6, 1, sup)) return;
      u.anim = ANIM.IDLE;
      return;
    }
  }
  const t = u.gem >= 0 && !GEM.CARRY_ATTACK[g.mode] ? null : fighterTarget(g, u);
  if (t) { rangedEngage(g, u, t); return; }
  moveByOrder(g, u);
}

function rangedEngage(g, u, t) {
  const B = UNITS.bot;
  const d = edgeDist(u, t);
  const T = g.teams[u.team];
  const shot = shotInk(0, false, T.lab.research);
  if (d <= B.range) {
    u.path = null;
    const x = tx_(t), y = ty_(t);
    u.facing = Math.atan2(y - u.y, x - u.x);
    if (u.cd <= 0 && u.tank >= shot) {
      const dist = Math.hypot(x - u.x, y - u.y);
      const ft = flightTime(dist, false);
      const lead = t.isBuilding ? 0 : 0.5 + g.rand() * 0.4;
      let ax = x + (t.vxe || 0) * ft * lead + (g.rand() - 0.5) * BOT.AIM_ERR;
      let ay = y + (t.vye || 0) * ft * lead + (g.rand() - 0.5) * BOT.AIM_ERR;
      const ad = Math.hypot(ax - u.x, ay - u.y);
      const max = B.range + 0.6;
      if (ad > max) { ax = u.x + ((ax - u.x) / ad) * max; ay = u.y + ((ay - u.y) / ad) * max; }
      g.launchArc({ team: u.team, unit: u.id, slot: u.owner }, 0, false, u.x, u.y, THROW.HAND * 0.75, ax, ay, {
        dmgMul: B.dmg * (T.lab.research.power ? 1.15 : 1),
      });
      g.fx.push({ k: "throw", id: u.id, x: u.x, y: u.y, team: u.team });
      u.tank -= shot;
      u.cd = B.cd;
      u.lastThrowAt = g.time;
    }
    u.anim = g.time - (u.lastThrowAt || -9) < 0.3 ? ANIM.THROW : ANIM.IDLE;
    return;
  }
  if (t.isBuilding) g.steer(u, 0, 0, B.range - 0.5, 1, t);
  else g.steer(u, t.x, t.y, B.range - 0.6);
  if (u.fails > 6 && u.order.type === "attack") g.setOrder(u, { type: "idle" });
}

function petTick(g, u) {
  const T = g.teams[u.team];
  // 회복 둥지: 우리 건물 곁에서 체력이 찬다
  if (T.fac.research.nest && u.hp < u.maxHp && (g.tickNo + u.id) % 10 === 0) {
    for (const b of g.buildings.values()) {
      if (b.team !== u.team) continue;
      if (rectDist(u.x, u.y, b.tx, b.ty, b.size) <= FACILITY.NEST_R) { u.hp = Math.min(u.maxHp, u.hp + u.maxHp * FACILITY.NEST_RATE * TICK * 10); break; }
    }
  }
  if (u.st !== "live") { monsterFight(g, u, fighterTarget(g, u)); return; }
  const t = fighterTarget(g, u);
  if (t) { monsterFight(g, u, t); return; }
  moveByOrder(g, u);
}

// ───────────── 중립 몬스터 ─────────────
function npcTick(g, m) {
  const home = m.home;
  // 섹션 지킴이(U21): 섹션을 친 상대를 끈(섹션 가운데에서 m.defend.leash) 안에서 쫓는다 — 평소 공격(미리 알림)을 그대로 쓴다.
  // 상대가 쓰러지거나 끈 밖으로 나가거나, 섹션을 한동안(GUARD.CALM) 아무도 안 치면 집으로
  const D = m.defend;
  if (D) {
    const s = D.site;
    const t = g.units.get(D.target);
    const off = (x, y) => Math.hypot(x - s.x, y - s.y);
    if (!s.def || g.time > s.def.until || !t || t.dead || t.quiz || off(t.x, t.y) > D.leash || off(m.x, m.y) > D.leash + 2) {
      m.defend = null;
      m.target = 0;
      if (m.st === "live") { m.homing = true; return; }
      monsterFight(g, m, null);
      return;
    }
    m.homing = false;
    m.target = t.id;
    monsterFight(g, m, t);
    return;
  }
  if (m.homing) {
    m.hp = Math.min(m.maxHp, m.hp + m.maxHp * NPC.REGEN * TICK);
    if (g.steer(m, home.x, home.y, 0.5) || m.fails > 6) { m.homing = false; m.hp = m.maxHp; m.target = 0; m.fails = 0; }
    return;
  }
  let t = m.target ? g.units.get(m.target) : null;
  if (t && (t.dead || t.quiz || t.team === NEUTRAL)) { t = null; m.target = 0; }
  const homeD = Math.hypot(m.x - home.x, m.y - home.y);
  if (t && (homeD > NPC.LEASH || Math.hypot(t.x - home.x, t.y - home.y) > NPC.LEASH + 3)) {
    m.target = 0;
    if (m.st === "live") { m.homing = true; return; }
    t = null;
  }
  if (!t && m.st === "live" && (g.tickNo + m.id) % 5 === 0) {
    let bd = NPC.AGGRO;
    for (const e of g.hash.query(m.x, m.y, NPC.AGGRO + 1)) {
      if (e.dead || e.quiz || e.team === NEUTRAL) continue;
      const d = Math.hypot(e.x - m.x, e.y - m.y) - e.radius;
      if (d < bd && Math.hypot(e.x - home.x, e.y - home.y) < NPC.LEASH) { bd = d; t = e; }
    }
    if (t) g.aggro(m, t);
  }
  if (t || m.st !== "live") { monsterFight(g, m, t); return; }
  if (homeD > 0.6) g.steer(m, home.x, home.y, 0.4, 0.6);
  else if (m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * NPC.REGEN * 0.5 * TICK);
}

// ───────────── 몬스터 싸움(중립 · 내 몬스터 같은 코드) ─────────────
function canUse(a, d) {
  switch (a.type) {
    case "slam": case "spin": return d < a.r * 0.85;
    case "lunge": return d < a.range && d > 0.5;
    case "charge": return d < a.range && d > 1.2;
    case "wave": return d < a.range && d > 0.8;
    default: return d < a.range; // shoot · toss
  }
}

function monsterFight(g, m, t) {
  const M = MONSTERS[m.kind];
  if (m.touchCd > 0) m.touchCd -= TICK;
  if (t && !t.isBuilding && t.dead) t = null;
  if (m.st === "wind") {
    const a = m.act;
    if (t && (a.type === "shoot" || a.type === "toss")) { m.aim = { x: tx_(t), y: ty_(t) }; m.facing = Math.atan2(m.aim.y - m.y, m.aim.x - m.x); }
    m.t -= TICK;
    m.anim = ANIM.WIND;
    m.animT = clamp(1 - m.t / a.wind, 0, 1);
    if (m.t <= 0) release(g, m, a, t);
    return;
  }
  if (m.st === "dash") { dashStep(g, m, t); return; }
  if (m.st === "stun") {
    m.stunT -= TICK;
    m.anim = ANIM.STUN;
    if (m.stunT <= 0) m.st = "live";
    return;
  }
  if (!t) return;
  const d = edgeDist(m, t);
  const x = tx_(t), y = ty_(t);
  m.facing = Math.atan2(y - m.y, x - m.x);
  if (g.time >= m.gcd) {
    for (const s of m.attacks) {
      if (g.time >= s.at && canUse(s.a, d)) { windUp(g, m, s, t); return; }
    }
  }
  // 쫓기 · 거리 두기(고블린 · 오징어)
  if (M.keep && d < M.keep && !t.isBuilding) {
    g.walkDir(m, m.x - x, m.y - y, g.unitSpeed(m) * 0.8 * TICK);
    m.facing = Math.atan2(y - m.y, x - m.x);
    m.anim = ANIM.MOVE;
    m.want = g.unitSpeed(m) * 0.8 * TICK;
  } else if (!(M.keep && d < M.keep + 1.2) && d > 0.12) {
    if (t.isBuilding) g.steer(m, 0, 0, 0.1, 1, t);
    else g.steer(m, x, y, m.radius + t.radius + 0.05);
    m.facing = Math.atan2(y - m.y, x - m.x);
  }
  // 몸으로 치기
  if (edgeDist(m, t) <= 0.3 && m.touchCd <= 0) {
    m.touchCd = TOUCH_CD;
    hitTarget(g, m, t, M.touch, M.kb);
    m.anim = ANIM.ATTACK;
    m.attackAt = g.time;
  }
  if (g.time - m.attackAt < 0.3) m.anim = ANIM.ATTACK;
}

function hitTarget(g, m, t, dmg, kb) {
  if (t.isBuilding) {
    if (m.team === NEUTRAL) return;
    g.hurtBuilding(t, dmg * THROW.BUILDING_MUL * (m.dmgMul || 1), { team: m.team, unit: m.id, slot: m.owner });
    return;
  }
  g.monsterHitUnit(m, t, dmg, kb);
}

function windUp(g, m, s, t) {
  const a = s.a;
  m.st = "wind";
  m.act = a;
  m.t = a.wind;
  m.aim = { x: tx_(t), y: ty_(t) };
  s.at = g.time + a.every * (0.85 + g.rand() * 0.3);
  m.anim = ANIM.WIND;
  m.animT = 0;
  m.path = null;
  if (a.type === "slam" || a.type === "spin") g.telegraph(m.x, m.y, a.r + m.radius * 0.3, a.wind, "ring", a.type === "slam");
  else if (a.type === "wave") {
    g.telegraph(m.x, m.y, a.r, a.wind, "wave", false);
    // 충격파가 닿을 때 컴퓨터 영웅이 뛰어오른다
    for (const u of g.hash.query(m.x, m.y, a.r + 1)) {
      if (u.type !== UTYPE.HERO || u.dead || u.team === m.team || g.isHumanHero(u)) continue;
      const d = Math.hypot(u.x - m.x, u.y - m.y);
      if (d <= a.r) u.jumpAt = g.time + a.wind + Math.max(0, d - m.radius) / a.speed - 0.15;
    }
  }
}

function release(g, m, a, t) {
  m.st = "live";
  m.gcd = g.time + 0.7;
  m.attackAt = g.time;
  m.anim = ANIM.ATTACK;
  const src = { team: m.team, unit: m.id, slot: m.owner };
  const aim = t ? { x: tx_(t), y: ty_(t) } : m.aim || { x: m.x + Math.cos(m.facing) * 3, y: m.y + Math.sin(m.facing) * 3 };
  switch (a.type) {
    case "slam":
    case "spin": {
      const r = a.r + m.radius * 0.3;
      g.fx.push({ k: "slam", x: Math.round(m.x * 100) / 100, y: Math.round(m.y * 100) / 100, r, ...(a.type === "spin" ? { spin: 1 } : {}) });
      g.monsterArea(m, m.x, m.y, r, a.dmg, a.kb, { grounded: a.type === "slam", slam: true });
      return;
    }
    case "shoot": {
      const n = Math.max(1, a.count | 0);
      const base = Math.atan2(aim.y - m.y, aim.x - m.x);
      m.facing = base;
      for (let i = 0; i < n; i++) {
        const ang = base + (n > 1 ? a.spread * (i / (n - 1) - 0.5) : 0);
        g.projs.push({
          id: g.newProjId(), kind: 100 + m.kind, team: m.team, src, mon: m, x: m.x + Math.cos(ang) * m.radius, y: m.y + Math.sin(ang) * m.radius,
          dir: ang, speed: a.speed, left: a.speed * a.life, life: a.life, age: 0, pierced: 0, monster: true, dmg: a.dmg, kb: a.kb, r: a.r, sticky: true,
        });
      }
      return;
    }
    case "toss": {
      const n = Math.max(1, a.count | 0) * (m.perk === "double" ? 2 : 1);
      const lead = t && !t.isBuilding ? a.fly * 0.5 : 0;
      const cx = aim.x + (t ? (t.vxe || 0) * lead : 0), cy = aim.y + (t ? (t.vye || 0) * lead : 0);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const ang = g.rand() * Math.PI * 2;
        const rr = i === 0 ? 0 : (a.scatter || 1.1) * (0.45 + 0.55 * g.rand());
        let px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
        const dd = Math.hypot(px - m.x, py - m.y);
        if (dd > a.range + 1) { px = m.x + ((px - m.x) / dd) * (a.range + 1); py = m.y + ((py - m.y) / dd) * (a.range + 1); }
        pts.push([clamp(px, 0.5, g.S - 0.5), clamp(py, 0.5, g.S - 0.5)]);
      }
      g.zones.push({ pts, r: a.r, at: g.time + a.fly, dmg: a.dmg, kb: a.kb, mon: m.id, team: m.team, owner: m.owner, dmgMul: m.dmgMul || 1 });
      for (const [px, py] of pts) g.telegraph(px, py, a.r, a.fly, "ring", true);
      return;
    }
    case "wave":
      g.waves.push({ x: m.x, y: m.y, r: m.radius * 0.6, v: a.speed, max: a.r, w: a.w, dmg: a.dmg, kb: a.kb, mon: m.id, team: m.team, owner: m.owner, dmgMul: m.dmgMul || 1, hit: new Set() });
      g.fx.push({ k: "slam", x: Math.round(m.x * 100) / 100, y: Math.round(m.y * 100) / 100, r: a.r, wave: a.speed });
      return;
    case "lunge":
    case "charge": {
      m.st = "dash";
      m.dashA = a;
      m.dashT = a.time;
      m.dashSpeed = MONSTERS[m.kind].speed * a.mul;
      m.dashHit = new Set();
      m.facing = Math.atan2(aim.y - m.y, aim.x - m.x);
    }
  }
}

function dashStep(g, m, t) {
  const a = m.dashA;
  const M = MONSTERS[m.kind];
  m.dashT -= TICK;
  m.anim = ANIM.ATTACK;
  const sp = m.dashSpeed * (m.slow > 0 ? SLOW.FACTOR : 1);
  const cx = Math.cos(m.facing), cy = Math.sin(m.facing);
  const ox = m.x, oy = m.y;
  g.moveBy(m, cx * sp * TICK, cy * sp * TICK);
  m.want = sp * TICK;
  const src = { team: m.team, unit: m.id, slot: m.owner };
  const siege = m.perk === "siege" ? 2 : 1;
  // 부딪힘: 돌진은 길 위의 모든 적, 달려들기는 노린 상대만
  const list = a.type === "charge" ? g.hash.query(m.x, m.y, m.radius + 1.5) : t && !t.isBuilding ? [t] : [];
  for (const e of [...list]) {
    if (e.dead || e.team === m.team || m.dashHit.has(e.id) || (e.z || 0) > 1.2) continue;
    if (Math.hypot(e.x - m.x, e.y - m.y) > m.radius + e.radius + 0.15) continue;
    m.dashHit.add(e.id);
    if (a.type === "charge") g.monsterHitUnit(m, e, a.dmg, a.kb);
    else { g.monsterHitUnit(m, e, M.touch, M.kb * 1.3); m.touchCd = TOUCH_CD; m.dashT = Math.min(m.dashT, 0.05); }
  }
  if (m.team !== NEUTRAL) {
    // 내 몬스터는 건물 · 방어막에도 부딪힌다(멧돼지 특기 × 2)
    const fx = m.x + cx * (m.radius + 0.35), fy = m.y + cy * (m.radius + 0.35);
    if (fx >= 0 && fy >= 0 && fx < g.S && fy < g.S) {
      const b = g.buildings.get(g.bldAt[Math.floor(fy) * g.S + Math.floor(fx)]);
      if (b && b.team !== m.team && !m.dashHit.has("b" + b.id)) {
        m.dashHit.add("b" + b.id);
        g.hurtBuilding(b, (a.type === "charge" ? a.dmg : M.touch) * THROW.BUILDING_MUL * (m.dmgMul || 1) * (a.type === "charge" ? siege : 1), src);
      }
    }
    for (const s of g.sites) {
      if (m.dashHit.has("s" + s.id) || s.state !== SITE_STATE.SHIELD) continue;
      if (Math.hypot(s.x - m.x, s.y - m.y) > GEM.SHIELD_R + m.radius) continue;
      m.dashHit.add("s" + s.id);
      g.hurtSite(s, (a.type === "charge" ? a.dmg : M.touch) * THROW.BUILDING_MUL * (m.dmgMul || 1) * (a.type === "charge" ? siege : 1), src);
    }
  }
  const prog = (m.x - ox) * cx + (m.y - oy) * cy;
  if (prog < sp * TICK * 0.5) {
    m.dashT = 0;
    if (a.type === "charge") { m.st = "stun"; m.stunT = a.stun || 1.5; return; } // 벽에 박았다 — 기절
  }
  if (m.dashT <= 0) m.st = "live";
}

// ───────────── 컴퓨터 플레이어 ─────────────
const LAB_PLAN = [
  ["unlock", "missile"], ["unlock", "triple"], ["level"], ["research", "thrift"], ["unlock", "homing"], ["unlock", "mega"],
  ["research", "siege"], ["unlock", "firework"], ["level"], ["unlock", "drill"], ["research", "long"], ["unlock", "bomb"],
  ["research", "power"], ["unlock", "sticky"], ["unlock", "vortex"], ["research", "quick"],
];
const FAC_PLAN = [["level-fac"], ["research", "nest"], ["research", "wild"], ["level-fac"]];

export function updateBots(g) {
  for (const p of g.players) {
    if (!p.bot || g.teams[p.team].out) continue; // 탈락한 팀은 쉰다(U27)
    if ((g.tickNo + p.slot * 3) % 20 === 0) economy(g, p);
  }
  for (const T of g.teams) {
    if (T.out || (g.tickNo + T.id * 7) % 40 !== 0) continue;
    const bots = g.players.filter((p) => p.bot && p.team === T.id);
    if (bots.length) teamPlan(g, T, bots);
  }
}

function labCost(T, step) {
  const [act, key] = step;
  if (act === "unlock") {
    const w = WEAPON[key];
    if (T.lab.unlocked[w]) return null;
    const W = WEAPONS[w];
    return W.tier <= T.lab.lv ? W.unlock : false;
  }
  if (act === "level") return T.lab.lv < LAB.MAX_LEVEL ? LAB.LEVELS[T.lab.lv + 1] : null;
  const R = LAB.RESEARCH.find((r) => r.key === key);
  if (!R || T.lab.research[key]) return null;
  return R.tier <= T.lab.lv ? R : false;
}

function facCost(T, step) {
  const [act, key] = step;
  if (act === "level-fac") return T.fac.lv < FACILITY.MAX_LEVEL ? FACILITY.LEVELS[T.fac.lv + 1] : null;
  const R = FACILITY.RESEARCH.find((r) => r.key === key);
  if (!R || T.fac.research[key]) return null;
  return R.tier <= T.fac.lv ? R : false;
}

/** 팀 살림(랩 · 퍼실리티) — 팀의 첫 컴퓨터(대표)가 자기 지갑으로 낸다(U31). 사람이 있는 팀에서는 골드가 넉넉할 때만 */
function teamPlan(g, T, bots) {
  const human = g.players.some((p) => p.team === T.id && !p.bot && p.connected);
  const spare = human ? 250 : 40;
  const lead = bots[0];
  const workersFull = bots.every((p) => g.workerCount(p.slot, "worker") >= 4);
  const lab = g.buildings.get(T.labId);
  if (!T.lab.job && lab && !lab.broken) {
    for (const step of LAB_PLAN) {
      const c = labCost(T, step);
      if (c === null) continue; // 이미 했다
      if (c === false) break; // 단계가 모자라다 — 앞의 단계 올리기를 기다린다
      const unlocks = T.lab.unlocked.filter(Boolean).length;
      const reserve = !workersFull && unlocks > 1 ? 60 + spare : spare;
      if ((c.gold || 0) + reserve <= lead.gold && (c.core || 0) <= lead.core) g.labAct(lead, step[0], step[1]);
      break;
    }
  }
  const fac = g.buildings.get(T.facId);
  if (!T.fac.job && fac && !fac.broken && T.lab.unlocked.filter(Boolean).length >= 3) {
    for (const step of FAC_PLAN) {
      const c = facCost(T, step);
      if (c === null) continue;
      if (c === false) break;
      if ((c.gold || 0) + spare + 120 <= lead.gold) g.facAct(lead, step[0], step[1]);
      break;
    }
  }
}

/** 한 컴퓨터의 살림: 일꾼 · 잉크봇 · 몬스터 · 일꾼 나누기 · 고치기 · 전진 공급소 */
function economy(g, p) {
  const T = g.teams[p.team];
  if (p.botBuild) botBuildTick(g, p);
  const tower = g.tower(p.team);
  const workers = g.workerCount(p.slot, "worker");
  const bots = g.workerCount(p.slot, "bot");
  const unlocks = T.lab.unlocked.filter(Boolean).length;
  // 코어 순서(§14): 잉크봇 하나 → 작은 몬스터 → 잉크봇 둘째. 잉크봇을 한 번 산 뒤 몬스터가 없으면
  // 잉크봇을 다시 사기 전에 몬스터 값(작은 급)만큼은 코어를 남긴다
  const wantBots = p.pet.state === "none" ? 1 : 2;
  const savePet = p.pet.state === "none" && (p.botsBought || 0) >= 1 ? MONSTER_TIERS[0].hatch.core : 0;
  if (tower && !tower.down && p.queue.length < 2) {
    if (workers < UNITS.worker.cap && p.gold >= UNITS.worker.train.gold + 20) g.train(p, "worker");
    else if (unlocks > 1 && bots < wantBots && p.core >= UNITS.bot.train.core + savePet) {
      const n = p.queue.length;
      g.train(p, "bot");
      if (p.queue.length > n) p.botsBought = (p.botsBought || 0) + 1;
    }
  }
  // 몬스터(코어): 잉크봇 하나를 산 뒤 작은 것부터
  const fac = g.buildings.get(T.facId);
  if (p.pet.state === "none" && fac && !fac.broken && (bots >= 1 || p.core >= 30)) {
    let pick = -1, best = -1;
    for (const M of MONSTERS) {
      if (M.tier > T.fac.lv - 1) continue;
      const c = hatchCost(M.kind, T.fac.dex.has(M.kind));
      if (c.core > p.core) continue;
      const v = M.tier * 10 + (T.fac.dex.has(M.kind) ? 2 : 0) + g.rand();
      if (v > best) { best = v; pick = M.kind; }
    }
    if (pick >= 0) g.facAct(p, "hatch", pick);
  } else if (p.pet.state === "alive" && p.pet.level < PET.PERK_LEVEL) {
    const c = PET.LEVELS[p.pet.level + 1];
    if (p.gold >= (c.gold || 0) + 200 && p.core >= (c.core || 0) + 10) g.facAct(p, "level");
  }
  // 잉크봇 · 몬스터는 늘 영웅 분대로. 영웅이 목숨을 다 썼으면(U26) 탑 앞으로 가서 지킨다
  const base = g.map.bases[p.team];
  for (const u of g.units.values()) {
    if (u.owner !== p.slot || u.dead || (u.type !== UTYPE.BOT && u.type !== UTYPE.PET)) continue;
    if (p.heroOut) {
      if (u.order.type === "follow" || u.order.type === "idle") g.setOrder(u, { type: "move", x: base.spawn.x + ((u.id % 5) - 2) * 0.7, y: base.spawn.y + ((u.id % 3) - 1) * 0.7 });
    } else if (u.order.type !== "follow" && u.order.type !== "deliver" && u.order.type !== "grab") g.setOrder(u, { type: "follow" });
  }
  assignWorkers(g, p, T);
  // 고장 · 크게 다친 건물 고치기(둘레에 적이 없을 때). 깃발의 탑은 부서지면 팀 탈락(U27)이라 60% 아래면 적이 있어도 셋까지
  for (const b of g.buildings.values()) {
    if (b.team !== p.team || !b.built || b.down) continue;
    if (!(b.broken || b.hp < b.maxHp * 0.5)) continue;
    const critical = b.kind === BLD.TOWER && b.hp < b.maxHp * 0.6;
    if (!critical && enemiesNear(g, p.team, b.cx, b.cy, 7)) continue;
    let fixing = 0;
    for (const u of g.units.values()) if (u.team === p.team && u.type === UTYPE.WORKER && u.order.type === "repair" && u.order.b === b.id) fixing++;
    if (fixing >= (critical ? 3 : 2)) continue;
    const w = nearestWorker(g, p.slot, b.cx, b.cy);
    if (w) g.setOrder(w, { type: "repair", b: b.id });
    break;
  }
  const lead = g.players.find((q) => q.bot && q.team === p.team);
  const supCost = BUILDINGS[BLD.SUPPLY].build.gold;
  // 공급소가 하나도 없으면(모두 무너짐) 본진에 다시 짓는다 — 탱크를 못 채우면 싸울 수 없다(팀의 첫 컴퓨터만)
  if (lead === p && tower && g.supplies(p.team, false).length === 0 && p.gold >= supCost) {
    const base = g.map.bases[p.team];
    const size = BUILDINGS[BLD.SUPPLY].size;
    const spot = g.canPlace(base.supply.tx, base.supply.ty, size) ? base.supply : findSupplySpot(g, tower);
    const w = nearestWorker(g, p.slot, tower.cx, tower.cy);
    if (spot && w && !p.botBuild) botBuildSupply(g, p, spot, w);
  }
  buyPacks(g, p, T, workers, lead === p);
  // 팀 랩 · 퍼실리티는 대표 컴퓨터가 낸다(U31) — 다른 컴퓨터는 골드가 넉넉하고 대표가 모자라면 대표에게 보낸다
  if (lead && lead !== p && (p.giveAt || 0) <= g.time) {
    const need = nextLabGold(T) + 120;
    const keep = 200 + (workers < UNITS.worker.cap ? UNITS.worker.train.gold : 0);
    if (lead.gold < need && p.gold > keep + 40) {
      const amount = Math.floor(Math.min(p.gold - keep, need - lead.gold, 300));
      if (amount >= 20 && g.give(p, { to: lead.slot, res: "gold", amount })) p.giveAt = g.time + 8;
    }
  }
  // 전진 공급소(팀의 첫 컴퓨터만): 큰 금광이 안전해지면 곁에
  if (lead === p && unlocks >= 2 && g.supplies(p.team, false).length < 2 && p.gold >= supCost + 150) {
    const rich = g.nodes.gold.find((n) => n.rich && n.team === p.team);
    if (rich && rich.safe) {
      const spot = findSupplySpot(g, rich);
      const w = nearestWorker(g, p.slot, rich.cx, rich.cy);
      if (spot && w && !p.botBuild) botBuildSupply(g, p, spot, w);
    }
  }
}

// 소지품 사기(v2.2 — U12): 가진 묶음이 적을 때만, 일꾼 값 · 랩 다음 일 몫 · (사람이 있는 팀이면) 더 많이 남기고 한 묶음씩
const PACK_PREF = ["missile", "triple", "homing", "mega", "firework", "drill", "sticky", "vortex"];
const PACK_LOW = 12; // 폭탄을 뺀 소지품이 이만큼보다 적으면 산다

/** 랩이 다음에 할 일(LAB_PLAN)의 골드 — 다 했으면 0 */
function nextLabGold(T) {
  for (const step of LAB_PLAN) {
    const c = labCost(T, step);
    if (c === null) continue;
    if (c === false) return T.lab.lv < LAB.MAX_LEVEL ? LAB.LEVELS[T.lab.lv + 1].gold : 0;
    return c.gold || 0;
  }
  return 0;
}

function buyPacks(g, p, T, workers, isLead) {
  if ((p.buyAt || 0) > g.time) return;
  const lab = g.buildings.get(T.labId);
  if (!lab || lab.broken) return;
  const human = g.players.some((q) => q.team === T.id && !q.bot && q.connected);
  const reserve = (workers < UNITS.worker.cap ? UNITS.worker.train.gold : 0) + (isLead ? Math.min(300, nextLabGold(T) * 0.5) : 0) + (human ? 200 : 60);
  let stock = 0;
  for (let w = 1; w < WEAPONS.length; w++) if (!WEAPONS[w].nuke) stock += p.inv[w];
  if (stock < PACK_LOW) {
    // 연 것 가운데 가장 적게 가진 것(같으면 앞의 것)
    let pick = -1;
    for (const k of PACK_PREF) {
      const w = WEAPON[k];
      if (!T.lab.unlocked[w] || p.inv[w] + WEAPONS[w].pack.n > stackMax(w)) continue;
      if (pick < 0 || p.inv[w] < p.inv[pick]) pick = w;
    }
    if (pick >= 0 && p.gold >= WEAPONS[pick].pack.gold + reserve && g.buy(p, pick)) p.buyAt = g.time + 4;
    return;
  }
  // 메가 잉크 폭탄은 하나씩, 골드가 넉넉할 때만
  const b = WEAPON.bomb;
  if (T.lab.unlocked[b] && p.inv[b] === 0 && p.gold >= WEAPONS[b].pack.gold + reserve + 150 && g.buy(p, b)) p.buyAt = g.time + 4;
}

/** 컴퓨터 일꾼 나누기: 골드 2 · 잉크 1 · 코어 1 꼴(잉크가 바닥나면 연못을 늘리고, 코어 금광 자리가 차 있으면 골드) */
function assignWorkers(g, p, T) {
  const ws = [];
  for (const u of g.units.values()) if (u.owner === p.slot && u.type === UTYPE.WORKER && !u.dead) ws.push(u);
  if (!ws.length) return;
  ws.sort((a, b) => a.id - b.id);
  let teamCore = 0;
  for (const u of g.units.values()) if (u.team === p.team && u.type === UTYPE.WORKER && !u.dead && u.res === "core" && u.owner !== p.slot) teamCore++;
  const coreNode = g.nodeFor("core", p.team);
  const coreRoom = coreNode ? Math.max(0, (coreNode.slots || CORE_MINE.SLOTS) + 1 - teamCore) : 0;
  // 잉크가 바닥나면 연못을 늘리고, 골드가 쓸 데 없이 쌓이면 골드 일꾼을 연못으로(문턱을 둘로 두어 오락가락하지 않게)
  const eco = p.eco || (p.eco = { dry: false, rich: false });
  if (p.ink < 80) eco.dry = true; else if (p.ink > 250) eco.dry = false; // 내 지갑 기준(U31)
  if (p.gold > 700) eco.rich = true; else if (p.gold < 300) eco.rich = false;
  const pattern = eco.dry && eco.rich ? ["ink", "ink", "core", "ink"]
    : eco.dry ? ["ink", "gold", "ink", "core"]
    : eco.rich ? ["ink", "core", "gold", "ink"]
    : ["gold", "ink", "core", "gold"];
  // 사람이 나가 컴퓨터가 잇는 자리: 학생이 시킨 일은 그대로 두고, 기다리는 일꾼에게만 일을 시킨다
  const keepJobs = !!p.humanEver;
  let coreUsed = 0;
  ws.forEach((w, k) => {
    let res = pattern[k % pattern.length];
    if (res === "core") { if (coreUsed < coreRoom && coreNode && coreNode.safe) coreUsed++; else res = "gold"; }
    if (g.idleWorker(w)) {
      // 기다리는 일꾼(경기 시작 · 새로 뽑음 · 일을 마침)은 조금 생각한 뒤(1.2 ~ 2.6초) 일을 시킨다
      if (g.time - (w.idleSince || 0) < 1.2 + ((w.id * 7) % 15) / 10) return;
    } else {
      if (keepJobs || w.order.type !== "gather") return; // 옮기기 · 짓기 · 고치기는 끝날 때까지
      if (w.res === res || w.carry > 0) return; // 짐은 내려놓고 바꾼다
    }
    w.res = res;
    const node = g.nodeFor(res, p.team);
    if (node) g.setOrder(w, { type: "gather", res, i: node.i, phase: w.carry > 0 ? "back" : "go" });
  });
}

// 컴퓨터의 공급소 짓기(U18): 일꾼을 자리 옆으로 옮기고, 닿으면 짓는다(사람과 같은 규칙 — 일꾼 바로 옆에만)
function botBuildSupply(g, p, spot, w) {
  p.botBuild = { tx: spot.tx, ty: spot.ty, wid: w.id, until: g.time + 40 };
  botBuildTick(g, p);
}
function botBuildTick(g, p) {
  const job = p.botBuild;
  const size = BUILDINGS[BLD.SUPPLY].size;
  const w = g.units.get(job.wid);
  if (!w || w.dead || g.time > job.until || !g.canPlace(job.tx, job.ty, size)) {
    p.botBuild = null;
    if (w && !w.dead && w.order.type === "move") g.setOrder(w, { type: "idle" });
    return;
  }
  if (rectDist(w.x, w.y, job.tx, job.ty, size) - w.radius <= BUILD_NEAR - 0.2) {
    p.botBuild = null;
    g.place(p, { kind: "supply", tx: job.tx, ty: job.ty, ids: [w.id] });
    return;
  }
  // 자리 가운데로 걸어간다(아직 아무것도 없는 빈 바닥이다)
  if (w.order.type !== "move") g.setOrder(w, { type: "move", x: job.tx + size / 2, y: job.ty + size / 2 });
}

function nearestWorker(g, slot, x, y) {
  let best = null, bd = Infinity;
  for (const u of g.units.values()) {
    if (u.owner !== slot || u.type !== UTYPE.WORKER || u.dead || u.order.type === "build" || u.order.type === "repair") continue;
    const d = Math.hypot(u.x - x, u.y - y);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

function findSupplySpot(g, node) {
  const size = BUILDINGS[BLD.SUPPLY].size;
  let best = null, bd = Infinity;
  for (let r = 2; r <= 7; r++) {
    for (let y = Math.floor(node.cy - r - size); y <= node.cy + r; y++)
      for (let x = Math.floor(node.cx - r - size); x <= node.cx + r; x++) {
        if (!g.canPlace(x, y, size)) continue;
        const d = rectDist(node.cx, node.cy, x, y, size);
        if (d < 1.2 || d >= bd) continue;
        bd = d; best = { tx: x, ty: y };
      }
    if (best) return best;
  }
  return best;
}

function enemiesNear(g, team, x, y, r) {
  let n = 0;
  for (const e of g.hash.query(x, y, r + 1)) if (!e.dead && e.team !== team && e.team !== NEUTRAL && Math.hypot(e.x - x, e.y - y) <= r) n++;
  return n;
}

// ───────────── 컴퓨터 영웅 ─────────────
function newBrain() {
  return { mode: "", goal: null, rect: null, target: null, siteId: -1, path: null, pathKey: "", pathAt: -9, strafe: 1, strafeAt: 0, charge: null, stuckT: 0, lx: 0, ly: 0, w: 0, aimBig: false, thinkAt: -9 };
}

/** 컴퓨터 영웅의 이번 틱 입력. 생각은 0.2초마다, 걷기 · 던지기는 틱마다 */
export function botHeroInput(g, p, h) {
  const B = p.brain || (p.brain = newBrain());
  if (g.time - B.thinkAt >= 0.2 || !B.mode) { B.thinkAt = g.time + (p.slot % 4) * 0.01; think(g, p, h, B); }
  return act(g, p, h, B);
}

function think(g, p, h, B) {
  const T = g.teams[h.team];
  const research = T.lab.research;
  B.target = null;
  B.rect = null;
  B.goal = null;
  B.aim = null;
  const canThrow = !(h.gem >= 0 && !GEM.CARRY_ATTACK[g.mode]);
  // 1) 보석을 들었으면 탑으로
  if (h.gem >= 0) {
    B.mode = "deliver";
    B.rect = g.tower(h.team);
    if (canThrow) B.target = nearestEnemy(g, h, 5);
    return;
  }
  // 2) 잉크가 모자라면 공급소로(메가 폭탄은 한 발이 커서 빼고 본다 — 탱크를 가득 채워도 세 발이 안 된다)
  const W = WEAPONS[h.weapon] || WEAPONS[0];
  const shot = shotInk(W.nuke ? 0 : h.weapon, false, research);
  if (B.mode === "refill" && h.tank < INK.TANK * 0.92 && p.ink > 2) { B.rect = g.nearestSupply(h.team, h.x, h.y); if (B.rect) return; }
  if (h.tank < Math.min(INK.TANK * 0.5, Math.max(shot, shotInk(0, false, research)) * 3) && p.ink > 10) {
    const sup = g.nearestSupply(h.team, h.x, h.y);
    if (sup) { B.mode = "refill"; B.rect = sup; return; }
  }
  // 2-1) 목숨을 아낀다(U26): 체력이 낮으면(마지막 목숨이면 더 일찍) 싸움을 피하고, 적이 가까우면 우리 탑으로 물러난다
  const low = h.hp < (p.lives <= 1 ? 50 : 35);
  if (low) {
    const e = nearestEnemy(g, h, 7);
    if (e) {
      B.mode = "retreat";
      B.rect = g.tower(h.team) || g.nearestSupply(h.team, h.x, h.y);
      if (Math.hypot(e.x - h.x, e.y - h.y) < 4) B.target = e;
      if (B.rect) return;
    }
  }
  // 2-2) 우리 탑이 공격받으면(부서지면 팀 탈락 — U27) 가까운 영웅은 탑 둘레의 적을 친다
  const tower = g.tower(h.team);
  if (!low && tower && g.time - tower.hitAt < 4 && Math.hypot(tower.cx - h.x, tower.cy - h.y) < 30) {
    let foe = null, fd = TOWER.RANGE + 5;
    for (const e of g.hash.query(tower.cx, tower.cy, fd + 1)) {
      if (e.dead || e.quiz || e.team === h.team || e.team === NEUTRAL || !g.seenBy(h.team, e)) continue;
      const d = rectDist(e.x, e.y, tower.tx, tower.ty, tower.size);
      if (d < fd) { fd = d; foe = e; }
    }
    if (foe) { B.mode = "fight"; B.target = foe; return; }
  }
  // 3) 적 운반자
  let carrier = null, cd = 20;
  for (const gem of g.gems.values()) {
    if (gem.state !== 1) continue;
    const c = g.units.get(gem.carrier);
    if (!c || c.quiz || c.team === h.team) continue;
    const d = Math.hypot(c.x - h.x, c.y - h.y);
    if (d < cd) { cd = d; carrier = c; }
  }
  if (carrier && !low) { B.mode = "chase"; B.target = carrier; return; }
  // 4) 떨어진 보석
  let loose = null, ld = 14;
  for (const gem of g.gems.values()) {
    if (gem.state !== 0) continue;
    const d = Math.hypot(gem.x - h.x, gem.y - h.y);
    if (d < ld) { ld = d; loose = gem; }
  }
  if (loose) { B.mode = "gem"; B.goal = { x: loose.x, y: loose.y }; B.target = nearestEnemy(g, h, 4); return; }
  // 5) 가까운 적
  const enemy = nearestEnemy(g, h, low ? 3.5 : 6);
  if (enemy) { B.mode = "fight"; B.target = enemy; return; }
  // 6) 목표 섹션
  const site = pickSite(g, p, h);
  if (site) {
    B.mode = "site";
    B.siteId = site.id;
    B.goal = { x: site.x, y: site.y };
    return;
  }
  // 7) 할 일이 없으면: 코어가 모자라면 사냥, 아니면 상대 탑
  const camp = nearestCamp(g, h);
  if (camp && !low && (p.core < 20 || g.rand() < 0.5)) { B.mode = "hunt"; B.goal = { x: camp.x, y: camp.y }; return; }
  // 상대 탑 부수기(부서지면 그 팀 탈락) — 체력이 넉넉하고 마지막 목숨이 아닐 때만
  const tw = h.hp >= 60 && p.lives >= 2 ? enemyTower(g, h) : null;
  if (tw) { B.mode = "siege"; B.target = tw; return; }
  B.mode = "idle";
  const base = g.map.bases[h.team];
  B.goal = { x: base.spawn.x, y: base.spawn.y };
}

function nearestEnemy(g, h, r) {
  let best = null, bd = r;
  for (const e of g.hash.query(h.x, h.y, r + 1)) {
    if (e.dead || e.quiz || e.team === h.team || !g.seenBy(h.team, e)) continue;
    let d = Math.hypot(e.x - h.x, e.y - h.y);
    if (e.type === UTYPE.NPC) {
      const et = e.target && g.units.get(e.target);
      if (!(et && et.team === h.team) && d > 3) continue;
      d += 1;
    }
    if (e.type === UTYPE.WORKER) d += 1.5;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function pickSite(g, p, h) {
  let best = null, bs = Infinity;
  for (const s of g.sites) {
    let ok = s.state === SITE_STATE.SHIELD || s.state === SITE_STATE.ROCK || (s.state === SITE_STATE.QUIZ && s.team === h.team);
    if (s.state === SITE_STATE.SHIELD && g.mode === "quiz" && (p.lock[s.id] || 0) > g.time) ok = false;
    if (!ok) continue;
    let score = Math.hypot(s.x - h.x, s.y - h.y) + enemiesNear(g, h.team, s.x, s.y, 6) * 8;
    if (s.center) {
      // 가운데는 큰 몬스터가 지킨다 — 팀이 셀 때만
      let boss = false;
      for (const u of g.hash.query(s.x, s.y, 8)) if (u.type === UTYPE.NPC && !u.dead && MONSTERS[u.kind].boss) boss = true;
      score += boss ? 35 : 4;
    }
    if (s.state === SITE_STATE.ROCK) score -= 6;
    if (s.state === SITE_STATE.QUIZ) score -= 4;
    score += (p.slot % 3) * 2 * (s.id % 2); // 같은 팀 컴퓨터끼리 조금 나뉘게
    if (score < bs) { bs = score; best = s; }
  }
  return best;
}

function nearestCamp(g, h) {
  let best = null, bd = 26;
  for (const c of g.camps) {
    if (c.alive <= 0 || c.tier >= 2) continue;
    const d = Math.hypot(c.x - h.x, c.y - h.y);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function enemyTower(g, h) {
  let best = null, bd = Infinity;
  for (const T of g.teams) {
    if (T.id === h.team) continue;
    const tw = g.buildings.get(T.towerId);
    if (!tw || tw.down) continue;
    const d = Math.hypot(tw.cx - h.x, tw.cy - h.y);
    if (d < bd) { bd = d; best = tw; }
  }
  return best;
}

/** 무기 고르기: 목표가 건물 · 섹션이면 드릴 · 대왕, 멀리 있는 유닛이면 미사일 · 유도, 가까우면 삼발 · 폭죽 */
function chooseWeapon(g, h, kind, dist) {
  // 소지품에 있는 것만(v2.2) — 없으면 기본 잉크
  const p = g.players[h.owner];
  const inv = p ? p.inv : [];
  const have = (k) => WEAPON[k] === 0 || inv[WEAPON[k]] > 0;
  const pick = (list) => { for (const k of list) if (have(k)) return WEAPON[k]; return 0; };
  if (have("bomb") && h.bombCd <= 0 && h.tank >= 90 + 50 && kind === "struct") return WEAPON.bomb;
  if (kind === "struct") return pick(["drill", "mega", "firework", "basic"]);
  if (dist > 4.5) return pick(["homing", "missile", "mega", "basic"]);
  return pick(["triple", "firework", "mega", "sticky", "vortex", "missile", "basic"]);
}

function act(g, p, h, B) {
  const T = g.teams[h.team];
  const input = { mx: 0, my: 0 };
  let moveTo = null; // { x, y } 또는 { rect }
  let aim = null; // { x, y, kind, dist, unit }
  let keep = null; // 상대와 둘 거리 [가까이, 멀리]
  const t = B.target && (B.target.isBuilding ? (g.buildings.has(B.target.id) && !B.target.down ? B.target : null) : !B.target.dead && !B.target.quiz && g.units.has(B.target.id) ? B.target : null);
  switch (B.mode) {
    case "deliver":
    case "refill":
    case "retreat":
      if (B.rect) moveTo = { rect: B.rect };
      if (t) aim = aimAtUnit(g, h, t);
      break;
    case "chase":
    case "fight":
      if (!t) { B.mode = ""; break; }
      aim = aimAtUnit(g, h, t);
      keep = h.weapon === WEAPON.missile || h.weapon === WEAPON.homing ? [3.5, 6.5] : [3, 5];
      if (B.mode === "chase") keep = [1.2, 4.5];
      break;
    case "gem":
      moveTo = B.goal;
      if (t) aim = aimAtUnit(g, h, t);
      break;
    case "site": {
      const s = g.sites[B.siteId];
      if (!s || !(s.state === SITE_STATE.SHIELD || s.state === SITE_STATE.ROCK || s.state === SITE_STATE.QUIZ)) { B.mode = ""; break; }
      const d = Math.hypot(s.x - h.x, s.y - h.y);
      if (s.state === SITE_STATE.QUIZ) {
        // 우리 팀이 풀고 있다 — 곁에서 지킨다
        if (d > 3.5) moveTo = { x: s.x, y: s.y };
        const e = nearestEnemy(g, h, 6);
        if (e) aim = aimAtUnit(g, h, e);
        break;
      }
      if (d > 4.6) moveTo = { x: s.x, y: s.y };
      else if (d < 2.6) keep = [2.6, 4.6];
      if (d < 6.2) aim = { x: s.x + (g.rand() - 0.5) * 0.6, y: s.y + (g.rand() - 0.5) * 0.6, kind: "struct", dist: d };
      const e = nearestEnemy(g, h, 4.5);
      if (e) aim = aimAtUnit(g, h, e);
      break;
    }
    case "hunt":
      moveTo = B.goal;
      if (B.goal && Math.hypot(B.goal.x - h.x, B.goal.y - h.y) < 3) B.mode = "";
      break;
    case "siege": {
      if (!t) { B.mode = ""; break; }
      const d = rectDist(h.x, h.y, t.tx, t.ty, t.size);
      if (d > 5) moveTo = { rect: t };
      else aim = { x: t.cx, y: t.cy, kind: "struct", dist: d + t.size / 2 };
      const e = nearestEnemy(g, h, 5);
      if (e) aim = aimAtUnit(g, h, e);
      break;
    }
    default:
      if (B.goal && Math.hypot(B.goal.x - h.x, B.goal.y - h.y) > 1.5) moveTo = B.goal;
  }
  // 걷기
  if (t && keep && !t.isBuilding) {
    const d = Math.hypot(t.x - h.x, t.y - h.y);
    if (d > keep[1]) moveTo = { x: t.x, y: t.y };
    else {
      if (g.time >= B.strafeAt) { B.strafe = g.rand() < 0.5 ? -1 : 1; B.strafeAt = g.time + 0.8 + g.rand() * 1.2; }
      const ux = (t.x - h.x) / (d || 1), uy = (t.y - h.y) / (d || 1);
      const back = d < keep[0] ? -1 : 0;
      input.mx = -uy * B.strafe * 0.8 + ux * back;
      input.my = ux * B.strafe * 0.8 + uy * back;
      // 운반자 곁이면 대시로 들이받는다
      if (B.mode === "chase" && d < 2.4 && h.dashCd <= 0 && g.rand() < 0.15) input.dash = { x: ux, y: uy };
    }
  } else if (keep && !t) {
    const s = g.sites[B.siteId];
    if (s) {
      const d = Math.hypot(s.x - h.x, s.y - h.y) || 1;
      input.mx = -(s.x - h.x) / d;
      input.my = -(s.y - h.y) / d;
    }
  }
  if (moveTo) {
    const dir = pathDir(g, h, B, moveTo);
    if (dir) { input.mx = dir.x; input.my = dir.y; }
  }
  const l = Math.hypot(input.mx, input.my);
  if (l > 1) { input.mx /= l; input.my /= l; }
  // 막힘: 1초 넘게 거의 못 움직이면 길을 다시 찾고 옆으로 비킨다
  if (l > 0.1) {
    const moved = Math.hypot(h.x - B.lx, h.y - B.ly);
    if (moved < 0.02) {
      B.stuckT += TICK;
      if (B.stuckT > 0.8) { B.path = null; B.stuckT = 0; B.nudge = g.time + 0.4; B.nudgeA = g.rand() * Math.PI * 2; }
    } else B.stuckT = 0;
  }
  if (B.nudge && g.time < B.nudge) { input.mx = Math.cos(B.nudgeA); input.my = Math.sin(B.nudgeA); }
  B.lx = h.x; B.ly = h.y;
  // 던지기(충전한 대형은 충전 시간을 지킨다)
  if (B.charge) {
    h.charging = true;
    h.c = clamp(1 - (B.charge.until - g.time) / chargeTime(T.lab.research), 0, 1);
    if (g.time >= B.charge.until) {
      const a = aim || B.charge;
      g.heroThrow(h, a.x, a.y, true);
      B.charge = null;
      h.charging = false;
      h.c = 0;
    }
  } else if (aim && h.throwCd <= 0) {
    const w = chooseWeapon(g, h, aim.kind, aim.dist);
    if (h.weapon !== w) h.weapon = w;
    const W = WEAPONS[w];
    const research = T.lab.research;
    const wantBig = !W.direct && !W.nuke && h.tank >= 110 && (aim.kind === "struct" ? g.rand() < 0.45 : g.rand() < 0.2);
    const need = shotInk(w, wantBig, research);
    if (h.tank >= need && aim.dist <= (W.direct ? MISSILE.RANGE : 7)) {
      if (wantBig) B.charge = { until: g.time + chargeTime(research) + 0.02, x: aim.x, y: aim.y };
      else g.heroThrow(h, aim.x, aim.y, false);
    }
  }
  if (!B.charge) h.charging = false;
  if (aim && !l) h.facing = Math.atan2(aim.y - h.y, aim.x - h.x);
  return input;
}

/** 움직이는 상대를 앞질러 겨눈다(브로울스 컴퓨터와 같은 식) */
function aimAtUnit(g, h, t) {
  const tx = t.isBuilding ? t.cx : t.x, ty = t.isBuilding ? t.cy : t.y;
  const d = Math.hypot(tx - h.x, ty - h.y);
  const W = WEAPONS[h.weapon] || WEAPONS[0];
  const ft = W.direct ? d / (W.homing ? HOMING.SPEED : MISSILE.SPEED) : flightTime(d, false);
  const lead = t.isBuilding ? 0 : 0.35 + g.rand() * 0.65;
  const err = (g.rand() - 0.5) * 2 * BOT.AIM_ERR;
  const ea = g.rand() * Math.PI * 2;
  return {
    x: tx + (t.vxe || 0) * ft * lead + Math.cos(ea) * err, y: ty + (t.vye || 0) * ft * lead + Math.sin(ea) * err,
    kind: t.isBuilding ? "struct" : "unit", dist: d, unit: t,
  };
}

/** 목표까지 길을 따라 걷는 방향(길은 1.2초마다 · 목표가 움직이면 다시 찾는다) */
function pathDir(g, h, B, to) {
  const rect = to.rect || null;
  const gx = rect ? rect.cx : to.x, gy = rect ? rect.cy : to.y;
  if (rect && rectDist(h.x, h.y, rect.tx, rect.ty, rect.size) < 0.6) return null;
  if (!rect && Math.hypot(gx - h.x, gy - h.y) < 0.3) return null;
  if (!rect && Math.hypot(gx - h.x, gy - h.y) < 6 && lineClear(g.grid, h.x, h.y, gx, gy, HERO.RADIUS + 0.04)) {
    B.path = null;
    const d = Math.hypot(gx - h.x, gy - h.y);
    return { x: (gx - h.x) / d, y: (gy - h.y) / d };
  }
  const key = rect ? `r${rect.id}` : `${Math.round(gx)},${Math.round(gy)}`;
  if (!B.path || (B.pathKey !== key && g.time - B.pathAt > 0.4) || g.time - B.pathAt > 2.5 || !B.path.length) {
    if (g.pathBudget > 0 || !B.path) {
      g.pathBudget--;
      B.path = findPath(g.grid, h.x, h.y, rect ? { rect: { tx: rect.tx, ty: rect.ty, size: rect.size } } : { x: gx, y: gy }, { radius: HERO.RADIUS + 0.04, maxNodes: 7000 });
      B.pathKey = key;
      B.pathAt = g.time;
    }
  }
  while (B.path && B.path.length && Math.hypot(B.path[0].x - h.x, B.path[0].y - h.y) < 0.3) B.path.shift();
  const pt = B.path && B.path[0];
  if (!pt) {
    const d = Math.hypot(gx - h.x, gy - h.y) || 1;
    return { x: (gx - h.x) / d, y: (gy - h.y) / d };
  }
  const d = Math.hypot(pt.x - h.x, pt.y - h.y) || 1;
  return { x: (pt.x - h.x) / d, y: (pt.y - h.y) / d };
}
