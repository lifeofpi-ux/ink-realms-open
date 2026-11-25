// 경기장 충돌 · 판정용 자료와 함수. 잉크 브로울스가 화면에 내놓는 경기장은 맨 아래의 "잉크 운동장"(퀴즈 · 아케이드 —
// 정사각형 벽 경기장, 홈 6 · 퀴즈 룸 5, docs/DESIGN.md §5)이다. 그 앞의 "네온 풀"(ARENA — 낙하전)과 "잉크 공장"(HP_ARENA —
// ink-brawl 의 체력전)은 시뮬레이션과 기존 시험을 위해 남겨 둔 것이다(arenaAt 의 mode "fall" · "hp").
//
// 아래 그림은 ink-brawl 시절의 시점(+Z 쪽에서 내려다봄) 기준이다. 잉크 브로울스의 화면은 45° 돌아가 있다
// (docs/CONTRACT.md 「좌표와 투영」).
//
// ---- 네온 풀(낙하전) ----
// 서버와 클라이언트 예측이 같이 쓴다. 결정적이어야 하므로 DOM · three · 난수 · 삼각함수를 쓰지 않는다
// (덧셈 · 곱셈 · 나눗셈 · 제곱근은 IEEE 754 가 결과를 정해 두어 엔진이 달라도 같은 값이 나온다).
//
// 위에서 본 모양(카메라는 +Z 쪽에서 본다 — 화면 아래가 +Z, 오른쪽이 +X):
//
//                  -Z
//            . - ~ ~ ~ - .
//        . '    ●     ●    ' .        ● 기둥 4개(대각선, 반지름 0.85)
//      /      ,-~~| |~~-.      \      가운데 원 = 중앙 섬(반지름 3.2)
//     |      / 풀 | | 풀 \      |     섬과 바깥 고리 사이 = 풀(잉크 바다로 뚫린 구멍) 4개
//  -X |     |===  섬   ===|     | +X  === , | | = 다리 4개(폭 2.4, 길이 약 1.9)
//     |      \ 풀 | | 풀 /      |     바깥 고리 = 반지름 5 ~ 11
//      \      `-~~| |~~-'      /
//        ' .    ●     ●    . '
//            ` - ~ ~ ~ - '
//                  +Z
//
// 바닥 = (r ≤ 3.2 인 섬) ∪ (5 ≤ r ≤ 11 인 고리) ∪ (3.2 < r < 5 띠에서 |x| ≤ 1.2 또는 |z| ≤ 1.2 인 다리).
// 떨어지는 곳 = 바깥(r > 11) 과 풀 4개. 시각 모듈(src/render/arena.js)은 아래 수치에서 메시를 만든다.

const OUTER_R = 11; // 바깥 가장자리 반지름
const RING_INNER_R = 5; // 바깥 고리의 안쪽 반지름(풀의 바깥 경계)
const ISLAND_R = 3.2; // 중앙 섬 반지름(풀의 안쪽 경계)
const BRIDGE_HALF = 1.2; // 다리 반폭. 다리 넷은 ±X, ±Z 축 위에 놓인다

const OUTER_R2 = OUTER_R * OUTER_R;
const RING_INNER_R2 = RING_INNER_R * RING_INNER_R;
const ISLAND_R2 = ISLAND_R * ISLAND_R;
// 다리 옆선이 섬 · 고리의 원과 만나는 점의 축 방향 좌표
const BRIDGE_S0 = Math.sqrt(ISLAND_R2 - BRIDGE_HALF * BRIDGE_HALF);
const BRIDGE_S1 = Math.sqrt(RING_INNER_R2 - BRIDGE_HALF * BRIDGE_HALF);

export const ARENA = {
  radius: OUTER_R,

  // 원기둥 장애물. 바깥 고리의 대각선 위(중심에서 약 7.92u)에 하나씩 — 풀과 바깥 가장자리 사이 길목을 둘로 가른다.
  // 좌표는 삼각함수 없이 적은 값이라 어느 엔진에서나 같다. color = PALETTE 인덱스.
  obstacles: [
    { id: 0, x: 5.6, z: -5.6, r: 0.85, h: 2.4, color: 2 }, // 화면 오른쪽 위 · 라임
    { id: 1, x: -5.6, z: -5.6, r: 0.85, h: 2.4, color: 3 }, // 왼쪽 위 · 네온 오렌지
    { id: 2, x: -5.6, z: 5.6, r: 0.85, h: 2.4, color: 5 }, // 왼쪽 아래 · 레몬
    { id: 3, x: 5.6, z: 5.6, r: 0.85, h: 2.4, color: 4 }, // 오른쪽 아래 · 울트라 바이올렛
  ],

  // 상자 장애물(축에 나란한 직육면체). 반변 hx · hz, 높이 h. kind 는 보이는 모양(crate 상자 · wall 엄폐벽 · stage 무대 · hurdle 허들).
  // 높이가 점프 높이(약 1.3u)보다 낮으면 뛰어 올라서거나 넘을 수 있다. 다리가 고리에 닿는 어귀 바로 바깥(r = 6.6)에
  // 낮은 점프 상자 넷 — 다리를 건너 나오면 뛰어넘거나 옆으로 돌아가야 한다.
  boxes: [
    { id: 0, x: 6.6, z: 0, hx: 0.7, hz: 0.7, h: 0.9, color: 1, kind: "crate" },
    { id: 1, x: 0, z: 6.6, hx: 0.7, hz: 0.7, h: 0.9, color: 1, kind: "crate" },
    { id: 2, x: -6.6, z: 0, hx: 0.7, hz: 0.7, h: 0.9, color: 1, kind: "crate" },
    { id: 3, x: 0, z: -6.6, hx: 0.7, hz: 0.7, h: 0.9, color: 1, kind: "crate" },
  ],

  // 부활 지점 8곳. 바깥 고리 한가운데(r = 8)에서 기둥과 다리 사이사이(22.5° + 45°·k).
  // 가장 가까운 가장자리까지 3.0u, 기둥 표면까지 약 2.25u, 서로는 약 6.1u.
  spawns: [
    { x: 7.39, z: 3.06 },
    { x: 3.06, z: 7.39 },
    { x: -3.06, z: 7.39 },
    { x: -7.39, z: 3.06 },
    { x: -7.39, z: -3.06 },
    { x: -3.06, z: -7.39 },
    { x: 3.06, z: -7.39 },
    { x: 7.39, z: -3.06 },
  ],

  // ---- 아래는 시각 모듈 · 미니 UI 가 쓰는 자료(계약 밖의 덧붙임) ----
  islandRadius: ISLAND_R,
  ringInnerRadius: RING_INNER_R,
  bridgeHalfWidth: BRIDGE_HALF,
  bridgeInner: BRIDGE_S0, // 다리 옆선의 시작(섬 쪽) — 축 방향 좌표
  bridgeOuter: BRIDGE_S1, // 다리 옆선의 끝(고리 쪽)
  seaY: -1.8, // 잉크 바다 수면 높이(바닥 윗면은 0)
  inkExtent: 12, // 잉크 텍스처가 덮는 정사각형의 반변: 월드 [-12, 12]² → UV [0, 1]²
  rimColor: 0, // 바깥 가장자리 발광선의 PALETTE 인덱스(핫핑크)
  poolColor: 1, // 풀 가장자리 발광선(일렉트릭 시안)
  // 점프 보드(바닥의 원판, 반지름 r). 가운데 섬 한복판 — 밟고 날아오르면 풀을 건너 바깥 고리 어디로든 내려앉을 수 있다
  pads: [{ id: 0, x: 0, z: 0, r: 0.9, color: 2 }],
};

/** 그 점 아래에 바닥이 있는가. 경계선 위는 바닥으로 친다. */
export function isOnPlatform(x, z) {
  const r2 = x * x + z * z;
  if (r2 > OUTER_R2) return false;
  if (r2 >= RING_INNER_R2) return true; // 바깥 고리
  if (r2 <= ISLAND_R2) return true; // 중앙 섬
  // 섬과 고리 사이 띠: 다리 위만 바닥
  return (x <= BRIDGE_HALF && x >= -BRIDGE_HALF) || (z <= BRIDGE_HALF && z >= -BRIDGE_HALF);
}

/**
 * pos = {x, z} 를 반지름 radius 인 원으로 보고 장애물 밖으로 밀어낸다. 밀었으면 true.
 * y = 발 높이(기본 0). 윗면이 y + JUMP_STEP 이하인 장애물은 막지 않는다(그 위에 올라서 있거나 넘어가는 중이다).
 * 장애물끼리 멀리 떨어져 있어 한 번 훑으면 충분하다.
 */
export function resolveObstacles(pos, radius, y = 0) {
  return resolveAll(ARENA.obstacles, ARENA.boxes, 0, pos, radius, y);
}

// shared/constants.js 의 JUMP.STEP_UP 과 같은 값(이 파일은 상수 모듈을 불러오지 않는다 — 문구 사전까지 끌려오지 않게)
const JUMP_STEP = 0.05;

/** 기둥 · 상자 · (벽이 있는 경기장이면) 둘레 벽. wallR > 0 이면 중심에서 wallR 안쪽으로 가둔다. */
function resolveAll(cyl, boxes, wallR, pos, radius, y) {
  let pushed = resolveIn(cyl, pos, radius, y);
  if (resolveBoxes(boxes, pos, radius, y)) pushed = true;
  if (wallR > 0) {
    const lim = wallR - radius;
    const d2 = pos.x * pos.x + pos.z * pos.z;
    if (d2 > lim * lim) {
      const d = Math.sqrt(d2);
      pos.x = (pos.x / d) * lim;
      pos.z = (pos.z / d) * lim;
      pushed = true;
    }
  }
  return pushed;
}

function resolveBoxes(list, pos, radius, y) {
  let pushed = false;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.h <= y + JUMP_STEP) continue;
    const lx = pos.x - b.x;
    const lz = pos.z - b.z;
    // 상자에서 가장 가까운 점
    const cx = lx < -b.hx ? -b.hx : lx > b.hx ? b.hx : lx;
    const cz = lz < -b.hz ? -b.hz : lz > b.hz ? b.hz : lz;
    const dx = lx - cx;
    const dz = lz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      pos.x = b.x + cx + (dx / d) * radius;
      pos.z = b.z + cz + (dz / d) * radius;
    } else {
      // 중심이 상자 안: 가장 얕은 쪽으로 꺼낸다(같으면 x 쪽 — 결정적이기만 하면 된다)
      const px = b.hx - (lx < 0 ? -lx : lx);
      const pz = b.hz - (lz < 0 ? -lz : lz);
      if (px <= pz) pos.x = b.x + (lx < 0 ? -(b.hx + radius) : b.hx + radius);
      else pos.z = b.z + (lz < 0 ? -(b.hz + radius) : b.hz + radius);
    }
    pushed = true;
  }
  return pushed;
}

