// 캐릭터 8종(docs/DESIGN.md §3.9): 남자 4 · 여자 4. 종류마다 머리 모양(3D 부품) · 장식 · 눈매 · 옷 · 살색 · 기본 무늬를 이 표 한 곳에 둔다.
// 원본 ink-brawl 인형의 몸 비율 · 움직임은 그대로이고(figures.js · characters.js), 종류는 머리 부품의 실루엣 · 눈 창 안의 눈 · 옷 선으로 가른다.
// "캐릭터 종류"와 "무늬"는 따로다: 종류는 플레이어가 고르고(char 0~7), 무늬는 지금은 종류의 기본 무늬 + 같은 색(팀) 안의 순서로
// 자동 배정한다(assignPatterns — 같은 팀 6명이 겹치지 않는다). 나중에 무늬도 고르게 되면 pattern 을 넘기면 된다(겹치면 다음 빈 무늬로).
// 순수 자료 · 순수 함수만(three 없음 — UI · 시험이 그대로 import 한다).

/** 무늬 이름(skins.js 의 그리는 함수와 같은 순서 — 번호가 곧 무늬). 앞의 8종은 원본 그대로 */
export const PATTERNS = Object.freeze([
  { key: "candy", name: "사탕 줄무늬" },
  { key: "dots", name: "물방울" },
  { key: "checker", name: "체크" },
  { key: "zigzag", name: "지그재그" },
  { key: "bands", name: "가로 띠" },
  { key: "drip", name: "흘러내림" },
  { key: "stars", name: "별" },
  { key: "split", name: "위아래" },
  { key: "vstripe", name: "세로 줄무늬" },
  { key: "bigdot", name: "큰 점" },
  { key: "speckle", name: "잔 점" },
  { key: "diamond", name: "다이아몬드" },
  { key: "hearts", name: "하트" },
  { key: "bolts", name: "번개" },
  { key: "flames", name: "불꽃" },
  { key: "waves", name: "물결" },
  { key: "clouds", name: "구름" },
  { key: "leaves", name: "나뭇잎" },
  { key: "flowers", name: "꽃" },
  { key: "halves", name: "반반" },
  { key: "thirds", name: "삼등분" },
  { key: "steps", name: "단계 띠" },
  { key: "swirl", name: "소용돌이" },
  { key: "target", name: "과녁" },
  { key: "camo", name: "위장" },
  { key: "splat", name: "잉크 튄 자국" },
]);
export const PATTERN_COUNT = PATTERNS.length;

/** 눈 창 안의 살색(톤 몇 가지 — 종류마다 하나) */
export const SKIN_TONES = Object.freeze([0xffd9bd, 0xf2c19c, 0xe0a47c, 0xc0835a, 0xffe4cf, 0x9c6844]);

/**
 * 캐릭터 8종. 순서가 곧 번호(char) — 0~3 남자, 4~7 여자. 옷은 모두 바지(종류마다 모양이 다르다), 남녀는 머리 모양 · 머리 장식으로 가른다.
 *   hairColor 머리카락의 자연색(8종이 서로 겹치지 않게 — 팀 색은 몸 · 옷 · 무늬 · 장식에만)
 *   hair   머리 껍질(머리에 씌우는 한 장 — 셰이더가 종류마다 모양을 만든다): rim = 앞 · 옆 · 뒤 아래 끝 높이(머리 좌표 y — 머리 밑 0, 윗면 0.75),
 *          zig = 앞머리 끝 지그재그(가닥) 깊이, off = 머리 위로 뜬 두께, bulge = 정수리 볼록, spikes = 삐죽 머리, flare = 머리 아래로 내려간 머리카락이 벌어짐,
 *          hat = { line, mat } 껍질의 고리 s(0 정수리 → 1 아래 끝)가 line 보다 위는 모자(캡 몸통 · 비니), 그 아래는 머리카락,
 *          cuff = { from, to, out, mat } 그 고리 구간을 out 만큼 밖으로 부풀린 단(비니의 접힌 단 · 캡 테두리)
 *   goggles 눈을 덮는 3D 고글: shape 0 둥근 렌즈 둘 · 1 각진 렌즈 둘 · 2 이어진 넓은 렌즈(스키 고글), frame = 테 재질
 *   tank   등에 멘 잉크 탱크(공통 — 크기만 조금씩): [가로, 세로] 배율
 *   parts  개성 장식 · 머리 부품 칸(tailA · tailB · band · knobA~D — figures.js 의 부위 8~14). parent(head · rig · tank · arm0 · arm1 · leg0 · leg1 ·
 *          tailA · tailB) 아래 자리 · 회전 · 크기, mat 재질, swing = 달릴 때 흔들리는 정도(0 고정 — 음수면 반대로), span = 띠(band)의 반각(π 면 한 바퀴),
 *          small = 화질 저에서 생략하는 작은 장식
 *   gear   개성 장식 이름(목록 · 시험 — 머리 모양 말고 두 가지씩)
 *   eyes   고글 너머로 흐릿하게 비치는 눈매(eyes.js — 표정 표시도 이 칸), skin = SKIN_TONES 번호, outfit = 윗옷 선 · pants = 바지(skins.js), shoe = 신발
 *   pattern 기본 무늬(PATTERNS 번호)
 */
