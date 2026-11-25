// 퀴즈 룸 · 전광판의 모양(순수 계산 — Node 시험에서 그대로 쓴다). docs/DESIGN.md §3.6 · §5.2.
//
// 전광판: 존 가운데에서 화면 위쪽(월드 −z, QUIZ.BOARD_DIST = 9u)에 받침(칸 자료의 BOARD 칸, 높이 BLOCK.BOARD_H 3.2u)이 서고,
// 그 위에 카메라를 똑바로 보는 판(문제 머리판 + 카드 n 장)이 뜬다 — 판이 시선과 직각이라 글자가 눌리지 않는다.
// 수치는 월드 u. 카드 가운데 = 받침 발밑 + 화면 오른쪽 x + 높이 y.
import { QUIZ } from "../shared/constants.js";
import { PROJ, SQUASH, LIFT } from "./camera.js";

export const BOARD = Object.freeze({
  BASE_H: 3.2, // 받침 높이(shared/constants.js 의 BLOCK.BOARD_H 와 같다)
  CARD_W: 4.3,
  CARD_H: 2.7,
  GAP: 0.4,
  ROW_Y: 4.75, // 카드 줄 가운데 높이
  HEADER_H: 1.3,
  HEADER_GAP: 0.3,
  MAX_CARDS: 5,
});

/** 판의 자리들. n = 카드 수(1..5). x = 화면 오른쪽(u), y = 높이(u) — 둘 다 받침 발밑 기준 */
export function boardLayout(n = BOARD.MAX_CARDS) {
  const k = Math.max(1, Math.min(BOARD.MAX_CARDS, n | 0));
  const span = k * BOARD.CARD_W + (k - 1) * BOARD.GAP;
  const cards = [];
  for (let i = 0; i < k; i++) cards.push({ x: -span / 2 + BOARD.CARD_W / 2 + i * (BOARD.CARD_W + BOARD.GAP), y: BOARD.ROW_Y, w: BOARD.CARD_W, h: BOARD.CARD_H });
  const fullSpan = BOARD.MAX_CARDS * BOARD.CARD_W + (BOARD.MAX_CARDS - 1) * BOARD.GAP;
  // 카드와 머리판은 카메라를 보는 판이라 높이 대신 "화면 위로" 쌓는다 — 화면 위 1u = 높이 1 / LIFT 만큼 위가 아니라
  // 판 위의 위쪽(PROJ.up)으로 재는 거리. 여기서는 그 거리를 그대로 쓴다(renderer 가 PROJ.up 으로 펼친다)
  const header = { x: 0, y: BOARD.ROW_Y, up: BOARD.CARD_H / 2 + BOARD.HEADER_GAP + BOARD.HEADER_H / 2, w: fullSpan, h: BOARD.HEADER_H };
  return { cards, header, span, fullSpan, topScreen: BOARD.ROW_Y * LIFT + header.up + BOARD.HEADER_H / 2 }; // topScreen = 받침 발밑에서 판 꼭대기까지(화면 u)
}

/** 판 위의 자리(받침 발밑 b 에서 화면 오른쪽 x · 높이 y · 판 위쪽 up) → 월드 점 */
export function boardPoint(b, x, y, up = 0, out = { x: 0, y: 0, z: 0 }) {
  out.x = b.x + PROJ.right[0] * x + PROJ.up[0] * up;
  out.y = y + PROJ.up[1] * up;
  out.z = b.z + PROJ.right[2] * x + PROJ.up[2] * up;
  return out;
}

/** 존 가운데에서 화면 위쪽으로 QUIZ.BOARD_DIST 떨어진 받침 자리(자료에 board 가 없을 때). 화면 위 = 바닥의 −PROJ.down(YAW 0° 에서 −z) */
export function defaultBoardSpot(x, z, dist = QUIZ.BOARD_DIST ?? 9) {
  return { x: x - PROJ.down[0] * dist, z: z - PROJ.down[2] * dist };
}

/**
 * 룸 근처에서 스크롤 목표를 화면 위쪽으로 치우치는 양(화면 u, 0 이하). 시점은 그대로이고 목표만 옮긴다(docs/DESIGN.md §3.6).
 * 존 가운데에서 r + 2u 안이면 끝까지, r + 7u 밖이면 0. 끝까지 치우치면 화면 가운데가 "존 아래 끝 ~ 판 꼭대기"의 한가운데.
 * @param {number} targetY  지금 스크롤 목표의 화면 y(follow 가 정한 값, u)
 */
export function focusBias(px, pz, rooms, targetY) {
  if (!rooms || !rooms.length) return 0;
  let best = 0;
  const lay = boardLayout(BOARD.MAX_CARDS);
  for (const r of rooms) {
    const d = Math.hypot(px - r.x, pz - r.z);
    const near = r.r + 2;
    const far = r.r + 7;
    if (d >= far) continue;
    const t = d <= near ? 1 : 1 - (d - near) / (far - near);
    const w = t * t * (3 - 2 * t);
    const zoneRz = r.x * PROJ.sin + r.z * PROJ.cos;
    const zoneBottom = (zoneRz + r.r) * SQUASH;
    const b = r.board || defaultBoardSpot(r.x, r.z);
    const top = (b.x * PROJ.sin + b.z * PROJ.cos) * SQUASH - lay.topScreen - 0.4;
    const mid = (zoneBottom + top) / 2;
    const dy = Math.min(0, mid - targetY) * w;
    if (dy < best) best = dy;
  }
  return best;
}

