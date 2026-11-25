// [왕국전] 건물 넷(깃발의 탑 · 잉크 공급소 · 잉크 무기 랩 · 몬스터 퍼실리티)과 탑 깃발의 자세한 모델(사용자 요청 — "각 건물을 더 많은
// 폴리곤으로 디테일하게"). models.js 의 builder 도구 b(b.box · b.cyl · b.cone · b.sph · b.torus · b.extrude · b.add · b.seg)를 받아 부품을 붙인다.
// 말투는 원본 장애물과 같다: 둥근 장난감 도형 · 금속 · 크림 몸 + 팀 색 형광. use 1 = 인스턴스 색(팀 색), use 4 = 그 짙은 톤,
// use 2 = 팀 색 경고 빗금, use 3 = 노랑 경고 빗금, emit = 발광.
// 정면 = +z. 카메라는 앞 위(고도 약 49°, 요 0°)에서 내려다본다 — 윗면과 앞면이 보이고 ±x 옆면은 거의 안 보인다. 그래서 잔 부품은 앞 · 위에 둔다.
// 화질 저(detail 0.6): 둥근 것의 분할은 b.seg 가 줄이고, 잔 부품(볼트 · 리벳 · 가로대 · 잔가지)은 fine(b) 가 거짓이면 뺀다.
// 다각 기둥(팔각 탑 등)은 분할 수가 곧 모양이라 줄이지 않는다(prism — b.cyl 은 팔각을 오각으로 줄인다).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// models.js 와 같은 색(순환 가져오기를 피해 여기에 다시 적는다)
const WOOD = 0xb07a55, WOOD_D = 0x7a4f40, WOOD_M = 0x9a6a4c;
const METAL = 0x46528c, METAL_L = 0x7f8fd0, METAL_D = 0x2a3160, IRON = 0x23232d;
const DARK = 0x100922, CREAM = 0xfff1dc, CREAM_D = 0xd9c8b4, LAV = 0xb9a6e8, GLASS = 0xdff4ff;
const CYAN = 0x00f0ff, PINK = 0xff2d95, LIME = 0xa8ff00, YELLOW = 0xffe600;
const TEAM = PINK; // use 1 · 4 부품의 정해진 색(그릴 때 인스턴스 색 = 팀 색이 덮는다)
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ 도구
/** 화질 고 · 중(detail ≥ 0.85)인가 — 아니면 잔 부품을 뺀다 */
const fine = (b) => b.seg(10, 1) >= 9;
/** 분할 수를 고정한 다각 기둥. face = 면 하나가 정면(+z)을 본다 */
function prism(b, rTop, rBot, h, n, col, o = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, n, 1, false, o.face === false ? 0 : Math.PI / n);
  return b.add(g, col, { flat: true, ...o });
}
/** 둥근 상자(모서리 분할을 detail 로) */
function rbox(b, w, h, d, r, col, o = {}) {
  return b.add(new RoundedBoxGeometry(w, h, d, o.rs ?? b.seg(2, 1), r), col, o);
}
/** 돌림 몸(단면 [반지름, 높이] 를 y 축으로 돌린다) */
function lathe(b, pts, col, o = {}) {
  const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0.001, r), y)), o.n ? b.seg(o.n, 6) : b.seg(18, 8), o.phi || 0);
  return b.add(g, col, o);
}
/** 굽은 관(점들을 잇는 매끈한 곡선) */
function tube(b, pts, r, col, o = {}) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  return b.add(new THREE.TubeGeometry(c, b.seg(o.len || 12, 4), r, b.seg(o.n || 6, 4), false), col, o);
}
/** 바닥과 나란한 고리(각은 +x 에서 +z 쪽으로 — 앞 = π/2). from 에서 len 만큼만 그릴 수 있다 */
function ring(b, R, t, col, o = {}) {
  const g = new THREE.TorusGeometry(R, t, b.seg(o.rs || 6, 3), b.seg(o.n || 24, 8), o.len ?? TAU);
  g.rotateX(Math.PI / 2);
  g.rotateY(-(o.from || 0));
  return b.add(g, col, o);
}
const _up = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _eu = new THREE.Euler();
/** 두 점을 잇는 막대(원기둥) */
function rod(b, p0, p1, r, col, o = {}) {
  _v.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const len = _v.length();
  _q.setFromUnitVectors(_up, _v.normalize());
  _eu.setFromQuaternion(_q);
  return b.cyl(o.r1 ?? r, r, len, col, { n: 6, ...o, at: [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], rot: [_eu.x, _eu.y, _eu.z] });
}
/** 아치(아래 네모 + 위 반원 — 가운데 아래가 원점) */
function archPath(w, h, P = THREE.Shape) {
  const s = new P(), r = w / 2;
  s.moveTo(-r, 0);
  s.lineTo(r, 0);
  s.lineTo(r, h - r);
  s.absarc(0, h - r, r, 0, Math.PI, false);
  s.lineTo(-r, 0);
  return s;
}
/** 아치 테(바깥 w × h, 테 두께 t — 아래는 열림) */
function archRim(w, h, t) {
  const r = w / 2, ri = r - t, s = new THREE.Shape();
  s.moveTo(-r, 0);
  s.lineTo(-ri, 0);
  s.lineTo(-ri, h - r);
  s.absarc(0, h - r, ri, Math.PI, 0, true);
  s.lineTo(ri, 0);
  s.lineTo(r, 0);
  s.lineTo(r, h - r);
  s.absarc(0, h - r, r, 0, Math.PI, false);
  s.lineTo(-r, 0);
  return s;
}
/** 면 위의 점: 각 a(정면 0, +x 쪽 +) 의 면, 바깥으로 R, 그 면에서 옆 dx · 높이 y */
const onFace = (a, R, dx, y) => [Math.sin(a) * R + Math.cos(a) * dx, y, Math.cos(a) * R - Math.sin(a) * dx];
/** 천 한 장: 1 × 1 판(nx × ny 칸, 두께 t)을 f(u, v) → [x, y, z] 로 옮겨 휜다(u · v = 0..1, 두께는 z 로 더한다) */
function cloth(b, nx, ny, t, f, col, o = {}) {
  const g = new THREE.BoxGeometry(1, 1, t, nx, ny, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = f(p.getX(i) + 0.5, p.getY(i) + 0.5);
    p.setXYZ(i, x, y, z + p.getZ(i));
  }
  g.computeVertexNormals();
  return b.add(g, col, o);
}
/** 볼트 머리(앞을 보는 면에 — rot 로 방향) */
const bolt = (b, at, r = 0.055, o = {}) => b.cyl(r, r, 0.05, METAL_L, { n: 6, rot: [Math.PI / 2, 0, 0], ...o, at });

/** 건물 받침 — 둥근 단(사용자 요청 "왕국의 사각 받침도 모두 원형으로"). R = 바깥 반지름(칸 발자국 안 — 3칸 2.85, 4칸 3.8).
 *  모서리를 깎은 짙은 아랫단(옆에 팀 색 경고 빗금) · 팀 색 형광 고리 · 모서리를 깎은 윗단 원판(높이 0.38 — 건물이 그 위에 선다) ·
 *  이음매 고리 · 볼트 · 둘레 팀 색 받침쇠 여덟 */
