// 캐릭터(docs/DESIGN.md §3.9): ink-brawl 의 3D 장난감 인형을 옮기고(생김새 figures.js · 무늬 skins.js · 움직임 이 파일 — 원본 createCharacters 의
// update 를 캐릭터 하나씩으로), 캐릭터 8종(charset.js — 남 4 · 여 4)의 머리 모양 · 장식 · 치마 부품을 같은 계층에 단다.
// 원본의 레이트레이서 제약(무대 아래 풀 · PARK_Y)은 버리고, 부위의 자세만 원본과 같은 Object3D 계층(root → lean → yaw → rig → 머리 · 몸통 · 팔 · 다리,
// yaw → 치켜든 풍선, 머리 → 머리 껍질 · 꼬리 · 띠 · 작은 공, rig → 치마)으로 계산해 figures.js 의 묶음 하나에 넣는다(36명 = 그리기 3번 + 부스터 꼬리 1번).
//
// 원본 그대로: 걷는 리듬(엇갈린 팔 · 다리, 통통 튀기) · 숨쉬기 · 착지 눌림 스프링 · 달리는 쪽으로 숙이기 · 머리 까딱임 · 충전하면 팔을 치켜들고
// 머리 위로 풍선이 부푼다 · 던지기 휘두르기 · 공중제비(남의 것은 보간 지연만큼 늦게) · 대시 · 맞아서 날아가면 빙글 · 피격 번쩍임 · 무적 깜빡임 ·
// 조준 점멸(흰 외곽선) · 부스터(운동화 빛 · 전기 꼬리 · 불티).
// 덧붙인 것: 홈 소환 · 부활(옛 자리에서 빙글 빨려 들고 새 자리에서 솟아오른다) · 안개에서 드러나기(appear — 원본의 작게 → 크게) ·
// 느려짐(축 처져 느릿느릿) · KO(뒤로 넘어져 구르다 가라앉는다) · 승리(cheer — 두 팔을 치켜들고 깡충) · 머리 묶음 · 리본이 달릴 때 관성으로 흔들림(화질 저는 고정) ·
// 눈 표정(깜빡임 · 맞음 > < · 날아갈 때 소용돌이 · KO X · 승리 ^^ — 눈 아틀라스의 칸만 바꾼다) · 롱샷 조준경(머리 옆에 뜨는 작은 표시). 캐릭터에는 잉크가 묻지 않는다.
// 그리는 크기는 원본 비율 그대로(머리 반지름 = 판정 반지름 0.5u — style.js 의 character.scale).
// 캐릭터 종류 · 무늬: R.actor.set(id, { char, pattern }) 로 받고(명단), 없으면 v.char → id % 8. 무늬는 pattern ≥ 0 이면 그것, 아니면 자동(같은 색 무리 안에서 겹치지 않게).
import * as THREE from "three";
import { FLAG, PALETTE, SHIELD, PLAYER, BALLOON } from "../shared/constants.js";
import { MODE, SHAPE } from "./sprites.js";
import { SHIELD_COLOR } from "./items.js";
import { layerRect } from "./stackatlas.js";
import { bloomLayer } from "./livestack.js";
import { MAP_COLORS, darkHex, mixHex } from "./palette.js";
import { STYLE } from "./style.js";
import { PROJ } from "./camera.js";
import { createFigures, HEAD_Y, TOP_Y, PARTS } from "./figures.js";
import { CHARACTERS, SLOTS, charOf, assignPatterns } from "./charset.js";
import { EXPR } from "./eyes.js";

const hexOf = (i) => PALETTE[((i ?? 0) % PALETTE.length + PALETTE.length) % PALETTE.length].hex;
export const REVEAL_TIME = 0.45;
const KO_TIME = 1.1;
const SINK_TIME = 0.45;
const FOG_TIME = 0.4; // 안개 밖으로 나간 다른 팀 캐릭터가 마지막 자리에서 낮게 가라앉으며 사라지는 시간
const SHADOW_OFF = [0.3, 0.2];
const FLIP_TIME = 0.42; // 공중제비 한 바퀴(초)
const RIB_STEP = 1 / 48; // 부스터 꼬리 점을 밀어 넣는 간격(초)
const BOOST_BLINK = 1.5;
const SPARKS = 7;
const CS = STYLE.character;
/** 층 스택(아이템 · 설치물 · 정답 폭탄) 외곽선: 짙은 보라(장애물 그림과 같은 색). false 면 애셋의 outline */
const OUTLINE_DARK = STYLE.outline.stackDark !== false;
const clamp = THREE.MathUtils.clamp;

/**
 * 원본의 Object3D 계층 하나(자세 계산용 — 장면에 넣지 않는다) + 캐릭터 종류의 부품(charset.js 의 parts — 머리 껍질은 머리에 그대로 겹친다).
 * parts = figures.js 의 부위 순서(PARTS 개) — 그 종류가 쓰지 않는 칸은 null(접힌다)
 */
