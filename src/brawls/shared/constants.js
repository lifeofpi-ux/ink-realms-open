// 서버와 클라이언트가 함께 쓰는 게임 상수. 값 하나를 바꾸면 양쪽 시뮬레이션이 같이 바뀐다.

import T from "./texts/game.js";

// 규약 버전. 잉크 브로울스는 ink-brawl(규약 8)과 다른 서비스라 1 부터 새로 센다. 메시지 · 스냅샷 모양을 바꾸면 올린다.
//  2(M3 · M4): 스냅샷 20Hz · 플레이어 레코드 압축(빠른 칸 + 4번에 한 번 느린 칸) · 팀 6 · 정원 36 · 세션 복귀 · 퀴즈 메시지
//  3(M5b): 새 아이템 9종(종류 번호 0~18 · 소지품 20칸 4비트 압축 · 느린 칸 kind 5비트) · 설치물 사건 · 팀 신호 · 경기 중 채팅 ·
//         잉크 강 · 다리(TILE.WATER · BRIDGE) · 전장의 안개(스냅샷 본문이 팀마다 다르다 — 시야 밖 적은 빠진다, 위치 사건을 시야로 나눈다)
//  4(통합 검증): 방장 내보내기 {t:"kick", sid} → {t:"left", kicked, msg} · 존 사건 zone.want(팀별 게이지 시간) · 롱샷(종류 19 · self 의 range ·
//         flags 의 RANGE) · 컴퓨터 팀원도 퀴즈 인원(메시지 모양은 그대로)
//  5(통합 검증): 퀴즈 각자 풀기 — ans 의 c 는 던진 본인에게만(me 묶음), 같은 팀에게는 n · need · first(제출 수), q.need, welcome.quiz.active 의 picked · n · need,
//         판정은 전원 제출 뒤(judge.timeout = 다 못 냄)
//  6(통합 검증): 캐릭터 종류 char(0~7) · 무늬 pattern(−1 자동) — hello.char, {t:"char", i}, 채널 구성원 · roster · botPlan 항목에
//  7(v13 — docs/DESIGN.md §2.10b · §2.14): 빠른 말 없음(chat 설정은 "free" · "off", {t:"chat", q} 는 버린다) ·
//         컴퓨터는 방장이 대기실 명단에서 직접 넣는다 {t:"bot", op:"add", team} · {t:"bot", op:"remove", i} — channel.botPlan 이 그 목록
//  8(v14): 소지품 한 칸을 4비트(0~15)에서 한 바이트로 — 아이템을 종류마다 STACK.MAX(30)개까지 쌓아 둔다
//  9(v15 — docs/DESIGN.md §2.15 던전 유형): 채널 설정 dungeon · welcome.dungeon · 몬스터 사건 mon · mhit · mslam · mdie · mrev · gate · dgoal ·
//         TILE.GATE(문 칸 — 닫힌 문은 blocks 1 · 풍선도 넘지 못한다). 던전 퀴즈는 레인마다 보이지 않는 퀴즈 룸 하나(rooms[].hidden)로 같은 퀴즈 사건을 쓴다
//  10(던전 몬스터 8종): 몬스터 상태 st 6 돌진 · 7 기절, 사건 maim(먹물 겨누기) · mshot(먹물 발사) · mpop(먹물 사라짐) · mstun(벽에 박아 기절),
//         mlunge.a("charge" — 멧돼지 돌진)
//  11(v16 — 큰 던전 · 몬스터 무리 · 드론): 스냅샷 위치 칸이 1/25u(±81.92u — 팀마다 큰 레인 2 × 2 맵). welcome.dungeon.seed(던전 배치),
//         몬스터는 방에 들어설 때 무리로 솟는다(사건 madd), 몬스터 정보 area · q(퀴즈 몬스터). 드론(사건 drone · 플레이어 깃발 FLAG.RIDE)
export const PROTOCOL_VERSION = 11;

// 캐릭터 종류(docs/DESIGN.md §3.9 — 사용자 확정 8종: 0~3 남자 · 4~7 여자). 플레이어마다 char(정수). 무늬(pattern)는 나중에 고를 수 있게 칸만 둔다
// (지금은 늘 PATTERN_AUTO — 캐릭터와 팀 안의 순서로 화면이 자동 배정)
export const CHAR_COUNT = 8;
export const PATTERN_AUTO = -1;
/** 캐릭터 종류 값이 맞으면 그대로(0~CHAR_COUNT−1), 아니면 −1 */
export const normalizeChar = (v) => (Number.isInteger(v) && v >= 0 && v < CHAR_COUNT ? v : -1);
/** 여자 캐릭터인가(4~7) — 컴퓨터가 남녀를 섞어 고를 때 */
export const isFemaleChar = (c) => c >= CHAR_COUNT / 2;

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAP_RATE = 20; // 스냅샷 전송 주기(Hz). 시뮬레이션(TICK_RATE)은 60Hz 그대로다(docs/DESIGN.md §6.2)
export const SNAP_SLOW_EVERY = 4; // 플레이어 레코드의 느린 칸(잉크 · 소지 · 점수 · 부스터 · 보호막)은 스냅샷 이만큼에 한 번(5Hz)

export const MAX_PLAYERS = 36; // 방 하나의 최대 인원(봇 포함) — 6명 × 6팀(docs/DESIGN.md §0 A4)
export const MIN_FIGHTERS = 4; // 사람이 모자라면 봇으로 이 수까지 채운다

// 형광 팔레트. index 가 곧 플레이어 색 번호다. 이름은 shared/texts/game.js 에 있다.
// 형광 팔레트(ink-brawl 원본 값). index 가 곧 플레이어 색 번호다. 이름은 shared/texts/game.js 에 있다.
// 0~5 가 팀 색(핫핑크 · 시안 · 라임 · 오렌지 · 퍼플 · 옐로), 6 · 7 은 개인전 · 예비(민트 · 레드)
export const PALETTE = [
  { name: T.colors[0], hex: 0xff2d95 },
  { name: T.colors[1], hex: 0x00f0ff },
  { name: T.colors[2], hex: 0xa8ff00 },
  { name: T.colors[3], hex: 0xff7a00 },
  { name: T.colors[4], hex: 0xa24bff },
  { name: T.colors[5], hex: 0xffe600 },
  { name: T.colors[6], hex: 0x00ffa3 },
  { name: T.colors[7], hex: 0xff3b4e },
  // [왕국전] 팀 7 · 8(블루 · 레드 — shared/constants.js TEAM_COLORS[6] · [7]). 6 · 7 번(민트 · 코랄 레드)은 브로울스 효과 · 중립 몬스터 색으로 그대로 두고 뒤에 붙인다
  { name: "블루", hex: 0x2f6bff },
  { name: "레드", hex: 0xff3b30 },
  // [왕국전] 10 = 중립 몬스터 잉크(연보라 회색) — 코랄 레드(7)가 팀 레드와 거의 같아 바꿨다
  { name: "중립", hex: 0x9b93bf },
];

export const PLAYER = {
  RADIUS: 0.5,
  HEIGHT: 1.5,
  SPEED: 8.4, // 최고 이동 속도(u/s)
  ACCEL: 78, // 조작 가속(u/s²) — 약 0.11초 만에 최고 속도
  FRICTION: 12, // 입력이 없을 때 감속(1/s, 지수)
  CHARGE_SLOW: 0.55, // 충전 중 이동 속도 배율
  STUN_CONTROL: 0.12, // 경직 중 조작 가속 배율
  GRAVITY: 32,
  EDGE_GRACE: 0.15, // 발이 바닥 밖으로 이만큼 나가야 떨어지기 시작
};

export const DASH = {
  SPEED: 17,
  TIME: 0.16,
  COOLDOWN: 1.5,
  IFRAME: 0.16, // 대시 중 잉크 폭발 무시 시간
  BUMP_KB: 7.5, // 대시로 부딪쳤을 때 넉백
  BUMP_RANGE: 1.15,
};

