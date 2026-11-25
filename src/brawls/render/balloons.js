// 날아가는 풍선 · 메가 잉크 폭탄(ink-brawl 의 createBalloons 모양 그대로 — 원본 레포는 읽기 전용):
//   풍선 = 아래가 살짝 뾰족한 물방울 + 꼭지(원뿔). 미사일은 날아가는 쪽으로 눕혀 길쭉하게(꼭지가 꼬리). 던진 사람 색으로 번들거리며 빛난다.
//   메가 잉크 폭탄 = 검게 번들거리는 쇠공 + 던진 사람 색의 형광 띠 셋(심장처럼 뛴다) + 쇠 마개 + 휘어진 심지 + 심지 끝 불꽃.
// 원본은 풍선마다 메시 · 점광이었다 — 여기서는 모양을 지오메트리 한 장으로 합쳐 풍선 묶음 1번 · 폭탄 묶음 1번에 그린다(인스턴스).
// 섬광 점광(glsl.js)을 받는다. 프레임마다 push 하고, 그려진 직후(onAfterRender) 비운다.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PALETTE } from "../shared/constants.js";
import { PROJ } from "./camera.js";
import { GLSL_LIGHTS } from "./glsl.js";
import { balloonGeometry } from "./figures.js";

const MAX_BALLOONS = 256;
const MAX_BOMBS = 8;

const v3s = (a) => `vec3(${a.map((x) => x.toFixed(5)).join(", ")})`;
const LDIR = (() => {
  const r = PROJ.right, u = PROJ.up, v = PROJ.view;
  const l = [0, 1, 2].map((i) => -0.6 * r[i] + 0.7 * u[i] + 0.4 * v[i]);
  const n = Math.hypot(...l);
  return l.map((x) => x / n);
})();

const VERT = /* glsl */ `
attribute float aPart;   // 폭탄: 0 껍질 · 1 띠 · 2 마개 · 3 심지 · 4 불꽃(풍선은 0)
attribute float iPulse;  // 폭탄 띠의 뛰기 · 불꽃 세기
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
varying float vPart;
varying float vPulse;
void main() {
  mat3 m = mat3(instanceMatrix);
  vec3 s2 = vec3(dot(m[0], m[0]), dot(m[1], m[1]), dot(m[2], m[2]));
  vN = normalize(m * (normal / max(s2, vec3(1e-6))));
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vC = instanceColor;
  vPart = aPart;
  vPulse = iPulse;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */ `
