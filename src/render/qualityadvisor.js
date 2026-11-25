// 화질 추천(첫 화면에서 기기를 재 알맞은 단계를 고른다 — 사용자 요청 "초기 화질 선택에서 알아서 최적의 화질을 추천").
//
// 언제 재나: 고른 화질이 없을 때(설정이 "자동")와 "다시 재기"를 눌렀을 때 — 첫 화면(.title-screen)에서만, 이미 흘러가는 첫 화면 지도
//   (나무 숲 · 후처리 그대로)를 그리는 동안 조용히. 대기실 · 경기 중에는 재지 않는다. 화면이 바뀌거나 탭이 가려지면 그만두고 다음에 다시.
//   재 둔 것은 기기마다 기억한다(localStorage "ibr-gfx-rec"): { level, measuredAt, p50s, p90s, gpu, cap, note, raise }.
//   그래픽 장치 이름이 바뀌었거나 30일이 지났으면 다시 잰다.
// 어떻게 재나(약 3~5초): 높음 · 해상도 100%(동적 해상도 멈춤)로 0.8초 데우고 2.2초 동안 프레임 간격의 p50 · p90 → 너무 느리면 보통으로
//   0.6초 데우고 1.8초 더. 그리고 값싼 기기 힌트를 더한다(THRESH · HINTS).
// 고르기(decideLevel — 순수 함수):
//   높음  = 높음에서 p90 ≤ 20ms(화면 화소가 4백만 넘게 많으면 ≤ 18ms) — 첫 화면은 경기보다 가벼워 넉넉히 본다
//   보통  = 그렇지 않고 보통에서 p90 ≤ 33ms
//   낮음  = 그 밖
//   그다음 힌트로 상한을 둔다: 소프트웨어 렌더러(SwiftShader · llvmpipe · Basic Render 등) = 낮음, 약한 모바일 · 옛 내장 GPU = 보통,
//   메모리(deviceMemory) ≤ 1GB = 낮음 · ≤ 2GB = 보통, 코어 ≤ 2 = 보통. 지난 경기에서 배운 상한(cap)도 넘지 않는다.
//   매끄러움을 예쁨보다 먼저 둔다(애매하면 아래 단계).
// 추천은 "자동"의 시작 단계로 바로 쓴다(renderer.setAutoLevel) — 동적 해상도가 거기서부터 맞춘다.
// 경기에서 배우기: 자동인데 동적 해상도가 단계를 내린 채 30초 넘게 머물면 그 단계를 다음 추천으로 기억하고, 다음 첫 화면에서 짧게 알린다
//   ("지난 경기에서 느려서 '낮음'으로 낮췄어요"). 반대로 높음보다 낮은 단계에서 경기 내내 해상도 100%(여유)였으면 다음 첫 화면에서
//   다시 재 올릴 수 있게 한다(raise — 배운 상한을 지운다).
// 시험(?debug 일 때만): ?gfxfake=fast | mid | slow 이면 잰 값 · 장치 이름을 지어낸다(빠른 GPU 길 · 카드 확인), ?gfxnow 이면 기억을 무시하고 곧 잰다.
import { LEVEL_NAMES } from "./quality.js";

const KEY = "ibr-gfx-rec";
const MAX_AGE = 30 * 24 * 3600 * 1000;
const ORDER = ["low", "mid", "high"];
const rank = (l) => ORDER.indexOf(l);
const minLevel = (a, b) => (rank(a) <= rank(b) ? a : b);

/** 고르는 기준(ms · 화소) */
export const THRESH = Object.freeze({ highP90: 20, highP90Big: 18, bigPx: 4e6, midP90: 33 });
/** 장치 이름 힌트 */
export const HINTS = Object.freeze({
  software: /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i,
  // 약한 GPU: 옛 Mali · Adreno 3xx/4xx/50x · PowerVR SGX/Rogue GE · 옛 인텔 HD(2000~4600) · GMA
  weak: /mali-(4|t[0-9])|adreno\D*(3\d\d|4\d\d|50\d)\b|powervr (sgx|rogue ge)|intel.*(hd graphics (2000|2500|3000|4000|4200|4400|4600)|gma)|intel\(r\) hd graphics( family)?$/i,
});

const NAME = LEVEL_NAMES;
const quantile = (arr, q) => {
  if (!arr.length) return Infinity;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
};

/** 값싼 기기 힌트 */
export function deviceHints(gpu) {
  const dpr = globalThis.devicePixelRatio || 1;
  const w = globalThis.innerWidth || 1280, h = globalThis.innerHeight || 720;
  return {
    gpu: gpu || "",
    software: HINTS.software.test(gpu || ""),
    weak: HINTS.weak.test(gpu || ""),
    mem: Number(globalThis.navigator?.deviceMemory) || 0, // GB(크롬 계열만 — 없으면 0)
    cores: globalThis.navigator?.hardwareConcurrency || 0,
    px: Math.round(w * h * Math.min(dpr, 2) * Math.min(dpr, 2)), // 높음이 그리는 기기 화소(픽셀 비율 2 까지)
  };
}

