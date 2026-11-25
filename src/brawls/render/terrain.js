// 바닥(docs/DESIGN.md §3.12 — 원본 ink-brawl "잉크 공장"의 바닥을 칸 격자 맵으로): 어두운 무채색 철판(판 하나 = 1칸 2u · 판 사이 줄눈 ·
// 모서리 안쪽 리벳 넷 · 판마다 조금 다른 거칠기)을 블랙라이트(차가운 파란 주광 왼쪽 위 + 보랏빛 보조광 · 주변광)로 비추고, 그 위에 잉크 캔버스가
// 칠해져 스스로 빛난다. 원본의 법선 · 거칠기 맵(arena-hp.js makePlateMaps)은 그림을 굽지 않고 셰이더가 판 좌표로 바로 계산한다(텍스처 0장).
// 지역(칸 배열에서 — 경계는 판 줄눈을 따라 반듯하게):
//   길(홈 ↔ 퀴즈 룸 ↔ 퀴즈 룸, 다익스트라) = 한 톤 밝은 판 + 판 가운데 유도등 점선 네온(진행 방향으로 천천히 흐름)
//   퀴즈 룸 광장 = 원으로 깐 밝은 판(방사형 줄눈) + 네온 고리 테두리 · 홈 = 팀 색으로 물든 판 + 팀 색 네온 테두리와 경고 빗금
//   잉크 강 = 낮게 파인 수로의 어두운 광택 잉크 물(느린 물결 · 형광 거품) + 위쪽 수로 벽 · 다리 = 철망 격자 · 점프 보드 = 네온 고리
//   경기장 밖 = 어두운 잉크 바다. 바닥은 그리기 1번. 섬광 점광 · 전장의 안개(가 본 곳은 철판이 어둡게, 네온만 희미하게)를 곱한다.
import * as THREE from "three";
import { CELL, isBlock } from "./grid.js";
import { GLSL_LIGHTS, GLSL_FOG, GLSL_UTIL } from "./glsl.js";
import { STYLE } from "./style.js";
import { INK_LIFE, INK_CODE_RATE } from "./ink.js";

/** 칸 종류 → 바닥 지역 번호(셰이더의 kind) */
export const REGION = { floor: 0, path: 1, plaza: 2, home: 3, river: 4, bridge: 5, pad: 6, wall: 7, block: 8 };
const DIR = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // 0 +x · 1 −x · 2 +z · 3 −z

const hash = (i, s = 0) => {
  let h = Math.imul((i + 1) ^ (s * 0x45d9f3b), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

/** 칸 r, c 가 걸어 다닐 수 있나(길 찾기용 — 처음 상태: 부서지는 블록은 비용이 크다) */
function walkCost(G, i) {
  const t = G.tile[i];
  if (t === CELL.BREAK) return 6;
  if (isBlock(t) || t === CELL.RIVER) return -1;
  return 1;
}

/** 칸 a → b 의 가장 싼 길(칸 번호 목록). 없으면 [] — 다익스트라(칸 ≤ 40² 이라 단순한 배열 큐로 충분) */
export function cellPath(G, a, b) {
  const N = G.n * G.n;
  const dist = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  dist[a] = 0;
  const open = [a];
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (dist[open[k]] < dist[open[bi]]) bi = k;
    const i = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === b) break;
    const c = i % G.n, r = (i / G.n) | 0;
    for (const [dc, dr] of DIR) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= G.n || rr >= G.n) continue;
      const j = rr * G.n + cc;
      if (done[j]) continue;
      const w = j === b ? 1 : walkCost(G, j);
      if (w < 0) continue;
      // 곧게 가는 길을 조금 더 좋아한다(지그재그 대신 굽이)
      const turn = prev[i] >= 0 && prev[i] !== i - (dc + dr * G.n) ? 0.35 : 0;
      const nd = dist[i] + w + turn + hash(j, 7) * 0.2;
      if (nd < dist[j]) {
        dist[j] = nd;
        prev[j] = i;
        open.push(j);
      }
    }
  }
  if (!Number.isFinite(dist[b])) return [];
  const out = [];
  for (let i = b; i >= 0; i = prev[i]) out.push(i);
  return out.reverse();
}

