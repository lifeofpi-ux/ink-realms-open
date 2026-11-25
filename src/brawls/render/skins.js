// 캐릭터 스킨 — ink-brawl 의 src/render/skins.js 를 옮겨 와 늘렸다(원본의 무늬 8종 · 배치 · 그리는 말투 그대로: 형광 팀 색 + 크림색 + 짙은 색).
// 캐릭터 한 명의 겉모습은 아틀라스 한 장(ATLAS 배치)으로 정해진다. figures.js 가 경기에 실제로 쓰이는 (색, 무늬, 종류)만 무늬 시트 한 장의 칸에 줄여 넣는다.
//
// 달라진 것(docs/DESIGN.md §3.9):
//   - 무늬 26종(charset.js 의 PATTERNS — 앞의 8종은 원본). 무늬마다 머리 윗면 그림이 다르다(위에서 내려다볼 때 갈리게 — 머리 껍질 · 모자가 이 그림을 쓴다).
//   - 얼굴을 그리지 않는다: 눈은 머리 앞면의 둥근 네모 창(figures.js 셰이더) 안에 eyes.js 의 그림으로. 무늬는 창 바깥의 머리 전체를 덮는다.
//   - 캐릭터 종류의 옷 선(후드 · 멜빵 · 반바지 · 지퍼 / 세일러 칼라 · 벨트 · 앞치마 · 둥근 칼라)을 몸통에, 다리 · 신발도 종류에 따라.
//
//   v=1 ┌───────────────────────────────────────┐
//       │ 머리 옆면 (한 바퀴, 가운데가 정면)       │  u 0..1    v 0.5..1
//  0.5  ├─────────┬─────────────────────────────┤
//       │ 머리 윗면 │ 몸통 (한 바퀴, 가운데가 정면)  │  윗면 u 0..0.25 / 몸통 u 0.25..1   v 0.25..0.5
//  0.25 ├─────────┼─────────┬─────────┬─────────┤
//       │ 팔      │ 손      │ 다리     │ 신발     │  각 u 폭 0.25   v 0..0.25
//   v=0 └─────────┴─────────┴─────────┴─────────┘
import * as THREE from "three";
import { PALETTE } from "../shared/constants.js";
import { PATTERNS, CHARACTERS } from "./charset.js";

export const ATLAS = {
  headSide: { u: 0, v: 0.5, w: 1, h: 0.5 },
  headTop: { u: 0, v: 0.25, w: 0.25, h: 0.25 },
  body: { u: 0.25, v: 0.25, w: 0.75, h: 0.25 },
  arm: { u: 0, v: 0, w: 0.25, h: 0.25 },
  hand: { u: 0.25, v: 0, w: 0.25, h: 0.25 },
  leg: { u: 0.5, v: 0, w: 0.25, h: 0.25 },
  shoe: { u: 0.75, v: 0, w: 0.25, h: 0.25 },
};

const SIZE = 1024;
export const CREAM = "#fff3df";
const css = (hex) => "#" + hex.toString(16).padStart(6, "0");
function shade(hex, k) {
  const c = new THREE.Color(hex);
  if (k < 0) c.multiplyScalar(1 + k);
  else c.lerp(new THREE.Color(0xffffff), k);
  return "#" + c.getHexString();
}
/** 팀 색 hex → 무늬에 쓰는 색(형광 본색 · 크림 · 짙은 색 · 밝은 색) */
export function skinColors(hex) {
  return { main: css(hex), cream: CREAM, dark: shade(hex, -0.45), light: shade(hex, 0.35), mid: shade(hex, -0.22), deep: shade(hex, -0.66) };
}

// 아틀라스 영역 → 캔버스 픽셀 사각형(캔버스는 위가 v=1)
function px(r) {
  return { x: r.u * SIZE, y: (1 - r.v - r.h) * SIZE, w: r.w * SIZE, h: r.h * SIZE };
}

function clipRect(ctx, r, draw) {
  const p = px(r);
  ctx.save();
  ctx.beginPath();
  ctx.rect(p.x, p.y, p.w, p.h);
  ctx.clip();
  ctx.translate(p.x, p.y);
  draw(p.w, p.h);
  ctx.restore();
}

// 결정적인 의사 난수(무늬가 모든 클라이언트 · 매번 같게)
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
const cells = (w) => Math.max(4, Math.round(w / 128));

// 도형 몇 가지
function starPath(ctx, cx, cy, r, inner = 0.45, n = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let k = 0; k < n * 2; k++) {
    const a = (k / (n * 2)) * Math.PI * 2 + rot;
    const rr = k % 2 === 0 ? r : r * inner;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}
