// 맵 3종 × 팀 2~8: 같은 씨앗이면 같은 맵, 그리고 상자를 하나도 안 부숴도 1칸 넘는(2칸 너비) 길로
// 모든 본진 · 연못 · 금광 · 코어 금광 · 보석 섹션 · 캠프에 닿는다(docs/DESIGN.md §13)
import test from "node:test";
import assert from "node:assert/strict";
import { generateMap, fillBlocked } from "../shared/map.js";
import { MAP_SIZE, BLD, GEM, POND, MINE, CORE_MINE, TILE, MAPS, MAX_TEAMS, TEAM_COUNTS, TEAM_COLORS, TEAM_NAMES } from "../shared/constants.js";

const KINDS = MAPS.map((m) => m.key);
const SEEDS = [1, 7, 42, 2026, 31337];

/** 본진 건물과 보석 바위까지 막은 칸 표(경기 처음 모습) */
function blockedOf(map) {
  const blds = [];
  for (const b of map.bases) blds.push({ kind: BLD.TOWER, ...b.tower }, { kind: BLD.SUPPLY, ...b.supply }, { kind: BLD.LAB, ...b.lab }, { kind: BLD.FACILITY, ...b.facility });
  return fillBlocked(map, new Uint8Array(map.size ** 2), blds, map.sites.map((s) => ({ tx: s.tx, ty: s.ty, rock: true })));
}

/** 2×2 몸이 지나갈 수 있는 곳만 따라 퍼진다. seen[y*S+x] = 왼쪽 위가 (x, y) 인 2×2 자리에 닿았나 */
function spread2(map, blk, sx, sy) {
  const S = map.size;
  const free = (x, y) => x >= 0 && y >= 0 && x < S && y < S && !blk[y * S + x];
  const sq = (x, y) => free(x, y) && free(x + 1, y) && free(x, y + 1) && free(x + 1, y + 1);
  let ox = -1, oy = -1;
  for (let r = 0; r < 5 && ox < 0; r++)
    for (let y = sy - r; y <= sy + r && ox < 0; y++) for (let x = sx - r; x <= sx + r; x++) if (sq(x, y)) { ox = x; oy = y; break; }
  assert.ok(ox >= 0, "출발 자리에 2×2 빈 곳이 있다");
  const seen = new Uint8Array(S * S);
  const q = [oy * S + ox];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), x = i % S, y = (i / S) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!sq(nx, ny)) continue;
      const j = ny * S + nx;
      if (!seen[j]) { seen[j] = 1; q.push(j); }
    }
  }
  return seen;
}

/** (tx, ty) 에서 시작하는 w×w 네모 바로 옆(맞닿음)에 닿은 2×2 자리가 있나 */
function touches(S, seen, tx, ty, w) {
  for (let y = ty - 2; y <= ty + w; y++)
    for (let x = tx - 2; x <= tx + w; x++) {
      if (x < 0 || y < 0 || x >= S || y >= S || !seen[y * S + x]) continue;
      const gx = Math.max(0, tx - (x + 1), x - (tx + w - 1)), gy = Math.max(0, ty - (y + 1), y - (ty + w - 1));
      if (gx <= 1 && gy <= 1 && gx + gy >= 1) return true;
    }
  return false;
}

function nearSeen(S, seen, cx, cy, r) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (x >= 0 && y >= 0 && x < S && y < S && seen[y * S + x]) return true;
  return false;
}

test("맵: 같은 씨앗 · 팀 수 · 종류면 같은 맵, 크기 · 본진 · 캐는 곳 · 섹션 수", () => {
  for (const kind of KINDS)
    for (let teams = 2; teams <= MAX_TEAMS; teams++) {
      const a = generateMap(99, teams, kind), b = generateMap(99, teams, kind);
      assert.ok(a.size <= 255, "건물 · 섹션 칸 좌표는 u8");
      assert.equal(a.kind, kind);
      assert.equal(a.size, MAP_SIZE[teams]);
      assert.deepEqual(a.tiles, b.tiles);
      assert.equal(a.bases.length, teams);
      assert.equal(a.ponds.length, teams, "연못은 본진마다 하나");
      assert.equal(a.mines.filter((m) => !m.rich).length, teams, "본진 금광");
      assert.equal(a.mines.filter((m) => m.rich).length, teams, "큰 금광");
      assert.equal(a.cores.length, teams, "코어 금광");
      assert.equal(a.sites.length, teams + 1, "보석 섹션 = 팀 수 + 1");
      assert.equal(a.sites.filter((s) => s.center).length, 1);
      for (const base of a.bases) {
        assert.equal(a.ponds[base.pond].team, base.team);
        assert.equal(a.mines[base.mine].rich, false);
        assert.equal(a.cores[base.core].team, base.team);
      }
      // 캐는 곳은 맵 칸으로 막혀 있다
      const S = a.size;
      for (const p of a.ponds) assert.equal(a.tiles[p.ty * S + p.tx], TILE.POND);
      for (const m of a.mines) assert.equal(a.tiles[m.ty * S + m.tx], TILE.GOLD);
      for (const c of a.cores) assert.equal(a.tiles[c.ty * S + c.tx], TILE.CORE);
    }
  assert.notDeepEqual(generateMap(5, 3, "forest").tiles, generateMap(5, 3, "factory").tiles, "종류가 다르면 다른 맵");
});

