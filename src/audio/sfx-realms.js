// [왕국전] 왕국전에만 있는 소리(브로울스 sfx.js 와 같은 부품 상자 k = { tone, noise, drive, pluck, bell } · 같은 계약).
// 각 합성 함수는 v = { k, t, out, p(세기 0..1), r(음높이 배율), col, duck, muffle } 를 받아 소리를 예약하고 길이(초)를 돌려준다.
// 일꾼 소리(곡괭이 · 망치 · 들통)는 수십 명이 한꺼번에 낼 수 있어 노드를 적게(4~6개) 쓴다. 드문 소리(득점 · 탈락)는 넉넉하게.

import { rand, jit, pick, semi } from "./util.js";

const PENTA = [0, 3, 5, 7, 10, 12, 15, 17];

// ── 싸움 ──

function sfxLaunch({ k, t, out, p, r }) {
  // 잉크 미사일 발사: 점화 "퓻" + 쉬익 하고 멀어지는 분사음
  k.noise(out, t, { type: "highpass", f0: 3000, attack: 0.001, dur: 0.03, gain: 0.22 + 0.1 * p });
  k.tone(k.drive(out), t, { f0: 170 * r, f1: 70, glide: 0.08, dur: 0.12, gain: 0.3 + 0.2 * p });
  k.noise(out, t, { type: "bandpass", f0: 1700 * r, f1: 5200 * r, sweep: 0.25, q: 1.2, attack: 0.01, hold: 0.06, dur: 0.28, gain: 0.28 + 0.15 * p });
  k.tone(out, t, { type: "sawtooth", f0: 420 * r, f1: 1300 * r, glide: 0.22, dur: 0.22, gain: 0.05 + 0.04 * p, lp: 2400 });
  return 0.45;
}

function sfxHoming(v) {
  // 유도 미사일: 발사음 + 과녁을 잡는 높은 "삐빅"
  const d = sfxLaunch(v);
  const { k, t, out, r } = v;
  for (let i = 0; i < 2; i++) k.tone(out, t + 0.05 + i * 0.07, { type: "square", f0: 1760 * r, dur: 0.045, gain: 0.06, lp: 4000 });
  return d;
}

function sfxDrill({ k, t, out, p, r }) {
  // 드릴 미사일: 윙— 하고 갈리는 톱니 버즈가 올라간다 + 발사 쿵
  k.noise(out, t, { type: "highpass", f0: 2500, attack: 0.001, dur: 0.03, gain: 0.2 });
  k.tone(out, t, { type: "sawtooth", f0: 140 * r, f1: 260 * r, glide: 0.4, attack: 0.01, hold: 0.15, dur: 0.3, gain: 0.11 + 0.06 * p, lp: 1800, vib: { rate: 55, depth: 30 } });
  k.tone(out, t, { type: "square", f0: 280 * r, f1: 520 * r, glide: 0.4, attack: 0.01, hold: 0.1, dur: 0.3, gain: 0.045, lp: 2600, vib: { rate: 55, depth: 50 } });
  k.noise(out, t, { type: "bandpass", f0: 900, f1: 3000, sweep: 0.4, q: 2, attack: 0.02, hold: 0.1, dur: 0.3, gain: 0.16 + 0.1 * p });
  k.tone(k.drive(out), t, { f0: 120, f1: 60, dur: 0.12, gain: 0.28 });
  return 0.55;
}

function sfxFirework({ k, t, out, p, r, duck }) {
  // 폭죽: 둘레로 흩어진 작은 터짐 — 탁탁 튀는 딱총 소리 + 반짝이는 높은 방울이 떨어진다
  k.tone(k.drive(out), t, { f0: 140, f1: 50, glide: 0.1, dur: 0.22, gain: 0.4 + 0.2 * p });
  k.noise(out, t, { type: "bandpass", f0: 1200, f1: 300, sweep: 0.3, q: 1, attack: 0.002, dur: 0.32, gain: 0.22 });
  for (let i = 0; i < 11; i++) {
    const at = t + Math.random() ** 1.3 * 0.55;
    k.noise(out, at, { type: "highpass", f0: rand(2500, 6000), attack: 0.001, dur: rand(0.01, 0.03), gain: rand(0.14, 0.32) });
    if (i % 3 === 0) k.tone(out, at, { type: "triangle", f0: rand(1800, 3400) * r, f1: rand(900, 1500) * r, glide: 0.12, dur: 0.14, gain: 0.045 });
  }
  duck(0.15, 0.2);
  return 0.8;
}

function sfxVortex({ k, t, out, p, r }) {
  // 소용돌이(2초): 바람이 빙빙 돌며 빨려 든다 — 떨리는 낮은 웅웅 + 올라가는 대역 잡음, 끝에 "쭉"
  const dur = 1.85;
  k.noise(out, t, { color: "pink", type: "bandpass", f0: 450 * r, f1: 1700 * r, sweep: dur, q: 3, attack: 0.25, hold: dur * 0.5, dur: dur * 0.4, gain: 0.34 + 0.14 * p });
  k.tone(out, t, { f0: 90 * r, f1: 140 * r, glide: dur, attack: 0.2, hold: dur * 0.5, dur: dur * 0.45, gain: 0.22, vib: { rate: 6, depth: 25 } });
  k.tone(out, t, { type: "triangle", f0: 600 * r, f1: 1200 * r, glide: dur, attack: 0.3, hold: dur * 0.4, dur: dur * 0.4, gain: 0.035, vib: { rate: 6, depth: 120 } });
  k.tone(out, t + dur - 0.15, { f0: 900 * r, f1: 180 * r, glide: 0.16, dur: 0.18, gain: 0.13 });
  k.noise(out, t + dur - 0.15, { type: "lowpass", f0: 3000, f1: 300, q: 3, attack: 0.005, dur: 0.2, gain: 0.28 });
  return dur + 0.25;
}

function sfxMShoot({ k, t, out, p, r }) {
  // 몬스터가 먹물을 뱉는다: "퉤" — 끈적한 대역 잡음 + 아래로 떨어지는 짧은 음 + 거품 하나
  k.noise(out, t, { color: "pink", type: "bandpass", f0: jit(900, 0.15) * r, f1: 400 * r, q: 3, attack: 0.004, dur: 0.12, gain: 0.6 + 0.25 * p });
  k.tone(out, t, { type: "triangle", f0: 420 * r, f1: 160 * r, glide: 0.1, dur: 0.12, gain: 0.24 });
  k.tone(out, t + 0.02, { f0: 220 * r, f1: 520 * r, glide: 0.05, dur: 0.06, gain: 0.1 });
  return 0.22;
}