function resolveIn(list, pos, radius, y = 0) {
  let pushed = false;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o.h <= y + JUMP_STEP) continue;
    const min = o.r + radius;
    let dx = pos.x - o.x;
    let dz = pos.z - o.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) continue;
    let d = Math.sqrt(d2);
    if (d < 1e-6) {
      // 정확히 중심에 겹친 경우: 무대 중심 쪽으로 민다(어느 쪽이든 결정적이기만 하면 된다)
      dx = -o.x;
      dz = -o.z;
      d = Math.sqrt(dx * dx + dz * dz);
      if (d < 1e-6) {
        dx = 1;
        dz = 0;
        d = 1;
      }
    }
    pos.x = o.x + (dx / d) * min;
    pos.z = o.z + (dz / d) * min;
    pushed = true;
  }
  return pushed;
}

/**
 * 반지름 r 인 공이 (x0,y0,z0) → (x1,y1,z1) 선분을 따라갈 때 기둥에 처음 닿는 t(0..1). 안 닿으면 -1.
 * 기둥을 r 만큼 부풀린 원기둥(반지름 o.r + r, 높이 -r .. o.h + r)과 선분의 교차로 계산한다.
 * 윗면 모서리에서만 최대 0.41·r 만큼 넉넉하게 잡힌다(풍선 기준 0.2u 이하). 출발점이 이미 안이면 0.
 */
export function segmentHitsObstacle(x0, y0, z0, x1, y1, z1, r) {
  return segmentAll(ARENA.obstacles, ARENA.boxes, x0, y0, z0, x1, y1, z1, r);
}

function segmentAll(cyl, boxes, x0, y0, z0, x1, y1, z1, r) {
  const a = segmentIn(cyl, x0, y0, z0, x1, y1, z1, r);
  const b = segmentBoxes(boxes, x0, y0, z0, x1, y1, z1, r);
  if (a < 0) return b;
  if (b < 0) return a;
  return a < b ? a : b;
}

/** 상자를 r 만큼 부풀린 직육면체(x · z 로 ±r, 높이 -r .. h + r)와 선분의 첫 교차 t. 모서리는 조금 넉넉하다. */
function segmentBoxes(list, x0, y0, z0, x1, y1, z1, r) {
  const d = [x1 - x0, y1 - y0, z1 - z0];
  const o = [x0, y0, z0];
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const lo = [b.x - b.hx - r, -r, b.z - b.hz - r];
    const hi = [b.x + b.hx + r, b.h + r, b.z + b.hz + r];
    let tIn = 0;
    let tOut = 1;
    let miss = false;
    for (let k = 0; k < 3; k++) {
      if (d[k] > 1e-12 || d[k] < -1e-12) {
        let ta = (lo[k] - o[k]) / d[k];
        let tb = (hi[k] - o[k]) / d[k];
        if (ta > tb) {
          const tmp = ta;
          ta = tb;
          tb = tmp;
        }
        if (ta > tIn) tIn = ta;
        if (tb < tOut) tOut = tb;
        if (tIn > tOut) { miss = true; break; }
      } else if (o[k] < lo[k] || o[k] > hi[k]) { miss = true; break; }
    }
    if (miss) continue;
    if (best < 0 || tIn < best) best = tIn;
  }
  return best;
}

/**
 * (x, z) 에 서 있을 때 발이 닿는 높이: 상자 · 기둥 윗면 위면 그 높이(겹치면 가장 높은 것), 아니면 바닥(0).
 * 중심점이 윗면 안에 있어야 그 위에 선 것으로 본다. 바닥이 있는지(낭떠러지)는 isOnPlatform 이 따로 본다.
 */
export function groundAt(x, z) {
  return groundIn(ARENA.obstacles, ARENA.boxes, x, z);
}

function groundIn(cyl, boxes, x, z) {
  let top = 0;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.h <= top) continue;
    const lx = x - b.x;
    const lz = z - b.z;
    if (lx <= b.hx && lx >= -b.hx && lz <= b.hz && lz >= -b.hz) top = b.h;
  }
  for (let i = 0; i < cyl.length; i++) {
    const o = cyl[i];
    if (o.h <= top) continue;
    const dx = x - o.x;
    const dz = z - o.z;
    if (dx * dx + dz * dz <= o.r * o.r) top = o.h;
  }
  return top;
}

function segmentIn(list, x0, y0, z0, x1, y1, z1, r) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const a = dx * dx + dz * dz;
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    const rad = o.r + r;
    const yLo = -r;
    const yHi = o.h + r;
    let tIn = 0;
    let tOut = 1;

    // 수평: |p0 + t·d - c|² <= rad²
    const fx = x0 - o.x;
    const fz = z0 - o.z;
    const c = fx * fx + fz * fz - rad * rad;
    if (a < 1e-12) {
      if (c > 0) continue; // 수직 선분이 원 밖
    } else {
      const b = fx * dx + fz * dz;
      const disc = b * b - a * c;
      if (disc < 0) continue;
      const s = Math.sqrt(disc);
      const t0 = (-b - s) / a;
      const t1 = (-b + s) / a;
      if (t0 > tIn) tIn = t0;
      if (t1 < tOut) tOut = t1;
      if (tIn > tOut) continue;
    }

    // 수직: yLo <= y0 + t·dy <= yHi
    if (dy > 1e-12 || dy < -1e-12) {
      let ta = (yLo - y0) / dy;
      let tb = (yHi - y0) / dy;
      if (ta > tb) {
        const tmp = ta;
        ta = tb;
        tb = tmp;
      }
      if (ta > tIn) tIn = ta;
      if (tb < tOut) tOut = tb;
      if (tIn > tOut) continue;
    } else if (y0 < yLo || y0 > yHi) {
      continue;
    }

    if (best < 0 || tIn < best) best = tIn;
  }
  return best;
}

