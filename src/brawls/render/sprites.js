// 평면 효과 묶음(그리기 1번 — 반투명): 존 고리 · 팀 색 게이지 · 빛 울타리 · 폭발 고리 · 발밑 점등 · (화질 저) 그림자 데칼 · 조준 표시.
// InstancedBufferGeometry + 직접 쓴 셰이더. 색은 0xRRGGBB(sRGB)로 받아 선형으로 바꿔 넣는다(장면은 선형으로 그리고 합성에서 sRGB 로).
//
// 놓는 방식(mode):
//   STAND 세운 판: (x, y, z) 가 아래 가운데, 화면 오른쪽(PROJ.right)으로 w, 월드 위로 h.
//   FLAT  바닥에 누운 판: (x, y, z) 가 가운데, 월드 x 로 w, 월드 z 로 h(YAW 0° — 일반형은 PROJ.right · PROJ.down).
//   FACE  카메라를 보는 판: (x, y, z) 가 가운데, 화면 오른쪽 · 화면 위로 w · h(입자 · 세운 고리).
//   WALL  바닥의 두 점 (x, z) → (x + w, z + h) 를 잇는 세운 벽(높이 = rect.x) — 둥근 울타리(꼭짓점마다 깊이).
// 모양(shape): RECT · DISC · RING(outline = 두께 비율) · ARC(채운 정도) · BAND(아래에서 위로 솟는 빛 층) · STAR(별).
import * as THREE from "three";
import { PROJ } from "./camera.js";

export const MODE = { STAND: 0, FLAT: 1, FACE: 2, WALL: 3 };
export const SHAPE = { RECT: 0, DISC: 1, RING: 2, ARC: 3, BAND: 5, STAR: 6, POND: 7, SOFT: 8 };

const VERT = /* glsl */ `
in vec3 aPos;
in vec2 aSize;
in vec4 aColor;
in vec4 aParam; // x 모양, y 테두리 · 두께, z 놓는 방식, w 카메라 쪽으로 당김(u)
in vec4 aRect;  // ARC: (채운 정도, 시작각) · WALL/BAND: (높이, 층 수, 솟은 정도)
uniform vec3 uRight;
uniform vec3 uDown;
uniform vec3 uUp;
uniform vec3 uView;
out vec2 vLocal;
flat out vec4 vColor;
flat out vec4 vParam;
flat out vec4 vRect;
void main() {
  vec2 q = position.xy; // x: -0.5..0.5, y: 0..1
  vLocal = vec2(q.x + 0.5, q.y);
  vColor = aColor;
  vParam = aParam;
  vRect = aRect;
  int mode = int(aParam.z + 0.5);
  vec3 w;
  if (mode == ${MODE.WALL}) w = aPos + vec3(aSize.x, 0.0, aSize.y) * (q.x + 0.5) + vec3(0.0, q.y * aRect.x, 0.0);
  else if (mode == ${MODE.FLAT}) w = aPos + uRight * (q.x * aSize.x) + uDown * ((q.y - 0.5) * aSize.y);
  else if (mode == ${MODE.FACE}) w = aPos + uRight * (q.x * aSize.x) + uUp * ((q.y - 0.5) * aSize.y);
  else w = aPos + uRight * (q.x * aSize.x) + vec3(0.0, q.y * aSize.y, 0.0);
  w += uView * aParam.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
in vec2 vLocal;
flat in vec4 vColor;
flat in vec4 vParam;
flat in vec4 vRect;
layout(location = 0) out vec4 outColor;
void main() {
  int shape = int(vParam.x + 0.5);
  vec3 col = vColor.rgb;
  float a = vColor.a;
  vec2 p = vLocal * 2.0 - 1.0;
  if (shape == ${SHAPE.DISC} || shape == ${SHAPE.RING} || shape == ${SHAPE.ARC}) {
    float d = length(p);
    float aa = fwidth(d) * 1.2;
    a *= 1.0 - smoothstep(1.0 - aa, 1.0, d);
    if (shape != ${SHAPE.DISC}) a *= smoothstep(1.0 - vParam.y - aa, 1.0 - vParam.y, d);
    if (shape == ${SHAPE.ARC}) {
      float ang = atan(p.x, -p.y);
      float f = fract((ang + vRect.y) / 6.2831853 + 1.0);
      if (f > vRect.x) discard;
    }
  } else if (shape == ${SHAPE.STAR}) {
    // 별(다섯 뿔)
    float d = length(p);
    float ang = atan(p.y, p.x);
    if (d > mix(0.38, 1.0, pow(0.5 + 0.5 * cos(5.0 * ang), 4.0))) discard;
  } else if (shape == ${SHAPE.POND}) {
    // [왕국전] 잉크 웅덩이(누운 판 한 장 — 예전 데칼 여덟 장): 천천히 도는 소용돌이 물결 · 퍼지는 잔물결 · 떠오르는 방울 · 밝은 둑
    float d = length(p);
    float aa = fwidth(d) * 1.2;
    if (d > 1.0) discard;
    float t = uTime + vRect.x * 7.0;
    float ang = atan(p.y, p.x);
    float sw = sin(ang * 3.0 + d * 7.0 - t * 0.9) * 0.5 + 0.5;
    float rip = pow(sin(d * 20.0 - t * 2.4) * 0.5 + 0.5, 6.0) * (1.0 - d);
    vec3 deep = vec3(0.07, 0.01, 0.09);
    vec3 c = mix(deep, col * 0.55, smoothstep(0.15, 0.95, sw) * (0.55 + 0.45 * d)) + col * rip * 0.5;
    c += col * (0.25 + 0.15 * sin(t * 2.2)) * (1.0 - d * d); // 가운데가 은은하게 빛난다
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float ph = fract(t * 0.6 + fk * 0.25 + vRect.x);
      float cy = floor(t * 0.6 + fk * 0.25 + vRect.x);
      vec2 bc = vec2(sin(fk * 2.1 + cy * 1.3 + vRect.x * 9.0), cos(fk * 1.7 + cy * 0.9 + vRect.x * 5.0)) * 0.48;
      float br = 0.04 + ph * 0.16;
      float rr = abs(length(p - bc) - br);
      c += mix(col, vec3(1.0), 0.6) * (1.0 - smoothstep(0.0, 0.03 + aa, rr)) * (1.0 - ph) * 0.9;
    }
    float bank = smoothstep(0.84, 0.93, d);
    c = mix(c, mix(col, vec3(1.0), 0.45) * 1.3, bank * (1.0 - smoothstep(0.97, 1.0, d)));
    col = c;
    a *= 1.0 - smoothstep(1.0 - aa, 1.0, d);
  } else if (shape == ${SHAPE.SOFT}) {
    // [왕국전] 부드러운 얼룩(가장자리가 흐린 그림자 — 건물 · 캐릭터 발밑)
    float d = length(p);
    a *= 1.0 - smoothstep(0.35, 1.0, d);
  } else if (shape == ${SHAPE.BAND}) {
    // 빛 울타리: 아래에서 위로 솟는 층(층이 하나씩 올라선다) + 아래가 진하고 위로 옅어진다 + 꼭대기 밝은 선
    float layers = max(vRect.y, 1.0);
    float k = floor(vLocal.y * layers);
    float rise = vRect.z * (layers + 2.0) - k;
    if (rise <= 0.0) discard;
    float top = smoothstep(0.9, 1.0, vLocal.y);
    a *= clamp(rise, 0.0, 1.0) * (pow(1.0 - vLocal.y, 1.6) * 0.7 + top * 0.9 + 0.06 * step(0.5, fract(vLocal.x * 6.0)));
    col *= 1.0 + top * 0.6;
  }
  if (a < 0.004) discard;
  outColor = vec4(col, a);
}`;

