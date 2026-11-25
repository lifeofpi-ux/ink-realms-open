// 퀴즈 아카이브에서 세트 받기(server/quizsource.js): 가짜 아카이브(이 컴퓨터의 HTTP 서버)로 — 인터넷은 쓰지 않는다.
// 꼴 바꾸기(O/X → 2지선다, 못 내는 문항은 빼고 이유) · 검사 · 5초 제한(여기서는 짧게) · 10분 기억 · 소유 키 · 실패해도 던지지 않기.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createQuizSource, toRealmsQuiz, mapQuestion, archiveId, ARCHIVE_DEFAULT, MESSAGES } from "../server/quizsource.js";
import { normalizeQuestions } from "../server/quizbook.js";

const KEY = "owner-key-aaaaaaaaaaaaaaaa";

const quiz = (over = {}) => ({
  id: "abc123", title: "물질의 상태", description: "", level: "middle", grade: "1", subject: "science", tags: [], count: 3,
  visibility: "public", mine: false, updatedAt: 1000,
  questions: [
    { text: "물이 끓는 온도는?", choices: ["100℃", "50℃", "0℃"], answer: 0, explanation: "1기압에서 100℃" },
    { text: "얼음은 고체다", choices: ["O", "X"], answer: 0, explanation: "" },
    { text: "수증기는 액체다", choices: ["O", "X"], answer: 1, explanation: "기체예요" },
  ],
  ...over,
});