/**
 * 잰 값 + 힌트 → 추천 단계(순수 함수). m = { high: { p50, p90 }, mid?: { p50, p90 } }, h = deviceHints(), cap = 배운 상한(없으면 null)
 * @returns {{ level: string, why: string }}
 */
export function decideLevel(m, h, cap = null) {
  const highOk = m.high && m.high.p90 <= (h.px > THRESH.bigPx ? THRESH.highP90Big : THRESH.highP90);
  let level = highOk ? "high" : m.mid && m.mid.p90 <= THRESH.midP90 ? "mid" : "low";
  const why = [highOk ? "높음 매끄러움" : m.mid ? `보통 p90 ${Math.round(m.mid.p90)}ms` : "느림"];
  let lim = "high";
  if (h.software) { lim = "low"; why.push("소프트웨어 렌더러"); }
  else {
    if (h.weak) { lim = minLevel(lim, "mid"); why.push("약한 GPU"); }
    if (h.mem && h.mem <= 1) { lim = "low"; why.push("메모리 1GB"); }
    else if (h.mem && h.mem <= 2) { lim = minLevel(lim, "mid"); why.push("메모리 2GB"); }
    if (h.cores && h.cores <= 2) { lim = minLevel(lim, "mid"); why.push("코어 2개"); }
  }
  if (cap) { lim = minLevel(lim, cap); why.push(`지난 경기 ${NAME[cap]}`); }
  level = minLevel(level, lim);
  return { level, why: why.join(" · ") };
}

function load() {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || "null");
    return r && rank(r.level) >= 0 ? r : null;
  } catch {
    return null;
  }
}
function save(r) {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {}
}
function savedChoice() {
  try {
    return localStorage.getItem("ibr-gfx");
  } catch {
    return null;
  }
}

/**
 * @param {{ R: object, isTitle: () => boolean, inGame: () => boolean, openSettings?: () => void }} o
 */
