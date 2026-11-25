// 던전 몬스터(3D — 던전 경기): 팀마다 제 길에서 만나는 NPC 몬스터 여덟 종류를 진짜 3D 인형으로 그린다.
//   0 꼬마 잉크 슬라임(1단계 · 작다) — 말랑한 젤리 돔, 큰 눈, 더듬이, 발 뭉치. 통통 뛰어 다닌다(눌림 · 늘어남).
//   1 뿔 잉크 도깨비(2단계) — 어깨가 떡 벌어진 장사: 역삼각 몸통 · 따로 노는 머리(뿔 둘 · 산발 · 송곳니 웃음) · 굵은 팔다리 ·
//     호랑이 가죽 치마 · 오른손에 쇠징 박힌 방망이. 내려찍기(slam) · 휘두르며 한 바퀴(spin).
//   2 잉크 대왕(3단계 · 보스 · 거인) — 뿔 투구 위 금관, 빛나는 노란 눈, 가시 어깨갑옷, 무릎까지 닿는 긴 팔과 발톱 주먹, 기둥 다리,
//     너덜너덜한 망토, 가슴의 하늘빛 보석. 두 주먹 내려찍기(slam) · 뛰어올라 덮치기(leap) · 발 구르기 충격파(wave). 성나면(rage) 붉게.
//   3 잉크 박쥐(1단계) — 마름모 보석 같은 몸, 들쭉날쭉한 날개, 뾰족 귀, 송곳니. 떠서 날갯짓, 덮치기(lunge = 내리꽂기).
//   4 잉크 고블린(1단계) — 깡마른 꼬마: 큰 뾰족 귀 · 긴 코 · 능글맞은 웃음 · 빨간 두건과 목도리, 손에 심지가 타는 잉크 폭탄. 던지기(toss).
//   5 먹물 오징어(2단계) — 화살촉 같은 몸통 위 세모 지느러미, 아래쪽 큰 눈, 다리 여섯 + 긴 촉완 둘, 빛나는 점. 먹물 쏘기(shoot).
//   6 돌진 멧돼지(2단계) — 각진 통 몸, 굽은 엄니, 노란 갈기, 네 다리. 돌진(charge → dash), 벽에 부딪히면 어질어질(stun · 별).
//   7 잉크 거미 여왕(3단계 · 보스) — 각진 등딱지, 가시 돋친 배와 빛나는 모래시계 무늬, 눈 여섯, 엄니, 작은 금관, 마디진 다리 여덟.
//     부채꼴 먹물(shoot — 일어선다) · 덮치기(leap — 다리를 벌리고 난다).
// 몬스터 한 마리 = 부위(몸통 · 머리 · 눈 · 팔 · 아랫팔 · 다리 · 날개 · 촉수 …)를 한 장으로 합친 지오메트리(종류마다 한 장을 함께 쓴다) +
// 부위마다 행렬(유니폼 배열 — Object3D 계층으로 자세를 계산해 넣는다. 아랫팔은 윗팔에, 눈은 머리에 매달린다). 그리기 2번(본 그림 · 외곽선).
// 발밑 그림자 · 잉크 웅덩이(나타나기 · 쓰러짐)와 머리 위 체력 막대는 모든 몬스터를 묶어 각각 그리기 1번.
// 몬스터가 쏜 잉크 덩이(고블린은 폭탄)도 묶음 하나(본 그림 1번 + 외곽선 1번 — 그림자는 발밑 묶음에 함께).
// 재질: 캐릭터와 같은 툰 3단계(그늘은 보랏빛) + 반짝 + 테두리 빛 + 섬광 점광 + 안개 + 짙은 외곽선. 맞으면 하얗게 번쩍, 기를 모으면 외곽선 ·
// 테두리가 종류 색으로 빛나고, 성나면 눈 · 보석 · 외곽선이 붉게 타고, 퀴즈를 푸는 동안(frozen)은 얼음빛으로 멈춘다. 그림자 맵(화질 중 · 고)에도 든다.
//
// 한 프레임: begin(time) → draw(m, time) × 보이는 몬스터 · shot(s) × 날아가는 덩이 → end().
//   m = { id, kind(0~7), x, z(발 — 바닥 y 0), face(라디안 — (cos, sin) 쪽을 본다), scale, hp(0..1), moving(0..1), windup(−1 | 0..1),
//         hit(0..1), spawn(0..1), dying(0..1), frozen,
//         (덧 — 없으면 옛 동작) atk("" | lunge | slam | spin | shoot | charge | toss | leap | wave — 지금 모으는 기가 무엇인지),
//         dash(돌진 중), stun(0..1 어질어질), fire(0..1 — 공격이 나간 순간 1, 부르는 쪽이 0.3 초쯤에 걸쳐 줄인다), air(발이 뜬 높이 u), rage(성남) }
//   s = { x, y(바닥에서 높이), z, kind(쏜 몬스터 — 색 · 고블린은 폭탄), dx, dz(날아가는 쪽 단위 벡터), r(판정 반지름 u), id(덧 — 출렁임 씨앗) }
// 크기: scale 1 에서 슬라임은 폭 약 1.4u · 키 약 1.5u. scale 이 모두를 똑같이 키운다(대왕 2.8 · 거미 여왕 2.6 은 캐릭터의 두세 배).
import * as THREE from "three";
import { PROJ } from "./camera.js";
import { GLSL_LIGHTS, GLSL_FOG } from "./glsl.js";
import { STYLE } from "./style.js";
import { SHADOW_LAYER } from "./props3d.js";
import { mixHex } from "./palette.js";

/** 부위 행렬 칸 수(종류마다 이만큼까지 쓴다 — 정점 셰이더 유니폼: 칸마다 mat4 + mat3 = vec4 7개) */
export const MONSTER_PARTS = 16;
const MAX_INST = 64; // 체력 막대 묶음의 칸
const MAX_GROUND = 128; // 발밑 묶음의 칸(몬스터 그림자 · 웅덩이 + 날아가는 덩이의 그림자)
export const MAX_SHOTS = 64; // 날아가는 덩이 묶음의 칸
const KEEP = 10; // 안 보인 지 이만큼(초) 지나면 그 몬스터의 풀을 버린다
const SLAM_T = 0.35; // 기 모으기가 끝난 뒤 내려찍는 동작(초)
const REL_T = 0.55; // 돌기(spin) · 발 구르기(wave) 뒷동작(초)
const LAND_T = 0.4; // 뛰어올랐다 내려앉아 눌리는 동작(초)
const LINE_DETAIL = 0.55; // 외곽선 껍질의 분할(거칠어도 티가 안 난다)
const TAU = Math.PI * 2;
const CS = STYLE.character;

/** 종류 표: 이름 · 기본 크기 · 몸 색 · 잉크 색(웅덩이 · 튀는 잉크 · 쏜 덩이) · 기 모으기 빛 색 · 키(scale 1, u) · 폭 */
export const MONSTER_KINDS = Object.freeze([
  Object.freeze({ key: "slime", name: "꼬마 잉크 슬라임", scale: 1, color: 0x8cff2e, ink: 0x5fd62a, glow: 0xeaff3a, top: 1.5, width: 1.42 }),
  Object.freeze({ key: "dokkaebi", name: "뿔 잉크 도깨비", scale: 1.6, color: 0xff6b1f, ink: 0xff4a1a, glow: 0xffb21a, top: 2.02, width: 1.5 }),
  Object.freeze({ key: "king", name: "잉크 대왕", scale: 2.8, color: 0x5a2fd8, ink: 0x6a36e8, glow: 0xff2dd8, top: 2.2, width: 1.75 }),
  Object.freeze({ key: "bat", name: "잉크 박쥐", scale: 0.95, color: 0xff3d9a, ink: 0xff2d95, glow: 0xff9be0, top: 1.65, width: 1.1 }),
  Object.freeze({ key: "goblin", name: "잉크 고블린", scale: 1, color: 0x3bbfa0, ink: 0x14c9a4, glow: 0xffa21a, top: 1.48, width: 1.15 }),
  Object.freeze({ key: "squid", name: "먹물 오징어", scale: 1.5, color: 0x3150e0, ink: 0x1f4fd8, glow: 0x46e0ff, top: 1.75, width: 1.6 }),
  Object.freeze({ key: "boar", name: "돌진 멧돼지", scale: 1.55, color: 0x8e3b22, ink: 0xd2462a, glow: 0xffd23a, top: 1.42, width: 1.7 }),
  Object.freeze({ key: "spider", name: "잉크 거미 여왕", scale: 2.6, color: 0x163a4a, ink: 0x18b8c8, glow: 0xff2dd8, top: 1.5, width: 2.3 }),
]);
/** 보스(체력 막대가 굵고 금테 · 10칸 눈금): 대왕 · 거미 여왕 */
const BOSS_KINDS = new Set([2, 7]);
export const isBossKind = (kind) => BOSS_KINDS.has(kind | 0);
/** atk 가 비었을 때 종류마다 모으는 기(옛 부르는 쪽 — 슬라임 · 도깨비 · 대왕은 내려찍기) */
const DEF_ATK = ["slam", "slam", "slam", "lunge", "toss", "shoot", "charge", "shoot"];

// 셰이더 재질 번호(aFx.y)
const MAT = { matte: 0, gloss: 1, core: 2, eye: 3, tiger: 4, gold: 5, glowEye: 6, shiny: 7, fur: 8 };

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const v3s = (a) => `vec3(${a.map((x) => x.toFixed(5)).join(", ")})`;
const lin = (hex) => {
  const c = new THREE.Color().setHex(hex);
  return [c.r, c.g, c.b];
};
const LDIR = (() => {
  const r = PROJ.right, u = PROJ.up, v = PROJ.view;
  const l = [0, 1, 2].map((i) => -0.6 * r[i] + 0.7 * u[i] + 0.4 * v[i]);
  const n = Math.hypot(...l);
  return l.map((x) => x / n);
})();
const UP = new THREE.Vector3(0, 1, 0);
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const norm3 = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
/** 로컬 +y 를 d 쪽으로 돌리는 회전 */
const upTo = (d) => new THREE.Quaternion().setFromUnitVectors(UP, V3(norm3(d)));
/** 축 그림(모양 X · Y · Z 가 몸 좌표의 어느 쪽인지)으로 회전 */
const basisQ = (X, Y, Z) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V3(X), V3(Y), V3(Z)));

// ------------------------------------------------------------------ 지오메트리
/** 옆모습(반지름, 높이 — 아래에서 위로) → 매끈한 선(돌림판 단면) */
function profile(pts, n) {
  const c = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y)));
  return c.getPoints(n).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
}
/** 단면의 높이 y 에서 반지름 */
function radiusAt(pr, y) {
  for (let i = 1; i < pr.length; i++) {
    if (pr[i].y >= y) {
      const a = pr[i - 1], b = pr[i];
      return a.x + (b.x - a.x) * ((y - a.y) / (b.y - a.y || 1));
    }
  }
  return 0;
}
/** 몸 겉면 위의 앞쪽(+x) 점: 높이 y · 옆 z 에서 겉면의 x */
const surfX = (pr, y, z) => Math.sqrt(Math.max(0, radiusAt(pr, y) ** 2 - z * z));
/** 타원체(가운데 c · 반지름 r3) 겉면의 앞쪽 x: 높이 y · 옆 z 에서 */
const ellX = (c, r3, y, z) => c[0] + r3[0] * Math.sqrt(Math.max(0, 1 - ((y - c[1]) / r3[1]) ** 2 - ((z - c[2]) / r3[2]) ** 2));

/**
 * 몬스터 하나를 짓는 도구: 부위(part)마다 축(pivot — 몸 좌표)을 정하고 도형을 몸 좌표로 놓으면, 부위 좌표(축 기준)로 바꿔 한 장에 모은다.
 * 정점 속성: position · normal · aCol(선형 색) · aFx(x 발광, y 재질, z 외곽선 두께 배율) · aOut(외곽선 방향 — 같은 자리 법선 평균) · aPart.
 * line = true 면 외곽선 묶음(line: 0 인 작은 도형은 빼고 거칠게)
 */
function builder(detail, line, unit = 1) {
  const P = [], N = [], CO = [], F = [], A = [], I = [];
  const roles = [];
  let part = 0;
  let piv = [0, 0, 0];
  const seg = (n, min = 3) => Math.max(min, Math.round(n * detail));
  const m4 = new THREE.Matrix4(), n3 = new THREE.Matrix3(), q = new THREE.Quaternion(), eu = new THREE.Euler();
  const v = new THREE.Vector3(), nv = new THREE.Vector3(), col = new THREE.Color(), s3 = new THREE.Vector3(), t3 = new THREE.Vector3();
  const b = {
    seg,
    /**
     * 이제부터 놓는 도형의 부위: i, 축(몸 좌표), 역할(body · head · eye · brow · mouth · arm · fore · thigh · shin · foot · wing · leg …), 옆(−1 · +1),
     * o = { parent(이 부위가 매달리는 부위 번호), under("lean" — 몸통 눌림을 받지 않는다), 그 밖의 역할 값(k · dir · ang …) }
     */
    part(i, pivot, role, side = 0, o = {}) {
      part = i;
      piv = (pivot || [0, 0, 0]).map((x) => x * unit);
      roles[i] = { ...o, pivot: piv.slice(), role, side };
    },
    /** 이미 정한 부위 i 로 돌아가 도형을 더 놓는다 */
    use(i) {
      part = i;
      piv = roles[i].pivot;
    },
    /**
     * o = { at, rot, order, quat, scale, emit, mat, line(외곽선 두께 배율 — 0 이면 외곽선 없음), wrap(몸 둘레 반지름 — 몸을 감싸 휜다),
     *       flat(면마다 법선 — 각진 보석 같은 면) }
     */
    add(geo, color, o = {}) {
      if (line && o.line === 0) {
        geo.dispose();
        return;
      }
      if (o.flat) {
        const f = geo.index ? geo.toNonIndexed() : geo;
        if (f !== geo) geo.dispose();
        geo = f;
        geo.computeVertexNormals();
      }
      if (o.quat) q.copy(o.quat);
      else q.setFromEuler(eu.set(...(o.rot || [0, 0, 0]), o.order || "XYZ"));
      const at = o.at || [0, 0, 0];
      m4.compose(t3.set(...at), q, s3.set(...(o.scale || [1, 1, 1])));
      n3.getNormalMatrix(m4);
      const pos = geo.attributes.position, nor = geo.attributes.normal;
      const base = P.length / 3;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m4);
        nv.fromBufferAttribute(nor, i).applyMatrix3(n3).normalize();
        if (o.wrap) {
          // 몸 둘레(세로 축이 at.x − wrap 에 있는 원기둥)에 감는다: 옆으로 간 만큼 뒤로 휘고 법선도 돈다
          const ax = at[0] - o.wrap;
          const u = v.x - ax, ang = v.z / o.wrap;
          const c = Math.cos(ang), s = Math.sin(ang);
          v.x = ax + u * c;
          v.z = u * s;
          const nx = nv.x * c - nv.z * s, nz = nv.x * s + nv.z * c;
          nv.x = nx;
          nv.z = nz;
        }
        col.setHex(typeof color === "function" ? color(v, nv) : color);
        if (unit !== 1) v.multiplyScalar(unit);
        P.push(v.x - piv[0], v.y - piv[1], v.z - piv[2]);
        N.push(nv.x, nv.y, nv.z);
        CO.push(col.r, col.g, col.b);
        F.push(o.emit || 0, o.mat || 0, o.line ?? 1);
        A.push(part);
      }
      if (geo.index) for (let i = 0; i < geo.index.count; i++) I.push(base + geo.index.getX(i));
      else for (let i = 0; i < pos.count; i++) I.push(base + i);
      geo.dispose();
    },
    sph(r, color, o = {}) {
      b.add(new THREE.SphereGeometry(r, seg(o.w ?? 14, 6), seg(o.h ?? 10, 4)), color, o);
    },
    /** 돌림판(o.phi0 · o.phiLen — 일부만 돌리기, o.jag — 맨 아래 고리를 한 칸 걸러 이만큼 올려 너덜너덜하게) */
    lathe(pts, color, o = {}) {
      const g = new THREE.LatheGeometry(pts, seg(o.n ?? 24, 8), o.phi0 ?? 0, o.phiLen ?? TAU);
      if (o.jag) {
        const pos = g.attributes.position, n = pts.length, cols = pos.count / n;
        for (let i = 1; i < cols; i += 2) pos.setY(i * n, pos.getY(i * n) + o.jag);
      }
      b.add(g, color, o);
    },
    torus(R, t, color, o = {}) {
      b.add(new THREE.TorusGeometry(R, t, seg(o.r ?? 6, 4), seg(o.n ?? 18, 8), o.arc ?? TAU), color, o);
    },
    cone(r, h, color, o = {}) {
      b.add(new THREE.ConeGeometry(r, h, o.sides || seg(o.n ?? 8, 5), 1, !!o.open), color, o);
    },
    /** 두 점(몸 좌표)을 잇는 캡슐 */
    stick(a, c, r, color, o = {}) {
      const d = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
      const L = d.length();
      const g = new THREE.CapsuleGeometry(r, L, seg(o.cap ?? 3, 2), seg(o.n ?? 10, 6));
      b.add(g, color, { ...o, at: [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2], quat: new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()) });
    },
    /** 팔다리 마디: a 에서 c 로 굵기가 r0 → r1(가운데 mid 만큼 불룩), 양 끝은 반구 */
    limb(a, c, r0, r1, color, o = {}) {
      const d = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const L = Math.hypot(...d);
      const k = seg(o.cap ?? 3, 2);
      const pts = [];
      for (let i = 0; i <= k; i++) {
        const t = (i / k - 1) * (Math.PI / 2);
        pts.push(new THREE.Vector2(r0 * Math.cos(t), r0 * Math.sin(t)));
      }
      if (o.mid) pts.push(new THREE.Vector2(o.mid, L * 0.5));
      for (let i = 0; i <= k; i++) {
        const t = (i / k) * (Math.PI / 2);
        pts.push(new THREE.Vector2(r1 * Math.cos(t), L + r1 * Math.sin(t)));
      }
      pts[0].x = 0;
      pts[pts.length - 1].x = 0;
      const { rot, ...rest } = o;
      b.add(new THREE.LatheGeometry(pts, seg(o.n ?? 8, 5)), color, { ...rest, at: a, quat: upTo(d) });
    },
    /** 굽은 관(촉수 · 엄니 · 꼬리): 몸 좌표 점들을 잇는 매끈한 선, 굵기 r0 → r1(끝은 공으로 막는다) */
    tube(pts, r0, r1, color, o = {}) {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => V3(p)));
      const ns = seg(o.n ?? 14, 4), rs = seg(o.r ?? 8, 4);
      const g = new THREE.TubeGeometry(curve, ns, 1, rs, false);
      const pos = g.attributes.position;
      const c = new THREE.Vector3();
      for (let j = 0; j <= ns; j++) {
        const u = j / ns;
        curve.getPointAt(u, c);
        const r = r0 + (r1 - r0) * u;
        for (let k = 0; k <= rs; k++) {
          const i = j * (rs + 1) + k;
          pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * r, c.y + (pos.getY(i) - c.y) * r, c.z + (pos.getZ(i) - c.z) * r);
        }
      }
      const { at, rot, quat, scale, ...rest } = o;
      b.add(g, color, rest);
      if (o.tip !== false) b.sph(r1, color, { ...rest, at: pts[pts.length - 1], w: 6, h: 4 });
      return curve;
    },
    /** 납작한 판(2D 모양을 두께 depth 로 — 날개 막 · 지느러미 · 별): 모양 X · Y 는 o.quat 로 몸 좌표에 놓는다 */
    slab(shape, depth, color, o = {}) {
      const bev = o.bevel ?? depth * 0.3;
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 1, curveSegments: seg(o.cs ?? 6, 2) });
      g.translate(0, 0, -depth / 2);
      b.add(g, color, o);
    },
    /** 굽은 뿔: 밑동 반지름 r, 길이 h(로컬 +y), 끝이 로컬 x 로 bx · z 로 bz 만큼 휜다(밑동은 몸에 묻는다 — 열린 원뿔) */
    horn(r, h, bx, bz, color, o = {}) {
      const g = new THREE.ConeGeometry(r, h, o.sides || seg(o.n ?? 10, 6), seg(5, 3), true);
      g.translate(0, h / 2, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = p.getY(i) / h;
        p.setXYZ(i, p.getX(i) + bx * t * t, p.getY(i), p.getZ(i) + bz * t * t);
      }
      g.computeVertexNormals();
      b.add(g, color, o);
    },
    done() {
      const n = A.length;
      // 외곽선 방향: 같은 부위 · 같은 자리 정점들의 법선 평균(둘레 이음매 · 극점에서 껍질이 갈라지지 않게)
      const out = new Float32Array(n * 3);
      const sum = new Map();
      const key = (i) => `${A[i]}|${Math.round(P[i * 3] * 1e4)}|${Math.round(P[i * 3 + 1] * 1e4)}|${Math.round(P[i * 3 + 2] * 1e4)}`;
      for (let i = 0; i < n; i++) {
        const k = key(i);
        const s = sum.get(k) || [0, 0, 0];
        s[0] += N[i * 3];
        s[1] += N[i * 3 + 1];
        s[2] += N[i * 3 + 2];
        sum.set(k, s);
      }
      for (let i = 0; i < n; i++) {
        const s = sum.get(key(i));
        const l = Math.hypot(s[0], s[1], s[2]) || 1;
        out[i * 3] = s[0] / l;
        out[i * 3 + 1] = s[1] / l;
        out[i * 3 + 2] = s[2] / l;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute("aCol", new THREE.Float32BufferAttribute(CO, 3));
      g.setAttribute("aFx", new THREE.Float32BufferAttribute(F, 3));
      g.setAttribute("aOut", new THREE.BufferAttribute(out, 3));
      g.setAttribute("aPart", new THREE.Float32BufferAttribute(A, 1));
      g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
      // 화면에서 발보다 가장 높이 솟는 곳(u — 어느 쪽을 보든): 높이 × LIFT + 축에서 떨어진 거리 × SQUASH. 체력 막대를 그 위에 띄운다
      let top = 0;
      for (let i = 0; i < n; i++) {
        const pv = roles[A[i]].pivot;
        const x = P[i * 3] + pv[0], y = P[i * 3 + 1] + pv[1], z = P[i * 3 + 2] + pv[2];
        top = Math.max(top, y * PROJ.LIFT + Math.hypot(x, z) * PROJ.SQUASH);
      }
      g.computeBoundingBox();
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); // 부위 행렬로 움직인다 — 화면 밖 버리기는 하지 않는다
      g.userData.roles = roles;
      g.userData.screenTop = top;
      return g;
    },
  };
  return b;
}

