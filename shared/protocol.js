// 통신 규약 v2(docs/DESIGN.md §15). 스냅숏만 바이너리, 그 밖은 JSON 글자 프레임({ t: "…" }).
//
// ── 스냅숏(서버 → 브라우저, 10Hz, 팀마다 시야로 거른다) ──
// 머리 27바이트: u8 형식(3) · u32 틱 · u16 남은 초 · u8 단계(PHASE) · u8 팀 수 · u16 유닛 수 · u16 건물 수 · u8 섹션 수 · u8 보석 수
//               · u16 탄 수 · u8 아이템 수 · u8 예비 · u8×8 팀 점수(MAX_TEAMS — v2.2 U14 에서 6 → 8)
// 유닛 18바이트: u16 id · u8 type(UTYPE) · u8 팀(255 중립) · u8 주인(플레이어 번호, 255 없음) · u8 sub · u8 info · u16 x · u16 y(1/64칸)
//               · u8 z(발 높이 u × 20) · u8 방향(256 = 한 바퀴) · u8 체력 비율 · u8 동작(ANIM) · u8 동작 값(0..255 — 충전 정도 · 진행) · u16 깃발(UF)
//     sub : 영웅 · 일꾼 · 잉크봇 = 인형 종류(0..7), 몬스터(PET · NPC) = 몬스터 kind
//     info: 영웅 = 무기 번호, 일꾼 = 든 것(0 없음 · 1 잉크 · 2 골드 · 3 코어 — RES_KINDS[info-1]), 내 몬스터 = 레벨(1..5), 중립 = 0
// 건물 11바이트: u16 id · u8 kind(BLD) · u8 팀 · u8 tx · u8 ty · u8 체력 비율 · u8 진행(짓기 · 하는 일 0..255) · u8 깃발(BF) · u8 단계 · u8 남은 초(꺾임 · 고장)
// 섹션 8바이트: u8 id · u8 상태(SITE_STATE) · u8 방어막 비율 · u8 바위 비율 · u8 팀(풀이 중 · 255) · u8 남은 초 · u8 점수 · u8 예비
// 보석 10바이트: u8 id · u8 상태(0 바닥 · 1 들림) · u16 든 유닛 id(65535 없음) · u16 x · u16 y · u8 점수 · u8 돌아가기까지 남은 초
// 탄 9바이트(곧게 나는 것 — 미사일 · 유도 · 드릴 · 몬스터 먹물): u16 id · u8 종류(무기 번호, 몬스터 먹물은 100 + kind) · u8 팀 · u16 x · u16 y · u8 방향
// 아이템 7바이트: u16 id · u8 종류(ITEMS 번호) · u16 x · u16 y
//
// ── 서버 → 브라우저 JSON ──
//  start { seed, teams, map, mode: "arcade"|"quiz", minutes, goal, you, players: [{ name, team, bot, char }], crates: [깨진 상자 칸 번호…],
//          out: [탈락한 팀 번호…](다시 들어올 때), lives: HERO.LIVES }
//  me    { hp, maxHp, tank, ink, w, cd, bombCd, dead(부활까지 초, 살아 있으면 0), carry(든 보석 점수 · 0), slow, stun, boost, shield, invuln,
//          kos, deaths, delivered, heroId, pet: { kind, level, state: "none"|"hatching"|"alive", t, hp } (쓰러지면 none — 다시 사야 한다),
//          counts: { worker, bot }, queue: [{ what, t, total }], lock: { [섹션 id]: 남은 초 },
//          inv: [무기 번호마다 남은 개수…](WEAPONS 길이 · inv[0] 은 늘 0 = 기본 잉크는 끝이 없다),
//          lives(남은 목숨 — 지금 것 포함, 0 = 영웅 탈락), heroOut(영웅이 다시 나오지 않는다 — 지휘만, U26), teamOut(우리 팀 탈락 — 구경만, U27) }
//  (U31 개인 지갑) me 에 gold · core · ink(내 지갑)와 made: { gold, core, ink }(내가 캔 양) · spent · given 이 더 붙는다. team 의 ink · gold · core 는 팀원 지갑의 합(보기만)
//  team  { ink, gold, core, lab: { lv, job, unlocked: [무기 번호…], research: { key: true } , broken }, fac: { lv, job, research, broken, dex: [kind…] },
//          supplies, score: [팀별 점수], kos: [팀별 KO] }      job = { kind: "unlock"|"level"|"research"|"hatch", key, t(지난 초), total } | null
//  fx    { e: [사건…] } — 사건 k:
//          throw { id }                                   던지는 동작
//          arc   { x0, y0, z0, x1, y1, t, w, big, team }  포물선 풍선(브라우저가 같은 식으로 날린다 — flightTime · flightApex)
//          boom  { x, y, r, team, w, big }               폭발(바닥 잉크 · 효과)
//          hit   { id, dmg, x, y }                       맞음(번쩍 · 숫자)
//          ko    { id, x, y, team }                       쓰러짐
//          warn  { x, y, r, t, shape: "ring"|"wave" }     몬스터 공격 예고
//          slam  { x, y, r }                              내려찍기 · 충격파 터짐
//          crate { i }                                    상자 깨짐(칸 번호)
//          bdown { id, kind, team }                       건물 무너짐 · 고장 · 탑 꺾임
//          gem   { ev: "pop"|"pick"|"drop"|"score"|"return"|"steal", team, x, y, value }
//          spawn { id }                                   유닛이 나타남
//          refill{ id }                                   잉크 채우는 중(띄엄띄엄)
//          item  { ev: "pick", x, y, kind }
//          pull  { x, y, r, t }                           소용돌이
//  kb    { vx, vy, stun, slow }  — 내 영웅이 밀림(주인에게만). 브라우저가 속도에 더한다
//  warp  { x, y }                — 서버가 내 영웅 위치를 정함(부활 · 검사 실패)
//  quiz  { site, q: { text, choices: [..] }, time } · quizResult { ok, answer, explain } · quizClose {}
//  brief { ready, total } — "이기는 방법"을 닫은 사람 수(U32) · count { playTick } — 이 틱에 모든 팀이 함께 시작한다(스냅숏 틱으로 남은 초를 센다)
//  note  { text, kind } · score { team, value, by } · end { winner, ranking, players, reason: "goal"|"time"|"last" }
//  elim  { team, by, reason: "tower"|"heroes", left: [남은 팀 번호…] } — 한 팀이 탈락했다(모두에게, U27). by = 탑을 부순 팀(heroes 면 -1)
//
// ── 브라우저 → 서버 JSON ── mv · throw · weapon · cmd · train · place · lab · fac · answer (docs/DESIGN.md §15)
//   ready {} — "이기는 방법" 카드를 닫았다(U32). 모두 보내면(컴퓨터 · 끊긴 사람은 늘 준비) 5초 세기가 함께 시작한다
//   give { to: 받는 사람 번호(같은 팀 · 탈락하지 않은 팀), res: "gold"|"core"|"ink", amount } — 내 지갑에서 팀원에게 보낸다(U31). 받는 쪽에 note
//   buy { w } — 랩에서 연 무기 w 한 묶음(WEAPONS[w].pack)을 팀 골드로 사서 내 소지품에 더한다(stackMax 를 넘으면 안 된다 · 랩 고장 중엔 안 된다)
//   weapon { w } — w = 0(기본) 이거나 내 소지품에 1개 이상 있을 때만 바꿔 든다
//   cmd gather 의 target = { res: "ink"|"gold"|"core", i: ponds · mines · cores 번호 } (i 가 없으면 그 자원의 가장 가까운 곳)
//   fac act = hatch(kind — 코어로 산다) · level · level-fac · research · release (부활 없음)
import { POS_SCALE, MAX_TEAMS } from "./constants.js";

