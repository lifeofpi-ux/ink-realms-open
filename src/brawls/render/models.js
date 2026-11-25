// 장애물 · 아이템 · 설치물의 3D 모델(docs/DESIGN.md §3.10 — 시안 docs/concept/proto3d 의 crate · barrel · tank · machine · pipes · rock 이 출발점).
// 도형(둥근 상자 · 원통 · 구 · 다면체)을 조립해 모델 하나 = 지오메트리 한 장으로 합친다(정점 색 + 정점 효과). props3d.js 가 모두 BatchedMesh
// 하나에 넣어 그리기 한 번에 그린다.
//   정점 속성: position · normal · aCol(정해진 색, 선형) · aFx(x 발광, y 색 쓰기: 0 정해진 색 · 1 인스턴스 색(팀 · 강조 색) ·
//             2 경고 빗금(인스턴스 색 / 짙은 색) · 3 노랑 경고 빗금 · 4 인스턴스 색의 짙은 톤)
// 모든 모델은 발밑(y = 0) 가운데가 원점, 정면 = +z. detail(1 · 화질 저 0.6)로 분할을 줄인다. 한 개당 수백 삼각형.
// [왕국전] aFx 에 셋째 값(정점마다 구운 가림 AO 0..1 — 부품끼리 · 바닥과 맞닿은 곳이 어둡다)을 더했다(bakeAO — 작은 복셀 격자로 반구를 몇 번 훑는다).
//          LOD: 멀리 볼 때 쓰는 가벼운 모델 "이름@1"(나무 · 건물 · 광산 — buildModels(detail, { lod: true })). b.lod 이면 다면체 잎도 한 단계 거칠게.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as REALM_PARTS from "./realmparts.js"; // [왕국전] 건물 넷 · 탑 깃발의 자세한 모델

const WOOD = 0xb07a55, WOOD_D = 0x7a4f40, WOOD_M = 0x9a6a4c;
const METAL = 0x46528c, METAL_L = 0x7f8fd0, METAL_D = 0x2a3160, IRON = 0x23232d;
const ROCK = 0x6f659e, MOSS = 0x3f8a6e, DARK = 0x100922;
const CYAN = 0x00f0ff, PINK = 0xff2d95, LIME = 0xa8ff00, YELLOW = 0xffe600, PURPLE = 0xa24bff;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();

/** 모델 하나를 짓는 도구. lod = 멀리 볼 때 쓰는 가벼운 변형(다면체 잎 · 열매를 한 단계 거칠게) */
function builder(detail, lod = false) {
  const parts = [];
  const seg = (n, min = 3) => Math.max(min, Math.round(n * detail));
  const api = {
    seg,
    lod,
    /** 도형 하나: geo(원점 가운데), color, { at, rot, scale, emit, use } */
    add(geo, color, o = {}) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
      _e.set(...(o.rot || [0, 0, 0]));
      _q.setFromEuler(_e);
      _m.compose(new THREE.Vector3(...(o.at || [0, 0, 0])), _q, new THREE.Vector3(...(o.scale || [1, 1, 1])));
      g.applyMatrix4(_m);
      if (o.flat) g.computeVertexNormals();
      const n = g.attributes.position.count;
      _c.setHex(color);
      const col = new Float32Array(n * 3);
      const fx = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
        fx[i * 3] = o.emit || 0; fx[i * 3 + 1] = o.use || 0; fx[i * 3 + 2] = 1;
      }
      g.setAttribute("aCol", new THREE.BufferAttribute(col, 3));
      g.setAttribute("aFx", new THREE.BufferAttribute(fx, 3));
      parts.push(g);
      return g;
    },
    box: (w, h, d, color, o = {}) => api.add(o.round ? new RoundedBoxGeometry(w, h, d, 1, o.round) : new THREE.BoxGeometry(w, h, d), color, o),
    cyl: (r0, r1, h, color, o = {}) => api.add(new THREE.CylinderGeometry(r0, r1, h, o.n ? seg(o.n, 5) : seg(14, 7), 1, !!o.open), color, o),
    cone: (r, h, color, o = {}) => api.add(new THREE.ConeGeometry(r, h, o.n ? seg(o.n, 4) : seg(10, 5)), color, o),
    sph: (r, color, o = {}) => api.add(new THREE.SphereGeometry(r, o.w ? seg(o.w, 5) : seg(12, 6), o.h ? seg(o.h, 4) : seg(8, 4)), color, o),
    torus: (R, t, color, o = {}) => api.add(new THREE.TorusGeometry(R, t, seg(6, 4), o.n ? seg(o.n, 8) : seg(20, 10), o.arc || Math.PI * 2), color, o),
    extrude: (shape, depth, color, o = {}) => {
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: seg(6, 3) });
      g.translate(0, 0, -depth / 2);
      return api.add(g, color, o);
    },
    /** ao: 정점 가림을 굽는다(ground = 발밑 y 0 이 바닥 — 바닥에 닿은 곳도 어둡게) */
    done(ao = null) {
      if (ao) bakeAO(parts, ao.ground !== false);
      const g = mergeGeometries(parts);
      g.computeBoundingBox();
      g.computeBoundingSphere();
      return g;
    },
  };
  return api;
}

// [왕국전] 정점 AO 굽기: 부품마다의 상자(조금 줄여서)를 작은 복셀 격자에 칠하고, 정점마다 법선 쪽 반구로 몇 방향 · 두 거리를 훑어
// 다른 부품(또는 바닥 아래)에 막히는 몫만큼 어둡게 한다. 그림은 aFx.z(0.4..1)에 담겨 셰이더가 곱한다 — 그리기 비용 0.
const AO_DIRS = (() => {
  // 정이십면체 꼭짓점 12 + 위쪽 하나(하늘 쪽 가중)
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1], [0, 1, 0]];
  return v.map((a) => { const l = Math.hypot(...a); return a.map((x) => x / l); });
})();
function bakeAO(parts, ground) {
  if (!parts.length) return;
  const boxes = parts.map((g) => {
    g.computeBoundingBox();
    return g.boundingBox;
  });
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    lo[0] = Math.min(lo[0], b.min.x); lo[1] = Math.min(lo[1], b.min.y); lo[2] = Math.min(lo[2], b.min.z);
    hi[0] = Math.max(hi[0], b.max.x); hi[1] = Math.max(hi[1], b.max.y); hi[2] = Math.max(hi[2], b.max.z);
  }
  const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const vs = Math.max(0.06, ext / 48);
  const N = [0, 1, 2].map((k) => Math.max(1, Math.ceil((hi[k] - lo[k]) / vs) + 1));
  // 칸마다 덮는 부품: 첫 번호 + 1(0 = 빈 칸), 둘 이상이면 −1
  const occ = new Int32Array(N[0] * N[1] * N[2]);
  boxes.forEach((b, pi) => {
    const sx = (b.max.x - b.min.x) * 0.12, sy = (b.max.y - b.min.y) * 0.12, sz = (b.max.z - b.min.z) * 0.12;
    const i0 = Math.max(0, Math.ceil((b.min.x + sx - lo[0]) / vs)), i1 = Math.min(N[0] - 1, Math.floor((b.max.x - sx - lo[0]) / vs));
    const j0 = Math.max(0, Math.ceil((b.min.y + sy - lo[1]) / vs)), j1 = Math.min(N[1] - 1, Math.floor((b.max.y - sy - lo[1]) / vs));
    const k0 = Math.max(0, Math.ceil((b.min.z + sz - lo[2]) / vs)), k1 = Math.min(N[2] - 1, Math.floor((b.max.z - sz - lo[2]) / vs));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = (k * N[1] + j) * N[0] + i;
      occ[c] = occ[c] === 0 ? pi + 1 : occ[c] === pi + 1 ? pi + 1 : -1;
    }
  });
  const blocked = (x, y, z, self) => {
    if (ground && y < 0) return true;
    const i = Math.round((x - lo[0]) / vs), j = Math.round((y - lo[1]) / vs), k = Math.round((z - lo[2]) / vs);
    if (i < 0 || j < 0 || k < 0 || i >= N[0] || j >= N[1] || k >= N[2]) return false;
    const o = occ[(k * N[1] + j) * N[0] + i];
    return o === -1 || (o > 0 && o !== self + 1);
  };
  const R = [0.18, 0.42];
  parts.forEach((g, pi) => {
    const p = g.attributes.position, nr = g.attributes.normal, fx = g.attributes.aFx;
    if (!nr) return;
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v), y = p.getY(v), z = p.getZ(v);
      const nx = nr.getX(v), ny = nr.getY(v), nz = nr.getZ(v);
      const bx = x + nx * vs * 0.9, by = y + ny * vs * 0.9, bz = z + nz * vs * 0.9;
      let hit = 0, tot = 0;
      for (const d of AO_DIRS) {
        const c = d[0] * nx + d[1] * ny + d[2] * nz;
        if (c < 0.15) continue;
        for (const r of R) {
          tot += c;
          if (blocked(bx + d[0] * r, by + d[1] * r, bz + d[2] * r, pi)) hit += c;
        }
      }
      let ao = tot > 0 ? 1 - 0.8 * (hit / tot) : 1;
      // 바닥에 맞닿은 곳(아래 0.5u)은 조금 더 — 장난감이 바닥에 놓인 느낌
      if (ground) ao *= 0.78 + 0.22 * Math.min(1, Math.max(0, y / 0.5));
      fx.setZ(v, Math.max(0.38, Math.min(1, ao)));
    }
  });
}