// 점 (px, pz) 에서 선분 (ax, az)-(bx, bz) 까지의 거리
function distToSegment(px, pz, ax, az, bx, bz) {
  const ex = bx - ax;
  const ez = bz - az;
  let t = ((px - ax) * ex + (pz - az) * ez) / (ex * ex + ez * ez);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + ex * t - px;
  const qz = az + ez * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

/**
 * 가장 가까운 바닥 가장자리까지의 거리. 바닥 위면 양수(가장자리까지 남은 거리),
 * 바닥 밖이면 음수(바닥까지 돌아가야 하는 거리). 근사가 아니라 이 도형에 대한 정확한 값이다.
 */
export function edgeDistance(x, z) {
  // 네 사분면이 대칭이라 1사분면으로 접어서 본다
  const ax = x < 0 ? -x : x;
  const az = z < 0 ? -z : z;
  const r = Math.sqrt(ax * ax + az * az);

  if (r > OUTER_R) return OUTER_R - r; // 바깥으로 벗어남

  const inBand = r > ISLAND_R && r < RING_INNER_R;
  if (inBand && ax > BRIDGE_HALF && az > BRIDGE_HALF) {
    // 풀 안: 풀을 이루는 네 경계(섬 원, 고리 안쪽 원, 다리 옆선 둘) 가운데 가장 가까운 것
    let d = r - ISLAND_R;
    if (RING_INNER_R - r < d) d = RING_INNER_R - r;
    if (ax - BRIDGE_HALF < d) d = ax - BRIDGE_HALF;
    if (az - BRIDGE_HALF < d) d = az - BRIDGE_HALF;
    return -d;
  }

  // 바닥 위: 바깥 가장자리와, 같은 사분면의 풀 가운데 가까운 쪽
  let best = OUTER_R - r;

  // 풀의 경계는 원호 둘 + 다리 옆선 둘. 원호까지는 반지름 방향으로 잰다(그 발이 풀 구간 안일 때만).
  if (r > 1e-9) {
    if (r <= ISLAND_R) {
      const k = ISLAND_R / r;
      if (ax * k >= BRIDGE_HALF && az * k >= BRIDGE_HALF && ISLAND_R - r < best) best = ISLAND_R - r;
    } else if (r >= RING_INNER_R) {
      const k = RING_INNER_R / r;
      if (ax * k >= BRIDGE_HALF && az * k >= BRIDGE_HALF && r - RING_INNER_R < best) best = r - RING_INNER_R;
    }
  }
  // 다리 옆선(끝점 = 풀의 모서리) — 원호의 발이 구간 밖일 때의 최단점도 이 끝점들이다
  const d1 = distToSegment(ax, az, BRIDGE_S0, BRIDGE_HALF, BRIDGE_S1, BRIDGE_HALF); // +X 다리의 옆선
  if (d1 < best) best = d1;
  const d2 = distToSegment(ax, az, BRIDGE_HALF, BRIDGE_S0, BRIDGE_HALF, BRIDGE_S1); // +Z 다리의 옆선
  if (d2 < best) best = d2;
  return best;
}

// ---- 체력전 경기장 "잉크 공장" ----
// 둘레가 벽(반지름 11)으로 막혀 있어 떨어지지 않는다. 승부는 체력으로만 난다. 위에서 본 모양(4방향 대칭):
//
//                 -Z
//          . - ~ ~ ~ ~ ~ - .            ━ 허들(낮은 막대, 높이 0.55 — 뛰어넘는다) — 축 위 r = 9
//       .'        ━━━        '.         ▬ 엄폐벽(높이 1.7 — 못 넘는다) — 축 위 r = 6.4
//     /    ▣      ▬▬▬      ▣    \       ▣ 점프 상자(높이 1.0 — 올라선다) — 대각선 (±5.9, ±5.9)
//    |        ●         ●        |      ● 기둥(높이 2.4) — 대각선 (±3.6, ±3.6)
// -X |  ┃ ▮        ▦        ▮ ┃  | +X   ▦ 가운데 무대(높이 0.9, 2.6 × 2.6 — 올라서면 사방이 보인다)
//    |        ●         ●        |
//     \    ▣      ▬▬▬      ▣    /
//       '.        ━━━        .'
//          ' - ~ ~ ~ ~ ~ - '
//                 +Z
const HP_R = 11;
const HP_R2 = HP_R * HP_R;

export const HP_ARENA = {
  radius: HP_R,
  walled: true, // 둘레 벽이 있다(떨어지지 않는다)
  wallHeight: 1.6, // 둘레 벽의 보이는 높이(판정은 높이와 상관없이 언제나 막는다)
  obstacles: [
    { id: 0, x: 3.6, z: -3.6, r: 0.75, h: 2.4, color: 2 },
    { id: 1, x: -3.6, z: -3.6, r: 0.75, h: 2.4, color: 3 },
    { id: 2, x: -3.6, z: 3.6, r: 0.75, h: 2.4, color: 5 },
    { id: 3, x: 3.6, z: 3.6, r: 0.75, h: 2.4, color: 4 },
  ],
  boxes: [
    { id: 0, x: 0, z: 0, hx: 1.3, hz: 1.3, h: 0.9, color: 6, kind: "stage" },
    { id: 1, x: 0, z: -6.4, hx: 2.2, hz: 0.35, h: 1.7, color: 0, kind: "wall" },
    { id: 2, x: 0, z: 6.4, hx: 2.2, hz: 0.35, h: 1.7, color: 0, kind: "wall" },
    { id: 3, x: -6.4, z: 0, hx: 0.35, hz: 2.2, h: 1.7, color: 1, kind: "wall" },
    { id: 4, x: 6.4, z: 0, hx: 0.35, hz: 2.2, h: 1.7, color: 1, kind: "wall" },
    { id: 5, x: 5.9, z: -5.9, hx: 0.7, hz: 0.7, h: 1.0, color: 2, kind: "crate" },
    { id: 6, x: -5.9, z: -5.9, hx: 0.7, hz: 0.7, h: 1.0, color: 3, kind: "crate" },
    { id: 7, x: -5.9, z: 5.9, hx: 0.7, hz: 0.7, h: 1.0, color: 5, kind: "crate" },
    { id: 8, x: 5.9, z: 5.9, hx: 0.7, hz: 0.7, h: 1.0, color: 4, kind: "crate" },
    { id: 9, x: 0, z: -9, hx: 1.6, hz: 0.25, h: 0.55, color: 7, kind: "hurdle" },
    { id: 10, x: 0, z: 9, hx: 1.6, hz: 0.25, h: 0.55, color: 7, kind: "hurdle" },
    { id: 11, x: -9, z: 0, hx: 0.25, hz: 1.6, h: 0.55, color: 7, kind: "hurdle" },
    { id: 12, x: 9, z: 0, hx: 0.25, hz: 1.6, h: 0.55, color: 7, kind: "hurdle" },
  ],
  // 출발점 8곳: r = 8.6, 22.5° + 45°·k(장애물 사이사이). 앞 넷은 북쪽(-Z) 반, 뒤 넷은 남쪽(+Z) 반 — 팀전에서 편을 가른다
  spawns: [
    { x: 7.95, z: -3.29 },
    { x: 3.29, z: -7.95 },
    { x: -3.29, z: -7.95 },
    { x: -7.95, z: -3.29 },
    { x: -7.95, z: 3.29 },
    { x: -3.29, z: 7.95 },
    { x: 3.29, z: 7.95 },
    { x: 7.95, z: 3.29 },
  ],
  seaY: -1.8,
  inkExtent: 12, // 잉크 텍스처가 덮는 정사각형의 반변(네온 풀과 같은 약속)
  rimColor: 1, // 둘레 벽 발광선(시안)
  // 점프 보드 4: 엄폐벽과 허들 사이(축 위 r = 7.75). 밟고 안쪽으로 날면 엄폐벽을 넘어 가운데 무대로 뛰어든다
  pads: [
    { id: 0, x: 7.75, z: 0, r: 0.65, color: 2 },
    { id: 1, x: -7.75, z: 0, r: 0.65, color: 2 },
    { id: 2, x: 0, z: 7.75, r: 0.65, color: 2 },
    { id: 3, x: 0, z: -7.75, r: 0.65, color: 2 },
  ],
};

/** (x, z) 가 점프 보드 위인가. 보드면 그 보드, 아니면 null */
function padIn(pads, x, z) {
  for (let i = 0; i < pads.length; i++) {
    const d = pads[i];
    const dx = x - d.x, dz = z - d.z;
    if (dx * dx + dz * dz <= d.r * d.r) return d;
  }
  return null;
}

function hpOnPlatform(x, z) {
  return x * x + z * z <= HP_R2;
}

/** 체력전 경기장의 "가장자리"는 둘레 벽이다(봇이 구석에 몰리지 않게 쓴다). 바닥 밖이면 음수. */
function hpEdgeDistance(x, z) {
  return HP_R - Math.sqrt(x * x + z * z);
}

// ---- 잉크 운동장(퀴즈 · 아케이드 — docs/DESIGN.md §5 격자 맵 · §7.2 부서지는 블록) ----
// 경기장은 칸(TILE) 종류의 2차원 배열 하나다. 1칸 = CELL(2u). 정원 18명 이하 28 × 28칸(56u), 36명 이하 36 × 36칸(72u).
// 칸 (c, r)(열 · 행, 0 부터)의 가운데 = 월드 (c·2 − n + 1, r·2 − n + 1), 칸 번호 i = r·n + c. 화면 위(YAW 0°) = 월드 −z = 행 번호가 작은 쪽.
//  - 블록(단단한 블록 · 부서지는 블록 · 전광판 받침 · 바깥 벽)은 캐릭터를 높이와 상관없이 막는다(순수한 2차원 칸 판정 —
//    점프 · 공중제비 · 점프 보드로도 넘거나 올라서지 못한다. 그래서 groundAt 은 늘 0 이다).
//  - 포물선 풍선은 그 칸 블록의 높이(BLOCK.SOLID_H · BREAK_H)보다 높으면 넘어간다. 바깥 벽은 풍선도 못 넘는다.
//    곧게 나는 미사일(높이 1.0)은 블록에 막힌다.
//  - 부서지는 블록의 지금 상태는 경기마다 따로 가진다(newArena — 서버는 여러 경기를 동시에 돌린다). 충돌 함수는 그 상태를 인자로 받는다
//    (gridResolve · gridSegment …). arenaAt 이 돌려주는 캐시된 객체는 "처음 상태"(블록 전부 있음)라 그리기 · 시험용이다.
// 배치(§5.2): 홈 띠 6곳(위 · 아래 변에 하나씩, 좌 · 우 변에 둘씩, 폭 3칸), 퀴즈 룸 5곳(가운데 + 네 귀퉁이 쪽). 룸은 존(원에 가까운
// 칸 묶음) 둘레를 담으로 두르고 문 셋(좌 · 우 · 아래, 2칸 폭), 존의 −z 쪽 9u 에 전광판 받침(B)이 서고 그 사이는 비어 있다.
// 좌우 대칭이다(열 c ↔ n − 1 − c). 위아래는 홈 · 룸 자리가 대칭이고, 전광판이 늘 존의 위쪽에 서는 만큼만 다르다.
// 부서지는 블록을 하나도 부수지 않아도 모든 홈에서 모든 퀴즈 룸까지 2칸 폭 길이 있다(test/arena.test.js 가 증명한다).
import { BLOCK } from "./constants.js";

export const CELL = 2; // 칸 한 변(u)
/** 칸 종류. 배열 값 그대로 렌더러 · 미니맵 · 봇이 읽는다. */
export const TILE = {
  FLOOR: 0, // 바닥(체크무늬)
  SOLID: 1, // 단단한 블록(부서지지 않는다)
  BREAK: 2, // 부서지는 블록(잉크 폭발에 부서진다 — 지금 있는지는 경기의 blocks 배열)
  WALL: 3, // 바깥 벽(풍선도 못 넘는다)
  HOME: 4, // 홈 띠(팀 진영 · 부활 · 홈 소환 자리)
  ZONE: 5, // 퀴즈 존 바닥
  PAD: 6, // 점프 보드(칸 가운데의 원판)
  BOARD: 7, // 전광판 받침(단단한 블록처럼 막는다)
  WATER: 8, // 잉크 강(v8 — docs/DESIGN.md §3.0): 캐릭터는 높이와 상관없이 못 건넌다(넉백으로 밀려도 강가에서 막힌다). 풍선 · 미사일은 넘어간다. 아이템 · 설치물은 놓이지 않는다
  BRIDGE: 9, // 다리: 강을 걸어서 건넌다(바닥과 같다 — 블록이 서지 않는 길목)
  GATE: 10, // 던전의 문(v15 — docs/DESIGN.md §2.15): 닫혀 있으면 blocks 1(지나갈 수 없고 폭발 · 드릴에 부서지지 않는다), 방을 깨면 열린다(blocks 0)
};
const TILE_OF = { ".": TILE.FLOOR, X: TILE.SOLID, b: TILE.BREAK, "#": TILE.WALL, H: TILE.HOME, z: TILE.ZONE, P: TILE.PAD, B: TILE.BOARD, "~": TILE.WATER, "=": TILE.BRIDGE };

// 맵 자료: rows(위 행부터, 글자 하나가 칸 하나 — . 바닥 · X 단단한 블록 · b 부서지는 블록 · # 바깥 벽 · H 홈 띠 · z 존 · P 점프 보드 · B 전광판 받침 ·
//   ~ 잉크 강 · = 다리),
// homes(홈 번호 순서의 칸 사각형 [c0, r0, c1, r1] — 0 위 · 1 아래 · 2 왼쪽 위 · 3 오른쪽 위 · 4 왼쪽 아래 · 5 오른쪽 아래),
// rooms(퀴즈 룸 번호 순서의 존 가운데 — 칸 모서리 [열, 행]. 0 가운데 · 1 왼쪽 위 · 2 오른쪽 위 · 3 왼쪽 아래 · 4 오른쪽 아래), zoneR(존 칸 묶음의 반지름 u)
const YARD_MAPS = {
  28: {
    zoneR: 4.5,
    homes: [[12, 1, 15, 3], [12, 24, 15, 26], [1, 9, 3, 11], [24, 9, 26, 11], [1, 16, 3, 18], [24, 16, 26, 18]],
    rooms: [[14, 14], [7, 6], [21, 6], [7, 22], [21, 22]],
    rows: [
    "############################",
    "#...XBBBBX..HHHH..XBBBBX...#",
    "#...X....Xb.HHHH.bX....X...#",
    "#.X.X....X..HHHH..X....X.X.#",
    "#...XzzzzX........XzzzzX...#",
    "#....zzzz..........zzzz....#",
    "#....zzzz...XbbX...zzzz....#",
    "#.P.bzzzzb........bzzzzb.P.#",
    "#...Xb..bX.P....P.Xb..bX...#",
    "#HHH.......XBBBBX.......HHH#",
    "#HHH.......X....X.......HHH#",
    "#HHH....P..X....X..P....HHH#",
    "#.....X....XzzzzX....X.....#",
    "#~~==~~~~==.zzzz.==~~~~==~~#",
    "#~~==~~~~==.zzzz.==~~~~==~~#",
    "#.....X....bzzzzb....X.....#",
    "#HHH.......Xb..bX.......HHH#",
    "#HHHXBBBBX........XBBBBXHHH#",
    "#HHHX....Xb......bX....XHHH#",
    "#...X....X........X....X...#",
    "#...XzzzzX..XbbX..XzzzzX...#",
    "#....zzzz..........zzzz....#",
    "#....zzzz.X......X.zzzz....#",
    "#...bzzzzb........bzzzzb...#",
    "#.X.Xb..bX..HHHH..Xb..bX.X.#",
    "#...........HHHH...........#",
    "#....P......HHHH......P....#",
    "############################",
    ],
  },
  36: {
    zoneR: 6,
    homes: [[15, 1, 20, 3], [15, 32, 20, 34], [1, 12, 3, 15], [32, 12, 34, 15], [1, 20, 3, 23], [32, 20, 34, 23]],
    rooms: [[18, 18], [8, 9], [28, 9], [8, 27], [28, 27]],
    rows: [
    "####################################",
    "#..............HHHHHH..............#",
    "#......b.......HHHHHH.......b......#",
    "#..............HHHHHH..............#",
    "#...XXBBBBXX............XXBBBBXX...#",
    "#...X......X............X......X...#",
    "#.X.XXzzzzXX............XXzzzzXX.X.#",
    "#...XzzzzzzX..XXbbbbXX..XzzzzzzX...#",
    "#....zzzzzz..............zzzzzz....#",
    "#.P..zzzzzz..............zzzzzz..P.#",
    "#...bzzzzzzb.X..P..P..X.bzzzzzzb...#",
    "#...XXzzzzXX............XXzzzzXX...#",
    "#HHHXXb..bXX............XXb..bXXHHH#",
    "#HHH..........XXBBBBXX..........HHH#",
    "#HHH........P.X......X.P........HHH#",
    "#HHH..X.......XXzzzzXX.......X..HHH#",
    "#........X....XzzzzzzX....X........#",
    "#~~==~~~~~~==..zzzzzz..==~~~~~~==~~#",
    "#~~==~~~~~~==..zzzzzz..==~~~~~~==~~#",
    "#........X....bzzzzzzb....X........#",
    "#HHH..X.......XXzzzzXX.......X..HHH#",
    "#HHH........P.XXb..bXX.P........HHH#",
    "#HHHXXBBBBXX............XXBBBBXXHHH#",
    "#HHHX......X............X......XHHH#",
    "#...XXzzzzXX............XXzzzzXX...#",
    "#...XzzzzzzX.X........X.XzzzzzzX...#",
    "#....zzzzzz..............zzzzzz....#",
    "#....zzzzzz..............zzzzzz....#",
    "#...bzzzzzzb..XXbbbbXX..bzzzzzzb...#",
    "#.X.XXzzzzXX............XXzzzzXX.X.#",
    "#...XXb..bXX............XXb..bXX...#",
    "#..........bb...P..P...bb..........#",
    "#..............HHHHHH..............#",
    "#....P.b.......HHHHHH.......b.P....#",
    "#..............HHHHHH..............#",
    "####################################",
    ],
  },
};
const YARD_BOARD = 9; // 전광판까지의 거리(존 가운데에서 −z) — shared/constants.js 의 QUIZ.BOARD_DIST 와 같다(시험이 본다)

// 팀 수 → 팀마다 쓸 홈(팀 번호 순). 마주 보는 자리부터: 2팀 위 · 아래, 3팀 위 + 아래 양옆, 4팀 좌 · 우 넷, 5팀 + 위, 6팀 모두
const HOME_SETS = { 1: [0], 2: [0, 1], 3: [0, 4, 5], 4: [2, 3, 4, 5], 5: [0, 2, 3, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
// 룸 수 → 쓸 룸(좌우 대칭이 깨지지 않는 묶음)
const SITE_SETS = { 1: [0], 2: [1, 2], 3: [0, 3, 4], 4: [1, 2, 3, 4], 5: [0, 1, 2, 3, 4] };

/** 팀 수(1..6) → 팀 번호마다 쓰는 홈 번호 배열. 범위를 벗어나면 가까운 값으로 자른다. */
export function homeSlots(teamCount) {
  const n = Math.max(1, Math.min(6, teamCount | 0 || 2));
  return HOME_SETS[n];
}

/** 퀴즈 룸 수(1..5) → 쓸 룸 번호 배열. */
export function quizSites(rooms) {
  const n = Math.max(1, Math.min(5, rooms | 0 || 1));
  return SITE_SETS[n];
}

/** 정원(봇 포함) → 잉크 운동장의 scale. 18명 이하 1(28칸), 그보다 많으면 9/7(36칸). welcome.map 에 실린다. */
export function yardScale(players) {
  return players > 18 ? 9 / 7 : 1;
}

/** scale → 맵 한 변의 칸 수(28 | 36). */
export const yardSize = (scale) => (scale > 1 ? 36 : 28);

// ---- 칸 격자 함수(경기마다 따로 가진 칸 상태 grid 를 인자로 받는다) ----
// grid = { n, half(= n, 월드 반변 u), tiles(Uint8Array 칸 종류), blocks(Uint8Array — 부서지는 블록이 지금 있으면 1) }

/** 월드 좌표의 칸 번호. 맵 밖이면 −1. */
export function cellAt(grid, x, z) {
  const n = grid.n;
  const c = Math.floor((x + n) / CELL), r = Math.floor((z + n) / CELL);
  return c < 0 || r < 0 || c >= n || r >= n ? -1 : r * n + c;
}

/**
 * 칸 i 가 지금 캐릭터를 막는가(단단한 블록 · 전광판 받침 · 바깥 벽 · 잉크 강 · 지금 서 있는 블록). 잉크 강은 캐릭터만 막고
 * 풍선은 넘어간다(cellHeight 0). 아이템 · 설치물 자리 찾기(gridOverlaps)도 이 함수를 쓰므로 강에는 아무것도 놓이지 않는다.
 * blocks[i] = 1 은 "그 칸에 부서지는 블록이 서 있다"는 뜻이다 — 처음부터 있는 부서지는 블록(TILE.BREAK)뿐 아니라
 * 경기 중에 바닥 칸에 세우는 임시 블록(나중의 잉크 장벽 같은 것)도 같은 배열 · 같은 사건({k:"blk"})으로 다룬다.
 */
export function cellBlocked(grid, i) {
  const t = grid.tiles[i];
  return t === TILE.SOLID || t === TILE.WALL || t === TILE.BOARD || t === TILE.WATER || grid.blocks[i] === 1;
}

/** 칸 i 의 블록 높이(풍선이 넘는 높이). 바깥 벽은 무한대, 블록이 없으면 0. */
export function cellHeight(grid, i) {
  const t = grid.tiles[i];
  if (t === TILE.WALL) return Infinity;
  if (t === TILE.SOLID) return BLOCK.SOLID_H;
  if (t === TILE.BOARD) return BLOCK.BOARD_H;
  if (t === TILE.GATE) return grid.blocks[i] === 1 ? BLOCK.SOLID_H : 0; // 닫힌 문은 단단한 블록 높이
  if (grid.blocks[i] === 1) return BLOCK.BREAK_H;
  return 0;
}

/** 칸 가운데의 월드 좌표. */
export function cellCenter(grid, i, out = { x: 0, z: 0 }) {
  const n = grid.n;
  out.x = (i % n) * CELL - n + 1;
  out.z = Math.floor(i / n) * CELL - n + 1;
  return out;
}

/**
 * pos = {x, z} 를 반지름 radius 인 원으로 보고 막힌 칸 밖으로 밀어낸다(높이와 상관없이). 밀었으면 true.
 * 주변 칸(원이 걸친 칸)만 본다. 마지막에 바깥 벽 안쪽으로 한 번 더 가둔다(아주 빠른 넉백이 벽을 뚫지 않게).
 */
export function gridResolve(grid, pos, radius, blocked = null) {
  const isBlocked = blocked || ((i) => cellBlocked(grid, i));
  const n = grid.n;
  let pushed = false;
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    const c0 = Math.floor((pos.x - radius + n) / CELL), c1 = Math.floor((pos.x + radius + n) / CELL);
    const r0 = Math.floor((pos.z - radius + n) / CELL), r1 = Math.floor((pos.z + radius + n) / CELL);
    for (let r = r0; r <= r1; r++) {
      if (r < 0 || r >= n) continue;
      for (let c = c0; c <= c1; c++) {
        if (c < 0 || c >= n) continue;
        const i = r * n + c;
        if (!isBlocked(i)) continue;
        const bx0 = c * CELL - n, bz0 = r * CELL - n, bx1 = bx0 + CELL, bz1 = bz0 + CELL;
        const qx = pos.x < bx0 ? bx0 : pos.x > bx1 ? bx1 : pos.x;
        const qz = pos.z < bz0 ? bz0 : pos.z > bz1 ? bz1 : pos.z;
        const dx = pos.x - qx, dz = pos.z - qz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          pos.x = qx + (dx / d) * radius;
          pos.z = qz + (dz / d) * radius;
        } else {
          // 중심이 칸 안: 막히지 않은 이웃 쪽 가운데 가장 얕은 면으로 꺼낸다(같으면 −x · +x · −z · +z 순 — 결정적)
          const faces = [
            [pos.x - bx0, c - 1, r, -1, 0], [bx1 - pos.x, c + 1, r, 1, 0],
            [pos.z - bz0, c, r - 1, 0, -1], [bz1 - pos.z, c, r + 1, 0, 1],
          ];
          let best = null;
          for (const f of faces) {
            const open = f[1] >= 0 && f[1] < n && f[2] >= 0 && f[2] < n && !isBlocked(f[2] * n + f[1]);
            if (open && (!best || f[0] < best[0])) best = f;
          }
          if (!best) {
            // 이웃 네 칸이 모두 막혔다(두꺼운 벽 속 깊이 — 큰 몸에 밀렸을 때): 두 칸 안의 가장 가까운 열린 칸의 가장 가까운 자리로 꺼낸다.
            // (예전에는 늘 −x 쪽으로 밀어 두꺼운 벽 너머 — 다른 방 · 다른 레인 — 로 뚫고 나갈 수 있었다)
            let bd = Infinity, nx = 0, nz = 0;
            for (let dr = -2; dr <= 2; dr++) {
              for (let dc = -2; dc <= 2; dc++) {
                const cc = c + dc, rr = r + dr;
                if (cc < 0 || rr < 0 || cc >= n || rr >= n || isBlocked(rr * n + cc)) continue;
                const x0 = cc * CELL - n + radius, x1 = x0 + CELL - 2 * radius, z0 = rr * CELL - n + radius, z1 = z0 + CELL - 2 * radius;
                const px = pos.x < x0 ? x0 : pos.x > x1 ? x1 : pos.x, pz = pos.z < z0 ? z0 : pos.z > z1 ? z1 : pos.z;
                const d = (px - pos.x) * (px - pos.x) + (pz - pos.z) * (pz - pos.z);
                if (d < bd) { bd = d; nx = px; nz = pz; }
              }
            }
            if (bd < Infinity) { pos.x = nx; pos.z = nz; moved = true; continue; }
            best = faces[0];
          }
          if (best[3] < 0) pos.x = bx0 - radius;
          else if (best[3] > 0) pos.x = bx1 + radius;
          else if (best[4] < 0) pos.z = bz0 - radius;
          else pos.z = bz1 + radius;
        }
        moved = true;
      }
    }
    if (!moved) break;
    pushed = true;
  }
  const lim = n - CELL - radius; // 바깥 벽(한 칸 두께) 안쪽
  if (pos.x > lim) { pos.x = lim; pushed = true; } else if (pos.x < -lim) { pos.x = -lim; pushed = true; }
  if (pos.z > lim) { pos.z = lim; pushed = true; } else if (pos.z < -lim) { pos.z = -lim; pushed = true; }
  return pushed;
}

/** 원(x, z, radius)이 막힌 칸과 겹치는가(밀어내지 않고 보기만 한다). */
export function gridOverlaps(grid, x, z, radius) {
  const n = grid.n;
  const c0 = Math.floor((x - radius + n) / CELL), c1 = Math.floor((x + radius + n) / CELL);
  const r0 = Math.floor((z - radius + n) / CELL), r1 = Math.floor((z + radius + n) / CELL);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (c < 0 || r < 0 || c >= n || r >= n) return true;
      if (!cellBlocked(grid, r * n + c)) continue;
      const bx0 = c * CELL - n, bz0 = r * CELL - n;
      const qx = x < bx0 ? bx0 : x > bx0 + CELL ? bx0 + CELL : x;
      const qz = z < bz0 ? bz0 : z > bz0 + CELL ? bz0 + CELL : z;
      if ((x - qx) * (x - qx) + (z - qz) * (z - qz) < radius * radius) return true;
    }
  }
  return false;
}