export const SNAP = 3;
export const HEAD = 27, UNIT_B = 18, BLD_B = 11, SITE_B = 8, GEM_B = 10, PROJ_B = 9, ITEM_B = 7;

export const PHASE = Object.freeze({ COUNTDOWN: 0, PLAY: 1, END: 2, BRIEF: 3 }); // BRIEF = "이기는 방법"을 읽는 중(U32 — 모두 닫으면 COUNTDOWN)
export const ANIM = Object.freeze({ IDLE: 0, MOVE: 1, THROW: 2, CHARGE: 3, GATHER: 4, BUILD: 5, WIND: 6, ATTACK: 7, KO: 8, SPAWN: 9, STUN: 10, DASH: 11, QUIZ: 12 });
export const UF = Object.freeze({
  GEM: 1, // 보석을 이고 있다
  INK: 2, // 일꾼이 잉크를 들고 있다
  SLOW: 4,
  SHIELD: 8,
  BOOST: 16,
  INVULN: 32,
  SQUAD: 64, // 영웅 분대로 따라다니는 중
  RAGE: 128,
  REFILL: 256, // 공급소에서 채우는 중
  DRY: 512, // 탱크가 비었다(한 발도 못 던진다)
  DOWN: 1024, // 쓰러져 있다(KO 연출 중)
  HATCH: 2048, // 막 나오는 중
  IDLE: 4096, // 일꾼이 할 일이 없다 — 명령을 기다린다(머리 위 "일 시켜주세요!", U17)
});
export const BF = Object.freeze({ BUILT: 1, BROKEN: 2, DOWN: 4, BUSY: 8, HIT: 16 });
export const NO_ID = 65535;