function plinth(b, R) {
  const F = fine(b), n = 36;
  lathe(b, [[R - 0.05, 0], [R, 0.05], [R, 0.19], [R - 0.06, 0.25], [R - 0.32, 0.25]], METAL_D, { n });
  b.cyl(R + 0.006, R + 0.006, 0.1, METAL, { at: [0, 0.12, 0], use: 2, emit: 0.3, n, open: true });
  lathe(b, [[R - 0.1, 0.22], [R - 0.1, 0.32], [R - 0.32, 0.32]], TEAM, { emit: 0.95, use: 1, n });
  lathe(b, [[R - 0.3, 0.3], [R - 0.3, 0.34], [R - 0.34, 0.38], [0, 0.38]], METAL, { n });
  if (F) lathe(b, [[R - 0.58, 0.379], [R - 0.61, 0.392], [R - 0.64, 0.379]], METAL_D, { n });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + TAU / 16;
    b.box(0.42, 0.3, 0.2, TEAM, { at: [Math.sin(a) * (R - 0.04), 0.16, Math.cos(a) * (R - 0.04)], rot: [0, a, 0], use: 4, emit: 0.15 });
  }
  if (F) for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    b.cyl(0.055, 0.055, 0.04, METAL_L, { at: [Math.sin(a) * (R - 0.46), 0.39, Math.cos(a) * (R - 0.46)], n: 5 });
  }
}
/** 기둥 등불: 받침 · 기둥 · 등롱(팀 색 불 + 살 + 갓) */
function lamp(b, x, z, hgt = 1.5) {
  const F = fine(b), y0 = 0.38;
  b.cyl(0.2, 0.24, 0.14, METAL_D, { at: [x, y0 + 0.07, z], n: 8 });
  b.cyl(0.06, 0.08, hgt, METAL_L, { at: [x, y0 + hgt / 2, z], n: 6 });
  b.cyl(0.11, 0.11, 0.08, METAL_D, { at: [x, y0 + hgt * 0.45, z], n: 6 });
  const yl = y0 + hgt + 0.2;
  b.cyl(0.18, 0.15, 0.06, METAL_D, { at: [x, yl - 0.2, z], n: 8 });
  b.sph(0.15, TEAM, { at: [x, yl, z], emit: 1.6, use: 1, w: 8, h: 6 });
  if (F) for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + TAU / 8;
    b.box(0.03, 0.36, 0.03, METAL_D, { at: [x + Math.sin(a) * 0.16, yl, z + Math.cos(a) * 0.16] });
  }
  b.cone(0.24, 0.2, METAL_D, { at: [x, yl + 0.27, z], n: 8 });
}
/** 앞을 보는 둥근 계기(바늘 = 팀 색). rot = 계기판 방향 */
function gauge(b, at, r, rot = [0, 0, 0], needle = 0.6) {
  const F = fine(b);
  const [rx, ry] = rot;
  const fwd = [Math.sin(ry) * Math.cos(rx), -Math.sin(rx), Math.cos(ry) * Math.cos(rx)];
  const p = (d) => [at[0] + fwd[0] * d, at[1] + fwd[1] * d, at[2] + fwd[2] * d];
  b.cyl(r * 1.18, r * 1.18, 0.07, METAL_D, { at, rot: [rx + Math.PI / 2, ry, 0], n: 12 });
  b.cyl(r, r, 0.05, CREAM, { at: p(0.03), rot: [rx + Math.PI / 2, ry, 0], emit: 0.45, n: 12 });
  b.box(0.035, r * 0.85, 0.03, TEAM, { at: p(0.065), rot: [rx, ry, needle], emit: 1.2, use: 1 });
  if (F) b.torus(r * 1.08, 0.025, METAL_L, { at: p(0.04), rot: [rx, ry, 0], n: 14 });
  b.sph(0.04, METAL_D, { at: p(0.07), w: 6, h: 4 });
}
/** 손잡이 바퀴(밸브) — 기본은 바닥과 나란히(위를 본다) */
function wheel(b, at, r, col = TEAM, o = {}) {
  const F = fine(b), rot = o.rot || [Math.PI / 2, 0, 0];
  b.add(new THREE.TorusGeometry(r, r * 0.16, b.seg(4, 3), b.seg(12, 8)), col, { at, rot, emit: o.emit ?? 1.0, use: o.use ?? 1 });
  if (o.spokes || (F && r >= 0.2)) for (const a of [0, Math.PI / 2]) b.box(r * 2, r * 0.14, r * 0.14, METAL_L, { at, rot: [rot[0], rot[1], rot[2] + a] });
  b.cyl(r * 0.25, r * 0.25, r * 0.3, METAL_D, { at, rot, n: 8 });
}

// ------------------------------------------------------------------ 깃발의 탑(8u)
// 팔각 두 단: 아랫단은 푸른 돌 켜 셋 + 아치 문(팀 색 문짝 · 쇠띠) + 양옆 팀 깃발 현수막, 가운데 팀 색 띠, 윗단은 크림 돌 + 팀 색으로 빛나는 아치 창 셋 +
// 받침돌(코벨) 고리, 꼭대기는 성가퀴 + 네 모서리 망루(팀 색 고깔 지붕 · 빛 구슬) + 팀 색 갑판 + 앞을 겨눈 포탑(사격). 깃대는 realm/flagpole(위 5.2u).
export function flagTower(b) {
  const F = fine(b);
  plinth(b, 3.8);
  for (const a of [TAU / 8, (TAU * 3) / 8, (TAU * 5) / 8, (TAU * 7) / 8]) lamp(b, Math.sin(a) * 3.28, Math.cos(a) * 3.28, 1.35);
  // 아랫단: 받침 + 짙은 심 + 돌 켜 셋(사이 이음매로 심이 비친다) + 모서리 기둥
  prism(b, 3.06, 3.12, 0.26, 8, METAL_D, { at: [0, 0.5, 0] });
  prism(b, 2.62, 2.8, 1.75, 8, METAL_D, { at: [0, 1.5, 0] });
  for (const [y0, y1, r0, r1] of [[0.63, 1.2, 2.98, 2.9], [1.25, 1.8, 2.87, 2.79], [1.85, 2.32, 2.76, 2.7]]) prism(b, r1, r0, y1 - y0, 8, METAL, { at: [0, (y0 + y1) / 2, 0] });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + TAU / 16;
    b.box(0.24, 1.72, 0.24, METAL_L, { at: [Math.sin(a) * 2.86, 1.48, Math.cos(a) * 2.86], rot: [0, a, 0] });
  }
  // 가운데 팀 색 띠(+ 짙은 턱)
  prism(b, 2.76, 2.78, 0.08, 8, METAL_D, { at: [0, 2.34, 0] });
  prism(b, 2.7, 2.72, 0.2, 8, TEAM, { at: [0, 2.48, 0], emit: 1, use: 1 });
  // 앞 계단 + 아치 문: 크림 돌 테 · 짙은 안 · 팀 색 문짝(가운데 틈 · 쇠띠 셋 · 고리 손잡이) · 팀 색 쐐기돌
  b.box(1.8, 0.13, 0.42, METAL_L, { at: [0, 0.44, 3.17], round: 0.03 });
  b.box(1.6, 0.13, 0.4, METAL, { at: [0, 0.57, 2.98], round: 0.03 });
  const zd = 2.72;
  b.extrude(archPath(1.36, 1.72), 0.3, DARK, { at: [0, 0.63, zd] });
  b.extrude(archRim(1.86, 1.98, 0.26), 0.44, CREAM, { at: [0, 0.63, zd + 0.06] });
  b.extrude(archPath(1.22, 1.62), 0.08, TEAM, { at: [0, 0.63, zd + 0.17], use: 4, emit: 0.25 });
  b.box(0.04, 1.6, 0.06, DARK, { at: [0, 1.43, zd + 0.22] });
  for (const y of [0.88, 1.3, 1.72]) {
    b.box(1.18, 0.09, 0.05, METAL_L, { at: [0, y, zd + 0.23] });
    if (F) for (const x of [-0.42, 0.42]) bolt(b, [x, y, zd + 0.26], 0.035);
  }
  for (const s of [-1, 1]) b.sph(0.06, METAL_L, { at: [s * 0.15, 1.12, zd + 0.27], w: 6, h: 4 });
  b.box(0.36, 0.3, 0.24, TEAM, { at: [0, 2.52, zd + 0.2], emit: 1.1, use: 1, round: 0.04 });
  // 현수막 둘: 앞 양옆 면에 팀 색 천(세로 주름 · 아래 제비 꼬리 · 보석 무늬) + 막대
  for (const s of [-1, 1]) {
    const a = (s * TAU) / 8, R = 2.84;
    const f = (u, v) => {
      const notch = 0.22 * (1 - Math.abs(2 * u - 1));
      const yb = 0.92 + notch;
      const y = yb + v * (2.2 - yb);
      const dx = (u - 0.5) * 0.92;
      const dz = 0.045 * Math.sin(u * TAU * 1.5) + 0.03 * (1 - v);
      return [Math.sin(a) * (R + dz) + Math.cos(a) * dx, y, Math.cos(a) * (R + dz) - Math.sin(a) * dx];
    };
    cloth(b, b.seg(6, 3), b.seg(4, 2), 0.06, f, TEAM, { use: 1, emit: 0.35 });
    cloth(b, b.seg(6, 3), 1, 0.09, (u, v) => f(u, 0.86 + v * 0.14), TEAM, { use: 4, emit: 0.2 });
    b.cyl(0.04, 0.04, 1.12, METAL_L, { at: onFace(a, R + 0.02, 0, 2.24), rot: [0, a, Math.PI / 2], n: 6 });
    for (const e of [-1, 1]) b.sph(0.065, METAL_L, { at: onFace(a, R + 0.02, e * 0.58, 2.24), w: 5, h: 3 });
    b.add(new THREE.OctahedronGeometry(0.19), CREAM, { at: onFace(a, R + 0.06, 0, 1.58), rot: [0, a, 0], scale: [1, 1.3, 0.45], emit: 1.0 });
  }
  // 윗단: 크림 돌(띠 하나) + 팀 색 아치 창 셋(테 · 창살 · 창턱)
  prism(b, 2.0, 2.25, 2.3, 8, CREAM, { at: [0, 3.73, 0] });
  prism(b, 2.14, 2.15, 0.07, 8, CREAM_D, { at: [0, 3.25, 0] });
  for (const a of [-TAU / 8, 0, TAU / 8]) {
    const R = 1.98;
    b.extrude(archRim(0.66, 1.02, 0.1), 0.14, METAL_D, { at: onFace(a, R + 0.02, 0, 3.4), rot: [0, a, 0] });
    b.extrude(archPath(0.48, 0.92), 0.06, TEAM, { at: onFace(a, R - 0.01, 0, 3.4), rot: [0, a, 0], use: 1, emit: 1.1 });
    b.box(0.04, 0.9, 0.04, METAL_D, { at: onFace(a, R + 0.04, 0, 3.86), rot: [0, a, 0] });
    b.box(0.48, 0.04, 0.04, METAL_D, { at: onFace(a, R + 0.04, 0, 3.98), rot: [0, a, 0] });
    b.box(0.76, 0.07, 0.2, CREAM_D, { at: onFace(a, R + 0.08, 0, 3.37), rot: [0, a, 0] });
  }
  // 받침돌 고리 + 성가퀴 판 + 갑판(팀 짙은 톤 · 팀 색 빛 테 · 뒤 해치)
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    b.box(0.24, 0.26, 0.34, METAL_D, { at: [Math.sin(a) * 2.02, 4.74, Math.cos(a) * 2.02], rot: [0, a, 0] });
  }
  prism(b, 2.4, 2.32, 0.3, 8, METAL_D, { at: [0, 4.98, 0] });
  prism(b, 1.95, 1.95, 0.08, 8, TEAM, { at: [0, 5.16, 0], emit: 0.3, use: 4 });
  prism(b, 1.62, 1.62, 0.02, 8, TEAM, { at: [0, 5.205, 0], emit: 1.3, use: 1 });
  prism(b, 1.46, 1.46, 0.025, 8, TEAM, { at: [0, 5.21, 0], emit: 0.3, use: 4 });
  b.box(0.62, 0.08, 0.48, METAL_D, { at: [0, 5.25, -1.0], round: 0.03 });
  b.box(0.34, 0.04, 0.04, METAL_L, { at: [0, 5.31, -0.84] });
  if (F) for (const x of [-0.24, 0.24]) b.cyl(0.035, 0.035, 0.03, METAL_L, { at: [x, 5.3, -1.16], n: 5 });
  // 성가퀴: 앞 · 뒤 · 옆 면마다 둘(앞은 가운데가 비어 포신이 나온다)
  for (const a of [0, TAU / 4, TAU / 2, (TAU * 3) / 4]) for (const dx of [-0.52, 0.52]) {
    b.box(0.5, 0.56, 0.4, CREAM, { at: onFace(a, 2.13, dx, 5.4), rot: [0, a, 0] });
    b.box(0.52, 0.06, 0.42, TEAM, { at: onFace(a, 2.13, dx, 5.7), rot: [0, a, 0], use: 4 });
  }
  // 네 모서리 망루: 받침 깔때기 · 크림 몸 · 팀 색 창 · 고깔 지붕(팀 색) · 꼭대기 빛 구슬
  for (const a of [TAU / 8, (TAU * 3) / 8, (TAU * 5) / 8, (TAU * 7) / 8]) {
    const [x, , z] = onFace(a, 2.28, 0, 0);
    b.cone(0.48, 0.5, METAL_D, { at: [x, 4.5, z], rot: [Math.PI, 0, 0], n: 12 });
    b.cyl(0.46, 0.46, 0.9, CREAM, { at: [x, 5.2, z], n: 12 });
    b.cyl(0.52, 0.52, 0.08, METAL_D, { at: [x, 5.68, z], n: 12 });
    b.box(0.12, 0.34, 0.06, TEAM, { at: onFace(a, 2.73, 0, 5.2), rot: [0, a, 0], emit: 1.2, use: 1 });
    b.cone(0.62, 0.72, TEAM, { at: [x, 6.07, z], n: 12, use: 1, emit: 0.3 });
    b.sph(0.1, YELLOW, { at: [x, 6.47, z], emit: 1.6, w: 6, h: 4 });
  }
  // 포탑(앞): 고리 받침 · 둥근 몸 · 옆판 · 포신(쇠띠) · 팀 색 포구 · 조준경
  const tz = 1.05;
  b.cyl(0.5, 0.56, 0.14, METAL_D, { at: [0, 5.26, tz], n: 14 });
  b.sph(0.42, METAL, { at: [0, 5.36, tz], scale: [1, 0.78, 1], w: 14, h: 9 });
  for (const s of [-1, 1]) b.box(0.08, 0.34, 0.5, METAL_D, { at: [s * 0.4, 5.42, tz] });
  b.cyl(0.11, 0.14, 1.05, METAL_L, { at: [0, 5.5, tz + 0.62], rot: [Math.PI / 2 - 0.12, 0, 0], n: 10 });
  if (F) b.cyl(0.155, 0.155, 0.1, METAL_D, { at: [0, 5.47, tz + 0.4], rot: [Math.PI / 2 - 0.12, 0, 0], n: 10 });
  b.cyl(0.16, 0.16, 0.14, TEAM, { at: [0, 5.57, tz + 1.15], rot: [Math.PI / 2 - 0.12, 0, 0], emit: 1.4, use: 1, n: 10 });
  b.box(0.12, 0.12, 0.3, METAL_D, { at: [0.22, 5.72, tz - 0.05], round: 0.03 });
  b.sph(0.045, TEAM, { at: [0.22, 5.72, tz + 0.11], emit: 1.6, use: 1, w: 6, h: 4 });
}

