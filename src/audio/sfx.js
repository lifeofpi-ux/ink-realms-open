// [왕국전] 잉크 브로울스 src/audio/sfx.js 를 그대로 가져왔다(왕국전에서 새로 만든 소리는 sfx-realms.js).
// 효과음 합성법. 음원 파일 없이 오실레이터와 필터 노이즈만으로 만든다.
// 타격음은 세 층을 겹친다: (1) 순간 클릭 — 귀에 "맞았다"를 알리는 1~3ms 의 날, (2) 저음 한 방 — 몸통의 무게,
// (3) 질감 노이즈 — 고무 · 잉크 · 물기. 층마다 음높이 · 길이 · 필터를 매번 조금씩 흔들어 기계적이지 않게 한다.

import { clamp, rand, jit, pick, semi } from "./util.js";

// 색(PALETTE 인덱스)마다 음색을 살짝 다르게: 몸통 음높이와 물방울 음계의 으뜸음을 옮긴다.
const COLOR_SEMI = [0, 3, -2, 5, -4, 7, 2, -5];
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17];
export const colorPitch = (c) => (Number.isInteger(c) && c >= 0 ? semi(COLOR_SEMI[c % COLOR_SEMI.length] * 0.35) : 1);
const dropRoot = (c) => 620 * (Number.isInteger(c) && c >= 0 ? semi(COLOR_SEMI[c % COLOR_SEMI.length]) : 1);

/** ctx 에 묶인 합성 부품 상자. buffers = { white, pink }, curves = { soft, hard } */
export function createKit(ctx, buffers, curves) {
  // 0 → peak(attack) → 유지(hold) → 지수 감쇠(decay). 지수 감쇠가 타악기처럼 자연스럽게 들린다.
  function envGain(t, peak, attack, hold, decay) {
    const g = ctx.createGain();
    const p = Math.max(0.0002, peak);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(p, t + attack);
    if (hold > 0) g.gain.setValueAtTime(p, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
    return g;
  }

  /** 오실레이터 한 줄. f0→f1 로 미끄러지고(glide), 필요하면 저역 필터(lp→lp1)와 비브라토(vib)를 건다. */
  function tone(dest, t, o) {
    const attack = o.attack ?? 0.002;
    const hold = o.hold ?? 0;
    const dur = o.dur ?? 0.1;
    const end = t + attack + hold + dur;
    const osc = ctx.createOscillator();
    osc.type = o.type || "sine";
    const f0 = clamp(o.f0, 20, 18000);
    const f1 = clamp(o.f1 ?? o.f0, 20, 18000);
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + (o.glide ?? attack + hold + dur));
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    if (o.vib) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.setValueAtTime(o.vib.rate, t);
      depth.gain.setValueAtTime(o.vib.depth, t);
      if (o.vib.depth1) depth.gain.linearRampToValueAtTime(o.vib.depth1, end);
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(end + 0.03);
    }
    const g = envGain(t, o.gain ?? 0.3, attack, hold, dur);
    let head = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.Q.value = o.q ?? 0.7;
      f.frequency.setValueAtTime(clamp(o.lp, 40, 18000), t);
      if (o.lp1) f.frequency.exponentialRampToValueAtTime(clamp(o.lp1, 40, 18000), end);
      osc.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(end + 0.03);
  }

  /** 필터 노이즈 한 줄. 필터 중심이 f0→f1 로 쓸려 가면(sweep) "철퍽" · "휙" 같은 움직임이 생긴다. */
  function noise(dest, t, o) {
    const attack = o.attack ?? 0.002;
    const hold = o.hold ?? 0;
    const dur = o.dur ?? 0.1;
    const end = t + attack + hold + dur;
    const buf = buffers[o.color || "white"];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || "bandpass";
    f.Q.value = o.q ?? 1;
    const f0 = clamp(o.f0, 30, 18000);
    f.frequency.setValueAtTime(f0, t);
    if (o.f1 && o.f1 !== o.f0) {
      f.frequency.exponentialRampToValueAtTime(clamp(o.f1, 30, 18000), t + (o.sweep ?? attack + hold + dur));
    }
    const g = envGain(t, o.gain ?? 0.3, attack, hold, dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * Math.max(0, buf.duration - 0.05));
    src.stop(end + 0.03);
  }

  /** 포화기. 순수한 사인 저음에 배음을 붙여 작은 스피커에서도 "한 방"이 들리게 한다. */
  function drive(dest, hard = false) {
    const ws = ctx.createWaveShaper();
    ws.curve = hard ? curves.hard : curves.soft;
    ws.connect(dest);
    return ws;
  }

  /** 짧게 튕기는 음(신호음 · 득점음). */
  function pluck(dest, t, freq, { dur = 0.25, gain = 0.2, type = "triangle", bright = 1 } = {}) {
    tone(dest, t, { type, f0: freq, dur, gain, attack: 0.003, lp: freq * 6 * bright, lp1: freq * 1.5 });
    tone(dest, t, { f0: freq * 2, dur: dur * 0.6, gain: gain * 0.35 });
  }

  /** 종소리 비슷한 비화성 배음. */
  function bell(dest, t, freq, { dur = 0.6, gain = 0.12 } = {}) {
    tone(dest, t, { f0: freq, dur, gain, attack: 0.002 });
    tone(dest, t, { f0: freq * 2.76, dur: dur * 0.55, gain: gain * 0.42, attack: 0.002 });
    tone(dest, t, { f0: freq * 5.4, dur: dur * 0.3, gain: gain * 0.2, attack: 0.002 });
  }

  return { tone, noise, drive, pluck, bell };
}