const TAU = Math.PI * 2;
const ratio = (hp, max) => (hp <= 0 ? 0 : Math.max(1, Math.min(255, Math.ceil((hp / max) * 255))));
const u8 = (v) => Math.max(0, Math.min(255, Math.round(v || 0)));
const u16 = (v) => Math.max(0, Math.min(65535, Math.round(v || 0)));
const pos = (v) => u16(v * POS_SCALE);
const ang = (a) => Math.round(((((a || 0) % TAU) + TAU) % TAU) / TAU * 256) & 255;

/**
 * s = { tick, timeLeft, phase, teams, scores: [..],
 *       units: [{ id, type, team, owner, sub, info, x, y, z, facing, hp, maxHp, anim, animT(0..1), flags }],
 *       buildings: [{ id, kind, team, tx, ty, hp, maxHp, progress(0..1), flags, level, timer }],
 *       sites: [{ id, state, shield(0..1), rock(0..1), team, timer, value }],
 *       gems: [{ id, state, carrier, x, y, value, timer }],
 *       projs: [{ id, kind, team, x, y, dir }], items: [{ id, kind, x, y }] }
 */
export function encodeSnapshot(s) {
  const U = s.units || [], B = s.buildings || [], Si = s.sites || [], G = s.gems || [], P = s.projs || [], I = s.items || [];
  const buf = new ArrayBuffer(HEAD + U.length * UNIT_B + B.length * BLD_B + Si.length * SITE_B + G.length * GEM_B + P.length * PROJ_B + I.length * ITEM_B);
  const v = new DataView(buf);
  v.setUint8(0, SNAP);
  v.setUint32(1, s.tick >>> 0);
  v.setUint16(5, u16(Math.ceil(s.timeLeft || 0)));
  v.setUint8(7, s.phase | 0);
  v.setUint8(8, s.teams | 0);
  v.setUint16(9, U.length);
  v.setUint16(11, B.length);
  v.setUint8(13, Si.length);
  v.setUint8(14, G.length);
  v.setUint16(15, P.length);
  v.setUint8(17, I.length);
  v.setUint8(18, 0);
  for (let t = 0; t < MAX_TEAMS; t++) v.setUint8(19 + t, u8((s.scores || [])[t]));
  let o = HEAD;
  for (const u of U) {
    v.setUint16(o, u.id);
    v.setUint8(o + 2, u.type);
    v.setUint8(o + 3, u.team);
    v.setUint8(o + 4, u.owner < 0 || u.owner == null ? 255 : u.owner);
    v.setUint8(o + 5, u8(u.sub));
    v.setUint8(o + 6, u8(u.info));
    v.setUint16(o + 7, pos(u.x));
    v.setUint16(o + 9, pos(u.y));
    v.setUint8(o + 11, u8((u.z || 0) * 20));
    v.setUint8(o + 12, ang(u.facing));
    v.setUint8(o + 13, ratio(u.hp, u.maxHp));
    v.setUint8(o + 14, u.anim | 0);
    v.setUint8(o + 15, u8((u.animT || 0) * 255));
    v.setUint16(o + 16, (u.flags || 0) & 0xffff);
    o += UNIT_B;
  }
  for (const b of B) {
    v.setUint16(o, b.id);
    v.setUint8(o + 2, b.kind);
    v.setUint8(o + 3, b.team);
    v.setUint8(o + 4, b.tx);
    v.setUint8(o + 5, b.ty);
    v.setUint8(o + 6, ratio(b.hp, b.maxHp));
    v.setUint8(o + 7, u8((b.progress || 0) * 255));
    v.setUint8(o + 8, b.flags || 0);
    v.setUint8(o + 9, u8(b.level));
    v.setUint8(o + 10, u8(Math.ceil(b.timer || 0)));
    o += BLD_B;
  }
  for (const x of Si) {
    v.setUint8(o, x.id);
    v.setUint8(o + 1, x.state);
    v.setUint8(o + 2, u8((x.shield || 0) * 255));
    v.setUint8(o + 3, u8((x.rock || 0) * 255));
    v.setUint8(o + 4, x.team == null || x.team < 0 ? 255 : x.team);
    v.setUint8(o + 5, u8(Math.ceil(x.timer || 0)));
    v.setUint8(o + 6, u8(x.value));
    v.setUint8(o + 7, 0);
    o += SITE_B;
  }
  for (const g of G) {
    v.setUint8(o, g.id);
    v.setUint8(o + 1, g.state);
    v.setUint16(o + 2, g.carrier == null || g.carrier < 0 ? NO_ID : g.carrier);
    v.setUint16(o + 4, pos(g.x));
    v.setUint16(o + 6, pos(g.y));
    v.setUint8(o + 8, u8(g.value));
    v.setUint8(o + 9, u8(Math.ceil(g.timer || 0)));
    o += GEM_B;
  }
  for (const p of P) {
    v.setUint16(o, p.id);
    v.setUint8(o + 2, p.kind);
    v.setUint8(o + 3, p.team);
    v.setUint16(o + 4, pos(p.x));
    v.setUint16(o + 6, pos(p.y));
    v.setUint8(o + 8, ang(p.dir));
    o += PROJ_B;
  }
  for (const it of I) {
    v.setUint16(o, it.id);
    v.setUint8(o + 2, it.kind);
    v.setUint16(o + 3, pos(it.x));
    v.setUint16(o + 5, pos(it.y));
    o += ITEM_B;
  }
  return buf;
}

