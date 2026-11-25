// HD 레이어(docs/DESIGN.md §3.3 ③): 기기 해상도에서 그리는 글자 · 카드 면 · 정답 폭탄 · (선택) 이름표 · 피해 숫자.
// 한글은 저해상도 패스에 넣지 않는다 — 2D 캔버스(1024², 「HD 캔버스」)에 글꼴로 그려 텍스처로 올리고, 인스턴스 사각형 한 묶음
// (그리기 1번)으로 화면에 붙인다. 캔버스는 바뀐 사각형만 올린다(ink.js 와 같은 부분 업로드).
//
// HD 캔버스 배치(픽셀):
//   x 0..255,   y 0..799   카드 글자 층 5장(256×160)        x 256..511, y 0..799  카드 잉크 층 5장(256×160)
//   x 512..1023, y 0..383  큰 딱지 12칸(256×64 — 전광판 바깥 상태 · 두 줄 말풍선)   y 384..799  작은 딱지 26칸(256×32 — 한 줄 말풍선 · 이름표)
//   x 0..1023,  y 800..895 문제 머리판(1024×96)               y 896..959  숫자 글리프 줄       y 960..1023  빛 · 폭탄 · 물방울 그림
//
// 가림: 카드 면처럼 월드에 붙은 것은 장면 패스의 깊이 텍스처를 읽어, 그 화소에서 더 앞의 것이 있으면 버린다(같은 카메라라 창 깊이를
// 그대로 비교한다) — 전광판 앞을 지나가는 캐릭터가 카드 위로 보인다. 이름표 · 숫자는 가리지 않는다(깊이 = −1).
// 장면을 저해상도로 그려도(픽셀 아트 월드) 글자는 늘 기기 해상도다. 캔버스 색은 sRGB 그대로 화면에 쓴다(합성 뒤에 그린다).
import * as THREE from "three";

export const HD_SIZE = 1024;
export const HD = Object.freeze({
  CARD_W: 256, CARD_H: 160,
  cardText: (i) => [0, i * 160, 256, 160],
  cardInk: (i) => [256, i * 160, 256, 160],
  header: [0, 800, 1024, 96],
  glyphs: [0, 896, 1024, 64],
  glow: [960, 960, 64, 64],
  bomb: [896, 960, 64, 64],
  drop: [864, 960, 32, 32],
});
export const MODE_HD = { TEX: 0, CARD: 1, ATLAS: 2, SOLID: 3, GLOW: 4 };

const VERT = /* glsl */ `
in vec4 aRect;   // 가운데 x, y(기기 픽셀, 위 → 아래), 너비, 높이
in vec4 aUV;     // u0, v0, u1, v1(텍스처 픽셀)
in vec4 aColor;
in vec4 aParam;  // 모드, 가림 깊이(창 깊이 0..1, −1 = 가리지 않음), 돌기, 시트(아틀라스)
uniform vec2 uDev;
out vec2 vUV;
flat out vec4 vColor;
flat out vec4 vParam;
void main() {
  vec2 q = position.xy; // -0.5..0.5
  vec2 p = vec2(q.x * aRect.z, -q.y * aRect.w);
  float c = cos(aParam.z), s = sin(aParam.z);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + aRect.xy;
  vUV = mix(aUV.xy, aUV.zw, vec2(q.x + 0.5, 0.5 - q.y));
  vColor = aColor;
  vParam = aParam;
  gl_Position = vec4(p.x / uDev.x * 2.0 - 1.0, 1.0 - p.y / uDev.y * 2.0, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D tHD;
uniform sampler2D tAtlas0;
uniform sampler2D tAtlas1;
uniform sampler2D tAtlas2;
uniform sampler2D tAtlas3;
uniform vec2 uAtlasSize[4];
uniform sampler2D tDepth;
uniform vec2 uDevF;
uniform vec2 uRT;       // 월드 타깃 크기(화소)
uniform vec2 uOrigin;   // 월드 타깃 왼쪽 아래 모서리의 기기 픽셀(GL 좌표)
uniform float uZoom;    // 정수 확대 배율
in vec2 vUV;
flat in vec4 vColor;
flat in vec4 vParam;
layout(location = 0) out vec4 outColor;
vec4 atlasTex(int s, vec2 px) {
  vec2 uv = (floor(px) + 0.5) / uAtlasSize[s];
  if (s == 0) return textureLod(tAtlas0, uv, 0.0);
  if (s == 1) return textureLod(tAtlas1, uv, 0.0);
  if (s == 2) return textureLod(tAtlas2, uv, 0.0);
  return textureLod(tAtlas3, uv, 0.0);
}
void main() {
  // 가림: 장면 깊이가 이것보다 앞이면 버린다
  if (vParam.y > -0.5) {
    vec2 t = (gl_FragCoord.xy - uOrigin) / uZoom;
    float d = texture(tDepth, (floor(t) + 0.5) / uRT).r;
    if (d < vParam.y - 0.0004) discard;
  }
  int mode = int(vParam.x + 0.5);
  vec4 c;
  if (mode == ${MODE_HD.SOLID}) c = vColor;
  else if (mode == ${MODE_HD.ATLAS}) c = atlasTex(int(vParam.w + 0.5), vUV) * vColor;
  else if (mode == ${MODE_HD.CARD}) {
    vec4 txt = texture(tHD, vUV / ${HD_SIZE.toFixed(1)});
    vec4 ink = texture(tHD, (vUV + vec2(256.0, 0.0)) / ${HD_SIZE.toFixed(1)});
    c = vec4(mix(txt.rgb, ink.rgb, ink.a), max(txt.a, ink.a));
    c *= vColor;
  } else c = texture(tHD, vUV / ${HD_SIZE.toFixed(1)}) * vColor;
  if (c.a < 0.01) discard;
  outColor = c;
}`;

