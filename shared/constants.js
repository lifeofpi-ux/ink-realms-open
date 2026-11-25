// 잉크 브로울스 왕국전 v2 — 서버와 브라우저가 함께 쓰는 수치(docs/DESIGN.md).
// 균형을 바꿀 때는 이 파일만 고친다. 좌표: 1 = 지도 한 칸(화면은 1칸 = 2u). x 는 오른쪽, y 는 화면 아래쪽(three.js 에서는 z).
// 높이(z — 점프)만 화면 단위 u 다(브로울스 원본 수치 그대로).

export const TICK = 0.05; // 시뮬레이션 한 걸음(초) — 20Hz
export const SNAP_EVERY = 2; // 스냅숏은 두 틱마다(10Hz)
export const ME_EVERY = 5; // me 는 다섯 틱마다(4Hz) + 바뀔 때
export const TEAM_EVERY = 20; // team 은 스무 틱마다(1Hz) + 바뀔 때
export const INTERP_DELAY = 0.11; // 브라우저는 남의 것을 이만큼 뒤로 보간해 그린다(초)
export const COUNTDOWN = 5; // 모두 "이기는 방법"을 닫으면(또는 BRIEF_MAX 가 지나면) 모든 팀이 함께 세는 시작 전 초(U32)
export const BRIEF_MAX = 25; // "이기는 방법"을 읽는 시간의 한도(초) — 이 뒤에는 닫지 않은 사람이 있어도 세기를 시작한다

// 팀: 잉크 브로울스의 형광 팔레트(핫핑크 · 시안 · 라임 · 오렌지 · 퍼플 · 옐로 · 블루 · 레드) — 8팀까지(v2.2 U14)
export const TEAM_COLORS = [0xff2d95, 0x00f0ff, 0xa8ff00, 0xff7a00, 0xa24bff, 0xffe600, 0x2f6bff, 0xff3b30];
export const TEAM_NAMES = ["핑크", "시안", "라임", "오렌지", "퍼플", "옐로", "블루", "레드"];
export const NEUTRAL = 255; // 중립(몬스터)의 팀 번호
export const NONE = 255; // 주인 없음
// 한 팀 = 맵 바깥 고리의 구역(본진) 하나. 팀마다 4명까지, 모두 32명(U14)
export const MAX_TEAMS = 8;
export const MAX_PER_TEAM = 4;
export const MAX_PLAYERS = MAX_TEAMS * MAX_PER_TEAM;
export const TEAM_COUNTS = [2, 3, 4, 5, 6, 7, 8];
export const ROUND_MINUTES = [10, 15, 20, 30];
export const DEFAULT_MINUTES = 15;
export const GOAL = 10; // 이 점수에 먼저 닿은 팀이 곧 이긴다

// ── 맵 ──
export const MAPS = Object.freeze([
  { key: "forest", name: "잉크 숲", desc: "숲 길목과 잉크 웅덩이" },
  { key: "canal", name: "잉크 수로", desc: "가운데 수로와 다리" },
  { key: "factory", name: "블록 공장", desc: "부서지는 상자 벽" },
]);
export const DEFAULT_MAP = "forest";
export const mapKey = (k) => (MAPS.some((m) => m.key === k) ? k : DEFAULT_MAP);
// 맵 한 변(칸). 건물 · 섹션 칸 좌표를 u8 로 보내므로 255 를 넘지 않는다
export const MAP_SIZE = { 2: 64, 3: 76, 4: 84, 5: 96, 6: 96, 7: 112, 8: 124 };
// 칸 종류. FLOOR 만 걸을 수 있다. WATER 는 풍선 · 미사일이 넘어가고(낮다), 박쥐는 날아서 건넌다.
// TREE · BLOCK 은 단단하다(미사일을 막는다). CRATE 는 폭발에 깨진다(깨지면 FLOOR). POND 는 잉크 연못(맵의 ponds 가 덮는 칸),
// GOLD 는 금광(맵의 mines), CORE 는 코어 금광(맵의 cores — 숲속). 셋 모두 못 지나가고, 일꾼이 가장자리에서 캔다
export const TILE = Object.freeze({ FLOOR: 0, TREE: 1, WATER: 2, BLOCK: 3, CRATE: 4, POND: 5, GOLD: 6, CORE: 7 });
export const isSolidTile = (t) => t === 1 || t === 3 || t === 4 || t === 6 || t === 7; // 미사일 · 시야를 막는 칸
export const CRATE_HP = 40;