// 각 합성 함수는 v = { k(부품 상자), t(시작 시각), out(목적지), p(세기 0..1), r(음높이 배율), col(색 | -1), duck(깊이, 길이) }
// 를 받아 소리를 예약하고, 소리가 끝나기까지의 길이(초)를 돌려준다.

function sfxThrow({ k, t, out, p, r }) {
  // 휙: 공기를 가르는 소리 + 고무가 손을 떠나는 튕김
  k.noise(out, t, { type: "bandpass", f0: jit(650, 0.12) * r, f1: jit(2600, 0.12) * r, q: 1.6, attack: 0.012, dur: 0.13, gain: 0.3 + 0.14 * p });
  k.tone(out, t, { type: "triangle", f0: jit(300, 0.06) * r, f1: 560 * r, glide: 0.07, dur: 0.09, gain: 0.16 + 0.1 * p });
  k.noise(out, t, { type: "highpass", f0: 3500, attack: 0.001, dur: 0.018, gain: 0.12 });
  return 0.22;
}

function sfxThrowBig({ k, t, out, p, r }) {
  // 더 길고 낮게: 무거운 것을 힘껏 내던지는 소리
  k.noise(out, t, { color: "pink", type: "bandpass", f0: jit(380, 0.1) * r, f1: jit(1900, 0.1) * r, q: 1.3, attack: 0.02, dur: 0.24, gain: 0.4 + 0.18 * p });
  k.tone(out, t, { type: "triangle", f0: 170 * r, f1: 430 * r, glide: 0.13, dur: 0.17, gain: 0.28 });
  k.tone(out, t, { f0: 110 * r, f1: 60, glide: 0.12, dur: 0.16, gain: 0.3 + 0.1 * p });
  k.noise(out, t, { type: "highpass", f0: 3000, attack: 0.001, dur: 0.025, gain: 0.16 });
  return 0.36;
}

function sfxBurst({ k, t, out, p, r, col, duck }) {
  const big = p; // 0.5 = 소형, 1 = 대형
  // (1) 팡 — 고무가 찢어지는 순간의 날카로운 클릭과, 풍선 속이 비어 울리는 짧은 공명
  k.noise(out, t, { type: "highpass", f0: 2600 * r, q: 0.7, attack: 0.001, dur: 0.035 + 0.02 * big, gain: 0.3 + 0.4 * big });
  k.tone(out, t, { type: "triangle", f0: jit(2100, 0.1) * r, f1: 520 * r, glide: 0.03, dur: 0.05, gain: 0.18 + 0.14 * big });
  k.noise(out, t, { type: "bandpass", f0: jit(980 - 320 * big, 0.08) * r, q: 5, attack: 0.001, dur: 0.09, gain: 0.32 + 0.26 * big });
  // (2) 저음 한 방 — 사인이 빠르게 떨어지며 배를 친다. 포화기로 배음을 붙인다
  const body = k.drive(out, big > 0.75);
  k.tone(body, t, { f0: (150 - 30 * big) * r, f1: 46 - 8 * big, glide: 0.09 + 0.05 * big, dur: 0.26 + 0.24 * big, gain: 0.5 + 0.45 * big, attack: 0.003 });
  k.tone(out, t, { type: "triangle", f0: 240 * r, f1: 85 * r, glide: 0.05, dur: 0.1, gain: 0.28 + 0.16 * big });
  // (3) 철퍽 — 끈적한 잉크가 바닥에 퍼진다: 공명 저역 필터가 위에서 아래로 쓸려 내려간다
  const ts = t + 0.012;
  k.noise(out, ts, { color: "pink", type: "lowpass", f0: jit(4200, 0.15) * r, f1: jit(340, 0.2), sweep: 0.2 + 0.1 * big, q: 5.5, attack: 0.006, dur: 0.3 + 0.25 * big, gain: 0.5 + 0.25 * big });
  k.noise(out, ts, { type: "bandpass", f0: jit(6500, 0.2), f1: 2400, q: 0.9, attack: 0.004, dur: 0.12 + 0.08 * big, gain: 0.15 + 0.08 * big });
  // (4) 물방울 — 튄 잉크가 여기저기 떨어지는 "똑 · 뽁". 색마다 다른 음계에서 고른다
  const root = dropRoot(col) * r;
  const drops = 3 + Math.round(5 * big) + ((Math.random() * 3) | 0);
  for (let i = 0; i < drops; i++) {
    const td = ts + 0.03 + Math.random() ** 1.4 * (0.26 + 0.2 * big);
    const f = root * semi(pick(PENTA));
    k.tone(out, td, { f0: f * 0.55, f1: f * jit(1.25, 0.2), glide: 0.035, dur: rand(0.04, 0.08), gain: rand(0.05, 0.11) * (1 - (i / drops) * 0.5) });
  }
  if (big > 0.45) duck(0.2 + 0.3 * big, 0.22);
  return 0.62 + 0.4 * big;
}