function heartPath(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.9);
  ctx.bezierCurveTo(cx - r * 1.3, cy + r * 0.1, cx - r * 0.95, cy - r * 0.95, cx, cy - r * 0.35);
  ctx.bezierCurveTo(cx + r * 0.95, cy - r * 0.95, cx + r * 1.3, cy + r * 0.1, cx, cy + r * 0.9);
  ctx.closePath();
}
function boltPath(ctx, cx, cy, r) {
  const p = [[0.15, -1], [-0.55, 0.12], [-0.02, 0.12], [-0.25, 1], [0.6, -0.22], [0.05, -0.22], [0.35, -1]];
  ctx.beginPath();
  for (const [x, y] of p) ctx.lineTo(cx + x * r, cy + y * r);
  ctx.closePath();
}
function flowerPath(ctx, cx, cy, r, petals = 5, rot = 0) {
  ctx.beginPath();
  for (let k = 0; k < petals; k++) {
    const a = rot + (k / petals) * Math.PI * 2;
    const ex = cx + Math.cos(a) * r * 0.55, ey = cy + Math.sin(a) * r * 0.55;
    ctx.moveTo(ex + Math.cos(a) * r * 0.5, ey + Math.sin(a) * r * 0.5);
    ctx.ellipse(ex, ey, r * 0.5, r * 0.32, a, 0, Math.PI * 2);
  }
}
function leafPath(ctx, cx, cy, r, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const P = (x, y) => [cx + x * c - y * s, cy + x * s + y * c];
  ctx.beginPath();
  ctx.moveTo(...P(-r, 0));
  ctx.quadraticCurveTo(...P(0, -r * 0.62), ...P(r, 0));
  ctx.quadraticCurveTo(...P(0, r * 0.62), ...P(-r, 0));
  ctx.closePath();
}
function cloudPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (const [x, y, rr] of [[-0.55, 0.12, 0.45], [0.55, 0.15, 0.42], [-0.05, -0.18, 0.6]]) {
    ctx.moveTo(cx + x * r + rr * r, cy + y * r);
    ctx.arc(cx + x * r, cy + y * r, rr * r, 0, Math.PI * 2);
  }
  ctx.rect(cx - r * 0.55, cy + r * 0.05, r * 1.1, r * 0.52);
}
function splatPath(ctx, cx, cy, r, rand) {
  ctx.beginPath();
  const n = 9;
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    const rr = r * (0.75 + rand() * 0.45);
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  for (let k = 0; k < 5; k++) {
    const a = rand() * Math.PI * 2;
    const d = r * (1.25 + rand() * 0.6);
    const rr = r * (0.1 + rand() * 0.12);
    ctx.moveTo(cx + Math.cos(a) * d + rr, cy + Math.sin(a) * d);
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr, 0, Math.PI * 2);
  }
}
/** 한 바퀴 도는 영역에서 가로로 이어 붙게: x 와 x ± w 에 그린다 */
function wrapX(w, x, r, fn) {
  fn(x);
  if (x - r < 0) fn(x + w);
  if (x + r > w) fn(x - w);
}
/** 엇갈린 격자의 칸마다(가로로 이어진다) */
function grid(w, h, n, rows, fn) {
  const step = w / n;
  const dh = h / rows;
  for (let j = 0; j < rows; j++)
    for (let i = -1; i <= n; i++) fn((i + 0.5 + (j % 2) * 0.5) * step, (j + 0.5) * dh, Math.min(step, dh), i, j);
}