export const BALLOON = {
  MAX_AMMO: 5, // 한 번에 들 수 있는 최대 발 수(HUD 의 칸 수). 종류별 발 수는 BALLOON_KINDS
  THROW_CD: 0.24,
  CHARGE_TIME: 0.5, // 이 이상 누르면 대형 풍선
  RANGE_MIN: 1.5,
  RANGE_MAX: 13,
  INK_REGEN: 1.4, // 모든 모드(v15.2 사용자 요청 — 예전에는 던전만): 기본 잉크가 BALLOON_KINDS[0].ammo 발까지 이 간격(초)마다 한 발씩 저절로 찬다(server/room.js _inkRegen). v16.3 사용자 요청: 0.7 → 1.4초(두 배 — 쉬지 않고 쏘지 못하게)
  HAND_HEIGHT: 1.7, // 던지는 순간의 높이
  SMALL: { splash: 2.1, kb: 9.5, ink: 14, r: 0.3 },
  BIG: { splash: 3.3, kb: 14, ink: 26, r: 0.46 },
};

// 풍선 종류. 기본 잉크(0번)는 경기 중에 저절로 찬다(BALLOON.INK_REGEN). 맵에 뜨는 아이템을 먹으면 그 종류로 바뀌고 ammo 발이 채워진다.
// index 가 곧 종류 번호(스냅샷의 kind). splash · kb 는 BALLOON.SMALL/BIG 값에 곱하는 배율, size 는 보이는 크기 배율.
// 이름은 shared/texts/game.js 의 balloons 에 있다.
export const BALLOON_KINDS = [
  { key: "basic", ammo: 5, weight: 5, splash: 1, kb: 1, dmg: 1, count: 1, spread: 0, slow: 0, size: 1 }, // 기본 잉크
  { key: "mega", ammo: 3, weight: 2, splash: 1.45, kb: 1.35, dmg: 1.35, count: 1, spread: 0, slow: 0, size: 1.5 }, // 대왕: 넓고 세다
  { key: "triple", ammo: 4, weight: 2, splash: 0.8, kb: 0.8, dmg: 0.7, count: 3, spread: 0.32, slow: 0, size: 0.85 }, // 삼발: 부채꼴로 셋(spread 는 옆 풍선의 각도, 라디안)
  { key: "sticky", ammo: 4, weight: 2, splash: 1.1, kb: 0.55, dmg: 0.8, count: 1, spread: 0, slow: 2.2, size: 1.1 }, // 끈끈이: 맞으면 slow 초 동안 느려진다
  // 잉크 미사일: 포물선이 아니라 조준한 방향으로 곧게 날아가 처음 닿는 것에서 터진다(direct). 충전 없이 누르는 즉시 나간다
  { key: "missile", ammo: 6, weight: 2, splash: 0.6, kb: 1.2, dmg: 0.9, count: 1, spread: 0, slow: 0, size: 0.8, direct: true },
  // 메가 잉크 폭탄: 맵에 뜨지 않는다(weight 0). 특수 풍선 네 가지(FUSE.KINDS)를 모두 모으면 저절로 합성된다.
  // 늘 대형으로 나가고(nuke), 핵폭발처럼 넓고 세게 터진다
  { key: "bomb", ammo: 1, weight: 0, splash: 2.0, kb: 2.0, dmg: 2.6, count: 1, spread: 0, slow: 0, size: 2.2, nuke: true },
  // 유도 미사일: 미사일처럼 누르는 즉시 곧게 나가되(direct), 겨눈 적(homingTarget)을 쫓아 방향을 튼다(homing — HOMING 의 각속도까지만).
  // 옆으로 크게 피하면 빗나간다. 메가 잉크 폭탄 합성 재료(FUSE.KINDS)는 아니다
  { key: "homing", ammo: 5, weight: 3, splash: 0.65, kb: 1.05, dmg: 0.85, count: 1, spread: 0, slow: 0, size: 0.8, direct: true, homing: true },
];

// ---------------------------------------------------------------------------------------------- 새 아이템 9종(docs/DESIGN.md §2.12)
// 종류 번호 한 줄(0~18): 0~8 · 12 풍선(BALLOON_KINDS) · 9 에너지 · 10 부스터 · 11 보호막(줍는 즉시 쓴다) · 13~18 설치 · 지원(GADGETS).
// 소지품(p.inv)은 이 번호 그대로 KIND_COUNT 칸이다. 무기 고르기({t:"weapon"}) · 던지기({t:"throw"})는 풍선 · 설치물 모두 같은 길로 간다.
// 새 풍선 셋의 weight 는 0 이다 — 맵에 뜨는 빈도는 모드별 ITEM_MIX 가 정한다(잉크 운동장에서 채널 설정 items "all" 일 때만).
BALLOON_KINDS.push(
  // 폭죽(7): 포물선으로 날아가 터진 FIREWORK.DELAY 초 뒤 둘레 FIREWORK.N 곳에서 작은 폭발이 이어진다
  { key: "firework", ammo: 3, weight: 0, splash: 0.85, kb: 0.9, dmg: 0.8, count: 1, spread: 0, slow: 0, size: 1, firework: true },
  // 소용돌이(8): 떨어진 자리에서 VORTEX.TIME 초 동안 둘레 VORTEX.R 의 적을 가운데로 끌어당긴 뒤 터진다
  { key: "vortex", ammo: 2, weight: 0, splash: 1.15, kb: 1.2, dmg: 0.9, count: 1, spread: 0, slow: 0, size: 1.2, vortex: true },
  // 9 · 10 · 11: 줍는 즉시 쓰는 아이템(에너지 · 부스터 · 보호막 — ENERGY_KIND · BOOST_KIND · SHIELD_KIND)의 번호 자리.
  // 소지품에 들지 않는다(pickup · ammo 0). 번호가 배열의 index 와 맞도록 자리만 채운다(값을 읽는 코드가 넘어지지 않게 수치는 기본값)
  { key: "energy", pickup: true, ammo: 0, weight: 0, splash: 1, kb: 1, dmg: 1, count: 1, spread: 0, slow: 0, size: 1 },
  { key: "boost", pickup: true, ammo: 0, weight: 0, splash: 1, kb: 1, dmg: 1, count: 1, spread: 0, slow: 0, size: 1 },
  { key: "shield", pickup: true, ammo: 0, weight: 0, splash: 1, kb: 1, dmg: 1, count: 1, spread: 0, slow: 0, size: 1 },
  // 드릴 미사일(12): 미사일처럼 곧게 나가되(direct) 부서지는 블록(임시 블록 포함)을 DRILL.PIERCE 개까지 뚫고 나간다.
  // 단단한 블록 · 바깥 벽 · 전광판 받침 · 그다음 부서지는 블록 · 사람 · 사거리 끝에서 터진다
  { key: "drill", ammo: 3, weight: 0, splash: 0.75, kb: 1.15, dmg: 0.95, count: 1, spread: 0, slow: 0, size: 0.85, direct: true, drill: true },
);

// 폭죽의 둘레 폭발: 가운데 폭발 DELAY 초 뒤, 날아온 방향을 기준으로 60° 마다 RING(u) 떨어진 N 곳.
// 한 곳의 세기는 소형 풍선(BALLOON.SMALL · HP.SMALL)에 곱하는 배율이다. 블록에 가로막히면 그 앞에서 터진다
export const FIREWORK = { DELAY: 0.35, N: 6, RING: 2.4, SPLASH: 0.55, KB: 0.6, DMG: 0.45, INK: 0.5 };
// 소용돌이: TIME 초 동안 반지름 R(u) 안의 적을 초당 PULL(u)씩 가운데로 끌어당긴다(같은 팀 · 보호막 · 빛 울타리 안은 영향 없음). 그 뒤 터진다
export const VORTEX = { TIME: 2, R: 4, PULL: 5.5 };
// 드릴 미사일: 뚫는 부서지는 블록 수
export const DRILL = { PIERCE: 3 };

