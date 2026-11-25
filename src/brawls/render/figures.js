// 3D 캐릭터 묶음(docs/DESIGN.md §3.9): ink-brawl 의 장난감 인형(큰 원통형 머리 · 달걀 몸통 · 벙어리장갑 손 · 운동화, 정면 +X)을 그대로 옮기고,
// 캐릭터 8종(charset.js)의 머리 모양 · 장식 · 치마를 같은 묶음에 넣어 모든 캐릭터를 한꺼번에 그린다.
//
//   - 부위(머리 · 몸통 · 팔 둘 · 다리 둘 · 치켜든 풍선 + 부품 칸 7개)를 지오메트리 한 장으로 합치고 정점마다 부위 번호를 단다.
//     부위의 월드 행렬(3×4)은 캐릭터마다 자세 텍스처(RGBA32F, 가로 = 부위 × 3, 세로 = 캐릭터)의 한 줄에 — characters.js 가 원본의
//     Object3D 계층(root → lean → yaw → rig → 부위)을 그대로 움직여 matrixWorld 를 써 넣는다. 그 종류가 쓰지 않는 부품 칸은 행렬 0(크기 0 으로 접힘).
//   - 부품 칸: 7 머리 껍질(한 장 — 앞 · 옆 · 뒤 끝 높이 · 앞머리 가닥 · 삐죽 · 정수리 볼록을 종류마다 셰이더가 만든다: 짧은 머리 · 삐죽 머리 · 캡 · 비니 ·
//     양 갈래 · 포니테일 · 단발 · 긴 머리) · 8 · 9 꼬리(물방울 — 양 갈래 · 포니테일 · 모자챙 · 리본 날개) · 10 띠(고리 — 헤드폰 · 고글 끈 · 머리띠,
//     반각만큼만 남기고 나머지는 끝으로 접는다) · 11 · 12 작은 공(헤드폰 귀 · 고글 알 · 방울 · 머리끈 · 단추 · 매듭) · 13 치마(원뿔대).
//   - 겉모습: 원본 스킨 아틀라스(skins.js)를 (색, 무늬, 종류)마다 무늬 시트 한 장의 칸에 줄여 넣고, 인스턴스 속성으로 칸을 고른다.
//     경기에 실제로 쓰이는 조합만 그린다(칸이 모자라면 가장 오래 안 쓴 칸을 다시 쓴다).
//   - 눈: 머리 앞면의 둥근 네모 창(짙은 테 · 살색 바탕)을 셰이더가 그리고, 그 안의 눈은 눈 아틀라스(eyes.js — 종류 × 표정)의 칸. 깜빡임 · 맞음 · KO 는 칸만 바꾼다.
//   - 그리기 3번: 본 그림(툰 3단계 — 그늘은 보랏빛, 빛은 맵 그림과 같은 왼쪽 위 + 원본의 형광 발광) · 외곽선(뒤집어 부풀린 껍질 — 조준 점멸이면 흰색,
//     부스터면 운동화가 노랗게) · 가려진 부분의 팀 색 실루엣(스텐실). + 부스터 전기 꼬리(있을 때만 1번).
//   - 섬광 점광(glsl.js)과 전장의 안개를 곱한다.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PROJ } from "./camera.js";
import { GLSL_LIGHTS, GLSL_FOG } from "./glsl.js";
import { ATLAS, drawAtlas } from "./skins.js";
import { CHARACTERS, MATS, CHAR_COUNT, GOGGLE_SHAPES } from "./charset.js";
import { drawEyeAtlas } from "./eyes.js";
import { SHADOW_LAYER } from "./props3d.js";
import { STYLE } from "./style.js";

export const MAX_FIGURES = 96;
/**
 * 0 머리 · 1 몸통 · 2 팔(+) · 3 팔(−) · 4 다리(+) · 5 다리(−) · 6 치켜든 풍선 · 7 머리 껍질 · 8 꼬리 A · 9 꼬리 B · 10 띠 · 11~14 작은 공 A~D ·
 * 15 고글 · 16 잉크 탱크 백팩 · 17 호스(탱크 → 손목 — 셰이더가 두 부위의 행렬로 잇는다)
 */
export const PARTS = 18;
export const HEAD_Y = 0.98;
export const HEAD_H = 0.75;
export const HEAD_R = 0.5;
export const TOP_Y = HEAD_Y + HEAD_H;
/** 눈 자리(머리 좌표 — 고글이 덮는다): 가운데 높이 · 반높이 · 반각(라디안) · 모서리 반지름 · 테 두께. 눈 아틀라스는 이 자리에 맞춰 렌즈 위에 비친다 */
export const WINDOW = Object.freeze({ cy: 0.39, hh: 0.15, ha: 0.7, r: 0.085, border: 0.028 });

// ------------------------------------------------------------------ 지오메트리(원본 그대로)
function lathe(profile, segments = 18) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments, -Math.PI / 2, Math.PI * 2);
}
function toAtlas(geo, rect, fn) {
  const uv = geo.attributes.uv;
  const pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    let u = uv.getX(i);
    let v = uv.getY(i);
    if (fn) [u, v] = fn(pos.getX(i), pos.getY(i), pos.getZ(i), u, v);
    uv.setXY(i, rect.u + u * rect.w, rect.v + v * rect.h);
  }
  return geo;
}
function merged(list) {
  return mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
}

/**
 * 원본 buildParts: { head, body, leg, arm } (UV 는 스킨 아틀라스 좌표). detail = 화질 저면 분할을 줄인다.
 * coarse = 가려진 부분 실루엣용(분할 하한을 더 낮춘다 — 단색 반투명이라 거칠어도 티가 안 난다)
 */
export function buildParts(detail = 1, coarse = false) {
  const k = (n, min) => Math.max(coarse ? Math.max(3, Math.round(min * 0.6)) : min, Math.round(n * detail));
  const side = toAtlas(
    lathe([[0.4, 0.0], [0.465, 0.03], [0.5, 0.1], [0.5, 0.62], [0.465, 0.7], [0.4, 0.735]], k(16, 10)),
    ATLAS.headSide,
    (x, y, z, u) => [u, y / 0.735]
  );
  const planar = (x, y, z) => [0.5 + z / (2 * HEAD_R), 0.5 + x / (2 * HEAD_R)];
  const top = toAtlas(lathe([[0.4, 0.735], [0.3, 0.745], [0.15, 0.75], [0.0, 0.75]], k(16, 10)), ATLAS.headTop, planar);
  const bottom = toAtlas(lathe([[0.0, 0.0], [0.4, 0.0]], k(16, 10)), ATLAS.hand, () => [0.5, 0.5]);
  const head = merged([side, top, bottom]);

  const body = toAtlas(
    lathe([[0.0, 0.0], [0.19, 0.015], [0.29, 0.13], [0.33, 0.3], [0.3, 0.46], [0.22, 0.56], [0.12, 0.6], [0.0, 0.6]], k(14, 8)),
    ATLAS.body
  );
  body.translate(0, 0.4, 0);

  const legCyl = toAtlas(new THREE.CylinderGeometry(0.115, 0.12, 0.34, k(10, 6), 1, true), ATLAS.leg);
  legCyl.translate(0, -0.17, 0);
  const shoe = new THREE.SphereGeometry(1, k(8, 6), k(5, 4));
  {
    const p = shoe.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setY(i, p.getY(i) * 0.35);
  }
  shoe.scale(0.21, 0.15, 0.15);
  toAtlas(shoe, ATLAS.shoe, (x, y, z) => [0.5 + z / 0.3, 0.5 + x / 0.42]);
  shoe.translate(0.07, -0.44, 0);
  const leg = merged([legCyl, shoe]);

  const armCyl = toAtlas(new THREE.CylinderGeometry(0.085, 0.1, 0.34, k(8, 6), 1, true), ATLAS.arm);
  armCyl.translate(0, -0.17, 0);
  const shoulder = toAtlas(new THREE.SphereGeometry(0.088, k(6, 5), k(4, 3)), ATLAS.arm);
  const lobe = (r, sx, sy, sz, x, y, z) => {
    const g = toAtlas(new THREE.SphereGeometry(r, k(6, 5), k(4, 3)), ATLAS.hand);
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    return g;
  };
  const palm = lobe(0.125, 1, 1.05, 0.85, 0, -0.39, 0);
  const finger = lobe(0.1, 0.85, 1.25, 0.8, -0.035, -0.5, 0);
  const thumb = lobe(0.07, 0.8, 1.15, 0.8, 0.105, -0.46, 0);
  const arm = merged([armCyl, shoulder, palm, finger, thumb]);
  return { head, body, leg, arm };
}