export function makeRig(char = 0) {
  const root = new THREE.Object3D();
  const lean = new THREE.Object3D();
  const yaw = new THREE.Object3D();
  const rig = new THREE.Object3D();
  root.add(lean);
  lean.add(yaw);
  yaw.add(rig);
  const body = new THREE.Object3D();
  const head = new THREE.Object3D();
  head.position.y = HEAD_Y;
  const arms = [1, -1].map((s) => {
    const m = new THREE.Object3D();
    m.position.set(0, 0.93, s * 0.33);
    m.userData.side = s;
    return m;
  });
  const legs = [1, -1].map((s) => {
    const m = new THREE.Object3D();
    m.position.set(0, 0.5, s * 0.14);
    m.userData.side = s;
    return m;
  });
  rig.add(body, head, ...arms, ...legs);
  const held = new THREE.Object3D();
  yaw.add(held);
  const parts = new Array(PARTS).fill(null);
  parts.splice(0, 7, head, body, arms[0], arms[1], legs[0], legs[1], held);
  // 캐릭터 종류의 부품 + 공통 장비(고글 · 등의 잉크 탱크 · 호스)
  const def = CHARACTERS[charOf(char)];
  const hair = new THREE.Object3D();
  head.add(hair);
  parts[SLOTS.hair] = hair;
  const goggles = new THREE.Object3D();
  head.add(goggles);
  parts[SLOTS.goggles] = goggles;
  const tank = new THREE.Object3D();
  const ts = def.tank || [1, 1];
  tank.position.set(-0.44, 0.73, 0);
  tank.scale.set(ts[0], ts[1], ts[0]);
  tank.userData.base = tank.rotation.clone();
  tank.userData.key = "tank";
  tank.userData.swing = 0.12;
  rig.add(tank);
  parts[SLOTS.tank] = tank;
  parts[SLOTS.hose] = tank; // 호스는 셰이더가 탱크 · 오른팔의 행렬로 잇는다(이 행렬은 쓰지 않는다)
  const slots = { head, rig, hair, tank, arm0: arms[0], arm1: arms[1], leg0: legs[0], leg1: legs[1] };
  const swingers = [tank];
  const small = [];
  for (const key of ["tailA", "tailB", "band", "knobA", "knobB", "knobC", "knobD"]) {
    const P = def.parts && def.parts[key];
    if (!P) continue;
    const o = new THREE.Object3D();
    o.position.set(...P.pos);
    o.rotation.set(...P.rot);
    o.scale.set(...P.scale);
    o.userData.base = o.rotation.clone();
    o.userData.swing = P.swing || 0;
    o.userData.key = key;
    o.userData.sx = P.scale[0];
    o.userData.sy = P.scale[1];
    o.userData.sz = P.scale[2];
    (slots[P.parent] || head).add(o);
    slots[key] = o;
    parts[SLOTS[key]] = o;
    if (P.swing) swingers.push(o);
    if (P.small) small.push(SLOTS[key]);
  }
  // 화질 저: 작은 장식은 접는다
  const partsLow = parts.slice();
  for (const i of small) partsLow[i] = null;
  // 머리 모양이 머리 윗면보다 솟은 높이(치켜든 풍선 · 조준경 자리)
  const h = def.hair;
  const topExtra = h.off + (h.bulge || 0) + (h.spikes || 0) * 1.05 + (def.parts.knobA && def.parts.knobA.pos[1] > 0.95 ? 0.3 : 0) + (def.key === "ribbon" ? 0.28 : 0);
  return { root, lean, yaw, rig, body, head, arms, legs, held, hair, goggles, tank, slots, swingers, char: charOf(char), parts, partsLow, topExtra };
}

function newActor(id) {
  return {
    id,
    rig: makeRig(charOf(-1, id)),
    variant: -1,
    // 원본 연출 상태
    bob: Math.random() * 6,
    squash: 0,
    squashV: 0,
    spin: 0,
    flipT: 0,
    flipWait: 0,
    flipAx: 1,
    flipAz: 0,
    flash: 0,
    throwT: 0,
    raise: 0,
    headX: 0,
    headZ: 0,
    headVX: 0,
    headVZ: 0,
    wasAir: false,
    appear: 0,
    // 덧붙인 것
    rise: 1, // 솟아오르기(0..1 — 홈 소환 · 부활)
    cheer: 0, // 승리 동작(남은 초)
    ripple: 0,
    lock: false,
    boostOn: false,
    trail: new Float32Array(4 * 14 * 3),
    trailN: 0,
    trailT: 0,
    st: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, aim: 0, flags: 0, charge: 0, boost: 0, gy: 0 },
    last: null,
    lastSeen: -1,
    color: 0,
    team: -1,
    // 캐릭터 종류 · 무늬(명단에서 — R.actor.set) · 머리 묶음 흔들림(뒤로 · 옆으로) · 눈 깜빡임
    charSel: -1,
    patSel: -1,
    char: -1,
    swP: 0,
    swR: 0,
    swPV: 0,
    swRV: 0,
    blinkT: 1 + Math.random() * 3,
    launched: false,
    cheering: false,
  };
}

const _axis = new THREE.Vector3();

/** 원본 startFlip: 진행 방향(서 있으면 바라보는 쪽)으로 앞으로 한 바퀴 */
function startFlip(a) {
  const st = a.st;
  const sp = Math.hypot(st.vx, st.vz);
  const fx = sp > 1 ? st.vx / sp : Math.cos(st.aim);
  const fz = sp > 1 ? st.vz / sp : Math.sin(st.aim);
  a.flipAx = fz;
  a.flipAz = -fx;
  a.flipWait = 0;
  a.flipT = 1e-4;
  a.squashV -= 3;
}

/**
 * 원본 update 의 캐릭터 하나(살아 있을 때). 부위 Object3D 의 자세를 정하고 연출 값을 돌려준다.
 * @returns {{ face, speed, flash, pulse, lockGlow, blink, boost, boostOn }}
 */
