// 브라우저 쪽 경기 상태(v2 「깃발의 탑」): 지도(씨앗으로 다시 만든다) · 깨진 상자 · 막힌 칸 표(내 영웅 충돌) · 스냅숏 버퍼와 보간 ·
// 서버가 따로 보내는 내 정보(me) · 팀 정보(team) · 우리 팀 시야(안개 그리기).
//
// 좌표는 지도 칸(1 = 한 칸). 화면 변환은 render/brawlscene.js 가 한다.
import { generateMap, fillBlocked } from "../shared/map.js";
import { TILE, TICK, INTERP_DELAY, UTYPE, UNITS, HERO, BUILDINGS, BLD, NPC, NEUTRAL, SITE_STATE, GEM, INK, mapKey } from "../shared/constants.js";
import { BF, UF } from "../shared/protocol.js";

const TAU = Math.PI * 2;
const lerpAngle = (a, b, t) => {
  const d = ((((b - a) % TAU) + TAU * 1.5) % TAU) - TAU / 2;
  return a + d * t;
};
/** 바위가 서 있는 섹션 상태(방어막 아래 · 드러남 · 풀이 중) */
export const rockUp = (state) => state === SITE_STATE.SHIELD || state === SITE_STATE.ROCK || state === SITE_STATE.QUIZ;

