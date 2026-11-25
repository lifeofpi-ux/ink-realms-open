// 퀴즈 편집기의 순수 로직(DOM 을 모른다) — 잉크 브로울스 src/ui/quizdata.js 에서 옮겼다(docs/DESIGN.md U25).
//  - 붙여넣기로 한꺼번에 만들기: 줄 형식 → 문항 배열(parsePaste) · 문항 배열 → 줄 형식(toPasteText)
//  - 한도 검사(checkQuiz): 브로울스 서버(server/db.js 의 LIMITS · normalizeQuizInput)와 같은 한도를 입력하면서 알려 준다
//  - 내 퀴즈 내보내기 · 가져오기 파일(exportFile · parseImport): 브로울스와 같은 파일 꼴("inkbrawls.quizzes")이라
//    브로울스에서 내보낸 파일의 소유 키를 왕국전에서 가져올 수 있고, 그 반대도 된다.
//
// 붙여넣기 줄 형식:
//   문제 한 줄                     (앞의 "1." "1)" "Q1." 같은 번호는 떼어 낸다)
//   * 정답 보기                    ("*" 로 시작 — 한 문항에 하나)
//   - 오답 보기                    ("-" 로 시작 — 정답과 합쳐 2~5개)
//   > 해설(없어도 된다)            (">" 로 시작)
//   (빈 줄)                        문항과 문항 사이

/** 브로울스 서버 한도(server/db.js 의 LIMITS 와 같은 값) */
export const LIMITS = Object.freeze({
  QUESTIONS: 50,
  TEXT: 120,
  CHOICES_MIN: 2,
  CHOICES_MAX: 5,
  CHOICE: 40,
  EXPLAIN: 200,
  TITLE: 60,
  DESCRIPTION: 300,
  TAGS: 8,
  TAG: 20,
  AUTHOR: 20,
});

/** 글자 수(코드 포인트 — 서버의 cleanText 와 같은 셈) */
export const charCount = (s) => Array.from(String(s ?? "")).length;

