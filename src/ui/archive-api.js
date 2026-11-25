// 퀴즈 아카이브 손님(docs/DESIGN.md U25). 왕국전은 잉크 브로울스의 아카이브를 같이 쓴다 — 만든 퀴즈는 두 게임 모두에서 보인다.
// 브라우저가 아카이브 서버(API_BASE)를 바로 부른다(그 서버가 이 게임 주소의 브라우저 요청을 받아 줘야 한다).
//
// 주소: 공개판은 기본으로 꺼져 있다(기본 세트 8개만). 빌드 때 VITE_ARCHIVE_API 로 브로울스 꼴의 아카이브 주소를 주면 켜지고,
//       개발 · 시험에서는 ?archive=http://localhost:PORT
//       (이 컴퓨터 주소만 받는다 — 이 탭 동안 sessionStorage 에 남는다. 대기실이 주소를 ?c=코드 로 바꿔도 이어진다).
// 소유: 가입이 없어서 이 기기가 만든 난수 열쇠(소유 키)를 왕국전 localStorage("ibr-archive-owner")에 두고 X-Owner-Key 로 보낸다.
//       왕국전과 브로울스는 주소(origin)가 달라 저장소를 같이 쓰지 못한다 — 브로울스의 "내 퀴즈 내보내기" 파일로 열쇠를 가져온다(setOwnerKey).
// 오류는 Error(message = 서버가 보낸 한국어 문구) + code · status 로 던진다. 아카이브가 꺼져 있으면(503) available 이 false.

export const ARCHIVE_ORIGIN = ""; // 공개판: 아카이브 없음
export const OWNER_KEY = "ibr-archive-owner";
const OVERRIDE_KEY = "ibr-archive-base";
const LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

function safe(fn, fallback = "") {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}

/** 아카이브 주소(끝 / 없음). 모듈을 처음 읽을 때 정한다(대기실이 주소창을 바꾸기 전에) */
function pickBase() {
  const param = safe(() => new URLSearchParams(location.search).get("archive"));
  const fromParam = param ? param.trim().replace(/\/+$/, "") : "";
  if (fromParam && LOCAL_RE.test(fromParam)) {
    safe(() => sessionStorage.setItem(OVERRIDE_KEY, fromParam));
    return fromParam;
  }
  const kept = safe(() => sessionStorage.getItem(OVERRIDE_KEY));
  if (kept && LOCAL_RE.test(kept)) return kept;
  const env = safe(() => import.meta.env.VITE_ARCHIVE_API);
  if (env && /^https?:\/\/[^/]+$/.test(String(env).replace(/\/+$/, ""))) return String(env).replace(/\/+$/, "");
  return ARCHIVE_ORIGIN;
}
export const API_BASE = pickBase();

/** 32글자 16진 난수 열쇠 */
export function newOwnerKey() {
  const b = new Uint8Array(16);
  safe(() => globalThis.crypto.getRandomValues(b));
  if (b.every((v) => v === 0)) for (let i = 0; i < 16; i++) b[i] = (Math.random() * 256) | 0;
  return Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
}

export const validKey = (k) => typeof k === "string" && /^[\x21-\x7e]{16,128}$/.test(k);

const store = (k, v) => safe(() => (localStorage.setItem(k, v), true), false);
const recall = (k) => safe(() => localStorage.getItem(k) || "");

let shared = null;
/** 한 페이지에 하나(소유 키를 같이 쓴다) */
export function archiveApi() {
  if (!shared) shared = createArchiveApi();
  return shared;
}

export function createArchiveApi({ base = API_BASE } = {}) {
  let key = recall(OWNER_KEY);
  if (!validKey(key)) {
    key = newOwnerKey();
    store(OWNER_KEY, key);
  }
  const root = base.replace(/\/+$/, "") + "/api";
  const api = {
    base,
    available: true, // 마지막으로 503 을 받았으면 false
    get ownerKey() {
      return key;
    },
    /** 가져온 파일의 열쇠로 바꾼다(이 기기가 그 열쇠의 퀴즈를 고칠 수 있게) */
    setOwnerKey(k) {
      if (!validKey(k)) return false;
      key = k;
      store(OWNER_KEY, k);
      return true;
    },
  };

  async function call(method, path, body) {
    if (!base) {
      // 아카이브 주소가 없다(공개판 기본) — 꺼진 아카이브(503)처럼 알린다
      api.available = false;
      const err = new Error("");
      err.code = "unavailable";
      err.status = 503;
      throw err;
    }
    let res;
    try {
      res = await fetch(root + path, {
        method,
        mode: "cors",
        credentials: "omit",
        headers: { "X-Owner-Key": key, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
    } catch {
      const err = new Error("");
      err.code = "network";
      err.status = 0;
      throw err;
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.status === 503) api.available = false;
    else if (res.ok) api.available = true;
    if (!res.ok) {
      const err = new Error(data && typeof data.message === "string" ? data.message : "");
      err.code = data && data.error ? data.error : "http";
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** 목록 · 검색: {q, level, grade, subject, sort, mine, cursor} → {items, next} */
  api.list = (p = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "" && v !== false) qs.set(k, v === true ? "1" : String(v));
    return call("GET", `/quizzes${qs.toString() ? "?" + qs : ""}`);
  };
  api.get = (id) => call("GET", `/quizzes/${encodeURIComponent(id)}`).then((r) => r.quiz);
  api.create = (payload) => call("POST", "/quizzes", payload);
  api.update = (id, payload) => call("PUT", `/quizzes/${encodeURIComponent(id)}`, payload).then((r) => r.quiz);
  api.remove = (id) => call("DELETE", `/quizzes/${encodeURIComponent(id)}`);
  api.fork = (id, author = "") => call("POST", `/quizzes/${encodeURIComponent(id)}/fork`, { author });
  api.like = (id, on = true) => call("POST", `/quizzes/${encodeURIComponent(id)}/like`, { on });
  api.report = (id) => call("POST", `/quizzes/${encodeURIComponent(id)}/report`, {});
  /** 아카이브가 켜져 있는가(가벼운 목록 요청 한 번) */
  api.probe = async () => {
    try {
      await api.list({ sort: "recent" });
      return true;
    } catch (e) {
      return e.status !== 503 && e.status !== 0;
    }
  };
  return api;
}