function sfxMSplat({ k, t, out, p, r }) {
  // 몬스터 먹물이 맞았다: 질척한 "철퍽"(작게) + 방울 둘
  k.tone(k.drive(out), t, { f0: 140 * r, f1: 60, glide: 0.08, dur: 0.12, gain: 0.25 + 0.15 * p });
  k.noise(out, t, { color: "pink", type: "lowpass", f0: jit(2600, 0.15) * r, f1: 320, sweep: 0.15, q: 4, attack: 0.004, dur: 0.22, gain: 0.36 + 0.14 * p });
  for (let i = 0; i < 2; i++) {
    const f = rand(500, 900) * r;
    k.tone(out, t + 0.05 + i * 0.06, { f0: f * 0.6, f1: f * 1.3, glide: 0.035, dur: 0.06, gain: 0.05 });
  }
  return 0.32;
}

function sfxCrate({ k, t, out, p, r }) {
  // 나무 상자가 부서진다: 마른 나무가 쩍쩍 갈라지는 딱딱 소리 + 묵직한 쿵 + 파편이 굴러떨어진다
  k.tone(k.drive(out), t, { f0: 170 * r, f1: 70, glide: 0.06, dur: 0.16, gain: 0.5 + 0.1 * p });
  k.tone(out, t, { type: "triangle", f0: 360 * r, f1: 210 * r, glide: 0.05, dur: 0.08, gain: 0.16 });
  for (let i = 0; i < 4; i++) {
    const at = t + i * 0.025 + Math.random() * 0.015;
    k.noise(out, at, { type: "bandpass", f0: rand(900, 2200) * r, q: 6, attack: 0.001, dur: rand(0.03, 0.06), gain: rand(0.22, 0.42) });
  }
  for (let i = 0; i < 5; i++) {
    const at = t + 0.08 + Math.random() ** 1.5 * 0.35;
    k.noise(out, at, { type: "bandpass", f0: rand(500, 1400), q: 4, attack: 0.001, dur: rand(0.02, 0.05), gain: rand(0.06, 0.15) });
  }
  return 0.55;
}

function sfxHeal({ k, t, out, p, r }) {
  // 에너지(체력 회복): 따뜻하게 올라가는 세 음 + 반짝이는 바람 + 종
  [0, 4, 7].forEach((n, i) => k.tone(out, t + i * 0.05, { f0: 523.25 * r * semi(n), attack: 0.02, hold: 0.1, dur: 0.35, gain: 0.08 + 0.04 * p }));
  k.noise(out, t, { type: "bandpass", f0: 2000 * r, f1: 6000 * r, sweep: 0.3, q: 3, attack: 0.05, dur: 0.25, gain: 0.07 + 0.05 * p });
  k.bell(out, t + 0.15, 2093 * r, { dur: 0.5, gain: 0.045 + 0.02 * p });
  return 0.7;
}

// ── 몬스터 ──

function sfxWarn({ k, t, out, p, r }) {
  // 몬스터 공격 예고: 짧게 끊어 우는 경고음이 점점 높아지고 빨라진다 — 마지막 음이 곧 "쿵"(p = 남은 시간 0..1 → 0.4~1.6초)
  const T = 0.4 + 1.2 * p;
  const n = Math.max(3, Math.round(T / 0.15));
  for (let i = 0; i < n; i++) {
    const q = i / n;
    const at = t + (1 - (1 - q) ** 1.4) * T; // 끝으로 갈수록 촘촘하게
    k.tone(out, at, { type: "square", f0: 520 * r * semi(q * 9), dur: 0.055, gain: 0.06 + 0.05 * q, lp: 2600 });
  }
  k.tone(out, t, { type: "sawtooth", f0: 110 * r, f1: 180 * r, glide: T, attack: T * 0.6, dur: T * 0.4, gain: 0.07, lp: 900 });
  return T + 0.1;
}

function sfxSlam({ k, t, out, p, r, duck }) {
  // 내려찍기 · 충격파: 땅이 울리는 쿵 + 흙이 튀는 잡음 + 낮게 퍼지는 웅
  k.tone(k.drive(out, true), t, { f0: 95 * r, f1: 32, glide: 0.25, dur: 0.55, gain: 0.75 + 0.15 * p });
  k.noise(out, t, { color: "pink", type: "lowpass", f0: 1800, f1: 120, sweep: 0.4, q: 1.5, attack: 0.002, dur: 0.6, gain: 0.6 + 0.1 * p });
  k.noise(out, t, { type: "bandpass", f0: 700, q: 1, attack: 0.001, dur: 0.05, gain: 0.35 });
  for (let i = 0; i < 4; i++) k.noise(out, t + 0.05 + Math.random() * 0.3, { type: "bandpass", f0: rand(400, 1200), q: 3, attack: 0.001, dur: 0.04, gain: rand(0.06, 0.14) });
  duck(0.3, 0.25);
  return 0.75;
}

function sfxRoar({ k, t, out, r, duck }) {
  // 화난 보스의 포효: 떨리는 낮은 톱니 두 줄이 목구멍(대역 잡음)을 지나 으르렁 — 끝으로 갈수록 내려앉는다
  const dur = 1.5;
  for (const det of [-12, 12]) {
    k.tone(out, t, { type: "sawtooth", f0: 120 * r, f1: 70 * r, glide: dur, attack: 0.08, hold: 0.6, dur: 0.8, gain: 0.15, detune: det, lp: 1400, lp1: 400, vib: { rate: 24, depth: 9, depth1: 20 } });
  }
  k.tone(out, t, { type: "square", f0: 60 * r, f1: 40 * r, glide: dur, attack: 0.1, hold: 0.6, dur: 0.8, gain: 0.07, lp: 500, vib: { rate: 24, depth: 6 } });
  k.noise(out, t, { color: "pink", type: "bandpass", f0: 700 * r, f1: 380 * r, sweep: dur, q: 2.5, attack: 0.08, hold: 0.6, dur: 0.8, gain: 0.48 });
  k.noise(out, t, { type: "bandpass", f0: 1800 * r, f1: 900 * r, sweep: dur, q: 4, attack: 0.1, hold: 0.4, dur: 0.6, gain: 0.14 });
  k.tone(k.drive(out, true), t, { f0: 70, f1: 34, glide: 0.8, attack: 0.05, hold: 0.2, dur: 1.1, gain: 0.5 });
  duck(0.5, 1.0);
  return dur + 0.4;
}

