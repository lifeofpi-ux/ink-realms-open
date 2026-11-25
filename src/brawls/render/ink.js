// 바닥 잉크: 2D 캔버스 한 장에 잉크 자국을 찍고(스탬프), 바뀐 사각형만 GPU 에 올린다.
// ink-brawl 의 src/render/effects.js 「바닥 잉크」를 옮겼다(스탬프 모양 · 부분 업로드).
// 달라진 것: 캔버스가 덮는 범위를 경기장마다 정한다(setExtent), 바닥 셰이더(terrain.js)가 이 텍스처를 월드 xz 로 직접 읽는다.
//
// 잉크의 수명(docs/DESIGN.md §3.7 v14 — 사용자 요청 "일정 시간이 지나면 점차 사라지게"):
//  - 색 캔버스는 바탕이 투명하다 — RGB = 잉크 색, A = 덮은 정도(가장자리 계단 없이).
//  - 시각 캔버스(timeTexture)에 같은 모양으로 "칠한 시각"을 적는다: 회색 값 = 칠한 순간의 시각 부호(CODE_RATE 번/초, 0..255 고리).
//    셰이더가 지금 부호(now)와의 차이로 나이를 구해 LIFE.HOLD 초 동안은 그대로, 그 뒤 LIFE.FADE 초 동안 부드럽게 사라지게 그린다.
//  - 색 캔버스의 알파도 천천히 줄인다(DRY — 띠로 나눠 조금씩). 부호 고리(256 / CODE_RATE 초)가 한 바퀴 돌아 아주 오래된 잉크가
//    "방금 칠한 것"으로 되살아나지 않게, 그 전에 셰이더가 잉크로 치지 않는 옅기(0.04)까지 내려가게 한다.
//
// 캔버스 ↔ 월드: 캔버스 (cx, cy) = (((x − X0) / E + 1) / 2, ((z − Z0) / E + 1) / 2) × SIZE((X0, Z0) = 덮는 가운데 — 보통 0). 텍스처는 뒤집지 않는다(flipY = false, v = cy / SIZE).
import * as THREE from "three";
import { PALETTE } from "../shared/constants.js";

/** 바닥 잉크의 수명(초): HOLD 동안 그대로, 그 뒤 FADE 동안 사라진다(v15.2 사용자 요청 "매우 빠르게" — 12 + 6초 → 1.5 + 1.5초) */
export const INK_LIFE = Object.freeze({ HOLD: 1.5, FADE: 1.5 });
/** 시각 부호: 초당 CODE_RATE 번 올라가는 0..255 고리(한 바퀴 128초) */
export const INK_CODE_RATE = 2;
// 색 캔버스 마르기: 각 줄을 DRY.PERIOD 초마다 한 번 알파 × (1 − DRY.ALPHA). 8비트 반올림으로 남는 옅기는 0.5 / ALPHA 이하(4/255) —
// 255 에서 그 아래까지 약 39번 = 78초 < 부호 한 바퀴(128초)
const DRY = { PERIOD: 2, ALPHA: 0.1 };

const css = (hex) => "#" + hex.toString(16).padStart(6, "0");
const rand = (a, b) => a + Math.random() * (b - a);
const mixHex = (hex, w) => {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const m = (c) => Math.round(c + (255 - c) * w);
  return "#" + ((m(r) << 16) | (m(g) << 8) | m(b)).toString(16).padStart(6, "0");
};

function makeCanvas(n) {
  const c = document.createElement("canvas");
  c.width = c.height = n;
  return c;
}