// 다면체 바위 덩이: 꼭짓점을 흩뜨려 평면 음영(각진 면) — 위를 보는 면 일부에 이끼
function rockLump(b, r, at, rnd, mossy) {
  const geo = new THREE.IcosahedronGeometry(r, 1); // 다면체는 처음부터 색인 없음
  const p = geo.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) seen.set(k, 0.8 + rnd() * 0.36);
    const f = seen.get(k);
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.82, p.getZ(i) * f);
  }
  geo.translate(at[0], r * 0.5 + at[1], at[2]);
  geo.computeVertexNormals();
  const g = b.add(geo, ROCK, { flat: true });
  // 면마다 톤 차이 · 이끼(위를 보는 면)
  const col = g.attributes.aCol, nrm = g.attributes.normal;
  const moss = new THREE.Color(MOSS), base = new THREE.Color(ROCK);
  for (let f = 0; f < col.count; f += 3) {
    const t = 0.86 + rnd() * 0.24;
    const up = nrm.getY(f) > 0.55 && mossy && rnd() < 0.45;
    const c = up ? moss : base;
    for (let v = 0; v < 3; v++) col.setXYZ(f + v, c.r * t, c.g * t, c.b * t);
  }
}

const rng = (seed) => {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};

// ------------------------------------------------------------------ 장애물
function crateParts(b, w = 1.62, x = 0, rotY = 0) {
  const h = 0.85;
  const R = (dx, dz) => [x + dx * Math.cos(rotY) + dz * Math.sin(rotY), dz * Math.cos(rotY) - dx * Math.sin(rotY)];
  const at = (dx, y, dz) => {
    const [px, pz] = R(dx, dz);
    return [px, y, pz];
  };
  const rot = [0, rotY, 0];
  b.box(w, h, 1.62, WOOD, { at: at(0, h / 2, 0), rot, round: 0.05 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.16, h + 0.06, 0.16, WOOD_D, { at: at(sx * (w / 2 - 0.05), h / 2, sz * 0.76), rot });
  for (const sz of [-1, 1]) b.box(w + 0.04, 0.14, 0.16, WOOD_D, { at: at(0, h - 0.04, sz * 0.76), rot });
  for (const sx of [-1, 1]) b.box(0.16, 0.14, 1.66, WOOD_D, { at: at(sx * (w / 2 - 0.05), h - 0.04, 0), rot });
  const diag = Math.hypot(w - 0.3, 1.32);
  for (const s of [-1, 1]) b.box(diag, 0.07, 0.13, WOOD_D, { at: at(0, h + 0.02, 0), rot: [0, rotY + s * Math.atan2(1.32, w - 0.3), 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.26, 0.1, 0.26, WOOD, { at: at(sx * (w / 2 - 0.06), h + 0.03, sz * 0.75), rot, emit: 0.55, use: 1 });
  b.box(w - 0.1, 0.2, 0.03, WOOD, { at: at(0, 0.14, 0.815), rot, use: 2, emit: 0.25 });
  b.cyl(0.26, 0.26, 0.04, WOOD, { at: at(0.1, h + 0.05, 0.05), emit: 0.6, use: 1, n: 10 });
}
function barrelParts(b, x = 0, z = 0) {
  const h = 0.82;
  b.cyl(0.5, 0.46, h, WOOD, { at: [x, h / 2, z] });
  b.cyl(0.54, 0.54, 0.46, WOOD_M, { at: [x, h / 2, z] });
  for (const y of [0.2, 0.62]) b.cyl(0.56, 0.56, 0.08, METAL, { at: [x, y, z] });
  b.cyl(0.42, 0.42, 0.05, WOOD, { at: [x, h + 0.01, z], emit: 0.65, use: 1 });
  b.sph(0.1, WOOD, { at: [x + 0.32, h - 0.12, z + 0.4], emit: 0.65, use: 1, w: 8, h: 6 });
  b.cyl(0.05, 0.05, 0.28, WOOD, { at: [x + 0.32, h - 0.02, z + 0.42], emit: 0.65, use: 1, n: 6 });
}
function tankParts(b, x = 0, z = 0) {
  const h = 1.25;
  b.cyl(0.62, 0.62, h, METAL, { at: [x, h / 2, z], n: 16 });
  for (const y of [0.34, 0.9]) b.cyl(0.65, 0.65, 0.12, METAL, { at: [x, y, z], emit: 0.7, use: 1, n: 16 });
  b.cyl(0.66, 0.66, 0.1, METAL_L, { at: [x, h, z], n: 16 });
  b.cyl(0.46, 0.46, 0.04, METAL_D, { at: [x, h + 0.05, z], n: 14 });
  b.cyl(0.34, 0.34, 0.04, METAL, { at: [x, h + 0.07, z], emit: 0.85, use: 1, n: 14 });
}
function machineParts(b, w = 1.7, d = 1.6) {
  b.box(w, 0.62, d, METAL_D, { at: [0, 0.31, 0], round: 0.06 });
  b.box(w * 0.62, 0.42, d * 0.62, METAL, { at: [-w * 0.14, 0.83, -d * 0.11], round: 0.05 });
  b.cyl(0.2, 0.24, 0.7, METAL, { at: [w * 0.3, 0.95, -d * 0.22], n: 12 });
  b.cyl(0.25, 0.25, 0.1, CYAN, { at: [w * 0.3, 1.32, -d * 0.22], emit: 0.8, n: 12 });
  for (let i = 0; i < 4; i++) b.box(w * 0.5, 0.05, 0.08, METAL_L, { at: [-w * 0.14, 1.06, -d * 0.31 + i * 0.12 * d] });
  [PINK, LIME, YELLOW].forEach((c, i) => b.sph(0.075, c, { at: [-w * 0.3 + i * 0.24, 0.42, d / 2 + 0.02], emit: 1.0, w: 8, h: 6 }));
  b.box(w - 0.14, 0.16, 0.03, METAL_D, { at: [0, 0.11, d / 2 + 0.005], use: 3, emit: 0.3 });
}
function pipesParts(b, list) {
  for (const [x, z, h] of list) {
    b.cyl(0.3, 0.3, h, METAL, { at: [x, h / 2, z], n: 12 });
    b.cyl(0.34, 0.34, 0.12, METAL_L, { at: [x, h, z], n: 12 });
    b.cyl(0.2, 0.2, 0.04, DARK, { at: [x, h + 0.07, z], n: 10 });
    b.cyl(0.335, 0.335, 0.1, PURPLE, { at: [x, h * 0.45, z], emit: 0.7, n: 12 });
  }
}
function rockParts(b, seed, lumps, spread, scale, mossy) {
  const r = rng(seed);
  for (const [x, z, rr] of lumps) rockLump(b, rr * scale, [x * spread[0], 0, z * spread[1]], r, mossy);
}

// 바깥 벽 한 칸(원본 둘레 벽: 낮은 막힌 판 + 윗단 네온 띠 + 기둥살 + 빛나는 난간대). 정면 +z(경기장 안쪽)
function wallParts(b) {
  b.box(2.02, 0.62, 1.1, 0x1a1a24, { at: [0, 0.31, -0.2] });
  b.box(2.02, 0.1, 1.12, 0x1a1a24, { at: [0, 0.62, -0.2], emit: 0.45, use: 1 });
  for (const x of [-0.5, 0.5]) b.box(0.1, 0.62, 0.1, 0x34344a, { at: [x, 0.98, -0.2] });
  b.box(2.02, 0.12, 0.22, 0x1a1a24, { at: [0, 1.32, -0.2], emit: 0.55, use: 1 });
}

/** 장애물 모델 표: 이름 → 지어 주는 함수(detail). 이름은 props.js 의 묶음 종류 · 모양("solid2x1") + 변형 번호 */
export const OBSTACLES = {
  "soft1x1/0": (b) => crateParts(b),
  "soft1x1/1": (b) => barrelParts(b),
  "soft1x1/2": (b) => crateParts(b, 1.5, 0, 0.12),
  "soft2x1/0": (b) => {
    crateParts(b, 1.62, -0.95, 0);
    crateParts(b, 1.62, 0.95, 0.12);
  },
  "soft2x1/1": (b) => {
    barrelParts(b, -0.95, 0.1);
    barrelParts(b, 0.95, -0.1);
    barrelParts(b, 0, 0.5);
  },
  "solid1x1/0": (b) => tankParts(b),
  "solid1x1/1": (b) => machineParts(b),
  "solid1x1/2": (b) => pipesParts(b, [[-0.4, -0.2, 1.3], [0.28, -0.3, 1.05], [-0.05, 0.36, 0.8]]),
  "solid1x1/3": (b) => rockParts(b, 5, [[-0.25, 0.05, 0.72], [0.42, -0.12, 0.52], [0.1, 0.42, 0.42]], [1, 1], 1, true),
  "solid1x1/4": (b) => rockParts(b, 9, [[-0.2, -0.1, 0.68], [0.38, 0.2, 0.5], [-0.3, 0.42, 0.36]], [1, 1], 1.05, false),
  "solid2x1/0": (b) => machineParts(b, 3.5, 1.6),
  "solid2x1/1": (b) => rockParts(b, 13, [[-0.45, 0.05, 0.8], [0.2, -0.1, 0.7], [0.75, 0.15, 0.55], [-0.05, 0.4, 0.42]], [1.5, 1], 1.05, true),
  "solid2x1/2": (b) => {
    tankParts(b, -0.95, 0);
    tankParts(b, 0.95, 0);
  },
  "solid1x2/0": (b) => {
    tankParts(b, 0, -0.95);
    tankParts(b, 0, 0.95);
  },
  "solid1x2/1": (b) => rockParts(b, 17, [[0.05, -0.5, 0.8], [-0.1, 0.25, 0.72], [0.3, 0.75, 0.5]], [1, 1.4], 1.05, true),
  "solid1x2/2": (b) => pipesParts(b, [[-0.35, -1.1, 1.3], [0.3, -0.7, 1.0], [-0.2, -0.1, 0.9], [0.35, 0.5, 1.25], [-0.3, 1.0, 1.05]]),
  "solid2x2/0": (b) => rockParts(b, 21, [[-0.5, -0.4, 1.0], [0.5, -0.3, 0.85], [-0.3, 0.55, 0.8], [0.55, 0.6, 0.7], [0.05, 0.05, 0.75]], [1.3, 1.3], 1.1, true),
  "solid2x2/1": (b) => {
    machineParts(b, 3.5, 3.3);
    b.cyl(0.3, 0.34, 1.1, METAL, { at: [-1.1, 1.0, 0.9], n: 12 });
    b.cyl(0.36, 0.36, 0.1, CYAN, { at: [-1.1, 1.58, 0.9], emit: 0.8, n: 12 });
  },
  "wall1x1/0": (b) => wallParts(b),
  "board1x1/0": (b) => {
    b.box(0.5, 3.0, 0.5, METAL_D, { at: [0, 1.5, 0], round: 0.05 });
    for (const y of [0.9, 2.2]) b.box(0.54, 0.12, 0.54, PURPLE, { at: [0, y, 0], emit: 1.0 });
  },
  "barrier1x1/0": (b) => {
    b.sph(0.8, PINK, { at: [0, 0.3, 0], scale: [1.15, 0.6, 1.1], emit: 0.35, use: 1 });
    b.sph(0.45, PINK, { at: [0.45, 0.65, 0.2], scale: [1, 0.8, 1], emit: 0.35, use: 1 });
    b.sph(0.35, PINK, { at: [-0.4, 0.62, -0.25], emit: 0.35, use: 1 });
  },
  "flag/0": (b) => {
    b.cyl(0.18, 0.22, 0.12, IRON, { at: [0, 0.06, 0], n: 10 });
    b.cyl(0.045, 0.045, 2.4, METAL_L, { at: [0, 1.2, 0], n: 6 });
    b.box(0.72, 0.46, 0.04, PINK, { at: [0.38, 2.1, 0], emit: 0.4, use: 1 });
  },
  "lamp/0": (b) => {
    b.cyl(0.15, 0.2, 0.1, IRON, { at: [0, 0.05, 0], n: 8 });
    b.cyl(0.05, 0.05, 2.0, METAL, { at: [0, 1.0, 0], n: 6 });
    b.add(new THREE.OctahedronGeometry(0.2), CYAN, { at: [0, 2.2, 0], scale: [1, 1.5, 1], emit: 1.4, use: 1 });
  },
};

// ------------------------------------------------------------------ 아이템 · 설치물(작게 — 발밑 기준 아닌 가운데 기준, 크기 약 0.6u)
function balloonShape(b, color, at = [0, 0, 0], r = 0.24, use = 1) {
  b.sph(r, color, { at, scale: [1, 1.12, 1], emit: 0.5, use });
  b.cone(r * 0.28, r * 0.35, color, { at: [at[0], at[1] - r * 1.15, at[2]], rot: [Math.PI, 0, 0], emit: 0.5, use, n: 6 });
}
function rocketShape(b, color, len = 0.62) {
  b.cyl(0.11, 0.11, len * 0.6, 0xe8e6f5, { rot: [0, 0, Math.PI / 2], n: 10 });
  b.cone(0.11, len * 0.3, color, { at: [len * 0.45, 0, 0], rot: [0, 0, -Math.PI / 2], emit: 0.5, use: 1 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.box(0.16, 0.02, 0.12, color, { at: [-len * 0.25, Math.cos(a) * 0.12, Math.sin(a) * 0.12], rot: [a, 0, 0], emit: 0.4, use: 1 });
  }
  b.cyl(0.07, 0.04, 0.08, 0xffb347, { at: [-len * 0.34, 0, 0], rot: [0, 0, Math.PI / 2], emit: 1.4, n: 8 });
}
const bolt = () => {
  const s = new THREE.Shape();
  [[0.05, 0.32], [-0.16, -0.02], [-0.02, -0.02], [-0.08, -0.32], [0.16, 0.06], [0.02, 0.06]].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  return s;
};
const shield = () => {
  const s = new THREE.Shape();
  s.moveTo(0, 0.3);
  s.quadraticCurveTo(0.14, 0.24, 0.26, 0.24);
  s.quadraticCurveTo(0.26, -0.12, 0, -0.32);
  s.quadraticCurveTo(-0.26, -0.12, -0.26, 0.24);
  s.quadraticCurveTo(-0.14, 0.24, 0, 0.3);
  return s;
};
export const ITEMS = {
  "item/0": (b) => balloonShape(b, PINK),
  "item/1": (b) => {
    balloonShape(b, PINK, [0, 0, 0], 0.32);
    b.torus(0.33, 0.03, 0xffffff, { rot: [Math.PI / 2, 0, 0], emit: 0.8 });
  },
  "item/2": (b) => {
    balloonShape(b, PINK, [-0.17, -0.05, 0], 0.16);
    balloonShape(b, PINK, [0.17, -0.05, 0], 0.16);
    balloonShape(b, PINK, [0, 0.15, 0], 0.16);
  },
  "item/3": (b) => {
    b.sph(0.26, LIME, { scale: [1.1, 0.8, 1.1], emit: 0.5, use: 1 });
    for (const [x, z, h] of [[0.12, 0.15, 0.2], [-0.16, 0.05, 0.14], [0.02, -0.18, 0.18]]) b.sph(0.06, LIME, { at: [x, -0.18 - h * 0.5, z], scale: [1, 2, 1], emit: 0.5, use: 1, w: 6, h: 5 });
  },
  "item/4": (b) => rocketShape(b, CYAN),
  "item/5": (b) => {
    b.sph(0.26, 0x17121f, {});
    b.torus(0.265, 0.03, PINK, { rot: [Math.PI / 2, 0, 0], emit: 1.4, use: 1 });
    b.cyl(0.07, 0.08, 0.08, IRON, { at: [0, 0.28, 0], n: 8 });
    b.sph(0.05, 0xffd27a, { at: [0.08, 0.38, 0], emit: 3, w: 6, h: 4 });
  },
  "item/6": (b) => {
    rocketShape(b, 0xff8a2a);
    b.torus(0.24, 0.02, 0xff8a2a, { rot: [0, Math.PI / 2, 0], emit: 1.0, use: 1 });
  },
  "item/firework": (b) => {
    b.cyl(0.09, 0.09, 0.5, 0xffffff, { at: [0, -0.05, 0], n: 10 });
    for (const y of [-0.2, 0, 0.15]) b.cyl(0.095, 0.095, 0.05, PINK, { at: [0, y, 0], emit: 0.6, use: 1, n: 10 });
    b.add(new THREE.OctahedronGeometry(0.12), YELLOW, { at: [0, 0.3, 0], emit: 1.4 });
  },
  "item/vortex": (b) => {
    [0.26, 0.2, 0.14, 0.08].forEach((r, i) => b.torus(r, 0.03, PURPLE, { at: [0, 0.16 - i * 0.12, 0], rot: [Math.PI / 2, 0, i * 0.4], emit: 0.9, use: 1, n: 14 }));
    b.cone(0.05, 0.12, PURPLE, { at: [0, -0.32, 0], rot: [Math.PI, 0, 0], emit: 0.9, use: 1 });
  },
  "item/drill": (b) => {
    b.cone(0.18, 0.5, 0x9fb1ff, { rot: [0, 0, -Math.PI / 2], n: 10 });
    for (const x of [-0.08, 0.06]) b.torus(0.13 - x * 0.5, 0.025, CYAN, { at: [x, 0, 0], rot: [0, Math.PI / 2, 0], emit: 0.8, use: 1, n: 12 });
    b.cyl(0.14, 0.14, 0.14, METAL_D, { at: [-0.3, 0, 0], rot: [0, 0, Math.PI / 2], n: 10 });
  },
  "item/9": (b) => {
    b.box(0.42, 0.14, 0.14, LIME, { emit: 0.8, use: 1, round: 0.04 });
    b.box(0.14, 0.42, 0.14, LIME, { emit: 0.8, use: 1, round: 0.04 });
  },
  "item/10": (b) => b.extrude(bolt(), 0.1, YELLOW, { emit: 1.0, use: 1 }),
  "item/11": (b) => {
    b.extrude(shield(), 0.1, CYAN, { emit: 0.7, use: 1 });
    b.extrude(shield(), 0.02, 0xffffff, { at: [0, 0, 0.06], scale: [0.55, 0.55, 1], emit: 0.6 });
  },
  "item/wall": (b) => {
    b.box(0.5, 0.3, 0.24, 0x8a5a44, { round: 0.03 });
    b.box(0.52, 0.06, 0.26, PINK, { at: [0, 0.18, 0], emit: 0.6, use: 1 });
  },
  "item/trap": (b) => {
    b.cyl(0.26, 0.28, 0.08, LIME, { emit: 0.4, use: 1, n: 12 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.cone(0.04, 0.1, 0xeeeeff, { at: [Math.cos(a) * 0.2, 0.08, Math.sin(a) * 0.2], n: 4 });
    }
  },
  "item/smoke": (b) => {
    b.cyl(0.11, 0.11, 0.3, 0x6b6f86, { at: [0, -0.08, 0], n: 10 });
    b.cyl(0.12, 0.12, 0.06, 0x4b4f66, { at: [0, 0.09, 0], use: 1, emit: 0.4, n: 10 });
    for (const [x, y, r] of [[0.1, 0.22, 0.1], [-0.08, 0.26, 0.08], [0.02, 0.34, 0.07]]) b.sph(r, 0xb7bad0, { at: [x, y, 0], w: 8, h: 6 });
  },
  "item/rally": (b) => {
    b.cyl(0.025, 0.025, 0.62, METAL_L, { n: 6 });
    b.box(0.3, 0.2, 0.03, PINK, { at: [0.16, 0.2, 0], emit: 0.5, use: 1 });
  },
  "item/aegis": (b) => {
    b.sph(0.26, CYAN, { scale: [1, 0.75, 1], emit: 0.5, use: 1 });
    b.torus(0.27, 0.03, 0xffffff, { rot: [Math.PI / 2, 0, 0], emit: 0.9 });
  },
  "item/spray": (b) => {
    b.cyl(0.11, 0.11, 0.36, 0xe8e6f5, { n: 10 });
    b.cyl(0.115, 0.115, 0.12, LIME, { at: [0, 0.05, 0], emit: 0.6, use: 1, n: 10 });
    b.cyl(0.07, 0.07, 0.08, IRON, { at: [0, 0.22, 0], n: 8 });
    b.box(0.06, 0.04, 0.08, IRON, { at: [0.04, 0.27, 0] });
  },
  "item/range": (b) => {
    b.cyl(0.07, 0.09, 0.56, METAL_D, { rot: [0, 0, Math.PI / 2], n: 10 });
    for (const x of [-0.18, 0.12]) b.cyl(0.1, 0.1, 0.05, METAL_L, { at: [x, 0, 0], rot: [0, 0, Math.PI / 2], n: 10 });
    b.cyl(0.085, 0.085, 0.02, CYAN, { at: [0.29, 0, 0], rot: [0, 0, Math.PI / 2], emit: 1.2, use: 1, n: 10 });
    b.box(0.06, 0.12, 0.05, IRON, { at: [0, -0.1, 0] });
  },
  // 정답 폭탄(던진 팀 색 띠) · 바닥의 덫 · 꽂힌 집결 깃발
  "quiz/bomb": (b) => {
    b.sph(0.28, 0x17121f, {});
    for (const y of [0, 0.14]) b.torus(0.282 - y * 0.25, 0.03, PINK, { at: [0, y, 0], rot: [Math.PI / 2, 0, 0], emit: 1.4, use: 1 });
    b.cyl(0.07, 0.08, 0.08, IRON, { at: [0, 0.3, 0], n: 8 });
    b.sph(0.05, 0xffd27a, { at: [0.08, 0.4, 0], emit: 3, w: 6, h: 4 });
  },
  "gadget/trap": (b) => {
    b.cyl(0.62, 0.66, 0.06, LIME, { at: [0, 0.03, 0], emit: 0.35, use: 4, n: 14 });
    b.torus(0.6, 0.04, LIME, { at: [0, 0.07, 0], rot: [Math.PI / 2, 0, 0], emit: 0.8, use: 1, n: 16 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      b.cone(0.05, 0.14, 0xeeeeff, { at: [Math.cos(a) * 0.42, 0.12, Math.sin(a) * 0.42], n: 4 });
    }
  },
  "gadget/rally": (b) => {
    b.cyl(0.2, 0.24, 0.1, IRON, { at: [0, 0.05, 0], n: 10 });
    b.cyl(0.04, 0.04, 1.9, METAL_L, { at: [0, 0.95, 0], n: 6 });
    b.box(0.7, 0.44, 0.04, PINK, { at: [0.37, 1.65, 0], emit: 0.5, use: 1 });
  },
};

// ================================================================== [왕국전] 숲 · 건물 · 광산
// 원본 장애물과 같은 도구(둥근 상자 · 원통 · 구 · 다면체) · 같은 색 말투(나무 · 금속 · 바위 + 형광 발광 · 인스턴스 색)로 짓는다.
// 한 칸 = 2u. 나무는 1칸, 건물은 칸 수 × 2u(본진 4칸 = 8u). use 1 = 인스턴스 색(팀 색 · 나무의 강조 색), use 4 = 그 짙은 톤.
const LEAF = 0x3fa86a, LEAF_L = 0x6fd37f, LEAF_D = 0x2c7a55, BARK = 0x7a4f40, CREAM = 0xfff1dc;

function canopy(b, r, at, rnd, col) {
  const geo = new THREE.IcosahedronGeometry(r, b.lod ? 0 : 1); // [왕국전] LOD 는 20면
  const p = geo.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) seen.set(k, 0.86 + rnd() * 0.24);
    const f = seen.get(k);
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.9, p.getZ(i) * f);
  }
  geo.translate(...at);
  geo.computeVertexNormals();
  const g = b.add(geo, col, { flat: true });
  const c = g.attributes.aCol, base = new THREE.Color(col);
  for (let f = 0; f < c.count; f += 3) {
    const t = 0.86 + rnd() * 0.26;
    for (let v = 0; v < 3; v++) c.setXYZ(f + v, base.r * t, base.g * t, base.b * t);
  }
}
// [왕국전] 나무는 지도에 수천 그루라 삼각형을 아낀다(544 → 약 330, LOD 약 130): 줄기는 위아래 뚜껑 없이(잎 · 받침에 가려진다),
// 잉크 열매(지름 약 7px)는 구(80삼각형) 대신 작은 보석 다면체(20 · LOD 8)
function berry(b, r, at, col, o) {
  b.add(b.lod ? new THREE.OctahedronGeometry(r) : new THREE.IcosahedronGeometry(r, 0), col, { at, flat: true, ...o });
}
function treeParts(b, seed, kind) {
  const r = rng(seed);
  b.cyl(0.16, 0.24, 1.0, BARK, { at: [0, 0.5, 0], n: b.lod ? 5 : 7, open: true });
  b.cyl(0.3, 0.38, 0.14, BARK, { at: [0, 0.07, 0], n: b.lod ? 5 : 8 });
  if (kind === "pine") {
    for (const [y, rr, h] of [[1.0, 0.95, 1.0], [1.55, 0.75, 0.9], [2.05, 0.5, 0.8]]) b.cone(rr, h, y > 1.5 ? LEAF_L : LEAF, { at: [0, y, 0], n: b.lod ? 6 : 8, flat: true });
    berry(b, 0.13, [0, 2.5, 0], YELLOW, { emit: 1, use: 1 });
  } else {
    canopy(b, 0.78, [0, 1.45, 0], r, kind === "dark" ? LEAF_D : LEAF);
    canopy(b, 0.52, [0.38, 1.85, 0.22], r, LEAF_L);
    canopy(b, 0.46, [-0.42, 1.7, -0.18], r, kind === "dark" ? LEAF : LEAF_L);
    // 잉크 열매(형광 — 인스턴스 강조 색)
    for (const [x, y, z] of [[0.55, 1.3, 0.45], [-0.35, 1.15, 0.6], [0.1, 2.1, -0.35]]) berry(b, 0.12, [x, y, z], PINK, { emit: 1, use: 1 });
  }
}
Object.assign(OBSTACLES, {
  "tree1x1/0": (b) => treeParts(b, 31, "round"),
  "tree1x1/1": (b) => treeParts(b, 47, "pine"),
  "tree1x1/2": (b) => treeParts(b, 59, "dark"),
  "tree1x1/3": (b) => treeParts(b, 71, "round"),
});

// 건물 바닥판: 금속 판 + 둘레 형광 띠(팀 색)
function pad(b, w) {
  b.box(w, 0.32, w, METAL_D, { at: [0, 0.16, 0], round: 0.08 });
  b.box(w + 0.06, 0.08, w + 0.06, PINK, { at: [0, 0.3, 0], emit: 0.9, use: 1 });
  b.box(w - 0.3, 0.06, w - 0.3, METAL, { at: [0, 0.35, 0] });
}
function hip(b, w, d, h, y, col, o = {}) {
  // 네모 지붕(사각뿔)
  b.cone(Math.SQRT1_2 * Math.max(w, d), h, col, { at: [0, y + h / 2, 0], rot: [0, Math.PI / 4, 0], scale: [w / Math.max(w, d), 1, d / Math.max(w, d)], n: 4, flat: true, ...o });
}
const REALM = {
  // 잉크 본진(8u): 큰 공장 건물 + 팀 색 지붕 + 네 귀퉁이 탑 + 지붕 위 잉크 탱크
  "realm/hall": (b) => {
    pad(b, 7.6);
    b.box(5.6, 2.4, 5.6, CREAM, { at: [0, 1.55, 0], round: 0.1 });
    b.box(5.8, 0.3, 5.8, METAL, { at: [0, 2.85, 0] });
    hip(b, 5.4, 5.4, 1.7, 2.95, PINK, { use: 1 });
    for (const [x, z] of [[-2.9, -2.9], [2.9, -2.9], [-2.9, 2.9], [2.9, 2.9]]) {
      b.cyl(0.62, 0.7, 3.4, METAL, { at: [x, 2.0, z], n: 10 });
      b.cyl(0.74, 0.74, 0.14, PINK, { at: [x, 3.0, z], emit: 0.9, use: 1, n: 10 });
      b.cone(0.82, 1.0, PINK, { at: [x, 4.2, z], use: 4, n: 10 });
    }
    b.cyl(0.9, 0.9, 1.3, METAL_L, { at: [0, 4.6, 0], n: 14 });
    b.cyl(0.8, 0.8, 0.06, PINK, { at: [0, 5.28, 0], emit: 1.1, use: 1, n: 14 });
    b.box(1.6, 1.6, 0.2, DARK, { at: [0, 1.15, 2.82], round: 0.05 });
    b.box(1.9, 0.18, 0.24, PINK, { at: [0, 2.05, 2.86], emit: 0.9, use: 1 });
    for (const x of [-1.9, 1.9]) b.box(0.9, 0.7, 0.12, CYAN, { at: [x, 1.7, 2.82], emit: 0.7 });
  },
  // 잉크 서재(6u): 둥근 지붕 + 기둥 + 떠 있는 책(빛)
  "realm/library": (b) => {
    pad(b, 5.6);
    b.box(4.2, 2.0, 4.2, CREAM, { at: [0, 1.35, 0], round: 0.1 });
    b.sph(2.3, PINK, { at: [0, 2.35, 0], scale: [1, 0.72, 1], use: 1, w: 16, h: 8 });
    for (const x of [-1.4, -0.47, 0.47, 1.4]) b.cyl(0.18, 0.2, 2.0, CREAM, { at: [x, 1.35, 2.25], n: 8 });
    b.box(4.4, 0.22, 0.6, METAL, { at: [0, 2.42, 2.2] });
    b.box(0.9, 1.3, 0.12, DARK, { at: [0, 1.0, 2.12] });
    // 책: 펼친 두 쪽
    b.box(0.9, 0.06, 1.1, CREAM, { at: [-0.45, 4.45, 0], rot: [0, 0, 0.35], emit: 0.9 });
    b.box(0.9, 0.06, 1.1, CREAM, { at: [0.45, 4.45, 0], rot: [0, 0, -0.35], emit: 0.9 });
    b.box(1.9, 0.05, 1.18, PINK, { at: [0, 4.3, 0], emit: 1, use: 1 });
    b.sph(0.16, YELLOW, { at: [0, 4.95, 0], emit: 1.2, w: 8, h: 6 });
  },
  // 대장간(6u): 나무 창고 + 굴뚝(불빛) + 모루
  "realm/forge": (b) => {
    pad(b, 5.6);
    b.box(4.2, 2.0, 3.4, WOOD, { at: [0, 1.35, -0.5], round: 0.08 });
    hip(b, 4.4, 3.6, 1.0, 2.35, PINK, { use: 4 });
    b.cyl(0.42, 0.5, 2.6, METAL, { at: [1.4, 3.2, -1.2], n: 10 });
    b.cyl(0.5, 0.5, 0.2, 0xff7a00, { at: [1.4, 4.55, -1.2], emit: 1.2, n: 10 });
    b.box(1.6, 0.9, 0.12, 0xff7a00, { at: [0, 1.0, 1.22], emit: 1.2 });
    b.box(0.9, 0.5, 0.6, IRON, { at: [-1.5, 0.6, 1.8], round: 0.05 });
    b.box(1.2, 0.22, 0.7, METAL_L, { at: [-1.5, 0.95, 1.8], round: 0.04 });
    for (const x of [-0.3, 0.6]) b.box(0.12, 0.5, 0.12, PINK, { at: [x, 0.6, 2.2], emit: 0.8, use: 1 });
  },
  // 잉크 공방(6u): 작은 건물 + 큰 잉크 통(팀 색 잉크) + 병 셋
  "realm/workshop": (b) => {
    pad(b, 5.6);
    b.box(3.0, 1.9, 3.0, 0xb9a6e8, { at: [-0.9, 1.3, -0.9], round: 0.1 });
    hip(b, 3.2, 3.2, 1.0, 2.25, PINK, { use: 4 });
    b.cyl(1.2, 1.1, 1.2, WOOD, { at: [1.2, 0.95, 1.1], n: 14 });
    for (const y of [0.6, 1.25]) b.cyl(1.24, 1.24, 0.12, METAL, { at: [1.2, y, 1.1], n: 14 });
    b.cyl(1.05, 1.05, 0.06, PINK, { at: [1.2, 1.56, 1.1], emit: 1.2, use: 1, n: 14 });
    [[0x39ff88, -1.4], [0xff3b4e, -0.9], [CYAN, -0.4]].forEach(([c, x]) => {
      b.sph(0.26, c, { at: [x, 0.72, 1.6], emit: 1, w: 10, h: 8 });
      b.cyl(0.08, 0.08, 0.2, CREAM, { at: [x, 1.02, 1.6], n: 6 });
    });
  },
  // 감시탑(4u): 육각 기둥 + 망루 + 빛 구슬
  "realm/tower": (b) => {
    pad(b, 3.6);
    b.cyl(1.1, 1.3, 3.4, METAL, { at: [0, 2.0, 0], n: 6, flat: true });
    for (const y of [1.2, 2.6]) b.cyl(1.24, 1.24, 0.14, PINK, { at: [0, y, 0], emit: 0.9, use: 1, n: 6 });
    b.cyl(1.7, 1.6, 0.3, WOOD, { at: [0, 3.85, 0], n: 8 });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      b.box(0.22, 0.5, 0.22, WOOD_D, { at: [Math.cos(a) * 1.45, 4.2, Math.sin(a) * 1.45] });
    }
    b.cone(1.5, 1.1, PINK, { at: [0, 5.2, 0], use: 4, n: 8 });
    b.sph(0.4, PINK, { at: [0, 4.35, 0], emit: 1.3, use: 1, w: 12, h: 8 });
  },
  // 창고(4u): 상자 무더기 + 차양
  "realm/depot": (b) => {
    pad(b, 3.6);
    crateParts(b, 1.5, -0.5, 0.1);
    b.box(1.2, 0.8, 1.2, WOOD_M, { at: [0.9, 0.75, 0.8], round: 0.05 });
    b.box(3.0, 0.14, 1.4, PINK, { at: [0, 2.0, -0.9], rot: [0.25, 0, 0], use: 4 });
    for (const x of [-1.3, 1.3]) b.cyl(0.08, 0.08, 1.7, METAL, { at: [x, 1.15, -0.4], n: 6 });
    b.sph(0.26, 0xff2df0, { at: [1.0, 1.35, 0.8], emit: 1.1, w: 10, h: 8 });
  },
  // 잉크 대포(6u): 받침 + 기운 포신(팀 색) + 포구 빛
  "realm/cannon": (b) => {
    pad(b, 5.6);
    b.cyl(2.0, 2.2, 0.8, METAL_D, { at: [0, 0.75, 0], n: 12 });
    b.sph(1.05, IRON, { at: [0, 1.55, 0], w: 14, h: 10 });
    b.cyl(0.62, 0.72, 3.4, PINK, { at: [0, 2.55, -0.85], rot: [-0.62, 0, 0], use: 1, n: 14 });
    b.cyl(0.82, 0.82, 0.4, METAL, { at: [0, 3.85, -1.85], rot: [-0.62, 0, 0], n: 14 });
    b.cyl(0.55, 0.55, 0.08, PINK, { at: [0, 4.05, -1.98], rot: [-0.62, 0, 0], emit: 1.3, use: 1, n: 14 });
    for (const x of [-1.25, 1.25]) b.cyl(0.55, 0.55, 0.3, METAL_L, { at: [x, 1.4, 0], rot: [0, 0, Math.PI / 2], n: 12 });
  },
  // 짓는 중 비계(칸 수마다 크기를 바꿔 쓴다 — 1칸 기준)
  "realm/scaffold": (b) => {
    for (const [x, z] of [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]]) b.box(0.1, 1.8, 0.1, WOOD, { at: [x, 0.9, z] });
    for (const y of [0.6, 1.5]) {
      b.box(1.8, 0.08, 0.08, WOOD_D, { at: [0, y, -0.85] });
      b.box(1.8, 0.08, 0.08, WOOD_D, { at: [0, y, 0.85] });
      b.box(0.08, 0.08, 1.8, WOOD_D, { at: [-0.85, y, 0] });
      b.box(0.08, 0.08, 1.8, WOOD_D, { at: [0.85, y, 0] });
    }
    b.box(0.5, 0.1, 0.5, YELLOW, { at: [0, 1.9, 0], emit: 0.8, use: 3 });
  },
};
// 광산(6u): 바위 무더기 + 형광 수정(종류마다 색)
function crystal(b, x, z, h, rot, col) {
  b.cone(0.34 * h, 1.3 * h, col, { at: [x, 0.65 * h + 0.2, z], rot, n: 6, emit: 1.1, flat: true });
  b.cone(0.34 * h, 0.4 * h, col, { at: [x, 0.2, z], rot: [rot[0] + Math.PI, rot[1], rot[2]], n: 6, emit: 1.1, flat: true });
}
for (const [kind, col] of [["base", 0xff2df0], ["mid", CYAN], ["center", YELLOW]]) {
  REALM[`realm/mine/${kind}`] = (b) => {
    rockParts(b, kind.length * 7 + 3, [[-0.7, -0.5, 1.05], [0.75, 0.2, 0.95], [-0.1, 0.85, 0.8], [0.6, -0.8, 0.7]], [1.2, 1.2], 1.05, false);
    crystal(b, 0, 0, 1.5, [0.1, 0, 0.12], col);
    crystal(b, -0.9, 0.2, 1.05, [-0.25, 0, 0.3], col);
    crystal(b, 0.95, -0.25, 1.1, [0.2, 0, -0.32], col);
    crystal(b, 0.3, 1.0, 0.8, [0.35, 0, 0.1], col);
    crystal(b, -0.5, -1.0, 0.75, [-0.3, 0, -0.2], col);
  };
}
// ================================================================== [왕국전] v2 「깃발의 탑」 — 건물 넷 · 잉크 연못 펌프 · 보석 섹션 · 유닛 소품
// 같은 말투: 금속 판 받침 + 크림 · 금속 몸 + 팀 색(use 1) 형광 띠. 깃대는 따로 그려(realm/flagpole) 탑이 꺾이면 쓰러뜨린다.
const TAU = Math.PI * 2;
function gemCut(b, at, r, col, use = 1, emit = 1.1) {
  // 보석 한 알: 위 왕관(낮은 팔각 기둥) + 아래 뾰족한 몸(팔각뿔)
  b.cyl(r * 0.62, r, r * 0.42, col, { at: [at[0], at[1] + r * 0.21, at[2]], n: 8, flat: true, emit, use });
  b.cone(r, r * 1.15, col, { at: [at[0], at[1] - r * 0.575, at[2]], rot: [Math.PI, 0, 0], n: 8, flat: true, emit: emit * 0.8, use });
}
Object.assign(REALM, {
  // 깃발의 탑(8u — 둥근 받침 지름 7.6): 팔각 돌탑 두 단 · 아치 문 · 현수막 · 팀 색 창 · 성가퀴 · 네 망루 · 포탑(realmparts.js).
  // 깃대는 realm/flagpole(위 5.2u 에 세운다)
  "realm/flagtower": (b) => REALM_PARTS.flagTower(b),
  // 깃대 + 큰 팀 깃발(여러 칸으로 접힌 천 · 제비 꼬리 · 보석 무늬 · 술). 발밑이 원점(탑 위에 올려 그린다)
  "realm/flagpole": (b) => REALM_PARTS.flagpole(b),
  // 잉크 공급소(6u — 둥근 받침): 잉크 창 · 리벳 · 둥근 지붕(밸브) · 계기 · 사다리 탱크 + 앞 조작대 + 둘레 주유기 넷(realmparts.js)
  "realm/supply": (b) => REALM_PARTS.supply(b),
  // 잉크 무기 랩(6u — 둥근 받침): 실험동(팀 색 창 · 차양 · 미닫이 문) + 지붕 풍선 · 접시 안테나 + 잉크 통 · 유리 기구 작업대 · 미사일(realmparts.js)
  "realm/lab": (b) => REALM_PARTS.lab(b),
  // 몬스터 퍼실리티(6u — 둥근 받침): 널판 우리 집(맞배지붕 · 쇠 해치 · 할퀸 자국) + 잔가지 둥지와 금 간 알 + 창살 우리(realmparts.js)
  "realm/facility": (b) => REALM_PARTS.facility(b),
  // 잉크 연못의 펌프(연못 가장자리에 하나)
  "realm/pump": (b) => {
    b.box(1.0, 0.4, 1.0, METAL_D, { at: [0, 0.2, 0], round: 0.06 });
    b.cyl(0.26, 0.3, 1.5, METAL, { at: [0, 1.1, 0], n: 10 });
    b.cyl(0.32, 0.32, 0.12, PINK, { at: [0, 1.5, 0], emit: 1.1, use: 1, n: 10 });
    b.cyl(0.08, 0.08, 0.9, METAL_L, { at: [0.42, 1.95, 0], rot: [0, 0, -1.0], n: 6 });
    b.cyl(0.1, 0.12, 0.6, METAL_L, { at: [0, 1.55, 0.36], rot: [Math.PI / 2 - 0.3, 0, 0], n: 8 });
    b.sph(0.13, PINK, { at: [0, 1.38, 0.66], emit: 1.5, use: 1, w: 8, h: 6 });
  },
  // 보석 섹션 바닥 판(지름 10u): 얇은 금속 원판 + 형광 테(팀 · 상태 색)
  "realm/sitepad": (b) => {
    b.cyl(4.95, 5.05, 0.06, METAL_D, { at: [0, 0.03, 0], n: 28 });
    b.cyl(3.5, 3.5, 0.07, METAL, { at: [0, 0.035, 0], n: 28 });
    b.torus(4.8, 0.08, CYAN, { at: [0, 0.07, 0], rot: [Math.PI / 2, 0, 0], emit: 1.1, use: 1, n: 36 });
    b.torus(3.55, 0.05, CYAN, { at: [0, 0.075, 0], rot: [Math.PI / 2, 0, 0], emit: 0.7, use: 1, n: 30 });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      b.box(0.5, 0.08, 0.5, CYAN, { at: [Math.cos(a) * 4.2, 0.07, Math.sin(a) * 4.2], rot: [0, -a, 0], emit: 0.9, use: 1 });
    }
  },
  // 원석 바위(2×2칸 = 4u): 바위 덩이 + 빛나는 원석(인스턴스 색)
  "realm/gemrock": (b) => {
    rockParts(b, 37, [[-0.55, -0.35, 0.9], [0.6, 0.1, 0.8], [-0.1, 0.65, 0.7], [0.35, -0.7, 0.6]], [1, 1], 1.0, false);
    for (const [x, z, h, rx, rz] of [[0, 0, 1.3, 0.1, 0.12], [-0.75, 0.2, 0.95, -0.25, 0.3], [0.8, -0.25, 1.0, 0.2, -0.32], [0.25, 0.85, 0.75, 0.35, 0.1]]) {
      b.cone(0.3 * h, 1.2 * h, CYAN, { at: [x, 0.6 * h + 0.25, z], rot: [rx, 0, rz], n: 6, emit: 1.1, flat: true, use: 1 });
      b.cone(0.3 * h, 0.36 * h, CYAN, { at: [x, 0.25, z], rot: [rx + Math.PI, 0, rz], n: 6, emit: 1.1, flat: true, use: 1 });
    }
  },
  // 보석(가운데 기준 — 바닥에 떠 있거나 머리 위에 인다)
  "realm/gem": (b) => gemCut(b, [0, 0, 0], 0.42, CYAN),
  // 일꾼이 머리에 인 잉크 통
  "realm/can": (b) => {
    b.cyl(0.27, 0.23, 0.44, METAL_L, { at: [0, 0.22, 0], n: 10 });
    b.cyl(0.25, 0.25, 0.05, PINK, { at: [0, 0.45, 0], emit: 1.3, use: 1, n: 10 });
    b.torus(0.21, 0.025, IRON, { at: [0, 0.45, 0], arc: Math.PI, n: 8 });
  },
  // 잉크봇의 머리 안테나(팀 색 구슬)
  "realm/antenna": (b) => {
    b.cyl(0.035, 0.035, 0.55, METAL_L, { at: [0, 0.27, 0], n: 5 });
    b.sph(0.13, PINK, { at: [0, 0.6, 0], emit: 1.6, use: 1, w: 8, h: 6 });
  },
  // [왕국전 v2.1] 금광(3×3칸 = 6u): 바위 무더기에 박힌 빛나는 금덩이 + 레일 위 광차(금 가득) + 등불
  "realm/goldmine": (b) => {
    rockParts(b, 61, [[-0.75, -0.55, 1.1], [0.7, -0.35, 0.95], [-0.2, 0.55, 0.85], [0.85, 0.75, 0.6], [-1.0, 0.65, 0.55]], [1.25, 1.2], 1.0, true);
    for (const [x, y, z, r] of [[-0.3, 1.15, -0.1, 0.32], [0.55, 0.95, -0.2, 0.26], [-0.9, 0.7, 0.4, 0.22], [0.2, 0.9, 0.75, 0.24], [-0.6, 1.35, -0.7, 0.2], [0.9, 0.55, 0.55, 0.18]]) {
      b.add(new THREE.DodecahedronGeometry(r), YELLOW, { at: [x, y, z], emit: 1.0, flat: true });
    }
    // 레일 + 광차(앞쪽)
    for (const x of [-0.5, 0.5]) b.box(0.08, 0.06, 2.4, METAL_L, { at: [x + 1.2, 0.05, 1.6], rot: [0, 0.35, 0] });
    b.box(1.1, 0.55, 0.8, WOOD, { at: [1.35, 0.5, 1.9], rot: [0, 0.35, 0], round: 0.06 });
    b.box(1.16, 0.1, 0.86, METAL, { at: [1.35, 0.8, 1.9], rot: [0, 0.35, 0] });
    for (const [x, z] of [[1.0, 1.6], [1.75, 1.85], [0.95, 2.05], [1.7, 2.3]]) b.cyl(0.14, 0.14, 0.08, IRON, { at: [x, 0.16, z], rot: [0, 0.35, Math.PI / 2], n: 8 });
    for (const [x, z] of [[1.2, 1.8], [1.5, 2.0], [1.3, 2.1]]) b.add(new THREE.DodecahedronGeometry(0.2), YELLOW, { at: [x, 0.92, z], emit: 1.2, flat: true });
    // 등불 기둥(팀 색)
    b.cyl(0.06, 0.08, 1.8, WOOD_D, { at: [-1.7, 0.9, 1.5], n: 6 });
    b.sph(0.18, PINK, { at: [-1.7, 1.9, 1.5], emit: 1.5, use: 1, w: 8, h: 6 });
  },
  // [왕국전 v2.1] 코어 금광(2×2칸 = 4u): 작은 수정 동굴 바위 + 입구 안에서 빛나는 몬스터 코어(보라 · 시안)
  "realm/coremine": (b) => {
    rockParts(b, 73, [[-0.6, -0.4, 0.95], [0.6, -0.45, 0.9], [0.0, -0.85, 0.75], [-0.85, 0.35, 0.6], [0.85, 0.35, 0.6]], [1, 1], 1.0, true);
    b.box(1.0, 0.9, 0.5, DARK, { at: [0, 0.5, 0.3], round: 0.2 });
    for (const [x, y, z, r, c] of [[0, 0.55, 0.55, 0.26, PURPLE], [-0.35, 0.3, 0.7, 0.16, CYAN], [0.38, 0.32, 0.68, 0.15, PURPLE]]) {
      b.add(new THREE.IcosahedronGeometry(r, 0), c, { at: [x, y, z], emit: 1.6, flat: true });
    }
    for (const [x, z, h, rx, rz, c] of [[-0.7, -0.3, 0.9, -0.2, 0.35, PURPLE], [0.75, -0.2, 0.8, 0.15, -0.35, CYAN], [0.1, -0.7, 1.05, 0.3, 0.05, PURPLE]]) {
      b.cone(0.22 * h, 1.1 * h, c, { at: [x, 0.55 * h + 0.55, z], rot: [rx, 0, rz], n: 6, emit: 1.2, flat: true });
    }
    b.torus(1.25, 0.05, PURPLE, { at: [0, 0.06, 0.1], rot: [Math.PI / 2, 0, 0], emit: 1.0, use: 1, n: 24 });
  },
  // [왕국전 v2.1] 일꾼이 인 금 자루(금덩이가 삐져나온다)
  "realm/sack": (b) => {
    b.sph(0.27, 0xc9a26a, { at: [0, 0.24, 0], scale: [1, 0.9, 1], w: 10, h: 8 });
    b.cyl(0.1, 0.14, 0.14, 0xa8814f, { at: [0, 0.5, 0], n: 8 });
    b.add(new THREE.DodecahedronGeometry(0.11), YELLOW, { at: [0.08, 0.58, 0.04], emit: 1.3, flat: true });
    b.add(new THREE.DodecahedronGeometry(0.08), YELLOW, { at: [-0.07, 0.55, -0.03], emit: 1.3, flat: true });
  },
  // [왕국전 v2.1] 일꾼이 든 몬스터 코어(빛나는 결정)
  "realm/core": (b) => {
    b.add(new THREE.IcosahedronGeometry(0.22, 0), PURPLE, { at: [0, 0.24, 0], emit: 1.7, flat: true });
    b.torus(0.28, 0.025, CYAN, { at: [0, 0.24, 0], rot: [Math.PI / 2, 0, 0.4], emit: 1.5, n: 14 });
  },
  // [왕국전] 일꾼 연장(원점 = 손잡이 쥔 곳, 자루는 +x 로 뻗는다 — 화면이 rz 로 휘두르고 rot 로 바라보는 쪽을 맞춘다)
  // 곡괭이: 나무 자루 + 휜 쇠 머리(양쪽 뾰족)
  "realm/pickaxe": (b) => {
    b.cyl(0.035, 0.04, 0.78, WOOD, { at: [0.39, 0, 0], rot: [0, 0, Math.PI / 2], n: 6 });
    b.box(0.1, 0.12, 0.1, IRON, { at: [0.76, 0, 0] });
    b.cone(0.06, 0.34, METAL_L, { at: [0.76, 0.2, 0], rot: [0, 0, -0.25], n: 5 });
    b.cone(0.06, 0.34, METAL_L, { at: [0.76, -0.2, 0], rot: [Math.PI, 0, 0.25], n: 5 });
  },
  // [왕국전] 들통: 자루 끝에 매달린 통(잉크가 찰랑 — 잉크 분홍)
  "realm/bucket": (b) => {
    b.cyl(0.035, 0.035, 0.3, WOOD, { at: [0.15, 0, 0], rot: [0, 0, Math.PI / 2], n: 5 });
    b.torus(0.14, 0.015, IRON, { at: [0.3, -0.12, 0], arc: Math.PI, n: 8 });
    b.cyl(0.17, 0.13, 0.26, METAL_L, { at: [0.3, -0.3, 0], n: 10 });
    b.cyl(0.155, 0.155, 0.03, PINK, { at: [0.3, -0.18, 0], emit: 1.3, n: 10 });
  },
  // [왕국전] 망치: 나무 자루 + 네모 쇠 머리
  "realm/hammer": (b) => {
    b.cyl(0.03, 0.035, 0.6, WOOD, { at: [0.3, 0, 0], rot: [0, 0, Math.PI / 2], n: 6 });
    b.box(0.14, 0.26, 0.14, METAL, { at: [0.6, 0, 0], round: 0.03 });
  },
  // 고장 · 꺾임 잔해(건물 둘레에 흩어 그린다)
  "realm/rubble": (b) => {
    rockParts(b, 53, [[-0.4, 0.1, 0.42], [0.35, -0.2, 0.34], [0.1, 0.4, 0.28]], [1, 1], 1, false);
    b.box(1.2, 0.1, 0.22, WOOD_D, { at: [0.1, 0.3, -0.1], rot: [0.2, 0.5, 0.15] });
    b.box(0.9, 0.08, 0.18, METAL_L, { at: [-0.2, 0.22, 0.3], rot: [-0.1, -0.7, 0.1] });
  },
});
Object.assign(ITEMS, REALM);

