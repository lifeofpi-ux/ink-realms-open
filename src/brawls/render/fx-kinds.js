// 폭발 연출 표(docs/DESIGN.md §3.7): 종류 → 재료 목록과 수치. 새 종류를 더할 때 코드가 아니라 이 표를 고친다.
// effects.js 가 이 표를 읽어 재료를 시간표대로 실행한다. 모두 입자 풀 하나(인스턴스 상한 512 — 화질 저는 1/3)와 섬광 점광 배열에서 나오므로
// 종류가 늘어도 그리기 호출은 늘지 않는다. 순수 자료(three.js 없음) — test/render-fx.test.js 가 모양을 검사한다.
//
// 재료(at = 시작 시각 초, 생략하면 0):
//   flash    { r, power, life }                       팀 색 섬광(점광 — 주변 블록 · 캐릭터를 물들인다)
//   core     { r, life }                               터지는 순간의 하얀 심(빛나는 구 — 블룸)
//   crown    { n, r, up }                              바닥에서 솟았다 가라앉는 입체 잉크 왕관(바깥으로 기운 뿔 n 개 · 끝 방울이 떨어져 난다 · 밑동 고리)
//   drops    { n, speed:[a,b], up:[a,b], size:[a,b], bias, spread }   포물선으로 튀는 입체 방울(바닥에 닿으면 작은 얼룩) — bias = 날아온 쪽으로 쏠림
//   shock    { r, life, thick, distort }               퍼지며 얇아지는 입체 충격파 고리 + 바닥 빛 고리(distort = 화질 고의 화면 일그러짐 세기)
//   sparks   { n, speed, life }                        도트 불꽃(작고 밝은 알갱이)
//   stars    { n, r, life }                            별 모양 반짝임
//   glow     { r, life }                               잔광(바닥에 남는 빛 + 약한 점광)
//   splat    { r, grow }                               바닥 얼룩이 grow 초에 걸쳐 퍼진다(잉크 캔버스)
//   splashChars { r }                                  둘레 캐릭터 층에 그 팀 색 잉크가 튄다
//   jolt     { r, power, wave }                        블록 들썩임(wave = 거리 1u 마다 늦어지는 초 — 충격파)
//   shake    { v }                                     (쓰지 않는다 — 화면 흔들림은 없앴다. 사용자 지시)
//   pillar   { n, h }                                  잉크 기둥(늘린 구가 솟았다 꺼진다 + 위로 솟는 방울 줄)
//   strings  { n, len }                                끈끈이의 늘어나는 잉크 실(길게 늘인 방울이 천천히)
//   puddle   { r, life }                               끈적한 웅덩이가 한동안 꿈틀
//   cone     { n, spread }                             미사일: 날아온 방향으로 쏠린 부채꼴 파편
//   spiral   { n, turns }                              유도 미사일: 나선으로 터지는 방울
//   mushroom { n, h, cap }                             메가 잉크 폭탄: 버섯 구름(굵은 기둥 + 부풀며 오르는 눌린 구 갓 + 방울)
//   rain     { n, time, r }                            메가 잉크 폭탄: 잉크 비(time 초 동안 둘레 바닥을 칠한다)
//   chain    { n, dist, delay }                        폭죽: 불꽃 꼬리 여섯 줄기가 날아가 차례로 터진다
//   swirl    { n, time, r }                            소용돌이: 나선으로 빨려 들어감
//   dim      { v, life }                               한순간 어두워짐(화면)
//   puffs    { n, life, r }                            연막: 굵고 느린 연기 덩이
//   wall     { len, h }                                장벽: 세운 빛 벽
//   dome     { r, life }                               팀 보호막: 반구 고리
//   sparkle  { n, life }                               회복: 위로 오르는 반짝임
//   repeat   { n, gap, tones }                         같은 연출을 n 번(삼발 — 밝기가 다른 세 톤)
// size(배율)은 종류 전체에 곱한다. 화질 저: 입자 수 × 1/3, 점광 없음(flash · glow 의 빛만 빠진다), 충격파는 남긴다.

