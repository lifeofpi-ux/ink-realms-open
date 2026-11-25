// [왕국전] 잉크 브로울스 src/audio/util.js 를 그대로 가져왔다.
// 합성에 쓰는 작은 도구들: 난수 흔들기, 노이즈 버퍼, 리버브 임펄스, 포화 곡선.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const rand = (a, b) => a + Math.random() * (b - a);
/** v 를 ±amt 비율만큼 흔든다. 같은 소리가 매번 조금씩 다르게 나도록. */
export const jit = (v, amt) => v * (1 + (Math.random() * 2 - 1) * amt);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const semi = (n) => 2 ** (n / 12);
export const midiHz = (n) => 440 * 2 ** ((n - 69) / 12);

/** 길이 seconds 의 모노 노이즈 버퍼. kind: "white" | "pink" */
export function makeNoiseBuffer(ctx, seconds, kind = "white") {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === "pink") {
    // Paul Kellet 의 핑크 노이즈 근사(1/f). 잉크의 "철퍽" 같은 묵직한 질감에 쓴다.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      d[i] = v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    const k = peak > 0 ? 0.95 / peak : 1;
    for (let i = 0; i < len; i++) d[i] *= k;
  } else {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

/**
 * 짧은 방 울림 임펄스(스테레오). 지수 감쇠 노이즈에 초기 반사 몇 개를 얹고,
 * 꼬리로 갈수록 고음을 깎아(damp) 금속성 쉿 소리를 없앤다.
 */
export function makeImpulse(ctx, seconds = 1.2, { decay = 5.5, damp = 0.82, predelay = 0.006 } = {}) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  const pre = Math.floor(predelay * sr);
  const taps = [0.011, 0.017, 0.023, 0.031, 0.043];
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      const env = Math.exp(-decay * t) * (1 - t);
      const coef = 1 - damp * Math.min(1, t * 2.2 + 0.15); // 뒤로 갈수록 저역만 남는다
      lp += ((Math.random() * 2 - 1) - lp) * coef;
      d[i] = lp * env;
    }
    for (let k = 0; k < taps.length; k++) {
      const at = Math.floor((taps[k] + c * 0.0037 + k * 0.0011) * sr);
      if (at < len) d[at] += (k % 2 ? -1 : 1) * (0.55 - k * 0.09);
    }
  }
  return buf;
}

/** tanh 포화 곡선. drive 가 클수록 배음이 많이 붙는다. 입력 ±1 → 출력 ±1. */
export function saturationCurve(drive = 1.5, n = 2048) {
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}
