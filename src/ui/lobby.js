// 첫 화면 · 대기실(docs/DESIGN.md §1). 가입 없이 닉네임과 채널 코드. 방장이 팀 수 · 팀당 최대 인원 · 맵 · 퀴즈(없음 = 아케이드) · 시간을 고르고,
// 컴퓨터는 팀 칸의 "+ 컴퓨터" · "×" 로 직접 넣고 뺀다(U24 — 잉크 브로울스와 같다. 저절로 채우는 컴퓨터는 없다).
import { TEAM_COLORS, TEAM_NAMES, MAX_PER_TEAM, MAPS, ROUND_MINUTES, DEFAULT_MINUTES, TEAM_COUNTS, DEFAULT_MAP, TILE } from "../../shared/constants.js";
import { generateMap } from "../../shared/map.js";
import { openQuizPicker, ownerKey } from "./archive.js";
import { showGuide } from "./rules.js"; // 첫 화면 "게임 설명"(U29) // 퀴즈 고르기 창(U25 — 잉크 브로울스와 같이 쓰는 퀴즈 아카이브)

const css = (hex) => "#" + (hex >>> 0).toString(16).padStart(6, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const SUBJ = { math: "수학", science: "과학", english: "영어", korean: "국어", social: "사회", general: "상식", other: "기타" };

export function createLobby(root, h) {
  let sets = [];
  let maps = MAPS;
  let teamCounts = TEAM_COUNTS; // hello.teamCounts 가 오면 그것(서버가 고를 수 있게 한 팀 수)
  let perTeamChoices = Array.from({ length: MAX_PER_TEAM }, (_, k) => k + 1); // hello.perTeamChoices(팀당 최대 인원 1 ~ 4명)
  let lastLobby = null;

  function title(name) {
    lastLobby = null;
    root.innerHTML = `<div class="screen title-screen">
      <div class="logo"><span class="l1">INK BRAWLS</span><span class="l2">REALMS</span><span class="l3">잉크 브로울스 왕국전 · 깃발의 탑</span></div>
      <p class="tagline">잉크 풍선으로 싸우고 <b>보석</b>을 모아<br>우리 <b>깃발의 탑</b>으로 먼저 가져와요!</p>
      <form class="entry">
        <label>닉네임<input name="name" maxlength="12" autocomplete="off" value="${esc(name || "")}" placeholder="이름을 적어 주세요" required></label>
        <button class="primary big" name="create" type="submit">채널 만들기</button>
        <div class="join-row"><input name="code" maxlength="5" autocomplete="off" placeholder="채널 코드" style="text-transform:uppercase"><button type="button" class="join">들어가기</button></div>
      </form>
      <button type="button" class="guide-btn">📖 게임 설명</button>
      <ul class="how">
        <li><b>WASD · 방향키</b> 달리기 · <b>클릭</b> 던지기</li>
        <li><b>오른쪽 클릭</b> 그곳으로 걷기 · <b>끌기</b> 고르기</li>
        <li><b>💎 보석</b>을 머리에 이고 탑으로</li>
        <li><b>⛏ 일꾼</b> 골드 · 코어 · 잉크 캐기</li>
      </ul>
    </div>`;
    root.querySelector(".guide-btn").onclick = () => showGuide();
    const f = root.querySelector("form");
    const nameIn = f.elements.name, codeIn = f.elements.code;
    f.onsubmit = (e) => { e.preventDefault(); h.onCreate(nameIn.value.trim()); };
    f.querySelector(".join").onclick = () => {
      if (!nameIn.value.trim()) { nameIn.focus(); return; }
      if (codeIn.value.trim().length < 5) { codeIn.focus(); return; }
      h.onJoin(nameIn.value.trim(), codeIn.value.trim().toUpperCase());
    };
    const fromUrl = new URLSearchParams(location.search).get("c");
    if (fromUrl) codeIn.value = fromUrl.toUpperCase();
  }

  function room(L) {
    lastLobby = L;
    const host = L.host === L.you;
    const s = L.settings || {};
    const teams = s.teams || 2;
    const quizKey = s.quiz || "";
    const mapK = s.map || DEFAULT_MAP;
    const minutes = s.minutes || DEFAULT_MINUTES;
    const perTeam = s.perTeam || MAX_PER_TEAM;
    // 팀 칸: 사람 줄 → 컴퓨터 줄("🤖 이름", 방장은 × 로 뺀다). 인원 n/perTeam 은 사람 + 컴퓨터
    const bots = (L.bots || []).map((b, i) => ({ ...b, i })); // i = 서버 명단의 번호({t:"bot", op:"remove", i})
    const cols = [];
    for (let t = 0; t < teams; t++) {
      const ms = (L.members || []).filter((m) => m.team === t);
      const bs = bots.filter((b) => b.team === t);
      const n = ms.length + bs.length;
      const mine = ms.some((m) => m.id === L.you);
      const full = n >= perTeam;
      cols.push(`<div class="team-col${mine ? " mine" : ""}${full ? " full" : ""}${n ? "" : " empty"}" style="--team:${css(TEAM_COLORS[t] ?? 0xffffff)}">
        <div class="tc-head">${TEAM_NAMES[t] ?? t + 1} 팀 <small>${n}/${perTeam}</small></div>
        <ul>${ms.map((m) => `<li class="${m.id === L.you ? "me" : ""}">${esc(m.name)}${m.id === L.host ? " 👑" : ""}</li>`).join("")}${bs
          .map((b) => `<li class="bot"><span>🤖 ${esc(b.name)}</span>${host ? `<button class="bot-x" data-i="${b.i}" title="${esc(b.name)} 빼기" aria-label="${esc(b.name)} 빼기">×</button>` : ""}</li>`)
          .join("")}${n ? "" : `<li class="none">비어 있어요</li>`}</ul>
        ${host ? `<button class="add-bot" data-t="${t}" ${full ? "disabled" : ""}>+ 컴퓨터</button>` : ""}
        ${mine ? "" : full ? `<button class="join-team" disabled>가득 찼어요</button>` : `<button class="join-team" data-t="${t}">이 팀으로</button>`}
      </div>`);
    }
    const set = sets.find((q) => q.key === quizKey);
    // 지금 퀴즈(U25): 서버의 quizInfo(아카이브 세트면 제목 · 문제 수). 없으면(예전 서버) 기본 세트 목록에서 찾는다
    const qi = L.quizInfo || (set ? { src: "seed", key: set.key, title: set.title, count: set.count } : { src: "none", title: "", count: 0 });
    const quizOn = qi.src !== "none";
    const quizLabel = L.quizPending ? "<span>퀴즈를 불러오는 중…</span>" : quizOn ? `<span>${esc(qi.title)}</span><small>${qi.count}문제${qi.src === "arc" ? " · 아카이브" : ""}</small>` : "<span>없음 · 아케이드</span>";
    const map = maps.find((m) => m.key === mapK) || maps[0];
    const link = `${location.origin}${location.pathname}?c=${L.code}`;
    const dis = host ? "" : "disabled";
    root.innerHTML = `<div class="screen room-screen">
      <div class="room-top">
        <div class="code-box"><small>채널 코드</small><b>${esc(L.code)}</b><button class="copy" title="초대 주소 복사">초대 주소 복사</button></div>
        <span class="mode-tag ${quizOn ? "quiz" : "arcade"}">${quizOn ? "퀴즈 모드" : "아케이드 모드"}</span>
        <button class="leave">나가기</button>
      </div>
      <div class="teams t${teams}${teams > 4 ? " many" : ""}">${cols.join("")}</div>
      <div class="settings ${host ? "" : "ro"}">
        <label>팀 수<select name="teams" ${dis}>${teamCounts.map((n) => `<option value="${n}" ${n === teams ? "selected" : ""}>${n}팀</option>`).join("")}</select></label>
        <label>팀당 최대 인원<select name="perTeam" ${dis}>${perTeamChoices.map((n) => `<option value="${n}" ${n === perTeam ? "selected" : ""}>${n}명</option>`).join("")}</select></label>
        <div class="map-pick"><span class="mp-lbl">맵 <small>${teams}팀 미리 보기</small></span><input type="hidden" name="map" value="${esc(mapK)}">
          <div class="map-cards" role="radiogroup" aria-label="맵">${maps.map((m) => `<button type="button" role="radio" aria-checked="${m.key === mapK}" class="map-card${m.key === mapK ? " on" : ""}" data-map="${esc(m.key)}" ${dis} title="${esc(m.desc || "")}"><canvas class="map-prev" data-map="${esc(m.key)}" width="168" height="168"></canvas><b>${esc(m.name)}</b></button>`).join("")}</div></div>
        <label>퀴즈<button type="button" class="quiz-pick${quizOn ? " on" : ""}" ${dis} ${L.quizPending ? "aria-busy=\"true\"" : ""} title="${quizOn ? `${esc(qi.title)} · ${qi.count}문제` : "퀴즈 고르기 · 만들기"}">${quizLabel}</button></label>
        <label>제한 시간<select name="minutes" ${dis}>${ROUND_MINUTES.map((n) => `<option value="${n}" ${n === minutes ? "selected" : ""}>${n}분</option>`).join("")}</select></label>
        <p class="set-desc"><b>${esc(map?.name || "")}</b>: ${esc(map?.desc || "")}<br>${quizOn ? `퀴즈: ${set ? `${esc(set.title)} <small>${SUBJ[set.subject] || ""}</small>` : `${esc(qi.title)} <small>${qi.count}문제${qi.skipped ? ` · ${qi.skipped}문제 뺌` : ""}</small>`} · 맞히면 보석` : "아케이드: 방어막 → 바위 부수면 보석"}</p>
      </div>
      ${host ? `<button class="primary big start">경기 시작</button>` : `<p class="wait">방장이 시작하기를 기다려요…</p>`}
      ${L.result && L.result.winner != null && L.result.winner >= 0 ? `<p class="last">지난 경기: <b style="color:${css(TEAM_COLORS[L.result.winner] ?? 0xffffff)}">${TEAM_NAMES[L.result.winner]} 팀</b> 승리</p>` : ""}
    </div>`;
    root.querySelectorAll("canvas.map-prev").forEach((c) => drawMapPreview(c, c.dataset.map, teams));
    root.querySelectorAll(".join-team[data-t]").forEach((b) => (b.onclick = () => h.onTeam(+b.dataset.t)));
    root.querySelector(".leave").onclick = () => h.onLeave();
    root.querySelector(".copy").onclick = async (e) => {
      try { await navigator.clipboard.writeText(link); e.target.textContent = "복사했어요!"; } catch { e.target.textContent = link; }
    };
    if (host) {
      const send = () => {
        const q = (n) => root.querySelector(`[name=${n}]`);
        h.onSettings({ teams: +q("teams").value, perTeam: +q("perTeam").value, map: q("map").value, minutes: +q("minutes").value });
      };
      root.querySelectorAll(".settings select, .settings input").forEach((x) => (x.onchange = send));
      root.querySelectorAll(".map-card[data-map]").forEach((b) => (b.onclick = () => {
        const inp = root.querySelector("[name=map]");
        if (inp.value === b.dataset.map) return;
        inp.value = b.dataset.map;
        root.querySelectorAll(".map-card").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", String(x === b)); });
        send();
      }));
      // 퀴즈: 고르기 창 → {quiz: "" | "seed:<key>" | "arc:<id>"}. 비공개 아카이브 세트는 이 기기의 소유 키를 함께 보낸다(서버가 그 세트를 받을 때만 쓴다)
      root.querySelector(".quiz-pick").onclick = () =>
        openQuizPicker({
          current: qi,
          onPick: (sel) => {
            if (sel.src === "arc") h.onSettings({ quiz: `arc:${sel.id}`, quizRev: sel.updatedAt || 0, ...(sel.visibility === "private" ? { quizOwner: ownerKey() } : {}) });
            else h.onSettings({ quiz: sel.src === "seed" ? `seed:${sel.key}` : "" });
          },
        });
      // 컴퓨터 넣기 · 빼기 — 서버 메시지 {t:"bot", op, team | i}. main.js 가 onBot 을 이으면 그것을, 아직이면 설정 경로로
      // (onSettings 는 {t:"settings", ...m} 을 보내므로 m 의 t 가 그것을 덮어쓴다 — 잉크 브로울스 ui.js 와 같은 길)
      const sendBot = (m) => (typeof h.onBot === "function" ? h.onBot({ t: "bot", ...m }) : h.onSettings({ ...m, t: "bot" }));
      root.querySelectorAll(".add-bot[data-t]").forEach((b) => (b.onclick = () => { if (!b.disabled) sendBot({ op: "add", team: +b.dataset.t }); }));
      root.querySelectorAll(".bot-x[data-i]").forEach((b) => (b.onclick = () => { b.closest("li")?.classList.add("leaving"); sendBot({ op: "remove", i: +b.dataset.i }); }));
      root.querySelector(".start").onclick = () => h.onStart(); // 받지 않으면(빈 팀 등) 서버가 까닭을 알림으로 보낸다
    }
  }

  return {
    setHello(m) {
      sets = m.sets || [];
      if (Array.isArray(m.maps) && m.maps.length) maps = m.maps;
      if (Array.isArray(m.teamCounts) && m.teamCounts.length) teamCounts = m.teamCounts.filter((n) => n >= 2 && n <= TEAM_COLORS.length);
      if (Array.isArray(m.perTeamChoices) && m.perTeamChoices.length) perTeamChoices = m.perTeamChoices.filter((n) => Number.isInteger(n) && n >= 1);
      if (lastLobby) room(lastLobby);
    },
    title, room,
    /** 서버가 설정을 받지 않았을 때(오류) — 고른 값을 지난 대기실 상태로 되돌린다 */
    refresh() { if (lastLobby) room(lastLobby); },
    hide() { root.innerHTML = ""; lastLobby = null; },
    toast(text) {
      const t = document.createElement("div");
      t.className = "toast";
      t.textContent = text;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3500);
    },
  };
}

