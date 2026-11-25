// 후처리(docs/DESIGN.md §3.5 — 순서: 월드 → 틸트 시프트 → 은은한 블룸 → 옅은 색 보정).
//
//   장면 타깃(색 + 깊이 텍스처). 크기 = 기기 해상도 × 배율(화질 저 0.75) — 또는 픽셀 아트 월드(style.world.pixel)면 1u = ppu 화소의 작은 타깃
//     └ [중 · 고] 절반으로 줄이며 장면 · 밝은 곳(임계값 넘는 것 — 발광으로 1 을 넘긴 것)을 두 장에(MRT) → 가로 흐림 → 세로 흐림
//   합성(화면, 기기 해상도): 확대(선형 | 최근접 + 스크롤 나머지 오프셋) + 틸트 시프트(위 · 아래를 흐린 장면으로) + 블룸 + 비네트
//                            + [고] 색 보정 · 안쪽 가장자리 선(깊이 차) + [선형] 가벼운 FXAA + 화면 번쩍임 · 묻은 잉크 + 선형 → sRGB
// 그리기 호출: 저 1 · 중/고 4. 장면은 선형 색으로 그리고(three 가 렌더 타깃에는 변환 없이 쓴다) 마지막 합성에서 sRGB 로 바꾼다.
// [왕국전] 블룸 · 흐림 타깃을 ¼ 해상도로(div 4 — 화소 수 1/16: 줄이며 쌍선형으로 4×4 를 평균, 흐림 간격도 그만큼 좁혀 빛 번짐 크기는 같다).
//          색 보정 · 비네트는 블룸 없이도(화질 저 — 합성 한 번 안의 계산만) 켤 수 있다(o.post = 블룸 · 틸트, o.grade · o.vignette 는 따로).
import * as THREE from "three";