function sfxMonsterKo({ k, t, out, p, r, duck }) {
  // 몬스터가 쓰러진다: 낮게 끄는 "끄억" → 털썩 + 잉크 방울
  k.tone(out, t, { type: "sawtooth", f0: 220 * r, f1: 70 * r, glide: 0.5, attack: 0.02, hold: 0.1, dur: 0.45, gain: 0.12, lp: 1200, lp1: 300, vib: { rate: 14, depth: 8 } });
  k.noise(out, t, { color: "pink", type: "bandpass", f0: 600 * r, f1: 300 * r, q: 2, attack: 0.02, hold: 0.1, dur: 0.4, gain: 0.26 });
  k.tone(k.drive(out), t + 0.35, { f0: 110, f1: 40, glide: 0.12, dur: 0.3, gain: 0.55 + 0.2 * p });
  k.noise(out, t + 0.35, { color: "pink", type: "lowpass", f0: 2000, f1: 200, q: 2, attack: 0.002, dur: 0.35, gain: 0.4 });
  for (let i = 0; i < 4; i++) {
    const f = rand(500, 900) * r;
    k.tone(out, t + 0.4 + i * 0.05 + Math.random() * 0.02, { f0: f, f1: f * 1.7, glide: 0.04, dur: 0.06, gain: 0.055 });
  }
  if (p > 0.6) duck(0.25, 0.3);
  return 0.95;
}

function sfxHatch({ k, t, out, r }) {
  // 알이 깨지고 아기 몬스터가 "삐약": 껍데기 톡 · 톡 · 쩍 → 위로 튀는 짹짹 + 반짝이는 종
  for (let i = 0; i < 3; i++) {
    const at = t + i * 0.12;
    k.noise(out, at, { type: "bandpass", f0: 2600 + i * 400, q: 5, attack: 0.001, dur: 0.03, gain: 0.28 });
    k.tone(out, at, { type: "triangle", f0: 1400 + i * 200, f1: 900, glide: 0.03, dur: 0.04, gain: 0.07 });
  }
  const tc = t + 0.4;
  k.noise(out, tc - 0.03, { type: "highpass", f0: 3000, attack: 0.001, dur: 0.06, gain: 0.22 });
  for (const d of [0, 0.11]) k.tone(out, tc + d, { f0: 1100 * r, f1: 1900 * r, glide: 0.06, dur: 0.09, gain: 0.14, vib: { rate: 30, depth: 40 } });
  [0, 4, 7, 12].forEach((n, i) => k.bell(out, tc + 0.22 + i * 0.05, 1046.5 * r * semi(n), { dur: 0.4, gain: 0.045 }));
  return 1.1;
}

function sfxLevelUp({ k, t, out, r, duck }) {
  // 레벨 업: 빠르게 올라가는 장조 아르페지오 → 맨 위에서 반짝이는 화음
  const base = 523.25 * r;
  [0, 4, 7, 12, 16].forEach((n, i) => k.pluck(out, t + i * 0.06, base * semi(n), { dur: 0.18, gain: 0.13, type: "square", bright: 1.2 }));
  const tc = t + 0.32;
  [12, 16, 19, 24].forEach((n, i) => k.tone(out, tc, { type: "sawtooth", f0: base * semi(n), attack: 0.01, hold: 0.15, dur: 0.5, gain: 0.035, lp: 5000, lp1: 1500, detune: i % 2 ? 7 : -7 }));
  k.bell(out, tc, base * 4, { dur: 0.8, gain: 0.06 });
  k.noise(out, tc, { type: "highpass", f0: 7000, attack: 0.002, dur: 0.4, gain: 0.07 });
  duck(0.2, 0.4);
  return 1.2;
}

// ── 일꾼 · 자원 ──

function sfxPick({ k, t, out, p, r }) {
  // 곡괭이가 금광을 친다: 쇠가 돌에 부딪는 "깡" — 짧은 비화성 배음 + 돌 부스러기 딸깍 + 낮은 퉁
  const f = jit(2300, 0.06) * r;
  k.tone(out, t, { f0: f, dur: 0.09, gain: 0.09 + 0.06 * p });
  k.tone(out, t, { f0: f * 1.47, dur: 0.06, gain: 0.045 + 0.03 * p });
  k.noise(out, t, { type: "bandpass", f0: 3200, q: 2, attack: 0.001, dur: 0.025, gain: 0.16 + 0.1 * p });
  k.tone(out, t, { f0: 180 * r, f1: 90, dur: 0.05, gain: 0.11 });
  return 0.14;
}

function sfxPickCore(v) {
  // 코어 금광: 곡괭이 소리 + 크리스털이 울리는 반짝임(높은 사인 둘이 천천히 사라진다)
  sfxPick(v);
  const { k, t, out, p, r } = v;
  const f = 2637 * r * semi(pick([0, 3, 5, 7]));
  k.tone(out, t + 0.01, { f0: f, dur: 0.45, gain: 0.035 + 0.03 * p, attack: 0.004, vib: { rate: 7, depth: 6 } });
  k.tone(out, t + 0.03, { f0: f * 1.5, dur: 0.35, gain: 0.022 + 0.02 * p, attack: 0.004 });
  return 0.5;
}

function sfxHammer({ k, t, out, p, r }) {
  // 망치질: 나무를 치는 "탁" — 짧은 세모파 + 좁은 대역 잡음 + 낮은 퉁
  k.tone(out, t, { type: "triangle", f0: jit(520, 0.05) * r, f1: 300 * r, glide: 0.03, dur: 0.06, gain: 0.14 + 0.08 * p });
  k.noise(out, t, { type: "bandpass", f0: 1400 * r, q: 5, attack: 0.001, dur: 0.03, gain: 0.2 + 0.1 * p });
  k.tone(out, t, { f0: 150, f1: 90, dur: 0.05, gain: 0.11 });
  return 0.1;
}

function sfxScoop({ k, t, out, p, r }) {
  // 들통을 연못에 담근다: "꿀렁" — 아래에서 위로 미끄러지는 물방울 + 낮은 찰랑
  k.tone(out, t, { f0: jit(220, 0.08) * r, f1: 620 * r, glide: 0.07, dur: 0.1, gain: 0.13 + 0.06 * p });
  k.noise(out, t, { color: "pink", type: "lowpass", f0: 1600, f1: 400, q: 3, attack: 0.005, dur: 0.14, gain: 0.16 + 0.08 * p });
  return 0.18;
}