/**
 * 반지름 r 인 공이 (x0,y0,z0) → (x1,y1,z1) 선분을 따라갈 때 블록 칸에 처음 닿는 t(0..1). 안 닿으면 −1.
 * 칸 사각형을 수평으로 r 만큼 부풀리고, 세로는 공의 중심 높이가 그 칸의 블록 높이(cellHeight) 이하일 때만 맞는다
 * (포물선 풍선은 블록보다 높이 날면 넘어간다 — 바깥 벽은 높이가 무한대). 닿은 칸 번호는 grid.hit 에 남는다(없으면 −1).
 */
export function gridSegment(grid, x0, y0, z0, x1, y1, z1, r) {
  const n = grid.n;
  grid.hit = -1;
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const lx = Math.min(x0, x1) - r, hx = Math.max(x0, x1) + r, lz = Math.min(z0, z1) - r, hz = Math.max(z0, z1) + r;
  const c0 = Math.max(0, Math.floor((lx + n) / CELL)), c1 = Math.min(n - 1, Math.floor((hx + n) / CELL));
  const r0 = Math.max(0, Math.floor((lz + n) / CELL)), r1 = Math.min(n - 1, Math.floor((hz + n) / CELL));
  let best = -1;
  for (let rr = r0; rr <= r1; rr++) {
    for (let c = c0; c <= c1; c++) {
      const i = rr * n + c;
      const h = cellHeight(grid, i);
      if (!(h > 0)) continue;
      // 슬랩 시험: x · z 는 부풀린 칸, y 는 (−∞, h]
      const ax = c * CELL - n - r, bx = ax + CELL + 2 * r;
      const az = rr * CELL - n - r, bz = az + CELL + 2 * r;
      let tIn = 0, tOut = 1;
      if (dx > 1e-12 || dx < -1e-12) {
        let ta = (ax - x0) / dx, tb = (bx - x0) / dx;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > tIn) tIn = ta;
        if (tb < tOut) tOut = tb;
      } else if (x0 < ax || x0 > bx) continue;
      if (tIn > tOut) continue;
      if (dz > 1e-12 || dz < -1e-12) {
        let ta = (az - z0) / dz, tb = (bz - z0) / dz;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > tIn) tIn = ta;
        if (tb < tOut) tOut = tb;
      } else if (z0 < az || z0 > bz) continue;
      if (tIn > tOut) continue;
      if (h !== Infinity) {
        if (dy > 1e-12 || dy < -1e-12) {
          const th = (h - y0) / dy; // 공의 중심이 블록 높이를 지나는 때
          if (dy > 0) { if (th < tOut) tOut = th; } else if (th > tIn) tIn = th;
        } else if (y0 > h) continue;
        if (tIn > tOut) continue;
      }
      if (best < 0 || tIn < best) { best = tIn; grid.hit = i; }
    }
  }
  return best;
}