/** 서버의 cleanText 와 같은 다듬기(제어 · 투명 문자 빼기, 공백 한 칸, 앞뒤 공백 떼기). 자르지는 않는다 */
export function tidyText(v) {
  if (typeof v !== "string") return "";
  return v
    .replace(/[\p{Cc}\u2028\u2029]/gu, " ")
    .replace(/[\p{Cf}\u115F\u1160\u3164\uFFA0\u2800]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const NUM_PREFIX = /^(?:Q\s*)?\d{1,3}\s*[.)．、:]\s*/i;

/**
 * 붙여넣은 글 → { questions:[{text, choices[], answer, explanation}], errors:[{line, code, q}] }.
 * 오류가 있는 문항도 가능한 만큼 담는다(편집기에서 고치게). code: "noChoices" | "fewChoices" | "manyChoices" | "noAnswer" |
 * "manyAnswers" | "orphan" | "textLong" | "choiceLong" | "explainLong" | "tooMany".
 */
export function parsePaste(raw) {
  const lines = String(raw ?? "").replace(/\r\n?/g, "\n").split("\n");
  const questions = [];
  const errors = [];
  let cur = null;
  const close = () => {
    if (!cur) return;
    const q = cur;
    cur = null;
    const qi = questions.length;
    const err = (code, line = q.line) => errors.push({ line, code, q: qi });
    if (!q.choices.length) err("noChoices");
    else if (q.choices.length < LIMITS.CHOICES_MIN) err("fewChoices");
    else if (q.choices.length > LIMITS.CHOICES_MAX) err("manyChoices");
    if (q.choices.length && q.answers.length === 0) err("noAnswer");
    if (q.answers.length > 1) err("manyAnswers", q.answers[1].line);
    if (charCount(q.text) > LIMITS.TEXT) err("textLong");
    q.choices.forEach((c, i) => { if (charCount(c) > LIMITS.CHOICE) err("choiceLong", q.choiceLines[i]); });
    if (charCount(q.explanation) > LIMITS.EXPLAIN) err("explainLong");
    questions.push({ text: q.text, choices: q.choices, answer: q.answers.length ? q.answers[0].i : 0, explanation: q.explanation });
  };
  lines.forEach((rawLine, idx) => {
    const line = idx + 1;
    const s = rawLine.trim();
    if (!s) {
      close();
      return;
    }
    const head = s[0];
    if (head === "*" || head === "-" || head === "−" || head === "•" || head === "+") {
      const body = tidyText(s.slice(1));
      if (!cur) {
        errors.push({ line, code: "orphan", q: questions.length });
        return;
      }
      if (!body) return;
      const correct = head === "*" || head === "+";
      if (correct) cur.answers.push({ i: cur.choices.length, line });
      cur.choices.push(body);
      cur.choiceLines.push(line);
      return;
    }
    if (head === ">") {
      const body = tidyText(s.slice(1));
      if (!cur) {
        errors.push({ line, code: "orphan", q: questions.length });
        return;
      }
      cur.explanation = cur.explanation ? `${cur.explanation} ${body}` : body;
      return;
    }
    // 보기가 나온 뒤의 새 글 줄은 다음 문제(빈 줄을 빠뜨려도 이어진다). 보기 전이면 문제가 여러 줄로 이어진 것
    if (cur && cur.choices.length) close();
    const text = tidyText(s.replace(NUM_PREFIX, ""));
    if (!cur) cur = { text, choices: [], choiceLines: [], answers: [], explanation: "", line };
    else cur.text = tidyText(`${cur.text} ${text}`);
  });
  close();
  if (questions.length > LIMITS.QUESTIONS) errors.push({ line: 0, code: "tooMany", q: LIMITS.QUESTIONS });
  return { questions, errors };
}

/** 문항 배열 → 붙여넣기 줄 형식 */
export function toPasteText(questions) {
  return (questions || [])
    .map((q) => {
      const out = [String(q.text ?? "")];
      (q.choices || []).forEach((c, i) => out.push(`${i === q.answer ? "*" : "-"} ${c}`));
      if (q.explanation) out.push(`> ${q.explanation}`);
      return out.join("\n");
    })
    .join("\n\n");
}

/** 태그 칸(쉼표로 나눈 글 또는 배열) → 다듬은 태그 배열(빈 것 · 겹친 것 빼기) */
export function splitTags(v) {
  const raw = Array.isArray(v) ? v : String(v ?? "").split(/[,，#]/);
  const out = [];
  for (const t of raw) {
    const s = tidyText(String(t ?? ""));
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * 한도 검사: 저장 전에(그리고 입력하는 동안) 무엇이 넘쳤는지. 빈 배열이면 저장할 수 있다.
 * @returns {{ field: string, q: number, c?: number, code: string, n?: number, max?: number }[]}
 */
export function checkQuiz(quiz) {
  const out = [];
  const q = quiz || {};
  const title = tidyText(q.title ?? "");
  if (!title) out.push({ field: "title", q: -1, code: "empty" });
  else if (charCount(title) > LIMITS.TITLE) out.push({ field: "title", q: -1, code: "long", n: charCount(title), max: LIMITS.TITLE });
  const desc = tidyText(q.description ?? "");
  if (charCount(desc) > LIMITS.DESCRIPTION) out.push({ field: "description", q: -1, code: "long", n: charCount(desc), max: LIMITS.DESCRIPTION });
  const tags = splitTags(q.tags);
  if (tags.length > LIMITS.TAGS) out.push({ field: "tags", q: -1, code: "many", n: tags.length, max: LIMITS.TAGS });
  tags.forEach((t, i) => { if (charCount(t) > LIMITS.TAG) out.push({ field: "tag", q: -1, c: i, code: "long", n: charCount(t), max: LIMITS.TAG }); });
  const qs = Array.isArray(q.questions) ? q.questions : [];
  if (!qs.length) out.push({ field: "questions", q: -1, code: "few", n: 0, max: LIMITS.QUESTIONS });
  if (qs.length > LIMITS.QUESTIONS) out.push({ field: "questions", q: -1, code: "many", n: qs.length, max: LIMITS.QUESTIONS });
  qs.forEach((item, qi) => {
    const text = tidyText(item.text ?? "");
    if (!text) out.push({ field: "text", q: qi, code: "empty" });
    else if (charCount(text) > LIMITS.TEXT) out.push({ field: "text", q: qi, code: "long", n: charCount(text), max: LIMITS.TEXT });
    const choices = Array.isArray(item.choices) ? item.choices : [];
    if (choices.length < LIMITS.CHOICES_MIN) out.push({ field: "choices", q: qi, code: "few", n: choices.length, max: LIMITS.CHOICES_MIN });
    if (choices.length > LIMITS.CHOICES_MAX) out.push({ field: "choices", q: qi, code: "many", n: choices.length, max: LIMITS.CHOICES_MAX });
    choices.forEach((c, ci) => {
      const v = tidyText(c ?? "");
      if (!v) out.push({ field: "choice", q: qi, c: ci, code: "empty" });
      else if (charCount(v) > LIMITS.CHOICE) out.push({ field: "choice", q: qi, c: ci, code: "long", n: charCount(v), max: LIMITS.CHOICE });
    });
    if (!(Number.isInteger(item.answer) && item.answer >= 0 && item.answer < choices.length)) out.push({ field: "answer", q: qi, code: "empty" });
    const ex = tidyText(item.explanation ?? "");
    if (charCount(ex) > LIMITS.EXPLAIN) out.push({ field: "explanation", q: qi, code: "long", n: charCount(ex), max: LIMITS.EXPLAIN });
  });
  return out;
}

/** 편집기 상태 → 서버로 보낼 본문(브로울스 server/db.js 의 normalizeQuizInput 이 받는 모양) */
export function toPayload(quiz, author = "") {
  return {
    title: tidyText(quiz.title ?? ""),
    description: tidyText(quiz.description ?? ""),
    level: quiz.level || "general",
    grade: quiz.grade || "",
    subject: quiz.subject || "other",
    tags: splitTags(quiz.tags),
    visibility: quiz.visibility === "private" ? "private" : "public",
    ...(author ? { author: Array.from(tidyText(author)).slice(0, LIMITS.AUTHOR).join("") } : {}),
    questions: (quiz.questions || []).map((q) => ({
      text: tidyText(q.text ?? ""),
      choices: (q.choices || []).map((c) => tidyText(c ?? "")),
      answer: q.answer | 0,
      explanation: tidyText(q.explanation ?? ""),
    })),
  };
}

// ---------------------------------------------------------------- 내 퀴즈 내보내기 · 가져오기(브로울스와 같은 파일 꼴)

export const EXPORT_FORMAT = "inkbrawls.quizzes";

/** 내보내기 파일 내용(JSON 글). ownerKey 를 담으면 다른 기기 · 브로울스에서 이 기기의 퀴즈를 고칠 수 있다 */
export function exportFile({ ownerKey = "", quizzes = [] } = {}) {
  return JSON.stringify({ format: EXPORT_FORMAT, v: 1, ownerKey, quizzes: quizzes.map((q) => ({ id: q.id, ...toPayload(q) })) }, null, 1);
}

/** 가져오기 파일 → { ok, ownerKey, quizzes:[payload + id?] } | { ok:false, error:"format" } */
export function parseImport(text) {
  let v;
  try {
    v = JSON.parse(String(text ?? ""));
  } catch {
    return { ok: false, error: "format" };
  }
  if (!v || typeof v !== "object" || v.format !== EXPORT_FORMAT || !Array.isArray(v.quizzes)) return { ok: false, error: "format" };
  const ownerKey = typeof v.ownerKey === "string" && /^[\x21-\x7e]{16,128}$/.test(v.ownerKey) ? v.ownerKey : "";
  const quizzes = v.quizzes
    .filter((q) => q && typeof q === "object" && Array.isArray(q.questions))
    .slice(0, 200)
    .map((q) => ({ ...(typeof q.id === "string" ? { id: q.id } : {}), ...toPayload(q) }));
  return { ok: true, ownerKey, quizzes };
}
