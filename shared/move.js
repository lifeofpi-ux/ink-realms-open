// 몸의 움직임(docs/DESIGN.md §3). 브라우저(내 영웅)와 서버(컴퓨터 영웅 · 검사)가 같은 함수를 쓴다.
//
//   blk: Uint8Array(S²) — 1 이면 막힌 칸(shared/map.js 의 fillBlocked), S: 맵 한 변
//   slide(blk, S, x, y, dx, dy, r)      → { x, y }  네모 몸(반 폭 r)을 칸 벽에 미끄러지며 옮긴다
//   heroStep(h, input, dt, blk, S, mul) → h 를 dt 만큼 움직인다(브로울스 원본의 가속 · 마찰 · 넉백 · 대시 · 점프를 칸 단위로)
//     h = { x, y, vx, vy, kvx, kvy, z, vz, air, dashT, dashX, dashY, dashCd, stun, slow, charging }
//     input = { mx, my(-1..1, 길이 ≤ 1), jump(누른 순간), dash: { x, y } | null(두 번 누른 순간) }
//     mul = 속력 배율(부스터 · 보석 · 끈끈이를 곱한 값)
import { HERO, DASH, JUMP, THROW, SLOW } from "./constants.js";

export function blockedTile(blk, S, tx, ty) {
  return tx < 0 || ty < 0 || tx >= S || ty >= S || blk[ty * S + tx] === 1;
}

function boxHits(blk, S, x, y, r) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (blockedTile(blk, S, tx, ty)) return true;
  return false;
}

/** 네모 몸을 (dx, dy) 만큼 옮기되 막힌 칸에 닿으면 그 축은 벽 앞에서 멈춘다(다른 축으로는 미끄러진다) */
export function slide(blk, S, x, y, dx, dy, r) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.2));
  const sx = dx / steps, sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (sx) {
      if (!boxHits(blk, S, x + sx, y, r)) x += sx;
      else x = sx > 0 ? Math.min(x + sx, Math.floor(x + r + sx) - r - 1e-4) : Math.max(x + sx, Math.floor(x - r + sx) + 1 + r + 1e-4);
      if (boxHits(blk, S, x, y, r)) x -= sx; // 모서리 끼임 되돌리기
    }
    if (sy) {
      if (!boxHits(blk, S, x, y + sy, r)) y += sy;
      else y = sy > 0 ? Math.min(y + sy, Math.floor(y + r + sy) - r - 1e-4) : Math.max(y + sy, Math.floor(y - r + sy) + 1 + r + 1e-4);
      if (boxHits(blk, S, x, y, r)) y -= sy;
    }
  }
  return { x, y };
}

/** 지금 칸이 막혀 있으면(건물이 섰거나 바위가 다시 섰을 때) 가장 가까운 빈 곳으로 꺼낸다 */
export function unstick(blk, S, x, y, r) {
  if (!boxHits(blk, S, x, y, r)) return { x, y };
  for (let d = 0.25; d < 8; d += 0.25)
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const nx = x + Math.cos(a) * d, ny = y + Math.sin(a) * d;
      if (!boxHits(blk, S, nx, ny, r)) return { x: nx, y: ny };
    }
  return { x, y };
}

export function newHeroBody(x, y) {
  return { x, y, vx: 0, vy: 0, kvx: 0, kvy: 0, z: 0, vz: 0, air: 0, airJumps: 0, dashT: 0, dashX: 0, dashY: 0, dashCd: 0, stun: 0, slow: 0, charging: false };
}

/** 속력 배율: 끈끈이 · 충전 · (밖에서 곱해 주는) 부스터 · 보석 */
export function heroSpeedMul(h, extra = 1) {
  let m = extra;
  if (h.slow > 0) m *= SLOW.FACTOR;
  if (h.charging) m *= HERO.CHARGE_SLOW;
  return m;
}

export function heroStep(h, input, dt, blk, S, mul = 1) {
  // 대시
  h.dashCd = Math.max(0, h.dashCd - dt);
  if (input.dash && h.dashCd <= 0 && h.stun <= 0) {
    const l = Math.hypot(input.dash.x, input.dash.y) || 1;
    h.dashX = input.dash.x / l; h.dashY = input.dash.y / l;
    h.dashT = DASH.TIME; h.dashCd = DASH.COOLDOWN;
  }
  // 점프(화면 높이 u)
  if (input.jump) {
    if (h.z <= 0.001) { h.vz = JUMP.SPEED; h.airJumps = 0; }
    else if (h.airJumps < JUMP.AIR_MAX) { h.vz = Math.max(h.vz, JUMP.AIR_SPEED); h.airJumps++; }
  }
  if (h.z > 0 || h.vz > 0) {
    h.vz -= JUMP.GRAVITY * dt;
    h.z += h.vz * dt;
    if (h.z <= 0) { h.z = 0; h.vz = 0; }
  }
  // 조작 속도(가속 · 마찰)
  const ctl = h.stun > 0 ? HERO.STUN_CONTROL : 1;
  const sp = HERO.SPEED * heroSpeedMul(h, mul);
  const mx = input.mx || 0, my = input.my || 0;
  if (mx || my) {
    const tx = mx * sp, ty = my * sp;
    const ax = tx - h.vx, ay = ty - h.vy;
    const al = Math.hypot(ax, ay), step = HERO.ACCEL * ctl * dt;
    if (al <= step) { h.vx = tx; h.vy = ty; } else { h.vx += (ax / al) * step; h.vy += (ay / al) * step; }
  } else {
    const f = Math.exp(-HERO.FRICTION * dt);
    h.vx *= f; h.vy *= f;
  }
  // 넉백(따로 줄어든다)
  const kd = Math.exp(-THROW.KB_DECAY * dt);
  h.kvx *= kd; h.kvy *= kd;
  if (Math.abs(h.kvx) < 0.02) h.kvx = 0;
  if (Math.abs(h.kvy) < 0.02) h.kvy = 0;
  let dx = (h.vx + h.kvx) * dt, dy = (h.vy + h.kvy) * dt;
  if (h.dashT > 0) {
    h.dashT -= dt;
    dx = h.dashX * DASH.SPEED * dt + h.kvx * dt;
    dy = h.dashY * DASH.SPEED * dt + h.kvy * dt;
  }
  const p = slide(blk, S, h.x, h.y, dx, dy, HERO.RADIUS);
  // 벽에 막힌 축의 속도는 지운다(벽에 붙어 미끄러질 때 튀지 않게)
  if (Math.abs(p.x - h.x) < Math.abs(dx) * 0.5) { h.vx = 0; h.kvx = 0; }
  if (Math.abs(p.y - h.y) < Math.abs(dy) * 0.5) { h.vy = 0; h.kvy = 0; }
  h.x = p.x; h.y = p.y;
  h.stun = Math.max(0, h.stun - dt);
  h.slow = Math.max(0, h.slow - dt);
  return h;
}
