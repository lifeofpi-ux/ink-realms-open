// 고르기 화면용 초상(docs/DESIGN.md §3.9 "고르기"): 캐릭터 종류 하나를 정면 조금 위에서 본 상반신 — 눈 창과 머리 모양이 잘 보이게, 투명 바탕.
// 경기 화면과 같은 3D 인형 · 같은 셰이더(figures.js)로 그린다: 작은 무늬 시트(칸 하나) · 경기와 같은 눈 아틀라스를 쓰는 묶음 하나를 따로 두고,
// 렌더러의 WebGL 로 작은 그리기 타깃에 2배로 그려 읽어 낸 뒤 줄여 캔버스로 돌려준다. (종류, 색, 크기)마다 한 번만 그리고 캐시한다.
//
//   const charPortrait = createPortraits(renderer)   // renderer = three WebGLRenderer (R.renderer)
//   charPortrait(char 0~7, 0xRRGGBB, px) -> HTMLCanvasElement(px × px)
import * as THREE from "three";
import { createFigures } from "./figures.js";
import { makeRig } from "./characters.js";
import { lightUniforms, fogUniforms } from "./glsl.js";
import { PROJ } from "./camera.js";
import { CHARACTERS, charOf } from "./charset.js";
import { EXPR } from "./eyes.js";

export { CHARACTERS };

/** 초상의 시점: 경기 카메라와 같은 방위(빛이 같은 왼쪽 위에서 온다)에서 18° 위 */
const ELEV = (18 * Math.PI) / 180;

export function createPortraits(renderer) {
  const cache = new Map();
  let figs = null;
  let scene = null;
  let cam = null;
  let rt = null;
  let buf = null;

  function setup() {
    figs = createFigures({ ...lightUniforms(THREE), ...fogUniforms(THREE) }, { cell: 256, cols: 1, rows: 1 });
    figs.setSrgbOut(true);
    scene = new THREE.Scene();
    scene.add(figs.main, figs.outline);
    cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
  }

  /** 캐릭터 하나를 그리기 타깃(px²)에 그리고 화소를 읽는다 */
  function renderOne(char, hex, px) {
    if (!figs) setup();
    if (!rt || rt.width !== px) {
      if (rt) rt.dispose();
      rt = new THREE.WebGLRenderTarget(px, px, { depthBuffer: true, stencilBuffer: true });
      buf = new Uint8Array(px * px * 4);
    }
    const def = CHARACTERS[char];
    const R = makeRig(char);
    const hx = PROJ.view[0], hz = PROJ.view[2];
    const hl = Math.hypot(hx, hz) || 1;
    const dir = new THREE.Vector3((hx / hl) * Math.cos(ELEV), Math.sin(ELEV), (hz / hl) * Math.cos(ELEV));
    // 카메라 쪽을 보되 살짝 돌려(3/4) 머리 모양이 입체로 보이게
    const face = Math.atan2(dir.z, dir.x) + 0.28;
    R.yaw.rotation.y = -face;
    for (const arm of R.arms) arm.rotation.set(-arm.userData.side * 0.3, 0, 0.15);
    R.root.updateMatrixWorld(true);
    const parts = R.parts.slice();
    parts[6] = null;
    figs.begin();
    figs.push(parts, hex, def.pattern, char, EXPR.open, 0, 0, 0, 0, 0);
    // 작은 그림은 머리 쪽으로 더 다가간다
    const small = px < 110;
    const half = small ? 0.88 : 1.0;
    const target = new THREE.Vector3(0, small ? 1.62 : 1.52, 0);
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.position.copy(target).addScaledVector(dir, 20);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);

    const prevRT = renderer.getRenderTarget();
    const prevColor = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    try {
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = false;
      renderer.clear(true, true, true);
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, px, px, buf);
    } finally {
      renderer.setRenderTarget(prevRT);
      renderer.setClearColor(prevColor, prevAlpha);
      renderer.autoClear = prevAuto;
    }
    return buf;
  }

  /**
   * (종류, 색, 크기) 의 초상 캔버스(투명 바탕). 그리지 못하면(문맥 잃음 등) 빈 캔버스를 돌려주고 캐시하지 않는다.
   * @param {number} char 0~7
   * @param {number} colorHex 0xRRGGBB(팀 색 · 중립 색)
   * @param {number} size 픽셀(정사각)
   */
  return function charPortrait(char, colorHex = 0xd6cfee, size = 72) {
    const c = charOf(char, 0);
    const hex = Number.isFinite(colorHex) ? colorHex & 0xffffff : 0xd6cfee;
    const s = Math.max(16, Math.min(512, Math.round(size) || 72));
    const key = `${c}|${hex}|${s}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const out = document.createElement("canvas");
    out.width = out.height = s;
    const gl = renderer && renderer.getContext && renderer.getContext();
    if (!gl || gl.isContextLost()) return out;
    const px = Math.min(1024, s * 2);
    let data;
    try {
      data = renderOne(c, hex, px);
    } catch (e) {
      console.warn("charPortrait", e);
      return out;
    }
    // 읽은 화소는 아래에서 위로 — 뒤집어 2배 캔버스에 놓고, 줄여서 그린다
    const big = document.createElement("canvas");
    big.width = big.height = px;
    const bctx = big.getContext("2d");
    const img = bctx.createImageData(px, px);
    const row = px * 4;
    for (let y = 0; y < px; y++) img.data.set(data.subarray((px - 1 - y) * row, (px - y) * row), y * row);
    bctx.putImageData(img, 0, 0);
    const ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(big, 0, 0, s, s);
    cache.set(key, out);
    return out;
  };
}