function sfxHit({ k, t, out, p, r, duck }) {
  // 남이 맞았다. 잉크%가 높을수록(= p) 더 크고 더 높게 — "쟤 이제 날아간다"가 귀로 들려야 한다
  const up = 1 + 0.7 * p;
  // 찰싹 — 젖은 살을 때리는 중고역 노이즈
  k.noise(out, t, { type: "bandpass", f0: jit(2000, 0.1) * up * r, q: 1.4, attack: 0.001, dur: 0.07 + 0.05 * p, gain: 0.26 + 0.64 * p });
  k.noise(out, t, { type: "highpass", f0: 5200, attack: 0.001, dur: 0.03, gain: 0.1 + 0.34 * p });
  // 몸통
  k.tone(k.drive(out), t, { f0: 270 * up * r, f1: 105 * r, glide: 0.07, dur: 0.13 + 0.08 * p, gain: 0.3 + 0.55 * p });
  // 봉크 — 만화 같은 음정 있는 타격. 세질수록 5도 위 배음이 붙는다
  k.tone(out, t, { type: "square", f0: 640 * up * r, f1: 300 * up * r, glide: 0.06, dur: 0.09, gain: 0.1 + 0.1 * p, lp: 3200 });
  if (p > 0.5) k.tone(out, t + 0.004, { type: "triangle", f0: 960 * up * r, f1: 620 * up * r, glide: 0.08, dur: 0.12, gain: 0.12 * p });
  // 잉크가 튀는 꼬리
  k.noise(out, t + 0.02, { color: "pink", type: "bandpass", f0: 3000, f1: 900, q: 2, dur: 0.16 + 0.14 * p, gain: 0.18 + 0.15 * p });
  if (p > 0.7) duck(0.2, 0.15);
  return 0.36 + 0.2 * p;
}

function sfxHitSelf({ k, t, out, p, r, duck }) {
  // 내가 맞았다. 가장 무겁게: 뱃속 저음 + 으깨지는 중음 + 찰싹 + 귀울림
  const body = k.drive(out, true);
  k.tone(body, t, { f0: 120, f1: 36, glide: 0.16, dur: 0.42 + 0.2 * p, gain: 0.9, attack: 0.003 });
  k.tone(body, t, { type: "sawtooth", f0: 190 * r, f1: 62, glide: 0.1, dur: 0.16, gain: 0.28 + 0.2 * p, lp: 1400, lp1: 300 });
  k.noise(out, t, { type: "bandpass", f0: jit(1700, 0.1), q: 1.1, attack: 0.001, dur: 0.1, gain: 0.75 + 0.35 * p });
  k.noise(out, t, { type: "highpass", f0: 4500, attack: 0.001, dur: 0.04, gain: 0.4 });
  k.noise(out, t + 0.015, { color: "pink", type: "lowpass", f0: 3200, f1: 260, q: 4, sweep: 0.22, attack: 0.006, dur: 0.4, gain: 0.5 });
  k.tone(out, t + 0.02, { f0: jit(3100, 0.04), dur: 0.7, gain: 0.03 + 0.03 * p, attack: 0.02 });
  duck(0.5 + 0.3 * p, 0.3);
  return 0.9;
}

function sfxBump({ k, t, out, r }) {
  // 대시 박치기: 둔탁한 쿵 + 고무공이 눌렸다 튀는 "뽀잉"
  k.tone(k.drive(out), t, { f0: 210 * r, f1: 72, glide: 0.08, dur: 0.16, gain: 0.7 });
  k.tone(out, t + 0.01, { type: "triangle", f0: 250 * r, f1: 390 * r, glide: 0.05, dur: 0.14, gain: 0.2, vib: { rate: 38, depth: 40 } });
  k.noise(out, t, { type: "lowpass", f0: 1800, f1: 400, attack: 0.001, dur: 0.07, gain: 0.5 });
  k.noise(out, t, { type: "bandpass", f0: 2600 * r, q: 2, attack: 0.001, dur: 0.03, gain: 0.3 });
  return 0.3;
}

function sfxDash({ k, t, out, p, r }) {
  // 쉭: 필터가 빠르게 올라가는 바람 + 짧은 음정 상승
  k.noise(out, t, { type: "bandpass", f0: jit(420, 0.1) * r, f1: jit(3800, 0.1) * r, sweep: 0.11, q: 2.2, attack: 0.015, dur: 0.2, gain: 0.42 + 0.28 * p });
  k.noise(out, t + 0.05, { type: "highpass", f0: 5000, attack: 0.03, dur: 0.14, gain: 0.09 + 0.06 * p });
  k.tone(out, t, { f0: 260 * r, f1: 880 * r, glide: 0.12, dur: 0.13, gain: 0.09 + 0.06 * p });
  k.tone(out, t, { f0: 130, f1: 70, dur: 0.1, gain: 0.05 + 0.25 * p });
  return 0.3;
}

function sfxStep({ k, t, out, r }) {
  k.noise(out, t, { type: "lowpass", f0: jit(1100, 0.3) * r, attack: 0.001, dur: rand(0.025, 0.04), gain: 0.11 });
  k.tone(out, t, { f0: jit(150, 0.15) * r, f1: 85, dur: 0.04, gain: 0.1 });
  // 가끔 잉크를 밟는 "찍"
  if (Math.random() < 0.35) k.noise(out, t + 0.012, { type: "bandpass", f0: jit(2400, 0.3), q: 3, dur: 0.03, gain: 0.05 });
  return 0.08;
}

function sfxFall({ k, t, out, r }) {
  // 떨어지는 휘파람: 음이 길게 내려가고 떨림이 점점 커진다
  const dur = 0.95;
  const f = jit(1650, 0.05) * r;
  k.tone(out, t, { type: "triangle", f0: f, f1: 240 * r, glide: dur, attack: 0.03, hold: dur * 0.55, dur: dur * 0.45, gain: 0.2, vib: { rate: 9, depth: 14, depth1: 60 } });
  k.tone(out, t, { f0: f * 1.5, f1: 360 * r, glide: dur, attack: 0.03, hold: dur * 0.4, dur: dur * 0.4, gain: 0.05 });
  k.noise(out, t, { type: "bandpass", f0: 2400, f1: 500, q: 1.5, attack: 0.1, hold: dur * 0.4, dur: dur * 0.5, gain: 0.07 });
  return dur + 0.1;
}

