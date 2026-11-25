// 아틀라스(public/atlas/stacks.json — version 3, docs/CONTRACT.md §3)를 읽는다. version 2 도 읽는다(pitch 없음 · 맵 그림 없음).
//
//   stacks[id] = { kind, w, h, count, cols, pitch, unit, footprint, height, outline("key0".."key3" | "#rrggbb"), frames: { 포즈: { sheet, x, y } }, hat? }
//   층 i 의 그림 = 시트 sheet 의 (x + (i % cols)·pitch[0], y + ⌊i / cols⌋·pitch[1]) 에서 w × h(pitch 가 없으면 w + 2·pad). 층 0 이 바닥.
//   sheets[].group: "stacks"(층 시트 — 층 스택 셰이더의 텍스처 자리 0..3) · "art"(2D 그림 — 장애물 · 데칼 · 그림자).
//   props · decals · terrain(v3): 맵 그림 — 그대로 넘겨 world.setMapArt 가 쓴다. half: 화질 저의 0.5배 판(파일 이름 뒤 suffix).
//   여러 프레임 포즈는 이름 끝 숫자로 묶는다("run0" … "run3" → run). 각 0 에서 그림 오른쪽 = 월드 +x, 아래 = +z(앞).
//   ramps.key 네 색(팀 색 자리) → ramps.team[팀 색][i]. flats = 평면 그림(입자 · 스탬프 · 아이콘).
//
// 위쪽 절반은 순수 함수(Node 시험): parseStacks · layerRect · poseFrames · frameAt · charPose · hexRgb.
// loadStacks 는 목차만 읽는다 — 그림 파일은 받지 않는다(docs/DESIGN.md §3.10 · §3.12: 바닥 · 장애물 · 아이템 · 캐릭터 모두 코드).
import { PALETTE, FLAG } from "../shared/constants.js";
/** 예약 램프(팀 색 자리) — 애셋 목차에 없을 때 */
const KEY_RAMP = ["#2a0a2e", "#5c1866", "#a02cb0", "#e85cf5"];

export const STACKS_VERSION = 3;
export const MAX_SHEETS = 4; // 층 시트(텍스처 자리) 상한 — 대용 시트 자리 하나를 남긴다