export function decodeSnapshot(buf) {
  const v = buf instanceof DataView ? buf : new DataView(buf.buffer ? buf.buffer : buf, buf.byteOffset || 0, buf.byteLength);
  if (v.getUint8(0) !== SNAP) return null;
  const s = {
    tick: v.getUint32(1), timeLeft: v.getUint16(5), phase: v.getUint8(7), teams: v.getUint8(8),
    scores: Array.from({ length: MAX_TEAMS }, (_, t) => v.getUint8(19 + t)),
    units: [], buildings: [], sites: [], gems: [], projs: [], items: [],
  };
  const nU = v.getUint16(9), nB = v.getUint16(11), nS = v.getUint8(13), nG = v.getUint8(14), nP = v.getUint16(15), nI = v.getUint8(17);
  let o = HEAD;
  for (let i = 0; i < nU; i++, o += UNIT_B) {
    const own = v.getUint8(o + 4);
    s.units.push({
      id: v.getUint16(o), type: v.getUint8(o + 2), team: v.getUint8(o + 3), owner: own === 255 ? -1 : own,
      sub: v.getUint8(o + 5), info: v.getUint8(o + 6),
      x: v.getUint16(o + 7) / POS_SCALE, y: v.getUint16(o + 9) / POS_SCALE, z: v.getUint8(o + 11) / 20,
      facing: (v.getUint8(o + 12) / 256) * TAU, hp: v.getUint8(o + 13) / 255,
      anim: v.getUint8(o + 14), animT: v.getUint8(o + 15) / 255, flags: v.getUint16(o + 16),
    });
  }
  for (let i = 0; i < nB; i++, o += BLD_B) {
    s.buildings.push({
      id: v.getUint16(o), kind: v.getUint8(o + 2), team: v.getUint8(o + 3), tx: v.getUint8(o + 4), ty: v.getUint8(o + 5),
      hp: v.getUint8(o + 6) / 255, progress: v.getUint8(o + 7) / 255, flags: v.getUint8(o + 8), level: v.getUint8(o + 9), timer: v.getUint8(o + 10),
    });
  }
  for (let i = 0; i < nS; i++, o += SITE_B) {
    const tm = v.getUint8(o + 4);
    s.sites.push({
      id: v.getUint8(o), state: v.getUint8(o + 1), shield: v.getUint8(o + 2) / 255, rock: v.getUint8(o + 3) / 255,
      team: tm === 255 ? -1 : tm, timer: v.getUint8(o + 5), value: v.getUint8(o + 6),
    });
  }
  for (let i = 0; i < nG; i++, o += GEM_B) {
    const c = v.getUint16(o + 2);
    s.gems.push({
      id: v.getUint8(o), state: v.getUint8(o + 1), carrier: c === NO_ID ? -1 : c,
      x: v.getUint16(o + 4) / POS_SCALE, y: v.getUint16(o + 6) / POS_SCALE, value: v.getUint8(o + 8), timer: v.getUint8(o + 9),
    });
  }
  for (let i = 0; i < nP; i++, o += PROJ_B) {
    s.projs.push({
      id: v.getUint16(o), kind: v.getUint8(o + 2), team: v.getUint8(o + 3),
      x: v.getUint16(o + 4) / POS_SCALE, y: v.getUint16(o + 6) / POS_SCALE, dir: (v.getUint8(o + 8) / 256) * TAU,
    });
  }
  for (let i = 0; i < nI; i++, o += ITEM_B) {
    s.items.push({ id: v.getUint16(o), kind: v.getUint8(o + 2), x: v.getUint16(o + 3) / POS_SCALE, y: v.getUint16(o + 5) / POS_SCALE });
  }
  return s;
}