// ── 영웅 ──
export const HERO = Object.freeze({
  HP: 100,
  SPEED: 2.8, // 칸/초
  RADIUS: 0.26, // 칸(브로울스 0.5u)
  ACCEL: 26, // 칸/초² — 약 0.11초 만에 최고 속도
  FRICTION: 12, // 입력이 없을 때 감속(1/s, 지수)
  CHARGE_SLOW: 0.55,
  STUN_CONTROL: 0.12, // 경직 중 조작 가속 배율
  RESPAWN: 6,
  LIVES: 3, // 영웅은 이만큼 쓰러지면 더 나오지 않는다(U26). 그 뒤에도 팀이 살아 있으면 일꾼 · 봇 · 몬스터를 지휘한다
  INVULN: 2,
  SIGHT: 8,
  CARRY_SLOW: 0.8, // 보석을 든 동안 속력 배율
  // 서버가 브라우저의 위치를 믿는 여유: 한 보고 사이 이동 ≤ (속력 × 배율) × 걸린 시간 × SLACK + PAD (+ 넉백 · 대시 몫)
  SLACK: 1.35,
  PAD: 0.35,
});
export const DASH = Object.freeze({ SPEED: 7, TIME: 0.16, COOLDOWN: 2, BUMP_KB: 3.75, BUMP_RANGE: 0.58, BUMP_DMG: 6, DOUBLE_TAP: 0.25 });
// 점프는 화면 높이(u) — 브로울스 원본 그대로
export const JUMP = Object.freeze({ SPEED: 10.2, GRAVITY: 32, AIR_SPEED: 5.2, AIR_MAX: 1, DODGE_Z: 0.8 });

// ── 던지기 · 잉크 ──
export const INK = Object.freeze({
  TANK: 200, // 영웅 탱크(브롤스) — 모든 무기 공통
  BOT_TANK: 60,
  BIG_MUL: 1.8, // 충전한 대형은 한 발 잉크 × 이만큼
  REFILL_RATE: 50, // 공급소 곁에서 초당 차는 양
  REFILL_COST: 0.5, // 탱크 1 을 채우는 데 드는 팀 잉크
  REFILL_REACH: 0.6, // 공급소 가장자리에서 이만큼 안(아주 가까이 가야 찬다 — 사용자 요청, 2.2 에서 줄였다)
});
export const THROW = Object.freeze({
  CD: 0.42,
  CHARGE: 0.6, // 이만큼 누르면 대형
  CHARGE_FAST: 0.35, // 연구 "빠른 충전"
  RANGE_MIN: 0.75,
  RANGE: 6.5, // 칸
  HAND: 1.7, // 던지는 순간의 높이(u)
  SMALL: { splash: 1.05, kb: 4.75, dmg: 12 },
  BIG: { splash: 1.65, kb: 7, dmg: 22 },
  DIRECT_DMG: 1.3, // 직격(폭발 가운데 0.35칸 안) 피해 배율
  DIRECT_R: 0.35,
  DIRECT_KB: 1.35,
  FALLOFF_MIN: 0.45, // 폭발 가장자리 세기
  KB_DECAY: 2.3,
  STUN: 0.45,
  BUILDING_MUL: 0.6, // 건물 · 방어막 · 바위 · 상자가 받는 피해 배율
});
// 풍선 비행 시간(초) — 브로울스 식(u)을 칸으로 옮기고 1.25배 느리게. 서버와 브라우저가 같은 식을 쓴다
export const flightTime = (distTiles, big) => (0.42 + distTiles * 2 * 0.036 + (big ? 0.1 : 0)) * 1.25;
export const flightApex = (distTiles) => 1.4 + distTiles * 2 * 0.2; // 포물선 꼭대기 높이(u)