export const CHARACTERS = Object.freeze([
  {
    key: "beat", name: "비트", nameKo: "비트", gender: "m", look: "짧은 머리 · LED 헤드폰 · 후드 · 조거 바지",
    eyes: "round", skin: 0, outfit: "hoodie", pants: "jogger", shoe: "sneaker", pattern: 0, hairColor: 0x4a2e22, hairName: "짙은 갈색",
    gear: ["LED 헤드폰", "손목 밴드"], goggles: { shape: 0, frame: "rubber" }, tank: [1, 1],
    hair: { rim: [0.64, 0.42, 0.34], zig: 0.05, off: 0.045, bulge: 0.03, spikes: 0, flare: 0, mat: "hair" },
    parts: {
      band: { parent: "head", pos: [-0.04, 0.36, 0], rot: [0, 0, Math.PI / 2 + 0.12], scale: [0.5, 0.55, 0.6], span: Math.PI / 2, mat: "rubber" },
      knobA: { parent: "head", pos: [-0.02, 0.38, 0.56], rot: [0, 0, 0], scale: [0.16, 0.18, 0.09], mat: "led" },
      knobB: { parent: "head", pos: [-0.02, 0.38, -0.56], rot: [Math.PI, 0, 0], scale: [0.16, 0.18, 0.09], mat: "led" },
      knobC: { parent: "arm0", pos: [0, -0.29, 0], rot: [0, 0, 0], scale: [0.122, 0.055, 0.122], mat: "stripe", small: 1 },
      knobD: { parent: "arm1", pos: [0, -0.29, 0], rot: [0, 0, 0], scale: [0.122, 0.055, 0.122], mat: "stripe", small: 1 },
    },
  },
  {
    key: "spike", name: "삐죽이", nameKo: "삐죽이", gender: "m", look: "삐죽 머리 · 고글 안테나 · 멜빵 반바지",
    eyes: "sharp", skin: 2, outfit: "overalls", pants: "overallShorts", shoe: "sneaker", pattern: 13, hairColor: 0x2f2b3c, hairName: "검정",
    gear: ["고글 안테나", "무릎 보호대"], goggles: { shape: 2, frame: "team" }, tank: [0.95, 1.05],
    hair: { rim: [0.66, 0.46, 0.38], zig: 0.03, off: 0.04, bulge: 0.02, spikes: 0.3, flare: 0, mat: "hair" },
    parts: {
      tailA: { parent: "head", pos: [0.34, 0.5, -0.42], rot: [0.3, 0, Math.PI - 0.15], scale: [0.13, 1.35, 0.13], mat: "chrome", swing: 0.25 },
      knobA: { parent: "tailA", pos: [0, -0.48, 0], rot: [0, 0, 0], scale: [0.55, 0.055, 0.55], mat: "led" },
      knobC: { parent: "leg0", pos: [0.1, -0.17, 0], rot: [0, 0, 0], scale: [0.065, 0.1, 0.11], mat: "pad", small: 1 },
      knobD: { parent: "leg1", pos: [0.1, -0.17, 0], rot: [0, 0, 0], scale: [0.065, 0.1, 0.11], mat: "pad", small: 1 },
    },
  },
  {
    key: "cap", name: "캡틴", nameKo: "캡틴", gender: "m", look: "캡 모자 · 스카프 · 어깨 배지 · 반바지",
    eyes: "wide", skin: 1, outfit: "tee", pants: "shorts", shoe: "sneaker", pattern: 4, hairColor: 0x80502c, hairName: "밤색",
    gear: ["날리는 스카프", "어깨 배지"], goggles: { shape: 1, frame: "chrome" }, tank: [1.05, 0.95],
    // 캡 몸통 = 머리 껍질의 윗부분(단색 팀 색 + 앞 표식), 그 아래 옆 · 뒤로 자연색 머리. 챙 = 납작한 반원판(공 B)
    hair: { rim: [0.71, 0.46, 0.4], zig: 0.02, off: 0.06, bulge: 0.22, spikes: 0, flare: 0, mat: "hair",
      hat: { line: 0.72, mat: "cap" }, cuff: { from: 0.6, to: 0.72, out: 0.02, mat: "cap" } },
    parts: {
      knobA: { parent: "head", pos: [0, 1.02, 0], rot: [0, 0, 0], scale: [0.075, 0.045, 0.075], mat: "chrome", small: 1 },
      knobB: { parent: "head", pos: [0.36, 0.82, 0], rot: [0, 0, 0.24], scale: [0.5, 0.06, 0.64], mat: "brim" },
      band: { parent: "rig", pos: [0, 0.95, 0], rot: [0, 0, 0], scale: [0.27, 0.8, 0.27], span: Math.PI, mat: "stripe" },
      tailA: { parent: "rig", pos: [-0.2, 0.95, 0.1], rot: [0, 0, -0.95], scale: [1.4, 1.7, 0.45], mat: "stripe", swing: 1.2 },
      knobC: { parent: "arm0", pos: [0, -0.07, 0.096], rot: [0, 0, 0], scale: [0.08, 0.08, 0.03], mat: "badge", small: 1 },
    },
  },
  {
    key: "acorn", name: "도토리", nameKo: "도토리", gender: "m", look: "니트 비니 · 공구 벨트와 붓 · 등 깃발 · 카고 바지",
    eyes: "sleepy", skin: 3, outfit: "jacket", pants: "cargo", shoe: "sneaker", pattern: 2, hairColor: 0xc8692e, hairName: "구릿빛",
    gear: ["공구 벨트 · 붓", "등 깃발"], goggles: { shape: 0, frame: "cream" }, tank: [1.1, 1],
    // 부풀린 니트 비니(세로 골) + 접힌 단 + 큰 방울, 단 아래로 자연색 머리
    hair: { rim: [0.62, 0.44, 0.36], zig: 0.025, off: 0.085, bulge: 0.3, spikes: 0, flare: 0, mat: "hair",
      hat: { line: 0.62, mat: "knit" }, cuff: { from: 0.62, to: 0.86, out: 0.06, mat: "knitLight" } },
    parts: {
      knobA: { parent: "head", pos: [-0.03, 1.24, 0], rot: [0, 0, 0], scale: [0.23, 0.21, 0.23], mat: "cream" },
      band: { parent: "rig", pos: [0, 0.53, 0], rot: [0, 0, 0], scale: [0.318, 0.6, 0.318], span: Math.PI, mat: "belt" },
      knobC: { parent: "rig", pos: [0.08, 0.5, 0.3], rot: [0, 0, 0], scale: [0.1, 0.11, 0.065], mat: "rubber", small: 1 },
      tailB: { parent: "rig", pos: [0.12, 0.4, -0.31], rot: [0.12, 0, Math.PI - 0.12], scale: [0.42, 1.25, 0.42], mat: "brush" },
      tailA: { parent: "tank", pos: [0, 0.22, 0], rot: [0, 0, Math.PI + 0.35], scale: [0.22, 1.9, 1.25], mat: "pennant", swing: -0.8 },
    },
  },
  {
    key: "twin", name: "방울이", nameKo: "방울이", gender: "f", look: "양 갈래 · 구슬 머리끈 · 스카프 · 팔 토시 · 접은 반바지",
    eyes: "big", skin: 4, outfit: "sailor", pants: "cuffShorts", shoe: "strap", pattern: 1, hairColor: 0x9a3a26, hairName: "적갈색",
    gear: ["목 스카프", "팔 토시"], goggles: { shape: 0, frame: "light" }, tank: [0.92, 0.95],
    hair: { rim: [0.64, 0.4, 0.3], zig: 0.035, off: 0.045, bulge: 0.04, spikes: 0, flare: 0, mat: "hair" },
    parts: {
      tailA: { parent: "head", pos: [-0.06, 0.66, 0.48], rot: [-0.85, 0, -0.1], scale: [1.5, 1.5, 1.5], mat: "hair", swing: 1 },
      tailB: { parent: "head", pos: [-0.06, 0.66, -0.48], rot: [0.85, 0, -0.1], scale: [1.5, 1.5, 1.5], mat: "hair", swing: 1 },
      knobA: { parent: "tailA", pos: [0, -0.03, 0], rot: [0, 0, 0], scale: [0.085, 0.07, 0.085], mat: "bead" },
      knobB: { parent: "tailB", pos: [0, -0.03, 0], rot: [0, 0, 0], scale: [0.085, 0.07, 0.085], mat: "bead" },
      band: { parent: "rig", pos: [0, 0.95, 0], rot: [0, 0, 0], scale: [0.26, 0.75, 0.26], span: Math.PI, mat: "stripe" },
      knobC: { parent: "arm0", pos: [0, -0.23, 0], rot: [0, 0, 0], scale: [0.118, 0.1, 0.118], mat: "knitStripe", small: 1 },
      knobD: { parent: "arm1", pos: [0, -0.23, 0], rot: [0, 0, 0], scale: [0.118, 0.1, 0.118], mat: "knitStripe", small: 1 },
    },
  },
  {
    key: "pony", name: "깡충이", nameKo: "깡충이", gender: "f", look: "크고 긴 포니테일 · 별 머리핀 · 땀밴드 · 등의 큰 붓 · 트랙 바지",
    eyes: "almond", skin: 1, outfit: "sporty", pants: "track", shoe: "strap", pattern: 6, hairColor: 0xe8bb58, hairName: "금발",
    gear: ["땀밴드", "등에 멘 큰 붓"], goggles: { shape: 2, frame: "cream" }, tank: [0.9, 1.05],
    hair: { rim: [0.64, 0.46, 0.4], zig: 0.03, off: 0.045, bulge: 0.04, spikes: 0, flare: 0, mat: "hair" },
    parts: {
      // 뒤통수 위에서 뒤로 늘어지는 굵은 꼬리(위에서 봐도 머리 밖으로 튀어나온다) — 달리면 뒤로 날린다
      tailA: { parent: "head", pos: [-0.42, 0.86, 0], rot: [0, 0, -1.12], scale: [2.0, 2.6, 2.0], mat: "hair", swing: 0.55 },
      knobA: { parent: "tailA", pos: [0, -0.05, 0], rot: [0, 0, 0], scale: [0.075, 0.04, 0.075], mat: "bead" },
      knobB: { parent: "head", pos: [0.26, 0.74, 0.44], rot: [0.6, 0, 0.3], scale: [0.15, 0.045, 0.15], mat: "gem" },
      band: { parent: "head", pos: [0, 0.645, 0], rot: [0, 0, 0], scale: [0.57, 0.45, 0.57], span: Math.PI, mat: "stripe" },
      tailB: { parent: "tank", pos: [0.02, 0.05, 0.05], rot: [-0.55, 0, Math.PI - 0.1], scale: [0.5, 2.1, 0.5], mat: "brush" },
    },
  },
  {
    key: "ribbon", name: "나비", nameKo: "나비", gender: "f", look: "단발 · 큰 리본 · 보석 버클 벨트 · 멜빵바지",
    eyes: "sparkle", skin: 0, outfit: "pinafore", pants: "dungarees", shoe: "strap", pattern: 12, hairColor: 0xd2bf98, hairName: "애쉬 금발",
    gear: ["보석 버클 벨트", "어깨 배지"], goggles: { shape: 0, frame: "chrome" }, tank: [0.95, 0.9],
    hair: { rim: [0.64, 0.1, 0.12], zig: 0.035, off: 0.055, bulge: 0.04, spikes: 0, flare: 0.25, mat: "hair" },
    parts: {
      tailA: { parent: "head", pos: [-0.04, 0.88, -0.24], rot: [-2.3, 0, 0], scale: [0.55, 1.05, 1.65], mat: "bow", swing: 0.35 },
      tailB: { parent: "head", pos: [-0.04, 0.88, -0.24], rot: [1.6, 0, 0], scale: [0.55, 1.05, 1.65], mat: "bow", swing: 0.35 },
      knobA: { parent: "head", pos: [-0.04, 0.89, -0.24], rot: [-0.35, 0, 0], scale: [0.085, 0.1, 0.095], mat: "gem" },
      band: { parent: "rig", pos: [0, 0.55, 0], rot: [0, 0, 0], scale: [0.316, 0.5, 0.316], span: Math.PI, mat: "stripe" },
      knobC: { parent: "rig", pos: [0.31, 0.55, 0], rot: [0, 0, 0], scale: [0.04, 0.07, 0.09], mat: "gem", small: 1 },
      knobD: { parent: "arm1", pos: [0, -0.07, -0.096], rot: [Math.PI, 0, 0], scale: [0.08, 0.08, 0.03], mat: "badge", small: 1 },
    },
  },
  {
    key: "band", name: "하늘", nameKo: "하늘", gender: "f", look: "긴 머리 · 꽃 머리띠 · 니트 손목 토시 · 와이드 바지",
    eyes: "gentle", skin: 5, outfit: "dress", pants: "wide", shoe: "strap", pattern: 18, hairColor: 0xa8713c, hairName: "밝은 갈색",
    gear: ["꽃 머리띠", "니트 손목 토시"], goggles: { shape: 1, frame: "rubber" }, tank: [1, 1.08],
    hair: { rim: [0.64, -0.3, -0.62], zig: 0.03, off: 0.05, bulge: 0.04, spikes: 0, flare: 0.32, mat: "hair" },
    parts: {
      band: { parent: "head", pos: [0.02, 0.37, 0], rot: [0, 0, Math.PI / 2 - 0.22], scale: [0.5, 0.85, 0.6], span: Math.PI / 2 + 0.05, mat: "stripe" },
      knobA: { parent: "head", pos: [0.12, 0.66, 0.5], rot: [0.5, 0, 0], scale: [0.11, 0.11, 0.06], mat: "gem" },
      knobB: { parent: "head", pos: [0.12, 0.66, -0.5], rot: [-0.5, 0, 0], scale: [0.11, 0.11, 0.06], mat: "gem" },
      knobC: { parent: "arm0", pos: [0, -0.27, 0], rot: [0, 0, 0], scale: [0.12, 0.085, 0.12], mat: "knitLight", small: 1 },
      knobD: { parent: "arm1", pos: [0, -0.27, 0], rot: [0, 0, 0], scale: [0.12, 0.085, 0.12], mat: "knitLight", small: 1 },
    },
  },
]);
export const CHAR_COUNT = CHARACTERS.length;

