// 화질 설정 「자동 · 높음 · 보통 · 낮음」 — 브라우저에 기억한다(localStorage "ibr-gfx", 막혀 있으면 그냥 자동).
// 자동: 휴대폰 · 코어 4개 이하 = 보통, 그 밖 = 높음으로 시작하고, 프레임이 느리면 장면 해상도(동적 해상도)부터 줄인 뒤 단계를 내린다
// (src/brawls/render/renderer.js 의 LEVELS · feedDrs). 첫 화면에서 기기를 재 추천 단계를 고른다(qualityadvisor.js).
// 설정 창(⚙ — ui/settings.js)의 화질 줄로 들어간다.
// ?debug 이면 화면 아래 가운데에 FPS · 장면 해상도 배율 · 단계를 작게 보인다(createPerfHud).

export const LEVEL_NAMES = Object.freeze({ high: "높음", mid: "보통", low: "낮음" });
export const QUALITY = [
  ["auto", "자동"],
  ["high", "높음"],
  ["mid", "보통"],
  ["low", "낮음"],
];
const KEY = "ibr-gfx";
const LEVEL_NAME = LEVEL_NAMES;

/** 기억한 화질(없거나 읽을 수 없으면 "auto") */
export function loadQuality() {
  try {
    const q = localStorage.getItem(KEY);
    return QUALITY.some(([k]) => k === q) ? q : "auto";
  } catch {
    return "auto";
  }
}
export function saveQuality(q) {
  try {
    localStorage.setItem(KEY, q);
  } catch {}
}

/**
 * 화질 단추 줄(설정 창 — src/ui/settings.js, 꾸밈은 settings.css 의 .gfx-q).
 * get() = 지금 설정, set(q) = 바꾸기, level() = 지금 실제 단계, rec() = 추천 단계(첫 화면에서 잰 것 — 없으면 null),
 * remeasure() = "다시 재기"(돌려준 글을 옆에 적는다), res() = 지금 장면 해상도 배율(동적 해상도), busy() = 재는 중인가
 * @returns {HTMLElement & { refresh(): void }}
 */
export function qualityControl({ get, set, level, rec, remeasure, res, busy }) {
  const box = document.createElement("div");
  box.className = "gfx-q";
  const btns = QUALITY.map(([k, name]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.q = k;
    b.textContent = name;
    b.onclick = () => {
      set(k);
      saveQuality(k);
      refresh();
    };
    box.appendChild(b);
    return b;
  });
  let msg = "";
  if (remeasure) {
    const again = document.createElement("button");
    again.type = "button";
    again.className = "again";
    again.textContent = "다시 재기";
    again.onclick = () => {
      msg = remeasure() || "";
      refresh();
    };
    box.appendChild(again);
  }
  const now = document.createElement("small");
  now.className = "now";
  box.appendChild(now);
  function refresh() {
    const q = get();
    const r = rec ? rec() : null;
    for (const b of btns) {
      const on = b.dataset.q === q;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      if (b.dataset.q === "auto") b.textContent = r ? `자동 (추천: ${LEVEL_NAME[r]})` : "자동";
    }
    const parts = [];
    if (busy && busy()) parts.push("화질 재는 중…");
    else if (msg) parts.push(msg);
    if (q === "auto" && level) parts.push(`지금 ${LEVEL_NAME[level()] || ""}`);
    if (res) parts.push(`해상도 ${Math.round(res() * 100)}%`);
    now.textContent = parts.join(" · ");
  }
  box.refresh = refresh;
  refresh();
  return box;
}

/** ?debug 표시: FPS · 장면 해상도 배율(동적 해상도) · 단계 · 그리기 · 삼각형(0.5초마다) */
export function createPerfHud(R) {
  const el = document.createElement("div");
  el.className = "perf-hud";
  el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:2px;z-index:50;pointer-events:none;font:11px/1.35 ui-monospace,monospace;color:#bfffd0;background:rgba(0,0,0,0.55);padding:3px 6px;white-space:pre";
  document.body.appendChild(el);
  setInterval(() => {
    const s = R.stats;
    el.textContent = `${Math.round(s.fps)}fps · res ${Math.round((s.res ?? 1) * 100)}% ${s.rt} · ${LEVEL_NAME[s.level] || s.level}${s.quality === "auto" ? "(자동)" : ""}${s.lod ? " · LOD" : ""}\n` +
      `calls ${s.calls} · tris ${Math.round(s.triangles / 1000)}k · js ${s.cpuMs.toFixed(1)}ms`;
  }, 500);
  return el;
}
