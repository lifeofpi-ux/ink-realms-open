// 격자 맵(docs/DESIGN.md §5 · shared/arena.js 의 잉크 운동장)을 렌더러가 쓰는 모양으로 바꾸는 얇은 층(순수 함수 — Node 시험에서 돈다).
//
// shared/arena.js: A.grid = { n, cell(2u), tiles(Uint8Array 칸 종류 — TILE), blocks(Uint8Array 부서지는 블록이 지금 있으면 1 — 경기 중에 바뀐다) },
//   칸 (c, r) 의 가운데 = 월드 (c·2 − n + 1, r·2 − n + 1), 칸 번호 i = r·n + c, A.homes = [{ id, c0, r0, c1, r1, … }].
// 렌더러는 blocks 를 프레임마다 그대로 읽는다(game.js 가 {k:"blk"} 로 바꾸는 그 배열 — 따로 들고 있지 않는다).
// 옛 자료(원기둥 · 상자 — obstacles/boxes 만 있는 낙하전 · 잉크 공장)면 null: 렌더러는 그것들을 상자로 그린다.

import { TILE } from "../shared/arena.js";

/**
 * 칸 종류 — shared/arena.js 의 TILE 과 같은 값(렌더러 · 미니맵이 같은 번호를 쓴다). v8 의 잉크 강 · 다리(TILE.WATER 8 · BRIDGE 9)는
 * RIVER · BRIDGE 로(없으면 −1 — 어느 칸과도 같지 않다)
 */
export const CELL = Object.freeze({
  FLOOR: 0, SOLID: 1, BREAK: 2, WALL: 3, HOME: 4, ZONE: 5, PAD: 6, BOARD: 7,
  RIVER: TILE && TILE.WATER >= 0 ? TILE.WATER : TILE && TILE.RIVER >= 0 ? TILE.RIVER : -1,
  BRIDGE: TILE && TILE.BRIDGE >= 0 ? TILE.BRIDGE : -1,
  GATE: TILE && TILE.GATE >= 0 ? TILE.GATE : -1, // 던전의 문(닫혀 있으면 blocks 1 — 임시 블록과 같은 "barrier" 그림)
});
/** 블록 칸(지나갈 수 없고 상자로 그린다) */
export const isBlock = (k) => k === CELL.SOLID || k === CELL.BREAK || k === CELL.WALL || k === CELL.BOARD;
/** 그리는 블록 높이(u) — shared/constants.js 의 BLOCK 과 같은 값(바깥 벽은 판정상 무한대지만 그림은 단단한 블록 높이) */
export const BLOCK_H = Object.freeze({ [CELL.SOLID]: 1.5, [CELL.BREAK]: 1.1, [CELL.WALL]: 1.5, [CELL.BOARD]: 3.2 });

/**
 * arenaAt / newArena 결과 → 렌더러 격자(없으면 null).
 * @returns {null | { n, size, x0, z0, tile: Uint8Array, kind: Uint8Array, home: Int8Array, height: Float32Array,
 *                    blocks: Uint8Array, standing: (i:number) => boolean }}
 */
export function gridOf(A, heights = null) {
  const g = A && A.grid;
  if (!g || !g.tiles || !(g.n > 0)) return null;
  const n = g.n;
  const size = g.cell || 2;
  const tile = g.tiles;
  const home = new Int8Array(n * n).fill(-1);
  for (const h of A.homes || []) {
    if (!(h.c1 >= h.c0 && h.r1 >= h.r0)) continue;
    for (let r = h.r0; r <= h.r1; r++) for (let c = h.c0; c <= h.c1; c++) if (r >= 0 && c >= 0 && r < n && c < n) home[r * n + c] = h.id;
  }
  const H = heights || BLOCK_H;
  const height = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) height[i] = isBlock(tile[i]) ? H[tile[i]] ?? 1.5 : 0;
  const blocks = g.blocks || new Uint8Array(n * n).fill(1);
  const G = {
    n, size, x0: -(n * size) / 2, z0: -(n * size) / 2, tile, kind: tile, home, height, blocks,
    /** [왕국전] 칸이 숲의 나무인가(props.js 가 나무 모델로 그린다) */
    tree: g.tree || null,
    /** 장벽 설치물의 임시 블록 칸 → 팀 색(0xRRGGBB) — renderer.blockChanged 가 채운다 */
    temp: new Map(),
    /** 칸 i 에 블록이 지금 서 있는가(부서지는 블록 · 장벽의 임시 블록은 blocks 로) */
    standing: (i) => {
      const t = tile[i];
      return t === CELL.SOLID || t === CELL.WALL || t === CELL.BOARD || (blocks[i] === 1 && t !== CELL.RIVER);
    },
  };
  return G;
}

/** 칸 i 의 가운데(월드) */
export function cellCenter(G, i, out = { x: 0, z: 0 }) {
  out.x = G.x0 + ((i % G.n) + 0.5) * G.size;
  out.z = G.z0 + (Math.floor(i / G.n) + 0.5) * G.size;
  return out;
}

/** 월드 (x, z) 가 든 칸 번호(밖이면 −1) */
export function cellAt(G, x, z) {
  const c = Math.floor((x - G.x0) / G.size);
  const r = Math.floor((z - G.z0) / G.size);
  return c < 0 || r < 0 || c >= G.n || r >= G.n ? -1 : r * G.n + c;
}

/** (x, z) 칸에 지금 서 있는 블록의 높이(없으면 0) */
export function heightAt(G, x, z) {
  const i = cellAt(G, x, z);
  return i < 0 ? 0 : G.standing(i) ? G.height[i] : 0;
}