function sfxSplash({ k, t, out, p, r }) {
  // 들어 올린 들통에서 잉크가 쏟아진다: "쏴" — 아래로 쓸리는 잡음 + 똑똑 방울
  k.noise(out, t, { type: "bandpass", f0: 2600 * r, f1: 700 * r, q: 1.2, attack: 0.01, dur: 0.18, gain: 0.14 + 0.08 * p });
  for (let i = 0; i < 2; i++) {
    const f = rand(600, 1100) * r;
    k.tone(out, t + 0.04 + i * 0.05, { f0: f, f1: f * 1.6, glide: 0.03, dur: 0.05, gain: 0.045 });
  }
  return 0.25;
}

function sfxCoin({ k, t, out, p, r }) {
  // 골드 +N: 동전 "띠링" — 두 음(시 → 미) 사각파 + 맑은 배음
  k.tone(out, t, { type: "square", f0: 987.77 * r, dur: 0.07, gain: 0.06 + 0.03 * p, lp: 5000 });
  k.tone(out, t + 0.07, { type: "square", f0: 1318.5 * r, dur: 0.26, gain: 0.06 + 0.03 * p, lp: 6000, lp1: 2500 });
  k.tone(out, t + 0.07, { f0: 2637 * r, dur: 0.18, gain: 0.025 });
  return 0.4;
}

function sfxChime({ k, t, out, p, r }) {
  // 코어 +N: 맑은 종 두 개 + 반짝이는 꼬리
  k.bell(out, t, 1567.98 * r, { dur: 0.6, gain: 0.06 + 0.03 * p });
  k.bell(out, t + 0.06, 2349.3 * r, { dur: 0.7, gain: 0.045 + 0.025 * p });
  k.noise(out, t + 0.05, { type: "highpass", f0: 8000, attack: 0.02, dur: 0.3, gain: 0.035 });
  return 0.8;
}

function sfxGlug({ k, t, out, p, r }) {
  // 잉크 +N: "꿀꺽" — 낮은 물방울 둘 + 출렁
  for (let i = 0; i < 2; i++) k.tone(out, t + i * 0.09, { f0: (170 + i * 60) * r, f1: (480 + i * 120) * r, glide: 0.06, dur: 0.09, gain: 0.14 + 0.05 * p });
  k.noise(out, t, { color: "pink", type: "lowpass", f0: 900, q: 4, attack: 0.005, dur: 0.18, gain: 0.1 });
  return 0.3;
}

function sfxBubble({ k, t, out, p, r }) {
  // 탱크를 채우는 중의 꿀렁 한 알(p = 탱크가 찬 정도 — 병에 물이 차오르듯 점점 높아진다)
  const f = (260 + 560 * p) * jit(1, 0.08) * r;
  k.tone(out, t, { f0: f * 0.6, f1: f * 1.4, glide: 0.05, dur: 0.07, gain: 0.22 });
  if (Math.random() < 0.5) k.noise(out, t, { color: "pink", type: "bandpass", f0: f * 2, q: 6, attack: 0.002, dur: 0.05, gain: 0.14 });
  return 0.1;
}

function sfxFull({ k, t, out, r }) {
  // "가득!": 밝게 올라가는 두 음 + 종
  k.pluck(out, t, 1046.5 * r, { dur: 0.12, gain: 0.13 });
  k.pluck(out, t + 0.07, 1568 * r, { dur: 0.3, gain: 0.15 });
  k.bell(out, t + 0.07, 3136 * r, { dur: 0.5, gain: 0.045 });
  return 0.6;
}

function sfxSpend({ k, t, out, r }) {
  // 샀다(골드 · 코어를 썼다): 금전 등록기 "철컥 · 짤랑" — 기계음 딸깍 + 종 두 번
  k.noise(out, t, { type: "bandpass", f0: 1800, q: 3, attack: 0.001, dur: 0.03, gain: 0.22 });
  k.tone(out, t, { type: "square", f0: 220 * r, f1: 160, dur: 0.04, gain: 0.07, lp: 1500 });
  k.bell(out, t + 0.06, 2093 * r, { dur: 0.35, gain: 0.07 });
  k.bell(out, t + 0.13, 2637 * r, { dur: 0.5, gain: 0.07 });
  return 0.65;
}

function sfxGive({ k, t, out, p, r }) {
  // 팀원에게 보내기 · 받기: 동전이 차르르 — p ≥ 0.5 받기(위로 + 종) · 그 밖 보내기(아래로)
  const up = p >= 0.5;
  const seq = up ? [0, 2, 4, 7, 12] : [12, 7, 4, 2, 0];
  seq.forEach((n, i) => {
    k.tone(out, t + i * 0.055, { type: "square", f0: 1318.5 * r * semi(n), dur: 0.08, gain: 0.045, lp: 6000 });
    k.noise(out, t + i * 0.055, { type: "highpass", f0: 6000, attack: 0.001, dur: 0.02, gain: 0.045 });
  });
  if (up) k.bell(out, t + 0.28, 2637 * r, { dur: 0.5, gain: 0.05 });
  return 0.8;
}

function sfxFanfare({ k, t, out, r, duck }) {
  // 랩 · 퍼실리티 일이 끝났다: 짧은 금관 팡파르 "빠바바밤!"(솔 · 솔 · 도 · 미) + 화음 + 저음
  const base = 392 * r;
  const seq = [[0, 0, 0.07], [0.1, 0, 0.07], [0.2, 5, 0.09], [0.32, 9, 0.5]];
  for (const [d, n, len] of seq) {
    const f = base * semi(n);
    for (const c of [-8, 8]) k.tone(out, t + d, { type: "sawtooth", f0: f, attack: 0.012, hold: len, dur: 0.18, gain: 0.06, lp: f * 6, lp1: f * 2, detune: c });
    k.tone(out, t + d, { type: "triangle", f0: f / 2, attack: 0.01, hold: len, dur: 0.15, gain: 0.09 });
  }
  const tc = t + 0.32;
  k.bell(out, tc, base * 4 * semi(9), { dur: 0.8, gain: 0.05 });
  k.tone(k.drive(out), tc, { f0: 130, f1: 60, dur: 0.3, gain: 0.35 });
  k.noise(out, tc, { type: "highpass", f0: 6000, attack: 0.002, dur: 0.5, gain: 0.07 });
  duck(0.3, 0.6);
  return 1.2;
}

function sfxBuilt({ k, t, out, r }) {
  // 짓기 · 고치기 끝: 망치 "탁 탁" → 올라가는 종 셋
  for (let i = 0; i < 2; i++) {
    k.tone(out, t + i * 0.11, { type: "triangle", f0: 520 * r, f1: 300 * r, glide: 0.03, dur: 0.06, gain: 0.14 });
    k.noise(out, t + i * 0.11, { type: "bandpass", f0: 1400 * r, q: 5, attack: 0.001, dur: 0.03, gain: 0.2 });
  }
  [0, 4, 7].forEach((n, i) => k.bell(out, t + 0.26 + i * 0.07, 1046.5 * r * semi(n), { dur: 0.5, gain: 0.055 }));
  return 0.95;
}

