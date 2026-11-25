// 대기실 → 경기 시작 → 스냅숏 · me · team · 영웅 움직임 · 다시 들어오기 · 끝 → 다시(진짜 WebSocket)
// 자리(U24): 팀당 최대 인원 하나로 정원을 정하고, 컴퓨터는 방장이 명단에서 직접 넣고 뺀다(저절로 채우지 않는다)
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { decodeSnapshot, PHASE } from "../shared/protocol.js";
import { UTYPE, MAPS, DEFAULT_MAP, DEFAULT_MINUTES, MAX_TEAMS, MAX_PER_TEAM, MAX_PLAYERS, TEAM_COUNTS } from "../shared/constants.js";

// 경기를 다섯 배 빠르게(세기 3초 → 0.6초). lobby.js 는 읽을 때 GAME_SPEED 를 보므로 그 전에 정한다
process.env.GAME_SPEED = "5";
const { Lobby, BOT_NAMES } = await import("../server/lobby.js");
const { createQuizSource } = await import("../server/quizsource.js");

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const msgs = [];
  const snaps = [];
  const waiters = [];
  ws.on("message", (d, bin) => {
    if (bin) snaps.push(decodeSnapshot(new Uint8Array(d).buffer));
    else {
      const m = JSON.parse(String(d));
      msgs.push(m);
      if (m.t === "start" && m.phase === 3) ws.send(JSON.stringify({ t: "ready" })); // 시작 전 읽기(U32) — 카드를 닫은 것처럼
    }
    for (const w of waiters.splice(0)) w();
  });
  ws.on("error", () => {});
  const until = async (fn, ms = 5000) => {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error("기다리다 시간 초과");
      await new Promise((r) => { waiters.push(r); setTimeout(r, 50); });
    }
  };
  return {
    ws, msgs, snaps, until,
    open: () => new Promise((r, j) => { ws.once("open", r); ws.once("error", j); }),
    send: (m) => ws.send(JSON.stringify(m)),
    last: (t) => [...msgs].reverse().find((m) => m.t === t),
    count: (t) => msgs.filter((m) => m.t === t).length,
  };
}