// ------------------------------------------------------------------ 무늬 그리기(옆면 · 몸통 · 다리 — 가로로 한 바퀴 이어진다)
// 각 무늬는 (ctx, w, h, 색들) 로 한 영역을 채운다. 가로로 이어 붙는(한 바퀴 도는) 영역이라 주기를 폭에 맞춘다.
const SIDE = {
  // 원본 8종 ------------------------------------------------------
  // 참고 그림과 같은 사탕 줄무늬
  candy(ctx, w, h, c) {
    ctx.fillStyle = c.cream;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.main;
    const n = cells(w);
    const step = w / n;
    for (let i = -n; i < n * 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step + step * 0.5, 0);
      ctx.lineTo(i * step + step * 0.5 + h * 0.8, h);
      ctx.lineTo(i * step + h * 0.8, h);
      ctx.closePath();
      ctx.fill();
    }
  },
  dots(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.cream;
    const n = cells(w);
    const step = w / n;
    const rows = Math.max(2, Math.round(h / step));
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= n; i++) {
        ctx.beginPath();
        ctx.arc((i + (j % 2) * 0.5) * step, (j + 0.5) * (h / rows), step * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
  },
  checker(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.dark;
    const n = cells(w) * 2;
    const s = w / n;
    for (let j = 0; j * s < h; j++)
      for (let i = 0; i < n; i++) if ((i + j) % 2 === 0) ctx.fillRect(i * s, j * s, s, s);
  },
  zigzag(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = c.cream;
    ctx.lineWidth = h * 0.085;
    ctx.lineJoin = "miter";
    const n = cells(w) * 2;
    const step = w / n;
    for (let row = 0; row < 3; row++) {
      const y = h * (0.2 + row * 0.3);
      ctx.beginPath();
      for (let i = -1; i <= n + 1; i++) ctx.lineTo(i * step, y + (i % 2 === 0 ? -1 : 1) * h * 0.08);
      ctx.stroke();
    }
  },
  bands(ctx, w, h, c) {
    ctx.fillStyle = c.cream;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.main;
    ctx.fillRect(0, h * 0.0, w, h * 0.22);
    ctx.fillRect(0, h * 0.4, w, h * 0.2);
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
    ctx.fillStyle = c.dark;
    ctx.fillRect(0, h * 0.28, w, h * 0.05);
    ctx.fillRect(0, h * 0.67, w, h * 0.05);
  },
  // 위에서 흘러내린 잉크
  drip(ctx, w, h, c) {
    ctx.fillStyle = c.cream;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.main;
    const n = cells(w) * 2;
    const step = w / n;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i < n; i++) {
      const len = h * (0.3 + (((i * 7919) % 13) / 13) * 0.5);
      const x0 = i * step;
      ctx.lineTo(x0, len - step * 0.5);
      ctx.arc(x0 + step * 0.5, len - step * 0.5, step * 0.5, Math.PI, 0, true);
      ctx.lineTo(x0 + step, 0);
    }
    ctx.closePath();
    ctx.fill();
  },
  stars(ctx, w, h, c) {
    ctx.fillStyle = c.dark;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.main;
    const n = cells(w);
    const step = w / n;
    const rows = Math.max(2, Math.round(h / step));
    for (let j = 0; j < rows; j++)
      for (let i = 0; i <= n; i++) {
        starPath(ctx, (i + (j % 2) * 0.5) * step, (j + 0.5) * (h / rows), step * 0.3);
        ctx.fill();
      }
  },
  // 위아래 두 색
  split(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.cream;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
    ctx.fillStyle = c.dark;
    ctx.fillRect(0, h * 0.5, w, h * 0.07);
  },
  // 늘린 무늬 ------------------------------------------------------
  vstripe(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    const n = cells(w) * 2;
    const step = w / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = c.cream;
      ctx.fillRect(i * step, 0, step * 0.42, h);
      ctx.fillStyle = c.dark;
      ctx.fillRect(i * step + step * 0.42, 0, step * 0.07, h);
    }
  },
  bigdot(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    const n = Math.max(3, Math.round(w / 200));
    grid(w, h, n, Math.max(1, Math.round(h / (w / n))), (x, y, s) => {
      ctx.fillStyle = c.dark;
      ctx.beginPath();
      ctx.arc(x, y, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.cream;
      ctx.beginPath();
      ctx.arc(x, y, s * 0.33, 0, Math.PI * 2);
      ctx.fill();
    });
  },
  speckle(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    const rand = rng(97);
    const n = Math.round((w * h) / 5200);
    const r = Math.max(3, w / 55);
    for (let k = 0; k < n; k++) {
      const x = rand() * w, y = rand() * h;
      const rr = r * (0.7 + rand() * 0.6);
      ctx.fillStyle = k % 3 === 0 ? c.dark : c.cream;
      wrapX(w, x, rr, (xx) => {
        ctx.beginPath();
        ctx.arc(xx, y, rr, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  },
  diamond(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    const n = cells(w);
    const step = w / n;
    const rows = Math.max(1, Math.round(h / (step * 1.3)));
    const dh = h / rows;
    for (let j = 0; j < rows; j++)
      for (let i = -1; i <= n; i++) {
        const x = (i + 0.5 + (j % 2) * 0.5) * step, y = (j + 0.5) * dh;
        ctx.fillStyle = (i + j) % 2 ? c.cream : c.light;
        ctx.beginPath();
        ctx.moveTo(x, y - dh * 0.46);
        ctx.lineTo(x + step * 0.36, y);
        ctx.lineTo(x, y + dh * 0.46);
        ctx.lineTo(x - step * 0.36, y);
        ctx.closePath();
        ctx.fill();
      }
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = Math.max(2, w / 300);
    for (let i = -n; i <= n * 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step + h * 0.6, h);
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step - h * 0.6, h);
      ctx.stroke();
    }
  },
  hearts(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    const n = cells(w);
    grid(w, h, n, Math.max(2, Math.round(h / (w / n))), (x, y, s, i, j) => {
      ctx.fillStyle = j % 2 ? c.light : c.cream;
      heartPath(ctx, x, y, s * 0.3);
      ctx.fill();
    });
  },
  bolts(ctx, w, h, c) {
    ctx.fillStyle = c.dark;
    ctx.fillRect(0, 0, w, h);
    const n = cells(w);
    grid(w, h, n, Math.max(1, Math.round(h / ((w / n) * 1.1))), (x, y, s, i, j) => {
      boltPath(ctx, x, y, s * 0.42);
      ctx.fillStyle = (i + j) % 2 ? c.cream : c.main;
      ctx.fill();
    });
  },
  flames(ctx, w, h, c) {
    // 아래에서 타오르는 굵은 불꽃 혀(짙은 테 → 본색 → 밝은 속)
    ctx.fillStyle = c.cream;
    ctx.fillRect(0, 0, w, h);
    const n = cells(w);
    const step = w / n;
    const tongue = (col, sc, lift) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-step, h);
      for (let i = -1; i <= n; i++) {
        const x = i * step;
        const tip = h * (0.92 - ((((i % n) + n) % n) % 2) * 0.18) * sc;
        const lean = step * 0.18;
        ctx.lineTo(x + step * (0.5 - 0.36 * sc), h - lift);
        ctx.bezierCurveTo(x + step * (0.5 - 0.42 * sc), h - tip * 0.55, x + step * 0.3 + lean, h - tip * 0.8, x + step * 0.5 + lean, h - tip);
        ctx.bezierCurveTo(x + step * 0.62, h - tip * 0.7, x + step * (0.5 + 0.44 * sc), h - tip * 0.5, x + step * (0.5 + 0.36 * sc), h - lift);
      }
      ctx.lineTo(w + step, h);
      ctx.closePath();
      ctx.fill();
    };
    tongue(c.dark, 1, 0);
    tongue(c.main, 0.8, 0);
    tongue(c.light, 0.45, 0);
  },
  waves(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    const n = cells(w);
    const rows = 4;
    for (let j = 0; j < rows; j++) {
      const y0 = (j + 0.3) * (h / rows);
      ctx.fillStyle = j % 2 ? c.light : c.cream;
      ctx.beginPath();
      for (let k = 0; k <= 96; k++) {
        const x = (k / 96) * w;
        ctx.lineTo(x, y0 + Math.sin((x / w) * n * Math.PI * 2) * h * 0.06);
      }
      for (let k = 96; k >= 0; k--) {
        const x = (k / 96) * w;
        ctx.lineTo(x, y0 + h * 0.1 + Math.sin((x / w) * n * Math.PI * 2) * h * 0.06);
      }
      ctx.closePath();
      ctx.fill();
    }
  },
  clouds(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    const n = cells(w);
    grid(w, h, n, Math.max(1, Math.round(h / (w / n))), (x, y, s) => {
      const r = s * 0.34;
      ctx.fillStyle = c.dark;
      cloudPath(ctx, x + r * 0.08, y + r * 0.14, r);
      ctx.fill();
      ctx.fillStyle = c.cream;
      cloudPath(ctx, x, y, r);
      ctx.fill();
    });
  },
  leaves(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    const n = cells(w);
    ctx.lineWidth = Math.max(1.5, w / 400);
    grid(w, h, n, Math.max(2, Math.round(h / (w / n))), (x, y, s, i, j) => {
      const a = (i + j) % 2 ? 0.6 : -0.6;
      const r = s * 0.5;
      leafPath(ctx, x, y, r, a);
      ctx.fillStyle = (i + j) % 2 ? c.cream : c.light;
      ctx.fill();
      ctx.strokeStyle = c.dark;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(a) * r * 0.8, y - Math.sin(a) * r * 0.8);
      ctx.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8);
      ctx.stroke();
    });
  },
  flowers(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    const n = cells(w);
    grid(w, h, n, Math.max(2, Math.round(h / (w / n))), (x, y, s, i, j) => {
      const r = s * 0.38;
      ctx.fillStyle = c.cream;
      flowerPath(ctx, x, y, r, 5, (i + j) * 0.4);
      ctx.fill();
      ctx.fillStyle = c.dark;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    });
  },
  // 반반: 앞에서 보면 얼굴 가운데로 갈린다
  halves(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w / 2, h);
    ctx.fillStyle = c.cream;
    ctx.fillRect(w / 2, 0, w / 2, h);
    ctx.fillStyle = c.dark;
    ctx.fillRect(w / 2 - w * 0.008, 0, w * 0.016, h);
    ctx.fillRect(0, 0, w * 0.008, h);
    ctx.fillRect(w - w * 0.008, 0, w * 0.008, h);
  },
  thirds(ctx, w, h, c) {
    // 세로 세 칸(본색 · 크림 · 밝은 색) — 한 칸이 정면 가운데
    const cols = [c.cream, c.main, c.light];
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = cols[k];
      ctx.fillRect((k * w) / 3, 0, w / 3 + 1, h);
    }
    ctx.fillStyle = c.dark;
    for (let k = 0; k <= 3; k++) ctx.fillRect((k * w) / 3 - w * 0.006, 0, w * 0.012, h);
  },
  steps(ctx, w, h, c) {
    const cols = [c.light, c.main, c.mid, c.dark];
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = cols[k];
      ctx.fillRect(0, (h * k) / 4, w, h / 4 + 1);
    }
    ctx.fillStyle = c.cream;
    for (let k = 1; k < 4; k++) ctx.fillRect(0, (h * k) / 4 - h * 0.018, w, h * 0.036);
  },
  swirl(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    const n = cells(w);
    ctx.lineCap = "round";
    grid(w, h, n, Math.max(2, Math.round(h / (w / n))), (x, y, s, i, j) => {
      const r = s * 0.42;
      ctx.strokeStyle = (i + j) % 2 ? c.cream : c.light;
      ctx.lineWidth = r * 0.22;
      ctx.beginPath();
      for (let t = 0; t <= 1; t += 0.03) {
        const a = t * Math.PI * 4.2;
        ctx.lineTo(x + Math.cos(a) * r * t, y + Math.sin(a) * r * t);
      }
      ctx.stroke();
    });
  },
  target(ctx, w, h, c) {
    ctx.fillStyle = c.dark;
    ctx.fillRect(0, 0, w, h);
    const n = cells(w);
    grid(w, h, n, Math.max(1, Math.round(h / (w / n))), (x, y, s) => {
      const r = s * 0.45;
      [c.main, c.cream, c.main, c.cream].forEach((col, k) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, r * (1 - k * 0.24), 0, Math.PI * 2);
        ctx.fill();
      });
    });
  },
  camo(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    const rand = rng(1234);
    const cols = [c.dark, c.light, c.cream, c.mid];
    const r0 = w / 16;
    const count = Math.round((w * h) / (r0 * r0 * 2.2));
    for (let k = 0; k < count; k++) {
      const x = rand() * w, y = rand() * h;
      ctx.fillStyle = cols[k % cols.length];
      const pts = [];
      const pieces = 3 + Math.floor(rand() * 3);
      for (let q = 0; q < pieces; q++) pts.push([(rand() - 0.5) * r0 * 1.4, (rand() - 0.5) * r0, r0 * (0.45 + rand() * 0.5)]);
      wrapX(w, x, r0 * 1.6, (xx) => {
        ctx.beginPath();
        for (const [dx, dy, rr] of pts) {
          ctx.moveTo(xx + dx + rr, y + dy);
          ctx.arc(xx + dx, y + dy, rr, 0, Math.PI * 2);
        }
        ctx.fill();
      });
    }
  },
  splat(ctx, w, h, c) {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    const rand = rng(4242);
    const n = cells(w) + 1;
    const step = w / n;
    for (let k = 0; k < n * 2; k++) {
      const x = (k / 2) * step + rand() * step * 0.3, y = h * (0.2 + rand() * 0.6);
      const r = Math.min(step * 0.5, h * 0.3) * (0.62 + rand() * 0.3);
      const col = k % 2 ? c.cream : c.dark;
      const seed = (rand() * 1e6) | 0;
      wrapX(w, x, r * 2.2, (xx) => {
        ctx.fillStyle = col;
        splatPath(ctx, xx, y, r, rng(seed));
        ctx.fill();
      });
    }
  },
};

