// 개발용 시연(대기 화면 · 메뉴에서만 돈다):
//   ?quizdemo — 퀴즈 룸 연출(서버 퀴즈가 없어도 렌더러의 퀴즈 길을 돌려 본다)
//   ?fxdemo   — 폭발 연출 표(fx-kinds.js)를 차례로 터뜨린다. 서버가 아직 없는 새 아이템(폭죽 · 소용돌이 · 드릴 …)도 여기서 본다
//   ?fxdemo=<종류>&fxt=<초> — 그 종류 하나만 터뜨리고 fxt 초에 연출 시간을 멈춘다(스크린샷으로 한 순간을 견주기)
//   ?fxdemo&fog — 전장의 안개 시연(우리 팀 한 사람이 둘레를 돌며 시야 · 가 본 곳을 만든다)
//   ?chardemo   — 3D 캐릭터 시연: 6팀 36명이 대기 · 달리기 · 충전 · 던지기 · 공중제비 · 대시 · 맞음 · KO · 부스터 · 느려짐 · 보호막 · 승리를 돌아가며
//   ?chardemo=<동작> — 한 동작만(idle · run · charge · throw · flip · dash · hit · ko · boost · slow · shield · cheer · warp) · items(아이템 · 설치물 전 종류)
// 아래는 퀴즈 룸 시연.
// 가짜 상태를 docs/CONTRACT.md §4 의 모양 그대로 만들어 R.setQuizLayout · R.drawQuizRoom · R.fx.* · R.drawPlayer 에 넣는다.
// 화면 문구를 새로 만들지 않는다(문제는 숫자 식, 팀 이름은 shared/texts 의 것).
//
// 한 바퀴(14초): 우리 팀(0)이 가운데 룸 존에 모여 게이지를 채움 → 울타리가 솟고 카드가 펼쳐짐 → 정답 폭탄이 날아가 잉크가 묻음 →
//   (홀수 바퀴) 전원이 한 카드에 모여 성공 · 분수 / (짝수 바퀴) 갈라져 시간 초과 → 카드가 깨지고 홈 소환.
// 다른 룸: 시안 팀이 풀이 중(바깥에서 보는 딱지) · 열림(남은 문제 수) · 완료.
import { FLAG, TEAMS, PALETTE, BALLOON } from "../shared/constants.js";
import { arenaAt } from "../shared/arena.js";
import { DEMO_ORDER } from "./fx-kinds.js";

const T_LOOP = 14;

/** 주소의 ?quizdemo · ?fxdemo 에 맞는 시연 하나 */
export function createDemo(R, q) {
  if (q && q.has("chardemo")) return createCharDemo(R, q);
  return q && q.has("fxdemo") ? createFxDemo(R, q) : createQuizDemo(R);
}

