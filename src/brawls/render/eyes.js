// 눈 창 안의 눈(docs/DESIGN.md §3.9 "눈은 둥근 네모 창"): 캐릭터 종류(줄) × 표정(칸)을 작은 아틀라스 한 장에 그린다.
// 창(모서리가 둥근 가로로 긴 네모 · 짙은 테두리 · 살색 바탕)은 figures.js 의 셰이더가 머리 앞면에 그리고, 이 그림은 그 안에 얹는 눈뿐이다
// (바탕은 투명 — 살색은 셰이더가 칠한다). 깜빡임 · 맞음 · KO 는 인스턴스 속성으로 칸만 바꾼다 — 무늬 시트 칸을 다시 그리지 않는다.
// 그림은 96 × 42 단위의 설계 공간에 그리고 칸 크기에 맞춰 늘린다(초상은 같은 함수로 크게).
import { CHARACTERS } from "./charset.js";

/** 표정(아틀라스의 칸) */
export const EXPR = Object.freeze({ open: 0, blink: 1, hurt: 2, ko: 3, dizzy: 4, happy: 5 });
export const EXPR_COUNT = 6;
/** 설계 공간(창의 가로 : 세로 ≈ 2.3) */
export const EYE_W = 96;
export const EYE_H = 42;

const INK = "#170f24";
const WHITE = "#fffaf2";
const BLUSH = "rgba(255, 105, 140, 0.5)";

/**
 * 눈매. rx · ry 눈동자(흰자가 있으면 흰자) 반지름, white 흰자, pupil 흰자 안 눈동자 비율, lid 윗눈꺼풀이 덮는 비율(0..1),
 * brow { w 굵기, len 길이, tilt 기울기(+ 면 안쪽이 내려감 — 다부짐), arch 휨, y 높이 }, lash 바깥 속눈썹 수, lashLine 윗 속눈썹 선, blush 볼 빛, hl 반짝임 수
 */
export const EYE_STYLES = Object.freeze({
  // 남자: 굵은 눈썹, 속눈썹 · 볼 빛 없음
  round: { rx: 8.2, ry: 10, white: false, lid: 0, brow: { w: 4.6, len: 15, tilt: 0.05, arch: 1, y: 8.5 }, lash: 0, lashLine: 0, blush: 0, hl: 1 },
  sharp: { rx: 8.4, ry: 9.4, white: false, lid: 0.3, brow: { w: 5, len: 16, tilt: 0.34, arch: 0, y: 9.5 }, lash: 0, lashLine: 0, blush: 0, hl: 1 },
  wide: { rx: 10, ry: 11, white: true, pupil: 0.6, lid: 0, brow: { w: 4, len: 14, tilt: -0.18, arch: 3, y: 6.5 }, lash: 0, lashLine: 0, blush: 0, hl: 1 },
  sleepy: { rx: 8.8, ry: 9.6, white: false, lid: 0.48, brow: { w: 4.8, len: 16, tilt: -0.02, arch: 0.5, y: 10.5 }, lash: 0, lashLine: 0, blush: 0, hl: 1 },
  // 여자: 조금 큰 눈동자 · 속눈썹 · 가는 눈썹 · 볼 빛
  big: { rx: 9.6, ry: 11.8, white: false, lid: 0, brow: { w: 2.2, len: 12, tilt: -0.12, arch: 2.6, y: 6 }, lash: 3, lashLine: 2.6, blush: 1, hl: 2 },
  almond: { rx: 10, ry: 10.4, white: false, lid: 0.16, brow: { w: 2.3, len: 13, tilt: 0.06, arch: 1.8, y: 6.5 }, lash: 2, lashLine: 3, blush: 1, hl: 2 },
  sparkle: { rx: 10.4, ry: 12.2, white: true, pupil: 0.74, lid: 0, brow: { w: 2.1, len: 12, tilt: -0.1, arch: 2.8, y: 5.5 }, lash: 3, lashLine: 2.6, blush: 1, hl: 3 },
  gentle: { rx: 9.4, ry: 11, white: false, lid: 0.3, brow: { w: 2.2, len: 13, tilt: -0.16, arch: 2, y: 7 }, lash: 3, lashLine: 3, blush: 1, hl: 2 },
});

const EYE_X = [30, 66];
const EYE_Y = 25;