// 설치 · 지원 아이템(먹으면 소지품에 쌓이고, 던지기 조작으로 쓴다). kind = 종류 번호(GADGET_BASE 부터), ammo = 한 번에 드는 개수.
//  place: true = 조준한 곳(range 안으로 당긴다)에 놓는다. false = 누르는 즉시 내 둘레에.
//  wall  잉크 장벽: 조준한 칸을 가운데로 조준 방향에 수직인 len 칸에 임시 블록(time 초 — 폭발에 부서진다). 바닥 칸에만(홈 띠 · 퀴즈 존 ·
//        전광판 · 점프 보드 · 블록 칸 · 캐릭터 · 아이템 · 설치물이 있는 칸은 건너뛴다)
//  trap  끈끈이 덫: 바닥에 놓는다(홈 띠 제외). arm 초 뒤부터 적이 r 안을 밟으면 slow 초 느려지고 push(u/s)로 살짝 밀린다(한 번 쓰면 사라짐).
//        팀마다 max 개(넘으면 가장 오래된 것이 사라진다), life 초가 지나면 사라진다. 다른 팀에게는 흐릿하게(faint)만 보인다
//  smoke 연막: 반지름 r 의 구름 time 초(가리는 것은 화면이 한다 — 서버는 자리 · 반지름 · 팀 · 끝나는 시각만 알린다)
//  rally 집결 깃발: time 초 동안 그 팀이 KO 뒤 홈 대신 깃발 둘레에서 부활(퀴즈 오답의 홈 소환은 그대로 홈). 팀마다 1개(새로 꽂으면 옛것이 뽑힌다).
//        적 폭발 한 방에 꺾인다(폭발 반경 + r 안). 퀴즈 존 안 · 블록 칸에는 못 꽂는다. 아케이드(부활 없음)에서는 쓰지 못한다
//  aegis 나눔 보호막: 반지름 r 안의 같은 팀(나 포함) 모두에게 보호막 time 초(SHIELD 효과 그대로 — 더 길게 남은 막은 그대로)
//  spray 회복 스프레이: 반지름 r 안의 같은 팀(나 포함) 체력 +hp
export const GADGET_BASE = 13;
export const GADGETS = [
  { kind: 13, key: "wall", ammo: 2, place: true, range: 8, len: 3, time: 8 },
  { kind: 14, key: "trap", ammo: 3, place: true, range: 7, r: 0.9, slow: 2.5, push: 5, arm: 0.6, max: 4, life: 60 },
  { kind: 15, key: "smoke", ammo: 2, place: true, range: 11, r: 3.5, time: 6 },
  { kind: 16, key: "rally", ammo: 1, place: true, range: 2.5, r: 0.7, time: 20 },
  { kind: 17, key: "aegis", ammo: 1, place: false, r: 4, time: 4 },
  { kind: 18, key: "spray", ammo: 2, place: false, r: 4, hp: 30 },
];
/** key → 설치물 항목(GADGET.wall.time 처럼 이름으로 읽는다) */
export const GADGET = Object.fromEntries(GADGETS.map((g) => [g.key, g]));
export const KIND_COUNT = GADGET_BASE + GADGETS.length; // 종류 번호의 개수(소지품 칸 수) = 19
export const GADGET_CD = 0.5; // 설치물을 쓴 뒤 다음 던지기까지(초)

/** 종류 번호의 설치물 항목. 설치물이 아니면 null. */
export const gadgetOf = (kind) => (Number.isInteger(kind) && kind >= GADGET_BASE && kind < KIND_COUNT ? GADGETS[kind - GADGET_BASE] : null);
export const isGadget = (kind) => gadgetOf(kind) !== null;
/** 소지품에 들고 무기로 고를 수 있는 종류인가(풍선 · 설치물. 에너지 · 부스터 · 보호막은 아니다). */
export function isHeld(kind) {
  if (!Number.isInteger(kind) || kind < 0 || kind >= KIND_COUNT) return false;
  const K = BALLOON_KINDS[kind];
  return K ? !K.pickup : true;
}
/** 그 종류를 한 번 먹으면 드는 개수. 들 수 없는 종류는 0. */
export function heldAmmo(kind) {
  if (!isHeld(kind)) return 0;
  const K = BALLOON_KINDS[kind];
  return K ? K.ammo : gadgetOf(kind).ammo;
}
// 아이템 쟁여 두기(docs/DESIGN.md §2.12 · v14 사용자 요청): 같은 종류를 또 먹으면 한 번 먹는 양(ammo)만큼 더 쌓인다 —
// 종류마다 STACK.MAX 개까지(잉크 풍선 · 설치 · 지원 아이템 모두). 메가 잉크 폭탄(합성으로만 생긴다)은 한 번 먹은 양까지.
// 소지품 한 칸은 규약 8 부터 한 바이트(0~255)라 MAX 를 올려도 규약은 그대로다.
export const STACK = { MAX: 30 };
/** 그 종류를 소지품에 쌓아 둘 수 있는 최대 개수. 이만큼 든 종류의 아이템은 줍지 않는다. 들 수 없는 종류는 0. */
export function stackCap(kind) {
  const one = heldAmmo(kind);
  if (!one) return 0;
  const K = BALLOON_KINDS[kind];
  if (K && K.nuke) return one;
  return Math.max(one, STACK.MAX);
}
// 롱샷(사거리 늘림 — docs/DESIGN.md §2.12 끝): 부스터 · 보호막처럼 "먹는 즉시 걸리는 강화". TIME 초 동안 던지는 사거리가 SCALE 배
// (풍선의 RANGE_MAX · 미사일 · 드릴의 비행 거리 · 유도 미사일의 수명 — 서버 판정 · 예측 · 조준 표시가 rangeScale(p) 하나를 쓴다).
// 다시 먹으면 시간이 처음부터. 시야(안개)는 늘지 않는다. 소지품에 들지 않는다(종류 번호가 KIND_COUNT 밖 — 맵 아이템 번호로만 쓴다)
export const RANGE_KIND = 19;
export const RANGE_UP = { TIME: 12, SCALE: 1.5 };
/** 그 플레이어가 지금 던지는 사거리 배율(롱샷이 걸려 있으면 RANGE_UP.SCALE, 아니면 1) */
export const rangeScale = (p) => (p && p.range > 0 ? RANGE_UP.SCALE : 1);

/** 종류 번호 → 영문 key("basic" … "drill", "energy" · "boost" · "shield", "wall" … "spray", "range"). 모르면 "". 애셋 · 렌더러 · 문구가 이 key 를 쓴다 */
export function kindKey(kind) {
  if (kind === RANGE_KIND) return "range";
  const K = Number.isInteger(kind) ? BALLOON_KINDS[kind] : null;
  if (K) return K.key;
  const G = gadgetOf(kind);
  return G ? G.key : "";
}
/** 영문 key → 종류 번호 */
export const KIND_OF = Object.fromEntries([...BALLOON_KINDS.map((k, i) => [k.key, i]), ...GADGETS.map((g) => [g.key, g.kind]), ["range", RANGE_KIND]]);
/** 새 아이템 9종의 종류 번호(맵에 뜨는 순서 — ITEM_MIX 의 key 순서) */
export const NEW_ITEM_KINDS = ["firework", "vortex", "drill", "wall", "trap", "smoke", "rally", "aegis", "spray"].map((k) => KIND_OF[k]);
/** 무기 막대(Q/E)에 늘어놓는 순서: 들 수 있는 종류를 번호 순으로 */
export const HELD_ORDER = Array.from({ length: KIND_COUNT }, (_, k) => k).filter(isHeld);

// 새 아이템 9종이 맵에 뜨는 가중치(ITEM 의 저울 — 풍선 weight · BOOST_WEIGHT · SHIELD_WEIGHT · ENERGY_WEIGHT 와 같은 저울에 더한다).
// 잉크 운동장(칸 격자)에서 채널 설정 items "all"(기본)일 때만 뜬다. 퀴즈: 방해 · 지원이 더 자주, 아케이드: 공격이 더 자주(집결 깃발은 부활이 없어 0)
export const ITEM_MIX = {
  quiz: { firework: 1.0, vortex: 0.8, drill: 1.0, wall: 1.5, trap: 1.5, smoke: 1.2, rally: 1.0, aegis: 1.2, spray: 1.4, range: 1.0 },
  arcade: { firework: 1.8, vortex: 1.4, drill: 1.5, wall: 0.8, trap: 0.8, smoke: 0.6, rally: 0, aegis: 0.6, spray: 1.0, range: 1.3 },
};
export const ITEM_SETS = ["all", "basic"]; // 채널 설정 items: "all" 새 아이템까지 · "basic" 기존 것만
export const DEFAULT_ITEM_SET = "all";