// ------------------------------------------------------------------ 머리 윗면(위에서 내려다볼 때 가장 넓게 보이는 곳 — 무늬마다 다른 그림)
// (ctx, w, h, c): 가운데가 정수리, 영역 위쪽(캔버스 y 작은 쪽)이 얼굴 쪽(+X). 평평한 윗면은 반지름 0.8 안쪽, 가장자리는 둥근 모서리.
function swirlTop(ctx, w, h, fill) {
  ctx.fillStyle = fill;
  const arms = 8;
  for (let i = 0; i < arms; i++) {
    const a0 = (i / arms) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    for (let t = 0; t <= 1; t += 0.05) {
      const a = a0 + t * 1.6;
      ctx.lineTo(w / 2 + Math.cos(a) * t * w * 0.72, h / 2 + Math.sin(a) * t * h * 0.72);
    }
    for (let t = 1; t >= 0; t -= 0.05) {
      const a = a0 + t * 1.6 + (Math.PI / arms) * 0.95;
      ctx.lineTo(w / 2 + Math.cos(a) * t * w * 0.72, h / 2 + Math.sin(a) * t * h * 0.72);
    }
    ctx.closePath();
    ctx.fill();
  }
}
function rings(ctx, w, h, cols, r0, dr) {
  cols.forEach((col, k) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * (r0 - k * dr), 0, Math.PI * 2);
    ctx.fill();
  });
}
function diamondAt(ctx, w, h, k) {
  ctx.beginPath();
  ctx.moveTo(w / 2, h * k);
  ctx.lineTo(w * (1 - k), h / 2);
  ctx.lineTo(w / 2, h * (1 - k));
  ctx.lineTo(w * k, h / 2);
  ctx.closePath();
}
const TOP = {
  candy: (ctx, w, h, c) => swirlTop(ctx, w, h, c.cream),
  dots(ctx, w, h, c) {
    ctx.fillStyle = c.cream;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.17, 0, Math.PI * 2);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const x = w / 2 + Math.cos(a) * w * 0.33, y = h / 2 + Math.sin(a) * h * 0.33;
      ctx.moveTo(x + w * 0.07, y);
      ctx.arc(x, y, w * 0.07, 0, Math.PI * 2);
    }
    ctx.fill();
  },
  checker(ctx, w, h, c) {
    ctx.fillStyle = c.dark;
    const n = 6;
    const s = w / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if ((i + j) % 2 === 0) ctx.fillRect(i * s, j * s, s, s);
  },
  zigzag(ctx, w, h, c) {
    ctx.strokeStyle = c.cream;
    ctx.lineWidth = w * 0.06;
    ctx.lineJoin = "miter";
    for (const rr of [0.16, 0.36]) {
      starPath(ctx, w / 2, h / 2, w * (rr + 0.06), (rr - 0.04) / (rr + 0.06), 10, 0);
      ctx.stroke();
    }
  },
  bands: (ctx, w, h, c) => rings(ctx, w, h, [c.main, c.cream, c.main, c.dark, c.cream], 0.5, 0.09),
  drip(ctx, w, h, c) {
    ctx.fillStyle = c.cream;
    splatPath(ctx, w / 2, h / 2, w * 0.25, rng(77));
    ctx.fill();
  },
  stars(ctx, w, h, c) {
    ctx.fillStyle = c.dark;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.main;
    starPath(ctx, w / 2, h / 2 + h * 0.02, w * 0.4, 0.46);
    ctx.fill();
    ctx.fillStyle = c.cream;
    starPath(ctx, w / 2, h / 2 + h * 0.02, w * 0.15, 0.46);
    ctx.fill();
  },
  split(ctx, w, h, c) {
    ctx.fillStyle = c.cream;
    ctx.fillRect(0, h * 0.5, w, h * 0.5);
    ctx.fillStyle = c.dark;
    ctx.fillRect(0, h * 0.47, w, h * 0.06);
  },
  vstripe(ctx, w, h, c) {
    ctx.fillStyle = c.cream;
    for (let k = 0; k < 12; k += 2) {
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.arc(w / 2, h / 2, w * 0.75, (k / 12) * Math.PI * 2, ((k + 1) / 12) * Math.PI * 2);
      ctx.closePath();
      ctx.fill();
    }
  },
  bigdot: (ctx, w, h, c) => rings(ctx, w, h, [c.dark, c.cream], 0.34, 0.06),
  speckle(ctx, w, h, c) {
    const rand = rng(31);
    for (let k = 0; k < 46; k++) {
      ctx.fillStyle = k % 3 ? c.cream : c.dark;
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, w * (0.018 + rand() * 0.02), 0, Math.PI * 2);
      ctx.fill();
    }
  },
  diamond(ctx, w, h, c) {
    ctx.fillStyle = c.dark;
    diamondAt(ctx, w, h, 0.08);
    ctx.fill();
    ctx.fillStyle = c.cream;
    diamondAt(ctx, w, h, 0.16);
    ctx.fill();
    ctx.fillStyle = c.main;
    diamondAt(ctx, w, h, 0.32);
    ctx.fill();
  },
  hearts(ctx, w, h, c) {
    ctx.fillStyle = c.dark;
    heartPath(ctx, w / 2, h / 2 + h * 0.03, w * 0.36);
    ctx.fill();
    ctx.fillStyle = c.cream;
    heartPath(ctx, w / 2, h / 2 + h * 0.03, w * 0.29);
    ctx.fill();
  },
  bolts(ctx, w, h, c) {
    ctx.fillStyle = c.dark;
    boltPath(ctx, w / 2, h / 2, w * 0.42);
    ctx.fill();
    ctx.fillStyle = c.cream;
    boltPath(ctx, w / 2, h / 2, w * 0.33);
    ctx.fill();
  },
  flames(ctx, w, h, c) {
    // 정수리에서 사방으로 타오르는 불꽃
    const ring = (col, r0, r1) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      const n = 9;
      for (let k = 0; k <= n * 2; k++) {
        const a = (k / (n * 2)) * Math.PI * 2;
        const rr = k % 2 ? r0 : r1;
        ctx.lineTo(w / 2 + Math.cos(a) * w * rr, h / 2 + Math.sin(a) * h * rr);
      }
      ctx.closePath();
      ctx.fill();
    };
    ring(c.dark, 0.26, 0.5);
    ring(c.cream, 0.18, 0.38);
    ring(c.light, 0.08, 0.2);
  },
  waves(ctx, w, h, c) {
    ctx.lineWidth = w * 0.055;
    for (const [rr, col] of [[0.38, c.cream], [0.24, c.light], [0.1, c.cream]]) {
      ctx.strokeStyle = col;
      ctx.beginPath();
      for (let k = 0; k <= 96; k++) {
        const a = (k / 96) * Math.PI * 2;
        const r = w * (rr + Math.sin(a * 8) * 0.025);
        ctx.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
      }
      ctx.stroke();
    }
  },
  clouds(ctx, w, h, c) {
    ctx.fillStyle = c.dark;
    cloudPath(ctx, w / 2 + w * 0.02, h / 2 + h * 0.04, w * 0.36);
    ctx.fill();
    ctx.fillStyle = c.cream;
    cloudPath(ctx, w / 2, h / 2, w * 0.34);
    ctx.fill();
  },
  leaves(ctx, w, h, c) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      leafPath(ctx, w / 2 + Math.cos(a) * w * 0.2, h / 2 + Math.sin(a) * h * 0.2, w * 0.2, a);
      ctx.fillStyle = k % 2 ? c.cream : c.light;
      ctx.fill();
    }
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.05, 0, Math.PI * 2);
    ctx.fill();
  },
  flowers(ctx, w, h, c) {
    ctx.fillStyle = c.cream;
    flowerPath(ctx, w / 2, h / 2, w * 0.42, 6, 0.3);
    ctx.fill();
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.light;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.08, 0, Math.PI * 2);
    ctx.fill();
  },
  halves(ctx, w, h, c) {
    ctx.fillStyle = c.cream;
    ctx.fillRect(w / 2, 0, w / 2, h);
    ctx.fillStyle = c.dark;
    ctx.fillRect(w / 2 - w * 0.025, 0, w * 0.05, h);
  },
  thirds(ctx, w, h, c) {
    const cols = [c.main, c.cream, c.light];
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = cols[k];
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.arc(w / 2, h / 2, w, (k / 3) * Math.PI * 2 - Math.PI / 2, ((k + 1) / 3) * Math.PI * 2 - Math.PI / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = w * 0.035;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + Math.cos(a) * w, h / 2 + Math.sin(a) * h);
      ctx.stroke();
    }
  },
  steps(ctx, w, h, c) {
    [c.dark, c.mid, c.main, c.light, c.cream].forEach((col, k) => {
      ctx.fillStyle = col;
      ctx.fillRect(w * k * 0.1, h * k * 0.1, w * (1 - k * 0.2), h * (1 - k * 0.2));
    });
  },
  swirl(ctx, w, h, c) {
    ctx.strokeStyle = c.cream;
    ctx.lineCap = "round";
    ctx.lineWidth = w * 0.065;
    ctx.beginPath();
    for (let t = 0; t <= 1; t += 0.01) {
      const a = t * Math.PI * 6;
      ctx.lineTo(w / 2 + Math.cos(a) * w * 0.42 * t, h / 2 + Math.sin(a) * h * 0.42 * t);
    }
    ctx.stroke();
  },
  target: (ctx, w, h, c) => rings(ctx, w, h, [c.cream, c.main, c.cream, c.dark, c.cream], 0.42, 0.085),
  camo: (ctx, w, h, c) => SIDE.camo(ctx, w, h, c),
  splat(ctx, w, h, c) {
    ctx.fillStyle = c.dark;
    splatPath(ctx, w * 0.5, h * 0.52, w * 0.27, rng(5));
    ctx.fill();
    ctx.fillStyle = c.cream;
    splatPath(ctx, w * 0.46, h * 0.46, w * 0.13, rng(9));
    ctx.fill();
  },
};

