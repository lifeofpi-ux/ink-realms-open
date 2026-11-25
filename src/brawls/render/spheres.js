// 광택 구 · 고리 인스턴스(docs/DESIGN.md §3.3 · §3.7 — v8 은 폭발을 three.js 실시간 3D 로): 풍선 · 미사일(늘린 구) · 정답 폭탄 · 잉크 방울 ·
// 폭발의 입체 방울 · 바닥에 닿아 납작하게 퍼지는 방울 · 잉크 왕관 · 기둥 · 버섯 구름, 그리고 퍼지는 충격파 고리(토러스).
// 그리기: 구(외곽선 포함) 한 번 + 고리 한 번.
// 재질(직접 쓴 셰이더): 부드러운 음영(감싼 확산) + 선명한 하이라이트(빛은 왼쪽 위) + 테두리 빛 + 인스턴스마다 발광(블룸 임계값 1 을 넘긴다) +
// 섬광 점광(glsl.js — 주변 폭발의 팀 색이 방울에도 비친다).
// [왕국전] 구는 삼각형 구(중 352 · 고 736 삼각형 + 외곽선 껍질) 대신 화면을 보는 네모 한 장(삼각형 둘)에 픽셀마다 광선 ↔ 타원체를 풀어 그린다
//          (직교 카메라라 구는 늘 원 — 늘린 · 눌린 방울도 행렬 그대로). 법선 · 깊이(gl_FragDepth)를 픽셀마다 구해 다른 것과 바르게 겹치고,
//          외곽선(풍선 · 폭탄 — 1.14배 껍질의 뒷면)도 같은 그리기에서 칠한다. 전투가 몰리면 구가 수백 개라 삼각형이 장면에서 가장 많았다(25만 넘게).
//          화면 밖(setView 의 바닥 사각형 + 여유) 구는 넣지 않는다.
import * as THREE from "three";
import { PROJ } from "./camera.js";
import { GLSL_LIGHTS } from "./glsl.js";

const MAX = 1400;
const MAX_RING = 48;
const OUTLINE_K = 1.14; // 외곽선 껍질 배율(옛 껍질 구와 같다)

const v3s = (a) => `vec3(${a.map((x) => x.toFixed(5)).join(", ")})`;
// 빛: 화면 왼쪽 위 + 카메라 쪽
const LDIR = (() => {
  const r = PROJ.right, u = PROJ.up, v = PROJ.view;
  const l = [0, 1, 2].map((i) => -0.55 * r[i] + 0.65 * u[i] + 0.55 * v[i]);
  const n = Math.hypot(...l);
  return l.map((x) => x / n);
})();

const GLOSS = /* glsl */ `
const vec3 LDIR = ${v3s(LDIR)};
const vec3 VDIR = ${v3s(PROJ.view)};
vec3 gloss(vec3 col, vec3 N, float emit) {
  float d = dot(N, LDIR) * 0.5 + 0.5;
  vec3 c = col * (0.32 + 0.85 * smoothstep(0.2, 0.9, d));
  vec3 H = normalize(LDIR + VDIR);
  float sp = pow(max(dot(N, H), 0.0), 60.0);
  c += vec3(1.0) * (smoothstep(0.45, 0.6, sp) * 0.85 + sp * 0.25);
  float rim = pow(1.0 - max(dot(N, VDIR), 0.0), 3.0);
  c += mix(col, vec3(1.0), 0.35) * rim * 0.65;
  return c + col * emit;
}
`;

// [왕국전] 구 = 화면을 보는 네모(가운데 · 크기 = 행렬의 가장 긴 축 × 외곽선 배율)
const BALL_VERT = /* glsl */ `
in float aEmit;
in vec4 aOl;               // 외곽선 색(선형) · 있음(1)
uniform vec3 uRight;
uniform vec3 uUp;
out vec3 vW;               // 네모 위의 월드 점
flat out vec3 vCenter;
flat out vec3 vC;
flat out float vE;
flat out vec4 vOl;
flat out mat3 vInv;        // 월드 → 단위 구
void main() {
  mat3 M = mat3(instanceMatrix);
  vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float r = max(length(M[0]), max(length(M[1]), length(M[2]))) * ${(OUTLINE_K + 0.02).toFixed(3)};
  vec2 q = position.xy * 2.0;
  vec3 w = c + (uRight * q.x + uUp * q.y) * r;
  vW = w;
  vCenter = c;
  vC = instanceColor;
  vE = aEmit;
  vOl = aOl;
  vInv = inverse(M);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const BALL_FRAG = /* glsl */ `