// ------------------------------------------------------------------ 탑 깃발(깃대 + 큰 팀 깃발)
// 소켓(팀 색 고리 · 볼트) + 마디 깃대 + 금 장식 끝(빛 구슬) + 천 깃발(여러 칸으로 접힌 주름 · 제비 꼬리 · 위아래 짙은 단 · 보석 무늬 · 술 장식).
// 발밑이 원점(탑 위에 올려 그린다 — 꺾이면 brawlscene 이 옆으로 눕힌다). 깃발은 +x 로 3.3u, 높이 4.1 ~ 5.9.
function flagAt(u, v) {
  const W = 3.2, H = 1.74, x0 = 0.15;
  const notch = 0.5 * (1 - Math.abs(2 * v - 1));
  const k = u * (W - notch);
  const x = x0 + k;
  const a = 0.05 + 0.085 * k;
  const z = a * Math.sin(k * 2.3) + 0.035 * Math.sin(k * 4.6 + v * 2.2) * Math.min(1, k);
  const y = 5.0 + (v - 0.5) * H * (1 - (0.07 * k) / W) - 0.022 * k * k + 0.05 * Math.sin(k * 2.8);
  return [x, y, z];
}
export function flagpole(b) {
  const F = fine(b);
  b.cyl(0.34, 0.42, 0.3, METAL_D, { at: [0, 0.15, 0], n: 12 });
  b.torus(0.36, 0.05, TEAM, { at: [0, 0.3, 0], rot: [Math.PI / 2, 0, 0], emit: 1.3, use: 1, n: 16 });
  if (F) for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    b.cyl(0.04, 0.04, 0.05, METAL_L, { at: [Math.sin(a) * 0.3, 0.32, Math.cos(a) * 0.3], n: 6 });
  }
  b.cyl(0.09, 0.12, 6.0, METAL_L, { at: [0, 3.0, 0], n: 10 });
  for (const y of [0.55, 2.2, 3.7]) b.cyl(0.15, 0.15, 0.1, METAL_D, { at: [0, y, 0], n: 10 });
  b.cyl(0.13, 0.13, 0.3, TEAM, { at: [0, 2.9, 0], emit: 0.8, use: 1, n: 10 });
  // 끝 장식: 받침 고리 · 빛 구슬 · 작은 뿔
  b.cyl(0.16, 0.12, 0.1, YELLOW, { at: [0, 6.0, 0], n: 10, emit: 0.5 });
  b.sph(0.24, YELLOW, { at: [0, 6.2, 0], emit: 1.4, w: 12, h: 8 });
  b.cone(0.07, 0.24, YELLOW, { at: [0, 6.52, 0], emit: 1.2, n: 6 });
  // 깃발: 팀 색 천 + 위아래 짙은 단 + 깃대 쪽 소매 + 보석 무늬(앞뒤로 나온다) + 꼬리 끝 술
  const nx = b.seg(16, 8), ny = b.seg(5, 3);
  cloth(b, nx, ny, 0.07, flagAt, TEAM, { use: 1, emit: 0.45 });
  for (const [v0, v1] of [[0, 0.12], [0.88, 1]]) cloth(b, nx, 1, 0.1, (u, v) => flagAt(u, v0 + v * (v1 - v0)), TEAM, { use: 4, emit: 0.25 });
  b.cyl(0.16, 0.16, 1.82, TEAM, { at: [0.02, 5.0, 0], use: 4, emit: 0.2, n: 10 });
  for (const y of [4.12, 5.88]) b.cyl(0.19, 0.19, 0.07, YELLOW, { at: [0.02, y, 0], emit: 0.6, n: 10 });
  const [ex, ey, ez] = flagAt(0.4, 0.5);
  const [ex2, , ez2] = flagAt(0.42, 0.5);
  const ang = -Math.atan2(ez2 - ez, ex2 - ex);
  b.add(new THREE.OctahedronGeometry(0.36), CREAM, { at: [ex, ey, ez], rot: [0, ang, 0], scale: [1, 1.3, 0.42], emit: 1.0 });
  b.torus(0.46, 0.04, CREAM, { at: [ex, ey, ez], rot: [0, ang, 0], n: 16, emit: 0.8, scale: [1, 1.12, 1] });
  for (const v of [0, 1]) {
    const [tx, ty, tz] = flagAt(1, v);
    b.sph(0.08, YELLOW, { at: [tx + 0.02, ty + (v ? 0.02 : -0.02), tz], emit: 1.1, w: 6, h: 4 });
    b.cone(0.07, 0.2, YELLOW, { at: [tx + 0.02, ty - 0.13, tz], rot: [Math.PI, 0, 0], emit: 0.8, n: 6 });
  }
}