// ---- 0 꼬마 잉크 슬라임
function buildSlime(b) {
  const pr = profile([[0, 0], [0.32, 0], [0.56, 0.05], [0.69, 0.19], [0.71, 0.37], [0.67, 0.58], [0.57, 0.8], [0.42, 0.98], [0.22, 1.1], [0, 1.14]], 16);
  const LIME = 0x8cff2e, UNDER = 0x1d8a3c, TOP = 0xd8ff9a, FOOT = 0x1f8f3a;
  b.part(0, [0, 0, 0], "body");
  b.lathe(pr, (p) => mixHex(mixHex(UNDER, LIME, smooth(0.04, 0.5, p.y)), TOP, 0.55 * smooth(0.82, 1.12, p.y)), { mat: MAT.gloss, n: 24 });
  // 동그랗게 벌린 입 + 혀, 볼 홍조
  const mx = surfX(pr, 0.4, 0) - 0.035;
  b.sph(1, 0x2a0a22, { at: [mx, 0.4, 0], scale: [0.06, 0.085, 0.13], w: 12, h: 8, line: 0.6 });
  b.sph(1, 0xff5f9a, { at: [mx + 0.038, 0.36, 0], scale: [0.035, 0.035, 0.07], w: 8, h: 6, line: 0 });
  for (const s of [-1, 1]) {
    const az = 0.62;
    const R = radiusAt(pr, 0.53);
    b.sph(1, 0xff7ab8, { at: [R * Math.cos(az) - 0.012, 0.53, s * R * Math.sin(az)], rot: [0, -s * az, 0], scale: [0.02, 0.055, 0.085], emit: 0.25, w: 8, h: 6, line: 0 });
  }
  // 큰 만화 눈(흰자 · 까만 눈동자 · 반짝 점) — 눈마다 부위(깜빡임)
  eyes(b, pr, { y: 0.74, az: 0.37, rs: 0.19, rp: 0.105, sq: [0.9, 1.15, 1], inset: 0.07 });
  // 더듬이(끝에 빛나는 방울)
  b.part(3, [-0.04, 1.08, 0], "antenna");
  b.stick([-0.04, 1.04, 0], [-0.1, 1.32, 0], 0.038, 0x4fcf2a, { mat: MAT.gloss, n: 8 });
  b.sph(0.085, 0xeaff5a, { at: [-0.11, 1.39, 0], mat: MAT.core, emit: 0.35, w: 10, h: 8 });
  // 발 뭉치
  for (const [i, s] of [[4, -1], [5, 1]]) {
    b.part(i, [0.2, 0, s * 0.33], "foot", s);
    b.sph(0.16, FOOT, { at: [0.22, 0.07, s * 0.33], scale: [1.3, 0.55, 1], mat: MAT.gloss, w: 12, h: 8 });
  }
}

/** 큰 눈 둘(부위 1 · 2): 흰자(타원) + 눈동자 + 반짝 점. dx = 단면 축의 x 자리, parent = 매달릴 부위(머리) */
function eyes(b, pr, { y, az, rs, rp, sq, inset, dx = 0, parent, white = 0xffffff, pupil = 0x140a26, look = 0.28, ew = 14 }) {
  for (const [i, s] of [[1, -1], [2, 1]]) {
    const R = radiusAt(pr, y);
    const c = [dx + R * Math.cos(az) - inset, y, s * R * Math.sin(az)];
    b.part(i, c, "eye", s, parent != null ? { parent } : {});
    b.sph(rs, white, { at: c, scale: sq, mat: MAT.eye, w: ew, h: Math.round(ew * 0.7), line: 0.8 });
    const d = new THREE.Vector3(Math.cos(az), look, s * Math.sin(az) * 0.5).normalize();
    const k = rs * 0.86 - rp * 0.4;
    const pc = [c[0] + d.x * k, c[1] + d.y * k, c[2] + d.z * k];
    b.sph(rp, pupil, { at: pc, mat: MAT.shiny, w: Math.round(ew * 0.7), h: Math.round(ew * 0.55), line: 0 });
    b.sph(rp * 0.32, 0xffffff, { at: [pc[0] + d.x * rp * 0.78, pc[1] + d.y * rp * 0.78 + rp * 0.36, pc[2] + d.z * rp * 0.78 - s * rp * 0.18], emit: 1.2, w: 6, h: 5, line: 0 });
  }
}

/** 두 발 몬스터의 팔다리(부위 6 · 7 왼팔 윗 · 아래, 8 · 9 오른팔, 10 · 11 왼다리 허벅지 · 정강이, 12 · 13 오른다리). 오른쪽 = +z */
function bipedLimbs(b, o) {
  for (const [ia, s] of [[6, -1], [8, 1]]) {
    const sh = [o.sh[0], o.sh[1], s * o.sh[2]], el = [o.el[0], o.el[1], s * o.el[2]], wr = [o.wr[0], o.wr[1], s * o.wr[2]];
    b.part(ia, sh, "arm", s);
    b.limb(sh, el, o.ua[0], o.ua[1], o.skin, { mid: o.ua[2], n: o.n, mat: o.mat });
    if (o.upperArm) o.upperArm(s, sh, el);
    b.part(ia + 1, el, "fore", s, { parent: ia });
    b.limb(el, wr, o.fa[0], o.fa[1], o.skin, { mid: o.fa[2], n: o.n, mat: o.mat });
    o.hand(s, wr, el);
  }
  for (const [il, s] of [[10, -1], [12, 1]]) {
    const hip = [o.hip[0], o.hip[1], s * o.hip[2]], kn = [o.kn[0], o.kn[1], s * o.kn[2]], an = [o.an[0], o.an[1], s * o.an[2]];
    b.part(il, hip, "thigh", s);
    b.limb(hip, kn, o.th[0], o.th[1], o.legSkin ?? o.skin, { mid: o.th[2], n: o.n, mat: o.mat });
    b.part(il + 1, kn, "shin", s, { parent: il });
    b.limb(kn, an, o.sn[0], o.sn[1], o.legSkin ?? o.skin, { mid: o.sn[2], n: o.n, mat: o.mat });
    o.foot(s, an, kn);
  }
}

// ---- 1 뿔 잉크 도깨비
function buildDokkaebi(b) {
  const OR = 0xff6b1f, RED = 0xe8352a, DARK = 0xa8261a, BELLY = 0xffb36e, MITT = 0xd8331f, FOOT = 0x5e1610;
  const HAIR = 0x2a0a18, HAIR2 = 0x6a1630, WOOD = 0x9a6232, WOOD2 = 0x5e3518, IRON = 0xd4d8e6, GOLD = 0xffc21a;
  const H = 0.62;
  // 몸통(부위 0 — 엉덩이 축): 허리가 잘록하고 어깨가 떡 벌어진 역삼각(앞뒤로 납작)
  b.part(0, [0, H, 0], "body");
  const pr = profile([[0.25, 0.58], [0.27, 0.7], [0.33, 0.86], [0.43, 1.03], [0.49, 1.13], [0.45, 1.22], [0.3, 1.29], [0.14, 1.33], [0, 1.34]], 13);
  b.lathe(pr, (p, n) => {
    let c = mixHex(DARK, OR, smooth(0.62, 0.92, p.y));
    c = mixHex(c, RED, 0.55 * smooth(-0.2, -0.8, n.x));
    return mixHex(c, BELLY, 0.8 * smooth(0.45, 0.85, n.x) * smooth(0.64, 0.76, p.y) * (1 - smooth(0.95, 1.08, p.y)));
  }, { n: 16, scale: [0.76, 1, 1] });
  // 어깨 근육 · 가슴 털 한 줌
  for (const s of [-1, 1]) b.sph(0.155, OR, { at: [0, 1.13, s * 0.42], scale: [0.95, 0.9, 1], w: 10, h: 8 });
  // 이빨 목걸이
  b.torus(0.25, 0.018, 0x3a1208, { at: [0.02, 1.22, 0], rot: [Math.PI / 2 + 0.25, 0, 0], scale: [0.8, 1, 1], r: 4, n: 16, line: 0.5 });
  for (let k = -2; k <= 2; k++) {
    const a = k * 0.42;
    b.cone(0.03, 0.1, 0xfff4dc, { at: [0.2 * Math.cos(a) + 0.02, 1.15 - 0.02 * Math.abs(k), 0.25 * Math.sin(a)], rot: [Math.PI, 0, 0], mat: MAT.eye, n: 5, line: 0.5 });
  }
  // 호랑이 가죽 치마(밑단 들쭉날쭉) + 새끼줄 허리띠
  const skirt = [[0.34, 0.34], [0.33, 0.42], [0.31, 0.56], [0.29, 0.66], [0.27, 0.74]].map(([r, y]) => new THREE.Vector2(r, y));
  b.lathe(skirt, 0xffc21a, { mat: MAT.tiger, n: 20, jag: 0.08, scale: [0.86, 1, 1] });
  b.torus(0.285, 0.035, 0x6e3a12, { at: [0, 0.73, 0], rot: [Math.PI / 2, 0, 0], scale: [0.86, 1, 1], r: 4, n: 16 });
  // 머리(부위 4 — 목 축): 아래턱이 넓은 서양배 꼴 · 뿔 둘 · 산발 머리 · 뾰족 귀
  const HX = 0.05;
  b.part(4, [0.03, 1.3, 0], "head");
  const hp = profile([[0, 1.3], [0.2, 1.32], [0.27, 1.4], [0.275, 1.52], [0.24, 1.64], [0.16, 1.73], [0, 1.76]], 12);
  b.lathe(hp, (p) => mixHex(OR, RED, smooth(1.55, 1.72, p.y)), { at: [HX, 0, 0], n: 16 });
  for (const s of [-1, 1]) {
    b.horn(0.075, 0.34, 0.06, -s * 0.06, (p) => mixHex(0xfff4dc, 0xffbf45, smooth(1.75, 2.0, p.y)), { at: [HX - 0.01, 1.66, s * 0.12], rot: [s * 0.42, 0, 0.12], mat: MAT.gloss });
    b.cone(0.06, 0.17, OR, { at: [HX - 0.02, 1.52, s * 0.29], rot: [s * 1.25, 0, 0.2], scale: [0.55, 1, 1], n: 6 });
  }
  const HAIRS = [[1.7, 0.25, 0.24], [2.3, 0.45, 0.3], [2.85, 0.4, 0.34], [3.14, 0.55, 0.36], [3.43, 0.4, 0.34], [3.98, 0.45, 0.3], [4.58, 0.25, 0.24], [2.6, 0.95, 0.28], [3.14, 1.05, 0.3], [3.7, 0.95, 0.28], [1.9, 0.75, 0.22], [4.4, 0.75, 0.22]];
  for (const [ph, el, h] of HAIRS) {
    const d = [Math.cos(el) * Math.cos(ph), Math.sin(el), Math.cos(el) * Math.sin(ph)];
    const base = [HX + d[0] * 0.2, 1.53 + d[1] * 0.18, d[2] * 0.22];
    b.cone(0.075, h, (p) => mixHex(HAIR, HAIR2, smooth(1.6, 1.95, p.y)), { at: add3(base, d, h * 0.4), quat: upTo([d[0], d[1] + 0.35, d[2]]), sides: 5 });
  }
  eyes(b, hp, { y: 1.57, az: 0.36, rs: 0.085, rp: 0.05, sq: [0.85, 1.05, 1], inset: 0.03, dx: HX, parent: 4, ew: 10 });
  // 화난 눈썹(안쪽이 낮다)
  b.part(3, [HX + surfX(hp, 1.66, 0), 1.66, 0], "brow", 0, { parent: 4 });
  for (const s of [-1, 1]) b.stick([HX + surfX(hp, 1.64, 0.04) + 0.01, 1.64, s * 0.04], [HX + surfX(hp, 1.69, 0.21) + 0.02, 1.7, s * 0.21], 0.038, 0x2a0612, { n: 6, cap: 2 });
  // 송곳니 웃음: 넓게 벌린 입 + 윗니 + 아래 엄니 둘
  const my = 1.42, mx = HX + surfX(hp, my, 0) - 0.03;
  b.part(5, [mx, my, 0], "mouth", 0, { parent: 4 });
  b.sph(1, 0x2a0612, { at: [mx, my, 0], scale: [0.06, 0.075, 0.2], wrap: 0.26, w: 14, h: 8, line: 0.7 });
  for (const s of [-1, 1]) {
    b.cone(0.034, 0.13, 0xffffff, { at: [HX + surfX(hp, 1.4, 0.15) + 0.005, 1.41, s * 0.15], mat: MAT.eye, n: 6, line: 0.6 });
    b.cone(0.022, 0.05, 0xffffff, { at: [HX + surfX(hp, 1.46, 0.06) + 0.008, 1.455, s * 0.06], rot: [Math.PI, 0, 0], mat: MAT.eye, n: 5, line: 0 });
  }
  // 팔다리: 굵은 팔(팔찌 · 벙어리 주먹), 짧고 굵은 다리(발톱)
  bipedLimbs(b, {
    skin: OR, sh: [0, 1.13, 0.46], el: [0.02, 0.87, 0.56], wr: [0.05, 0.63, 0.58], ua: [0.125, 0.1, 0.135], fa: [0.1, 0.11, 0.125],
    hip: [0, H, 0.17], kn: [0.04, 0.35, 0.2], an: [0, 0.1, 0.2], th: [0.13, 0.105, 0.14], sn: [0.105, 0.09, 0.11],
    hand(s, wr) {
      b.torus(0.1, 0.03, GOLD, { at: add3(wr, [0, 0.03, 0]), rot: [Math.PI / 2, 0, 0], mat: MAT.gold, r: 4, n: 12 });
      const F = [wr[0] + 0.02, wr[1] - 0.08, wr[2] + s * 0.01];
      b.sph(0.13, MITT, { at: F, scale: [1.05, 1, 0.95], w: 10, h: 8 });
      if (s > 0) {
        // 쇠징 박힌 방망이: 주먹에서 앞 아래로(손목 축에서 45° 앞) — 끝이 바닥에 닿을락 말락
        const d = norm3([0.76, -0.64, 0.02]);
        const cl = [[0, -0.07], [0.04, -0.06], [0.042, 0.1], [0.046, 0.26], [0.075, 0.38], [0.112, 0.56], [0.13, 0.68], [0.115, 0.78], [0.065, 0.84], [0, 0.85]].map(([r, y]) => new THREE.Vector2(r, y));
        const Q = upTo(d);
        b.lathe(cl, (p) => mixHex(WOOD2, WOOD, smooth(0.2, 0.6, Math.hypot(p.x - F[0], p.y - F[1]))), { at: F, quat: Q, n: 12 });
        b.torus(0.06, 0.022, IRON, { at: add3(F, d, 0.3), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), V3(d)), mat: MAT.shiny, r: 4, n: 10 });
        const p1 = norm3([d[1], -d[0], 0]), p2 = [0, 0, 1];
        for (const [t, R, n0] of [[0.48, 0.1, 0], [0.64, 0.128, 0.5], [0.79, 0.105, 0]]) {
          for (let k = 0; k < 6; k++) {
            const a = ((k + n0) / 6) * TAU;
            const rd = add3(p1.map((x) => x * Math.cos(a)), p2, Math.sin(a));
            b.cone(0.028, 0.09, IRON, { at: add3(add3(F, d, t), rd, R + 0.02), quat: upTo(rd), mat: MAT.shiny, n: 5, line: 0.5 });
          }
        }
        b.cone(0.035, 0.1, IRON, { at: add3(F, d, 0.89), quat: Q, mat: MAT.shiny, n: 5, line: 0.5 });
      }
    },
    foot(s, an) {
      b.sph(0.15, FOOT, { at: [an[0] + 0.08, 0.07, an[2] + s * 0.01], scale: [1.45, 0.58, 1.05], w: 10, h: 8 });
      for (const t of [-1, 0, 1]) b.cone(0.028, 0.08, 0xfff4dc, { at: [an[0] + 0.3, 0.06, an[2] + s * 0.01 + t * 0.065], rot: [0, 0, -Math.PI / 2], mat: MAT.eye, n: 5, line: 0.5 });
    },
  });
}