const DUMMY = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
DUMMY.needsUpdate = true;

export function createHD(renderer, post) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = HD_SIZE;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.premultiplyAlpha = false;

  const MAX = 640; // 풀이 판(카드 · 조준선 · 폭탄 · 방울)까지 넉넉하게
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  const buf = { aRect: new Float32Array(MAX * 4), aUV: new Float32Array(MAX * 4), aColor: new Float32Array(MAX * 4), aParam: new Float32Array(MAX * 4) };
  const attrs = {};
  for (const [k, a] of Object.entries(buf)) {
    attrs[k] = new THREE.InstancedBufferAttribute(a, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(k, attrs[k]);
  }
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      tHD: { value: texture },
      tAtlas0: { value: DUMMY }, tAtlas1: { value: DUMMY }, tAtlas2: { value: DUMMY }, tAtlas3: { value: DUMMY },
      uAtlasSize: { value: [new THREE.Vector2(1, 1), new THREE.Vector2(1, 1), new THREE.Vector2(1, 1), new THREE.Vector2(1, 1)] },
      tDepth: { value: post.depthTexture },
      uDevF: { value: new THREE.Vector2(1, 1) },
      uDev: { value: new THREE.Vector2(1, 1) },
      uRT: { value: new THREE.Vector2(1, 1) },
      uOrigin: { value: new THREE.Vector2() },
      uZoom: { value: 1 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.SrcAlphaFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---------------------------------------------------------------------- 부분 업로드
  const rects = [];
  let full = true;
  function dirty(x, y, w, h) {
    rects.push([Math.max(0, Math.floor(x)), Math.max(0, Math.floor(y)), Math.min(HD_SIZE, Math.ceil(x + w)), Math.min(HD_SIZE, Math.ceil(y + h))]);
    if (rects.length > 24) {
      const u = rects.reduce((a, r) => [Math.min(a[0], r[0]), Math.min(a[1], r[1]), Math.max(a[2], r[2]), Math.max(a[3], r[3])]);
      rects.length = 0;
      rects.push(u);
    }
  }
  function upload() {
    const glTex = renderer.properties.get(texture).__webglTexture;
    if (full || !glTex) {
      if (full) texture.needsUpdate = true;
      full = false;
      rects.length = 0;
      return;
    }
    if (!rects.length) return;
    const gl = renderer.getContext();
    const state = renderer.state;
    state.bindTexture(gl.TEXTURE_2D, glTex);
    state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    state.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    for (const [x0, y0, x1, y1] of rects) {
      if (x1 <= x0 || y1 <= y0) continue;
      state.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
      state.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
      state.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, x1 - x0, y1 - y0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    }
    state.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    state.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    rects.length = 0;
  }

  // ---------------------------------------------------------------------- 딱지 칸(LRU)
  const big = Array.from({ length: 12 }, (_, i) => ({ x: 512 + (i % 2) * 256, y: Math.floor(i / 2) * 64, w: 256, h: 64, key: null, sig: null, used: 0 }));
  const small = Array.from({ length: 26 }, (_, i) => ({ x: 512 + (i % 2) * 256, y: 384 + Math.floor(i / 2) * 32, w: 256, h: 32, key: null, sig: null, used: 0 }));
  let tick = 0;
  /**
   * 딱지 칸 하나를 빌린다. sig(그릴 내용의 서명)가 지난번과 다르면 draw(ctx, slot) 로 다시 그린다.
   * @returns {{x, y, w, h}} 캔버스 칸
   */
  function label(key, sig, isBig, draw) {
    tick++;
    const pool = isBig ? big : small;
    let s = pool.find((p) => p.key === key);
    if (!s) {
      s = pool.reduce((a, b) => (a.used <= b.used ? a : b));
      s.key = key;
      s.sig = null;
    }
    s.used = tick;
    if (s.sig !== sig) {
      s.sig = sig;
      ctx.clearRect(s.x, s.y, s.w, s.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(s.x, s.y, s.w, s.h);
      ctx.clip();
      draw(ctx, s);
      ctx.restore();
      dirty(s.x, s.y, s.w, s.h);
    }
    return s;
  }

  // 고정 그림: 빛(원형 그러데이션) · 폭탄 · 물방울
  function drawStatic() {
    ctx.clearRect(0, 0, HD_SIZE, HD_SIZE);
    const [gx, gy, gw] = HD.glow;
    const g = ctx.createRadialGradient(gx + gw / 2, gy + gw / 2, 0, gx + gw / 2, gy + gw / 2, gw / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(gx, gy, gw, gw);
    const [bx, by] = HD.bomb;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(bx + 32, by + 36, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(bx + 28, by + 6, 8, 12);
    const [dx, dy] = HD.drop;
    ctx.beginPath();
    ctx.arc(dx + 16, dy + 18, 11, 0, Math.PI * 2);
    ctx.fill();
    full = true;
  }
  drawStatic();

  let n = 0;
  const hd = {
    canvas,
    ctx,
    texture,
    dirty,
    label,
    get count() {
      return n;
    },
    bytes: HD_SIZE * HD_SIZE * 4,
    /** 아틀라스 시트(정답 폭탄을 그 그림으로 그릴 때) */
    setAtlas(i, tex, w, h) {
      mat.uniforms[`tAtlas${i}`].value = tex || DUMMY;
      mat.uniforms.uAtlasSize.value[i].set(w || 1, h || 1);
    },
    begin() {
      n = 0;
    },
    /**
     * 사각형 하나(기기 픽셀). uv = [u0, v0, u1, v1](HD 캔버스 · 아틀라스 픽셀), rgba = [r, g, b, a](곱하기), mode = MODE_HD,
     * depth = 가림 기준(창 깊이 0..1, 가리지 않으면 −1), rot = 돌기(라디안), sheet = 아틀라스 시트 번호
     */
    quad(cx, cy, w, h, uv, rgba, mode = MODE_HD.TEX, rz = -1, rot = 0, sheet = 0) {
      if (n >= MAX) return;
      const i = n * 4;
      buf.aRect[i] = cx; buf.aRect[i + 1] = cy; buf.aRect[i + 2] = w; buf.aRect[i + 3] = h;
      buf.aUV[i] = uv[0]; buf.aUV[i + 1] = uv[1]; buf.aUV[i + 2] = uv[2]; buf.aUV[i + 3] = uv[3];
      buf.aColor[i] = rgba[0]; buf.aColor[i + 1] = rgba[1]; buf.aColor[i + 2] = rgba[2]; buf.aColor[i + 3] = rgba[3];
      buf.aParam[i] = mode; buf.aParam[i + 1] = rz; buf.aParam[i + 2] = rot; buf.aParam[i + 3] = sheet;
      n++;
    },
    /** 화면 크기(기기 픽셀)와 월드 타깃이 화면에 놓인 자리(가림 시험용) */
    setView(devW, devH, rtW = devW, rtH = devH, ox = 0, oy = 0, zoom = 1) {
      const u = mat.uniforms;
      u.uDevF.value.set(devW, devH);
      u.uDev.value.set(devW, devH);
      u.uRT.value.set(rtW, rtH);
      u.uOrigin.value.set(ox, oy);
      u.uZoom.value = zoom;
    },
    /** 화면(지금 렌더 타깃)에 덧그린다. 그릴 것이 없으면 그리기 호출을 쓰지 않는다 */
    render() {
      upload();
      geo.instanceCount = n;
      if (!n) return;
      for (const at of Object.values(attrs)) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, n * 4);
        at.needsUpdate = true;
      }
      renderer.render(scene, cam);
    },
    restore() {
      drawStatic();
      for (const s of [...big, ...small]) s.sig = null;
    },
  };
  return hd;
}

/** HD 캔버스 글꼴(화면 문구 글꼴과 같은 계열). 숫자 · 제목은 포스터체, 본문은 본문체 */
export const FONT_POSTER = '"Black Han Sans", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
export const FONT_BODY = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif';

/** 둥근 사각형 경로 */
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 칸 너비에 맞게 글자를 줄로 나눈다(한글은 글자 단위로 끊는다). 최대 maxLines 줄, 넘치면 마지막 줄 끝을 … */
export function wrapText(ctx, text, maxW, maxLines) {
  const words = String(text ?? "").split(/(\s+)/);
  const lines = [];
  let cur = "";
  const push = (s) => {
    lines.push(s);
  };
  for (const w of words) {
    const t = cur + w;
    if (ctx.measureText(t).width <= maxW) {
      cur = t;
      continue;
    }
    if (cur.trim()) push(cur.trim());
    cur = "";
    // 한 낱말이 너무 길면 글자 단위로
    let piece = "";
    for (const ch of w.trimStart()) {
      if (ctx.measureText(piece + ch).width > maxW) {
        push(piece);
        piece = ch;
      } else piece += ch;
    }
    cur = piece;
  }
  if (cur.trim()) push(cur.trim());
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    let last = keep[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
    keep[maxLines - 1] = last + "…";
    return keep;
  }
  return lines;
}