function sfxReady({ k, t, out, r }) {
  // 일꾼 · 잉크봇이 나왔다: "뿅" + 두 음
  k.tone(out, t, { f0: 300 * r, f1: 900 * r, glide: 0.06, dur: 0.08, gain: 0.11 });
  k.pluck(out, t + 0.07, 784 * r, { dur: 0.12, gain: 0.1 });
  k.pluck(out, t + 0.14, 1046.5 * r, { dur: 0.2, gain: 0.1 });
  return 0.4;
}

function sfxRelease({ k, t, out, r }) {
  // 몬스터를 놓아 주었다: 부드럽게 내려가는 휘파람
  k.tone(out, t, { type: "triangle", f0: 1200 * r, f1: 500 * r, glide: 0.5, attack: 0.03, hold: 0.2, dur: 0.35, gain: 0.08, vib: { rate: 6, depth: 10 } });
  return 0.65;
}

// ── 보석 · 섹션 ──

function sfxShieldCrack({ k, t, out, r, duck }) {
  // 보석 방어막이 깨진다: 유리가 쩍 갈라지는 높은 잡음 + 어긋난 종소리가 흩어져 떨어진다
  k.noise(out, t, { type: "highpass", f0: 4000, f1: 2000, sweep: 0.1, q: 0.8, attack: 0.001, dur: 0.12, gain: 0.45 });
  k.noise(out, t, { type: "bandpass", f0: 5200, q: 8, attack: 0.001, dur: 0.06, gain: 0.3 });
  k.tone(k.drive(out), t, { f0: 200, f1: 70, glide: 0.1, dur: 0.2, gain: 0.4 });
  k.tone(out, t, { type: "sawtooth", f0: 1800 * r, f1: 600 * r, glide: 0.3, dur: 0.3, gain: 0.04, lp: 4000 });
  for (let i = 0; i < 7; i++) {
    const at = t + 0.03 + Math.random() ** 1.3 * 0.6;
    k.bell(out, at, rand(2200, 5200) * r, { dur: rand(0.15, 0.35), gain: rand(0.02, 0.045) });
  }
  duck(0.25, 0.3);
  return 0.9;
}

function sfxGemPop({ k, t, out, p, r, duck }) {
  // 바위가 깨지고 보석이 튀어나온다: 와르르(바위) → 반짝이며 올라가는 높은 음계 + 종(가운데 2점 보석은 한 음 높게)
  k.tone(k.drive(out, true), t, { f0: 110, f1: 38, glide: 0.2, dur: 0.45, gain: 0.7 });
  k.noise(out, t, { color: "pink", type: "lowpass", f0: 2400, f1: 200, sweep: 0.35, q: 1.2, attack: 0.002, dur: 0.5, gain: 0.5 });
  for (let i = 0; i < 6; i++) k.noise(out, t + 0.02 + Math.random() ** 1.4 * 0.4, { type: "bandpass", f0: rand(500, 1600), q: 4, attack: 0.001, dur: rand(0.03, 0.06), gain: rand(0.1, 0.2) });
  const tc = t + 0.18;
  const base = 1046.5 * r * (p >= 0.9 ? semi(2) : 1);
  [0, 4, 7, 12, 16, 19].forEach((n, i) => k.tone(out, tc + i * 0.045, { type: "triangle", f0: base * semi(n), dur: 0.25, gain: 0.06 }));
  k.bell(out, tc + 0.28, base * 2, { dur: 0.9, gain: 0.07 });
  k.noise(out, tc, { type: "highpass", f0: 7500, attack: 0.03, hold: 0.2, dur: 0.4, gain: 0.05 });
  duck(0.3, 0.4);
  return 1.4;
}

function sfxGemPick({ k, t, out, p, r }) {
  // 보석을 들었다: "띠링~" 위로 두 음 + 반짝(p 가 크면 — 우리 팀 · 나 — 밝고 크게, 남이면 낮고 작게)
  const base = (p > 0.7 ? 1318.5 : 987.77) * r;
  k.pluck(out, t, base, { dur: 0.15, gain: 0.08 + 0.06 * p, bright: 1.3 });
  k.pluck(out, t + 0.08, base * semi(7), { dur: 0.35, gain: 0.08 + 0.06 * p, bright: 1.3 });
  k.bell(out, t + 0.08, base * 2, { dur: 0.5, gain: 0.025 + 0.03 * p });
  k.tone(out, t, { f0: 300 * r, f1: 900 * r, glide: 0.12, dur: 0.14, gain: 0.05 });
  return 0.6;
}

function sfxGemSteal({ k, t, out, r }) {
  // 다른 팀이 보석을 빼앗았다: 휙 낚아채는 바람 + 불안한 반음 부딪힘
  k.noise(out, t, { type: "bandpass", f0: 3000, f1: 600, sweep: 0.15, q: 2, attack: 0.005, dur: 0.16, gain: 0.4 });
  for (const n of [0, 1]) k.tone(out, t + 0.05, { type: "square", f0: 740 * r * semi(n), dur: 0.22, gain: 0.075, lp: 3000 });
  k.tone(out, t + 0.05, { type: "sawtooth", f0: 370 * r, f1: 330 * r, dur: 0.3, gain: 0.1, lp: 1800 });
  return 0.45;
}

function sfxGemDrop({ k, t, out, r }) {
  // 보석이 떨어졌다: "통" — 튀며 굴러가는 종소리가 내려간다
  k.tone(k.drive(out), t, { f0: 160, f1: 70, dur: 0.12, gain: 0.32 });
  [0, 0.12, 0.2, 0.26].forEach((d, i) => k.bell(out, t + d, 1760 * r * semi(-i * 2), { dur: 0.25, gain: 0.06 * (1 - i * 0.18) }));
  return 0.6;
}

function sfxGemReturn({ k, t, out, r }) {
  // 떨어진 보석이 섹션으로 돌아갔다: 거꾸로 빨려 드는 바람 + 부드러운 종
  k.noise(out, t, { type: "bandpass", f0: 600 * r, f1: 4000 * r, sweep: 0.5, q: 3, attack: 0.4, dur: 0.12, gain: 0.16 });
  k.bell(out, t + 0.45, 1318.5 * r, { dur: 0.6, gain: 0.05 });
  return 1.1;
}

