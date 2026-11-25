// 설정 창(⚙ — 사용자 요청 "게임 화면에서도 설정에서 화질 등 기본 요소를 변경할 수 있는 기능"): 경기 중 위 띠의 ⚙(? 옆)와 첫 화면 왼쪽 위 ⚙ 가
// 같은 창을 연다. 경기를 멈추지 않는다(여럿이 하는 게임) — 작게, 빨리 닫히게(Esc · ✕ · 바깥 누르기).
//   화질: 자동(추천: X) · 높음 · 보통 · 낮음 + 다시 재기 + 지금 해상도 %(동적 해상도가 맞추는 것이 보인다) — render/quality.js · qualityadvisor.js
//   소리: 켬/끔 + 전체 · 음악 · 효과(src/audio/settings.js 의 getSoundSettings · setSoundSettings · onSoundSettings — 없으면 "소리 준비 중")
//   화면: 이름표 보이기 · 피해 숫자 보이기 · 화면 흔들림 줄이기(기본값 = 기기의 "동작 줄이기" 설정)
//   경기(경기 중에만): 조작 도움말 보기 · 이기는 방법 보기(rules.js 의 winRules) · 채널 나가기(창 안에서 한 번 더 묻는다)
// 화면 설정은 localStorage "ibr-settings"(막혀 있으면 기본값)에 기억하고 처음 켤 때 바로 적용한다. prefs 는 같은 객체를 HUD 가 읽는다.
import "./settings.css";
import { qualityControl } from "../render/quality.js";
import { winRules } from "./rules.js";

// 소리 설정(src/audio/settings.js) — 파일이 없어도 빌드가 깨지지 않게 glob 으로 찾는다
const audioSet = Object.values(import.meta.glob("../audio/settings.js", { eager: true }))[0] || null;
const SOUND = audioSet && typeof audioSet.getSoundSettings === "function" && typeof audioSet.setSoundSettings === "function" ? audioSet : null;

const KEY = "ibr-settings";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const reducedMotion = () => {
  try {
    return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  } catch {
    return false;
  }
};

/** 화면 설정(기억한 것 — 없으면 기본값). tags 이름표 · floats 피해 숫자 · calm 흔들림 줄이기 */
export function loadSettings() {
  const s = { tags: true, floats: true, calm: reducedMotion() };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    for (const k of ["tags", "floats", "calm"]) if (typeof raw[k] === "boolean") s[k] = raw[k];
  } catch {}
  return s;
}
function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ tags: s.tags, floats: s.floats, calm: s.calm }));
  } catch {}
}

/**
 * @param {object} o
 *   R            렌더러(scene.R — 화질 · 흔들림)
 *   advisor      화질 추천(render/qualityadvisor.js — rec · busy · remeasure)
 *   inGame()     경기 중인가 · isTitle() 첫 화면인가
 *   onHelp()     조작 도움말 · rules() 이기는 방법 인자({ mode, teams, minutes, goal, lives } | null) · onLeave() 채널 나가기
 */