// ------------------------------------------------------------------ 잉크 공급소(6u)
// 큰 잉크 탱크: 발 달린 받침 + 금속 몸 + 가운데 유리 창(팀 색 잉크가 반쯤 차 있다 — 잉크 선 · 거품 · 세로 살) + 리벳 고리 + 둥근 지붕(맨홀 · 팀 색 손잡이 바퀴 · 숨구멍) +
// 앞 큰 계기 · 왼쪽 앞 사다리. 앞 조작대(계기 둘 · 단추 · 잉크 눈금). 둘레의 주유기 넷(화면 · 노즐 · 감긴 호스) + 탱크에서 오는 관(이음 테 · 밸브).
export function supply(b) {
  const F = fine(b);
  plinth(b, 2.85);
  const Z = -0.15;
  const at = (a, R, y) => [Math.sin(a) * R, y, Z + Math.cos(a) * R];
  // 받침 + 발
  b.cyl(1.58, 1.7, 0.42, METAL_D, { at: [0, 0.59, Z], n: 20 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + TAU / 12;
    b.box(0.32, 0.5, 0.34, METAL, { at: at(a, 1.66, 0.62), rot: [0, a, 0] });
  }
  // 몸통: 아래 금속 · 잉크(팀 색, 밝게) · 빈 유리(팀 짙은 톤) · 위 금속 + 잉크 선 · 세로 살 · 거품
  b.cyl(1.43, 1.45, 0.6, METAL, { at: [0, 1.1, Z], n: 22 });
  b.cyl(1.38, 1.38, 0.78, TEAM, { at: [0, 1.79, Z], emit: 1.0, use: 1, n: 22 });
  b.cyl(1.38, 1.38, 0.32, TEAM, { at: [0, 2.34, Z], emit: 0.12, use: 4, n: 22 });
  ring(b, 1.39, 0.03, CREAM, { at: [0, 2.18, Z], emit: 1.2, n: 22, rs: 3 });
  b.cyl(1.43, 1.43, 0.5, METAL, { at: [0, 2.75, Z], n: 22 });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU + TAU / 24;
    b.box(0.09, 1.1, 0.08, METAL_L, { at: at(a, 1.42, 1.95), rot: [0, a, 0] });
  }
  for (const [x, y, r] of [[-0.3, 1.62, 0.07], [0.05, 1.9, 0.05], [0.3, 1.55, 0.08], [-0.05, 1.45, 0.045]]) b.sph(r, CREAM, { at: [x, y, Z + 1.38], emit: 1.3, w: 6, h: 4 });
  for (const [y, r, h] of [[0.84, 1.48, 0.1], [1.4, 1.52, 0.13], [2.5, 1.52, 0.13], [3.0, 1.48, 0.08]]) {
    b.cyl(r, r, h, METAL_L, { at: [0, y, Z], n: 22 });
    if (F && h > 0.1) for (let k = 0; k < 9; k++) b.sph(0.035, METAL_D, { at: at(-1.3 + (k / 8) * 2.6, r + 0.01, y), w: 5, h: 3 });
  }
  // 둥근 지붕 + 맨홀 목 + 손잡이 바퀴 + 숨구멍 + 빛 구슬
  const dome = [];
  const nd = b.seg(7, 4);
  for (let i = 0; i <= nd; i++) {
    const t = (i / nd) * 1.33;
    dome.push([1.45 * Math.cos(t), 3.0 + 0.6 * Math.sin(t)]);
  }
  lathe(b, dome, METAL_L, { at: [0, 0, Z], n: 22 });
  b.cyl(0.36, 0.4, 0.3, METAL_D, { at: [0, 3.72, Z], n: 14 });
  b.cyl(0.42, 0.42, 0.06, METAL, { at: [0, 3.86, Z], n: 14 });
  wheel(b, [0, 3.95, Z], 0.28, TEAM, { emit: 1.2, spokes: true });
  b.cyl(0.08, 0.08, 0.55, METAL, { at: [-0.78, 3.55, Z - 0.6], n: 8 });
  b.sph(0.16, METAL_D, { at: [-0.78, 3.82, Z - 0.6], scale: [1, 0.5, 1], w: 10, h: 6 });
  b.sph(0.06, TEAM, { at: [0.75, 3.52, Z - 0.55], emit: 1.6, use: 1, w: 6, h: 4 });
  // 앞 큰 계기(위 금속 몸)
  gauge(b, at(0.12, 1.45, 2.74), 0.24, [0, 0.12, 0], 0.7);
  // 사다리(왼쪽 앞)
  {
    const a = -0.42;
    for (const dx of [-0.17, 0.17]) b.box(0.05, 2.35, 0.05, METAL_L, { at: onFaceZ(a, 1.58, dx, 1.95, Z), rot: [0, a, 0] });
    for (let y = 1.0; y < 3.1; y += F ? 0.26 : 0.52) b.box(0.34, 0.04, 0.04, METAL_L, { at: onFaceZ(a, 1.58, 0, y, Z), rot: [0, a, 0] });
    b.torus(0.17, 0.03, METAL_L, { at: onFaceZ(a, 1.48, 0, 3.13, Z), rot: [0, a, 0], arc: Math.PI, n: 8 });
  }
  // 앞 조작대: 비스듬한 판 위에 계기 둘 · 잉크 눈금(팀 색 칸) · 단추 셋 + 탱크로 가는 관
  {
    const cz = 1.78, t = 0.62;
    b.box(1.44, 0.66, 0.46, METAL_D, { at: [0, 0.71, cz], round: 0.06 });
    const pc = [0, 1.08, cz];
    const P = (dx, dz, dn) => [pc[0] + dx, pc[1] - Math.sin(t) * dz + Math.cos(t) * dn, pc[2] + Math.cos(t) * dz + Math.sin(t) * dn];
    b.box(1.5, 0.08, 0.56, METAL, { at: pc, rot: [t, 0, 0], round: 0.03 });
    for (const dx of [-0.46, -0.1]) {
      b.cyl(0.15, 0.15, 0.04, METAL_D, { at: P(dx, -0.02, 0.05), rot: [t, 0, 0], n: 12 });
      b.cyl(0.12, 0.12, 0.03, CREAM, { at: P(dx, -0.02, 0.075), rot: [t, 0, 0], emit: 0.5, n: 12 });
      b.box(0.025, 0.02, 0.11, TEAM, { at: P(dx + 0.02, -0.04, 0.095), rot: [t, dx < -0.3 ? 0.7 : -0.5, 0], emit: 1.3, use: 1 });
    }
    for (let k = 0; k < 5; k++) b.box(0.08, 0.03, 0.06, TEAM, { at: P(0.2 + k * 0.1, -0.1, 0.05), rot: [t, 0, 0], use: k < 3 ? 1 : 4, emit: k < 3 ? 1.3 : 0.15 });
    [LIME, YELLOW, TEAM].forEach((c, k) => b.cyl(0.045, 0.045, 0.05, c, { at: P(0.28 + k * 0.14, 0.15, 0.05), rot: [t, 0, 0], emit: 1.2, use: c === TEAM ? 1 : 0, n: 8 }));
    rod(b, [0.5, 0.85, cz - 0.2], [0.5, 0.85, Z + 1.38], 0.06, METAL_L, { n: 8 });
  }
  // 네 주유기(받침 둘레에서 바깥을 본다) + 탱크에서 오는 관(이음 테 · 팀 색 밸브)
  for (const a of [0.86, -0.86, Math.PI - 0.9, -(Math.PI - 0.9)]) {
    const R = 2.12, x = Math.sin(a) * R, z = Math.cos(a) * R;
    const o = (dx, y, dz) => [x + Math.sin(a) * dz + Math.cos(a) * dx, y, z + Math.cos(a) * dz - Math.sin(a) * dx];
    const rot = [0, a, 0];
    b.box(0.56, 1.08, 0.46, METAL_D, { at: o(0, 0.92, 0), rot, round: 0.07 });
    b.box(0.62, 0.1, 0.52, METAL_L, { at: o(0, 1.5, 0), rot });
    b.box(0.36, 0.26, 0.04, TEAM, { at: o(0, 1.18, 0.24), rot, emit: 1.1, use: 1 });
    if (F) b.box(0.28, 0.05, 0.03, CREAM, { at: o(0, 0.94, 0.24), rot, emit: 0.4 });
    // 노즐(바깥 면에 걸림) + 감긴 호스
    b.box(0.2, 0.12, 0.12, METAL, { at: o(0.12, 0.8, 0.28), rot });
    b.cyl(0.055, 0.075, 0.3, METAL_L, { at: o(0.12, 0.72, 0.36), rot: [0.5, a, 0], n: 8 });
    b.sph(0.08, TEAM, { at: o(0.12, 0.6, 0.44), emit: 1.5, use: 1, w: 6, h: 4 });
    tube(b, [o(-0.2, 0.62, 0.24), o(-0.3, 0.45, 0.4), o(-0.05, 0.42, 0.46), o(0.1, 0.68, 0.36)], 0.04, IRON, { len: 8, n: 5 });
    // 관: 탱크 → 주유기
    const dx = x, dz = z - Z, L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L;
    const p0 = [ux * 1.43, 1.2, Z + uz * 1.43], p1 = [x - ux * 0.25, 1.2, z - uz * 0.25];
    rod(b, p0, p1, 0.075, METAL_L, { n: 8 });
    for (const p of [p0, p1]) rod(b, [p[0] - ux * 0.04, p[1], p[2] - uz * 0.04], [p[0] + ux * 0.04, p[1], p[2] + uz * 0.04], 0.12, METAL_D, { n: 8 });
    const m = [(p0[0] + p1[0]) / 2, 1.2, (p0[2] + p1[2]) / 2];
    b.cyl(0.03, 0.03, 0.2, METAL_D, { at: [m[0], 1.32, m[2]], n: 6 });
    wheel(b, [m[0], 1.43, m[2]], 0.11, TEAM, { emit: 1.0 });
  }
}
/** onFace 의 가운데가 (0, Z) 인 판 */
const onFaceZ = (a, R, dx, y, Z) => {
  const p = onFace(a, R, dx, y);
  p[2] += Z;
  return p;
};