export const FX_KINDS = {
  basic: {
    size: 1,
    parts: [
      { k: "flash", r: 4, power: 1.0, life: 0.3 }, { k: "core", r: 0.4, life: 0.12 },
      { k: "crown", n: 14, r: 0.8, up: 5 }, { k: "drops", n: 28, speed: [2, 5.5], up: [3, 8], size: [0.05, 0.2] },
      { k: "shock", r: 2.2, life: 0.32, thick: 0.1 }, { k: "sparks", n: 6, speed: 6, life: 0.3 },
      { k: "splat", r: 1, grow: 0.15 }, { k: "splashChars", r: 1.6 }, { k: "jolt", r: 2.6, power: 0.45, wave: 0.02 },
    ],
  },
  mega: { // 대왕: 2단 폭발(작게 → 크게), 굵은 충격파, 잉크 기둥
    size: 1,
    parts: [
      { k: "flash", r: 3, power: 0.8, life: 0.15 }, { k: "core", r: 0.35, life: 0.1 }, { k: "drops", n: 8, speed: [1.5, 3], up: [2, 4], size: [0.06, 0.12] },
      { k: "flash", at: 0.12, r: 7, power: 1.8, life: 0.45 }, { k: "core", at: 0.12, r: 0.6, life: 0.18 },
      { k: "crown", at: 0.12, n: 22, r: 1.3, up: 7 }, { k: "pillar", at: 0.12, n: 16, h: 3.5 },
      { k: "drops", at: 0.12, n: 44, speed: [3, 8], up: [4, 10], size: [0.06, 0.26] },
      { k: "shock", at: 0.12, r: 4.2, life: 0.45, thick: 0.22, distort: 0.8 }, { k: "sparks", at: 0.12, n: 12, speed: 8, life: 0.4 },
      { k: "splat", at: 0.12, r: 1, grow: 0.15 }, { k: "splashChars", at: 0.12, r: 2.6 }, { k: "jolt", at: 0.12, r: 4.5, power: 0.9, wave: 0.03 },
      { k: "glow", at: 0.12, r: 2.4, life: 0.9 },
    ],
  },
  triple: { // 삼발: 한 발마다 작게(세 발이 따로 터지며 톡톡톡 — 밝기 세 톤은 effects 가 번갈아)
    size: 0.85,
    tones: [1.0, 0.72, 1.3],
    parts: [
      { k: "flash", r: 3, power: 0.7, life: 0.22 }, { k: "core", r: 0.3, life: 0.08 },
      { k: "crown", n: 8, r: 0.6, up: 4 }, { k: "drops", n: 16, speed: [2, 4.5], up: [2.5, 6], size: [0.05, 0.16] },
      { k: "shock", r: 1.6, life: 0.25, thick: 0.1 }, { k: "sparks", n: 5, speed: 5, life: 0.25 },
      { k: "splat", r: 1, grow: 0.12 }, { k: "splashChars", r: 1.3 },
    ],
  },
  sticky: { // 끈끈이: 늘어나는 잉크 실, 천천히 떨어지는 굵은 방울, 꿈틀대는 웅덩이
    size: 1.1,
    parts: [
      { k: "flash", r: 3.5, power: 0.8, life: 0.35 }, { k: "core", r: 0.4, life: 0.14 },
      { k: "strings", n: 8, len: 1.4 }, { k: "crown", n: 9, r: 0.7, up: 3 }, { k: "drops", n: 14, speed: [1, 2.5], up: [3, 5], size: [0.14, 0.26], slow: 0.45 },
      { k: "shock", r: 1.9, life: 0.4, thick: 0.16 }, { k: "puddle", r: 1.5, life: 3.5 },
      { k: "splat", r: 1, grow: 0.25 }, { k: "splashChars", r: 1.8 }, { k: "jolt", r: 2.2, power: 0.3, wave: 0.03 },
    ],
  },
  missile: { // 미사일: 날아온 방향으로 쏠린 부채꼴 얼룩과 파편
    size: 0.9,
    parts: [
      { k: "flash", r: 3.5, power: 1.1, life: 0.25 }, { k: "core", r: 0.35, life: 0.1 },
      { k: "cone", n: 28, spread: 0.7 }, { k: "drops", n: 8, speed: [1.5, 3], up: [2, 5], size: [0.06, 0.12], bias: 1.2 },
      { k: "shock", r: 1.8, life: 0.28, thick: 0.1 }, { k: "sparks", n: 10, speed: 9, life: 0.3 },
      { k: "splat", r: 1, grow: 0.12 }, { k: "splashChars", r: 1.4 }, { k: "jolt", r: 2.4, power: 0.5, wave: 0.02 },
    ],
  },
  homing: { // 유도 미사일: 나선 꼬리(비행 중) + 별 모양 터짐
    size: 0.9,
    parts: [
      { k: "flash", r: 3.5, power: 1.1, life: 0.25 }, { k: "core", r: 0.35, life: 0.1 },
      { k: "spiral", n: 18, turns: 1.5 }, { k: "stars", n: 5, r: 1.6, life: 0.45 },
      { k: "shock", r: 1.8, life: 0.3, thick: 0.1 }, { k: "sparks", n: 8, speed: 7, life: 0.35 },
      { k: "splat", r: 1, grow: 0.12 }, { k: "splashChars", r: 1.4 }, { k: "jolt", r: 2.4, power: 0.45, wave: 0.02 },
    ],
  },
  bomb: { // 메가 잉크 폭탄: 화면 번쩍 → 버섯 구름 → 2초 잉크 비 → 블록들이 차례로 들썩이는 충격파 → 긴 잔광
    size: 1,
    parts: [
      { k: "dim", v: -0.55, life: 0.35 }, { k: "flash", r: 14, power: 3, life: 1.2 }, { k: "core", r: 0.9, life: 0.3 },
      { k: "mushroom", n: 44, h: 5, cap: 2.6 }, { k: "crown", n: 30, r: 2.2, up: 9 },
      { k: "shock", r: 8, life: 0.9, thick: 0.25, distort: 1.4 }, { k: "shock", at: 0.15, r: 11, life: 1.1, thick: 0.12, distort: 0.8 },
      { k: "jolt", r: 11, power: 1.4, wave: 0.06 }, { k: "rain", at: 0.4, n: 110, time: 2, r: 7 },
      { k: "sparks", n: 24, speed: 11, life: 0.6 }, { k: "stars", n: 8, r: 3.5, life: 0.8 },
      { k: "splashChars", r: 6 }, { k: "glow", r: 5, life: 3 },
    ],
  },
  // ---- 새 아이템: 폭죽 · 소용돌이 · 드릴은 풍선 종류(BALLOON_KINDS 7 · 8 · 12)로 서버에 들어왔다 — fx.burst 가 kind 로 고른다.
  //      나머지(연막 · 장벽 · 덫 · 깃발 · 팀 보호막 · 회복)는 서버 사건이 아직 없어 ?fxdemo 로만 돌려 본다(fx.play(이름, …) 로 잇는다) ----
  firework: { // 폭죽: 가운데가 터진다 — 둘레 여섯 폭발은 서버가 sub 1..6 으로 따로 보낸다(FIREWORK.DELAY 뒤 — fx.burst 가 작게)
    size: 1,
    parts: [
      { k: "flash", r: 4, power: 1.2, life: 0.3 }, { k: "core", r: 0.45, life: 0.12 }, { k: "sparks", n: 18, speed: 8, life: 0.45 },
      { k: "stars", n: 6, r: 1.4, life: 0.5 }, { k: "drops", n: 14, speed: [2, 6], up: [4, 9], size: [0.05, 0.14] },
      { k: "shock", r: 2, life: 0.3, thick: 0.1 }, { k: "splat", r: 1, grow: 0.12 },
    ],
  },
  vortex: { // 소용돌이: 끌어당기는 동안은 drawVortex(바닥 고리 — game.vortices), 끝에 한순간 어두워졌다가 팡
    size: 1,
    parts: [
      { k: "dim", v: -0.35, life: 0.2 }, { k: "swirl", n: 18, time: 0.2, r: 2.5 },
      { k: "flash", at: 0.08, r: 6, power: 2, life: 0.4 }, { k: "core", at: 0.08, r: 0.5, life: 0.16 },
      { k: "crown", at: 0.08, n: 14, r: 1.1, up: 6 }, { k: "drops", at: 0.08, n: 36, speed: [3, 8], up: [3, 9], size: [0.06, 0.22] }, { k: "shock", at: 0.08, r: 3.5, life: 0.4, thick: 0.18, distort: 0.7 },
      { k: "splat", at: 0.08, r: 1.3, grow: 0.15 }, { k: "jolt", at: 0.08, r: 4, power: 0.8, wave: 0.03 },
    ],
  },
  drill: { // 드릴 미사일: 블록을 뚫을 때마다 파편과 불꽃, 끝에서 방향성 폭발
    size: 1,
    parts: [
      { k: "sparks", n: 10, speed: 7, life: 0.3 }, { k: "cone", n: 14, spread: 0.45 },
      { k: "sparks", at: 0.15, n: 10, speed: 7, life: 0.3 }, { k: "flash", at: 0.3, r: 4, power: 1.3, life: 0.3 },
      { k: "cone", at: 0.3, n: 26, spread: 0.6 }, { k: "shock", at: 0.3, r: 2.6, life: 0.3, thick: 0.12 }, { k: "splat", at: 0.3, r: 1.1, grow: 0.12 },
      { k: "jolt", at: 0.3, r: 3, power: 0.6, wave: 0.02 },
    ],
  },
  smoke: { size: 1, parts: [{ k: "core", r: 0.3, life: 0.1 }, { k: "puffs", n: 18, life: 2.5, r: 2.5 }, { k: "shock", r: 1.5, life: 0.3, thick: 0.1 }] },
  barrier: { size: 1, parts: [{ k: "wall", len: 4, h: 1.6 }, { k: "sparks", n: 10, speed: 4, life: 0.4 }, { k: "flash", r: 3, power: 0.6, life: 0.4 }] },
  trap: { size: 1, parts: [{ k: "shock", r: 1.4, life: 0.25, thick: 0.2 }, { k: "stars", n: 4, r: 0.9, life: 0.35 }, { k: "sparks", n: 6, speed: 4, life: 0.25 }] },
  flag: { size: 1, parts: [{ k: "pillar", n: 8, h: 2.5 }, { k: "shock", r: 2.5, life: 0.5, thick: 0.08 }, { k: "glow", r: 1.5, life: 1.2 }] },
  teamShield: { size: 1, parts: [{ k: "dome", r: 3, life: 1.2 }, { k: "flash", r: 4, power: 0.7, life: 0.6 }, { k: "sparkle", n: 12, life: 0.9 }] },
  heal: { size: 1, parts: [{ k: "sparkle", n: 18, life: 1.1 }, { k: "glow", r: 1.2, life: 0.8 }, { k: "flash", r: 2.5, power: 0.5, life: 0.5 }] },
  // 합동 폭발(burst 의 combo — 같은 팀 다른 사람의 폭발과 0.5초 · 2u 안): 원래 폭발 위에 덧붙는 큰 고리 · 별 · 섬광
  combo: {
    size: 1,
    parts: [
      { k: "flash", r: 7, power: 2.2, life: 0.5 }, { k: "core", r: 0.55, life: 0.18 }, { k: "crown", n: 18, r: 1.6, up: 8 },
      { k: "shock", r: 4.5, life: 0.5, thick: 0.25, distort: 1 }, { k: "shock", at: 0.08, r: 3, life: 0.4, thick: 0.12 },
      { k: "stars", n: 8, r: 2.2, life: 0.6 }, { k: "sparks", n: 16, speed: 9, life: 0.45 }, { k: "glow", r: 2, life: 0.8 },
    ],
  },
  // 부서지는 블록(블록 사건)
  block: { size: 1, parts: [{ k: "debris", n: 14 }, { k: "puffs", n: 8, life: 0.9, r: 1.1 }, { k: "shock", r: 1.6, life: 0.3, thick: 0.15 }] },
};

/** BALLOON_KINDS 의 key(shared/constants.js) → 이 표의 이름 */
export const KIND_OF_BALLOON = {
  basic: "basic", mega: "mega", triple: "triple", sticky: "sticky", missile: "missile", bomb: "bomb", homing: "homing",
  firework: "firework", vortex: "vortex", drill: "drill",
  energy: "heal", boost: "basic", shield: "teamShield", // 아이템 자리(풍선으로 터지지 않는다 — 혹시 오면)
};

/** 재료 이름 목록(검사용) */
export const PART_KINDS = [
  "flash", "core", "crown", "drops", "shock", "sparks", "stars", "glow", "splat", "splashChars", "jolt", "shake", "pillar", "strings", "puddle",
  "cone", "spiral", "mushroom", "rain", "chain", "swirl", "dim", "puffs", "wall", "dome", "sparkle", "debris",
];

/** ?fxdemo 가 차례로 보여 줄 순서 */
export const DEMO_ORDER = ["basic", "mega", "triple", "sticky", "missile", "homing", "bomb", "firework", "vortex", "drill", "combo", "smoke", "barrier", "trap", "flag", "teamShield", "heal", "block"];