/**
 * ground = true: 바닥에 붙은 것(누운 판)만 받는 묶음 — 불투명 목록에서 renderOrder 순서로 섞어 그린다(장애물 그림 · 캐릭터보다 먼저, 깊이 시험 없이).
 * 아니면 반투명 목록(모든 불투명 것 뒤, 깊이 시험).
 */
export function createSpriteBatch({ max, order = 20, depthTest = true, additive = false, ground = false }) {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0);
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  const buf = {
    aPos: new Float32Array(max * 3),
    aSize: new Float32Array(max * 2),
    aColor: new Float32Array(max * 4),
    aParam: new Float32Array(max * 4),
    aRect: new Float32Array(max * 4),
  };
  const attrs = {};
  for (const [name, arr] of Object.entries(buf)) {
    attrs[name] = new THREE.InstancedBufferAttribute(arr, arr.length / max).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, attrs[name]);
  }
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uRight: { value: new THREE.Vector3(...PROJ.right) },
      uDown: { value: new THREE.Vector3(...PROJ.down) },
      uUp: { value: new THREE.Vector3(...PROJ.up) },
      uView: { value: new THREE.Vector3(...PROJ.view) },
    },
    transparent: !ground,
    depthWrite: false,
    depthTest: ground ? false : depthTest,
    side: THREE.DoubleSide,
    blending: ground ? THREE.CustomBlending : additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;

  const c = new THREE.Color();
  let n = 0;
  let dropped = 0;
  function common(i, x, y, z, rgb, a, shape, outline, mode, lift) {
    const i3 = i * 3, i4 = i * 4;
    buf.aPos[i3] = x; buf.aPos[i3 + 1] = y; buf.aPos[i3 + 2] = z;
    c.setHex(rgb);
    buf.aColor[i4] = c.r; buf.aColor[i4 + 1] = c.g; buf.aColor[i4 + 2] = c.b; buf.aColor[i4 + 3] = a;
    buf.aParam[i4] = shape; buf.aParam[i4 + 1] = outline; buf.aParam[i4 + 2] = mode; buf.aParam[i4 + 3] = lift;
  }
  const batch = {
    mesh,
    material: mat,
    get count() {
      return n;
    },
    get dropped() {
      return dropped;
    },
    begin() {
      n = 0;
      dropped = 0;
    },
    /**
     * 판 하나. rgb = 0xRRGGBB(sRGB), a = 0..1, lift = 카메라 쪽으로 당기는 양(u — 바닥과 겹쳐 깜빡이지 않게).
     * emit 을 주면 색에 곱해 1 을 넘긴다(블룸).
     */
    push(x, y, z, w, h, rgb, a = 1, shape = SHAPE.RECT, outline = 0, mode = MODE.FACE, lift = 0, emit = 0) {
      if (n >= max) {
        dropped++;
        return false;
      }
      const i = n++;
      common(i, x, y, z, rgb, a, shape, outline, mode, lift);
      if (emit > 0) {
        const i4 = i * 4;
        buf.aColor[i4] *= 1 + emit; buf.aColor[i4 + 1] *= 1 + emit; buf.aColor[i4 + 2] *= 1 + emit;
      }
      buf.aSize[i * 2] = w; buf.aSize[i * 2 + 1] = h;
      buf.aRect[i * 4] = 0; buf.aRect[i * 4 + 1] = 0; buf.aRect[i * 4 + 2] = 0;
      return true;
    },
    /** [왕국전] 잉크 웅덩이(누운 판 — SHAPE.POND): 지름 d, 색, 씨앗(웅덩이마다 다른 물결), 발광 */
    pond(x, y, z, d, rgb, a, seed, lift = 0.02, emit = 0) {
      if (!batch.push(x, y, z, d, d, rgb, a, SHAPE.POND, 0, MODE.FLAT, lift, emit)) return false;
      buf.aRect[(n - 1) * 4] = seed;
      return true;
    },
    /** 바닥에 누운 호(게이지): 반지름 r, 두께 비율 thick, 채운 정도 fill(0..1, 화면 위쪽에서 시계 방향) */
    arc(x, y, z, r, thick, rgb, a, fill, lift = 0.02, start = 0) {
      if (fill <= 0) return false;
      if (!batch.push(x, y, z, r * 2, r * 2, rgb, a, SHAPE.ARC, thick, MODE.FLAT, lift)) return false;
      buf.aRect[(n - 1) * 4] = Math.min(1, fill);
      buf.aRect[(n - 1) * 4 + 1] = start;
      return true;
    },
    /** 세운 빛 벽 한 칸(울타리): (x0, z0) → (x1, z1), 높이 h, 층 layers 개가 rise(0..1)만큼 솟았다 */
    wall(x0, z0, x1, z1, y, h, rgb, a, layers, rise, emit = 0) {
      if (!batch.push(x0, y, z0, x1 - x0, z1 - z0, rgb, a, SHAPE.BAND, 0, MODE.WALL, 0, emit)) return false;
      const i4 = (n - 1) * 4;
      buf.aRect[i4] = h; buf.aRect[i4 + 1] = layers; buf.aRect[i4 + 2] = rise;
      return true;
    },
    end() {
      geo.instanceCount = n;
      for (const at of Object.values(attrs)) {
        at.clearUpdateRanges();
        if (n > 0) at.addUpdateRange(0, n * at.itemSize);
        at.needsUpdate = true;
      }
    },
  };
  return batch;
}

