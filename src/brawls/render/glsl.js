// 여러 셰이더가 같이 쓰는 GLSL 조각: 섬광 점광(바닥 · 장애물 그림 · 층 스택 · 구가 모두 이것 — three 의 빛은 쓰지 않는다) ·
// 전장의 안개(docs/DESIGN.md §3.8 — 바닥 · 그림 · 스택에 곱한다) · 4×4 베이어 디더 · 값 잡음.
// 점광은 lights.js 가 프레임마다 채운다(화질 저 0 · 중 4 · 고 8 — docs/DESIGN.md §3.5). 꺼지면 uLightOn = 0 이라 계산을 건너뛴다.
// 안개는 fog.js 가 채운다(반 칸에 한 점 — R 지금 보임, G 가 본 곳). 꺼지면 uFogOn = 0.
import { PROJ } from "./camera.js";
import { STYLE } from "./style.js";

export const MAX_LIGHTS = 8;

// 카메라 쪽(V)과 화면 위쪽(U)의 월드 방향(camera.js 의 PROJ)
export const VIEW_V = PROJ.view;
export const VIEW_U = PROJ.up;

const v3 = (a) => `vec3(${a.map((x) => x.toFixed(6)).join(", ")})`;

export const GLSL_LIGHTS = /* glsl */ `
uniform vec4 uLightPos[${MAX_LIGHTS}]; // xyz 월드 위치, w 반지름(u)
uniform vec4 uLightCol[${MAX_LIGHTS}]; // rgb 색, a 세기
uniform int uLightN;
uniform float uLightOn;   // 0 = 조명 없음(저 · 중)
uniform float uAmbient;   // 조명이 켜졌을 때의 바탕 밝기
uniform float uLightAdd;  // 더하는 빛(어두운 바닥도 팀 색으로 물든다)
uniform float uShadowPass; // 1 = 그림자 맵에 깊이만 그리는 중(장애물 · 캐릭터)
const vec3 VIEW_R = ${v3(PROJ.right)};
const vec3 VIEW_U = ${v3(VIEW_U)};
const vec3 VIEW_V = ${v3(VIEW_V)};
vec3 shade(vec3 col, vec3 P, vec3 N) {
  if (uLightOn < 0.5) return col;
  vec3 sum = vec3(uAmbient);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightN) break;
    vec3 L = uLightPos[i].xyz - P;
    float d = length(L);
    float att = clamp(1.0 - d / uLightPos[i].w, 0.0, 1.0);
    att *= att;
    float nl = max(dot(N, L / max(d, 1e-3)), 0.0) * 0.75 + 0.25;
    sum += uLightCol[i].rgb * (uLightCol[i].a * att * nl);
  }
  return col * sum + (sum - uAmbient) * uLightAdd;
}
`;

const F = STYLE.fog;
/** 안개(바닥 · 그림 · 스택이 같이 쓴다). fogK(xz) = (지금 보임 0..1, 가 본 곳 0..1), fogApply(색, 그 둘) */
export const GLSL_FOG = /* glsl */ `
uniform sampler2D uFog;
uniform vec4 uFogInfo;    // x0, z0, 1/폭(u), 1/깊이(u)
uniform float uFogOn;
vec2 fogK(vec2 xz) {
  vec2 f = texture(uFog, (xz - uFogInfo.xy) * uFogInfo.zw).rg;
  return vec2(smoothstep(0.3, 0.7, f.r), smoothstep(0.15, 0.6, f.g));
}
vec3 fogApply(vec3 c, vec2 k) {
  if (uFogOn < 0.5) return c;
  float l = dot(c, vec3(0.3, 0.59, 0.11));
  // 안 가 본 곳도 바닥 · 장애물은 어둡게 보인다(움직이는 것은 그리지 않는다) — 가 본 곳은 조금 더 밝게
  vec3 dim = mix(vec3(l), c, ${F.seenSat.toFixed(3)}) * mix(${F.unseen.toFixed(3)}, ${F.seen.toFixed(3)}, k.y);
  return mix(dim, c, k.x);
}
`;

export const GLSL_UTIL = /* glsl */ `
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

/** 조명 유니폼의 기본값(three ShaderMaterial uniforms 에 펼쳐 넣는다). lights.js 가 같은 객체를 공유해 값을 바꾼다 */
export function lightUniforms(THREE) {
  return {
    uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, -100, 0, 1)) },
    uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uLightN: { value: 0 },
    uLightOn: { value: 0 },
    uAmbient: { value: 1 },
    uLightAdd: { value: 0.1 },
    uShadowPass: { value: 0 },
  };
}

/** 안개 유니폼(fog.js 가 같은 객체를 공유해 값을 바꾼다) */
export function fogUniforms(THREE) {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return {
    uFog: { value: t },
    uFogInfo: { value: new THREE.Vector4(-100, -100, 1 / 200, 1 / 200) },
    uFogOn: { value: 0 },
  };
}