// 팀 전략 장치(docs/DESIGN.md §2.13)의 수치. 규칙 함수는 shared/teamplay.js(서버 · 화면이 같이 쓴다)
export const TEAMPLAY = {
  SCRUM_R: 3, // 스크럼: 나를 포함한 같은 팀 SCRUM_N 명 이상이 내 둘레 SCRUM_R(u) 안에 있으면
  SCRUM_N: 3,
  SCRUM_KB: 0.75, // 받는 넉백 배율(−25%)
  CATCH_BONUS: 1.3, // 끈끈이 · 덫에 느려졌거나 소용돌이에 끌려가는 적이 받는 넉백 · 피해 배율(+30%)
  PULL_GRACE: 0.3, // 소용돌이 밖으로 벗어난 뒤에도 이만큼(초)은 "걸린" 것으로 친다(마지막 폭발이 보너스를 받게)
  COMBO_TIME: 0.5, // 합동 폭발: 같은 팀의 다른 사람이 일으킨 폭발과 COMBO_TIME 초 · COMBO_DIST(u) 안에서 겹치면
  COMBO_DIST: 2,
  COMBO_SPLASH: 1.25, // 뒤의 폭발의 반경 배율
  PING_KINDS: ["gather", "go", "block", "help"], // 팀 신호: 모여 · 여기로(우리 팀 목표) · 막아 · 도와줘
  PING_WINDOW: 2, // 한 사람이 PING_WINDOW 초에 PING_BURST 번까지
  PING_BURST: 3,
};

// 전장의 안개(docs/DESIGN.md §3.8). 팀이 시야를 함께 쓴다: 살아 있는 팀원마다 반지름 R, 우리 홈 띠 둘레 HOME_PAD, 우리 집결 깃발 둘레 RALLY_R.
// 장애물은 시야를 가리지 않는다(단순한 원). 판정은 shared/fog.js(서버 · 화면이 같이 쓴다). 채널 설정 fog(기본 켬), 퀴즈 · 아케이드 모두
// (통합 검증 — 사용자 지시: 화면을 더 넓게 보게 되어(1u ≈ 34px) 9 → 11u. 홈 둘레 · 깃발 둘레도 같은 비율로 4 → 5 · 6 → 7.3)
export const FOG = { R: 11, HOME_PAD: 5, RALLY_R: 7.3 };

// 채팅(docs/DESIGN.md §2.14). 경기 중 채팅은 채널 설정 chat 을 따른다: "free" 켬(직접 입력) · "off" 끔(팀 신호만 — 신호는 늘 된다).
// 빠른 말은 없다(v13). 옛 값 "quick" 이 오면 "free" 로 받는다(server/lobby.js)
export const CHAT = { MODES: ["free", "off"], DEFAULT: "free", MATCH_MAX: 40, LOBBY_MAX: 120 };

// 메가 잉크 폭탄 합성(수집 카드): 한 경기 동안 KINDS 의 아이템을 종류마다 한 번씩 먹으면(카드에 도장) 폭탄 한 발이
// 저절로 생겨 곧바로 손에 들린다. 먹은 풍선은 하나도 쓰지 않는다(소지품 그대로). 합성하면 카드가 빈다(쓰러져도 카드는 남는다).
// 이미 폭탄을 들고 있으면 합성하지 않는다(카드는 다 찬 채로 남아 다음 재료를 먹을 때 합성된다)
export const FUSE = { KINDS: [1, 2, 3, 4], INTO: 5 };

// 잉크 미사일의 비행. 궤적은 (출발점, 방향)으로 정해진 직선이고 높이는 그대로다.
export const MISSILE = {
  SPEED: 30, // u/s
  RANGE: 16, // 이만큼 날아가면 허공에서 터진다
  HEIGHT: 1.0, // 날아가는 높이(캐릭터 몸통)
  CD: 0.42, // 연사 간격(초). 누르고 있으면 이 간격으로 계속 나간다
};

// 유도 미사일의 비행. 서버는 목표의 실제 위치로, 화면은 보이는 위치로 같은 함수(shared/sim.js 의 homingStep)를 돌린다 — 명중은 서버가 정한다.
export const HOMING = {
  SPEED: 17, // u/s(미사일보다 느려 휘는 것이 보인다)
  TURN: 3.4, // 최대 각속도(rad/s) — 회전 반지름 5u: 가까이서 옆으로 크게 피하면 못 따라온다
  ARM: 0.12, // 처음 이만큼(초)은 조준한 방향으로 곧게 나간다
  LIFE: 1.8, // 이만큼 날아도 못 맞히면 허공에서 터진다
  LOCK_RADIUS: 6, // 조준점에서 이 거리 안의 적 중 가장 가까운 적을 노린다
  CONE: 0.6, // 그런 적이 없으면 조준 방향 ±이 각도(rad) 안, RANGE 안에서 가장 가까운 적
  RANGE: 20,
  STEP: 1 / 120, // 비행을 이 간격으로 쪼개 돌린다(프레임 · 틱 간격과 상관없이 같은 길)
};

// 점프 보드: 경기장 바닥의 보드(arena 의 pads) 위에 서면 위로 SPEED 로 튀어 오른다(약 3.9u · 1초 체공).
// 공중에서는 평소처럼 방향을 조종한다. 체력전은 둘레 벽이 높이와 상관없이 막아 아무리 높이 떠도 밖으로 나가지 않는다
export const PAD = { SPEED: 16 };

// 맵에 뜨는 아이템(풍선 종류 하나를 담고 있다).
// 먹은 것은 종류별로 따로 쌓인다(소지품). 잉크는 같은 종류를 또 먹으면 ammo 발씩 더 쌓여 stackCap(종류)까지, 그만큼 든 종류의 아이템은 줍지 않는다.
export const ITEM = {
  PICK_RADIUS: 1.1, // 이 거리 안으로 들어오면 자동으로 먹는다
  SPAWN_EVERY: 1.6, // 목표 개수보다 모자랄 때 하나씩 생기는 간격(초)
  BASE: 3, // 목표 개수 = min(MAX, round((BASE + 인원 × PER_FIGHTER) × 맵 배율))
  PER_FIGHTER: 0.6,
  MAX: 24,
  EDGE_MARGIN: 1.6, // 바닥 가장자리 · 기둥에서 이만큼 떨어진 곳에만 생긴다
  SPACING: 3.5, // 아이템끼리의 최소 거리
  SLOW_FACTOR: 0.5, // 끈끈이에 맞은 동안의 이동 속도 배율
  ENERGY_WEIGHT: 3, // 에너지(체력 회복) 아이템이 뽑힐 가중치(풍선 종류의 weight 와 같은 저울)
  ENERGY_WEIGHT_HP: 5, // 체력전에서는 에너지가 더 자주 나온다
  BOOST_WEIGHT: 2, // 부스터(이동 · 점프 강화) 아이템이 뽑힐 가중치
  SHIELD_WEIGHT: 1.5, // 보호막 아이템이 뽑힐 가중치
};

// 아이템 종류 번호 가운데 "에너지"(체력 회복). 풍선 종류(BALLOON_KINDS 의 index)와 겹치지 않는 값이다.
// 먹으면 체력이 HP.ENERGY 만큼 차고(최대 HP.MAX), 체력이 가득이면 줍지 않는다.
export const ENERGY_KIND = 9;

// 아이템 종류 번호 가운데 "부스터". 먹으면 BOOST.TIME 초 동안 더 빨리 달리고(SPEED 배) 더 높이 뛴다(점프 속도 JUMP 배 —
// 최고 높이는 JUMP² 배, 약 2.4u 라 체력전의 엄폐벽 · 기둥 위에도 올라선다). 다시 먹으면 시간이 처음부터 다시 흐른다
export const BOOST_KIND = 10;
export const BOOST = { TIME: 8, SPEED: 1.35, JUMP: 1.25 };