function animate(a, dt, time, slow = false, still = false) {
  const st = a.st;
  const R = a.rig;
  a.appear = Math.min(1, a.appear + dt * 4);
  if (a.rise < 1) a.rise = Math.min(1, a.rise + dt / REVEAL_TIME);
  if (a.cheer > 0) a.cheer -= dt;
  R.root.position.set(st.x, st.y, st.z);
  R.root.scale.setScalar(CS.scale * (a.sizeMul || 1)); // [왕국전] 일꾼은 작게(v.size)

  const speed = Math.hypot(st.vx, st.vz);
  const air = st.y - (st.gy || 0) > 0.06 || (st.flags & FLAG.FALLING) !== 0;
  const dashing = (st.flags & FLAG.DASHING) !== 0;
  const charging = (st.flags & FLAG.CHARGING) !== 0;
  const launched = air && (speed > PLAYER.SPEED * 1.15 || (st.flags & FLAG.FALLING) !== 0);

  let flipping = false;
  if (a.flipWait > 0) {
    a.flipWait -= dt;
    if (a.flipWait <= 0) startFlip(a);
  } else if (a.flipT > 0) {
    a.flipT += dt / FLIP_TIME;
    if (a.flipT >= 1 || launched) a.flipT = 0;
    else flipping = true;
  }

  // 승리: 깡충깡충
  const cheering = a.cheer > 0 && !air;
  if (cheering && Math.sin(time * 9) > 0.92 && a.squashV > -1) a.squashV -= 2.6;

  if (a.wasAir && !air) a.squashV -= 5.5;
  a.wasAir = air;
  const h = Math.min(dt, 1 / 30);
  a.squashV += (-a.squash * 220 - a.squashV * 16) * h;
  a.squash += a.squashV * h;

  const walk = air ? 0 : Math.min(1, speed / PLAYER.SPEED);
  a.bob += dt * (3 + speed * 2.1) * (slow ? 0.55 : 1);
  const swing = Math.sin(a.bob) * walk;
  const bobY = Math.abs(Math.cos(a.bob)) * 0.05 * walk;

  let face = st.aim;
  if (dashing && speed > 1) face = Math.atan2(st.vz, st.vx);
  // 솟아오르기: 빙글 돌며 커진다
  const rise = a.rise < 1 ? 1 - (1 - a.rise) ** 3 : 1;
  R.yaw.rotation.y = -face - (1 - rise) * 7;

  let lx = 0;
  let lz = 0;
  if (launched) a.spin += dt * (9 + speed * 0.5);
  else a.spin *= Math.exp(-dt * 14);
  if (launched && speed > 0.5) {
    _axis.set(st.vz, 0, -st.vx).normalize();
    R.lean.quaternion.setFromAxisAngle(_axis, a.spin);
  } else if (flipping) {
    const t = a.flipT;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    _axis.set(a.flipAx, 0, a.flipAz);
    R.lean.quaternion.setFromAxisAngle(_axis, e * Math.PI * 2);
  } else {
    const k = dashing ? 0.06 : 0.035;
    lx = clamp(st.vz * k, -0.55, 0.55);
    lz = clamp(-st.vx * k, -0.55, 0.55);
    if (slow) {
      // 느려짐: 앞으로 축 처진다
      lx += Math.sin(face) * 0.12;
      lz += -Math.cos(face) * 0.12;
    }
    R.lean.rotation.set(lx, 0, lz);
  }
  const pivot = launched || flipping;
  R.lean.position.y = bobY + (pivot ? 0.9 : 0);
  R.yaw.position.y = pivot ? -0.9 : 0;

  const breath = Math.sin(time * 2.1 + a.id * 1.7) * 0.012;
  let sy = 1 + breath + a.squash * 0.5;
  let sxz = 1 - breath * 0.5 - a.squash * 0.28;
  const c = charging ? Math.min(1, (st.charge || 0) / BALLOON.CHARGE_TIME) : 0;
  sy *= 1 - c * 0.07;
  sxz *= 1 + c * 0.045;
  if (slow) {
    sy *= 0.95;
    sxz *= 1.03;
  }
  const ap = (a.appear < 1 ? 0.3 + 0.7 * (1 - Math.pow(1 - a.appear, 3)) : 1) * (a.rise < 1 ? 0.05 + 0.95 * rise : 1);
  R.rig.scale.set(sxz * ap, sy * ap, sxz * ap);

  a.headVX += ((-lx * 0.5 - a.headX) * 160 - a.headVX * 13) * h;
  a.headVZ += ((-lz * 0.5 - a.headZ) * 160 - a.headVZ * 13) * h;
  a.headX += a.headVX * h;
  a.headZ += a.headVZ * h;
  const cf = Math.cos(face);
  const sf = Math.sin(face);
  R.head.rotation.set(a.headX * cf + a.headZ * sf, 0, -a.headX * sf + a.headZ * cf);

  if (a.throwT > 0) a.throwT = Math.max(0, a.throwT - dt * 4.5);
  const thr = Math.sin(a.throwT * Math.PI);
  a.raise += ((charging ? 1 : 0) - a.raise) * (1 - Math.exp(-dt * 18));
  for (const arm of R.arms) {
    const side = arm.userData.side;
    let rx = -side * 0.32;
    let rz = -side * swing * 0.75;
    if (launched) {
      rx = -side * (1.7 + Math.sin(time * 23 + side) * 0.5);
      rz = Math.sin(time * 27 + side * 2) * 1.1;
    } else if (flipping) {
      rx = -side * 0.45;
      rz = 1.6;
    } else if (dashing) {
      rx = -side * 0.7;
      rz = -1.2;
    } else if (cheering) {
      // 두 팔을 번갈아 흔들며 치켜든다
      rx = -side * (2.3 + Math.sin(time * 12 + side * 1.5) * 0.35);
      rz = Math.sin(time * 12 + side) * 0.4;
    } else {
      rx += -side * 2.0 * a.raise;
      rz *= 1 - a.raise;
      rz += thr * 1.9;
      rx += side * thr * 0.5 * (1 - a.raise);
      if (slow) rx *= 0.5;
    }
    arm.rotation.set(rx, 0, rz);
  }
  for (const leg of R.legs) {
    const side = leg.userData.side;
    let rz = side * swing * 0.8;
    if (launched) rz = Math.sin(time * 21 + side * 1.5) * 0.9;
    else if (flipping) rz = 1.05;
    else if (dashing) rz = side * 0.85;
    leg.rotation.set(0, 0, rz);
  }

  // 머리 묶음 · 리본 · 치마: 달리면 뒤로 날리고(관성 — 용수철), 걸음마다 통통, 착지 · 맞음에 출렁(화질 저는 고정)
  if (R.swingers.length) {
    if (still) {
      a.swP = a.swR = a.swPV = a.swRV = 0;
    } else {
      const run = Math.min(1.2, speed / PLAYER.SPEED);
      const tp = (launched || flipping ? 0.2 : run * 0.62) + Math.sin(a.bob * 2) * 0.1 * walk - a.squash * 1.2;
      const tr = -a.headZ * 2.2 + Math.cos(a.bob) * 0.12 * walk;
      a.swPV += ((tp - a.swP) * 90 - a.swPV * 7) * h;
      a.swRV += ((tr - a.swR) * 90 - a.swRV * 7) * h;
      a.swP += a.swPV * h;
      a.swR += a.swRV * h;
    }
    for (const o of R.swingers) {
      const b = o.userData.base;
      const k = o.userData.swing;
      if (o.userData.key === "tank") o.rotation.set(b.x + a.swR * 0.1, b.y, b.z + a.swP * k);
      else o.rotation.set(b.x + a.swR * k, b.y, b.z - a.swP * k);
    }
  }

  // 머리 위로 치켜든 풍선(충전 표시) — 머리 모양이 높으면(삐죽 · 비니 방울 · 리본) 그만큼 위로
  let held = false;
  if (charging) {
    const full = c >= 1;
    const r = THREE.MathUtils.lerp(BALLOON.SMALL.r, BALLOON.BIG.r, c) * (full ? 1 + Math.sin(time * 30) * 0.06 : 1);
    R.held.scale.set(r, r * (1 + Math.sin(time * 22) * 0.05), r);
    R.held.position.set(0, (TOP_Y + R.topExtra) * sy + 0.14 + r, 0);
    held = true;
  }
  R.root.updateMatrixWorld(true);
  a.launched = launched;
  a.cheering = cheering;

  a.flash = Math.max(0, a.flash - dt * 9);
  const inv = (st.flags & FLAG.INVULN) !== 0;
  const pulse = inv ? 0.5 + 0.5 * Math.sin(time * 26) : 0;
  const blink = a.lock && Math.sin(time * 44) > -0.2;
  const lockGlow = a.lock ? (blink ? 1 : 0.35) : 0;
  const boost = st.boost > 0 ? st.boost : 0;
  const boostOn = boost > 0 && (boost > BOOST_BLINK || Math.sin(time * (boost > 0.6 ? 34 : 60)) > -0.1);
  return { face, speed, flash: a.flash, pulse, lockGlow, blink, boost, boostOn, held };
}