/** [왕국전] 멀리 볼 때 가벼운 변형("이름@1")을 따로 두는 모델(나무 · 건물 · 광산 — 화면에 많거나 무거운 것) */
export const LOD_MODELS = new Set([
  "tree1x1/0", "tree1x1/1", "tree1x1/2", "tree1x1/3",
  "realm/flagtower", "realm/flagpole", "realm/supply", "realm/lab", "realm/facility", "realm/goldmine", "realm/coremine", "realm/sitepad",
]);
/** 정점 AO 를 굽지 않는 것(가운데가 원점인 작은 소품 · 들고 다니는 것) */
const NO_AO = /^(item\/|quiz\/|realm\/(gem|can|antenna|sack|core|pickaxe|bucket|hammer)$)/;

/**
 * 모델 이름 → 지오메트리(detail 1 · 화질 저 0.6). o = { names(이것만 — 없으면 모두), lod(가벼운 변형 "이름@1"도 — LOD_MODELS 만), ao(정점 AO, 기본 켬) }
 */
export function buildModels(detail = 1, o = {}) {
  const out = new Map();
  const want = o.names ? new Set(o.names) : null;
  const ao = o.ao !== false;
  for (const [name, fn] of [...Object.entries(OBSTACLES), ...Object.entries(ITEMS)]) {
    if (want && !want.has(name)) continue;
    const opt = ao && !NO_AO.test(name) ? { ground: true } : null;
    // 화질 저(detail < 0.85)는 나무 · 건물도 처음부터 가벼운 모양(다면체 잎 20면)
    const b = builder(detail, detail < 0.85 && LOD_MODELS.has(name));
    fn(b);
    out.set(name, b.done(opt));
    if (o.lod && LOD_MODELS.has(name)) {
      const bl = builder(Math.min(detail, 0.6), true);
      fn(bl);
      out.set(`${name}@1`, bl.done(opt));
    }
  }
  return out;
}

/** 이 이름이 정적 장애물(칸 묶음)인가 — props3d.js 가 정적 묶음 · 동적 묶음을 나눈다 */
export const isObstacle = (name) => Object.prototype.hasOwnProperty.call(OBSTACLES, name.replace(/@1$/, ""));

/** 묶음 종류 · 모양별 변형 수(props3d.js 가 칸 해시로 고른다) */
export function variantsOf(key) {
  let n = 0;
  while (OBSTACLES[`${key}/${n}`]) n++;
  return n;
}
