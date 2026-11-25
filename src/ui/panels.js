// 건물 판(docs/DESIGN.md §6~§9 · §12): 아래 가운데에 뜨는 블랙라이트 포스터 판 — 깃발의 탑(뽑기) · 잉크 공급소(팀 잉크 · 채우기 안내 ·
// 공급소 짓기) · 잉크 무기 랩(단계 · 무기 열기 · 연구) · 몬스터 퍼실리티(내 몬스터 · 부화 · 레벨 업 · 특기 · 부활 · 단계 · 연구).
// 값은 team · me 메시지(world.info · world.me)에서 읽고, 누르면 train · lab · fac 를 보낸다(판의 data-act 한 곳에서 받는다).
import {
  BLD, BUILDINGS, UNITS, WEAPONS, WEAPON, MONSTERS, MONSTER_TIERS, PERKS, PET, LAB, FACILITY, TOWER, INK, TEAM_COLORS, RESEARCH_FX,
  canAfford, costText, hatchCost, shotInk, petHp, stackMax,
} from "../../shared/constants.js";
import { BF } from "../../shared/protocol.js";

const css = (hex) => "#" + (hex >>> 0).toString(16).padStart(6, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const secs = (t) => `${Math.max(0, Math.ceil(t))}초`;

// 카드 설명은 한 줄로(초등 3~6학년이 한눈에)
export const WEAPON_DESC = {
  basic: "기본 풍선", triple: "세 갈래로 퍼져요", sticky: "맞으면 느려져요", missile: "곧게 날아가요",
  mega: "크고 세요", homing: "적을 따라가요", firework: "터지고 또 터져요", vortex: "끌어당긴 뒤 터져요",
  drill: "블록을 뚫어요 · 건물에 세요", bomb: `아주 세요 · ${WEAPONS[WEAPON.bomb].cooldown}초에 한 번`,
};
/** 연구 설명(짧게) — 숫자는 constants 에서. 없으면 constants 의 desc */
const RESEARCH_DESC = {
  siege: `건물 · 바위 피해 × ${RESEARCH_FX.siege}`,
};
const ATK = { lunge: "달려들기", slam: "내려찍기", spin: "휩쓸기", shoot: "먹물 쏘기", charge: "돌진", toss: "폭탄 던지기", wave: "충격파" };
export const monsterDesc = (k) => {
  const M = MONSTERS[k];
  const a = [ATK[M.atk.type], M.atk2 ? ATK[M.atk2.type] : null].filter(Boolean).join(" · ");
  return M.fly ? `${a} · 물 위를 날아요` : a;
};
const PANEL_NAME = { [BLD.TOWER]: "깃발의 탑", [BLD.SUPPLY]: "잉크 공급소", [BLD.LAB]: "잉크 무기 랩", [BLD.FACILITY]: "몬스터 퍼실리티" };
const JOB_KIND = { unlock: "무기 여는 중", level: "단계 올리는 중", research: "연구 중", hatch: "부화 중" };

export function createPanels(root, h) {
  const el = document.createElement("div");
  el.className = "bpanel";
  el.hidden = true;
  root.appendChild(el);
  let kind = -1;
  let lastKey = "";

  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.disabled || b.classList.contains("off")) { if (b.dataset.why) h.note(b.dataset.why, "warn"); return; }
    const act = b.dataset.act;
    const key = b.dataset.key;
    if (act === "close") close();
    else if (act === "train") h.send({ t: "train", what: key });
    else if (act === "lab") h.send({ t: "lab", act: b.dataset.sub, key: key === "" ? undefined : isNaN(+key) ? key : key });
    else if (act === "fac") h.send({ t: "fac", act: b.dataset.sub, key: key === "" || key == null ? undefined : isNaN(+key) ? key : +key });
    else if (act === "place") h.startPlacing();
    else if (act === "weapon") h.setWeapon(+key);
    else if (act === "buy") h.send({ t: "buy", w: +key });
    else if (act === "gather") h.gather(key);
    lastKey = "";
  });

  function open(k) {
    kind = k;
    el.hidden = false;
    lastKey = "";
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }
  function close() {
    kind = -1;
    el.hidden = true;
  }

  /** 단추 하나: 값 · 막힌 까닭을 같이 */
  function btn(act, label, o = {}) {
    const off = !!o.why;
    // 코어 값은 비싸다 — 보라 딱지로 크게(U11)
    const cost = o.cost ? esc(o.cost).replace(/코어 (\d+)/g, '<i class="ccore">◆ 코어 $1</i>').replace(/골드 (\d+)/g, '<i class="cgold">● 골드 $1</i>') : "";
    return `<button class="pbtn${off ? " off" : ""}${o.cls ? " " + o.cls : ""}" data-act="${act}" ${o.sub ? `data-sub="${o.sub}"` : ""} data-key="${esc(o.key ?? "")}" ${off ? `data-why="${esc(o.why)}"` : ""}>
      <b>${label}</b>${cost ? `<small>${cost}</small>` : ""}</button>`;
  }
  const RES_KO = { gold: "골드", core: "코어", ink: "잉크" };
  /** 내 지갑으로 낼 수 있나(U31) — 모자라면 "내 골드 40 / 120" */
  const why = (res, cost, extra) => {
    if (extra) return extra;
    if (!res || !cost || canAfford(res, cost)) return "";
    return ["gold", "core", "ink"].filter((k) => (cost[k] || 0) > (res[k] || 0)).map((k) => `${RES_KO[k]} 부족(${Math.floor(res[k] || 0)}/${cost[k]})`).join(" · ");
  };
  const TEAMPAY = (what) => `<p class="phint teampay">💰 ${what} = 내 골드 · 팀 모두 써요</p>`;
  const bar = (k, cls = "") => `<span class="pbar ${cls}"><i style="width:${Math.max(0, Math.min(1, k)) * 100}%"></i></span>`;

  function jobLine(job, nameOf) {
    if (!job) return "";
    return `<div class="pjob"><span>${JOB_KIND[job.kind] || "일하는 중"} · <b>${esc(nameOf(job))}</b></span>${bar(job.total ? job.t / job.total : 0, "job")}<small>${secs((job.total || 0) - (job.t || 0))}</small></div>`;
  }

  function tower(w, b) {
    const me = w.me || {};
    const info = w.info;
    const down = b && b.flags & BF.DOWN;
    const wal = w.wallet(); // 내 지갑(U31)
    const counts = me.counts || { worker: 0, bot: 0 };
    const rows = ["worker", "bot"].map((what) => {
      const U = UNITS[what];
      const n = counts[what] || 0;
      const queued = (me.queue || []).filter((q) => q.what === what).length;
      const reason = down ? `탑이 꺾였어요 · ${secs(b.timer)}` : n + queued >= U.cap ? `최대 ${U.cap}명` : why(wal, U.train);
      const desc = what === "worker" ? "자원을 캐고 공급소를 지어요" : "싸워요 · <b>쓰러지면 사라져요</b>";
      return `<div class="pcard${what === "bot" ? " pricey" : ""}"><div class="pc-head"><b>${U.name}</b><em>${n}${queued ? `+${queued}` : ""} / ${U.cap}</em></div><p>${desc}</p>
        ${btn("train", `${U.name} 뽑기`, { key: what, cost: `${costText(U.train)} · ⏳${U.train.time}초`, why: reason })}</div>`;
    });
    const q = (me.queue || []).map((x) => `<div class="pq"><span>${UNITS[x.what]?.name || x.what}</span>${bar(x.total ? x.t / x.total : 0, "job")}<small>${secs((x.total || 0) - (x.t || 0))}</small></div>`).join("");
    // 일꾼 캐기 명령은 일꾼을 고르면 나오는 판에 있다(건물 판에는 그 건물 일만 — U16)
    return `<div class="pgrid two">${rows.join("")}</div>${q ? `<div class="pqueue"><h4>뽑는 줄</h4>${q}</div>` : ""}
      <p class="phint">💎 보석을 이고 오면 <b>점수</b> · 부서지면 <b>탈락</b></p>`;
  }

  function supply(w) {
    const info = w.info;
    const n = (w.latest?.buildings || []).filter((b) => b.team === w.team && b.kind === BLD.SUPPLY).length;
    const wal = w.wallet(); // 내 지갑(U31)
    const def = BUILDINGS[BLD.SUPPLY];
    const reason = n >= def.max ? `팀에 최대 ${def.max}곳` : why(wal, def.build);
    const tsum = () => ""; // 팀 합계는 보이지 않는다(사용자 요청)
    return `<div class="pbigs"><div class="pbig ink"><span>내 잉크${tsum("ink")}</span><b>${Math.floor(wal.ink)}</b><small>탱크 채우기</small></div>
      <div class="pbig gold"><span>내 골드${tsum("gold")}</span><b>${Math.floor(wal.gold)}</b><small>무기 · 일꾼</small></div>
      <div class="pbig core"><span>내 코어${tsum("core")}</span><b>${Math.floor(wal.core)}</b><small>잉크봇 · 몬스터</small></div></div>
      <p class="phint">🛢 곁에 서면 충전 · 초당 ${INK.REFILL_RATE} · <b>내 잉크</b>로</p>
      ${TEAMPAY("짓기")}
      <div class="prow">${btn("place", "공급소 짓기 (B)", { cost: `${costText(def.build)} · ⏳${def.build.time}초 · ${n}/${def.max}`, why: reason })}<small class="pnote">일꾼 바로 옆에 지어요</small></div>`;
  }

  function lab(w, b) {
    const info = w.info || {};
    const wal = w.wallet(); // 내 지갑(U31)
    const L = info.lab || { lv: 1, unlocked: [], research: {} };
    const lv = L.lv || 1;
    const broken = L.broken || (b && b.flags & BF.BROKEN);
    const busy = !!L.job;
    const unlocked = new Set([0, ...(L.unlocked || [])]);
    const blockWhy = broken ? "고장 · 일꾼이 고쳐요" : busy ? "다른 일 하는 중" : "";
    const nameOf = (job) => job.kind === "unlock" ? (WEAPONS.find((x, i) => x.key === job.key || i === job.key)?.name || job.key) : job.kind === "level" ? `${lv + 1}단계` : LAB.RESEARCH.find((r) => r.key === job.key)?.name || job.key;
    const next = LAB.LEVELS[lv + 1];
    let html = `<div class="phead2"><span class="plv">${lv}단계</span>${broken ? `<span class="pbad">고장</span>` : ""}${jobLine(L.job, nameOf)}
      ${next ? btn("lab", `${lv + 1}단계로`, { sub: "level", cost: `${costText(next)} · ⏳${next.time}초`, why: blockWhy || why(wal, next), cls: "small" }) : `<span class="pmax">최고 단계</span>`}</div>
      <p class="phint">🔓 <b>열기</b> = 팀 모두 · 🛒 <b>사기</b> = 내 것</p>`;
    for (let tier = 1; tier <= 3; tier++) {
      const cards = WEAPONS.map((W, i) => [W, i]).filter(([W]) => W.tier === tier).map(([W, i]) => {
        const open = unlocked.has(i);
        const working = L.job && L.job.kind === "unlock" && (L.job.key === W.key || L.job.key === i);
        const locked = tier > lv;
        const res = research(w);
        let foot;
        if (open) {
          // 연 무기: 학생마다 한 묶음씩 사서 소지품에 쌓는다(v2.2 — 바로, 팀 골드)
          const inv = Array.isArray(w.me?.inv) ? w.me.inv : [];
          const n = inv[i] | 0, max = stackMax(i), P = W.pack || { n: 1, gold: 0 };
          // 한 묶음을 더하면 최대를 넘는 때도 못 산다(서버와 같은 규칙)
          const buyWhy = broken ? "고장 · 일꾼이 고쳐요" : n + P.n > max ? `최대 ${max}개(지금 ${n})` : why(wal, { gold: P.gold });
          foot = `<div class="pinv"><span title="가진 것 / 최대">가진 것 <b>×${n}</b><small>/${max}</small></span>${n > 0 ? btn("weapon", w.me?.w === i ? "들고 있어요" : "들기", { key: i, cls: "ghost small" }) : ""}</div>` +
            btn("buy", `${P.n}발 사기`, { key: i, cost: `골드 ${P.gold} · 나`, why: buyWhy, cls: "buy" });
        }
        else if (working) foot = `<span class="pwork">여는 중…</span>`;
        else foot = btn("lab", "열기", { sub: "unlock", key: W.key, cost: `${costText(W.unlock)} · ⏳${W.unlock.time}초`, why: locked ? `랩 ${tier}단계 필요` : blockWhy || why(wal, W.unlock) });
        return `<div class="pcard w${open ? " open" : ""}${locked ? " locked" : ""}"><div class="pc-head"><b>${W.name}</b><span class="ptag ${open ? "mine" : "team"}">${open ? "사기 · 나" : "열기 · 팀"}</span><em>💧${shotInk(i, false, res)}</em></div><p>${WEAPON_DESC[W.key] || ""}</p>${foot}</div>`;
      });
      html += `<h4 class="ptier">${tier}단계 무기${tier > lv ? " · 잠김" : ""}</h4><div class="pgrid three">${cards.join("")}</div>`;
    }
    html += `<h4 class="ptier">연구</h4><div class="pgrid three">${LAB.RESEARCH.map((r) => {
      const done = L.research?.[r.key];
      const working = L.job && L.job.kind === "research" && L.job.key === r.key;
      const foot = done ? `<span class="pdone">완료 ✓</span>` : working ? `<span class="pwork">연구 중…</span>` : btn("lab", "연구", { sub: "research", key: r.key, cost: `${costText(r)} · ⏳${r.time}초`, why: r.tier > lv ? `랩 ${r.tier}단계 필요` : blockWhy || why(wal, r) });
      return `<div class="pcard r${done ? " open" : ""}${r.tier > lv ? " locked" : ""}"><div class="pc-head"><b>${r.name}</b></div><p>${RESEARCH_DESC[r.key] || r.desc}</p>${foot}</div>`;
    }).join("")}</div>`;
    return html;
  }

  function facility(w, b) {
    const info = w.info || {};
    const wal = w.wallet(); // 내 지갑(U31)
    const F = info.fac || { lv: 1, research: {}, dex: [] };
    const lv = F.lv || 1;
    const broken = F.broken || (b && b.flags & BF.BROKEN);
    const busy = !!F.job;
    const blockWhy = broken ? "고장 · 일꾼이 고쳐요" : "";
    const pet = w.me?.pet || { state: "none" };
    const dex = new Set(F.dex || []);
    const nameOf = (job) => job.kind === "hatch" ? MONSTERS[job.key]?.name || "몬스터" : job.kind === "level" || job.key === "level-fac" ? `${lv + 1}단계` : FACILITY.RESEARCH.find((r) => r.key === job.key)?.name || job.key;
    // 내 몬스터
    let petHtml;
    if (pet.state === "none" || pet.kind == null || pet.kind < 0) petHtml = `<div class="ppet empty"><b>내 몬스터가 없어요</b><small><b>코어</b>로 1마리 사요 · <b>쓰러지면 사라져요</b></small></div>`;
    else {
      const M = MONSTERS[pet.kind];
      const L = pet.level || 1;
      const perk = PERKS[M.perk];
      const nextCost = PET.LEVELS[L + 1];
      const max = petHp(pet.kind, L);
      let state = "";
      if (pet.state === "hatching") state = `<span class="pwork">부화 중 · ${secs(pet.t)}</span>`;
      else state = `<span class="php">${bar((pet.hp ?? max) / max, "hp")}<small>${Math.ceil(pet.hp ?? max)} / ${max}</small></span>${btn("fac", "놓아 주기", { sub: "release", cls: "small ghost" })}`;
      petHtml = `<div class="ppet"><div class="pp-name"><b>${M.name}</b><em>Lv ${L}</em></div>${state}
        <div class="pp-perk ${L >= PET.PERK_LEVEL ? "on" : ""}">특기 <b>${perk.name}</b> · ${perk.desc}${L >= PET.PERK_LEVEL ? "" : ` <small>(Lv${PET.PERK_LEVEL})</small>`}</div>
        ${nextCost && pet.state !== "hatching" ? btn("fac", `Lv ${L + 1}로`, { sub: "level", cost: costText(nextCost), why: blockWhy || why(wal, nextCost), cls: "small" }) : pet.state !== "hatching" ? `<span class="pmax">최고 레벨</span>` : ""}</div>`;
    }
    const next = FACILITY.LEVELS[lv + 1];
    let html = `<div class="phead2"><span class="plv">${lv}단계</span>${broken ? `<span class="pbad">고장</span>` : ""}${jobLine(F.job, nameOf)}
      ${next ? btn("fac", `${lv + 1}단계로`, { sub: "level-fac", cost: `${costText(next)} · ⏳${next.time}초`, why: blockWhy || (busy ? "다른 일 하는 중" : "") || why(wal, next), cls: "small" }) : `<span class="pmax">최고 단계</span>`}</div>${TEAMPAY("단계 · 연구")}${petHtml}`;
    for (let tier = 0; tier < 3; tier++) {
      const cards = MONSTERS.filter((M) => M.tier === tier).map((M) => {
        const c = hatchCost(M.kind, dex.has(M.kind));
        const locked = tier + 1 > lv;
        const mine = pet.kind === M.kind && pet.state !== "none";
        const swap = pet.state !== "none" && pet.kind != null && pet.kind >= 0 && !mine;
        const foot = mine ? `<span class="pdone">내 몬스터</span>` : btn("fac", "사기", { sub: "hatch", key: M.kind, cost: `${costText(c)} · ⏳${c.time}초${dex.has(M.kind) ? " · 도감 할인" : ""}`, why: locked ? `퍼실리티 ${tier + 1}단계 필요` : blockWhy || (swap ? "1마리만 · 먼저 놓아 줘요" : "") || (pet.state === "hatching" ? "부화 중" : "") || why(wal, c) });
        return `<div class="pcard m pricey${locked ? " locked" : ""}${mine ? " open" : ""}"><div class="pc-head"><b>${M.name}</b>${dex.has(M.kind) ? `<em class="dex">도감</em>` : ""}</div><p>${monsterDesc(M.kind)}</p>${foot}</div>`;
      });
      html += `<h4 class="ptier">${MONSTER_TIERS[tier].name} 몬스터${tier + 1 > lv ? " · 잠김" : ""}</h4><div class="pgrid three">${cards.join("")}</div>`;
    }
    html += `<h4 class="ptier">연구</h4><div class="pgrid two">${FACILITY.RESEARCH.map((r) => {
      const done = F.research?.[r.key];
      const working = F.job && F.job.kind === "research" && F.job.key === r.key;
      const foot = done ? `<span class="pdone">완료 ✓</span>` : working ? `<span class="pwork">연구 중…</span>` : btn("fac", "연구", { sub: "research", key: r.key, cost: `${costText(r)} · ⏳${r.time}초`, why: r.tier > lv ? `퍼실리티 ${r.tier}단계 필요` : blockWhy || (busy ? "다른 일 하는 중" : "") || why(wal, r) });
      return `<div class="pcard r${done ? " open" : ""}${r.tier > lv ? " locked" : ""}"><div class="pc-head"><b>${r.name}</b></div><p>${RESEARCH_DESC[r.key] || r.desc}</p>${foot}</div>`;
    }).join("")}</div>`;
    return html;
  }
  const research = (w) => w.info?.lab?.research || {};

  function update(w) {
    if (kind < 0 || !w) return;
    const b = w.myBuilding(kind);
    const info = w.info;
    const me = w.me;
    const key = JSON.stringify([kind, info, me && { c: me.counts, q: me.queue?.map((q) => [q.what, Math.floor(q.t)]), p: me.pet && [me.pet.kind, me.pet.level, me.pet.state, Math.ceil(me.pet.t || 0), Math.round(me.pet.hp || 0)], w: me.w, inv: me.inv, wal: [me.gold, me.core, me.ink] }, b && [b.flags, Math.round(b.hp * 50), b.timer, Math.round(b.progress * 40)]]);
    if (key === lastKey) return;
    lastKey = key;
    const hex = TEAM_COLORS[w.team] ?? 0xffffff;
    const hp = b ? Math.ceil(b.hp * BUILDINGS[kind].hp) : 0;
    let status = "";
    if (!b) status = kind === BLD.SUPPLY ? "공급소가 없어요" : "";
    else if (!(b.flags & BF.BUILT)) status = `짓는 중 ${Math.floor(b.progress * 100)}%`;
    else if (b.flags & BF.DOWN) status = `꺾임 · ${secs(b.timer)}`;
    else if (b.flags & BF.BROKEN) status = "고장 · 일꾼으로 고쳐요";
    let body = "";
    if (kind === BLD.TOWER) body = tower(w, b);
    else if (kind === BLD.SUPPLY) body = supply(w);
    else if (kind === BLD.LAB) body = lab(w, b);
    else if (kind === BLD.FACILITY) body = facility(w, b);
    el.style.setProperty("--team", css(hex));
    // 누른 건물 하나만 보여 준다(다른 건물로 가는 탭은 두지 않는다 — U16)
    el.innerHTML = `<div class="phead"><h3>${PANEL_NAME[kind]}</h3>${b ? `<span class="php">${bar(b.hp, b.flags & (BF.BROKEN | BF.DOWN) ? "bad" : "hp")}<small>${hp} / ${BUILDINGS[kind].hp}</small></span>` : ""}${status ? `<span class="pstat">${esc(status)}</span>` : ""}<button class="pclose" data-act="close" title="닫기 (Esc)">✕</button></div>
      <div class="pbody">${body}</div>`;
  }

  return {
    open, close, update,
    el,
    get kind() { return kind; },
    get isOpen() { return kind >= 0; },
  };
}