// 무기(브로울스 BALLOON_KINDS 의 배율 그대로). brawl = 브로울스 풍선 종류 번호(화면이 같은 풍선 모양을 그린다).
// ink = 한 발 잉크(소형), tier = 랩 단계(0 = 처음부터 — 단계 1 에서 살 수 있는 것은 tier 1), unlock = 사는 값(골드) · 시간. 산 무기는 팀 모두가 쓴다
export const WEAPONS = Object.freeze([
  { key: "basic", name: "기본 잉크", brawl: 0, ink: 10, tier: 0, splash: 1, kb: 1, dmg: 1, count: 1, spread: 0, slow: 0 },
  { key: "triple", name: "삼발 풍선", brawl: 2, ink: 12, tier: 1, splash: 0.8, kb: 0.8, dmg: 0.7, count: 3, spread: 0.32, slow: 0, unlock: { gold: 120, time: 15 }, pack: { n: 10, gold: 40 } },
  { key: "sticky", name: "끈끈이 풍선", brawl: 3, ink: 9, tier: 1, splash: 1.1, kb: 0.55, dmg: 0.8, count: 1, spread: 0, slow: 2.2, unlock: { gold: 120, time: 15 }, pack: { n: 10, gold: 40 } },
  { key: "missile", name: "잉크 미사일", brawl: 4, ink: 8, tier: 1, splash: 0.6, kb: 1.2, dmg: 0.9, count: 1, spread: 0, slow: 0, direct: true, unlock: { gold: 150, time: 15 }, pack: { n: 10, gold: 45 } },
  { key: "mega", name: "대왕 풍선", brawl: 1, ink: 16, tier: 2, splash: 1.45, kb: 1.35, dmg: 1.35, count: 1, spread: 0, slow: 0, unlock: { gold: 240, time: 20 }, pack: { n: 6, gold: 50 } },
  { key: "homing", name: "유도 미사일", brawl: 6, ink: 12, tier: 2, splash: 0.65, kb: 1.05, dmg: 0.85, count: 1, spread: 0, slow: 0, direct: true, homing: true, unlock: { gold: 260, time: 20 }, pack: { n: 6, gold: 55 } },
  { key: "firework", name: "폭죽", brawl: 7, ink: 18, tier: 2, splash: 0.85, kb: 0.9, dmg: 0.8, count: 1, spread: 0, slow: 0, firework: true, unlock: { gold: 260, time: 20 }, pack: { n: 6, gold: 55 } },
  { key: "vortex", name: "소용돌이", brawl: 8, ink: 26, tier: 3, splash: 1.15, kb: 1.2, dmg: 0.9, count: 1, spread: 0, slow: 0, vortex: true, unlock: { gold: 380, time: 25 }, pack: { n: 4, gold: 60 } },
  { key: "drill", name: "드릴 미사일", brawl: 12, ink: 14, tier: 3, splash: 0.75, kb: 1.15, dmg: 0.95, count: 1, spread: 0, slow: 0, direct: true, drill: true, siege: 2, unlock: { gold: 340, time: 25 }, pack: { n: 6, gold: 60 } },
  { key: "bomb", name: "메가 잉크 폭탄", brawl: 5, ink: 90, tier: 3, splash: 2.0, kb: 2.0, dmg: 2.6, count: 1, spread: 0, slow: 0, nuke: true, cooldown: 30, unlock: { gold: 600, time: 30 }, pack: { n: 1, gold: 90 } },
]);
export const WEAPON = Object.fromEntries(WEAPONS.map((w, i) => [w.key, i]));
// 소지품(v2.2 — U12, 브로울스식): 랩에서 연 무기(팀 · 한 번)를 학생마다 골드로 묶음(pack.n 발 · pack.gold)씩 사서 쌓아 둔다.
// 던질 때마다 1개와 탱크 잉크를 함께 쓴다. 0개가 되면 기본 잉크로 돌아간다. 기본 잉크는 끝이 없다. 쓰러져도 소지품은 그대로.
export const STACK = Object.freeze({ MAX: 30, BOMB_MAX: 3 });
/** 무기 w 를 소지품에 몇 개까지 둘 수 있나 */
export const stackMax = (w) => (WEAPONS[w] && WEAPONS[w].nuke ? STACK.BOMB_MAX : STACK.MAX);
export const MISSILE = Object.freeze({ SPEED: 12, RANGE: 8, CD: 0.6, HEIGHT: 1.0 });
export const HOMING = Object.freeze({ SPEED: 7, TURN: 3.4, ARM: 0.12, LIFE: 2.0, LOCK_RADIUS: 3, CONE: 0.6, RANGE: 10 });
export const FIREWORK = Object.freeze({ DELAY: 0.35, N: 6, RING: 1.2, SPLASH: 0.55, KB: 0.6, DMG: 0.45 });
export const VORTEX = Object.freeze({ TIME: 2, R: 2, PULL: 2.75 });
export const DRILL = Object.freeze({ PIERCE: 3 });
export const SLOW = Object.freeze({ FACTOR: 0.5 });