/** 칸 종류 배열 + 홈 · 퀴즈 룸 · 점프 보드 목록(한 크기에 한 번 — 바뀌지 않는다). */
const yardBase = new Map();
function yardLayout(size) {
  let L = yardBase.get(size);
  if (L) return L;
  const M = YARD_MAPS[size];
  const n = size;
  const tiles = new Uint8Array(n * n);
  M.rows.forEach((row, r) => {
    for (let c = 0; c < n; c++) tiles[r * n + c] = TILE_OF[row[c]];
  });
  const world = (c) => c * CELL - n + 1; // 칸 가운데
  const homes = M.homes.map(([c0, r0, c1, r1], id) => ({
    id, c0, r0, c1, r1,
    x: (world(c0) + world(c1)) / 2, z: (world(r0) + world(r1)) / 2, // 띠의 가운데
    hx: ((c1 - c0 + 1) * CELL) / 2, hz: ((r1 - r0 + 1) * CELL) / 2, // 띠의 반변
  }));
  const quizRooms = M.rooms.map(([j, k], id) => {
    const x = j * CELL - n, z = k * CELL - n; // 칸 모서리 = 존 가운데
    return { id, x, z, r: M.zoneR, board: { x, z: z - YARD_BOARD } };
  });
  const pads = [];
  const breakables = [];
  for (let i = 0; i < n * n; i++) {
    if (tiles[i] === TILE.PAD) pads.push({ id: pads.length, cell: i, x: world(i % n), z: world(Math.floor(i / n)), r: 0.8, color: 2 });
    if (tiles[i] === TILE.BREAK) breakables.push(i);
  }
  L = { n, tiles, homes, quizRooms, pads, breakables, zoneR: M.zoneR };
  yardBase.set(size, L);
  return L;
}

/** 잉크 운동장 한 판의 경기장: 칸 배열은 함께 쓰고, 부서지는 블록 상태(blocks)만 따로 가진다. */
function makeYard(scale) {
  return gridArena(yardLayout(yardSize(scale)), scale, "yard");
}

/**
 * 칸 격자 경기장 한 판(잉크 운동장 · 던전이 함께 쓴다). L = 칸 배치 { n, tiles, homes, quizRooms, pads, breakables, zoneR, gates? } —
 * 칸 배열은 함께 쓰고 블록 상태(blocks — 부서지는 블록 · 닫힌 문)만 따로 가진다.
 */
function gridArena(L, scale, mode) {
  const n = L.n;
  const blocks = new Uint8Array(n * n);
  for (const i of L.breakables) blocks[i] = 1;
  for (const i of L.gates || []) blocks[i] = 1; // 던전의 문은 닫힌 채로 시작한다
  const grid = { n, half: n, cell: CELL, tiles: L.tiles, blocks, hit: -1 };
  const pads = L.pads;
  return {
    scale, mode, shape: "grid",
    radius: n, // 맵의 반변(u — 바깥 벽 바깥 끝까지). 스크롤 범위 · 아이템 자리 · 봇 판단이 쓴다
    half: n,
    walled: true,
    wallHeight: BLOCK.SOLID_H,
    grid, // { n, cell, tiles, blocks, hit } — 렌더러 · 미니맵 · 봇이 읽는다(blocks 는 경기 중에 바뀐다)
    homes: L.homes, quizRooms: L.quizRooms, pads, breakables: L.breakables, zoneR: L.zoneR,
    obstacles: [], boxes: [], // 옛 원기둥 · 상자 자료는 쓰지 않는다(빈 배열 — 옛 화면 코드가 그대로 돌게)
    spawns: L.homes.map((h) => ({ x: h.x, z: h.z })),
    seaY: -1.8,
    inkExtent: n / scale, // 잉크 텍스처가 덮는 반변(u)은 inkExtent × scale = n(화면이 × scale 해서 쓰는 약속이라 미리 나눠 둔다)
    rimColor: 1,
    itemScale: (n * n) / 400, // 아이템 목표 개수에 곱하는 넓이 배율(Room.itemTarget)
    itemMax: n > 28 ? 48 : 36,
    padAt: (x, z) => padIn(pads, x, z),
    isOnPlatform: (x, z) => x <= n && x >= -n && z <= n && z >= -n,
    resolveObstacles: (pos, radius) => gridResolve(grid, pos, radius),
    segmentHitsObstacle: (x0, y0, z0, x1, y1, z1, r) => gridSegment(grid, x0, y0, z0, x1, y1, z1, r),
    edgeDistance: (x, z) => n - CELL - Math.max(x < 0 ? -x : x, z < 0 ? -z : z),
    groundAt: () => 0, // 블록 위에는 올라서지 못한다
    overlaps: (x, z, radius) => gridOverlaps(grid, x, z, radius),
    cellAt: (x, z) => cellAt(grid, x, z),
    /** 부서지는 블록 상태를 비트 문자열(base64)로 — welcome.blocks */
    packBlocks() {
      const bytes = new Uint8Array(Math.ceil((n * n) / 8));
      for (let i = 0; i < n * n; i++) if (blocks[i]) bytes[i >> 3] |= 1 << (i & 7);
      return toB64(bytes);
    },
    /** welcome.blocks 를 그대로 적용한다. */
    unpackBlocks(b64) {
      const bytes = fromB64(b64 || "");
      for (let i = 0; i < n * n; i++) {
        const t = L.tiles[i];
        const can = t !== TILE.SOLID && t !== TILE.WALL && t !== TILE.BOARD && t !== TILE.WATER; // 블록이 설 수 있는 칸(부서지는 블록 · 임시 블록 · 문)
        blocks[i] = can && bytes[i >> 3] & (1 << (i & 7)) ? 1 : 0;
      }
    },
  };
}