function sfxGemScore({ k, t, out, p, r, duck }) {
  // 우리 팀 득점: 브로울스 득점 네 음 → 큰 장조 화음 + 저음 + 종 비(p 가 크면 — 2점 — 맨 끝에 두 음 더). 가장 크고 길게
  const base = 659.25 * r;
  [0, 4, 7, 12].forEach((n, i) => k.pluck(out, t + i * 0.07, base * semi(n), { dur: 0.25, gain: 0.18, type: "square", bright: 1.2 }));
  const tc = t + 0.3;
  [0, 4, 7, 12, 16].forEach((n, i) => {
    k.tone(out, tc, { type: "sawtooth", f0: (base * semi(n)) / 2, attack: 0.01, hold: 0.35, dur: 0.8, gain: 0.045, lp: 5000, lp1: 1400, detune: i % 2 ? 8 : -8 });
  });
  k.tone(k.drive(out), tc, { f0: 130.8, f1: 55, glide: 0.15, dur: 0.6, gain: 0.55 });
  for (let i = 0; i < 6; i++) k.bell(out, tc + 0.05 + i * 0.07, base * 2 * semi(pick(PENTA)), { dur: 0.5, gain: 0.035 });
  k.noise(out, tc, { type: "highpass", f0: 6000, attack: 0.003, dur: 0.9, gain: 0.1 });
  if (p > 0.7) [0, 7].forEach((n, i) => k.pluck(out, tc + 0.55 + i * 0.1, base * 2 * semi(n), { dur: 0.3, gain: 0.11 }));
  duck(0.5, 1.0);
  return 1.8;
}

function sfxGemScoreOther({ k, t, out, r, duck }) {
  // 다른 팀 득점: 짧고 어두운 세 음(단조로 내려간다) + 낮은 쿵 — 경고처럼
  [[0, 0], [0.13, -3], [0.26, -7]].forEach(([d, n], i) => {
    const f = 440 * r * semi(n);
    k.tone(out, t + d, { type: "square", f0: f, attack: 0.005, hold: i === 2 ? 0.25 : 0.07, dur: 0.12, gain: 0.06, lp: 2200 });
    k.tone(out, t + d, { type: "triangle", f0: f / 2, attack: 0.005, hold: i === 2 ? 0.25 : 0.07, dur: 0.12, gain: 0.08 });
  });
  k.tone(k.drive(out), t, { f0: 110, f1: 50, dur: 0.3, gain: 0.35 });
  duck(0.25, 0.4);
  return 0.8;
}

function sfxQuiz({ k, t, out, r }) {
  // 문제가 나왔다: "딩동" 초인종 두 음(미 → 도)
  k.bell(out, t, 1318.5 * r, { dur: 0.5, gain: 0.1 });
  k.bell(out, t + 0.22, 1046.5 * r, { dur: 0.8, gain: 0.1 });
  k.pluck(out, t, 659.25 * r, { dur: 0.2, gain: 0.07 });
  k.pluck(out, t + 0.22, 523.25 * r, { dur: 0.3, gain: 0.07 });
  return 1.1;
}

function sfxRight({ k, t, out, r, duck }) {
  // 정답: "딩동댕" — 도 · 미 · 솔 · 도 올라가고 맨 위 종
  [0, 4, 7, 12].forEach((n, i) => k.pluck(out, t + i * 0.09, 523.25 * r * semi(n), { dur: 0.22 + (i === 3 ? 0.3 : 0), gain: 0.15, bright: 1.2 }));
  k.bell(out, t + 0.27, 2093 * r, { dur: 0.8, gain: 0.07 });
  duck(0.25, 0.5);
  return 1.1;
}

function sfxWrong({ k, t, out, r, duck }) {
  // 오답 · 시간 끝: "삐-익" 낮은 버저 두 번(내려간다)
  [0, 0.2].forEach((d, i) => {
    for (const c of [-10, 10]) k.tone(out, t + d, { type: "sawtooth", f0: (i ? 147 : 165) * r, attack: 0.005, hold: i ? 0.32 : 0.12, dur: 0.06, gain: 0.08, detune: c, lp: 1400 });
  });
  duck(0.2, 0.4);
  return 0.7;
}

// ── 본진 ──

function sfxAlarm({ k, t, out, r }) {
  // 우리 건물이 공격받는다: "삐뽀 삐뽀" 두 음 경보
  for (let i = 0; i < 4; i++) {
    const f = (i % 2 ? 660 : 880) * r;
    k.tone(out, t + i * 0.14, { type: "square", f0: f, attack: 0.004, hold: 0.09, dur: 0.04, gain: 0.06, lp: 3200 });
    k.tone(out, t + i * 0.14, { type: "triangle", f0: f / 2, attack: 0.004, hold: 0.09, dur: 0.04, gain: 0.06 });
  }
  return 0.65;
}

function sfxCollapse({ k, t, out, r, duck }) {
  // 건물이 무너진다: 쩍 갈라짐 → 와르르 굴러떨어지는 파편(여러 번 쿵) → 길게 남는 흙먼지 울림
  k.noise(out, t, { type: "highpass", f0: 2500, f1: 900, sweep: 0.1, attack: 0.001, dur: 0.12, gain: 0.4 });
  const body = k.drive(out, true);
  k.tone(body, t, { f0: 85 * r, f1: 30, glide: 0.5, attack: 0.004, hold: 0.1, dur: 1.0, gain: 0.8 });
  k.noise(out, t + 0.02, { color: "pink", type: "lowpass", f0: 1400, f1: 90, sweep: 1.3, q: 1.4, attack: 0.03, hold: 0.25, dur: 1.2, gain: 0.7 });
  for (let i = 0; i < 7; i++) {
    const at = t + 0.08 + Math.random() ** 1.3 * 0.9;
    k.tone(body, at, { f0: rand(90, 160), f1: 45, dur: 0.12, gain: rand(0.18, 0.35) });
    k.noise(out, at, { type: "bandpass", f0: rand(400, 1500), q: 3, attack: 0.001, dur: rand(0.03, 0.07), gain: rand(0.1, 0.2) });
  }
  duck(0.5, 0.8);
  return 1.7;
}

function sfxTowerHit({ k, t, out, r }) {
  // 우리 깃발의 탑이 맞는다: 묵직한 "쿵" + 낮은 쇳소리 울림
  k.tone(k.drive(out), t, { f0: 120, f1: 55, glide: 0.1, dur: 0.25, gain: 0.5 });
  k.bell(out, t, 330 * r, { dur: 0.5, gain: 0.07 });
  k.noise(out, t, { type: "bandpass", f0: 900, q: 2, attack: 0.001, dur: 0.06, gain: 0.22 });
  return 0.6;
}