/** 폭발 연출 시연: 블록 사이 빈 자리에서 표의 종류를 차례로(종류 이름은 말풍선으로) */
export function createFxDemo(R, q = null) {
  const only = q && q.get("fxdemo") && DEMO_ORDER.includes(q.get("fxdemo")) ? q.get("fxdemo") : null;
  const stopAt = q && Number(q.get("fxt")) > 0 ? Number(q.get("fxt")) : 0;
  let fxClock = 0;
  let frozen = false;
  const fogDemo = !!(q && q.has("fog"));
  if (only && stopAt) {
    // 연출 시간만 멈춘다(main.js 가 넘기는 dt 를 0 으로)
    const bf = R.beginFrame;
    R.beginFrame = (t, dt) => {
      if (fxClock > 0) fxClock += dt;
      if (fxClock - 1 >= stopAt) frozen = true;
      bf(t, frozen ? 0 : dt);
    };
  }
  const A = arenaAt(1, "quiz");
  R.setArena(A);
  R.setHomeColors(TEAMS.map((t) => t.color));
  const room = (A.quizRooms || [])[0] || { x: 0, z: 0 };
  const cx = room.x, cz = room.z + 1;
  const people = [0, 1, 2, 3].map((i) => ({ id: 400 + i, x: cx + [-2.6, 2.6, -1.6, 1.8][i], y: 0, z: cz + [1.2, 1.0, -1.8, -1.6][i], aim: Math.PI / 2, flags: FLAG.ALIVE | FLAG.GROUNDED, color: TEAMS[i % TEAMS.length].color, team: i, vx: 0, vy: 0, vz: 0, ink: 60, shield: 0, boost: 0, name: "" }));
  let idx = -1;
  let nextAt = only ? 3 : 0.5;
  return {
    frame(time) {
      if (time >= nextAt && !(stopAt && fxClock > 0)) {
        idx = (idx + 1) % DEMO_ORDER.length;
        const name = only || DEMO_ORDER[idx];
        if (only && stopAt) fxClock = 1e-6 + 1;
        const color = TEAMS[idx % TEAMS.length].color;
        const a = time * 0.7;
        if (name === "bomb") R.fx.nuke(cx, 0.2, cz, color, BALLOON.BIG.splash * 2);
        else if (name === "block") {
          const i = (A.breakables || [])[(idx * 7) % Math.max(1, (A.breakables || []).length)];
          if (i !== undefined) {
            A.grid.blocks[i] = 0;
            R.blockChanged(i, 0);
            setTimeout(() => {
              A.grid.blocks[i] = 1;
              R.blockChanged(i, 1);
            }, 1200);
          }
        } else R.fx.play(name, cx, 0.2, cz, color, { dx: Math.cos(a), dz: Math.sin(a), splash: BALLOON.SMALL.splash });
        R.say(people[0].id, name, 1.6, color);
        nextAt = time + (name === "bomb" ? 4.5 : name === "vortex" || name === "firework" ? 2.2 : 1.6);
      }
      if (fogDemo) {
        // 안개 시연(?fxdemo&fog): 우리 팀(0) 한 사람이 둘레를 돈다 — 시야 원 · 가 본 곳 · 홈 둘레
        const a = time * 0.35;
        const me = people[0];
        me.x = cx + Math.cos(a) * 9;
        me.z = cz + Math.sin(a) * 7;
        me.aim = a + Math.PI / 2;
        me.vx = -Math.sin(a) * 3;
        me.vz = Math.cos(a) * 2.4;
        R.setVision({ team: 0, eyes: [me.x, me.z], home: (A.homes || [])[0] || null, flags: [] });
      }
      for (const v of people) R.drawPlayer(v, { gy: 0, self: fogDemo && v === people[0] });
      if (fogDemo) R.follow(people[0].x, people[0].z);
      else R.follow(cx, cz, cx, cz - 2);
    },
  };
}