// ---- 2 잉크 대왕(거인)
function buildKing(b) {
  const VIO = 0x5a2fd8, DEEP = 0x2a1470, LIGHT = 0x8b5cff, ARMOR = 0x241060, FIST = 0x4322b0, GOLD = 0xffc83a;
  const FACE = 0x0e0626, CAPE = 0x2a0f52, LINING = 0xb01e5e, CLAW = 0xf2eaff, HORN = 0xfff0d8;
  const H = 0.74;
  b.part(0, [0, H, 0], "body");
  const pr = profile([[0.29, 0.72], [0.32, 0.86], [0.4, 1.04], [0.5, 1.22], [0.55, 1.33], [0.5, 1.43], [0.34, 1.51], [0.17, 1.55], [0, 1.56]], 16);
  b.lathe(pr, (p, n) => {
    let c = mixHex(DEEP, VIO, smooth(0.76, 1.1, p.y));
    c = mixHex(c, LIGHT, 0.5 * smooth(0.3, 0.9, n.x) * smooth(1.12, 1.34, p.y));
    return mixHex(c, DEEP, 0.6 * smooth(-0.1, -0.7, n.x));
  }, { mat: MAT.gloss, n: 18, scale: [0.74, 1, 1] });
  // 가슴 보석(금 테 — 빛나는 하늘빛), 금 목깃 · 허리띠, 갑옷 치마(밑단 들쭉날쭉)
  const gy = 1.12, gx = surfX(pr, gy, 0) * 0.74;
  b.sph(0.12, 0x00f0ff, { at: [gx - 0.035, gy, 0], scale: [0.5, 1, 1], mat: MAT.core, emit: 0.5, w: 10, h: 7 });
  b.torus(0.13, 0.03, GOLD, { at: [gx - 0.005, gy, 0], rot: [0, Math.PI / 2, 0], mat: MAT.gold, r: 5, n: 16 });
  b.lathe([[0.36, 1.43], [0.33, 1.5], [0.24, 1.56], [0.2, 1.6]].map(([r, y]) => new THREE.Vector2(r, y)), GOLD, { mat: MAT.gold, n: 16, scale: [0.8, 1, 1] });
  b.torus(0.31, 0.045, GOLD, { at: [0, 0.8, 0], rot: [Math.PI / 2, 0, 0], scale: [0.78, 1, 1], mat: MAT.gold, r: 4, n: 18 });
  b.lathe([[0.42, 0.4], [0.4, 0.48], [0.36, 0.64], [0.32, 0.79]].map(([r, y]) => new THREE.Vector2(r, y)), (p) => mixHex(ARMOR, DEEP, smooth(0.45, 0.75, p.y)), { mat: MAT.gloss, n: 16, jag: 0.1, scale: [0.82, 1, 1] });
  // 가시 어깨갑옷(금테 + 금 가시 셋)
  for (const s of [-1, 1]) {
    const c = [0, 1.43, s * 0.56];
    b.sph(0.25, ARMOR, { at: c, scale: [1.12, 0.72, 1.0], mat: MAT.gloss, w: 11, h: 7 });
    b.torus(0.25, 0.03, GOLD, { at: add3(c, [0, -0.06, 0]), rot: [Math.PI / 2, 0, 0], scale: [1.12, 1, 1], mat: MAT.gold, r: 3, n: 14 });
    for (const [dx, h] of [[0, 0.34], [-0.42, 0.24], [0.42, 0.24]]) {
      const d = norm3([dx, 0.85, s * 0.55]);
      b.cone(0.07, h, GOLD, { at: add3(c, d, 0.13 + h * 0.4), quat: upTo(d), mat: MAT.gold, n: 6 });
    }
  }
  // 머리(부위 4): 뿔 투구 — 얼굴은 그늘진 투구 속, 금 이마띠, 금관, 크게 휜 뿔 둘
  const HX = 0.04;
  b.part(4, [0.02, 1.52, 0], "head");
  const hp = profile([[0, 1.5], [0.17, 1.52], [0.23, 1.6], [0.24, 1.72], [0.21, 1.84], [0.13, 1.92], [0, 1.95]], 12);
  b.lathe(hp, (p, n) => mixHex(ARMOR, FACE, smooth(0.3, 0.6, n.x) * (1 - smooth(1.74, 1.82, p.y))), { at: [HX, 0, 0], mat: MAT.gloss, n: 16 });
  b.torus(0.235, 0.028, GOLD, { at: [HX, 1.8, 0], rot: [Math.PI / 2, 0, 0], mat: MAT.gold, r: 4, n: 18 });
  b.lathe([[0.17, 1.86], [0.2, 1.87], [0.215, 1.95], [0.21, 1.975], [0.19, 1.97], [0.18, 1.9]].map(([r, y]) => new THREE.Vector2(r, y)), GOLD, { at: [HX, 0, 0], mat: MAT.gold, n: 16 });
  const GEMS = [0xff2d95, 0x00f0ff, 0xa8ff00, 0x00f0ff, 0xa8ff00];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU;
    const d = norm3([Math.cos(a) * 0.2, 1, Math.sin(a) * 0.2]);
    const base = [HX + 0.205 * Math.cos(a), 1.96, 0.205 * Math.sin(a)];
    const h = 0.16;
    b.cone(0.05, h, GOLD, { at: add3(base, d, h * 0.5), quat: upTo(d), mat: MAT.gold, n: 6 });
    b.sph(0.035, GEMS[k], { at: add3(base, d, h + 0.02), mat: MAT.shiny, emit: 0.5, w: 5, h: 4, line: 0.7 });
  }
  for (const s of [-1, 1]) {
    b.horn(0.075, 0.5, -0.12, s * 0.24, (p) => mixHex(HORN, GOLD, smooth(1.95, 2.25, p.y)), { at: [HX - 0.02, 1.74, s * 0.19], rot: [s * 1.0, 0, 0.15], mat: MAT.gloss });
  }
  // 빛나는 노란 눈(비스듬한 타원 + 세로 동공), 굵은 눈썹
  for (const [i, s] of [[1, -1], [2, 1]]) {
    const y = 1.69, az = 0.33, R = radiusAt(hp, y);
    const c = [HX + R * Math.cos(az) - 0.035, y, s * R * Math.sin(az)];
    b.part(i, c, "eye", s, { parent: 4 });
    const rot = [-s * 0.42, -s * az, 0];
    b.sph(0.085, 0xffe600, { at: c, rot, order: "YXZ", scale: [0.5, 0.62, 1.2], mat: MAT.glowEye, emit: 0.6, w: 10, h: 8, line: 0.8 });
    b.sph(1, 0x1a0630, { at: [c[0] + Math.cos(az) * 0.038, y, c[2] + s * Math.sin(az) * 0.038], rot, order: "YXZ", scale: [0.02, 0.055, 0.022], mat: MAT.shiny, w: 6, h: 6, line: 0 });
  }
  b.part(3, [HX + surfX(hp, 1.76, 0), 1.76, 0], "brow", 0, { parent: 4 });
  for (const s of [-1, 1]) b.stick([HX + surfX(hp, 1.74, 0.04), 1.74, s * 0.04], [HX + surfX(hp, 1.8, 0.21) + 0.01, 1.8, s * 0.21], 0.045, 0x12062e, { n: 6, cap: 2 });
  // 앞으로 내민 아래턱 + 엄니
  b.part(5, [HX + 0.12, 1.57, 0], "mouth", 0, { parent: 4 });
  b.sph(0.16, VIO, { at: [HX + 0.1, 1.56, 0], scale: [0.85, 0.5, 1.15], mat: MAT.gloss, w: 12, h: 8 });
  b.sph(1, 0x12041e, { at: [HX + 0.22, 1.585, 0], scale: [0.03, 0.03, 0.12], wrap: 0.2, w: 10, h: 6, line: 0.6 });
  for (const s of [-1, 1]) {
    b.cone(0.035, 0.14, 0xffffff, { at: [HX + 0.21, 1.62, s * 0.11], rot: [s * 0.15, 0, 0], mat: MAT.eye, n: 6, line: 0.6 });
    b.cone(0.022, 0.07, 0xffffff, { at: [HX + 0.235, 1.6, s * 0.04], mat: MAT.eye, n: 5, line: 0 });
  }
  // 무릎까지 닿는 긴 팔: 금 팔찌 둘, 커다란 주먹 + 발톱 넷 · 기둥 다리: 금 무릎 덮개, 발톱 셋
  bipedLimbs(b, {
    skin: VIO, legSkin: DEEP, mat: MAT.gloss,
    sh: [0, 1.38, 0.6], el: [0.03, 1.02, 0.72], wr: [0.07, 0.68, 0.76], ua: [0.15, 0.12, 0.165], fa: [0.12, 0.15, 0.165],
    hip: [0, H, 0.22], kn: [0.05, 0.42, 0.25], an: [0, 0.13, 0.25], th: [0.17, 0.14, 0.185], sn: [0.14, 0.15, 0.15],
    hand(s, wr, el) {
      for (const t of [0.35, 0.7]) b.torus(0.155, 0.035, GOLD, { at: [lerp(el[0], wr[0], t), lerp(el[1], wr[1], t), lerp(el[2], wr[2], t)], rot: [Math.PI / 2, 0, 0], mat: MAT.gold, r: 3, n: 12 });
      const F = [wr[0] + 0.04, wr[1] - 0.17, wr[2] + s * 0.01];
      b.sph(0.24, FIST, { at: F, scale: [1.05, 0.95, 0.92], mat: MAT.gloss, w: 12, h: 9 });
      for (let k = 0; k < 4; k++) {
        const z = F[2] + (k - 1.5) * 0.1;
        const d = norm3([0.62, -0.78, 0]);
        b.cone(0.045, 0.22, CLAW, { at: [F[0] + 0.2, F[1] - 0.06 - 0.02 * Math.abs(k - 1.5), z], quat: upTo(d), mat: MAT.shiny, n: 5, line: 0.6 });
      }
    },
    foot(s, an, kn) {
      b.sph(0.13, ARMOR, { at: [kn[0] + 0.1, kn[1] + 0.02, kn[2]], scale: [0.7, 1, 1], mat: MAT.gloss, w: 10, h: 8 });
      b.torus(0.13, 0.025, GOLD, { at: [kn[0] + 0.1, kn[1] + 0.02, kn[2]], rot: [0, Math.PI / 2, 0], mat: MAT.gold, r: 4, n: 12, line: 0.6 });
      b.sph(0.2, ARMOR, { at: [an[0] + 0.1, 0.09, an[2] + s * 0.01], scale: [1.55, 0.6, 1.15], mat: MAT.gloss, w: 10, h: 8 });
      for (const t of [-1, 0, 1]) b.cone(0.045, 0.13, CLAW, { at: [an[0] + 0.42, 0.07, an[2] + s * 0.01 + t * 0.11], rot: [0, 0, -Math.PI / 2], mat: MAT.shiny, n: 5, line: 0.5 });
    },
  });
  // 너덜너덜한 망토(부위 14 — 어깨 뒤): 바깥 짙은 보라 · 안쪽 진홍
  b.part(14, [-0.1, 1.45, 0], "cape");
  const cape = [[0.62, 0.22], [0.58, 0.5], [0.52, 0.84], [0.46, 1.14], [0.42, 1.36], [0.4, 1.48]];
  const ph0 = 1.5 * Math.PI - 1.05;
  b.lathe(cape.map(([r, y]) => new THREE.Vector2(r, y)), (p) => mixHex(0x1a0838, CAPE, smooth(0.2, 1.2, p.y)), { phi0: ph0, phiLen: 2.1, n: 14, jag: 0.17, mat: MAT.matte });
  b.lathe(cape.slice().reverse().map(([r, y]) => new THREE.Vector2(r - 0.025, y)), LINING, { phi0: ph0, phiLen: 2.1, n: 14, line: 0 });
}

// ---- 3 잉크 박쥐(마름모 보석 몸 · 들쭉날쭉 날개)
const BAT_C = 0.9; // 몸 가운데 높이(떠 있다)
/** 날개 막 모양(펼친 쪽 a — 0..1, 앞뒤 c — 앞이 +). sg = −1 이면 앞뒤를 뒤집는다(왼쪽 날개를 거울 없이 돌리려고) */
const BAT_WING = [[0, 0.14], [0.28, 0.3], [0.45, 0.37], [0.55, 0.25], [1.03, 0.07], [0.84, -0.04], [0.88, -0.37], [0.67, -0.17], [0.53, -0.48], [0.4, -0.21], [0.2, -0.39], [0.09, -0.15], [0, -0.1]];
function batWingShape(sg) {
  const sh = new THREE.Shape();
  BAT_WING.forEach(([a, c], i) => (i ? sh.lineTo(a, c * sg) : sh.moveTo(a, c * sg)));
  return sh;
}
function buildBat(b) {
  const PINK = 0xff3d9a, DEEP = 0xb81a6a, BELLY = 0x8a1256, TOP = 0xff8cc8, MEM = 0x7a1a5e, MEM2 = 0xc8409a, EAR_IN = 0xffb0d8, BONE = 0xff5cab;
  const C = BAT_C;
  const pr = [[0, C - 0.44], [0.27, C - 0.2], [0.41, C - 0.02], [0.41, C + 0.08], [0.25, C + 0.3], [0, C + 0.42]].map(([r, y]) => new THREE.Vector2(r, y));
  b.part(0, [0, C, 0], "body");
  b.lathe(pr, (p, n) => {
    let c = mixHex(DEEP, PINK, smooth(C - 0.3, C, p.y));
    c = mixHex(c, TOP, 0.45 * smooth(C + 0.12, C + 0.4, p.y));
    return mixHex(c, BELLY, 0.85 * smooth(0.2, 0.7, n.x) * (1 - smooth(C - 0.12, C - 0.02, p.y)));
  }, { n: 8, flat: true, mat: MAT.fur });
  // 뾰족 귀(네모뿔) + 안쪽 분홍, 정수리 털 가시
  for (const s of [-1, 1]) {
    b.cone(0.17, 0.56, (p) => mixHex(PINK, DEEP, smooth(C + 0.3, C + 0.8, p.y)), { at: [-0.03, C + 0.5, s * 0.18], rot: [s * 0.4, Math.PI / 4, 0.14], sides: 4, flat: true, mat: MAT.fur });
    b.cone(0.1, 0.36, EAR_IN, { at: [0.06, C + 0.47, s * 0.2], rot: [s * 0.4, Math.PI / 4, 0.14], scale: [1, 1, 0.5], sides: 4, flat: true, line: 0 });
  }
  for (const z of [-0.06, 0.06]) b.cone(0.05, 0.16, TOP, { at: [-0.06, C + 0.44, z], rot: [z * 4, 0, 0.5], sides: 4, flat: true, line: 0.6 });
  // 비스듬한 성난 눈(아몬드 흰자 + 큰 눈동자), 눈 위 짙은 눈두덩
  const fd = 0.41 * Math.cos(Math.PI / 8);
  for (const [i, s] of [[1, -1], [2, 1]]) {
    const az = Math.PI / 8, y = C + 0.07;
    const c = [(fd - 0.035) * Math.cos(az), y, s * (fd - 0.035) * Math.sin(az)];
    b.part(i, c, "eye", s);
    const rot = [s * 0.35, -s * az, 0];
    b.sph(0.13, 0xffffff, { at: c, rot, order: "YXZ", scale: [0.5, 0.78, 1.12], mat: MAT.eye, w: 12, h: 9, line: 0.8 });
    const pc = [c[0] + 0.05 * Math.cos(az), y - 0.005, c[2] + s * 0.045 * Math.sin(az)];
    b.sph(0.065, 0x1a0420, { at: pc, mat: MAT.shiny, w: 8, h: 6, line: 0 });
    b.sph(0.02, 0xffffff, { at: [pc[0] + 0.05, pc[1] + 0.03, pc[2] - s * 0.012], emit: 1.2, w: 5, h: 4, line: 0 });
  }
  b.use(0);
  for (const s of [-1, 1]) b.stick([fd * 0.86, BAT_C + 0.19, s * 0.035], [fd * 0.78, BAT_C + 0.24, s * 0.23], 0.028, 0x3a0624, { n: 6, cap: 2, line: 0.6 });
  // 입(작은 세모) + 송곳니 둘
  const my = C - 0.15, mx = 0.27 + (0.41 - 0.27) * (0.05 / 0.18) - 0.012;
  b.part(3, [mx, my, 0], "mouth");
  b.sph(1, 0x3a0620, { at: [mx, my, 0], scale: [0.04, 0.045, 0.1], w: 8, h: 5, line: 0.6 });
  for (const s of [-1, 1]) b.cone(0.026, 0.085, 0xffffff, { at: [mx + 0.02, my - 0.055, s * 0.05], rot: [Math.PI, 0, 0], mat: MAT.eye, sides: 4, line: 0.5 });
  // 날개(부위 4 · 5 — 어깨 축): 막(판) + 뼈대(팔 · 손가락 셋) + 손목 갈고리
  for (const [i, s] of [[4, -1], [5, 1]]) {
    const S = [-0.03, C + 0.06, s * 0.33];
    b.part(i, S, "wing", s);
    const q = s > 0 ? basisQ([0, 0, 1], [1, 0, 0], [0, 1, 0]) : basisQ([0, 0, -1], [-1, 0, 0], [0, 1, 0]);
    b.slab(batWingShape(s), 0.03, (p) => mixHex(MEM, MEM2, smooth(0.1, 0.95, Math.abs(p.z) - 0.33)), { at: S, quat: q, mat: MAT.gloss, cs: 4, bevel: 0.008 });
    const at = (a, c) => [S[0] + c, S[1] + 0.025, S[2] + s * a];
    const wr = at(0.45, 0.35);
    b.stick(at(0.02, 0.14), wr, 0.03, BONE, { n: 6, line: 0.6 });
    for (const [a, c] of [[1.0, 0.07], [0.86, -0.34], [0.53, -0.45]]) b.stick(wr, at(a, c), 0.02, BONE, { n: 5, cap: 2, line: 0.5 });
    b.cone(0.035, 0.12, 0xffe0f0, { at: add3(wr, [0.06, 0.01, 0]), rot: [0, 0, -Math.PI / 2 - 0.4], sides: 4, mat: MAT.eye, line: 0.5 });
  }
  // 대롱대롱 작은 발(부위 6 · 7)
  for (const [i, s] of [[6, -1], [7, 1]]) {
    const P = [0.02, C - 0.33, s * 0.12];
    b.part(i, P, "dangle", s);
    b.stick(P, [0.03, C - 0.48, s * 0.13], 0.03, DEEP, { n: 6 });
    for (const t of [-1, 1]) b.cone(0.022, 0.07, 0x2a0618, { at: [0.06, C - 0.52, s * 0.13 + t * 0.03], rot: [0, 0, -Math.PI / 2 - 0.6], sides: 4, line: 0.5 });
  }
}