uniform mat4 projectionMatrix; // three 는 조각 셰이더에 viewMatrix 만 선언한다
uniform vec3 uView;
in vec3 vW;
flat in vec3 vCenter;
flat in vec3 vC;
flat in float vE;
flat in vec4 vOl;
flat in mat3 vInv;
layout(location = 0) out vec4 outColor;
${GLSL_LIGHTS}
${GLOSS}
float depthOf(vec3 p) {
  vec4 cp = projectionMatrix * viewMatrix * vec4(p, 1.0);
  return cp.z / cp.w * 0.5 + 0.5;
}
void main() {
  // 광선(카메라 → 장면): 네모 위 점에서 −uView 쪽. 단위 구 공간에서 |o + t d| = 1 을 푼다
  vec3 o = vInv * (vW - vCenter);
  vec3 d = vInv * (-uView);
  float a = dot(d, d), b = dot(o, d), c = dot(o, o);
  float disc = b * b - a * (c - 1.0);
  if (disc >= 0.0) {
    float t = (-b - sqrt(disc)) / a;
    vec3 p = o + t * d;
    vec3 N = normalize(transpose(vInv) * p);
    vec3 hit = vW - uView * t;
    vec3 col = gloss(vC, N, vE);
    outColor = vec4(shade(col, hit, N), 1.0);
    gl_FragDepth = depthOf(hit);
    return;
  }
  // 외곽선: 1.14배 껍질의 뒷면(옛 뒤집은 껍질 구와 같은 깊이 — 앞의 것에 가려진다)
  if (vOl.a < 0.5) discard;
  float K2 = ${(OUTLINE_K * OUTLINE_K).toFixed(4)};
  float disc2 = b * b - a * (c - K2);
  if (disc2 < 0.0) discard;
  float t2 = (-b + sqrt(disc2)) / a;
  outColor = vec4(vOl.rgb, 1.0);
  gl_FragDepth = depthOf(vW - uView * t2);
}`;

const RING_VERT = /* glsl */ `
attribute vec2 aTor;    // 고리 둘레각 θ, 관 둘레각 φ
attribute vec4 rA;      // 가운데 xyz, 반지름 R
attribute vec4 rB;      // 관 굵기, 발광, 높이 눌림(0..1), 쓰지 않음
attribute vec3 rC;      // 색(선형)
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
varying float vE;
void main() {
  vec3 dir = vec3(cos(aTor.x), 0.0, sin(aTor.x));
  float cp = cos(aTor.y), sp = sin(aTor.y);
  vec3 p = rA.xyz + dir * (rA.w + rB.x * cp) + vec3(0.0, rB.x * sp * rB.z, 0.0);
  vN = normalize(vec3(dir.x * cp, sp / max(rB.z, 0.05), dir.z * cp));
  vW = p;
  vC = rC;
  vE = rB.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RING_FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
varying float vE;
${GLSL_LIGHTS}
${GLOSS}
void main() {
  vec3 N = normalize(vN);
  vec3 c = gloss(vC, N, vE);
  gl_FragColor = vec4(shade(c, vW, N), 1.0);
}`;

function ringGeometry(seg = 64, tube = 8) {
  const g = new THREE.InstancedBufferGeometry();
  const tor = new Float32Array((seg + 1) * (tube + 1) * 2);
  const idx = [];
  let k = 0;
  for (let i = 0; i <= seg; i++) for (let j = 0; j <= tube; j++) {
    tor[k++] = (i / seg) * Math.PI * 2;
    tor[k++] = (j / tube) * Math.PI * 2;
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) {
    const a = i * (tube + 1) + j, b = (i + 1) * (tube + 1) + j;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  g.setAttribute("aTor", new THREE.BufferAttribute(tor, 2));
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((seg + 1) * (tube + 1) * 3), 3));
  g.setIndex(idx);
  return g;
}

export function createSpheres(lightU) {
  // [왕국전] 네모 한 장(−0.5..0.5) — 셰이더가 구로 그린다
  const geo = new THREE.PlaneGeometry(1, 1);
  const aEmit = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
  const aOl = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aEmit", aEmit);
  geo.setAttribute("aOl", aOl);
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: BALL_VERT,
    fragmentShader: BALL_FRAG,
    uniforms: {
      uRight: { value: new THREE.Vector3(...PROJ.right) },
      uUp: { value: new THREE.Vector3(...PROJ.up) },
      uView: { value: new THREE.Vector3(...PROJ.view) },
      ...lightU,
    },
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.renderOrder = 8;

  // 충격파 고리(토러스 — 반지름과 관 굵기를 따로)
  const rgeo = ringGeometry();
  const rbuf = { rA: new Float32Array(MAX_RING * 4), rB: new Float32Array(MAX_RING * 4), rC: new Float32Array(MAX_RING * 3) };
  const rattr = {};
  for (const [k, a] of Object.entries(rbuf)) {
    rattr[k] = new THREE.InstancedBufferAttribute(a, a.length / MAX_RING).setUsage(THREE.DynamicDrawUsage);
    rgeo.setAttribute(k, rattr[k]);
  }
  rgeo.instanceCount = 0;
  rgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const ringMat = new THREE.ShaderMaterial({ vertexShader: RING_VERT, fragmentShader: RING_FRAG, uniforms: { ...lightU } });
  const ring = new THREE.Mesh(rgeo, ringMat);
  ring.frustumCulled = false;
  ring.renderOrder = 8;

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const col = new THREE.Color();
  let n = 0;
  let nl = 0;
  let nr = 0;
  let dropped = 0;
  let culled = 0;
  // [왕국전] 화면에 드는 바닥 사각형(지난 프레임 — 구는 그리기 전에 넣는다). 높이 y 인 구는 화면에서 y·LIFT/SQUASH 만큼 먼 쪽 바닥과 겹친다
  const view = { x0: -1e9, z0: -1e9, x1: 1e9, z1: 1e9 };
  const LZ = PROJ.LIFT / PROJ.SQUASH;
  const out = (x, y, z, r) => x + r < view.x0 || x - r > view.x1 || z - y * LZ + r < view.z0 || z - y * LZ - r > view.z1;
  return {
    mesh,
    ring,
    meshes: [mesh, ring],
    get count() {
      return n + nr;
    },
    get dropped() {
      return dropped;
    },
    /** 이번 프레임에 화면 밖이라 넣지 않은 구 수 */
    get culled() {
      return culled;
    },
    /** [왕국전] 구를 넣을 바닥 사각형(월드 u — 화면 + 여유). 렌더러가 프레임마다 */
    setView(x0, z0, x1, z1) {
      view.x0 = x0; view.z0 = z0; view.x1 = x1; view.z1 = z1;
    },
    /** 화질: (옛 구 분할) — 이제 픽셀마다 구라 할 일이 없다 */
    setDetail() {},
    begin() {
      n = 0;
      nl = 0;
      nr = 0;
      dropped = 0;
      culled = 0;
    },
    /**
     * 구 하나: 가운데 (x, y, z), 반지름 r, 색 0xRRGGBB, 발광(0 = 없음, 0.3 = 은은 · 1 이상 = 블룸), 외곽선(짙은 톤 0xRRGGBB | −1),
     * 늘림 stretch 와 방향 (dx, dy, dz)(미사일 · 날아가는 방울 — 부피는 그대로 두고 늘인다)
     */
    ball(x, y, z, r, hex, emit = 0, outline = -1, stretch = 1, dx = 0, dy = 0, dz = 0) {
      if (n >= MAX) {
        dropped++;
        return;
      }
      if (out(x, y, z, r * stretch * OUTLINE_K + 0.5)) {
        culled++;
        return;
      }
      p3.set(x, y, z);
      if (stretch !== 1 && (dx || dy || dz)) {
        dir.set(dx, dy, dz).normalize();
        q.setFromUnitVectors(up, dir);
        const k = 1 / Math.sqrt(stretch);
        s3.set(r * k, r * stretch, r * k);
      } else {
        q.identity();
        s3.set(r, r, r);
      }
      m4.compose(p3, q, s3);
      mesh.setMatrixAt(n, m4);
      mesh.setColorAt(n, col.setHex(hex));
      aEmit.array[n] = emit;
      const o4 = n * 4;
      if (outline >= 0) {
        col.setHex(outline);
        aOl.array[o4] = col.r; aOl.array[o4 + 1] = col.g; aOl.array[o4 + 2] = col.b; aOl.array[o4 + 3] = 1;
        nl++;
      } else aOl.array[o4 + 3] = 0;
      n++;
    },
    /** 눌린 · 늘린 구(바닥에 닿아 퍼지는 방울 · 버섯 갓): 반지름 (rx, ry, rz) */
    blob(x, y, z, rx, ry, rz, hex, emit = 0) {
      if (n >= MAX) {
        dropped++;
        return;
      }
      if (out(x, y, z, Math.max(rx, ry, rz) + 0.5)) {
        culled++;
        return;
      }
      q.identity();
      m4.compose(p3.set(x, y, z), q, s3.set(rx, ry, rz));
      mesh.setMatrixAt(n, m4);
      mesh.setColorAt(n, col.setHex(hex));
      aEmit.array[n] = emit;
      aOl.array[n * 4 + 3] = 0;
      n++;
    },
    /** 고리(토러스): 가운데 (x, y, z), 반지름 R, 관 굵기 t, 색, 발광, 높이 눌림(1 = 둥근 관 · 0.3 = 납작) */
    ring(x, y, z, R, t, hex, emit = 0, flat = 1) {
      if (nr >= MAX_RING || t <= 0.002) return;
      if (out(x, y, z, R + t + 0.5)) return;
      const o = nr * 4;
      rbuf.rA[o] = x; rbuf.rA[o + 1] = y; rbuf.rA[o + 2] = z; rbuf.rA[o + 3] = R;
      rbuf.rB[o] = t; rbuf.rB[o + 1] = emit; rbuf.rB[o + 2] = flat;
      col.setHex(hex);
      rbuf.rC[nr * 3] = col.r; rbuf.rC[nr * 3 + 1] = col.g; rbuf.rC[nr * 3 + 2] = col.b;
      nr++;
    },
    end() {
      mesh.count = n;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, n * 3);
      mesh.instanceColor.needsUpdate = true;
      for (const [at, k] of [[aEmit, 1], [aOl, 4]]) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, n * k);
        at.needsUpdate = true;
      }
      rgeo.instanceCount = nr;
      for (const at of Object.values(rattr)) {
        at.clearUpdateRanges();
        if (nr) at.addUpdateRange(0, nr * at.itemSize);
        at.needsUpdate = true;
      }
    },
  };
}
