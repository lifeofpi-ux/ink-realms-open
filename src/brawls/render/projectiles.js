// 풍선 · 미사일 · 메가 잉크 폭탄(ink-brawl 원본 모양 — balloons.js 의 인스턴스 묶음), 조준 표시, 폭탄이 떨어질 자리.
// 풍선은 공중의 그 자리에 있는 진짜 3D 모양이라 장애물 · 캐릭터와 깊이가 저절로 맞는다. 그림자는 바닥 얼룩.
import { PALETTE, BALLOON, BALLOON_KINDS, balloonApex } from "../shared/constants.js";
import { MODE, SHAPE } from "./sprites.js";
import { MAP_COLORS, darkHex } from "./palette.js";
import { createBalloonBatch } from "./balloons.js";

const hexOf = (i) => PALETTE[((i ?? 0) % PALETTE.length + PALETTE.length) % PALETTE.length].hex;
const kindOf = (k) => BALLOON_KINDS[k] || BALLOON_KINDS[0];

// 풍선 묶음: 처음 그릴 때 구 묶음(spheres.js)의 자식으로 장면에 건다(섬광 점광 유니폼도 그것을 빌린다)
let batch = null;
let batchParent = null;
function balloons(spheres) {
  if (batch && batchParent === spheres.mesh) return batch;
  if (batch) for (const m of batch.meshes) if (m.parent) m.parent.remove(m);
  batch = createBalloonBatch(spheres.mesh.material.uniforms);
  batchParent = spheres.mesh;
  for (const m of batch.meshes) batchParent.add(m);
  return batch;
}

/**
 * 날아가는 풍선 하나. (x, y, z) = 풍선 가운데. o = { big, color(PALETTE 번호), kind, gy, dx, dz(날아가는 쪽 — 미사일), decalShadow }
 */
export function drawBalloon(B, x, y, z, o) {
  const K = kindOf(o.kind);
  const gy = o.gy ?? 0;
  const r = (o.big ? BALLOON.BIG.r : BALLOON.SMALL.r) * (K.size || 1);
  const air = Math.max(0, y - gy);
  if (o.decalShadow) {
    const s = Math.max(0.3, r * 2.2 * (1.1 - air * 0.05));
    B.decals.push(x + 0.25 + air * 0.25, gy + 0.01, z + 0.18 + air * 0.2, s, s * 0.7, MAP_COLORS.shadow, 0.28, SHAPE.DISC, 0, MODE.FLAT, 0.01);
  }
  const b = balloons(B.spheres);
  const time = performance.now() / 1000;
  const seed = (o.color ?? 0) * 1.7 + (o.kind ?? 0) * 0.9;
  if (K.nuke) {
    b.bomb(x, y, z, BALLOON.BIG.r * (K.size || 1), o.color ?? 0, seed, time);
    return;
  }
  const rr = (o.big ? BALLOON.BIG.r : BALLOON.SMALL.r) * (K.size || 1);
  if (K.direct) {
    b.balloon(x, y, z, rr, o.color ?? 0, seed, time, o.dx || 1, o.dz || 0);
    return;
  }
  b.balloon(x, y, z, rr, o.color ?? 0, seed, time);
}

/**
 * 조준 표시: 던질 궤적(점선)과 떨어질 자리의 고리. 미사일(line > 0)은 그 높이의 곧은 점선.
 * a = { x, z, y0, tx, tz, ty, line, charge, color, canThrow, splashScale, lock }
 */
export function drawAim(fx, a, time) {
  const blink = a.lock && Math.sin(time * 44) > -0.2;
  const base = hexOf(a.color);
  const col = a.lock ? (blink ? 0xffffff : base) : base;
  const alpha = a.canThrow ? (a.lock ? 0.95 : 0.75) : 0.2;
  const dx = a.tx - a.x, dz = a.tz - a.z;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.round(dist / 0.85));
  if (a.line > 0) {
    for (let i = 1; i <= steps; i++) {
      const s = i / steps;
      fx.push(a.x + dx * s, a.line, a.z + dz * s, 0.14, 0.14, col, alpha, SHAPE.DISC, 0, MODE.FACE, 0.05);
    }
    fx.push(a.tx, a.line, a.tz, 0.45, 0.45, col, alpha, SHAPE.RING, 0.3, MODE.FACE, 0.05);
    return;
  }
  const y0 = (a.y0 || 0) + BALLOON.HAND_HEIGHT;
  const apex = balloonApex(dist);
  for (let i = 1; i < steps; i++) {
    const s = i / steps;
    const y = y0 + ((a.ty || 0) - y0) * s + 4 * apex * s * (1 - s);
    fx.push(a.x + dx * s, y, a.z + dz * s, 0.13, 0.13, col, alpha * 0.85, SHAPE.DISC, 0, MODE.FACE, 0.05);
  }
  const big = a.charge >= 1;
  const r = (big ? BALLOON.BIG.splash : BALLOON.SMALL.splash) * (a.splashScale || 1);
  fx.push(a.tx, (a.ty || 0) + 0.01, a.tz, r * 2, r * 2, darkHex(col, 0.8), alpha * (big ? 1 : 0.8), SHAPE.RING, big ? 0.09 : 0.05, MODE.FLAT, 0.03);
  if (a.charge > 0) fx.push(a.tx, (a.ty || 0) + 0.01, a.tz, r * 2 * a.charge, r * 2 * a.charge, col, 0.2, SHAPE.DISC, 0, MODE.FLAT, 0.025);
}

/** 메가 잉크 폭탄이 떨어질 자리: 깜빡이며 차오르는 고리. progress 0..1 */
export function drawBombMark(fx, x, z, radius, progress, color, time, gy = 0) {
  const on = Math.sin(time * (10 + progress * 20)) > -0.3;
  const c = hexOf(color);
  fx.push(x, gy + 0.01, z, radius * 2, radius * 2, c, on ? 0.9 : 0.4, SHAPE.RING, 0.06, MODE.FLAT, 0.03, 0.5);
  fx.push(x, gy + 0.01, z, radius * 2 * progress, radius * 2 * progress, c, 0.2, SHAPE.DISC, 0, MODE.FLAT, 0.025);
}