function sfxElimSelf({ k, t, out, r, duck, muffle }) {
  // 우리 팀 탈락: 큰 저음 한 방 → 단조 화음이 길게 처지며 무너져 내린다 + 느린 종 세 번
  k.tone(k.drive(out, true), t, { f0: 110, f1: 28, glide: 0.9, attack: 0.004, hold: 0.2, dur: 1.6, gain: 0.85 });
  k.noise(out, t, { color: "pink", type: "lowpass", f0: 3000, f1: 120, sweep: 1.2, q: 1, attack: 0.003, dur: 1.4, gain: 0.5 });
  [220, 261.63, 329.63, 440].forEach((f) => {
    for (const c of [-9, 9]) k.tone(out, t + 0.1, { type: "sawtooth", f0: f * r, f1: f * r * 0.84, glide: 2.0, attack: 0.05, hold: 0.8, dur: 1.4, gain: 0.04, detune: c, lp: 2400, lp1: 500 });
  });
  [0, 0.6, 1.2].forEach((d, i) => k.bell(out, t + 0.3 + d, 196 * r, { dur: 1.2, gain: 0.07 - i * 0.015 }));
  duck(0.85, 2.0);
  muffle(0.4, 2.2, 0.15);
  return 2.8;
}

function sfxElimOther({ k, t, out, p, r, duck }) {
  // 다른 팀 탈락: 짧은 금관 두 음. p 가 크면(우리가 탑을 부쉈다) 밝게 올라가고, 아니면 무겁게 "둥-둥"
  const win = p > 0.7;
  const seq = win ? [[0, 0, 0.1], [0.14, 7, 0.45]] : [[0, 0, 0.12], [0.18, -5, 0.4]];
  const base = (win ? 392 : 293.66) * r;
  for (const [d, n, len] of seq) {
    const f = base * semi(n);
    for (const c of [-8, 8]) k.tone(out, t + d, { type: "sawtooth", f0: f, attack: 0.012, hold: len, dur: 0.25, gain: 0.06, lp: f * 5, lp1: f * 1.8, detune: c });
    k.tone(out, t + d, { type: "triangle", f0: f / 2, attack: 0.01, hold: len, dur: 0.2, gain: 0.1 });
  }
  k.tone(k.drive(out), t, { f0: 120, f1: 45, glide: 0.15, dur: 0.5, gain: 0.5 });
  k.noise(out, t, { type: "highpass", f0: 5000, attack: 0.002, dur: 0.6, gain: 0.08 });
  duck(0.4, 0.6);
  return 1.0;
}

function sfxOut({ k, t, out, r, duck }) {
  // 내 영웅의 목숨이 다했다: 내려가는 세 음 + 느린 종 두 번(이제 지휘관)
  [[0, 0], [0.25, -3], [0.5, -7]].forEach(([d, n], i) => {
    k.tone(out, t + d, { type: "triangle", f0: 523.25 * r * semi(n), attack: 0.01, hold: i === 2 ? 0.5 : 0.15, dur: 0.3, gain: 0.15, vib: i === 2 ? { rate: 5, depth: 6 } : undefined });
  });
  k.bell(out, t + 0.5, 261.63 * r, { dur: 1.4, gain: 0.09 });
  k.bell(out, t + 1.1, 196 * r, { dur: 1.6, gain: 0.07 });
  duck(0.5, 1.2);
  return 2.2;
}

// ── 화면 · 단추 ──

function sfxTick({ k, t, out, r }) {
  // 시작 전 세기의 째깍(나무 블록)
  k.tone(out, t, { type: "triangle", f0: 1250 * r, f1: 1000 * r, dur: 0.05, gain: 0.3 });
  k.noise(out, t, { type: "bandpass", f0: 2500 * r, q: 6, attack: 0.001, dur: 0.025, gain: 0.3 });
  k.tone(out, t, { f0: 160, f1: 90, dur: 0.05, gain: 0.15 });
  return 0.08;
}

function sfxHorn({ k, t, out, r, duck }) {
  // 시작 나팔: 도 · 솔 · 도 금관 화음을 짧게 한 번, 한 음 올려 길게 한 번
  const blast = (at, hold, up) => {
    for (const f of [261.63, 392, 523.25]) {
      for (const c of [-8, 8]) k.tone(out, at, { type: "sawtooth", f0: f * r * (up ? semi(2) : 1), attack: 0.02, hold, dur: 0.25, gain: 0.045, detune: c, lp: 3600, lp1: 1400 });
    }
  };
  blast(t, 0.12, false);
  blast(t + 0.24, 0.5, true);
  duck(0.4, 0.6);
  return 1.1;
}

function sfxDeny({ k, t, out, r }) {
  // 안 돼요(서버가 거절한 일 · 못 하는 일): 낮은 "부-붑" 버저
  for (const d of [0, 0.11]) k.tone(out, t + d, { type: "square", f0: 130 * r, attack: 0.003, hold: 0.06, dur: 0.03, gain: 0.07, lp: 900 });
  return 0.22;
}

function sfxSelect({ k, t, out, r }) {
  // 유닛을 골랐다: 짧게 올라가는 "삑"
  k.tone(out, t, { f0: 880 * r, f1: 1320 * r, glide: 0.04, dur: 0.06, gain: 0.15 });
  k.noise(out, t, { type: "highpass", f0: 5000, attack: 0.001, dur: 0.012, gain: 0.08 });
  return 0.08;
}

function sfxTarget({ k, t, out, r }) {
  // 공격 과녁 고르기 켬: 조준이 잠기는 "삑삑"
  [0, 0.07].forEach((d, i) => k.tone(out, t + d, { type: "square", f0: (1200 + i * 400) * r, dur: 0.05, gain: 0.08, lp: 5000 }));
  return 0.15;
}

function sfxOpen({ k, t, out, r }) {
  // 판 · 명령 판 열기: 부드럽게 올라가는 "뽁"
  k.tone(out, t, { type: "triangle", f0: 420 * r, f1: 840 * r, glide: 0.05, dur: 0.08, gain: 0.22 });
  k.noise(out, t, { type: "bandpass", f0: 2400, q: 2, attack: 0.001, dur: 0.02, gain: 0.12 });
  return 0.12;
}