/** 부품 칸 이름 → 부위 번호(figures.js PARTS — 7 머리 껍질 · 8~14 장식 · 15 고글 · 16 잉크 탱크 · 17 호스) */
export const SLOTS = Object.freeze({ hair: 7, tailA: 8, tailB: 9, band: 10, knobA: 11, knobB: 12, knobC: 13, knobD: 14, goggles: 15, tank: 16, hose: 17 });
/**
 * 부품 재질: pat 무늬 · hair 머리카락(종류의 자연색 + 가닥 결 + 윤기 · 테두리 빛) · team 팀 색 · cream 크림 · dark 짙은 색 · light 밝은 팀 색 · lens 색유리 ·
 * knit 니트(팀 색 + 세로 골) · knitLight 밝은 니트 · cap 캡 몸통(단색 팀 색 + 앞 표식) · brim 챙(밑면은 짙은 그늘) · rubber 무광 검정 고무 · chrome 크롬 ·
 * led 검정 + 형광 LED 고리 · stripe 두 톤 줄(팀 색 · 크림) · bead 두 톤 광택 구슬 · gem 반짝이는 보석 · brush 붓(나무 자루 · 크롬 고리 · 팀 색 털) ·
 * pennant 깃발(팀 색 + 크림 사선) · badge 배지(크롬 테 + 팀 색 별) · pad 보호대(고무 + 팀 색 줄) · knitStripe 줄무늬 니트 · belt 벨트(고무 + 크롬 버클) · bow 리본(팀 색 + 크림 테)
 */