/** "#rrggbb" | 0xRRGGBB → [r, g, b](0..1). 잘못된 값이면 null */
export function hexRgb(s) {
  if (typeof s === "number") return [((s >> 16) & 255) / 255, ((s >> 8) & 255) / 255, (s & 255) / 255];
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s || "").trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** PALETTE 색 하나로 어두움 → 밝음 4단 램프(ramps.team 이 모자랄 때) */
export function rampFromHex(hex) {
  const c = hexRgb(hex);
  const mix = (t, to) => c.map((v, i) => v + (to[i] - v) * t);
  return [mix(0.75, [0.1, 0.03, 0.2]), mix(0.45, [0.1, 0.03, 0.2]), c.slice(), mix(0.45, [1, 1, 1])];
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * stacks.json 을 검사하고 쓰기 좋은 모양으로. 잘못된 스택은 그 스택만 버린다(warnings).
 * @returns {{ ok: true, atlas: object, warnings: string[] } | { ok: false, reason: string }}
 */
export function parseStacks(json) {
  if (!json || typeof json !== "object") return { ok: false, reason: "not-json" };
  if (json.version !== STACKS_VERSION && json.version !== 2) return { ok: false, reason: `version ${json.version}` };
  const warnings = [];
  // 시트: json 순서 그대로(번호 = 프레임 · 그림의 sheet). 층 시트는 텍스처 자리(slot)를 차례로 받는다
  const sheets = [];
  let slots = 0;
  for (const s of Array.isArray(json.sheets) ? json.sheets : []) {
    if (!s || typeof s.file !== "string" || !(s.w > 0) || !(s.h > 0)) {
      warnings.push("sheet: bad");
      sheets.push(null);
      continue;
    }
    // "hero"(캐릭터 · 모자 층 시트)는 받지 않는다 — 캐릭터는 3D 모델이다(docs/DESIGN.md §3.9)
    const group = s.group === "art" ? "art" : s.group === "hero" ? "hero" : "stacks";
    let slot = -1;
    if (group === "stacks") {
      if (slots >= MAX_SHEETS - 1) warnings.push(`sheet ${s.file}: too many sheets`);
      else slot = slots++;
    }
    sheets.push({ file: s.file, w: s.w, h: s.h, group, slot });
  }
  if (!sheets.some(Boolean)) return { ok: false, reason: "no-sheets" };
  const pad = isNum(json.pad) ? json.pad : 0;
  const unit = isNum(json.unit) && json.unit > 0 ? json.unit : 16;
  const key = (json.ramps?.key || KEY_RAMP).map(hexRgb);
  const keyRamp = key.length === 4 && key.every(Boolean) ? key : KEY_RAMP.map(hexRgb);
  const teamRamps = PALETTE.map((p, i) => {
    const r = (json.ramps?.team || [])[i];
    const rr = Array.isArray(r) ? r.map(hexRgb) : null;
    return rr && rr.length === 4 && rr.every(Boolean) ? rr : rampFromHex(p.hex);
  });
  const stacks = new Map();
  for (const [id, st] of Object.entries(json.stacks || {})) {
    // 캐릭터 · 모자 · 얼굴 스택은 쓰지 않는다(3D 캐릭터) — 시트가 빠졌어도 경고하지 않는다
    if (id === "hero" || id.startsWith("hat/") || id.startsWith("face/")) continue;
    const why = checkStack(st, sheets, pad);
    if (why) {
      warnings.push(`stack ${id}: ${why}`);
      continue;
    }
    stacks.set(id, normStack(id, st, pad, unit, sheets));
  }
  const okRect = (f) => f && f.sheet >= 0 && f.sheet < sheets.length && sheets[f.sheet] && isNum(f.x) && isNum(f.y) && f.w > 0 && f.h > 0 && f.x + f.w <= sheets[f.sheet].w && f.y + f.h <= sheets[f.sheet].h;
  const flats = new Map();
  for (const [id, f] of Object.entries(json.flats || {})) if (okRect(f)) flats.set(id, { ...f });
  // 맵 그림(v3): 장애물 · 데칼 · 지형 질감
  const props = new Map();
  for (const [id, p] of Object.entries(json.props || {})) {
    if (!okRect(p) || !isNum(p.ax) || !isNum(p.ay)) {
      warnings.push(`prop ${id}: bad`);
      continue;
    }
    const cells = Array.isArray(p.cells) && p.cells.length === 2 ? p.cells : [1, 1];
    props.set(id, { ...p, id, cells, kind: p.kind || "deco", shadow: okRect(p.shadow) ? { ...p.shadow } : null });
  }
  const decals = new Map();
  for (const [id, d] of Object.entries(json.decals || {})) if (okRect(d)) decals.set(id, { ...d, id });
  const terrain = {};
  for (const [name, t] of Object.entries(json.terrain || {})) if (t && typeof t.file === "string") terrain[name] = { file: t.file, size: t.size || 512, tint: t.tint || "none" };
  const half = json.half && typeof json.half.suffix === "string" ? { suffix: json.half.suffix, scale: json.half.scale || 0.5 } : null;
  return {
    ok: true,
    atlas: { version: json.version, sheets, pad, unit, filter: json.filter || "nearest", keyRamp, teamRamps, stacks, flats, props, decals, terrain, half },
    warnings,
  };
}

function checkStack(st, sheets, pad) {
  if (!st || typeof st !== "object") return "not an object";
  if (!(st.w > 0 && st.h > 0 && st.count > 0)) return "bad w/h/count";
  const cols = st.cols > 0 ? st.cols : st.count;
  const frames = st.frames && typeof st.frames === "object" ? Object.entries(st.frames) : [];
  if (!frames.length) return "no frames";
  const [px, py] = Array.isArray(st.pitch) ? st.pitch : [st.w + 2 * pad, st.h + 2 * pad];
  for (const [name, f] of frames) {
    if (!f || !(f.sheet >= 0 && f.sheet < sheets.length) || !sheets[f.sheet] || !isNum(f.x) || !isNum(f.y)) return `frame ${name}: bad`;
    const sh = sheets[f.sheet];
    if (sh.slot < 0) return `frame ${name}: not a stacks sheet`;
    const rows = Math.ceil(st.count / cols);
    const right = f.x + (Math.min(cols, st.count) - 1) * px + st.w;
    const bottom = f.y + (rows - 1) * py + st.h;
    if (f.x < 0 || f.y < 0 || right > sh.w || bottom > sh.h) return `frame ${name}: outside sheet`;
  }
  return null;
}

function normStack(id, st, pad, unit, sheets = null) {
  const poses = {};
  for (const [name, f] of Object.entries(st.frames)) {
    // sheet = 층 스택 셰이더의 텍스처 자리(json 의 시트 번호가 아니다)
    const fr = { sheet: sheets ? sheets[f.sheet].slot : f.sheet, x: f.x, y: f.y };
    const m = /^(.*?)(\d+)$/.exec(name);
    const base = m && m[1] ? m[1] : name;
    (poses[base] ||= []).push(fr);
    if (base !== name) poses[name] = [fr];
  }
  // 외곽선: "key<i>"(팀 램프 i 단 — 음수 −(i + 1) 로) · "#rrggbb"(정해진 색). 옛 "key" 는 key0
  const km = /^key(\d?)$/.exec(String(st.outline || ""));
  const outline = km ? -(Number(km[1] || 0) + 1) : hexRgb(st.outline) ? parseInt(String(st.outline).replace("#", ""), 16) : 0x05040c;
  return {
    id, kind: st.kind || "item", w: st.w, h: st.h, count: st.count, cols: st.cols > 0 ? st.cols : st.count, pad,
    pitch: Array.isArray(st.pitch) ? st.pitch : [st.w + 2 * pad, st.h + 2 * pad],
    unit: st.unit > 0 ? st.unit : unit, footprint: st.footprint || [1, 1], height: st.height || st.count / unit, outline, poses, hat: st.hat || null,
  };
}

/** 프레임의 층 k 그림 왼쪽 위 [x, y](시트 픽셀) */
export function layerRect(st, frame, k) {
  const [px, py] = st.pitch || [st.w + 2 * st.pad, st.h + 2 * st.pad];
  return [frame.x + (k % st.cols) * px, frame.y + Math.floor(k / st.cols) * py];
}

/** 포즈의 프레임 목록(없으면 idle → 아무거나) */
export function poseFrames(st, pose) {
  return st.poses[pose] || st.poses.idle || st.poses[Object.keys(st.poses)[0]];
}

const FPS = { idle: 2.5, run: 10 };
/** 포즈 · 시간 → 프레임 하나 */
export function frameAt(st, pose, t) {
  const list = poseFrames(st, pose);
  if (list.length <= 1) return list[0];
  return list[Math.floor(Math.max(0, t) * (FPS[pose] ?? 8)) % list.length];
}

/** 프레임이 어느 포즈 이름인가(모자 자리 찾기용 — "run2" 처럼 번호까지) */
export function frameName(st, pose, frame) {
  const list = poseFrames(st, pose);
  const i = list.indexOf(frame);
  return list.length > 1 ? `${pose}${Math.max(0, i)}` : st.poses[pose] ? pose : `${pose}0`;
}

/**
 * 캐릭터 포즈(맞음 → 던짐 → 공중 → 준비(충전) → 달리기 → 대기). rate = 달리기 프레임 빠르기 배율.
 */
export function charPose(v, a, gy = 0) {
  if (!(v.flags & FLAG.ALIVE)) return { pose: "ko", rate: 1 };
  if (a && a.hit > 0) return { pose: "hit", rate: 1 };
  if (a && a.throwT > 0) return { pose: "throw", rate: 1 };
  if (v.y - gy > 0.18) return { pose: "jump", rate: 1 };
  if (v.flags & FLAG.CHARGING) return { pose: "ready", rate: 1 };
  const sp = Math.hypot(v.vx || 0, v.vz || 0);
  if (sp > 0.8) return { pose: "run", rate: Math.max(0.6, Math.min(1.6, sp / 8.4)) };
  return { pose: "idle", rate: 1 };
}

/** 파일 이름에 0.5배 판 suffix 를 붙인다("stacks0.png" → "stacks0@0.5.png") */
export function halfName(file, suffix) {
  const i = file.lastIndexOf(".");
  return i < 0 ? file + suffix : file.slice(0, i) + suffix + file.slice(i);
}

// ------------------------------------------------------------- 3D 모델 자리 표시 스택(docs/DESIGN.md §3.10)
/**
 * 아이템 · 설치물 · 정답 폭탄은 3D 모델(models.js · props3d.js)이다. 그래도 그것을 부르는 길(drawStack — 퀴즈 판 · 설치물 · 아이템)은 그대로 두려고
 * 층 하나짜리 자리 표시 스택을 만든다: 프레임의 sheet = MODEL_SHEET + 모델 번호(stacks.js 가 그 층을 모델로 옮긴다).
 */
export const MODEL_SHEET = 100;
export const STUB_MODELS = [
  "quiz/bomb", "gadget/trap", "gadget/rally",
  "item/0", "item/1", "item/2", "item/3", "item/4", "item/5", "item/6", "item/9", "item/10", "item/11",
  "item/firework", "item/vortex", "item/drill", "item/wall", "item/trap", "item/smoke", "item/rally", "item/aegis", "item/spray", "item/range",
];
export function stubStack(id) {
  const k = STUB_MODELS.indexOf(id);
  if (k < 0) return null;
  const fr = { sheet: MODEL_SHEET + k, x: 0, y: 0 };
  return {
    id, kind: "model", w: 1, h: 1, count: 1, cols: 1, pad: 0, pitch: [1, 1], unit: 1, footprint: [1, 1], height: 1, outline: -1,
    poses: { idle: [fr], spin: [fr], wave: [fr] }, hat: null,
  };
}

// --------------------------------------------------------------------------------------------- 브라우저
/**
 * 아틀라스 목차(public/atlas/stacks.json)를 읽는다 — 그림 파일은 받지 않는다(바닥 · 장애물 · 아이템 · 캐릭터 모두 코드).
 * 목차가 없어도 3D 모델 자리 표시 스택만으로 늘 돌아간다.
 * @returns {Promise<{ atlas, textures: [], art: null, artSize, terrain: {}, bytes: 0, source, warnings, half }>}
 */
export async function loadStacks(THREE, base, { half = false } = {}) {
  let parsed = null;
  try {
    const res = await fetch(base + "stacks.json", { cache: "no-cache" });
    if (res.ok) parsed = parseStacks(await res.json());
  } catch {
    parsed = null;
  }
  const warnings = [];
  let atlas;
  if (parsed && parsed.ok) atlas = parsed.atlas;
  else {
    if (parsed) warnings.push("거부: " + parsed.reason);
    atlas = { version: 0, sheets: [], pad: 0, unit: 48, filter: "linear", keyRamp: KEY_RAMP.map(hexRgb), teamRamps: PALETTE.map((p) => rampFromHex(p.hex)), stacks: new Map(), flats: new Map(), props: new Map(), decals: new Map(), terrain: {}, half: null };
  }
  // 층 그림 스택은 쓰지 않는다 — 3D 모델 자리 표시로 바꾼다
  atlas.stacks = new Map(STUB_MODELS.map((id) => [id, stubStack(id)]));
  return { atlas, textures: [], art: null, artSize: [1, 1], terrain: {}, bytes: 0, source: parsed && parsed.ok ? "models" : "models(목차 없음)", warnings, half: false };
}
