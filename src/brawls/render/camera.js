// 직교 카메라(docs/DESIGN.md §3.2 v6 · docs/CONTRACT.md §1). 시점은 하나로 고정이다(회전 · 확대가 경기 중에 바뀌지 않는다).
// 진짜 직교 투영이다 — 3D 메시(블록 · 바닥)와 층 이미지(캐릭터)가 같은 투영을 탄다.
//
//   YAW = 0°, 고도 = asin(SQUASH) ≈ 48.6°.  rx = x·cos(YAW) − z·sin(YAW),  rz = x·sin(YAW) + z·cos(YAW)   (0° 에서 rx = x, rz = z)
//   화면 가로 sx = rx − Cx            화면 세로 sy = rz·SQUASH − y·LIFT − Cy      (월드 단위 u, 화면 y 는 아래로. LIFT = cos(고도) ≈ 0.661)
//   카메라 쪽 깊이 d = rz·LIFT + y·SQUASH(클수록 앞)      바닥(높이 gy) 역변환: rz = (sy + Cy + gy·LIFT) / SQUASH, rx = sx + Cx
//   (sx, sy, d) 는 (rx, y, rz) 를 x 축으로 돌린 것이라(0.75² + 0.661² = 1) 길이 · 각이 보존되는 진짜 직교 카메라다.
//
// 확대: 화면 가로에 월드 VIEW_WIDTH(42u)가 들어오게 — 기기 픽셀/u = zoom = 기기 가로 / 42(1440px 화면에서 약 34, 세로 깊이 약 35u).
// 좁은 화면(CSS 가로 840px 아래)은 1u ≥ 20 CSS px 가 되게 가로를 줄이되 시야 지름(22u)보다 좁히지 않는다(viewWidthFor).
// 창 크기에 맞춰 연속으로 정한다(정수 배율이 아니다). VIEW_DEPTH(22u)는 옛 기준(전광판 배치 등이 아직 쓰는 값)이다.
// 스크롤 (Cx, Cy)(화면 단위 u)는 내 캐릭터를 부드럽게 따라가되 조준점 쪽으로 LOOK_AHEAD 만큼 앞서 보고, 경기장 끝에서 멈춘다.
// 마지막에 한 번만 기기 픽셀 단위로 반올림하고 그 값으로 투영 행렬 · 화면↔월드 변환을 모두 한다.
//
// three.js 를 불러오지 않는다(순수 계산 — Node 시험에서 바로 쓴다). renderer.js 가 matrix() 를 OrthographicCamera 의
// projectionMatrix 에 그대로 채운다(카메라 자체는 원점 · 회전 없음이라 viewMatrix 는 단위 행렬).

import { VIEW, FOG } from "../shared/constants.js";

/** 요(도). v5 부터 0° — 화면 위 = 월드 −z, 오른쪽 = +x. 식은 일반형이라 이 값만 바꾸면 된다 */
export const YAW = 0;
/** sin(고도) — 바닥 깊이가 화면에서 눌리는 비율(스킬의 squash 0.75) */
export const SQUASH = 0.75;
/** cos(고도) — 높이 1u 가 화면에서 올라가는 양 */
export const LIFT = Math.sqrt(1 - SQUASH * SQUASH);
/** 화면 세로에 들어오는 월드 깊이(u) */
export const VIEW_DEPTH = 22;
/** 개발용 ?zoom=<u>(브라우저에서만) — 주면 화면 크기와 상관없이 가로를 그 값으로 고정해 견줘 본다. 0 = 안 줌 */
const ZOOM_PARAM = (() => {
  const q = typeof location !== "undefined" ? Number(new URLSearchParams(location.search).get("zoom")) : 0;
  return q >= 8 && q <= 200 ? q : 0;
})();
/**
 * 화면 가로에 들어오는 월드 너비(u) — 확대 기준(docs/DESIGN.md §3.11 A "더 넓게 본다"): 1440px 화면에서 1u ≈ 34px, 세로 깊이 약 35u.
 * 넓은 화면은 화면 크기에 비례(가로 42u). 좁은 화면(휴대폰 세로)은 아래 MIN_CSS_PPU · MIN_VIEW_WIDTH 로 더 당겨 본다.
 */
export const VIEW_WIDTH = ZOOM_PARAM || 42;
/**
 * 좁은 화면에서 1u 가 이만큼(CSS px)보다 작아지지 않게 가로를 줄인다(사용자 지시 — 휴대폰에서 캐릭터가 너무 작다).
 * 가로 42u 를 그대로 넣으면 세로 휴대폰(약 390px)에서 1u ≈ 9px 라 캐릭터가 손톱만 해진다. 화면 가로 840px 이상은 그대로 42u.
 */