export function createQuizDemo(R) {
  const A = arenaAt(1, "quiz");
  R.setArena(A);
  const rooms = (A.quizRooms || []).map((r) => ({ id: r.id, x: r.x, z: r.z, r: r.r || A.zoneR || 4.5, board: r.board }));
  R.setQuizLayout(rooms);
  R.setHomeColors(TEAMS.map((t) => t.color));
  const team = (t) => TEAMS[t % TEAMS.length].color;
  const main = rooms[0];
  const home = (A.homes || [])[0] || { x: 0, z: -20 };
  // 우리 팀 5명(존 안), 시안 3명(룸 1 둘레), 민트 2명(돌아다님)
  const people = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    people.push({ id: 100 + i, team: 0, hx: main.x + Math.cos(a) * 2.2, hz: main.z + Math.sin(a) * 2.2, name: `P${i + 1}` });
  }
  const r1 = rooms[1] || main;
  for (let i = 0; i < 3; i++) people.push({ id: 200 + i, team: 1, hx: r1.x + (i - 1) * 1.6, hz: r1.z + 0.5, name: `C${i + 1}` });
  for (let i = 0; i < 2; i++) people.push({ id: 300 + i, team: 2, hx: main.x + 7 + i * 1.5, hz: main.z + 6, name: `M${i + 1}`, wander: true });
  const views = people.map((p) => ({ id: p.id, x: p.hx, y: 0, z: p.hz, aim: Math.PI / 2, flags: FLAG.ALIVE | FLAG.GROUNDED, color: team(p.team), team: p.team, name: p.name, ink: 0, vx: 0, vy: 0, vz: 0, shield: 0, boost: 0 }));
  const votes = [[], [], [], []];
  let loop = -1;
  let fired = new Set();
  let warped = false;
  let breakAt = -1;

  function at(t, key, fn) {
    if (t >= key && !fired.has(key)) {
      fired.add(key);
      fn();
    }
  }

  return {
    frame(time, dt) {
      const L = Math.floor(time / T_LOOP);
      const t = time - L * T_LOOP;
      const fail = L % 2 === 0;
      if (L !== loop) {
        loop = L;
        fired = new Set();
        votes.forEach((v) => (v.length = 0));
        warped = false;
        views.forEach((v, i) => {
          v.x = people[i].hx;
          v.z = people[i].hz;
        });
      }
      // 사람들: 존 안 사람은 전광판 쪽을 보고 조금씩 흔들린다. 떠도는 사람은 원을 그리며 달린다
      views.forEach((v, i) => {
        const p = people[i];
        if (p.wander) {
          const a = time * 0.9 + i;
          const nx = main.x + 7 + Math.cos(a) * 3, nz = main.z + 6 + Math.sin(a) * 2;
          v.vx = (nx - v.x) / Math.max(dt, 1e-3);
          v.vz = (nz - v.z) / Math.max(dt, 1e-3);
          v.x = nx;
          v.z = nz;
          v.aim = Math.atan2(v.vz, v.vx);
        } else {
          v.vx = v.vz = 0;
          v.aim = p.team === 0 ? -Math.PI / 2 + Math.sin(time * 0.7 + i) * 0.5 : Math.PI / 2;
        }
        v.flags = FLAG.ALIVE | FLAG.GROUNDED;
      });
      // 시간표
      const gauge = Math.min(1, Math.max(0, (t - 0.3) / 1.5));
      const solving = t >= 1.8 && t < 10.5;
      const fence = solving ? Math.min(1, (t - 1.8) / 0.6) : t >= 10.5 ? Math.max(0, 1 - (t - 10.5) / 0.5) : 0;
      const throwAt = fail ? [[3.0, 0, 1], [3.5, 1, 2], [4.0, 2, 1], [4.6, 3, 3], [5.2, 4, 0]] : [[3.0, 0, 1], [3.5, 1, 1], [4.0, 2, 2], [4.6, 3, 1], [5.2, 4, 1], [6.0, 2, 1]];
      for (const [tt, who, c] of throwAt) {
        at(t, `b${tt}`, () => {
          const v = views[who];
          R.actor.throwPose(v.id);
          R.fx.answerBomb(v.x, v.y, v.z, main.id, c, team(0), v.id);
          setTimeout(() => {
            votes.forEach((vs) => {
              const k = vs.indexOf(v.id);
              if (k >= 0) vs.splice(k, 1);
            });
            votes[c].push(v.id);
          }, 850);
        });
      }
      let result = null;
      if (t >= 7.5 && t < 10.5) result = fail ? { ok: false } : { ok: true, c: 1 };
      at(t, "res", () => {});
      if (t >= 7.5) at(t, "result", () => R.fx.roomResult(main.id, !fail, team(0)));
      if (fail && t >= 8.3 && !warped) {
        // 실패: 홈 소환(옛 자리에서 빨려 들고 홈에서 아래층부터 솟는다)
        warped = true;
        views.forEach((v, i) => {
          if (people[i].team !== 0) return;
          const fx = v.x, fz = v.z;
          v.x = home.x + (i - 2) * 1.2;
          v.z = home.z;
          R.fx.homeWarp(v.x, v.z, team(0), fx, fz);
        });
      }
      const card = solving || (t >= 10.5 && !fail && false)
        ? { qi: L, text: "3/4 + 1/8 = ?", choices: ["5/8", "7/8", "4/12", "1"], votes: votes.map((v) => v.slice()), picked: 1, result }
        : null;
      const inside = [solving || t < 1.8 ? 5 : 0, 0, 0, 0, 0, 0];
      R.drawQuizRoom({
        id: main.id, state: solving ? "solve" : t >= 10.5 && !fail ? "done" : "open", team: solving ? 0 : -1,
        gauge: solving ? [] : [t < 1.8 ? gauge : 0, t < 1.8 ? gauge * 0.4 : 0], inside, need: [5, 3, 2, 0, 0, 0],
        fence, left: Math.max(0, 15 - (t - 1.8)), mine: { left: 2 }, card,
      });
      if (rooms[1]) R.drawQuizRoom({ id: rooms[1].id, state: "solve", team: 1, gauge: [], inside: [0, 3], need: [5, 3], fence: 1, left: Math.max(0, 12 - (t % 12)), mine: { left: 1 }, card: null });
      if (rooms[2]) R.drawQuizRoom({ id: rooms[2].id, state: "open", team: -1, gauge: [0, 0, 0.35 + 0.3 * Math.sin(time)], inside: [0, 0, 2], need: [5, 3, 2], fence: 0, left: 0, mine: { left: 2 }, card: null });
      if (rooms[3]) R.drawQuizRoom({ id: rooms[3].id, state: "done", team: -1, gauge: [], inside: [], need: [], fence: 0, left: 0, mine: { left: 0 }, card: null });
      if (rooms[4]) R.drawQuizRoom({ id: rooms[4].id, state: "open", team: -1, gauge: [], inside: [], need: [], fence: 0, left: 0, mine: { left: 2 }, card: null });
      // 바깥의 난투: 시안 풍선이 울타리 밖에서 터지고, 부서지는 블록 하나가 깨졌다 자란다
      if (Math.floor(time * 1.3) !== Math.floor((time - dt) * 1.3)) {
        const a = Math.random() * Math.PI * 2;
        R.fx.burst(main.x + Math.cos(a) * (main.r + 2.5), 0, main.z + Math.sin(a) * (main.r + 2.5), team(Math.random() < 0.5 ? 1 : 2), Math.random() < 0.4, Math.cos(a), Math.sin(a));
      }
      if (A.breakables && A.breakables.length) {
        if (breakAt < 0) breakAt = A.breakables[(A.breakables.length / 2) | 0];
        const k = Math.floor(time / 3) % 2;
        if (A.grid.blocks[breakAt] !== (k ? 0 : 1)) {
          A.grid.blocks[breakAt] = k ? 0 : 1;
          R.blockChanged(breakAt, k ? 0 : 1);
        }
      }
      at(t, "say1", () => R.say(views[1].id, "7/8!", 3));
      at(t, "say2", () => R.say(views[3].id, fail ? "4/12 ?" : "2 → 7/8 !!", 3.5));
      for (let i = 0; i < views.length; i++) R.drawPlayer(views[i], { self: i === 0, gy: 0 });
      R.follow(views[0].x, views[0].z, views[0].x, views[0].z - 3);
      void PALETTE;
    },
  };
}