// ---- 4 잉크 고블린
function buildGoblin(b) {
  const SKIN = 0x3bbfa0, SKIN_D = 0x1f7d68, SKIN_L = 0x8fe6cc, HOOD = 0xd8323a, HOOD_D = 0x8e1a22, TUNIC = 0x6b4a2b, TUNIC_D = 0x3e2a14;
  const SHOE = 0x3a2010, ROPE = 0xc8a060, EAR_IN = 0xff9fae;
  const H = 0.42;
  b.part(0, [0, H, 0], "body");
  // 누더기 웃옷(밑단 들쭉날쭉) + 새끼줄 띠 + 빨간 목도리(등 뒤로 늘어진 끝)
  const pr = profile([[0.18, 0.28], [0.16, 0.38], [0.15, 0.5], [0.17, 0.62], [0.19, 0.71], [0.16, 0.79], [0.09, 0.85], [0, 0.86]], 12);
  b.lathe(pr, (p) => mixHex(TUNIC_D, TUNIC, smooth(0.3, 0.72, p.y)), { n: 14, scale: [0.85, 1, 1], jag: 0.05 });
  b.torus(0.155, 0.022, ROPE, { at: [0, 0.48, 0], rot: [Math.PI / 2, 0, 0], scale: [0.88, 1, 1], r: 4, n: 12 });
  b.torus(0.11, 0.055, HOOD, { at: [0, 0.81, 0], rot: [Math.PI / 2 + 0.15, 0, 0], r: 6, n: 14 });
  b.tube([[-0.07, 0.81, 0.06], [-0.15, 0.74, 0.09], [-0.2, 0.62, 0.08], [-0.23, 0.5, 0.05]], 0.05, 0.028, HOOD_D, { n: 8, r: 6 });
  // 머리(부위 4): 큰 머리 · 빨간 두건(뒤로 꼬리) · 큰 뾰족 귀 · 긴 코 · 뾰족 턱
  const HC = [0.05, 1.0, 0], HR = [0.19, 0.18, 0.2];
  b.part(4, [0.03, 0.84, 0], "head");
  b.sph(1, (p) => mixHex(SKIN_D, SKIN, smooth(0.83, 0.92, p.y)), { at: HC, scale: HR, w: 14, h: 10 });
  b.cone(0.07, 0.14, SKIN_D, { at: [0.16, 0.86, 0], rot: [0, 0, Math.PI - 0.5], n: 6 });
  b.sph(0.22, (p) => mixHex(HOOD_D, HOOD, smooth(0.9, 1.15, p.y)), { at: [-0.035, 1.035, 0], scale: [0.95, 0.92, 1.03], w: 14, h: 10 });
  b.horn(0.1, 0.32, -0.16, 0, HOOD_D, { at: [-0.16, 1.1, 0], rot: [0, 0, 1.05], n: 8 });
  for (const s of [-1, 1]) {
    b.horn(0.085, 0.44, -0.05, 0, (p) => mixHex(SKIN, SKIN_L, smooth(0.15, 0.55, Math.abs(p.z))), { at: [0.0, 1.0, s * 0.17], rot: [s * 1.22, 0, 0.3], scale: [0.5, 1, 1], n: 8 });
    b.horn(0.05, 0.32, -0.04, 0, EAR_IN, { at: [0.02, 1.0, s * 0.18], rot: [s * 1.22, 0, 0.3], scale: [0.3, 1, 1], n: 6, line: 0 });
  }
  b.horn(0.05, 0.27, 0, 0, (p) => mixHex(SKIN, SKIN_D, smooth(0.25, 0.45, p.x)), { at: [0.2, 1.0, 0], rot: [0, 0, -Math.PI / 2 + 0.35], n: 8 });
  // 가늘게 뜬 노란 눈(비스듬 · 세로 동공), 비스듬한 눈썹
  for (const [i, s] of [[1, -1], [2, 1]]) {
    const az = 0.42, el = 0.12;
    const c = [HC[0] + HR[0] * Math.cos(el) * Math.cos(az) - 0.02, HC[1] + HR[1] * Math.sin(el), s * HR[2] * Math.cos(el) * Math.sin(az)];
    b.part(i, c, "eye", s, { parent: 4 });
    const rot = [s * 0.4, -s * az, 0];
    b.sph(0.06, 0xffe24a, { at: c, rot, order: "YXZ", scale: [0.55, 0.55, 1.15], mat: MAT.glowEye, emit: 0.2, w: 10, h: 8, line: 0.8 });
    b.sph(1, 0x1a0a10, { at: [c[0] + 0.028 * Math.cos(az), c[1], c[2] + s * 0.028 * Math.sin(az)], rot, order: "YXZ", scale: [0.012, 0.032, 0.012], mat: MAT.shiny, w: 6, h: 6, line: 0 });
  }
  b.part(3, [0.22, 1.08, 0], "brow", 0, { parent: 4 });
  for (const s of [-1, 1]) b.stick([0.215, 1.065, s * 0.035], [0.16, 1.11, s * 0.15], 0.022, 0x123a30, { n: 6 });
  // 능글맞은 웃음(한쪽이 올라간 납작한 입 + 뾰족 이)
  b.part(5, [0.205, 0.92, 0], "mouth", 0, { parent: 4 });
  b.sph(1, 0x1a0610, { at: [0.2, 0.925, 0.01], rot: [0.22, 0, 0], scale: [0.03, 0.022, 0.12], wrap: 0.18, w: 10, h: 6, line: 0.6 });
  for (const z of [-0.07, -0.02, 0.04, 0.09]) b.cone(0.012, 0.03, 0xffffff, { at: [0.22, 0.935 + z * 0.22, z], rot: [Math.PI, 0, 0], mat: MAT.eye, sides: 4, line: 0 });
  // 가는 팔다리, 뾰족 신발(코가 말린다), 오른손에 잉크 폭탄(부위 14)
  bipedLimbs(b, {
    skin: SKIN, legSkin: SKIN_D, n: 8,
    sh: [0, 0.76, 0.19], el: [-0.03, 0.6, 0.25], wr: [0.04, 0.46, 0.27], ua: [0.048, 0.04, 0.05], fa: [0.04, 0.036, 0.044],
    hip: [0, H, 0.1], kn: [0.05, 0.25, 0.12], an: [0, 0.08, 0.12], th: [0.052, 0.042, 0.055], sn: [0.042, 0.036, 0.045],
    upperArm(s, sh) {
      b.sph(0.075, TUNIC, { at: sh, w: 8, h: 6 });
    },
    hand(s, wr) {
      b.sph(0.055, SKIN, { at: [wr[0] + 0.02, wr[1] - 0.04, wr[2]], w: 8, h: 6 });
      for (const t of [-1, 0, 1]) b.cone(0.012, 0.05, 0x10302a, { at: [wr[0] + 0.08, wr[1] - 0.06, wr[2] + t * 0.025], rot: [0, 0, -Math.PI / 2 - 0.5], sides: 4, line: 0 });
      if (s > 0) {
        const BC = [wr[0] + 0.07, wr[1] - 0.12, wr[2] + 0.02];
        b.part(14, [wr[0] + 0.02, wr[1] - 0.04, wr[2]], "bomb", s, { parent: 9 });
        b.sph(0.125, 0x1d1a2c, { at: BC, mat: MAT.shiny, w: 14, h: 10 });
        b.torus(0.122, 0.022, 0x14c9a4, { at: BC, rot: [Math.PI / 2, 0, 0], mat: MAT.core, emit: 0.3, r: 4, n: 16, line: 0 });
        b.add(new THREE.CylinderGeometry(0.04, 0.05, 0.05, b.seg(10, 6)), 0x8a8fa8, { at: add3(BC, [0, 0.13, 0]), mat: MAT.shiny });
        b.tube([add3(BC, [0, 0.15, 0]), add3(BC, [0.02, 0.2, 0.01]), add3(BC, [-0.01, 0.25, 0.0]), add3(BC, [0.01, 0.29, -0.01])], 0.014, 0.012, 0xc8a060, { n: 6, r: 4, line: 0.5 });
        const SP = add3(BC, [0.01, 0.31, -0.01]);
        b.sph(0.035, 0xffe066, { at: SP, mat: MAT.core, emit: 1.0, w: 6, h: 5, line: 0 });
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU;
          const d = norm3([Math.cos(a), 0.8, Math.sin(a)]);
          b.cone(0.012, 0.07, 0xffa21a, { at: add3(SP, d, 0.045), quat: upTo(d), mat: MAT.core, emit: 1.0, sides: 4, line: 0 });
        }
      }
    },
    foot(s, an) {
      b.limb([an[0] - 0.04, 0.05, an[2]], [an[0] + 0.17, 0.055, an[2]], 0.06, 0.026, SHOE, { n: 8 });
      b.horn(0.026, 0.08, -0.03, 0, SHOE, { at: [an[0] + 0.18, 0.06, an[2]], n: 5 });
    },
  });
}

// ---- 5 먹물 오징어
function buildSquid(b) {
  const IND = 0x2333a8, BLUE = 0x3b62f0, TIP = 0x8aa8ff, GLOW = 0x46e0ff, PINK = 0xff8ac8, ARM = 0x3354dc, ARM2 = 0x6f8fff;
  const pr = profile([[0, 0.38], [0.24, 0.41], [0.34, 0.5], [0.38, 0.66], [0.37, 0.86], [0.32, 1.1], [0.23, 1.34], [0.12, 1.54], [0, 1.7]], 16);
  b.part(0, [0, 0.45, 0], "head");
  b.lathe(pr, (p) => mixHex(mixHex(IND, BLUE, smooth(0.45, 0.95, p.y)), TIP, 0.7 * smooth(1.2, 1.68, p.y)), { mat: MAT.gloss, n: 20 });
  // 빛나는 점(옆 · 뒤)
  for (const [y, a, r] of [[0.95, 2.2, 0.035], [1.15, 2.85, 0.03], [0.84, 3.45, 0.04], [1.32, 3.9, 0.028], [1.0, 4.35, 0.035], [0.78, 1.45, 0.03], [1.2, 1.35, 0.028], [0.8, 4.85, 0.03], [1.42, 0.75, 0.024], [1.42, 5.5, 0.024], [1.05, 5.0, 0.03], [1.05, 1.0, 0.03]]) {
    const R = radiusAt(pr, y);
    b.sph(r, GLOW, { at: [R * Math.cos(a) * 0.985, y, R * Math.sin(a) * 0.985], mat: MAT.core, emit: 0.4, w: 6, h: 5, line: 0 });
  }
  // 세모 지느러미(부위 3 — 꼭대기 양옆, 화살촉)
  b.part(3, [0, 1.3, 0], "fin", 0, { parent: 0 });
  for (const s of [-1, 1]) {
    const y0 = 1.1, R0 = radiusAt(pr, y0) - 0.04;
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.lineTo(0.48, 0.1);
    sh.lineTo(0.04, 0.58);
    sh.lineTo(-0.02, 0.4);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.3)).multiply(s > 0 ? basisQ([0, 0, 1], [0, 1, 0], [-1, 0, 0]) : basisQ([0, 0, -1], [0, 1, 0], [1, 0, 0]));
    b.slab(sh, 0.05, (p) => mixHex(BLUE, TIP, smooth(0.2, 0.55, Math.abs(p.z))), { at: [-0.02, y0, s * R0], quat: q, mat: MAT.gloss, cs: 2, bevel: 0.012 });
  }
  // 아래쪽 큰 눈 + 눈 위 짙은 눈두덩
  eyes(b, pr, { y: 0.66, az: 0.55, rs: 0.15, rp: 0.1, sq: [0.8, 1.05, 1], inset: 0.06, parent: 0, look: 0.1, ew: 12 });
  b.use(0);
  for (const s of [-1, 1]) {
    const R = radiusAt(pr, 0.82);
    b.stick([R * Math.cos(0.3) - 0.01, 0.82, s * R * Math.sin(0.3)], [R * Math.cos(0.85) - 0.01, 0.8, s * R * Math.sin(0.85)], 0.035, IND, { n: 6 });
  }
  // 깔때기(부위 4 — 앞 아래, 빛나는 테)
  const sy = 0.47, sx = radiusAt(pr, sy) - 0.06;
  b.part(4, [sx, sy, 0], "siphon", 0, { parent: 0 });
  const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2 + 0.2));
  b.lathe([[0.1, 0], [0.095, 0.08], [0.08, 0.16], [0.09, 0.22], [0.1, 0.25], [0.075, 0.27], [0.05, 0.24]].map(([r, y]) => new THREE.Vector2(r, y)), ARM2, { at: [sx, sy, 0], quat: tq, mat: MAT.gloss, n: 12 });
  const tipP = add3([sx, sy, 0], [Math.cos(0.2), Math.sin(0.2), 0], 0.255);
  b.torus(0.08, 0.02, GLOW, { at: tipP, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0.2, "ZYX")), mat: MAT.core, emit: 0.3, r: 4, n: 12, line: 0.5 });
  b.sph(0.06, 0x08103a, { at: add3(tipP, [-1, -0.2, 0], 0.02), scale: [0.4, 1, 1], w: 8, h: 6, line: 0 });
  // 다리 여섯(부위 5..10 — 아래로 내려 바닥에서 말린다) + 긴 촉완 둘(부위 11 · 12 — 앞으로 뻗은 곤봉 끝)
  const arm = (i, a, pts, r0, r1, sucker) => {
    const ca = Math.cos(a), sa = Math.sin(a);
    const W = (rho, y, w) => [rho * ca - w * sa, y, rho * sa + w * ca];
    const P = pts.map(([rho, y, w]) => W(rho, y, w));
    b.part(i, P[0], "tentacle", 0, { ang: a, k: i - 5, long: pts.length < 7 });
    const curve = b.tube(P, r0, r1, (p) => mixHex(ARM, ARM2, smooth(0.35, 0.9, Math.hypot(p.x, p.z))), { n: 16, r: 7, mat: MAT.gloss });
    const t = new THREE.Vector3(-sa, 0, ca);
    for (const u of sucker) {
      const c = curve.getPointAt(u), T = curve.getTangentAt(u);
      const under = T.clone().cross(t).normalize();
      const r = (r0 + (r1 - r0) * u) * 0.9;
      b.sph(1, PINK, { at: [c.x + under.x * r, c.y + under.y * r, c.z + under.z * r], quat: new THREE.Quaternion().setFromUnitVectors(UP, under), scale: [r * 0.55, r * 0.3, r * 0.55], mat: MAT.gloss, w: 6, h: 4, line: 0 });
    }
  };
  for (let k = 0; k < 6; k++) {
    const a = ((k + 0.5) / 6) * TAU, tw = k % 2 ? 1 : -1;
    arm(5 + k, a, [[0.2, 0.44, 0], [0.32, 0.29, 0.02 * tw], [0.45, 0.13, 0.05 * tw], [0.6, 0.06, 0.07 * tw], [0.73, 0.08, 0.05 * tw], [0.79, 0.19, 0.02 * tw], [0.72, 0.27, -0.03 * tw]], 0.1, 0.026, [0.66, 0.78, 0.88, 0.95]);
  }
  for (const [i, s] of [[11, -1], [12, 1]]) {
    const a = s * 0.42;
    arm(i, a, [[0.22, 0.44, 0], [0.42, 0.24, 0], [0.68, 0.08, -s * 0.03], [0.96, 0.05, -s * 0.05], [1.16, 0.07, -s * 0.04], [1.24, 0.09, 0]], 0.055, 0.04, []);
    const ca = Math.cos(a), sa = Math.sin(a);
    const E = [1.24 * ca, 0.09, 1.24 * sa];
    b.sph(0.11, ARM, { at: E, rot: [0, -a, 0], scale: [1.5, 0.45, 0.85], mat: MAT.gloss, w: 10, h: 7 });
    for (const [dr, dw] of [[-0.06, 0], [0.04, 0.035], [0.04, -0.035], [0.11, 0]]) b.sph(0.022, PINK, { at: [E[0] + dr * ca - dw * sa, 0.135, E[2] + dr * sa + dw * ca], scale: [1, 0.5, 1], w: 6, h: 4, line: 0 });
  }
}

// ---- 6 돌진 멧돼지(각진 통 몸)
function buildBoar(b) {
  const RB = 0x8e3b22, BACK = 0x6a2614, BELLY = 0xbf6a40, SNOUT = 0xd9846a, NOSE = 0xeaa08a, LEG = 0x5e2414, HOOF = 0x2b1d1a;
  const MANE = 0xffd23a, MANE_T = 0xfff2a0, MANE_B = 0xf09a18, IVORY = 0xfff4dc;
  const pr = [[0, -0.76], [0.3, -0.66], [0.43, -0.4], [0.47, -0.1], [0.53, 0.18], [0.5, 0.38], [0.36, 0.54], [0, 0.6]].map(([r, y]) => new THREE.Vector2(r, y));
  const BX = -0.05, BY = 0.7, SH = 0.86;
  const bodyTop = (x) => BY + SH * radiusAt(pr, x - BX);
  b.part(0, [0, 0.7, 0], "body");
  b.lathe(pr, (p, n) => {
    let c = mixHex(BELLY, RB, smooth(-0.6, -0.1, n.y));
    return mixHex(c, BACK, 0.6 * smooth(0.4, 0.9, n.y));
  }, { at: [BX, BY, 0], rot: [0, 0, -Math.PI / 2], scale: [SH, 1, 0.9], n: 10, flat: true, mat: MAT.fur });
  // 갈기(등 — 노란 가시, 뒤로 누웠다)
  for (const [x, h] of [[0.3, 0.34], [0.12, 0.36], [-0.08, 0.33], [-0.28, 0.29], [-0.46, 0.24], [-0.62, 0.18]]) {
    b.cone(0.1, h, (p) => mixHex(MANE_B, mixHex(MANE, MANE_T, smooth(0.5, 1, (p.y - bodyTop(x)) / h)), smooth(0, 0.3, (p.y - bodyTop(x)) / h)), { at: [x, bodyTop(x) + h * 0.3, 0], rot: [0, 0, 0.6], scale: [1, 1, 0.7], sides: 5, flat: true });
  }
  // 머리(부위 4 — 목 축): 각진 머리 · 코 · 콧구멍 · 엄니 · 귀 · 앞 갈기 · 눈 · 눈썹 · 어질 별(부위 10)
  b.part(4, [0.38, 0.78, 0], "head");
  b.sph(0.34, (p, n) => mixHex(RB, BACK, 0.5 * smooth(0.3, 0.9, n.y)), { at: [0.6, 0.76, 0], scale: [1.0, 0.92, 0.95], w: 9, h: 7, flat: true, mat: MAT.fur });
  b.sph(0.2, SNOUT, { at: [0.86, 0.63, 0], scale: [0.85, 0.8, 1.0], w: 9, h: 6, flat: true, mat: MAT.fur });
  b.add(new THREE.CylinderGeometry(0.15, 0.16, 0.07, b.seg(10, 6)), NOSE, { at: [0.99, 0.64, 0], rot: [0, 0, -Math.PI / 2], scale: [1, 1, 0.92], flat: true });
  for (const s of [-1, 1]) {
    b.sph(0.034, 0x2a0e0a, { at: [1.03, 0.65, s * 0.055], scale: [0.5, 1.25, 1], w: 6, h: 5, line: 0 });
    b.tube([[0.9, 0.55, s * 0.13], [1.02, 0.52, s * 0.21], [1.12, 0.6, s * 0.27], [1.15, 0.77, s * 0.27]], 0.055, 0.012, IVORY, { mat: MAT.gloss, n: 10, r: 6 });
    b.cone(0.09, 0.22, BACK, { at: [0.48, 1.04, s * 0.21], rot: [s * 0.65, 0, 0.45], scale: [0.6, 1, 1], sides: 4, flat: true });
    b.cone(0.05, 0.14, 0xe08a7a, { at: [0.51, 1.03, s * 0.215], rot: [s * 0.65, 0, 0.45], scale: [0.4, 1, 1], sides: 4, flat: true, line: 0 });
  }
  for (const [x, y, h] of [[0.6, 1.06, 0.28], [0.44, 1.1, 0.32]]) b.cone(0.09, h, (p) => mixHex(MANE, MANE_T, smooth(y, y + h * 0.7, p.y)), { at: [x, y + h * 0.25, 0], rot: [0, 0, 0.7], scale: [1, 1, 0.7], sides: 5, flat: true });
  for (const [i, s] of [[1, -1], [2, 1]]) {
    const c = [0.82, 0.86, s * 0.165];
    b.part(i, c, "eye", s, { parent: 4 });
    b.sph(0.068, 0xfff3b0, { at: c, rot: [s * 0.3, -s * 0.5, 0], order: "YXZ", scale: [0.6, 0.75, 1], mat: MAT.eye, w: 10, h: 8, line: 0.8 });
    b.sph(0.034, 0x1a0606, { at: [c[0] + 0.035, c[1] - 0.005, c[2] + s * 0.012], mat: MAT.shiny, w: 6, h: 5, line: 0 });
  }
  b.part(3, [0.86, 0.93, 0], "brow", 0, { parent: 4 });
  for (const s of [-1, 1]) b.stick([0.88, 0.91, s * 0.06], [0.79, 0.99, s * 0.25], 0.04, 0x2a0d08, { n: 6 });
  // 네 다리(부위 5..8 — 엉덩이 축 · 몸통 눌림을 받지 않는다): 다리 + 굽
  for (const [i, fb, s] of [[5, 1, -1], [6, 1, 1], [7, -1, -1], [8, -1, 1]]) {
    const x = fb > 0 ? 0.3 : -0.44;
    const hip = [x, 0.46, s * 0.25];
    b.part(i, hip, "leg", s, { fb, under: "lean" });
    b.limb(hip, [x + 0.02, 0.13, s * 0.26], 0.105, 0.085, LEG, { mid: 0.11, n: 8 });
    b.add(new THREE.CylinderGeometry(0.09, 0.11, 0.11, b.seg(8, 5)), HOOF, { at: [x + 0.03, 0.055, s * 0.26], mat: MAT.gloss, flat: true });
  }
  // 말린 꼬리(부위 9) + 노란 술
  b.part(9, [-0.78, 0.82, 0], "tail");
  b.torus(0.08, 0.026, RB, { at: [-0.86, 0.88, 0], rot: [0, 0, 0.4], r: 5, n: 12, arc: Math.PI * 1.6 });
  b.sph(0.045, MANE, { at: [-0.95, 0.93, 0], w: 6, h: 5 });
  // 어질 별 셋(부위 10 — 머리 위를 돈다, 어질어질할 때만 보인다)
  b.part(10, [0.58, 1.42, 0], "stars", 0, { parent: 4 });
  const star = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 0.045 : 0.1;
    if (k) star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    b.slab(star, 0.035, 0xffe34a, { at: [0.58 + 0.3 * Math.cos(a), 1.42, 0.3 * Math.sin(a)], rot: [-Math.PI / 2 + 0.5, 0, 0], mat: MAT.core, emit: 0.4, cs: 1, bevel: 0.01, line: 0.7 });
  }
}