/** 시험마다 서버 하나. 끝나면(실패해도) 모든 연결 · 타이머를 닫는다 */
async function withServer(fn, opts = {}) {
  const lobby = new Lobby(opts);
  const server = http.createServer();
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => lobby.connect(ws));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const clients = [];
  const mk = async () => { const c = client(server.address().port); clients.push(c); await c.open(); return c; };
  try {
    await fn({ lobby, mk });
  } finally {
    for (const c of clients) c.ws.terminate();
    for (const ws of wss.clients) ws.terminate();
    lobby.close();
    await new Promise((r) => wss.close(r));
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

/** 방장이 채널을 연다 → { a, code } */
async function host(mk, name = "선생님", key = "h0") {
  const a = await mk();
  a.send({ t: "hello", name, key });
  await a.until(() => a.last("hello"));
  a.send({ t: "create" });
  const L = await a.until(() => a.last("lobby"));
  return { a, code: L.code };
}

/** 학생이 채널에 들어온다(들어오기를 기다린다) */
async function joiner(mk, code, name, key) {
  const c = await mk();
  c.send({ t: "hello", name, key });
  c.send({ t: "join", code });
  await c.until(() => c.last("lobby") || c.last("error"));
  return c;
}

/** 보낸 것을 서버가 다 처리했을 때까지(같은 채널에 다시 join = 대기실을 다시 보내 준다) */
async function sync(c, code) {
  const n = c.count("lobby");
  c.send({ t: "join", code });
  return c.until(() => c.count("lobby") > n && c.last("lobby"));
}

/** act 뒤에 새로 온 error */
async function errorAfter(c, act) {
  const n = c.count("error");
  act();
  return c.until(() => c.count("error") > n && c.last("error"));
}

/** 대기실 화면이 보는 팀마다 [사람 수, 컴퓨터 수] */
const seats = (L) => Array.from({ length: L.settings.teams }, (_, t) => [L.members.filter((m) => m.team === t).length, L.bots.filter((b) => b.team === t).length]);
const teamOf = (c) => { const L = c.last("lobby"); return L.members.find((m) => m.id === L.you).team; };

test("대기실: 처음 설정은 2팀 · 팀당 4명 · 잉크 숲 · 퀴즈 없음(아케이드) · 15분 · 컴퓨터 없음, hello 에 맵 · 팀당 인원 목록", async () => {
  await withServer(async ({ lobby, mk }) => {
    const a = await mk();
    a.send({ t: "hello", name: "선생님", key: "ka" });
    const hello = await a.until(() => a.last("hello"));
    assert.ok(hello.sets.length >= 1);
    assert.deepEqual(hello.maps.map((m) => m.key), MAPS.map((m) => m.key));
    assert.deepEqual(hello.teamCounts, TEAM_COUNTS);
    assert.deepEqual(hello.perTeamChoices, [1, 2, 3, 4]);
    a.send({ t: "create" });
    const L = await a.until(() => a.last("lobby"));
    assert.deepEqual(L.settings, { teams: 2, map: DEFAULT_MAP, quiz: "", minutes: DEFAULT_MINUTES, perTeam: MAX_PER_TEAM });
    assert.deepEqual(L.bots, [], "저절로 들어오는 컴퓨터는 없다");
    a.send({ t: "settings", map: "moon", minutes: 7, perTeam: 9 });
    a.send({ t: "settings", teams: 2, bots: 5, fill: true }); // 예전 bots · fill 은 받지 않는다
    await a.until(() => a.count("lobby") >= 3);
    const L2 = a.last("lobby");
    assert.equal(L2.settings.map, DEFAULT_MAP, "없는 맵은 받지 않는다");
    assert.equal(L2.settings.minutes, DEFAULT_MINUTES, "없는 시간은 받지 않는다");
    assert.equal(L2.settings.perTeam, MAX_PER_TEAM, "1 ~ 4 밖의 팀당 인원은 받지 않는다");
    assert.ok(!("bots" in L2.settings) && !("fill" in L2.settings));
    assert.deepEqual(L2.bots, []);
    // 상대 팀이 비어 있으면 시작하지 않는다 → 컴퓨터를 넣으면 시작
    const e = await errorAfter(a, () => a.send({ t: "start" }));
    assert.match(e.text, /빈 팀이 있어요/);
    assert.equal(lobby.channels.get(L.code).game, null);
    a.send({ t: "bot", op: "add", team: 1 });
    await a.until(() => a.last("lobby").bots.length === 1);
    a.send({ t: "start" });
    const st = await a.until(() => a.last("start"));
    assert.equal(st.mode, "arcade", "퀴즈를 안 고르면 아케이드");
    assert.equal(st.map, DEFAULT_MAP);
    assert.equal(st.minutes, DEFAULT_MINUTES);
    assert.equal(st.players.length, 2, "사람 1 + 넣은 컴퓨터 1");
    assert.ok(st.players.every((p) => Number.isInteger(p.char) && p.char >= 0 && p.char < 8));
    assert.deepEqual(st.players.map((p) => [p.team, p.bot]), [[0, false], [1, true]]);
  });
});

test("대기실: 만들기 · 들어오기 · 맵/퀴즈 설정 · 시작 · 스냅숏 · me · team · 영웅 움직임 · 다시 들어오기 · 끝 → 다시", async () => {
  await withServer(async ({ lobby, mk }) => {
    const a = await mk(), b = await mk();
    a.send({ t: "hello", name: "선생님", key: "ka" });
    b.send({ t: "hello", name: "학생", key: "kb" });
    await a.until(() => a.last("hello"));
    a.send({ t: "create" });
    const L = await a.until(() => a.last("lobby"));
    assert.equal(L.code.length, 5);
    b.send({ t: "join", code: L.code });
    await b.until(() => b.last("lobby"));
    const L2 = await a.until(() => { const m = a.last("lobby"); return m.members.length === 2 && m; });
    assert.notEqual(L2.members[0].team, L2.members[1].team, "다른 팀으로 나뉜다");
    b.send({ t: "settings", teams: 4 }); // 방장이 아니면 무시
    b.send({ t: "start" });
    const quiz = (await a.until(() => a.last("hello"))).sets[0].key;
    a.send({ t: "settings", teams: 3, map: "canal", quiz, minutes: 10 });
    const L3 = await a.until(() => { const m = a.last("lobby"); return m.settings.teams === 3 && m; });
    assert.deepEqual(L3.settings, { teams: 3, perTeam: MAX_PER_TEAM, map: "canal", quiz, minutes: 10 });
    // 팀마다 2명이 되게 컴퓨터를 넣는다(0 · 1팀에 하나씩, 빈 2팀에 둘)
    for (const team of [0, 1, 2, 2]) a.send({ t: "bot", op: "add", team });
    await a.until(() => a.last("lobby").bots.length === 4);
    a.send({ t: "start" });
    const sa = await a.until(() => a.last("start"));
    const sb = await b.until(() => b.last("start"));
    assert.equal(sa.teams, 3);
    assert.equal(sa.map, "canal");
    assert.equal(sa.mode, "quiz", "퀴즈 세트를 고르면 퀴즈 모드");
    assert.equal(sa.minutes, 10);
    assert.equal(sa.players.length, 6, "사람 2 + 컴퓨터 4");
    assert.notEqual(sa.you, sb.you);
    assert.deepEqual(sa.crates, []);
    // 스냅숏 · me · team
    const snap = await a.until(() => a.snaps.find((s) => s.phase === PHASE.PLAY));
    const hero = snap.units.find((u) => u.owner === sa.you && u.type === UTYPE.HERO);
    assert.ok(hero, "내 영웅이 보인다");
    assert.ok(snap.buildings.length === 12 && snap.sites.length === 4);
    const me = await a.until(() => a.last("me"));
    assert.equal(me.heroId, hero.id);
    const team = await a.until(() => a.last("team"));
    assert.ok(Number.isFinite(team.gold) && Number.isFinite(team.core) && Number.isFinite(team.ink));
    // 영웅 움직임 보고: 조금 옮기면 받아서 스냅숏에 그 자리
    const g = lobby.channels.get(L.code).game;
    const h = g.heroOf(sa.you);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const [dx, dy] = dirs.find(([x, y]) => g.grid.passableAt(h.x + x * 0.9, h.y + y * 0.9) && g.grid.passableAt(h.x + x * 0.4, h.y + y * 0.4));
    const to = { x: h.x + dx * 0.5, y: h.y + dy * 0.5 };
    a.send({ t: "mv", x: to.x, y: to.y, z: 0, f: 0, d: 0 });
    await a.until(() => { const s = a.snaps.at(-1); const u = s.units.find((x) => x.id === hero.id); return u && Math.hypot(u.x - to.x, u.y - to.y) < 0.05; });
    // 순간 이동 보고는 warp 로 되돌린다
    a.send({ t: "mv", x: h.x + 15, y: h.y, z: 0, f: 0, d: 0 });
    await a.until(() => a.last("warp"));
    // b 가 나갔다 같은 키로 다시 들어오면 자리를 돌려받는다
    b.ws.close();
    await a.until(() => g.players[sb.you].bot === true);
    const c = await mk();
    c.send({ t: "hello", name: "학생", key: "kb" });
    c.send({ t: "join", code: L.code });
    const sc = await c.until(() => c.last("start"));
    assert.equal(sc.you, sb.you);
    assert.equal(sc.map, "canal");
    assert.equal(g.players[sb.you].bot, false);
    await c.until(() => c.last("warp"), 3000);
    await c.until(() => c.snaps.length > 0);
    // 다른 키로는 경기 중에 못 들어온다
    const d = await mk();
    d.send({ t: "hello", name: "손님", key: "kd" });
    d.send({ t: "join", code: L.code });
    await d.until(() => d.last("error"));
    // 경기 중에는 컴퓨터를 넣거나 뺄 수 없다
    const eb = await errorAfter(a, () => a.send({ t: "bot", op: "remove", i: 0 }));
    assert.match(eb.text, /경기 중에는/);
    assert.equal(lobby.channels.get(L.code).bots.length, 4);
    // 끝 → 결과 → 다시(대기실로)
    g.finish("time");
    const end = await a.until(() => a.last("end"));
    assert.equal(end.reason, "time");
    assert.equal(end.ranking.length, 3);
    await c.until(() => c.last("end"));
    const before = a.count("lobby");
    a.send({ t: "again" });
    const back = await a.until(() => a.count("lobby") > before && a.last("lobby"));
    assert.equal(back.result.reason, "time", "대기실에 지난 결과");
    assert.equal(back.bots.length, 4, "넣어 둔 컴퓨터는 다음 경기에도 남는다");
    assert.equal(back.members.find((m) => m.name === "학생").team, sb.players[sb.you].team, "다시 들어온 학생은 제 팀에");
    assert.equal(lobby.channels.get(L.code).game, null);
    assert.equal(lobby.stats().playing, 0);
  });
});

test("컴퓨터 넣기 · 빼기(U24): 방장만 · 가득 찬 팀은 못 넣고 · 이름은 겹치지 않고 '봇'이 없다", async () => {
  await withServer(async ({ lobby, mk }) => {
    const { a, code } = await host(mk);
    const b = await joiner(mk, code, "학생", "kb");
    const ch = lobby.channels.get(code);
    // 방장이 아니면 못 넣는다
    const e0 = await errorAfter(b, () => b.send({ t: "bot", op: "add", team: 1 }));
    assert.match(e0.text, /방장만/);
    assert.equal(ch.bots.length, 0);
    a.send({ t: "settings", perTeam: 2 });
    await a.until(() => a.last("lobby").settings.perTeam === 2);
    a.send({ t: "bot", op: "add", team: 0 });
    let L = await a.until(() => { const m = a.last("lobby"); return m.bots.length === 1 && m; });
    assert.deepEqual(L.bots, [{ team: 0, name: BOT_NAMES[0], char: 0 }]);
    // 0팀 = 선생님 + 컴퓨터 = 2명(가득) → 더 못 넣는다
    const e1 = await errorAfter(a, () => a.send({ t: "bot", op: "add", team: 0 }));
    assert.match(e1.text, /가득 찼어요\(2명\)/);
    a.send({ t: "bot", op: "add", team: 1 });
    L = await a.until(() => { const m = a.last("lobby"); return m.bots.length === 2 && m; });
    assert.deepEqual(L.bots.map((x) => [x.team, x.char]), [[0, 0], [1, 1]]);
    assert.deepEqual(seats(L), [[1, 1], [1, 1]]);
    // 없는 팀 · 이상한 값 · 없는 번호는 무시한다
    a.send({ t: "bot", op: "add", team: 5 });
    a.send({ t: "bot", op: "add", team: -1 });
    a.send({ t: "bot", op: "add", team: "x" });
    a.send({ t: "bot", op: "remove", i: 9 });
    a.send({ t: "bot", op: "boom" });
    L = await sync(a, code);
    assert.equal(L.bots.length, 2);
    // 학생이 컴퓨터와 같은 이름으로 바꾸면 그 컴퓨터가 새 이름을 받는다
    b.send({ t: "name", name: BOT_NAMES[1] });
    L = await a.until(() => { const m = a.last("lobby"); return m.members.some((x) => x.name === BOT_NAMES[1]) && m; });
    const names = [...L.members.map((x) => x.name), ...L.bots.map((x) => x.name)];
    assert.equal(new Set(names).size, names.length, "이름이 겹치지 않는다");
    assert.ok(L.bots.every((x) => !x.name.includes("봇")));
    // 빼기(i = 명단 번호) — 0팀의 컴퓨터가 빠진다
    const keep = L.bots[1];
    a.send({ t: "bot", op: "remove", i: 0 });
    L = await a.until(() => { const m = a.last("lobby"); return m.bots.length === 1 && m; });
    assert.deepEqual(L.bots, [keep]);
    // 방장이 아니면 못 뺀다
    await errorAfter(b, () => b.send({ t: "bot", op: "remove", i: 0 }));
    assert.equal(ch.bots.length, 1);
  });
});

test("자리(U24): 빈자리가 없으면 들어온 사람이 컴퓨터 자리를 받고 · 모두 사람이면 못 들어오고 · 가득 찬 팀으로는 못 옮긴다", async () => {
  await withServer(async ({ lobby, mk }) => {
    const { a, code } = await host(mk);
    const ch = lobby.channels.get(code);
    a.send({ t: "settings", perTeam: 2 }); // 정원 2팀 × 2명 = 4
    for (const team of [0, 1, 1]) a.send({ t: "bot", op: "add", team });
    let L = await a.until(() => { const m = a.last("lobby"); return m.bots.length === 3 && m; });
    assert.deepEqual(seats(L), [[1, 1], [0, 2]], "모두 찼다");
    const [b0, b1] = L.bots.map((x) => x.name);
    // 컴퓨터가 가장 많은 팀(1팀)에 들어가고 그 팀의 마지막 컴퓨터가 빠진다
    const b = await joiner(mk, code, "학생1", "k1");
    assert.equal(teamOf(b), 1);
    assert.deepEqual(ch.bots.map((x) => x.name), [b0, b1]);
    // 컴퓨터가 같으면 앞 팀
    const c = await joiner(mk, code, "학생2", "k2");
    assert.equal(teamOf(c), 0);
    assert.deepEqual(ch.bots.map((x) => x.name), [b1]);
    const d = await joiner(mk, code, "학생3", "k3");
    assert.equal(teamOf(d), 1);
    assert.deepEqual(ch.bots, []);
    L = await sync(a, code);
    assert.deepEqual(seats(L), [[2, 0], [2, 0]]);
    // 모두 사람 → 못 들어온다
    const e = await joiner(mk, code, "학생4", "k4");
    assert.match(e.last("error").text, /채널이 가득 찼어요/);
    assert.equal(e.last("lobby"), undefined);
    assert.equal(ch.members.length, 4);
    // 가득 찬 팀(사람 + 컴퓨터 = 2)으로는 못 옮긴다
    const e2 = await errorAfter(b, () => b.send({ t: "team", team: 0 }));
    assert.match(e2.text, /그 팀은 가득 찼어요\(2명\)/);
    assert.equal(teamOf(b), 1);
    // 팀을 늘리면 빈 팀으로 옮길 수 있다
    a.send({ t: "settings", teams: 3 });
    await b.until(() => b.last("lobby").settings.teams === 3);
    b.send({ t: "team", team: 2 });
    await b.until(() => teamOf(b) === 2);
  });
});

test("팀당 인원 줄이기(U24): 넘치는 컴퓨터가 먼저 빠지고 · 넘치는 사람은 자리가 남은 팀으로 · 사람이 다 못 앉으면 받지 않는다", async () => {
  await withServer(async ({ lobby, mk }) => {
    const { a, code } = await host(mk);
    const ch = lobby.channels.get(code);
    const b = await joiner(mk, code, "학생1", "k1");
    const c = await joiner(mk, code, "학생2", "k2");
    assert.deepEqual([teamOf(a), teamOf(b), teamOf(c)].sort(), [0, 0, 1]);
    for (const team of [0, 0, 1]) a.send({ t: "bot", op: "add", team }); // 0팀 = 사람 2 + 컴퓨터 2, 1팀 = 사람 1 + 컴퓨터 1
    let L = await a.until(() => { const m = a.last("lobby"); return m.bots.length === 3 && m; });
    assert.deepEqual(seats(L), [[2, 2], [1, 1]]);
    // 4 → 2: 0팀의 컴퓨터 둘이 빠진다(사람은 그대로)
    a.send({ t: "settings", perTeam: 2 });
    L = await a.until(() => { const m = a.last("lobby"); return m.settings.perTeam === 2 && m; });
    assert.deepEqual(seats(L), [[2, 0], [1, 1]]);
    assert.deepEqual(L.bots.map((x) => x.team), [1]);
    // 2팀 × 1명 = 2자리 < 사람 3 → 받지 않는다(그대로)
    const e = await errorAfter(a, () => a.send({ t: "settings", perTeam: 1 }));
    assert.match(e.text, /3명이라 2팀 × 1명으로는 자리가 모자라요/);
    assert.equal(ch.settings.perTeam, 2);
    assert.deepEqual(seats(await sync(a, code)), [[2, 0], [1, 1]]);
    // 3팀 × 1명: 1팀의 컴퓨터가 빠지고, 0팀의 둘째 사람은 빈 2팀으로
    const second = L.members.filter((m) => m.team === 0)[1].id;
    a.send({ t: "settings", teams: 3, perTeam: 1 });
    L = await a.until(() => { const m = a.last("lobby"); return m.settings.perTeam === 1 && m; });
    assert.equal(L.settings.teams, 3);
    assert.deepEqual(seats(L), [[1, 0], [1, 0], [1, 0]]);
    assert.equal(L.members.find((m) => m.id === second).team, 2);
  });
});

test("팀 수 줄이기(U24): 없어진 팀의 사람 · 컴퓨터는 자리가 남은 팀으로(컴퓨터는 자리가 없으면 빠진다) · 사람은 컴퓨터 자리도 받는다", async () => {
  await withServer(async ({ lobby, mk }) => {
    const { a, code } = await host(mk);
    a.send({ t: "settings", teams: 4, perTeam: 3 });
    await a.until(() => a.last("lobby").settings.teams === 4);
    const b = await joiner(mk, code, "학생1", "k1");
    const c = await joiner(mk, code, "학생2", "k2");
    assert.deepEqual([teamOf(a), teamOf(b), teamOf(c)], [0, 1, 2]);
    for (const team of [2, 3, 3, 3]) a.send({ t: "bot", op: "add", team });
    let L = await a.until(() => { const m = a.last("lobby"); return m.bots.length === 4 && m; });
    assert.deepEqual(seats(L), [[1, 0], [1, 0], [1, 1], [0, 3]]);
    // 4팀 → 2팀: 2팀의 학생2는 0팀으로, 없어진 팀의 컴퓨터 넷은 인원이 적은 팀부터 — 자리가 없는 하나는 빠진다
    a.send({ t: "settings", teams: 2 });
    L = await a.until(() => { const m = a.last("lobby"); return m.settings.teams === 2 && m; });
    assert.equal(L.members.find((m) => m.name === "학생2").team, 0);
    assert.deepEqual(seats(L), [[2, 1], [1, 2]]);
    assert.equal(L.bots.length, 3);
    assert.ok(L.bots.every((x) => x.team === 0 || x.team === 1));
    // 팀당 2명으로: 0팀 컴퓨터 하나 · 1팀 컴퓨터 하나가 빠진다
    a.send({ t: "settings", perTeam: 2 });
    L = await a.until(() => { const m = a.last("lobby"); return m.settings.perTeam === 2 && m; });
    assert.deepEqual(seats(L), [[2, 0], [1, 1]]);
    // 3팀으로 늘려 학생2를 2팀에 두고 컴퓨터를 채운 뒤 다시 2팀으로 — 남는 자리가 없으니 학생2는 컴퓨터 자리를 받는다
    a.send({ t: "settings", teams: 3 });
    await c.until(() => c.last("lobby").settings.teams === 3);
    c.send({ t: "team", team: 2 });
    await a.until(() => a.last("lobby").members.find((m) => m.name === "학생2").team === 2);
    a.send({ t: "bot", op: "add", team: 0 });
    a.send({ t: "bot", op: "add", team: 2 });
    L = await a.until(() => { const m = a.last("lobby"); return m.bots.length === 3 && m; });
    assert.deepEqual(seats(L), [[1, 1], [1, 1], [1, 1]]);
    a.send({ t: "settings", teams: 2 });
    L = await a.until(() => { const m = a.last("lobby"); return m.settings.teams === 2 && m; });
    assert.deepEqual(seats(L), [[2, 0], [1, 1]], "학생2가 0팀 컴퓨터 자리를 받고, 2팀의 컴퓨터는 자리가 없어 빠진다");
    assert.equal(lobby.channels.get(code).members.length, 3);
    // 사람 3명은 2팀 × 1명에 못 앉는다
    const e = await errorAfter(a, () => a.send({ t: "settings", teams: 2, perTeam: 1 }));
    assert.match(e.text, /자리가 모자라요/);
    assert.equal(lobby.channels.get(code).settings.perTeam, 2);
  });
});

test("경기 시작(U24): 빈 팀이 있으면 받지 않고 · 선수 = 팀마다 사람 → 컴퓨터(명단 차례) · start 의 팀 · 선수", async () => {
  await withServer(async ({ lobby, mk }) => {
    const { a, code } = await host(mk);
    a.send({ t: "settings", teams: 3 });
    await a.until(() => a.last("lobby").settings.teams === 3);
    const b = await joiner(mk, code, "학생", "kb");
    assert.equal(teamOf(b), 1);
    const e = await errorAfter(a, () => a.send({ t: "start" }));
    assert.equal(e.text, "빈 팀이 있어요 — 컴퓨터를 넣거나 팀 수를 줄여 주세요.");
    assert.equal(lobby.channels.get(code).game, null);
    assert.equal(a.last("start"), undefined);
    // 0팀 · 2팀 · 0팀 차례로 넣는다 → 경기에서는 팀마다 사람 다음에 명단 차례
    for (const team of [0, 2, 0]) a.send({ t: "bot", op: "add", team });
    const L = await a.until(() => { const m = a.last("lobby"); return m.bots.length === 3 && m; });
    const [k0, k1, k2] = L.bots;
    a.send({ t: "start" });
    const st = await a.until(() => a.last("start"));
    const sb = await b.until(() => b.last("start"));
    assert.equal(st.teams, 3);
    assert.deepEqual(st.players.map((p) => [p.team, p.bot, p.name]), [
      [0, false, "선생님"], [0, true, k0.name], [0, true, k2.name],
      [1, false, "학생"],
      [2, true, k1.name],
    ]);
    assert.deepEqual(st.players.filter((p) => p.bot).map((p) => p.char), [k0.char, k2.char, k1.char], "컴퓨터의 인형은 명단 그대로");
    assert.ok(st.players.every((p) => Number.isInteger(p.char) && p.char >= 0 && p.char < 8));
    assert.equal(st.you, 0);
    assert.equal(sb.you, 3);
    const snap = await a.until(() => a.snaps.find((x) => x.phase === PHASE.PLAY));
    assert.equal(snap.teams, 3);
    assert.ok(snap.units.some((u) => u.owner === st.you && u.type === UTYPE.HERO));
  });
});

test("대기실(8팀 × 4명): 사람 9 + 컴퓨터 23 = 32자리, 이름이 겹치지 않고 '봇'이 없다", async () => {
  await withServer(async ({ mk }) => {
    const { a, code } = await host(mk);
    a.send({ t: "settings", teams: MAX_TEAMS });
    await a.until(() => a.last("lobby").settings.teams === MAX_TEAMS);
    for (let k = 1; k <= 8; k++) await joiner(mk, code, `학생${k}`, `h${k}`);
    let L = await a.until(() => { const m = a.last("lobby"); return m.members.length === 9 && m; });
    assert.deepEqual(seats(L).map(([h]) => h), [2, 1, 1, 1, 1, 1, 1, 1], "인원이 가장 적은 팀부터");
    for (let t = 0; t < MAX_TEAMS; t++) for (let k = seats(L)[t][0]; k < MAX_PER_TEAM; k++) a.send({ t: "bot", op: "add", team: t });
    L = await a.until(() => { const m = a.last("lobby"); return m.bots.length === MAX_PLAYERS - 9 && m; });
    assert.ok(seats(L).every(([h, k]) => h + k === MAX_PER_TEAM));
    const e = await errorAfter(a, () => a.send({ t: "bot", op: "add", team: 3 }));
    assert.match(e.text, /가득 찼어요\(4명\)/);
    a.send({ t: "start" });
    const st = await a.until(() => a.last("start"));
    assert.equal(st.teams, MAX_TEAMS);
    assert.equal(st.players.length, MAX_PLAYERS);
    for (let t = 0; t < MAX_TEAMS; t++) assert.equal(st.players.filter((p) => p.team === t).length, MAX_PER_TEAM);
    const bots = st.players.filter((p) => p.bot);
    assert.equal(bots.length, MAX_PLAYERS - 9);
    assert.equal(new Set(st.players.map((p) => p.name)).size, MAX_PLAYERS, "이름이 겹치지 않는다");
    assert.ok(bots.every((p) => !p.name.includes("봇")), "컴퓨터 이름에 봇이 없다");
    const snap = await a.until(() => a.snaps.find((x) => x.phase === PHASE.PLAY));
    assert.equal(snap.teams, MAX_TEAMS);
    assert.equal(snap.scores.length, MAX_TEAMS);
    assert.equal(snap.buildings.length, MAX_TEAMS * 4);
    assert.equal(snap.sites.length, MAX_TEAMS + 1);
    assert.ok(snap.units.some((u) => u.owner === st.you && u.type === UTYPE.HERO));
  });
});

// ------------------------------------------------------------ 퀴즈 아카이브(U25): 가짜 아카이브(이 컴퓨터의 HTTP 서버 — 인터넷은 쓰지 않는다)

const OWNER = "owner-key-teacher-aaaaaaaa";
const arcQuiz = (over = {}) => ({
  id: "abc123", title: "왕국전 물질 퀴즈", level: "middle", grade: "1", subject: "science", visibility: "public", updatedAt: 1000,
  questions: [
    { text: "물이 끓어 수증기가 되는 변화는?", choices: ["융해", "기화", "응고"], answer: 1, explanation: "액체 → 기체" },
    { text: "얼음은 고체다", choices: ["O", "X"], answer: 0, explanation: "" },
    { text: "보기가 없는 단답형", answer: "기체" }, // 왕국전 문제 창에 낼 수 없다 → 뺀다
    { text: "수증기는 액체다", choices: ["O", "X"], answer: 1, explanation: "기체예요" },
  ],
  ...over,
});

/** routes[id] = (req) => { status, body, delay } */
async function fakeArchive(routes) {
  const hits = [];
  const server = http.createServer(async (req, res) => {
    const m = /^\/api\/quizzes\/([^/?]+)$/.exec(req.url);
    hits.push({ id: m && m[1], key: req.headers["x-owner-key"] || "" });
    const r = m && routes[m[1]] ? await routes[m[1]](req) : { status: 404, body: { error: "notFound" } };
    if (r.delay) await new Promise((ok) => setTimeout(ok, r.delay));
    if (res.destroyed) return;
    res.writeHead(r.status ?? 200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(r.body));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { base: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }) };
}

/** 가짜 아카이브 + 그것을 쓰는 대기실 서버 */
async function withArchive(routes, fn, { timeoutMs = 400 } = {}) {
  const fa = await fakeArchive(routes);
  try {
    await withServer((ctx) => fn({ ...ctx, fa }), { quizSource: createQuizSource({ base: fa.base, timeoutMs }) });
  } finally {
    await fa.close();
  }
}

test("퀴즈 아카이브(U25): 방장이 arc:<id> 를 고르면 서버가 받아 와 대기실에 제목 · 문제 수, 시작하면 그 문제로 퀴즈 모드", async () => {
  await withArchive({ abc123: () => ({ body: { quiz: arcQuiz() } }) }, async ({ lobby, mk, fa }) => {
    const { a, code } = await host(mk);
    const b = await joiner(mk, code, "학생", "kb");
    b.send({ t: "settings", quiz: "arc:abc123" }); // 방장이 아니면 무시(아카이브도 부르지 않는다)
    await sync(b, code);
    assert.equal(fa.hits.length, 0);
    a.send({ t: "settings", quiz: "arc:abc123" });
    const pend = await a.until(() => a.last("lobby").quizPending && a.last("lobby"));
    assert.equal(pend.settings.quiz, "", "받아 오기 전에는 지난 퀴즈 그대로");
    const L = await a.until(() => { const m = a.last("lobby"); return m.quizInfo.src === "arc" && m; });
    assert.equal(L.settings.quiz, "arc:abc123");
    assert.equal(L.quizPending, false);
    assert.deepEqual(L.quizInfo, { src: "arc", id: "abc123", title: "왕국전 물질 퀴즈", count: 3, skipped: 1 });
    const Lb = await b.until(() => { const m = b.last("lobby"); return m.quizInfo.src === "arc" && m; });
    assert.equal(Lb.quizInfo.title, "왕국전 물질 퀴즈", "모두의 대기실에 보인다");
    // 다른 설정을 바꾸거나 같은 세트를 다시 골라도 다시 부르지 않는다
    a.send({ t: "settings", map: "canal" });
    a.send({ t: "settings", quiz: "arc:abc123", quizRev: 1000 });
    await sync(a, code);
    assert.equal(fa.hits.length, 1);
    assert.equal(a.last("lobby").settings.quiz, "arc:abc123");
    a.send({ t: "bot", op: "add", team: 1 });
    await a.until(() => a.last("lobby").bots.length === 1);
    a.send({ t: "start" });
    const st = await a.until(() => a.last("start"));
    assert.equal(st.mode, "quiz", "아카이브 세트를 고르면 퀴즈 모드");
    assert.equal(st.quizTitle, "왕국전 물질 퀴즈");
    assert.equal(st.quizCount, 3);
    const qs = lobby.channels.get(code).game.quiz.questions;
    assert.deepEqual(qs.map((q) => q.choices), [["융해", "기화", "응고"], ["O", "X"], ["O", "X"]], "O/X 는 2지선다, 단답형은 뺐다");
    assert.deepEqual(qs.map((q) => q.answer), [1, 0, 1]);
    assert.equal(qs[2].explanation, "기체예요");
  });
});

test("퀴즈 아카이브(U25): 못 받으면 방장에게 error 알림 · 지난 퀴즈 그대로(없음 · 낼 문제 없음 · 시간 초과 · 503 · 틀린 번호), seed:<key> · \"\" 도 받는다", async () => {
  const routes = {
    gone: () => ({ status: 404, body: { error: "notFound" } }),
    empty1: () => ({ body: { quiz: arcQuiz({ id: "empty1", questions: [{ text: "단답", answer: "서울" }] }) } }),
    slow1: () => ({ delay: 600, body: { quiz: arcQuiz({ id: "slow1" }) } }),
    down1: () => ({ status: 503, body: { error: "unavailable" } }),
  };
  await withArchive(routes, async ({ mk }) => {
    const { a, code } = await host(mk);
    const seedKey = (await a.until(() => a.last("hello"))).sets[1].key;
    a.send({ t: "settings", quiz: `seed:${seedKey}` });
    const L = await a.until(() => { const m = a.last("lobby"); return m.settings.quiz === seedKey && m; });
    assert.equal(L.quizInfo.src, "seed");
    assert.equal(L.quizInfo.count, 10);
    const cases = [["arc:gone", /찾을 수 없어요/], ["arc:empty1", /낼 수 있는 문제가 없어요/], ["arc:slow1", /답하지 않아요/], ["arc:down1", /쓸 수 없어요/], ["arc:BAD!", /퀴즈 번호/], ["arc:", /퀴즈 번호/]];
    for (const [quiz, re] of cases) {
      const e = await errorAfter(a, () => a.send({ t: "settings", quiz }));
      assert.match(e.text, re, quiz);
      const now = await sync(a, code);
      assert.equal(now.settings.quiz, seedKey, `${quiz}: 지난 퀴즈 그대로`);
      assert.equal(now.quizInfo.src, "seed");
      assert.equal(now.quizPending, false);
    }
    a.send({ t: "settings", quiz: "seed:없는세트" });
    assert.equal((await sync(a, code)).settings.quiz, seedKey, "없는 기본 세트는 받지 않는다");
    a.send({ t: "settings", quiz: "" });
    const off = await a.until(() => { const m = a.last("lobby"); return m.settings.quiz === "" && m; });
    assert.deepEqual(off.quizInfo, { src: "none", title: "", count: 0, skipped: 0 });
    a.send({ t: "bot", op: "add", team: 1 });
    await a.until(() => a.last("lobby").bots.length === 1);
    a.send({ t: "start" });
    assert.equal((await a.until(() => a.last("start"))).mode, "arcade", "퀴즈 없음 = 아케이드");
  }, { timeoutMs: 200 });
});

test("퀴즈 아카이브(U25): 비공개 세트는 quizOwner 를 아카이브로만 넘기고 · 늦게 온 답은 그 뒤에 고른 것을 덮지 않고 · 더 새 quizRev 면 다시 받는다", async () => {
  let rev = 1000;
  const routes = {
    priv12: (req) => (req.headers["x-owner-key"] === OWNER ? { body: { quiz: arcQuiz({ id: "priv12", visibility: "private", updatedAt: rev }) } } : { status: 404, body: { error: "notFound" } }),
    late1: () => ({ delay: 250, body: { quiz: arcQuiz({ id: "late1", title: "늦게 온 세트" }) } }),
  };
  await withArchive(routes, async ({ mk, fa }) => {
    const { a, code } = await host(mk);
    const e = await errorAfter(a, () => a.send({ t: "settings", quiz: "arc:priv12" }));
    assert.match(e.text, /찾을 수 없어요/, "열쇠 없이는 비공개 세트를 못 받는다");
    a.send({ t: "settings", quiz: "arc:priv12", quizOwner: OWNER, quizRev: 1000 });
    const L = await a.until(() => { const m = a.last("lobby"); return m.quizInfo.src === "arc" && m; });
    assert.equal(L.quizInfo.id, "priv12");
    assert.equal(fa.hits.at(-1).key, OWNER, "소유 키는 아카이브 요청에만");
    assert.ok(!a.msgs.some((m) => JSON.stringify(m).includes(OWNER)), "대기실 메시지에는 키가 없다");
    // 고친 뒤 다시 고르기: 같은 판이면 그대로, 더 새 판이면 다시 받는다
    const n = fa.hits.length;
    a.send({ t: "settings", quiz: "arc:priv12", quizOwner: OWNER, quizRev: 1000 });
    await sync(a, code);
    assert.equal(fa.hits.length, n);
    rev = 2000;
    a.send({ t: "settings", quiz: "arc:priv12", quizOwner: OWNER, quizRev: 2000 });
    await a.until(() => fa.hits.length === n + 1);
    // 늦게 온 답: 고른 뒤 곧바로 기본 세트를 고르면 기본 세트가 남는다
    const seedKey = a.last("hello").sets[0].key;
    a.send({ t: "settings", quiz: "arc:late1" });
    a.send({ t: "settings", quiz: seedKey });
    await a.until(() => fa.hits.some((h) => h.id === "late1"));
    await new Promise((r) => setTimeout(r, 450));
    const end = await sync(a, code);
    assert.equal(end.settings.quiz, seedKey);
    assert.equal(end.quizInfo.src, "seed");
    assert.equal(end.quizPending, false);
  });
});