export const MIN_CSS_PPU = 20;
/** 그래도 가로는 이만큼(u)은 보인다 — 시야(안개 반지름 FOG.R)의 지름. 세로 휴대폰은 이 값이 된다(1u ≈ 18px, 예전의 약 1.9배) */
export const MIN_VIEW_WIDTH = 2 * FOG.R;
const LOOK_AHEAD = VIEW.LOOK_AHEAD ?? 2.2;
const FOLLOW = VIEW.FOLLOW ?? 9;
/** 렌더러가 실제로 쓰는 시점 상수 */
export const VIEW_USED = Object.freeze({ YAW, SQUASH, LIFT, VIEW_DEPTH, VIEW_WIDTH, MIN_CSS_PPU, MIN_VIEW_WIDTH, LOOK_AHEAD, FOLLOW });

/**
 * 이 화면(CSS 가로 cssW)에서 실제로 쓰는 화면 가로(u). want = 진행자 화면이 정한 가로(0 · null 이면 자동).
 * 자동이면 VIEW_WIDTH(42u)를 넘지 않고, 1u 가 MIN_CSS_PPU 보다 작아지지 않게 줄이되 MIN_VIEW_WIDTH 보다 좁히지 않는다.
 */
export function viewWidthFor(cssW, want = 0) {
  if (want > 0) return want;
  if (ZOOM_PARAM) return ZOOM_PARAM;
  return Math.min(VIEW_WIDTH, Math.max(MIN_VIEW_WIDTH, cssW / MIN_CSS_PPU));
}

const DEG = Math.PI / 180;
const COS = Math.cos(YAW * DEG);
const SIN = Math.sin(YAW * DEG);
const SQ = SQUASH;
const LF = LIFT;

/** 깊이(카메라 쪽 거리)가 NDC z 의 −1..1 에 들어가는 반폭(u). 화면에 보이는 깊이(약 ±12u)보다 넉넉하면 된다 */
export const DEPTH_RANGE = 100;

/**
 * 투영 상수(셰이더 · 애셋 쪽과 맞출 때 쓴다).
 * right = 화면 오른쪽의 월드 방향, down = 바닥에서 화면 아래(rz 가 커지는) 방향, view = 카메라 쪽(물체 → 카메라) 단위 벡터,
 * up = 화면 위쪽의 월드 방향(view 와 직각)
 */
export const PROJ = Object.freeze({
  yaw: YAW, cos: COS, sin: SIN, SQUASH: SQ, LIFT: LF,
  right: Object.freeze([COS, 0, -SIN]),
  down: Object.freeze([SIN, 0, COS]),
  view: Object.freeze([SIN * LF, SQ, COS * LF]),
  up: Object.freeze([-SIN * SQ, LF, -COS * SQ]),
});

/** 월드 (x, z) → 돌린 좌표 (rx, rz). */
export function toView(x, z, out = { rx: 0, rz: 0 }) {
  out.rx = x * COS - z * SIN;
  out.rz = x * SIN + z * COS;
  return out;
}

/** 돌린 좌표 (rx, rz) → 월드 (x, z). toView 의 역. */
export function fromView(rx, rz, out = { x: 0, z: 0 }) {
  out.x = rx * COS + rz * SIN;
  out.z = -rx * SIN + rz * COS;
  return out;
}

/** 월드 → 화면 단위(스크롤 전, 월드 원점이 0). sx · sy 는 u, depth = 카메라 쪽 깊이(클수록 앞). */
export function worldToView(x, y, z, out = { sx: 0, sy: 0, depth: 0 }) {
  const rx = x * COS - z * SIN;
  const rz = x * SIN + z * COS;
  out.sx = rx;
  out.sy = rz * SQ - y * LF;
  out.depth = rz * LF + y * SQ;
  return out;
}
/** 옛 이름(M0 ~ v5). 단위가 아트 픽셀이 아니라 u 로 바뀌었다 */
export const worldToArt = worldToView;

/**
 * 화면 기준 방향(dx = 화면 오른쪽 +, dy = 화면 아래 +) → 월드 방향 (x, z). 길이는 그대로 둔다(정규화는 부르는 쪽).
 *  - ground = false(키보드): 돌리기만 한다. YAW 0° 에서 W(0, −1) → 월드 −z, D → +x.
 *  - ground = true(터치 스틱): 바닥이 SQUASH 로 눌린 것까지 되돌린다 — 화면에서 손가락이 가리킨 쪽으로 정확히 간다.
 */