export const PATTERN_NAMES = PATTERNS.map((p) => p.key);

// ------------------------------------------------------------------ 옷 선(몸통 영역 — 캐릭터 종류마다)
// 몸통은 원본 회전체(프로필 점 8개 — v 는 점 번호를 따른다). 몸통 좌표 y(몸통 밑 0 ~ 꼭대기 0.6) → 영역 안 캔버스 y.
const BODY_Y = [0, 0.015, 0.13, 0.3, 0.46, 0.56, 0.6];
function bodyY(y, h) {
  let v = 6 / 7;
  for (let i = 0; i < BODY_Y.length - 1; i++) {
    if (y <= BODY_Y[i + 1]) {
      v = (i + (y - BODY_Y[i]) / Math.max(1e-6, BODY_Y[i + 1] - BODY_Y[i])) / 7;
      break;
    }
  }
  if (y > 0.6) v = 6 / 7 + Math.min(1, (y - 0.6) / 0.05) / 7;
  return (1 - v) * h;
}
/** 정면에서 a 라디안(+ 은 한쪽) → 영역 안 캔버스 x */
const angX = (a, w) => w * (0.5 + a / (Math.PI * 2));

/** 몸통 둘레의 부채꼴 띠(각 a0..a1, 높이 y0..y1) — 한 바퀴를 넘어가면 이어 그린다 */
function bodyBox(ctx, w, h, a0, a1, y0, y1, col) {
  ctx.fillStyle = col;
  const x0 = angX(a0, w), x1 = angX(a1, w);
  const top = bodyY(y1, h), bot = bodyY(y0, h);
  const cx0 = (x0 + x1) / 2;
  const wrapped = ((cx0 % w) + w) % w;
  wrapX(w, wrapped, (x1 - x0) / 2, (cx) => ctx.fillRect(cx - (x1 - x0) / 2, top, x1 - x0, bot - top));
}
function band(ctx, w, h, y0, y1, col) {
  ctx.fillStyle = col;
  const top = bodyY(y1, h), bot = bodyY(y0, h);
  ctx.fillRect(0, top, w, bot - top);
}
function dot(ctx, w, h, a, y, r, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(angX(a, w), bodyY(y, h), r, 0, Math.PI * 2);
  ctx.fill();
}

