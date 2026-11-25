// 렌더러(docs/DESIGN.md §3 · §3.0 v8 · docs/CONTRACT.md §4): 직교 카메라로 기기 해상도(화질 저 0.75배)에 그린다 —
// 격자가 보이지 않는 지형 섞기 바닥 + 세운 2D 장애물 그림 + 실시간 층 이미지 스택(48px/u · 약 72층) + 입체 잉크 폭발 + 전장의 안개,
// 그리고 글자 층과 후처리(틸트 시프트 → 블룸 → 색 보정).
// main.js 와의 경계(함수 이름 · 인자)는 M0 그대로다. 덧붙인 것: blockChanged · setHomeColors · say · fx.play · fx.burst 의 kind ·
// setVision · setFog · fog · drawGadget · drawVortex · actor.appear.
//
// 한 프레임(main.js):  R.beginFrame(time, dt) → R.setVision(game.vision()) → R.follow | R.center → R.drawPlayer / drawBalloon / drawItem /
//                      drawBombMark / drawAim / drawGadget / drawQuizRoom … → R.render()
// render(): 카메라 → 화면 안의 장애물 그림 · 장식 → 효과 · 유령 층 → 점광 고르기 →
//           [장면 타깃] 바닥(−10) · 누운 그림(−9) · 바닥 효과(−8) · 세운 그림(2) · 전광판 판(3) · 층(5) · 층 외곽선(6) · 구 · 고리(8) ·
//           구 외곽선(9) · 공중 효과(20) · 가려진 캐릭터 실루엣(40) → [화면] 확대(선형) + 후처리 → 글자 층(카드 · 딱지 · 말풍선 · 이름표).
import * as THREE from "three";
import { arenaAt, TILE } from "../shared/arena.js";
import { DEFAULT_MAP, DEFAULT_MODE, PALETTE, PLAYER } from "../shared/constants.js";
import { createCamera, screenDirToWorld, PROJ } from "./camera.js";
import { createInk, INK_LIFE } from "./ink.js";
import { createWorld } from "./world.js";
import { createDecals, MODE, SHAPE } from "./sprites.js";
import { createStackBatch } from "./stacks.js";
import { createSpheres } from "./spheres.js";
import { createCharacters, drawStack } from "./characters.js";
import { drawBalloon, drawAim, drawBombMark } from "./projectiles.js";
import { drawItem } from "./items.js";
import { createEffects } from "./effects.js";
import { createLights } from "./lights.js";
import { lightUniforms, fogUniforms } from "./glsl.js";
import { createFog } from "./fog.js";
import { createPost } from "./post.js";
import { createHD, MODE_HD, FONT_POSTER, roundRect, wrapText } from "./hd.js";
import { createQuizBoard } from "./quizboard.js";
import { createMonsters } from "./monsters.js";
import { createDrones } from "./drones.js";
import { gridOf, cellCenter, isBlock, CELL } from "./grid.js";
import { loadStacks, poseFrames, frameAt } from "./stackatlas.js";
import { createGpuTimer } from "./gpu.js";
import { STYLE } from "./style.js";
import { cssOf, darkHex, mixHex } from "./palette.js";
import { createPortraits, CHARACTERS } from "./portraits.js";
import { activeProps } from "./props3d.js";

/**
 * 화질 단계(docs/DESIGN.md §3.5 · §3.0 v8): 장면 해상도 배율 · 후처리 · 점광 · 층 건너뛰기(고 전부 · 중 한 층 건너 · 저 셋 중 하나) · 입자 · 장식 · 0.5배 그림.
 * [왕국전] 높음 · 보통 · 낮음(설정 "자동"은 기기로 고른다 — 휴대폰 · 코어 4개 이하 = 보통, 그 밖 = 높음):
 *   maxDpr  기기 픽셀 비율 상한(보통 1 — 레티나 · 휴대폰에서 화소 수를 크게 줄인다. 글자 층 · HUD 는 기기 해상도 그대로)
 *   hdr     장면 타깃 반정밀 실수(블룸이 1 넘는 빛을 읽는다) · post = 블룸 + 틸트(¼ 해상도 — post.js) · fxaa = 합성에서 가벼운 FXAA
 *   grade   색 보정 세기(STYLE.post.grade 배) · vig = 비네트(블룸 없이도)
 *   drsMin  동적 해상도의 바닥(프레임이 느리면 장면 타깃을 이만큼까지 줄인다)
 */
const LEVELS = {
  low: { maxDpr: 1, scale: STYLE.world.scale.low, hdr: false, post: false, fxaa: false, vig: 1, points: 0, step: 3, stackOutline: true, grade: 0.6, distort: false, parts: 1 / 3, decor: false, half: true, detail: "low", ink: 512, drsMin: 0.6 },
  mid: { maxDpr: 1, scale: STYLE.world.scale.mid, hdr: true, post: true, fxaa: false, vig: 1, points: 4, step: 2, stackOutline: true, grade: 0.7, distort: false, parts: 1, decor: true, half: false, detail: "mid", ink: 1024, drsMin: 0.6 },
  // distort(충격파 화면 일그러짐)는 끈다 — 화면이 출렁여 보인다(사용자 지시: 화면 흔들림 제거)
  high: { maxDpr: 2, scale: STYLE.world.scale.high, hdr: true, post: true, fxaa: true, vig: 1, points: 8, step: 1, stackOutline: true, grade: 1, distort: false, parts: 1, decor: true, half: false, detail: "high", ink: 1024, drsMin: 0.7 },
};
/** [왕국전] 화면 가로(u)가 이보다 넓으면(멀리 볼 때) 나무 · 건물을 가벼운 모델로 — 사이에서는 지금 것을 둔다(깜빡이지 않게) */
const LOD_FAR = 62, LOD_NEAR = 56;
const SAY_TIME = 4;

const hexOf = (i) => (i >= 0 && i < PALETTE.length ? PALETTE[i].hex : 0xffffff);

