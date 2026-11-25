// 길 찾기(docs/DESIGN.md §11): 칸 격자 A*(8방향, 대각선은 모서리를 자르지 않는다) + 시선이 열린 칸은 건너뛰어 곧게 편다.
//
//   const grid = new Grid(size)            grid.block[i] = 1 이면 막힘(나무 · 물 · 건물 · 광산)
//   findPath(grid, sx, sy, { x, y })        → [{x, y}, …] 월드 좌표 경유점(출발점은 빼고). 못 가면 가장 가까운 곳까지
//   findPath(grid, sx, sy, { rect: { tx, ty, w, h } | { tx, ty, size } })  → 그 네모에 닿는(옆 · 대각 칸) 곳까지

const SQ2 = Math.SQRT2;

export class Grid {
  constructor(size) {
    this.size = size;
    this.block = new Uint8Array(size * size);
    const n = size * size;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.stamp = 0;
    this.heapI = new Int32Array(n * 2);
    this.heapF = new Float32Array(n * 2);
  }
  passable(x, y) {
    return x >= 0 && y >= 0 && x < this.size && y < this.size && !this.block[y * this.size + x];
  }
  passableAt(wx, wy) {
    return this.passable(Math.floor(wx), Math.floor(wy));
  }
}

/** (wx, wy) 에서 가장 가까운 지나갈 수 있는 칸의 가운데 — 없으면 null */
export function nearestFree(grid, wx, wy, maxR = 12) {
  const cx = Math.floor(wx), cy = Math.floor(wy);
  if (grid.passable(cx, cy)) return { x: cx + 0.5, y: cy + 0.5 };
  let best = null, bd = Infinity;
  for (let r = 1; r <= maxR; r++) {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || !grid.passable(x, y)) continue;
        const d = (x + 0.5 - wx) ** 2 + (y + 0.5 - wy) ** 2;
        if (d < bd) { bd = d; best = { x: x + 0.5, y: y + 0.5 }; }
      }
    if (best) return best;
  }
  return null;
}

/** 두 점 사이가 두께 2r 로 막히지 않았나 */
export function lineClear(grid, ax, ay, bx, by, r = 0.3) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return true;
  const nx = -dy / len, ny = dx / len;
  const steps = Math.ceil(len / 0.25);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = ax + dx * t, y = ay + dy * t;
    if (!grid.passableAt(x, y) || !grid.passableAt(x + nx * r, y + ny * r) || !grid.passableAt(x - nx * r, y - ny * r)) return false;
  }
  return true;
}

function rectGap(x, y, rect) {
  // 칸 (x, y) 와 네모 사이의 칸 거리(체비쇼프) — 0 이면 안, 1 이면 맞닿음. 네모는 { tx, ty, w, h } 또는 { tx, ty, size }
  const w = rect.w ?? rect.size, h = rect.h ?? rect.size;
  const dx = x < rect.tx ? rect.tx - x : x >= rect.tx + w ? x - (rect.tx + w - 1) : 0;
  const dy = y < rect.ty ? rect.ty - y : y >= rect.ty + h ? y - (rect.ty + h - 1) : 0;
  return { dx, dy };
}