/** 원본 풍선 모양(아래쪽이 살짝 뾰족한 물방울) */
export function balloonGeometry(w = 14, h = 10) {
  const g = new THREE.SphereGeometry(1, w, h);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0) {
      const k = 1 + y * 0.28;
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
      pos.setY(i, y * 1.16);
    }
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ 부품 칸 지오메트리(캐릭터 8종 — 모양은 셰이더가 종류마다 만든다)
/**
 * 회전체 격자(삼각형 낱개): rings = [{ r, y, s }](위 → 아래), 바깥을 보게 감는다. aAux = (θ, s, 짝홀, 셋째마다 1).
 * θ 는 정면(+X)에서 +Z 쪽으로, 정점이 정면 좌우로 대칭이 되게 반 칸 어긋난다.
 */
function revolve(rings, segs, center = [0, 0, 0]) {
  const pos = [], nrm = [], aux = [];
  const vert = (ring, i) => {
    const th = -Math.PI + ((i + 0.5) * Math.PI * 2) / segs;
    const x = Math.cos(th) * ring.r, z = Math.sin(th) * ring.r;
    return { p: [x, ring.y, z], n: [Math.cos(th), 0.3, Math.sin(th)], a: [th, ring.s, i % 2, i % 3 === 0 ? 1 : 0] };
  };
  const push = (v) => {
    pos.push(...v.p);
    nrm.push(...v.n);
    aux.push(...v.a);
  };
  const tri = (a, b, c) => {
    // 바깥(축에서 멀어지는 쪽)을 보게
    const ux = b.p[0] - a.p[0], uy = b.p[1] - a.p[1], uz = b.p[2] - a.p[2];
    const vx = c.p[0] - a.p[0], vy = c.p[1] - a.p[1], vz = c.p[2] - a.p[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a.p[0] + b.p[0] + c.p[0]) / 3 - center[0], my = (a.p[1] + b.p[1] + c.p[1]) / 3 - center[1], mz = (a.p[2] + b.p[2] + c.p[2]) / 3 - center[2];
    if (nx * mx + ny * my + nz * mz < 0) [b, c] = [c, b];
    push(a);
    push(b);
    push(c);
  };
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < segs; i++) {
      const a = vert(rings[j], i), b = vert(rings[j], i + 1), c = vert(rings[j + 1], i), d = vert(rings[j + 1], i + 1);
      if (rings[j].r > 1e-6) tri(a, c, b);
      if (rings[j + 1].r > 1e-6) tri(b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setAttribute("aAux", new THREE.Float32BufferAttribute(aux, 4));
  return g;
}

/** 머리 껍질 고리의 s(0 정수리 → 0.55 모서리 → 1 아래 끝) — 셰이더의 hairShell 과 같은 값 */
export const HAIR_RINGS = [0, 0.2, 0.4, 0.55, 0.7, 0.85, 1];

/**
 * 부품 칸 지오메트리. o = { hair(둘레 칸 수), tail, band, knob: [w, h], skirt } — 0 이면 그 칸을 넣지 않는다(외곽선 · 실루엣을 가볍게).
 * 머리 껍질 · 띠 · 치마는 셰이더가 정점을 다시 놓는다(여기 자리는 대략 — 경계 상자 · 법선의 출발점).
 */
export function buildSlots(o) {
  const out = {};
  if (o.hair) out.hair = revolve(HAIR_RINGS.map((s) => (s <= 0.55 ? { r: (s / 0.55) * 0.5, y: 0.8, s } : { r: 0.54, y: 0.69 - (s - 0.55), s })), o.hair, [0, 0.4, 0]);
  if (o.tail) {
    // 꼬리(물방울): 뿌리가 원점, −Y 로 늘어진다
    const g = lathe([[0, -0.47], [0.07, -0.41], [0.12, -0.29], [0.13, -0.15], [0.085, -0.035], [0, 0]], o.tail);
    out.tail = g.toNonIndexed();
  }
  if (o.band) {
    // 띠: 반지름 1 고리(XZ 평면), 단면은 납작한 네모(지름 쪽 ±0.06, 높이 ±0.1) — 셰이더가 반각 밖을 끝으로 접는다
    const pos = [], nrm = [], aux = [];
    const corner = [[0.06, 0.1], [0.06, -0.1], [-0.06, -0.1], [-0.06, 0.1]];
    const P = (i, k) => {
      const th = -Math.PI + (i * Math.PI * 2) / o.band;
      const [dr, dy] = corner[k % 4];
      const c = Math.cos(th), s = Math.sin(th);
      const nl = Math.hypot(dr, dy);
      return { p: [c * (1 + dr), dy, s * (1 + dr)], n: [(c * dr) / nl, dy / nl, (s * dr) / nl], th };
    };
    for (let i = 0; i < o.band; i++)
      for (let k = 0; k < 4; k++) {
        const a = P(i, k), b = P(i, k + 1), c = P(i + 1, k), d = P(i + 1, k + 1);
        // 단면 가운데에서 바깥으로 감기(네 면 모두)
        for (const t of [[a, b, c], [b, d, c]]) {
          const [p, q, r] = t;
          const ux = q.p[0] - p.p[0], uy = q.p[1] - p.p[1], uz = q.p[2] - p.p[2];
          const vx = r.p[0] - p.p[0], vy = r.p[1] - p.p[1], vz = r.p[2] - p.p[2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const mid = [(p.n[0] + q.n[0] + r.n[0]), (p.n[1] + q.n[1] + r.n[1]), (p.n[2] + q.n[2] + r.n[2])];
          const list = nx * mid[0] + ny * mid[1] + nz * mid[2] < 0 ? [p, r, q] : [p, q, r];
          for (const v of list) {
            pos.push(...v.p);
            nrm.push(...v.n);
            aux.push(v.th, 0, 0, 0);
          }
        }
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    g.setAttribute("aAux", new THREE.Float32BufferAttribute(aux, 4));
    out.band = g;
  }
  if (o.knob) out.knob = new THREE.SphereGeometry(1, o.knob[0], o.knob[1]).toNonIndexed();
  if (o.goggles) out.goggles = goggleGeometry(o.goggles);
  if (o.tank) {
    // 잉크 탱크: 세운 알약(반지름 0.17, 높이 ±0.26) — 가운데 띠가 투명 창
    out.tank = lathe([[0, -0.26], [0.15, -0.23], [0.17, -0.16], [0.17, 0.16], [0.15, 0.23], [0, 0.26]], o.tank).toNonIndexed();
  }
  if (o.hose) out.hose = hoseGeometry(o.hose[0], o.hose[1]);
  return out;
}

/** 삼각형 낱개를 바깥(기준점에서 멀어지는 쪽)을 보게 감아 쌓는다 */
function triList(center) {
  const pos = [], nrm = [], aux = [];
  return {
    tri(a, b, c, ref = center) {
      const ux = b.p[0] - a.p[0], uy = b.p[1] - a.p[1], uz = b.p[2] - a.p[2];
      const vx = c.p[0] - a.p[0], vy = c.p[1] - a.p[1], vz = c.p[2] - a.p[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const mx = (a.p[0] + b.p[0] + c.p[0]) / 3 - ref[0], my = (a.p[1] + b.p[1] + c.p[1]) / 3 - ref[1], mz = (a.p[2] + b.p[2] + c.p[2]) / 3 - ref[2];
      if (nx * mx + ny * my + nz * mz < 0) [b, c] = [c, b];
      for (const v of [a, b, c]) {
        pos.push(...v.p);
        nrm.push(...v.n);
        aux.push(...v.a);
      }
    },
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
      g.setAttribute("aAux", new THREE.Float32BufferAttribute(aux, 4));
      return g;
    },
  };
}

/**
 * 고글(머리 앞면을 감싸는 휜 판 — 테 두께가 실루엣으로 보이게): 단면 고리(안쪽 아래 → 바깥 아래 → 바깥 가운데 → 바깥 위 → 안쪽 위) × 가로 칸.
 * aAux = (u −1..1 가로, 단면 점 번호 0..4, 면 0 아랫면 · 1 앞면 · 2 윗면, 0). 모양(폭 · 높이 · 두께)은 셰이더가 종류마다 정한다
 */
function goggleGeometry(segs) {
  const T = triList([0, 0.39, 0]);
  const P = (i, k, face) => {
    const u = -1 + (2 * i) / segs;
    const th = u * 0.75;
    const r = k === 0 || k === 4 ? 0.47 : 0.56;
    const y = 0.39 + (k <= 1 ? -1 : k === 2 ? 0 : 1) * 0.15;
    return { p: [Math.cos(th) * r, y, Math.sin(th) * r], n: [Math.cos(th), 0, Math.sin(th)], a: [u, k, face, 0] };
  };
  for (let i = 0; i < segs; i++)
    for (let k = 0; k < 4; k++) {
      const face = k === 0 ? 0 : k === 3 ? 2 : 1;
      const a = P(i, k, face), b = P(i + 1, k, face), c = P(i, k + 1, face), d = P(i + 1, k + 1, face);
      T.tri(a, b, c);
      T.tri(b, d, c);
    }
  return T.geometry();
}

/** 호스(관): 길이 방향 n 고리 × 둘레 m — 자리는 셰이더가 탱크 · 팔의 행렬로 잇는다. aAux = (t 0..1, 둘레각, 0, 0) */
function hoseGeometry(n, m) {
  const T = triList([0, 0, 0]);
  const P = (i, j) => {
    const t = i / (n - 1);
    const ph = (j / m) * Math.PI * 2;
    // 셰이더와 같은 틀(진행 방향 +Z, N1 = −X, N2 = +Y)
    const nx = -Math.cos(ph), ny = Math.sin(ph);
    return { p: [nx * 0.03, ny * 0.03, t], n: [nx, ny, 0], a: [t, ph, 0, 0] };
  };
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < m; j++) {
      const a = P(i, j), b = P(i, j + 1), c = P(i + 1, j), d = P(i + 1, j + 1);
      T.tri(a, b, c, [0, 0, (i + 0.5) / (n - 1)]);
      T.tri(b, d, c, [0, 0, (i + 0.5) / (n - 1)]);
    }
  return T.geometry();
}

/** 패스(본 그림 · 외곽선 · 실루엣)와 화질에 따른 지오메트리 설정 */
export function geometrySpec(pass, low) {
  // 실루엣은 몸 · 탱크만, 외곽선은 호스를 뺀 부품(화질 저는 작은 공 · 띠도 뺀다), 화질 저는 분할을 더 줄인다
  if (pass === "xray") return { detail: low ? 0.27 : 0.45, coarse: true, slots: { tank: low ? 4 : 5 } };
  if (pass === "line") return low
    ? { detail: 0.42, coarse: true, slots: { hair: 12, tail: 5, goggles: 5, tank: 6 } }
    : { detail: 0.6, coarse: false, slots: { hair: 18, tail: 5, band: 6, knob: [6, 3], goggles: 8, tank: 7 } };
  return low
    ? { detail: 0.6, coarse: false, slots: { hair: 12, tail: 5, band: 8, knob: [5, 3], goggles: 6, tank: 6, hose: [5, 4] } }
    : { detail: 1, coarse: false, slots: { hair: 18, tail: 6, band: 10, knob: [7, 4], goggles: 10, tank: 8, hose: [7, 5] } };
}

/** 부위를 한 장으로: position · normal · uv · aPart(0..17) · aAux */
export function figureGeometry(spec) {
  const { detail, coarse, slots } = spec;
  const p = buildParts(detail, coarse);
  const hd = coarse ? Math.max(5, Math.round(8 * detail)) : Math.max(6, Math.round(8 * detail));
  const held = balloonGeometry(hd, Math.max(coarse ? 4 : 5, Math.round(6 * detail)));
  const s = buildSlots(slots);
  const list = [
    [p.head, 0], [p.body, 1], [p.arm, 2], [p.arm, 3], [p.leg, 4], [p.leg, 5], [held, 6],
    [s.hair, 7], [s.tail, 8], [s.tail, 9], [s.band, 10], [s.knob, 11], [s.knob, 12], [s.knob, 13], [s.knob, 14],
    [s.goggles, 15], [s.tank, 16], [s.hose, 17],
  ]
    .filter(([g]) => g)
    .map(([g, part]) => {
      const n = g.index ? g.toNonIndexed() : g.clone();
      if (!n.getAttribute("uv")) n.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
      for (const k of Object.keys(n.attributes)) if (!["position", "normal", "uv", "aAux"].includes(k)) n.deleteAttribute(k);
      if (!n.getAttribute("aAux")) n.setAttribute("aAux", new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 4), 4));
      n.setAttribute("aPart", new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count).fill(part), 1));
      return n;
    });
  return mergeGeometries(list);
}
/** 한 명의 삼각형 수(본 그림 · 외곽선 · 실루엣) — 시험 · 통계 */
export function trianglesPerFigure(low = false) {
  const t = (pass) => {
    const g = figureGeometry(geometrySpec(pass, low));
    return g.attributes.position.count / 3;
  };
  return { main: t("main"), line: t("line"), xray: t("xray") };
}

