// 맵 만들기(docs/DESIGN.md §13). 씨앗 · 팀 수 · 맵 종류가 같으면 서버와 브라우저가 같은 맵을 얻는다.
//
//   const map = generateMap(seed, teams, kind = "forest" | "canal" | "factory")
//   map.tiles[y * size + x]  — TILE.FLOOR | TREE | WATER | BLOCK | CRATE | POND | GOLD | CORE
//   map.bases[t]  — { team, cx, cy, dir:{x,y}(가운데 쪽 단위 벡터), perp:{x,y},
//                     tower:{tx,ty}, supply:{tx,ty}, lab:{tx,ty}, facility:{tx,ty}(왼쪽 위 칸),
//                     pond: ponds 번호, mine: mines 번호(본진 금광), core: cores 번호(숲속 코어 금광), spawn:{x,y} }
//   map.ponds[i]  — { tx, ty, team }(잉크 연못 3×3 · 왼쪽 위 칸 — 본진마다 하나)
//   map.mines[i]  — { tx, ty, rich, team }(금광 3×3 — 본진 금광(rich false)과 바깥 큰 금광(rich true, 가까운 팀))
//   map.cores[i]  — { tx, ty, team }(코어 금광 2×2 — 팀마다 하나, 숲 고리 속. 들어가는 길이 하나 열려 있다)
//   map.sites[i]  — { id, x, y(가운데), tx, ty(바위 2×2 왼쪽 위 칸), center }
//   map.camps[i]  — { x, y, kinds: [몬스터 kind, …], tier(가장 센 급) }
//   map.roads[i]  — [x0, y0, x1, y1] 늘 열려 있는 길(상자 없이 지나갈 수 있다)
import { MAP_SIZE, MAX_TEAMS, TILE, POND, MINE, CORE_MINE, BUILDINGS, BLD, GEM, mapKey } from "./constants.js";
import { mulberry32, valueNoise } from "./rng.js";

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px, qy = ay + dy * t - py;
  return Math.sqrt(qx * qx + qy * qy);
}

