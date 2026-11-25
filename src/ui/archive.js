// 퀴즈 고르기 창(docs/DESIGN.md U25): 잉크 브로울스의 퀴즈 아카이브 창을 왕국전으로 옮겼다 — 같은 아카이브를 같이 쓴다.
//   고르기(기본 세트 8개 + 아카이브 검색 · 학교급/학년/교과 칩 · 인기/최신) · 미리 보기(좋아요 · 복사해서 고치기 · 신고) ·
//   내 퀴즈(고치기 · 지우기 · 내보내기 · 브로울스 열쇠 가져오기) · 새로 만들기(편집기 — 붙여넣기 · 한도 검사).
// 대기실이 openQuizPicker({ current, onPick, canPick }) 로 연다. 고르면 onPick 에 다음 중 하나를 준다:
//   {src:"seed", key, title, count} · {src:"arc", id, title, count, updatedAt, visibility, mine} · {src:"none", title:"", count:0}(아케이드)
// 사용자 글(제목 · 문제 · 만든 사람)은 전부 textContent 로 넣는다.
import "./archive.css";
import { SEED_SETS } from "../../shared/quizseed.js";
import { LEVELS, className } from "./archive-curriculum.js";
import { archiveApi, API_BASE } from "./archive-api.js";
import { TA, TE, fmt } from "./archive-texts.js";
import { LIMITS, charCount, parsePaste, checkQuiz, toPayload, exportFile, parseImport } from "./archive-data.js";

const SEARCH_WAIT = 250;
const TABS = ["browse", "mine", "create"];