// 아이템 종류 번호 가운데 "보호막". 먹으면 SHIELD.TIME 초 동안 몸을 감싼 막이 잉크를 막는다(다시 먹으면 시간이 처음부터).
//  - 막에 닿은 풍선 · 미사일은 터지지 않고 바깥쪽으로 튕겨 나간다. 튕긴 것은 막 주인의 것이 되어(색 · 팀도) 던진 사람을 맞힐 수 있다
//    (유도 미사일은 던진 사람을 쫓아간다). 한 풍선은 MAX_BOUNCE 번까지만 튕기고, 그다음 막에 닿으면 그 자리에서 터진다
//  - 곁에서 터진 폭발(메가 잉크 폭탄 포함)도 막 주인에게는 아무 영향이 없다(넉백 · 잉크 · 피해 · 끈끈이 모두)
//  - 대시 박치기는 막지 못한다(몸으로 밀어내는 것이 맞수다). 같은 팀의 풍선은 원래대로 막을 지나간다
export const SHIELD_KIND = 11;
export const SHIELD = {
  TIME: 10,
  R: 1.05, // 막의 반지름(발에서 CY 위가 중심 — 몸 전체를 감싼다)
  CY: 0.8,
  ARC_DIST: 4.5, // 튕긴 풍선이 날아가 떨어지는 거리
  ARC_APEX: 0.9, // 튕긴 풍선의 포물선 높이(출발 높이 위로 더해진다)
  LINE_DIST: 10, // 튕긴 미사일이 다시 날아가는 거리(그 끝 허공에서 터진다)
  HOMING_LIFE: 1.4, // 튕긴 유도 미사일의 남은 비행 시간
  MAX_BOUNCE: 2,
};

// 체력. 풍선에 맞으면 줄고, 0 이 되면 쓰러진다(낙하전은 부활, 체력전은 탈락).
// 풍선 한 방의 피해 = (소형 SMALL | 대형 BIG) × 종류의 dmg × 거리 감쇠(직격은 × DIRECT_BONUS).
export const HP = {
  MAX: 100,
  SMALL: 12,
  BIG: 22,
  DIRECT_BONUS: 1.3,
  BUMP: 6, // 대시 박치기 피해
  ENERGY: 35, // 에너지 아이템 하나의 회복량
};

// 점프. 위로 SPEED(u/s) 로 뛰어오른다(중력 PLAYER.GRAVITY 아래 최고 높이 약 1.54u — 틱 단위 적분이라 공식값 1.63 보다 조금 낮다).
// 낮은 상자 · 허들은 그냥 넘고, 엄폐벽(1.7)은 공중제비를 더해야, 기둥(2.4)은 부스터를 먹어야 올라선다.
// 드론(v16 — 사용자 요청, 던전): 방 공중에 떠 있는 드론 밑에서 뛰어오르면 올라탄다. TIME 초 동안 벽 위를 날아다니며(우리 팀이 연 곳만 —
// 레인 바깥 벽 · 아직 열지 않은 방은 못 들어간다) 풍선을 던질 수 있고, 타는 동안은 피해를 받지 않는다. 끝나기 BLINK 초 전부터 깜빡이다 사라지고
// 탄 사람은 가까운 바닥으로 내려온다. 사라진 드론은 RESPAWN 초 뒤 제자리에 다시 뜬다.
export const DRONE = {
  TIME: 7, // 탈 수 있는 시간(초 — v16.1 사용자 요청 15 → 7)
  BLINK: 2, // 끝나기 이만큼 전부터 깜빡인다(초)
  Y: 2.1, // 탄 사람의 발 높이(u — 단단한 블록 1.5u 위)
  HOVER: 2.4, // 빈 드론이 떠 있는 높이(u — 드론 몸통 가운데)
  MOUNT_R: 1.5, // 드론과 이만큼(수평 u) 가까운 데서 뛰어오르면 올라탄다
  MOUNT_Y: 0.7, // 발이 이 높이 위에 있어야 탄다(뛰어올랐을 때)
  RISE: 8, // 올라탈 때 DRONE.Y 로 다가가는 빠르기(1/s, 지수)
  SPEED: 1.15, // 타는 동안 걷기 빠르기 배율
  RESPAWN: 25, // 사라진 드론이 다시 뜨기까지(초)
};

export const JUMP = {
  SPEED: 10.2,
  // 공중제비: 공중에서 한 번 더 누르면(땅에 닿기 전 AIR_MAX 번) 위로 AIR_SPEED 를 준다 — 이미 더 빨리 오르는 중이면 그대로.
  // 정점에서 쓰면 약 0.38u 더 올라 최고 약 1.92u(체공 약 0.82초)
  AIR_SPEED: 5.2,
  AIR_MAX: 1,
  STEP_UP: 0.05, // 발 높이보다 이만큼 낮은(또는 같은) 장애물 윗면은 막지 않는다(그 위를 걷는다)
  DODGE: 0.55, // 발이 폭발 지점보다 (폭발 반경 × 이 값) 넘게 높으면 맞지 않는다(점프로 피하기)
};

// 경기 방식. 방장이 대기실에서 고른다(docs/DESIGN.md §2.1). 두 방식 모두 팀전이고 같은 벽 경기장을 쓴다.
//  quiz:   퀴즈 모드 — 쓰러지면(KO) MATCH.RESPAWN 초 뒤 자기 팀 진영에서 부활한다. 퀴즈 룸 · 문제는 server/quiz.js(M4)가 붙인다.
//          퀴즈가 붙지 않은 경기(M0)는 제한 시간이 끝나면 결과로 간다(승패 없음).
//  arcade: 아케이드 모드 — ink-brawl 의 체력전 팀전 그대로. 체력이 다하면 탈락(관전), 시간이 다 되면 살아남은 수 → 남은 체력 합.
// 화면에 내놓지 않는 방식: "fall"(낙하전 — 네온 풀 경기장, 떨어지면 KO · 부활). 시뮬레이션과 시험을 위해 서버 Room 이 아직 받는다.
export const MODES = [
  { key: "quiz", name: T.modes.quiz },
  { key: "arcade", name: T.modes.arcade },
];
export const DEFAULT_MODE = "quiz"; // 새 채널의 처음 경기 방식

/** 그 경기 방식이 벽 경기장(shared/arena.js 의 HP_ARENA — 떨어지지 않는다)을 쓰는가. "fall" 만 네온 풀이다. */
export const isWalledMode = (mode) => mode === "quiz" || mode === "arcade" || mode === "hp";

// 제한 시간(초). 방장이 대기실에서 고른다(docs/DESIGN.md §2.1). 퀴즈 모드의 기본은 M4 에서 "문제 수 × 60초"로 바뀐다.
export const ROUND_TIMES = { quiz: [300, 480, 600, 900], arcade: [120, 180, 300] };
export const DEFAULT_ROUND_TIME = { quiz: 300, arcade: 180 };

// 팀전의 팀(최대 6). color = 그 팀 모두가 쓰는 PALETTE 색 번호(핫핑크 · 시안 · 라임 · 오렌지 · 퍼플 · 옐로).
// 이름은 shared/texts/game.js 의 teams. 한 경기의 팀 수는 방장이 고른다(TEAM_COUNTS, 기본 DEFAULT_TEAM_COUNT)
export const TEAMS = [{ color: 0 }, { color: 1 }, { color: 2 }, { color: 3 }, { color: 4 }, { color: 5 }];
export const MAX_TEAMS = TEAMS.length;
export const TEAM_COUNTS = [2, 3, 4, 5, 6];
export const DEFAULT_TEAM_COUNT = 2;

// 풍선 궤적은 (출발점, 도착점, 출발 시각)만으로 결정된다. 서버·클라이언트가 같은 식을 쓴다.
export function balloonFlightTime(dist, big) {
  return 0.42 + dist * 0.036 + (big ? 0.1 : 0);
}
export function balloonApex(dist) {
  return 1.4 + dist * 0.2;
}