/** 무기 w 로 한 발 던질 때 드는 잉크. research = 팀 연구 표({ thrift: true, … }) */
export function shotInk(w, big, research) {
  const W = WEAPONS[w] || WEAPONS[0];
  let ink = W.ink * (big && !W.direct && !W.nuke ? INK.BIG_MUL : 1);
  if (research && research.thrift) ink *= 0.75;
  return Math.max(1, Math.round(ink));
}
/** 사거리(칸) — 연구 롱샷 반영 */
export const throwRange = (research) => THROW.RANGE * (research && research.long ? RESEARCH_FX.long : 1);
export const chargeTime = (research) => (research && research.quick ? THROW.CHARGE_FAST : THROW.CHARGE);

// ── 팀 자원(docs/DESIGN.md §5) ──
// 잉크(브롤스) = 탱크 채우기에만 · 골드 = 무기 · 일꾼 · 랩/퍼실리티 · 공급소 · 몬스터 레벨 · 코어 = 잉크봇 · 몬스터 사기(비싸다)
// 처음 지갑(U31 — 학생마다 자기 골드 · 코어 · 잉크. 내 일꾼이 캔 것은 내 지갑, 내가 사는 것은 내 지갑에서)
export const START = Object.freeze({ ink: 200, gold: 150, core: 0, workers: 2 });
export const GIVE = Object.freeze({ STEPS: [10, 50], RES: ["gold", "core", "ink"] }); // 팀원에게 보내기(U31) — 단추 단위 · 보낼 수 있는 것
// 캐는 곳 세 가지. 모두 마르지 않는다. 일꾼은 가장자리 REACH 안에서 TIME 초 캐고 AMOUNT 를 들고 가장 가까운 우리 공급소 · 탑에 내려놓는다.
export const RES_KINDS = ["ink", "gold", "core"]; // 일꾼이 든 것(유닛 info 1 · 2 · 3)
export const POND = Object.freeze({ SIZE: 3, TIME: 3, BASE: 10, REACH: 0.85 }); // 잉크 연못(본진마다 하나)
export const MINE = Object.freeze({ SIZE: 3, TIME: 3.5, BASE: 8, RICH: 12, REACH: 0.85 }); // 금광(본진 금광 + 바깥 큰 금광)
export const CORE_MINE = Object.freeze({ SIZE: 2, TIME: 7, AMOUNT: 1, SLOTS: 2, REACH: 0.85 }); // 코어 금광(숲속) — 한 번에 일꾼 SLOTS 명만 캔다(나머지는 기다린다)
export const DELIVER_REACH = 0.85; // 일꾼이 공급소 · 탑 가장자리에서 이만큼 안이면 내려놓는다

// ── 유닛 ──
export const UTYPE = Object.freeze({ HERO: 0, WORKER: 1, BOT: 2, PET: 3, NPC: 4 });
// 잉크봇은 코어로 산다. 쓰러지면 사라진다(부활 없음 — 다시 사야 한다)
export const UNITS = Object.freeze({
  worker: { name: "일꾼", hp: 50, speed: 2.4, radius: 0.24, sight: 6, cap: 4, train: { gold: 50, time: 12 },
    // 아주 약한 근접 공격(U22): 오른쪽 클릭 공격 명령으로만(저절로 싸우지 않는다). reach = 가장자리 거리(칸), 건물에는 × THROW.BUILDING_MUL
    melee: { reach: 0.45, dmg: 3, cd: 1.1 } },
  bot: { name: "잉크봇", hp: 60, speed: 2.6, radius: 0.24, sight: 7, cap: 3, train: { core: 8, time: 15 }, range: 5.5, cd: 1.2, dmg: 0.8 },
});
export const SQUAD = Object.freeze({ ASSIST: 4, GUARD: 5, LEASH: 8, ORDER_RIGHT_R: 1.5 });