// ---- 7 잉크 거미 여왕
function buildSpider(b) {
  const NAVY = 0x0e2432, TEAL = 0x1f6b7a, LEG = 0x163f4f, LEG2 = 0x0d2a36, JOINT = 0x2fb3c4, MAG = 0xff2d95, CYAN = 0x46f0ff, GOLD = 0xffc83a, FANG = 0xf4ecff;
  // 머리가슴(부위 0 — 각진 등딱지)
  const CC = [0.36, 0.5, 0], CR = [0.4, 0.29, 0.34];
  b.part(0, [0.2, 0.5, 0], "body");
  b.sph(1, (p, n) => mixHex(NAVY, TEAL, smooth(-0.1, 0.9, n.y)), { at: CC, scale: CR, mat: MAT.fur, w: 10, h: 7, flat: true });
  b.sph(0.12, NAVY, { at: [-0.06, 0.56, 0], mat: MAT.gloss, w: 8, h: 6 });
  // 작은 눈 넷(빛난다)
  for (const s of [-1, 1]) {
    for (const [y, z, r] of [[0.705, 0.05, 0.034], [0.665, 0.19, 0.036]]) b.sph(r, CYAN, { at: [ellX(CC, CR, y, z) - 0.01, y, s * z], mat: MAT.glowEye, emit: 0.4, w: 6, h: 5, line: 0.6 });
  }
  // 큰 눈 둘(부위 1 · 2)
  for (const [i, s] of [[1, -1], [2, 1]]) {
    const y = 0.6, z = 0.1;
    const c = [ellX(CC, CR, y, z) - 0.025, y, s * z];
    b.part(i, c, "eye", s);
    b.sph(0.085, CYAN, { at: c, scale: [0.8, 1, 1], mat: MAT.glowEye, emit: 0.5, w: 10, h: 8, line: 0.8 });
    b.sph(0.022, 0xffffff, { at: [c[0] + 0.06, c[1] + 0.035, c[2] - s * 0.02], emit: 1.2, w: 5, h: 4, line: 0 });
  }
  // 엄니(부위 3): 턱 둘 + 휜 송곳니(상아 → 끝은 자홍)
  b.part(3, [0.68, 0.44, 0], "fang");
  for (const s of [-1, 1]) {
    b.sph(0.075, NAVY, { at: [0.69, 0.43, s * 0.075], scale: [1, 1.1, 0.9], mat: MAT.gloss, w: 8, h: 6 });
    b.tube([[0.74, 0.4, s * 0.075], [0.81, 0.31, s * 0.075], [0.8, 0.2, s * 0.045], [0.74, 0.14, s * 0.015]], 0.036, 0.008, (p) => mixHex(FANG, MAG, smooth(0.3, 0.16, p.y)), { mat: MAT.gloss, n: 8, r: 6 });
  }
  // 배(부위 4 — 허리 축): 반들반들한 큰 배 + 빛나는 모래시계 무늬 + 가시 줄 + 빛나는 점
  const AC = [-0.46, 0.76, 0], AR = [0.62, 0.5, 0.55], AROT = [0, 0, -0.22];
  b.part(4, [-0.06, 0.56, 0], "abdomen");
  b.sph(1, (p, n) => mixHex(NAVY, TEAL, smooth(-0.2, 0.85, n.y)), { at: AC, rot: AROT, scale: AR, mat: MAT.fur, w: 16, h: 12 });
  const em = new THREE.Matrix4().compose(V3(AC), new THREE.Quaternion().setFromEuler(new THREE.Euler(...AROT)), V3(AR));
  const en = new THREE.Matrix3().getNormalMatrix(em);
  const onAbd = (d) => {
    const u = V3(norm3(d));
    return { p: u.clone().applyMatrix4(em).toArray(), n: u.clone().applyMatrix3(en).normalize().toArray() };
  };
  const hg = (u, v) => {
    const au = Math.abs(u);
    return au < 0.4 && Math.abs(v) < 0.04 + 0.2 * smooth(0.04, 0.38, au) && !(au > 0.33 && Math.abs(v) > 0.19);
  };
  b.add(sphereDecal(hg, b.seg(28, 14)), MAG, { at: AC, rot: AROT, scale: AR.map((x) => x * 1.012), mat: MAT.core, emit: 0.4, line: 0 });
  for (const [x, z, h] of [[0.55, 0, 0.22], [-0.05, 0, 0.26], [-0.45, 0, 0.24], [-0.8, 0, 0.18], [0.3, 0.55, 0.17], [-0.2, 0.62, 0.2], [-0.62, 0.5, 0.16], [0.3, -0.55, 0.17], [-0.2, -0.62, 0.2], [-0.62, -0.5, 0.16]]) {
    const { p, n } = onAbd([x, 0.9 - 0.25 * Math.abs(z) - 0.1 * Math.abs(x), z]);
    b.cone(0.055, h, (q) => mixHex(LEG2, MAG, smooth(0.35, 1, Math.hypot(q.x - p[0], q.y - p[1], q.z - p[2]) / h)), { at: add3(p, n, h * 0.3), quat: upTo(n), mat: MAT.gloss, sides: 5, flat: true });
  }
  for (const [x, z] of [[0.35, 0.82], [-0.15, 0.9], [0.35, -0.82], [-0.15, -0.9], [-0.7, 0.6], [-0.7, -0.6]]) {
    const { p } = onAbd([x, 0.15, z]);
    b.sph(0.035, CYAN, { at: p, mat: MAT.core, emit: 0.3, w: 6, h: 4, line: 0 });
  }
  // 마디진 다리 여덟(부위 5..12 — 엉덩이 축): 허벅지 → 무릎(빛나는 마디 + 가시) → 가늘고 뾰족한 끝
  const HX = [0.5, 0.42, 0.32, 0.22], TH = [0.62, 1.22, 1.9, 2.5], LL = [1.12, 1.0, 1.0, 1.08];
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) {
      const idx = 5 + i * 2 + (s > 0 ? 1 : 0);
      const d = [Math.cos(TH[i]), 0, s * Math.sin(TH[i])];
      const hip = [HX[i], 0.46, s * 0.24];
      const kn = [hip[0] + d[0] * LL[i] * 0.4, 1.0 + (i === 0 ? 0.05 : 0), hip[2] + d[2] * LL[i] * 0.4];
      const ft = [hip[0] + d[0] * LL[i], 0.02, hip[2] + d[2] * LL[i]];
      b.part(idx, hip, "leg", s, { k: i, dir: d });
      b.limb(hip, kn, 0.062, 0.048, LEG, { mid: 0.07, n: 8, mat: MAT.gloss });
      b.limb(kn, ft, 0.046, 0.012, (p) => mixHex(LEG, LEG2, smooth(0.8, 0.1, p.y)), { mid: 0.05, n: 8, mat: MAT.gloss });
      b.sph(0.064, JOINT, { at: kn, mat: MAT.gloss, w: 8, h: 6 });
      b.cone(0.03, 0.15, MAG, { at: add3(kn, norm3([-d[0] * 0.4, 1, -d[2] * 0.4]), 0.1), quat: upTo([-d[0] * 0.4, 1, -d[2] * 0.4]), mat: MAT.gloss, sides: 4, line: 0.6 });
    }
  }
  // 작은 금관(부위 13)
  b.part(13, [0.36, 0.78, 0], "crown");
  b.lathe([[0.13, 0.74], [0.155, 0.75], [0.165, 0.82], [0.16, 0.84], [0.145, 0.835], [0.14, 0.78]].map(([r, y]) => new THREE.Vector2(r, y)), GOLD, { at: [0.36, 0, 0], mat: MAT.gold, n: 14 });
  for (let k = 0; k < 5; k++) {
    const a = ((k - 2) / 5) * Math.PI * 0.9;
    const d = norm3([Math.cos(a) * 0.25, 1, Math.sin(a) * 0.25]);
    const base = [0.36 + 0.155 * Math.cos(a), 0.83, 0.155 * Math.sin(a)];
    const h = k === 2 ? 0.17 : 0.11;
    b.cone(0.04, h, GOLD, { at: add3(base, d, h * 0.5), quat: upTo(d), mat: MAT.gold, sides: 5 });
    b.sph(0.026, k === 2 ? MAG : CYAN, { at: add3(base, d, h + 0.015), mat: MAT.shiny, emit: 0.5, w: 5, h: 4, line: 0.6 });
  }
}

/** 단위 구 꼭대기에 붙는 무늬: 격자를 모양 안(inside(u, v) — u 앞뒤(x) · v 옆(z), −0.5..0.5)만 남겨 구면에 붙인다 */
function sphereDecal(inside, n) {
  const P = [], N = [], I = [];
  const idx = new Map();
  const vert = (i, j) => {
    const k = i * (n + 1) + j;
    if (!idx.has(k)) {
      const u = -0.5 + i / n, v = -0.5 + j / n;
      const p = norm3([u, Math.sqrt(Math.max(0, 1 - u * u - v * v)), v]);
      idx.set(k, P.length / 3);
      P.push(...p);
      N.push(...p);
    }
    return idx.get(k);
  };
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!inside(-0.5 + (i + 0.5) / n, -0.5 + (j + 0.5) / n)) continue;
      const a = vert(i, j), bb = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1);
      I.push(a, c, bb, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  g.setIndex(I);
  return g;
}

const BUILD = [buildSlime, buildDokkaebi, buildKing, buildBat, buildGoblin, buildSquid, buildBoar, buildSpider];
/** 종류마다 지을 때 곱하는 크기(고블린은 깡마른 몸을 조금 키워 슬라임만 하게) */
const UNIT = [1, 1, 1, 1, 1.2, 1, 1, 1];
// 걸음새: hop 깡충(눌림 · 늘어남) · biped 두 발(관절) · fly 날갯짓(떠 있다) · glide 미끄러지듯 · trot 네 발 종종 · skitter 다리 여덟 사사삭.
// freq = 초당 걸음 주기, cy = 몸 축 높이(엉덩이 — 기울기 · 눌림의 중심), bob 들썩 · roll 좌우 흔들 · lean 숙임 · step 다리 앞뒤(라디안) ·
// knee 무릎 굽힘 · swing 팔 흔들기 · armOut 팔 벌림 · elbow 팔꿈치 · legLen 다리 길이(웅크리면 그만큼 내려간다) · hunch 늘 숙인 등 ·
// dashRate 돌진하면 걸음이 이만큼 더 빠르다 · flap 날갯짓(쉴 때 · 움직일 때 초당)
const GAIT = [
  { kind: "hop", freq: 2.3, hop: 0.34 },
  { kind: "biped", freq: 1.7, cy: 0.62, bob: 0.05, roll: 0.07, lean: 0.08, step: 0.45, knee: 0.75, swing: 0.5, armOut: 0.2, elbow: 0.3, legLen: 0.52, dashRate: 0.8 },
  { kind: "biped", freq: 1.05, cy: 0.74, bob: 0.06, roll: 0.05, lean: 0.06, step: 0.38, knee: 0.65, swing: 0.35, armOut: 0.16, elbow: 0.25, legLen: 0.61, dashRate: 0.8 },
  { kind: "fly", freq: 1.4, cy: BAT_C, flap: [4, 7] },
  { kind: "biped", freq: 2.2, cy: 0.42 * 1.2, bob: 0.05, roll: 0.06, lean: 0.16, step: 0.55, knee: 0.95, swing: 0.6, armOut: 0.28, elbow: 0.55, legLen: 0.34 * 1.2, hunch: 0.12, dashRate: 0.8 },
  { kind: "glide", freq: 1.1, bob: 0.05, roll: 0.07, lean: 0.08 },
  { kind: "trot", freq: 2.2, bob: 0.05, roll: 0.03, lean: 0.05, step: 0.45, lift: 0.07, dashRate: 0.9 },
  { kind: "skitter", freq: 2.6, bob: 0.03, roll: 0.03, lean: 0.04, dashRate: 0.8 },
];

const geoCache = new Map();
/** 종류의 지오메트리(본 그림 | 외곽선 — 한 번 지어 모든 몬스터가 함께 쓴다) */
export function monsterGeometry(kind, line = false) {
  const k = `${kind}|${line ? 1 : 0}`;
  let g = geoCache.get(k);
  if (!g) {
    const b = builder(line ? LINE_DETAIL : 1, line, UNIT[kind]);
    BUILD[kind](b);
    g = b.done();
    geoCache.set(k, g);
  }
  return g;
}
const triOf = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
/** 종류 하나의 삼각형 수: { main, line, total } */
export function monsterTriangles(kind) {
  const main = triOf(monsterGeometry(kind)), line = triOf(monsterGeometry(kind, true));
  return { main, line, total: main + line };
}
// ------------------------------------------------------------------ 셰이더(본 그림 · 외곽선)
const VERT = /* glsl */ `
uniform mat4 uPart[${MONSTER_PARTS}];
uniform mat3 uNrm[${MONSTER_PARTS}];
uniform float uMode;     // 0 본 그림 · 1 외곽선
uniform float uThick;
uniform vec2 uPos;       // 발 자리(안개)
in vec3 aCol;
in vec3 aFx;
in vec3 aOut;
in float aPart;
out vec3 vN;
out vec3 vW;
out vec3 vObj;
out vec3 vCol;
out vec3 vFx;
out vec2 vFog;
${GLSL_FOG}
void main() {
  int p = int(aPart + 0.5);
  vec4 w = modelMatrix * (uPart[p] * vec4(position, 1.0));
  mat3 nm = mat3(modelMatrix) * uNrm[p];
  vN = normalize(nm * normal);
  if (uMode > 0.5) w.xyz += normalize(nm * aOut) * uThick * aFx.z;
  vW = w.xyz;
  vObj = position;
  vCol = aCol;
  vFx = aFx;
  vFog = fogK(uPos);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform float uMode;
uniform vec3 uLine;
uniform vec4 uState;   // x 맞음 번쩍 · y 얼음 · z 기 모으기 · w 움직임 시간(초)
uniform vec3 uGlow;    // 기 모으기 빛 색
uniform float uRage;   // 성남(0..1): 눈 · 보석 · 외곽선 · 테두리가 붉게 탄다
uniform float uClipY;  // 이보다 낮은 곳은 버린다(웅덩이에서 솟기 · 가라앉기)
in vec3 vN;
in vec3 vW;
in vec3 vObj;
in vec3 vCol;
in vec3 vFx;
in vec2 vFog;
layout(location = 0) out vec4 outColor;
${GLSL_LIGHTS}
${GLSL_FOG}
const vec3 LDIR = ${v3s(LDIR)};
const vec3 VDIR = ${v3s(PROJ.view)};
const vec3 RAGE = vec3(1.0, 0.1, 0.3);
void main() {
  if (vW.y < uClipY) discard;
  if (uShadowPass > 0.5) {
    if (uMode > 0.5) discard;
    outColor = vec4(1.0);
    return;
  }
  float hit = uState.x, ice = uState.y, wind = uState.z, t = uState.w;
  float pulse = 0.5 + 0.5 * sin(t * (9.0 + 18.0 * wind));
  float rp = 0.5 + 0.5 * sin(t * 7.0);
  if (uMode > 0.5) {
    // 외곽선: 짙은 보라 · 얼면 짙은 하늘빛 · 기를 모으면 종류 색으로 깜빡이며 빛난다 · 성나면 붉게 · 맞으면 흰빛
    vec3 lc = mix(uLine, vec3(0.1, 0.26, 0.5), ice * 0.85);
    lc = mix(lc, uGlow * 1.9, wind * (0.3 + 0.7 * pulse));
    lc = mix(lc, RAGE * 1.7, uRage * (0.35 + 0.4 * rp));
    lc = mix(lc, vec3(1.8), hit * 0.55);
    outColor = vec4(fogApply(lc, vFog), 1.0);
    return;
  }
  vec3 N = normalize(vN);
  int mat = int(vFx.y + 0.5);
  vec3 base = vCol;
  float spec = ${CS.spec.toFixed(3)};
  float sPow = 24.0;
  float emit = vFx.x;
  float flat_ = 0.0;
  if (mat == 1) { spec = 0.85; sPow = 36.0; }
  else if (mat == 2) { emit += 0.45 + 0.2 * sin(t * 3.0) + wind * (1.2 + 0.9 * pulse); spec = 1.2; }
  else if (mat == 3) { flat_ = 0.55; spec = 0.5; }
  else if (mat == 4) {
    float th = atan(vObj.z, vObj.x);
    float s = sin(th * 9.0 + sin(vObj.y * 22.0 + th * 3.0) * 1.3);
    base = mix(base, vec3(0.03, 0.02, 0.03), smoothstep(0.45, 0.6, s));
  }
  else if (mat == 5) { base *= mix(0.6, 1.25, smoothstep(-0.2, 0.9, N.y)); spec = 1.2; sPow = 30.0; }
  else if (mat == 6) { emit += 0.8 + wind * (1.0 + 0.8 * pulse); flat_ = 0.7; }
  else if (mat == 7) { spec = 1.3; sPow = 50.0; }
  else if (mat == 8) { spec = 0.1; sPow = 10.0; } // 털 · 각진 면: 반짝이 거의 없이(면마다 하얀 얼룩이 지지 않게)
  if (mat == 2 || mat == 6) {
    base = mix(base, RAGE * 1.15, uRage * 0.8);
    emit += uRage * (0.4 + 0.5 * rp);
  }
  // 툰 3단계(그늘은 보랏빛)
  float d = dot(N, LDIR);
  float band = d > ${CS.bands[0].toFixed(3)} ? 1.0 : d > ${CS.bands[1].toFixed(3)} ? ${CS.mid.toFixed(3)} : ${CS.dark.toFixed(3)};
  band = mix(band, 1.0, flat_);
  vec3 tint = mix(${v3s(CS.shadowTint)}, vec3(1.0), smoothstep(${CS.dark.toFixed(3)}, 1.0, band));
  vec3 col = base * band * tint;
  col += base * (${CS.emit.toFixed(3)} + emit);
  if (mat == 1) col += base * 0.15 * smoothstep(-0.2, 0.6, d); // 젤리 · 잉크 광택: 빛 쪽이 속까지 밝다
  vec3 H = normalize(LDIR + VDIR);
  col += vec3(1.0) * smoothstep(0.55, 0.7, pow(max(dot(N, H), 0.0), sPow)) * spec;
  // 테두리 빛(어두운 바닥 위에서도 몸 윤곽이 읽히게) + 기 모으기 빛 + 성남
  float rim = pow(1.0 - max(dot(N, VDIR), 0.0), 2.5);
  col += mix(base, vec3(0.8, 0.85, 1.0), 0.5) * rim * 0.3;
  col += uGlow * rim * wind * (0.8 + 1.2 * pulse);
  col += RAGE * rim * uRage * (0.6 + 0.6 * rp);
  col = shade(col, vW, N);
  // 얼음: 밝기를 살린 하늘빛 + 서리 테
  if (ice > 0.0) {
    float l = dot(col, vec3(0.3, 0.59, 0.11));
    vec3 icy = mix(vec3(0.3, 0.55, 0.95), vec3(0.92, 0.98, 1.0), smoothstep(0.12, 0.9, l));
    col = mix(col, icy * (0.75 + 0.45 * l) + vec3(0.6, 0.85, 1.0) * rim * 0.7, ice * 0.72);
  }
  col = mix(col, vec3(1.5, 1.45, 1.4), hit * 0.5);
  outColor = vec4(fogApply(col, vFog), 1.0);
}`;

// ------------------------------------------------------------------ 발밑 그림자 · 잉크 웅덩이(묶음 하나)
const SHADOW_RGB = lin(STYLE.colors.shadow);
const GROUND_VERT = /* glsl */ `
in vec4 iA;  // x, z, 반폭(u), 크기(scale)
in vec4 iB;  // 잉크 색(선형), 씨앗
in vec4 iC;  // 그림자 진하기, 그림자 크기 배율, 웅덩이(0..1), 웅덩이 진하기
out vec2 vQ;
out vec2 vFog;
flat out vec4 vB;
flat out vec4 vC;
${GLSL_FOG}
void main() {
  vec2 o = position.xy * 2.0 * iA.z;
  vQ = o / iA.w;
  vB = iB;
  vC = iC;
  vFog = fogK(iA.xy);
  gl_Position = projectionMatrix * viewMatrix * vec4(iA.x + o.x, 0.02, iA.y + o.y, 1.0);
}`;
const GROUND_FRAG = /* glsl */ `
in vec2 vQ;
in vec2 vFog;
flat in vec4 vB;
flat in vec4 vC;
layout(location = 0) out vec4 outColor;
${GLSL_FOG}
void main() {
  vec2 q = vQ;
  // 그림자: 빛이 왼쪽 위라 오른쪽 아래로 조금
  vec2 sq = (q - vec2(0.1, 0.08)) / (0.8 * vC.y);
  float sh = (1.0 - smoothstep(0.4, 1.0, length(sq))) * vC.x;
  // 잉크 웅덩이: 일렁이는 가장자리 + 둘레의 방울
  float ia = 0.0;
  vec3 ic = vB.rgb;
  if (vC.z > 0.001) {
    float R = vC.z * 1.2;
    float a = atan(q.y, q.x);
    float sd = vB.w * 6.2832;
    float rr = R * (1.0 + 0.1 * sin(a * 5.0 + sd) + 0.06 * sin(a * 9.0 + sd * 2.7) + 0.04 * sin(a * 13.0 + sd * 4.9));
    float d = length(q) - rr;
    for (int i = 0; i < 4; i++) {
      float ai = sd + float(i) * 1.7 + 0.4;
      vec2 c = vec2(cos(ai), sin(ai)) * R * (1.28 + 0.14 * float(i - (i / 2) * 2));
      d = min(d, length(q - c) - R * (0.13 - 0.02 * float(i)));
    }
    float aa = fwidth(d) + 1e-4;
    ia = (1.0 - smoothstep(-aa, aa, d)) * vC.w;
    float hl = smoothstep(-0.28 * R, -0.06 * R, d) * smoothstep(0.1, 0.7, dot(normalize(q + 1e-4), vec2(-0.6, -0.8)));
    ic = vB.rgb * (0.5 + 0.3 * (1.0 - smoothstep(0.0, R, length(q)))) + vec3(0.9, 0.95, 1.0) * hl * 0.35;
    ic = fogApply(ic, vFog);
  }
  float alpha = ia + sh * (1.0 - ia);
  if (alpha < 0.004) discard;
  outColor = vec4(mix(${v3s(SHADOW_RGB)}, ic, ia / max(alpha, 1e-4)), alpha);
}`;