/** 원본 drawBoost: 꼬리 점을 밀어 넣고(두 발 · 허리 양옆) 띠와 발밑 불티를 그린다 */
function drawBoost(a, figs, decals, face, speed, on, dt) {
  const st = a.st;
  const RIBS = figs.RIBS, RIB_N = figs.RIB_N;
  const cf = Math.cos(face);
  const sf = Math.sin(face);
  const sx = -sf;
  const sz = cf;
  const tr = a.trail;
  a.trailT -= dt;
  const push = a.trailT <= 0;
  if (push) {
    a.trailT += RIB_STEP;
    if (a.trailT < 0) a.trailT = 0;
    if (a.trailN < RIB_N) a.trailN++;
  }
  for (let r = 0; r < RIBS; r++) {
    const off = r * RIB_N * 3;
    if (push) tr.copyWithin(off + 3, off, off + (RIB_N - 1) * 3);
    const side = r % 2 ? -1 : 1;
    const hip = r >= 2;
    const lat = hip ? 0.36 : 0.14;
    tr[off] = st.x + sx * lat * side + (hip ? 0 : cf * 0.08);
    tr[off + 1] = st.y + (hip ? 0.82 + side * 0.08 : 0.07);
    tr[off + 2] = st.z + sz * lat * side + (hip ? 0 : sf * 0.08);
    if (a.trailN <= 1) for (let i = 1; i < RIB_N; i++) tr.copyWithin(off + i * 3, off, off + 3);
  }
  if (!on) return;
  const move = Math.min(1, Math.max(0, (speed - 1) / 5));
  if (move > 0.02) {
    const flick = 0.75 + Math.random() * 0.25;
    for (let r = 0; r < RIBS; r++) figs.ribbon(tr, r * RIB_N * 3, r >= 2, move, flick);
  }
  // 발밑 불티(우리 공중 효과 묶음 — 카메라를 보는 빛 점)
  for (let i = 0; i < SPARKS; i++) {
    if (Math.random() < 0.3) continue;
    const foot = i % 2 ? -1 : 1;
    const white = Math.random() < 0.35;
    const col = white ? 0xfffff2 : Math.random() < 0.3 ? 0xffe6ff : 0xffe64d;
    decals.push(st.x + sx * 0.14 * foot + (Math.random() - 0.5) * 0.5, st.y + Math.random() * 0.35, st.z + sz * 0.14 * foot + (Math.random() - 0.5) * 0.5, 0.16, 0.16, col, 0.9, SHAPE.DISC, 0, MODE.FACE, 0.3, 2.5);
  }
}

/** 화질 단계(step: 1 고 · 2 중 · 3+ 저 — 렌더러의 층 간격)에 따른 캐릭터 묶음: 무늬 시트 칸(px) · 분할 */
const TIERS = { high: { cell: CS.cell || 192, low: false }, mid: { cell: 128, low: false }, low: { cell: CS.cellLow || 96, low: true } };
const tierOf = (step) => ((step || 1) >= 3 ? "low" : step === 2 ? "mid" : "high");
const nowSec = () => (typeof performance !== "undefined" ? performance.now() / 1000 : Date.now() / 1000);
/** 롱샷 조준경 색(아이템 표시와 같은 청록) */
const SCOPE_COL = 0x00f0ff;
const HURT_TIME = 0.42;