export function screenDirToWorld(dx, dy, out = { x: 0, z: 0 }, ground = false) {
  const rz = ground ? dy / SQ : dy;
  out.x = dx * COS + rz * SIN;
  out.z = -dx * SIN + rz * COS;
  if (ground) {
    const l0 = Math.hypot(dx, dy);
    const l1 = Math.hypot(out.x, out.z);
    if (l1 > 1e-9) {
      out.x *= l0 / l1;
      out.z *= l0 / l1;
    }
  }
  return out;
}

/** 조준각(라디안) → 방향 칸 번호 0..n−1(칸 d 의 가운데 = d·360°/n). v6 의 렌더러는 쓰지 않는다(회전이 연속) — 시험 · 도구용 */
export function dirOf(aim, n = 16) {
  const k = Math.round(aim / ((Math.PI * 2) / n));
  return ((k % n) + n) % n;
}

/**
 * 카메라 하나. 상태는 모두 화면 단위(u, 월드 원점 기준)이고, 그린 스크롤(drawX/drawY)은 기기 픽셀 단위로 반올림한 값이다.
 */
export function createCamera() {
  const cam = {
    cssW: 1, cssH: 1, dpr: 1, devW: 1, devH: 1,
    zoom: 1, // 기기 픽셀 / u
    viewWidth: VIEW_WIDTH, // 지금 화면 가로에 들어오는 u(viewWidthFor — 좁은 화면은 42u 보다 좁다)
    wantWidth: 0, // 진행자 화면이 정한 가로(u). 0 = 자동(화면 크기로 정한다)
    artW: 1, artH: 1, // 화면 크기(u) — 옛 이름 그대로
    cx: 0, cy: 0, // 매끄럽게 따라가는 스크롤 중심(u)
    drawX: 0, drawY: 0, // 이번 프레임에 그린 스크롤 중심(픽셀 아트 월드면 타깃 화소 격자에 붙임)
    viewX: 0, viewY: 0, // 화면에 보이는 스크롤 중심(기기 픽셀로 반올림 — 화면↔월드 변환)
    tx: 0, ty: 0,
    hasTarget: false,
    snap: true,
    shake: 0,
    shakeScale: 1,
    kick: 0,
    bounds: { minRx: -12, maxRx: 12, minRz: -12, maxRz: 12, extraTop: 0 }, // 보여 줄 경기장 범위(돌린 좌표 u) · 위쪽 여유(화면 u)
    insetTop: 0, // 화면 위쪽을 덮는 HUD 높이(CSS px — 세로 터치 화면의 시계 · 팀 막대 · 미니맵). 그만큼 경기장 위 끝 너머로 더 올라간다
    time: 0,
    ppu: 0, // 픽셀 아트 월드(style.js world.pixel): 1u = ppu 화소의 저해상도 타깃 — 0 이면 끔
    zi: 1, // 그때의 정수 확대 배율(기기 px / 타깃 화소)
  };

  /** 화면 크기(CSS px)와 기기 화소비. zoom(기기 px/u)과 화면 크기(u)를 다시 정한다. */
  cam.resize = (cssW, cssH, dpr) => {
    cam.cssW = Math.max(1, cssW);
    cam.cssH = Math.max(1, cssH);
    cam.dpr = dpr > 0 ? dpr : 1;
    cam.devW = Math.max(1, Math.floor(cam.cssW * cam.dpr));
    cam.devH = Math.max(1, Math.floor(cam.cssH * cam.dpr));
    // 넓은 화면은 가로에 VIEW_WIDTH(42u) — 화면 크기에 비례. 좁은 화면(휴대폰 세로)은 더 당겨 본다(viewWidthFor)
    cam.viewWidth = viewWidthFor(cam.cssW, cam.wantWidth);
    cam.zoom = cam.devW / cam.viewWidth;
    if (cam.ppu > 0) {
      // 픽셀 아트 월드: 기기 px / u 를 ppu 의 정수배로(타깃 한 화소 = 기기 zi × zi 화소)
      cam.zi = Math.max(1, Math.round(cam.zoom / cam.ppu));
      cam.zoom = cam.zi * cam.ppu;
    } else cam.zi = 1;
    cam.artW = cam.devW / cam.zoom;
    cam.artH = cam.devH / cam.zoom;
  };

  /**
   * 경기장 범위: 반지름 radius 인 원(또는 반변 radius 인 정사각형)을 덮는 돌린 좌표 범위. 스크롤이 이 밖으로 나가지 않는다.
   * extraTop = 위쪽으로 더 보여 줄 것(화면 u — 경기장 위 끝 너머로 선 전광판).
   */
  cam.setBounds = (radius, square = false, extraTop = 0) => {
    const r = square ? radius * (Math.abs(COS) + Math.abs(SIN)) : radius;
    cam.bounds.minRx = -r;
    cam.bounds.maxRx = r;
    cam.bounds.minRz = -r;
    cam.bounds.maxRz = r;
    cam.bounds.extraTop = Math.max(0, extraTop || 0);
    cam.snap = true;
  };

  /**
   * 경기장 범위를 월드 사각형으로(던전 — 보이는 레인만 · v16). 돌린 좌표의 네 모서리를 감싼다. extraTop 은 setBounds 와 같다.
   */
  cam.setRect = (x0, z0, x1, z1, extraTop = 0) => {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const x of [x0, x1]) for (const z of [z0, z1]) {
      const rx = x * COS - z * SIN, rz = x * SIN + z * COS;
      a0 = Math.min(a0, rx); a1 = Math.max(a1, rx); b0 = Math.min(b0, rz); b1 = Math.max(b1, rz);
    }
    cam.bounds.minRx = a0;
    cam.bounds.maxRx = a1;
    cam.bounds.minRz = b0;
    cam.bounds.maxRz = b1;
    cam.bounds.extraTop = Math.max(0, extraTop || 0);
    cam.snap = true;
  };

  cam.extendTop = (u) => {
    cam.bounds.extraTop = Math.max(cam.bounds.extraTop || 0, u || 0);
  };

  /** 따라갈 곳: (x, z) 를 화면 가운데에 두되 조준점 (ax, az) 쪽으로 LOOK_AHEAD 까지 앞서 본다. */
  cam.follow = (x, z, ax = x, az = z) => {
    let dx = ax - x;
    let dz = az - z;
    const d = Math.hypot(dx, dz);
    const look = Math.min(LOOK_AHEAD, d * 0.25);
    if (d > 1e-6) {
      dx = (dx / d) * look;
      dz = (dz / d) * look;
    } else {
      dx = dz = 0;
    }
    const rx = (x + dx) * COS - (z + dz) * SIN;
    const rz = (x + dx) * SIN + (z + dz) * COS;
    cam.tx = rx;
    cam.ty = rz * SQ;
    cam.hasTarget = true;
  };

  /** 따라갈 목표를 화면 단위(u)만큼 옮긴다(follow 뒤에 — 룸 근처에서 화면 위쪽으로 치우치기). 시점은 바뀌지 않는다 */
  cam.nudge = (dx, dy) => {
    cam.tx += dx;
    cam.ty += dy;
  };

  cam.center = () => {
    cam.tx = 0;
    cam.ty = 0;
    cam.hasTarget = false;
  };

  /** 진행자 화면: 화면 가로에 들어올 월드 너비(u). 0 · null 이면 자동(viewWidthFor — 넓은 화면 42u). 시점은 그대로, 확대만 바뀐다 */
  cam.setViewWidth = (u) => {
    const w = u > 0 ? u : 0;
    if (Math.abs(w - cam.wantWidth) < 1e-4) return;
    cam.wantWidth = w;
    cam.resize(cam.cssW, cam.cssH, cam.dpr);
  };

  /**
   * 바닥 사각형(월드 x0..x1 × z0..z1)이 여유 pad(u)와 함께 다 들어오는 화면 가로(u). reserveTop = 화면 위쪽을 덮는 띠의 비율(0..0.5)
   */
  cam.widthFor = (x0, z0, x1, z1, pad = 0, reserveTop = 0) => {
    let rx0 = Infinity, rx1 = -Infinity, rz0 = Infinity, rz1 = -Infinity;
    for (const x of [x0, x1]) for (const z of [z0, z1]) {
      const rx = x * COS - z * SIN;
      const rz = x * SIN + z * COS;
      rx0 = Math.min(rx0, rx); rx1 = Math.max(rx1, rx);
      rz0 = Math.min(rz0, rz); rz1 = Math.max(rz1, rz);
    }
    const w = rx1 - rx0 + pad * 2;
    const h = ((rz1 - rz0) + pad * 2) * SQ + 2 * LF; // 화면 세로(u) — 서 있는 것들의 키만큼 더
    return Math.max(w, (h / (1 - Math.min(0.5, Math.max(0, reserveTop)))) * (cam.devW / cam.devH));
  };

  /** 경기장 전체(setBounds 범위 + 위쪽 여유)가 들어오는 화면 가로(u) */
  cam.fitWidth = (reserveTop = 0) => {
    const b = cam.bounds;
    const m = 1.5;
    const w = b.maxRx - b.minRx + 2 * m;
    const h = (b.maxRz - b.minRz) * SQ + 2 * LF + (b.extraTop || 0) + m * SQ;
    return Math.max(w, (h / (1 - Math.min(0.5, Math.max(0, reserveTop)))) * (cam.devW / cam.devH)) * 1.01;
  };

  /** 스크롤 중심을 경기장 범위 안으로. 화면이 경기장보다 넓으면 그 축은 가운데에 고정한다. */
  function clampCenter(x, y) {
    const b = cam.bounds;
    const halfW = cam.artW / 2;
    const halfH = cam.artH / 2;
    const margin = 1.5;
    const minX = b.minRx - margin + halfW;
    const maxX = b.maxRx + margin - halfW;
    // 위쪽은 서 있는 것들(블록 · 벽)의 키만큼 더 보여 준다. 화면 위를 HUD 가 덮으면(insetTop) 그만큼 더 올라가
    // 경기장 위 끝(출발 자리)에 선 캐릭터가 HUD 밑에 깔리지 않고 그 아래에 보인다
    const inset = cam.insetTop > 0 ? (cam.insetTop * cam.dpr) / cam.zoom : 0;
    const minY = b.minRz * SQ - 2 * LF - (b.extraTop || 0) - inset + halfH;
    const maxY = b.maxRz * SQ + margin * SQ - halfH;
    const cx = minX > maxX ? (minX + maxX) / 2 : Math.min(maxX, Math.max(minX, x));
    const cy = minY > maxY ? (minY + maxY) / 2 : Math.min(maxY, Math.max(minY, y));
    return [cx, cy];
  }

  /** 한 프레임: 따라가기 · 경계 · 흔들림, 그리고 마지막에 한 번만 반올림. */
  cam.update = (dt) => {
    cam.time += dt;
    const [gx, gy] = clampCenter(cam.tx, cam.ty);
    if (cam.snap) {
      cam.cx = gx;
      cam.cy = gy;
      cam.snap = false;
    } else {
      const k = 1 - Math.exp(-FOLLOW * Math.min(dt, 0.1));
      cam.cx += (gx - cam.cx) * k;
      cam.cy += (gy - cam.cy) * k;
    }
    cam.shake = Math.max(0, cam.shake - dt * 1.8);
    cam.kick = Math.max(0, cam.kick - dt * 5);
    const amp = Math.min(1.2, cam.shake) ** 2 * 0.42 * cam.shakeScale; // u
    const t = cam.time * 60;
    const ox = amp * (Math.sin(t * 1.7) * 0.6 + Math.sin(t * 3.1 + 1.3) * 0.4);
    const oy = amp * (Math.cos(t * 2.3) * 0.6 + Math.sin(t * 2.9 + 0.4) * 0.4) - cam.kick * 0.18 * cam.shakeScale;
    // 보이는 중심(viewX/Y)은 기기 픽셀로 반올림 — 화면↔월드 변환이 이것을 쓴다.
    // 그리는 중심(drawX/Y)은 픽셀 아트 월드면 타깃 화소(1/ppu u) 격자에 붙인다(도트 일렁임 방지 — DESIGN §3.2). 남는 소수
    // (viewX − drawX)는 확대 단계에서 화면을 그만큼 민다(renderer → post). 매끈한 월드면 둘이 같다.
    const zd = cam.zoom;
    cam.viewX = Math.round((cam.cx + ox) * zd) / zd;
    cam.viewY = Math.round((cam.cy + oy) * zd) / zd;
    if (cam.ppu > 0) {
      cam.drawX = Math.round(cam.viewX * cam.ppu) / cam.ppu;
      cam.drawY = Math.round(cam.viewY * cam.ppu) / cam.ppu;
    } else {
      cam.drawX = cam.viewX;
      cam.drawY = cam.viewY;
    }
  };

  // 화면 흔들림 · 반동은 없앴다(사용자 지시 — 화면 전체가 떨리는 연출은 하지 않는다). 부르는 곳이 많아 이름만 남겨 둔다
  cam.addShake = () => {};
  cam.addKick = () => {};

  /** 화면 가운데의 바닥 깊이(카메라 쪽) — 깊이 기준점 */
  const centerDepth = () => (cam.drawY / SQ) * LF;

  /**
   * 투영 행렬(열 우선 16개 — three.js Matrix4.elements 순서). 월드 (x, y, z, 1) → 클립(NDC).
   * NDC z = −(d − d0) / DEPTH_RANGE — 앞(d 가 큰 것)일수록 작다(three 의 기본 깊이 비교에서 앞이 이긴다).
   */
  cam.matrix = (e = new Array(16)) => {
    const A = 2 / cam.artW;
    const B = 2 / cam.artH;
    const Cx = cam.drawX;
    const Cy = cam.drawY;
    const D = DEPTH_RANGE;
    const d0 = centerDepth();
    // 행 0: ndc_x = A·(x·cos − z·sin − Cx)
    e[0] = A * COS; e[4] = 0; e[8] = -A * SIN; e[12] = -A * Cx;
    // 행 1: ndc_y = −B·(SQ·(x·sin + z·cos) − LF·y − Cy)
    e[1] = -B * SQ * SIN; e[5] = B * LF; e[9] = -B * SQ * COS; e[13] = B * Cy;
    // 행 2: ndc_z = −(LF·(x·sin + z·cos) + SQ·y − d0) / D
    e[2] = -(LF * SIN) / D; e[6] = -SQ / D; e[10] = -(LF * COS) / D; e[14] = d0 / D;
    e[3] = 0; e[7] = 0; e[11] = 0; e[15] = 1;
    return e;
  };

  /** NDC z → 카메라 쪽 깊이 d(셰이더 · 시험용) */
  cam.depthOfNdc = (nz) => centerDepth() - nz * DEPTH_RANGE;
  /** 깊이 기준점(셰이더 유니폼용) */
  cam.centerDepth = centerDepth;

  /** 월드 → 화면(CSS px, 캔버스 왼쪽 위 기준). visible: 화면 안(여유 40px)인가. */
  cam.worldToScreen = (x, y, z, out = { x: 0, y: 0, visible: false }) => {
    const rx = x * COS - z * SIN;
    const rz = x * SIN + z * COS;
    const ax = rx - cam.viewX;
    const ay = rz * SQ - y * LF - cam.viewY;
    out.x = (ax * cam.zoom + cam.devW / 2) / cam.dpr;
    out.y = (ay * cam.zoom + cam.devH / 2) / cam.dpr;
    out.visible = out.x > -40 && out.y > -40 && out.x < cam.cssW + 40 && out.y < cam.cssH + 40;
    return out;
  };

  /** 화면(CSS px) → 높이 gy(기본 0)인 바닥 위의 월드 (x, z). 조준은 레이캐스트 없이 이 역변환 한 번이다. */
  cam.screenToGround = (px, py, out = { x: 0, z: 0 }, gy = 0) => {
    const ax = (px * cam.dpr - cam.devW / 2) / cam.zoom;
    const ay = (py * cam.dpr - cam.devH / 2) / cam.zoom;
    const rx = ax + cam.viewX;
    const rz = (ay + cam.viewY + gy * LF) / SQ;
    out.x = rx * COS + rz * SIN;
    out.z = -rx * SIN + rz * COS;
    return out;
  };

  /** 지금 화면이 덮는 바닥(높이 0)의 월드 사각형 — 화면 밖 버리기 · 그림자 맵 범위. pad = 여유(u) */
  cam.groundRect = (pad = 0, out = { x0: 0, z0: 0, x1: 0, z1: 0 }) => {
    const hx = cam.artW / 2;
    const hy = cam.artH / 2;
    const rz0 = (cam.viewY - hy) / SQ;
    const rz1 = (cam.viewY + hy + 3 * LF) / SQ; // 화면 아래 끝 너머 블록 높이만큼
    const xs = [];
    const zs = [];
    for (const rx of [cam.viewX - hx, cam.viewX + hx]) for (const rz of [rz0, rz1]) {
      xs.push(rx * COS + rz * SIN);
      zs.push(-rx * SIN + rz * COS);
    }
    out.x0 = Math.min(...xs) - pad;
    out.x1 = Math.max(...xs) + pad;
    out.z0 = Math.min(...zs) - pad;
    out.z1 = Math.max(...zs) + pad;
    return out;
  };

  return cam;
}