uniform float uBomb;
varying vec3 vN;
varying vec3 vW;
varying vec3 vC;
varying float vPart;
varying float vPulse;
${GLSL_LIGHTS}
const vec3 LDIR = ${v3s(LDIR)};
const vec3 VDIR = ${v3s(PROJ.view)};
vec3 lit(vec3 base, vec3 N, float rough, float metal) {
  float d = dot(N, LDIR);
  float band = d > 0.25 ? 1.0 : d > -0.25 ? 0.78 : 0.58;
  vec3 c = base * band * mix(vec3(0.7, 0.6, 1.0), vec3(1.0), smoothstep(0.58, 1.0, band));
  vec3 H = normalize(LDIR + VDIR);
  float sp = pow(max(dot(N, H), 0.0), mix(80.0, 12.0, rough));
  c += mix(vec3(1.0), base, metal) * (smoothstep(0.5, 0.65, sp) * 0.85 + sp * 0.2);
  return c;
}
void main() {
  vec3 N = normalize(vN);
  vec3 col;
  if (uBomb < 0.5) {
    // 풍선: 던진 사람 색, 번들번들 + 형광(원본 emissiveIntensity 0.85)
    col = lit(vC, N, 0.16, 0.0) + vC * 0.85;
  } else {
    int p = int(vPart + 0.5);
    if (p == 0) col = lit(vec3(0.009, 0.007, 0.014), N, 0.22, 0.5) + vC * 0.06;
    else if (p == 1) col = lit(vC, N, 0.4, 0.0) * 0.4 + vC * (1.6 + vPulse * 2.2);
    else if (p == 2) col = lit(vec3(0.023, 0.017, 0.033), N, 0.3, 0.8);
    else if (p == 3) col = lit(vec3(0.042, 0.023, 0.010), N, 0.9, 0.0) + vec3(1.0, 0.19, 0.01) * 0.5;
    else col = vec3(1.0, 0.65, 0.2) * (3.0 + vPulse * 2.0);
  }
  gl_FragColor = vec4(shade(col, vW, N), 1.0);
}`;

function bombGeometry() {
  const tag = (g, part) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== "position" && k !== "normal") n.deleteAttribute(k);
    n.setAttribute("aPart", new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count).fill(part), 1));
    return n;
  };
  const list = [tag(new THREE.SphereGeometry(1, 28, 18), 0)];
  for (const [y, rr] of [[0, 1.0], [0.52, 0.855], [-0.52, 0.855]]) {
    const band = new THREE.TorusGeometry(1.0, 0.075, 8, 48);
    band.rotateX(Math.PI / 2);
    band.scale(rr * 1.02, 1, rr * 1.02);
    band.translate(0, y, 0);
    list.push(tag(band, 1));
  }
  const cap = new THREE.CylinderGeometry(0.26, 0.32, 0.26, 18);
  cap.translate(0, 1.0, 0);
  list.push(tag(cap, 2));
  const fuseCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.08, 0), new THREE.Vector3(0.05, 1.3, 0), new THREE.Vector3(0.2, 1.48, 0.03), new THREE.Vector3(0.38, 1.56, 0.05),
  ]);
  list.push(tag(new THREE.TubeGeometry(fuseCurve, 12, 0.055, 6, false), 3));
  const spark = new THREE.IcosahedronGeometry(0.14, 0);
  spark.translate(0.38, 1.56, 0.05);
  list.push(tag(spark, 4));
  return mergeGeometries(list);
}

function balloonWithKnot() {
  const body = balloonGeometry();
  const knot = new THREE.ConeGeometry(0.22, 0.3, 6);
  knot.rotateX(Math.PI);
  knot.translate(0, -1.22, 0);
  const list = [body, knot].map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== "position" && k !== "normal") n.deleteAttribute(k);
    n.setAttribute("aPart", new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count), 1));
    return n;
  });
  return mergeGeometries(list);
}

/** lights = 섬광 점광 유니폼(spheres.js 의 재질 유니폼을 그대로 빌린다) */
export function createBalloonBatch(lights) {
  const make = (geo, max, bomb) => {
    const iPulse = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("iPulse", iPulse);
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...lights, uBomb: { value: bomb ? 1 : 0 } } });
    const mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 8;
    return { mesh, iPulse, n: 0, max };
  };
  const B = make(balloonWithKnot(), MAX_BALLOONS, false);
  const M = make(bombGeometry(), MAX_BOMBS, true);
  for (const g of [B, M]) {
    g.mesh.onBeforeRender = () => {
      g.mesh.count = g.n;
      for (const at of [g.mesh.instanceMatrix, g.mesh.instanceColor, g.iPulse]) {
        at.clearUpdateRanges();
        if (g.n) at.addUpdateRange(0, g.n * at.itemSize);
        at.needsUpdate = true;
      }
    };
    g.mesh.onAfterRender = () => {
      g.n = 0;
    };
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e3 = new THREE.Euler();
  const p3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const col = new THREE.Color();
  const colorOf = (i) => col.setHex(PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length].hex);
  return {
    meshes: [B.mesh, M.mesh],
    /**
     * 풍선 하나(원본 draw): r = 반지름(u), seed = 풍선마다 다른 흔들림. (dirX, dirZ) 를 주면 미사일 — 그쪽으로 눕혀 길쭉하게
     */
    balloon(x, y, z, r, colorIndex, seed, time, dirX = 0, dirZ = 0) {
      if (B.n >= B.max) return;
      p3.set(x, y, z);
      if (dirX || dirZ) {
        const pulse = 1 + Math.sin(time * 40 + seed) * 0.06;
        s3.set(r * 0.72 * pulse, r * 2.1, r * 0.72 * pulse);
        q.setFromUnitVectors(up, dir.set(dirX, 0, dirZ).normalize());
      } else {
        const wob = Math.sin(time * 19 + seed * 5.1) * 0.13;
        s3.set(r * (1 + wob), r * (1 - wob), r * (1 + wob));
        q.setFromEuler(e3.set(time * 3.1 + seed, time * 2.3 + seed * 2, 0));
      }
      B.mesh.setMatrixAt(B.n, m4.compose(p3, q, s3));
      B.mesh.setColorAt(B.n, colorOf(colorIndex));
      B.iPulse.array[B.n] = 0;
      B.n++;
    },
    /** 메가 잉크 폭탄 하나(원본 drawBomb): 천천히 뒹굴되 심지는 대체로 위로, 띠가 뛴다 */
    bomb(x, y, z, r, colorIndex, seed, time) {
      if (M.n >= M.max) return;
      p3.set(x, y, z);
      s3.setScalar(r * (1 + Math.sin(time * 9 + seed) * 0.025));
      q.setFromEuler(e3.set(Math.sin(time * 1.7 + seed) * 0.45, time * 2.4 + seed, Math.cos(time * 1.3 + seed) * 0.4));
      M.mesh.setMatrixAt(M.n, m4.compose(p3, q, s3));
      M.mesh.setColorAt(M.n, colorOf(colorIndex));
      M.iPulse.array[M.n] = Math.max(0, Math.sin(time * 11 + seed)) + Math.random() * 0.3;
      M.n++;
    },
  };
}
