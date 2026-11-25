// 퀴즈 아카이브(잉크 브로울스와 같이 쓰는 곳 — docs/DESIGN.md U25 · §16)에서 경기에 쓸 세트를 받아 온다.
// 서버끼리 부르므로 CORS 와 상관없다: GET ${ARCHIVE_API}/api/quizzes/:id → {quiz:{title, questions:[{text, choices, answer, explanation}]}}
//
// - ARCHIVE_API(환경 변수 — 공개판은 기본으로 비어 있어 꺼져 있다) · 5초 안에 답이 없으면 그만둔다 · 받은 세트는 id 마다 10분 동안 기억한다
//   (같은 세트를 여러 반이 고르면 한 번만 받는다. 고친 뒤 다시 고르면 updatedAt 이 더 새것일 때 다시 받는다).
// - 비공개 세트(복사한 퀴즈는 처음에 비공개)는 그 주인의 소유 키(X-Owner-Key)를 함께 보내야 받을 수 있다. 키는 이 요청에만 쓰고 남기지 않는다.
// - 브로울스 아카이브의 문항은 한 가지 꼴뿐이다(server/db.js normalizeQuizInput): 문제 1~120자 · 보기 2~5개(각 1~40자) · 정답 번호 하나 · 해설.
//   O/X 문제도 보기 ["O", "X"] 인 2지선다로 저장된다 → 그대로 쓴다. 혹시 다른 꼴(type "ox" · 정답이 참/거짓 · 정답 여러 개 · 보기 없는
//   단답형 · 보기 6개 이상 · 빈 보기)이 오면 O/X 는 2지선다로 바꾸고 나머지는 빼고 skipped 에 이유를 적는다.
// - 실패해도 던지지 않는다: {ok:false, error(코드), message(화면 문구)}.

export const ARCHIVE_DEFAULT = ""; // 공개판: 아카이브 없음(ARCHIVE_API 로 켠다)
export const TIMEOUT_MS = 5000;
export const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const BODY_MAX = 512 * 1024;
const ID_RE = /^[a-z0-9]{1,32}$/;
const KEY_RE = /^[\x21-\x7e]{16,128}$/;
// 왕국전 문제 창이 받는 한도(server/quizbook.js normalizeQuestions 와 같은 값)
const MAX_CHOICES = 5;
const TEXT_MAX = 200;
const EXPLAIN_MAX = 300;
const TITLE_MAX = 60;

export const MESSAGES = {
  badId: "퀴즈 번호가 올바르지 않아요.",
  notFound: "아카이브에서 그 퀴즈를 찾을 수 없어요(지워졌거나 비공개예요).",
  timeout: "퀴즈 아카이브가 답하지 않아요. 잠시 뒤에 다시 골라 주세요.",
  network: "퀴즈 아카이브에 닿지 못했어요. 잠시 뒤에 다시 골라 주세요.",
  unavailable: "퀴즈 아카이브를 지금 쓸 수 없어요.",
  badResponse: "퀴즈 아카이브의 답을 읽지 못했어요.",
  empty: "이 퀴즈에는 왕국전에서 낼 수 있는 문제가 없어요.",
};
const fail = (error) => ({ ok: false, error, message: MESSAGES[error] || MESSAGES.badResponse });

const str = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "");
const OX_TRUE = new Set(["o", "○", "⭕", "true", "참", "맞다", "맞아요"]);
const OX_FALSE = new Set(["x", "×", "✕", "❌", "false", "거짓", "틀리다", "틀려요"]);

/**
 * 문항 하나 → 왕국전 문항 {text, choices, answer, explanation} 또는 {skip: 이유}.
 * 이유: "noText" · "noChoices"(단답형 등) · "tooManyChoices" · "emptyChoice" · "multiAnswer" · "badAnswer"
 */
export function mapQuestion(q) {
  if (!q || typeof q !== "object") return { skip: "badQuestion" };
  const text = str(q.text ?? q.question).slice(0, TEXT_MAX);
  if (!text) return { skip: "noText" };
  const explanation = str(q.explanation ?? q.explain).slice(0, EXPLAIN_MAX);
  const type = typeof q.type === "string" ? q.type.toLowerCase() : "";
  // O/X: type "ox" 이거나 정답이 참/거짓이면 보기 ["O", "X"](O = 0)
  if (type === "ox" || typeof q.answer === "boolean") {
    let yes = null;
    if (typeof q.answer === "boolean") yes = q.answer;
    else if (Number.isInteger(q.answer) && Array.isArray(q.choices) && q.choices.length === 2) {
      const pick = str(q.choices[q.answer]).toLowerCase();
      yes = OX_TRUE.has(pick) ? true : OX_FALSE.has(pick) ? false : q.answer === 0;
    } else if (typeof q.answer === "string") {
      const a = q.answer.trim().toLowerCase();
      yes = OX_TRUE.has(a) ? true : OX_FALSE.has(a) ? false : null;
    }
    if (yes === null) return { skip: "badAnswer" };
    return { text, choices: ["O", "X"], answer: yes ? 0 : 1, explanation };
  }
  if (!Array.isArray(q.choices) || q.choices.length === 0) return { skip: "noChoices" };
  if (q.choices.length < 2) return { skip: "noChoices" };
  if (q.choices.length > MAX_CHOICES) return { skip: "tooManyChoices" };
  const choices = q.choices.map(str);
  // 빈 보기를 그냥 빼면 정답 번호가 밀린다 — 문항째 뺀다
  if (choices.some((c) => !c)) return { skip: "emptyChoice" };
  let answer = q.answer;
  if (Array.isArray(answer)) {
    if (answer.length !== 1) return { skip: "multiAnswer" };
    answer = answer[0];
  }
  if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length) return { skip: "badAnswer" };
  return { text, choices, answer, explanation };
}

