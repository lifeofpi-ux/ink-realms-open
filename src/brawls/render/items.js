// 아이템(맵에 떠 있는 잉크 · 에너지 · 부스터 · 보호막 · 새 아이템 · 롱샷): 작은 three.js 3D 모델(models.js 의 item/<번호 | key>)이
// 제자리에서 돌며 떠오르내린다(docs/DESIGN.md §3.10). 그리기는 props3d.js 의 묶음 하나(장애물과 같이).
// 색 표(ITEM_COLOR · itemColor · SHIELD_COLOR)는 main.js 의 머리 위 글자에도 쓴다.
import { ENERGY_KIND, BOOST_KIND, SHIELD_KIND, kindKey, KIND_OF } from "../shared/constants.js";
import { MODE, SHAPE } from "./sprites.js";
import { MAP_COLORS } from "./palette.js";
import { activeProps } from "./props3d.js";

/** 보호막 색(막 · 아이템 · "튕겨 냄!" 글자) */
export const SHIELD_COLOR = 0x6fd3f2;

/** 아이템 종류 → 색 */
export const ITEM_COLOR = [
  0x9a8cc8, // 기본 잉크
  0xff6f8e, // 대왕
  0xf5c400, // 삼발
  0x5fc95a, // 끈끈이
  0x5b8dff, // 미사일
  0xff5fc8, // 메가 잉크 폭탄(맵에 뜨지 않는다)
  0xff8a2a, // 유도 미사일
];
ITEM_COLOR[ENERGY_KIND] = 0x2fcf7f;
ITEM_COLOR[BOOST_KIND] = 0xf2b51d;
ITEM_COLOR[SHIELD_KIND] = SHIELD_COLOR;
// 새 아이템(종류 번호 — shared/constants.js KIND_OF): 머리 위 "○○ 획득!" 글자 · 바닥 빛 고리 색
Object.assign(ITEM_COLOR, {
  [KIND_OF.firework]: 0xff9e2c, [KIND_OF.vortex]: 0xb58cff, [KIND_OF.drill]: 0x7fd0ff,
  [KIND_OF.wall]: 0xd6c7ff, [KIND_OF.trap]: 0x7cd957, [KIND_OF.smoke]: 0xb9b3d6, [KIND_OF.rally]: 0xff6fae, [KIND_OF.aegis]: 0x6fe0f2, [KIND_OF.spray]: 0x5ff0a6,
  [KIND_OF.range]: 0xffad3b,
});

export const itemColor = (kind) => ITEM_COLOR[kind] ?? 0x9a8cc8;

/** 모델에 칠하는 또렷한 색(종류마다 — 한눈에 갈리게). 머리 위 글자는 ITEM_COLOR */
const MODEL_HEX = {
  0: 0x00f0ff, 1: 0xff2d95, 2: 0xffe600, 3: 0xa8ff00, 4: 0x5b8dff, 5: 0xff2d95, 6: 0xff8a2a, 9: 0x2fcf7f, 10: 0xffd400, 11: 0x6fd3f2,
  firework: 0xff2d95, vortex: 0xa24bff, drill: 0x00f0ff, wall: 0xff7a00, trap: 0xa8ff00, smoke: 0xb7bad0, rally: 0xff2d95, aegis: 0x00f0ff,
  spray: 0xa8ff00, range: 0x00f0ff,
};
export const ITEM_SCALE = 1.8;

/**
 * 아이템 하나. B = { decals }, o = { decalShadow, scale }. 모델 이름: 종류 0~11 은 item/<번호>, 그 밖은 item/<영문 key>(docs/CONTRACT.md §2)
 */
export function drawItem(B, x, z, kind, time, gy = 0, art = null, o = {}) {
  const bob = 0.42 + Math.sin(time * 3.2 + x * 1.7 + z) * 0.1;
  if (o.decalShadow) B.decals.push(x + 0.18, gy + 0.01, z + 0.12, 0.8, 0.55, MAP_COLORS.shadow, 0.35, SHAPE.DISC, 0, MODE.FLAT, 0.01);
  // 바닥에 은은한 빛 고리(주울 수 있다는 표시)
  B.decals.push(x, gy + 0.01, z, 1.1, 1.1, itemColor(kind), 0.4 + 0.15 * Math.sin(time * 4 + x), SHAPE.RING, 0.16, MODE.FLAT, 0.02, 0.7);
  const P = activeProps();
  const key = kind < 12 ? String(kind) : kindKey(kind);
  let name = `item/${key}`;
  if (P && !P.has(name)) name = "item/0";
  const hex = MODEL_HEX[key] ?? itemColor(kind);
  if (P) P.push(name, x, gy + bob, z, time * 2.2 + x * 0.37 + z * 0.61, hex, (o.scale || 1) * ITEM_SCALE, Math.sin(time * 1.7 + x) * 0.12, 0);
  else B.spheres && B.spheres.ball(x, gy + bob, z, 0.3, itemColor(kind), 0.4);
}