export function createRenderer(canvas) {
  THREE.ColorManagement.enabled = true;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, depth: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = false;
  const gl = renderer.getContext();
  const params = new URLSearchParams(location.search);
  /** 캐릭터를 그리는 크기 배율(판정 크기는 그대로 — 장애물 그림에 비해 작아 보이지 않게). ?charscale= 로 견줘 본다 */
  const CHAR_SCALE = Number(params.get("charscale")) || 1.2;
  // 말풍선 기준점(발에서, u): 3D 인형(키 1.73u) 머리 위 이름표(main.js HEAD 1.85 + 0.35) 위로 한 줄
  const SAY_Y = 3.6;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 160);
  const cam = createCamera();
  cam.ppu = STYLE.world.ppu;

  const lightU = lightUniforms(THREE);
  const fogU = fogUniforms(THREE);
  const lights = createLights(lightU);
  const fog = createFog(THREE, fogU);
  const ink = createInk(renderer, { size: 1024 });
  // 바닥 잉크의 수명(v14): 칠한 시각 텍스처 · 지금 부호 · 그대로 / 사라지는 시간 — 바닥 셰이더가 나이를 구해 흐리게 지운다
  const inkU = { uInkT: { value: ink.timeTexture }, uInkNow: { value: 0 }, uInkLife: { value: new THREE.Vector2(INK_LIFE.HOLD, INK_LIFE.FADE) } };
  const world = createWorld(ink.texture, lightU, fogU, inkU);
  const decals = createDecals({ max: 1400 });
  const stacks = createStackBatch(lightU, fogU);
  const spheres = createSpheres(lightU);
  scene.add(...world.meshes, stacks.mesh, stacks.outlineMesh, ...spheres.meshes, ...decals.meshes, stacks.xrayMesh);
  // 던전 몬스터(3D — monsters.js): 본 그림 5 · 외곽선 6(캐릭터와 같이) · 발밑 −8 · 체력 막대 21
  const monsters = createMonsters(lightU, fogU);
  scene.add(monsters.group);
  // 던전 드론(v16 — drones.js)
  const drones = createDrones();
  scene.add(drones.group);

  const post = createPost(renderer);
  const hd = createHD(renderer, post);
  let arena = null;
  let G = null;
  const chars = createCharacters();
  const L0 = () => LEVELS[level];
  const fx = createEffects(ink, () => (arena ? arena.isOnPlatform : () => true), lights, {
    jolt: (x, z, r, power, wave) => world.jolt(x, z, r, power, wave),
    shake: (v) => cam.addShake(v),
    splashChars: (x, z, r, color) => chars.splash(x, z, r, color, frameTime),
    quality: () => ({ parts: L0().parts, lights: L0().points > 0, distort: L0().distort }),
    visible: (x, z) => fog.visible(x, z, 1.5),
  });
  const quiz = createQuizBoard({ hd, fx, addShake: (v) => cam.addShake(v), lights });

  // ------------------------------------------------------------------ 아틀라스(층 · 맵 그림)
  let art = null;
  let artInfo = { source: "none", bytes: 0 };
  const base = params.get("atlas") || `${import.meta.env?.BASE_URL ?? "/"}atlas/`;
  let loadedHalf = null;
  let loadToken = 0;
  function loadArt(half) {
    if (loadedHalf === half) return;
    loadedHalf = half;
    const token = ++loadToken;
    loadStacks(THREE, base, { half }).then((r) => {
      if (token !== loadToken) return;
      art = r.atlas;
      artInfo = { source: r.source + (r.half ? "@0.5" : ""), bytes: r.bytes, warnings: r.warnings };
      stacks.setSheets(r.textures, art.filter === "linear");
      stacks.setRamps(art.keyRamp, art.teamRamps);
      quiz.setArt(art);
      world.setMapArt(r);
      if (r.warnings.length) console.warn("[stacks]", r.warnings.join(" · "));
    });
  }
  const hdTags = params.has("hdtags");

  // ------------------------------------------------------------------ 화질 · 크기
  const isMobile = (navigator.maxTouchPoints ?? 0) > 1 || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || "");
  const cores = navigator.hardwareConcurrency || 0;
  // [왕국전] 자동: 휴대폰 · 코어 4개 이하 = 보통(예전 저), 그 밖 = 높음(예전 중) — 그다음은 동적 해상도가 맞춘다
  // [왕국전] 첫 화면에서 기기를 재 추천한 단계가 있으면 그것으로 시작한다(setAutoLevel — src/render/qualityadvisor.js)
  let autoLevel = isMobile || (cores > 0 && cores <= 4) ? "mid" : "high";
  let probeSaved = null; // 재는 동안(probe) 원래 동적 해상도
  let requested = "auto";
  let level = autoLevel;
  const gpu = createGpuTimer(gl);
  let rtW = 1;
  let rtH = 1;
  let zi = 1; // 기기 px / 장면 타깃 화소
  // [왕국전] 동적 해상도: 잰 프레임 시간(GPU 타이머가 있으면 그것)이 목표를 넘으면 장면 타깃을 줄이고, 넉넉하면 되돌린다.
  //   목표 = 60fps(화면이 더 느리게 고정돼 있으면 그 간격). JS 가 프레임을 다 먹는 중(CPU 가 막힘)이면 해상도를 줄여도 소용없어 그대로 둔다.
  //   자동 화질이면 바닥(drsMin)까지 줄여도 느릴 때 한 단계 내린다(높음 → 보통 → 낮음). ?drs=0 이면 끈다(벤치마크).
  const drs = {
    on: params.get("drs") !== "0",
    scale: 1,
    ema: 16.7, cpu: 4, refresh: 16.7, acc: 0, over: 0, under: 0, slowAtMin: 0, warm: 0,
    before: 0, check: 0, // 줄인 뒤 정말 빨라졌나 2초 뒤에 본다(아니면 화면이 느리게 고정됐거나 CPU 가 막힌 것 — 되돌리고 그 간격을 목표로)
  };
  const drsStart = () => (requested === "auto" && isMobile ? 0.85 : 1);
  drs.scale = drsStart();

  // 캔버스 크기는 CSS 가 정한다(보통 화면 전체 — 세로 터치 화면에서는 아래 조작부 칸을 뺀 위쪽, src/style.css .t-split #game).
  // 그래서 창 크기가 아니라 캔버스가 놓인 크기를 재고, 캔버스 크기가 바뀔 때마다(조작부 칸이 생기거나 사라질 때도) 다시 맞춘다.
  // 캔버스의 왼쪽 위는 언제나 화면의 왼쪽 위 — 화면 좌표(clientX · Y)와 캔버스 좌표가 같다(조준 · 이름표 · 화살표가 그대로 맞는다).
  function applySize() {
    const L = LEVELS[level];
    const w = canvas.clientWidth || window.innerWidth || 1;
    const h = canvas.clientHeight || window.innerHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, L.maxDpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    cam.resize(w, h, dpr);
    // 장면 타깃: 기기 해상도 × 배율(화질 저 0.75) × [왕국전] 동적 해상도 — 선형으로 늘려 붙인다
    const k = L.scale * drs.scale;
    rtW = Math.max(1, Math.round(cam.devW * k));
    rtH = Math.max(1, Math.round(cam.devH * k));
    zi = cam.devW / rtW;
    post.setSize(rtW, rtH, L.hdr, STYLE.world.filter === "nearest", 4);
  }
  window.addEventListener("resize", applySize);
  if (typeof ResizeObserver === "function") {
    let lastW = 0;
    let lastH = 0;
    new ResizeObserver(() => {
      if (canvas.clientWidth === lastW && canvas.clientHeight === lastH) return;
      lastW = canvas.clientWidth;
      lastH = canvas.clientHeight;
      applySize();
    }).observe(canvas);
  }

  function applyLevel() {
    const L = LEVELS[level];
    stacks.setOutline(L.stackOutline);
    spheres.setDetail(L.detail);
    world.setDetail(L.decor);
    ink.setSize(L.ink); // 바닥 잉크 캔버스: 저 512²(1MB) · 중 · 고 1024²(4MB)
    drs.over = drs.under = drs.slowAtMin = 0;
    drs.warm = 30; // 막 바뀐 뒤 몇 프레임은 믿지 않는다(셰이더 준비 · 버퍼 할당)
    applySize();
    loadArt(L.half);
  }

  function setQuality(q) {
    requested = q === "low" || q === "mid" || q === "high" ? q : "auto";
    level = requested === "auto" ? autoLevel : requested;
    drs.scale = drsStart();
    applyLevel();
    return level;
  }

  // [왕국전] 동적 해상도 판단(0.5초마다). ivl = 이번 프레임 간격(ms), cpu = 이번 프레임 JS(ms)
  function feedDrs(ivl, cpu) {
    if (!drs.on || document.hidden) return;
    if (drs.warm > 0) {
      drs.warm--;
      return;
    }
    if (!(ivl > 0) || ivl > 250) return; // 탭 전환 · 멈춤
    drs.ema += (ivl - drs.ema) * 0.08;
    drs.cpu += (cpu - drs.cpu) * 0.08;
    // 화면 새로 고침 간격(가장 짧은 간격 — 천천히 잊는다)
    drs.refresh = ivl < drs.refresh ? ivl : drs.refresh + (ivl - drs.refresh) * 0.0005;
    drs.acc += ivl / 1000;
    if (drs.acc < 0.5) return;
    const dt = drs.acc;
    drs.acc = 0;
    const L = LEVELS[level];
    if (drs.check > 0) {
      drs.check -= dt;
      if (drs.check <= 0 && drs.ema > drs.before * 0.95) {
        // 해상도를 줄여도 빨라지지 않았다: GPU 가 병목이 아니다 → 되돌리고, 지금 간격을 이 기기의 목표로 삼는다
        drs.refresh = Math.max(drs.refresh, drs.ema / 1.04);
        drs.scale = Math.min(1, Math.round((drs.scale + 0.1) * 100) / 100);
        drs.over = drs.slowAtMin = 0;
        applySize();
        drs.warm = 10;
        return;
      }
    }
    const target = Math.max(1000 / 60, drs.refresh * 1.04);
    const gpuMs = gpu.lastMs;
    // GPU 타이머가 있으면 GPU 시간으로(예산 = 목표의 0.8), 없으면 프레임 간격으로. CPU 가 막힌 중이면 줄이지 않는다
    const cpuBound = drs.cpu > target * 0.75;
    const slow = Number.isFinite(gpuMs) ? gpuMs > target * 0.8 : drs.ema > target * 1.18 && !cpuBound;
    const fast = Number.isFinite(gpuMs) ? gpuMs < target * 0.55 : drs.ema < target * 1.06;
    drs.over = slow ? drs.over + dt : 0;
    drs.under = fast ? drs.under + dt : 0;
    let changed = false;
    if (drs.over >= 1 && drs.scale > L.drsMin + 1e-3) {
      drs.scale = Math.max(L.drsMin, Math.round((drs.scale - 0.1) * 100) / 100);
      drs.over = 0;
      if (!Number.isFinite(gpuMs)) {
        drs.before = drs.ema;
        drs.check = 2;
      }
      changed = true;
    } else if (drs.under >= 4 && drs.scale < 1 - 1e-3) {
      drs.scale = Math.min(1, Math.round((drs.scale + 0.05) * 100) / 100);
      drs.under = 0;
      changed = true;
    }
    drs.slowAtMin = slow && drs.scale <= L.drsMin + 1e-3 ? drs.slowAtMin + dt : 0;
    if (requested === "auto" && drs.slowAtMin >= 4 && level !== "low") {
      level = level === "high" ? "mid" : "low";
      drs.scale = 0.85;
      drs.slowAtMin = 0;
      applyLevel();
      if (api.onDowngrade) api.onDowngrade(level);
      return;
    }
    if (changed) {
      applySize();
      drs.warm = 10;
    }
  }

  // ------------------------------------------------------------ 그래픽 연결 · 탭
  let lost = false;
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    lost = true;
    if (api.onContext) api.onContext("lost");
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false;
    ink.restore();
    hd.restore();
    gpu.reset();
    if (api.onContext) api.onContext("restored");
  });
  document.addEventListener("visibilitychange", () => {
    drs.over = drs.under = drs.slowAtMin = 0;
    drs.warm = 30;
  });

  // ------------------------------------------------------------------- 경기장
  /**
   * 경기장을 바꾼다. view = { lanes: [레인 번호…] } 이면(던전 — v16) 그 레인만 그린다: 다른 레인 칸은 빈 바다(블록 · 바닥을 만들지 않는다),
   * 카메라는 그 레인들의 사각형 안에서만 움직이고, 잉크 캔버스도 그 사각형만 덮는다(레인이 커져도 잉크가 흐려지지 않게).
   * 사람은 자기 레인 하나, 진행자는 쓰는 레인 모두.
   */
  function setArena(A, view = null) {
    arena = A;
    const D = A && A.dungeon;
    const lanes = D && view && Array.isArray(view.lanes) ? view.lanes.filter((k) => D.lanes[k]) : null;
    let VA = A;
    let rect = null;
    if (lanes && lanes.length && A.grid) {
      const keep = new Set(lanes);
      const tiles = A.grid.tiles.slice();
      for (let i = 0; i < tiles.length; i++) if (!keep.has(D.lane[i])) tiles[i] = TILE.WATER;
      // 칸 상태(blocks — 문이 열리면 바뀐다)는 같은 배열을 그대로 읽는다
      VA = { ...A, grid: { ...A.grid, tiles }, homes: (A.homes || []).filter((h) => keep.has(h.id)) };
      const rs = lanes.map((k) => D.lanes[k].rect);
      rect = { x0: Math.min(...rs.map((r) => r.x0)), z0: Math.min(...rs.map((r) => r.z0)), x1: Math.max(...rs.map((r) => r.x1)), z1: Math.max(...rs.map((r) => r.z1)) };
    }
    G = gridOf(VA);
    const inkRect = rect ? { e: Math.max(rect.x1 - rect.x0, rect.z1 - rect.z0) / 2, cx: (rect.x0 + rect.x1) / 2, cz: (rect.z0 + rect.z1) / 2 } : null;
    world.setArena(VA, G, inkRect);
    fog.setArena(VA, G);
    if (inkRect) ink.setExtent(inkRect.e, inkRect.cx, inkRect.cz);
    else ink.setExtent((A.inkExtent ?? 12) * (A.scale || 1));
    if (rect) cam.setRect(rect.x0, rect.z0, rect.x1, rect.z1);
    else cam.setBounds(A.radius, A.shape === "square" || A.shape === "grid" || !!G);
    quiz.setLayout([]);
    fx.clear();
    lights.clear();
    monsters.clear();
    drones.clear();
  }

  // ---------------------------------------------------------------- 한 프레임
  const stats = { fps: 60, calls: 0, instances: 0, layers: 0, blocks: 0, parts: 0, gpuMs: NaN, texMB: 0, triangles: 0, level: "", rt: "", fog: false, res: 1, cpuMs: 0, quality: "auto", lod: 0 };
  let frameT0 = 0; // [왕국전] 이번 프레임 JS 시작(beginFrame) — 동적 해상도가 CPU 막힘을 가른다
  let flashScale = 1; // [왕국전] 화면 번쩍임 세기(설정 — 흔들림 줄이기)
  let lodOn = 0;
  let fpsAcc = 0;
  let fpsN = 0;
  let frameTime = 0;
  let frameDt = 0;
  let frameNo = 0;
  let myTeam = -1;
  const groundAt = (x, z) => (arena && arena.groundAt ? arena.groundAt(x, z) : 0);
  const rect = { x0: 0, z0: 0, x1: 0, z1: 0 };
  const scr = { flash: [0, 0, 0, 0], lens: [], shock: [] };
  const tags = [];
  const says = new Map(); // id → { text, until, color, x, y, z }

  function beginFrame(time, dt) {
    frameT0 = performance.now();
    lastPlayers = drawnPlayers;
    drawnPlayers = 0;
    frameTime = time;
    frameDt = dt;
    frameNo++;
    decals.begin();
    decals.setTime(time);
    stacks.begin();
    spheres.begin();
    world.begin();
    monsters.begin(time);
    drones.begin();
    tags.length = 0;
    chars.update(dt);
    fx.update(dt);
    ink.update(dt);
    inkU.uInkNow.value = ink.now;
    lights.update(dt);
    quiz.update(dt);
    world.update(dt, time);
    fog.update(dt);
  }

  const camTarget = new THREE.Vector3();
  function placeCamera() {
    // 화면 가운데의 바닥 점을 보는 진짜 직교 카메라. 장면 타깃은 화면 전체(기기 해상도 × 배율)
    const rx = cam.drawX;
    const rz = cam.drawY / PROJ.SQUASH;
    camTarget.set(rx * PROJ.cos + rz * PROJ.sin, 0, -rx * PROJ.sin + rz * PROJ.cos);
    camera.position.set(camTarget.x + PROJ.view[0] * 60, PROJ.view[1] * 60, camTarget.z + PROJ.view[2] * 60);
    camera.up.set(0, 1, 0);
    camera.lookAt(camTarget);
    const k = cam.zoom / zi; // 장면 타깃 화소 / u
    camera.left = -rtW / (2 * k);
    camera.right = rtW / (2 * k);
    camera.top = rtH / (2 * k);
    camera.bottom = -rtH / (2 * k);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  const v3 = new THREE.Vector3();
  /** 월드 점 → 기기 픽셀(위 → 아래) + 창 깊이(글자 층용) */
  function toScreen(x, y, z, out) {
    v3.set(x, y, z).project(camera);
    out.x = (v3.x * 0.5 + 0.5) * rtW * zi;
    out.y = cam.devH - (v3.y * 0.5 + 0.5) * rtH * zi;
    out.depth = v3.z * 0.5 + 0.5;
    return out;
  }
  const hdView = { toScreen, zoom: 1, devW: 1, devH: 1, cssW: 1, cssH: 1, dpr: 1 };
  const sp = { x: 0, y: 0, depth: 0 };
  /** 충격파 일그러짐용: 바닥 점 → 기기 픽셀(GL 좌표) · 1u 의 픽셀 */
  const project = (x, z) => {
    toScreen(x, 0, z, sp);
    return { x: sp.x, y: cam.devH - sp.y, k: cam.zoom };
  };

  function render() {
    if (document.hidden) return; // 탭이 가려지면 그리지 않는다
    const L = LEVELS[level];
    fpsAcc += frameDt;
    fpsN++;
    if (fpsAcc > 0.5) {
      stats.fps = fpsN / fpsAcc;
      fpsAcc = 0;
      fpsN = 0;
    }
    feedDrs(frameDt * 1000, stats.cpuMs);
    cam.update(frameDt);
    placeCamera();
    renderer.info.reset();
    gpu.begin();

    cam.groundRect(2.5, rect);
    // [왕국전] 멀리 볼 때(화면 가로가 넓을 때) 나무 · 건물 · 광산을 가벼운 모델로
    const vw = cam.viewWidth;
    lodOn = vw > LOD_FAR ? 1 : vw < LOD_NEAR ? 0 : lodOn;
    world.setLod(lodOn);
    spheres.setView(rect.x0 - 1, rect.z0 - 1, rect.x1 + 1, rect.z1 + 1);
    world.drawBlocks(rect);
    quiz.emitWorld({ world, decals, stacks, spheres }, frameNo, frameTime, L.step);
    fx.draw(decals, spheres);
    if (art) chars.drawGhosts({ stacks, decals }, L.step);
    world.end();
    decals.end();
    stacks.end();
    spheres.end();
    monsters.end();
    drones.end();
    lights.apply(L.points, camTarget.x, camTarget.z);

    if (lost) return;
    post.begin();
    renderer.setClearColor(STYLE.colors.background, 1);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    fx.screen(scr, L.distort ? project : null);
    // [왕국전] 설정 "화면 흔들림 줄이기": 화면 번쩍임 · 묻은 잉크를 옅게
    if (flashScale < 1) {
      scr.flash[3] *= flashScale;
      for (const l of scr.lens) l.a *= flashScale;
    }
    post.run({
      post: L.post, bloom: STYLE.post.bloom, threshold: STYLE.post.bloomThreshold, spread: 2.2, tilt: STYLE.post.tilt, focus: 0.42,
      vignette: STYLE.post.vignette * L.vig, grade: L.grade * STYLE.post.grade, edges: 0, fxaa: L.fxaa,
      nearest: false, zoom: zi, ox: 0, oy: 0, devW: cam.devW, devH: cam.devH, flash: scr.flash, lens: scr.lens, shock: L.distort ? scr.shock : [],
    });
    // 글자 층(기기 해상도)
    hd.setView(cam.devW, cam.devH, rtW, rtH, 0, 0, zi);
    hd.begin();
    hdView.zoom = cam.zoom;
    hdView.devW = cam.devW;
    hdView.devH = cam.devH;
    hdView.cssW = cam.devW / cam.dpr;
    hdView.cssH = cam.devH / cam.dpr;
    hdView.dpr = cam.dpr;
    quiz.emitHD(hdView, frameNo);
    if (hdTags) drawTags();
    drawSays();
    quiz.emitPanel(hdView); // 풀이 판(문제 띠 + 답 카드 — 화면 위쪽 고정, 무엇에도 가려지지 않는다)은 맨 위에
    hd.render();
    const ms = gpu.end();
    if (Number.isFinite(ms)) stats.gpuMs = stats.gpuMs !== stats.gpuMs ? ms : stats.gpuMs + (ms - stats.gpuMs) * 0.1;

    stats.calls = renderer.info.render.calls;
    stats.triangles = renderer.info.render.triangles;
    stats.layers = stacks.count;
    stats.blocks = world.count;
    stats.parts = fx.counts.parts;
    stats.instances = stacks.count + world.count + spheres.count + decals.count + hd.count;
    stats.level = level;
    stats.rt = `${rtW}×${rtH}`;
    stats.fog = fog.enabled;
    stats.art = `${artInfo.source} · map ${world.artSource}`;
    // 텍스처(애셋 그림 · 잉크 · 안개 · 지형 지도)와 그리기 타깃(장면 · 블룸 · 글자 층)을 따로 센다
    const mapBytes = String(world.artSource).startsWith("atlas") ? 0 : world.artBytes; // 애셋을 받았으면 artInfo.bytes 에 들어 있다
    // + 캐릭터 무늬 시트 · 자세 자료(chars.bytes — 3D 인형) · 바닥 잉크 캔버스(화질마다 크기가 다르다)
    stats.texMB = Math.round(((artInfo.bytes || 0) + mapBytes + ink.bytes + fog.bytes + world.bytes + (chars.bytes || 0)) / 1e5) / 10; // [갈래 B] world.bytes = 바닥 칸 자료 + 그림자 맵
    stats.rtMB = Math.round((post.bytes + hd.bytes) / 1e5) / 10;
    stats.res = drs.scale;
    stats.quality = requested;
    stats.lod = lodOn;
    stats.cpuMs = performance.now() - frameT0;
  }

  // 말풍선(docs/DESIGN.md §2.14): 머리 위(이름표 위) 4초, 검정 판 + 팀 색 띠, 두 줄까지. 이번 프레임에 그리지 않은(시야 밖) 캐릭터의 것은 숨긴다
  function drawSays() {
    for (const [id, s] of says) {
      if (frameTime > s.until) {
        says.delete(id);
        continue;
      }
      const a = chars.get(id);
      const last = a && a.last;
      if (last) {
        s.x = last.x;
        s.y = last.y;
        s.z = last.z;
        if (frameTime - a.lastSeen > 0.1) continue;
      }
      if (!Number.isFinite(s.x)) continue;
      toScreen(s.x, s.y + SAY_Y, s.z, sp);
      if (sp.x < -300 || sp.y < -100 || sp.x > cam.devW + 300 || sp.y > cam.devH + 100) continue;
      const two = s.text.length > 16;
      const slot = hd.label(`say${id}`, `${s.text}|${s.color}`, two, (ctx, sl) => {
        ctx.font = `${two ? 21 : 22}px ${FONT_POSTER}`;
        const lines = wrapText(ctx, s.text, sl.w - 30, two ? 2 : 1);
        const tw = Math.min(sl.w - 8, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 30);
        const x0 = sl.x + (sl.w - tw) / 2;
        roundRect(ctx, x0, sl.y + 2, tw, sl.h - 4, 6);
        ctx.fillStyle = "#0b0a18";
        ctx.fill();
        ctx.fillStyle = cssOf(s.color);
        ctx.fillRect(x0, sl.y + 2, 7, sl.h - 4);
        ctx.lineWidth = 2;
        ctx.strokeStyle = cssOf(s.color);
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const lh = (sl.h - 4) / lines.length;
        lines.forEach((l, k) => ctx.fillText(l, x0 + tw / 2 + 3, sl.y + 2 + lh * (k + 0.5) + 1));
      });
      const k = cam.devH / (22 * 0.75) / 48; // [갈래 B] 글자 크기는 화면 높이 기준(월드를 넓게 보아도 말풍선 · 이름표는 줄지 않는다)
      const age = frameTime - (s.until - s.ttl);
      const pop = Math.min(1, age / 0.12);
      const fade = Math.min(1, (s.until - frameTime) / 0.3);
      hd.quad(sp.x, sp.y - (1 - pop) * 6, slot.w * 0.75 * k * (0.8 + 0.2 * pop), slot.h * 0.75 * k * (0.8 + 0.2 * pop), [slot.x, slot.y, slot.x + slot.w, slot.y + slot.h], [1, 1, 1, fade], MODE_HD.TEX, -1);
    }
  }

  // (선택) 글자 층 이름표 — 주소에 ?hdtags. 기본은 UI 갈래의 DOM 이름표(ui.tag)
  function drawTags() {
    for (const t of tags) {
      toScreen(t.x, t.y, t.z, sp);
      if (sp.x < -100 || sp.y < -50 || sp.x > cam.devW + 100 || sp.y > cam.devH + 50) continue;
      const slot = hd.label(`tag${t.id}`, `${t.name}|${t.color}|${t.self}`, false, (ctx, s) => {
        ctx.font = `22px ${FONT_POSTER}`;
        const w = Math.min(s.w - 8, ctx.measureText(t.name).width + 24);
        ctx.fillStyle = t.self ? "#ffffff" : cssOf(t.color);
        ctx.fillRect(s.x + (s.w - w) / 2, s.y + 3, w, s.h - 6);
        ctx.fillStyle = t.self ? "#0b0a18" : cssOf(darkHex(t.color, 0.15));
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(t.name, s.x + s.w / 2, s.y + s.h / 2 + 1);
      });
      const k = cam.devH / (22 * 0.75) / 48; // [갈래 B] 글자 크기는 화면 높이 기준(월드를 넓게 보아도 말풍선 · 이름표는 줄지 않는다)
      hd.quad(sp.x, sp.y, slot.w * 0.75 * k, slot.h * 0.75 * k, [slot.x, slot.y, slot.x + slot.w, slot.y + slot.h], [1, 1, 1, 1], MODE_HD.TEX, -1);
    }
  }

  // 층 건너뛰기: 화질의 단계 + 사람이 많으면(지난 프레임에 그린 캐릭터 × 약 87층이 예산 2,800 을 넘을 만큼) 한 단계 더
  let drawnPlayers = 0;
  let lastPlayers = 0;
  const step = () => LEVELS[level].step + (lastPlayers * 87 > 2800 / LEVELS[level].step ? 1 : 0);
  /** 시야 밖인가(안개): 우리 팀이 아닌 것만 가린다 */
  const hidden = (x, z, pad = 0.5) => !fog.visible(x, z, pad);
  const fogApi = {
    seen: (i, c, r) => fog.seen(i, c, r),
    visible: (x, z, pad = 0) => fog.visible(x, z, pad),
    snapshot: () => fog.snapshot(),
  };

  const api = {
    THREE,
    renderer,
    /** 캐릭터 8종 표(charset.js — 이름 · 성별 · 생김새). 고르기 화면(src/ui/chars.js)이 읽는다 */
    CHARACTERS,
    /** 고르기 화면 초상: (종류 0~7, 0xRRGGBB, px) → 투명 바탕 캔버스(경기와 같은 3D 인형, 캐시) */
    charPortrait: createPortraits(renderer),
    scene,
    camera,
    cam,
    stats,
    /** 개발용(시험 · 콘솔): 월드 · 안개 */
    world,
    fogState: fog,
    onContext: null,
    onDowngrade: null,
    get level() {
      return level;
    },
    get requested() {
      return requested;
    },
    get contextLost() {
      return lost;
    },
    get arena() {
      return arena;
    },
    get atlas() {
      return artInfo;
    },
    setArena,
    setQuality,
    /** [왕국전] 설정 화질("auto" · "high" · "mid" · "low") */
    get quality() {
      return requested;
    },
    /** [왕국전] 자동일 때 시작 단계(첫 화면에서 잰 추천). 자동이면 바로 그 단계로 바꾸고, 동적 해상도가 거기서부터 맞춘다 */
    setAutoLevel(l) {
      if (!LEVELS[l]) return;
      autoLevel = l;
      if (requested === "auto" && !probeSaved) {
        level = l;
        drs.scale = drsStart();
        applyLevel();
      }
    },
    get autoLevel() {
      return autoLevel;
    },
    /** [왕국전] 기기 재기: l 단계 · 100% 해상도로 잠깐 바꾼다(동적 해상도 멈춤). null 이면 원래대로(설정 · 자동 단계) */
    probe(l) {
      if (l && LEVELS[l]) {
        if (!probeSaved) probeSaved = { on: drs.on };
        drs.on = false;
        drs.scale = 1;
        level = l;
        applyLevel();
      } else if (probeSaved) {
        drs.on = probeSaved.on;
        probeSaved = null;
        level = requested === "auto" ? autoLevel : requested;
        drs.scale = drsStart();
        applyLevel();
      }
    },
    /** [왕국전] 그래픽 장치 이름(WEBGL_debug_renderer_info — 없으면 RENDERER) · GPU 타이머가 있나 */
    get gpuName() {
      try {
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        return String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || "");
      } catch {
        return "";
      }
    },
    get gpuTimer() {
      return gpu.supported;
    },
    /** [왕국전] 동적 해상도 켜고 끄기(벤치마크 — 끄면 배율을 scale 에 고정) · 지금 배율 */
    setDynamicRes(on, scale = 1) {
      drs.on = !!on;
      if (!on) drs.scale = Math.max(0.3, Math.min(1, scale));
      applySize();
    },
    get resScale() {
      return drs.scale;
    },
    /** [왕국전] 바닥에 구울 그림자 주인(건물 · 광산 — floorshade.js caster 목록) */
    setCasters: (list) => world.setCasters(list),
    /** [왕국전] 개발용 숫자(벤치마크 · ?debug 표시): 장면 타깃 화소 · 동적 해상도 · 모델 단계 · 구 · 정적 묶음 · 굽기 */
    debugStats() {
      const pc = world.props.counts;
      return {
        px: rtW * rtH, dev: cam.devW * cam.devH, res: stats.res, lod: lodOn, level, quality: requested,
        balls: spheres.count, ballsCulled: spheres.culled, propsVis: pc.static, propsAll: pc.staticAll, dyn: pc.dynamic,
        bakeMs: Math.round(world.shadeStats.bakeMs * 10) / 10, bakes: world.shadeStats.bakes, cpuMs: Math.round(stats.cpuMs * 100) / 100,
      };
    },
    setShakeScale(v) {
      cam.shakeScale = Math.max(0, Math.min(1, Number(v) || 0));
    },
    /** [왕국전] 화면 번쩍임 · 묻은 잉크 세기(0..1 — 설정 "화면 흔들림 줄이기") */
    setFlashScale(v) {
      flashScale = Math.max(0, Math.min(1, Number(v) || 0));
    },
    clearInk() {
      ink.clear();
    },

    beginFrame,
    /**
     * 전장의 안개(docs/DESIGN.md §3.8): 프레임마다 우리 팀의 시야(game.vision() — shared/fog.js makeVision)를 넘긴다.
     * null(안개가 꺼진 경기 · 진행자 · 대기 화면) 이면 다 보인다
     */
    setVision(v) {
      fog.setVision(v);
      myTeam = v && v.team >= 0 ? v.team : -1;
    },
    /** 안개 그리기를 통째로 켜고 끈다(개발 · 진행자 — 기본 켬) */
    setFog(on) {
      fog.setEnabled(on);
    },
    /** 미니맵용(src/ui/minimap.js 의 fog): { seen(i, c, r), visible(x, z, pad), snapshot() } — 안개가 꺼져 있으면 null */
    get fog() {
      return fog.enabled ? fogApi : null;
    },
    /**
     * 카메라가 따라갈 곳(내 캐릭터 · 관전 대상). 조준점 쪽으로 조금 앞서 본다.
     * (예전에는 퀴즈 룸 근처에서 전광판이 보이게 화면 위쪽으로 치우쳤다 — 그러면 존과 내 캐릭터가 화면 아래 HUD(무기 막대)에 깔렸다.
     *  문제 · 카드는 이제 화면 위쪽에 고정된 풀이 판에 뜨므로 치우치지 않는다. quizgeom.focusBias 는 시험 · 도구용으로 남긴다)
     */
    follow(x, z, ax, az) {
      cam.follow(x, z, ax, az);
      // 풀이 판이 떠 있으면(화면 위쪽을 덮는다) 내 캐릭터 · 존이 판과 아래 HUD 사이 한가운데에 오게 조금 내려 보인다
      const pn = quiz.panel;
      if (pn) {
        const zoomCss = cam.zoom / cam.dpr;
        // 아래 HUD(무기 막대 · 조작부)가 맵 위에 겹치는 만큼 뺀다 — 세로 터치 화면은 조작부가 맵 밖(아래 칸)에 있어 조금만
        const below = document.documentElement.classList.contains("t-split") ? 16 : Math.min(170, cam.cssH * 0.22);
        const mid = (pn.bottom + cam.cssH - below) / 2;
        const dy = (mid - cam.cssH / 2) / zoomCss;
        if (dy > 0) cam.nudge(0, -dy);
      }
    },
    center: () => cam.center(),
    /** 화면 위쪽을 덮는 HUD 의 높이(CSS px, 0 = 없음). 카메라가 그만큼 경기장 위 끝 너머로 올라가 캐릭터가 HUD 밑에 깔리지 않는다 */
    setTopInset(px) {
      cam.insetTop = Math.max(0, Math.min(cam.cssH * 0.5, Number(px) || 0));
    },
    /** 진행자 화면 카메라(docs/DESIGN.md §7 v14): 화면 가로 u(null = 자동 — 넓은 화면 42u, 좁은 화면은 더 당긴다) · 지금 값 · 경기장 전체가 드는 가로 · 바닥 사각형이 드는 가로 */
    setViewWidth: (u) => cam.setViewWidth(u),
    get viewWidth() {
      return cam.viewWidth;
    },
    fitWidth: (reserveTop = 0) => cam.fitWidth(reserveTop),
    widthFor: (x0, z0, x1, z1, pad = 0, reserveTop = 0) => cam.widthFor(x0, z0, x1, z1, pad, reserveTop),
    /** 지금 큰 화면이 덮는 바닥의 월드 사각형 { x0, z0, x1, z1 }(진행자 미니맵의 흰 사각형) */
    viewRect: (out) => cam.groundRect(0, out),
    /** (x, z) 를 화면 가운데로 부드럽게(앞서 보기 없이) */
    lookAt: (x, z) => cam.follow(x, z),
    snap() {
      cam.snap = true;
    },
    /** 캐릭터 하나. 시야 밖의 다른 팀이면 그리지 않고 false. o = { self, lock, gy, scrum(뭉친 팀원 — 발밑 옅은 고리) } */
    drawPlayer(v, o = {}) {
      if (!o.self && v.team !== myTeam && hidden(v.x, v.z, PLAYER.RADIUS)) return false;
      if (!art) return true;
      drawnPlayers++;
      const gy = o.gy ?? groundAt(v.x, v.z);
      chars.draw({ stacks, decals }, v, {
        self: !!o.self, lock: !!o.lock, gy, time: frameTime, dt: frameDt, step: step(), decalShadow: true, scale: CHAR_SCALE,
        zoneColor: quiz.zoneColorAt(v.x, v.z, v.color ?? -1),
      }, art);
      if (o.scrum) decals.push(v.x, gy + 0.01, v.z, 1.9, 1.9, hexOf(v.color), 0.35 + 0.1 * Math.sin(frameTime * 6), SHAPE.RING, 0.08, MODE.FLAT, 0.02, 0.3);
      if (hdTags && v.name) tags.push({ id: v.id, name: String(v.name), color: hexOf(v.color), self: !!o.self, x: v.x, y: v.y + 2.2, z: v.z });
      const s = says.get(v.id);
      if (s) {
        s.x = v.x;
        s.y = v.y;
        s.z = v.z;
        if (s.color === undefined) s.color = hexOf(v.color);
      }
      return true;
    },
    drawBalloon(x, y, z, o = {}) {
      if (hidden(x, z, 0.6)) return;
      drawBalloon({ spheres, decals }, x, y, z, { ...o, gy: groundAt(x, z), decalShadow: true });
    },
    drawItem(x, z, kind) {
      if (hidden(x, z, 0.6)) return;
      drawItem({ stacks, decals, spheres }, x, z, kind, frameTime, groundAt(x, z), art, { step: step(), decalShadow: true });
    },
    drawBombMark(x, z, radius, progress, color) {
      drawBombMark(decals, x, z, radius, progress, color, frameTime, groundAt(x, z));
    },
    drawAim(a) {
      drawAim(decals, a, frameTime);
    },
    /**
     * 맵에 남은 설치물(game.gadgets 의 항목 — gadget 사건 그대로): 덫(gadget/trap — 다른 팀 것은 faint 로 흐릿하게) · 집결 깃발(gadget/rally) ·
     * 연막(다른 팀의 연막은 구름 안이 보이지 않게 짙게) · 장벽(칸은 블록 — blockChanged 의 tmp 로 그린다)
     */
    drawGadget(gd) {
      if (!gd || !Number.isFinite(gd.x)) return;
      const mine = gd.team === myTeam;
      if (gd.g === "smoke") {
        drawSmoke(gd, mine);
        return;
      }
      if (!mine && hidden(gd.x, gd.z, 1)) return;
      const col = gd.color ?? -1;
      if (gd.g === "trap" || gd.g === "rally") {
        const st = art && art.stacks.get(gd.g === "trap" ? "gadget/trap" : "gadget/rally");
        const faint = gd.faint ? 0.45 : 1;
        if (gd.g === "rally") decals.push(gd.x, 0.01, gd.z, (gd.r || 3) * 2, (gd.r || 3) * 2, hexOf(col), 0.25 + 0.1 * Math.sin(frameTime * 3), SHAPE.RING, 0.04, MODE.FLAT, 0.02, 0.4);
        else decals.push(gd.x, 0.01, gd.z, (gd.r || 0.8) * 2, (gd.r || 0.8) * 2, hexOf(col), 0.3 * faint, SHAPE.RING, 0.12, MODE.FLAT, 0.02, 0.3);
        if (st) {
          const f = gd.g === "rally" ? frameAt(st, "wave", frameTime) : poseFrames(st, "idle")[0];
          drawStack(stacks, st, f, gd.x, 0, gd.z, Math.PI / 2, col, { step: step(), shade: faint, xray: 0 });
        }
      }
    },
    /**
     * (덧) 던전 몬스터 한 마리(보이는 것만 — 안개로 가리기는 부르는 쪽이): m = { id, kind(0~7 — monsters.js 의 MONSTER_KINDS), x, z, face, scale, hp,
     * moving, windup(−1 | 0..1), hit, spawn, dying, frozen, atk, dash, stun, fire, air, rage } — src/render/monsters.js
     */
    drawMonster(m) {
      monsters.draw(m, frameTime);
    },
    /** [왕국전] 바닥 · 공중 표시 한 장(sprites.js 의 decals.push 그대로 — 고르기 고리 · 체력 막대 · 놓을 자리) */
    decal: (...a) => decals.push(...a),
    /** [왕국전] 3D 모델 한 개(models.js 의 이름 — 건물 · 광산). beginFrame 과 render 사이에. rx · rz = 기울기(쓰러진 깃대) */
    model: (name, x, y, z, rot = 0, hex = 0xffffff, scale = 1, rx = 0, rz = 0) => activeProps()?.push(name, x, y, z, rot, hex, scale, rx, rz) ?? false,
    /** [왕국전] 바닥에 누운 호 게이지(sprites.js 의 decals.arc 그대로 — 방어막 비율) */
    decalArc: (...a) => decals.arc(...a),
    /** [왕국전] 잉크 웅덩이 한 장(sprites.js 의 decals.pond — 셰이더가 물결 · 방울을 그린다) */
    decalPond: (...a) => decals.pond(...a),
    /** [왕국전] 지금 화면에 드는 바닥 사각형(월드 u — 지난 프레임 카메라) */
    viewRectNow: (out) => cam.groundRect(0, out),
    /** [왕국전] 세운 빛 벽 한 칸(sprites.js 의 decals.wall 그대로 — 풀이 중 빛기둥) */
    decalWall: (...a) => decals.wall(...a),
    get camera() {
      return cam;
    },
    /**
     * (덧) 몬스터가 쏜 잉크 덩이 하나(고블린은 심지가 타는 폭탄): s = { x, y(바닥에서 높이), z, kind(쏜 몬스터 종류 — 색), dx, dz(날아가는 쪽 단위 벡터),
     * r(판정 반지름 u), id(덧 — 출렁임 씨앗) }. 프레임마다 다시 넣는다 — src/render/monsters.js
     */
    /** (덧) 던전 드론 한 대: d = { x, y, z, t, blink, team, fade } — src/render/drones.js */
    drawDrone(d) {
      drones.draw(d);
    },
    drawMonsterShot(s) {
      monsters.shot(s);
    },
    /** 소용돌이(game.vortices 의 항목): 바닥에서 빨려 드는 고리 */
    drawVortex(vx) {
      if (!vx || hidden(vx.x, vx.z, vx.r || 3)) return;
      const r = vx.r || 3;
      for (let i = 0; i < 3; i++) {
        const k = ((frameTime * 1.6 + i / 3) % 1);
        decals.push(vx.x, 0.02, vx.z, r * 2 * (1 - k), r * 2 * (1 - k), hexOf(vx.color ?? -1), 0.7 * k, SHAPE.RING, 0.12, MODE.FLAT, 0.03, 0.8);
      }
      spheres.ring(vx.x, 0.15, vx.z, r * (0.35 + 0.05 * Math.sin(frameTime * 9)), 0.12, hexOf(vx.color ?? -1), 1.2, 0.5);
    },
    render,

    /** 말풍선(채팅 · 팀 신호): 캐릭터 id 의 머리 위에 ttl 초(기본 4). color = PALETTE 번호(없으면 그 캐릭터의 팀 색). 빈 글이면 지운다 */
    say(id, text, ttl = SAY_TIME, color) {
      const t = String(text ?? "").trim().slice(0, 40);
      if (!t) {
        says.delete(id);
        return;
      }
      const prev = says.get(id);
      says.set(id, { text: t, until: frameTime + ttl, ttl, color: color >= 0 ? hexOf(color) : prev?.color, x: prev?.x ?? NaN, y: prev?.y ?? 0, z: prev?.z ?? 0 });
    },

    /** 경기 시작 때 한 번: [{ id, x, z, r(존 반지름), board: {x, z} }] (docs/CONTRACT.md §4) */
    setQuizLayout(rooms) {
      quiz.setLayout(rooms || []);
      if (arena) cam.extendTop(quiz.topReach(-arena.radius));
    },
    /** 매 프레임 룸마다(상태 모양은 docs/CONTRACT.md §4) */
    drawQuizRoom(room) {
      quiz.draw(room, frameNo);
    },
    /**
     * (덧) 풀이 판(docs/DESIGN.md §2.6): 우리 팀이 풀이 중이면 화면 위쪽에 고정되는 문제 띠 + 답 카드의 자리(CSS px —
     * { x, y, w, h, bottom, head, cards: [{x, y, w, h}], room, n, done }), 없으면 null. 지난 프레임에 그린 것
     */
    get quizPanel() {
      return quiz.panel;
    },
    /** (덧) 화면 자리(CSS px)의 답 카드 번호 — 풀이 판이 없거나 카드 밖이면 −1(마우스로 카드 겨누기) */
    quizCardAt: (px, py, pad = 0) => quiz.cardAt(px, py, pad),
    /** (덧) 내가 겨눈 카드: { c, x, y, z(내 발 — 월드), color(PALETTE 번호) } | null — 카드가 빛나고 손에서 카드까지 포물선 조준선 */
    setCardAim: (a) => quiz.setAim(a),
    /** (덧) 카드의 이름 딱지(누가 던졌나): pid → 닉네임 */
    setNameOf: (fn) => quiz.setNameOf(fn),
    /**
     * 칸 i 의 블록이 부서졌다(on = 0) · 다시 자랐다(1) — {k:"blk"} 를 받은 뒤. 블록 상태 자체는 경기장의 grid.blocks 를 그대로 읽는다
     * (game.js 가 바꾼다). e = blk 사건(tmp = 장벽의 임시 블록 — color 를 붙여 주면 그 팀 색으로, drill = 드릴이 뚫었다).
     * 여기서는 그 묶음만 다시 나누고(props.js) 연출(조각 · 먼지 · 부서진 자국 / 아래에서 위로 솟기)을 붙인다.
     */
    blockChanged(i, on, e = null) {
      if (!G || i < 0 || i >= G.n * G.n) return;
      if (e && e.tmp && on) G.temp.set(i, e.color >= 0 ? hexOf(e.color) : 0xb9aee0);
      const wasTemp = G.temp.has(i);
      if (!on) G.temp.delete(i);
      // 던전의 문(TILE.GATE — 바닥 칸에 선 블록, e.gate)도 임시 블록처럼 묶음을 다시 나눈다(열리면 문 그림이 걷힌다)
      const gate = G.tile[i] === CELL.GATE || !!(e && e.gate);
      if (!isBlock(G.tile[i]) && !wasTemp && !(e && e.tmp) && !gate) return;
      const c = cellCenter(G, i);
      world.blockChanged(i, !!on, frameTime);
      if (on) fx.regrow(c.x, c.z, [0x8a5a44, 0xff7a00]);
      else if (gate) fx.fountain(c.x, 0.3, c.z, 3, 18); // 문이 열렸다: 빛 분수(색은 PALETTE 번호 — 네온 오렌지)
      else fx.debris(c.x, c.z, wasTemp ? [0xb9aee0, 0x3a3360] : [0xaa7454, 0x5a3424], 1.1);
    },
    /** 홈 번호 → 팀 색(PALETTE 번호 배열, −1 = 비었다) — 홈 판석 · 홈 깃대를 팀 색으로 */
    setHomeColors(list) {
      world.setHomeColors((list || []).map((c) => (c >= 0 ? hexOf(c) : -1)));
    },

    fx: Object.assign(fx, {
      answerBomb: (x, y, z, roomId, choice, color, pid, local = false) => quiz.answerBomb(x, y, z, roomId, choice, hexOf(color), pid, local),
      cardHit: (roomId, choice, color, pid) => quiz.cardHit(roomId, choice, hexOf(color), pid),
      roomResult: (roomId, ok, color) => quiz.roomResult(roomId, ok, hexOf(color)),
      /** 홈 소환 소용돌이: (x, z) = 솟아오를 홈 자리. (fromX, fromZ) 를 주면 그 자리에서 빨려 드는 소용돌이도 */
      homeWarp(x, z, color, fromX, fromZ) {
        fx.swirl(x, z, color, true);
        if (Number.isFinite(fromX) && Number.isFinite(fromZ)) fx.swirl(fromX, fromZ, color, false);
      },
    }),
    actor: {
      /** [캐릭터 갈래] 명단의 캐릭터 종류 · 무늬: o = { char(0~7), pattern(−1 자동) } */
      set: (id, o) => chars.set?.(id, o),
      hit: (id, power, dx, dz) => chars.hit(id, power, dx, dz),
      throwPose: (id) => chars.throwPose(id),
      flip: (id, delay) => chars.flip(id, delay),
      ripple: (id) => chars.ripple(id),
      /** 승리 동작(두 팔을 치켜들고 깡충) t 초 — main.js 가 결과 때 이긴 사람에게 */
      cheer: (id, t) => chars.cheer(id, t),
      /** 안개 밖에서 시야 안으로 들어왔다(game.on("fogIn")) — 뿅 튀어나오지 않게 아래층부터 살짝 드러난다 */
      appear: (id) => chars.appear(id),
      /** 안개 밖으로 나갔다(game.on("fogOut")) — 마지막 자리에서 가라앉으며 사라진다 */
      fade: (id) => chars.fade?.(id, frameTime),
      gone: (id) => {
        chars.gone(id);
        says.delete(id);
      },
    },
    addShake: (v) => cam.addShake(v),
    addKick: (v) => cam.addKick(v),

    /** 맵(캔버스)의 CSS 크기 — 세로 터치 화면에서는 창보다 낮다(아래 조작부 칸) */
    get viewW() {
      return cam.cssW;
    },
    get viewH() {
      return cam.cssH;
    },
    worldToScreen: (x, y, z, out) => cam.worldToScreen(x, y, z, out),
    screenToGround: (px, py, out, gy) => cam.screenToGround(px, py, out, gy),
    screenDirToWorld: (dx, dy, out, groundDir) => screenDirToWorld(dx, dy, out, groundDir),
  };

  // 연막: 우리 팀 것은 옅은 연기 고리, 다른 팀 것은 구름 안이 보이지 않게 짙은 연기 덩이(공중 효과 — 캐릭터 위에)
  function drawSmoke(gd, mine) {
    const r = gd.r || 3.5;
    const n = mine ? 10 : 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + frameTime * 0.25 * (i % 2 ? 1 : -1);
      const d = (mine ? 0.9 : (i % 3) / 3 + 0.15) * r * 0.75;
      const s = (mine ? 1.4 : 2.6) + Math.sin(frameTime * 1.7 + i) * 0.25;
      decals.push(gd.x + Math.cos(a) * d, 0.6 + (i % 4) * 0.35, gd.z + Math.sin(a) * d * 0.9, s, s, mixHex(0x3a3555, hexOf(gd.color ?? -1), 0.15), mine ? 0.35 : 0.92, SHAPE.DISC, 0, MODE.FACE, 0.8);
    }
  }

  // 쓰러짐은 층이 흩어지는 연출이 붙는다(main.js 는 fx.ko 를 그대로 부른다)
  const fxKo = fx.ko;
  fx.ko = (x, z, color) => {
    if (!hidden(x, z, 1)) chars.koAt(x, z, frameTime);
    fxKo(x, z, color);
  };

  setQuality("auto");
  setArena(arenaAt(DEFAULT_MAP, DEFAULT_MODE));
  return api;
}