export function createInk(renderer, { size = 1024 } = {}) {
  let SIZE = size; // 화질마다 다르다(setSize — 저 512² · 중 · 고 1024²)
  const paletteCss = PALETTE.map((p) => css(p.hex));
  const paletteHot = PALETTE.map((p) => mixHex(p.hex, 0.25)); // 형광 잉크의 밝은 속살(흰색을 섞은 것)

  // 색 캔버스(바탕 투명)
  let canvas = makeCanvas(SIZE);
  let ink = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false; // 캔버스 (x, y) = 텍스처 (x, y) — 그래야 바뀐 사각형만 그 자리에 올릴 수 있다
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  // 시각 캔버스(회색 = 칠한 시각 부호). 부호끼리 섞이면 엉뚱한 나이가 되므로 최근접으로 읽는다
  let tcan = makeCanvas(SIZE);
  let tctx = tcan.getContext("2d");
  tctx.fillStyle = "#000";
  tctx.fillRect(0, 0, SIZE, SIZE);
  const timeTexture = new THREE.CanvasTexture(tcan);
  timeTexture.colorSpace = THREE.NoColorSpace;
  timeTexture.flipY = false;
  timeTexture.generateMipmaps = false;
  timeTexture.minFilter = THREE.NearestFilter;
  timeTexture.magFilter = THREE.NearestFilter;

  let extent = 12; // 캔버스가 덮는 정사각형의 반변(월드 u): 가운데 (inkCx, inkCz) 둘레 [−E, E]²
  let inkCx = 0; // 덮는 정사각형의 가운데(월드) — 던전은 내 레인의 가운데(v16)
  let inkCz = 0;
  let pxPerUnit = SIZE / (2 * extent);
  let fullC = true; // 통째로 올려야 한다(처음 · 지우기)
  let fullT = true;
  let clock = 0; // 잉크 시계(초 — update 의 dt 를 쌓는다. 셰이더의 now 와 같은 시계)
  let fadeT = 0;
  let uploadT = 0;
  let fadeRow = 0;
  const rectsC = []; // 아직 올리지 않은 사각형 [x0, y0, x1, y1](캔버스 픽셀) — 색
  const rectsT = []; // 시각(칠한 곳만 — 마르기는 색에만)

  const toPx = (x, z) => [(((x - inkCx) / extent + 1) / 2) * SIZE, (((z - inkCz) / extent + 1) / 2) * SIZE];
  const codeNow = () => Math.floor(clock * INK_CODE_RATE) % 256;
  const timeCss = () => {
    const c = codeNow();
    return `rgb(${c},${c},${c})`;
  };

  function pushRect(list, r) {
    list.push(r);
    if (list.length > 16) {
      // 너무 잘게 흩어졌으면 하나로 묶는다(호출 수를 묶어 둔다)
      const u = list.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[2]), Math.max(a[3], q[3])]);
      list.length = 0;
      list.push(u);
    }
  }

  /** (cx, cy) 둘레 rad 픽셀이 바뀌었다 — 다음 업로드에 그 사각형만 올린다(색 · 시각 모두). */
  function mark(cx, cy, rad) {
    const x0 = Math.max(0, Math.floor(cx - rad));
    const y0 = Math.max(0, Math.floor(cy - rad));
    const x1 = Math.min(SIZE, Math.ceil(cx + rad));
    const y1 = Math.min(SIZE, Math.ceil(cy + rad));
    if (x1 <= x0 || y1 <= y0) return;
    pushRect(rectsC, [x0, y0, x1, y1]);
    pushRect(rectsT, [x0, y0, x1, y1]);
  }

  /**
   * 바뀐 사각형만 GPU 에 올린다. three 의 상태 캐시를 거쳐(bindTexture · pixelStorei · texSubImage2D)
   * 다른 텍스처 업로드와 엇갈리지 않게 한다. 아직 한 번도 올리지 않았으면 three 가 다음 그리기에서 통째로 올린다.
   * @returns {boolean} 다음에 통째로 올려야 하는가(full 을 이어 둔다)
   */
  function uploadOne(tex, src, rects, full) {
    const glTex = renderer.properties.get(tex).__webglTexture;
    if (full || !glTex) {
      if (full) tex.needsUpdate = true;
      rects.length = 0;
      return false;
    }
    if (!rects.length) return false;
    const gl = renderer.getContext();
    const state = renderer.state;
    state.bindTexture(gl.TEXTURE_2D, glTex);
    state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    state.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    for (const [x0, y0, x1, y1] of rects) {
      state.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
      state.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
      state.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, x1 - x0, y1 - y0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    }
    state.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    state.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    rects.length = 0;
    return false;
  }
  function upload() {
    fullC = uploadOne(texture, canvas, rectsC, fullC);
    fullT = uploadOne(timeTexture, tcan, rectsT, fullT);
  }

  function blobPath(cx, cy, r, wobble, points) {
    const pts = [];
    const off = Math.random() * 6.28;
    for (let i = 0; i < points; i++) {
      const a = off + (i / points) * Math.PI * 2;
      const rr = r * (1 - wobble * 0.5 + Math.random() * wobble);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    const path = new Path2D();
    const last = pts[points - 1];
    const first = pts[0];
    path.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
    for (let i = 0; i < points; i++) {
      const p = pts[i];
      const n = pts[(i + 1) % points];
      path.quadraticCurveTo(p[0], p[1], (p[0] + n[0]) / 2, (p[1] + n[1]) / 2);
    }
    path.closePath();
    return path;
  }

  /** 같은 모양을 색 캔버스(잉크 색)와 시각 캔버스(지금 시각 부호)에 칠한다 */
  function fillBoth(path, color, tcol) {
    ink.fillStyle = color;
    ink.fill(path);
    tctx.fillStyle = tcol;
    tctx.fill(path);
  }

  /** 바닥에 잉크 자국을 남긴다. (dx, dz) 가 있으면 그 방향으로 튄 모양이 된다. */
  function splat(x, z, colorIndex, radius, dx = 0, dz = 0) {
    const [cx, cy] = toPx(x, z);
    const r = radius * pxPerUnit;
    const ci = ((colorIndex % PALETTE.length) + PALETTE.length) % PALETTE.length;
    const col = paletteCss[ci];
    const tcol = timeCss();
    // 날아온 방향(캔버스 공간 = 월드 xz 를 그대로 늘린 것)
    let dpx = dx;
    let dpy = dz;
    const dl = Math.hypot(dpx, dpy);
    const biased = dl > 0.001;
    if (biased) {
      dpx /= dl;
      dpy /= dl;
    }
    ink.globalAlpha = 1;
    fillBoth(blobPath(cx, cy, r * 0.62, 0.55, 13), col, tcol);
    // 뻗어 나간 줄기
    const streaks = 5 + ((Math.random() * 5) | 0);
    for (let i = 0; i < streaks; i++) {
      let a = Math.random() * Math.PI * 2;
      if (biased && Math.random() < 0.7) a = Math.atan2(dpy, dpx) + rand(-0.7, 0.7);
      const len = r * rand(0.7, 1.5);
      const w = r * rand(0.05, 0.13);
      const ex = cx + Math.cos(a) * len;
      const ey = cy + Math.sin(a) * len;
      const nx = -Math.sin(a) * w;
      const ny = Math.cos(a) * w;
      const s = new Path2D();
      s.moveTo(cx + nx * 2.2, cy + ny * 2.2);
      s.quadraticCurveTo((cx + ex) / 2 + nx, (cy + ey) / 2 + ny, ex, ey);
      s.quadraticCurveTo((cx + ex) / 2 - nx, (cy + ey) / 2 - ny, cx - nx * 2.2, cy - ny * 2.2);
      s.closePath();
      fillBoth(s, col, tcol);
      const e = new Path2D();
      e.arc(ex, ey, w * rand(1.0, 1.9), 0, Math.PI * 2);
      fillBoth(e, col, tcol);
    }
    // 주변에 흩어진 방울
    const dots = 9 + ((Math.random() * 9) | 0);
    for (let i = 0; i < dots; i++) {
      let a = Math.random() * Math.PI * 2;
      if (biased && Math.random() < 0.6) a = Math.atan2(dpy, dpx) + rand(-0.9, 0.9);
      const d = r * rand(0.7, 1.9);
      const p = new Path2D();
      p.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * rand(0.025, 0.11), 0, Math.PI * 2);
      fillBoth(p, col, tcol);
    }
    // 밝은 속살: 형광 잉크가 두껍게 고인 가운데(몸 안쪽이라 시각은 몸과 같다 — 색에만)
    ink.fillStyle = paletteHot[ci];
    ink.globalAlpha = 0.6;
    ink.fill(blobPath(cx + rand(-1, 1) * r * 0.06, cy + rand(-1, 1) * r * 0.06, r * 0.34, 0.5, 9));
    ink.globalAlpha = 1;
    mark(cx, cy, r * 2.1 + 3); // 줄기 끝(1.5r + 방울) · 흩어진 방울(1.9r + 0.11r)까지
  }

  /** 작은 잉크 방울(떨어지는 방울 · 미사일 꼬리). */
  function dot(x, z, colorIndex, radius) {
    const [cx, cy] = toPx(x, z);
    const rr = Math.max(1.2, radius * pxPerUnit);
    const p = new Path2D();
    p.arc(cx, cy, rr, 0, Math.PI * 2);
    fillBoth(p, paletteCss[((colorIndex % PALETTE.length) + PALETTE.length) % PALETTE.length], timeCss());
    mark(cx, cy, rr + 2);
  }

  function clear() {
    ink.globalAlpha = 1;
    ink.clearRect(0, 0, SIZE, SIZE);
    tctx.fillStyle = "#000";
    tctx.fillRect(0, 0, SIZE, SIZE);
    fullC = fullT = true;
  }

  /** 매 프레임: 잉크 시계 + 천천히 마르기(띠로 나눠 조금씩) + 초당 20번 정도로 묶어서 올리기. */
  function update(dt) {
    clock += dt;
    uploadT -= dt;
    fadeT += dt;
    if (uploadT > 0) return;
    // 각 줄은 DRY.PERIOD 초마다 한 번 알파가 DRY.ALPHA 만큼 줄어든다(색 캔버스만 — 올리는 것은 그 띠뿐이다)
    const rows = Math.min(SIZE, Math.round((fadeT * SIZE) / DRY.PERIOD));
    if (rows > 0) {
      fadeT -= (rows * DRY.PERIOD) / SIZE;
      ink.globalCompositeOperation = "destination-out";
      ink.globalAlpha = DRY.ALPHA;
      ink.fillStyle = "#000";
      let left = rows;
      while (left > 0) {
        const n = Math.min(left, SIZE - fadeRow);
        ink.fillRect(0, fadeRow, SIZE, n);
        pushRect(rectsC, [0, fadeRow, SIZE, fadeRow + n]);
        fadeRow = (fadeRow + n) % SIZE;
        left -= n;
      }
      ink.globalCompositeOperation = "source-over";
      ink.globalAlpha = 1;
    }
    upload();
    uploadT = 0.05;
  }

  return {
    texture,
    timeTexture,
    /** 지금 시각 부호(연속값, 0..256 고리) — 셰이더의 uInkNow */
    get now() {
      return (clock * INK_CODE_RATE) % 256;
    },
    get extent() {
      return extent;
    },
    get center() {
      return [inkCx, inkCz];
    },
    /** 캔버스가 덮는 범위(반변, 월드 u)와 가운데(월드 — 던전은 내 레인만 덮는다)를 바꾸고 잉크를 지운다. */
    setExtent(e, cx = 0, cz = 0) {
      extent = e > 0 ? e : 12;
      inkCx = cx || 0;
      inkCz = cz || 0;
      pxPerUnit = SIZE / (2 * extent);
      clear();
    },
    splat,
    dot,
    clear,
    update,
    /** 그래픽 연결이 되살아났다 — 다음 업로드에서 통째로 올린다. */
    restore() {
      fullC = fullT = true;
    },
    /**
     * 캔버스 크기를 바꾼다(화질: 저 512² · 중 · 고 1024² — 텍스처 메모리). 지금까지 칠한 잉크는 늘이거나 줄여 옮긴다(경기 중에 화질이
     * 저절로 내려가도 바닥이 지워지지 않게 — 시각 부호는 섞이지 않게 최근접으로). GPU 텍스처는 새 크기로 다시 만든다.
     */
    setSize(n) {
      n = Math.max(128, n | 0);
      if (n === SIZE) return;
      const next = makeCanvas(n);
      const ctx = next.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(canvas, 0, 0, n, n);
      const tnext = makeCanvas(n);
      const tc = tnext.getContext("2d");
      tc.imageSmoothingEnabled = false;
      tc.drawImage(tcan, 0, 0, n, n);
      canvas = next;
      ink = ctx;
      tcan = tnext;
      tctx = tc;
      SIZE = n;
      pxPerUnit = SIZE / (2 * extent);
      fadeRow = 0;
      rectsC.length = 0;
      rectsT.length = 0;
      texture.dispose();
      texture.image = canvas;
      timeTexture.dispose();
      timeTexture.image = tcan;
      fullC = fullT = true;
    },
    get size() {
      return SIZE;
    },
    get bytes() {
      return SIZE * SIZE * 4 * 2;
    },
  };
}