export const HIT = {
  HITSTOP: 0.09, // 직격 시 멈칫하는 시간(초)
  STUN: 0.45, // 넉백 뒤 조작이 둔해지는 시간
  KB_DECAY: 2.3, // 넉백 속도 감쇠(1/s, 지수)
  INK_KB_SCALE: 60, // 넉백 배율 = 1 + ink / 이 값
  DIRECT_BONUS: 1.35, // 직격 넉백 배율
  POP_UP: 6.5, // 맞았을 때 위로 튀는 속도
  FALLOFF_MIN: 0.45, // 폭발 가장자리에서의 세기 비율
  INK_MAX: 300,
};

export const MATCH = {
  ROUND_TIME: 150, // 경기 방식의 제한 시간(ROUND_TIMES)을 쓰지 않는 경기(낙하전 · 시험)의 길이
  COUNTDOWN: 3,
  RESULTS: 9,
  KO_Y: -6, // 이 높이 아래로 떨어지면 KO
  RESPAWN: 2.2,
  INVULN: 1.6,
  CREDIT_WINDOW: 7, // 마지막으로 맞힌 사람에게 KO 를 주는 시간 창
};

export const PHASE = { COUNTDOWN: 0, PLAY: 1, RESULTS: 2 };

// 맵 크기: 같은 경기장을 수평으로 이 배율만큼 키운다(높이는 그대로). 방장이 채널 설정에서 고른다.
// 배율 1 은 지름 22u(8명이 붙어 싸우는 크기)다. 풍선 사거리는 13u 로 고정이라 클수록 추격과 자리 싸움이 길어진다.
export const MAP_SIZES = [
  { scale: 1.5, name: T.mapSizes[0] },
  { scale: 2.2, name: T.mapSizes[1] },
  { scale: 3, name: T.mapSizes[2] },
];
export const DEFAULT_MAP = 1.5;

export const NET = {
  INPUT_REDUNDANCY: 3, // 입력 패킷 하나에 최근 입력을 몇 개 겹쳐 싣는가(비신뢰 채널 손실 대비)
  MAX_REWIND: 0.15, // 던지기 지연 보상 한도(초)
  // 원격 플레이어 보간 지연(초) = 스냅샷 1.5 주기 + 지터 × 2.5 를 이 범위로 자른다. 20Hz 에서 한 주기 50ms —
  // 하한 0.08 이면 스냅샷 하나가 늦거나 빠져도(비신뢰 채널) 다음 것이 오기 전에 버퍼가 바닥나지 않는다
  INTERP_MIN: 0.08,
  INTERP_MAX: 0.25,
  EXTRAPOLATE: 0.12, // 버퍼가 바닥났을 때 마지막 속도로 이어 가는 한도(초)
  MAX_INPUT_QUEUE: 8,
};

// 플레이어 상태 플래그(스냅샷의 flags 바이트)
export const FLAG = {
  ALIVE: 1,
  CHARGING: 2,
  DASHING: 4,
  FALLING: 8,
  BOT: 16,
  GROUNDED: 32,
  INVULN: 64,
  SLOWED: 128, // 끈끈이에 맞아 느려진 상태
};

// 입력 버튼 비트. DASH · JUMP 는 누른 순간 한 번만 실린다(서버는 입력을 되풀이할 때 이 둘을 지운다)
export const BTN = { CHARGE: 1, DASH: 2, JUMP: 4 };
export const BTN_PULSE = BTN.DASH | BTN.JUMP;


// ---------------------------------------------------------------------------------------------- 화면 투영
// 시점은 하나로 고정된 아핀 투영이다(카메라 회전 · 확대 없음 — docs/DESIGN.md §3.1, docs/CONTRACT.md 「좌표와 투영」).
//   시점의 요(YAW)는 0° 로 고정이라 상수가 없다(src/render/camera.js 의 YAW — 화면 위 = 월드 −z).
//   sx = x·PPU                             sy = z·PPU·SQUASH − y·PPU·LIFT      (아트 픽셀, 화면 y 는 아래로)
//   깊이 = z(클수록 앞). 스프라이트 한 장의 깊이는 발밑 점의 z 하나다.
// 애셋을 굽는 쪽(tools/art)과 렌더러(src/render/camera.js)가 같은 값을 쓴다. 값을 바꾸면 아틀라스를 다시 구워야 한다.
export const VIEW = {
  PPU: 16, // 월드 1u = 아트 픽셀 16
  SQUASH: 0.75, // 바닥이 세로로 눌리는 비율(sprite-stacking 의 squash)
  LIFT: 1.0, // 높이 1u 가 화면에서 올라가는 양(PPU 배). sprite-stacking 의 층 간격(spacing) 1.0
  ART_H: 270, // 내부 해상도의 세로(아트 픽셀) 목표. 화면에는 정수 배율로 올린다(1080p 에서 4배)
  ART_MIN_W: 300, // 세로 화면에서도 가로가 이만큼은 보이게 배율을 고른다
  LOOK_AHEAD: 2.2, // 카메라가 조준 방향으로 앞서 보는 거리(u)
  FOLLOW: 9, // 카메라가 따라가는 빠르기(1/s, 지수)
};

// ---------------------------------------------------------------------------------------------- 퀴즈 모드
// 부서지는 블록 · 블록 높이(docs/DESIGN.md §5.1 · §7.2). 블록은 캐릭터를 높이와 상관없이 막는다(순수한 2차원 칸 판정).
// 포물선 풍선은 그 칸 블록의 높이보다 높이 날면 넘어가고, 낮으면 블록에 맞아 터진다. 바깥 벽은 풍선도 넘지 못한다.
// 곧게 나는 미사일 · 유도 미사일(MISSILE.HEIGHT 1.0)은 블록에 막힌다
export const BLOCK = {
  SOLID_H: 1.5, // 단단한 블록 높이(풍선이 이보다 높으면 넘어간다)
  BREAK_H: 1.1, // 부서지는 블록 높이
  BOARD_H: 3.2, // 전광판 받침(풍선이 넘지 못한다 — 전광판에 가려진다)
  ITEM_CHANCE: 0.2, // 부서질 때 아이템이 나올 확률(맵 위 아이템 상한은 지킨다)
  REGROW: 25, // 퀴즈 모드: 부서진 블록이 다시 자라기까지(초). 아케이드는 다시 자라지 않는다
  REGROW_CLEAR: 1, // 다시 자랄 칸 둘레 이만큼(u, 반 칸) 안에 캐릭터 · 아이템이 있으면 비워질 때까지 미룬다
};