/** 가짜 아카이브: routes[id] = (req) => {status, body, delay} */
async function fakeArchive(routes) {
  const hits = [];
  const server = http.createServer(async (req, res) => {
    const m = /^\/api\/quizzes\/([^/?]+)$/.exec(req.url);
    hits.push({ url: req.url, key: req.headers["x-owner-key"] || "" });
    const r = m && routes[m[1]] ? await routes[m[1]](req) : { status: 404, body: { error: "notFound" } };
    if (r.delay) await new Promise((ok) => setTimeout(ok, r.delay));
    if (res.destroyed) return;
    res.writeHead(r.status ?? 200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(typeof r.body === "string" ? r.body : JSON.stringify(r.body));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    hits,
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}

test("꼴 바꾸기: 브로울스 문항(보기 2~5 · 정답 번호 · 해설) 그대로, O/X 는 2지선다, 못 내는 것은 빼고 이유를 적는다", () => {
  const r = toRealmsQuiz(quiz());
  assert.equal(r.ok, true);
  assert.equal(r.title, "물질의 상태");
  assert.equal(r.total, 3);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.questions[0], { text: "물이 끓는 온도는?", choices: ["100℃", "50℃", "0℃"], answer: 0, explanation: "1기압에서 100℃" });
  assert.deepEqual(r.questions[2].choices, ["O", "X"]);
  assert.equal(r.questions[2].answer, 1);
  // 왕국전 문제 줄(quizbook)이 하나도 버리지 않는다
  assert.equal(normalizeQuestions(r.questions).length, 3);

  // 다른 꼴: type ox · 정답 참/거짓 · 정답이 글 · 단답형 · 보기 6개 · 빈 보기 · 정답 여러 개 · 정답 번호 밖 · 문제 없음 · explain 별칭
  assert.deepEqual(mapQuestion({ type: "ox", text: "지구는 둥글다", answer: true }), { text: "지구는 둥글다", choices: ["O", "X"], answer: 0, explanation: "" });
  assert.deepEqual(mapQuestion({ text: "해는 서쪽에서 뜬다", answer: false, explain: "동쪽" }), { text: "해는 서쪽에서 뜬다", choices: ["O", "X"], answer: 1, explanation: "동쪽" });
  assert.equal(mapQuestion({ type: "OX", text: "참?", answer: "X" }).answer, 1);
  assert.equal(mapQuestion({ type: "ox", text: "보기가 거꾸로", choices: ["X", "O"], answer: 1 }).answer, 0, "고른 보기 글자(O)를 본다");
  assert.equal(mapQuestion({ type: "ox", text: "모름", answer: "글쎄" }).skip, "badAnswer");
  assert.equal(mapQuestion({ text: "수도는?", answer: "서울" }).skip, "noChoices", "단답형");
  assert.equal(mapQuestion({ text: "하나뿐", choices: ["a"], answer: 0 }).skip, "noChoices");
  assert.equal(mapQuestion({ text: "여섯", choices: ["1", "2", "3", "4", "5", "6"], answer: 5 }).skip, "tooManyChoices");
  assert.equal(mapQuestion({ text: "빈 보기", choices: ["a", " ", "c"], answer: 2 }).skip, "emptyChoice", "빼면 정답 번호가 밀린다");
  assert.equal(mapQuestion({ text: "둘 다", choices: ["a", "b", "c"], answer: [0, 2] }).skip, "multiAnswer");
  assert.equal(mapQuestion({ text: "하나만 배열", choices: ["a", "b"], answer: [1] }).answer, 1);
  assert.equal(mapQuestion({ text: "밖", choices: ["a", "b"], answer: 2 }).skip, "badAnswer");
  assert.equal(mapQuestion({ text: "  ", choices: ["a", "b"], answer: 0 }).skip, "noText");
  assert.equal(mapQuestion(null).skip, "badQuestion");
  // 제어 문자 · 긴 글 다듬기
  const long = mapQuestion({ text: "가\u0007나".padEnd(400, "다"), choices: ["a\nb", "c"], answer: 0, explanation: "e".repeat(500) });
  assert.equal(long.text.length, 200);
  assert.equal(long.choices[0], "a b");
  assert.equal(long.explanation.length, 300);

  const mixed = toRealmsQuiz(quiz({ questions: [{ text: "단답", answer: "x" }, ...quiz().questions, { text: "여섯", choices: ["1", "2", "3", "4", "5", "6"], answer: 0 }] }));
  assert.equal(mixed.ok, true);
  assert.equal(mixed.questions.length, 3);
  assert.deepEqual(mixed.skipped, [{ n: 1, reason: "noChoices" }, { n: 5, reason: "tooManyChoices" }]);
  assert.equal(mixed.total, 5);

  const none = toRealmsQuiz(quiz({ questions: [{ text: "단답", answer: "x" }] }));
  assert.equal(none.ok, false);
  assert.equal(none.error, "empty");
  assert.equal(none.message, MESSAGES.empty);
  assert.equal(toRealmsQuiz(null).error, "badResponse");
  assert.equal(toRealmsQuiz({ title: "문항 없음" }).error, "badResponse");
  assert.equal(toRealmsQuiz(quiz({ title: "" })).title, "아카이브 퀴즈");
});

test("id 다듬기: arc: 앞붙이 · 소문자 영숫자 32자까지", () => {
  assert.equal(archiveId("arc:abc123"), "abc123");
  assert.equal(archiveId("abc123"), "abc123");
  assert.equal(archiveId("ABC"), "");
  assert.equal(archiveId("../x"), "");
  assert.equal(archiveId("a".repeat(33)), "");
  assert.equal(archiveId(null), "");
  assert.equal(ARCHIVE_DEFAULT, "", "공개판은 아카이브가 기본으로 꺼져 있다");
});

test("받기: 가짜 아카이브에서 → 꼴 바꾸기, 10분 동안 기억(한 번만 부른다), 동시에 불러도 한 번, 더 새 updatedAt 이면 다시", async () => {
  let rev = 1000;
  const fa = await fakeArchive({ abc123: () => ({ body: { quiz: quiz({ updatedAt: rev }) } }) });
  let t = 0;
  const src = createQuizSource({ base: fa.base + "/", now: () => t });
  try {
    const [a, b] = await Promise.all([src.get("arc:abc123"), src.get("abc123")]);
    assert.equal(a.ok, true);
    assert.equal(a.id, "abc123");
    assert.equal(a.title, "물질의 상태");
    assert.equal(a.questions.length, 3);
    assert.equal(a.updatedAt, 1000);
    assert.deepEqual(b.questions, a.questions);
    assert.equal(fa.hits.length, 1, "동시에 두 번 불러도 아카이브에는 한 번");
    assert.equal(fa.hits[0].url, "/api/quizzes/abc123", "끝의 / 를 떼고 붙인다");

    t += 9 * 60 * 1000;
    const c = await src.get("abc123");
    assert.equal(c.cached, true);
    assert.equal(fa.hits.length, 1, "10분 안에는 기억한 것");

    // 고친 뒤 다시 고르기: 더 새 updatedAt 을 주면 다시 받는다(같거나 오래된 것은 기억한 것)
    rev = 2000;
    assert.equal((await src.get("abc123", { updatedAt: 1000 })).cached, true);
    const d = await src.get("abc123", { updatedAt: 2000 });
    assert.equal(d.cached, false);
    assert.equal(d.updatedAt, 2000);
    assert.equal(fa.hits.length, 2);
    assert.equal((await src.get("abc123", { fresh: true })).cached, false);
    assert.equal(fa.hits.length, 3);

    t += 10 * 60 * 1000 + 1;
    assert.equal((await src.get("abc123")).cached, false, "10분이 지나면 다시 받는다");
    assert.equal(fa.hits.length, 4);
    assert.equal(src.size, 1);
  } finally {
    await fa.close();
  }
});

test("받기: 비공개 세트는 소유 키를 X-Owner-Key 로 보낸다(올바른 꼴만), 실패는 기억하지 않는다", async () => {
  const fa = await fakeArchive({
    priv12: (req) => (req.headers["x-owner-key"] === KEY ? { body: { quiz: quiz({ id: "priv12", visibility: "private" }) } } : { status: 404, body: { error: "notFound" } }),
  });
  const src = createQuizSource({ base: fa.base });
  try {
    const no = await src.get("priv12");
    assert.deepEqual([no.ok, no.error], [false, "notFound"]);
    assert.equal(no.message, MESSAGES.notFound);
    const bad = await src.get("priv12", { ownerKey: "short" });
    assert.equal(bad.ok, false, "짧은 키는 보내지 않는다");
    assert.equal(fa.hits[1].key, "");
    const ok = await src.get("priv12", { ownerKey: KEY });
    assert.equal(ok.ok, true);
    assert.equal(ok.visibility, "private");
    assert.equal(fa.hits[2].key, KEY);
    assert.equal((await src.get("priv12")).cached, true, "받은 뒤에는 id 로 기억(브로울스처럼 id 를 아는 채널은 쓸 수 있다)");
  } finally {
    await fa.close();
  }
});

test("받기 실패는 던지지 않고 {ok:false, error, message}: 없음 · 503 · 500 · JSON 아님 · 꼴 틀림 · 낼 문항 없음 · 시간 초과 · 닿지 않음 · 틀린 id", async () => {
  const fa = await fakeArchive({
    gone: () => ({ status: 404, body: { error: "notFound" } }),
    forbid: () => ({ status: 403, body: { error: "forbidden" } }),
    down: () => ({ status: 503, body: { error: "unavailable" } }),
    boom: () => ({ status: 500, body: { error: "badRequest" } }),
    html: () => ({ body: "<html>not json</html>" }),
    shape: () => ({ body: { quiz: { title: "문항 없음" } } }),
    nothing: () => ({ body: { items: [] } }),
    empty: () => ({ body: { quiz: quiz({ questions: [{ text: "단답", answer: "서울" }] }) } }),
    slow: () => ({ delay: 400, body: { quiz: quiz() } }),
  });
  const src = createQuizSource({ base: fa.base, timeoutMs: 120 });
  try {
    const cases = { gone: "notFound", forbid: "notFound", down: "unavailable", boom: "badResponse", html: "badResponse", shape: "badResponse", nothing: "badResponse", empty: "empty", slow: "timeout" };
    for (const [id, error] of Object.entries(cases)) {
      const r = await src.get(id);
      assert.equal(r.ok, false, id);
      assert.equal(r.error, error, id);
      assert.equal(typeof r.message, "string", id);
      assert.ok(r.message.length > 0, id);
    }
    const before = fa.hits.length;
    for (const id of ["", "BAD!", "../etc", "a".repeat(40)]) assert.equal((await src.get(id)).error, "badId", id);
    assert.equal(fa.hits.length, before, "틀린 id 는 부르지 않는다");
    assert.equal(src.size, 0, "실패는 기억하지 않는다");
  } finally {
    await fa.close();
  }
  // 닿지 않는 주소(닫힌 포트)
  const off = createQuizSource({ base: fa.base, timeoutMs: 500 });
  const r = await off.get("abc123");
  assert.equal(r.ok, false);
  assert.ok(["network", "timeout"].includes(r.error), r.error);
});