// ── 몬스터(브로울스 던전 몬스터 — kind 번호가 화면 모델 번호) ──
// atk: lunge(달려들기) · charge(돌진) · slam(내려찍기, 점프로 피함) · spin(휩쓸기) · shoot(곧은 탄) · toss(폭탄) · wave(충격파)
// 거리 · 빠르기는 칸(브로울스 u 의 절반). hp 는 중립 기준(내 몬스터는 PET.HP_MUL 배), tier 0 작은 · 1 중간 · 2 큰
export const MONSTERS = Object.freeze([
  { kind: 0, name: "꼬마 잉크 슬라임", tier: 0, hp: 110, speed: 1.8, radius: 0.35, scale: 1.0, touch: 10, kb: 4, atk: { type: "lunge", range: 3, wind: 0.5, time: 0.4, mul: 3.2, every: 2.6 }, perk: "leech" },
  { kind: 1, name: "뿔 잉크 도깨비", tier: 1, hp: 300, speed: 1.6, radius: 0.55, scale: 1.6, touch: 15, kb: 5, atk: { type: "slam", r: 1.7, dmg: 20, kb: 6, wind: 0.95, every: 4 }, atk2: { type: "spin", r: 1.65, dmg: 16, kb: 7, wind: 0.75, every: 5 }, perk: "stun" },
  { kind: 2, name: "잉크 대왕", tier: 2, hp: 900, speed: 1.4, radius: 0.95, scale: 2.8, touch: 20, kb: 6, boss: true, atk: { type: "slam", r: 2.3, dmg: 26, kb: 7.5, wind: 1.05, every: 4 }, atk2: { type: "wave", range: 5.5, speed: 3.5, r: 5, w: 0.45, dmg: 18, kb: 6, wind: 0.85, every: 5.5 }, perk: "stun" },
  { kind: 3, name: "잉크 박쥐", tier: 0, hp: 75, speed: 2.2, radius: 0.32, scale: 0.95, touch: 8, kb: 3, fly: true, atk: { type: "lunge", range: 3.75, wind: 0.38, time: 0.35, mul: 3.4, every: 2 }, perk: "leech" },
  { kind: 4, name: "잉크 고블린", tier: 0, hp: 120, speed: 1.7, radius: 0.35, scale: 1.0, touch: 9, kb: 3.5, keep: 2.25, atk: { type: "toss", range: 5, wind: 0.6, fly: 1.0, r: 1.05, dmg: 14, kb: 5, count: 1, scatter: 0, every: 3 }, perk: "double" },
  { kind: 5, name: "먹물 오징어", tier: 1, hp: 240, speed: 1.45, radius: 0.5, scale: 1.5, touch: 12, kb: 4, keep: 2.75, atk: { type: "shoot", range: 6, wind: 0.6, every: 2.5, speed: 4.5, dmg: 12, kb: 4.5, r: 0.18, count: 3, spread: 0.32, life: 1.6 }, perk: "sticky" },
  { kind: 6, name: "돌진 멧돼지", tier: 1, hp: 300, speed: 1.5, radius: 0.52, scale: 1.55, touch: 16, kb: 5.5, atk: { type: "charge", range: 7, wind: 0.8, time: 1.0, mul: 3.6, dmg: 22, kb: 8, stun: 1.8, every: 3.7 }, perk: "siege" },
  { kind: 7, name: "잉크 거미 여왕", tier: 2, hp: 850, speed: 1.5, radius: 0.9, scale: 2.6, touch: 18, kb: 6, boss: true, atk: { type: "shoot", range: 7, wind: 0.8, every: 3.6, speed: 4, dmg: 14, kb: 5, r: 0.21, count: 5, spread: 0.95, life: 1.9 }, atk2: { type: "toss", range: 6.5, wind: 0.7, fly: 1.1, r: 1.1, dmg: 14, kb: 5, count: 3, scatter: 1.6, every: 6 }, perk: "sticky" },
]);
export const MONSTER_TIERS = Object.freeze([
  { name: "작은", hatch: { core: 12, time: 10 }, gold: 15, core: 0 },
  { name: "중간", hatch: { core: 22, time: 15 }, gold: 40, core: 1 },
  { name: "큰", hatch: { core: 36, time: 20 }, gold: 120, core: 3 },
]); // hatch = 사는 값(코어). gold · core = 중립을 쓰러뜨린 팀이 받는 것
export const PERKS = Object.freeze({
  leech: { name: "흡혈", desc: "준 피해의 30% 회복", value: 0.3 },
  double: { name: "연쇄 폭탄", desc: "폭탄이 둘" },
  stun: { name: "넘어뜨리기", desc: "맞은 적 0.6초 멈춤", value: 0.6 },
  sticky: { name: "끈끈 먹물", desc: "맞은 적 1.5초 느려짐", value: 1.5 },
  siege: { name: "성벽 부수기", desc: "돌진이 건물 · 방어막에 × 2", value: 2 },
});
// 내 몬스터: 코어로 산다(한 사람 1마리). 쓰러지면 사라진다(부활 없음 — 레벨도 잃고 다시 사야 한다)
export const PET = Object.freeze({
  HP_MUL: 0.7,
  LEVELS: [null, null, { gold: 80, core: 3 }, { gold: 120, core: 5 }, { gold: 160, core: 7 }, { gold: 220, core: 10 }], // 레벨 L 로 올리는 값
  MAX_LEVEL: 5,
  PERK_LEVEL: 3,
  HP_PER_LEVEL: 0.2,
  DMG_PER_LEVEL: 0.15,
  SIZE_PER_LEVEL: 0.05,
  DEX_DISCOUNT: 0.75, // 도감(그 종류의 중립을 잡아 본 팀) 사는 코어 배율
});
export const petScale = (level) => 1 + PET.SIZE_PER_LEVEL * ((level || 1) - 1);
export const petHp = (kind, level) => Math.round(MONSTERS[kind].hp * PET.HP_MUL * (1 + PET.HP_PER_LEVEL * ((level || 1) - 1)));
export const petDmg = (level) => 1 + PET.DMG_PER_LEVEL * ((level || 1) - 1);
/** 몬스터 사는 값(도감 할인 반영) — { core, time } */
export function hatchCost(kind, dex) {
  const h = MONSTER_TIERS[MONSTERS[kind].tier].hatch;
  return { core: Math.round(h.core * (dex ? PET.DEX_DISCOUNT : 1)), time: h.time };
}

