// [왕국전] 잉크 브로울스 src/audio/music.js 를 가져왔다. 바꾼 곳은 [왕국전] 표시(final 경보음을 드문드문 — 왕국전의 final 은 마지막 2분이라 길다).
// 생성형 일렉트로 루프. 16분음 단위의 룩어헤드 스케줄러가 조금 앞의 음들을 오디오 시계에 미리 예약한다
// (setInterval 은 깨우는 구실만 한다 — 박자는 AudioContext.currentTime 이 정한다).
// 상태(menu · play · final · results)마다 빠르기 · 코드 진행 · 패턴이 다르고, 강도(0..1)가 오르면 층이 더해진다:
//   0.00 킥 + 베이스 + 패드 → 0.2 클랩 · 8분 하이햇 → 0.35 아르페지오 → 0.5 16분 하이햇 · 오픈 햇 · 필 → 0.75 리드 스탭

import { clamp, midiHz } from "./util.js";

// 가단조. bass = 베이스 음(MIDI), tones = 아르페지오 · 패드 음.
const Am7 = { bass: 45, tones: [57, 60, 64, 67] };
const Fmaj7 = { bass: 41, tones: [53, 57, 60, 64] };
const Cadd9 = { bass: 48, tones: [55, 60, 62, 64] };
const Cmaj7 = { bass: 48, tones: [55, 59, 60, 64] };
const G6 = { bass: 43, tones: [55, 59, 62, 64] };
const Dm7 = { bass: 50, tones: [57, 60, 62, 65] };
const E7 = { bass: 40, tones: [56, 59, 62, 64] };
const Em7 = { bass: 40, tones: [55, 59, 62, 64] };

const STATES = {
  menu: { bpm: 110, swing: 0.1, prog: [Am7, Fmaj7, Cmaj7, Em7], pump: 0.25 },
  play: { bpm: 118, swing: 0.06, prog: [Am7, Fmaj7, Cadd9, G6], pump: 0.55 },
  final: { bpm: 124, swing: 0.03, prog: [Am7, Fmaj7, Dm7, E7], pump: 0.6 }, // 딸림화음(E7)으로 조여 온다
  results: { bpm: 110, swing: 0.1, prog: [Cadd9, G6, Am7, Fmaj7], pump: 0.3 },
};

// 베이스 패턴(16분음 16칸): 0 쉼 · 1 근음 · 2 옥타브 위 · 3 5도
const BASS = [
  [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 2],
  [0, 0, 1, 1, 0, 0, 1, 2, 0, 0, 1, 1, 0, 3, 1, 2],
  [0, 1, 1, 2, 0, 1, 1, 2, 0, 1, 3, 2, 0, 1, 2, 1],
];
// 아르페지오 패턴: 코드 음을 옥타브로 이어 붙인 사다리의 칸 번호(-1 은 쉼)
const ARP = [
  [0, -1, -1, 2, -1, -1, 4, -1, 5, -1, -1, 4, -1, -1, 2, -1], // 3-3-2 리듬
  [0, 2, 4, 2, 5, 4, 2, 4, 0, 2, 4, 2, 6, 5, 4, 2],
  [0, 4, 2, 5, 4, 7, 5, 4, 2, 5, 4, 7, 5, 4, 2, 1],
];
const STAB_STEPS = [0, 3, 6, 10, 13];

/** 강도 I 가 from 을 넘어 width 만큼 올라가는 동안 0→1 로 켜지는 층 음량. */
const layer = (I, from, width) => clamp((I - from) / width, 0, 1);