export function createQualityAdvisor({ R, isTitle, inGame, openSettings }) {
  const params = new URLSearchParams(location.search);
  const debug = params.has("debug");
  const fake = debug ? params.get("gfxfake") : null;
  const gpu = fake ? `Fake GPU (${fake})` : R.gpuName;
  let rec = load();
  if (debug && params.has("gfxnow")) rec = null;
  const fresh = (r) => r && r.gpu === gpu && Date.now() - (r.measuredAt || 0) < MAX_AGE && !r.raise;
  if (fresh(rec) || (rec && rec.gpu === gpu && rec.raise)) R.setAutoLevel(rec.level);
  let forced = false; // "다시 재기"
  let running = false;
  let aborted = false;
  let titleSince = 0;
  let card = null;
  let cardTimer = 0;
  let lastResult = null;

  // ---------------------------------------------------------------- 재기
  const raf = () => new Promise((res) => requestAnimationFrame(res));
  async function sample(ms) {
    const out = [];
    let last = await raf();
    const t0 = last;
    while (last - t0 < ms) {
      if (aborted) throw new Error("abort");
      const t = await raf();
      out.push(t - last);
      last = t;
    }
    return out;
  }
  const stats = (a) => ({ p50: quantile(a, 0.5), p90: quantile(a, 0.9), n: a.length });
  const FAKE = { fast: [{ p50: 16.6, p90: 17.2 }, null], mid: [{ p50: 26, p90: 34 }, { p50: 17, p90: 22 }], slow: [{ p50: 60, p90: 75 }, { p50: 45, p90: 55 }] };

  async function measure() {
    running = true;
    aborted = false;
    showBusy();
    const m = {};
    try {
      R.probe("high");
      await sample(800);
      m.high = stats(await sample(2200));
      const h = deviceHints(gpu);
      if (!(m.high.p90 <= (h.px > THRESH.bigPx ? THRESH.highP90Big : THRESH.highP90))) {
        R.probe("mid");
        await sample(600);
        m.mid = stats(await sample(1800));
      }
    } catch {
      R.probe(null);
      running = false;
      hideCard();
      return;
    }
    R.probe(null);
    if (fake && FAKE[fake]) {
      m.high = { ...FAKE[fake][0], n: 0 };
      m.mid = FAKE[fake][1] ? { ...FAKE[fake][1], n: 0 } : undefined;
    }
    const hints = deviceHints(gpu);
    const cap = rec && rec.gpu === gpu && !rec.raise ? rec.cap || null : null;
    const d = decideLevel(m, hints, cap);
    rec = {
      v: 1, level: d.level, measuredAt: Date.now(), gpu,
      p50s: { high: Math.round(m.high.p50 * 10) / 10, mid: m.mid ? Math.round(m.mid.p50 * 10) / 10 : null },
      p90s: { high: Math.round(m.high.p90 * 10) / 10, mid: m.mid ? Math.round(m.mid.p90 * 10) / 10 : null },
      why: d.why, cap, hints: { mem: hints.mem, cores: hints.cores, px: hints.px, software: hints.software, weak: hints.weak },
    };
    save(rec);
    lastResult = rec;
    R.setAutoLevel(rec.level);
    running = false;
    forced = false;
    if (isTitle()) showResult();
  }

  // ---------------------------------------------------------------- 첫 화면 카드
  function makeCard() {
    if (card) return card;
    card = document.createElement("div");
    card.className = "gfx-rec";
    card.setAttribute("role", "status");
    document.body.appendChild(card);
    return card;
  }
  function hideCard() {
    clearTimeout(cardTimer);
    if (card) card.remove();
    card = null;
  }
  function showBusy() {
    const c = makeCard();
    c.classList.add("busy");
    c.innerHTML = `<span class="spin"></span><span class="msg">화질 찾는 중…</span>`;
  }
  function showResult(note = "") {
    const c = makeCard();
    c.classList.remove("busy");
    const name = NAME[rec.level];
    const usingAuto = (savedChoice() || "auto") === "auto";
    c.innerHTML = `${note ? `<p class="note">${note}</p>` : ""}<p class="msg">추천 화질: <b>${name}</b></p>
      <div class="btns"><button type="button" class="ok">좋아요</button><button type="button" class="chg">바꾸기</button></div>`;
    c.querySelector(".ok").onclick = () => {
      // 좋아요 = 추천대로(자동). 손으로 고른 화질이 있었으면 자동으로 돌린다
      if (!usingAuto) {
        try { localStorage.setItem("ibr-gfx", "auto"); } catch {}
        R.setQuality("auto");
      }
      hideCard();
    };
    c.querySelector(".chg").onclick = () => {
      hideCard();
      openSettings?.();
    };
    clearTimeout(cardTimer);
    cardTimer = setTimeout(hideCard, 14000); // 가만두면 사라진다(막지 않는 알림)
  }

  // ---------------------------------------------------------------- 경기에서 배우기
  let drop = null; // { level, t }
  let match = null; // { secs, ceil, dropped }
  const prevDown = R.onDowngrade;
  R.onDowngrade = (l) => {
    if (typeof prevDown === "function") prevDown(l);
    if (!inGame()) return;
    drop = { level: l, t: performance.now() };
    if (match) match.dropped = true;
  };
  function learnDrop(l) {
    const base = rec && rec.gpu === gpu ? rec : { v: 1, gpu, measuredAt: Date.now(), p50s: {}, p90s: {} };
    rec = { ...base, level: minLevel(base.level || "high", l), cap: l, raise: false, note: `느려서 '${NAME[l]}'으로 낮췄어요` };
    save(rec);
  }

  let lastT = performance.now();
  let wasGame = false;
  function tick() {
    const t = performance.now();
    const dt = Math.min(2, (t - lastT) / 1000);
    lastT = t;
    const game = inGame();
    // 경기: 자동일 때만 본다
    if (game && R.quality === "auto") {
      if (!match) match = { secs: 0, ceil: 0, dropped: false };
      match.secs += dt;
      if (R.level !== "high" && R.resScale >= 0.999) match.ceil += dt;
      if (drop && R.level === drop.level && t - drop.t > 30000) {
        learnDrop(drop.level);
        drop = null;
      } else if (drop && R.level !== drop.level && rank(R.level) > rank(drop.level)) drop = null; // 다시 올라갔다(설정을 바꿈)
    }
    if (wasGame && !game) {
      // 경기가 끝났다: 높음보다 낮은 단계에서 거의 내내 해상도 100%(여유) — 다음 첫 화면에서 다시 재 올릴 수 있게
      if (match && !match.dropped && match.secs >= 60 && match.ceil / match.secs >= 0.9 && rec && rec.level !== "high") {
        rec = { ...rec, raise: true, cap: null };
        save(rec);
      }
      match = null;
      drop = null;
    }
    wasGame = game;
    // 첫 화면
    const title = !game && isTitle() && !document.hidden;
    if (!title) {
      titleSince = 0;
      if (running) aborted = true;
      if (card && !running) hideCard();
      return;
    }
    if (!titleSince) titleSince = t;
    if (running) return;
    const auto = (savedChoice() || "auto") === "auto";
    const want = forced || (auto && !fresh(rec));
    if (want && t - titleSince > 1500) {
      measure();
      return;
    }
    // 지난 경기에서 배운 것 알림(한 번)
    if (rec && rec.note && !card) {
      const note = rec.note;
      rec = { ...rec, note: "" };
      save(rec);
      showResult(note);
    }
  }
  setInterval(tick, 400);

  return {
    /** 추천 단계(없으면 null) */
    get rec() {
      return rec && rec.gpu === gpu ? rec.level : null;
    },
    get busy() {
      return running;
    },
    get detail() {
      return rec;
    },
    get last() {
      return lastResult;
    },
    /** "다시 재기": 첫 화면이면 곧, 아니면 다음 첫 화면에서. 돌려준 글을 설정 창에 적는다 */
    remeasure() {
      forced = true;
      if (!inGame() && isTitle()) {
        titleSince = performance.now() - 1500;
        return "곧 다시 잴게요";
      }
      return "첫 화면에서 다시 잴게요";
    },
  };
}