test("맵: 상자를 안 부숴도 2칸 너비 길로 모든 본진 · 연못 · 금광 · 코어 금광 · 섹션 · 캠프에 닿는다", () => {
  for (const kind of KINDS)
    for (let teams = 2; teams <= MAX_TEAMS; teams++)
      for (const seed of SEEDS) {
        const map = generateMap(seed, teams, kind);
        const S = map.size;
        const seen = spread2(map, blockedOf(map), Math.floor(map.bases[0].spawn.x), Math.floor(map.bases[0].spawn.y));
        const tag = `${kind} 팀 ${teams} 씨앗 ${seed}`;
        for (const b of map.bases) assert.ok(nearSeen(S, seen, b.spawn.x, b.spawn.y, 2), `${tag}: 본진 ${b.team}`);
        map.ponds.forEach((p, i) => assert.ok(touches(S, seen, p.tx, p.ty, POND.SIZE), `${tag}: 연못 ${i}`));
        map.mines.forEach((m, i) => assert.ok(touches(S, seen, m.tx, m.ty, MINE.SIZE), `${tag}: 금광 ${i}`));
        map.cores.forEach((c, i) => assert.ok(touches(S, seen, c.tx, c.ty, CORE_MINE.SIZE), `${tag}: 코어 금광 ${i}`));
        map.sites.forEach((s, i) => assert.ok(touches(S, seen, s.tx, s.ty, GEM.ROCK), `${tag}: 섹션 ${i}`));
        map.camps.forEach((c, i) => assert.ok(nearSeen(S, seen, c.x, c.y, 1.5), `${tag}: 캠프 ${i}`));
      }
});

test("맵: 팀 수 2~8 · 팀 색 · 이름이 8개 · 8팀보다 많이 달라고 해도 8팀", () => {
  assert.deepEqual(TEAM_COUNTS, [2, 3, 4, 5, 6, 7, 8]);
  assert.equal(TEAM_COLORS.length, MAX_TEAMS);
  assert.equal(new Set(TEAM_COLORS).size, MAX_TEAMS);
  assert.equal(new Set(TEAM_NAMES).size, MAX_TEAMS);
  assert.equal(generateMap(1, 12, "forest").teams, MAX_TEAMS);
});

test("맵: 캠프는 서로 겹치지 않고(5칸 넘게) 금광 안에 들지 않는다 · 7 · 8팀도 본진 사이가 넉넉하다", () => {
  for (const kind of KINDS)
    for (let teams = 2; teams <= MAX_TEAMS; teams++)
      for (const seed of SEEDS) {
        const m = generateMap(seed, teams, kind);
        const tag = `${kind} 팀 ${teams} 씨앗 ${seed}`;
        for (let i = 0; i < m.camps.length; i++) {
          for (let j = i + 1; j < m.camps.length; j++) assert.ok(Math.hypot(m.camps[i].x - m.camps[j].x, m.camps[i].y - m.camps[j].y) > 5, `${tag}: 캠프 ${i} · ${j}`);
          for (const q of m.mines) assert.ok(Math.hypot(q.tx + 1.5 - m.camps[i].x, q.ty + 1.5 - m.camps[i].y) > 2.5, `${tag}: 캠프 ${i} 가 금광 안`);
        }
        for (let i = 0; i < teams; i++)
          for (let j = i + 1; j < teams; j++) assert.ok(Math.hypot(m.bases[i].cx - m.bases[j].cx, m.bases[i].cy - m.bases[j].cy) >= 30, `${tag}: 본진 ${i} · ${j}`);
      }
});

test("맵: 블록 공장에는 부서지는 상자가 있고, 수로에는 물이 있다", () => {
  const f = generateMap(3, 4, "factory"), c = generateMap(3, 4, "canal");
  assert.ok(f.tiles.some((t) => t === TILE.CRATE));
  assert.ok(c.tiles.some((t) => t === TILE.WATER));
});