// ---- 던전(v16 — docs/DESIGN.md §2.15) ----
// 팀마다 자기만의 큰 던전(레인) 하나. 레인은 DL × DL 칸(76u)이고 맵에 2 × 2 로 놓인다(맵 2·DL = 76칸 = 152u — 스냅샷 위치 칸 ±81.92u 안).
// 레인끼리는 바깥 벽(풍선도 못 넘는다)으로 완전히 막혀 서로 마주치지 않으므로, 화면은 내 레인만 그린다(진행자는 쓰는 레인 모두).
// 모든 레인은 같은 배치다(경기마다 seed 로 새로 짓는다 — 모든 팀이 같은 던전이라 공정하다). 레인 k 는 레인 0 을 옮긴 것(돌리지 않는다).
//
// 레인 짓기(레인 안 칸 (a, b) — a 오른쪽, b 아래. 0 · DL − 1 은 바깥 벽): 안쪽을 3 × 3 칸(한 칸 DS = 12칸)으로 나누고
//  - 큰길: 모서리의 출발 방에서 이웃 칸을 하나씩 밟아 가는 7칸 — 출발 방 → 1 ~ 5번 방(5번 = 왕의 방) → 목표 방
//  - 곁방 2개(남는 두 칸): 큰길의 몬스터 방에 문 없이 붙은 보물 방(아이템 · 작은 무리)
//  - 방은 칸 안의 사각형(칸의 첫 칸부터 아홉째 칸까지 — 이웃 방과 벽이 세 칸 이상), 방 사이 통로는 2칸 폭(곧은 길 또는 꺾인 길)
//  - 문 g(1 ~ 5)는 g번 방 → 다음 방 통로의 끝(다음 방 입구) 두 칸. g번 방의 몬스터를 모두 물리치면 열린다. 출발 방 → 1번 방은 문이 없다
//  - 넓이(area): 0 출발 방 · 1 ~ 5 몬스터 방 · 6 목표 방 · 7 · 8 곁방. 통로는 앞 방(곁방 통로는 곁방)의 넓이, 문 칸은 −1(gateOf 가 번호)
//  - 방 안의 기둥(단단한 블록 — 엄폐물). 방 사이 벽도 단단한 블록이라 풍선은 넘어가지만 캐릭터 · 몬스터는 못 지나간다
//  - 드론 자리(v16 — 사용자 요청): 출발 방 · 2번 방 · 4번 방 · 곁방에 하나씩 떠 있다(server/room.js 의 드론)
export const DL = 38; // 레인 한 변(칸)
const DS = 12; // 3 × 3 칸 한 칸(칸)
export const D_STAGES = 5; // 몬스터 방 수(shared/constants.js 의 DUNGEON.STAGES 와 같다)
export const D_GOAL = D_STAGES + 1; // 목표 방의 넓이 번호
export const D_SIDES = [D_GOAL + 1, D_GOAL + 2]; // 곁방의 넓이 번호
const D_SIZE = { start: [5, 7], room: [7, 9], boss: [9, 9], goal: [4, 5], side: [6, 7] }; // 방 크기(칸, 가로 · 세로 따로 고른다)
const D_PILLARS = { start: 0, room: 3, boss: 4, goal: 0, side: 0 };
const D_DRONE_ROOMS = [0, 2, 4, ...[D_GOAL + 1, D_GOAL + 2]]; // 드론이 뜨는 넓이
// 팀 수 → 쓸 레인(위 줄부터)
const LANE_SETS = { 1: [0], 2: [0, 1], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

/** 팀 수(1..4) → 팀 번호마다 쓰는 레인 번호 배열. */
export function laneSlots(teamCount) {
  const n = Math.max(1, Math.min(4, teamCount | 0 || 2));
  return LANE_SETS[n];
}

/** 결정적 난수(seed → 0..1). 서버와 화면이 같은 seed 로 같은 던전을 짓는다. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 방 둘을 잇는 2칸 폭 통로(R1 이 축을 따라 R2 보다 앞 — horiz 면 가로축). gateAt: 1 · 2 = 그쪽 방 입구에 문(꺾인 길이 문을 비껴 방에 바로 닿지 않게), 0 = 없음.
 * @returns {{cells:number[][], end1:number[][], end2:number[][], in1:number[], in2:number[]}}  end = 그 방 쪽 통로 끝 두 칸, in = 그 방 안 문턱 자리(칸 좌표 · 소수)
 */
function carveLink(R1, R2, horiz, gateAt, ri) {
  const U0 = (R) => (horiz ? R.a0 : R.b0), U1 = (R) => (horiz ? R.a1 : R.b1);
  const V0 = (R) => (horiz ? R.b0 : R.a0), V1 = (R) => (horiz ? R.b1 : R.a1);
  const ab = (u, v) => (horiz ? [u, v] : [v, u]);
  const cells = [];
  const add = (u, v) => cells.push(ab(u, v));
  const lo = Math.max(V0(R1), V0(R2)), hi = Math.min(V1(R1), V1(R2));
  let v1, v2;
  if (hi - lo >= 1) {
    v1 = v2 = ri(lo, hi - 1);
    for (let u = U1(R1) + 1; u <= U0(R2) - 1; u++) { add(u, v1); add(u, v1 + 1); }
  } else {
    // 꺾인 길: R1 쪽 가로 → 세로 → R2 쪽 가로. 세로 토막은 문이 있는 쪽 방 바로 앞 줄에 닿지 않는다
    v1 = ri(V0(R1), V1(R1) - 1);
    v2 = ri(V0(R2), V1(R2) - 1);
    const x = ri(U1(R1) + 1 + (gateAt === 1 ? 1 : 0), U0(R2) - 2 - (gateAt === 2 ? 1 : 0));
    for (let u = U1(R1) + 1; u <= x + 1; u++) { add(u, v1); add(u, v1 + 1); }
    for (let v = Math.min(v1, v2); v <= Math.max(v1, v2) + 1; v++) { add(x, v); add(x + 1, v); }
    for (let u = x; u <= U0(R2) - 1; u++) { add(u, v2); add(u, v2 + 1); }
  }
  return {
    cells,
    end1: [ab(U1(R1) + 1, v1), ab(U1(R1) + 1, v1 + 1)],
    end2: [ab(U0(R2) - 1, v2), ab(U0(R2) - 1, v2 + 1)],
    in1: ab(U1(R1), v1 + 0.5),
    in2: ab(U0(R2), v2 + 0.5),
  };
}

/**
 * 레인 하나의 배치(레인 안 칸 좌표). 모든 레인이 이것을 옮겨 쓴다.
 * @returns {{local:Int16Array, tiles:Uint8Array, rooms:object[], gates:number[][][], links:object[]}}
 *   local[b·DL + a] = 넓이(0 이상) · −1 벽 · −2 기둥 · −10 − g 문 g
 */
function genLane(seed) {
  const rnd = mulberry32(seed);
  const ri = (a, b) => (b <= a ? a : a + Math.floor(rnd() * (b - a + 1)));
  const shuffleR = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  // 1) 큰길: 3 × 3 칸 위 7칸(모서리에서 시작하는 자기 자신을 밟지 않는 길 — 모서리에서는 늘 있다)
  const corners = [[0, 0], [2, 0], [0, 2], [2, 2]];
  const [sx, sy] = corners[ri(0, 3)];
  const walk = [[sx, sy]];
  const used = new Set([sx + sy * 3]);
  const dfs = () => {
    if (walk.length === 7) return true;
    const [x, y] = walk[walk.length - 1];
    const nb = shuffleR([[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy]).filter(([u, v]) => u >= 0 && v >= 0 && u < 3 && v < 3 && !used.has(u + v * 3)));
    for (const q of nb) {
      walk.push(q); used.add(q[0] + q[1] * 3);
      if (dfs()) return true;
      walk.pop(); used.delete(q[0] + q[1] * 3);
    }
    return false;
  };
  dfs();
  // 2) 방: 큰길(넓이 0 ~ 6) + 곁방(남는 칸 — 큰길의 몬스터 방에 붙인다)
  const kindOf = (i) => (i === 0 ? "start" : i === D_STAGES ? "boss" : i === D_GOAL ? "goal" : "room");
  const rooms = walk.map(([x, y], i) => ({ area: i, kind: kindOf(i), sx: x, sy: y }));
  let side = 0;
  for (let k = 0; k < 9 && side < D_SIDES.length; k++) {
    if (used.has(k)) continue;
    const x = k % 3, y = (k / 3) | 0;
    const nbs = rooms.filter((r) => r.area <= D_GOAL && Math.abs(r.sx - x) + Math.abs(r.sy - y) === 1);
    const pick = nbs.find((r) => r.area >= 1 && r.area <= D_STAGES) || nbs.find((r) => r.area === 0) || nbs[0];
    rooms.push({ area: D_SIDES[side++], kind: "side", sx: x, sy: y, attach: pick.area });
  }
  for (const R of rooms) {
    const [lo, hi] = D_SIZE[R.kind];
    const w = ri(lo, hi), h = ri(lo, hi);
    const s0a = 1 + R.sx * DS + 1, s0b = 1 + R.sy * DS + 1; // 방이 쓸 수 있는 첫 칸(칸의 둘째 칸)
    R.a0 = s0a + ri(0, 9 - w); R.b0 = s0b + ri(0, 9 - h);
    R.a1 = R.a0 + w - 1; R.b1 = R.b0 + h - 1;
  }
  const local = new Int16Array(DL * DL).fill(-1);
  const at = (a, b) => b * DL + a;
  const inRoom = new Uint8Array(DL * DL); // 방 칸(통로가 아닌) — 출발 방 · 목표 방 바닥 무늬
  for (const R of rooms) for (let b = R.b0; b <= R.b1; b++) for (let a = R.a0; a <= R.a1; a++) { local[at(a, b)] = R.area; inRoom[at(a, b)] = 1; }
  // 3) 통로(큰길 · 곁방)
  const gates = [[]];
  const links = [];
  const byArea = new Map(rooms.map((R) => [R.area, R]));
  const link = (A, B, gate) => {
    // A → B(B 입구에 문 gate — 0 이면 없음). 통로 칸의 넓이 = A(큰길) 또는 곁방
    const horiz = A.sy === B.sy;
    const fwd = horiz ? B.sx > A.sx : B.sy > A.sy;
    const [R1, R2] = fwd ? [A, B] : [B, A];
    const L = carveLink(R1, R2, horiz, gate ? (fwd ? 2 : 1) : 0, ri);
    const owner = A.kind === "side" ? A.area : B.kind === "side" ? B.area : A.area;
    for (const [a, b] of L.cells) if (local[at(a, b)] === -1) local[at(a, b)] = owner;
    const endB = fwd ? L.end2 : L.end1, inA = fwd ? L.in1 : L.in2, inB = fwd ? L.in2 : L.in1;
    if (gate) {
      gates[gate] = endB.slice();
      for (const [a, b] of endB) local[at(a, b)] = -10 - gate;
    }
    links.push({ from: A.area, to: B.area, gate, exitA: inA, entryB: inB, mid: [(endB[0][0] + endB[1][0]) / 2, (endB[0][1] + endB[1][1]) / 2] });
  };
  for (let i = 0; i < D_GOAL; i++) link(byArea.get(i), byArea.get(i + 1), i >= 1 ? i : 0);
  for (const R of rooms) if (R.kind === "side") link(byArea.get(R.attach), R, 0);
  // 4) 방 안 기둥(가장자리에서 두 칸 이상, 서로 두 칸 이상 떨어져 — 길을 막지 않는다)
  for (const R of rooms) {
    const want = D_PILLARS[R.kind];
    const placed = [];
    for (let t = 0; t < 60 && placed.length < want; t++) {
      const a = ri(R.a0 + 2, R.a1 - 2), b = ri(R.b0 + 2, R.b1 - 2);
      if (a < R.a0 + 2 || a > R.a1 - 2 || b < R.b0 + 2 || b > R.b1 - 2) continue;
      if (placed.some(([pa, pb]) => Math.max(Math.abs(pa - a), Math.abs(pb - b)) < 3)) continue;
      placed.push([a, b]);
      local[at(a, b)] = -2;
    }
    R.pillars = placed;
  }
  return { local, inRoom, rooms, gates, links };
}

/** 칸 (c, r) 의 가운데 월드 좌표(맵 n 칸) */
const cellXZ = (n, c, r) => ({ x: c * CELL - n + 1, z: r * CELL - n + 1 });

let dungeonBase = null;
/** 던전 칸 배치(seed 마다 한 번 — 마지막 것만 기억한다). */
function dungeonLayout(seed) {
  seed = seed >>> 0;
  if (dungeonBase && dungeonBase.seed === seed) return dungeonBase;
  const G = genLane(seed);
  const n = DL * 2;
  const N = n * n;
  const tiles = new Uint8Array(N).fill(TILE.WATER);
  const area = new Int8Array(N).fill(-1); // 칸마다 넓이(−1 막힘)
  const lane = new Int8Array(N).fill(-1); // 칸마다 레인
  const gateOf = new Int8Array(N).fill(0); // 문 칸이면 몇 번 문(1 ~ 5)
  const lanes = [];
  const toW = (k, a, b) => {
    // 레인 k 의 칸 좌표(소수 가능 — 칸 가운데가 정수) → 월드
    const c = (k & 1) * DL + a, r = (k >> 1) * DL + b;
    return { x: c * CELL - n + 1, z: r * CELL - n + 1 };
  };
  for (let k = 0; k < 4; k++) {
    const oc = (k & 1) * DL, or = (k >> 1) * DL;
    const idx = (a, b) => (or + b) * n + oc + a;
    for (let b = 0; b < DL; b++) {
      for (let a = 0; a < DL; a++) {
        const i = idx(a, b);
        const v = G.local[b * DL + a];
        lane[i] = k;
        if (a === 0 || b === 0 || a === DL - 1 || b === DL - 1) tiles[i] = TILE.WALL;
        else if (v >= 0) {
          area[i] = v;
          const room = G.inRoom[b * DL + a] === 1;
          tiles[i] = room && v === 0 ? TILE.HOME : room && v === D_GOAL ? TILE.ZONE : TILE.FLOOR;
        } else if (v <= -11) {
          tiles[i] = TILE.GATE;
          gateOf[i] = -10 - v;
        } else tiles[i] = TILE.SOLID; // 방 사이 벽 · 기둥
      }
    }
    const rooms = [];
    for (const R of G.rooms) {
      const cells = [];
      for (let b = R.b0; b <= R.b1; b++) for (let a = R.a0; a <= R.a1; a++) if (G.local[b * DL + a] === R.area) cells.push(idx(a, b));
      const c = toW(k, (R.a0 + R.a1) / 2, (R.b0 + R.b1) / 2);
      const into = G.links.find((L) => L.to === R.area);
      const entry = into ? toW(k, into.entryB[0], into.entryB[1]) : c;
      // 몬스터 자리: 가장자리 · 기둥 둘레를 뺀 칸 가운데에서 입구에서 먼 것부터 서로 멀리(가장 먼 점 고르기 — 결정적)
      const pill = new Set(R.pillars.map(([a, b]) => a + "," + b));
      const cand = [];
      for (let b = R.b0 + 1; b <= R.b1 - 1; b++) {
        for (let a = R.a0 + 1; a <= R.a1 - 1; a++) {
          let near = false;
          for (let db = -1; db <= 1 && !near; db++) for (let da = -1; da <= 1; da++) if (pill.has(a + da + "," + (b + db))) { near = true; break; }
          if (!near) cand.push(toW(k, a, b));
        }
      }
      const spots = [];
      const dmin = cand.map((p) => Math.hypot(p.x - entry.x, p.z - entry.z) * 0.5);
      for (let t = 0; t < 16 && cand.length; t++) {
        let bi = 0;
        for (let j = 1; j < cand.length; j++) if (dmin[j] > dmin[bi]) bi = j;
        if (dmin[bi] <= 0) break;
        const p = cand[bi];
        spots.push({ x: p.x, z: p.z });
        for (let j = 0; j < cand.length; j++) dmin[j] = Math.min(dmin[j], Math.hypot(cand[j].x - p.x, cand[j].z - p.z));
      }
      rooms[R.area] = {
        area: R.area, kind: R.kind, attach: R.attach ?? -1,
        c0: oc + R.a0, r0: or + R.b0, c1: oc + R.a1, r1: or + R.b1,
        x: c.x, z: c.z, hx: ((R.a1 - R.a0 + 1) * CELL) / 2, hz: ((R.b1 - R.b0 + 1) * CELL) / 2,
        cells, spots, entry,
      };
    }
    const st = rooms[0];
    const home = { id: k, c0: st.c0, r0: st.r0, c1: st.c1, r1: st.r1, x: st.x, z: st.z, hx: st.hx, hz: st.hz };
    const gates = [[]];
    const gateCenter = [null];
    for (let g = 1; g <= D_STAGES; g++) {
      gates[g] = (G.gates[g] || []).map(([a, b]) => idx(a, b));
      const L = G.links.find((x) => x.gate === g);
      gateCenter[g] = toW(k, L.mid[0], L.mid[1]);
    }
    // 부활 자리: 0 = 출발 방 가운데, g = g번 문을 연 뒤(g번 방의 나가는 문턱 — 이미 깬 방 쪽)
    const checkpoints = [{ x: st.x, z: st.z }];
    for (let g = 1; g <= D_STAGES; g++) {
      const L = G.links.find((x) => x.from === g && x.to === g + 1);
      checkpoints[g] = toW(k, L.exitA[0], L.exitA[1]);
    }
    const goal = rooms[D_GOAL];
    const x0 = oc * CELL - n, z0 = or * CELL - n;
    lanes.push({
      id: k, home, rooms, gates, gateCenter, checkpoints,
      goal: { x: goal.x, z: goal.z, r: Math.min(goal.hx, goal.hz) },
      rect: { c0: oc, r0: or, c1: oc + DL - 1, r1: or + DL - 1, x0, z0, x1: x0 + DL * CELL, z1: z0 + DL * CELL, cx: x0 + DL, cz: z0 + DL },
      drones: D_DRONE_ROOMS.filter((ar) => rooms[ar]).map((ar) => ({ area: ar, x: rooms[ar].x, z: rooms[ar].z })),
    });
  }
  const homes = lanes.map((L) => L.home);
  const gateCells = [];
  for (const L of lanes) for (let g = 1; g <= D_STAGES; g++) gateCells.push(...L.gates[g]);
  // 아이템 자리(레인 0 — 다른 레인은 옮겨 쓴다): 방 · 통로의 바닥 칸(목표 방 · 문 빼고)
  const itemCells = [];
  for (let i = 0; i < N; i++) if (lane[i] === 0 && area[i] >= 0 && area[i] !== D_GOAL) itemCells.push(i);
  dungeonBase = {
    seed, n, tiles, homes, quizRooms: [], pads: [], breakables: [], zoneR: 3, gates: gateCells,
    area, lane, gateOf, lanes, itemCells,
  };
  return dungeonBase;
}

/** 던전 한 판의 경기장: 잉크 운동장과 같은 칸 격자 함수 + dungeon(레인 · 넓이 · 문 · 방 · 부활 자리 · 목표 · 드론 자리). */
function makeDungeon(seed = 1) {
  const L = dungeonLayout(seed);
  const A = gridArena(L, 1, "dungeon");
  const n = L.n;
  A.itemScale = 1;
  A.itemMax = 4 * DUNGEON_ITEMS;
  const offset = (k) => ({ x: (k & 1) * DL * CELL, z: (k >> 1) * DL * CELL });
  // 드론을 타고 나는 사람의 칸 판정(v16): 바깥 벽 · 빈 바다는 막히고, 바닥 칸은 그 레인 팀이 연 곳(지금 방까지 · 거기 붙은 곁방 · 다 열었으면 목표 방)만.
  // 단단한 블록 · 기둥 · 문 칸(넓이 −1)은 위로 지나간다. 문이 열렸는지는 경기의 칸 상태(blocks)로 본다 — 서버 · 화면 예측이 같다
  const gateOpen = (k, g) => { const cs = L.lanes[k].gates[g]; return !!cs && cs.length > 0 && A.grid.blocks[cs[0]] === 0; };
  const areaOpen = (k, ar) => {
    if (ar <= 1) return true;
    if (ar <= D_STAGES) return gateOpen(k, ar - 1);
    if (ar === D_GOAL) return gateOpen(k, D_STAGES);
    const R = L.lanes[k].rooms[ar];
    return !!R && R.attach >= 0 && areaOpen(k, R.attach);
  };
  const flyBlocked = (i) => {
    const t = L.tiles[i];
    if (t === TILE.WALL || t === TILE.WATER) return true;
    const ar = L.area[i];
    return ar >= 0 && !areaOpen(L.lane[i], ar);
  };
  A.resolveFlying = (pos, radius) => gridResolve(A.grid, pos, radius, flyBlocked);
  A.dungeon = {
    seed: L.seed,
    size: DL, // 레인 한 변(칸)
    stages: D_STAGES,
    goalArea: D_GOAL,
    sides: D_SIDES,
    lanes: L.lanes, // [{ id, home, rooms[넓이], gates[1..5] 칸 번호들, gateCenter[1..5], checkpoints[0..5], goal {x, z, r}, rect, drones }]
    area: L.area, // 칸 → 넓이(−1 막힘)
    lane: L.lane, // 칸 → 레인
    gateOf: L.gateOf, // 칸 → 문 번호(0 = 문 아님)
    itemCells: L.itemCells, // 레인 0 의 아이템 자리 칸들
    /** 월드 (x, z) 의 넓이(−1 = 막힌 칸 · 맵 밖) */
    areaAt: (x, z) => { const i = cellAt(A.grid, x, z); return i < 0 ? -1 : L.area[i]; },
    /** 월드 (x, z) 의 레인(−1 = 맵 밖) */
    laneAt: (x, z) => { const i = cellAt(A.grid, x, z); return i < 0 ? -1 : L.lane[i]; },
    /** 레인 0 의 자리 → 레인 k 의 같은 자리(옮기기만 한다 — 아이템을 레인마다 같은 자리에) */
    toLane: (k, x, z) => { const o = offset(k); return { x: x + o.x, z: z + o.z }; },
    /** 레인 k 의 자리 → 레인 0 의 같은 자리(toLane 의 거꾸로) */
    fromLane: (k, x, z) => { const o = offset(k); return { x: x - o.x, z: z - o.z }; },
    /** 칸 i 를 드론을 타고 지나갈 수 없는가(바깥 벽 · 아직 열지 않은 방) */
    flyBlocked,
    /** 레인 k 의 넓이 ar 를 지금 갈 수 있는가(그 방의 문이 열렸다) */
    areaOpen,
  };
  void n;
  return A;
}
const DUNGEON_ITEMS = 6; // shared/constants.js 의 DUNGEON.ITEMS_PER_LANE 과 같은 값(이 파일은 상수 모듈에서 BLOCK 만 불러온다)

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const v = (a << 16) | (b << 8) | c;
    s += B64[(v >> 18) & 63] + B64[(v >> 12) & 63] + (i + 1 < bytes.length ? B64[(v >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[v & 63] : "=");
  }
  return s;
}
function fromB64(s) {
  const clean = s.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1] || "A") << 12) | (B64.indexOf(clean[i + 2] || "A") << 6) | B64.indexOf(clean[i + 3] || "A");
    if (o < out.length) out[o++] = (v >> 16) & 255;
    if (o < out.length) out[o++] = (v >> 8) & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}