const FS_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uSrc;
uniform float uThreshold;
uniform float uDiv;      // [왕국전] 2 = 절반(텍셀 넷을 그대로) · 4 = ¼(쌍선형 넷 = 4×4)
in vec2 vUv;
layout(location = 0) out vec4 outScene;
layout(location = 1) out vec4 outBright;
void main() {
  vec2 base = floor(gl_FragCoord.xy) * uDiv;
  vec3 s = vec3(0.0);
  vec3 b = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i & 1), float(i >> 1));
    vec3 c = texture(tScene, (base + o * (uDiv * 0.5) + uDiv * 0.25) / uSrc).rgb;
    s += c;
    float l = max(c.r, max(c.g, c.b));
    b += c * max(l - uThreshold, 0.0) / max(l, 1e-3);
  }
  outScene = vec4(s * 0.25, 1.0);
  outBright = vec4(b * 0.25, 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tA;
uniform sampler2D tB;
uniform vec2 uDir;
in vec2 vUv;
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;
void main() {
  const float w0 = 0.2270270270, w1 = 0.3162162162, w2 = 0.0702702703;
  vec2 o1 = uDir * 1.3846153846, o2 = uDir * 3.2307692308;
  outA = texture(tA, vUv) * w0 + (texture(tA, vUv + o1) + texture(tA, vUv - o1)) * w1 + (texture(tA, vUv + o2) + texture(tA, vUv - o2)) * w2;
  outB = texture(tB, vUv) * w0 + (texture(tB, vUv + o1) + texture(tB, vUv - o1)) * w1 + (texture(tB, vUv + o2) + texture(tB, vUv - o2)) * w2;
}`;

const MAX_LENS = 8;
const COMP_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D tBlur;
uniform sampler2D tBloom;
uniform vec2 uSrc;        // 장면 타깃 크기
uniform vec2 uDev;        // 기기 픽셀 크기
uniform float uNearest;   // 1 = 최근접 확대(픽셀 아트)
uniform vec2 uOffset;     // 최근접일 때 스크롤 나머지(기기 픽셀)
uniform float uZoom;      // 최근접일 때 정수 배율
uniform float uPost;
uniform float uBloom;
uniform float uTilt;
uniform float uFocus;
uniform float uVignette;
uniform float uGrade;
uniform float uEdges;
uniform float uFxaa;
uniform vec3 uEdgeColor;
uniform vec4 uFlash;
uniform vec4 uShock[4];   // 충격파 화면 일그러짐(화질 고): 가운데 x, y(기기 px, GL), 반지름(px), 세기
uniform int uShockN;
uniform vec4 uLens[${MAX_LENS}];
uniform vec3 uLensCol[${MAX_LENS}];
uniform int uLensN;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
vec3 sceneAt(vec2 uv) { return texture(tScene, uv).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 toSRGB(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 fc = gl_FragCoord.xy;
  for (int i = 0; i < 4; i++) {
    if (i >= uShockN) break;
    vec2 d = fc - uShock[i].xy;
    float r = length(d);
    float band = 1.0 - smoothstep(0.0, 26.0, abs(r - uShock[i].z));
    fc -= d / max(r, 1.0) * band * uShock[i].w * 14.0;
  }
  // 월드 타깃 화소 좌표(확대 배율 · 스크롤 소수만큼 민 자리). 최근접이면 화소 가운데를, 선형이면 그대로 읽는다(style.world.filter)
  vec2 t = (fc - uOffset) / uZoom;
  vec2 uv = uNearest > 0.5 ? (floor(t) + 0.5) / uSrc : t / uSrc;
  vec3 c = sceneAt(uv);
  vec2 px = 1.0 / uSrc;
  if (uFxaa > 0.5) {
    // 가벼운 FXAA: 이웃 밝기 차가 큰 곳만 가장자리 방향으로 섞는다
    float lN = luma(sceneAt(uv + vec2(0.0, px.y))), lS = luma(sceneAt(uv - vec2(0.0, px.y)));
    float lE = luma(sceneAt(uv + vec2(px.x, 0.0))), lW = luma(sceneAt(uv - vec2(px.x, 0.0)));
    float lM = luma(c);
    float lo = min(lM, min(min(lN, lS), min(lE, lW))), hi = max(lM, max(max(lN, lS), max(lE, lW)));
    if (hi - lo > max(0.04, hi * 0.12)) {
      vec2 dir = normalize(vec2(-(lN - lS), lE - lW) + 1e-5) * px * 0.75;
      c = (sceneAt(uv + dir) + sceneAt(uv - dir) + c * 2.0) * 0.25;
    }
  }
  if (uEdges > 0.0) {
    // 안쪽 가장자리 선: 깊이가 갑자기 바뀌는 곳(직교라 깊이는 선형)
    float d = texture(tDepth, uv).r;
    float dd = abs(texture(tDepth, uv + vec2(px.x, 0.0)).r - d) + abs(texture(tDepth, uv + vec2(0.0, px.y)).r - d);
    c = mix(c, c * uEdgeColor, uEdges * smoothstep(0.0012, 0.004, dd));
  }
  if (uPost > 0.5) {
    float sy = gl_FragCoord.y / uDev.y;
    float d = sy - uFocus;
    float tb = uTilt * (smoothstep(0.2, 0.52, d) * 0.85 + smoothstep(0.26, 0.56, -d));
    if (tb > 0.004) c = mix(c, texture(tBlur, uv).rgb, clamp(tb, 0.0, 0.9));
    c += texture(tBloom, uv).rgb * uBloom;
  }
  // [왕국전] 색 보정 · 비네트는 블룸과 따로(화질 저도 — 합성 안의 계산만)
  if (uGrade > 0.0) {
    float l = luma(c);
    vec3 g = c * mix(vec3(0.96, 0.94, 1.06), vec3(1.04, 1.01, 0.96), smoothstep(0.05, 0.7, l));
    g = mix(vec3(l), g, 1.08);
    c = mix(c, g, uGrade);
  }
  if (uVignette > 0.0) {
    vec2 q = vUv - 0.5;
    c *= 1.0 - uVignette * smoothstep(0.35, 0.85, length(q * vec2(uDev.x / uDev.y, 1.0)));
  }
  c = toSRGB(c);
  vec2 ndc = vUv * 2.0 - 1.0;
  float aspect = uDev.x / uDev.y;
  for (int i = 0; i < ${MAX_LENS}; i++) {
    if (i >= uLensN) break;
    vec2 dv = (ndc - uLens[i].xy) * vec2(aspect, 1.0);
    float r = length(dv) / uLens[i].z + 0.12 * sin(atan(dv.y, dv.x) * 7.0 + float(i) * 2.1);
    if (r < 1.0) c = mix(c, uLensCol[i], uLens[i].w * (r > 0.82 ? 0.75 : 1.0));
  }
  c = mix(c, uFlash.rgb, uFlash.a);
  outColor = vec4(c, 1.0);
}`;

export function createPost(renderer) {
  // 깊이 + 스텐실(가려진 캐릭터 실루엣은 블록이 보이는 화소에만 — stacks.js · world.js)
  const depthTex = new THREE.DepthTexture(1, 1, THREE.UnsignedInt248Type);
  depthTex.format = THREE.DepthStencilFormat;
  let hdr = true;
  const mkScene = (half) => {
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: true,
      depthTexture: depthTex,
    });
    return rt;
  };
  let scene = mkScene(true);
  const halfOpts = {
    count: 2,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
    type: THREE.HalfFloatType,
  };
  const halfA = new THREE.WebGLRenderTarget(1, 1, halfOpts);
  const halfB = new THREE.WebGLRenderTarget(1, 1, halfOpts);

  const tri = new THREE.BufferGeometry();
  tri.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(tri);
  quad.frustumCulled = false;
  const fsScene = new THREE.Scene();
  fsScene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mk = (frag, uniforms) => new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const down = mk(DOWN_FRAG, { tScene: { value: scene.texture }, uSrc: { value: new THREE.Vector2(1, 1) }, uThreshold: { value: 1 }, uDiv: { value: 4 } });
  let div = 4; // [왕국전] 블룸 · 흐림 타깃 배율(2 절반 · 4 ¼)
  const blur = mk(BLUR_FRAG, { tA: { value: null }, tB: { value: null }, uDir: { value: new THREE.Vector2() } });
  const comp = mk(COMP_FRAG, {
    tScene: { value: scene.texture },
    tDepth: { value: depthTex },
    tBlur: { value: halfA.textures[0] },
    tBloom: { value: halfA.textures[1] },
    uSrc: { value: new THREE.Vector2(1, 1) },
    uDev: { value: new THREE.Vector2(1, 1) },
    uNearest: { value: 0 },
    uOffset: { value: new THREE.Vector2() },
    uZoom: { value: 1 },
    uPost: { value: 0 },
    uBloom: { value: 0.35 },
    uTilt: { value: 0.55 },
    uFocus: { value: 0.45 },
    uVignette: { value: 0.12 },
    uGrade: { value: 0 },
    uEdges: { value: 0 },
    uFxaa: { value: 1 },
    uEdgeColor: { value: new THREE.Color(0.45, 0.38, 0.6) },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uShock: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    uShockN: { value: 0 },
    uLens: { value: Array.from({ length: MAX_LENS }, () => new THREE.Vector4()) },
    uLensCol: { value: Array.from({ length: MAX_LENS }, () => new THREE.Vector3()) },
    uLensN: { value: 0 },
  });

  let sw = 1;
  let sh = 1;
  const post = {
    get scene() {
      return scene;
    },
    depthTexture: depthTex,
    get size() {
      return [sw, sh];
    },
    /** 장면 타깃 크기와 형식(hdr = 반정밀 실수 — 블룸이 1 넘는 빛을 읽는다), [왕국전] d = 블룸 타깃 배율(2 · 4). 바뀔 때만 다시 잡는다 */
    setSize(w, h, useHdr, nearest, d = 4) {
      if (d !== div) {
        div = d;
        down.uniforms.uDiv.value = d;
        sw = sh = 0;
      }
      if (useHdr !== hdr) {
        scene.dispose();
        hdr = useHdr;
        scene = mkScene(hdr);
        down.uniforms.tScene.value = scene.texture;
        comp.uniforms.tScene.value = scene.texture;
        sw = sh = 0;
      }
      const f = nearest ? THREE.NearestFilter : THREE.LinearFilter;
      if (scene.texture.minFilter !== f) {
        scene.texture.minFilter = scene.texture.magFilter = f;
        scene.texture.needsUpdate = true;
      }
      if (w === sw && h === sh) return;
      sw = w;
      sh = h;
      scene.setSize(w, h);
      halfA.setSize(Math.max(1, Math.ceil(w / div)), Math.max(1, Math.ceil(h / div)));
      halfB.setSize(Math.max(1, Math.ceil(w / div)), Math.max(1, Math.ceil(h / div)));
      down.uniforms.uSrc.value.set(w, h);
      comp.uniforms.uSrc.value.set(w, h);
    },
    /** 텍스처 메모리(바이트, 대략): 장면 색 + 깊이 + 절반 두 벌 */
    get bytes() {
      const hw = Math.ceil(sw / div), hh = Math.ceil(sh / div);
      return sw * sh * ((hdr ? 8 : 4) + 4) + hw * hh * 8 * 4;
    },
    /** 장면을 그릴 타깃(renderer.setRenderTarget 에 넘긴다) */
    begin() {
      renderer.setRenderTarget(scene);
    },
    /**
     * 후처리 묶음을 돌리고 화면에 합성한다.
     * o: { post, bloom, threshold, spread, tilt, focus, vignette, grade, edges, fxaa, nearest, zoom, ox, oy, devW, devH, flash, lens }
     */
    run(o) {
      const u = comp.uniforms;
      if (o.post) {
        down.uniforms.uThreshold.value = o.threshold;
        renderer.setRenderTarget(halfA);
        quad.material = down;
        renderer.render(fsScene, cam);
        const sp = o.spread * (2 / div); // ¼ 타깃은 텍셀이 두 배 — 같은 번짐 크기
        blur.uniforms.uDir.value.set(sp / halfA.width, 0);
        blur.uniforms.tA.value = halfA.textures[0];
        blur.uniforms.tB.value = halfA.textures[1];
        renderer.setRenderTarget(halfB);
        quad.material = blur;
        renderer.render(fsScene, cam);
        blur.uniforms.uDir.value.set(0, sp / halfA.height);
        blur.uniforms.tA.value = halfB.textures[0];
        blur.uniforms.tB.value = halfB.textures[1];
        renderer.setRenderTarget(halfA);
        renderer.render(fsScene, cam);
      }
      renderer.setRenderTarget(null);
      u.uPost.value = o.post ? 1 : 0;
      u.uBloom.value = o.bloom;
      u.uTilt.value = o.tilt;
      u.uFocus.value = o.focus;
      u.uVignette.value = o.vignette;
      u.uGrade.value = o.grade;
      u.uEdges.value = o.edges;
      u.uFxaa.value = o.fxaa ? 1 : 0;
      u.uNearest.value = o.nearest ? 1 : 0;
      u.uOffset.value.set(o.ox || 0, o.oy || 0);
      u.uZoom.value = o.zoom || 1;
      u.uDev.value.set(o.devW, o.devH);
      u.uFlash.value.set(o.flash[0], o.flash[1], o.flash[2], o.flash[3]);
      const n = Math.min(MAX_LENS, o.lens.length);
      for (let i = 0; i < n; i++) {
        const l = o.lens[i];
        u.uLens.value[i].set(l.x, l.y, l.r, l.a);
        u.uLensCol.value[i].set(l.rgb[0], l.rgb[1], l.rgb[2]);
      }
      u.uLensN.value = n;
      const ns = Math.min(4, (o.shock || []).length);
      for (let i = 0; i < ns; i++) u.uShock.value[i].set(...o.shock[i]);
      u.uShockN.value = ns;
      quad.material = comp;
      renderer.render(fsScene, cam);
    },
  };
  return post;
}