export function createCharacters() {
  const actors = new Map();
  const ghosts = []; // KO(넘어져 구르다 가라앉는다) · 홈 소환(옛 자리에서 빙글 빨려 든다)
  let figs = null;
  let figKey = "";
  let figParent = null;
  let tierWant = "";
  let tierSince = 0;
  const groups = new Map(); // 색(팀전이면 팀 색) → 캐릭터 번호 묶음 — 같은 무리 안에서 무늬가 겹치지 않게
  // 개발용 견주기: ?charhair=pat|team|dark 면 머리카락 재질을 바꾼다
  const hairMat = typeof location !== "undefined" ? new URLSearchParams(location.search).get("charhair") : null;

  const get = (id) => {
    let a = actors.get(id);
    if (!a) {
      a = newActor(id);
      actors.set(id, a);
    }
    return a;
  };

  /** 무리의 무늬를 다시 나눈다(charset.assignPatterns — 종류의 기본 무늬 + 번호 순, 겹치면 다음 빈 무늬) */
  function regroup(key) {
    const set = groups.get(key);
    if (!set) return;
    const members = [];
    for (const id of set) {
      const b = actors.get(id);
      members.push({ id, char: b && b.char >= 0 ? b.char : charOf(-1, id), pattern: b ? b.patSel : -1 });
    }
    for (const [id, p] of assignPatterns(members)) {
      const b = actors.get(id);
      if (b) b.variant = p;
    }
  }
  function join(a, key) {
    if (a.group === key && groups.get(key)?.has(a.id)) return;
    leave(a);
    a.group = key;
    let set = groups.get(key);
    if (!set) groups.set(key, (set = new Set()));
    set.add(a.id);
    regroup(key);
  }
  function leave(a) {
    if (a.group === undefined) return;
    const set = groups.get(a.group);
    if (set && set.delete(a.id)) regroup(a.group);
    a.group = undefined;
  }

  /** 그리기 묶음(화질 단계마다 무늬 시트 칸 · 분할) — 층 스택 묶음의 자식으로 장면에 걸린다. 단계가 2초 넘게 바뀌어 있어야 새로 만든다 */
  function ensure(B, step) {
    let key = tierOf(step);
    if (figs && key !== figKey) {
      const t = nowSec();
      if (tierWant !== key) {
        tierWant = key;
        tierSince = t;
      }
      if (t - tierSince < 2) key = figKey;
    }
    if (figs && figKey === key && figParent === B.stacks.mesh) return figs;
    if (figs) figs.dispose();
    const T = TIERS[key];
    // 개발용: ?charcell=<px> 면 무늬 시트 칸 크기를 그것으로(화질 단계별 칸 크기 견주기)
    const force = typeof location !== "undefined" ? Number(new URLSearchParams(location.search).get("charcell")) : 0;
    figs = createFigures(B.stacks.uniforms, { cell: force >= 64 && force <= 512 ? force : T.cell, low: T.low, hairMat: hairMat && hairMat in { pat: 1, team: 1, dark: 1, light: 1 } ? hairMat : null });
    figKey = key;
    figParent = B.stacks.mesh;
    for (const m of figs.meshes) figParent.add(m);
    // 개발용: ?charline=0 이면 외곽선 없이(견줘 보기)
    if (typeof location !== "undefined" && new URLSearchParams(location.search).get("charline") === "0") figs.setOutline(false);
    return figs;
  }

  function snapshot(a, v, time) {
    // [왕국전] 프레임마다 새 객체를 만들지 않는다(사람마다 — 같은 객체에 다시 쓴다. 남의 손에 넘길 때는 펼쳐 복사한다: ghost)
    const L = a.last || (a.last = { x: 0, y: 0, z: 0, aim: 0, color: 0, variant: 0, char: 0, time: 0 });
    L.x = v.x; L.y = v.y; L.z = v.z; L.aim = v.aim; L.color = v.color; L.variant = a.variant; L.char = a.char; L.time = time;
  }

  function ghost(kind, last, seed = 0) {
    const rig = makeRig(last.char ?? 0);
    const g = { kind, t: 0, seed, ...last, rig, a: newActor(-1) };
    g.a.appear = 1;
    ghosts.push(g);
  }

  /** 캐릭터 종류가 바뀌었다 → 부품 계층을 새로 */
  function setChar(a, ch) {
    if (a.char === ch) return;
    a.char = ch;
    a.rig = makeRig(ch);
    if (a.group !== undefined) regroup(a.group);
  }

  /** 눈 표정(눈 아틀라스의 칸): 날아감 소용돌이 > 맞음 > < > 승리 ^^ > 깜빡임 > 뜬 눈 */
  function exprOf(a, dt) {
    a.blinkT -= dt;
    let e = EXPR.open;
    if (a.blinkT < 0) {
      e = EXPR.blink;
      if (a.blinkT < -0.13) a.blinkT = 2 + Math.random() * 3.5;
    }
    if (a.cheering) e = EXPR.happy;
    if (a.hurtT > 0) {
      a.hurtT -= dt;
      e = EXPR.hurt;
    }
    if (a.launched) e = EXPR.dizzy;
    return e;
  }

  return {
    get: (id) => actors.get(id) || null,
    get figures() {
      return figs;
    },
    /** 캐릭터 그림이 쓰는 텍스처 바이트(무늬 시트 + 자세 자료 + 눈 아틀라스) — R.stats.texMB 에 더한다 */
    get bytes() {
      return figs ? figs.bytes : 0;
    },
    /**
     * (덧) 명단의 캐릭터 종류 · 무늬: o = { char(0~7 — 없으면 id % 8), pattern(무늬 번호 — −1/없음 = 자동) }.
     * main.js 가 명단을 받을 때마다 부른다(R.actor.set). 바뀐 것만 반영한다.
     */
    set(id, o = {}) {
      const a = get(id);
      const ch = Number.isInteger(o.char) && o.char >= 0 ? charOf(o.char, id) : -1;
      const pat = Number.isInteger(o.pattern) && o.pattern >= 0 ? o.pattern : -1;
      const changed = ch !== a.charSel || pat !== a.patSel;
      a.charSel = ch;
      a.patSel = pat;
      if (!changed) return;
      if (ch >= 0) setChar(a, ch);
      if (a.group !== undefined) regroup(a.group);
    },
    hit(id, power = 0.5) {
      const a = get(id);
      a.flash = 1;
      a.hurtT = HURT_TIME;
      a.squashV += 6 + power * 6;
      a.headVX += (Math.random() - 0.5) * 14 * (0.5 + power);
      a.headVZ += (Math.random() - 0.5) * 14 * (0.5 + power);
    },
    throwPose(id) {
      get(id).throwT = 1;
    },
    /** 공중제비. delay(초)만큼 기다렸다 돈다 — 남의 캐릭터는 보간 지연만큼 늦게 보인다 */
    flip(id, delay = 0) {
      const a = get(id);
      if (delay > 0) a.flipWait = delay;
      else startFlip(a);
    },
    ripple(id) {
      get(id).ripple = 0.35;
    },
    /** 나타났다(안개에서 드러남 · 부활): 원본처럼 작게 → 크게 */
    appear(id) {
      get(id).appear = 0;
    },
    /** 안개 밖으로 나갔다(game.on("fogOut")): 뚝 꺼지지 않게 마지막 자리에서 낮게 가라앉으며 사라진다 */
    fade(id, now) {
      const a = actors.get(id);
      if (!a || !a.last || (now !== undefined && now - a.lastSeen > 0.5)) return;
      ghost("fog", a.last);
      a.appear = 0;
    },
    /** 승리 동작(두 팔을 치켜들고 깡충) — t 초 */
    cheer(id, t = 2.5) {
      get(id).cheer = t;
    },
    /** (x, z) 에서 쓰러진 사람: 가장 가까이에 있던 사람의 마지막 모습으로 넘어져 구르다 가라앉는다 */
    koAt(x, z, now) {
      let best = null;
      let bd = 2.5;
      for (const a of actors.values()) {
        if (!a.last || now - a.lastSeen > 0.5) continue;
        const d = Math.hypot(a.last.x - x, a.last.z - z);
        if (d < bd) {
          bd = d;
          best = a;
        }
      }
      if (best) {
        ghost("ko", best.last, (Math.random() * 1e6) | 0);
        best.last = null;
      }
    },
    /** 폭발에 휩쓸렸다(캐릭터에는 잉크가 묻지 않는다 — 머리만 흔들린다) */
    splash(x, z, r, color, now) {
      for (const a of actors.values()) {
        if (!a.last || now - a.lastSeen > 0.5) continue;
        const d = Math.hypot(a.last.x - x, a.last.z - z);
        if (d > r) continue;
        const k = (1 - d / r) * 4;
        a.headVX += (Math.random() - 0.5) * k;
        a.headVZ += (Math.random() - 0.5) * k;
      }
    },
    gone(id) {
      const a = actors.get(id);
      if (a) leave(a);
      actors.delete(id);
    },
    clear() {
      actors.clear();
      ghosts.length = 0;
      groups.clear();
    },
    update(dt) {
      if (figs) figs.begin(dt);
      for (const a of actors.values()) if (a.ripple > 0) a.ripple -= dt;
      for (let i = ghosts.length - 1; i >= 0; i--) {
        ghosts[i].t += dt;
        const k = ghosts[i].kind;
        if (ghosts[i].t > (k === "ko" ? KO_TIME : k === "fog" ? FOG_TIME : SINK_TIME)) ghosts.splice(i, 1);
      }
    },

    /**
     * 한 사람. B = { stacks, decals }. o = { self, lock, gy, time, dt, step, decalShadow, zoneColor }.
     * v 의 char · pattern 이 있으면 그것이 R.actor.set 보다 먼저다(시연 · 시험)
     */
    draw(B, v, o) {
      const a = get(v.id);
      if (!(v.flags & FLAG.ALIVE)) {
        a.appear = 0; // 원본: 쓰러져 있는 동안 숨고, 다시 나타날 때 작게 → 크게
        a.trailN = 0;
        return;
      }
      const F = ensure(B, o.step);
      const time = o.time;
      const dt = Math.min(o.dt || 1 / 60, 1 / 20);
      const gy = o.gy ?? 0;
      const x = v.x, y = v.y, z = v.z;
      const air = Math.max(0, y - gy);
      const col = hexOf(v.color);
      // 캐릭터 종류 · 무늬
      const ch = Number.isInteger(v.char) && v.char >= 0 ? charOf(v.char, v.id) : a.charSel >= 0 ? a.charSel : charOf(-1, v.id);
      setChar(a, ch);
      if (Number.isInteger(v.pattern) && v.pattern !== a.patSel) {
        a.patSel = v.pattern >= 0 ? v.pattern : -1;
        if (a.group !== undefined) regroup(a.group);
      }
      a.team = v.team ?? -1;
      if (a.color !== v.color || a.group === undefined) {
        a.color = v.color;
        join(a, v.color ?? -1);
      }
      if (a.variant < 0) regroup(a.group);
      // 홈 소환 · 부활로 끊어 옮겨졌다: 옛 자리에서 빙글 빨려 들고, 새 자리에서 솟아오른다
      if (a.last && Math.hypot(a.last.x - x, a.last.z - z) > 4) {
        ghost("sink", a.last);
        a.rise = 0;
      }
      const st = a.st;
      a.sizeMul = v.size || 1;
      st.x = x; st.y = y; st.z = z;
      st.vx = v.vx || 0; st.vy = v.vy || 0; st.vz = v.vz || 0;
      st.aim = v.aim; st.flags = v.flags; st.charge = v.charge || 0; st.boost = v.boost || 0; st.gy = gy;
      a.lock = !!o.lock;
      const slow = (v.flags & FLAG.SLOWED) !== 0;
      const r = animate(a, dt, time, slow, F.low);
      const expr = exprOf(a, dt);

      // 바닥: 발밑 얼룩 · 내 발밑 고리 · 존 안 발밑 점등 · 바라보는 쪽 점
      // 발밑 얼룩: 그림자 맵이 켜져 있으면(화질 중 · 고 — 캐릭터도 그림자를 드리운다) 끈다
      if (o.decalShadow !== false && !F.castsShadow) {
        const sh = Math.max(0.5, 1.2 - air * 0.16) * CS.scale;
        // [왕국전] 그림자 맵이 없어져(바닥에 구운 그림자) 모든 화질에서 이 얼룩이 발밑 그림자 — 가장자리가 흐린 얼룩(SHAPE.SOFT)으로 조금 크게
        B.decals.push(x + SHADOW_OFF[0] + air * 0.2, gy + 0.01, z + SHADOW_OFF[1] + air * 0.15, sh * 1.55, sh * 1.2, MAP_COLORS.shadow, Math.max(0.22, 0.72 - air * 0.07), SHAPE.SOFT, 0, MODE.FLAT, 0.01);
      }
      if (o.zoneColor >= 0) B.decals.push(x, gy + 0.01, z, 1.4, 1.4, o.zoneColor, 0.55 + 0.25 * Math.sin(time * 7), SHAPE.DISC, 0, MODE.FLAT, 0.02, 0.3);
      if (o.self) B.decals.push(x, gy + 0.01, z, 1.6, 1.6, darkHex(col, 0.85), 0.85, SHAPE.RING, 0.16, MODE.FLAT, 0.03);
      if (v.boost > 0) B.decals.push(x, gy + 0.01, z, 1.35, 1.35, 0xffd24a, 0.8, SHAPE.RING, 0.2, MODE.FLAT, 0.03, 0.5);
      const fxd = Math.cos(v.aim), fzd = Math.sin(v.aim);
      B.decals.push(x + fxd * 0.85, gy + 0.01, z + fzd * 0.85, 0.24, 0.24, o.self ? darkHex(col, 0.7) : col, 0.9, SHAPE.DISC, 0, MODE.FLAT, 0.03);

      a.lastSeen = time;
      snapshot(a, v, time);
      F.push(partsFor(a.rig, r.held, F.low), col, a.variant, a.char, expr,
        r.flash, r.blink ? 1 : 0, r.boostOn ? 1 : 0, o.self ? 0.9 : 0.7, r.pulse + r.lockGlow * 0.6 + (slow ? 0.12 : 0), clamp(a.swP, -1, 1));
      if (r.boost > 0) {
        if (!a.boostOn) {
          a.boostOn = true;
          a.trailN = 0;
          a.trailT = 0;
        }
        drawBoost(a, F, B.decals, r.face, r.speed, r.boostOn, dt);
      } else a.boostOn = false;

      // 보호막: 몸을 감싼 반투명 공(카메라를 보는 판). 끝나기 2초 전부터 깜빡인다
      if (v.shield > 0 && !(v.shield < 2 && Math.floor(time * 8) % 2 === 0)) {
        const rr = SHIELD.R * CS.scale * (1 + (a.ripple > 0 ? a.ripple * 0.25 : 0));
        B.decals.push(x, y + SHIELD.CY * CS.scale, z, rr * 2, rr * 2, SHIELD_COLOR, 0.2, SHAPE.DISC, 0, MODE.FACE, 0.6);
        B.decals.push(x, y + SHIELD.CY * CS.scale, z, rr * 2, rr * 2, mixHex(SHIELD_COLOR, 0xffffff, 0.4), 0.9, SHAPE.RING, 0.08, MODE.FACE, 0.62, 0.4);
      }
      // 롱샷 조준경: 머리 옆(화면 오른쪽 위)에 작은 조준경 — 끝나기 2초 전부터 깜빡인다
      if (v.range > 0 && !(v.range < 2 && Math.floor(time * 6) % 2 === 0)) drawScope(B.decals, x, y + (1.62 + a.rig.topExtra * 0.5) * CS.scale, z, time);
    },

    /** KO · 홈 소환의 남은 모습(사람과 상관없이 매 프레임) */
    drawGhosts(B, step = 1) {
      if (!ghosts.length) return;
      const F = ensure(B, step);
      for (const g of ghosts) {
        const a = g.a;
        a.rig = g.rig;
        const R = g.rig;
        const st = a.st;
        st.x = g.x; st.y = g.y; st.z = g.z; st.aim = g.aim; st.flags = FLAG.ALIVE | FLAG.GROUNDED;
        st.vx = st.vy = st.vz = 0;
        animate(a, 0, g.time + g.t, false, true);
        let expr = g.kind === "fog" ? EXPR.open : EXPR.dizzy;
        if (g.kind === "ko") {
          // 뒤로 넘어지고(0.25초) 옆으로 한 번 구른 뒤 납작해지며 가라앉는다 — 눈은 X
          expr = EXPR.ko;
          const k = g.t / KO_TIME;
          const fall = Math.min(1, g.t / 0.25);
          const e = 1 - (1 - fall) ** 2;
          const bx = Math.sin(g.aim), bz = -Math.cos(g.aim); // 몸 옆 축(뒤로 넘어지는 축)
          _axis.set(bx, 0, bz);
          R.lean.quaternion.setFromAxisAngle(_axis, -e * Math.PI * 0.5);
          R.lean.position.set(-Math.cos(g.aim) * e * 0.5, 0.25 * e, -Math.sin(g.aim) * e * 0.5);
          R.yaw.rotation.y = -g.aim + Math.max(0, g.t - 0.25) * 5 * (g.seed % 2 ? 1 : -1);
          for (const arm of R.arms) arm.rotation.set(-arm.userData.side * (1.4 + Math.sin(g.t * 20) * 0.3), 0, 0.5);
          for (const leg of R.legs) leg.rotation.set(0, 0, 0.6 + Math.sin(g.t * 18 + leg.userData.side) * 0.3);
          // 머리 묶음은 넘어지는 쪽 반대로 휙
          for (const o of R.swingers) if (o.userData.key !== "tank") o.rotation.z = o.userData.base.z + Math.sin(Math.min(1, g.t * 3) * Math.PI) * 0.6 * o.userData.swing;
          const sink = Math.max(0, (k - 0.6) / 0.4);
          R.rig.scale.set(1 + sink * 0.2, Math.max(0.02, 1 - sink), 1 + sink * 0.2);
        } else if (g.kind === "fog") {
          // 안개 속으로: 돌지 않고 납작해지며 바닥으로 가라앉는다
          const p = Math.min(1, g.t / FOG_TIME);
          R.lean.rotation.set(0, 0, 0);
          R.yaw.rotation.y = -g.aim;
          const s = Math.max(0.02, 1 - p * p);
          R.rig.scale.set(1 - p * 0.35, s, 1 - p * 0.35);
        } else {
          // 빙글 돌며 빨려 든다
          const p = g.t / SINK_TIME;
          R.lean.rotation.set(0, 0, 0);
          R.yaw.rotation.y = -g.aim + p * p * 14;
          const s = Math.max(0.02, 1 - p * p);
          R.rig.scale.set(s, s * (1 - p * 0.5), s);
        }
        R.root.updateMatrixWorld(true);
        F.push(partsFor(R, false, F.low), hexOf(g.color), g.variant >= 0 ? g.variant : 0, g.char ?? 0, expr, g.kind === "sink" ? g.t / SINK_TIME : 0, 0, 0, 0, 0, 0);
      }
    },
  };
}