function sfxKo({ k, t, out, r, duck }) {
  // 누군가 빠졌다: 멀리서 풍덩 + 물기둥 방울 + 내려가는 세 음(아케이드 KO 표식)
  k.tone(k.drive(out), t, { f0: 96, f1: 30, glide: 0.3, dur: 0.6, gain: 0.7 });
  k.noise(out, t, { color: "pink", type: "lowpass", f0: 2600, f1: 180, sweep: 0.4, q: 2, attack: 0.004, dur: 0.6, gain: 0.5 });
  for (let i = 0; i < 5; i++) {
    const f = (500 + Math.random() * 500) * r;
    k.tone(out, t + 0.06 + i * 0.045 + Math.random() * 0.02, { f0: f, f1: f * 1.8, glide: 0.04, dur: 0.07, gain: 0.08 });
  }
  [0, -4, -9].forEach((n, i) => {
    k.tone(out, t + 0.02 + i * 0.07, { type: "square", f0: 880 * r * semi(n), dur: 0.11, gain: 0.1, lp: 2600 });
  });
  duck(0.3, 0.25);
  return 0.9;
}

function sfxKoSelf({ k, t, out, duck }) {
  // 내가 빠졌다: 길게 가라앉는 저음, 닫혀 가는 톱니파, 물속으로 잠기는 방울
  k.tone(k.drive(out, true), t, { f0: 140, f1: 26, glide: 0.7, dur: 1.2, gain: 0.85, attack: 0.004 });
  k.tone(out, t, { type: "sawtooth", f0: 440, f1: 48, glide: 0.9, dur: 1.0, gain: 0.2, lp: 3000, lp1: 200, detune: -14 });
  k.tone(out, t, { type: "sawtooth", f0: 446, f1: 50, glide: 0.9, dur: 1.0, gain: 0.2, lp: 3000, lp1: 200, detune: 14 });
  k.noise(out, t, { color: "pink", type: "lowpass", f0: 5000, f1: 150, sweep: 0.8, q: 1.5, attack: 0.004, dur: 1.2, gain: 0.6 });
  k.noise(out, t, { type: "highpass", f0: 3000, attack: 0.001, dur: 0.08, gain: 0.4 });
  for (let i = 0; i < 6; i++) {
    const f = 700 - i * 70;
    k.tone(out, t + 0.25 + i * 0.11 + Math.random() * 0.03, { f0: f, f1: f * 1.6, glide: 0.05, dur: 0.08, gain: 0.06 });
  }
  duck(0.75, 0.9);
  return 1.6;
}

function sfxScore({ k, t, out, p, r, duck }) {
  // 내가 득점: 밝게 올라가는 네 음 + 종. 연속 득점(p)일수록 온음씩 높아진다
  const base = 659.25 * r * semi(2 * Math.round(p * 3));
  [0, 4, 7, 12].forEach((n, i) => {
    k.pluck(out, t + i * 0.055, base * semi(n), { dur: 0.22 + (i === 3 ? 0.3 : 0), gain: 0.22 });
  });
  k.bell(out, t + 0.165, base * 2, { dur: 0.7, gain: 0.13 });
  k.noise(out, t, { type: "highpass", f0: 7000, attack: 0.002, dur: 0.25, gain: 0.07 });
  k.tone(out, t, { f0: 180, f1: 80, dur: 0.12, gain: 0.3 });
  duck(0.2, 0.3);
  return 1.0;
}

function sfxSpawn({ k, t, out, p, r }) {
  // 부활: 빨려 올라오는 상승음 뒤에 "뿅"
  k.noise(out, t, { type: "bandpass", f0: 400 * r, f1: 4200 * r, q: 3, attack: 0.08, hold: 0.1, dur: 0.14, gain: 0.2 + 0.1 * p });
  k.tone(out, t, { f0: 280 * r, f1: 1120 * r, glide: 0.26, attack: 0.05, hold: 0.14, dur: 0.12, gain: 0.13 + 0.06 * p });
  k.tone(out, t, { type: "triangle", f0: 420 * r, f1: 1680 * r, glide: 0.26, attack: 0.05, hold: 0.14, dur: 0.1, gain: 0.07 });
  k.pluck(out, t + 0.27, 1320 * r, { dur: 0.3, gain: 0.18 });
  k.tone(out, t + 0.27, { f0: 200, f1: 90, dur: 0.12, gain: 0.05 + 0.2 * p });
  return 0.65;
}

function sfxAmmo({ k, t, out, r }) {
  // 한 발 장전: 고무가 부풀어 차는 "뽁"
  k.tone(out, t, { f0: jit(390, 0.03) * r, f1: 640 * r, glide: 0.05, dur: 0.08, gain: 0.2 });
  k.tone(out, t + 0.005, { type: "triangle", f0: 780 * r, f1: 1280 * r, glide: 0.05, dur: 0.06, gain: 0.07 });
  k.noise(out, t, { type: "bandpass", f0: 3200, q: 2, attack: 0.001, dur: 0.02, gain: 0.1 });
  return 0.14;
}