/**
 * 바닥 효과 묶음 + 공중 효과 묶음을 하나처럼: 누운 판(FLAT · arc)은 바닥 묶음으로(장애물 그림 · 캐릭터 밑에), 나머지는 공중 묶음으로
 */
export function createDecals({ max = 1200 } = {}) {
  const ground = createSpriteBatch({ max, order: -8, ground: true });
  const air = createSpriteBatch({ max: Math.round(max / 2), order: 20 });
  return {
    ground,
    air,
    meshes: [ground.mesh, air.mesh],
    get count() {
      return ground.count + air.count;
    },
    begin() {
      ground.begin();
      air.begin();
    },
    push(x, y, z, w, h, rgb, a, shape, outline, mode = MODE.FACE, lift, emit) {
      return (mode === MODE.FLAT ? ground : air).push(x, y, z, w, h, rgb, a, shape, outline, mode, lift, emit);
    },
    arc: (...a) => ground.arc(...a),
    pond: (...a) => ground.pond(...a),
    wall: (...a) => air.wall(...a),
    /** [왕국전] 시각(초 — 웅덩이 물결) */
    setTime(t) {
      ground.material.uniforms.uTime.value = t % 1000;
      air.material.uniforms.uTime.value = t % 1000;
    },
    end() {
      ground.end();
      air.end();
    },
  };
}
