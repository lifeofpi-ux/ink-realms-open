// 퀴즈 아카이브의 분류표(학교급 → 학년 → 교과) — 잉크 브로울스 shared/curriculum.js 를 그대로 옮긴 것이에요(docs/DESIGN.md U25).
// 왕국전은 브로울스 아카이브를 같이 쓰므로 코드(영어 소문자)가 브로울스 서버의 normalizeClass 와 꼭 같아야 해요.
// 브로울스에서 교과를 더하면 여기에도 더해요(코드는 바꾸지 않는다). 서버의 최신 표는 GET /api/curriculum 으로도 받을 수 있어요.

const S = (code, name, grades) => ({ code, name, ...(grades ? { grades } : {}) });

export const LEVELS = [
  {
    code: "elementary", name: "초등",
    grades: [{ code: "1-2", name: "1–2학년" }, { code: "3-4", name: "3–4학년" }, { code: "5-6", name: "5–6학년" }],
    subjects: [
      S("korean", "국어"), S("math", "수학"), S("integrated", "바른 · 슬기로운 · 즐거운 생활", ["1-2"]),
      S("social", "사회", ["3-4", "5-6"]), S("science", "과학", ["3-4", "5-6"]), S("english", "영어", ["3-4", "5-6"]),
      S("moral", "도덕", ["3-4", "5-6"]), S("practical-arts", "실과", ["5-6"]), S("pe", "체육", ["3-4", "5-6"]),
      S("music", "음악", ["3-4", "5-6"]), S("art", "미술", ["3-4", "5-6"]),
      S("creative-activities", "창의적 체험활동"), S("other", "기타"),
    ],
  },
  {
    code: "middle", name: "중등",
    grades: [{ code: "1", name: "1학년" }, { code: "2", name: "2학년" }, { code: "3", name: "3학년" }],
    subjects: [
      S("korean", "국어"), S("math", "수학"), S("social", "사회"), S("history", "역사"), S("moral", "도덕"), S("science", "과학"),
      S("tech-home", "기술 · 가정"), S("informatics", "정보"), S("english", "영어"), S("pe", "체육"), S("music", "음악"), S("art", "미술"),
      S("chinese-classics", "한문"), S("second-language", "생활 외국어"), S("career", "진로"), S("other", "기타"),
    ],
  },
  {
    code: "high", name: "고등",
    grades: [{ code: "1", name: "1학년" }, { code: "2", name: "2학년" }, { code: "3", name: "3학년" }],
    subjects: [
      S("korean", "국어"), S("math", "수학"), S("english", "영어"), S("korean-history", "한국사"), S("integrated-social", "통합사회"),
      S("geography", "지리"), S("general-social", "일반사회"), S("ethics", "윤리"), S("world-history", "세계사 · 동아시아사"),
      S("integrated-science", "통합과학"), S("physics", "물리학"), S("chemistry", "화학"), S("life-science", "생명과학"),
      S("earth-science", "지구과학"), S("tech-home", "기술 · 가정"), S("informatics", "정보"), S("second-language", "제2외국어"),
      S("chinese-classics", "한문"), S("pe", "체육"), S("music", "음악"), S("art", "미술"), S("liberal-arts", "교양"),
      S("vocational", "전문 교과"), S("other", "기타"),
    ],
  },
  {
    code: "general", name: "일반",
    grades: [],
    subjects: [
      S("general-knowledge", "상식"), S("current-affairs", "시사"), S("language", "언어"), S("it-coding", "IT · 코딩"),
      S("history-culture", "역사 · 문화"), S("science", "과학"), S("economy-finance", "경제 · 금융"), S("safety-health", "안전 · 보건"),
      S("training", "연수"), S("fun", "넌센스 · 재미"), S("other", "기타"),
    ],
  },
];

const byLevel = new Map(LEVELS.map((l) => [l.code, l]));

/** 학교급 코드가 있는가. */
export const isLevel = (level) => byLevel.has(level);

/** 그 학교급에 그 학년 코드가 있는가(일반은 학년이 없다 — 빈 값만). */
export function isGrade(level, grade) {
  const L = byLevel.get(level);
  if (!L) return false;
  if (!L.grades.length) return grade === "" || grade == null;
  return L.grades.some((g) => g.code === grade);
}

/** 그 학교급에 그 교과가 있는가. grade 를 주면 그 학년에 있는 교과인지까지 본다. */
export function isSubject(level, subject, grade) {
  const L = byLevel.get(level);
  const s = L && L.subjects.find((x) => x.code === subject);
  if (!s) return false;
  return !grade || !s.grades || s.grades.includes(grade);
}

/**
 * 분류 하나를 검사해 다듬는다. 맞으면 {level, grade, subject}(일반의 학년은 ""), 아니면 null.
 * level 이 비면 일반 · 기타로 본다.
 */
export function normalizeClass({ level, grade, subject } = {}) {
  const lv = level || "general";
  const gr = grade == null ? "" : String(grade);
  const sj = subject || "other";
  if (!isLevel(lv) || !isGrade(lv, gr) || !isSubject(lv, sj, gr)) return null;
  return { level: lv, grade: gr, subject: sj };
}

/** 화면용 이름(없는 코드는 코드 그대로). */
export function className({ level, grade, subject } = {}) {
  const L = byLevel.get(level);
  if (!L) return { level: level || "", grade: grade || "", subject: subject || "" };
  const g = L.grades.find((x) => x.code === grade);
  const s = L.subjects.find((x) => x.code === subject);
  return { level: L.name, grade: g ? g.name : "", subject: s ? s.name : subject || "" };
}
