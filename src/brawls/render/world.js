// 월드(docs/DESIGN.md §3.12 · §3.10): 바닥(terrain.js — 원본 ink-brawl "잉크 공장" 철판을 셰이더로, 그리기 1번) +
// 장애물 · 아이템 · 설치물(props3d.js — three.js 3D 모델을 BatchedMesh 로, 정적 · 동적 × 본 그림 · 외곽선) + 퀴즈 전광판 판(상자 인스턴스 1번) +
// [왕국전] 바닥에 구운 그림자 · 접지 어둠(floorshade.js — 경기장이 바뀌거나 블록 · 건물이 바뀔 때만 CPU 에서 다시 굽는다).
//   예전의 그림자 맵(프레임마다 빛 카메라로 장애물 · 캐릭터 · 몬스터를 한 번 더 — 1024²)은 없앴다. 모든 화질에서 바닥 그림자가 보이고,
//   움직이는 것(캐릭터 · 몬스터 · 풍선)은 발밑 얼룩(데칼)이 맡는다.
// 그림 파일을 받지 않는다(바닥 무늬 · 장애물 · 아이템 모두 코드).
import * as THREE from "three";
import { createTerrain } from "./terrain.js";
import { createProps3D, setActiveProps } from "./props3d.js";
import { bakeFloorShade } from "./floorshade.js";
import { GLSL_LIGHTS, GLSL_FOG } from "./glsl.js";
import { BLOCK_H, CELL } from "./grid.js";
import { STYLE } from "./style.js";

const MAX_BOX = 160;

const BOX_VERT = /* glsl */ `
in vec4 iCol;   // 몸 색(선형) · 발광
out vec3 vN;
out vec2 vUv;
out vec3 vW;
flat out vec4 vCol;
flat out vec2 vFog;
${GLSL_FOG}
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vUv = uv;
  vW = w.xyz;
  vCol = iCol;
  vFog = fogK(w.xz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const BOX_FRAG = /* glsl */ `