function sfxEmpty({ k, t, out, r }) {
  // 탄약 없음: 마른 "틱-턱"
  for (let i = 0; i < 2; i++) {
    k.tone(out, t + i * 0.075, { type: "square", f0: (150 - i * 30) * r, dur: 0.045, gain: 0.16, lp: 900 });
    k.noise(out, t + i * 0.075, { type: "bandpass", f0: 1500, q: 2, attack: 0.001, dur: 0.02, gain: 0.14 });
  }
  return 0.2;
}

function sfxCount({ k, t, out, r }) {
  // 3 · 2 · 1: 짧고 단단한 신호음(pitch 로 한 음씩 올려 부른다)
  const f = 440 * r;
  k.tone(out, t, { type: "square", f0: f, dur: 0.2, gain: 0.16, lp: f * 5, lp1: f * 1.5 });
  k.tone(out, t, { f0: f * 2, dur: 0.14, gain: 0.1 });
  k.tone(out, t, { f0: f / 2, dur: 0.22, gain: 0.2 });
  k.tone(out, t, { f0: 150, f1: 60, dur: 0.12, gain: 0.5 });
  k.noise(out, t, { type: "highpass", f0: 4000, attack: 0.001, dur: 0.02, gain: 0.15 });
  return 0.35;
}

function sfxGo({ k, t, out, r, duck }) {
  // GO!: 한 옥타브 위 화음 + 킥 + 크래시
  const f = 880 * r;
  [1, 1.5, 2].forEach((m, i) => {
    k.tone(out, t, { type: "sawtooth", f0: (f * m) / 2, dur: 0.55, gain: 0.1, lp: 5000, lp1: 900, detune: (i - 1) * 9 });
    k.tone(out, t, { type: "square", f0: f * m, dur: 0.45, gain: 0.05, lp: 6000 });
  });
  k.tone(k.drive(out), t, { f0: 170, f1: 44, glide: 0.12, dur: 0.4, gain: 0.8 });
  k.noise(out, t, { type: "highpass", f0: 5000, f1: 2500, attack: 0.002, dur: 0.6, gain: 0.22 });
  k.noise(out, t, { type: "bandpass", f0: 1200, f1: 6000, q: 1, sweep: 0.25, attack: 0.01, dur: 0.3, gain: 0.15 });
  duck(0.35, 0.3);
  return 0.9;
}

function sfxRoundEnd({ k, t, out, duck }) {
  // 종료 경적: 짧게 한 번, 길게 한 번. 끝에서 음이 처진다
  const blast = (at, hold) => {
    for (const f of [196, 246.94, 293.66]) {
      for (const cents of [-9, 9]) {
        k.tone(out, at, { type: "sawtooth", f0: f, f1: f * 0.95, glide: hold + 0.35, attack: 0.015, hold, dur: 0.3, gain: 0.065, detune: cents, lp: 3400, lp1: 1100 });
      }
    }
  };
  blast(t, 0.1);
  blast(t + 0.28, 0.55);
  k.tone(k.drive(out), t, { f0: 130, f1: 40, glide: 0.2, dur: 0.5, gain: 0.6 });
  k.noise(out, t, { type: "highpass", f0: 4000, attack: 0.002, dur: 0.5, gain: 0.12 });
  duck(0.6, 1.0);
  return 1.5;
}

function sfxWin({ k, t, out, duck }) {
  // 승리: 올라가는 장3화음 뒤에 길게 울리는 화음
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => k.pluck(out, t + i * 0.11, f, { dur: 0.3, gain: 0.15, type: "square", bright: 1.2 }));
  const tc = t + 0.5;
  [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
    k.tone(out, tc, { type: "sawtooth", f0: f, attack: 0.01, hold: 0.5, dur: 0.9, gain: 0.05, lp: 4500, lp1: 1500, detune: i % 2 ? 7 : -7 });
    k.bell(out, tc + i * 0.03, f * 2, { dur: 1.0, gain: 0.03 });
  });
  k.tone(k.drive(out), tc, { f0: 130.8, f1: 65.4, glide: 0.1, dur: 0.9, gain: 0.5 });
  k.noise(out, tc, { type: "highpass", f0: 6000, attack: 0.003, dur: 1.2, gain: 0.12 });
  duck(0.6, 1.6);
  return 2.3;
}

function sfxLose({ k, t, out, duck }) {
  // 패배: 처지며 내려가는 네 음, 마지막은 길게 늘어진다
  [392, 369.99, 311.13, 261.63].forEach((f, i) => {
    const last = i === 3;
    const at = t + i * 0.26;
    k.tone(out, at, {
      type: "sawtooth", f0: f, f1: f * (last ? 0.89 : 0.97), glide: last ? 0.8 : 0.24, attack: 0.02,
      hold: last ? 0.45 : 0.14, dur: last ? 0.5 : 0.1, gain: 0.2, lp: 1800, lp1: last ? 400 : 1200,
      vib: last ? { rate: 5.5, depth: 6 } : undefined,
    });
    k.tone(out, at, { type: "triangle", f0: f / 2, f1: (f / 2) * (last ? 0.89 : 0.97), glide: last ? 0.8 : 0.24, attack: 0.02, hold: last ? 0.45 : 0.14, dur: last ? 0.5 : 0.1, gain: 0.18 });
  });
  duck(0.5, 1.4);
  return 2.0;
}

function sfxJoin({ k, t, out, r }) {
  k.pluck(out, t, 660 * r, { dur: 0.14, gain: 0.12 });
  k.pluck(out, t + 0.09, 990 * r, { dur: 0.2, gain: 0.12 });
  return 0.35;
}