const v3s = (a) => `vec3(${a.map((x) => x.toFixed(5)).join(", ")})`;
// 빛: 맵 그림과 같은 왼쪽 위(+ 카메라 쪽)
const LDIR = (() => {
  const r = PROJ.right, u = PROJ.up, v = PROJ.view;
  const l = [0, 1, 2].map((i) => -0.6 * r[i] + 0.7 * u[i] + 0.4 * v[i]);
  const n = Math.hypot(...l);
  return l.map((x) => x / n);
})();

const C = STYLE.character;
const NC = CHAR_COUNT;
// 그림자 패스 표시(glsl.js 의 빛 조각이 이미 선언했으면 그대로 쓴다)
const SHADOW_DECL = GLSL_LIGHTS.includes("uShadowPass") ? "" : "uniform float uShadowPass;";
const W = WINDOW;
const f = (x) => Number(x).toFixed(4);

const VERT = /* glsl */ `
#define PI 3.14159265
in float aPart;
in vec4 aAux;    // 부품 칸: 머리 껍질(θ, 고리 s, 짝홀, 셋째) · 띠(φ) · 고글(u, 단면 점, 면) · 호스(t, 둘레각)
in vec4 iCell;   // 무늬 시트의 칸: x, y, w, h(텍스처 uv — 위에서 아래)
in vec4 iCol;    // 팀 색(선형) · 번쩍임
in vec4 iFx;     // 조준 점멸(0..1) · 부스터(0/1) · 가려진 부분 실루엣 세기 · 무적 깜빡임(0..1)
in vec4 iChar;   // 캐릭터 종류 · 눈 표정 칸 · 탱크 잉크 출렁임 · 0
uniform sampler2D uPose;
uniform float uMode;     // 0 본 그림 · 1 외곽선 · 2 실루엣
uniform float uThick;
uniform vec4 uHairA[${NC}]; // 앞 · 옆 · 뒤 아래 끝 높이, 앞머리 가닥 깊이
uniform vec4 uHairB[${NC}]; // 두께, 정수리 볼록, 삐죽, 벌어짐
uniform vec4 uSlot[${NC}];  // 띠 반각, 고글 테 재질, 단 재질, 모자 재질
uniform vec4 uHairC[${NC}]; // 모자 선(고리 s), 단 시작 · 끝(고리 s), 단 부풀림
uniform vec4 uGog[${NC}];   // 고글 반각, 반높이, 두께, 내림
out vec2 vUv;
out vec3 vN;
out vec3 vW;
out vec3 vL;
out vec4 vAux;
flat out float vPart;
flat out vec4 vCol;
flat out vec4 vFx;
flat out vec2 vFog;
flat out vec4 vChr;
flat out vec4 vCell;
out float vShoe;
${GLSL_FOG}
void hairShell(int c, vec4 aux, out vec3 P, out vec3 N) {
  vec4 A = uHairA[c];
  vec4 B = uHairB[c];
  float th = aux.x;
  float s = aux.y;
  float a = min(1.0, abs(th) / PI);
  float rim = mix(A.x, A.y, smoothstep(0.25, 0.37, a));
  rim = mix(rim, A.z, smoothstep(0.55, 0.92, a));
  float off = B.x;
  float r, y, nr, ny;
  if (s < 0.551) {
    float k = s / 0.55;
    r = k * (0.47 + off * 0.8);
    y = 0.75 + off + B.y * (1.0 - k * k) - 0.06 * k * k * k * k;
    float sp = B.z * aux.w * smoothstep(0.2, 1.0, k);
    y += sp * 0.75 + (s < 0.01 ? B.z * 0.32 : 0.0);
    r += sp * 0.32;
    nr = k * 0.95;
    ny = 1.0 - k * 0.5 + B.y * 1.5;
  } else {
    float t = (s - 0.55) / 0.45;
    y = mix(0.69 + off * 0.5, rim, t);
    if (s > 0.99) y -= A.w * aux.z;
    r = 0.5 + off + B.w * max(0.0, 0.1 - y);
    vec4 H = uHairC[c];
    if (s >= H.y && s <= H.z) r += H.w; // 비니의 접힌 단 · 캡 테두리
    nr = 1.0;
    ny = 0.12 - B.w * 0.35;
  }
  P = vec3(cos(th) * r, y, sin(th) * r);
  N = normalize(vec3(cos(th) * nr, ny, sin(th) * nr));
}
// 고글: 머리 앞면을 감싸는 휜 판(앞면 · 윗면 · 아랫면 — 테 두께가 실루엣으로 보인다)
void goggleShape(int c, vec4 aux, out vec3 P, out vec3 N) {
  vec4 G = uGog[c];
  float u = aux.x;
  int k = int(aux.y + 0.5);
  float th = u * G.x;
  float h = G.y * (1.0 - 0.32 * pow(abs(u), 5.0));
  float r = (k == 0 || k == 4) ? 0.47 : 0.5 + G.z * (1.0 - 0.3 * u * u) + (k == 2 ? 0.012 : 0.0);
  float yf = k <= 1 ? -1.0 : k == 2 ? 0.0 : 1.0;
  P = vec3(cos(th) * r, ${f(W.cy)} - G.w + yf * h, sin(th) * r);
  vec3 radial = vec3(cos(th), 0.0, sin(th));
  N = aux.z < 0.5 ? normalize(vec3(0.0, -1.0, 0.0) + radial * 0.35) : aux.z > 1.5 ? normalize(vec3(0.0, 1.0, 0.0) + radial * 0.35) : normalize(radial + vec3(0.0, yf * 0.3, 0.0));
}
vec3 xf(int q, int inst, vec3 l) {
  vec4 v = vec4(l, 1.0);
  return vec3(dot(texelFetch(uPose, ivec2(q * 3, inst), 0), v), dot(texelFetch(uPose, ivec2(q * 3 + 1, inst), 0), v), dot(texelFetch(uPose, ivec2(q * 3 + 2, inst), 0), v));
}
// 호스: 탱크 아래(부위 16)에서 오른 손목(부위 2)까지 처진 3차 곡선
void hosePath(int inst, vec4 aux, out vec3 W, out vec3 N) {
  vec3 P0 = xf(16, inst, vec3(0.05, -0.2, 0.1));
  vec3 P1 = xf(2, inst, vec3(0.0, -0.31, 0.0));
  vec3 C0 = P0 + vec3(0.0, -0.3, 0.0);
  vec3 C1 = P1 + vec3(0.0, -0.22, 0.0);
  float t = aux.x, u = 1.0 - t;
  vec3 B = u * u * u * P0 + 3.0 * u * u * t * C0 + 3.0 * u * t * t * C1 + t * t * t * P1;
  vec3 T = normalize(3.0 * u * u * (C0 - P0) + 6.0 * u * t * (C1 - C0) + 3.0 * t * t * (P1 - C1) + vec3(0.0, 0.0, 1e-4));
  vec3 N1 = cross(T, vec3(0.0, 1.0, 0.0));
  N1 = length(N1) < 1e-3 ? vec3(1.0, 0.0, 0.0) : normalize(N1);
  vec3 N2 = cross(N1, T);
  N = N1 * cos(aux.y) + N2 * sin(aux.y);
  W = B + N * 0.032;
}
void main() {
  int p = int(aPart + 0.5);
  int inst = gl_InstanceID;
  int c = int(iChar.x + 0.5);
  vec3 lpos = position;
  vec3 lnrm = normal;
  vec3 w;
  vec3 n;
  if (p == 17) {
    hosePath(inst, aAux, w, n);
  } else {
    vec4 r0 = texelFetch(uPose, ivec2(p * 3, inst), 0);
    vec4 r1 = texelFetch(uPose, ivec2(p * 3 + 1, inst), 0);
    vec4 r2 = texelFetch(uPose, ivec2(p * 3 + 2, inst), 0);
    if (p == 7) hairShell(c, aAux, lpos, lnrm);
    else if (p == 15) goggleShape(c, aAux, lpos, lnrm);
    else if (p == 10) {
      float h = uSlot[c].x;
      float d = clamp(aAux.x, -h, h) - aAux.x;
      float cs = cos(d), sn = sin(d);
      lpos.xz = vec2(lpos.x * cs - lpos.z * sn, lpos.x * sn + lpos.z * cs);
      lnrm.xz = vec2(lnrm.x * cs - lnrm.z * sn, lnrm.x * sn + lnrm.z * cs);
    }
    vec4 lp = vec4(lpos, 1.0);
    w = vec3(dot(r0, lp), dot(r1, lp), dot(r2, lp));
    n = normalize(vec3(dot(r0.xyz, lnrm), dot(r1.xyz, lnrm), dot(r2.xyz, lnrm)) + 1e-6);
  }
  vShoe = (p == 4 || p == 5) && position.y < -0.36 ? 1.0 : 0.0;
  if (uMode > 0.5 && uMode < 1.5) {
    float t = uThick * (1.0 + vShoe * iFx.y * 1.6 + iFx.x * 0.6);
    w += n * t;
  }
  vUv = iCell.xy + vec2(0.003 + uv.x * 0.994, 0.003 + (1.0 - uv.y) * 0.994) * iCell.zw;
  vN = n;
  vW = w;
  vL = lpos;
  vAux = aAux;
  vPart = aPart;
  vCol = iCol;
  vFx = iFx;
  vChr = iChar;
  vCell = iCell;
  vec4 b0 = texelFetch(uPose, ivec2(3, inst), 0);
  vec4 b2 = texelFetch(uPose, ivec2(5, inst), 0);
  vFog = fogK(vec2(b0.w, b2.w));
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const FRAG = /* glsl */ `
#define PI 3.14159265
uniform sampler2D uSkin;
uniform sampler2D uEyes;
uniform vec4 uEyeCell;   // 칸 가로 · 세로(uv), 안쪽 여백 가로 · 세로(uv)
uniform float uMode;
uniform vec3 uLine;
uniform float uOut;      // 1 = sRGB 로 내보낸다(초상 — 후처리를 거치지 않는다)
uniform float uTime;
uniform vec4 uMatA[${NC}];  // 머리 껍질 · 꼬리 A · 꼬리 B · 띠
uniform vec4 uMatB[${NC}];  // 공 A · 공 B · 공 C · 공 D
uniform vec4 uHairB[${NC}];
uniform vec4 uSlot[${NC}];
uniform vec4 uHairC[${NC}];
uniform vec3 uHairCol[${NC}];
uniform vec4 uGog[${NC}];
uniform vec4 uGogL[${NC}];  // 렌즈 반폭 · 반높이 · 모서리 · 이어진 렌즈
in vec2 vUv;
in vec3 vN;
in vec3 vW;
in vec3 vL;
in vec4 vAux;
flat in float vPart;
flat in vec4 vCol;
flat in vec4 vFx;
flat in vec2 vFog;
flat in vec4 vChr;
flat in vec4 vCell;
in float vShoe;
layout(location = 0) out vec4 outColor;
${GLSL_LIGHTS}
${GLSL_FOG}
${SHADOW_DECL}
const vec3 LDIR = ${v3s(LDIR)};
const vec3 VDIR = ${v3s(PROJ.view)};
const vec3 CREAM = vec3(1.0, 0.896, 0.737);
const vec3 RUB = vec3(0.07, 0.065, 0.085);
const float GCY = ${f(W.cy)};
vec2 cellUv(vec2 a) { return vCell.xy + vec2(0.003 + clamp(a.x, 0.0, 1.0) * 0.994, 0.003 + (1.0 - clamp(a.y, 0.0, 1.0)) * 0.994) * vCell.zw; }
vec3 skinAt(vec2 a) { return texture(uSkin, cellUv(a)).rgb; }
float around(vec3 L) { return fract((atan(L.x, L.z + 1e-6) + PI * 0.5) / (2.0 * PI)); }
vec3 chrome(vec3 N) { return mix(vec3(0.26, 0.27, 0.34), vec3(1.08), smoothstep(-0.3, 0.85, N.y)); }
// 머리 껍질의 무늬: 윗면은 평면(머리 윗면 그림), 옆은 둘레(머리 옆면)
vec3 hairPat(vec3 L) {
  if (L.y > 0.7) {
    vec2 t = clamp(vec2(0.5 + L.z / 1.16, 0.5 + L.x / 1.16), 0.01, 0.99);
    return skinAt(vec2(t.x * 0.25, 0.25 + t.y * 0.25));
  }
  return skinAt(vec2(around(L), 0.5 + clamp(abs(L.y) / 0.735, 0.01, 0.99) * 0.5));
}
vec3 matColor(float m, int part, int c, vec3 N, inout float spec, inout float hairK, inout float emit) {
  int mi = int(m + 0.5);
  float th = atan(vL.z, vL.x + 1e-6);
  vec3 T = vCol.rgb;
  if (mi == ${MATS.team}) return T;
  if (mi == ${MATS.cream}) return CREAM;
  if (mi == ${MATS.dark}) return mix(T * 0.22, vec3(0.05, 0.035, 0.09), 0.55);
  if (mi == ${MATS.light}) return mix(T, vec3(1.0), 0.5);
  if (mi == ${MATS.lens}) {
    spec = 1.4;
    emit += 0.3;
    return mix(vec3(0.62, 0.95, 1.0), T, 0.35) * 0.8;
  }
  if (mi == ${MATS.rubber}) {
    spec = 0.12;
    return RUB;
  }
  if (mi == ${MATS.chrome}) {
    spec = 1.3;
    return chrome(N);
  }
  if (mi == ${MATS.led}) {
    // 무광 검정 + 바깥 면의 형광 LED 고리
    spec = 0.25;
    float rr = length(vL.xy);
    float ring = vL.z > 0.4 ? smoothstep(0.36, 0.44, rr) * (1.0 - smoothstep(0.6, 0.68, rr)) : 0.0;
    emit += ring * 1.8;
    return mix(RUB * 1.3, mix(T, vec3(1.0), 0.3), ring);
  }
  if (mi == ${MATS.stripe}) {
    // 두 톤 줄(팀 색 · 크림): 고리는 둘레 마디, 꼬리는 길이 방향, 공은 가로 줄
    float st = part == 10 ? cos(th * 12.0) : (part == 8 || part == 9) ? sin(vL.y * 42.0) : sin(vL.y * 13.0);
    spec = 0.35;
    return mix(T, CREAM, step(0.3, st));
  }
  if (mi == ${MATS.bead}) {
    spec = 1.4;
    return vL.y > -0.15 ? mix(T, vec3(1.0), 0.15) : T * 0.55;
  }
  if (mi == ${MATS.gem}) {
    spec = 1.7;
    emit += 0.3;
    float fct = 0.78 + 0.22 * step(0.0, sin(th * 6.0) * sin(vL.y * 7.0));
    return mix(T, vec3(1.0), 0.45) * fct;
  }
  if (mi == ${MATS.brush}) {
    // 붓: 뿌리 쪽 털(잉크 묻은 팀 색) · 크롬 고리 · 나무 자루
    if (vL.y > -0.13) return T * (0.75 + 0.25 * cos(th * 10.0));
    if (vL.y > -0.175) {
      spec = 1.3;
      return chrome(N);
    }
    return vec3(0.55, 0.33, 0.17);
  }
  if (mi == ${MATS.pennant}) return abs(vL.y * 0.7 + vL.z * 1.6 + 0.12) < 0.05 ? CREAM : T;
  if (mi == ${MATS.badge}) {
    // 배지: 크롬 테 + 팀 색 바탕의 크림 별
    float rr = length(vL.xy);
    if (vL.z < 0.25 || rr > 0.72) {
      spec = 1.3;
      return chrome(N);
    }
    float a = atan(vL.y, vL.x + 1e-6);
    emit += 0.12;
    return rr < (0.32 + 0.16 * cos(a * 5.0)) ? CREAM : T;
  }
  if (mi == ${MATS.pad}) {
    spec = 0.2;
    return abs(vL.y) < 0.22 ? T : RUB * 1.4;
  }
  if (mi == ${MATS.knitStripe}) {
    float rib = 0.82 + 0.18 * smoothstep(-0.3, 0.6, cos(th * 30.0));
    spec = 0.12;
    return (sin(vL.y * 12.0) > 0.0 ? T : CREAM) * rib;
  }
  if (mi == ${MATS.belt}) {
    // 벨트: 무광 고무 + 앞의 크롬 버클
    if (abs(th) < 0.22 && abs(vL.y) < 0.08) {
      spec = 1.3;
      return chrome(N);
    }
    spec = 0.15;
    return abs(vL.y) > 0.075 ? mix(T, RUB, 0.5) : RUB * 1.2;
  }
  if (mi == ${MATS.bow}) {
    // 리본: 팀 색 + 끝의 크림 테 + 가운데 크림 줄, 광택
    spec = 0.8;
    float edge = smoothstep(-0.36, -0.42, vL.y);
    float mid = 1.0 - smoothstep(0.012, 0.024, abs(vL.z));
    return mix(mix(T, CREAM, edge), CREAM, mid * 0.85);
  }
  if (mi == ${MATS.knit} || mi == ${MATS.knitLight}) {
    // 니트: 세로 골(접힌 단은 더 촘촘하게 · 밝게)
    bool cuff = mi == ${MATS.knitLight};
    float rib = 0.78 + 0.22 * smoothstep(-0.35, 0.65, cos(th * (cuff ? 40.0 : 26.0)));
    spec = 0.12;
    return (cuff ? mix(T, vec3(1.0), 0.42) : T) * rib;
  }
  if (mi == ${MATS.cap}) {
    // 캡 몸통: 무늬 없는 단색 팀 색 + 앞 위쪽의 형광 원 표식
    vec3 d = normalize(vL - vec3(0.0, 0.76, 0.0) + vec3(1e-5, 0.0, 0.0));
    float e = dot(d, normalize(vec3(1.0, 0.8, 0.0)));
    float aa = 0.012;
    vec3 col = T;
    col = mix(col, CREAM * 1.25, smoothstep(0.952 - aa, 0.952 + aa, e));
    col = mix(col, mix(T, vec3(1.0), 0.35) * 1.7, smoothstep(0.985 - aa, 0.985 + aa, e));
    spec = 0.5;
    return col;
  }
  if (mi == ${MATS.brim}) {
    // 챙: 윗면은 밝은 팀 색 + 짙은 테, 밑면은 짙은 그늘
    spec = 0.4;
    float edge = smoothstep(0.8, 0.95, length(vL.xz));
    vec3 top = mix(T, vec3(1.0), 0.3);
    return vL.y < -0.05 ? T * 0.14 : mix(top, T * 0.45, edge);
  }
  if (mi == ${MATS.hair}) {
    // 머리카락: 종류의 자연색 + 가닥 결 + 윤기 띠(밝은 면이 살아 있게 — 검정 머리도 바닥에 묻히지 않는다)
    hairK = 1.0;
    vec3 hc = uHairCol[c];
    vec3 hl = mix(hc, vec3(0.86, 0.9, 1.0), 0.55);
    float strand = part == 7 ? 0.86 + 0.14 * smoothstep(-0.3, 0.9, cos(th * 18.0)) : 0.88 + 0.12 * cos(th * 6.0);
    vec3 hair = hc;
    if (part == 7) {
      float s = vAux.y;
      float shine = smoothstep(0.24, 0.32, s) * (1.0 - smoothstep(0.42, 0.5, s));
      hair = mix(hair, hl, 0.5 * shine * (0.75 + 0.25 * cos(th * 9.0)));
    } else {
      float shine = smoothstep(-0.1, -0.16, vL.y) * (1.0 - smoothstep(-0.22, -0.3, vL.y));
      hair = mix(hair, hl, 0.45 * shine);
    }
    spec = 0.55;
    return hair * strand;
  }
  // 무늬
  if (part == 7) return hairPat(vL);
  if (part == 8 || part == 9) return skinAt(vec2(0.375 + around(vL) * 0.25, 0.5 + clamp(1.0 + vL.y / 0.6, 0.02, 0.98) * 0.5));
  return T;
}
// 고글 끈: 머리(와 그 높이의 머리카락)를 감는 무광 띠 + 가운데 팀 색 실선
vec3 strapAt(vec3 base, int c) {
  float y = vL.y - (GCY - uGog[c].w);
  float th = atan(vL.z, vL.x + 1e-6);
  if (abs(y) > 0.034 || abs(th) < uGog[c].x - 0.05) return base;
  return mix(RUB * 1.4, mix(vCol.rgb, vec3(1.0), 0.25), 1.0 - smoothstep(0.004, 0.009, abs(y)));
}
// 고글 아래의 입(표정): 작은 미소 · 맞음 · KO 벌린 입 · 어지러움 물결 · 웃음 반달
vec3 mouthAt(vec3 base, int c) {
  float th = atan(vL.z, vL.x + 1e-6);
  if (abs(th) > 0.7) return base;
  vec2 m = vec2(th * 0.5, vL.y - (0.105 - uGog[c].w * 0.4));
  int e = int(vChr.y + 0.5);
  float d;
  if (e == 5) {
    float r = length(m - vec2(0.0, 0.022));
    d = max(r - 0.052, m.y - 0.022);
  } else if (e == 2 || e == 3) {
    d = (length(m / vec2(0.03, 0.024)) - 1.0) * 0.024;
  } else if (e == 4) {
    d = max(abs(m.y - 0.008 * sin(m.x * 110.0)) - 0.006, abs(m.x) - 0.05);
  } else {
    d = max(max(abs(length(m - vec2(0.0, 0.05)) - 0.05) - 0.0065, m.y - 0.008), abs(m.x) - 0.042);
  }
  float aa = max(fwidth(d), 1e-4);
  float halo = 1.0 - smoothstep(0.008 - aa, 0.008 + aa, d);
  float ink = 1.0 - smoothstep(-aa, aa, d);
  vec3 col = mix(base, CREAM, halo * 0.85);
  return mix(col, vec3(0.09, 0.05, 0.1), ink);
}
// 고글 앞면: 테(종류의 재질) + 형광 테두리 한 줄 + 색유리 렌즈(팀 색이 비치고 사선 반사 띠, 흐릿한 눈 · 표정 표시가 빛난다)
vec3 goggleColor(int c, vec3 N, inout float spec, inout float emit) {
  vec4 G = uGog[c];
  vec4 L = uGogL[c];
  float hk = 0.0;
  vec3 frame = matColor(uSlot[c].y, 15, c, N, spec, hk, emit);
  if (vAux.z < 0.5 || vAux.z > 1.5) return frame * 0.85;
  float th = atan(vL.z, vL.x + 1e-6);
  vec2 q = vec2(th * 0.5, vL.y - (GCY - G.w));
  vec2 lq = L.w > 0.5 ? q : vec2(abs(q.x) - 0.132, q.y);
  vec2 dd = abs(lq) - L.xy + L.z;
  float sd = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0) - L.z;
  float aa = max(fwidth(sd), 1e-4);
  float inside = 1.0 - smoothstep(-aa, aa, sd);
  float neon = 1.0 - smoothstep(0.0045 - aa, 0.0045 + aa, abs(sd - 0.011));
  vec2 e = clamp(vec2(0.5 - q.x / 0.35 * 0.5, 0.5 - q.y / 0.15 * 0.5), 0.0, 1.0);
  vec2 cell = vec2(vChr.y, vChr.x) * uEyeCell.xy;
  vec4 eye = texture(uEyes, cell + uEyeCell.zw + e * (uEyeCell.xy - 2.0 * uEyeCell.zw));
  vec3 glass = mix(vec3(0.03, 0.03, 0.07), vCol.rgb, 0.32);
  float s1 = 1.0 - smoothstep(0.007, 0.014, abs(lq.x * 0.85 + lq.y - 0.035));
  float s2 = 1.0 - smoothstep(0.003, 0.007, abs(lq.x * 0.85 + lq.y + 0.025));
  glass += vec3(0.85, 0.95, 1.0) * (s1 * 0.85 + s2 * 0.5);
  int ex = int(vChr.y + 0.5);
  if (ex >= 2) glass = mix(glass, mix(vCol.rgb, vec3(1.0), 0.65) * 2.2, eye.a);
  else glass = mix(glass, glass * 0.3 + vec3(0.05), eye.a * 0.5);
  vec3 col = mix(frame, mix(vCol.rgb, vec3(1.0), 0.45) * 1.9, neon * 0.9);
  col = mix(col, glass, inside);
  emit += inside * 0.35;
  if (inside > 0.5) spec = 1.4;
  return col;
}
// 잉크 탱크: 무광 마개 · 크롬 고리 · 투명 창(팀 색 잉크가 출렁이며 은은히 빛난다) · 세로 살
vec3 tankColor(int c, vec3 N, inout float spec, inout float emit) {
  float y = vL.y;
  float th = atan(vL.z, vL.x + 1e-6);
  if (abs(y) > 0.19) {
    spec = 0.2;
    return RUB * (abs(y) > 0.235 ? 1.8 : 1.0);
  }
  if (abs(y) > 0.155) {
    spec = 1.3;
    return chrome(N);
  }
  float lvl = -0.01 + vChr.z * 0.25 * (vL.x / 0.17) + 0.016 * sin(uTime * 5.0 + th * 3.0 + vChr.x * 1.7);
  float bar = 1.0 - smoothstep(0.06, 0.1, abs(sin(th * 2.0)));
  vec3 col;
  if (y < lvl) {
    col = vCol.rgb * (0.95 + 0.2 * sin(y * 70.0 + th * 4.0 + uTime * 2.0));
    emit += 0.9;
  } else col = mix(vec3(0.04, 0.04, 0.08), vCol.rgb, 0.12);
  col += vec3(0.85, 0.92, 1.0) * (1.0 - smoothstep(0.03, 0.07, abs(th - 2.2))) * 0.5;
  col = mix(col, RUB * 1.3, bar * 0.9);
  spec = 1.0;
  return col;
}
void main() {
  int mode = int(uMode + 0.5);
  // 그림자 맵 패스(world.js — 화질 중 · 고): 본 그림의 깊이만(외곽선 · 실루엣은 그리지 않는다)
  if (uShadowPass > 0.5) {
    if (mode != 0) discard;
    outColor = vec4(1.0);
    return;
  }
  if (mode == 2) {
    outColor = vec4(vCol.rgb * 1.25, 0.55 * vFx.z);
    return;
  }
  if (mode == 1) {
    // 외곽선: 짙은 보라 · 조준 점멸이면 흰빛 · 부스터면 운동화가 노란빛
    vec3 lc = uLine;
    if (vFx.x > 0.5) lc = vec3(2.2);
    if (vShoe > 0.5 && vFx.y > 0.5) lc = vec3(1.6, 1.0, 0.1);
    outColor = vec4(fogApply(lc, vFog), 1.0);
    if (uOut > 0.5) outColor.rgb = pow(clamp(outColor.rgb, 0.0, 1.0), vec3(1.0 / 2.2));
    return;
  }
  vec3 N = normalize(vN);
  int part = int(vPart + 0.5);
  int c = int(vChr.x + 0.5);
  bool held = part == 6;
  float spec = ${C.spec.toFixed(3)};
  float hairK = 0.0;
  float emit = 0.0;
  vec3 base;
  if (held) base = vCol.rgb;
  else if (part < 6) {
    base = texture(uSkin, vUv).rgb;
    if (part == 0) base = mouthAt(strapAt(base, c), c);
    // 형광 밑창(운동화 둘레의 맨 아래 줄)
    if ((part == 4 || part == 5) && vShoe > 0.5 && vL.y < -0.468) {
      base = mix(vCol.rgb, vec3(1.0), 0.35);
      emit += 1.3;
    }
  } else if (part == 15) base = goggleColor(c, N, spec, emit);
  else if (part == 16) base = tankColor(c, N, spec, emit);
  else if (part == 17) {
    // 호스: 무광 고무 + 팀 색 나선 줄
    base = mix(RUB * 1.5, vCol.rgb, step(0.8, sin(vAux.y + vAux.x * 46.0)));
    spec = 0.3;
  } else {
    vec4 A = uMatA[c];
    vec4 B = uMatB[c];
    float m = part == 7 ? A.x : part == 8 ? A.y : part == 9 ? A.z : part == 10 ? A.w : part == 11 ? B.x : part == 12 ? B.y : part == 13 ? B.z : B.w;
    if (part == 7) {
      // 머리 껍질: 모자 선 위는 모자, 단 구간은 단, 그 아래는 머리카락
      vec4 H = uHairC[c];
      if (vAux.y < H.x) m = uSlot[c].w;
      else if (vAux.y >= H.y && vAux.y < H.z) m = uSlot[c].z;
    }
    base = matColor(m, part, c, N, spec, hairK, emit);
    if (part == 7 && hairK > 0.5) base = strapAt(base, c);
  }
  // 툰 3단계(그늘은 보랏빛) — 맵의 2D 그림처럼 칠한 명암
  float d = dot(N, LDIR);
  float band = d > ${C.bands[0].toFixed(3)} ? 1.0 : d > ${C.bands[1].toFixed(3)} ? ${C.mid.toFixed(3)} : ${C.dark.toFixed(3)};
  vec3 tint = mix(${v3s(C.shadowTint)}, vec3(1.0), smoothstep(${C.dark.toFixed(3)}, 1.0, band));
  vec3 col = base * band * tint;
  // 형광 도료처럼 무늬가 조금 스스로 빛난다(원본 emissiveIntensity 0.24) + 번쩍임 · 무적 깜빡임 · 조준 점멸 + 포인트 발광(밑창 · 탱크 창 · LED · 렌즈)
  float glow = ${C.emit.toFixed(3)} + vCol.a * 2.2 + vFx.w * 0.8 + vFx.x * 1.1;
  col += base * (glow + emit);
  // 작은 반짝(윗면 왼쪽)
  vec3 H = normalize(LDIR + VDIR);
  float sp = pow(max(dot(N, H), 0.0), held ? 60.0 : 24.0);
  col += vec3(1.0) * smoothstep(0.55, 0.7, sp) * (held ? 0.8 : spec);
  if (held) col += base * 0.9;
  // 머리카락의 테두리 빛(어두운 바닥 위에서도 머리 윤곽이 읽히게)
  if (hairK > 0.5) col += mix(base, vec3(0.75, 0.8, 1.0), 0.6) * pow(1.0 - max(dot(N, VDIR), 0.0), 2.5) * 0.45;
  col = shade(col, vW, N);
  outColor = vec4(fogApply(col, vFog), 1.0);
  if (uOut > 0.5) outColor.rgb = pow(clamp(outColor.rgb, 0.0, 1.0), vec3(1.0 / 2.2));
}`;

// ------------------------------------------------------------------ 종류별 표(유니폼)
const MAT_OF = (name) => (name in MATS ? MATS[name] : MATS.pat);
/** charset 표 → 셰이더 유니폼 값. hairMat 을 주면 "hair" 재질을 그것으로 바꿔 본다(개발용 견주기) */
export function charUniforms(hairMat = null) {
  const v4 = (a) => new THREE.Vector4(...a);
  const hm = (m) => (m === "hair" && hairMat ? hairMat : m);
  const U = { uHairA: [], uHairB: [], uHairC: [], uSlot: [], uMatA: [], uMatB: [], uHairCol: [], uGog: [], uGogL: [] };
  for (const d of CHARACTERS) {
    const h = d.hair;
    const P = d.parts || {};
    const m = (k) => (P[k] ? MAT_OF(hm(P[k].mat)) : 0);
    const g = GOGGLE_SHAPES[(d.goggles && d.goggles.shape) || 0];
    U.uHairA.push(v4([h.rim[0], h.rim[1], h.rim[2], h.zig || 0]));
    U.uHairB.push(v4([h.off, h.bulge || 0, h.spikes || 0, h.flare || 0]));
    const hat = h.hat || null, cuff = h.cuff || null;
    U.uHairC.push(v4([hat ? hat.line : -1, cuff ? cuff.from : 2, cuff ? cuff.to : 2, cuff ? cuff.out : 0]));
    U.uSlot.push(v4([P.band ? P.band.span : Math.PI, MAT_OF((d.goggles && d.goggles.frame) || "rubber"), cuff ? MAT_OF(cuff.mat) : 0, hat ? MAT_OF(hat.mat) : 0]));
    U.uHairCol.push(new THREE.Color(d.hairColor ?? 0x4a2e22));
    U.uGog.push(v4([g[0], g[1], g[2], d.windowDrop || 0]));
    U.uGogL.push(v4([g[3], g[4], g[5], g[6]]));
    U.uMatA.push(v4([MAT_OF(hm(h.mat)), m("tailA"), m("tailB"), m("band")]));
    U.uMatB.push(v4([m("knobA"), m("knobB"), m("knobC"), m("knobD")]));
  }
  return U;
}

// ------------------------------------------------------------------ 눈 아틀라스(종류 × 표정 — 화질마다 한 장을 나눠 쓴다)
const eyeTextures = new Map();
function eyeTexture(cw, ch) {
  const key = `${cw}x${ch}`;
  let e = eyeTextures.get(key);
  if (e) return e;
  const pad = Math.max(2, Math.round(cw / 24));
  const a = drawEyeAtlas(cw, ch, pad);
  const tex = new THREE.CanvasTexture(a.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  const W2 = a.canvas.width, H2 = a.canvas.height;
  e = { texture: tex, info: new THREE.Vector4(cw / W2, ch / H2, pad / W2, pad / H2), bytes: Math.round(W2 * H2 * 4 * 1.33) };
  eyeTextures.set(key, e);
  return e;
}

// ------------------------------------------------------------------ 무늬 시트
/**
 * (색, 무늬, 종류) → 시트의 칸. 원본 스킨(1024² 배치)을 칸 크기로 줄여 넣는다. 칸이 모자라면 가장 오래 안 쓴 칸을 다시 쓴다.
 */
function createSkinSheet(cell, cols = 8, rows = 6) {
  const COLS = cols;
  const ROWS = rows;
  const W = COLS * cell, H = ROWS * cell;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.generateMipmaps = false; // 화면의 머리 한 바퀴가 칸과 비슷해 밉맵이 없어도 된다
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const slots = new Map(); // key → { i, used }
  const order = [];
  let pending = [];
  let full = true;
  const tmp = document.createElement("canvas");
  tmp.width = tmp.height = cell;
  const tctx = tmp.getContext("2d");
  tctx.imageSmoothingQuality = "high";
  const src = Math.min(1024, cell * 2);
  function draw(i, hex, pattern, char) {
    const img = drawAtlas(hex, pattern, char, src);
    tctx.clearRect(0, 0, cell, cell);
    tctx.drawImage(img, 0, 0, cell, cell);
    const x = (i % COLS) * cell, y = Math.floor(i / COLS) * cell;
    ctx.drawImage(tmp, x, y);
    pending.push([x, y]);
  }
  return {
    texture: tex,
    cell,
    get bytes() {
      return W * H * 4;
    },
    get used() {
      return slots.size;
    },
    /** (색, 무늬, 종류) 의 칸(텍스처 uv): [x, y, w, h] */
    cellOf(hex, pattern, char, frame) {
      const key = hex * 4096 + pattern * 16 + (char + 1);
      let s = slots.get(key);
      if (!s) {
        let i = order.length;
        if (i >= COLS * ROWS) {
          // 가장 오래 안 쓴 칸
          let old = null;
          for (const [k, v] of slots) if (!old || v.used < old[1].used) old = [k, v];
          slots.delete(old[0]);
          i = old[1].i;
        } else order.push(i);
        s = { i, used: frame, uv: [((i % COLS) * cell) / W, (Math.floor(i / COLS) * cell) / H, cell / W, cell / H] };
        slots.set(key, s);
        draw(i, hex, pattern, char);
      }
      s.used = frame;
      return s.uv;
    },
    /** 바뀐 칸만 올린다(처음엔 통째로) — three 의 상태 캐시를 거친다 */
    upload(renderer) {
      if (!pending.length) return;
      const glTex = renderer.properties.get(tex).__webglTexture;
      if (full || !glTex) {
        tex.needsUpdate = true;
        full = false;
        pending = [];
        return;
      }
      const gl = renderer.getContext();
      const state = renderer.state;
      state.bindTexture(gl.TEXTURE_2D, glTex);
      state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      for (const [x, y] of pending) {
        state.pixelStorei(gl.UNPACK_SKIP_PIXELS, x);
        state.pixelStorei(gl.UNPACK_SKIP_ROWS, y);
        state.texSubImage2D(gl.TEXTURE_2D, 0, x, y, cell, cell, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      }
      state.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
      state.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      pending = [];
    },
    restore() {
      full = true;
      pending.push([0, 0]);
    },
    dispose() {
      tex.dispose();
    },
  };
}

// ------------------------------------------------------------------ 묶음
/**
 * @param {object} uniforms  stacks.js 의 공유 유니폼(섬광 점광 · 안개)
 * @param {object} o  cell(무늬 시트 칸 px) · low(화질 저 — 분할을 줄인다) · eye([칸 가로, 세로] px) · cols · rows(시트 칸 수) · hairMat(견주기)
 */
export function createFigures(uniforms, { cell = 192, low = false, eye = null, cols = 8, rows = 6, hairMat = null } = {}) {
  const sheet = createSkinSheet(cell, cols, rows);
  const eyes = eye ? eyeTexture(eye[0], eye[1]) : low ? eyeTexture(64, 28) : eyeTexture(96, 42);
  const poseData = new Float32Array(PARTS * 3 * 4 * MAX_FIGURES);
  const pose = new THREE.DataTexture(poseData, PARTS * 3, MAX_FIGURES, THREE.RGBAFormat, THREE.FloatType);
  pose.minFilter = pose.magFilter = THREE.NearestFilter;
  pose.generateMipmaps = false;
  pose.needsUpdate = true;

  // 본 그림 · 외곽선 · 실루엣은 분할이 다른 지오메트리(삼각형 예산 — 실루엣 · 외곽선은 거칠어도 티가 안 난다)에 같은 인스턴스 속성을 건다
  const buf = { iCell: new Float32Array(MAX_FIGURES * 4), iCol: new Float32Array(MAX_FIGURES * 4), iFx: new Float32Array(MAX_FIGURES * 4), iChar: new Float32Array(MAX_FIGURES * 4) };
  const attrs = {};
  for (const [k, a] of Object.entries(buf)) attrs[k] = new THREE.InstancedBufferAttribute(a, 4).setUsage(THREE.DynamicDrawUsage);
  const makeGeo = (pass) => {
    const g = new THREE.InstancedBufferGeometry();
    const b = figureGeometry(geometrySpec(pass, low));
    for (const k of ["position", "normal", "uv", "aPart", "aAux"]) g.setAttribute(k, b.getAttribute(k));
    for (const [k, at] of Object.entries(attrs)) g.setAttribute(k, at);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  };
  const geo = makeGeo("main");
  const geoLine = makeGeo("line");
  const geoXray = makeGeo("xray");
  const tri = (g) => g.attributes.position.count / 3;
  const triangles = tri(geo);
  const trianglesAll = tri(geo) + tri(geoLine) + tri(geoXray);

  const CU = charUniforms(hairMat);
  const shared = {
    uPose: { value: pose },
    uSkin: { value: sheet.texture },
    uEyes: { value: eyes.texture },
    uEyeCell: { value: eyes.info },
    uThick: { value: C.outline },
    uLine: { value: new THREE.Color(STYLE.outline.color) },
    uOut: { value: 0 },
    uTime: { value: 0 },
    ...Object.fromEntries(Object.entries(CU).map(([k, v]) => [k, { value: v }])),
    uShadowPass: { value: 0 },
    ...uniforms,
  };
  const mk = (mode, extra) => new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { ...shared, uMode: { value: mode } },
    ...extra,
  });
  // 스텐실: 캐릭터가 덮은 화소는 0(자기 몸 뒤쪽이 실루엣으로 비치지 않게), 장애물 그림이 보이는 화소는 1(props.js)
  const zero = { stencilWrite: true, stencilRef: 0, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp };
  const main = new THREE.Mesh(geo, mk(0, zero));
  const outline = new THREE.Mesh(geoLine, mk(1, { side: THREE.BackSide, ...zero }));
  const xray = new THREE.Mesh(geoXray, mk(2, {
    transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth,
    stencilWrite: true, stencilWriteMask: 0, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc,
  }));
  main.renderOrder = 5;
  // 그림자 맵(world.js — 화질 중 · 고): 본 그림만 빛 카메라의 층에도 든다(셰이더가 uShadowPass 면 깊이만)
  main.layers.enable(SHADOW_LAYER);
  outline.renderOrder = 6;
  xray.renderOrder = 40;
  for (const m of [main, outline, xray]) m.frustumCulled = false;
  outline.visible = C.outline > 0;

  // 부스터 전기 꼬리(원본 그대로 — 지난 위치를 이은 띠, 너비 방향은 카메라를 본다)
  const RIBS = 4, RIB_N = 14;
  const ribTotal = MAX_FIGURES * RIBS;
  const ribVerts = RIB_N * 2;
  const ribPos = new Float32Array(ribTotal * ribVerts * 3);
  const ribCol = new Float32Array(ribTotal * ribVerts * 4);
  const ribIdx = new Uint32Array(ribTotal * (RIB_N - 1) * 6);
  for (let r = 0, o = 0; r < ribTotal; r++) {
    const b = r * ribVerts;
    for (let i = 0; i < RIB_N - 1; i++) {
      const a = b + i * 2;
      ribIdx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], o);
      o += 6;
    }
  }
  const ribGeo = new THREE.BufferGeometry();
  ribGeo.setAttribute("position", new THREE.BufferAttribute(ribPos, 3).setUsage(THREE.DynamicDrawUsage));
  ribGeo.setAttribute("color", new THREE.BufferAttribute(ribCol, 4).setUsage(THREE.DynamicDrawUsage));
  ribGeo.setIndex(new THREE.BufferAttribute(ribIdx, 1));
  ribGeo.setDrawRange(0, 0);
  const ribMesh = new THREE.Mesh(ribGeo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  }));
  ribMesh.frustumCulled = false;
  ribMesh.renderOrder = 21;

  let n = 0;
  let ribUsed = 0;
  let frame = 0;
  const tint = new THREE.Color();
  const view = PROJ.view;

  let shadowFrame = -10; // 그림자 패스가 마지막으로 우리를 그린 프레임(그림자 맵이 켜져 있으면 발밑 얼룩을 끈다)
  let uploaded = -1;
  main.onBeforeRender = (renderer) => {
    if (shared.uShadowPass.value > 0.5) shadowFrame = frame;
    if (uploaded === frame) return; // 그림자 패스에서 이미 올렸다
    uploaded = frame;
    sheet.upload(renderer);
    geo.instanceCount = geoLine.instanceCount = geoXray.instanceCount = n;
    for (const at of Object.values(attrs)) {
      at.clearUpdateRanges();
      if (n) at.addUpdateRange(0, n * 4);
      at.needsUpdate = true;
    }
    if (n) pose.needsUpdate = true;
    ribGeo.setDrawRange(0, ribUsed * (RIB_N - 1) * 6);
    ribMesh.visible = ribUsed > 0;
    if (ribUsed > 0) {
      ribGeo.attributes.position.needsUpdate = true;
      ribGeo.attributes.color.needsUpdate = true;
    }
  };

  return {
    meshes: [main, outline, xray, ribMesh],
    main,
    outline,
    xray,
    RIBS,
    RIB_N,
    low,
    cell,
    get count() {
      return n;
    },
    /** 이번 프레임 캐릭터 삼각형 수: { main(본 그림), all(외곽선 · 실루엣 포함) } */
    get triangles() {
      return { main: n * triangles, all: n * (outline.visible ? trianglesAll : trianglesAll - tri(geoLine)), per: triangles, perAll: trianglesAll };
    },
    /** 텍스처 바이트: 무늬 시트 + 자세 자료 + 눈 아틀라스 */
    get bytes() {
      return sheet.bytes + poseData.byteLength + eyes.bytes;
    },
    get sheetUsed() {
      return sheet.used;
    },
    /** 그림자 맵에 캐릭터가 드리우는 중인가(최근 두 프레임 안에 그림자 패스가 그렸다) */
    get castsShadow() {
      return frame - shadowFrame <= 2;
    },
    setOutline(on) {
      outline.visible = on && C.outline > 0;
    },
    /** 초상용: 셰이더가 sRGB 로 내보낸다 */
    setSrgbOut(on) {
      shared.uOut.value = on ? 1 : 0;
    },
    /** 프레임 시작(dt = 연출 시간 — 탱크 잉크 물결) */
    begin(dt = 0) {
      n = 0;
      ribUsed = 0;
      frame++;
      shared.uTime.value = (shared.uTime.value + (dt || 0)) % 1000;
    },
    /**
     * 캐릭터 하나. parts = 부위 Object3D 14개(matrixWorld 를 읽는다 — null 이면 그 부위를 접는다), hex = 팀 색, pattern = 무늬, char = 종류,
     * expr = 눈 표정 칸(eyes.js EXPR), flash · lock · boost · xray · pulse = 연출, slosh = 탱크 잉크 출렁임(−1..1)
     */
    push(parts, hex, pattern, char, expr = 0, flash = 0, lock = 0, boost = 0, xray = 0, pulse = 0, slosh = 0) {
      if (n >= MAX_FIGURES) return -1;
      const row = n * PARTS * 3 * 4;
      for (let p = 0; p < PARTS; p++) {
        const o = row + p * 12;
        const obj = parts[p];
        if (!obj) {
          poseData.fill(0, o, o + 12);
          continue;
        }
        const e = obj.matrixWorld.elements; // 열 우선
        poseData[o] = e[0]; poseData[o + 1] = e[4]; poseData[o + 2] = e[8]; poseData[o + 3] = e[12];
        poseData[o + 4] = e[1]; poseData[o + 5] = e[5]; poseData[o + 6] = e[9]; poseData[o + 7] = e[13];
        poseData[o + 8] = e[2]; poseData[o + 9] = e[6]; poseData[o + 10] = e[10]; poseData[o + 11] = e[14];
      }
      const ch = ((char % NC) + NC) % NC;
      const uv = sheet.cellOf(hex, pattern, ch, frame);
      const i4 = n * 4;
      buf.iCell.set(uv, i4);
      tint.setHex(hex);
      buf.iCol[i4] = tint.r; buf.iCol[i4 + 1] = tint.g; buf.iCol[i4 + 2] = tint.b; buf.iCol[i4 + 3] = flash;
      buf.iFx[i4] = lock; buf.iFx[i4 + 1] = boost; buf.iFx[i4 + 2] = xray; buf.iFx[i4 + 3] = pulse;
      buf.iChar[i4] = ch; buf.iChar[i4 + 1] = expr; buf.iChar[i4 + 2] = slosh; buf.iChar[i4 + 3] = 0;
      return n++;
    },
    /**
     * 부스터 꼬리 띠 하나(원본 drawBoost 의 띠 부분): tr = 지난 위치(RIB_N 점 × xyz, 0 이 가장 최근), hip = 허리 꼬리인가, move · flick = 세기
     */
    ribbon(tr, off, hip, move, flick) {
      if (ribUsed >= ribTotal) return;
      const w0 = hip ? 0.06 : 0.17;
      const vb = ribUsed * ribVerts;
      for (let i = 0; i < RIB_N; i++) {
        const j = off + i * 3;
        const ja = off + Math.max(0, i - 1) * 3;
        const jb = off + Math.min(RIB_N - 1, i + 1) * 3;
        const tx = tr[ja] - tr[jb], ty = tr[ja + 1] - tr[jb + 1], tz = tr[ja + 2] - tr[jb + 2];
        // 너비 방향 = 진행 방향 × 카메라 방향(직교 카메라라 방향 하나)
        let nx = ty * view[2] - tz * view[1];
        let ny = tz * view[0] - tx * view[2];
        let nz = tx * view[1] - ty * view[0];
        const nl = Math.hypot(nx, ny, nz);
        const k = i / (RIB_N - 1);
        const w = nl > 1e-5 ? (w0 * (1 - k * 0.85)) / nl : 0;
        nx *= w;
        ny *= w;
        nz *= w;
        const v = (vb + i * 2) * 3;
        ribPos[v] = tr[j] + nx; ribPos[v + 1] = tr[j + 1] + ny; ribPos[v + 2] = tr[j + 2] + nz;
        ribPos[v + 3] = tr[j] - nx; ribPos[v + 4] = tr[j + 1] - ny; ribPos[v + 5] = tr[j + 2] - nz;
        const a = Math.pow(1 - k, 0.8) * move * flick * (hip ? 0.8 : 1);
        const c = (vb + i * 2) * 4;
        ribCol[c] = ribCol[c + 4] = 1;
        ribCol[c + 1] = ribCol[c + 5] = 0.88 - 0.4 * k;
        ribCol[c + 2] = ribCol[c + 6] = (hip ? 0.6 : 0.12) * (1 - k);
        ribCol[c + 3] = ribCol[c + 7] = a;
      }
      ribUsed++;
    },
    restore() {
      sheet.restore();
    },
    /** GPU 자원을 놓는다(화질 단계가 바뀌어 새로 만들 때) — 눈 아틀라스는 화질마다 나눠 쓰므로 남긴다 */
    dispose() {
      for (const m of [main, outline, xray, ribMesh]) {
        if (m.parent) m.parent.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
      sheet.dispose();
      pose.dispose();
    },
  };
}
