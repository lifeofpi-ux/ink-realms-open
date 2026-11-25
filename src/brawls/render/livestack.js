// 살아 있는 스택(층마다 사각형을 쌓아 그린다)의 움직임 — 순수 계산(Node 시험에서 그대로 돈다). docs/DESIGN.md §3.2 · 스킬 3절.
//
// 피어오르기(slice-bloom): 드러나는 경계 f 가 0 → count + width 로 간다(끝 층이 한 프레임에 튀지 않게 경계를 count 너머까지).
//   층 k 의 진행 s = clamp((f − k) / width, 0, 1), 들어 올린 양 = k · spacing · spring(s). s = 0 인 층은 아직 그리지 않는다.
// 깨지기(shatter): 층마다 정해진(씨앗) 방향으로 흩어지며 떨어지고 돈다. 알파 대신 드러남(reveal)을 줄여 픽셀이 뭉개지지 않게.
// 동시에 움직이는 스택은 6개 이하(DESIGN §3.2) — 넘으면 renderer 가 나머지를 한 장(구운 모습 + 드러남)으로 대신한다.

export const LIVE_MAX = 6;
export const BLOOM_WIDTH = 3; // 층 몇 개에 걸쳐 섞어 올리는가

/** 부드러운 용수철 정착: 0 → 1, 살짝 넘쳤다 돌아온다(s = 1 에서 정확히 1) */
export function spring(s) {
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  return 1 - Math.exp(-6 * s) * Math.cos(9 * s) * (1 - s); // (1 − s) 로 끝에서 정확히 1
}

/**
 * 피어오르기: progress 0..1 에서 층 k 의 상태.
 * @returns {{ show: boolean, lift: number }}  lift = 들어 올린 양(층 간격 단위 — k 층이 다 서면 k)
 */
export function bloomLayer(k, count, progress, width = BLOOM_WIDTH) {
  const f = Math.max(0, Math.min(1, progress)) * (count + width);
  const s = Math.max(0, Math.min(1, (f - k) / width));
  return { show: s > 0, lift: k * spring(s) };
}

/** 씨앗 있는 난수(0..1) */
function hash(a, b) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * 깨지기: 시간 t(초)에서 층 k 의 어긋남(아트 픽셀)과 돌기 · 드러남.
 * @returns {{ dx: number, dy: number, rot: number, reveal: number }}  dy 는 화면 아래 +
 */
export function shatterLayer(k, count, t, seed = 1, life = 0.9) {
  const a = hash(seed, k) * Math.PI * 2;
  const sp = 22 + hash(seed + 7, k) * 40;
  const up = 30 + (k / Math.max(1, count - 1)) * 40 + hash(seed + 3, k) * 20;
  const g = 160;
  const dx = Math.cos(a) * sp * t;
  const dy = -up * t + 0.5 * g * t * t + Math.sin(a) * sp * 0.4 * t;
  const rot = (hash(seed + 11, k) - 0.5) * 8 * t;
  const reveal = t < life * 0.55 ? 1 : Math.max(0, 1 - (t - life * 0.55) / (life * 0.45));
  return { dx, dy, rot, reveal };
}
