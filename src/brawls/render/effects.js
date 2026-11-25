// 한 번 일어나는 연출(docs/DESIGN.md §3.7 · v8 — 폭발은 three.js 실시간 3D): 폭발은 fx-kinds.js 의 표를 읽어 재료를 시간표대로 실행한다.
// 입자는 풀 하나(상한 1100 — 화질 저 1/3)에서 광택 구(입체 잉크 방울 — 날아가는 동안 길쭉하게, 바닥에 닿으면 납작하게 퍼진 뒤 얼룩으로),
// 왕관은 바닥에서 솟았다 가라앉는 입체 뿔(늘린 구) + 밑동 고리, 충격파는 퍼지며 얇아지는 토러스 고리 + 바닥 빛 고리 + (화질 고) 화면 일그러짐,
// 기둥 · 버섯 구름은 늘린 구 · 눌린 구, 별 · 잔광 · 웅덩이 · 연기는 평면 효과 묶음(곁들이)으로, 섬광은 점광(lights.js — 지형 · 장애물 그림 ·
// 캐릭터를 팀 색으로 물들인다)으로, 화면 번쩍임 · 어두워짐 · 묻은 잉크는 합성 단계(post.js)로 나간다. 그리기 호출은 늘지 않는다.
// 안개(§3.8): 시야 밖에서 터지면 play(…, { silent: true }) — 바닥 잉크만 조용히 칠하고 연출은 그리지 않는다.
// 바닥에 남는 잉크는 ink.js 가 찍는다(잉크 시스템의 본체) — 얼룩은 0.15초에 걸쳐 퍼진다.
// 색 인자는 PALETTE 번호(−1 = 흰색).
import { PALETTE, BALLOON, BALLOON_KINDS } from "../shared/constants.js";
import { MODE, SHAPE } from "./sprites.js";
import { mixHex, darkHex } from "./palette.js";
import { FX_KINDS, KIND_OF_BALLOON } from "./fx-kinds.js";

const MAX_PARTS = 1100;
const MAX_SPIKES = 260;
const MAX_DECALS = 160;
const MAX_LENS = 8;
const GRAVITY = 22;
const rand = (a, b) => a + Math.random() * (b - a);
const hexOf = (i) => (i < 0 ? 0xffffff : PALETTE[((i ?? 0) % PALETTE.length + PALETTE.length) % PALETTE.length].hex);

/**
 * @param {object} ink        ink.js(splat · dot)
 * @param {() => (x:number, z:number) => boolean} floorAt  바닥이 있는 곳에만 잉크를 찍는다
 * @param {object} [lights]   lights.js(점광)
 * @param {object} [hooks]    { jolt(x, z, r, power, wave), shake(v), splashChars(x, z, r, color), quality() → { parts(0..1), lights, distort },
 *                              visible(x, z) → 안개 — 시야 밖이면 바닥 잉크만 }
 */