// ------------------------------------------------------------------ 잉크 무기 랩(6u)
// 연보라 실험동: 짙은 받침 · 앞 모서리 기둥 · 지붕 턱(앞 팀 색 형광 띠) · 팀 색으로 빛나는 창 둘(창살 · 창턱) + 줄무늬 차양 + 미닫이 문(경고 빗금 · 팀 색 창) +
// 문 위 플라스크 간판. 지붕: 묶어 둔 큰 풍선(팀 색 — 줄 · 감개) · 접시 안테나(받침 · 고개 · 수신기) · 안테나 기둥(빛 구슬) · 환기구 · 환풍기.
// 앞마당: 잉크 통(유리 안 팀 색 잉크 · 거품 · 관) · 작업대(서랍 · 아래 선반)와 유리 기구(삼각 플라스크 · 둥근 플라스크 · 비커 · 시험관 꽂이) · 발사대 위 미사일.
export function lab(b) {
  const F = fine(b);
  plinth(b, 2.85);
  const Z = -0.95, W = 3.6, D = 2.3, H = 2.0, y0 = 0.58;
  const zf = Z + D / 2;
  b.box(W + 0.14, 0.22, D + 0.14, METAL_D, { at: [0, 0.48, Z], round: 0.05 });
  rbox(b, W, H, D, 0.12, LAV, { at: [0, y0 + H / 2, Z] });
  for (const sx of [-1, 1]) b.box(0.24, H + 0.06, 0.24, METAL_D, { at: [sx * (W / 2 - 0.06), y0 + H / 2, zf - 0.06] });
  const yr = y0 + H;
  b.box(W + 0.2, 0.16, D + 0.2, METAL, { at: [0, yr + 0.06, Z] });
  b.box(W + 0.2, 0.14, 0.12, METAL_D, { at: [0, yr + 0.2, zf + 0.04] });
  b.box(W + 0.2, 0.14, 0.12, METAL_D, { at: [0, yr + 0.2, Z - D / 2 - 0.04] });
  for (const sx of [-1, 1]) b.box(0.12, 0.14, D + 0.2, METAL_D, { at: [sx * (W / 2 + 0.04), yr + 0.2, Z] });
  b.box(W + 0.22, 0.07, 0.05, TEAM, { at: [0, yr + 0.02, zf + 0.11], emit: 1.1, use: 1 });
  // 창 둘
  for (const x of [-1.15, -0.22]) {
    b.box(0.8, 0.86, 0.08, METAL_D, { at: [x, 1.6, zf + 0.02] });
    b.box(0.64, 0.7, 0.06, TEAM, { at: [x, 1.6, zf + 0.05], emit: 1.0, use: 1 });
    b.box(0.05, 0.7, 0.04, METAL_D, { at: [x, 1.6, zf + 0.08] });
    b.box(0.64, 0.05, 0.04, METAL_D, { at: [x, 1.68, zf + 0.08] });
    b.box(0.9, 0.07, 0.18, METAL_L, { at: [x, 1.13, zf + 0.1] });
  }
  // 줄무늬 차양(팀 색 · 크림 번갈아)
  for (let k = 0; k < 5; k++) {
    const x = -1.6 + k * 0.4 + 0.2;
    b.box(0.41, 0.05, 0.34, k % 2 ? CREAM : TEAM, { at: [x, 2.42, zf + 0.16], rot: [0.5, 0, 0], use: k % 2 ? 0 : 1, emit: k % 2 ? 0 : 0.35 });
    b.cyl(0.07, 0.07, 0.4, k % 2 ? CREAM : TEAM, { at: [x, 2.33, zf + 0.32], rot: [0, 0, Math.PI / 2], use: k % 2 ? 0 : 1, emit: k % 2 ? 0 : 0.35, n: 8 });
  }
  // 미닫이 문 + 문 위 간판(플라스크)
  const dx = 1.08;
  b.box(1.0, 1.5, 0.06, DARK, { at: [dx, y0 + 0.75, zf + 0.02] });
  for (const s of [-1, 1]) {
    const x = dx + s * 0.24;
    b.box(0.44, 1.38, 0.05, METAL_L, { at: [x, y0 + 0.7, zf + 0.06] });
    b.box(0.44, 0.22, 0.03, METAL, { at: [x, y0 + 0.14, zf + 0.09], use: 2, emit: 0.3 });
    b.box(0.2, 0.34, 0.03, TEAM, { at: [x, y0 + 1.0, zf + 0.09], emit: 1.0, use: 1 });
  }
  b.box(1.1, 0.12, 0.14, METAL_D, { at: [dx, y0 + 1.52, zf + 0.06] });
  b.box(0.78, 0.38, 0.06, METAL_D, { at: [dx, 2.33, zf + 0.06], round: 0.03 });
  b.sph(0.1, TEAM, { at: [dx, 2.29, zf + 0.12], emit: 1.4, use: 1, w: 8, h: 6 });
  b.cyl(0.035, 0.05, 0.12, CREAM, { at: [dx, 2.43, zf + 0.12], n: 6, emit: 0.5 });
  for (const s of [-1, 1]) b.box(0.14, 0.03, 0.03, CREAM, { at: [dx + s * 0.22, 2.33, zf + 0.11], emit: 0.5 });
  // ── 지붕 ── 판 이음매 + 천창(팀 색 유리 · 창살)
  const yt = yr + 0.14;
  for (const z of [Z - 0.45, Z + 0.45]) b.box(W, 0.012, 0.04, METAL_D, { at: [0, yt + 0.005, z] });
  b.box(0.82, 0.12, 0.62, METAL_D, { at: [-0.02, yt + 0.06, -1.62], round: 0.03 });
  b.box(0.68, 0.04, 0.48, TEAM, { at: [-0.02, yt + 0.13, -1.62], rot: [0.12, 0, 0], emit: 0.7, use: 1 });
  b.box(0.04, 0.05, 0.5, METAL_D, { at: [-0.02, yt + 0.16, -1.62], rot: [0.12, 0, 0] });
  // 풍선 + 줄 + 감개
  const bx = -0.8, bz = -1.05;
  b.box(0.62, 0.14, 0.46, METAL_D, { at: [bx, yt + 0.07, bz], round: 0.03 });
  for (const s of [-1, 1]) b.box(0.06, 0.3, 0.3, METAL, { at: [bx + s * 0.26, yt + 0.27, bz] });
  b.cyl(0.13, 0.13, 0.46, METAL_L, { at: [bx, yt + 0.32, bz], rot: [0, 0, Math.PI / 2], n: 10 });
  b.cyl(0.15, 0.15, 0.08, TEAM, { at: [bx, yt + 0.32, bz], rot: [0, 0, Math.PI / 2], use: 1, emit: 0.6, n: 10 });
  b.cyl(0.022, 0.022, 0.78, CREAM, { at: [bx, yt + 0.79, bz], n: 4 });
  b.cone(0.16, 0.24, TEAM, { at: [bx, yt + 1.2, bz], rot: [Math.PI, 0, 0], emit: 0.5, use: 1, n: 8 });
  b.sph(0.9, TEAM, { at: [bx, 4.5, bz], scale: [1, 1.12, 1], emit: 0.5, use: 1, w: 16, h: 10 });
  if (F) ring(b, 0.12, 0.03, TEAM, { at: [bx, 3.5, bz], use: 4, n: 10, rs: 3 });
  // 접시 안테나: 받침 · 기둥 · 고개 · 접시(두께 있는 돌림 몸) · 수신기 다리 셋 · 팀 색 끝
  {
    const ax = 1.05, az = -1.45, ay = yt;
    b.cyl(0.3, 0.34, 0.12, METAL_D, { at: [ax, ay + 0.06, az], n: 12 });
    b.cyl(0.07, 0.09, 0.5, METAL, { at: [ax, ay + 0.37, az], n: 8 });
    b.box(0.3, 0.12, 0.16, METAL_D, { at: [ax, ay + 0.64, az], round: 0.03 });
    const tilt = [0.85, 0.35, 0];
    const pts = [];
    const nd = b.seg(4, 2);
    for (let i = 0; i <= nd; i++) { const r = (i / nd) * 0.66; pts.push([r, 0.3 * (r / 0.66) ** 2 - 0.05]); }
    pts.push([0.7, 0.31]);
    for (let i = nd; i >= 0; i--) { const r = (i / nd) * 0.62; pts.push([r, 0.3 * (r / 0.66) ** 2 + 0.01]); }
    const dc = [ax, ay + 0.78, az];
    lathe(b, pts, METAL_L, { at: dc, rot: tilt, n: 14 });
    // 접시의 축(돌린 y) 방향
    const e = new THREE.Euler(...tilt), ax3 = new THREE.Vector3(0, 1, 0).applyEuler(e);
    const tip = [dc[0] + ax3.x * 0.55, dc[1] + ax3.y * 0.55, dc[2] + ax3.z * 0.55];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      const rim = new THREE.Vector3(Math.cos(a) * 0.56, 0.24, Math.sin(a) * 0.56).applyEuler(e);
      rod(b, [dc[0] + rim.x, dc[1] + rim.y, dc[2] + rim.z], tip, 0.02, METAL_D, { n: 4 });
    }
    b.cyl(0.05, 0.07, 0.14, METAL_D, { at: tip, rot: tilt, n: 8 });
    b.sph(0.07, TEAM, { at: [tip[0] + ax3.x * 0.09, tip[1] + ax3.y * 0.09, tip[2] + ax3.z * 0.09], emit: 1.6, use: 1, w: 6, h: 4 });
  }
  // 안테나 기둥(앞 오른쪽): 가로대 둘 · 빛 구슬
  const mx0 = 1.45, mz0 = -0.12;
  b.cyl(0.13, 0.15, 0.1, METAL_D, { at: [mx0, yt + 0.05, mz0], n: 8 });
  b.cyl(0.03, 0.04, 1.45, METAL_L, { at: [mx0, yt + 0.8, mz0], n: 5 });
  for (const [y, w] of [[yt + 0.95, 0.5], [yt + 1.3, 0.34]]) b.box(w, 0.03, 0.03, METAL_L, { at: [mx0, y, mz0] });
  b.sph(0.09, TEAM, { at: [mx0, yt + 1.56, mz0], emit: 1.7, use: 1, w: 8, h: 6 });
  // 환기구(살 넷) · 환풍기(테 · 날개 셋)
  b.box(0.56, 0.26, 0.42, METAL_D, { at: [0.3, yt + 0.13, -0.3], round: 0.04 });
  if (F) for (let k = 0; k < 4; k++) b.box(0.46, 0.03, 0.05, METAL_L, { at: [0.3, yt + 0.27, -0.45 + k * 0.1] });
  const fx = -1.3, fz = -0.2;
  b.cyl(0.3, 0.32, 0.18, METAL, { at: [fx, yt + 0.09, fz], n: 14 });
  ring(b, 0.25, 0.035, METAL_L, { at: [fx, yt + 0.19, fz], n: 12, rs: 3 });
  for (let k = 0; k < 3; k++) b.box(0.2, 0.02, 0.09, METAL_L, { at: [fx + Math.cos((k * TAU) / 3) * 0.11, yt + 0.17, fz + Math.sin((k * TAU) / 3) * 0.11], rot: [0.3, (-k * TAU) / 3, 0] });
  b.sph(0.055, TEAM, { at: [fx, yt + 0.19, fz], emit: 1.2, use: 1, w: 6, h: 4 });
  // ── 앞마당 ──
  // 잉크 통(왼쪽 앞)
  {
    const vx = -1.72, vz = 1.15;
    b.cyl(0.42, 0.46, 0.2, METAL_D, { at: [vx, 0.48, vz], n: 14 });
    b.cyl(0.34, 0.34, 0.82, TEAM, { at: [vx, 0.99, vz], emit: 1.1, use: 1, n: 14 });
    b.cyl(0.34, 0.34, 0.34, GLASS, { at: [vx, 1.57, vz], emit: 0.12, n: 14 });
    ring(b, 0.345, 0.025, CREAM, { at: [vx, 1.4, vz], emit: 1.2, n: 12, rs: 3 });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + TAU / 8;
      b.box(0.06, 1.18, 0.06, METAL_L, { at: [vx + Math.sin(a) * 0.35, 1.17, vz + Math.cos(a) * 0.35], rot: [0, a, 0] });
    }
    b.cyl(0.4, 0.38, 0.14, METAL_D, { at: [vx, 1.8, vz], n: 14 });
    b.sph(0.2, METAL, { at: [vx, 1.87, vz], scale: [1, 0.6, 1], w: 10, h: 6 });
    for (const [x, y, r] of [[-0.1, 0.95, 0.06], [0.08, 1.2, 0.045], [-0.02, 0.7, 0.05]]) b.sph(r, CREAM, { at: [vx + x, y, vz + 0.33], emit: 1.3, w: 6, h: 4 });
    tube(b, [[vx, 1.92, vz], [vx + 0.05, 2.12, vz - 0.35], [vx + 0.1, 2.02, zf + 0.25], [vx + 0.12, 1.92, zf + 0.04]], 0.05, METAL_L, { len: 10 });
  }
  // 작업대 + 유리 기구
  {
    const cx = -0.15, cz = 1.55, ty = 1.0;
    b.box(1.86, 0.1, 0.72, WOOD, { at: [cx, ty, cz], round: 0.03 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.1, 0.56, 0.1, WOOD_D, { at: [cx + sx * 0.84, 0.67, cz + sz * 0.28] });
    b.box(1.7, 0.05, 0.56, WOOD_M, { at: [cx, 0.6, cz] });
    for (const s of [-1, 1]) {
      b.box(0.62, 0.18, 0.04, WOOD_M, { at: [cx + s * 0.4, 0.84, cz + 0.35] });
      b.sph(0.035, METAL_L, { at: [cx + s * 0.4, 0.84, cz + 0.38], w: 6, h: 4 });
    }
    const top = ty + 0.05;
    // 삼각 플라스크(라임)
    lathe(b, [[0, 0], [0.22, 0], [0.24, 0.03], [0.2, 0.12], [0.09, 0.3], [0.07, 0.33]], LIME, { at: [cx - 0.62, top, cz], emit: 1.1, n: 14 });
    b.cyl(0.065, 0.065, 0.18, GLASS, { at: [cx - 0.62, top + 0.42, cz], n: 8, emit: 0.15 });
    b.torus(0.07, 0.02, GLASS, { at: [cx - 0.62, top + 0.51, cz], rot: [Math.PI / 2, 0, 0], n: 8, emit: 0.15 });
    // 둥근 플라스크(팀 색) + 받침 고리
    ring(b, 0.14, 0.03, METAL_L, { at: [cx - 0.12, top + 0.03, cz - 0.05], n: 10, rs: 3 });
    b.sph(0.22, TEAM, { at: [cx - 0.12, top + 0.22, cz - 0.05], emit: 1.1, use: 1, w: 10, h: 8 });
    b.cyl(0.055, 0.055, 0.24, GLASS, { at: [cx - 0.12, top + 0.52, cz - 0.05], n: 8, emit: 0.15 });
    b.cyl(0.065, 0.06, 0.07, WOOD, { at: [cx - 0.12, top + 0.66, cz - 0.05], n: 8 });
    // 비커(시안 — 아래 잉크, 위 유리) + 눈금
    b.cyl(0.15, 0.14, 0.2, CYAN, { at: [cx + 0.32, top + 0.1, cz + 0.06], emit: 1.1, n: 12 });
    b.cyl(0.155, 0.15, 0.14, GLASS, { at: [cx + 0.32, top + 0.27, cz + 0.06], emit: 0.15, n: 12 });
    if (F) for (const y of [0.12, 0.2, 0.28]) b.box(0.06, 0.012, 0.01, METAL_D, { at: [cx + 0.27, top + y, cz + 0.215] });
    // 시험관 꽂이
    b.box(0.5, 0.06, 0.2, WOOD_D, { at: [cx + 0.66, top + 0.2, cz - 0.05], round: 0.02 });
    for (const s of [-1, 1]) b.box(0.05, 0.22, 0.2, WOOD_D, { at: [cx + 0.66 + s * 0.23, top + 0.11, cz - 0.05] });
    [CYAN, YELLOW, TEAM, LIME].forEach((c, k) => {
      const x = cx + 0.49 + k * 0.113;
      b.cyl(0.038, 0.038, 0.34, c, { at: [x, top + 0.2, cz - 0.05], emit: 1.1, use: c === TEAM ? 1 : 0, n: 6 });
      b.sph(0.038, c, { at: [x, top + 0.03, cz - 0.05], emit: 1.1, use: c === TEAM ? 1 : 0, w: 6, h: 4 });
    });
  }
  // 발사대 위 미사일(오른쪽 앞)
  {
    const mx = 1.72, mz = 1.0;
    b.box(0.82, 0.12, 0.82, METAL_D, { at: [mx, 0.44, mz], round: 0.04 });
    for (const s of [-1, 1]) b.box(0.08, 1.9, 0.12, METAL_L, { at: [mx + s * 0.32, 1.45, mz - 0.1] });
    for (const y of [1.05, 1.95]) b.box(0.72, 0.08, 0.1, METAL_D, { at: [mx, y, mz - 0.22] });
    const yb = 0.72;
    b.cone(0.17, 0.2, METAL_D, { at: [mx, yb - 0.08, mz], rot: [Math.PI, 0, 0], n: 10 });
    b.cyl(0.24, 0.22, 1.55, 0xe8e6f5, { at: [mx, yb + 0.78, mz], n: 12 });
    lathe(b, [[0.24, 0], [0.23, 0.18], [0.18, 0.38], [0.1, 0.55], [0, 0.66]], TEAM, { at: [mx, yb + 1.55, mz], emit: 0.6, use: 1, n: 12 });
    for (const y of [yb + 0.45, yb + 1.3]) b.cyl(0.245, 0.245, 0.08, TEAM, { at: [mx, y, mz], emit: 0.6, use: 1, n: 12 });
    b.cyl(0.08, 0.08, 0.03, CREAM, { at: [mx, yb + 0.95, mz + 0.235], rot: [Math.PI / 2, 0, 0], emit: 0.8, n: 8 });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + TAU / 8;
      b.box(0.04, 0.42, 0.28, TEAM, { at: [mx + Math.sin(a) * 0.32, yb + 0.12, mz + Math.cos(a) * 0.32], rot: [0, a, 0], emit: 0.5, use: 1 });
    }
  }
}