export function createMusic() {
  let ctx = null;
  let n = null; // 버스 노드들
  let noiseBuf = null;
  let wantRun = false;
  let running = false;
  let timer = 0;
  let state = "menu";
  let pending = null;
  let target = 0;
  let intensity = 0;
  let step = 0;
  let bar = 0;
  let nextTime = 0;
  let accent = false; // 상태가 바뀐 첫 박에 크래시를 얹는다

  function attach(env) {
    ctx = env.ctx;
    noiseBuf = env.noise;
    const fade = ctx.createGain();
    fade.gain.value = 0;
    fade.connect(env.out);
    const drums = ctx.createGain();
    drums.gain.value = 1;
    drums.connect(fade);
    // 킥이 칠 때마다 눌렸다 돌아오는 버스(사이드체인 펌핑) → 상태 · 강도에 따라 열리는 저역 필터
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3200;
    tone.Q.value = 0.6;
    tone.connect(fade);
    const pump = ctx.createGain();
    pump.connect(tone);
    // 아르페지오용 되울림 딜레이(점8분음)
    const delay = ctx.createDelay(1);
    const fb = ctx.createGain();
    fb.gain.value = 0.36;
    const dlp = ctx.createBiquadFilter();
    dlp.type = "lowpass";
    dlp.frequency.value = 2600;
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    delay.connect(dlp);
    dlp.connect(fb);
    fb.connect(delay);
    dlp.connect(wet);
    wet.connect(pump);
    const rev = ctx.createGain();
    rev.gain.value = 1;
    if (env.rev) rev.connect(env.rev);
    n = { fade, drums, pump, tone, delay, rev };
    if (wantRun) begin();
  }

  // ---------------------------------------------------------------- 악기

  function noiseHit(dest, t, type, freq, q, peak, decay) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * Math.max(0, noiseBuf.duration - 0.05));
    src.stop(t + decay + 0.02);
    return g;
  }

  function kick(t, vel, pumpDepth, beat) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g);
    g.connect(n.drums);
    o.start(t);
    o.stop(t + 0.36);
    noiseHit(n.drums, t, "highpass", 3000, 0.7, vel * 0.22, 0.014);
    if (pumpDepth > 0) {
      n.pump.gain.setValueAtTime(1 - pumpDepth * vel, t);
      n.pump.gain.linearRampToValueAtTime(1, t + beat * 0.6);
    }
  }

  function hat(t, vel, open) {
    noiseHit(n.drums, t, "highpass", open ? 7000 : 8500, 0.8, vel, open ? 0.2 : 0.04);
  }

  function clap(t, vel) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1400;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    // 손뼉 여러 개가 살짝 어긋나 치는 것처럼 세 번 끊어 친 뒤 꼬리를 남긴다
    for (let i = 0; i < 3; i++) {
      g.gain.setValueAtTime(vel, t + i * 0.011);
      g.gain.exponentialRampToValueAtTime(vel * 0.2, t + i * 0.011 + 0.009);
    }
    g.gain.setValueAtTime(vel, t + 0.033);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    src.connect(f);
    f.connect(g);
    g.connect(n.drums);
    g.connect(n.rev);
    src.start(t, Math.random() * Math.max(0, noiseBuf.duration - 0.05));
    src.stop(t + 0.22);
  }

  function snare(t, vel) {
    noiseHit(n.drums, t, "bandpass", 2400, 0.8, vel, 0.09);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.06);
    g.gain.setValueAtTime(vel * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g);
    g.connect(n.drums);
    o.start(t);
    o.stop(t + 0.1);
  }

  function crash(t, vel) {
    const g = noiseHit(n.drums, t, "highpass", 5200, 0.5, vel, 1.3);
    g.connect(n.rev);
  }

  function riser(t, dur, vel) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.6;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel), t + dur * 0.96);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(n.drums);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function bass(t, midi, dur, vel, bright) {
    const f = midiHz(midi);
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = "sawtooth";
    o2.type = "square";
    o1.frequency.value = f;
    o2.frequency.value = f;
    o2.detune.value = 9;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(f * (3 + 9 * bright), t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.004);
    g.gain.setValueAtTime(vel, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(n.pump);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.02);
    o2.stop(t + dur + 0.02);
  }

  function arp(t, midi, vel, cutoff) {
    const f = midiHz(midi);
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = "square";
    o2.type = "triangle";
    o1.frequency.value = f;
    o1.detune.value = (Math.random() - 0.5) * 10;
    o2.frequency.value = f * 2;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 2.5;
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, cutoff * 0.3), t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    o1.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(n.pump);
    g.connect(n.delay);
    g.connect(n.rev);
    o1.start(t);
    o2.start(t);
    o1.stop(t + 0.22);
    o2.stop(t + 0.22);
  }

  function pad(t, chord, dur, vel, cutoff) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.8;
    lp.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + dur * 0.3);
    g.gain.setValueAtTime(vel, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.08);
    lp.connect(g);
    g.connect(n.pump);
    g.connect(n.rev);
    // 근음은 한 옥타브 아래에 깔고 3음 · 7음을 위에 얹는다. 음마다 살짝 어긋난 톱니파 두 개
    for (const m of [chord.tones[0] - 12, chord.tones[1], chord.tones[3]]) {
      for (const cents of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = midiHz(m);
        o.detune.value = cents;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur * 1.08 + 0.02);
      }
    }
  }

  function stab(t, chord, vel) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    lp.connect(g);
    g.connect(n.pump);
    g.connect(n.delay);
    for (const m of chord.tones) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = midiHz(m + 12);
      o.detune.value = (Math.random() - 0.5) * 16;
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.24);
    }
  }

  function ping(t, midi, vel) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = midiHz(midi);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g);
    g.connect(n.pump);
    g.connect(n.delay);
    o.start(t);
    o.stop(t + 0.1);
  }

  // ---------------------------------------------------------------- 한 칸(16분음) 예약

  function scheduleStep(t0) {
    const S = STATES[state];
    const s16 = 60 / S.bpm / 4;
    const beat = s16 * 4;
    const t = t0 + (step % 2 === 1 ? s16 * S.swing : 0);
    const chord = S.prog[bar % S.prog.length];
    const phrase = bar % 4;
    const cycle = (bar >> 2) % 4;
    const ladder = (i) => chord.tones[i % 4] + 12 * ((i / 4) | 0);
    const on = (I, from, width) => layer(I, from, width);

    if (step === 0) {
      // 마디 머리: 필터 열림과 딜레이 시간을 상태에 맞춘다
      const I0 = state === "final" ? Math.max(intensity, 0.6) : intensity;
      const cut = state === "menu" ? 3200 : state === "results" ? 9000 : state === "final" ? 16000 : 2600 + I0 * 12000;
      n.tone.frequency.setTargetAtTime(cut, t, 0.3);
      n.delay.delayTime.setTargetAtTime(s16 * 3, t, 0.05);
    }
    if (accent && step === 0) {
      accent = false;
      crash(t, state === "menu" ? 0.1 : 0.22);
    }

    if (state === "menu") {
      // 느긋하게: 부드러운 킥, 오프비트 햇, 길게 끄는 베이스, 딜레이 먹은 아르페지오
      if (step === 0) pad(t, chord, beat * 4, 0.035, 900);
      if (step === 0 || step === 10) kick(t, 0.5, S.pump, beat);
      if (step % 4 === 2) hat(t, 0.15 + Math.random() * 0.04, false);
      if (step === 0) bass(t, chord.bass, s16 * 6, 0.22, 0.25);
      if (step === 10) bass(t, chord.bass + (phrase === 3 ? 7 : 0), s16 * 4, 0.18, 0.2);
      const a = ARP[0][step];
      if (a >= 0) arp(t, ladder(a + (cycle % 2 ? 1 : 0)), 0.085, 2200);
      return;
    }

    if (state === "results") {
      // 반박자 느낌: 킥은 1 · 3 박, 클랩은 3 박, 밝은 아르페지오
      if (step === 0) pad(t, chord, beat * 4, 0.035, 1400);
      if (step === 0 || step === 8) kick(t, 0.6, S.pump, beat);
      if (step === 8) clap(t, 0.3);
      if (step % 2 === 0) hat(t, step % 4 === 2 ? 0.2 : 0.1, false);
      if (step === 0 || step === 6 || step === 10) bass(t, chord.bass, s16 * 3, 0.24, 0.35);
      const a = ARP[1][step];
      if (step % 2 === 0 || cycle % 2 === 1) arp(t, ladder(a) + 12, 0.07, 3600);
      return;
    }

    // play · final
    const final = state === "final";
    const I = final ? Math.max(intensity, 0.6) : intensity;
    if (step === 0) pad(t, chord, beat * 4, 0.022 + 0.012 * I, 500 + 1100 * I);

    // 킥: 4분음 네 번. 뜨거워지면 마디 끝에 엇박 한 번
    if (step % 4 === 0) kick(t, 0.78 + 0.14 * I, S.pump, beat);
    else if (step === 14 && bar % 2 === 1 && I > 0.7) kick(t, 0.45, 0, beat);

    // 클랩
    const cl = on(I, 0.2, 0.15);
    if (cl > 0 && (step === 4 || step === 12)) clap(t, 0.42 * cl);

    // 하이햇: 오프비트 → 8분음 → 16분음
    if (step % 4 === 2) hat(t, 0.24 + 0.12 * I, I > 0.55);
    else if (step % 2 === 0) {
      const h = on(I, 0.15, 0.2);
      if (h > 0) hat(t, 0.12 * h, false);
    } else {
      const h = on(I, 0.5, 0.25);
      if (h > 0) hat(t, (0.07 + Math.random() * 0.07) * h, false);
    }

    // 베이스: 강도에 따라 패턴이 촘촘해진다
    const bp = BASS[I < 0.35 ? 0 : I < 0.7 ? 1 : 2];
    const b = bp[step];
    if (b) {
      const note = chord.bass + (b === 2 ? 12 : b === 3 ? 7 : 0);
      bass(t, note, s16 * (I < 0.35 ? 1.7 : 0.95), 0.3 - (b === 2 ? 0.06 : 0), 0.2 + 0.7 * I);
    }

    // 아르페지오
    const av = on(I, 0.35, 0.2);
    if (av > 0) {
      const pat = I < 0.6 ? ARP[0] : ARP[1 + (cycle % 2)];
      const a = pat[step];
      if (a >= 0) arp(t, ladder(a) + (final ? 12 : 0), 0.075 * av, 1600 + 4200 * I);
    }

    // 리드 스탭
    const sv = on(I, 0.75, 0.15);
    if (sv > 0 && STAB_STEPS.includes(step)) stab(t, chord, 0.05 * sv);

    // 마지막 30초: 8분음 경보음 + 네 마디마다 라이저
    if (final) {
      // [왕국전] 마지막 2분 · 목표 2점 앞은 길게 이어진다 — 경보음은 4분음(강도가 아주 높을 때만 8분음)으로 조금 작게
      if (step % (I > 0.85 ? 2 : 4) === 0) ping(t, 88, step % 8 === 0 ? 0.045 : 0.028);
      if (phrase === 3 && step === 0) riser(t, beat * 4, 0.16);
    }

    // 네 마디 끝의 스네어 필 → 다음 마디 머리에 크래시
    if (phrase === 3 && step >= 12 && I > 0.45) {
      snare(t, 0.16 + (step - 12) * 0.07);
      if (step === 15) accent = true;
    }
  }

  function advance() {
    const s16 = 60 / STATES[state].bpm / 4;
    nextTime += s16;
    step++;
    if (step >= 16) {
      step = 0;
      bar++;
    }
    if (step % 4 === 0) {
      intensity += (target - intensity) * 0.35;
      if (pending) {
        // 상태 전환은 다음 박 머리에서 마디를 새로 시작한다(반 초 안에 반응)
        state = pending;
        pending = null;
        step = 0;
        bar = 0;
        accent = true;
      }
    }
  }

  function tick() {
    if (!running || !ctx) return;
    const now = ctx.currentTime;
    if (nextTime < now - 0.1) nextTime = now + 0.05; // 타이머가 멈췄다 깨면 밀린 음을 몰아 치지 않고 이어 간다
    const hidden = typeof document !== "undefined" && document.hidden;
    const ahead = hidden ? 1.4 : 0.16; // 숨은 탭은 타이머가 1초에 한 번만 돈다
    while (nextTime < now + ahead) {
      scheduleStep(nextTime);
      advance();
    }
  }

  function begin() {
    if (running || !ctx) return;
    running = true;
    if (pending) {
      state = pending;
      pending = null;
    }
    step = 0;
    bar = 0;
    accent = false;
    intensity = target;
    const now = ctx.currentTime;
    nextTime = now + 0.08;
    n.fade.gain.cancelScheduledValues(now);
    n.fade.gain.setTargetAtTime(1, now, 0.15);
    timer = setInterval(tick, 25);
    tick();
  }

  function halt() {
    if (!running) return;
    running = false;
    clearInterval(timer);
    timer = 0;
    const now = ctx.currentTime;
    n.fade.gain.cancelScheduledValues(now);
    n.fade.gain.setTargetAtTime(0, now, 0.1);
  }

  return {
    attach,
    start() {
      wantRun = true;
      begin();
    },
    stop() {
      wantRun = false;
      halt();
    },
    setState(next) {
      if (!Object.hasOwn(STATES, next)) return;
      if (!running) {
        state = next;
        pending = null;
      } else if (next === state) pending = null;
      else pending = next;
    },
    setIntensity(v) {
      target = clamp(Number(v) || 0, 0, 1);
    },
    get state() {
      return pending || state;
    },
    get running() {
      return running;
    },
    /** 오프라인 렌더 · 시험용: 타이머 없이 seconds 초 분량을 한꺼번에 예약한다. */
    renderAhead(seconds) {
      if (!ctx) return;
      if (pending) {
        state = pending;
        pending = null;
      }
      step = 0;
      bar = 0;
      accent = false;
      intensity = target;
      nextTime = ctx.currentTime + 0.05;
      n.fade.gain.setValueAtTime(1, ctx.currentTime);
      const end = ctx.currentTime + seconds;
      while (nextTime < end) {
        scheduleStep(nextTime);
        advance();
      }
    },
  };
}