export function findPath(grid, sx, sy, goal, opts = {}) {
  const S = grid.size;
  const maxNodes = opts.maxNodes || 9000;
  const radius = opts.radius ?? 0.3;
  const sxi = Math.max(0, Math.min(S - 1, Math.floor(sx))), syi = Math.max(0, Math.min(S - 1, Math.floor(sy)));
  let gx, gy, isGoal, h;
  let endPoint = null;
  if (goal.rect) {
    const rc = goal.rect;
    isGoal = (x, y) => {
      const { dx, dy } = rectGap(x, y, rc);
      return Math.max(dx, dy) === 1;
    };
    h = (x, y) => {
      const { dx, dy } = rectGap(x, y, rc);
      const a = Math.max(0, dx - 1), b = Math.max(0, dy - 1);
      return Math.max(a, b) + (SQ2 - 1) * Math.min(a, b);
    };
    if (isGoal(sxi, syi)) return [];
  } else {
    const f = grid.passableAt(goal.x, goal.y) ? { x: goal.x, y: goal.y } : nearestFree(grid, goal.x, goal.y, 16);
    if (!f) return [];
    endPoint = f;
    gx = Math.floor(f.x); gy = Math.floor(f.y);
    isGoal = (x, y) => x === gx && y === gy;
    h = (x, y) => {
      const a = Math.abs(x - gx), b = Math.abs(y - gy);
      return Math.max(a, b) + (SQ2 - 1) * Math.min(a, b);
    };
    if (sxi === gx && syi === gy) return [{ x: f.x, y: f.y }];
    // 시선이 열려 있으면 바로 간다
    if (lineClear(grid, sx, sy, f.x, f.y, radius)) return [{ x: f.x, y: f.y }];
  }

  const stamp = ++grid.stamp;
  const { g, parent, seen, closed, heapI, heapF } = grid;
  let hn = 0;
  const push = (i, f) => {
    let k = hn++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p] <= f) break;
      heapI[k] = heapI[p]; heapF[k] = heapF[p]; k = p;
    }
    heapI[k] = i; heapF[k] = f;
  };
  const pop = () => {
    const top = heapI[0];
    const li = heapI[--hn], lf = heapF[hn];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= hn) break;
      if (c + 1 < hn && heapF[c + 1] < heapF[c]) c++;
      if (heapF[c] >= lf) break;
      heapI[k] = heapI[c]; heapF[k] = heapF[c]; k = c;
    }
    heapI[k] = li; heapF[k] = lf;
    return top;
  };

  const si = syi * S + sxi;
  g[si] = 0; parent[si] = -1; seen[si] = stamp;
  push(si, h(sxi, syi));
  let found = -1, best = si, bestH = h(sxi, syi), expanded = 0;
  while (hn > 0 && expanded < maxNodes) {
    const cur = pop();
    if (closed[cur] === stamp) continue;
    closed[cur] = stamp;
    expanded++;
    const cx = cur % S, cy = (cur / S) | 0;
    if (isGoal(cx, cy)) { found = cur; break; }
    const hc = h(cx, cy);
    if (hc < bestH) { bestH = hc; best = cur; }
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!grid.passable(nx, ny)) continue;
        if (dx && dy && (!grid.passable(cx + dx, cy) || !grid.passable(cx, cy + dy))) continue;
        const ni = ny * S + nx;
        if (closed[ni] === stamp) continue;
        const ng = g[cur] + (dx && dy ? SQ2 : 1);
        if (seen[ni] === stamp && ng >= g[ni]) continue;
        seen[ni] = stamp; g[ni] = ng; parent[ni] = cur;
        push(ni, ng + h(nx, ny));
      }
  }
  const end = found >= 0 ? found : best;
  const cells = [];
  for (let i = end; i !== -1 && i !== si; i = parent[i]) cells.push(i);
  cells.reverse();
  const pts = cells.map((i) => ({ x: (i % S) + 0.5, y: ((i / S) | 0) + 0.5 }));
  if (found >= 0 && endPoint && pts.length) pts[pts.length - 1] = { x: endPoint.x, y: endPoint.y };
  return smooth(grid, sx, sy, pts, radius);
}

/** 시선이 열린 경유점은 건너뛴다 */
export function smooth(grid, sx, sy, pts, radius = 0.3) {
  if (pts.length <= 1) return pts;
  const out = [];
  let ax = sx, ay = sy, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !lineClear(grid, ax, ay, pts[j].x, pts[j].y, radius)) j--;
    out.push(pts[j]);
    ax = pts[j].x; ay = pts[j].y;
    i = j + 1;
  }
  return out;
}