// 퀴즈 룸 · 존 · 풀이의 수치(docs/DESIGN.md §2.2~§2.9). 쓰는 곳은 server/quiz.js 와 화면(src/quizstate.js).
export const QUIZ = {
  MAX_ROOMS: 5, // 룸 수 = min(MAX_ROOMS, 문제 수)
  ZONE_R_BASE: 3.5, // 존 반지름 = ZONE_R_BASE + ZONE_R_PER × 가장 큰 팀의 인원
  ZONE_R_PER: 0.35,
  ZONE_R_MAX: 6, // 한 팀이 아주 클 때(두 팀 × 18명 같은) 존이 이웃 룸 · 엄폐벽에 닿지 않게 자르는 상한 — 경기장 배치가 이 값을 기준으로 짜여 있다
  BOARD_DIST: 9, // 전광판은 존의 화면 위쪽으로 이만큼(u)
  ENTER_TIME: 2, // 팀 전원이 존 안에 들어온 순간부터 이만큼(초) 머물면 입장(사용자 확정 — 컴퓨터 팀원 포함)
  ENTER_TIME_LEADER: 2.5, // 따라잡기 도움: 1위 팀의 게이지 시간
  ENTER_TIME_STALE: 1, // 교착 방지: STALE_AFTER 초 동안 아무도 못 들어간 룸의 게이지 시간
  STALE_AFTER: 30,
  HIT_SETBACK: 0.5, // 존 안에서 잉크에 맞으면 게이지가 이만큼(초) 뒤로
  SOLVE_TIMES: [10, 15, 20, 30], // 풀이 시간 선택지(초)
  DEFAULT_SOLVE: 15,
  WINDUP: 0.6, // 카드를 고른 뒤 정답 폭탄이 나가기까지(서버가 확정)
  ANSWER_GRACE: 0.6, // 문제가 뜬 뒤 이만큼(초)은 카드에 던져도 받지 않는다(싸우던 던지기가 이어져 실수로 고르지 않게 — 화면 · 던전 서버)
  REVOTE: 1.5, // 다시 던지기 간격
  JUDGE_DELAY: 1.5, // 팀 전원이 제출한 뒤 판정까지(그 사이에도 고쳐 던질 수 있다)
  REENTRY: 8, // 풀이를 마친 팀이 그 룸에 다시 들어가지 못하는 시간
  EXIT_INVULN: 1.6, // 성공하고 룸에서 나온 뒤 무적
  AFK: 15, // 이만큼 입력이 없는 사람은 입장 · 만장일치 인원에서 뺀다
  ZONE_RATE: 5, // {k:"zone"} 통지 빈도(Hz, 사람이 있는 룸만)
  PER_QUESTION: 60, // 제한 시간 기본값 = 문제 수 × 이 값(초)
  QUESTION_COUNTS: [5, 10, 0], // 방장이 고르는 문제 수(0 = 전부)
  DEFAULT_QUESTION_COUNT: 10,
  REWARD_KINDS: [1, 2, 3, 4], // 성공 보상 특수 풍선: 맞힌 수에 따라 대왕 → 삼발 → 끈끈이 → 미사일 순환(합성 카드에도 도장)
  FENCE_PAD: 0.15, // 울타리는 존 가장자리에서 이만큼 바깥(다른 팀은 r + 반지름 + 이 값 밖으로 밀린다)
  EXIT_GAP: 1.4, // 성공한 팀을 룸 밖으로 내보낼 때 울타리 바깥으로 이만큼(u)
  PUSH_CREDIT: 1.2, // 존 밖으로 밀려난 사람을 이 시간(초) 안에 맞힌 적에게 밀어내기를 준다
  BOT_ACCURACY: { low: 0.4, mid: 0.65, high: 0.85 }, // 혼자 연습: 컴퓨터 팀의 정답률(난이도 하 · 중 · 상)
  BOT_THINK: [1.5, 4.5], // 사람이 없는 컴퓨터 팀이 카드를 고르기까지(초, 이 사이에서 무작위)
  BOT_FOLLOW: [0.8, 1.5], // 사람이 있는 팀의 컴퓨터가 사람 팀원이 가장 많이 던진 카드를 따라 던지기까지(초)
  BOT_GATHER: 8, // "모여" 신호를 받은 컴퓨터가 신호한 사람 곁으로 가는 시간(초)
  BOT_NEAR: 6, // 사람 팀원이 룸 존 가장자리에서 이만큼(u) 안이면 컴퓨터는 그 룸 존으로 들어가 선다(아니면 그 팀원 곁)
  PRESENTERS_MAX: 2, // 한 채널의 진행자(캐릭터 없이 보는 화면) 수 한도
};

// 퀴즈 모드의 제한 시간 기본값: 문제 수 × PER_QUESTION 을 ROUND_TIMES.quiz 의 가장 가까운 값으로(같으면 긴 쪽)
export function quizRoundTime(n) {
  const want = Math.max(1, n | 0) * QUIZ.PER_QUESTION;
  let best = ROUND_TIMES.quiz[0];
  for (const t of ROUND_TIMES.quiz) if (Math.abs(t - want) <= Math.abs(best - want)) best = t;
  return best;
}