// ------------------------------------------------------------------ 작은 DOM 도구
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function btn(cls, text, attrs = {}) {
  const b = el("button", cls, text);
  b.type = "button";
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) b.setAttribute(k, String(v));
  return b;
}
function input(attrs = {}) {
  const i = document.createElement(attrs.tag === "textarea" ? "textarea" : "input");
  for (const [k, v] of Object.entries(attrs)) if (k !== "tag" && v !== undefined && v !== null) i.setAttribute(k, String(v));
  i.spellcheck = false;
  return i;
}
/** 라벨이 붙은 입력칸: <label class=qe-fld><span>이름</span><input …><small class=qe-cnt></small></label> */
function field(label, inp, { cls = "", counter = false } = {}) {
  const wrap = el("label", `qe-fld ${cls}`.trim());
  wrap.append(el("span", "qe-fld-name", label), inp);
  if (counter) wrap.append(el("small", "qe-cnt"));
  return wrap;
}
/** 라디오처럼 고르는 단추 줄. options: [{value, label}] */
function segment(label, options, onPick, cls = "") {
  const node = el("div", `qp-seg ${cls}`.trim());
  node.setAttribute("role", "radiogroup");
  node.setAttribute("aria-label", label);
  const buttons = options.map((o) => {
    const b = btn("", o.label, { role: "radio", "aria-checked": "false" });
    b.dataset.v = String(o.value);
    node.append(b);
    return b;
  });
  let cur;
  function set(value) {
    cur = value;
    buttons.forEach((b, i) => b.setAttribute("aria-checked", String(String(options[i].value) === String(value))));
  }
  node.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b || b.getAttribute("aria-checked") === "true") return;
    const o = options[buttons.indexOf(b)];
    set(o.value);
    onPick?.(o.value);
  });
  return { node, set, get value() { return cur; } };
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** 알림(대기실 toast 와 같은 모양). kind: "info" | "error" */
function toast(text, kind = "info") {
  const t = el("div", `toast qp-toast ${kind}`, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}
const recallName = () => {
  try {
    return localStorage.getItem("ibr-name") || "";
  } catch {
    return "";
  }
};

// ------------------------------------------------------------------ 기본 세트 · 고른 것
const levelOf = (code) => LEVELS.find((l) => l.code === code) || null;
function classLine(q) {
  const c = className(q);
  return [c.level, c.grade, c.subject].filter(Boolean).join(" · ");
}
/** 왕국전에 들어 있는 기본 세트(목록 카드 꼴) */
export const SEEDS = SEED_SETS.map((s) => ({
  src: "seed", key: s.key, title: s.title, description: s.description || "", level: s.level, grade: s.grade || "", subject: s.subject,
  tags: s.tags || [], count: s.questions.length, questions: s.questions,
  search: [s.title, s.description, ...(s.tags || []), ...s.questions.flatMap((q) => [q.text, ...q.choices])].join(" ").toLowerCase(),
}));

/**
 * 고른 것(대기실 settings.quiz 글 또는 고르기 결과) → {src:"seed"|"arc"|"none", key?, id?, title, count}
 * 글: "" = 아케이드 · "seed:<key>" 또는 기본 세트 key · "arc:<id>"
 */
export function parseSelection(v) {
  if (v && typeof v === "object") {
    if (v.src === "seed") return describeSeed(v.key, v);
    if (v.src === "arc" && v.id) return { src: "arc", id: String(v.id), title: v.title || "", count: v.count | 0 };
    return { src: "none", title: "", count: 0 };
  }
  const s = String(v ?? "").trim();
  if (!s) return { src: "none", title: "", count: 0 };
  if (s.startsWith("arc:")) return { src: "arc", id: s.slice(4), title: "", count: 0 };
  return describeSeed(s.replace(/^seed:/, ""));
}
function describeSeed(key, over = {}) {
  const s = SEEDS.find((x) => x.key === key);
  if (!s) return { src: "none", title: "", count: 0 };
  return { src: "seed", key: s.key, title: over.title || s.title, count: over.count || s.count };
}
const selKey = (s) => (s.src === "seed" ? `seed:${s.key}` : s.src === "arc" ? `arc:${s.id}` : "none");

/** 지금 이 기기의 퀴즈 소유 키(비공개 아카이브 세트를 경기 서버가 받아 올 때 함께 보낸다) */
export const ownerKey = () => archiveApi().ownerKey;
export { API_BASE };

// ------------------------------------------------------------------ 창(한 페이지에 하나)
let picker = null;

/**
 * 퀴즈 고르기 창을 연다.
 * @param {object} o
 * @param {string|object} [o.current]   지금 고른 것(settings.quiz 글 또는 고르기 결과 — 제목 · 문제 수가 있으면 위 띠에 보인다)
 * @param {(sel) => void} [o.onPick]    고르면 부른다(창은 닫힌다)
 * @param {boolean|(() => boolean)} [o.canPick=true]  false 면 둘러보기 · 만들기만(방장이 아닐 때)
 * @param {"browse"|"mine"|"create"} [o.tab]
 * @param {string} [o.author]           만든 사람 이름의 기본값(기본: 내 닉네임)
 * @returns {{ close: () => void }}
 */
export function openQuizPicker(o = {}) {
  if (!picker) picker = createPicker();
  picker.open(o);
  return { close: () => picker.close(true) };
}

function createPicker() {
  const api = archiveApi();
  const st = { onPick: null, canPick: false, current: parseSelection(""), author: "" };
  let opener = null;

  // ---------------------------------------------------------------- 틀
  const wrap = el("div", "qp");
  wrap.hidden = true;
  const panel = el("div", "qp-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", TA.title);
  const head = el("header", "qp-head");
  const stamp = el("span", "qp-stamp", TA.title);
  const tabsEl = el("div", "qp-tabs");
  tabsEl.setAttribute("role", "tablist");
  const tabBtns = {};
  for (const k of TABS) {
    const b = btn("qp-tab", TA.tabs[k], { role: "tab", "aria-selected": "false", id: `qp-tab-${k}`, "aria-controls": `qp-pane-${k}` });
    b.dataset.tab = k;
    if (!API_BASE && k !== "browse") b.hidden = true; // 아카이브 주소가 없다(공개판 기본) — 기본 세트 고르기만
    tabBtns[k] = b;
    tabsEl.append(b);
  }
  const closeX = btn("qp-x", "×", { "aria-label": TA.close });
  head.append(stamp, tabsEl, closeX);
  const nowBar = el("div", "qp-now");
  const body = el("div", "qp-body");
  const panes = {};
  for (const k of [...TABS, "preview"]) {
    const p = el("section", `qp-pane qp-${k}`);
    p.id = `qp-pane-${k}`;
    p.setAttribute("role", "tabpanel");
    p.hidden = true;
    panes[k] = p;
    body.append(p);
  }
  panel.append(head, nowBar, body);
  wrap.append(panel);
  document.body.append(wrap);

  let tab = "browse";
  let back = "browse"; // 미리 보기에서 돌아갈 탭
  function showTab(k, { focus = false } = {}) {
    if (k !== "preview") back = k;
    tab = k;
    for (const t of TABS) {
      const on = t === k || (k === "preview" && t === back);
      tabBtns[t].setAttribute("aria-selected", String(on));
      tabBtns[t].tabIndex = on ? 0 : -1;
      if (on && focus) tabBtns[t].focus({ preventScroll: true });
    }
    for (const [name, p] of Object.entries(panes)) p.hidden = name !== k;
    if (k === "browse" && !browse.loaded) browse.reload();
    if (k === "mine") mine.reload();
    body.scrollTop = 0;
  }
  const leaveEditorOk = () => tab !== "create" || !editor.dirty || confirm(TE.discardAsk);
  tabsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b || !leaveEditorOk()) return;
    if (b.dataset.tab === "create" && tab !== "create") editor.load(null);
    showTab(b.dataset.tab);
  });
  tabsEl.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    if (!leaveEditorOk()) return;
    const i = TABS.indexOf(tab === "preview" ? back : tab);
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    if (next === "create") editor.load(null);
    showTab(next, { focus: true });
  });
  closeX.addEventListener("click", () => close());
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  });

  const errText = (e) => (e && e.status === 0 ? TA.network : (e && e.message) || TA.failed);

  function paintNow() {
    nowBar.textContent = "";
    const c = st.current;
    nowBar.append(el("span", "qp-now-k", TA.now));
    if (c.src === "none") nowBar.append(el("b", "qp-now-t arcade", TA.nowArcade));
    else {
      nowBar.append(el("b", "qp-now-t", c.title || (c.src === "arc" ? TA.arcGroup : "")));
      if (c.count) nowBar.append(el("span", "qp-now-n", fmt(TA.count, { n: c.count })));
      nowBar.append(el("span", `qp-now-src ${c.src}`, c.src === "seed" ? TA.seedBy : TA.arcGroup));
    }
    if (!st.canPick) nowBar.append(el("small", "qp-now-ro", TA.viewOnly));
  }
  /** 카드 · 단추의 "지금 쓰는 퀴즈" 표시를 다시 */
  function paintCurrent() {
    const k = selKey(st.current);
    for (const n of wrap.querySelectorAll("[data-sel]")) n.classList.toggle("is-current", n.dataset.sel === k);
  }

  // ---------------------------------------------------------------- 카드(목록 한 줄)
  function card(q, { actions = [], sel } = {}) {
    const node = el("div", "qp-card");
    node.setAttribute("role", "listitem");
    node.dataset.sel = sel;
    if (q.src !== "seed") node.__quiz = q; // "고르기" 단추가 문제 수 · updatedAt · 공개 범위를 쓴다
    if (sel === selKey(st.current)) node.classList.add("is-current");
    const main = btn("qp-card-main");
    main.dataset.sel = sel;
    const title = el("b", "qp-card-title", q.title);
    const meta = el("span", "qp-card-meta");
    meta.append(el("span", "qp-count", fmt(TA.count, { n: q.count | 0 })), el("span", "qp-class", classLine(q)));
    if (q.src === "seed") meta.append(el("span", "qp-by", TA.seedBy));
    else {
      meta.append(
        el("span", "", fmt(TA.plays, { n: q.plays | 0 })),
        el("span", "", fmt(TA.likes, { n: q.likes | 0 })),
        el("span", "qp-by", fmt(TA.by, { name: q.author || TA.anon }))
      );
      if (q.mine) {
        meta.prepend(el("span", `qp-vis ${q.visibility}`, q.visibility === "private" ? TA.private : TA.public));
        if (q.hidden) meta.prepend(el("span", "qp-vis hidden", TA.hidden));
      }
    }
    main.append(el("i", "qp-cur-mark", TA.using), title, meta);
    if (q.description) main.append(el("span", "qp-card-desc", q.description));
    node.append(main);
    const row = el("div", "qp-card-acts");
    const use = btn("qp-btn sm hot qp-pickonly", TA.useShort);
    use.dataset.use = sel;
    row.append(use, ...actions);
    node.append(row);
    return node;
  }

  // ---------------------------------------------------------------- 고르기(기본 세트 + 아카이브)
  const browse = (() => {
    const p = panes.browse;
    const filters = el("div", "qp-filters");
    const search = input({ type: "search", placeholder: TA.searchPlaceholder, enterkeyhint: "search", "aria-label": TA.searchLabel, maxlength: 100 });
    search.className = "qp-search";
    const chipsRow = (label) => {
      const r = el("div", "qp-chips");
      r.setAttribute("role", "radiogroup");
      r.setAttribute("aria-label", label);
      return r;
    };
    const lvRow = chipsRow(TA.levelLabel);
    const grRow = chipsRow(TA.gradeLabel);
    const sjRow = chipsRow(TA.subjectLabel);
    const sort = segment(TA.sortLabel, [{ value: "popular", label: TA.sort.popular }, { value: "recent", label: TA.sort.recent }], () => reload(), "qp-sort");
    sort.set("popular");
    const top = el("div", "qp-top");
    top.append(search, sort.node);
    filters.append(top, lvRow, grRow, sjRow);

    const seedHead = el("div", "qp-group");
    seedHead.append(el("h3", "", TA.seedGroup), el("small", "", TA.seedNote));
    const seeds = el("div", "qp-seeds");
    seeds.setAttribute("role", "list");
    const arcHead = el("div", "qp-group");
    arcHead.append(el("h3", "", TA.arcGroup), el("small", "", TA.shared));
    const list = el("div", "qp-list");
    list.setAttribute("role", "list");
    const status = el("p", "qp-status");
    status.setAttribute("aria-live", "polite");
    const retry = btn("qp-btn sm ghost", TA.retry);
    retry.hidden = true;
    const more = btn("qp-btn ghost qp-more", TA.more);
    more.hidden = true;
    p.append(filters, seedHead, seeds, arcHead, list, status, retry, more);
    if (!API_BASE) arcHead.hidden = list.hidden = true;

    const f = { level: "", grade: "", subject: "", next: null, seq: 0, loaded: false };
    function chip(label, value, on) {
      const b = btn("qp-chip", label, { role: "radio", "aria-checked": String(on) });
      b.dataset.v = value;
      return b;
    }
    function paintChips() {
      lvRow.replaceChildren(chip(TA.all, "", !f.level), ...LEVELS.map((l) => chip(l.name, l.code, f.level === l.code)));
      const L = levelOf(f.level);
      grRow.hidden = !L || !L.grades.length;
      if (L && L.grades.length) grRow.replaceChildren(chip(TA.all, "", !f.grade), ...L.grades.map((g) => chip(g.name, g.code, f.grade === g.code)));
      sjRow.hidden = !L;
      if (L) {
        const subs = L.subjects.filter((s) => !f.grade || !s.grades || s.grades.includes(f.grade));
        sjRow.replaceChildren(chip(TA.all, "", !f.subject), ...subs.map((s) => chip(s.name, s.code, f.subject === s.code)));
      }
    }
    lvRow.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      f.level = b.dataset.v;
      f.grade = "";
      f.subject = "";
      paintChips();
      reload();
    });
    grRow.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      f.grade = b.dataset.v;
      const L = levelOf(f.level);
      const s = L && L.subjects.find((x) => x.code === f.subject);
      if (s && s.grades && f.grade && !s.grades.includes(f.grade)) f.subject = "";
      paintChips();
      reload();
    });
    sjRow.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (!b) return;
      f.subject = b.dataset.v;
      paintChips();
      reload();
    });
    let timer = 0;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(reload, SEARCH_WAIT);
    });
    search.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        clearTimeout(timer);
        reload();
      }
    });
    retry.addEventListener("click", () => reload());
    more.addEventListener("click", () => load(false));

    /** 기본 세트: 같은 칩 · 검색 낱말로 이 자리에서 거른다. 맨 앞은 "퀴즈 없이(아케이드)" */
    function paintSeeds() {
      const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const hit = SEEDS.filter((s) => (!f.level || s.level === f.level) && (!f.grade || s.grade === f.grade) && (!f.subject || s.subject === f.subject) && words.every((w) => s.search.includes(w)));
      const nodes = hit.map((s) => card(s, { sel: `seed:${s.key}` }));
      if (!words.length && !f.level) {
        const a = el("div", "qp-card qp-arcade qp-pickonly");
        a.setAttribute("role", "listitem");
        a.dataset.sel = "none";
        if (st.current.src === "none") a.classList.add("is-current");
        const b = btn("qp-card-main");
        b.dataset.use = "none";
        b.append(el("i", "qp-cur-mark", TA.using), el("b", "qp-card-title", TA.arcade), el("span", "qp-card-meta", TA.arcadeSub));
        a.append(b);
        nodes.unshift(a);
      }
      seeds.replaceChildren(...nodes);
      seedHead.hidden = seeds.hidden = !nodes.length;
    }

    async function load(reset) {
      const seq = ++f.seq;
      if (reset) {
        f.next = null;
        list.textContent = "";
        paintSeeds();
      }
      if (!API_BASE) { f.loaded = true; status.textContent = ""; return; } // 공개판: 아카이브 없음 — 기본 세트만
      status.textContent = TA.loading;
      more.hidden = true;
      retry.hidden = true;
      try {
        const r = await api.list({ q: search.value.trim(), level: f.level, grade: f.grade, subject: f.subject, sort: sort.value, cursor: reset ? undefined : f.next });
        if (seq !== f.seq) return;
        f.loaded = true;
        for (const q of r.items) list.append(card(q, { sel: `arc:${q.id}` }));
        f.next = r.next;
        more.hidden = !r.next;
        status.textContent = list.childElementCount ? "" : TA.empty;
      } catch (e) {
        if (seq !== f.seq) return;
        status.textContent = e.status === 503 ? TA.unavailable : errText(e);
        retry.hidden = false;
      }
    }
    function reload() {
      clearTimeout(timer);
      return load(true);
    }
    paintChips();
    p.addEventListener("click", onCardClick);
    return { reload, get loaded() { return f.loaded; }, set loaded(v) { f.loaded = v; }, focus: () => search.focus({ preventScroll: true }) };
  })();

  /** 목록 카드 누르기: 본문 = 미리 보기, "고르기" = 곧바로 고르기 */
  async function onCardClick(e) {
    const use = e.target.closest("[data-use]");
    if (use) {
      const k = use.dataset.use;
      if (k === "none") return pick({ src: "none", title: "", count: 0 });
      if (k.startsWith("seed:")) {
        const s = SEEDS.find((x) => x.key === k.slice(5));
        if (s) pick({ src: "seed", key: s.key, title: s.title, count: s.count });
        return;
      }
      if (k.startsWith("arc:")) {
        const n = use.closest(".qp-card");
        const q = n && n.__quiz;
        if (q) pick(q);
        else {
          try {
            pick(await api.get(k.slice(4)));
          } catch (err) {
            toast(errText(err), "error");
          }
        }
      }
      return;
    }
    const main = e.target.closest(".qp-card-main[data-sel]");
    if (!main) return;
    const k = main.dataset.sel;
    if (k.startsWith("seed:")) preview.openSeed(k.slice(5));
    else if (k.startsWith("arc:")) preview.open(k.slice(4));
  }

  // ---------------------------------------------------------------- 미리 보기
  const preview = (() => {
    const p = panes.preview;
    const backBtn = btn("qp-btn sm ghost qp-back", TA.back);
    const title = el("h3", "qp-pv-title");
    const meta = el("p", "qp-pv-meta");
    const desc = el("p", "qp-pv-desc");
    const note = el("p", "qp-pv-note");
    const use = btn("qp-btn hot big qp-use qp-pickonly", TA.use);
    const acts = el("div", "qp-pv-acts");
    const like = btn("qp-btn ghost", TA.like, { "aria-pressed": "false" });
    const fork = btn("qp-btn ghost", TA.fork);
    const edit = btn("qp-btn ghost", TA.edit);
    const remove = btn("qp-btn sm danger", TA.remove);
    const report = btn("qp-btn sm danger", TA.report);
    acts.append(like, fork, edit, remove, report);
    const headRow = el("div", "qp-pv-head");
    const info = el("div", "qp-pv-info");
    info.append(title, meta, desc, note);
    headRow.append(info, use);
    const qs = el("ol", "qp-qs");
    const status = el("p", "qp-status");
    p.append(backBtn, headRow, acts, status, qs);
    let q = null; // 보고 있는 세트(아카이브: 서버 세트 · 기본 세트: SEEDS 의 것)
    let liked = false;
    backBtn.addEventListener("click", () => showTab(back));

    function metaLine() {
      const bits = [classLine(q), fmt(TA.count, { n: q.count ?? q.questions.length })];
      if (q.src === "seed") bits.push(TA.seedBy);
      else bits.push(fmt(TA.plays, { n: q.plays | 0 }), fmt(TA.likes, { n: q.likes | 0 }), fmt(TA.by, { name: q.author || TA.anon }));
      return bits.join(" · ");
    }
    function paint() {
      title.textContent = q.title;
      meta.textContent = metaLine();
      desc.textContent = q.description || "";
      desc.hidden = !q.description;
      note.textContent = q.src !== "seed" && q.mine && q.visibility === "private" ? TA.privateNote : "";
      note.hidden = !note.textContent;
      const sel = q.src === "seed" ? `seed:${q.key}` : `arc:${q.id}`;
      use.dataset.sel = sel;
      use.classList.toggle("is-current", sel === selKey(st.current));
      use.textContent = sel === selKey(st.current) ? TA.using : TA.use;
      const arc = q.src !== "seed";
      like.hidden = !arc;
      report.hidden = !arc || !!q.mine;
      edit.hidden = remove.hidden = !(arc && q.mine);
      fork.textContent = arc ? TA.fork : TA.forkSeed;
      report.disabled = false;
      qs.textContent = "";
      for (const item of q.questions) {
        const li = el("li", "qp-q");
        li.append(el("p", "qp-q-text", item.text));
        const ch = el("ul", "qp-q-choices");
        item.choices.forEach((c, i) => {
          const c1 = el("li", i === item.answer ? "is-answer" : "", c);
          if (i === item.answer) c1.append(el("em", "qp-q-ok", TA.answer));
          ch.append(c1);
        });
        li.append(ch);
        if (item.explanation) li.append(el("p", "qp-q-ex", `${TA.explain} · ${item.explanation}`));
        qs.append(li);
      }
    }
    function reset() {
      showTab("preview");
      q = null;
      for (const n of [title, meta, desc, note, qs]) n.textContent = "";
      acts.hidden = true;
      use.hidden = true;
    }
    async function open(id) {
      reset();
      status.textContent = TA.loading;
      try {
        q = await api.get(id);
      } catch (e) {
        status.textContent = errText(e);
        return;
      }
      status.textContent = "";
      acts.hidden = false;
      use.hidden = false;
      liked = false;
      like.textContent = TA.like;
      like.setAttribute("aria-pressed", "false");
      paint();
      (st.canPick ? use : backBtn).focus({ preventScroll: true });
    }
    function openSeed(key) {
      const s = SEEDS.find((x) => x.key === key);
      if (!s) return;
      reset();
      status.textContent = "";
      q = s;
      acts.hidden = false;
      use.hidden = false;
      paint();
      (st.canPick ? use : backBtn).focus({ preventScroll: true });
    }
    use.addEventListener("click", () => {
      if (!q) return;
      if (q.src === "seed") pick({ src: "seed", key: q.key, title: q.title, count: q.count });
      else pick(q);
    });
    like.addEventListener("click", async () => {
      if (!q || q.src === "seed") return;
      try {
        const r = await api.like(q.id, !liked);
        liked = !!r.liked;
        q.likes = r.likes;
        like.textContent = liked ? TA.unlike : TA.like;
        like.setAttribute("aria-pressed", String(liked));
        meta.textContent = metaLine();
      } catch (e) {
        toast(errText(e), "error");
      }
    });
    report.addEventListener("click", async () => {
      if (!q || q.src === "seed" || !confirm(TA.reportAsk)) return;
      try {
        await api.report(q.id);
        toast(TA.reported);
        report.disabled = true;
      } catch (e) {
        toast(errText(e), "error");
      }
    });
    fork.addEventListener("click", async () => {
      if (!q) return;
      if (q.src === "seed") {
        // 기본 세트는 아카이브의 것이 아니라 왕국전에 들어 있는 것 — 편집기에 새 퀴즈로 옮겨 담는다(저장하면 아카이브에 올라간다)
        editor.load({ ...q, id: null, mine: false, visibility: "public", author: "" });
        toast(TA.seedCopied);
        showTab("create");
        return;
      }
      try {
        const r = await api.fork(q.id, st.author);
        toast(TA.forked);
        editor.load(r.quiz);
        showTab("create");
        browse.loaded = false; // 돌아가면 다시 불러온다
      } catch (e) {
        toast(errText(e), "error");
      }
    });
    edit.addEventListener("click", () => {
      if (!q || !q.mine) return;
      editor.load(q);
      showTab("create");
    });
    remove.addEventListener("click", async () => {
      if (!q || !q.mine || !confirm(fmt(TA.removeAsk, { title: q.title }))) return;
      try {
        await api.remove(q.id);
        toast(TA.removed);
        browse.loaded = false;
        showTab(back === "mine" ? "mine" : "browse");
      } catch (e) {
        toast(errText(e), "error");
      }
    });
    return { open, openSeed };
  })();

  // ---------------------------------------------------------------- 내 퀴즈
  const mine = (() => {
    const p = panes.mine;
    const tools = el("div", "qp-mine-tools");
    const exp = btn("qp-btn ghost", TA.exportMine);
    const impLabel = el("label", "qp-btn ghost qp-import");
    const imp = input({ type: "file", accept: ".json,application/json" });
    imp.className = "qp-sr";
    impLabel.append(TA.importKey, imp);
    tools.append(impLabel, exp);
    const note = el("p", "qp-note");
    note.append(TA.keyNote, " ", el("b", "", TA.keyWarn));
    const list = el("div", "qp-list");
    list.setAttribute("role", "list");
    const status = el("p", "qp-status");
    status.setAttribute("aria-live", "polite");
    const more = btn("qp-btn ghost qp-more", TA.more);
    more.hidden = true;
    p.append(tools, note, list, status, more);
    let next = null;
    let seq = 0;
    let count = 0;

    function row(q) {
      const ed = btn("qp-btn sm ghost", TA.edit);
      ed.addEventListener("click", async () => {
        try {
          editor.load(await api.get(q.id));
          showTab("create");
        } catch (e) {
          toast(errText(e), "error");
        }
      });
      const rm = btn("qp-btn sm danger", TA.remove);
      rm.addEventListener("click", async () => {
        if (!confirm(fmt(TA.removeAsk, { title: q.title }))) return;
        try {
          await api.remove(q.id);
          toast(TA.removed);
          browse.loaded = false;
          reload();
        } catch (e) {
          toast(errText(e), "error");
        }
      });
      const node = card(q, { actions: [ed, rm], sel: `arc:${q.id}` });
      return node;
    }
    p.addEventListener("click", onCardClick);
    async function load(reset) {
      const s = ++seq;
      if (reset) {
        list.textContent = "";
        count = 0;
        next = null;
      }
      status.textContent = TA.loading;
      more.hidden = true;
      try {
        const r = await api.list({ mine: true, sort: "recent", cursor: reset ? undefined : next });
        if (s !== seq) return;
        for (const q of r.items) {
          count++;
          list.append(row(q));
        }
        next = r.next;
        more.hidden = !next;
        status.textContent = count ? "" : TA.mineEmpty;
      } catch (e) {
        if (s !== seq) return;
        status.textContent = e.status === 503 ? TA.unavailable : errText(e);
      }
    }
    const reload = () => load(true);
    more.addEventListener("click", () => load(false));

    /** 내 퀴즈 전부(문제 포함) */
    async function all() {
      const out = [];
      let cursor;
      for (let guard = 0; guard < 50; guard++) {
        const r = await api.list({ mine: true, sort: "recent", cursor });
        out.push(...r.items);
        if (!r.next) break;
        cursor = r.next;
      }
      const full = [];
      for (const q of out) full.push(await api.get(q.id));
      return full;
    }
    exp.addEventListener("click", async () => {
      try {
        const qs = await all();
        download(TA.exportFile, exportFile({ ownerKey: api.ownerKey, quizzes: qs }), "application/json;charset=utf-8");
        toast(fmt(TA.exported, { n: qs.length }));
      } catch (e) {
        toast(errText(e), "error");
      }
    });
    // 브로울스 "내 퀴즈 내보내기" 파일(같은 꼴)에서 열쇠만 가져온다 — 아카이브가 같아서 퀴즈는 이미 거기 있다
    imp.addEventListener("change", async () => {
      const file = imp.files && imp.files[0];
      imp.value = "";
      if (!file) return;
      const r = parseImport(await file.text());
      if (!r.ok) return toast(TA.importBad, "error");
      if (!r.ownerKey) return toast(TA.importNoKey, "error");
      if (r.ownerKey === api.ownerKey) return toast(TA.importSame);
      if (!confirm(TA.importAsk)) return;
      api.setOwnerKey(r.ownerKey);
      toast(TA.importedKey);
      browse.loaded = false;
      reload();
    });
    return { reload };
  })();

  // ---------------------------------------------------------------- 편집기
  const editor = createEditor(panes.create, {
    api,
    author: () => st.author,
    canUse: () => st.canPick,
    errText,
    onSaved(q, use) {
      browse.loaded = false;
      if (use) pick(q);
    },
    onRemoved() {
      browse.loaded = false;
      showTab("mine");
    },
  });

  // ---------------------------------------------------------------- 고르기 · 열기 · 닫기
  function pick(q) {
    if (!st.canPick || !st.onPick) return;
    let sel;
    if (q.src === "none") sel = { src: "none", title: "", count: 0 };
    else if (q.src === "seed") sel = { src: "seed", key: q.key, title: q.title, count: q.count | 0 };
    else {
      sel = {
        src: "arc", id: q.id, title: q.title, count: q.count ?? (q.questions ? q.questions.length : 0),
        updatedAt: Number.isFinite(q.updatedAt) ? q.updatedAt : 0, visibility: q.visibility === "private" ? "private" : "public", mine: !!q.mine,
      };
    }
    const cb = st.onPick;
    toast(sel.src === "none" ? TA.pickedArcade : fmt(TA.picked, { title: sel.title }));
    close(true);
    cb(sel);
  }

  function open({ current = "", onPick = null, canPick = true, tab: first = "browse", author } = {}) {
    st.onPick = typeof onPick === "function" ? onPick : null;
    st.canPick = !!st.onPick && (typeof canPick === "function" ? !!canPick() : canPick !== false);
    st.current = parseSelection(current);
    st.author = typeof author === "string" ? author : recallName();
    wrap.classList.toggle("can-pick", st.canPick);
    stamp.textContent = st.canPick ? TA.title : TA.titleManage;
    panel.setAttribute("aria-label", stamp.textContent);
    paintNow();
    paintCurrent();
    opener = document.activeElement;
    wrap.hidden = false;
    document.documentElement.classList.add("qp-open");
    const k = TABS.includes(first) ? first : "browse";
    if (k === "create") editor.load(null);
    browse.loaded = false; // 열 때마다 새로(다른 기기 · 브로울스에서 만든 것도 보이게)
    showTab(k);
    tabBtns[k].focus({ preventScroll: true });
  }
  function close(force = false) {
    if (wrap.hidden) return;
    if (!force && !leaveEditorOk()) return;
    wrap.hidden = true;
    document.documentElement.classList.remove("qp-open");
    st.onPick = null;
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }
  return { open, close };
}