// ── 중립 몬스터 ──
export const NPC = Object.freeze({
  AGGRO: 5,
  LEASH: 9,
  RESPAWN: 120,
  REGEN: 0.08, // 돌아가는 동안 초당 최대 체력의 이만큼
  ITEM_DROP: 0.3,
  SIGHT: 6,
});

// ── 아이템(중립 몬스터가 떨어뜨림, 영웅만 줍는다) — brawl 은 브로울스 아이템 번호(화면이 같은 모델을 그린다) ──
export const ITEMS = Object.freeze([
  { key: "energy", name: "에너지", brawl: 9, heal: 35 },
  { key: "boost", name: "부스터", brawl: 10, time: 8, speed: 1.35 },
  { key: "shield", name: "보호막", brawl: 11, time: 10 },
]);
export const ITEM_PICK = 0.55;
export const ITEM_LIFE = 40;

// ── 건물 ──
export const BLD = Object.freeze({ TOWER: 0, SUPPLY: 1, LAB: 2, FACILITY: 3 });
export const BUILDINGS = Object.freeze([
  { key: "tower", name: "깃발의 탑", size: 4, hp: 2500, sight: 9 },
  { key: "supply", name: "잉크 공급소", size: 3, hp: 700, sight: 6, build: { gold: 150, time: 20 }, max: 3 },
  { key: "lab", name: "잉크 무기 랩", size: 3, hp: 1200, sight: 6 },
  { key: "facility", name: "몬스터 퍼실리티", size: 3, hp: 1200, sight: 6 },
]);
export const TOWER = Object.freeze({ RANGE: 6, CD: 1.5, DMG: 14, DOWN: 30, BACK_HP: 0.6, DELIVER: 2.5 });
export const REPAIR = Object.freeze({ RATE: 25, REACH: 0.85 });
// 공급소는 일꾼 바로 옆에만 짓는다(U18): 고른 일꾼 가운데 하나가 지을 자리(3×3) 가장자리에서 이만큼(칸) 안에 있어야 한다. 멀면 일꾼을 먼저 옮긴다
export const BUILD_NEAR = 2;