/** 3D 캐릭터 시연(?chardemo): 퀴즈 룸 광장에 6팀 × 6명 */
export function createCharDemo(R, q) {
  const A = arenaAt(1, "quiz");
  R.setArena(A);
  R.setHomeColors(TEAMS.map((t) => t.color));
  const room = (A.quizRooms || [])[0] || { x: 0, z: 0 };
  const only = q.get("chardemo") || "";
  const ACTS = ["idle", "run", "charge", "throw", "flip", "dash", "hit", "ko", "boost", "slow", "shield", "cheer", "warp"];
  const people = [];
  const n = only ? 4 : 36;
  for (let i = 0; i < n; i++) {
    const team = i % 6;
    const k = Math.floor(i / 6);
    const hx = room.x + (team - 2.5) * 2.2 + (only ? i * 2.4 - 3.6 - (team - 2.5) * 2.2 : 0);
    const hz = room.z - 3 + k * 1.6 + (only ? 3 : 0);
    people.push({ id: 600 + i, team, hx, hz, act: only || ACTS[i % ACTS.length], phase: i * 0.37, v: { id: 600 + i, x: hx, y: 0, z: hz, aim: Math.PI / 2, flags: FLAG.ALIVE | FLAG.GROUNDED, color: TEAMS[team].color, team, vx: 0, vy: 0, vz: 0, charge: 0, boost: 0, shield: 0, name: "" }, next: 0 });
  }
  let t0 = -1;
  return {
    frame(time) {
      if (t0 < 0) t0 = time;
      const T = time - t0;
      for (const p of people) {
        const v = p.v;
        const ph = T + p.phase;
        v.flags = FLAG.ALIVE | FLAG.GROUNDED;
        v.vx = v.vz = v.vy = 0;
        v.y = 0;
        v.charge = 0;
        v.boost = 0;
        v.shield = 0;
        v.x = p.hx;
        v.z = p.hz;
        v.aim = Math.PI / 2 + Math.sin(ph * 0.7) * 0.6;
        const a = p.act;
        if (a === "run" || a === "boost" || a === "slow" || a === "dash") {
          const s = a === "slow" ? 0.45 : a === "dash" ? 1.6 : 1;
          const ang = ph * 1.4 * s;
          v.x = p.hx + Math.cos(ang) * 0.9;
          v.z = p.hz + Math.sin(ang) * 0.6;
          v.vx = -Math.sin(ang) * 8.4 * 0.9 * s * 0.18 * 8;
          v.vz = Math.cos(ang) * 8.4 * 0.6 * s * 0.18 * 8;
          v.aim = Math.atan2(v.vz, v.vx);
          if (a === "boost") v.boost = 5;
          if (a === "slow") v.flags |= FLAG.SLOWED;
          if (a === "dash") v.flags |= FLAG.DASHING;
        } else if (a === "charge") {
          v.flags |= FLAG.CHARGING;
          v.charge = (ph * 0.6) % 1.2;
        } else if (a === "throw" && ph > p.next) {
          p.next = ph + 1.2;
          R.actor.throwPose(v.id);
        } else if (a === "flip" && ph > p.next) {
          p.next = ph + 1.4;
          R.actor.flip(v.id, 0);
        } else if (a === "hit" && ph > p.next) {
          p.next = ph + 1.1;
          R.actor.hit(v.id, 0.8, 1, 0);
        } else if (a === "shield") {
          v.shield = 5;
        } else if (a === "cheer" && ph > p.next) {
          p.next = ph + 2.5;
          if (R.actor.cheer) R.actor.cheer(v.id, 2.4);
        }
        if (a === "flip" && ph < p.next - 1.0) v.y = Math.sin(((ph - (p.next - 1.4)) / 0.42) * Math.PI) * 1.2;
        if (a === "ko") {
          const c = ph % 3;
          if (c < 1.5) {
            if (p.down) {
              p.down = false;
              R.actor.appear(v.id);
            }
          } else {
            if (!p.down) {
              p.down = true;
              R.fx.ko(v.x, v.z, v.color);
            }
            v.flags = 0;
          }
        }
        if (a === "warp") {
          const c = Math.floor(ph / 1.6) % 2;
          v.x = p.hx + (c ? 5 : 0);
        }
        R.drawPlayer(v, { gy: 0, self: v.id === 600 });
      }
      if (only === "items") {
        // 아이템 전 종류(종류 번호 0~19 — 메가 잉크 폭탄 5 는 맵에 뜨지 않지만 모양 확인용) + 바닥의 덫 · 꽂힌 집결 깃발
        const kinds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
        kinds.forEach((k, i) => R.drawItem(room.x - 8.1 + (i % 10) * 1.8, room.z + 4.2 + Math.floor(i / 10) * 1.9, k));
        if (R.drawGadget) {
          R.drawGadget({ g: "trap", x: room.x - 6, z: room.z + 8.6, team: 0, color: TEAMS[0].color, r: 0.9 });
          R.drawGadget({ g: "rally", x: room.x - 3, z: room.z + 8.6, team: 0, color: TEAMS[1].color, r: 3 });
          R.drawGadget({ g: "trap", x: room.x, z: room.z + 8.6, team: 1, color: TEAMS[2].color, r: 0.9, faint: 1 });
        }
      }
      R.follow(room.x, room.z + (only === "items" ? 5 : only ? 1 : 0.5));
    },
  };
}
