// [왕국전] 잉크 브로울스 src/audio/index.js 를 가져왔다. 바꾼 곳은 [왕국전] 표시:
//   · 거리 · 좌우를 지도 칸으로 잰다(듣는 자리 = 화면 가운데, 확대 배율 scale). 너무 먼 소리는 아예 내지 않는다(CULL).
//   · 가벼운 모드(lite — 휴대폰 · 코어 4개 이하): 동시 발음 14 · 짧은 방 울림.
//   · 소리 끔(setMuted) · 음악을 켤지(음량 0 · 끔이면 스케줄러도 멈춘다) · 소리마다 낸 횟수(counts — ?debug 확인용).
//   · iOS: unlock 때 아주 짧은 무음 버퍼를 한 번 틀어 오디오 출력을 연다. 왕국전 소리(sfx-realms.js)를 합친다.
//   · 기본 음량을 낮게(교실에 기기가 많다).
//
// INK BRAWLS 사운드 엔진. Web Audio 로 전부 절차 합성한다(음원 파일 없음).
//
// 신호 흐름
//   효과음 목소리 ─ 거리 감쇠 · 저역 필터 · 좌우 패닝 ─┬─ sfx 음량 ─┐
//                                                      └─ 리버브 센드 ─ 컨볼버 ─┤
//   음악 ─ music 음량 ─ 덕킹(큰 타격 때 눌림) ─────────────────────────────────┤
//                                   합 ─ 먹먹함 필터 ─ 컴프레서(리미터 구실) ─ 보정 ─ 소프트 클립 ─ master 음량 ─ 출력
//
// unlock() 전에는 AudioContext 를 만들지 않는다. 그 전의 play · setCharge · setMuffle 은 조용히 무시한다.

import { clamp, jit, makeNoiseBuffer, makeImpulse, saturationCurve } from "./util.js";
import { createKit, SOUNDS as BRAWLS_SOUNDS, INTERNAL, colorPitch } from "./sfx.js";
import { REALM_SOUNDS } from "./sfx-realms.js";
import { createMusic } from "./music.js";

// [왕국전] 브로울스 소리 + 왕국전 소리(같은 이름이면 왕국전 것)
const SOUNDS = { ...BRAWLS_SOUNDS, ...REALM_SOUNDS };
const HEADROOM = 0.6; // 목소리 하나의 기준 음량. 여럿이 겹쳐도 컴프레서가 숨 쉴 틈을 남긴다
const volCurve = (v) => clamp(Number(v) || 0, 0, 1) ** 1.7; // 슬라이더 0..1 → 귀에 고르게 들리는 게인
// [왕국전] 지도 칸 거리(기본 확대에서 화면 가로 ≈ 22칸). 가운데 NEAR 칸 안은 그대로, 그 밖은 FALL 칸마다 줄고,
// CULL 칸(× reach × 확대 배율)을 넘으면 내지 않는다. 좌우는 PAN 칸에서 끝까지(0.78)
const NEAR = 5, FALL = 9, CULL = 32, PAN = 12;

/**
 * @param {{ context?: BaseAudioContext, lite?: boolean }} [opts] context 를 주면 그 위에 만든다(OfflineAudioContext 로 렌더 · 시험할 때).
 *   lite = 가벼운 모드(휴대폰): 동시 발음 수 · 방 울림 길이를 줄인다.
 */