export function createEffects(ink, floorAt, lights = null, hooks = {}) {
  const parts = [];
  const lands = []; // 바닥에 닿아 납작하게 퍼지는 방울
  const spikes = []; // 왕관의 뿔
  const rings = []; // 충격파 고리(토러스)
  const bodies = []; // 기둥 · 버섯 갓(늘린 · 눌린 구 하나)
  const decals = [];
  const lens = [];
  const pending = [];
  const shocks = []; // 화면 일그러짐(화질 고)
  const flash = { color: 0xffffff, a: 0 };
  const dim = { a: 0 };
  let tone = 0;
  const Q = () => (hooks.quality ? hooks.quality() : { parts: 1, lights: true, distort: true });

  function part(o) {
    if (parts.length >= MAX_PARTS * Q().parts) return;
    parts.push({ grav: GRAVITY, drag: 0, emit: 0.35, stretch: 0, paint: -1, t: 0, ...o });
  }
  function decal(o) {
    if (decals.length >= MAX_DECALS) decals.shift();
    decals.push({ t: 0, ...o });
  }
  const later = (dt, fn) => (dt > 0 ? pending.push({ t: dt, fn }) : fn());
  const paint = (x, z, color, radius, dx = 0, dz = 0) => {
    if (floorAt()(x, z)) ink.splat(x, z, color, radius, dx, dz);
  };
  const light = (x, y, z, hex, r, power, life) => {
    if (lights && Q().lights) lights.flash(x, y, z, hex, r, power, life);
  };
  const n3 = (n) => Math.max(1, Math.round(n * Q().parts));

  // ------------------------------------------------------------------ 재료
  const ING = {
    flash: (P, c) => light(c.x, c.y + 1.2, c.z, c.hex, P.r * c.s, P.power * c.tone, P.life),
    core: (P, c) => part({ x: c.x, y: c.y + 0.3, z: c.z, vx: 0, vy: 0, vz: 0, col: mixHex(c.hex, 0xffffff, 0.75), life: P.life, size: P.r * c.s, grav: 0, emit: 3.5, grow: -1 }),
    crown: (P, c) => {
      // 바닥에서 솟았다 가라앉는 입체 왕관: 바깥으로 기운 뿔(늘린 구)이 둥글게 서고, 꼭대기 방울이 떨어져 날아간다 + 밑동 고리
      const n = Math.max(5, n3(P.n));
      const r = P.r * c.s;
      const life = 0.42 + r * 0.12;
      for (let i = 0; i < n && spikes.length < MAX_SPIKES; i++) {
        const a = (i / n) * Math.PI * 2 + rand(-0.12, 0.12);
        spikes.push({ x: c.x, z: c.z, a, r0: r * 0.5, r1: r * 1.05, len: P.up * 0.17 * rand(0.7, 1.3) * c.s, w: rand(0.1, 0.15) * c.s * (0.85 + r * 0.2), col: c.hex, ol: c.ol, color: c.color, t: 0, life: life * rand(0.9, 1.1), tip: false });
      }
      // 왕관의 벽: 세로로 늘린 고리가 솟았다 꺼진다(뿔의 밑동을 잇는다)
      rings.push({ x: c.x, z: c.z, r0: r * 0.45, r1: r * 1.0, y: 0.05, t: 0, life, thick: 0.07 * c.s * (0.9 + r * 0.2), col: c.hex, emit: 0.3, flat: 1, wall: P.up * 0.07 * c.s });
    },
    drops: (P, c) => {
      const n = n3(P.n);
      for (let i = 0; i < n; i++) {
        let a = Math.random() * Math.PI * 2;
        if (P.bias && (c.dx || c.dz) && Math.random() < 0.7) a = Math.atan2(c.dz, c.dx) + rand(-0.7, 0.7);
        const sp = rand(P.speed[0], P.speed[1]) * c.s;
        const sz = P.size[0] + (P.size[1] - P.size[0]) * Math.random() ** 1.6; // 작은 것이 많고 큰 것이 드물게
        part({ x: c.x, y: Math.max(0.1, c.y), z: c.z, vx: Math.cos(a) * sp + c.dx * 2, vy: rand(P.up[0], P.up[1]), vz: Math.sin(a) * sp + c.dz * 2, col: c.hex, life: rand(0.6, 1.1), size: sz * c.s * 1.25, paint: c.color, grav: GRAVITY * (P.slow || 1), stretch: 0.07, ol: c.ol });
      }
    },
    shock: (P, c) => {
      // 퍼지며 얇아지는 입체 고리 + 바닥 빛 고리
      rings.push({ x: c.x, z: c.z, r0: 0.3, r1: P.r * c.s, y: 0.08, t: 0, life: P.life, thick: (0.05 + P.thick * 0.5) * c.s, col: mixHex(c.hex, 0xffffff, 0.35), emit: 1.6, flat: 0.45 });
      decal({ kind: "ring", x: c.x, y: 0.03, z: c.z, r0: 0.3, r1: P.r * c.s * 1.05, life: P.life * 1.1, thick: P.thick * 1.6, hex: c.hex, a: 0.55, emit: 0.8 });
      if (P.distort && Q().distort) shocks.push({ x: c.x, z: c.z, r: P.r * c.s, t: 0, life: P.life * 1.2, w: P.distort });
    },
    sparks: (P, c) => {
      const n = n3(P.n);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = P.speed * rand(0.5, 1.1) * c.s;
        part({ x: c.x, y: c.y + 0.4, z: c.z, vx: Math.cos(a) * sp, vy: rand(2, 7), vz: Math.sin(a) * sp, col: i % 3 ? 0xffffff : mixHex(c.hex, 0xffffff, 0.5), life: P.life * rand(0.6, 1.2), size: 0.05, emit: 2.5, drag: 2, stretch: 0.03 });
      }
    },
    stars: (P, c) => {
      const n = n3(P.n);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        decal({ kind: "star", x: c.x + Math.cos(a) * P.r * 0.4 * c.s, y: 0.8, z: c.z + Math.sin(a) * P.r * 0.4 * c.s, vx: Math.cos(a) * P.r * 2, vz: Math.sin(a) * P.r * 2, life: P.life, size: 0.5 * c.s, hex: i % 2 ? 0xffffff : c.hex, a: 1, emit: 1.5 });
      }
    },
    glow: (P, c) => {
      decal({ kind: "glow", x: c.x, y: 0.03, z: c.z, r0: P.r * c.s, r1: P.r * c.s * 1.2, life: P.life, hex: c.hex, a: 0.55, emit: 1.2 });
      light(c.x, c.y + 0.8, c.z, c.hex, P.r * 2.5 * c.s, 0.5 * c.tone, P.life);
    },
    splat: (P, c) => {
      // 0.15초에 걸쳐 퍼진다: 작게 → 중간 → 다 찬 크기
      const R = c.splash * P.r;
      paint(c.x, c.z, c.color, R * 0.45, c.dx, c.dz);
      later(P.grow * 0.5, () => paint(c.x, c.z, c.color, R * 0.75, c.dx, c.dz));
      later(P.grow, () => paint(c.x, c.z, c.color, R, c.dx, c.dz));
    },
    splashChars: (P, c) => hooks.splashChars && hooks.splashChars(c.x, c.z, P.r * c.s, c.color),
    jolt: (P, c) => hooks.jolt && hooks.jolt(c.x, c.z, P.r * c.s, P.power * c.tone, P.wave || 0),
    shake: (P, c) => hooks.shake && hooks.shake(P.v * c.near),
    pillar: (P, c) => {
      bodies.push({ kind: "column", x: c.x, z: c.z, h: P.h * c.s, r: 0.32 * c.s, t: 0, life: 0.75, col: c.hex });
      const n = n3(P.n);
      for (let i = 0; i < n; i++) part({ x: c.x + rand(-0.25, 0.25), y: 0.2, z: c.z + rand(-0.25, 0.25), vx: rand(-0.6, 0.6), vy: P.h * rand(2.2, 3.4), vz: rand(-0.6, 0.6), col: c.hex, life: rand(0.6, 0.9), size: rand(0.14, 0.24) * c.s, paint: c.color, emit: 0.6, stretch: 0.05 });
    },
    strings: (P, c) => {
      const n = n3(P.n);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
        part({ x: c.x, y: 0.3, z: c.z, vx: Math.cos(a) * P.len * 1.5, vy: rand(3, 5), vz: Math.sin(a) * P.len * 1.5, col: c.hex, life: 1.1, size: 0.08, paint: c.color, grav: 9, drag: 1.5, stretch: 0.6 });
      }
    },
    puddle: (P, c) => decal({ kind: "puddle", x: c.x, y: 0.025, z: c.z, r0: P.r * c.s, r1: P.r * c.s, life: P.life, hex: c.hex, a: 0.6, emit: 0.5 }),
    cone: (P, c) => {
      const n = n3(P.n);
      const base = Math.atan2(c.dz || 0, c.dx || 1);
      for (let i = 0; i < n; i++) {
        const a = base + rand(-P.spread, P.spread);
        const sp = rand(4, 10) * c.s;
        part({ x: c.x, y: Math.max(0.3, c.y), z: c.z, vx: Math.cos(a) * sp, vy: rand(1, 5), vz: Math.sin(a) * sp, col: i % 4 ? c.hex : 0x2a2440, life: rand(0.4, 0.8), size: rand(0.06, 0.14), paint: i % 4 ? c.color : -1, stretch: 0.08 });
      }
    },
    spiral: (P, c) => {
      const n = n3(P.n);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 * P.turns;
        const sp = 1.5 + (i / n) * 5;
        part({ x: c.x, y: 0.4 + (i / n) * 1.2, z: c.z, vx: Math.cos(a) * sp, vy: 2 + (i / n) * 4, vz: Math.sin(a) * sp, col: c.hex, life: 0.7, size: 0.1, paint: c.color, emit: 0.8 });
      }
    },
    mushroom: (P, c) => {
      bodies.push({ kind: "column", x: c.x, z: c.z, h: P.h * 0.9, r: 0.55, t: 0, life: 1.1, col: c.hex });
      later(0.18, () => bodies.push({ kind: "cap", x: c.x, z: c.z, h: P.h, r: P.cap * 0.5, t: 0, life: 1.0, col: mixHex(c.hex, 0xffffff, 0.12) }));
      const n = n3(P.n);
      for (let i = 0; i < n; i++) {
        const stem = i < n * 0.4;
        const a = Math.random() * Math.PI * 2;
        if (stem) part({ x: c.x + rand(-0.4, 0.4), y: 0.3, z: c.z + rand(-0.4, 0.4), vx: rand(-0.4, 0.4), vy: rand(6, 9), vz: rand(-0.4, 0.4), col: c.hex, life: 0.9, size: rand(0.18, 0.32), grav: 4, drag: 1.2, emit: 0.6, ol: c.ol });
        else later(0.25, () => part({ x: c.x, y: P.h * 0.75, z: c.z, vx: Math.cos(a) * P.cap * rand(1.5, 2.6), vy: rand(1.5, 3.5), vz: Math.sin(a) * P.cap * rand(1.5, 2.6), col: mixHex(c.hex, 0xffffff, 0.15), life: 1.3, size: rand(0.18, 0.34), grav: 2, drag: 1.4, emit: 0.6, paint: c.color, ol: c.ol }));
      }
    },
    rain: (P, c) => {
      const n = n3(P.n);
      for (let i = 0; i < n; i++) {
        later((i / n) * P.time, () => {
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * P.r;
          part({ x: c.x + Math.cos(a) * r, y: rand(5, 7), z: c.z + Math.sin(a) * r, vx: 0, vy: -rand(2, 5), vz: 0, col: c.hex, life: 2.5, size: rand(0.09, 0.16), paint: c.color, emit: 0.5, stretch: 0.15, big: true });
        });
      }
    },
    chain: (P, c) => {
      for (let i = 0; i < P.n; i++) {
        const a = (i / P.n) * Math.PI * 2 + rand(-0.2, 0.2);
        const tx = c.x + Math.cos(a) * P.dist, tz = c.z + Math.sin(a) * P.dist;
        part({ x: c.x, y: 0.6, z: c.z, vx: (tx - c.x) / 0.35, vy: 4, vz: (tz - c.z) / 0.35, col: 0xffffff, life: 0.35, size: 0.12, emit: 3, grav: 20, stretch: 0.08 });
        later(0.35 + i * P.delay, () => play("basic", tx, 0.2, tz, c.color, { s: 0.6, near: c.near * 0.5 }));
      }
    },
    swirl: (P, c) => {
      const n = n3(P.n);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        part({ x: c.x + Math.cos(a) * P.r, y: rand(0.2, 1.4), z: c.z + Math.sin(a) * P.r, vx: -Math.sin(a) * 6 - Math.cos(a) * P.r / P.time, vy: 0, vz: Math.cos(a) * 6 - Math.sin(a) * P.r / P.time, col: c.hex, life: P.time, size: 0.12, grav: 0, emit: 0.9, stretch: 0.05 });
      }
      decal({ kind: "ring", x: c.x, y: 0.03, z: c.z, r0: P.r, r1: 0.2, life: P.time, thick: 0.15, hex: c.hex, a: 0.8, emit: 0.8 });
    },
    dim: (P) => {
      dim.a = Math.min(dim.a, P.v);
    },
    puffs: (P, c) => {
      const n = n3(P.n);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * P.r * 0.5;
        decal({ kind: "puff", x: c.x + Math.cos(a) * r, y: rand(0.3, 1.2), z: c.z + Math.sin(a) * r, vx: Math.cos(a) * rand(0.5, 1.5), vz: Math.sin(a) * rand(0.5, 1.5), life: P.life * rand(0.7, 1.1), size: rand(0.8, 1.5), hex: mixHex(c.hex, 0x3a3555, 0.7), a: 0.7, emit: 0 });
      }
    },
    wall: (P, c) => {
      const a = Math.atan2(c.dz || 0, c.dx || 1) + Math.PI / 2;
      const hx = Math.cos(a) * P.len / 2, hz = Math.sin(a) * P.len / 2;
      decal({ kind: "wall", x: c.x - hx, z: c.z - hz, x1: c.x + hx, z1: c.z + hz, h: P.h, life: 1.5, hex: c.hex, a: 0.6, emit: 0.6 });
    },
    dome: (P, c) => decal({ kind: "dome", x: c.x, y: 0, z: c.z, r0: 0.3, r1: P.r, life: P.life, hex: c.hex, a: 0.8, emit: 0.8 }),
    sparkle: (P, c) => {
      const n = n3(P.n);
      for (let i = 0; i < n; i++) decal({ kind: "star", x: c.x + rand(-0.8, 0.8), y: rand(0.2, 1), z: c.z + rand(-0.8, 0.8), vx: 0, vz: 0, vy: rand(1, 2.5), life: P.life * rand(0.6, 1), size: rand(0.25, 0.4), hex: i % 2 ? 0xffffff : c.hex, a: 1, emit: 1.2 });
    },
    debris: (P, c) => {
      const n = n3(P.n);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        part({ x: c.x + rand(-0.7, 0.7), y: rand(0.2, c.h || 1.2), z: c.z + rand(-0.7, 0.7), vx: Math.cos(a) * rand(1.5, 5), vy: rand(3, 8), vz: Math.sin(a) * rand(1.5, 5), col: i % 3 ? c.hex : c.hex2 || 0x2a2440, life: rand(0.5, 0.9), size: rand(0.12, 0.24), emit: i % 3 ? 0.4 : 0 });
      }
    },
  };

  /** 표의 한 종류를 (x, y, z) 에서 실행한다. color = PALETTE 번호. o = { dx, dz, s(크기 배율), splash(얼룩 반지름 u), near(흔들림 배율) } */
  const seen = (x, z) => !hooks.visible || hooks.visible(x, z);
  function play(name, x, y, z, color, o = {}) {
    const K = FX_KINDS[name];
    if (!K) return;
    if (o.silent || !seen(x, z)) {
      // 시야 밖: 바닥 잉크만(얼룩 · 잉크 비) — 연출 · 빛 · 흔들림은 없다
      const splash = o.splash ?? BALLOON.SMALL.splash;
      for (const P of K.parts) {
        if (P.k === "splat") later(P.at || 0, () => paint(x, z, color, splash * P.r, o.dx || 0, o.dz || 0));
        else if (P.k === "rain") for (let i = 0; i < Math.round(P.n / 3); i++) later((P.at || 0) + (i / P.n) * 3 * P.time, () => {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * P.r * (o.s ?? 1);
          paint(x + Math.cos(a) * r, z + Math.sin(a) * r, color, rand(0.25, 0.5));
        });
      }
      return;
    }
    const tones = K.tones;
    const t = tones ? tones[tone++ % tones.length] : 1;
    const hex = t > 1 ? mixHex(hexOf(color), 0xffffff, t - 1) : t < 1 ? mixHex(hexOf(color), 0x05040c, 1 - t) : hexOf(color);
    const c = {
      x, y, z, color, hex, ol: darkHex(hex, 0.38), tone: t, dx: o.dx || 0, dz: o.dz || 0, s: (o.s ?? 1) * (K.size || 1),
      splash: o.splash ?? BALLOON.SMALL.splash, near: o.near ?? 1, h: o.h, hex2: o.hex2,
    };
    if (o.hex !== undefined) {
      c.hex = o.hex;
      c.ol = darkHex(o.hex, 0.38);
    }
    for (const P of K.parts) {
      const fn = ING[P.k];
      if (!fn) continue;
      later(P.at || 0, () => fn(P, c));
    }
  }

  const fx = {
    play,
    /**
     * 풍선이 터졌다: 종류(kind = BALLOON_KINDS 번호)마다 다른 연출 + 바닥 잉크(잉크 시스템의 본체).
     * ev = burst 사건의 덧붙은 것 { sub(폭죽의 둘레 폭발 — 작게), combo(합동 폭발 — 큰 고리 · 별을 덧붙인다), r(실제 반경) }
     */
    burst(x, y, z, color, big, dx = 0, dz = 0, splashScale = 1, kind = 0, ev = null) {
      const K = BALLOON_KINDS[kind] || BALLOON_KINDS[0];
      let splash = (big ? BALLOON.BIG.splash : BALLOON.SMALL.splash) * splashScale;
      if (ev && ev.r > 0) splash = ev.r;
      if (K.nuke) return; // 메가 잉크 폭탄은 nuke 가 맡는다
      const name = KIND_OF_BALLOON[K.key] || "basic";
      const s = (big ? 1.3 : 1) * (ev && ev.sub ? 0.7 : 1);
      if (y >= 0.6) {
        // 공중(울타리 · 블록 옆면)에서 터졌다: 바닥은 칠하지 않는다
        play(name, x, y, z, color, { dx, dz, s: big ? 1.25 : 1, splash: 0.01 });
      } else play(ev && ev.sub ? "triple" : name, x, y, z, color, { dx, dz, s, splash: splash * (big ? 0.95 : 0.9) });
      if (ev && ev.combo) play("combo", x, Math.min(y, 0.3), z, color, { s: Math.max(1, splash / 2.4) });
    },
    /** 메가 잉크 폭탄: 번쩍 → 버섯 구름 → 잉크 비 → 차례로 들썩이는 충격파 → 긴 잔광 */
    nuke(x, y, z, color, radius) {
      paint(x, z, color, radius * 0.75, 0, 0);
      const vis = seen(x, z);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.random();
        const d = radius * rand(0.45, 0.8);
        later(0.05 + i * 0.03, () => paint(x + Math.cos(a) * d, z + Math.sin(a) * d, color, radius * rand(0.16, 0.3), Math.cos(a), Math.sin(a)));
      }
      play("bomb", x, 0, z, color, { s: radius / 6, silent: !vis });
      if (vis) fx.flash(-1, 0.6);
    },
    ko(x, z, color) {
      play("basic", x, 0.4, z, color, { s: 1.2, splash: 1.6 });
    },
    spawn(x, z, color) {
      if (!seen(x, z)) return;
      decal({ kind: "ring", x, y: 0.03, z, r0: 1.8, r1: 0.3, life: 0.45, thick: 0.18, hex: hexOf(color), a: 0.9, emit: 0.8 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        part({ x: x + Math.cos(a) * 0.5, y: 0.1, z: z + Math.sin(a) * 0.5, vx: 0, vy: rand(3, 5), vz: 0, col: mixHex(hexOf(color), 0xffffff, 0.5), life: 0.4, size: 0.08, grav: 4, emit: 1.5 });
      }
    },
    ring(x, y, z, color, r0, r1, life, alpha = 0.8) {
      if (!seen(x, z)) return;
      decal({ kind: "ring", x, y: y + 0.03, z, r0, r1, life, thick: 0.14, hex: hexOf(color), a: alpha, emit: 0.6 });
    },
    sparks(x, y, z, color, power = 0.5, dx = 0, dz = 0) {
      if (!seen(x, z)) return;
      const n = 4 + Math.round(power * 8);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = rand(1.5, 4) * (0.6 + power);
        part({ x, y: y + 0.8, z, vx: Math.cos(a) * sp + dx * 4 * power, vy: rand(2, 6), vz: Math.sin(a) * sp + dz * 4 * power, col: i % 3 ? hexOf(color) : 0xffffff, life: rand(0.25, 0.5), size: rand(0.05, 0.09), emit: 1.6 });
      }
    },
    dash(x, z, dx, dz, color) {
      if (!seen(x, z)) return;
      for (let i = 0; i < 6; i++) part({ x: x - dx * i * 0.3, y: 0.15, z: z - dz * i * 0.3, vx: -dx * rand(1, 3), vy: rand(0.5, 1.5), vz: -dz * rand(1, 3), col: hexOf(color), life: rand(0.2, 0.35), size: 0.09, emit: 0.8 });
      fx.ring(x, 0, z, color, 0.3, 1.2, 0.25, 0.6);
    },
    itemPop(x, z, picked) {
      if (!seen(x, z)) return;
      decal({ kind: "ring", x, y: 0.03, z, r0: picked ? 0.3 : 1.2, r1: picked ? 1.3 : 0.2, life: picked ? 0.3 : 0.4, thick: 0.2, hex: 0xffffff, a: 0.75, emit: 0.6 });
    },
    drip(x, y, z, color) {
      if (!seen(x, z)) return;
      part({ x, y, z, vx: rand(-0.4, 0.4), vy: rand(-0.5, 0.5), vz: rand(-0.4, 0.4), col: hexOf(color), life: 1.5, size: 0.06, paint: color, emit: 0.4 });
    },
    fuse(x, y, z, color) {
      if (!seen(x, z)) return;
      for (const [i, c] of [[0, 1], [1, 2], [2, 3], [3, 4]]) decal({ kind: "ring", x, y: y - 1.2, z, r0: 2.2 - i * 0.2, r1: 0.2, life: 0.5 + i * 0.08, thick: 0.15, hex: hexOf(c), a: 0.9, emit: 0.8 });
      light(x, y, z, hexOf(color), 4, 1.4, 0.6);
    },
    boost(x, y, z) {
      if (!seen(x, z)) return;
      fx.ring(x, Math.max(0, y - 0.6), z, 5, 0.3, 1.8, 0.4, 0.9);
    },
    shieldHit(x, y, z) {
      if (!seen(x, z)) return;
      decal({ kind: "fring", x, y, z, r0: 0.1, r1: 0.7, life: 0.25, thick: 0.3, hex: hexOf(1), a: 0.9, emit: 1 });
    },
    /** 블록이 부서졌다: 상자 조각 · 먼지 */
    debris(x, z, colors, h = 1.5) {
      play("block", x, 0.5, z, 0, { hex: colors[0], hex2: colors[1], h });
    },
    /** 블록이 다시 자랐다: 발밑 고리 */
    regrow(x, z, colors) {
      if (!seen(x, z)) return;
      decal({ kind: "ring", x, y: 0.03, z, r0: 1.6, r1: 0.4, life: 0.4, thick: 0.25, hex: colors[1] ?? 0xffffff, a: 0.6, emit: 0.6 });
    },
    /** 잉크 분수(퀴즈 성공) */
    fountain(x, y, z, color, n = 40) {
      if (!seen(x, z)) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = rand(0.5, 4);
        part({ x: x + rand(-0.8, 0.8), y, z: z + rand(-0.3, 0.3), vx: Math.cos(a) * sp, vy: rand(7, 13), vz: Math.sin(a) * sp * 0.6 + 1.2, col: hexOf(color), life: rand(1.0, 1.6), size: rand(0.1, 0.2), paint: color, emit: 0.7 });
      }
      light(x, y, z, hexOf(color), 7, 1.8, 1.2);
    },
    /** 소용돌이(홈 소환): rise = true 면 솟아오르는 쪽, false 면 빨려 드는 쪽 */
    swirl(x, z, color, rise = true) {
      if (!seen(x, z)) return;
      const hex = hexOf(color);
      for (let i = 0; i < 3; i++) decal({ kind: "ring", x, y: 0.03, z, r0: rise ? 0.3 : 2.2 - i * 0.4, r1: rise ? 2.0 - i * 0.4 : 0.2, life: 0.55 + i * 0.12, thick: 0.2, hex, a: 0.85, emit: 0.8 });
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const r = rise ? 0.4 : 1.6;
        part({ x: x + Math.cos(a) * r, y: 0.1, z: z + Math.sin(a) * r, vx: -Math.sin(a) * 3 + (rise ? 1.5 : -2) * Math.cos(a), vy: rand(4, 7), vz: Math.cos(a) * 3 + (rise ? 1.5 : -2) * Math.sin(a), col: hex, life: rand(0.5, 0.8), size: 0.1, grav: 6, emit: 0.9 });
      }
      light(x, 0.8, z, hex, 4, 1.2, 0.6);
    },
    flash(color, strength) {
      if (strength > flash.a) {
        flash.a = Math.min(0.9, strength);
        flash.color = hexOf(color);
      }
    },
    lens(color, power = 0.5) {
      if (lens.length >= MAX_LENS) lens.shift();
      lens.push({ x: rand(-0.75, 0.75), y: rand(-0.7, 0.7), r: rand(0.18, 0.34) * (0.7 + power * 0.6), col: hexOf(color), t: 0, life: 1.6 + power * 1.2 });
    },
    clearLens() {
      lens.length = 0;
    },
    clear() {
      parts.length = 0;
      lands.length = 0;
      spikes.length = 0;
      rings.length = 0;
      bodies.length = 0;
      decals.length = 0;
      lens.length = 0;
      pending.length = 0;
      shocks.length = 0;
      flash.a = 0;
      dim.a = 0;
    },
    /** 개발용: 지금 살아 있는 연출 목록 */
    get live() {
      return { parts, lands, spikes, rings, bodies, decals };
    },
    get counts() {
      return { parts: parts.length + lands.length + spikes.length + rings.length + bodies.length, decals: decals.length, pending: pending.length };
    },

    update(dt) {
      for (let i = pending.length - 1; i >= 0; i--) {
        pending[i].t -= dt;
        if (pending[i].t <= 0) {
          const f = pending[i].fn;
          pending.splice(i, 1);
          f();
        }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += dt;
        const drag = Math.exp(-p.drag * dt);
        p.vx *= drag;
        p.vz *= drag;
        p.vy -= p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y <= 0 && p.grav > 0) {
          if (p.paint >= 0 && floorAt()(p.x, p.z)) {
            if (p.big) ink.splat(p.x, p.z, p.paint, p.size * 4, 0, 0);
            else ink.dot(p.x, p.z, p.paint, p.size * 0.9);
            // 바닥에 닿은 방울이 납작하게 퍼졌다가 얼룩 속으로 가라앉는다
            if (p.size > 0.05 && lands.length < 160) lands.push({ x: p.x, z: p.z, r: p.size, col: p.col, t: 0, life: 0.26, sx: p.vx * 0.02, sz: p.vz * 0.02 });
          }
          parts.splice(i, 1);
          continue;
        }
        if (p.t >= p.life) parts.splice(i, 1);
      }
      for (const L of [lands, rings, bodies]) {
        for (let i = L.length - 1; i >= 0; i--) {
          L[i].t += dt;
          if (L[i].t >= L[i].life) L.splice(i, 1);
        }
      }
      for (let i = spikes.length - 1; i >= 0; i--) {
        const k = spikes[i];
        k.t += dt;
        // 꼭대기에 다다르면 끝 방울이 떨어져 날아간다
        if (!k.tip && k.t > k.life * 0.42) {
          k.tip = true;
          const L = k.len, sp = 2.2 + L * 2.5;
          const dx = Math.cos(k.a), dz = Math.sin(k.a);
          const rr = k.r0 + (k.r1 - k.r0) * 0.5;
          part({ x: k.x + dx * (rr + L * 0.45), y: L * 0.9, z: k.z + dz * (rr + L * 0.45), vx: dx * sp, vy: rand(2.5, 4.5), vz: dz * sp, col: k.col, life: 1.2, size: k.w * rand(1.0, 1.4), paint: k.color, emit: 0.3, stretch: 0.07, ol: k.ol });
        }
        if (k.t >= k.life) spikes.splice(i, 1);
      }
      for (let i = decals.length - 1; i >= 0; i--) {
        const d = decals[i];
        d.t += dt;
        if (d.vx) d.x += d.vx * dt;
        if (d.vz) d.z += d.vz * dt;
        if (d.vy) d.y += d.vy * dt;
        if (d.t >= d.life) decals.splice(i, 1);
      }
      for (let i = shocks.length - 1; i >= 0; i--) {
        shocks[i].t += dt;
        if (shocks[i].t >= shocks[i].life) shocks.splice(i, 1);
      }
      for (let i = lens.length - 1; i >= 0; i--) {
        lens[i].t += dt;
        if (lens[i].t >= lens[i].life) lens.splice(i, 1);
      }
      flash.a *= Math.exp(-dt * 9);
      if (flash.a < 0.004) flash.a = 0;
      dim.a *= Math.exp(-dt * 6);
      if (dim.a > -0.004) dim.a = 0;
    },

    /** 월드 연출: 입자는 광택 구(입체 방울 · 불꽃 — 떨어지는 쪽으로 조금 늘린다), 고리 · 별 · 잔광 · 연기는 평면 묶음 */
    draw(batch, spheres) {
      for (const p of parts) {
        const k = p.t / p.life;
        let s = p.size * (1 - k * k * 0.6);
        if (p.grow === -1) s = p.size * (0.75 + Math.sin(Math.min(1, k * 1.6) * Math.PI) * 0.5) * (1 - k * 0.5); // 하얀 심: 부풀었다 사그라든다
        const sp = Math.hypot(p.vx, p.vy, p.vz);
        spheres.ball(p.x, p.y, p.z, Math.max(0.02, s), p.col, p.grow === -1 ? p.emit * (1 - k) : p.emit, p.ol !== undefined && s > 0.07 ? p.ol : -1, 1 + Math.min(1.6, sp * (p.stretch || 0)), p.vx, p.vy, p.vz);
      }
      // 납작하게 퍼지는 방울: 0.06초에 넓게 퍼지고 높이가 꺼지며 얼룩으로 가라앉는다
      for (const L of lands) {
        const k = L.t / L.life;
        const spread = 1 + 1.3 * Math.min(1, k / 0.25);
        const hgt = L.r * (k < 0.25 ? 0.55 - k : 0.3 * (1 - k));
        spheres.blob(L.x + L.sx * k, Math.max(0.01, hgt * 0.5), L.z + L.sz * k, L.r * spread, Math.max(0.012, hgt), L.r * spread, L.col, 0.25);
      }
      // 왕관 뿔: 밑동이 바깥으로 퍼지며 솟았다(0..45%) 가라앉는다
      for (const K of spikes) {
        const k = K.t / K.life;
        const up = k < 0.45 ? Math.sin((k / 0.45) * Math.PI * 0.5) : Math.cos(((k - 0.45) / 0.55) * Math.PI * 0.5);
        const L = Math.max(0.02, K.len * up);
        const rr = K.r0 + (K.r1 - K.r0) * (1 - (1 - k) * (1 - k));
        const dx = Math.cos(K.a), dz = Math.sin(K.a);
        // 바깥으로 기운 뿔(위 + 바깥 0.5). 카메라 쪽(+z)으로 기운 앞쪽 뿔은 시선과 거의 나란해져 납작한 동전처럼 보였다 —
        // 앞으로 기우는 몫은 줄이고(0.12) 그만큼 곧게 세운다(화면에서 늘 위로 솟은 뿔로 보이게)
        const lx = dx * 0.5, ly = 1, lz = dz > 0 ? dz * 0.12 : dz * 0.5;
        const ln = Math.hypot(lx, ly, lz);
        const mx = K.x + dx * rr + (lx / ln) * L * 0.5, my = (ly / ln) * L * 0.5, mz = K.z + dz * rr + (lz / ln) * L * 0.5;
        const w = K.w * (0.6 + 0.4 * up);
        spheres.ball(mx, my, mz, w, K.col, 0.35, K.ol, Math.max(1, L / (2 * w)), lx, ly, lz);
        if (!K.tip) spheres.ball(K.x + dx * rr + (lx / ln) * L, (ly / ln) * L, K.z + dz * rr + (lz / ln) * L, w * 1.3, K.col, 0.45, K.ol);
      }
      // 충격파 · 왕관 밑동 고리: 퍼지며 얇아진다
      for (const R of rings) {
        const k = R.t / R.life;
        const e = 1 - (1 - k) * (1 - k) * (1 - k);
        if (R.wall) {
          // 왕관 벽: 솟았다(0..40%) 꺼진다 — 세로로 늘린 관
          const up = k < 0.4 ? Math.sin((k / 0.4) * Math.PI * 0.5) : Math.cos(((k - 0.4) / 0.6) * Math.PI * 0.5);
          const h = Math.max(0.02, R.wall * up);
          spheres.ring(R.x, h, R.z, R.r0 + (R.r1 - R.r0) * e, R.thick, R.col, R.emit, h / R.thick);
        } else spheres.ring(R.x, R.y, R.z, R.r0 + (R.r1 - R.r0) * e, R.thick * Math.pow(1 - k, 0.8), R.col, R.emit * (1 - k * 0.7), R.flat);
      }
      // 기둥(늘린 구가 솟았다 꺼진다) · 버섯 갓(눌린 구가 부풀며 오르다 흩어진다)
      for (const B of bodies) {
        const k = B.t / B.life;
        if (B.kind === "column") {
          const up = k < 0.35 ? Math.sin((k / 0.35) * Math.PI * 0.5) : 1 - (k - 0.35) / 0.65;
          const h = Math.max(0.05, B.h * up);
          const r = B.r * (0.75 + 0.25 * up);
          spheres.blob(B.x, h * 0.5, B.z, r, h * 0.5, r, B.col, 0.5);
        } else {
          const grow = 1 - (1 - Math.min(1, k / 0.4)) ** 2;
          const r = B.r * (0.5 + 0.5 * grow) * (1 - Math.max(0, k - 0.55) / 0.45);
          spheres.blob(B.x, B.h * (0.7 + 0.3 * grow), B.z, r, r * 0.55, r, B.col, 0.6 * (1 - k));
        }
      }
      for (const d of decals) {
        const k = d.t / d.life;
        const e = 1 - (1 - k) * (1 - k);
        if (d.kind === "ring" || d.kind === "fring") {
          const rad = d.r0 + (d.r1 - d.r0) * e;
          const w = Math.max(0.05, rad * 2);
          batch.push(d.x, d.y, d.z, w, w, d.hex, d.a * (1 - k), SHAPE.RING, d.thick, d.kind === "ring" ? MODE.FLAT : MODE.FACE, 0.05, d.emit);
        } else if (d.kind === "star") {
          const s = d.size * (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8);
          batch.push(d.x, d.y, d.z, s, s, d.hex, d.a, SHAPE.STAR, 0, MODE.FACE, 0.2, d.emit);
        } else if (d.kind === "glow" || d.kind === "puddle") {
          const wob = d.kind === "puddle" ? 1 + Math.sin(d.t * 9) * 0.06 : 1;
          const rad = (d.r0 + (d.r1 - d.r0) * e) * wob;
          batch.push(d.x, d.y, d.z, rad * 2, rad * 2 / wob / wob, d.hex, d.a * (1 - k * k), SHAPE.DISC, 0, MODE.FLAT, 0.03, d.emit);
        } else if (d.kind === "puff") {
          const s = d.size * (0.6 + k * 0.8);
          batch.push(d.x, d.y, d.z, s, s, d.hex, d.a * (1 - k), SHAPE.DISC, 0, MODE.FACE, 0.1, 0);
        } else if (d.kind === "wall") {
          batch.wall(d.x, d.z, d.x1, d.z1, 0, d.h, d.hex, d.a * (1 - k * k), 6, Math.min(1, d.t / 0.25), d.emit);
        } else if (d.kind === "dome") {
          const rad = d.r0 + (d.r1 - d.r0) * e;
          batch.push(d.x, rad * 0.4, d.z, rad * 2, rad * 2, d.hex, d.a * (1 - k), SHAPE.RING, 0.06, MODE.FACE, 0.2, d.emit);
          batch.push(d.x, 0.03, d.z, rad * 2, rad * 2, d.hex, d.a * (1 - k), SHAPE.RING, 0.08, MODE.FLAT, 0.05, d.emit);
        }
      }
    },
    /** 합성 단계에 넘길 화면 연출: { flash, lens, shock(기기 px — project 로), dim } */
    screen(out, project) {
      const c = flash.color;
      const lin = (v) => v;
      out.flash[0] = lin(((c >> 16) & 255) / 255);
      out.flash[1] = lin(((c >> 8) & 255) / 255);
      out.flash[2] = lin((c & 255) / 255);
      out.flash[3] = flash.a;
      if (dim.a < 0) {
        out.flash[0] = out.flash[1] = out.flash[2] = 0;
        out.flash[3] = Math.max(flash.a, -dim.a);
      }
      out.lens.length = 0;
      for (const l of lens) {
        const k = l.t / l.life;
        const a = k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9;
        out.lens.push({ x: l.x, y: l.y - k * 0.15, r: l.r * (1 + k * 0.25), a: 0.55 * a, rgb: [((l.col >> 16) & 255) / 255, ((l.col >> 8) & 255) / 255, (l.col & 255) / 255] });
      }
      out.shock.length = 0;
      if (project) {
        for (const s of shocks) {
          if (out.shock.length >= 4) break;
          const k = s.t / s.life;
          const p = project(s.x, s.z);
          out.shock.push([p.x, p.y, p.k * s.r * (0.2 + k * 0.9), s.w * (1 - k)]);
        }
      }
      return out;
    },
  };
  void BALLOON_KINDS;
  return fx;
}