// ---------------------------------------------------------------------------------------------- 던전 유형(v15 — docs/DESIGN.md §2.15)
// 퀴즈 모드 · 아케이드 모드 모두에 고를 수 있는 "유형". 팀마다 벽으로 막힌 자기 레인(맵의 네 귀퉁이 → 가운데)에서만 움직이고 다른 팀과는
// 마주치지도 싸우지도 않는다. 레인의 방마다 몬스터(NPC)가 있고, 그 방의 몬스터를 모두 물리치면 다음 방(가운데 쪽)으로 가는 문이 열린다.
// 가운데의 목표에 가장 먼저 닿은 팀이 이긴다. 가운데로 갈수록 몬스터가 크고 세다.
// 퀴즈 모드: 몬스터를 하나 물리칠 때마다 팀에게 문제가 뜬다(팀 전원이 각자 정답 — 퀴즈 룸과 같은 규칙). 맞히면 그 몬스터는 그대로 쓰러져 있고,
// 못 맞히면 그 몬스터가 다시 살아난다. 아케이드 모드: 문제 없이 물리치면 끝.
export const DUNGEON = {
  MAX_TEAMS: 4, // 레인이 넷(맵에 2 × 2 로 놓인 팀마다의 큰 던전)이라 던전은 4팀까지
  STAGES: 5, // 큰길의 몬스터 방 수(1 → … → 5, 5 가 목표 방 바로 앞의 왕의 방) — shared/arena.js 의 D_STAGES 와 같다
  // 몬스터 종류(kind — 화면 모델 src/render/monsters.js 의 MONSTER_KINDS 와 같은 번호). stage = 나오는 방(가운데에 가까울수록 크고 세다),
  // scale = 크기(판정 반지름 R × scale), hp = 체력(팀 인원 배율 hpScale 을 곱한다), speed = 걷는 빠르기(u/s), touch · kb = 몸에 닿으면 주는 피해 · 넉백.
  // 공격(없는 것은 빠진다 — 모두 미리 알린다: 웅크림 · 바닥 경고 고리 · 겨누기):
  //   lunge  달려들기 — 표적이 range 안이면 wind 초 웅크렸다가 time 초 동안 speed 배로 돌진(돌진 중에 닿으면 touch 피해)
  //   slam   내려찍기 — 표적이 반경 r 안이면 발밑에 경고 고리, wind 초 뒤 반경 안 피해(뛰어오르면 피한다)
  //   spin   휩쓸기 — slam 과 같지만 뛰어도 맞는다(고리 밖으로 나가야 피한다)
  //   shoot  먹물 쏘기 — 표적이 range 안이면 wind 초 겨눴다가 count 발을 spread(라디안) 부채꼴로 쏜다. 곧게 speed(u/s)로 날아가 벽 · 기둥에 막히고
  //          life 초 뒤 사라진다(옆으로 피한다). keep = 표적과 이만큼 떨어지려 한다
  //   toss   폭탄 던지기 — 표적이 range 안이면 wind 초 뒤 표적 자리(둘레 scatter 안에 count 개)로 던진다. 떨어질 자리에 경고 고리가 뜨고
  //          fly 초 뒤 반경 r 안 피해(고리 밖으로 피한다)
  //   charge 돌진 — 표적이 range 안이면 wind 초 앞발을 긁다가 그 쪽으로 time 초 동안 speed 배로 곧게 달린다(닿으면 dmg). 벽에 박으면 stun 초 기절 —
  //          기절한 동안은 weak 배로 아프게 맞는다
  //   leap   도약 강타 — 표적이 range 안이면 wind 초 웅크렸다가 표적 자리로 뛰어올라 air 초 뒤 내려앉는다. 내려앉을 자리에 경고 고리(반경 r),
  //          닿으면 dmg. wave 가 있으면 내려앉을 때 충격파도 일으킨다
  //   wave   충격파 — 표적이 range 안이면 wind 초 한 발을 들었다가 쿵: 몸에서 둥근 파도가 speed(u/s)로 r 까지 퍼진다. 파도가 지나갈 때 바닥에 서 있으면
  //          맞는다(뛰어넘는다)
  // rage = 체력이 이 비율 아래로 떨어지면 분노 — 빠르기 × 1.25, 공격 간격 × 0.65(한 번만)
  // fly = 떠다닌다(화면) · weave = 쫓을 때 좌우로 흔들리는 폭(맞히기 어렵다), boss = 왕(체력 막대 눈금)
  MONSTERS: [
    /* 0 꼬마 잉크 슬라임 */ { kind: 0, stage: 1, scale: 1.0, hp: 110, speed: 3.6, touch: 10, kb: 8,
      lunge: { range: 6, wind: 0.5, time: 0.4, speed: 3.2, every: [2.2, 3.6] } },
    /* 1 뿔 잉크 도깨비(방망이) */ { kind: 1, stage: 2, scale: 1.6, hp: 300, speed: 3.2, touch: 15, kb: 10,
      slam: { r: 3.4, dmg: 20, kb: 12, wind: 0.95, every: [3.4, 5] },
      spin: { r: 3.3, dmg: 16, kb: 14, wind: 0.75, every: [4, 6] } },
    /* 2 잉크 대왕(거인 마왕) */ { kind: 2, stage: 3, scale: 2.8, hp: 900, speed: 2.8, touch: 20, kb: 12, boss: true, rage: 0.4,
      slam: { r: 4.6, dmg: 26, kb: 15, wind: 1.05, every: [3.4, 4.8] },
      leap: { range: 13, wind: 0.7, air: 1.0, r: 3.6, dmg: 30, kb: 16, every: [5, 7] },
      wave: { range: 11, wind: 0.85, speed: 7, r: 10, w: 0.9, dmg: 18, kb: 12, every: [4.5, 6.5] } },
    /* 3 잉크 박쥐 */ { kind: 3, stage: 1, scale: 0.95, hp: 75, speed: 4.4, touch: 8, kb: 6, fly: true, weave: 1.5,
      lunge: { range: 7.5, wind: 0.38, time: 0.35, speed: 3.4, every: [1.5, 2.6] } },
    /* 4 잉크 고블린(폭탄) */ { kind: 4, stage: 1, scale: 1.0, hp: 120, speed: 3.4, touch: 9, kb: 7, keep: 4.5,
      toss: { range: 10, wind: 0.6, fly: 1.0, r: 2.1, dmg: 14, kb: 10, count: 1, scatter: 0, every: [2.4, 3.6] } },
    /* 5 먹물 오징어 */ { kind: 5, stage: 2, scale: 1.5, hp: 240, speed: 2.9, touch: 12, kb: 8, keep: 5.5,
      shoot: { range: 12, wind: 0.6, every: [2, 3], speed: 9, dmg: 12, kb: 9, r: 0.35, count: 3, spread: 0.32, life: 1.6 } },
    /* 6 돌진 멧돼지 */ { kind: 6, stage: 2, scale: 1.55, hp: 300, speed: 3.0, touch: 16, kb: 11,
      charge: { range: 14, wind: 0.8, time: 1.0, speed: 3.6, every: [3, 4.4], dmg: 22, kb: 16, stun: 1.8, weak: 1.5 } },
    /* 7 잉크 거미 여왕 */ { kind: 7, stage: 3, scale: 2.6, hp: 850, speed: 3.0, touch: 18, kb: 12, boss: true, rage: 0.4,
      shoot: { range: 14, wind: 0.8, every: [3, 4.2], speed: 8, dmg: 14, kb: 10, r: 0.42, count: 5, spread: 0.95, life: 1.9 },
      leap: { range: 12, wind: 0.6, air: 0.85, r: 3.2, dmg: 26, kb: 14, every: [4.5, 6.5] },
      toss: { range: 13, wind: 0.7, fly: 1.1, r: 2.2, dmg: 14, kb: 10, count: 3, scatter: 3.2, every: [5, 7] } },
  ],
  RAGE: { SPEED: 1.25, EVERY: 0.65 },
  // 급(tier)마다 나올 수 있는 종류: s 작은 것 · m 중간 · b 왕. 경기마다 섞은 차례로 돌려 쓴다 — 모든 레인이 같은 차례다(공정하게)
  LINEUP: { s: [0, 3, 4], m: [1, 5, 6], b: [2, 7] },
  // 몬스터 무리(v16 — 사용자 요청 "한 번에 여러 마리 · 팀 인원에 따라"): 방에 우리 팀이 처음 들어서면 첫 무리가 솟고, 무리를 다 물리치면 다음 무리.
  // n = 그 순간 우리 팀의 센 인원(컴퓨터 포함 — 자리 비운 사람 · 뺀 사람 제외). 방마다 무리 목록 [[급, 수], …] 을 돌려준다.
  //   1 · 2번 방: 작은 것 / 3 · 4번 방: 중간 + 작은 것 / 5번 방(왕의 방): 왕 + 작은 것(왕이 분노하면 작은 것이 더 나온다) / 곁방: 작은 것
  PACKS: (area, n) => {
    n = Math.max(1, Math.min(8, n | 0));
    const s = Math.min(8, 1 + n), h = Math.max(1, Math.ceil(n * 0.6)), m = n <= 2 ? 1 : n <= 4 ? 2 : 3;
    if (area === 1) return [[["s", s]]];
    if (area === 2) return [[["s", s]], [["s", h]]];
    if (area === 3) return [[["m", m], ["s", h]], [["s", h]]];
    if (area === 4) return [[["m", m], ["s", h]], [["m", m]]];
    if (area === 5) return [[["b", 1], ["s", h]]];
    return [[["s", h + 1]]]; // 곁방
  },
  RAGE_PACK: (n) => [["s", Math.max(1, Math.ceil(Math.max(1, n) * 0.6))]], // 왕이 분노하면 더 나오는 무리
  WAVE_DELAY: 1.2, // 무리를 다 물리친 뒤 다음 무리가 솟기까지(초)
  QUIZ_COUNT: 3, // 퀴즈 던전: 문제 몬스터를 물리친 뒤 3 · 2 · 1 을 세고 문제가 뜬다(초 — 그동안 우리 팀 몬스터 · 폭탄이 멈춘다. 사용자 요청: 몬스터를 치던 던지기가 이어져 문제를 실수로 풀지 않게)
  R: 0.7, // 몬스터 판정 반지름(× scale)
  H: 1.5, // 몬스터 판정 높이(× scale) — 풍선이 이보다 높이 지나가면 맞지 않는다
  AGGRO: 15, // 이 거리 안의 우리 레인 팀원을 쫓는다(그 밖이면 제자리로 돌아간다)
  TOUCH_CD: 1.0, // 몸으로 한 번 친 뒤 다음까지(초)
  SPAWN_T: 1.0, // 몬스터가 바닥에서 솟아오르는 시간(그동안 맞지 않고 움직이지 않는다)
  REVIVE_T: 1.2, // 퀴즈를 못 맞혀 몬스터가 다시 살아나기까지(초)
  RESPAWN: 7, // 쓰러진 사람은 이만큼(초) 뒤 우리 팀이 마지막으로 깬 방의 나가는 문턱(처음에는 출발 방)에서 부활(던전은 탈락이 없다 — v16.2 사용자 요청 3 → 7초)
  REGEN_DELAY: 4, // 이만큼(초) 맞지 않으면 체력이 차오른다
  REGEN_HP: 6, // 초당 체력 회복
  DROP: 0.75, // 몬스터가 쓰러질 때 아이템이 나올 확률
  CLEAR_INVULN: 1.6, // 방을 깨고 문이 열릴 때 팀 전원 무적(초)
  ITEMS_PER_LANE: 6, // 레인마다 바닥에 떠 있는 아이템 목표 수(레인끼리 같은 자리 · 같은 종류로 놓는다 — 공정하게)
  ITEM_EVERY: 7, // 아이템 보충 간격(초)
  SNAP_EVERY: 3, // 몬스터 상태 사건(mon)을 몇 틱마다 보내나(60Hz / 3 = 20Hz — 스냅샷과 같다)
  hpScale: (n) => 0.55 + 0.45 * Math.max(1, n), // 팀의 센 인원 n → 왕의 체력 배율(1명 1배, 4명 2.35배). 작은 것 · 중간은 수로 맞추므로 체력은 그대로
};

// 세션 복귀: 접속이 끊긴 사람의 채널 자리 · 경기 기록을 이만큼(초) 남겨 둔다. 같은 세션 토큰으로 다시 붙으면 그대로 돌아온다
export const RESUME_WINDOW = 60;