function brows(ctx, st, expr) {
  const b = st.brow;
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.lineWidth = b.w;
  for (let k = 0; k < 2; k++) {
    const s = k ? 1 : -1; // 바깥쪽 방향(왼눈 −, 오른눈 +)
    const cx = EYE_X[k];
    let tilt = b.tilt;
    let y = b.y;
    if (expr === EXPR.hurt) tilt = -0.42; // 찡그림: 안쪽이 올라감
    if (expr === EXPR.happy) y -= 1.5;
    const half = b.len / 2;
    const xi = cx - s * half, xo = cx + s * half;
    const yi = y + tilt * half, yo = y - tilt * half;
    ctx.beginPath();
    ctx.moveTo(xi, yi);
    ctx.quadraticCurveTo(cx, (yi + yo) / 2 - b.arch, xo, yo);
    ctx.stroke();
  }
}

function openEye(ctx, st, k, expr) {
  const cx = EYE_X[k];
  const s = k ? 1 : -1;
  const { rx, ry } = st;
  const cy = EYE_Y;
  ctx.save();
  // 눈(흰자 또는 눈동자) 모양 — 윗눈꺼풀이 덮는 만큼은 잘라 낸다(바탕이 투명이라 살색이 드러난다)
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  if (st.white) {
    ctx.fillStyle = WHITE;
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    const pr = rx * st.pupil, pry = ry * (st.pupil + 0.08);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(cx + s * 0.6, cy + ry * 0.12, pr, pry, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = INK;
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    // 눈동자 아래쪽에 옅은 빛(입체감)
    const g = ctx.createLinearGradient(0, cy, 0, cy + ry);
    g.addColorStop(0, "rgba(120, 90, 200, 0)");
    g.addColorStop(1, "rgba(150, 120, 255, 0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - rx, cy, rx * 2, ry);
  }
  // 반짝임
  ctx.fillStyle = "#ffffff";
  const hx = cx - rx * 0.34, hy = cy - ry * 0.4;
  ctx.beginPath();
  ctx.ellipse(hx, hy, rx * 0.34, ry * 0.3, -0.4, 0, Math.PI * 2);
  ctx.fill();
  if (st.hl >= 2) {
    ctx.beginPath();
    ctx.arc(cx + rx * 0.36, cy + ry * 0.4, rx * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }
  if (st.hl >= 3) {
    // 별 반짝임
    const sx = cx + rx * 0.3, sy = cy - ry * 0.05, r = rx * 0.2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = i % 2 ? r * 0.35 : r;
      ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  // 윗눈꺼풀
  if (st.lid > 0) {
    const ly = cy - ry + ry * 2 * st.lid;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.moveTo(cx - rx - 2, cy - ry - 2);
    ctx.lineTo(cx + rx + 2, cy - ry - 2);
    ctx.lineTo(cx + rx + 2, ly + s * 0);
    ctx.quadraticCurveTo(cx, ly + ry * 0.12, cx - rx - 2, ly);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
  // 흰자 테두리
  if (st.white) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 눈꺼풀 선 · 속눈썹
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  if (st.lid > 0) {
    const ly = cy - ry + ry * 2 * st.lid;
    const hw = rx * Math.sqrt(Math.max(0, 1 - ((ly - cy) / ry) ** 2));
    ctx.lineWidth = 2.6 + (st.lashLine || 0) * 0.3;
    ctx.beginPath();
    ctx.moveTo(cx - hw - 1.5, ly + 0.5);
    ctx.quadraticCurveTo(cx, ly + ry * 0.12, cx + hw + 1.5, ly + 0.5);
    ctx.stroke();
  }
  if (st.lashLine > 0) {
    const top = st.lid > 0 ? cy - ry + ry * 2 * st.lid : cy - ry;
    if (!(st.lid > 0)) {
      ctx.lineWidth = st.lashLine;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + 0.4, ry + 0.4, 0, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    for (let i = 0; i < st.lash; i++) {
      // 바깥 위쪽으로 뻗는 속눈썹
      const a = -Math.PI / 2 + s * (0.55 + i * 0.32);
      const ex = cx + Math.cos(a) * rx * 0.98, ey = Math.max(top, cy + Math.sin(a) * ry * 0.98);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + Math.cos(a - s * 0.25) * 4.2, ey + Math.sin(a - s * 0.25) * 4.2 - 0.5);
      ctx.stroke();
    }
  }
  void expr;
}

function closedEye(ctx, st, k, up) {
  // 감은 눈(깜빡임 ︶) · 웃는 눈(︵)
  const cx = EYE_X[k];
  const s = k ? 1 : -1;
  const w = st.rx * 1.05;
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  const y = EYE_Y + (up ? 2 : 1);
  ctx.moveTo(cx - w, y);
  ctx.quadraticCurveTo(cx, y + (up ? -10 : 7), cx + w, y);
  ctx.stroke();
  if (st.lash > 0) {
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + s * w, y);
    ctx.lineTo(cx + s * (w + 4), y - (up ? 1 : 3.5));
    ctx.stroke();
  }
}

function hurtEye(ctx, k) {
  // > < 찡그림
  const cx = EYE_X[k];
  const s = k ? -1 : 1; // 왼눈은 ">"(끝이 안쪽 = 오른쪽)
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(cx - s * 7, EYE_Y - 7);
  ctx.lineTo(cx + s * 6, EYE_Y);
  ctx.lineTo(cx - s * 7, EYE_Y + 7);
  ctx.stroke();
}

function koEye(ctx, k) {
  const cx = EYE_X[k];
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.moveTo(cx - 7, EYE_Y - 7);
  ctx.lineTo(cx + 7, EYE_Y + 7);
  ctx.moveTo(cx + 7, EYE_Y - 7);
  ctx.lineTo(cx - 7, EYE_Y + 7);
  ctx.stroke();
}

function dizzyEye(ctx, k) {
  const cx = EYE_X[k];
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  const dir = k ? 1 : -1;
  for (let t = 0; t <= 1; t += 0.02) {
    const a = t * Math.PI * 5 * dir;
    const r = 1 + t * 8.5;
    ctx.lineTo(cx + Math.cos(a) * r, EYE_Y + Math.sin(a) * r);
  }
  ctx.stroke();
}

/**
 * 한 칸(창 안) 그리기: (x, y, w, h) 캔버스 자리에 char 종류의 expr 표정. 바탕은 건드리지 않는다(투명 위에 그린다).
 */
export function drawEyes(ctx, x, y, w, h, char, expr = EXPR.open) {
  const def = CHARACTERS[char] || CHARACTERS[0];
  const st = EYE_STYLES[def.eyes] || EYE_STYLES.round;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x, y);
  ctx.scale(w / EYE_W, h / EYE_H);
  // 볼 빛(여자 · 웃음)
  if (st.blush || expr === EXPR.happy) {
    ctx.fillStyle = BLUSH;
    for (const bx of [11, 85]) {
      ctx.beginPath();
      ctx.ellipse(bx, 35, 7.5, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (expr !== EXPR.ko && expr !== EXPR.dizzy) brows(ctx, st, expr);
  for (let k = 0; k < 2; k++) {
    if (expr === EXPR.blink) closedEye(ctx, st, k, false);
    else if (expr === EXPR.happy) closedEye(ctx, st, k, true);
    else if (expr === EXPR.hurt) hurtEye(ctx, k);
    else if (expr === EXPR.ko) koEye(ctx, k);
    else if (expr === EXPR.dizzy) dizzyEye(ctx, k);
    else openEye(ctx, st, k, expr);
  }
  ctx.restore();
}

/**
 * 눈 아틀라스(캔버스): 가로 = 표정 EXPR_COUNT 칸, 세로 = 캐릭터 종류. 칸 = cw × ch(가장자리 pad 화소는 비워 밉맵이 이웃 칸을 섞지 않게).
 * 그림은 칸 안쪽(pad 를 뺀 자리)에 — 셰이더도 같은 pad 로 읽는다.
 * @returns {{ canvas, cw, ch, pad, cols, rows }}
 */
export function drawEyeAtlas(cw = 96, ch = 42, pad = 4) {
  const cols = EXPR_COUNT, rows = CHARACTERS.length;
  const canvas = document.createElement("canvas");
  canvas.width = cols * cw;
  canvas.height = rows * ch;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) drawEyes(ctx, c * cw + pad, r * ch + pad, cw - pad * 2, ch - pad * 2, r, c);
  return { canvas, cw, ch, pad, cols, rows };
}
