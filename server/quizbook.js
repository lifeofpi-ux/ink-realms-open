// 잉크 서재의 문제 줄(docs/DESIGN.md §4). 팀마다 세트를 섞어 줄을 세우고 앞에서 하나씩 낸다.
// 맞힌 문제는 줄 맨 뒤로, 틀린 문제는 WRONG_GAP 문제 뒤로 다시 넣는다. 줄이 비면(모두 다른 영웅이 들고 있으면) 아무 문제나 낸다.
// 문제 수와 관계없이 같은 규칙이다.
import { QUIZ } from "../shared/constants.js";

/** questions = [{ text, choices: [..], answer: 번호, explanation }] */
export function normalizeQuestions(list) {
  const out = [];
  for (const q of Array.isArray(list) ? list : []) {
    if (!q || typeof q.text !== "string" || !Array.isArray(q.choices)) continue;
    const choices = q.choices.filter((c) => typeof c === "string" && c.trim()).slice(0, 5);
    const answer = q.answer | 0;
    if (choices.length < 2 || answer < 0 || answer >= choices.length) continue;
    out.push({ text: q.text.slice(0, 200), choices, answer, explanation: typeof q.explanation === "string" ? q.explanation.slice(0, 300) : "" });
  }
  return out;
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createQuizbook(questions, teams, rand = Math.random) {
  const qs = normalizeQuestions(questions);
  const lines = [];
  for (let t = 0; t < teams; t++) lines.push(shuffle(qs.map((_, i) => i), rand));
  return {
    questions: qs,
    get size() { return qs.length; },
    /** 팀의 다음 문제 번호(문제가 없으면 −1) */
    take(team) {
      if (!qs.length) return -1;
      const line = lines[team];
      if (line.length) return line.shift();
      return Math.floor(rand() * qs.length);
    },
    /** 푼 결과를 줄에 돌려놓는다 */
    result(team, idx, correct) {
      const line = lines[team];
      if (idx < 0 || line.includes(idx)) return;
      if (correct) line.push(idx);
      else line.splice(Math.min(QUIZ.WRONG_GAP, line.length), 0, idx);
    },
    /** 풀지 않고 나왔다 — 줄 맨 앞으로 */
    giveBack(team, idx) {
      const line = lines[team];
      if (idx < 0 || line.includes(idx)) return;
      line.unshift(idx);
    },
    /** 보낼 모양: 선택지를 섞어 보내고, 섞은 순서를 돌려준다 */
    present(idx) {
      const q = qs[idx];
      const order = shuffle(q.choices.map((_, i) => i), rand);
      return { order, view: { text: q.text, choices: order.map((i) => q.choices[i]) } };
    },
    line: (team) => lines[team].slice(),
  };
}
