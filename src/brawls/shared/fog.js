// 전장의 안개(docs/DESIGN.md §3.8)의 시야 판정. 서버(server/room.js — 스냅샷 · 사건을 팀마다 나눈다 · 봇 표적)와
// 화면(안개 텍스처 · 미니맵)이 같은 함수를 쓴다. 순수 함수: Math.random · 시간 · DOM 을 쓰지 않는다. 수치는 shared/constants.js 의 FOG.
//
// 팀의 시야 = 살아 있는 팀원마다 반지름 FOG.R 의 원 ∪ 우리 홈 띠(사각형)를 FOG.HOME_PAD 만큼 넓힌 곳 ∪ 우리 집결 깃발 둘레 FOG.RALLY_R.
// 장애물은 시야를 가리지 않는다.

import { FOG, FLAG } from "./constants.js";

/** 살아 있는가(서버 상태의 alive 또는 화면 항목의 flags). */
function alive(o) {
  if (o.alive !== undefined) return !!o.alive;
  return ((o.flags | 0) & FLAG.ALIVE) !== 0;
}

/**
 * 팀 team 의 시야를 만든다.
 * @param {number} team
 * @param {Iterable<{x:number, z:number, team:number, alive?:boolean, flags?:number}>} players  같은 경기의 캐릭터들(서버 p 또는 game.view)
 * @param {{x:number, z:number, hx:number, hz:number}|null} [home]  우리 홈 띠(arena.homes 의 항목 — 가운데와 반변)
 * @param {Array<{x:number, z:number}>} [flags]  우리 집결 깃발들(보통 0 · 1개)
 * @returns {{team:number, eyes:number[], home:object|null, flags:Array<{x:number, z:number}>}}  eyes = [x0, z0, x1, z1, …]
 */
export function makeVision(team, players, home = null, flags = []) {
  const eyes = [];
  for (const p of players) if (p.team === team && alive(p)) eyes.push(p.x, p.z);
  return { team, eyes, home: home || null, flags: flags || [] };
}

/**
 * 시야 v 안에서 (x, z) 가 보이는가. pad = 대상의 반지름(캐릭터는 몸이 조금이라도 들어오면 보인다 — PLAYER.RADIUS).
 */
export function canSee(v, x, z, pad = 0) {
  const R = FOG.R + pad, R2 = R * R;
  const e = v.eyes;
  for (let i = 0; i < e.length; i += 2) {
    const dx = e[i] - x, dz = e[i + 1] - z;
    if (dx * dx + dz * dz <= R2) return true;
  }
  const h = v.home;
  if (h && Math.abs(x - h.x) <= h.hx + FOG.HOME_PAD + pad && Math.abs(z - h.z) <= h.hz + FOG.HOME_PAD + pad) return true;
  const F = FOG.RALLY_R + pad, F2 = F * F;
  for (const f of v.flags) {
    const dx = f.x - x, dz = f.z - z;
    if (dx * dx + dz * dz <= F2) return true;
  }
  return false;
}

/**
 * 선분 (x0, z0) → (x1, z1) 의 어느 곳이라도 시야 안에 드는가(풍선 · 미사일의 길 — 날아오는 것이 보이는가).
 * 시야의 원 · 사각형과 선분의 가장 가까운 거리로 본다.
 */
export function canSeeSegment(v, x0, z0, x1, z1, pad = 0) {
  if (canSee(v, x0, z0, pad) || canSee(v, x1, z1, pad)) return true;
  const dx = x1 - x0, dz = z1 - z0;
  const l2 = dx * dx + dz * dz;
  if (!(l2 > 1e-9)) return false;
  const near = (cx, cz, r) => {
    const t = Math.max(0, Math.min(1, ((cx - x0) * dx + (cz - z0) * dz) / l2));
    const qx = x0 + dx * t - cx, qz = z0 + dz * t - cz;
    return qx * qx + qz * qz <= r * r;
  };
  const e = v.eyes;
  for (let i = 0; i < e.length; i += 2) if (near(e[i], e[i + 1], FOG.R + pad)) return true;
  for (const f of v.flags) if (near(f.x, f.z, FOG.RALLY_R + pad)) return true;
  const h = v.home;
  if (h) {
    // 사각형: 선분을 잘게 나눠 본다(홈 띠는 넓어 몇 점이면 충분하다)
    const steps = Math.min(64, Math.ceil(Math.sqrt(l2) / 1));
    for (let k = 1; k < steps; k++) {
      const x = x0 + (dx * k) / steps, z = z0 + (dz * k) / steps;
      if (Math.abs(x - h.x) <= h.hx + FOG.HOME_PAD + pad && Math.abs(z - h.z) <= h.hz + FOG.HOME_PAD + pad) return true;
    }
  }
  return false;
}