export const OUTFITS = {
  // 남자 -------------------------------------------------------------
  hoodie(ctx, w, h, c) {
    // 목둘레 두건 · 등 뒤 두건 자락 · 앞 주머니 · 끈
    band(ctx, w, h, 0.5, 0.65, c.dark);
    bodyBox(ctx, w, h, Math.PI - 0.95, Math.PI + 0.95, 0.3, 0.56, c.dark);
    bodyBox(ctx, w, h, Math.PI - 0.78, Math.PI + 0.78, 0.34, 0.52, c.mid);
    const px0 = angX(-0.62, w), px1 = angX(0.62, w), py0 = bodyY(0.27, h), py1 = bodyY(0.08, h);
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.roundRect(px0, py0, px1 - px0, py1 - py0, (py1 - py0) * 0.3);
    ctx.fill();
    ctx.strokeStyle = c.cream;
    ctx.lineWidth = w * 0.006;
    ctx.setLineDash([w * 0.012, w * 0.01]);
    ctx.beginPath();
    ctx.roundRect(px0 + w * 0.01, py0 + w * 0.01, px1 - px0 - w * 0.02, py1 - py0 - w * 0.02, (py1 - py0) * 0.25);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = w * 0.01;
    for (const a of [-0.2, 0.2]) {
      ctx.beginPath();
      ctx.moveTo(angX(a, w), bodyY(0.52, h));
      ctx.lineTo(angX(a * 1.1, w), bodyY(0.34, h));
      ctx.stroke();
      dot(ctx, w, h, a * 1.1, 0.33, w * 0.012, c.cream);
    }
  },
  overalls(ctx, w, h, c) {
    // 멜빵 반바지: 아래 띠 + 가슴판 + 멜빵 두 줄(앞뒤) + 단추
    band(ctx, w, h, 0, 0.2, c.dark);
    bodyBox(ctx, w, h, -0.55, 0.55, 0.18, 0.38, c.dark);
    for (const a of [-0.42, 0.42, Math.PI - 0.42, Math.PI + 0.42]) bodyBox(ctx, w, h, a - 0.1, a + 0.1, 0.18, 0.65, c.dark);
    for (const a of [-0.42, 0.42]) dot(ctx, w, h, a, 0.36, w * 0.014, c.cream);
    ctx.strokeStyle = c.cream;
    ctx.lineWidth = w * 0.004;
    ctx.strokeRect(angX(-0.18, w), bodyY(0.33, h), angX(0.18, w) - angX(-0.18, w), bodyY(0.24, h) - bodyY(0.33, h));
  },
  tee(ctx, w, h, c) {
    // 티셔츠 가슴 띠 · 목둘레 + 반바지(아래 띠 · 허리띠)
    band(ctx, w, h, 0.53, 0.65, c.dark);
    band(ctx, w, h, 0.32, 0.4, c.dark);
    band(ctx, w, h, 0.335, 0.385, c.cream);
    band(ctx, w, h, 0, 0.17, c.dark);
    band(ctx, w, h, 0.155, 0.19, c.cream);
    bodyBox(ctx, w, h, -0.08, 0.08, 0.15, 0.2, c.dark);
  },
  jacket(ctx, w, h, c) {
    // 지퍼 점퍼: 앞 지퍼 · 세운 깃 · 주머니 · 밑단
    bodyBox(ctx, w, h, -1.25, 1.25, 0.5, 0.65, c.cream);
    band(ctx, w, h, 0, 0.07, c.dark);
    bodyBox(ctx, w, h, -0.05, 0.05, 0, 0.6, c.cream);
    bodyBox(ctx, w, h, -0.025, 0.025, 0, 0.6, c.dark);
    bodyBox(ctx, w, h, -0.09, 0.09, 0.42, 0.48, c.cream);
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = w * 0.008;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(angX(s * 0.45, w), bodyY(0.26, h));
      ctx.lineTo(angX(s * 0.7, w), bodyY(0.14, h));
      ctx.stroke();
    }
  },
  // 여자 -------------------------------------------------------------
  sailor(ctx, w, h, c) {
    // 세일러 칼라(앞은 V, 등은 네모 자락) + 앞 매듭
    const col = c.cream;
    bodyBox(ctx, w, h, Math.PI - 0.95, Math.PI + 0.95, 0.3, 0.65, col);
    band(ctx, w, h, 0.5, 0.65, col);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(angX(-0.75, w), bodyY(0.52, h));
    ctx.lineTo(angX(0, w), bodyY(0.28, h));
    ctx.lineTo(angX(0.75, w), bodyY(0.52, h));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.moveTo(angX(-0.45, w), bodyY(0.53, h));
    ctx.lineTo(angX(0, w), bodyY(0.37, h));
    ctx.lineTo(angX(0.45, w), bodyY(0.53, h));
    ctx.closePath();
    ctx.fill();
    // 칼라 테 줄
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = w * 0.007;
    ctx.beginPath();
    ctx.moveTo(angX(-0.68, w), bodyY(0.51, h));
    ctx.lineTo(angX(0, w), bodyY(0.31, h));
    ctx.lineTo(angX(0.68, w), bodyY(0.51, h));
    ctx.stroke();
    ctx.strokeRect(angX(Math.PI - 0.85, w), bodyY(0.6, h), angX(Math.PI + 0.85, w) - angX(Math.PI - 0.85, w), bodyY(0.34, h) - bodyY(0.6, h));
    // 매듭(나비 모양)
    ctx.fillStyle = c.dark;
    const bx = angX(0, w), by = bodyY(0.31, h), r = w * 0.03;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - r * 1.4, by - r * 0.8);
    ctx.lineTo(bx - r * 1.4, by + r * 0.8);
    ctx.closePath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + r * 1.4, by - r * 0.8);
    ctx.lineTo(bx + r * 1.4, by + r * 0.8);
    ctx.closePath();
    ctx.fill();
  },
  sporty(ctx, w, h, c) {
    // 트랙 재킷: 목 테 · 옆선 두 줄 · 앞 지퍼
    band(ctx, w, h, 0.53, 0.65, c.cream);
    for (const a of [-Math.PI / 2, Math.PI / 2]) {
      bodyBox(ctx, w, h, a - 0.12, a - 0.05, 0.12, 0.56, c.cream);
      bodyBox(ctx, w, h, a + 0.05, a + 0.12, 0.12, 0.56, c.cream);
    }
    bodyBox(ctx, w, h, -0.03, 0.03, 0.17, 0.6, c.cream);
  },
  pinafore(ctx, w, h, c) {
    // 멜빵바지의 가슴판 + 어깨끈(짙은 색) + 하트 주머니 + 단추
    const x0 = angX(-0.55, w), x1 = angX(0.55, w), y0 = bodyY(0.44, h), y1 = bodyY(0.12, h);
    ctx.fillStyle = c.deep;
    ctx.beginPath();
    ctx.roundRect(x0, y0, x1 - x0, y1 - y0, w * 0.02);
    ctx.fill();
    for (const a of [-0.42, 0.42]) bodyBox(ctx, w, h, a - 0.07, a + 0.07, 0.42, 0.65, c.deep);
    for (const a of [Math.PI - 0.42, Math.PI + 0.42]) bodyBox(ctx, w, h, a - 0.07, a + 0.07, 0.15, 0.65, c.deep);
    for (const a of [-0.42, 0.42]) dot(ctx, w, h, a, 0.42, w * 0.012, c.cream);
    ctx.fillStyle = c.light;
    heartPath(ctx, angX(0, w), bodyY(0.28, h), w * 0.03);
    ctx.fill();
  },
  dress(ctx, w, h, c) {
    // 둥근 칼라 블라우스: 칼라 두 장 + 단추 셋

    band(ctx, w, h, 0.56, 0.65, c.cream);
    const ry = (bodyY(0.44, h) - bodyY(0.6, h)) * 0.6;
    for (const [col, k] of [[c.dark, 1.12], [c.cream, 1]]) {
      ctx.fillStyle = col;
      for (const a of [-0.33, 0.33]) {
        ctx.beginPath();
        ctx.ellipse(angX(a, w), bodyY(0.53, h), w * 0.046 * k, ry * k, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const y of [0.42, 0.34, 0.26]) dot(ctx, w, h, 0, y, w * 0.011, c.dark);
  },
};

/**
 * 바지(종류마다): 몸통 아래 띠(허리 · 엉덩이)와 다리 영역(위가 엉덩이, 아래가 발목). [몸통 색, 다리 그리기]
 *   jogger 조거(짙은 색 + 크림 발목 단) · overallShorts 멜빵 반바지 · shorts 반바지 · cargo 카고(옆 주머니) · cuffShorts 접은 반바지 ·
 *   track 트랙 바지(형광 옆줄) · dungarees 멜빵 긴바지 · wide 와이드(밝은 색 + 주름선)
 */
export const PANTS = {
  jogger: (ctx, w, h, c) => {
    ctx.fillStyle = c.dark;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.cream;
    ctx.fillRect(0, h * 0.84, w, h * 0.16);
    return c.dark;
  },
  overallShorts: (ctx, w, h, c) => {
    ctx.fillStyle = c.dark;
    ctx.fillRect(0, 0, w, h * 0.42);
    return c.dark;
  },
  shorts: (ctx, w, h, c) => {
    ctx.fillStyle = c.deep;
    ctx.fillRect(0, 0, w, h * 0.46);
    ctx.fillStyle = c.cream;
    ctx.fillRect(0, h * 0.42, w, h * 0.05);
    return c.deep;
  },
  cargo: (ctx, w, h, c) => {
    ctx.fillStyle = c.mid;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.deep;
    for (const x of [0.2, 0.7]) ctx.fillRect(w * x, h * 0.3, w * 0.12, h * 0.22);
    ctx.fillRect(0, h * 0.86, w, h * 0.14);
    return c.mid;
  },
  cuffShorts: (ctx, w, h, c) => {
    ctx.fillStyle = c.light;
    ctx.fillRect(0, 0, w, h * 0.44);
    ctx.fillStyle = c.cream;
    ctx.fillRect(0, h * 0.36, w, h * 0.1);
    return c.light;
  },
  track: (ctx, w, h, c) => {
    ctx.fillStyle = c.deep;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.main;
    for (const x of [0.22, 0.72]) {
      ctx.fillRect(w * x, 0, w * 0.035, h);
      ctx.fillRect(w * (x + 0.06), 0, w * 0.035, h);
    }
    return c.deep;
  },
  dungarees: (ctx, w, h, c) => {
    ctx.fillStyle = c.deep;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.cream;
    ctx.fillRect(0, h * 0.86, w, h * 0.05);
    return c.deep;
  },
  wide: (ctx, w, h, c) => {
    ctx.fillStyle = c.cream;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.light;
    for (const x of [0.25, 0.75]) ctx.fillRect(w * x - w * 0.006, 0, w * 0.012, h);
    return c.cream;
  },
};

/**
 * 팀 색(hex)과 무늬 번호, 캐릭터 종류로 아틀라스 캔버스(size² — 기본 1024)를 그린다. char < 0 이면 옷 선 없이(원본 그대로의 인형).
 * 머리 옆면은 무늬만(눈 창은 셰이더가 덧그린다).
 */
export function drawAtlas(hex, patternIndex, char = -1, size = SIZE) {
  const c = skinColors(hex);
  const N = PATTERN_NAMES.length;
  const name = PATTERN_NAMES[(((patternIndex | 0) % N) + N) % N];
  const pat = SIDE[name];
  const def = char >= 0 ? CHARACTERS[char % CHARACTERS.length] : null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.scale(size / SIZE, size / SIZE);
  ctx.fillStyle = c.main;
  ctx.fillRect(0, 0, SIZE, SIZE);

  clipRect(ctx, ATLAS.headSide, (w, h) => pat(ctx, w, h, c));
  // 바지 색(몸통 아래 띠와 같은 색)을 먼저 정한다
  let pantsCol = null;
  if (def && PANTS[def.pants]) {
    const tmp = document.createElement("canvas");
    tmp.width = tmp.height = 4;
    pantsCol = PANTS[def.pants](tmp.getContext("2d"), 4, 4, c);
  }
  clipRect(ctx, ATLAS.body, (w, h) => {
    pat(ctx, w, h, c);
    if (def && OUTFITS[def.outfit]) OUTFITS[def.outfit](ctx, w, h, c);
    if (pantsCol) {
      // 바지 허리: 몸통 아래 띠 + 허리선
      band(ctx, w, h, 0, 0.17, pantsCol);
      band(ctx, w, h, 0.15, 0.18, c.deep);
    }
  });
  clipRect(ctx, ATLAS.headTop, (w, h) => {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    (TOP[name] || TOP.candy)(ctx, w, h, c);
  });
  // 팔: 단색 + 소매 띠
  clipRect(ctx, ATLAS.arm, (w, h) => {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = c.cream;
    ctx.fillRect(0, h * 0.12, w, h * 0.1);
    ctx.fillRect(0, h * 0.28, w, h * 0.05);
  });
  clipRect(ctx, ATLAS.hand, (w, h) => {
    ctx.fillStyle = c.main;
    ctx.fillRect(0, 0, w, h);
  });
  clipRect(ctx, ATLAS.leg, (w, h) => {
    pat(ctx, w, h, c);
    if (def && PANTS[def.pants]) PANTS[def.pants](ctx, w, h, c);
  });
  // 신발: 운동화(단색 + 발등의 줄 세 개) · 끈 구두(짙은 색 + 크림 끈)
  clipRect(ctx, ATLAS.shoe, (w, h) => {
    if (def && def.shoe === "strap") {
      ctx.fillStyle = c.dark;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = c.cream;
      ctx.fillRect(w * 0.18, h * 0.42, w * 0.64, h * 0.12);
      ctx.beginPath();
      ctx.arc(w * 0.72, h * 0.48, w * 0.05, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = c.main;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = c.cream;
      for (let i = 0; i < 3; i++) ctx.fillRect(w * 0.36, h * (0.2 + i * 0.13), w * 0.28, h * 0.06);
    }
  });
  return canvas;
}

/** 팔레트 색 번호 → hex(−1 등 범위 밖은 돌려 쓴다 — characters.js 의 옛 hexOf 와 같다) */
export function paletteHex(colorIndex) {
  const n = PALETTE.length;
  return PALETTE[(((colorIndex ?? 0) % n) + n) % n].hex;
}

/** 닉네임에서 무늬 번호를 뽑는다(원본 그대로 — 모든 클라이언트가 같은 값). */
export function skinVariant(name) {
  let h = 2166136261;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % PATTERN_NAMES.length;
}

/** 그리는 함수가 있는 무늬 · 윗면 · 옷 이름(시험 — 무늬 표와 그리는 함수가 어긋나지 않았나) */
export const PATTERN_DRAWERS = Object.freeze({ side: Object.keys(SIDE), top: Object.keys(TOP), outfits: Object.keys(OUTFITS), pants: Object.keys(PANTS) });
