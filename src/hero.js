// 내 영웅(docs/DESIGN.md §3 · §4): 움직임은 내 브라우저가 정한다(shared/move.js heroStep 을 60Hz 고정 걸음으로) — 서버는 받은 자리를 검사만.
// 겨누기 · 충전 · 던지기(브로울스 그대로: 누르면 충전, 떼면 던진다 — 미사일은 누르는 즉시) · 잉크 탱크 미리 빼기 · mv 보내기(약 15Hz).
// 넉백(kb) · 자리 고침(warp)은 서버가 알려 준다.
import { HERO, THROW, MISSILE, WEAPONS, ITEMS, INK, shotInk, throwRange, chargeTime } from "../shared/constants.js";
import { newHeroBody, heroStep, unstick } from "../shared/move.js";
import { Grid, findPath } from "../shared/path.js";
import { PHASE } from "../shared/protocol.js";

const STEP = 1 / 60;
const SEND_EVERY = 1 / 15;
const BOOST = ITEMS.find((i) => i.key === "boost") || { speed: 1.35 };

export function createHero(world, net) {
  const spawn = world.map.bases[world.team]?.spawn || { x: world.S / 2, y: world.S / 2 };
  const body = newHeroBody(spawn.x, spawn.y);
  const st = {
    body,
    ready: false, // 서버가 내 영웅 자리를 한 번이라도 알려 줬나(스냅숏 · warp)
    facing: 0,
    aimX: spawn.x + 1, aimY: spawn.y, // 겨눈 땅(칸)
    w: 0, // 지금 무기(바꾸면 바로 — 서버가 me.w 로 확인)
    wAt: 0,
    charging: false,
    chargeT: 0,
    cd: 0,
    spent: [], // 보낸 던지기의 잉크(서버의 me.tank 가 아직 모르는 것) { t, ink }
    throwPose: 0, // 이번 프레임에 던지는 자세를 시작했나(화면이 R.actor.throwPose 를 부른다)
    lastDash: 0,
    frozen: true,
    why: "", // 못 던지는 까닭(HUD)
  };
  let acc = 0;
  let sendAcc = 0;
  let last = { x: NaN, y: NaN, z: NaN, f: NaN, d: 0, c: 0 };
  let pendJump = false;
  let pendDash = null;
  let lastBlk = -1;

  // ── 마우스로 걷기(오른쪽 클릭 — U20): 내 브라우저가 길을 찾아(shared/path.js) 그 경유점 쪽으로 heroStep 을 민다(순간 이동 없음) ──
  // goal = { x, y } 땅 · { rect: { tx, ty, size } } 그 네모 옆 칸까지 · range > 0 이면 그만큼 가까워지면 멈춘다(적 — unitId 면 따라간다)
  const grid = new Grid(world.S);
  grid.block = world.blk; // 내 영웅 충돌과 같은 막힌 칸 표(같은 배열 — 상자가 깨지면 함께 바뀐다)
  const walk = { on: false, path: [], k: 0, x: 0, y: 0, rect: null, range: 0, unitId: -1, endX: 0, endY: 0, stuckT: 0, lx: 0, ly: 0, tries: 0, repathT: 0 };
  const steer = { x: 0, y: 0 };
  const rectGap = (x, y, r) => Math.hypot(Math.max(r.tx - x, 0, x - (r.tx + r.size)), Math.max(r.ty - y, 0, y - (r.ty + r.size)));
  function plan() {
    walk.path = walk.rect ? findPath(grid, body.x, body.y, { rect: walk.rect }) : findPath(grid, body.x, body.y, { x: walk.x, y: walk.y });
    walk.k = 0;
    const e = walk.path[walk.path.length - 1];
    walk.endX = e ? e.x : body.x; walk.endY = e ? e.y : body.y;
    walk.lx = body.x; walk.ly = body.y; walk.stuckT = 0;
  }
  function stopWalk() {
    walk.on = false;
    walk.path = [];
  }
  /** 다 왔나(멈출 거리) — 적이면 사거리 안, 네모면 옆 칸 */
  function arrived() {
    if (walk.range > 0) {
      if (walk.unitId >= 0) {
        const u = world.latest?.byId?.get(walk.unitId);
        if (!u) return true; // 보이지 않거나 쓰러졌다
        if (Math.hypot(u.x - body.x, u.y - body.y) <= walk.range) return true;
      } else if (walk.rect && rectGap(body.x, body.y, walk.rect) <= walk.range) return true;
    }
    return false;
  }
  /** 다음 경유점 쪽 단위 벡터(steer) — 다 왔으면 걷기를 끝내고 false */
  function steerStep() {
    if (arrived()) { stopWalk(); return false; }
    while (walk.k < walk.path.length) {
      const p = walk.path[walk.k];
      const dx = p.x - body.x, dy = p.y - body.y;
      const d = Math.hypot(dx, dy);
      const last = walk.k === walk.path.length - 1;
      if (d < (last ? 0.12 : 0.3)) { walk.k++; continue; }
      steer.x = dx / d; steer.y = dy / d;
      return true;
    }
    stopWalk();
    return false;
  }

  const me = () => world.me;
  const alive = () => !!me() && !(me().dead > 0) && !me().heroOut; // 목숨을 다 쓰면(heroOut — U26) 다시 나오지 않는다

  /** 서버의 스냅숏에 내 영웅이 처음 보이면 그 자리에서 시작 */
  function syncFromSnapshot() {
    if (st.ready) return;
    const id = me()?.heroId;
    const u = id != null ? world.latest?.byId?.get(id) : null;
    if (u) {
      body.x = u.x; body.y = u.y;
      st.ready = true;
    }
  }

  function speedMul() {
    const m = me();
    let k = 1;
    if (m?.boost > 0) k *= BOOST.speed || 1.35;
    if (m?.carry > 0) k *= HERO.CARRY_SLOW;
    return k;
  }

  /** 지금 탱크(서버 값 − 아직 서버가 모르는 던지기) */
  function tank() {
    const m = me();
    const base = m ? (Number.isFinite(m.tank) ? m.tank : Number.isFinite(m.ink) ? m.ink : 0) : 0;
    let s = 0;
    for (const p of st.spent) s += p.ink;
    return Math.max(0, base - s);
  }

  function weaponCost(big) {
    return shotInk(st.w, big, world.research());
  }
  /** 소지품에 남은 개수(서버 값 − 아직 서버가 모르는 던지기). 기본 잉크는 Infinity */
  function invLeft(w) {
    if (!w) return Infinity;
    let n = world.invCount(w);
    for (const p of st.spent) if (p.w === w) n--;
    return Math.max(0, n);
  }

  /** 지금 던질 수 없는 까닭("" = 던질 수 있다) */
  function blockReason() {
    const m = me();
    if (world.spectator || !m) return "watch";
    if (m.heroOut) return "out";
    if (m.dead > 0) return "dead";
    if (world.phase !== PHASE.PLAY) return "wait";
    if (st.frozen) return "quiz";
    if (m.carry > 0 && world.carryBlocksThrow()) return "carry";
    const W = WEAPONS[st.w];
    if (W.cooldown && (m.bombCd || 0) > 0) return "bombcd";
    if (st.w && invLeft(st.w) <= 0) return "empty";
    if (tank() < weaponCost(false)) return "ink";
    return "";
  }

  function send(force = false) {
    const f = Math.round(st.facing * 100) / 100;
    const d = body.dashT > 0 ? 1 : 0;
    const c = st.charging ? 1 : 0;
    // last.x 가 NaN 이면(처음 · warp 뒤) 꼭 보낸다 — NaN 과의 비교는 늘 거짓이라 따로 본다
    const moved = Number.isNaN(last.x) || Math.abs(body.x - last.x) > 0.004 || Math.abs(body.y - last.y) > 0.004 || Math.abs(body.z - last.z) > 0.02 || Math.abs(f - last.f) > 0.04 || d !== last.d || c !== last.c;
    if (!moved && !force) return;
    last = { x: body.x, y: body.y, z: body.z, f, d, c };
    net.send({ t: "mv", x: +body.x.toFixed(3), y: +body.y.toFixed(3), z: +body.z.toFixed(2), f, d, c });
  }

  /** 겨눈 곳 → 던질 곳(사거리 안으로). 미사일은 그 방향 사거리 끝 */
  function target() {
    const W = WEAPONS[st.w];
    const dx = st.aimX - body.x, dy = st.aimY - body.y;
    const d = Math.hypot(dx, dy);
    const ux = d > 1e-4 ? dx / d : Math.cos(st.facing), uy = d > 1e-4 ? dy / d : Math.sin(st.facing);
    if (W.direct) {
      const R = MISSILE.RANGE * (world.research().long ? throwRange(world.research()) / THROW.RANGE : 1);
      return { x: body.x + ux * R, y: body.y + uy * R, d: R };
    }
    const max = throwRange(world.research());
    const c = Math.max(THROW.RANGE_MIN, Math.min(max, d));
    return { x: body.x + ux * c, y: body.y + uy * c, d: c };
  }

  function doThrow(big) {
    const W = WEAPONS[st.w];
    if (W.nuke) big = true;
    if (big && tank() < weaponCost(true)) big = false;
    const cost = weaponCost(big);
    if (tank() < cost) return null;
    const t = target();
    net.send({ t: "throw", tx: +t.x.toFixed(2), ty: +t.y.toFixed(2), big: big ? 1 : 0 });
    st.spent.push({ t: performance.now(), ink: cost, w: st.w });
    st.cd = W.direct ? MISSILE.CD : THROW.CD;
    st.throwPose = 1;
    return { x0: body.x, y0: body.y, z0: body.z + THROW.HAND, x1: t.x, y1: t.y, w: st.w, big, direct: !!W.direct };
  }

  return {
    st,
    body,
    tank,
    target,
    weaponCost,
    invLeft,
    blockReason,
    get ready() { return st.ready; },

    /** 서버의 me 가 왔다: 무기 · 잉크 맞추기 */
    onMe(m) {
      const now = performance.now();
      st.spent = st.spent.filter((p) => now - p.t < 280);
      // 서버가 정한 무기(다 써서 기본으로 돌린 것 포함). 방금 내가 바꾼 것은 잠깐 믿는다
      if (Number.isInteger(m.w) && (now - st.wAt > 600 || (st.w && invLeft(st.w) <= 0))) st.w = m.w;
      if (m.slow > body.slow + 0.3) body.slow = m.slow;
    },
    /** 넉백(서버가 내 영웅을 밀었다) */
    onKb(k) {
      body.kvx += k.vx || 0;
      body.kvy += k.vy || 0;
      if (k.stun) body.stun = Math.max(body.stun, k.stun);
      if (k.slow) body.slow = Math.max(body.slow, k.slow);
    },
    /** 서버가 자리를 정했다(부활 · 검사 실패) */
    onWarp(p) {
      stopWalk();
      body.x = p.x; body.y = p.y;
      body.vx = body.vy = body.kvx = body.kvy = 0;
      body.dashT = 0;
      st.ready = true;
      last.x = NaN;
    },
    setWeapon(w) {
      if (w === st.w || !WEAPONS[w]) return false;
      if (w && invLeft(w) <= 0) return false; // 소지품에 없는 무기는 들 수 없다(서버도 버린다)
      st.w = w;
      st.wAt = performance.now();
      st.charging = false;
      net.send({ t: "weapon", w });
      return true;
    },
    jump() { pendJump = true; },
    /** 마우스로 걷기: o = { x, y } | { rect: { tx, ty, size } } (+ range · unitId) */
    walkTo(o) {
      if (!st.ready || !alive()) return false;
      walk.x = o.x ?? 0; walk.y = o.y ?? 0;
      walk.rect = o.rect || null;
      walk.range = o.range || 0;
      walk.unitId = o.unitId ?? -1;
      walk.tries = 0; walk.repathT = 0;
      walk.on = true;
      plan();
      if (!walk.path.length && !walk.range) stopWalk(); // 벌써 거기
      return walk.on;
    },
    stopWalk,
    get walking() { return walk.on; },
    /** 화면이 그리는 걷기 길(경유점 · 끝) — 같은 객체를 돌려준다 */
    walk,
    dash(dx, dy) { pendDash = { x: dx, y: dy }; },

    /** 누름: 미사일은 바로 던진다(돌려준 값 = 화면에 미리 날릴 포물선 · 직선), 풍선은 충전 시작 */
    press() {
      let why = blockReason();
      if (why === "empty") {
        // 다 썼다: 기본 잉크로 바꾼다(서버도 그렇게 한다)
        this.setWeapon(0);
        st.why = "empty";
        return null;
      }
      st.why = why;
      if (why || st.cd > 0) return null;
      const W = WEAPONS[st.w];
      if (W.direct) return doThrow(false);
      st.charging = true;
      st.chargeT = 0;
      return null;
    },
    /** 뗌: 충전한 만큼(대형 = 충전 시간 이상) 던진다 */
    release() {
      if (!st.charging) return null;
      st.charging = false;
      const why = blockReason();
      st.why = why;
      if (why) return null;
      if (st.cd > 0) return null;
      const big = st.chargeT >= chargeTime(world.research());
      return doThrow(big);
    },
    cancel() { st.charging = false; },
    chargeFrac() { return st.charging ? Math.min(1, st.chargeT / chargeTime(world.research())) : 0; },

    /**
     * 한 프레임. input = { mx, my(-1..1 화면 = 지도 축), aimX, aimY(겨눈 땅 칸) | undefined }
     * frozen = 문제 창이 열렸거나 쓰러졌다(그 자리에 선다)
     */
    update(dt, input, frozen) {
      syncFromSnapshot();
      st.throwPose = 0;
      st.frozen = !!frozen;
      if (input.aimX != null) { st.aimX = input.aimX; st.aimY = input.aimY; }
      const dx = st.aimX - body.x, dy = st.aimY - body.y;
      if (Math.hypot(dx, dy) > 0.15) st.facing = Math.atan2(dy, dx);
      else if (input.mx || input.my) st.facing = Math.atan2(input.my, input.mx);
      st.cd = Math.max(0, st.cd - dt);
      if (st.charging) st.chargeT += dt;
      body.charging = st.charging;
      if (world.blkVersion !== lastBlk) {
        lastBlk = world.blkVersion;
        const p = unstick(world.blk, world.S, body.x, body.y, HERO.RADIUS);
        body.x = p.x; body.y = p.y;
      }
      const canMove = st.ready && alive() && !frozen && world.phase === PHASE.PLAY;
      // 걷기는 WASD · 이동 판 · 쓰러짐 · 문제 창에서 멈춘다
      if (walk.on && (!canMove || input.mx || input.my)) stopWalk();
      if (walk.on) {
        // 0.5초 넘게 거의 못 움직였으면 길을 다시 찾는다(세 번까지) · 따라가는 적이 멀어졌으면 다시
        walk.stuckT += dt;
        walk.repathT += dt;
        if (Math.hypot(body.x - walk.lx, body.y - walk.ly) > 0.15) { walk.lx = body.x; walk.ly = body.y; walk.stuckT = 0; }
        if (walk.stuckT > 0.5) { if (++walk.tries > 3) stopWalk(); else plan(); }
        else if (walk.unitId >= 0 && walk.repathT > 0.7) {
          walk.repathT = 0;
          const u = world.latest?.byId?.get(walk.unitId);
          if (u && Math.hypot(u.x - walk.endX, u.y - walk.endY) > 1) { walk.x = u.x; walk.y = u.y; plan(); }
        }
      }
      if (!canMove) {
        body.vx = body.vy = 0;
        body.kvx *= 0.8; body.kvy *= 0.8;
        if (!alive()) st.charging = false;
        pendJump = false; pendDash = null;
        acc = 0;
        world.heroPos = st.ready && !me()?.heroOut ? { x: body.x, y: body.y } : null;
        return;
      }
      acc = Math.min(acc + dt, STEP * 6);
      const mul = speedMul();
      let first = true;
      while (acc >= STEP) {
        acc -= STEP;
        let mx = input.mx || 0, my = input.my || 0;
        if (walk.on && steerStep()) { mx = steer.x; my = steer.y; }
        heroStep(body, { mx, my, jump: first && pendJump, dash: first ? pendDash : null }, STEP, world.blk, world.S, mul);
        if (first) { pendJump = false; pendDash = null; first = false; }
      }
      world.heroPos = { x: body.x, y: body.y };
      sendAcc += dt;
      if (sendAcc >= SEND_EVERY) {
        sendAcc = 0;
        send();
      }
    },
    tankMax: INK.TANK,
  };
}