// ── 잉크 무기 랩 ──
export const LAB = Object.freeze({
  LEVELS: [null, null, { gold: 300, time: 30 }, { gold: 550, time: 45 }], // 단계 L 로 올리는 값
  MAX_LEVEL: 3,
  RESEARCH: [
    { key: "thrift", name: "잉크 절약", tier: 1, gold: 180, time: 25, desc: "한 발 잉크 −25%" },
    { key: "quick", name: "빠른 충전", tier: 1, gold: 160, time: 20, desc: "충전 0.6 → 0.35초" },
    { key: "long", name: "롱샷", tier: 2, gold: 240, time: 25, desc: "사거리 +20%" },
    { key: "siege", name: "공성 잉크", tier: 2, gold: 280, time: 30, desc: "건물 · 방어막 · 바위 피해 × 1.6" },
    { key: "power", name: "강화 잉크", tier: 3, gold: 320, time: 30, desc: "모든 피해 +15%" },
  ],
});
export const RESEARCH_FX = Object.freeze({ long: 1.2, siege: 1.6, power: 1.15 });

// ── 몬스터 퍼실리티 ──
export const FACILITY = Object.freeze({
  LEVELS: [null, null, { gold: 300, time: 30 }, { gold: 550, time: 45 }],
  MAX_LEVEL: 3,
  RESEARCH: [
    { key: "nest", name: "회복 둥지", tier: 1, gold: 150, time: 20, desc: "우리 건물 곁 몬스터 회복" },
    { key: "wild", name: "야성", tier: 2, gold: 240, time: 25, desc: "우리 몬스터 피해 +20%" },
  ],
  NEST_R: 4,
  NEST_RATE: 0.03,
  WILD: 1.2,
});

// ── 보석 섹션 ──
export const GEM = Object.freeze({
  SHIELD_HP: 100,
  SHIELD_REGEN_AFTER: 8,
  ROCK_HP: 180,
  RESPAWN: 45,
  DROP_RETURN: 30,
  PICK: 0.6, // 닿는 거리(칸)
  VALUE: { side: 1, center: 2 },
  DELIVER_GOLD: 60, // 보석 배달 덤(팀 골드)
  QUIZ_TIME: 20,
  QUIZ_LOCKOUT: 15,
  CARRY_ATTACK: { quiz: true, arcade: false }, // 보석을 든 동안 던질 수 있나(U8 — 아케이드는 못 던진다)
  ROCK: 2, // 바위 크기(칸)
  PAD_R: 2.5, // 바닥 판 반지름(칸)
  SHIELD_R: 1.5, // 방어막 반지름(칸) — 폭발이 이 원에 닿으면 방어막을 친다
});
export const SITE_STATE = Object.freeze({ SHIELD: 0, ROCK: 1, QUIZ: 2, GEM: 3, EMPTY: 4 });

// ── 퀴즈 ──
export const QUIZ = Object.freeze({ WRONG_GAP: 2, LOCK: 0.6 });

// ── 컴퓨터 ──
export const BOT = Object.freeze({ ACCURACY: 0.65, THINK: 0.25, AIM_ERR: 0.5 });

// ── 통신 ──
export const POS_SCALE = 64; // 위치는 1/64칸으로 담는다(u16 — 최대 1024칸)

/** 값 표 { ink, gold, core } 를 팀이 낼 수 있나 */
export function canAfford(res, cost) {
  if (!cost) return true;
  return res.ink >= (cost.ink || 0) && res.gold >= (cost.gold || 0) && res.core >= (cost.core || 0);
}
export function pay(res, cost) {
  if (!cost) return;
  res.ink -= cost.ink || 0;
  res.gold -= cost.gold || 0;
  res.core -= cost.core || 0;
}
export function refund(res, cost) {
  if (!cost) return;
  res.ink += cost.ink || 0;
  res.gold += cost.gold || 0;
  res.core += cost.core || 0;
}
export function costText(cost) {
  if (!cost) return "";
  const out = [];
  if (cost.gold) out.push(`골드 ${cost.gold}`);
  if (cost.core) out.push(`코어 ${cost.core}`);
  if (cost.ink) out.push(`잉크 ${cost.ink}`);
  return out.join(" · ");
}