function sfxLeave({ k, t, out, r }) {
  k.pluck(out, t, 660 * r, { dur: 0.14, gain: 0.12 });
  k.pluck(out, t + 0.09, 440 * r, { dur: 0.2, gain: 0.12 });
  return 0.35;
}

function sfxUi({ k, t, out, r }) {
  k.tone(out, t, { type: "triangle", f0: 1250 * r, f1: 900 * r, dur: 0.05, gain: 0.08 });
  k.noise(out, t, { type: "highpass", f0: 5000, attack: 0.001, dur: 0.012, gain: 0.08 });
  k.tone(out, t, { f0: 220 * r, f1: 120, dur: 0.05, gain: 0.07 });
  return 0.08;
}

function sfxUiHover({ k, t, out, r }) {
  k.tone(out, t, { f0: jit(2100, 0.04) * r, dur: 0.025, gain: 0.04 });
  return 0.04;
}

function sfxNuke({ k, t, out, p, r, duck, muffle }) {
  // 메가 잉크 폭탄의 핵폭발(사이렌 없음): 찢어지는 섬광음 → 배를 치는 거대한 저음 → 불티가 튀는 지지직 → 몇 초를 끄는 땅울림
  const big = 0.6 + 0.4 * p;
  // (1) 섬광의 날: 공기가 한꺼번에 찢어지는 소리
  k.noise(out, t, { type: "highpass", f0: 1800, f1: 600, sweep: 0.12, q: 0.6, attack: 0.001, dur: 0.16, gain: 0.85 * big });
  k.noise(out, t, { type: "bandpass", f0: jit(900, 0.08) * r, q: 0.8, attack: 0.001, dur: 0.22, gain: 0.7 * big });
  k.tone(out, t, { type: "square", f0: 160 * r, f1: 38, glide: 0.18, dur: 0.2, gain: 0.3 * big, lp: 1800, lp1: 200 });
  // (2) 몸통: 두 겹의 사인 저음이 깊이 떨어지고 포화기로 배음을 붙인다(작은 스피커에서도 "쿵")
  const body = k.drive(out, true);
  k.tone(body, t, { f0: 92 * r, f1: 24, glide: 1.4, attack: 0.004, hold: 0.12, dur: 1.9, gain: 1.0 * big });
  k.tone(body, t + 0.02, { f0: 58, f1: 21, glide: 2.4, attack: 0.02, hold: 0.3, dur: 2.6, gain: 0.6 * big });
  k.tone(out, t, { type: "sawtooth", f0: 140 * r, f1: 34, glide: 1.1, attack: 0.004, dur: 1.4, gain: 0.32 * big, lp: 2200, lp1: 120 });
  // (3) 충격파가 지나가는 "휘익" — 위에서 아래로 쓸린다
  k.noise(out, t + 0.04, { color: "pink", type: "bandpass", f0: 3200, f1: 260, sweep: 0.7, q: 1.2, attack: 0.03, dur: 0.85, gain: 0.55 * big });
  // (4) 불티 · 잉크 파편이 튀는 지지직(처음엔 촘촘히, 점점 드문드문)
  for (let i = 0; i < 34; i++) {
    const at = t + 0.08 + Math.pow(Math.random(), 1.8) * 2.6;
    const near = 1 - (at - t) / 2.8;
    k.noise(out, at, { type: "highpass", f0: rand(1800, 5200), attack: 0.001, dur: rand(0.008, 0.03), gain: rand(0.08, 0.26) * near * big });
    if (i % 3 === 0) k.noise(out, at, { type: "bandpass", f0: rand(500, 1400), q: 3, attack: 0.001, dur: rand(0.02, 0.06), gain: rand(0.08, 0.2) * near * big });
  }
  // (5) 땅울림: 길게 끄는 저역 잡음 두 겹(하나는 천천히 닫히고, 하나는 더 깊이 남는다)
  k.noise(out, t + 0.03, { color: "pink", type: "lowpass", f0: 900, f1: 70, sweep: 3.2, q: 1.4, attack: 0.06, hold: 0.4, dur: 3.4, gain: 0.95 * big });
  k.noise(out, t + 0.1, { color: "pink", type: "lowpass", f0: 180, f1: 45, sweep: 4, q: 2.2, attack: 0.3, hold: 0.8, dur: 3.4, gain: 0.8 * big });
  k.tone(out, t + 0.25, { f0: 41, f1: 28, glide: 3, attack: 0.4, hold: 0.6, dur: 2.8, gain: 0.35 * big, vib: { rate: 5.5, depth: 3 } });
  // (6) 귀울림: 높고 가는 사인이 오래 남는다(가까울수록)
  k.tone(out, t + 0.06, { f0: jit(3600, 0.04), attack: 0.05, hold: 0.4, dur: 2.2, gain: 0.03 + 0.03 * p });
  duck(0.9, 2.6);
  muffle(0.7 * p, 2.4, 0.2);
  return 4.6;
}