/** 이번에 그릴 부위 목록: 치켜든 풍선(충전 중) · 화질 저(작은 장식을 접는다) — 계층마다 한 번 만들어 둔다 */
function partsFor(R, held, low) {
  const key = (held ? 1 : 0) + (low ? 2 : 0);
  if (!R.lists) R.lists = [];
  let l = R.lists[key];
  if (!l) {
    l = (low ? R.partsLow : R.parts).slice();
    if (!held) l[6] = null;
    R.lists[key] = l;
  }
  return l;
}

/** 롱샷 조준경(머리 옆 — 화면 오른쪽 위로 띄운 작은 표시): 어두운 받침 · 청록 고리 · 십자 · 가운데 점 */
function drawScope(decals, x, y, z, time) {
  const R = PROJ.right, U = PROJ.up;
  const ox = R[0] * 0.72 + U[0] * 0.2, oy = R[1] * 0.72 + U[1] * 0.2, oz = R[2] * 0.72 + U[2] * 0.2;
  const cx = x + ox, cy = y + oy, cz = z + oz;
  const s = 0.5 * (1 + Math.sin(time * 5) * 0.05);
  decals.push(cx, cy, cz, s * 1.12, s * 1.12, 0x0b0716, 0.8, SHAPE.DISC, 0, MODE.FACE, 1.2);
  decals.push(cx, cy, cz, s, s, SCOPE_COL, 1, SHAPE.RING, 0.2, MODE.FACE, 1.22, 0.8);
  const t = s * 0.34;
  for (const [dx, dy, w, h] of [[t, 0, s * 0.2, s * 0.07], [-t, 0, s * 0.2, s * 0.07], [0, t, s * 0.07, s * 0.2], [0, -t, s * 0.07, s * 0.2]]) {
    decals.push(cx + R[0] * dx + U[0] * dy, cy + R[1] * dx + U[1] * dy, cz + R[2] * dx + U[2] * dy, w, h, SCOPE_COL, 1, SHAPE.RECT, 0, MODE.FACE, 1.24, 0.8);
  }
  decals.push(cx, cy, cz, s * 0.12, s * 0.12, 0xff3b6b, 1, SHAPE.DISC, 0, MODE.FACE, 1.25, 0.8);
}