/**
 * 경기 한 판의 경기장. 잉크 운동장은 부서지는 블록 상태를 따로 가진 새 객체, 그 밖(낙하전 · 잉크 공장)은 arenaAt 과 같은 객체.
 * 던전은 seed 마다 다른 배치(서버가 경기마다 고르고 welcome.dungeon.seed 로 알린다 — 화면도 같은 seed 로 짓는다).
 */
export function newArena(scale, mode = "fall", seed = 1) {
  const s = scale > 0 && scale < Infinity ? scale : 1;
  if (layoutOf(mode) === "dungeon") return makeDungeon(seed);
  if (layoutOf(mode) === "yard") return makeYard(s);
  return arenaAt(s, mode);
}

// ---- 맵 크기 ----
// 같은 경기장을 수평(x, z)으로 scale 배 한 것. 높이(기둥 · 상자의 h)와 캐릭터 · 풍선 크기는 그대로다.
// 나눗셈 · 곱셈만 쓰므로 결정적이고, scale 1 은 위의 최상위 함수들과 완전히 같은 값을 낸다.
const arenaCache = new Map();
let lastDungeon = null;

/**
 * 경기 방식 · 배치 이름 → 배치 이름: "quiz" · "arcade" · "yard" → "yard"(잉크 운동장), "dungeon" → "dungeon"(던전 — 두 방식 모두의 던전 유형),
 * "hp" → "hp"(잉크 공장 — 옛 체력전 시험용), 그 밖 → "fall".
 */