// ── 맵 미리 보기(대기실 맵 카드) — 실제 맵 생성기로 이 팀 수의 배치를 작은 그림으로. 같은 맵 · 팀 수는 한 번만 만든다 ──
const PREVIEW_SEED = 20261124;
const PREVIEW_COL = {
  [TILE.FLOOR]: [43, 36, 64], [TILE.TREE]: [47, 125, 85], [TILE.WATER]: [58, 95, 208], [TILE.BLOCK]: [107, 100, 136],
  [TILE.CRATE]: [139, 94, 60], [TILE.POND]: [255, 45, 240], [TILE.GOLD]: [255, 207, 51], [TILE.CORE]: [176, 107, 255],
};
const previewCache = new Map();
function previewOf(key, teams) {
  const id = `${key}:${teams}`;
  let pv = previewCache.get(id);
  if (pv) return pv;
  const map = generateMap(PREVIEW_SEED, teams, key);
  const S = map.size;
  const off = document.createElement("canvas");
  off.width = S; off.height = S;
  const g = off.getContext("2d");
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const c = PREVIEW_COL[map.tiles[i]] || PREVIEW_COL[TILE.FLOOR];
    img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  pv = { off, map };
  previewCache.set(id, pv);
  return pv;
}
function drawMapPreview(canvas, key, teams) {
  let pv;
  try { pv = previewOf(key, teams); } catch { return; }
  const { off, map } = pv;
  const W = canvas.width, k = W / map.size;
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(off, 0, 0, W, W);
  // 팀 본진(깃발의 탑 자리 둘레를 팀 색으로) · 보석 섹션(가운데는 크게)
  for (const b of map.bases) {
    const col = css(TEAM_COLORS[b.team] ?? 0xffffff);
    g.fillStyle = col;
    g.globalAlpha = 0.28;
    g.beginPath(); g.arc(b.cx * k, b.cy * k, 7 * k, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    const t = b.tower;
    g.fillRect(t.tx * k, t.ty * k, Math.max(4, 4 * k), Math.max(4, 4 * k));
  }
  for (const st of map.sites) {
    const r = Math.max(2.5, (st.center ? 2.2 : 1.5) * k);
    g.save(); g.translate(st.x * k, st.y * k); g.rotate(Math.PI / 4);
    g.fillStyle = st.center ? "#ffe600" : "#7df9ff";
    g.fillRect(-r, -r, r * 2, r * 2);
    g.restore();
  }
}