const dirOf = (from, to, n) => {
  const dc = (to % n) - (from % n), dr = ((to / n) | 0) - ((from / n) | 0);
  return dc > 0 ? 0 : dc < 0 ? 1 : dr > 0 ? 2 : 3;
};

/**
 * 칸 배열 → 바닥 칸 자료(n × n RGBA, 순수 함수 — test/render-map.test.js).
 *   R = 지역(REGION) · G = 길의 들어온 방향 + 1(0 없음) · B = 나가는 방향 + 1 · A = 홈 번호 + 1
 * 길은 홈마다 가장 가까운 퀴즈 룸으로, 퀴즈 룸끼리는 가까운 순서로 잇는다(최소 신장 나무). 방향은 홈 → 룸(유도등이 흐르는 쪽).
 * @returns {{ n, data: Uint8Array, paths: number[][] }}
 */
export function floorMap(G, A = {}) {
  const n = G.n;
  const data = new Uint8Array(n * n * 4);
  const cellOf = (x, z) => {
    const c = Math.max(0, Math.min(n - 1, Math.floor((x - G.x0) / G.size)));
    const r = Math.max(0, Math.min(n - 1, Math.floor((z - G.z0) / G.size)));
    return r * n + c;
  };
  const rooms = (A.quizRooms || []).map((q) => cellOf(q.x, q.z));
  const homes = (A.homes || []).filter((h) => h.c1 >= h.c0).map((h) => Math.round((h.r0 + h.r1) / 2) * n + Math.round((h.c0 + h.c1) / 2));
  const links = [];
  const dCell = (p, q) => Math.hypot((p % n) - (q % n), ((p / n) | 0) - ((q / n) | 0));
  for (const h of homes) {
    let best = -1;
    for (const r of rooms) if (best < 0 || dCell(h, r) < dCell(h, best)) best = r;
    if (best >= 0) links.push([h, best]);
  }
  if (rooms.length > 1) {
    const inTree = [rooms[0]];
    const rest = rooms.slice(1);
    while (rest.length) {
      let bi = 0, bj = 0, bd = Infinity;
      rest.forEach((r, i) => inTree.forEach((t, j) => {
        const d = dCell(r, t);
        if (d < bd) [bd, bi, bj] = [d, i, j];
      }));
      links.push([inTree[bj], rest[bi]]);
      inTree.push(rest.splice(bi, 1)[0]);
    }
  }
  const pin = new Int8Array(n * n).fill(-1);
  const pout = new Int8Array(n * n).fill(-1);
  const paths = [];
  for (const [p, q] of links) {
    const path = cellPath(G, p, q);
    paths.push(path);
    for (let k = 0; k < path.length; k++) {
      const i = path[k];
      if (k > 0 && pin[i] < 0) pin[i] = dirOf(path[k - 1], i, n);
      if (k < path.length - 1 && pout[i] < 0) pout[i] = dirOf(i, path[k + 1], n);
    }
  }
  for (let i = 0; i < n * n; i++) {
    const t = G.tile[i];
    let reg = REGION.floor;
    if (t === CELL.ZONE) reg = REGION.plaza;
    else if (t === CELL.HOME) reg = REGION.home;
    else if (t === CELL.RIVER) reg = REGION.river;
    else if (t === CELL.BRIDGE) reg = REGION.bridge;
    else if (t === CELL.PAD) reg = REGION.pad;
    else if (t === CELL.WALL) reg = REGION.wall;
    else if (isBlock(t)) reg = REGION.block;
    else if (pin[i] >= 0 || pout[i] >= 0) reg = REGION.path;
    data[i * 4] = reg;
    const onPath = reg === REGION.path || reg === REGION.bridge || reg === REGION.floor || reg === REGION.pad;
    data[i * 4 + 1] = onPath && pin[i] >= 0 ? pin[i] + 1 : 0;
    data[i * 4 + 2] = onPath && pout[i] >= 0 ? pout[i] + 1 : 0;
    data[i * 4 + 3] = G.home && G.home[i] >= 0 ? G.home[i] + 1 : 0;
  }
  return { n, data, paths };
}