export function generateMap(seed, teams, kind = "forest") {
  kind = mapKey(kind);
  const n = Math.max(2, Math.min(MAX_TEAMS, teams | 0));
  const S = MAP_SIZE[n];
  const rand = mulberry32((seed ^ (kind === "canal" ? 0x51 : kind === "factory" ? 0xa7 : 0)) >>> 0);
  const tiles = new Uint8Array(S * S);
  const C = S / 2;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < S && y < S;
  const set = (x, y, v) => { if (inMap(x, y)) tiles[y * S + x] = v; };
  const get = (x, y) => (inMap(x, y) ? tiles[y * S + x] : TILE.BLOCK);
  const disc = (cx, cy, r, v, wobble = 0, s = 0, only = null) => {
    const R = Math.ceil(r + 2);
    for (let y = Math.floor(cy - R); y <= cy + R; y++)
      for (let x = Math.floor(cx - R); x <= cx + R; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const rr = wobble ? r * (1 - wobble * 0.5 + wobble * valueNoise(x * 0.45, y * 0.45, s)) : r;
        if (d <= rr && (only === null || get(x, y) === only)) set(x, y, v);
      }
  };
  const rect = (tx, ty, w, h, v) => { for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) set(x, y, v); };

  // 1) 본진 자리 — 가운데를 둘러싼 원 위에 고르게(2팀은 대각선 반대편)
  const R = S * 0.36;
  const start = n === 2 ? -Math.PI * 0.75 : -Math.PI / 2;
  const angles = [];
  const bases = [];
  for (let i = 0; i < n; i++) {
    const a = start + (i * Math.PI * 2) / n;
    angles.push(a);
    const cx = Math.round(C + Math.cos(a) * R), cy = Math.round(C + Math.sin(a) * R);
    let dx = C - cx, dy = C - cy;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    bases.push({ team: i, cx, cy, dir: { x: dx, y: dy }, perp: { x: -dy, y: dx } });
  }

  // 2) 본진 건물 · 연못 · 금광: 본진 가운데 기준 (앞 u, 옆 v) 자리에서 시작해 다른 것과 겹치면 밖으로 민다
  const ponds = [];
  const mines = [];
  const cores = [];
  const placed = []; // { tx, ty, w } — 겹침 검사용(여유 1칸)
  const overlaps = (tx, ty, w) => placed.some((p) => tx < p.tx + p.w + 1 && tx + w + 1 > p.tx && ty < p.ty + p.w + 1 && ty + w + 1 > p.ty);
  const place = (b, u, v, w) => {
    const ox = b.dir.x * u + b.perp.x * v, oy = b.dir.y * u + b.perp.y * v;
    const ol = Math.hypot(ox, oy) || 1;
    for (let k = 0; k < 40; k++) {
      const px = b.cx + ox + (ox / ol) * k * 0.5, py = b.cy + oy + (oy / ol) * k * 0.5;
      const tx = Math.round(px - w / 2), ty = Math.round(py - w / 2);
      if (!overlaps(tx, ty, w)) { placed.push({ tx, ty, w }); return { tx, ty }; }
    }
    const tx = Math.round(b.cx + ox - w / 2), ty = Math.round(b.cy + oy - w / 2);
    placed.push({ tx, ty, w });
    return { tx, ty };
  };
  const TW = BUILDINGS[BLD.TOWER].size, SW = BUILDINGS[BLD.SUPPLY].size, LW = BUILDINGS[BLD.LAB].size, FW = BUILDINGS[BLD.FACILITY].size;
  for (const b of bases) {
    b.tower = place(b, 0, 0, TW);
    b.supply = place(b, -1, 6, SW);
    const pp = place(b, -5.5, 6.5, POND.SIZE);
    b.pond = ponds.length;
    ponds.push({ tx: pp.tx, ty: pp.ty, team: b.team });
    const mp = place(b, -6.5, 0, MINE.SIZE);
    b.mine = mines.length;
    mines.push({ tx: mp.tx, ty: mp.ty, rich: false, team: b.team });
    b.lab = place(b, 0.5, -6, LW);
    b.facility = place(b, -4.5, -5.5, FW);
    b.spawn = { x: b.cx + b.dir.x * 3.6, y: b.cy + b.dir.y * 3.6 };
  }

  // 3) 보석 섹션: 이웃한 두 본진 사이마다 하나(가운데 쪽으로 당겨서) + 가운데 하나
  const sites = [];
  const addSite = (x, y, center) => {
    const tx = Math.round(x - GEM.ROCK / 2), ty = Math.round(y - GEM.ROCK / 2);
    sites.push({ id: sites.length, x: tx + GEM.ROCK / 2, y: ty + GEM.ROCK / 2, tx, ty, center });
  };
  const sideAngles = [];
  for (let i = 0; i < n; i++) {
    const a = n === 2 ? angles[i] + Math.PI / 2 : angles[i] + Math.PI / n;
    sideAngles.push(a);
    const rr = S * (n === 2 ? 0.26 : 0.3);
    addSite(C + Math.cos(a) * rr, C + Math.sin(a) * rr, false);
  }
  addSite(C, C, true);

  // 4) 큰 금광(팀마다 하나 — 본진과 다음 섹션 사이) · 숲속 코어 금광(팀마다 하나 — 본진 바깥, 이전 섹션 쪽) · 캠프
  const camps = [];
  for (let i = 0; i < n; i++) {
    // 본진 가운데에서 15칸 넘게(본진 건물과 숲 고리가 겹치지 않게), 맵 가장자리에서 6칸 안쪽 — 이전 섹션 쪽으로 돌려 가며 찾는다
    const prev = sites[(i - 1 + n) % n];
    let px = 0, py = 0;
    for (let k = 0; k < 40; k++) {
      const a = angles[i] - (Math.PI / n) * (0.6 + k * 0.03);
      const rr = Math.min(R * 1.12, C - 6);
      px = C + Math.cos(a) * rr; py = C + Math.sin(a) * rr;
      if (Math.hypot(px - bases[i].cx, py - bases[i].cy) >= 15 && Math.hypot(px - prev.x, py - prev.y) >= 9) break;
    }
    const tx = Math.round(px - CORE_MINE.SIZE / 2), ty = Math.round(py - CORE_MINE.SIZE / 2);
    bases[i].core = cores.length;
    cores.push({ tx, ty, team: i });
  }
  for (let i = 0; i < n; i++) {
    const a = angles[i] + (sideAngles[i] - angles[i]) * 0.5;
    const rr = R * 0.8;
    const px = C + Math.cos(a) * rr, py = C + Math.sin(a) * rr;
    const tx = Math.round(px - MINE.SIZE / 2), ty = Math.round(py - MINE.SIZE / 2);
    mines.push({ tx, ty, rich: true, team: i });
    const ix = (C - px) / (Math.hypot(C - px, C - py) || 1), iy = (C - py) / (Math.hypot(C - px, C - py) || 1);
    camps.push({ x: px + ix * 3.6, y: py + iy * 3.6, kinds: i % 2 ? [4, 3] : [4, 0], tier: 0 });
  }
  // 본진 캠프: 본진 앞 옆(원래 자리). 팀이 많아 큰 금광 · 연못 · 코어 금광 · 섹션과 겹치면 반대쪽 · 조금 다른 자리를 찾는다
  const campClash = (x, y) =>
    mines.some((m) => Math.hypot(m.tx + MINE.SIZE / 2 - x, m.ty + MINE.SIZE / 2 - y) < 6) ||
    ponds.some((m) => Math.hypot(m.tx + POND.SIZE / 2 - x, m.ty + POND.SIZE / 2 - y) < 6) ||
    cores.some((m) => Math.hypot(m.tx + CORE_MINE.SIZE / 2 - x, m.ty + CORE_MINE.SIZE / 2 - y) < 7) ||
    sites.some((q) => Math.hypot(q.x - x, q.y - y) < 7) ||
    camps.some((q) => Math.hypot(q.x - x, q.y - y) < 6);
  for (const b of bases) {
    const at = (u, v) => ({ x: b.cx + b.dir.x * u - b.perp.x * v, y: b.cy + b.dir.y * u - b.perp.y * v });
    let spot = at(10, 6);
    for (const [u, v] of [[10, 6], [10, -6], [12, 3], [12, -3], [9, 8], [9, -8]]) {
      const q = at(u, v);
      if (!campClash(q.x, q.y)) { spot = q; break; }
    }
    camps.push({ ...spot, kinds: b.team % 2 ? [3, 3] : [0, 0], tier: 0 });
  }
  const MIDS = [1, 5, 6];
  for (let i = 0; i < n; i++) {
    const s = sites[i];
    const ix = (C - s.x) / (Math.hypot(C - s.x, C - s.y) || 1), iy = (C - s.y) / (Math.hypot(C - s.x, C - s.y) || 1);
    camps.push({ x: s.x - iy * 3.4, y: s.y + ix * 3.4, kinds: [MIDS[(i + (seed & 3)) % 3], i % 2 ? 4 : 0], tier: 1 });
  }
  camps.push({ x: C, y: C + 3.2, kinds: [(seed & 1) ? 7 : 2, 0, 3], tier: 2 });

  // 5) 길(늘 열려 있어야 하는 곳)
  const roads = [];
  for (let i = 0; i < n; i++) {
    const b = bases[i];
    roads.push([b.cx, b.cy, C, C]);
    const j = (i + 1) % n;
    if (n > 2 || i === 0) roads.push([b.cx, b.cy, bases[j].cx, bases[j].cy]);
    roads.push([sites[i].x, sites[i].y, C, C]);
    roads.push([b.cx, b.cy, sites[i].x, sites[i].y]);
    const prev = (i - 1 + n) % n;
    roads.push([b.cx, b.cy, sites[prev].x, sites[prev].y]);
    const rm = mines[n + i];
    roads.push([b.cx, b.cy, rm.tx + 1.5, rm.ty + 1.5]);
    const cm = cores[i];
    roads.push([b.cx, b.cy, cm.tx + 1, cm.ty + 1]);
  }
  const nearRoad = (x, y, pad) => roads.some((r) => segDist(x, y, r[0], r[1], r[2], r[3]) < pad);

  const keep = [
    ...bases.map((b) => ({ x: b.cx, y: b.cy, r: 12 })),
    ...ponds.map((p) => ({ x: p.tx + 1.5, y: p.ty + 1.5, r: 4 })),
    ...mines.map((p) => ({ x: p.tx + 1.5, y: p.ty + 1.5, r: 4 })),
    ...cores.map((p) => ({ x: p.tx + 1, y: p.ty + 1, r: 5 })),
    ...camps.map((c) => ({ x: c.x, y: c.y, r: 3.5 })),
    ...sites.map((s) => ({ x: s.x, y: s.y, r: s.center ? 6 : 4.5 })),
  ];
  const free = (x, y, r, road = 2.2) => !keep.some((k) => Math.hypot(k.x - x, k.y - y) < k.r + r) && !nearRoad(x, y, r + road);

  // 6) 맵 종류별 지형
  const edge = (x, y) => Math.min(x, y, S - 1 - x, S - 1 - y);
  if (kind === "forest") {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) if (edge(x, y) < 2 || edge(x, y) < 2 + 3.2 * valueNoise(x * 0.18, y * 0.18, seed + 7)) set(x, y, TILE.TREE);
    const blobs = Math.round((S * S) / 200);
    for (let k = 0, tries = 0; k < blobs && tries < blobs * 10; tries++) {
      const r = 1.6 + rand() * 2.4;
      const x = 4 + rand() * (S - 8), y = 4 + rand() * (S - 8);
      if (!free(x, y, r)) continue;
      disc(x, y, r, TILE.TREE, 0.6, seed + k);
      k++;
    }
    const pools = n + 2;
    for (let k = 0, tries = 0; k < pools && tries < pools * 30; tries++) {
      const r = 1.6 + rand() * 1.4;
      const x = 6 + rand() * (S - 12), y = 6 + rand() * (S - 12);
      if (!free(x, y, r + 1)) continue;
      disc(x, y, r, TILE.WATER, 0.5, seed + 99 + k);
      k++;
    }
  } else if (kind === "canal") {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (edge(x, y) < 2 || edge(x, y) < 2 + 2 * valueNoise(x * 0.2, y * 0.2, seed + 3)) set(x, y, TILE.TREE);
    // 가운데를 두른 둥근 수로
    const ring = S * 0.17;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - C, y + 0.5 - C);
        if (Math.abs(d - ring) < 1.3) set(x, y, TILE.WATER);
      }
    // 섹션마다 양옆으로 바깥까지 뻗는 수로 둘(섹션이 반쯤 섬이 된다)
    for (let i = 0; i < n; i++) {
      for (const side of [-1, 1]) {
        const a = sideAngles[i] + side * (n === 2 ? 0.42 : 0.6 / Math.max(1, n / 3));
        for (let r = ring; r < S * 0.47; r += 0.4) {
          const x = C + Math.cos(a) * r, y = C + Math.sin(a) * r;
          disc(x, y, 1.15, TILE.WATER);
        }
      }
    }
    // 흩어진 나무 몇 덩이
    const blobs = Math.round((S * S) / 600);
    for (let k = 0, tries = 0; k < blobs && tries < blobs * 10; tries++) {
      const r = 1.2 + rand() * 1.6;
      const x = 4 + rand() * (S - 8), y = 4 + rand() * (S - 8);
      if (!free(x, y, r) || get(Math.floor(x), Math.floor(y)) !== TILE.FLOOR) continue;
      disc(x, y, r, TILE.TREE, 0.5, seed + k, TILE.FLOOR);
      k++;
    }
  } else {
    // 블록 공장: 바깥 벽 · 기둥 · 상자 벽
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (edge(x, y) < 2) set(x, y, TILE.BLOCK);
    for (let y = 5; y < S - 5; y += 7)
      for (let x = 5; x < S - 5; x += 7) {
        const ox = x + Math.round(rand() * 2 - 1), oy = y + Math.round(rand() * 2 - 1);
        if (!free(ox + 1, oy + 1, 1.5, 1.6)) continue;
        rect(ox, oy, 2, 2, TILE.BLOCK);
      }
    const walls = Math.round((S * S) / 45);
    for (let k = 0, tries = 0; k < walls && tries < walls * 12; tries++) {
      const x = 3 + Math.floor(rand() * (S - 6)), y = 3 + Math.floor(rand() * (S - 6));
      const horiz = rand() < 0.5, len = 3 + Math.floor(rand() * 5), thick = rand() < 0.35 ? 2 : 1;
      let ok = true;
      for (let s = 0; s < len && ok; s++) {
        const px = x + (horiz ? s : 0), py = y + (horiz ? 0 : s);
        if (!inMap(px, py) || keep.some((kk) => Math.hypot(kk.x - px, kk.y - py) < kk.r + 0.5)) ok = false;
      }
      if (!ok) continue;
      for (let s = 0; s < len; s++)
        for (let t = 0; t < thick; t++) {
          const px = x + (horiz ? s : t), py = y + (horiz ? t : s);
          if (get(px, py) === TILE.FLOOR) set(px, py, TILE.CRATE);
        }
      k++;
    }
  }

  // 7) 본진 · 섹션 · 연못 · 캠프 둘레를 비우고, 길을 연다(수로는 길이 지나는 곳이 다리가 된다)
  for (const b of bases) disc(b.cx, b.cy, 11, TILE.FLOOR);
  for (const s of sites) disc(s.x, s.y, s.center ? 5.5 : 4, TILE.FLOOR);
  for (const c of camps) disc(c.x, c.y, 2.6, TILE.FLOOR);
  for (const p of ponds) disc(p.tx + 1.5, p.ty + 1.5, 3.4, TILE.FLOOR);
  for (const p of mines) disc(p.tx + 1.5, p.ty + 1.5, 3.4, TILE.FLOOR);
  // 코어 금광은 숲 고리 속에 — 길(아래)이 고리를 뚫어 들어가는 문이 된다
  for (const c of cores) {
    disc(c.tx + 1, c.ty + 1, 4.6, TILE.TREE, 0.25, seed + 31);
    disc(c.tx + 1, c.ty + 1, 2.6, TILE.FLOOR);
  }
  for (const r of roads) {
    const len = Math.hypot(r[2] - r[0], r[3] - r[1]);
    for (let s = 0; s <= len; s += 0.5) {
      const t = s / (len || 1);
      disc(r[0] + (r[2] - r[0]) * t, r[1] + (r[3] - r[1]) * t, 1.6, TILE.FLOOR);
    }
  }
  // 바깥 테두리는 늘 막혀 있다
  const wallTile = kind === "factory" ? TILE.BLOCK : TILE.TREE;
  for (let i = 0; i < S; i++) { set(i, 0, wallTile); set(i, S - 1, wallTile); set(0, i, wallTile); set(S - 1, i, wallTile); }
  for (const p of ponds) rect(p.tx, p.ty, POND.SIZE, POND.SIZE, TILE.POND);
  for (const p of mines) rect(p.tx, p.ty, MINE.SIZE, MINE.SIZE, TILE.GOLD);
  for (const c of cores) rect(c.tx, c.ty, CORE_MINE.SIZE, CORE_MINE.SIZE, TILE.CORE);

  return { seed, teams: n, size: S, kind, tiles, bases, ponds, mines, cores, sites, camps, roads };
}

