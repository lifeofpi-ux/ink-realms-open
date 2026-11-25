// 개발용 캐릭터 견본(docs/DESIGN.md §3.9 — 화면 확인 스크립트가 페이지에서 import 해 R.render 앞에 끼워 부른다. 앱은 이 파일을 쓰지 않는다).
//   lineup   8종을 한 줄로(남 4 · 여 4 — 이름은 말풍선), 카메라 쪽을 보고 선다. act 를 주면 모두 그 동작(run · throw · ko · charge · flip · hit · cheer · back 뒤돌기 · side 옆)
//   lineup2  8종 × 팀 색 두 가지(두 줄)
//   patterns 무늬 26종(종류는 번갈아, 색은 6팀) — 칸마다 무늬 이름
//   crowd    6팀 36명(팀마다 종류가 섞이게)이 달리고 던지고 맞는다
import { FLAG, TEAMS, PALETTE } from "../shared/constants.js";
import { PROJ } from "./camera.js";
import { CHARACTERS, PATTERNS } from "./charset.js";

const FACE = Math.atan2(PROJ.view[2], PROJ.view[0]); // 카메라 쪽

export function createCharShowcase(R, mode = "lineup", o = {}) {
  const cx = o.x ?? 0, cz = o.z ?? 0;
  const people = [];
  const add = (i, x, z, char, color, extra = {}) =>
    people.push({ i, hx: x, hz: z, next: 0, down: false, v: { id: 900 + i, x, y: 0, z, aim: FACE, flags: FLAG.ALIVE | FLAG.GROUNDED, color, team: extra.team ?? -1, char, pattern: extra.pattern ?? -1, vx: 0, vy: 0, vz: 0, charge: 0, boost: 0, shield: 0, range: extra.range || 0, name: "" } });
  if (mode === "lineup") {
    const gap = o.gap ?? 1.55;
    for (let i = 0; i < 8; i++) add(i, cx - (i - 3.5) * gap * Math.cos(FACE + Math.PI / 2), cz - (i - 3.5) * gap * Math.sin(FACE + Math.PI / 2), i, o.color ?? TEAMS[i % 2 ? 1 : 0].color, { team: 0 });
  } else if (mode === "lineup2") {
    // 8종 × 팀 색 두 가지(두 줄 — 앞줄 분홍 · 뒷줄 시안)
    const gap = o.gap ?? 1.55;
    const rx = Math.cos(FACE + Math.PI / 2), rz = Math.sin(FACE + Math.PI / 2);
    const fx = Math.cos(FACE), fz = Math.sin(FACE);
    for (let r = 0; r < 2; r++)
      for (let i = 0; i < 8; i++) add(r * 8 + i, cx - (i - 3.5) * gap * rx + (r ? -1.3 : 1.3) * fx, cz - (i - 3.5) * gap * rz + (r ? -1.3 : 1.3) * fz, i, TEAMS[r ? 1 : 0].color, { team: r });
  } else if (mode === "patterns") {
    const cols = 7;
    PATTERNS.forEach((p, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const rx = Math.cos(FACE + Math.PI / 2), rz = Math.sin(FACE + Math.PI / 2);
      const fx = Math.cos(FACE), fz = Math.sin(FACE);
      add(i, cx - (c - 3) * 1.7 * rx - (r - 1.5) * 2.1 * fx, cz - (c - 3) * 1.7 * rz - (r - 1.5) * 2.1 * fz, i % 8, TEAMS[i % 6].color, { pattern: i });
    });
  } else {
    for (let i = 0; i < 36; i++) {
      const team = i % 6;
      const k = Math.floor(i / 6);
      add(i, cx + (team - 2.5) * 2.3, cz - 4 + k * 1.7, (team * 3 + k) % 8, TEAMS[team].color, { team, range: i % 9 === 0 ? 8 : 0 });
    }
  }
  const act = o.act || (mode === "crowd" ? "mix" : "idle");
  const ACTS = ["idle", "run", "throw", "hit", "charge", "flip", "ko", "cheer"];
  let t0 = -1;
  let said = false;
  return {
    people,
    frame(time) {
      if (t0 < 0) t0 = time;
      const T = time - t0;
      if (!said) {
        said = true;
        if (mode === "lineup") people.forEach((p) => R.say(p.v.id, CHARACTERS[p.v.char].name, 9999));
        if (mode === "lineup2") people.filter((p) => p.i >= 8).forEach((p) => R.say(p.v.id, CHARACTERS[p.v.char].name, 9999));

      }
      for (const p of people) {
        const v = p.v;
        const ph = T + p.i * 0.37;
        const a = act === "mix" ? ACTS[p.i % ACTS.length] : act;
        v.flags = FLAG.ALIVE | FLAG.GROUNDED;
        v.vx = v.vz = v.vy = 0;
        v.y = 0;
        v.charge = 0;
        v.x = p.hx;
        v.z = p.hz;
        v.aim = FACE + (o.turn ?? 0) + (a === "back" ? Math.PI : a === "side" ? Math.PI / 2 : 0);
        if (a === "run") {
          const ang = ph * 2.2;
          v.x = p.hx + Math.cos(ang) * 0.5;
          v.z = p.hz + Math.sin(ang) * 0.4;
          v.vx = -Math.sin(ang) * 8.4;
          v.vz = Math.cos(ang) * 8.4 * 0.8;
          v.aim = Math.atan2(v.vz, v.vx);
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
          R.actor.hit(v.id, 0.8);
        } else if (a === "cheer" && ph > p.next) {
          p.next = ph + 2.5;
          R.actor.cheer(v.id, 2.4);
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
        R.drawPlayer(v, { gy: 0, self: false });
      }
      void PALETTE;
    },
  };
}