const F = STYLE.floor;
const v3s = (h) => {
  if (Array.isArray(h)) return `vec3(${h.map((x) => x.toFixed(4)).join(", ")})`;
  const c = new THREE.Color(h);
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
};
const MAX_HOMES = 8; // [왕국전] 8팀(6 → 8)
const MAX_ROOMS = 9; // [왕국전] 보석 섹션 = 팀 수 + 1(8팀이면 9곳 — 5 → 9)

const VERT = /* glsl */ `
out vec2 vXZ;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
precision highp float;
in vec2 vXZ;
uniform sampler2D uCells;   // 칸 자료(최근접): R 지역 · G 들어온 방향 · B 나가는 방향 · A 홈
uniform sampler2D uInk;     // 바닥 잉크(ink.js): RGB 색 · A 덮은 정도(바탕 투명)
uniform sampler2D uInkT;    // 칠한 시각 부호(최근접 — R × 255 = 0..255 고리, 초당 INK_CODE_RATE)
uniform float uInkNow;      // 지금 시각 부호(연속값)
uniform vec2 uInkLife;      // 그대로인 시간 · 사라지는 시간(초)
uniform sampler2D uShade;   // [왕국전] 구운 그림자(R) · 접지 어둠(G) — floorshade.js(바닥 칸 격자에 맞춘 텍스처, 선형)
uniform float uShadeOn;
uniform vec4 uGrid;         // x0, z0, 칸 크기, n
uniform vec4 uInkInfo;     // x = 잉크 캔버스가 덮는 반변(u), zw = 그 가운데(월드 — 던전은 내 레인의 가운데)
uniform vec4 uHomeRect[${MAX_HOMES}];   // x0, z0, x1, z1(u)
uniform vec4 uHomeCol[${MAX_HOMES}];    // 팀 색(선형) · 아는 팀인가
uniform vec4 uRoom[${MAX_ROOMS}];       // x, z, 반지름, 있음
uniform vec3 uRoomCol[${MAX_ROOMS}];
uniform float uTime;
uniform float uDetail;
layout(location = 0) out vec4 outColor;
${GLSL_UTIL}
${GLSL_LIGHTS}
${GLSL_FOG}
const vec3 PLATE = ${v3s(F.plate)};
const vec3 PLATE_PATH = ${v3s(F.path)};
const vec3 PLATE_PLAZA = ${v3s(F.plaza)};
const vec3 SEA = ${v3s(F.sea)};
const vec3 WATER = ${v3s(F.water)};
const vec3 KEY = ${v3s(F.key)};
const vec3 FILL = ${v3s(F.fill)};
const vec3 AMB = ${v3s(F.ambient)};
const vec3 GUIDE = ${v3s(F.guide)};
const vec3 LKEY = normalize(vec3(-0.45, 1.0, -0.35));
ivec2 cellOf(vec2 p) { return ivec2(floor((p - uGrid.xy) / uGrid.z)); }
vec4 cellAt(ivec2 c) {
  int n = int(uGrid.w + 0.5);
  if (c.x < 0 || c.y < 0 || c.x >= n || c.y >= n) return vec4(-1.0);
  return texelFetch(uCells, c, 0) * 255.0;
}
vec2 dirV(float d) {
  int k = int(d + 0.5) - 1;
  return k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(-1.0, 0.0) : k == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
}
float inkK(vec2 p) {
  return texture(uInk, ((p - uInkInfo.zw) / uInkInfo.x + 1.0) * 0.5).a;
}
// 블랙라이트로 비춘 판: 주광(차가운 파랑) · 보조광(보라) · 주변광 + 판마다 다른 거칠기의 반들거림
vec3 lightPlate(vec3 base, vec3 N, float rough) {
  float kd = max(dot(N, LKEY), 0.0);
  vec3 c = base * (AMB + KEY * kd + FILL * max(dot(N, normalize(vec3(0.5, 0.6, 0.9))), 0.0));
  float spec = pow(max(dot(N, normalize(LKEY + vec3(0.0, 0.66, 0.75))), 0.0), mix(60.0, 8.0, rough));
  return c + KEY * spec * (1.0 - rough) * 0.12;
}
// 정사각 판 하나(가로세로 s u): 줄눈(어둡게) · 왼쪽 위 모서리 밝게 · 오른쪽 아래 짙게 · 리벳 넷. 반환 (밝기 배율, 줄눈 0..1, 리벳 0..1)
vec3 plate(vec2 q, float s, float aa) {
  vec2 f = fract(q);
  vec2 e2 = min(f, 1.0 - f) * s;
  float edge = min(e2.x, e2.y);
  float groove = 1.0 - smoothstep(0.03 - aa, 0.05 + aa, edge);
  float bev = 0.0;
  if (edge < 0.12) {
    // 줄눈 둘레의 비스듬한 면: 왼쪽 · 위 가장자리는 빛을 받고, 오른쪽 · 아래는 그늘
    float lit = (f.x < 0.5 && e2.x < 0.12) || (f.y < 0.5 && e2.y < 0.12) ? 1.0 : -1.0;
    bev = lit * (1.0 - smoothstep(0.05, 0.12, edge)) * (1.0 - groove);
  }
  vec2 r = abs(f - 0.5) * s - (s * 0.5 - 0.22);
  float rv = 1.0 - smoothstep(0.035, 0.06 + aa, length(r));
  return vec3(1.0 + bev * 0.22, groove, rv);
}
void main() {
  vec2 p = vXZ;
  float aa = max(fwidth(p.x), 0.004);
  ivec2 ci = cellOf(p);
  vec4 C = cellAt(ci);
  int reg = int(C.r + 0.5);
  vec2 cellC = uGrid.xy + (vec2(ci) + 0.5) * uGrid.z;
  vec2 fc = (p - cellC) / uGrid.z; // 칸 안 −0.5..0.5
  float ph = hash12(vec2(ci) + 17.0); // 판마다
  float rough = mix(${F.roughness[0].toFixed(2)}, ${F.roughness[1].toFixed(2)}, ph);
  vec3 N = vec3(0.0, 1.0, 0.0);
  vec3 col;
  vec3 emit = vec3(0.0);
  bool water = false;

  if (C.r < 0.0) {
    // 경기장 밖: 어두운 잉크 바다(느린 잔물결의 반짝임)
    float w = vnoise(p * 0.7 + vec2(uTime * 0.12, uTime * 0.05)) * 0.6 + vnoise(p * 2.1 - uTime * 0.2) * 0.4;
    col = SEA * (0.7 + 0.6 * w) + KEY * pow(w, 6.0) * 0.06;
    water = true;
  } else if (reg == ${REGION.river} || reg == ${REGION.bridge}) {
    // 잉크 강: 낮게 파인 수로의 어두운 광택 물 + 형광 거품 + 위쪽(먼 쪽) 수로 벽
    float w = vnoise(p * 0.9 + vec2(uTime * 0.25, uTime * 0.08)) * 0.6 + vnoise(p * 2.6 + vec2(-uTime * 0.3, uTime * 0.11)) * 0.4;
    col = WATER * (0.65 + 0.7 * w) + KEY * smoothstep(0.72, 0.9, w) * 0.1;
    // 둘레(물이 아닌 이웃 쪽)까지의 거리
    float dN = 9.0, dS = 9.0, dW = 9.0, dE = 9.0;
    vec4 nN = cellAt(ci + ivec2(0, -1)), nS = cellAt(ci + ivec2(0, 1)), nW = cellAt(ci + ivec2(-1, 0)), nE = cellAt(ci + ivec2(1, 0));
    bool wN = nN.r == ${REGION.river}.0 || nN.r == ${REGION.bridge}.0, wS = nS.r == ${REGION.river}.0 || nS.r == ${REGION.bridge}.0;
    bool wW = nW.r == ${REGION.river}.0 || nW.r == ${REGION.bridge}.0, wE = nE.r == ${REGION.river}.0 || nE.r == ${REGION.bridge}.0;
    if (!wN) dN = (fc.y + 0.5) * uGrid.z;
    if (!wS) dS = (0.5 - fc.y) * uGrid.z;
    if (!wW) dW = (fc.x + 0.5) * uGrid.z;
    if (!wE) dE = (0.5 - fc.x) * uGrid.z;
    float shore = min(min(dS, dW), dE);
    // 먼 쪽(위)의 수로 벽: 세운 철판이 보인다
    if (dN < 0.5) {
      vec3 pl = plate(vec2(p.x / 1.0, dN / 0.5), 1.0, aa);
      col = PLATE * 0.55 * pl.x * (1.0 - 0.6 * pl.y) * (0.6 + 0.8 * dN);
    } else {
      float foam = (1.0 - smoothstep(0.0, 0.18, min(shore, dN - 0.5))) * (0.55 + 0.45 * vnoise(p * 6.0 + uTime * 1.5));
      col = mix(col * (0.55 + 0.45 * smoothstep(0.0, 0.5, min(shore, dN - 0.5))), ${v3s(F.foam)}, foam * 0.8);
      emit += ${v3s(F.foam)} * foam * 0.35;
      water = true;
    }
    if (reg == ${REGION.bridge}) {
      // 철망 격자 판(그 아래로 물이 비친다) + 테두리 판
      vec2 g = fract(p / 0.32);
      float bar = 1.0 - smoothstep(0.08, 0.14, min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y)));
      vec3 metal = lightPlate(PLATE * 1.25, N, 0.35);
      col = mix(col, metal, bar * 0.95);
      vec2 e2 = (0.5 - abs(fc)) * uGrid.z;
      float frame = 1.0 - smoothstep(0.16, 0.2, min(wN && wS ? 9.0 : e2.y, wW && wE ? 9.0 : e2.x));
      col = mix(col, metal * 0.9, frame);
      water = false;
    }
  } else {
    // 철판 바닥(판 하나 = 1칸)
    vec3 base = PLATE * (0.94 + 0.12 * ph);
    vec3 pl = plate((p - uGrid.xy) / uGrid.z, uGrid.z, aa);
    if (reg == ${REGION.path}) base = PLATE_PATH * (0.96 + 0.08 * ph);
    if (reg == ${REGION.wall} || reg == ${REGION.block}) base *= 0.8;
    // 퀴즈 룸 광장: 원으로 깐 밝은 판(동심 고리 + 방사형 줄눈) + 네온 고리
    for (int k = 0; k < ${MAX_ROOMS}; k++) {
      vec4 R = uRoom[k];
      if (R.w < 0.5) continue;
      vec2 d = p - R.xy;
      float r = length(d);
      if (r < R.z + 0.6) {
        float ring = r / 1.25;
        float ang = atan(d.y, d.x);
        float nSeg = max(6.0, floor(6.2831853 * (floor(ring) + 0.5) * 1.25 / 1.7));
        vec2 pq = vec2(ang / 6.2831853 * nSeg, ring);
        vec3 pp = plate(pq, 1.25, aa);
        float inside = 1.0 - smoothstep(R.z - 0.02, R.z + 0.02, r);
        base = mix(base, PLATE_PLAZA * (0.95 + 0.1 * hash12(floor(pq) + 3.0)), inside);
        pl = mix(pl, pp, inside);
        float glow = exp(-pow((r - R.z - 0.1) / 0.06, 2.0));
        float halo = exp(-pow((r - R.z - 0.1) / 0.35, 2.0)) * 0.25;
        emit += uRoomCol[k] * (glow * 1.3 + halo * 0.6);
      }
    }
    // 홈: 팀 색으로 물든 판 + 경고 빗금 띠 + 팀 색 네온 테두리
    int hid = int(C.a + 0.5) - 1;
    if (hid >= 0 && hid < ${MAX_HOMES}) {
      vec4 HR = uHomeRect[hid];
      vec4 HC = uHomeCol[hid];
      vec3 tc = HC.a > 0.5 ? HC.rgb : vec3(0.0, 0.85, 1.0);
      base = mix(base, base * 0.55 + tc * 0.12, 0.85);
      float e = min(min(p.x - HR.x, HR.z - p.x), min(p.y - HR.y, HR.w - p.y));
      if (e < 0.55) {
        float stripe = step(0.5, fract((p.x + p.y) * 1.6));
        float band = smoothstep(0.12, 0.16, e) * (1.0 - smoothstep(0.5, 0.55, e));
        base = mix(base, mix(PLATE * 0.35, tc * 0.55, stripe), band);
        emit += tc * stripe * band * 0.25;
      }
      float line = exp(-pow((e - 0.06) / 0.035, 2.0));
      emit += tc * line * 1.5;
    }
    col = lightPlate(base * pl.x, N, rough);
    col *= 1.0 - 0.62 * pl.y;
    col += KEY * pl.z * 0.05 + base * pl.z * 0.6; // 리벳 머리(반들반들)
    // 점프 보드: 원본의 네온 고리
    if (reg == ${REGION.pad}) {
      float r = length(fc) * uGrid.z;
      float g1 = exp(-pow((r - 0.62) / 0.05, 2.0)), g2 = exp(-pow((r - 0.38) / 0.04, 2.0));
      vec3 pc = ${v3s(F.pad)};
      col = mix(col, col * 0.4, 1.0 - smoothstep(0.66, 0.72, r));
      emit += pc * (g1 * 1.8 + g2 * (0.9 + 0.6 * sin(uTime * 5.0)));
    }
    // 길: 판 가운데 유도등 점선(진행 방향으로 천천히 흐른다)
    if (C.g > 0.5 || C.b > 0.5) {
      float best = 0.0;
      for (int s = 0; s < 2; s++) {
        float code = s == 0 ? C.g : C.b;
        if (code < 0.5) continue;
        vec2 dv = dirV(code);
        // 들어온 쪽은 칸 가운데 뒤(-dv 쪽 반), 나가는 쪽은 앞(+dv 쪽 반)
        float along = dot(fc, dv) * (s == 0 ? -1.0 : 1.0);
        float across = abs(dot(fc, vec2(-dv.y, dv.x))) * uGrid.z;
        if (along < -0.02 || along > 0.5) continue;
        float phase = fract(dot(p, dv) * 0.9 - uTime * 0.45);
        float dash = smoothstep(0.0, 0.08, phase) * (1.0 - smoothstep(0.45, 0.55, phase));
        best = max(best, dash * (1.0 - smoothstep(0.035, 0.06, across)));
      }
      emit += GUIDE * best * ${F.guideGlow.toFixed(2)};
      col += GUIDE * best * 0.08;
    }
  }

  // [왕국전] 구운 그림자 · 접지 어둠(floorshade.js — 예전의 프레임마다 그림자 맵 패스 대신 텍스처 한 번 읽기). 모든 화질에서
  float shadowK = 1.0;
  if (uShadeOn > 0.5) {
    vec2 sh = texture(uShade, (p - uGrid.xy) / (uGrid.z * uGrid.w)).rg;
    shadowK = mix(1.0, ${F.shadow.toFixed(2)}, sh.r) * (1.0 - 0.3 * sh.g);
  }

  // 잉크: 매끈한 가장자리 + 오른쪽 아래 짙은 테 + 왼쪽 위 젖은 하이라이트 + 스스로 빛남(원본처럼 발광)
  vec2 inkUV = ((p - uInkInfo.zw) / uInkInfo.x + 1.0) * 0.5;
  vec4 inkS = texture(uInk, inkUV);
  float k0 = inkS.a;
  if (k0 > 0.04 && !water) {
    // 잉크의 수명(v14): 칠한 지 uInkLife.x 초 동안은 그대로, 그 뒤 uInkLife.y 초 동안 부드럽게 사라진다
    float code = floor(texture(uInkT, inkUV).r * 255.0 + 0.5);
    float age = mod(uInkNow - code + 256.0, 256.0) * ${(1 / INK_CODE_RATE).toFixed(4)};
    float life = 1.0 - smoothstep(uInkLife.x, uInkLife.x + uInkLife.y, age);
    float aa2 = max(fwidth(k0) * 0.8, 0.01);
    float body = smoothstep(0.17 - aa2, 0.17 + aa2, k0) * life;
    float inner = smoothstep(0.3, 0.85, k0);
    vec3 ink = inkS.rgb;
    vec3 hue = ink / max(max(ink.r, max(ink.g, ink.b)), 1e-4);
    vec3 ic = hue * (0.62 + 0.38 * inner);
    float kDR = smoothstep(0.17 - aa2, 0.17 + aa2, inkK(p + vec2(0.07, 0.07)));
    float kUL = smoothstep(0.3, 0.85, inkK(p - vec2(0.09, 0.09)));
    ic *= 1.0 - 0.55 * clamp(body - kDR, 0.0, 1.0);
    ic += (1.0 - ic) * 0.7 * clamp(inner - kUL, 0.0, 1.0) * uDetail;
    col = mix(col * shadowK, ic * shadowK, body);
    emit = mix(emit, hue * (0.3 + 0.3 * inner), body);
  } else col *= shadowK;
  col = shade(col, vec3(p.x, 0.0, p.y), vec3(0.0, 1.0, 0.0)) + emit;
  // 안개: 가 본 곳은 철판이 어둡게 · 네온만 희미하게
  vec2 fk = fogK(p + (vec2(vnoise(p * 0.45), vnoise(p * 0.45 + 7.1)) - 0.5) * ${(STYLE.fog.edge * 2).toFixed(3)});
  outColor = vec4(fogApply(col, fk), 1.0);
}`;