// ------------------------------------------------------------------ 머리 위 체력 막대(묶음 하나 — 카메라를 똑바로 본다)
const HP_GOOD = lin(0x3dff6a), HP_MID = lin(0xffe600), HP_BAD = lin(0xff2d3d);
const BAR_VERT = /* glsl */ `
in vec4 iP;  // 가운데 x, y, z, 체력
in vec4 iS;  // 가로, 세로(u), 늦게 따라오는 체력, 투명도
in float iBoss;
out vec2 vUv;
flat out vec4 vP;
flat out vec4 vS;
flat out float vBoss;
const vec3 R = ${v3s(PROJ.right)};
const vec3 U = ${v3s(PROJ.up)};
const vec3 V = ${v3s(PROJ.view)};
void main() {
  vec3 w = iP.xyz + R * position.x * iS.x + U * position.y * iS.y + V * 0.6;
  vUv = position.xy + 0.5;
  vP = iP;
  vS = iS;
  vBoss = iBoss;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const BAR_FRAG = /* glsl */ `
in vec2 vUv;
flat in vec4 vP;
flat in vec4 vS;
flat in float vBoss;
layout(location = 0) out vec4 outColor;
float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 size = vS.xy;
  vec2 p = (vUv - 0.5) * size;
  float d = box(p, size * 0.5, size.y * 0.5);
  float aa = fwidth(d) + 1e-5;
  float outer = 1.0 - smoothstep(-aa, aa, d);
  if (outer < 0.004) discard;
  float bw = size.y * 0.2;
  float inner = 1.0 - smoothstep(-aa, aa, d + bw);
  float fx = (vUv.x * size.x - bw) / max(size.x - 2.0 * bw, 1e-4);
  float ex = fwidth(fx) + 1e-5;
  float hp = vP.w;
  vec3 fc = hp > 0.5 ? mix(${v3s(HP_MID)}, ${v3s(HP_GOOD)}, (hp - 0.5) * 2.0) : mix(${v3s(HP_BAD)}, ${v3s(HP_MID)}, hp * 2.0);
  float fill = 1.0 - smoothstep(hp - ex, hp + ex, fx);
  float lag = 1.0 - smoothstep(vS.z - ex, vS.z + ex, fx);
  vec3 col = vec3(0.02, 0.015, 0.05);
  col = mix(col, vec3(0.95, 0.9, 0.85), lag * 0.85);
  col = mix(col, fc * (0.82 + 0.3 * smoothstep(0.45, 0.85, vUv.y)), fill);
  // 보스: 10칸 눈금
  if (vBoss > 0.5) col *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, ex * 1.5, abs(fract(fx * 10.0 + 0.5) - 0.5) / 10.0)) * step(0.02, fx) * step(fx, 0.98);
  vec3 rimC = vBoss > 0.5 ? vec3(0.95, 0.75, 0.25) : vec3(0.06, 0.035, 0.13);
  col = mix(rimC, col, inner);
  outColor = vec4(col, outer * vS.w);
}`;

function instGeo(attrs, max = MAX_INST) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute("position", quad.getAttribute("position"));
  const bufs = {};
  for (const [name, size] of Object.entries(attrs)) {
    bufs[name] = new Float32Array(max * size);
    g.setAttribute(name, new THREE.InstancedBufferAttribute(bufs[name], size).setUsage(THREE.DynamicDrawUsage));
  }
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return { g, bufs };
}

// ------------------------------------------------------------------ 날아가는 잉크 덩이 · 고블린 폭탄(묶음 하나)
// 로컬 좌표: +x 가 날아가는 쪽, 반지름 1(판정 반지름 r 을 곱한다). 부위 0 덩이 · 1..3 꼬리 방울 · 4 폭탄(쇠공 · 잉크 띠 · 마개 · 심지) · 5 불꽃.
// 재질(aFx.y): 0 잉크 색으로 번들 · 1 제 색 그대로 · 2 빛 색으로 활활(불꽃) · 3 잉크 색으로 빛나는 띠
const SPARK = [0.05, 1.68, 0];
function buildShot(b) {
  b.part(0, [0, 0, 0], "glob");
  b.lathe(profile([[0, -1.5], [0.2, -1.28], [0.48, -0.86], [0.8, -0.4], [0.98, 0.06], [0.93, 0.5], [0.66, 0.86], [0.3, 1.02], [0, 1.05]], 14), 0xffffff, { rot: [0, 0, -Math.PI / 2], n: 16 });
  b.sph(0.22, 0xffffff, { at: [0.42, 0.5, -0.32], scale: [1.4, 0.7, 1], emit: 0.6, w: 8, h: 6, line: 0 });
  for (const [i, x, r, y] of [[1, -1.95, 0.36, 0.08], [2, -2.55, 0.25, -0.06], [3, -3.0, 0.16, 0.05]]) {
    b.part(i, [0, 0, 0], "drop");
    b.sph(r, 0xffffff, { at: [x, y, 0], w: 10, h: 7 });
  }
  b.part(4, [0, 0, 0], "bomb");
  b.sph(0.92, 0x1d1a2c, { mat: 1, w: 16, h: 12 });
  b.torus(0.9, 0.11, 0xffffff, { rot: [Math.PI / 2, 0, 0], mat: 3, r: 4, n: 20 });
  b.add(new THREE.CylinderGeometry(0.3, 0.34, 0.24, b.seg(12, 6)), 0x8a8fa8, { at: [0, 0.95, 0], mat: 1 });
  b.tube([[0, 1.02, 0], [0.12, 1.24, 0], [-0.05, 1.42, 0], [0.04, 1.6, 0]], 0.08, 0.06, 0xc8a060, { mat: 1, n: 8, r: 5 });
  b.part(5, [0, 0, 0], "spark");
  b.sph(0.2, 0xffffff, { at: SPARK, mat: 2, w: 8, h: 6, line: 0 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    const d = norm3([Math.cos(a), 0.5, Math.sin(a)]);
    b.cone(0.06, 0.36, 0xffffff, { at: add3(SPARK, d, 0.26), quat: upTo(d), mat: 2, sides: 4, line: 0 });
  }
}
const SHOT_VERT = /* glsl */ `
uniform float uMode;
uniform float uThick;
uniform float uTime;
in vec3 aCol;
in vec3 aFx;
in vec3 aOut;
in float aPart;
in vec4 iP;  // x, y, z, 반지름
in vec4 iD;  // dx, dz(날아가는 쪽), 씨앗, 폭탄(1)
in vec3 iC;  // 잉크 색(선형)
in vec3 iG;  // 빛 색(선형)
out vec3 vN;
out vec3 vW;
out vec3 vCol;
flat out vec3 vInk;
flat out vec3 vGlow;
flat out float vMat;
out vec2 vFog;
${GLSL_FOG}
mat3 rotZ(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0);
}
void main() {
  // 덩이와 폭탄은 한 장에 들어 있다 — 안 쓰는 쪽은 그리지 않는다(클립 밖 한 점)
  if ((iD.w > 0.5) != (aPart > 3.5)) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float t = uTime + iD.z * 7.0;
  vec3 p = position, n = normal, o = aOut;
  if (aPart < 0.5) {
    // 출렁: 날아가는 쪽으로 늘었다 줄었다
    float k = 0.09 * sin(t * 13.0);
    vec3 sc = vec3(1.0 + k, 1.0 - 0.5 * k, 1.0 - 0.5 * k);
    p *= sc;
    n /= sc;
    o /= sc;
  } else if (aPart < 3.5) {
    // 꼬리 방울은 살랑
    p.y += 0.12 * sin(t * 9.0 + aPart * 1.9);
    p.z += 0.1 * sin(t * 7.0 + aPart * 2.7);
  } else {
    if (aPart > 4.5) {
      // 불꽃: 파르르
      vec3 c = ${v3s(SPARK)};
      p = c + (p - c) * (0.75 + 0.35 * sin(t * 47.0) * sin(t * 31.0 + 1.0));
    }
    // 폭탄은 앞으로 데굴데굴
    mat3 R = rotZ(-t * 7.0);
    p = R * p;
    n = R * n;
    o = R * o;
  }
  mat3 B = mat3(vec3(iD.x, 0.0, iD.y), vec3(0.0, 1.0, 0.0), vec3(-iD.y, 0.0, iD.x));
  vN = normalize(B * n);
  vec3 w = iP.xyz + B * p * iP.w;
  if (uMode > 0.5) w += normalize(B * o) * uThick * aFx.z;
  vW = w;
  vCol = aCol;
  vInk = iC;
  vGlow = iG;
  vMat = aFx.y;
  vFog = fogK(iP.xz);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const SHOT_FRAG = /* glsl */ `
uniform float uMode;
uniform vec3 uLine;
in vec3 vN;
in vec3 vW;
in vec3 vCol;
flat in vec3 vInk;
flat in vec3 vGlow;
flat in float vMat;
in vec2 vFog;
layout(location = 0) out vec4 outColor;
${GLSL_LIGHTS}
${GLSL_FOG}
const vec3 LDIR = ${v3s(LDIR)};
const vec3 VDIR = ${v3s(PROJ.view)};
void main() {
  if (uShadowPass > 0.5) discard;
  if (uMode > 0.5) {
    outColor = vec4(fogApply(uLine, vFog), 1.0);
    return;
  }
  vec3 N = normalize(vN);
  int mat = int(vMat + 0.5);
  vec3 base = mat == 1 ? vCol : mat == 2 ? vGlow * vCol : vInk * vCol;
  float emit = mat == 2 ? 1.7 : mat == 3 ? 0.9 : mat == 0 ? 0.32 : 0.0;
  // 몬스터와 같은 툰 3단계 + 잉크 광택 + 반짝 + 빛 색 테두리(어두운 바닥 위에서도 또렷하게)
  float d = dot(N, LDIR);
  float band = d > ${CS.bands[0].toFixed(3)} ? 1.0 : d > ${CS.bands[1].toFixed(3)} ? ${CS.mid.toFixed(3)} : ${CS.dark.toFixed(3)};
  vec3 tint = mix(${v3s(CS.shadowTint)}, vec3(1.0), smoothstep(${CS.dark.toFixed(3)}, 1.0, band));
  vec3 col = base * band * tint + base * emit;
  col += base * 0.18 * smoothstep(-0.2, 0.6, d);
  vec3 H = normalize(LDIR + VDIR);
  if (mat != 2) col += vec3(1.0) * smoothstep(0.55, 0.7, pow(max(dot(N, H), 0.0), 40.0)) * 1.1;
  float rim = pow(1.0 - max(dot(N, VDIR), 0.0), 2.2);
  col += (mat == 1 ? vGlow * 0.9 : mix(vGlow, vInk, 0.3) * 0.75) * rim;
  col = shade(col, vW, N);
  outColor = vec4(fogApply(col, vFog), 1.0);
}`;

// ------------------------------------------------------------------ 자세
const ease = (t) => 1 - (1 - t) ** 3;
const wrapAngle = (a) => a - TAU * Math.round(a / TAU);
const _qa = new THREE.Quaternion(), _ax = new THREE.Vector3();

/**
 * 몬스터 하나의 자세 계층: root(자리 · 방향 · 크기 — 발 기준) → base(엉덩이 높이 cy) → lean(기울기 · 비틀기) → squash(눌림 · 늘어남) → 부위들.
 * 허벅지는 base 에(몸이 숙여도 다리는 선다), 발 · under: "lean" 은 lean 에, parent 가 있으면 그 부위에(아랫팔 → 윗팔, 눈 → 머리) 매달린다.
 */
function makeRig(kind) {
  const roles = monsterGeometry(kind).userData.roles;
  const cy = GAIT[kind].cy || 0;
  const root = new THREE.Object3D();
  const base = new THREE.Object3D();
  const lean = new THREE.Object3D();
  const squash = new THREE.Object3D();
  root.add(base);
  base.add(lean);
  lean.add(squash);
  base.position.y = cy;
  const nodes = roles.map(() => new THREE.Object3D());
  const local = roles.map((r, i) => {
    let parent, pp;
    if (r.parent != null) {
      parent = nodes[r.parent];
      pp = roles[r.parent].pivot;
    } else {
      parent = r.role === "thigh" ? base : r.role === "foot" || r.under === "lean" ? lean : squash;
      pp = [0, cy, 0];
    }
    const l = [r.pivot[0] - pp[0], r.pivot[1] - pp[1], r.pivot[2] - pp[2]];
    nodes[i].position.set(...l);
    parent.add(nodes[i]);
    return l;
  });
  return { root, base, lean, squash, nodes, roles, local };
}

/**
 * 상태 → 부위 행렬. e = 몬스터 풀 항목(연출 상태를 들고 있다), m = 이번 프레임 상태, dt = 실제로 흐른 시간.
 * 돌려주는 값: { hop(뛰어오른 높이 u — 로컬), hover(떠 있음 0..1 — 박쥐), air(뛰어오른 높이 u — 월드) }
 */
function poseMonster(e, m, dt) {
  const kind = e.kind;
  const K = MONSTER_KINDS[kind];
  const G = GAIT[kind];
  const R = e.rig;
  const frozen = !!m.frozen;
  const adt = frozen ? 0 : dt; // 얼면 연출 시간이 멈춘다(숨쉬기 · 깜빡임 · 걸음 · 날갯짓 · 촉수)
  e.at += adt;
  const at = e.at;
  const follow = (rate) => 1 - Math.exp(-adt * rate);
  e.mv += (clamp01(m.moving ?? 0) - e.mv) * follow(10);
  const mvA = Math.min(1, e.mv * 1.3);
  // 돌진 · 어지러움 · 성남은 부드럽게 들고 난다. 반동(fire) · 뛰어오름(air)은 부르는 쪽 값 그대로
  e.dsh += ((m.dash ? 1 : 0) - e.dsh) * follow(12);
  e.stn += (smooth(0, 0.08, Number(m.stun) || 0) - e.stn) * follow(9);
  e.rg += ((m.rage ? 1 : 0) - e.rg) * follow(4);
  const dsh = e.dsh, stn = e.stn, rage = e.rg;
  const fire = clamp01(Number(m.fire) || 0);
  const air = Math.max(0, Number(m.air) || 0);
  e.ph += adt * G.freq * (1 + (G.dashRate || 0) * dsh) * Math.min(1, Math.max(e.mv, dsh) * 1.5);
  const p = e.ph * TAU;
  if (G.flap) e.fl += adt * TAU * lerp(G.flap[0], G.flap[1], Math.max(mvA, dsh));
  e.br += adt * (2.3 + 2.2 * rage);

  // 기 모으기 · 풀기. atk 가 비면 종류의 기본 공격(옛 부르는 쪽)
  const winding = m.windup >= 0;
  const wu = winding ? clamp01(m.windup) : 0;
  const we = ease(wu);
  const atk = winding ? m.atk || DEF_ATK[kind] : "";
  const relAtk = e.prevAtk || DEF_ATK[kind]; // 마지막으로 모은 기(풀린 뒤의 동작)
  const fireUp = fire > 0.5 && e.prevFire <= 0.5;
  // 기 모으기가 끝까지 찼다가 풀리면 내려찍기(atk 가 slam 이거나 없을 때만 — 옛 동작), 돌기 · 발 구르기는 풀리거나 반동이 오면
  if (!winding && e.prevWind >= 0.8 && (e.prevAtk === "slam" || !e.prevAtk)) e.slam = 0;
  if (((!winding && e.prevWind >= 0.5) || fireUp) && (relAtk === "spin" || relAtk === "wave") && e.relT > 0.2) e.relT = 0;
  if (e.prevAir > 0.25 && air < 0.05) e.land = 0;
  e.prevWind = winding ? wu : -1;
  if (winding) e.prevAtk = m.atk || "";
  e.prevFire = fire;
  e.prevAir = air;
  if (e.slam < SLAM_T) e.slam += adt;
  if (e.relT < REL_T) e.relT += adt;
  if (e.land < LAND_T) e.land += adt;
  const slam = Math.max(e.slam < SLAM_T ? (1 - e.slam / SLAM_T) ** 2 : 0, relAtk === "slam" ? fire : 0);
  const relU = e.relT < REL_T ? e.relT / REL_T : 1;
  const spinOn = relAtk === "spin" && relU < 1;
  const spinAng = spinOn ? TAU * smooth(0, 1, relU) : 0;
  const spinW = spinOn ? 1 - relU ** 3 : 0;
  const wave = relAtk === "wave" ? Math.max(fire, relU < 1 ? (1 - relU) ** 2 : 0) : 0;
  const throwK = relAtk === "toss" ? fire : 0;
  const shot = relAtk === "shoot" ? fire : 0;
  const land = e.land < LAND_T ? (1 - e.land / LAND_T) ** 2 : 0;
  const airK = smooth(0.1, 0.45, air);
  const aimW = atk === "shoot" ? we : 0;
  const lowW = atk === "lunge" || atk === "charge" ? we : 0;
  const hit = clamp01(m.hit ?? 0);
  const sp = clamp01(m.spawn ?? 1);
  const dy = clamp01(m.dying ?? 0);
  const dA = clamp01(dy / 0.3); // 비틀비틀
  const dB = clamp01((dy - 0.3) / 0.7); // 납작하게 퍼지며 가라앉는다
  const dBs = smooth(0, 1, dB);

  let y = 0, sx = 1, sy = 1, pitch = 0, roll = 0, twist = 0, jx = 0, jz = 0, hop = 0, g = 0, qa = 0, hover = 0;
  let wx = 1, wy = 1; // 발 기준 전체 늘이기(나타나기 · 쓰러짐 — 슬라임은 옛 방식대로 몸통에)
  // 숨쉬기(성나면 가쁘게)
  const breath = frozen ? 0 : Math.sin(e.br + e.seed * TAU);
  sy *= 1 + 0.035 * breath * (1 - mvA * 0.6);
  sx *= 1 - 0.018 * breath * (1 - mvA * 0.6);
  // 걸음
  if (G.kind === "hop") {
    const q = e.ph - Math.floor(e.ph);
    qa = clamp01((q - 0.12) / 0.76);
    const airQ = q > 0.12 && q < 0.88 ? Math.sin(Math.PI * qa) : 0;
    g = q < 0.12 ? 1 - q / 0.12 : q > 0.88 ? (q - 0.88) / 0.12 : 0;
    hop = airQ * G.hop * mvA;
    y += hop;
    sy *= 1 - 0.24 * g * mvA + 0.1 * airQ * mvA;
    sx *= 1 + 0.13 * g * mvA - 0.04 * airQ * mvA;
    pitch -= 0.14 * mvA;
  } else if (G.kind === "fly") {
    // 떠 있다: 둥실 + 날갯짓마다 살짝 들썩, 움직이면 앞으로 숙인다
    hover = 1;
    y += 0.06 * Math.sin(at * 2.4 + e.seed * TAU) - 0.035 * Math.cos(e.fl);
    roll += 0.05 * Math.sin(at * 1.7 + 1) + 0.08 * Math.sin(p) * mvA;
    pitch -= 0.22 * mvA;
  } else if (G.kind === "biped") {
    y += G.bob * Math.abs(Math.cos(p)) * mvA;
    roll += G.roll * Math.sin(p) * mvA;
    pitch -= G.lean * mvA + (G.hunch || 0);
  } else {
    const s = Math.sin(G.kind === "skitter" ? p * 2 : p);
    y += (G.kind === "glide" ? 0.5 + 0.5 * s : Math.abs(s)) * G.bob * mvA;
    roll += G.roll * Math.sin(p) * mvA;
    pitch -= G.lean * mvA;
    if (G.kind === "glide") {
      y += 0.025 * Math.sin(at * 1.6 + e.seed * TAU);
      roll += 0.035 * Math.sin(at * 1.1);
    }
  }
  // 기 모으기(몸통): 슬라임은 웅크리고, 박쥐는 솟아 뒤로 젖히고, 멧돼지는 엉덩이를 들고, 거미 여왕은 쏘려면 일어서고 덮치려면 웅크린다
  switch (kind) {
    case 0:
      sy *= 1 - 0.24 * we;
      sx *= 1 + 0.14 * we;
      break;
    case 3:
      y += 0.28 * we;
      pitch += 0.42 * we;
      sy *= 1 + 0.05 * we;
      sx *= 1 - 0.03 * we;
      break;
    case 5:
      pitch += 0.05 * we;
      sy *= 1 - 0.06 * we;
      break;
    case 6:
      pitch -= 0.13 * we;
      sy *= 1 - 0.04 * we;
      break;
    case 7:
      if (atk === "shoot") {
        pitch += 0.3 * we;
        y += 0.17 * we;
      } else {
        sy *= 1 - 0.26 * we;
        sx *= 1 + 0.08 * we;
        pitch -= 0.05 * we;
      }
      break;
  }
  // 점점 부들부들(성나면 늘 조금)
  jx = 0.025 * wu * wu * Math.sin(at * 57) + 0.014 * rage * Math.sin(at * 61);
  jz = 0.025 * wu * wu * Math.sin(at * 43 + 1) + 0.014 * rage * Math.sin(at * 47 + 2);
  // 내려찍기(두 발은 팔다리로 — 아래)
  if (G.kind !== "biped") {
    sy *= 1 - 0.28 * slam;
    sx *= 1 + 0.18 * slam;
    pitch -= 0.16 * slam;
  } else {
    sy *= 1 - 0.08 * slam;
    sx *= 1 + 0.05 * slam;
  }
  // 돌진: 앞으로 숙인다(박쥐는 내리꽂고, 거미 여왕은 낮게)
  if (dsh > 0) {
    if (kind === 3) {
      pitch -= 0.6 * dsh;
      y -= 0.12 * dsh;
    } else if (kind === 7) {
      sy *= 1 - 0.16 * dsh;
      pitch -= 0.08 * dsh;
    } else if (kind === 6) pitch -= 0.12 * dsh;
    else if (G.kind === "biped") pitch -= 0.28 * dsh;
    else {
      pitch -= 0.2 * dsh;
      sy *= 1 - 0.06 * dsh;
      sx *= 1 + 0.04 * dsh;
    }
  }
  // 어지러움: 빙글빙글(멧돼지는 뒤로 주저앉는다)
  if (stn > 0) {
    const w = at * 5.5;
    if (kind === 6) {
      pitch += 0.3 * stn;
      y -= 0.05 * stn;
      roll += 0.05 * stn * Math.sin(w);
    } else {
      roll += 0.1 * stn * Math.sin(w);
      pitch += 0.07 * stn * Math.cos(w);
    }
  }
  // 쏘기 반동: 거미 여왕은 앞으로 휘청, 오징어는 뒤로 밀린다
  if (shot > 0) {
    if (kind === 7) {
      pitch -= 0.18 * shot;
      jx += 0.12 * shot;
    } else if (kind === 5) {
      pitch += 0.12 * shot;
      jx -= 0.08 * shot;
    } else {
      pitch += 0.08 * shot;
      sy *= 1 - 0.06 * shot;
    }
  }
  // 뛰어오름 · 내려앉음(대왕은 팔다리로)
  if (kind === 7) {
    sy *= 1 - 0.1 * airK;
    pitch -= 0.06 * airK;
  }
  if (land > 0) {
    sy *= 1 - 0.22 * land;
    sx *= 1 + 0.12 * land;
  }
  // 맞음: 찌그러졌다 출렁 + 뒤로 젖힘
  sy *= 1 - 0.15 * hit * Math.cos((1 - hit) * 11);
  sx *= 1 + 0.08 * hit;
  pitch += 0.18 * hit;

  // 두 발(도깨비 · 대왕 · 고블린): 관절 각 — 팔 [벌림, 앞으로 듦, 팔꿈치], 다리 [앞으로 듦, 무릎]. 0 = 왼쪽(−z), 1 = 오른쪽(+z)
  const arm = [[0, 0, 0], [0, 0, 0]];
  const leg = [[0, 0], [0, 0]];
  let headP = 0, headY = 0, headR = 0;
  if (G.kind === "biped") {
    let crouch = 0;
    for (let i = 0; i < 2; i++) {
      const sd = i ? 1 : -1;
      const ps = p + (sd > 0 ? 0 : Math.PI);
      arm[i][0] = G.armOut + 0.04 * Math.sin(at * 2 + sd);
      arm[i][1] = 0.1 - G.swing * Math.sin(ps) * mvA;
      arm[i][2] = G.elbow + 0.06 * breath + 0.3 * mvA * Math.max(0, -Math.sin(ps));
      leg[i][0] = G.step * Math.sin(ps) * mvA;
      leg[i][1] = G.knee * Math.max(0, Math.cos(ps)) * mvA;
    }
    headP = 0.04 * Math.sin(p * 2) * mvA;
    headY = 0.12 * Math.sin(at * 0.6 + e.seed * 5) * (1 - mvA);
    const A = (i, abd, flex, elb, w) => {
      if (w <= 0) return;
      const a = arm[i];
      a[0] = lerp(a[0], abd, w);
      a[1] = lerp(a[1], flex, w);
      a[2] = lerp(a[2], elb, w);
    };
    const L = (i, flex, knee, w) => {
      if (w <= 0) return;
      leg[i][0] = lerp(leg[i][0], flex, w);
      leg[i][1] = lerp(leg[i][1], knee, w);
    };
    const both = (abd, flex, elb, w) => {
      A(0, abd, flex, elb, w);
      A(1, abd, flex, elb, w);
    };
    if (kind === 1) {
      // 도깨비: 방망이를 머리 위로 → 앞 바닥에 쾅 / 옆으로 쭉 뻗고 몸을 비틀었다 → 한 바퀴
      if (atk === "spin") {
        A(1, 1.45, 0.25, 0.08, we);
        A(0, 1.15, -0.15, 0.6, we);
        twist -= 0.8 * we;
        crouch += 0.25 * we;
      } else if (lowW > 0) {
        both(0.35, -0.6, 0.5, we);
        crouch += 0.45 * we;
        pitch -= 0.2 * we;
      } else if (we > 0) {
        A(1, 0.25, 2.5, 0.25, we);
        A(0, 0.95, 0.55, 0.9, we);
        pitch += 0.12 * we;
        crouch += 0.12 * we;
        headP -= 0.15 * we;
      }
      if (slam > 0) {
        A(1, 0.12, 0.4, 0.05, slam);
        A(0, 0.5, 0.2, 0.5, slam);
        pitch -= 0.34 * slam;
        crouch += 0.42 * slam;
      }
      if (spinW > 0) {
        A(1, 1.5, 0.2, 0.05, spinW);
        A(0, 1.35, 0, 0.3, spinW);
        crouch += 0.15 * spinW;
      }
    } else if (kind === 2) {
      // 대왕: 두 주먹을 머리 위로 → 쾅 / 깊이 웅크렸다 → 공중에서 두 팔을 들고 무릎을 당긴다 → 쿵 / 한 발을 높이 → 쾅(충격파)
      if (atk === "leap") {
        both(0.35, -0.75, 0.55, we);
        crouch += 0.7 * we;
        pitch -= 0.25 * we;
        headP -= 0.1 * we;
      } else if (atk === "wave") {
        L(1, 1.35, 1.55, we);
        A(0, 1.25, 0.25, 0.45, we);
        A(1, 1.05, 0.4, 0.55, we);
        pitch += 0.08 * we;
        roll -= 0.09 * we;
        crouch += 0.08 * we;
      } else if (lowW > 0) {
        both(0.3, -0.6, 0.5, we);
        crouch += 0.4 * we;
        pitch -= 0.2 * we;
      } else if (we > 0) {
        both(0.42, Math.PI - 0.12, 0.55, we);
        pitch += 0.13 * we;
        crouch += 0.12 * we;
        headP -= 0.2 * we;
      }
      if (slam > 0) {
        both(0.28, 1.1, 0.1, slam);
        pitch -= 0.3 * slam;
        crouch += 0.48 * slam;
      }
      if (wave > 0) {
        L(1, 0.25, 0.3, wave);
        both(1.0, 0.45, 0.35, wave);
        crouch += 0.42 * wave;
      }
      if (airK > 0) {
        both(0.55, Math.PI - 0.35, 0.35, airK);
        L(0, 0.75, 1.2, airK);
        L(1, 0.55, 1.0, airK);
      }
      if (land > 0) {
        both(0.75, 0.75, 0.3, land);
        crouch += 0.6 * land;
      }
    } else if (kind === 4) {
      // 고블린: 폭탄 든 팔을 머리 뒤로 젖히고(왼팔은 겨눈다) → 위에서 앞으로 휙
      if (lowW > 0) {
        both(0.5, -0.6, 0.8, we);
        crouch += 0.5 * we;
        pitch -= 0.15 * we;
      } else if (we > 0) {
        A(1, 0.45, Math.PI - 0.5, 1.9, we);
        A(0, 0.2, 1.25, 0.15, we);
        twist -= 0.45 * we;
        pitch += 0.12 * we + (G.hunch || 0) * we;
        crouch += 0.15 * we;
      }
      if (throwK > 0) {
        A(1, 0.18, 1.4, 0.05, throwK);
        A(0, 0.35, 0.1, 0.5, throwK);
        twist += 0.35 * throwK;
        pitch -= 0.26 * throwK;
      }
    }
    // 돌진: 팔을 뒤로 젖히고 내달린다 · 어지러움: 팔이 축 늘어지고 머리가 빙빙 · 맞음: 팔이 들린다
    if (dsh > 0) {
      both(0.35, -0.75, 0.5, dsh * 0.8);
      headP -= 0.15 * dsh;
    }
    if (stn > 0) {
      both(0.3, -0.05, 0.15, stn * 0.7);
      headR += 0.22 * stn * Math.sin(at * 5.5);
      headP += 0.14 * stn * Math.cos(at * 5.5);
    }
    for (let i = 0; i < 2; i++) arm[i][0] += 0.45 * hit;
    headP -= 0.12 * hit;
    if (dy > 0) {
      for (let i = 0; i < 2; i++) arm[i][0] = lerp(arm[i][0], 0.2 + 1.3 * Math.abs(Math.sin(dA * Math.PI * 3 + i)), (1 - dB) * Math.min(1, dA * 3));
    }
    // 웅크리기: 엉덩이를 굽히고 무릎은 두 배로 — 발은 그 자리, 몸이 내려간다
    const th = Math.min(1.1, crouch * 0.95);
    for (let i = 0; i < 2; i++) {
      leg[i][0] += th;
      leg[i][1] += 2 * th;
    }
    y -= G.legLen * (1 - Math.cos(th));
  }

  // 나타나기: 웅덩이에서 길쭉하게 솟아 뿅
  const rise = ease(clamp01(sp / 0.75));
  y -= (1 - rise) * (K.top * 1.3 + 0.1); // 늘어난 키까지 바닥 아래에서 시작
  const st = (1 - rise) * 0.25;
  const pop = Math.sin(Math.PI * clamp01((sp - 0.65) / 0.35)) * 0.12;
  if (kind === 0) {
    sy *= 1 + st;
    sx *= 1 - st * 0.5;
    sx *= 1 + pop;
    sy *= 1 - pop * 0.6;
  } else {
    wy *= (1 + st) * (1 - pop * 0.6);
    wx *= (1 - st * 0.5) * (1 + pop);
  }
  // 쓰러짐: 비틀비틀 → 납작한 잉크 자국 → 가라앉는다(박쥐는 먼저 떨어진다)
  if (dy > 0) {
    const wob = Math.sin(dA * Math.PI * 5) * (1 - dB);
    roll += 0.18 * Math.sin(dA * Math.PI * 4) * (1 - dB);
    pitch += 0.12 * Math.sin(dA * Math.PI * 3 + 1) * (1 - dB);
    pitch *= 1 - dBs;
    roll *= 1 - dBs;
    twist *= 1 - dBs;
    if (kind === 0) {
      sx *= 1 + 0.12 * wob;
      sy *= 1 - 0.12 * wob;
      sy *= lerp(1, 0.06, dBs);
      sx *= lerp(1, 1.75, dBs);
    } else {
      wx *= (1 + 0.1 * wob) * lerp(1, 1.5, dBs);
      wy *= (1 - 0.1 * wob) * lerp(1, 0.06, dBs);
    }
    y -= smooth(0.55, 1, dB) * 0.25;
    if (G.kind === "fly") y -= 0.5 * smooth(0, 0.4, dy);
    hover *= 1 - smooth(0, 0.4, dy);
  }

  // 자리 · 방향 · 크기
  const s = e.scale;
  const cf = Math.cos(e.face), sf = Math.sin(e.face);
  R.root.position.set(m.x + (jx * cf - jz * sf) * s, y * s + air, m.z + (jx * sf + jz * cf) * s);
  R.root.rotation.set(0, -e.face - spinAng, 0);
  R.root.scale.set(s * wx, s * wy, s * wx);
  R.lean.rotation.set(roll, twist, pitch);
  R.squash.scale.set(sx, sy, sx);

  // 깜빡임
  if (!frozen && at >= e.blinkAt) {
    e.blinkStart = at;
    e.blinkAt = at + 1.8 + e.rand() * 3.2;
  }
  const bt = (at - e.blinkStart) / 0.14;
  let eye = bt >= 0 && bt < 1 ? 1 - 0.9 * Math.sin(Math.PI * bt) : 1;
  eye = Math.min(eye, lerp(1, 0.25, smooth(0.35, 0.7, hit))); // 맞으면 질끈
  if (kind === 0) eye *= 1 - 0.35 * we; // 슬라임은 기를 모으면 눈을 가늘게
  eye = Math.min(eye, lerp(0.1, 1, smooth(0.6, 0.85, sp))); // 솟는 동안은 감고 있다가 번쩍
  if (dy > 0) eye = Math.min(eye, lerp(1, 0.12, dA));
  eye = Math.min(eye, lerp(1, 0.12, stn)); // 어질어질 — 질끈

  for (let i = 0; i < R.nodes.length; i++) {
    const nd = R.nodes[i];
    const r = R.roles[i];
    const sd = r.side;
    const l0 = R.local[i];
    nd.position.set(l0[0], l0[1], l0[2]);
    nd.rotation.set(0, 0, 0);
    nd.scale.set(1, 1, 1);
    switch (r.role) {
      case "eye": {
        const big = kind === 0 ? 1 : 1 + 0.08 * we + 0.1 * rage; // 기를 모으거나 성나면 눈을 부릅뜬다
        nd.scale.set(big, big * Math.max(0.05, eye), big);
        break;
      }
      case "brow":
        nd.position.y += -0.035 * we + 0.04 * hit - 0.02 * slam - 0.02 * rage;
        break;
      case "mouth":
        nd.scale.y = 1 + 0.7 * we + 0.5 * hit + 0.6 * dA * (1 - dB) + 0.08 * Math.sin(p * 2) * mvA + 0.35 * rage + 0.5 * slam;
        nd.scale.z = 1 + 0.08 * we;
        break;
      case "antenna":
        nd.rotation.z = (0.35 * Math.cos(TAU * qa) * mvA + 0.07 * Math.sin(at * 3.1)) * (1 - we) + 0.05 * Math.sin(at * 40) * we - 0.25 * hit;
        nd.rotation.x = 0.08 * Math.sin(at * 2.3 + 1) * (1 - we);
        break;
      case "crown":
        nd.rotation.set(0.05 * Math.sin(p * 2 + 0.6) * mvA + 0.5 * dA, 0, -0.08 - 0.12 * hit + 0.1 * aimW);
        nd.position.y += 0.02 * Math.abs(Math.sin(p * 2)) * mvA + 0.08 * dA * (1 - dB);
        break;
      case "arm": {
        const a = arm[(sd + 1) >> 1];
        nd.rotation.set(-sd * a[0], 0, a[1]);
        break;
      }
      case "fore":
        nd.rotation.set(0, 0, arm[(sd + 1) >> 1][2]);
        break;
      case "thigh":
        nd.rotation.set(-sd * 0.03, 0, leg[(sd + 1) >> 1][0]);
        break;
      case "shin":
        nd.rotation.set(0, 0, -leg[(sd + 1) >> 1][1]);
        break;
      case "head":
        if (G.kind === "biped") nd.rotation.set(headR, headY, headP);
        else if (kind === 5) {
          // 오징어 몸통: 조준하면 뒤로 젖히며 부풀고, 쏘면 찌그러지며 밀린다
          const bend = 0.32 * we + 0.15 * shot;
          nd.rotation.set(0.05 * Math.sin(at * 1.3) * (1 - we), 0, bend + 0.06 * Math.sin(at * 1.7 + 1) * (1 - we) - 0.08 * mvA);
          const inf = 1 + 0.08 * we;
          nd.scale.set(inf * (1 + 0.12 * shot), inf * (1 - 0.2 * shot), inf * (1 + 0.12 * shot));
        } else {
          // 멧돼지: 걸음마다 끄덕, 돌진 준비 — 고개를 푹, 어지러움 — 빙빙
          const w = at * 5.5;
          nd.rotation.set(0.22 * stn * Math.sin(w), 0.22 * stn * Math.cos(w), 0.05 * Math.sin(p * 2) * mvA - 0.38 * we - 0.12 * dsh + 0.25 * hit + 0.1 * stn);
        }
        break;
      case "wing": {
        // 날갯짓(위아래 + 젖힘) · 기 모으기 — 위 · 뒤로 접는다 · 돌진 — 뒤로 착 붙인다 · 쓰러짐 — 축 늘어진다
        const f = Math.sin(e.fl);
        let up = 0.3 + 0.75 * f, back = 0.12 + 0.12 * Math.cos(e.fl);
        up = lerp(up, 1.3 + 0.05 * Math.sin(at * 40), we);
        back = lerp(back, 0.85, we);
        up = lerp(up, 0.3 + 0.15 * f, dsh);
        back = lerp(back, 1.1, dsh);
        up += 0.45 * hit;
        if (dy > 0) {
          up = lerp(up, -0.2, dA);
          back = lerp(back, 0.15, dA);
        }
        nd.rotation.set(-sd * up, -sd * back, 0);
        break;
      }
      case "dangle":
        nd.rotation.set(sd * 0.1, 0, -0.45 * mvA - 0.7 * dsh - 0.5 * we + 0.12 * Math.sin(at * 3 + sd));
        break;
      case "fin":
        nd.scale.z = 1 + 0.15 * Math.sin(at * (3 + 4 * mvA));
        break;
      case "siphon": {
        nd.scale.set(1 + 0.4 * we + 0.5 * shot, 1 - 0.25 * we + 0.25 * shot, 1 - 0.25 * we + 0.25 * shot);
        nd.rotation.set(0, 0.12 * Math.sin(at * 1.7) * (1 - we), 0.08 * Math.sin(at * 2.1) * (1 - we) - 0.25 * we);
        break;
      }
      case "tentacle": {
        // 둘레를 따라 도는 물결 — 조준하면 바닥을 딛고, 쏘면 확 펼친다
        const a = r.ang;
        const ph = at * (2.0 + 2.5 * mvA) - r.k * 1.05;
        let lift = (0.12 + 0.06 * mvA) * Math.sin(ph) + 0.03;
        let swing = 0.1 * Math.sin(ph * 0.7 + 1.3) * (0.5 + mvA);
        lift = lerp(lift, -0.12, we * 0.8) + 0.35 * shot - 0.1 * slam;
        if (r.long) {
          swing += 0.12 * Math.sin(at * 1.3 + a * 3);
          lift += 0.4 * shot;
        }
        if (dy > 0) lift = lerp(lift, -0.15, dA);
        nd.quaternion.setFromAxisAngle(_ax.set(-Math.sin(a), 0, Math.cos(a)), lift);
        nd.quaternion.premultiply(_qa.setFromAxisAngle(UP, swing));
        break;
      }
      case "leg":
        if (kind === 6) {
          // 멧돼지: 대각선 짝(앞오른 + 뒤왼)으로 종종 · 돌진 준비 — 오른 앞발로 바닥을 긁는다 · 어지러움 — 뒷다리를 접고 주저앉는다
          const fb = r.fb;
          const ps = p + ((sd > 0) === (fb > 0) ? 0 : Math.PI);
          let rz = G.step * (1 + 0.7 * dsh) * Math.sin(ps) * mvA;
          let ly = G.lift * Math.max(0, Math.cos(ps)) * mvA;
          if (fb > 0 && sd > 0) {
            const sc = Math.sin(at * 13);
            rz = lerp(rz, -0.25 + 0.4 * sc, we);
            ly = lerp(ly, 0.07 * Math.max(0, sc), we);
          } else if (fb < 0) rz = lerp(rz, -0.18, we);
          rz = lerp(rz, fb < 0 ? 1.25 : 0.35, stn);
          nd.position.y += ly;
          nd.rotation.z = rz;
        } else {
          // 거미 여왕: 번갈아 넷씩 사사삭 · 쏘기 준비 — 앞다리를 번쩍 · 덮치기 준비 — 납작 · 공중 — 활짝 · 쓰러짐 — 오므린다
          const k = r.k, d = r.dir;
          const ps = p * 2 + (((k + (sd > 0 ? 0 : 1)) & 1) ? Math.PI : 0);
          let yaw = (0.24 + 0.08 * dsh) * Math.sin(ps) * mvA;
          let lift = 0.26 * Math.max(0, Math.cos(ps)) * mvA + 0.03 * Math.sin(at * 2.3 + k * 1.7 + sd);
          if (atk === "shoot") {
            lift += [0.95 + 0.08 * Math.sin(at * 9), 0.22, 0.15, 0.3][k] * we;
            if (k === 0) yaw -= 0.2 * we;
          } else lift -= 0.14 * we;
          if (k === 0) lift -= 0.3 * shot;
          lift += 0.3 * airK - 0.15 * land + 0.1 * hit;
          yaw += (k < 2 ? 0.25 : -0.25) * airK;
          if (dy > 0) lift = lerp(lift, 0.7, dA);
          nd.quaternion.setFromAxisAngle(_ax.set(-d[2], 0, d[0]), lift);
          nd.quaternion.premultiply(_qa.setFromAxisAngle(UP, yaw * sd));
        }
        break;
      case "abdomen": {
        const pu = 1 + 0.05 * Math.sin(at * 12) * aimW + 0.08 * shot;
        nd.scale.set(pu, pu, pu);
        nd.rotation.set(0.04 * Math.sin(at * 1.3), 0.05 * Math.sin(p) * mvA, 0.04 * Math.sin(at * 1.6) + 0.04 * Math.sin(p * 2) * mvA - 0.3 * aimW + 0.15 * airK);
        break;
      }
      case "fang":
        nd.rotation.set(0, 0, 0.08 * Math.sin(at * 3) + 0.4 * lowW + 0.35 * airK - 0.3 * shot + 0.2 * rage * Math.sin(at * 14));
        break;
      case "tail":
        nd.rotation.set(0.5 * Math.sin(at * (5 + 6 * mvA)), 0, -0.3 * stn + 0.2 * we);
        break;
      case "stars":
        if (stn > 0.01) {
          nd.scale.setScalar(stn);
          nd.rotation.y = at * 4.5;
          nd.position.y += 0.04 * Math.sin(at * 6);
        } else nd.scale.setScalar(0.001);
        break;
      case "cape":
        nd.rotation.set(0.04 * Math.sin(p) * mvA, 0, -(0.06 + 0.16 * mvA + 0.35 * dsh + 0.55 * airK + 0.03 * Math.sin(at * 1.8)) + 0.2 * slam + 0.15 * wave);
        break;
      case "bomb": {
        // 던지면 손에서 사라졌다가(덩이는 shot 으로 그린다) 반동이 잦아들면 새 폭탄
        const k = 1 - smooth(0.02, 0.12, throwK);
        nd.scale.setScalar(Math.max(0.001, k * (1 + 0.05 * Math.sin(at * 30) * we)));
        break;
      }
      case "foot": {
        if (G.kind === "hop") {
          nd.scale.setScalar(1 - 0.15 * (hop > 0.02 ? 1 : 0) * mvA);
        }
        if (dy > 0) nd.scale.multiplyScalar(1 - dBs);
        break;
      }
    }
  }
  R.root.updateMatrixWorld(true);
  return { hop, hover, air };
}

// ------------------------------------------------------------------ 묶음
/**
 * @param {object} lightU  섬광 점광 유니폼(glsl.js — uShadowPass 포함)
 * @param {object} fogU    안개 유니폼
 */
export function createMonsters(lightU, fogU) {
  const group = new THREE.Group();
  group.name = "monsters";
  const pool = new Map(); // id → 항목
  const lineCol = new THREE.Color(STYLE.outline.color);
  const glowCols = MONSTER_KINDS.map((k) => new THREE.Color().setHex(k.glow));
  const inkRGB = MONSTER_KINDS.map((k) => lin(k.ink));
  const glowRGB = MONSTER_KINDS.map((k) => lin(k.glow));
  const screenTop = MONSTER_KINDS.map((k, i) => monsterGeometry(i).userData.screenTop);

  // 그림자 · 웅덩이(바닥 효과 −8 — 불투명 목록에서 깊이 시험 없이 장애물 · 캐릭터보다 먼저)
  const ground = instGeo({ iA: 4, iB: 4, iC: 4 }, MAX_GROUND);
  const groundMesh = new THREE.Mesh(ground.g, new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: GROUND_VERT,
    fragmentShader: GROUND_FRAG,
    uniforms: { ...fogU },
    transparent: false,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  groundMesh.frustumCulled = false;
  groundMesh.renderOrder = -8;
  // 체력 막대(반투명 목록 — 모든 것 위에)
  const bars = instGeo({ iP: 4, iS: 4, iBoss: 1 });
  const barMesh = new THREE.Mesh(bars.g, new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: BAR_VERT,
    fragmentShader: BAR_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  }));
  barMesh.frustumCulled = false;
  barMesh.renderOrder = 21;
  // 날아가는 덩이(본 그림 5 · 외곽선 6 — 몬스터와 같이, 인스턴스 버퍼는 둘이 함께 쓴다)
  const shotSrc = [false, true].map((ln) => {
    const b = builder(ln ? LINE_DETAIL : 1, ln);
    buildShot(b);
    return b.done();
  });
  const shotTri = shotSrc.map((g) => {
    // 덩이 · 폭탄 따로 센다(안 쓰는 쪽은 클립 밖으로 접힌다)
    const ap = g.attributes.aPart, idx = g.index;
    const n = [0, 0];
    for (let i = 0; i < idx.count; i += 3) n[ap.getX(idx.getX(i)) > 3.5 ? 1 : 0]++;
    return n;
  });
  const shotBufs = { iP: new Float32Array(MAX_SHOTS * 4), iD: new Float32Array(MAX_SHOTS * 4), iC: new Float32Array(MAX_SHOTS * 3), iG: new Float32Array(MAX_SHOTS * 3) };
  const shotAttr = Object.fromEntries(Object.entries(shotBufs).map(([k, a]) => [k, new THREE.InstancedBufferAttribute(a, a.length / MAX_SHOTS).setUsage(THREE.DynamicDrawUsage)]));
  const shotU = { uTime: { value: 0 }, uThick: { value: 0.03 }, uLine: { value: lineCol }, ...lightU, ...fogU };
  const shotMesh = [0, 1].map((mode) => {
    const src = shotSrc[mode];
    const g = new THREE.InstancedBufferGeometry();
    g.index = src.index;
    for (const k of ["position", "normal", "aCol", "aFx", "aOut", "aPart"]) g.setAttribute(k, src.getAttribute(k));
    for (const [k, a] of Object.entries(shotAttr)) g.setAttribute(k, a);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SHOT_VERT,
      fragmentShader: SHOT_FRAG,
      uniforms: { ...shotU, uMode: { value: mode } },
      side: mode ? THREE.BackSide : THREE.FrontSide,
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 5 + mode;
    mesh.visible = false;
    mesh.userData.monsterShot = true;
    return mesh;
  });
  group.add(groundMesh, barMesh, ...shotMesh);

  let frame = 0;
  let castFrame = -10; // 그림자 패스가 마지막으로 몬스터를 그린 프레임(그림자 맵이 켜졌으면 발밑 얼룩을 옅게)
  let now = 0;
  let nGround = 0;
  let nBar = 0;
  let nShot = 0;
  let shotTris = 0;
  let drawn = 0;
  let tris = 0;
  const onCast = () => {
    if (lightU.uShadowPass && lightU.uShadowPass.value > 0.5) castFrame = frame;
  };
  const kindOf = (k) => Math.max(0, Math.min(MONSTER_KINDS.length - 1, k | 0));

  function newEntry(id, kind) {
    const uPart = Array.from({ length: MONSTER_PARTS }, () => new THREE.Matrix4());
    const uNrm = Array.from({ length: MONSTER_PARTS }, () => new THREE.Matrix3());
    const U = {
      uPart: { value: uPart },
      uNrm: { value: uNrm },
      uThick: { value: 0.035 },
      uPos: { value: new THREE.Vector2() },
      uLine: { value: lineCol },
      uState: { value: new THREE.Vector4() },
      uGlow: { value: glowCols[kind] },
      uRage: { value: 0 },
      uClipY: { value: -1e4 },
      ...lightU,
      ...fogU,
    };
    const mk = (mode, extra) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { ...U, uMode: { value: mode } },
      ...extra,
    });
    // 본 그림은 장애물처럼 스텐실 1(뒤에 가려진 캐릭터의 팀 색 실루엣이 몬스터 위에 비친다)
    const main = new THREE.Mesh(monsterGeometry(kind), mk(0, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp }));
    const line = new THREE.Mesh(monsterGeometry(kind, true), mk(1, { side: THREE.BackSide }));
    main.renderOrder = 5;
    line.renderOrder = 6;
    main.frustumCulled = line.frustumCulled = false;
    main.layers.enable(SHADOW_LAYER);
    main.onBeforeRender = onCast;
    main.visible = line.visible = false;
    main.userData.monster = line.userData.monster = id;
    group.add(main, line);
    let rs = (Math.imul(id | 0, 2654435761) >>> 0) || 1;
    const rand = () => ((rs = (Math.imul(rs, 1103515245) + 12345) >>> 0) / 4294967296);
    const seed = rand();
    return {
      id, kind, main, line, U, uPart, uNrm, rig: makeRig(kind),
      seed, rand, at: seed * 10, br: seed * 10 * 2.3, ph: seed, fl: seed * TAU, mv: 0, face: 0, scale: 1, first: true, lastT: 0, seen: 0, drawn: false,
      blinkAt: seed * 13 + 1, blinkStart: -10, prevWind: -1, prevAtk: "", prevFire: 0, prevAir: 0, slam: SLAM_T, relT: REL_T, land: LAND_T,
      dsh: 0, stn: 0, rg: 0, lag: 1,
      tri: triOf(main.geometry) + triOf(line.geometry),
    };
  }
  function drop(e) {
    group.remove(e.main, e.line);
    e.main.material.dispose();
    e.line.material.dispose();
    pool.delete(e.id);
  }

  function begin(time) {
    frame++;
    if (Number.isFinite(time)) now = time;
    for (const e of pool.values()) {
      e.drawn = false;
      e.main.visible = e.line.visible = false; // 그림자 패스(world.end)보다 먼저 — 이번 프레임에 그린 것만 보인다
    }
    nGround = nBar = nShot = shotTris = drawn = tris = 0;
  }

  const B4 = (arr, i, a, b, c, d) => {
    arr[i * 4] = a;
    arr[i * 4 + 1] = b;
    arr[i * 4 + 2] = c;
    arr[i * 4 + 3] = d;
  };

  function draw(m, time) {
    if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.z)) return false;
    const kind = kindOf(m.kind);
    const K = MONSTER_KINDS[kind];
    const t = Number.isFinite(time) ? time : now;
    if (t > now) now = t;
    let e = pool.get(m.id);
    if (e && e.kind !== kind) {
      drop(e);
      e = null;
    }
    if (!e) {
      e = newEntry(m.id, kind);
      pool.set(m.id, e);
    }
    const dt = e.first ? 0 : Math.min(0.1, Math.max(0, t - e.lastT));
    e.lastT = t;
    e.seen = t;
    e.drawn = true;
    const face = Number.isFinite(m.face) ? m.face : 0;
    if (e.first) e.face = face;
    else e.face += wrapAngle(face - e.face) * (1 - Math.exp(-dt * 14));
    e.first = false;
    e.scale = m.scale > 0 ? m.scale : K.scale;
    const dying = clamp01(m.dying ?? 0);
    const spawn = clamp01(m.spawn ?? 1);
    const { hop, hover, air } = poseMonster(e, m, dt);
    for (let i = 0; i < e.rig.nodes.length; i++) {
      e.uPart[i].copy(e.rig.nodes[i].matrixWorld);
      e.uNrm[i].getNormalMatrix(e.uPart[i]);
    }
    const U = e.U;
    U.uPos.value.set(m.x, m.z);
    U.uThick.value = 0.032 * (0.75 + 0.25 * e.scale);
    const wind = m.windup >= 0 ? clamp01(m.windup) : 0;
    U.uState.value.set(Math.max(clamp01(m.hit ?? 0), dying > 0 ? 0.6 * (1 - clamp01(dying / 0.3)) : 0), m.frozen ? 1 : 0, wind, e.at);
    U.uRage.value = e.rg;
    U.uClipY.value = spawn < 1 || dying > 0 ? 0.002 : -1e4;
    const show = dying < 1;
    e.main.visible = e.line.visible = show;
    if (show) {
      drawn++;
      tris += e.tri;
    }

    // 발밑: 그림자(뛰면 · 떠 있으면 작고 옅게, 납작해지면 사라진다) + 웅덩이(솟을 때 · 쓰러질 때)
    const s = e.scale;
    const lift = hop / 0.34;
    const cast = frame - castFrame <= 2;
    const shadowA = (0.55 * (cast ? 0.45 : 1) * (1 - 0.4 * lift) * (1 - 0.45 * hover) * smooth(0.25, 0.7, spawn) * (1 - smooth(0.3, 0.75, dying))) / (1 + 0.5 * air);
    const puddle = spawn < 1 ? (0.6 + 0.4 * smooth(0, 0.15, spawn)) * (1 - smooth(0.6, 1, spawn)) : dying > 0 ? smooth(0.25, 0.7, dying) * 1.25 : 0;
    const puddleA = dying > 0 ? 0.92 * (1 - smooth(0.8, 1, dying)) : 0.92;
    if ((shadowA > 0.004 || puddle > 0.001) && nGround < MAX_GROUND) {
      const i4 = nGround * 4;
      const B = ground.bufs;
      B.iA.set([m.x, m.z, 2.4 * s, s], i4);
      const ink = inkRGB[kind];
      B.iB.set([ink[0], ink[1], ink[2], e.seed], i4);
      B.iC.set([shadowA, ((K.width / 1.6) * (1 - 0.2 * lift) * (1 - 0.3 * hover)) / (1 + 0.12 * air), puddle, puddleA], i4);
      nGround++;
    }
    // 체력 막대: 다친 몬스터 · 보스는 늘. 솟고 나서 나타나고 쓰러지면 바로 사라진다(뛰어오르면 같이 뜬다)
    const hp = clamp01(m.hp ?? 1);
    if (hp > e.lag || e.lag > 1) e.lag = hp;
    else e.lag = Math.max(hp, e.lag - dt * 0.45);
    const boss = BOSS_KINDS.has(kind);
    const barA = (hp < 1 || boss ? 1 : 0) * smooth(0.7, 0.95, spawn) * (1 - clamp01(dying * 4));
    if (barA > 0.004 && nBar < MAX_INST) {
      const w = (boss ? 1.25 : 1.0) * (0.75 + 0.25 * s);
      const h = boss ? 0.24 : 0.17;
      B4(bars.bufs.iP, nBar, m.x, (screenTop[kind] * s + 0.2 + h) / PROJ.LIFT + air, m.z, hp);
      B4(bars.bufs.iS, nBar, w, h, e.lag, barA);
      bars.bufs.iBoss[nBar] = boss ? 1 : 0;
      nBar++;
    }
    return true;
  }

  /** 몬스터가 쏜 덩이 하나(고블린은 심지가 타는 폭탄): s = { x, y, z, kind, dx, dz, r, id? } */
  function shot(s) {
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z) || nShot >= MAX_SHOTS) return false;
    const kind = kindOf(s.kind);
    const r = s.r > 0 ? s.r : 0.4;
    let dx = Number(s.dx) || 0, dz = Number(s.dz) || 0;
    const l = Math.hypot(dx, dz);
    if (l > 1e-6) {
      dx /= l;
      dz /= l;
    } else {
      dx = 1;
      dz = 0;
    }
    const y = Number.isFinite(s.y) ? s.y : 0.8;
    const bomb = kind === 4 ? 1 : 0;
    const i = nShot++;
    B4(shotBufs.iP, i, s.x, y, s.z, r);
    B4(shotBufs.iD, i, dx, dz, Number.isFinite(s.id) ? (Math.abs(s.id) * 0.618034) % 1 : (i * 0.37) % 1, bomb);
    shotBufs.iC.set(inkRGB[kind], i * 3);
    shotBufs.iG.set(glowRGB[kind], i * 3);
    shotTris += shotTri[0][bomb] + shotTri[1][bomb];
    // 바닥 그림자(높을수록 옅게)
    if (nGround < MAX_GROUND) {
      const i4 = nGround * 4;
      const B = ground.bufs;
      B.iA.set([s.x, s.z, 0.3 + r * 2.2, 1], i4);
      B.iB.set([0, 0, 0, 0], i4);
      B.iC.set([0.75 / (1 + 0.2 * Math.max(0, y)), r * 2, 0, 0], i4);
      nGround++;
    }
    return true;
  }

  function upload(geo, n) {
    geo.g.instanceCount = n;
    for (const name of Object.keys(geo.bufs)) {
      const at = geo.g.attributes[name];
      at.clearUpdateRanges();
      if (n) at.addUpdateRange(0, n * at.itemSize);
      at.needsUpdate = n > 0;
    }
  }
  function uploadShots(n) {
    for (const mesh of shotMesh) {
      mesh.geometry.instanceCount = n;
      mesh.visible = n > 0;
    }
    for (const a of Object.values(shotAttr)) {
      a.clearUpdateRanges();
      if (n) a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = n > 0;
    }
  }

  function end() {
    for (const e of [...pool.values()]) {
      if (e.drawn) continue;
      e.main.visible = e.line.visible = false;
      if (now - e.seen > KEEP) drop(e);
    }
    upload(ground, nGround);
    upload(bars, nBar);
    shotU.uTime.value = now;
    uploadShots(nShot);
    groundMesh.visible = nGround > 0;
    barMesh.visible = nBar > 0;
    tris += (nGround + nBar) * 2 + shotTris;
  }

  function clear() {
    for (const e of [...pool.values()]) drop(e);
    nGround = nBar = nShot = shotTris = drawn = tris = 0;
    upload(ground, 0);
    upload(bars, 0);
    uploadShots(0);
    groundMesh.visible = barMesh.visible = false;
  }

  /** 몬스터 id 의 지금 월드 경계 상자(본 그림 — part 를 주면 그 부위만). 시험 · 개발용 */
  const _v = new THREE.Vector3();
  function bounds(id, part = -1) {
    const e = pool.get(id);
    if (!e) return null;
    const g = e.main.geometry;
    const pos = g.attributes.position, ap = g.attributes.aPart;
    const box = new THREE.Box3();
    for (let i = 0; i < pos.count; i++) {
      const pi = Math.round(ap.getX(i));
      if (part >= 0 && pi !== part) continue;
      box.expandByPoint(_v.fromBufferAttribute(pos, i).applyMatrix4(e.uPart[pi]));
    }
    return box;
  }

  return {
    group,
    get meshes() {
      return group.children;
    },
    begin,
    draw,
    shot,
    end,
    clear,
    bounds,
    /** 이번 프레임에 그린 몬스터 수 */
    get count() {
      return drawn;
    },
    /** 이번 프레임에 그린 덩이 수 */
    get shots() {
      return nShot;
    },
    /** 덩이 묶음(본 그림 · 외곽선 — 시험용) */
    shotMeshes: shotMesh,
    /** 풀에 든 몬스터 수(안 보여도 KEEP 초까지 남는다) */
    get pooled() {
      return pool.size;
    },
    /** 이번 프레임에 그린 삼각형(본 그림 + 외곽선 + 발밑 · 막대 + 덩이) */
    get triangles() {
      return tris;
    },
    /** 지오메트리 · 인스턴스 버퍼 바이트(텍스처는 없다) */
    get bytes() {
      let n = 0;
      for (const g of [...geoCache.values(), ...shotSrc]) {
        for (const a of Object.values(g.attributes)) n += a.array.byteLength;
        if (g.index) n += g.index.array.byteLength;
      }
      for (const geo of [ground, bars]) for (const a of Object.values(geo.bufs)) n += a.byteLength;
      for (const a of Object.values(shotBufs)) n += a.byteLength;
      return n;
    },
    /** 항목(시험용): id → { main, line, kind } */
    entry: (id) => pool.get(id) || null,
    /** 발밑 묶음에 든 수(시험용) */
    get grounds() {
      return nGround;
    },
  };
}