// ==================================================================== 편집기
/**
 * 문제 편집기(브로울스 편집기와 같다). load(quiz|null) 로 새로 만들기 · 고치기를 시작한다.
 * 구조가 바뀔 때(문제 · 보기 더하기 · 지우기 · 옮기기 · 붙여넣기)만 문제 칸을 다시 만들고, 글자를 칠 때는 세는 칸과 확인 목록만 고친다.
 */
function createEditor(p, { api, author, canUse, errText, onSaved, onRemoved }) {
  let q = null;
  let dirty = false;
  let saving = false;
  const blankQuestion = () => ({ text: "", choices: ["", ""], answer: 0, explanation: "" });
  const blankQuiz = () => ({ id: null, title: "", description: "", level: "general", grade: "", subject: "general-knowledge", tags: "", visibility: "public", questions: [blankQuestion()] });

  const heading = el("h3", "qe-heading");
  const limitsLine = el("p", "qe-limits", TE.limits);
  const title = input({ maxlength: LIMITS.TITLE + 20, placeholder: TE.titlePlaceholder });
  const desc = input({ tag: "textarea", rows: 2, maxlength: LIMITS.DESCRIPTION + 40, placeholder: TE.descriptionPlaceholder });
  const level = document.createElement("select");
  const grade = document.createElement("select");
  const subject = document.createElement("select");
  const tags = input({ maxlength: 200, placeholder: TE.tagsPlaceholder });
  const who = input({ maxlength: LIMITS.AUTHOR });
  const vis = segment(TE.visibility, [{ value: "public", label: TE.public }, { value: "private", label: TE.private }], (v) => {
    q.visibility = v;
    touch();
  }, "qe-vis");
  const meta = el("div", "qe-meta");
  const fTitle = field(TE.title, title, { cls: "qe-title", counter: true });
  const fDesc = field(TE.description, desc, { cls: "qe-desc", counter: true });
  const cls = el("div", "qe-class");
  cls.append(field(TE.level, level), field(TE.grade, grade), field(TE.subject, subject));
  const fTags = field(TE.tags, tags, { cls: "qe-tags" });
  const fWho = field(TE.author, who, { cls: "qe-who" });
  const visWrap = el("div", "qe-visrow");
  visWrap.append(el("span", "qe-fld-name", TE.visibility), vis.node);
  meta.append(fTitle, fDesc, cls, fTags, fWho, visWrap);

  const pasteBox = el("details", "qe-paste");
  const pasteSum = el("summary", "", TE.paste);
  const pasteHelp = el("p", "qe-paste-help", TE.pasteHelp);
  const pasteEx = el("pre", "qe-paste-ex", TE.pasteExample);
  const pasteArea = input({ tag: "textarea", rows: 8, "aria-label": TE.pasteLabel }); // 예시는 바로 위(pasteEx)에 보인다
  const pasteActs = el("div", "qe-paste-acts");
  const pasteAppend = btn("qp-btn sm", TE.pasteAppend);
  const pasteReplace = btn("qp-btn sm ghost", TE.pasteReplace);
  pasteActs.append(pasteAppend, pasteReplace);
  const pasteOut = el("ul", "qe-paste-out");
  pasteOut.setAttribute("aria-live", "polite");
  pasteBox.append(pasteSum, pasteHelp, pasteEx, pasteArea, pasteActs, pasteOut);

  const qHead = el("div", "qe-qhead");
  const qCount = el("b", "qe-qcount");
  qHead.append(el("span", "qp-stamp sm", TE.questions), qCount, el("small", "qe-hint", TE.answerHint));
  const qList = el("ol", "qe-qs");
  const addQ = btn("qp-btn ghost qe-addq", TE.addQ);

  const issuesBox = el("div", "qe-issues");
  issuesBox.setAttribute("aria-live", "polite");
  const foot = el("div", "qe-foot");
  const save = btn("qp-btn qe-save", TE.save);
  const saveUse = btn("qp-btn hot qe-saveuse", TE.saveUse);
  const remove = btn("qp-btn sm danger qe-remove", TE.remove);
  foot.append(remove, save, saveUse);
  p.append(heading, limitsLine, meta, pasteBox, qHead, qList, addQ, issuesBox, foot);

  // ---------------------------------------------------------------- 분류 고르기
  function fillSelect(sel, items, value) {
    sel.textContent = "";
    for (const it of items) {
      const o = document.createElement("option");
      o.value = it.code;
      o.textContent = it.name;
      sel.append(o);
    }
    sel.value = items.some((i) => i.code === value) ? value : items[0]?.code ?? "";
  }
  function paintClass() {
    fillSelect(level, LEVELS, q.level);
    q.level = level.value;
    const L = levelOf(q.level);
    grade.disabled = !L.grades.length;
    fillSelect(grade, L.grades.length ? L.grades : [{ code: "", name: "—" }], q.grade);
    q.grade = grade.value;
    const subs = L.subjects.filter((s) => !q.grade || !s.grades || s.grades.includes(q.grade));
    fillSelect(subject, subs, q.subject);
    q.subject = subject.value;
  }
  level.addEventListener("change", () => {
    q.level = level.value;
    q.grade = "";
    paintClass();
    touch();
  });
  grade.addEventListener("change", () => {
    q.grade = grade.value;
    paintClass();
    touch();
  });
  subject.addEventListener("change", () => {
    q.subject = subject.value;
    touch();
  });

  // ---------------------------------------------------------------- 세는 칸
  function counter(fld, value, max) {
    const c = fld && fld.querySelector(".qe-cnt");
    if (!c) return;
    const n = charCount(value.trim());
    c.textContent = fmt(TE.counter, { n, max });
    c.classList.toggle("over", n > max);
    fld.classList.toggle("is-over", n > max);
  }
  title.addEventListener("input", () => {
    q.title = title.value;
    counter(fTitle, title.value, LIMITS.TITLE);
    touch();
  });
  desc.addEventListener("input", () => {
    q.description = desc.value;
    counter(fDesc, desc.value, LIMITS.DESCRIPTION);
    touch();
  });
  tags.addEventListener("input", () => {
    q.tags = tags.value;
    touch();
  });
  who.addEventListener("input", () => touch());

  // ---------------------------------------------------------------- 문제 칸
  function questionNode(item, qi) {
    const li = el("li", "qe-q");
    li.dataset.qi = String(qi);
    const top = el("div", "qe-q-top");
    top.append(el("b", "qe-q-num", fmt(TE.qNumber, { n: qi + 1 })));
    const up = btn("qp-mini", "↑", { "aria-label": TE.up, "data-act": "up" });
    const down = btn("qp-mini", "↓", { "aria-label": TE.down, "data-act": "down" });
    const rm = btn("qp-mini danger", "×", { "aria-label": TE.removeQ, "data-act": "rmq" });
    up.disabled = qi === 0;
    down.disabled = qi === q.questions.length - 1;
    rm.disabled = q.questions.length <= 1;
    top.append(up, down, rm);
    const text = input({ tag: "textarea", rows: 2, maxlength: LIMITS.TEXT + 40, placeholder: TE.qTextPlaceholder });
    text.value = item.text;
    text.dataset.f = "text";
    const fText = field(TE.qText, text, { cls: "qe-q-text", counter: true });
    counter(fText, item.text, LIMITS.TEXT);
    const choices = el("div", "qe-choices");
    choices.setAttribute("role", "radiogroup");
    choices.setAttribute("aria-label", TE.answerMark);
    item.choices.forEach((c, ci) => {
      const row = el("div", "qe-choice");
      if (ci === item.answer) row.classList.add("is-answer");
      const mark = btn("qe-mark", String(ci + 1), { role: "radio", "aria-checked": String(ci === item.answer), "aria-label": fmt(TE.answerAria, { n: ci + 1 }), "data-act": "answer" });
      mark.dataset.ci = String(ci);
      const ci1 = input({ maxlength: LIMITS.CHOICE + 20, placeholder: TE.choicePlaceholder, "aria-label": fmt(TE.choice, { n: ci + 1 }) });
      ci1.value = c;
      ci1.dataset.f = "choice";
      ci1.dataset.ci = String(ci);
      const cnt = el("small", "qe-cnt");
      const crm = btn("qp-mini", "−", { "aria-label": TE.removeChoice, "data-act": "rmc" });
      crm.dataset.ci = String(ci);
      crm.disabled = item.choices.length <= LIMITS.CHOICES_MIN;
      row.append(mark, ci1, cnt, crm);
      paintChoiceCount(row, c);
      choices.append(row);
    });
    const addC = btn("qp-mini qe-addc", TE.addChoice, { "data-act": "addc" });
    addC.disabled = item.choices.length >= LIMITS.CHOICES_MAX;
    const ex = input({ maxlength: LIMITS.EXPLAIN + 40, placeholder: TE.explanationPlaceholder });
    ex.value = item.explanation || "";
    ex.dataset.f = "explanation";
    const fEx = field(TE.explanation, ex, { cls: "qe-q-ex", counter: true });
    counter(fEx, ex.value, LIMITS.EXPLAIN);
    li.append(top, fText, choices, addC, fEx);
    return li;
  }
  function paintChoiceCount(row, value) {
    const n = charCount(value.trim());
    const c = row.querySelector(".qe-cnt");
    c.textContent = fmt(TE.counter, { n, max: LIMITS.CHOICE });
    c.classList.toggle("over", n > LIMITS.CHOICE);
    row.classList.toggle("is-over", n > LIMITS.CHOICE);
  }
  function renderQuestions(focus) {
    qList.textContent = "";
    q.questions.forEach((item, qi) => qList.append(questionNode(item, qi)));
    qCount.textContent = fmt(TE.counter, { n: q.questions.length, max: LIMITS.QUESTIONS });
    qCount.classList.toggle("over", q.questions.length > LIMITS.QUESTIONS);
    addQ.disabled = q.questions.length >= LIMITS.QUESTIONS;
    if (focus) {
      const node = qList.querySelector(focus);
      if (node) node.focus({ preventScroll: false });
    }
  }
  qList.addEventListener("input", (e) => {
    const t = e.target;
    const li = t.closest(".qe-q");
    if (!li || !t.dataset.f) return;
    const item = q.questions[Number(li.dataset.qi)];
    if (t.dataset.f === "text") {
      item.text = t.value;
      counter(t.closest(".qe-fld"), t.value, LIMITS.TEXT);
    } else if (t.dataset.f === "explanation") {
      item.explanation = t.value;
      counter(t.closest(".qe-fld"), t.value, LIMITS.EXPLAIN);
    } else if (t.dataset.f === "choice") {
      item.choices[Number(t.dataset.ci)] = t.value;
      paintChoiceCount(t.closest(".qe-choice"), t.value);
    }
    touch();
  });
  qList.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const li = b.closest(".qe-q");
    const qi = Number(li.dataset.qi);
    const item = q.questions[qi];
    const act = b.dataset.act;
    let focus = null;
    if (act === "answer") {
      item.answer = Number(b.dataset.ci);
      focus = `.qe-q[data-qi="${qi}"] .qe-mark[data-ci="${item.answer}"]`;
    } else if (act === "rmc") {
      const ci = Number(b.dataset.ci);
      item.choices.splice(ci, 1);
      if (item.answer === ci) item.answer = 0;
      else if (item.answer > ci) item.answer--;
      focus = `.qe-q[data-qi="${qi}"] .qe-addc`;
    } else if (act === "addc") {
      item.choices.push("");
      focus = `.qe-q[data-qi="${qi}"] input[data-ci="${item.choices.length - 1}"]`;
    } else if (act === "up" || act === "down") {
      const to = act === "up" ? qi - 1 : qi + 1;
      [q.questions[qi], q.questions[to]] = [q.questions[to], q.questions[qi]];
      focus = `.qe-q[data-qi="${to}"] [data-act="${act}"]`;
    } else if (act === "rmq") {
      q.questions.splice(qi, 1);
      focus = `.qe-q[data-qi="${Math.max(0, qi - 1)}"] textarea`;
    }
    renderQuestions(focus);
    touch();
  });
  addQ.addEventListener("click", () => {
    q.questions.push(blankQuestion());
    renderQuestions(`.qe-q[data-qi="${q.questions.length - 1}"] textarea`);
    touch();
  });

  // ---------------------------------------------------------------- 붙여넣기
  function doPaste(replace) {
    const r = parsePaste(pasteArea.value);
    pasteOut.textContent = "";
    if (!r.questions.length) {
      pasteOut.append(el("li", "bad", TE.pasteNone));
      return;
    }
    const keep = replace ? [] : q.questions.filter((x) => x.text.trim() || x.choices.some((c) => c.trim()));
    q.questions = [...keep, ...r.questions.map((x) => ({ ...x, choices: x.choices.slice() }))];
    renderQuestions();
    touch();
    pasteOut.append(el("li", "ok", fmt(TE.pasteDone, { n: r.questions.length })));
    if (r.errors.length) {
      pasteOut.append(el("li", "bad", fmt(TE.pasteIssues, { n: r.errors.length })));
      for (const er of r.errors.slice(0, 8)) pasteOut.append(el("li", "bad", fmt(TE.pasteErrors[er.code] || er.code, { line: er.line })));
    } else pasteArea.value = "";
  }
  pasteAppend.addEventListener("click", () => doPaste(false));
  pasteReplace.addEventListener("click", () => doPaste(true));

  // ---------------------------------------------------------------- 확인 목록
  let issueTimer = 0;
  function issueText(i) {
    const key = `${i.field}_${i.code}`;
    const qn = i.q >= 0 ? fmt(TE.qNumber, { n: i.q + 1 }) : "";
    return fmt(TE.issues[key] || key, { q: qn, n: i.n ?? "", max: i.max ?? "" });
  }
  function paintIssues() {
    const list = checkQuiz(q);
    issuesBox.textContent = "";
    if (list.length) {
      issuesBox.append(el("b", "qe-issues-title", TE.issuesTitle));
      const ul = el("ul");
      for (const i of list.slice(0, 10)) ul.append(el("li", "", issueText(i)));
      issuesBox.append(ul);
    }
    const ok = list.length === 0 && !saving;
    save.disabled = !ok;
    saveUse.disabled = !ok;
    return list;
  }
  function touch() {
    dirty = true;
    clearTimeout(issueTimer);
    issueTimer = setTimeout(paintIssues, 150);
  }

  // ---------------------------------------------------------------- 저장 · 지우기
  async function doSave(use) {
    if (saving || paintIssues().length) return;
    saving = true;
    save.textContent = TE.saving;
    save.disabled = saveUse.disabled = true;
    try {
      const payload = toPayload(q, who.value);
      let saved;
      if (q.id) saved = await api.update(q.id, payload);
      else saved = (await api.create(payload)).quiz;
      q.id = saved.id;
      dirty = false;
      heading.textContent = TE.editTitle;
      remove.hidden = false;
      toast(TE.saved);
      onSaved(saved, use);
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      saving = false;
      save.textContent = TE.save;
      paintIssues();
    }
  }
  save.addEventListener("click", () => doSave(false));
  saveUse.addEventListener("click", () => doSave(true));
  remove.addEventListener("click", async () => {
    if (!q.id || !confirm(fmt(TA.removeAsk, { title: q.title }))) return;
    try {
      await api.remove(q.id);
      dirty = false;
      toast(TA.removed);
      onRemoved();
    } catch (e) {
      toast(errText(e), "error");
    }
  });

  /** 새로 만들기(null) 또는 고치기(서버에서 받은 세트 — 문제 포함, 내 것이 아니면 새로 만들기로) */
  function load(src) {
    q = src
      ? {
          id: src.mine ? src.id : null,
          title: src.title || "",
          description: src.description || "",
          level: src.level || "general",
          grade: src.grade || "",
          subject: src.subject || "other",
          tags: (src.tags || []).join(", "),
          visibility: src.visibility === "private" ? "private" : "public",
          questions: (src.questions || []).map((x) => ({ text: x.text, choices: x.choices.slice(), answer: x.answer | 0, explanation: x.explanation || "" })),
        }
      : blankQuiz();
    if (!q.questions.length) q.questions.push(blankQuestion());
    heading.textContent = q.id ? TE.editTitle : TE.newTitle;
    remove.hidden = !q.id;
    saveUse.hidden = !canUse();
    title.value = q.title;
    desc.value = q.description;
    tags.value = q.tags;
    who.value = (src && src.author) || author() || "";
    counter(fTitle, title.value, LIMITS.TITLE);
    counter(fDesc, desc.value, LIMITS.DESCRIPTION);
    vis.set(q.visibility);
    paintClass();
    renderQuestions();
    pasteOut.textContent = "";
    pasteArea.value = "";
    pasteBox.open = false;
    dirty = false;
    paintIssues();
  }
  load(null);
  return {
    load,
    get dirty() {
      return dirty;
    },
  };
}