function sfxBombFall({ k, t, out, p, r }) {
  // 폭탄이 떨어지는 휘파람: 높은 음이 길게 내려오며 떨림이 커지고, 밑에서 불길한 저음이 차오른다. 심지가 타는 지글거림이 함께
  const dur = 1.05;
  const f = jit(2300, 0.03) * r;
  k.tone(out, t, { f0: f, f1: 420 * r, glide: dur, attack: 0.08, hold: dur * 0.6, dur: dur * 0.4, gain: 0.2 + 0.1 * p, vib: { rate: 7, depth: 10, depth1: 70 } });
  k.tone(out, t, { type: "triangle", f0: f * 1.5, f1: 640 * r, glide: dur, attack: 0.08, hold: dur * 0.5, dur: dur * 0.4, gain: 0.06 + 0.04 * p });
  k.noise(out, t, { type: "bandpass", f0: 3000, f1: 700, q: 2, attack: 0.1, hold: dur * 0.5, dur: dur * 0.45, gain: 0.08 + 0.05 * p });
  // 차오르는 저음(땅이 먼저 떤다)
  k.tone(k.drive(out), t + 0.15, { f0: 48, f1: 62, glide: dur, attack: dur * 0.8, dur: 0.25, gain: 0.25 + 0.25 * p });
  // 심지: 지글거리는 고역 잡음이 빠르게 끊긴다
  for (let i = 0; i < 9; i++) {
    k.noise(out, t + i * 0.11 + Math.random() * 0.04, { type: "highpass", f0: rand(4500, 7500), attack: 0.002, dur: rand(0.03, 0.07), gain: 0.05 + 0.04 * p });
  }
  return dur + 0.3;
}

function sfxFuse({ k, t, out, p, r, duck }) {
  // 합성: 네 재료가 차례로 "띵 · 띵 · 띵 · 띵" 올라가며 모이고(소용돌이 휘익), 하나가 되는 순간 반짝이는 화음과 묵직한 한 방
  const base = 523.25 * r;
  [0, 4, 7, 11].forEach((n, i) => {
    const at = t + i * 0.12;
    k.pluck(out, at, base * semi(n), { dur: 0.2, gain: 0.15 + 0.03 * p, type: "square", bright: 1.3 });
    k.tone(out, at, { f0: base * semi(n) * 2, dur: 0.12, gain: 0.04 });
  });
  // 빨려 드는 소용돌이
  k.noise(out, t, { type: "bandpass", f0: 500 * r, f1: 5200 * r, sweep: 0.58, q: 3, attack: 0.25, hold: 0.2, dur: 0.16, gain: 0.25 + 0.1 * p });
  k.tone(out, t, { type: "sawtooth", f0: 200 * r, f1: 1600 * r, glide: 0.58, attack: 0.3, hold: 0.25, dur: 0.06, gain: 0.05 + 0.03 * p, lp: 1200, lp1: 6000 });
  // 합쳐지는 순간(약 0.6초): 장7 화음 + 종 + 저음 한 방 + 반짝임
  const tc = t + 0.6;
  [0, 4, 7, 11, 14].forEach((n, i) => {
    k.tone(out, tc, { type: "sawtooth", f0: base * semi(n), attack: 0.005, hold: 0.15, dur: 0.7, gain: 0.05, lp: 5200, lp1: 1400, detune: i % 2 ? 8 : -8 });
  });
  k.bell(out, tc, base * 4, { dur: 1.0, gain: 0.08 });
  k.tone(k.drive(out), tc, { f0: 150, f1: 42, glide: 0.18, dur: 0.45, gain: 0.7 * (0.6 + 0.4 * p) });
  k.noise(out, tc, { type: "highpass", f0: 6500, attack: 0.002, dur: 0.6, gain: 0.12 });
  for (let i = 0; i < 6; i++) k.tone(out, tc + 0.05 + i * 0.06, { f0: base * 4 * semi(pick(PENTA)), dur: 0.08, gain: 0.04 });
  duck(0.45, 0.6);
  return 1.6;
}

function sfxBoost({ k, t, out, p, r }) {
  // 부스터: 빠르게 튀어 오르는 아르페지오 + 위로 쓸리는 "지잉" + 전기가 지직거리는 버즈
  [0, 5, 9, 12, 17].forEach((n, i) => {
    k.tone(out, t + i * 0.035, { type: "square", f0: 660 * r * semi(n), dur: 0.07, gain: 0.12 + 0.06 * p, lp: 4200 });
  });
  k.noise(out, t, { type: "bandpass", f0: 900 * r, f1: 7000 * r, sweep: 0.2, q: 2.5, attack: 0.01, dur: 0.26, gain: 0.38 + 0.18 * p });
  k.tone(out, t, { type: "sawtooth", f0: 220 * r, f1: 880 * r, glide: 0.2, attack: 0.005, hold: 0.05, dur: 0.2, gain: 0.11 + 0.07 * p, lp: 2600, vib: { rate: 46, depth: 40 } });
  k.tone(out, t + 0.18, { type: "triangle", f0: 1760 * r, f1: 2640 * r, glide: 0.08, dur: 0.18, gain: 0.12 });
  k.tone(k.drive(out), t, { f0: 120, f1: 220, dur: 0.12, gain: 0.14 + 0.24 * p });
  return 0.5;
}

function sfxShield({ k, t, out, p, r }) {
  // 보호막: 둥글게 부풀어 오르는 "우웅" 위로 맑은 종소리 화음이 반짝인다
  k.tone(out, t, { type: "sine", f0: 180 * r, f1: 420 * r, glide: 0.22, attack: 0.03, hold: 0.08, dur: 0.3, gain: 0.16 + 0.1 * p, vib: { rate: 7, depth: 12 } });
  k.noise(out, t, { type: "bandpass", f0: 1800 * r, f1: 5200 * r, sweep: 0.25, q: 4, attack: 0.04, dur: 0.3, gain: 0.12 + 0.08 * p });
  [0, 4, 7, 12].forEach((n, i) => k.bell(out, t + 0.06 + i * 0.045, 1046.5 * r * semi(n), { dur: 0.6, gain: 0.05 + 0.03 * p }));
  return 0.7;
}