uniform vec3 uEdge;
uniform vec3 uGlowC;
in vec3 vN;
in vec2 vUv;
in vec3 vW;
flat in vec4 vCol;
flat in vec2 vFog;
layout(location = 0) out vec4 outColor;
${GLSL_LIGHTS}
${GLSL_FOG}
void main() {
  // 면마다 칠한 명암(빛은 왼쪽 위) + 가장자리 짙은 선 + 안쪽 형광 테
  float lit = 0.55 + 0.45 * max(dot(vN, normalize(vec3(-0.4, 0.8, 0.45))), 0.0);
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = min(e.x, e.y);
  float aa = fwidth(edge) * 1.5;
  vec3 col = vCol.rgb * lit;
  col = mix(col, uGlowC * (1.0 + vCol.a * 2.0), (1.0 - smoothstep(0.035, 0.035 + aa, edge)) * smoothstep(0.012, 0.012 + aa, edge) * 0.9);
  col = mix(uEdge, col, smoothstep(0.012 - aa, 0.012, edge));
  col += vCol.rgb * vCol.a;
  col = shade(col, vW, vN);
  outColor = vec4(fogApply(col, vFog), 1.0);
}`;

export function createWorld(inkTexture, lightU, fogU, inkU = null) {
  const terrain = createTerrain(inkTexture, lightU, fogU, inkU);
  const propsGroup = new THREE.Group();
  let props = null;
  let detail = -1;
  let A = null;
  let G = null;
  function buildProps(d) {
    if (d === detail) return;
    detail = d;
    if (props) {
      for (const m of props.meshes) propsGroup.remove(m);
      props.dispose(); // 지오메트리 · 행렬 · 색 텍스처(화질을 바꿀 때 GPU 메모리가 쌓이지 않게)
    }
    props = createProps3D(lightU, fogU, d);
    props.setTempColor((i) => (G && G.temp && G.temp.get(i)) ?? 0xb9aee0);
    for (const m of props.meshes) propsGroup.add(m);
    setActiveProps(props);
    if (G) props.setArena(G);
    shadeDirty = shadeFull = true;
  }

  // ------------------------------------------------------------------ [왕국전] 구운 바닥 그림자(floorshade.js)
  let shadeTex = null;
  let shadeDirty = true;
  let shadeFull = true; // 통째로 다시(경기장 · 건물 · 화질이 바뀜) — 아니면 region 만(블록이 부서짐 · 자람)
  let region = null; // { c0, r0, c1, r1 } 칸
  let shadeAge = 1e9; // 마지막으로 구운 뒤 흐른 시간(초)
  let shadeBytes = 0;
  let extra = []; // 건물 · 광산(brawlscene 이 setCasters 로)
  const stats = { bakeMs: 0, bakes: 0 };
  function rebake() {
    shadeDirty = false;
    shadeAge = 0;
    if (!G || !props) return;
    const t0 = performance.now();
    const T = G.n > 90 ? 4 : 6; // 칸마다 텍셀(124칸 지도 = 496², 작은 지도는 더 곱게)
    const prev = shadeTex && shadeTex.image.width === G.n * T ? shadeTex.image.data : null;
    const part = !shadeFull && region && prev;
    let casters;
    if (part) {
      // 부서진 칸 둘레만: 그 둘레(그림자가 닿는 거리 + 흐림 여유) 주인만 모아 그 사각형을 다시 굽는다
      const r = { x0: G.x0 + region.c0 * G.size - 6, z0: G.z0 + region.r0 * G.size - 6, x1: G.x0 + (region.c1 + 1) * G.size + 2, z1: G.z0 + (region.r1 + 1) * G.size + 2 };
      casters = props.casters(r);
      for (const c of extra) if (c.x > r.x0 - 6 && c.x < r.x1 + 6 && c.z > r.z0 - 6 && c.z < r.z1 + 6) casters.push(c);
    } else {
      casters = props.casters();
      for (const c of extra) casters.push(c);
    }
    const { W, data } = bakeFloorShade(G, casters, T, prev, part ? region : null);
    shadeFull = false;
    region = null;
    if (shadeTex && shadeTex.image.width === W) shadeTex.needsUpdate = true;
    else {
      shadeTex && shadeTex.dispose();
      shadeTex = new THREE.DataTexture(data, W, W, THREE.RGFormat, THREE.UnsignedByteType);
      shadeTex.minFilter = shadeTex.magFilter = THREE.LinearFilter;
      shadeTex.wrapS = shadeTex.wrapT = THREE.ClampToEdgeWrapping;
      shadeTex.generateMipmaps = false;
      shadeTex.needsUpdate = true;
    }
    shadeBytes = W * W * 2;
    terrain.setShade(shadeTex);
    stats.bakeMs = performance.now() - t0;
    stats.bakes++;
  }
  buildProps(1);

  // ------------------------------------------------------------------ 전광판 판(상자)
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const iCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BOX * 4), 4).setUsage(THREE.DynamicDrawUsage);
  boxGeo.setAttribute("iCol", iCol);
  const boxMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: BOX_VERT,
    fragmentShader: BOX_FRAG,
    uniforms: { uEdge: { value: new THREE.Color(0x100922) }, uGlowC: { value: new THREE.Color(0xa24bff) }, ...lightU, ...fogU },
  });
  Object.assign(boxMat, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
  const boxes = new THREE.InstancedMesh(boxGeo, boxMat, MAX_BOX);
  boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  boxes.frustumCulled = false;
  boxes.count = 0;
  boxes.renderOrder = 3;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e3 = new THREE.Euler(0, 0, 0, "YXZ");
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const col = new THREE.Color();
  const BODY = { panel: 0x2b1f55, board: 0x2b1f55 };
  let nb = 0;

  // 홈 깃대 · 가로등(팀 색 — 블록이 아닌 장식): 프레임마다 동적 모델로
  let homeHex = [];
  const homeDeco = [];
  function layoutHomes() {
    homeDeco.length = 0;
    if (!G || !A) return;
    for (const h of A.homes || []) {
      if (!(h.c1 >= h.c0)) continue;
      const x0 = G.x0 + h.c0 * G.size, x1 = G.x0 + (h.c1 + 1) * G.size, z0 = G.z0 + h.r0 * G.size, z1 = G.z0 + (h.r1 + 1) * G.size;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const horiz = Math.abs(cx) > Math.abs(cz);
      const fx = horiz ? (cx > 0 ? x1 - 0.7 : x0 + 0.7) : cx;
      const fz = horiz ? cz : cz > 0 ? z1 - 0.7 : z0 + 0.7;
      homeDeco.push({ name: "flag/0", x: fx, z: fz, home: h.id });
      const lamps = horiz ? [[cx > 0 ? x0 + 0.4 : x1 - 0.4, z0 + 0.4], [cx > 0 ? x0 + 0.4 : x1 - 0.4, z1 - 0.4]] : [[x0 + 0.4, cz > 0 ? z0 + 0.4 : z1 - 0.4], [x1 - 0.4, cz > 0 ? z0 + 0.4 : z1 - 0.4]];
      for (const [lx, lz] of lamps) homeDeco.push({ name: "lamp/0", x: lx, z: lz, home: h.id });
    }
  }

  return {
    meshes: [terrain.mesh, propsGroup, boxes],
    terrain,
    get props() {
      return props;
    },
    get artBytes() {
      return 0;
    },
    get artSource() {
      return "code";
    },
    /** inkRect = { e, cx, cz } 잉크 캔버스가 덮는 범위(없으면 경기장 전체 — 던전은 보이는 레인만) */
    setArena(arena, grid, inkRect = null) {
      A = arena;
      G = grid;
      terrain.setArena(arena, grid, inkRect);
      props.setArena(grid);
      extra = [];
      layoutHomes();
      shadeFull = true;
      rebake();
    },
    /** [왕국전] 바닥에 구울 그림자 주인을 더한다(건물 · 광산 — floorshade.js 의 caster 목록). 바뀌면 곧 다시 굽는다 */
    setCasters(list) {
      extra = list || [];
      shadeDirty = shadeFull = true;
    },
    /** [왕국전] 모델 단계(0 고운 · 1 멀리 볼 때 가벼운) */
    setLod(v) {
      props.setLod(v);
    },
    get shadeStats() {
      return stats;
    },
    /** (옛 길) 애셋 맵 그림 — 이제 받지 않는다(바닥 · 장애물이 모두 코드) */
    setMapArt() {},
    /** 홈 번호 → 팀 색(0xRRGGBB, −1 = 모름) */
    setHomeColors(list) {
      homeHex = list || [];
      terrain.setHomeColors(list);
    },
    /** 화질: 중 · 고(on) = 고운 모델(+ 멀리 볼 때 LOD), 저 = 분할을 줄인 모델. 바닥 그림자는 모든 화질에서 구운 것 */
    setDetail(on) {
      buildProps(on ? 1 : 0.6);
      terrain.uniforms.uDetail.value = on ? 1 : 0;
    },
    get shadows() {
      return !!shadeTex;
    },
    /** 칸 i 의 블록이 부서졌다 · 다시 자랐다 */
    blockChanged(i, on) {
      props.changed(i, !!on);
      shadeDirty = true;
      if (G) {
        // 그 칸 둘레(그림자가 오른쪽 아래로 2칸까지 · 위 · 왼쪽 1칸)만 다시 굽는다
        const c = i % G.n, r = (i / G.n) | 0;
        const c0 = Math.max(0, c - 1), r0 = Math.max(0, r - 1), c1 = Math.min(G.n - 1, c + 3), r1 = Math.min(G.n - 1, r + 3);
        region = region ? { c0: Math.min(region.c0, c0), r0: Math.min(region.r0, r0), c1: Math.max(region.c1, c1), r1: Math.max(region.r1, r1) } : { c0, r0, c1, r1 };
      }
    },
    jolt(x, z, radius, power, wave) {
      props.jolt(x, z, radius, power, wave);
    },
    update(dt, time) {
      props.update(dt);
      terrain.uniforms.uTime.value = time;
      // 다시 굽기는 0.3초에 한 번까지(블록이 연달아 부서져도 한꺼번에)
      shadeAge += dt;
      if (shadeDirty && shadeAge > 0.3) rebake();
    },
    begin() {
      props.begin();
      nb = 0;
    },
    /** 상자 하나(전광판 판): 가운데 (x, y, z), 크기 (sx, sy, sz), 이름(panel), 발광, 회전 rx(앞으로 기울임) · ry */
    box(x, y, z, sx, sy, sz, tile = "panel", glow = 0, rx = 0, ry = 0) {
      if (nb >= MAX_BOX) return;
      e3.set(rx, ry, 0);
      q.setFromEuler(e3);
      m4.compose(v3.set(x, y, z), q, s3.set(sx, sy, sz));
      boxes.setMatrixAt(nb, m4);
      col.setHex(BODY[tile] ?? BODY.panel);
      iCol.array[nb * 4] = col.r;
      iCol.array[nb * 4 + 1] = col.g;
      iCol.array[nb * 4 + 2] = col.b;
      iCol.array[nb * 4 + 3] = glow;
      nb++;
    },
    /** 화면 안의 장식(홈 깃대 · 가로등) + [왕국전] 정적 장애물의 화면 밖 버리기(칸 덩이 — props3d.cull) */
    drawBlocks(r) {
      props.cull(r);
      for (const d of homeDeco) {
        if (d.x < r.x0 - 3 || d.x > r.x1 + 3 || d.z < r.z0 - 3 || d.z > r.z1 + 5) continue;
        const hex = homeHex[d.home] >= 0 ? homeHex[d.home] : 0x00f0ff;
        props.push(d.name, d.x, 0, d.z, 0, hex, 1);
      }
    },
    end() {
      props.end();
      boxes.count = nb;
      boxes.instanceMatrix.clearUpdateRanges();
      boxes.instanceMatrix.addUpdateRange(0, nb * 16);
      boxes.instanceMatrix.needsUpdate = true;
      iCol.clearUpdateRanges();
      iCol.addUpdateRange(0, nb * 4);
      iCol.needsUpdate = true;
    },
    get count() {
      return (props ? props.groups.length : 0) + nb;
    },
    get grid() {
      return G;
    },
    get bytes() {
      return terrain.bytes + shadeBytes;
    },
    BLOCK_H,
  };
}