export const MATS = Object.freeze({
  pat: 0, hair: 1, team: 2, cream: 3, dark: 4, light: 5, lens: 6, knit: 7, knitLight: 8, cap: 9, brim: 10,
  rubber: 11, chrome: 12, led: 13, stripe: 14, bead: 15, gem: 16, brush: 17, pennant: 18, badge: 19, pad: 20, knitStripe: 21, belt: 22, bow: 23,
});
/** 고글 모양: [반각(라디안), 반높이, 앞으로 나온 두께, 렌즈 반폭, 렌즈 반높이, 렌즈 모서리, 이어진 렌즈(1)] */
export const GOGGLE_SHAPES = Object.freeze([
  [0.74, 0.15, 0.065, 0.1, 0.1, 0.085, 0],
  [0.76, 0.145, 0.06, 0.106, 0.092, 0.025, 0],
  [0.82, 0.16, 0.07, 0.3, 0.105, 0.075, 1],
]);

/** 캐릭터 번호를 0..7 로(없거나 이상하면 id % 8) */
export function charOf(char, id = 0) {
  if (Number.isInteger(char) && char >= 0 && char < CHAR_COUNT) return char;
  const n = Number.isFinite(id) ? Math.abs(Math.trunc(id)) : 0;
  return n % CHAR_COUNT;
}