/**
 * @param {THREE.Texture} inkTexture  ink.js
 * @param {object} lightU             glsl.js lightUniforms
 * @param {object} fogU               glsl.js fogUniforms
 */
export function createTerrain(inkTexture, lightU, fogU, inkU = null) {
  inkTexture.colorSpace = THREE.SRGBColorSpace;
  inkTexture.minFilter = inkTexture.magFilter = THREE.LinearFilter;
  const dummy = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  dummy.needsUpdate = true;
  const U = {
    uCells: { value: dummy },
    uInk: { value: inkTexture },
    // 잉크 수명(renderer.js 가 ink.js 의 시각 텍스처 · 지금 부호를 넣는다 — 없으면 늘 그대로)
    uInkT: { value: dummy },
    uInkNow: { value: 0 },
    uInkLife: { value: new THREE.Vector2(1e6, 1) },
    ...(inkU || {}),
    uShade: { value: dummy },
    uShadeOn: { value: 0 },
    uGrid: { value: new THREE.Vector4(-28, -28, 2, 28) },
    uInkInfo: { value: new THREE.Vector4(28, 0, 0, 0) },
    uHomeRect: { value: Array.from({ length: MAX_HOMES }, () => new THREE.Vector4(1e4, 1e4, 1e4, 1e4)) },
    uHomeCol: { value: Array.from({ length: MAX_HOMES }, () => new THREE.Vector4()) },
    uRoom: { value: Array.from({ length: MAX_ROOMS }, () => new THREE.Vector4()) },
    uRoomCol: { value: Array.from({ length: MAX_ROOMS }, () => new THREE.Color(F.ring)) },
    uTime: { value: 0 },
    uDetail: { value: 1 },
    ...lightU,
    ...fogU,
  };
  const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: U, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;

  let cellsTex = null;
  let map = null;
  let homeHex = [];
  let A = null;
  const c3 = new THREE.Color();

  function paintHomes() {
    U.uHomeCol.value.forEach((v, i) => {
      const hex = homeHex[i];
      if (hex >= 0) {
        c3.setHex(hex);
        v.set(c3.r, c3.g, c3.b, 1);
      } else v.set(0, 0, 0, 0);
    });
  }

  return {
    mesh,
    uniforms: U,
    setArena(arena, G, inkRect = null) {
      A = arena;
      const ext = inkRect ? inkRect.e : (arena.inkExtent ?? 12) * (arena.scale || 1);
      U.uInkInfo.value.set(ext, 0, inkRect ? inkRect.cx : 0, inkRect ? inkRect.cz : 0);
      U.uRoom.value.forEach((v) => v.set(0, 0, 0, 0));
      U.uHomeRect.value.forEach((v) => v.set(1e4, 1e4, 1e4, 1e4));
      if (G) {
        const span = G.n * G.size;
        mesh.scale.set(span + 40, 1, span + 40);
        mesh.position.set(G.x0 + span / 2, 0, G.z0 + span / 2);
        U.uGrid.value.set(G.x0, G.z0, G.size, G.n);
        map = floorMap(G, arena);
        cellsTex && cellsTex.dispose();
        cellsTex = new THREE.DataTexture(map.data, G.n, G.n);
        cellsTex.minFilter = cellsTex.magFilter = THREE.NearestFilter;
        cellsTex.generateMipmaps = false;
        cellsTex.needsUpdate = true;
        U.uCells.value = cellsTex;
        (arena.quizRooms || []).slice(0, MAX_ROOMS).forEach((q, k) => U.uRoom.value[k].set(q.x, q.z, (q.r || arena.zoneR || 4.5) + 0.2, 1));
        for (const h of arena.homes || []) {
          if (!(h.c1 >= h.c0) || h.id >= MAX_HOMES) continue;
          U.uHomeRect.value[h.id].set(G.x0 + h.c0 * G.size, G.z0 + h.r0 * G.size, G.x0 + (h.c1 + 1) * G.size, G.z0 + (h.r1 + 1) * G.size);
        }
      } else {
        const R = arena.radius || 20;
        mesh.scale.set(R * 2 + 40, 1, R * 2 + 40);
        mesh.position.set(0, 0, 0);
        map = null;
        U.uCells.value = dummy;
        U.uGrid.value.set(-R, -R, 2, 0);
      }
      paintHomes();
    },
    get map() {
      return map;
    },
    /** 홈 번호 → 팀 색(0xRRGGBB, −1 = 모름) */
    setHomeColors(list) {
      homeHex = list || [];
      paintHomes();
    },
    /** 퀴즈 룸 광장 고리의 색(룸 번호 → 0xRRGGBB — 풀이 중이면 그 팀 색, 아니면 흰색) */
    setRoomColor(id, hex) {
      const c = U.uRoomCol.value[id];
      if (c) c.setHex(hex >= 0 ? hex : F.ring);
    },
    /** [왕국전] 구운 그림자 · 접지 어둠 텍스처(floorshade.js — RG, 바닥 칸 격자 전체). null 이면 끈다 */
    setShade(tex) {
      U.uShadeOn.value = tex ? 1 : 0;
      U.uShade.value = tex || dummy;
    },
    update(time, detail) {
      U.uTime.value = time;
      if (detail !== undefined) U.uDetail.value = detail;
    },
    get bytes() {
      return map ? map.n * map.n * 4 : 0;
    },
  };
}