export function createAudio(opts = {}) {
  let ctx = opts.context || null;
  const offline = !!ctx && typeof ctx.startRendering === "function";
  const lite = !!opts.lite;
  const MAX_VOICES = lite ? 14 : 32; // [왕국전] 휴대폰은 동시 발음을 줄인다(CPU)
  let g = null; // 마스터 체인 노드들
  let kit = null;
  const vol = { master: 0.6, music: 0.45, sfx: 0.8 }; // [왕국전] 기본을 낮게
  const listener = { x: 0, z: 0, scale: 1 }; // [왕국전] 지도 칸 · 확대 배율
  const voices = []; // { name, out, nodes, start, end, prio }
  const lastStart = Object.create(null);
  const counts = Object.create(null); // [왕국전] 이름 → [낸 횟수, 멀어서 버림, 몰려서 버림]
  const music = createMusic();
  let warned = false;
  let muted = false; // [왕국전]
  let musicWanted = false; // [왕국전] 게임이 음악을 원한다(끔 · 음량 0 이면 실제로는 멈춰 둔다)
  let primed = false; // [왕국전] iOS 무음 버퍼를 틀었나

  const live = () => !!g && (offline || ctx.state === "running");
  const count = (name, k) => ((counts[name] || (counts[name] = [0, 0, 0]))[k]++);

  function build() {
    const sum = ctx.createGain();
    const muffle = ctx.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.value = 20000;
    muffle.Q.value = 0.5;
    // 컴프레서는 겹친 소리의 덩어리만 누른다. attack 을 12ms 로 두어 타격의 첫 순간(클릭 · 저음의 머리)은
    // 그대로 지나가게 하고, 그렇게 빠져나온 순간 피크는 뒤의 소프트 클립이 둥글린다 — 눌리지 않고 "딱" 맞는 소리.
    // (브라우저 컴프레서는 자동 보정 이득이 붙으므로 post 에서 깎는다.)
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 8;
    comp.attack.value = 0.012;
    comp.release.value = 0.15;
    const post = ctx.createGain();
    post.gain.value = 0.55;
    const clip = ctx.createWaveShaper();
    clip.curve = saturationCurve(1.3);
    const master = ctx.createGain();
    sum.connect(muffle);
    muffle.connect(comp);
    comp.connect(post);
    post.connect(clip);
    clip.connect(master);
    master.connect(ctx.destination);

    const sfxIn = ctx.createGain();
    sfxIn.connect(sum);
    const musicIn = ctx.createGain();
    const duckGain = ctx.createGain();
    musicIn.connect(duckGain);
    duckGain.connect(sum);

    // 짧은 방 울림. 센드는 sfx · music 음량을 따로 따른다(효과음을 0 으로 내리면 그 울림도 사라진다).
    // [왕국전] 가벼운 모드는 울림을 0.7초로(컨볼버 계산이 길이에 비례한다)
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, lite ? 0.7 : 1.25);
    const revReturn = ctx.createGain();
    revReturn.gain.value = 0.55;
    conv.connect(revReturn);
    revReturn.connect(sum);
    const revSfx = ctx.createGain();
    const revMusic = ctx.createGain();
    revSfx.connect(conv);
    revMusic.connect(conv);

    g = { sum, muffle, comp, master, sfxIn, musicIn, duckGain, revSfx, revMusic };
    const buffers = { white: makeNoiseBuffer(ctx, 2, "white"), pink: makeNoiseBuffer(ctx, 2.3, "pink") };
    kit = createKit(ctx, buffers, { soft: saturationCurve(1.6), hard: saturationCurve(3.2) });
    applyVolumes(true);
    music.attach({ ctx, out: musicIn, rev: revMusic, noise: buffers.white });
    syncMusic();
  }

  function applyVolumes(immediate) {
    if (!g) return;
    const set = (param, v) => {
      if (immediate) param.value = v;
      else param.setTargetAtTime(v, ctx.currentTime, 0.03);
    };
    const s = volCurve(vol.sfx);
    const m = volCurve(vol.music) * 0.8;
    set(g.master.gain, muted ? 0 : volCurve(vol.master)); // [왕국전] 끔
    set(g.sfxIn.gain, s);
    set(g.revSfx.gain, s);
    set(g.musicIn.gain, m);
    set(g.revMusic.gain, m * 0.35);
  }

  // [왕국전] 음악 스케줄러는 원할 때만 돈다(끔 · 음악 음량 0 · 전체 음량 0 이면 멈춰 CPU 를 아낀다)
  function syncMusic() {
    if (!g) return;
    const on = musicWanted && !muted && vol.music > 0.001 && vol.master > 0.001;
    if (on && !music.running) music.start();
    else if (!on && music.running) music.stop();
  }

  function unlock() {
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return false;
      try {
        ctx = new AC({ latencyHint: "interactive" });
      } catch {
        return false;
      }
    }
    if (!g) {
      try {
        build();
      } catch (err) {
        console.warn("[audio] 그래프를 만들지 못했다", err);
        g = null;
        return false;
      }
    }
    if (ctx.state !== "running" && typeof ctx.resume === "function") ctx.resume().catch(() => {});
    // [왕국전] iOS(예전 사파리)는 사용자 손짓 안에서 무언가를 한 번 틀어야 출력이 열린다 — 1 샘플 무음
    if (!offline && !primed) {
      try {
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
        primed = true;
      } catch {
        /* 무시 */
      }
    }
    return true;
  }

  function setVolumes(v = {}) {
    for (const k of ["master", "music", "sfx"]) {
      if (Number.isFinite(v[k])) vol[k] = clamp(v[k], 0, 1);
    }
    applyVolumes(false);
    syncMusic();
  }

  /** [왕국전] 소리 끔 · 켬. 끄면 새 소리를 만들지 않고(CPU) 음악 스케줄러도 멈춘다 */
  function setMuted(on) {
    muted = !!on;
    if (muted) setCharge(0);
    applyVolumes(false);
    syncMusic();
  }

  /** [왕국전] 듣는 자리(지도 칸)와 확대 배율(화면에 담긴 칸 수 / 기본 22칸 — 멀리 볼수록 멀리까지 들린다) */
  function setListener(x, z, scale) {
    if (Number.isFinite(x)) listener.x = x;
    if (Number.isFinite(z)) listener.z = z;
    if (Number.isFinite(scale) && scale > 0) listener.scale = clamp(scale, 0.5, 2.5);
  }

  // ---------------------------------------------------------------- 목소리 관리

  function release(v) {
    for (const node of v.nodes) {
      try {
        node.disconnect();
      } catch {
        /* 이미 끊긴 노드 */
      }
    }
  }

  function sweep(now) {
    for (let i = voices.length - 1; i >= 0; i--) {
      if (voices[i].end + 0.05 < now) {
        release(voices[i]);
        voices.splice(i, 1);
      }
    }
  }

  // 자리를 내줘야 하는 목소리는 뚝 끊지 않고 8ms 로 빠르게 줄인다(딸깍 소리 방지).
  function choke(v, now) {
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setTargetAtTime(0, now, 0.008);
    v.end = Math.min(v.end, now + 0.05);
    v.choked = true;
  }

  function duck(depth, hold = 0.2) {
    if (!g) return;
    const now = ctx.currentTime;
    const p = g.duckGain.gain;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(1 - clamp(depth, 0, 0.9), now, 0.012);
    p.setTargetAtTime(1, now + 0.05 + hold * 0.4, 0.08 + hold * 0.5);
  }

  function trigger(name, def, o) {
    // [왕국전] 위치를 먼저 잰다: 너무 멀면 노드를 하나도 만들지 않고 버린다(32명 · 300 유닛이 내는 소리 대부분은 화면 밖)
    let pan = 0;
    let near = 1;
    let cutoff = 0;
    let send = def.send ?? 0.12;
    if (!def.flat && Number.isFinite(o.x) && Number.isFinite(o.z)) {
      const dx = o.x - listener.x;
      const dz = o.z - listener.z;
      const reach = (def.reach || 1) * listener.scale; // 멀리까지 울리는 소리(핵폭발 등)는 거리를 줄여 셈한다
      const d = Math.hypot(dx, dz) / reach;
      if (d > CULL) {
        count(name, 1);
        return false;
      }
      pan = clamp(dx / (PAN * reach), -1, 1) * 0.78;
      const far = Math.max(0, d - NEAR);
      near = 1 / (1 + (far / FALL) ** 2);
      if (d > NEAR + 2) cutoff = 20000 / (1 + ((d - NEAR - 2) / 9) ** 2 * 1.6); // 멀수록 고음이 깎인다
      send *= 1 + clamp(d / 14, 0, 1.5); // 멀수록 방 울림이 많다
    }

    const now = ctx.currentTime;
    sweep(now);

    // 같은 이름이 한꺼번에 몰리면 조금씩 밀어서 친다(플램). 너무 밀리면 버린다.
    let t = now;
    const last = lastStart[name];
    if (last !== undefined && now - last < def.gap) {
      t = last + def.gap;
      if (t - now > 0.07) {
        count(name, 2);
        return false;
      }
    }

    let active = 0;
    let same = 0;
    let oldestSame = null;
    let weakest = null;
    for (const v of voices) {
      if (v.choked || v.end <= now) continue;
      active++;
      if (v.name === name) {
        same++;
        if (!oldestSame || v.start < oldestSame.start) oldestSame = v;
      }
      if (!weakest || v.prio < weakest.prio || (v.prio === weakest.prio && v.start < weakest.start)) weakest = v;
    }
    if (same >= def.max && oldestSame) choke(oldestSame, now);
    if (active >= MAX_VOICES && weakest) {
      if (weakest.prio > def.prio) {
        count(name, 2);
        return false; // 더 중요한 소리들로 꽉 찼다
      }
      choke(weakest, now);
    }
    lastStart[name] = t;

    const p = clamp(Number.isFinite(o.power) ? o.power : 0.6, 0, 1);
    const pitch = clamp(Number.isFinite(o.pitch) ? o.pitch : 1, 0.25, 4);
    const col = Number.isInteger(o.color) ? o.color : -1;
    const r = pitch * colorPitch(col) * (def.steady ? 1 : jit(1, 0.04));
    const gain = Number.isFinite(o.gain) ? clamp(o.gain, 0, 1.5) : 1; // [왕국전] 이 소리만 더 작게 · 크게

    const out = ctx.createGain();
    out.gain.value = HEADROOM * near * gain * (0.94 + Math.random() * 0.12);
    const nodes = [out];
    let tail = out;
    if (cutoff && cutoff < 17000) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = cutoff;
      lp.Q.value = 0.5;
      tail.connect(lp);
      tail = lp;
      nodes.push(lp);
    }
    if (pan !== 0 && typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      tail.connect(panner);
      tail = panner;
      nodes.push(panner);
    }
    tail.connect(g.sfxIn);
    const sendGain = ctx.createGain();
    sendGain.gain.value = send;
    tail.connect(sendGain);
    sendGain.connect(g.revSfx);
    nodes.push(sendGain);

    let dur;
    try {
      dur = def.fn({
        k: kit, t, out, p, r, col,
        duck: (depth, hold) => duck(depth * near * Math.min(1, gain), hold),
        muffle: (amount, seconds, delay) => setMuffle(amount * near, seconds, delay), // 귀가 먹먹해지는 소리(핵폭발)
      });
    } catch (err) {
      if (!warned) {
        warned = true;
        console.warn(`[audio] "${name}" 합성 실패`, err);
      }
      release({ nodes });
      return false;
    }
    voices.push({ name, out, nodes, start: t, end: t + dur + 0.05, prio: def.prio });
    count(name, 0);
    return true;
  }

  /** 소리 하나. o = { x, z(지도 칸 — 없으면 가운데), power 0..1, pitch, color(팀 번호), gain }. 냈으면 true */
  function play(name, o = {}) {
    if (muted || !live()) return false;
    const def = Object.hasOwn(SOUNDS, name) ? SOUNDS[name] : null;
    if (!def) return false;
    return trigger(name, def, o || {});
  }

  // ---------------------------------------------------------------- 충전음

  // 누르고 있는 동안 차오르는 음: 톱니파 + 사각파가 올라가며 필터가 열리고 떨림이 빨라진다.
  let charge = null;
  let chargeT = 0;
  let chargeFull = false;

  function startCharge(now) {
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    const sub = ctx.createOscillator();
    a.type = "sawtooth";
    b.type = "square";
    b.detune.value = 9;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 5;
    lp.frequency.value = 350;
    const trem = ctx.createGain();
    trem.gain.value = 0.75;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.25;
    lfo.connect(lfoDepth);
    lfoDepth.connect(trem.gain);
    const out = ctx.createGain();
    out.gain.value = 0;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    a.connect(lp);
    b.connect(lp);
    lp.connect(trem);
    sub.connect(subGain);
    subGain.connect(trem);
    trem.connect(out);
    out.connect(g.sfxIn);
    for (const o of [a, b, sub, lfo]) o.start(now);
    charge = { a, b, sub, lfo, lp, out };
    chargeT = -1;
  }

  function stopCharge(now) {
    const c = charge;
    charge = null;
    c.out.gain.cancelScheduledValues(now);
    c.out.gain.setTargetAtTime(0, now, 0.02);
    for (const o of [c.a, c.b, c.sub, c.lfo]) o.stop(now + 0.15);
    setTimeout(() => {
      try {
        c.out.disconnect();
      } catch {
        /* 무시 */
      }
    }, 400);
  }

  function setCharge(value) {
    const t = clamp(Number(value) || 0, 0, 1);
    if (!live()) return;
    const now = ctx.currentTime;
    if (t <= 0 || muted) {
      // [왕국전] 끔이면 충전음도 내지 않는다
      if (charge) stopCharge(now);
      chargeFull = false;
      return;
    }
    if (!charge) startCharge(now);
    const full = t >= 1;
    if (Math.abs(t - chargeT) < 0.015 && full === chargeFull) return; // 매 프레임 불려도 값이 움직일 때만 손댄다
    chargeT = t;
    const f = 150 * 2 ** (1.6 * t);
    const tc = 0.03;
    charge.a.frequency.setTargetAtTime(f, now, tc);
    charge.b.frequency.setTargetAtTime(f, now, tc);
    charge.sub.frequency.setTargetAtTime(f / 2, now, tc);
    charge.lp.frequency.setTargetAtTime(350 + 2600 * t * t, now, tc);
    charge.lfo.frequency.setTargetAtTime(full ? 22 : 5 + 11 * t, now, tc);
    charge.out.gain.setTargetAtTime(full ? 0.065 : 0.03 + 0.06 * t, now, tc);
    if (full && !chargeFull) trigger("chargeFull", INTERNAL.chargeFull, {});
    chargeFull = full;
  }

  // ---------------------------------------------------------------- 먹먹함

  /** delay: 이만큼(초) 뒤에 먹먹해진다(소리 자신의 첫 타격은 또렷하게 들리게). */
  function setMuffle(amount, seconds, delay = 0) {
    if (!live()) return;
    const a = clamp(Number(amount) || 0, 0, 1);
    const s = clamp(Number(seconds) || 0.6, 0.15, 6);
    const f = g.muffle.frequency;
    const now = ctx.currentTime + clamp(Number(delay) || 0, 0, 1);
    const low = 18000 * 0.028 ** a; // a=1 → 약 500Hz, a=0.5 → 약 3kHz
    f.cancelScheduledValues(now);
    f.setTargetAtTime(low, now, 0.012);
    f.setValueAtTime(low, now + s * 0.25);
    f.exponentialRampToValueAtTime(20000, now + s); // 옥타브 단위로 고르게 열린다
  }

  return {
    unlock,
    setVolumes,
    setMuted,
    setListener,
    play,
    setCharge,
    setMuffle,
    music: {
      // [왕국전] start · stop 은 "원한다"만 적고, 실제로 돌릴지는 끔 · 음량을 보고 정한다
      start: () => {
        musicWanted = true;
        syncMusic();
      },
      stop: () => {
        musicWanted = false;
        syncMusic();
      },
      setState: (s) => music.setState(s),
      setIntensity: (v) => music.setIntensity(v),
      get state() {
        return music.state;
      },
      get running() {
        return music.running;
      },
      renderAhead: (seconds) => music.renderAhead(seconds),
    },
    // 계약서 밖의 보조(미리보기 · 디버그용)
    names: Object.keys(SOUNDS),
    get context() {
      return ctx;
    },
    get ready() {
      return live();
    },
    get muted() {
      return muted;
    },
    get lite() {
      return lite;
    },
    /** [왕국전] 이름 → [낸 횟수, 멀어서 버림, 몰려서 버림] */
    counts: () => JSON.parse(JSON.stringify(counts)),
    stats: () => {
      const now = ctx ? ctx.currentTime : 0;
      return { voices: voices.filter((v) => !v.choked && v.end > now).length, max: MAX_VOICES, state: ctx ? ctx.state : "none", music: music.running ? music.state : "off" };
    },
  };
}