function coprimeStep(n) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  for (let s = 7; s < n + 7; s++) if (gcd(s, n) === 1) return s % n || 1;
  return 1;
}
const STEP = coprimeStep(PATTERN_COUNT);

/**
 * 한 무리(같은 색 — 팀전이면 팀)의 무늬를 정한다. members = [{ id, char, pattern }] (pattern −1/없음 = 자동).
 * 번호 순으로 원하는 무늬(고른 무늬 → 없으면 종류의 기본 무늬)를 주고, 앞사람이 이미 가졌으면 STEP 씩 건너 다음 빈 무늬로 — 무리 안에서 겹치지 않는다
 * (무리가 무늬 수보다 크면 그때부터 겹친다). 모든 클라이언트에서 같은 값.
 * @returns {Map<number, number>} id → 무늬 번호
 */
export function assignPatterns(members) {
  const list = [...members].sort((a, b) => a.id - b.id);
  const used = new Set();
  const out = new Map();
  for (const m of list) {
    const c = charOf(m.char, m.id);
    const want = Number.isInteger(m.pattern) && m.pattern >= 0 ? m.pattern % PATTERN_COUNT : CHARACTERS[c].pattern;
    let p = want;
    for (let k = 1; used.has(p) && k <= PATTERN_COUNT; k++) p = (want + STEP * k) % PATTERN_COUNT;
    used.add(p);
    out.set(m.id, p);
  }
  return out;
}