export function createSettings(o) {
  const prefs = loadSettings();
  function apply() {
    o.R.setShakeScale?.(prefs.calm ? 0.15 : 1);
    o.R.setFlashScale?.(prefs.calm ? 0.3 : 1);
  }
  apply();

  let wrap = null;
  let refreshT = 0;
  let gfx = null;
  let unSound = null;

  /** 소리 줄: [소리 켬/끔] + 전체 · 음악 · 효과 밀대(0..100) */
  function soundRows() {
    const box = document.createElement("div");
    box.className = "snd-rows";
    const tg = document.createElement("button");
    tg.type = "button";
    tg.className = "tg";
    tg.setAttribute("role", "switch");
    tg.innerHTML = `<span>소리<small>M 키로 끄고 켜요</small></span><i aria-hidden="true"></i>`;
    tg.onclick = () => SOUND.setSoundSettings({ mute: !SOUND.getSoundSettings().mute });
    box.appendChild(tg);
    const sliders = [["master", "전체"], ["music", "음악"], ["sfx", "효과"]].map(([k, name]) => {
      const row = document.createElement("label");
      row.className = "sl";
      row.innerHTML = `<span>${name}</span><input type="range" min="0" max="100" step="5" aria-label="${name} 음량"><b></b>`;
      const inp = row.querySelector("input");
      inp.oninput = () => SOUND.setSoundSettings({ [k]: Number(inp.value) / 100 });
      box.appendChild(row);
      return { k, inp, out: row.querySelector("b") };
    });
    const paint = (s = SOUND.getSoundSettings()) => {
      tg.setAttribute("aria-checked", s.mute ? "false" : "true");
      tg.classList.toggle("on", !s.mute);
      box.classList.toggle("muted", !!s.mute);
      for (const x of sliders) {
        const v = Math.round((s[x.k] ?? 0) * 100);
        if (document.activeElement !== x.inp) x.inp.value = String(v);
        x.out.textContent = `${v}`;
      }
    };
    paint();
    if (typeof SOUND.onSoundSettings === "function") unSound = SOUND.onSoundSettings((s) => paint(s));
    return box;
  }

  function toggleRow(key, label, hint) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tg";
    b.setAttribute("role", "switch");
    b.innerHTML = `<span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ""}</span><i aria-hidden="true"></i>`;
    const paint = () => {
      b.setAttribute("aria-checked", prefs[key] ? "true" : "false");
      b.classList.toggle("on", !!prefs[key]);
    };
    b.onclick = () => {
      prefs[key] = !prefs[key];
      saveSettings(prefs);
      apply();
      paint();
    };
    paint();
    return b;
  }

  function build() {
    const game = !!o.inGame?.();
    wrap = document.createElement("div");
    wrap.className = "set-wrap";
    wrap.innerHTML = `<div class="set-box" role="dialog" aria-label="설정">
        <div class="set-head"><h2>⚙ 설정</h2><button type="button" class="set-x" title="닫기 (Esc)" aria-label="닫기">✕</button></div>
        <section class="s-gfx"><h3>화질</h3></section>
        <section class="s-snd"><h3>소리</h3></section>
        <section class="s-view"><h3>화면</h3></section>
        ${game ? `<section class="s-game"><h3>경기</h3><div class="g-btns">
          <button type="button" class="g-help">조작 도움말</button><button type="button" class="g-rules">이기는 방법</button>
          <button type="button" class="g-leave">채널 나가기</button></div><div class="g-more"></div></section>` : ""}
      </div>`;
    const box = wrap.querySelector(".set-box");
    // 화질
    gfx = qualityControl({
      get: () => o.R.quality,
      set: (q) => o.R.setQuality(q),
      level: () => o.R.level,
      rec: () => o.advisor?.rec ?? null,
      busy: () => !!o.advisor?.busy,
      remeasure: o.advisor ? () => o.advisor.remeasure() : null,
      res: () => o.R.resScale ?? 1,
    });
    box.querySelector(".s-gfx").appendChild(gfx);
    // 소리
    const sb = box.querySelector(".s-snd");
    if (SOUND) sb.appendChild(soundRows());
    else sb.insertAdjacentHTML("beforeend", `<p class="s-none">소리 준비 중</p>`);
    // 화면
    const vb = box.querySelector(".s-view");
    vb.appendChild(toggleRow("tags", "이름표", "머리 위 이름 · ▼ 표시"));
    vb.appendChild(toggleRow("floats", "피해 숫자", "맞으면 뜨는 −10"));
    vb.appendChild(toggleRow("calm", "흔들림 줄이기", "흔들림 · 번쩍임 약하게"));
    // 경기
    if (game) {
      const more = box.querySelector(".g-more");
      box.querySelector(".g-help").onclick = () => {
        close();
        o.onHelp?.();
      };
      box.querySelector(".g-rules").onclick = () => {
        const a = o.rules?.();
        if (!a) return;
        const r = winRules(a);
        more.innerHTML = `<div class="g-rules-box"><b>${a.mode === "quiz" ? "퀴즈 모드" : "아케이드"} · ${a.teams}팀 · ${a.minutes}분</b>
          <ol>${r.win.map((w) => `<li><i>${w.icon}</i><span><b>${esc(w.head)}</b>${w.text ? ` · ${esc(w.text)}` : ""}</span></li>`).join("")}</ol>
          <ul>${r.keep.map((k) => `<li><i>${k.icon}</i><span>${esc(k.text)}</span></li>`).join("")}</ul></div>`;
      };
      box.querySelector(".g-leave").onclick = () => {
        more.innerHTML = `<div class="g-confirm"><span>정말 나갈까요?</span><button type="button" class="g-yes">나가기</button><button type="button" class="g-no">취소</button></div>`;
        more.querySelector(".g-yes").onclick = () => {
          close();
          o.onLeave?.();
        };
        more.querySelector(".g-no").onclick = () => (more.innerHTML = "");
      };
    }
    wrap.querySelector(".set-x").onclick = () => close();
    // 바깥(창 밖)을 누르면 닫는다
    wrap.addEventListener("pointerdown", (e) => {
      if (!box.contains(e.target)) close();
    });
    document.body.appendChild(wrap);
    refreshT = setInterval(() => {
      gfx?.refresh?.();
    }, 500);
  }

  // Esc: 다른 Esc 처리(고르기 풀기 등)보다 먼저 받아 창만 닫는다
  const onKey = (e) => {
    if (!wrap) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener("keydown", onKey, true);

  function open() {
    if (wrap) return;
    build();
  }
  function close() {
    if (!wrap) return;
    clearInterval(refreshT);
    wrap.remove();
    wrap = null;
    gfx = null;
    if (unSound) unSound();
    unSound = null;
  }

  // 첫 화면 왼쪽 위 ⚙(대기실 · 경기 중에는 숨긴다 — 경기 중에는 위 띠의 ⚙)
  const titleBtn = document.createElement("button");
  titleBtn.type = "button";
  titleBtn.className = "set-title-btn";
  titleBtn.title = "설정 (화질 · 소리 · 화면)";
  titleBtn.setAttribute("aria-label", "설정");
  titleBtn.textContent = "⚙";
  titleBtn.hidden = true;
  titleBtn.onclick = () => (wrap ? close() : open());
  document.body.appendChild(titleBtn);
  setInterval(() => {
    const show = !o.inGame?.() && !!o.isTitle?.();
    if (titleBtn.hidden === show) titleBtn.hidden = !show;
  }, 300);

  return {
    prefs,
    open,
    close,
    toggle: () => (wrap ? close() : open()),
    get isOpen() {
      return !!wrap;
    },
  };
}