function sfxDeflect({ k, t, out, p, r }) {
  // 보호막이 잉크를 튕겨 냈다: 쇠붙이처럼 짧고 높은 "팅" + 고무가 튀는 "뽀잉"
  k.bell(out, t, jit(2093, 0.04) * r, { dur: 0.35, gain: 0.1 + 0.08 * p });
  k.pluck(out, t, 1568 * r, { dur: 0.16, gain: 0.12 + 0.08 * p });
  k.tone(out, t + 0.01, { type: "triangle", f0: 520 * r, f1: 1300 * r, glide: 0.09, dur: 0.1, gain: 0.08 + 0.06 * p });
  k.noise(out, t, { type: "highpass", f0: 5000, attack: 0.001, dur: 0.04, gain: 0.1 + 0.06 * p });
  return 0.4;
}

// 충전이 꽉 찼다는 신호(setCharge 가 안에서 부른다. play 이름은 아니다)
function sfxChargeFull({ k, t, out }) {
  k.pluck(out, t, 1318.5, { dur: 0.12, gain: 0.14 });
  k.pluck(out, t + 0.05, 1760, { dur: 0.22, gain: 0.16 });
  k.bell(out, t + 0.05, 2637, { dur: 0.4, gain: 0.05 });
  k.noise(out, t, { type: "highpass", f0: 6000, attack: 0.001, dur: 0.05, gain: 0.08 });
  return 0.4;
}

// max = 같은 이름의 동시 발음 한도, gap = 같은 이름 사이 최소 간격(초 — 이보다 붙으면 살짝 밀어 겹침을 푼다),
// prio = 발음 수가 찼을 때 살아남는 순위, flat = 위치 없이 가운데에서, steady = 음높이를 흔들지 않는다, send = 리버브 양,
// reach = 들리는 거리 배율(기본 1 — 핵폭발처럼 경기장 끝까지 울려야 하는 소리는 크게).
export const SOUNDS = {
  throw: { fn: sfxThrow, max: 5, gap: 0.03, prio: 2 },
  throwBig: { fn: sfxThrowBig, max: 4, gap: 0.03, prio: 2 },
  burst: { fn: sfxBurst, max: 6, gap: 0.022, prio: 4, send: 0.2 },
  hit: { fn: sfxHit, max: 5, gap: 0.022, prio: 4, send: 0.16 },
  hitSelf: { fn: sfxHitSelf, max: 2, gap: 0.05, prio: 6, flat: true, send: 0.2 },
  bump: { fn: sfxBump, max: 3, gap: 0.04, prio: 3 },
  dash: { fn: sfxDash, max: 4, gap: 0.04, prio: 2 },
  step: { fn: sfxStep, max: 4, gap: 0.05, prio: 0, send: 0.05 },
  fall: { fn: sfxFall, max: 3, gap: 0.1, prio: 3, send: 0.3 },
  ko: { fn: sfxKo, max: 3, gap: 0.08, prio: 5, send: 0.3 },
  koSelf: { fn: sfxKoSelf, max: 1, gap: 0.3, prio: 7, flat: true, send: 0.35 },
  score: { fn: sfxScore, max: 2, gap: 0.1, prio: 6, flat: true, steady: true, send: 0.25 },
  spawn: { fn: sfxSpawn, max: 4, gap: 0.05, prio: 2, send: 0.2 },
  ammo: { fn: sfxAmmo, max: 2, gap: 0.05, prio: 1, flat: true, send: 0.06 },
  empty: { fn: sfxEmpty, max: 2, gap: 0.08, prio: 1, flat: true, send: 0.04 },
  count: { fn: sfxCount, max: 2, gap: 0.1, prio: 6, flat: true, steady: true, send: 0.2 },
  go: { fn: sfxGo, max: 1, gap: 0.3, prio: 7, flat: true, steady: true, send: 0.3 },
  roundEnd: { fn: sfxRoundEnd, max: 1, gap: 0.5, prio: 7, flat: true, steady: true, send: 0.3 },
  win: { fn: sfxWin, max: 1, gap: 0.5, prio: 7, flat: true, steady: true, send: 0.35 },
  lose: { fn: sfxLose, max: 1, gap: 0.5, prio: 7, flat: true, steady: true, send: 0.3 },
  join: { fn: sfxJoin, max: 2, gap: 0.08, prio: 1, flat: true },
  leave: { fn: sfxLeave, max: 2, gap: 0.08, prio: 1, flat: true },
  nuke: { fn: sfxNuke, max: 2, gap: 0.12, prio: 8, send: 0.35, reach: 3.2 },
  bombFall: { fn: sfxBombFall, max: 2, gap: 0.08, prio: 5, send: 0.25, reach: 1.8 },
  fuse: { fn: sfxFuse, max: 2, gap: 0.1, prio: 6, send: 0.3, reach: 1.4 },
  boost: { fn: sfxBoost, max: 2, gap: 0.06, prio: 4, send: 0.15 },
  shield: { fn: sfxShield, max: 2, gap: 0.06, prio: 4, send: 0.2 },
  deflect: { fn: sfxDeflect, max: 4, gap: 0.03, prio: 4, send: 0.15 },
  ui: { fn: sfxUi, max: 3, gap: 0.03, prio: 1, flat: true, send: 0.04 },
  uiHover: { fn: sfxUiHover, max: 2, gap: 0.03, prio: 0, flat: true, send: 0.02 },
};

export const INTERNAL = {
  chargeFull: { fn: sfxChargeFull, max: 1, gap: 0.1, prio: 5, flat: true, steady: true, send: 0.15 },
};
