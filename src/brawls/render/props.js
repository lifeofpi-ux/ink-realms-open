// 장애물 묶음 규칙(docs/DESIGN.md §3.0 · §3.10 — 순수 함수, test/render-map.test.js): 막힌 칸 → 그림 묶음. 이웃한 막힌 칸은 큰 덩어리 하나로
// 묶는다(2×1 · 1×2 · 2×2 — 같은 종류끼리, 칸 해시로 결정적). 블록이 부서지면 그 묶음만 다시 나눈다(props3d.js 가 부른다).
// 그리기는 props3d.js(three.js 3D 모델)가 맡는다.
import { CELL, isBlock } from "./grid.js";


export const hash = (i, s = 0) => {
  let h = Math.imul((i + 1) ^ Math.imul(s + 1, 0x45d9f3b), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

/** 칸 종류 → 묶음 종류(애셋 props 의 kind). 그리지 않으면 null */
export function propClass(t) {
  if (t === CELL.SOLID) return "solid";
  if (t === CELL.BREAK) return "soft";
  if (t === CELL.WALL) return "wall";
  if (t === CELL.BOARD) return "board";
  return null;
}

/** 칸 i 의 묶음 종류(서 있는 것만): 장벽의 임시 블록(G.temp · 또는 바닥 칸에 선 블록)은 "barrier" */
export function cellClass(G, i) {
  if (!G.standing(i)) return null;
  if (G.tree && G.tree[i]) return "tree"; // [왕국전] 숲의 나무(베면 사라진다)
  const t = G.tile[i];
  if ((G.temp && G.temp.has(i)) || (t !== CELL.BREAK && !isBlock(t))) return "barrier";
  return propClass(t);
}

const SHAPES = { solid: ["2x2", "2x1", "1x2"], soft: ["2x1"] };
/**
 * 막힌 칸 → 그림 묶음(순수 함수 — test/render-map.test.js). 칸 번호 순서(위 행부터)로 훑으며, 아직 묶이지 않은 칸에서
 * 2×2(단단한 것) → 2×1 → 1×2(단단한 것) → 1×1 을 칸 해시 확률로 시도한다(그 모양 그림이 있을 때만). 같은 칸 상태면 늘 같은 결과.
 * @param {{ n, tile, standing(i) }} G
 * @param {number[]} [only]  이 칸들만 다시 묶는다(나머지 묶음은 그대로 — 부서진 묶음 다시 나누기)
 * @param {object} [shapes]  종류 → 쓸 수 있는 묶음 모양(["2x2", "2x1", "1x2"])
 * @returns {{ c, r, w, h, cls, cells: number[] }[]}
 */
export function groupBlocks(G, only = null, shapes = SHAPES) {
  const n = G.n;
  const owner = new Uint8Array(n * n);
  const out = [];
  const allow = only ? new Set(only) : null;
  const cls = (i) => cellClass(G, i);
  const free = (c, r, k) => {
    if (c < 0 || r < 0 || c >= n || r >= n) return false;
    const i = r * n + c;
    return !owner[i] && (!allow || allow.has(i)) && cls(i) === k;
  };
  const has = (k, s) => (shapes[k] || []).includes(s);
  const visit = (i) => {
    const c = i % n, r = (i / n) | 0;
    const k = cls(i);
    if (!k || owner[i] || (allow && !allow.has(i))) return;
    let w = 1, hh = 1;
    if (has(k, "2x2") && free(c + 1, r, k) && free(c, r + 1, k) && free(c + 1, r + 1, k) && hash(i, 11) < 0.5) [w, hh] = [2, 2];
    else if (has(k, "2x1") && free(c + 1, r, k) && hash(i, 12) < (k === "solid" ? 0.55 : 0.4)) w = 2;
    else if (has(k, "1x2") && free(c, r + 1, k) && hash(i, 13) < 0.45) hh = 2;
    const cells = [];
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const j = (r + y) * n + (c + x);
      owner[j] = 1;
      cells.push(j);
    }
    out.push({ c, r, w, h: hh, cls: k, cells });
  };
  if (allow) [...allow].sort((a, b) => a - b).forEach(visit);
  else for (let i = 0; i < n * n; i++) visit(i);
  return out;
}