export function layoutOf(mode) {
  return mode === "quiz" || mode === "arcade" || mode === "yard" ? "yard" : mode === "dungeon" ? "dungeon" : mode === "hp" ? "hp" : "fall";
}

/**
 * @param {number} scale  배율. 양수가 아니면 1 로 본다. 잉크 운동장은 yardScale(정원)(1 이하 = 28칸 · 56u, 그보다 크면 36칸 · 72u),
 *                        네온 풀 · 잉크 공장은 MAP_SIZES 의 scale(수평으로 그만큼 키운다)
 * @param {string} [mode] 경기 방식 또는 배치 이름. "quiz" · "arcade" 는 잉크 운동장(벽 · 정사각형 — 퀴즈 룸 · 홈이 있다),
 *                        "hp" 는 옛 체력전 경기장(HP_ARENA — 잉크 공장, 시험용), 그 밖(기본 · "fall")은 네온 풀(낙하전 — 시험용).
 *                        결과 객체의 mode 는 배치 이름("yard" | "hp" | "fall")이다
 * @returns {{scale:number, mode:string, radius:number, walled:boolean, obstacles:object[], boxes:object[], spawns:object[],
 *            isOnPlatform:Function, resolveObstacles:Function, segmentHitsObstacle:Function, edgeDistance:Function, groundAt:Function}}
 *          (scale, mode) 마다 한 번 만들어 캐시한 객체(같은 값이면 같은 객체). 잉크 운동장에는 grid(칸 배열 · 블록 상태) · homes ·
 *          quizRooms · pads · itemScale · itemMax 가 더 있다 — 캐시된 것은 처음 상태라 경기에는 newArena 를 쓴다
 */
export function arenaAt(scale, mode = "fall", seed = 1) {
  const s = scale > 0 && scale < Infinity ? scale : 1;
  const m = layoutOf(mode);
  if (m === "dungeon") {
    // 던전은 seed 마다 다르다 — 마지막 것 하나만 기억한다(경기마다 새 seed)
    seed = seed >>> 0;
    if (!lastDungeon || lastDungeon.dungeon.seed !== seed) lastDungeon = makeDungeon(seed); // 처음 상태(문 전부 닫힘)
    return lastDungeon;
  }
  const key = m + ":" + s;
  let a = arenaCache.get(key);
  if (a) return a;
  if (m === "yard") {
    a = makeYard(s); // 처음 상태(블록 전부 있음) — 그리기 · 시험용. 경기는 newArena 로 따로 만든다
  } else if (m === "fall" && s === 1) {
    a = {
      scale: 1, mode: m, radius: ARENA.radius, walled: false,
      obstacles: ARENA.obstacles, boxes: ARENA.boxes, spawns: ARENA.spawns, pads: ARENA.pads,
      isOnPlatform, resolveObstacles, segmentHitsObstacle, edgeDistance, groundAt,
      padAt: (x, z) => padIn(ARENA.pads, x, z),
    };
  } else {
    const src = m === "hp" ? HP_ARENA : ARENA;
    const obstacles = src.obstacles.map((o) => ({ ...o, x: o.x * s, z: o.z * s, r: o.r * s }));
    const boxes = src.boxes.map((b) => ({ ...b, x: b.x * s, z: b.z * s, hx: b.hx * s, hz: b.hz * s }));
    const spawns = src.spawns.map((p) => ({ x: p.x * s, z: p.z * s }));
    const pads = (src.pads || []).map((d) => ({ ...d, x: d.x * s, z: d.z * s, r: d.r * s }));
    const wallR = m === "hp" ? HP_R * s : 0;
    const onPlat = m === "hp" ? hpOnPlatform : isOnPlatform;
    const edge = m === "hp" ? hpEdgeDistance : edgeDistance;
    a = {
      scale: s, mode: m, radius: src.radius * s, walled: m === "hp",
      obstacles, boxes, spawns, pads,
      padAt: (x, z) => padIn(pads, x, z),
      isOnPlatform: s === 1 ? onPlat : (x, z) => onPlat(x / s, z / s),
      resolveObstacles: (pos, radius, y = 0) => resolveAll(obstacles, boxes, wallR, pos, radius, y),
      segmentHitsObstacle: (x0, y0, z0, x1, y1, z1, r) => segmentAll(obstacles, boxes, x0, y0, z0, x1, y1, z1, r),
      edgeDistance: s === 1 ? edge : (x, z) => edge(x / s, z / s) * s,
      groundAt: (x, z) => groundIn(obstacles, boxes, x, z),
    };
  }
  arenaCache.set(key, a);
  return a;
}