/** 존 둘레 게이지의 반지름(팀마다 바깥으로 한 줄씩) */
export const gaugeRadius = (r, i) => r + 0.3 + i * 0.32;

/**
 * 풀이 판(docs/DESIGN.md §2.6 — 사용자 확정): 풀이 중인 팀의 화면 위쪽에 고정되는 문제 띠 + 답 카드 n 장의 자리(CSS px).
 * 존 어디에 서 있든 · 룸이 화면 어디에 있든 늘 같은 자리에 다 보인다. 문제 띠와 카드는 한 덩어리다(같은 상태에서 함께 그리고 함께 사라진다).
 *  - 위: 시계 · 팀 띠 아래(낮은 화면은 맨 위). 옆: side(px)만큼 비운다(넓은 화면은 오른쪽 위 미니맵 자리 — 좁은 화면은 화면이 미니맵을 접는다).
 *  - 크기: 문제 띠는 HD 캔버스의 머리판(1024 × 96)과 같은 비율, 카드는 256 × 160 비율. 판 전체가 화면 높이의 MAX_H 를 넘지 않게 줄인다.
 * @returns {{ x, y, w, h, bottom, head: {x, y, w, h}, cards: {x, y, w, h}[] }}
 */
export const PANEL = Object.freeze({ MAX_W: 1040, MAX_CARD_W: 250, SIDE: 12, MAX_H: 0.46, HEAD: 96 / 1024, CARD: 160 / 256, WIDE: 1180 });
export function panelLayout(cssW, cssH, n, side = -1) {
  const k = Math.max(1, Math.min(BOARD.MAX_CARDS, n | 0));
  const top = cssH < 560 ? 6 : Math.min(64, Math.max(40, cssW * 0.05)) + 30 + 54; // 시계(clamp(40px, 5vw, 64px)) + 팀 띠(그림자까지) 아래
  if (side < 0) side = cssW >= PANEL.WIDE ? Math.min(210, Math.max(150, cssW * 0.14)) + 36 : PANEL.SIDE; // 넓은 화면: 미니맵(.minimap 너비) 자리를 비운다
  let W = Math.max(200, Math.min(PANEL.MAX_W, cssW - 2 * side));
  let cap = PANEL.MAX_CARD_W;
  const fit = (w) => {
    const gap = Math.max(6, Math.min(14, w * 0.012));
    const headH = w * PANEL.HEAD;
    const cw = Math.min(cap, (w - gap * (k - 1)) / k);
    const ch = cw * PANEL.CARD;
    return { gap, headH, cw, ch, total: headH + gap + ch };
  };
  let f = fit(W);
  const maxH = cssH * PANEL.MAX_H;
  for (let i = 0; i < 6 && f.total > maxH + 0.01; i++) {
    const r = maxH / f.total;
    W *= r;
    cap *= r;
    f = fit(W);
  }
  const cx = cssW / 2;
  const x = cx - W / 2;
  const head = { x, y: top, w: W, h: f.headH };
  const rowW = k * f.cw + (k - 1) * f.gap;
  const cy = top + f.headH + f.gap;
  const cards = [];
  for (let i = 0; i < k; i++) cards.push({ x: cx - rowW / 2 + i * (f.cw + f.gap), y: cy, w: f.cw, h: f.ch });
  return { x, y: top, w: W, h: f.total, bottom: top + f.total, head, cards };
}

/** 그 자리(CSS px)의 카드 번호, 없으면 −1. pad = 둘레 여유(px) */
export function panelCardAt(lay, px, py, pad = 0) {
  if (!lay) return -1;
  for (let i = 0; i < lay.cards.length; i++) {
    const c = lay.cards[i];
    if (px >= c.x - pad && px <= c.x + c.w + pad && py >= c.y - pad && py <= c.y + c.h + pad) return i;
  }
  return -1;
}

/**
 * 화면 위 판에 띄울 카드(룸 상태 목록에서): 우리 팀이 풀고 있는 카드(판정 전)가 있으면 그것, 없으면 판정이 난 지 keep 초 안의 카드
 * (성공 빛 · 실패 조각 연출) — 둘 이상이면 가장 늦게 받은 문제(card.serial). 없으면 null. resultAt(room) = 그 룸의 판정을 처음 본 때(초).
 */
export function pickPanel(rooms, now, resultAt, keep = 1.8) {
  let best = null;
  for (const r of rooms) {
    const c = r && r.card;
    if (!c) continue;
    const live = !c.result;
    if (!live && !(now - resultAt(r) <= keep)) continue;
    if (!best || (live && best.card.result) || (live === !best.card.result && (c.serial ?? 0) > (best.card.serial ?? 0))) best = r;
  }
  return best;
}