// ------------------------------------------------------------------ 몬스터 퍼실리티(6u)
// 뒤쪽 우리 집: 세로 널판 벽(두 톤) · 모서리 기둥 · 쇠띠(볼트) · 맞배지붕(팀 색 기와 줄 · 용마루) · 지붕의 발바닥 무늬 · 둥근 쇠 해치(팀 색 고리) · 경고판 · 할퀸 자국.
// 앞: 잔가지 둥지(깃털 = 팀 색) + 큰 알(팀 색 점 · 금 사이로 팀 색 빛). 우리: 팀 색 바닥 고리 · 위 · 가운데 고리(앞은 문) · 창살(뾰족 끝) · 문기둥(팀 색 등) ·
// 열어 둔 문짝. 우리 안 앞쪽: 밥그릇과 뼈 · 바닥 할퀸 자국.
export function facility(b) {
  const F = fine(b);
  plinth(b, 2.85);
  const W = 3.2, Zh = -1.55, zf = -0.93, yb = 0.38;
  // 집 몸 + 널판
  b.box(W, 1.58, 1.24, WOOD_D, { at: [0, yb + 0.79, Zh] });
  const np = 7, pw = W / np;
  for (let k = 0; k < np; k++) {
    const x = -W / 2 + pw * (k + 0.5);
    const h = 1.54 + ((k * 37) % 5) * 0.012;
    b.box(pw - 0.035, h, 0.08, k % 2 ? WOOD_M : WOOD, { at: [x, yb + h / 2, zf + 0.02] });
  }
  for (const sx of [-1, 1]) for (const z of [zf + 0.02, Zh - 0.62]) b.box(0.24, 1.72, 0.24, WOOD_D, { at: [sx * (W / 2 + 0.02), yb + 0.86, z] });
  for (const y of [yb + 0.42, yb + 1.3]) {
    b.box(W + 0.1, 0.12, 0.05, IRON, { at: [0, y, zf + 0.08] });
    if (F) for (let k = 0; k < 4; k++) bolt(b, [-1.38 + k * 0.92, y, zf + 0.11], 0.035);
  }
  // 맞배지붕: 앞 비탈(팀 짙은 톤 + 팀 색 기와 줄 셋) · 뒤 비탈 · 용마루
  const RW = W + 0.3, ang = 0.6, ze = zf + 0.28, ye = yb + 1.62, zr = Zh, yr = ye + Math.tan(ang) * (ze - zr);
  const sl = Math.hypot(ze - zr, yr - ye) + 0.05;
  b.box(RW, 0.1, sl, TEAM, { at: [0, (ye + yr) / 2, (ze + zr) / 2], rot: [ang, 0, 0], use: 4, emit: 0.15 });
  const up = [0, Math.sin(ang), -Math.cos(ang)], nrm = [0, Math.cos(ang), Math.sin(ang)];
  const onRoof = (dx, s, dn) => [dx, ye + up[1] * s + nrm[1] * dn, ze + up[2] * s + nrm[2] * dn];
  for (let k = 0; k < 3; k++) b.box(RW, 0.07, 0.2, TEAM, { at: onRoof(0, 0.1 + k * 0.36, 0.07), rot: [ang, 0, 0], use: 1, emit: 0.4 });
  b.box(RW, 0.1, sl * 0.8, TEAM, { at: [0, yr - (yr - ye) * 0.4, zr - (ze - zr) * 0.4], rot: [-ang, 0, 0], use: 4, emit: 0.1 });
  b.cyl(0.1, 0.1, RW + 0.1, METAL_D, { at: [0, yr + 0.04, zr], rot: [0, 0, Math.PI / 2], n: 8 });
  // 지붕의 발바닥 무늬(크림 빛)
  {
    const px = 0.85, ps = 0.6;
    b.sph(0.17, CREAM, { at: onRoof(px, ps, 0.1), rot: [ang, 0, 0], scale: [1.25, 0.35, 1], emit: 0.8, w: 10, h: 6 });
    for (const [dx, s] of [[-0.24, 0.17], [-0.09, 0.27], [0.09, 0.27], [0.24, 0.17]]) b.sph(0.075, CREAM, { at: onRoof(px + dx, ps + s, 0.1), rot: [ang, 0, 0], scale: [1, 0.4, 1], emit: 0.8, w: 6, h: 4 });
  }
  // 둥근 쇠 해치(왼쪽) + 경고판
  {
    const hx = -0.95, hy = yb + 0.86, hz = zf + 0.14;
    b.cyl(0.44, 0.44, 0.08, METAL_D, { at: [hx, hy, hz], rot: [Math.PI / 2, 0, 0], n: 16 });
    b.add(new THREE.TorusGeometry(0.44, 0.07, b.seg(5, 3), b.seg(18, 10)), METAL_L, { at: [hx, hy, hz + 0.03] });
    b.add(new THREE.TorusGeometry(0.3, 0.035, b.seg(4, 3), b.seg(16, 10)), TEAM, { at: [hx, hy, hz + 0.05], emit: 1.3, use: 1 });
    for (const a of [Math.PI / 4, -Math.PI / 4]) b.box(0.56, 0.07, 0.05, IRON, { at: [hx, hy, hz + 0.08], rot: [0, 0, a] });
    b.cyl(0.08, 0.08, 0.08, METAL_L, { at: [hx, hy, hz + 0.1], rot: [Math.PI / 2, 0, 0], n: 8 });
    if (F) for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      b.sph(0.035, METAL_D, { at: [hx + Math.cos(a) * 0.44, hy + Math.sin(a) * 0.44, hz + 0.1], w: 5, h: 3 });
    }
    prism(b, 0.24, 0.24, 0.04, 3, YELLOW, { at: [hx, yb + 1.52, zf + 0.12], rot: [-Math.PI / 2, 0, 0], face: false, emit: 0.4 });
    b.box(0.04, 0.11, 0.03, DARK, { at: [hx, yb + 1.53, zf + 0.15] });
    b.box(0.04, 0.035, 0.03, DARK, { at: [hx, yb + 1.44, zf + 0.15] });
  }
  // 할퀸 자국(오른쪽 벽 — 팀 색 빛이 비친다)
  for (let k = 0; k < 3; k++) {
    b.box(0.07, 0.72, 0.03, DARK, { at: [0.72 + k * 0.2, yb + 1.0 - k * 0.04, zf + 0.08], rot: [0, 0, 0.42] });
    b.box(0.025, 0.6, 0.02, TEAM, { at: [0.72 + k * 0.2, yb + 1.0 - k * 0.04, zf + 0.1], rot: [0, 0, 0.42], emit: 1.2, use: 1 });
  }
  // 둥지: 고리 둘 + 잔가지 + 깃털(팀 색)
  const nz = 0.5;
  b.torus(1.1, 0.3, WOOD_M, { at: [0, 0.62, nz], rot: [Math.PI / 2, 0, 0], n: 18 });
  b.torus(0.86, 0.2, WOOD_D, { at: [0, 0.86, nz], rot: [Math.PI / 2, 0, 0.4], n: 16 });
  const nt = F ? 16 : 8;
  for (let k = 0; k < nt; k++) {
    const a = (k / nt) * TAU + 0.2;
    const r = 1.1 + ((k * 7) % 3) * 0.08, y = 0.72 + ((k * 5) % 3) * 0.1;
    const t = [-Math.sin(a), Math.cos(a)], tl = 0.48, tilt = ((k % 3) - 1) * 0.12;
    const c = [Math.cos(a) * r, y, nz + Math.sin(a) * r];
    rod(b, [c[0] - t[0] * tl, c[1] - tilt, c[2] - t[1] * tl], [c[0] + t[0] * tl, c[1] + tilt, c[2] + t[1] * tl], 0.035, k % 2 ? WOOD_D : WOOD, { n: 5 });
  }
  for (const [a, tilt] of [[2.3, 0.5], [0.7, -0.6], [1.6, 0.2]]) {
    const p = [Math.cos(a) * 1.0, 1.05, nz + Math.sin(a) * 1.0];
    b.cone(0.09, 0.5, TEAM, { at: p, rot: [tilt, a, -0.5], scale: [1, 1, 0.35], emit: 0.6, use: 1, n: 6 });
  }
  // 알: 매끈한 돌림 몸 + 팀 색 점 + 금(팀 색 빛)
  const ey = 0.5, eh = 1.85;
  const er = (s) => 0.74 * Math.sin(Math.PI * s) ** 0.8 * (1.06 - 0.2 * s);
  const ep = [];
  const ne = b.seg(12, 6);
  for (let i = 0; i <= ne; i++) ep.push([er(i / ne), (i / ne) * eh]);
  lathe(b, ep, CREAM, { at: [0, ey, nz], n: 18 });
  for (const [s, a, r] of [[0.55, 0.3, 0.12], [0.4, -0.45, 0.1], [0.72, -0.15, 0.09], [0.3, 0.75, 0.08], [0.62, 1.1, 0.1], [0.5, -1.2, 0.09]]) {
    const R = er(s) * 0.96;
    b.sph(r, TEAM, { at: [Math.sin(a) * R, ey + s * eh, nz + Math.cos(a) * R], scale: [1, 1, 0.6], rot: [0, a, 0], emit: 0.8, use: 1, w: 7, h: 5 });
  }
  {
    const zig = [[-0.95, 0.66], [-0.7, 0.69], [-0.55, 0.655], [-0.3, 0.7], [-0.05, 0.675], [0.12, 0.71], [0.4, 0.68], [0.6, 0.7], [0.88, 0.665]];
    const p = (a, s) => { const R = er(s) + 0.005; return [Math.sin(a) * R, ey + s * eh, nz + Math.cos(a) * R]; };
    for (let i = 0; i + 1 < zig.length; i++) rod(b, p(...zig[i]), p(...zig[i + 1]), 0.024, TEAM, { emit: 1.6, use: 1, n: 4 });
    rod(b, p(-0.3, 0.7), p(-0.22, 0.76), 0.02, TEAM, { emit: 1.6, use: 1, n: 4 });
  }
  // 우리: 바닥 고리(팀 색) · 위 · 가운데 고리(앞 문은 비움) · 창살 · 뾰족 끝
  const cz = 0.2, CR = 2.3, gate = 0.62, front = Math.PI / 2;
  ring(b, CR, 0.09, TEAM, { at: [0, 0.45, cz], emit: 1, use: 1, n: 30, rs: 4 });
  const a0 = -0.5, a1 = Math.PI + 0.5;
  for (const [from, to] of [[a0, front - gate], [front + gate, a1]]) {
    ring(b, CR, 0.07, METAL_L, { at: [0, 2.55, cz], from, len: to - from, n: 12 });
    ring(b, CR, 0.045, METAL, { at: [0, 1.5, cz], from, len: to - from, n: 12, rs: 4 });
    const nb = Math.round((to - from) / 0.2);
    for (let k = 0; k <= nb; k++) {
      const a = from + ((to - from) * k) / nb;
      const x = Math.cos(a) * CR, z = cz + Math.sin(a) * CR;
      b.cyl(0.05, 0.05, 2.2, METAL_L, { at: [x, 1.55, z], n: 6 });
      if (F || k % 2 === 0) b.cone(0.075, 0.2, METAL_L, { at: [x, 2.72, z], n: 6 });
    }
  }
  // 문기둥 + 팀 색 등 + 열어 둔 문짝(오른쪽 기둥에 매달려 우리 바깥쪽으로 젖혀 있다)
  for (const s of [-1, 1]) {
    const a = front - s * gate;
    const x = Math.cos(a) * CR, z = cz + Math.sin(a) * CR;
    b.box(0.22, 2.4, 0.22, METAL_D, { at: [x, 1.58, z] });
    b.sph(0.13, TEAM, { at: [x, 2.88, z], emit: 1.6, use: 1, w: 8, h: 6 });
  }
  {
    const a = front - gate;
    const hx = Math.cos(a) * CR, hz = cz + Math.sin(a) * CR;
    const ux = Math.sin(a) * 0.98 + Math.cos(a) * 0.2, uz = -Math.cos(a) * 0.98 + Math.sin(a) * 0.2; // 바깥으로 조금 벌어진 접선
    const L = 1.0;
    const P = (t, y) => [hx + ux * t, y, hz + uz * t];
    rod(b, P(0.1, 0.6), P(L, 0.6), 0.04, METAL_L, { n: 5 });
    rod(b, P(0.1, 2.2), P(L, 2.2), 0.04, METAL_L, { n: 5 });
    rod(b, P(L, 0.6), P(L, 2.2), 0.045, METAL_L, { n: 5 });
    for (let k = 1; k <= 3; k++) rod(b, P((L * k) / 4, 0.6), P((L * k) / 4, 2.2), 0.035, METAL_L, { n: 5 });
    b.box(0.8, 0.08, 0.05, TEAM, { at: P(L * 0.55, 1.4), rot: [0, -Math.atan2(uz, ux), 0], emit: 1.0, use: 1 });
  }
  // 앞 왼쪽: 밥그릇과 뼈
  {
    const gx = -0.98, gz = 1.88;
    lathe(b, [[0.14, 0], [0.22, 0.02], [0.26, 0.15], [0.22, 0.17], [0.18, 0.06], [0, 0.06]], TEAM, { at: [gx, 0.38, gz], use: 1, emit: 0.4, n: 14 });
    b.cyl(0.19, 0.19, 0.04, 0xc98a5a, { at: [gx, 0.5, gz], n: 12 });
    rod(b, [gx - 0.18, 0.58, gz + 0.04], [gx + 0.18, 0.58, gz - 0.04], 0.04, CREAM, { n: 6 });
    for (const s of [-1, 1]) for (const d of [-1, 1]) b.sph(0.05, CREAM, { at: [gx + s * 0.2, 0.58, gz - s * 0.045 + d * 0.045], w: 6, h: 5 });
  }
  // 바닥 할퀸 자국(앞 오른쪽, 우리 안)
  for (let k = 0; k < 3; k++) b.box(0.07, 0.02, 0.55, DARK, { at: [0.75 + k * 0.17, 0.385, 1.95 - k * 0.04], rot: [0, 0.5, 0] });
}