/**
 * 스택 하나를 층마다 묶음에 넣는다(캐릭터 · 아이템 · 정답 폭탄이 같이 쓴다). 위층부터 넣는다(앞쪽 깊이가 먼저 써져 아래층이 일찍 버려진다).
 * o: step · flash · reveal(아래층부터 솟기 0..1) · ink(잉크 얼룩 팀 + 양) · leanX/leanZ(맨 위층 어긋남 u) · stretch(층 간격 배율) · flipP(공중제비 0..1, −1 없음) ·
 *    spin(층마다 더 도는 각) · xray(가려진 부분 실루엣 세기 0..1) · shade(전체 명암) · scale(크기 배율)
 */
export function drawStack(batch, st, frame, x, y, z, rot, team, o = {}) {
  const unit = st.unit;
  const sc = o.scale ?? 1;
  const texel = sc / unit;
  const n = st.count;
  const step = o.step || 1;
  const reveal = o.reveal ?? 1;
  const lx = o.leanX || 0, lz = o.leanZ || 0;
  const stretch = o.stretch ?? 1;
  const ol = OUTLINE_DARK ? STYLE.outline.color : st.outline;
  const top = n - 1;
  for (let k = top - (top % step); k >= 0; k -= step) {
    const t = top > 0 ? k / top : 0;
    let yy = y + (k / unit) * stretch * sc;
    if (reveal < 1) {
      const b = bloomLayer(k, n, reveal);
      if (!b.show) continue;
      yy = y + (b.lift / unit) * stretch * sc;
    }
    let r = rot + (o.spin || 0) * t;
    let ox = lx * t * t;
    let oz = lz * t * t;
    if (o.flipP >= 0) {
      // 공중제비: 층마다 조금씩 늦게 도는 비틀림 + 몸이 앞으로 말린다
      const p = Math.max(0, Math.min(1, o.flipP * 1.3 - (1 - t) * 0.3));
      r += p * Math.PI * 2;
      ox += Math.cos(rot) * Math.sin(p * Math.PI) * 0.25 * t;
      oz += Math.sin(rot) * Math.sin(p * Math.PI) * 0.25 * t;
    }
    const [u, v] = layerRect(st, frame, k);
    const shade = (o.shade ?? 1) * (0.86 + 0.14 * Math.min(1, k / 8)) * (k % 2 ? 0.95 : 1);
    batch.layer(x + ox, yy, z + oz, r, shade, team, frame.sheet, u, v, st.w, st.h, texel, o.flash || 0, o.xray ?? 0, ol, o.ink ?? -1);
  }
}
