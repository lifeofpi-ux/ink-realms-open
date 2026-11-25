// 맵 색(docs/DESIGN.md §5.3 미니맵): 렌더러의 바닥 · 블록과 UI 의 미니맵이 **같은 색**을 쓰도록 여기서 내보낸다.
// 값은 style.js 의 지금 겉모습에서 온다(스타일이 바뀌면 미니맵도 따라 바뀐다). three.js 를 불러오지 않는다.
//
//   import { MAP_COLORS, cellColor, cssOf, ROOM_COLORS } from "./render/palette.js";
//   ctx.fillStyle = cssOf(cellColor(tiles[i], teamHex));   // tiles = arena.grid.tiles(shared/arena.js 의 TILE 값)
import { PALETTE } from "../shared/constants.js";
import { CELL } from "./grid.js";
import { STYLE } from "./style.js";

const C = STYLE.colors;
/** 대표 색(0xRRGGBB) — 미니맵은 블록을 몸(밝은 면) 색, 바깥 벽을 형광 띠 색으로 */
export const MAP_COLORS = Object.freeze({
  outside: C.background,
  floorA: C.floorA,
  floorB: C.floorB,
  solid: C.solid[0][1],
  breakable: C.breakable[0][1],
  wall: C.wall[1],
  board: C.board[1],
  path: C.path,
  plaza: C.plaza,
  river: C.river,
  bridge: C.bridge,
  homeNeutral: C.homeA,
  zone: C.zoneA,
  zoneLine: C.zoneB,
  pad: C.pad,
  shadow: C.shadow,
});

/** 0xRRGGBB → "#rrggbb" */
export const cssOf = (hex) => "#" + (hex >>> 0).toString(16).padStart(6, "0").slice(-6);

/** 두 색 섞기(t = 0 이면 a) */
export function mixHex(a, b, t) {
  const ch = (s) => Math.round(((a >> s) & 255) + ((((b >> s) & 255) - ((a >> s) & 255)) * t));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** 색을 짙게(외곽선 · 가장자리 톤). k = 남길 밝기 비율 */
export const darkHex = (hex, k = 0.62) => mixHex(hex, 0x05040c, 1 - k);

/** PALETTE 번호 → 팀 색(0xRRGGBB). −1 이나 범위 밖이면 중립 */
export const teamHex = (i) => (i >= 0 && i < PALETTE.length ? PALETTE[i].hex : 0xb9aee0);

/**
 * 칸 종류(CELL = shared/arena.js 의 TILE) → 미니맵 대표 색. team = 그 칸(홈 띠)의 팀 색 0xRRGGBB(모르면 생략)
 */
export function cellColor(kind, team) {
  switch (kind) {
    case CELL.SOLID: return MAP_COLORS.solid;
    case CELL.BREAK: return MAP_COLORS.breakable;
    case CELL.WALL: return MAP_COLORS.wall;
    case CELL.BOARD: return MAP_COLORS.board;
    case CELL.HOME: return team === undefined ? MAP_COLORS.homeNeutral : mixHex(MAP_COLORS.floorA, team, 0.55);
    case CELL.ZONE: return MAP_COLORS.plaza;
    case CELL.PAD: return MAP_COLORS.pad;
    case CELL.RIVER: return MAP_COLORS.river;
    case CELL.BRIDGE: return MAP_COLORS.bridge;
    case CELL.FLOOR: return MAP_COLORS.floorA;
    default: return MAP_COLORS.outside;
  }
}

/** 퀴즈 룸 상태 색(미니맵 · 존 고리): 열림 · 우리 팀 완료(풀이 중은 그 팀 색) */
export const ROOM_COLORS = Object.freeze({ open: 0xffffff, done: 0x00ffa3 });