/**
 * 아카이브의 세트(GET /api/quizzes/:id 의 quiz) → {ok, title, questions, skipped:[{n(1부터), reason}], total, updatedAt, visibility}
 * 낼 수 있는 문항이 하나도 없으면 {ok:false, error:"empty"}.
 */
export function toRealmsQuiz(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.questions)) return fail("badResponse");
  const title = str(raw.title).slice(0, TITLE_MAX) || "아카이브 퀴즈";
  const questions = [];
  const skipped = [];
  raw.questions.forEach((q, i) => {
    const m = mapQuestion(q);
    if (m.skip) skipped.push({ n: i + 1, reason: m.skip });
    else questions.push(m);
  });
  if (!questions.length) return { ...fail("empty"), skipped, total: raw.questions.length };
  return {
    ok: true, title, questions, skipped, total: raw.questions.length,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
    visibility: raw.visibility === "private" ? "private" : "public",
  };
}

/** "arc:abc123" · "abc123" → "abc123" | "" */
export function archiveId(v) {
  const s = String(v ?? "").trim().replace(/^arc:/, "");
  return ID_RE.test(s) ? s : "";
}

/**
 * @param {object} [o]
 * @param {string} [o.base]       아카이브 주소(기본 ARCHIVE_API 또는 ARCHIVE_DEFAULT)
 * @param {number} [o.timeoutMs]  기본 5초
 * @param {number} [o.cacheMs]    기본 10분
 * @param {typeof fetch} [o.fetch]
 * @param {() => number} [o.now]
 */
export function createQuizSource(o = {}) {
  const base = String(o.base ?? process.env.ARCHIVE_API ?? ARCHIVE_DEFAULT).replace(/\/+$/, "");
  const timeoutMs = o.timeoutMs ?? TIMEOUT_MS;
  const cacheMs = o.cacheMs ?? CACHE_MS;
  const doFetch = o.fetch ?? globalThis.fetch;
  const now = o.now ?? (() => Date.now());
  const cache = new Map(); // id → {at, value}
  const flying = new Map(); // id → Promise (같은 세트를 동시에 여러 번 부르면 한 번만)

  async function load(id, ownerKey) {
    if (!base) return fail("unavailable");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const headers = { Accept: "application/json" };
      if (ownerKey) headers["X-Owner-Key"] = ownerKey;
      let res;
      try {
        res = await doFetch(`${base}/api/quizzes/${encodeURIComponent(id)}`, { headers, signal: ctl.signal, redirect: "error" });
      } catch {
        return fail(ctl.signal.aborted ? "timeout" : "network");
      }
      if (res.status === 404 || res.status === 403) return fail("notFound");
      if (res.status === 503) return fail("unavailable");
      if (!res.ok) return fail("badResponse");
      const len = Number(res.headers?.get?.("content-length"));
      if (Number.isFinite(len) && len > BODY_MAX) return fail("badResponse");
      let text;
      try {
        text = await res.text();
      } catch {
        return fail(ctl.signal.aborted ? "timeout" : "network");
      }
      if (text.length > BODY_MAX) return fail("badResponse");
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return fail("badResponse");
      }
      const r = toRealmsQuiz(data && data.quiz);
      return r.ok ? { ...r, id } : r;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * id 의 세트를 받는다. → {ok:true, id, title, questions, skipped, total, updatedAt, visibility, cached} | {ok:false, error, message}
   * @param {string} id
   * @param {{ownerKey?: string, updatedAt?: number, fresh?: boolean}} [opt]
   *   ownerKey: 비공개 세트용 소유 키 · updatedAt: 기억한 것이 이보다 오래됐으면 다시 받는다 · fresh: 늘 다시 받는다
   */
  async function get(id, opt = {}) {
    const key = archiveId(id);
    if (!key) return fail("badId");
    const t = now();
    const hit = cache.get(key);
    const stale = !hit || t - hit.at > cacheMs || opt.fresh || (Number.isFinite(opt.updatedAt) && opt.updatedAt > (hit.value.updatedAt || 0));
    if (!stale) return { ...hit.value, cached: true };
    if (hit && t - hit.at > cacheMs) cache.delete(key);
    const ownerKey = typeof opt.ownerKey === "string" && KEY_RE.test(opt.ownerKey) ? opt.ownerKey : "";
    // 소유 키를 붙인 요청은 따로 부른다(키 없이 부른 요청이 비공개 세트에서 404 를 받아도 이 요청까지 실패하지 않게)
    const flyKey = ownerKey ? `${key}\u0000k` : key;
    let p = flying.get(flyKey);
    if (!p) {
      p = load(key, ownerKey).finally(() => flying.delete(flyKey));
      flying.set(flyKey, p);
    }
    const r = await p;
    if (r.ok) {
      cache.set(key, { at: now(), value: r });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return { ...r, cached: false };
    }
    return r;
  }

  return { get, base, clear: () => cache.clear(), get size() { return cache.size; } };
}

let shared = null;
/** 기본 아카이브(ARCHIVE_API)에서 세트 하나 — 서버 전체가 같은 기억(10분)을 쓴다 */
export function fetchArchiveQuiz(id, opt) {
  if (!shared) shared = createQuizSource();
  return shared.get(id, opt);
}