/** 칸 (tx, ty) 에서 시작하는 크기 size 의 네모가 맵 안의 빈 바닥인가(건물 · 바위 겹침은 따로 본다) */
export function rectOnFloor(map, tx, ty, size) {
  const S = map.size;
  if (tx < 1 || ty < 1 || tx + size > S - 1 || ty + size > S - 1) return false;
  for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) if (map.tiles[y * S + x] !== TILE.FLOOR) return false;
  return true;
}

/** 지금 걸을 수 없는 칸 표 — 맵 칸 + 건물 + 보석 바위(있을 때). 서버의 길 찾기 격자와 브라우저의 영웅 충돌이 같은 것을 쓴다.
 *  out: Uint8Array(size²). buildings: [{ kind, tx, ty }], sites: [{ tx, ty, rock: bool }] */
export function fillBlocked(map, out, buildings = [], sites = []) {
  const S = map.size;
  for (let i = 0; i < S * S; i++) out[i] = map.tiles[i] !== TILE.FLOOR ? 1 : 0;
  for (const b of buildings) {
    const w = BUILDINGS[b.kind].size;
    for (let y = b.ty; y < b.ty + w; y++) for (let x = b.tx; x < b.tx + w; x++) if (x >= 0 && y >= 0 && x < S && y < S) out[y * S + x] = 1;
  }
  for (const s of sites) if (s.rock) for (let y = s.ty; y < s.ty + GEM.ROCK; y++) for (let x = s.tx; x < s.tx + GEM.ROCK; x++) out[y * S + x] = 1;
  return out;
}