// max = 같은 이름 동시 발음 한도, gap = 같은 이름 사이 최소 간격(초), prio = 발음 수가 찼을 때 살아남는 순위,
// flat = 위치 없이 가운데에서, steady = 음높이를 흔들지 않는다, send = 리버브 양, reach = 들리는 거리 배율(지도 칸 · 기본 1)
export const REALM_SOUNDS = {
  launch: { fn: sfxLaunch, max: 3, gap: 0.04, prio: 3 },
  homing: { fn: sfxHoming, max: 3, gap: 0.04, prio: 3 },
  drill: { fn: sfxDrill, max: 3, gap: 0.04, prio: 3 },
  firework: { fn: sfxFirework, max: 3, gap: 0.05, prio: 4, send: 0.25 },
  vortex: { fn: sfxVortex, max: 2, gap: 0.2, prio: 4, send: 0.25 },
  mshoot: { fn: sfxMShoot, max: 3, gap: 0.05, prio: 2 },
  msplat: { fn: sfxMSplat, max: 3, gap: 0.05, prio: 2 },
  crate: { fn: sfxCrate, max: 3, gap: 0.05, prio: 3 },
  heal: { fn: sfxHeal, max: 2, gap: 0.08, prio: 4, send: 0.2 },
  warn: { fn: sfxWarn, max: 2, gap: 0.15, prio: 4 },
  slam: { fn: sfxSlam, max: 2, gap: 0.08, prio: 5, send: 0.25, reach: 1.4 },
  roar: { fn: sfxRoar, max: 1, gap: 1.5, prio: 7, send: 0.35, reach: 2 },
  mko: { fn: sfxMonsterKo, max: 3, gap: 0.08, prio: 4, send: 0.25 },
  hatch: { fn: sfxHatch, max: 1, gap: 0.3, prio: 5, flat: true, send: 0.2 },
  levelUp: { fn: sfxLevelUp, max: 1, gap: 0.3, prio: 5, flat: true, steady: true, send: 0.25 },
  pick: { fn: sfxPick, max: 3, gap: 0.05, prio: 0, send: 0.05 },
  pickCore: { fn: sfxPickCore, max: 2, gap: 0.06, prio: 0, send: 0.08 },
  hammer: { fn: sfxHammer, max: 3, gap: 0.05, prio: 0, send: 0.05 },
  scoop: { fn: sfxScoop, max: 2, gap: 0.06, prio: 0, send: 0.05 },
  splash: { fn: sfxSplash, max: 2, gap: 0.06, prio: 0, send: 0.06 },
  coin: { fn: sfxCoin, max: 2, gap: 0.08, prio: 1, steady: true, send: 0.08 },
  chime: { fn: sfxChime, max: 2, gap: 0.08, prio: 1, steady: true, send: 0.15 },
  glug: { fn: sfxGlug, max: 2, gap: 0.08, prio: 1, send: 0.08 },
  bubble: { fn: sfxBubble, max: 2, gap: 0.06, prio: 1, flat: true, send: 0.04 },
  full: { fn: sfxFull, max: 1, gap: 0.3, prio: 3, flat: true, steady: true, send: 0.15 },
  spend: { fn: sfxSpend, max: 1, gap: 0.12, prio: 2, flat: true, steady: true, send: 0.1 },
  give: { fn: sfxGive, max: 1, gap: 0.2, prio: 3, flat: true, steady: true, send: 0.12 },
  fanfare: { fn: sfxFanfare, max: 1, gap: 0.4, prio: 5, flat: true, steady: true, send: 0.25 },
  built: { fn: sfxBuilt, max: 1, gap: 0.3, prio: 3, flat: true, steady: true, send: 0.15 },
  ready: { fn: sfxReady, max: 2, gap: 0.12, prio: 2, flat: true, steady: true, send: 0.1 },
  release: { fn: sfxRelease, max: 1, gap: 0.2, prio: 2, flat: true, send: 0.2 },
  shieldCrack: { fn: sfxShieldCrack, max: 2, gap: 0.1, prio: 5, send: 0.25, reach: 1.6 },
  gemPop: { fn: sfxGemPop, max: 2, gap: 0.1, prio: 5, send: 0.25, reach: 2 },
  gemPick: { fn: sfxGemPick, max: 2, gap: 0.1, prio: 5, send: 0.2, reach: 2.5 },
  gemSteal: { fn: sfxGemSteal, max: 2, gap: 0.1, prio: 5, send: 0.2, reach: 2.5 },
  gemDrop: { fn: sfxGemDrop, max: 2, gap: 0.1, prio: 4, send: 0.2, reach: 2 },
  gemReturn: { fn: sfxGemReturn, max: 2, gap: 0.2, prio: 3, send: 0.3, reach: 2 },
  gemScore: { fn: sfxGemScore, max: 1, gap: 0.4, prio: 7, flat: true, steady: true, send: 0.3 },
  gemScoreOther: { fn: sfxGemScoreOther, max: 1, gap: 0.3, prio: 6, flat: true, steady: true, send: 0.25 },
  quiz: { fn: sfxQuiz, max: 1, gap: 0.3, prio: 6, flat: true, steady: true, send: 0.2 },
  right: { fn: sfxRight, max: 1, gap: 0.3, prio: 6, flat: true, steady: true, send: 0.25 },
  wrong: { fn: sfxWrong, max: 1, gap: 0.3, prio: 6, flat: true, steady: true, send: 0.15 },
  alarm: { fn: sfxAlarm, max: 1, gap: 0.5, prio: 5, flat: true, steady: true, send: 0.12 },
  collapse: { fn: sfxCollapse, max: 2, gap: 0.15, prio: 6, send: 0.3, reach: 2.5 },
  towerHit: { fn: sfxTowerHit, max: 1, gap: 0.3, prio: 4, flat: true, send: 0.15 },
  elimSelf: { fn: sfxElimSelf, max: 1, gap: 1, prio: 8, flat: true, steady: true, send: 0.35 },
  elimOther: { fn: sfxElimOther, max: 1, gap: 0.5, prio: 7, flat: true, steady: true, send: 0.3 },
  out: { fn: sfxOut, max: 1, gap: 1, prio: 7, flat: true, steady: true, send: 0.3 },
  tick: { fn: sfxTick, max: 2, gap: 0.1, prio: 3, flat: true, steady: true, send: 0.05 },
  horn: { fn: sfxHorn, max: 1, gap: 0.5, prio: 7, flat: true, steady: true, send: 0.3 },
  deny: { fn: sfxDeny, max: 1, gap: 0.1, prio: 2, flat: true, steady: true, send: 0.04 },
  select: { fn: sfxSelect, max: 2, gap: 0.05, prio: 1, flat: true, send: 0.03 },
  target: { fn: sfxTarget, max: 1, gap: 0.1, prio: 2, flat: true, steady: true, send: 0.04 },
  open: { fn: sfxOpen, max: 2, gap: 0.05, prio: 1, flat: true, send: 0.04 },
};