export function createWorld(start) {
  const map = generateMap(start.seed, start.teams, mapKey(start.map));
  const S = map.size;
  // 깨진 상자는 지도 칸을 바닥으로 바꿔 둔다(fillBlocked 가 지도 칸을 읽는다)
  for (const i of start.crates || []) if (map.tiles[i] === TILE.CRATE) map.tiles[i] = TILE.FLOOR;
  const blk = new Uint8Array(S * S);
  const vis = new Uint8Array(S * S);
  const explored = new Uint8Array(S * S);
  const snaps = [];
  let offset = null;
  const you = Number.isInteger(start.you) ? start.you : -1;
  const players = start.players || [];
  const team = you >= 0 && players[you] ? players[you].team : -1;
  const out = new Set(start.out || []); // 탈락한 팀(U27)
  let blkKey = "";

  const w = {
    map, S, blk, vis, explored, start, players, you, team,
    spectator: team < 0 || out.has(team), // 진행자 · 탈락한 팀(구경만)
    out, // 탈락한 팀 번호들(U27)
    outInfo: new Map(), // 팀 → { reason: "tower"|"heroes", by, order } — elim 을 받은 차례
    livesMax: start.lives || HERO.LIVES, // 영웅 목숨(U26)
    mode: start.mode === "quiz" ? "quiz" : "arcade",
    goal: start.goal || 10,
    teams: map.teams,
    me: null, // 내 영웅 · 일꾼 줄 · 내 몬스터(4Hz + 바뀔 때)
    info: null, // 팀 정보(team 메시지 — 잉크 · 코어 · 랩 · 퍼실리티 · 점수)
    latest: null,
    timeLeft: (start.minutes || 15) * 60,
    phase: 0,
    scores: new Array(8).fill(0), // 팀 점수(스냅숏 — 8팀까지)
    blkVersion: 0, // 막힌 칸 표가 바뀔 때마다 1 씩(내 영웅이 벽 안에 갇혔는지 다시 본다)
    cratesDirty: [], // 이번에 깨진 상자 칸 번호(화면이 블록을 지운다)
    meAt: 0, // 마지막 me 를 받은 시각(performance.now — 탱크 막대가 채우는 동안 앞질러 그린다)
    heroRefillAt: 0, // 내 영웅의 refill 사건을 마지막으로 받은 시각
        /** 내 영웅 자리(내 브라우저가 정한 것 — hero.js 가 프레임마다 적는다). 시야 · 미니맵이 쓴다 */
    heroPos: null,

    push(s) {
      const now = performance.now() / (TICK * 1000);
      const est = s.tick - now;
      if (offset === null || Math.abs(est - offset) > 6) offset = est;
      else offset = est > offset ? offset + (est - offset) * 0.5 : offset + (est - offset) * 0.05;
      s.byId = new Map();
      for (const u of s.units) s.byId.set(u.id, u);
      s.gemById = new Map();
      for (const g of s.gems) s.gemById.set(g.id, g);
      s.projById = new Map();
      for (const p of s.projs) s.projById.set(p.id, p);
      snaps.push(s);
      if (snaps.length > 14) snaps.shift();
      w.latest = s;
      w.timeLeft = s.timeLeft;
      w.phase = s.phase;
      w.scores = s.scores;
      w.refreshBlocked();
    },

    /** 상자가 깨졌다(fx crate) */
    breakCrate(i) {
      if (i < 0 || i >= S * S || map.tiles[i] !== TILE.CRATE) return;
      map.tiles[i] = TILE.FLOOR;
      w.cratesDirty.push(i);
      blkKey = "";
      w.refreshBlocked();
    },

    /** 건물 · 바위가 바뀌었으면 막힌 칸 표를 다시 만든다(shared/map.js fillBlocked — 서버와 같은 것) */
    refreshBlocked() {
      const s = w.latest;
      const bs = s ? s.buildings : [];
      const ss = s ? s.sites : [];
      let key = "";
      for (const b of bs) key += `${b.id}:${b.kind}:${b.tx}:${b.ty};`;
      key += "|";
      for (const x of ss) key += rockUp(x.state) ? "1" : "0";
      if (key === blkKey) return;
      blkKey = key;
      const sites = ss.map((x) => {
        const m = map.sites[x.id];
        return m ? { tx: m.tx, ty: m.ty, rock: rockUp(x.state) } : null;
      }).filter(Boolean);
      fillBlocked(map, blk, bs, sites);
      w.blkVersion++;
    },

    /** 지금 그릴 모습 — 두 스냅숏 사이를 보간한 유닛 · 보석 · 탄(건물 · 섹션 · 아이템은 나중 것 그대로) */
    sample() {
      if (!snaps.length) return null;
      const now = performance.now() / (TICK * 1000);
      const rt = now + offset - INTERP_DELAY / TICK;
      let a = snaps[0], b = snaps[snaps.length - 1];
      if (rt >= b.tick) a = b;
      else for (let i = snaps.length - 1; i > 0; i--) if (snaps[i - 1].tick <= rt) { a = snaps[i - 1]; b = snaps[i]; break; }
      const t = a === b ? 1 : Math.max(0, Math.min(1, (rt - a.tick) / (b.tick - a.tick)));
      const units = [];
      for (const ub of b.units) {
        const ua = a.byId.get(ub.id);
        if (!ua || t >= 1 || Math.hypot(ub.x - ua.x, ub.y - ua.y) > 4) { units.push(ub); continue; }
        units.push({ ...ub, x: ua.x + (ub.x - ua.x) * t, y: ua.y + (ub.y - ua.y) * t, z: ua.z + (ub.z - ua.z) * t, facing: lerpAngle(ua.facing, ub.facing, t) });
      }
      const gems = b.gems.map((gb) => {
        const ga = a.gemById.get(gb.id);
        if (!ga || t >= 1 || ga.state !== gb.state) return gb;
        return { ...gb, x: ga.x + (gb.x - ga.x) * t, y: ga.y + (gb.y - ga.y) * t };
      });
      const projs = b.projs.map((pb) => {
        const pa = a.projById.get(pb.id);
        if (!pa || t >= 1) return pb;
        return { ...pb, x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, dir: lerpAngle(pa.dir, pb.dir, t) };
      });
      const byId = new Map();
      for (const u of units) byId.set(u.id, u);
      return { units, byId, gems, projs, buildings: b.buildings, sites: b.sites, items: b.items, tick: rt };
    },

    /** 우리 팀 시야(안개 그리기 · 미니맵). 서버도 팀마다 걸러 보내므로 보이는 모양만 맞춘다 */
    computeVision() {
      const s = w.latest;
      vis.fill(0);
      if (w.spectator) { vis.fill(1); explored.fill(1); return; }
      if (!s) return;
      const stamp = (x, y, r) => {
        const cx = Math.floor(x), cy = Math.floor(y), R = Math.ceil(r);
        const r2 = r * r + 0.5;
        for (let yy = Math.max(0, cy - R); yy <= Math.min(S - 1, cy + R); yy++) {
          const dy = yy - cy;
          for (let xx = Math.max(0, cx - R); xx <= Math.min(S - 1, cx + R); xx++) {
            const dx = xx - cx;
            if (dx * dx + dy * dy > r2) continue;
            const i = yy * S + xx;
            vis[i] = 1;
            explored[i] = 1;
          }
        }
      };
      const heroId = w.me?.heroId;
      for (const u of s.units) {
        if (u.team !== w.team) continue;
        if (u.id === heroId && w.heroPos) continue;
        const r = u.type === UTYPE.HERO ? HERO.SIGHT : u.type === UTYPE.WORKER ? UNITS.worker.sight : u.type === UTYPE.BOT ? UNITS.bot.sight : NPC.SIGHT;
        stamp(u.x, u.y, r);
      }
      if (w.heroPos && !(w.me && w.me.dead > 0)) stamp(w.heroPos.x, w.heroPos.y, HERO.SIGHT);
      for (const b of s.buildings) if (b.team === w.team) {
        const def = BUILDINGS[b.kind];
        stamp(b.tx + def.size / 2, b.ty + def.size / 2, def.sight + def.size / 2);
      }
    },

    // ── 묻기 ──
    playerName(slot) { return players[slot]?.name || ""; },
    charOf(slot) { const c = players[slot]?.char; return Number.isInteger(c) ? c : ((slot % 8) + 8) % 8; },
    isMine(u) { return you >= 0 && u.owner === you; },
    isEnemyTeam(t) { return t !== w.team && t !== NEUTRAL; },
    /** 우리 팀이 쓸 수 있는 공급소(다 지었고 무너지지 않았다) */
    mySupplies() {
      const s = w.latest;
      if (!s) return [];
      return s.buildings.filter((b) => b.team === w.team && b.kind === BLD.SUPPLY && b.flags & BF.BUILT && !(b.flags & BF.BROKEN));
    },
    nearestSupply(x, y) {
      let best = null, bd = Infinity;
      for (const b of w.mySupplies()) {
        const c = BUILDINGS[b.kind].size / 2;
        const d = Math.hypot(b.tx + c - x, b.ty + c - y);
        if (d < bd) { bd = d; best = b; }
      }
      return best;
    },
    myBuilding(kind) {
      const s = w.latest;
      return s ? s.buildings.find((b) => b.team === w.team && b.kind === kind) || null : null;
    },
    /** 팀 연구 표(무기 랩) */
    research() { return w.info?.lab?.research || {}; },
    /** 내 소지품에 남은 개수(v2.2 — me.inv). 기본 잉크(0)는 끝이 없다(Infinity). inv 가 없으면(옛 서버) 기본만 */
    invCount(n) {
      const wo = w;
      if (!n) return Infinity;
      const inv = Array.isArray(wo.me?.inv) ? wo.me.inv : null;
      return inv ? Math.max(0, inv[n] | 0) : 0;
    },
    /** 소지품 칸(무기 막대 순서): 기본 잉크 + 1개 이상 가진 무기 */
    slots() {
      const inv = Array.isArray(w.me?.inv) ? w.me.inv : [];
      const out = [0];
      for (let i = 1; i < inv.length; i++) if ((inv[i] | 0) > 0) out.push(i);
      return out;
    },
    /** 우리 팀이 연 무기(기본 잉크는 늘) — 랩 판 */
    unlocked() {
      const list = w.info?.lab?.unlocked || [];
      const out = [0];
      for (const k of list) if (k > 0 && !out.includes(k)) out.push(k);
      return out.sort((a, b) => a - b);
    },
    /** 한 팀이 탈락했다(elim — U27). 우리 팀이면 구경하기로 바뀐다(온 지도가 보인다) */
    eliminate(m) {
      if (!Number.isInteger(m.team) || m.team < 0) return;
      if (!out.has(m.team)) w.outInfo.set(m.team, { reason: m.reason || "", by: m.by ?? -1, order: out.size });
      out.add(m.team);
      if (m.team === w.team) w.setSpectator();
    },
    setSpectator() {
      if (w.spectator) return;
      w.spectator = true;
      vis.fill(1);
      explored.fill(1);
    },
    /** 내 지갑(U31 — me 의 gold · core · ink). 옛 서버(me 에 gold 가 없다)면 팀 창고(team)를 그대로 */
    wallet() {
      const m = w.me;
      if (m && Number.isFinite(m.gold)) return { gold: m.gold || 0, core: m.core || 0, ink: m.ink || 0, own: true };
      const t = w.info || {};
      return { gold: t.gold || 0, core: t.core || 0, ink: t.ink || 0, own: false };
    },
    /** 팀원(나를 뺀 같은 팀 사람 — 보내기 받을 사람). 컴퓨터도 넣는다(🤖) */
    teammates() {
      const out = [];
      players.forEach((p, i) => { if (p && i !== you && p.team === team) out.push({ slot: i, name: p.name, bot: !!p.bot }); });
      return out;
    },
        /** 내 영웅이 더 나오지 않는다(목숨을 다 썼다 — 지휘관, U26) */
    heroOut() { return !!w.me?.heroOut && !w.spectator; },
    /** 내 영웅이 지금 공급소에서 채우는 중인가 — 스냅숏의 UF.REFILL 이 먼저, 없으면 막 받은 refill 사건(0.7초 안) */
    heroRefilling() {
      const id = w.me?.heroId;
      const u = id != null ? w.latest?.byId?.get(id) : null;
      if (u && u.flags & UF.REFILL) return true;
      return performance.now() - w.heroRefillAt < 700;
    },
        /** 보석을 든 동안 던질 수 없나(아케이드 — GEM.CARRY_ATTACK) */
    carryBlocksThrow() { return !GEM.CARRY_ATTACK[w.mode]; },
    tankMax: INK.TANK,
  };
  return w;
}
