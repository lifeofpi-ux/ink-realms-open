// 장애물 · 아이템 · 설치물을 three.js 3D 로 한꺼번에(docs/DESIGN.md §3.10): models.js 의 모델(지오메트리 한 장씩)을 BatchedMesh 에 넣고
// (WEBGL_multi_draw — 그리기 1번), 같은 내용의 외곽선 묶음(뒤집어 부풀린 껍질, 그리기 1번)을 하나 더 둔다.
//   - 정적: 칸 배열의 막힌 칸 묶음(props.js 의 groupBlocks — 2×1 · 1×2 · 2×2 결정적 묶음, 부서지면 그 묶음만 다시 나눔) → 모델 인스턴스.
//     칸 해시로 변형 · 방향(조금) · 크기 · 강조 색을 흩뜨린다. 폭발에 들썩이고, 다시 자랄 때 아래에서 솟는다.
//   - 동적: 아이템 · 정답 폭탄 · 덫 · 집결 깃발 · [왕국전] 건물 · 광산 · 연장을 프레임마다 push(이름마다 인스턴스 풀 — 안 쓰인 것은 숨긴다).
//   - 재질: 캐릭터와 같은 툰 3단계(그늘은 보랏빛, 빛은 왼쪽 위) + 발광 + 섬광 점광 + 안개 + 짙은 외곽선.
// [왕국전] 자원 줄이기(124칸 숲 지도 · 8팀):
//   - 정적 묶음과 동적 묶음을 나눴다. 동적 모델은 프레임마다 행렬을 쓰는데, 한 묶음이면 수천 개짜리 행렬 텍스처(256KB × 본 그림 · 외곽선)를
//     프레임마다 통째로 다시 올렸다. 이제 바뀐 행렬만(같은 값이면 건너뛴다) 줄 단위로 올린다.
//   - 정적 묶음의 화면 밖 버리기는 three 의 인스턴스마다 경계 구 검사(수천 개 × 두 묶음, 프레임마다) 대신 칸 덩이(8×8칸)로 —
//     화면 사각형에 걸친 덩이만 인스턴스를 본다.
//   - 외곽선 묶음은 본 그림 묶음과 정점 버퍼를 함께 쓴다(같은 모델을 같은 순서로 넣는다 — GPU 메모리 절반).
//   - LOD: 멀리 볼 때(setLod(1) — 화면 가로가 넓을 때 · 화질 저) 나무 · 건물 · 광산을 가벼운 변형("이름@1")으로.
//   - 그림자 맵 패스를 없앴다(바닥에 구운 그림자 — floorshade.js). SHADOW_LAYER 는 옛 이름으로만 남는다.
//   - 보기: 정점 AO(models.js 의 aFx.z — 부품끼리 · 바닥과 맞닿은 곳이 어둡다) + 하늘 · 땅 반구 빛 + 테두리 빛(블랙라이트 보라).
import * as THREE from "three";
import { buildModels, variantsOf, OBSTACLES, LOD_MODELS, isObstacle } from "./models.js";
import { groupBlocks, cellClass, hash } from "./props.js";
import { PROJ } from "./camera.js";
import { GLSL_LIGHTS, GLSL_FOG } from "./glsl.js";
import { STYLE } from "./style.js";

export const SHADOW_LAYER = 2;
const MAX_DYN = 1024; // 동적 모델 인스턴스(건물 · 광산 · 연장 · 아이템 …)
const POOL = 24; // 동적 모델 이름마다 미리 잡아 둘 인스턴스 수
const ACCENTS = [0xff2d95, 0xff7a00, 0xa8ff00, 0x00f0ff, 0xa24bff, 0xffe600];
const GROW_T = 0.55;
const CHUNK = 8; // 정적 묶음 덩이(칸)
const FULL_UPLOAD = 96; // 한 프레임에 바뀐 행렬이 이보다 많으면 행렬 텍스처를 통째로 올린다

const v3s = (a) => `vec3(${a.map((x) => x.toFixed(5)).join(", ")})`;
const LDIR = (() => {
  const r = PROJ.right, u = PROJ.up, v = PROJ.view;
  const l = [0, 1, 2].map((i) => -0.6 * r[i] + 0.7 * u[i] + 0.4 * v[i]);
  const n = Math.hypot(...l);
  return l.map((x) => x / n);
})();
const P = STYLE.props;

const VERT = /* glsl */ `
#include <batching_pars_vertex>
in vec3 aCol;
in vec3 aFx;
uniform float uMode;     // 0 본 그림 · 1 외곽선
uniform float uThick;
out vec3 vN;
out vec3 vW;
out vec3 vObj;
out vec3 vCol;
out vec3 vTint;
out vec3 vFx;
out vec2 vFog;
${GLSL_FOG}
void main() {
  mat4 bm = mat4(1.0);
  vec3 tint = vec3(1.0);
  #ifdef USE_BATCHING
    float bi = getIndirectIndex(gl_DrawID);
    bm = getBatchingMatrix(bi);
  #endif
  #ifdef USE_BATCHING_COLOR
    tint = getBatchingColor(bi).rgb;
  #endif
  vec4 w = modelMatrix * bm * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix * bm) * normal);
  if (uMode > 0.5) w.xyz += n * uThick;
  vN = n;
  vW = w.xyz;
  vObj = position;
  vCol = aCol;
  vTint = tint;
  vFx = aFx;
  vFog = fogK(vec2((modelMatrix * bm)[3].x, (modelMatrix * bm)[3].z));
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform float uMode;
uniform vec3 uLine;
in vec3 vN;
in vec3 vW;
in vec3 vObj;
in vec3 vCol;
in vec3 vTint;
in vec3 vFx;
in vec2 vFog;
layout(location = 0) out vec4 outColor;
${GLSL_LIGHTS}
${GLSL_FOG}
const vec3 LDIR = ${v3s(LDIR)};
const vec3 VDIR = ${v3s(PROJ.view)};
void main() {
  if (uMode > 0.5) { outColor = vec4(fogApply(uLine, vFog), 1.0); return; }
  vec3 N = normalize(vN);
  int use = int(vFx.y + 0.5);
  vec3 base = vCol;
  if (use == 1) base = vTint;
  else if (use == 4) base = vTint * 0.45;
  else if (use == 2 || use == 3) {
    float s = step(0.5, fract((vObj.x + vObj.y) * 4.0));
    vec3 hc = use == 3 ? vec3(1.0, 0.79, 0.0) : vTint;
    base = mix(vec3(0.016, 0.008, 0.024), hc, s);
  }
  float d = dot(N, LDIR);
  float band = d > 0.25 ? 1.0 : d > -0.25 ? ${P.mid.toFixed(3)} : ${P.dark.toFixed(3)};
  vec3 tint = mix(${v3s(P.shadowTint)}, vec3(1.0), smoothstep(${P.dark.toFixed(3)}, 1.0, band));
  // [왕국전] 하늘(위) · 땅(아래) 반구 빛 — 아래를 보는 면은 보랏빛으로 가라앉는다
  vec3 hemi = mix(vec3(0.78, 0.74, 0.98), vec3(1.04, 1.02, 1.0), N.y * 0.5 + 0.5);
  float ao = vFx.z;
  vec3 col = base * band * tint * hemi * ao * ${P.light.toFixed(3)};
  vec3 H = normalize(LDIR + VDIR);
  col += vec3(1.0) * smoothstep(0.55, 0.7, pow(max(dot(N, H), 0.0), 30.0)) * 0.18 * ao;
  // [왕국전] 테두리 빛(블랙라이트 보라 — 실루엣이 바닥과 갈린다)
  float rim = pow(1.0 - max(dot(N, VDIR), 0.0), 3.0);
  col += vec3(0.42, 0.3, 0.95) * rim * 0.22 * ao;
  col += base * vFx.x;
  col = shade(col, vW, N);
  outColor = vec4(fogApply(col, vFog), 1.0);
}`;

function makeMaterial(lightU, fogU, mode) {
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uMode: { value: mode }, uThick: { value: P.outline }, uLine: { value: new THREE.Color(STYLE.outline.color) }, ...lightU, ...fogU },
    side: mode ? THREE.BackSide : THREE.FrontSide,
  });
  if (!mode) Object.assign(mat, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
  return mat;
}

/** 본 그림 + 외곽선 묶음 한 쌍(정점 버퍼는 함께 쓴다) */
function makePair(geos, maxInst, lightU, fogU, perObjectCull) {
  let verts = 0;
  for (const g of geos.values()) verts += g.attributes.position.count;
  const mk = (mode) => {
    const bm = new THREE.BatchedMesh(maxInst, verts + 64, 0, makeMaterial(lightU, fogU, mode));
    bm.sortObjects = false;
    bm.perObjectFrustumCulled = perObjectCull;
    bm.frustumCulled = false;
    bm.renderOrder = mode ? 3 : 2;
    return bm;
  };
  const main = mk(0);
  const line = mk(1);
  const ids = new Map();
  for (const [name, g] of geos) {
    const a = main.addGeometry(g);
    const b = line.addGeometry(g);
    if (a !== b) console.warn("[props3d] 지오메트리 번호가 어긋났다", a, b);
    ids.set(name, a);
  }
  // 외곽선 묶음은 본 그림 묶음의 정점 버퍼를 그대로 쓴다(같은 모델 · 같은 순서 — 시작 · 개수가 같다)
  line.geometry.dispose();
  line.geometry = main.geometry;
  return { main, line, ids, verts };
}

/**
 * @param {object} lightU  섬광 점광 유니폼(glsl.js)
 * @param {object} fogU    안개 유니폼
 * @param {number} detail  1 · 화질 저 0.6
 */
export function createProps3D(lightU, fogU, detail = 1) {
  const geos = buildModels(detail, { lod: detail >= 0.85 });
  const tri = new Map([...geos].map(([k, g]) => [k, g.attributes.position.count / 3]));
  const staticGeos = new Map([...geos].filter(([k]) => isObstacle(k) && !/^(flag|lamp)\//.test(k)));
  const dynGeos = new Map([...geos].filter(([k]) => !staticGeos.has(k)));
  const dyn = makePair(dynGeos, MAX_DYN, lightU, fogU, true);
  let st = null; // 정적 묶음(경기장마다 크기에 맞춰 새로)
  const group = new THREE.Group();
  group.add(dyn.main, dyn.line);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e3 = new THREE.Euler();
  const p3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const col = new THREE.Color();
  let lod = 0;
  const lodName = (name) => (lod && geos.has(`${name}@1`) ? `${name}@1` : name);

  // ---------------------------------------------------------------- 묶음 쌍 다루기
  function pairOps(pair) {
    const hexOf = [];
    const changed = { m: 0, c: 0 };
    return {
      pair,
      hexOf,
      add(name) {
        const g = pair.ids.get(name);
        const a = pair.main.addInstance(g);
        const b = pair.line.addInstance(g);
        if (a !== b) console.warn("[props3d] 인스턴스 번호가 어긋났다", a, b);
        // [왕국전] addInstance 는 (지운 뒤 다시 쓰는 번호여도) 색을 흰색으로 되돌린다 — 색 기억을 지워 다음 setHex 가 꼭 쓰게 한다
        hexOf[a] = undefined;
        return a;
      },
      del(id) {
        pair.main.deleteInstance(id);
        pair.line.deleteInstance(id);
      },
      /** 행렬: 같은 값이면 건너뛰고, 바뀐 것만 줄 단위로 올린다(많으면 통째로) */
      setM(id, m) {
        const arr = pair.main._matricesTexture.image.data;
        const e = m.elements, o = id * 16;
        let same = true;
        for (let k = 0; k < 16; k++) if (arr[o + k] !== Math.fround(e[k])) { same = false; break; }
        if (same) return;
        pair.main.setMatrixAt(id, m);
        pair.line.setMatrixAt(id, m);
        if (++changed.m <= FULL_UPLOAD) {
          pair.main._matricesTexture.addUpdateRange(o, 16);
          pair.line._matricesTexture.addUpdateRange(o, 16);
        }
      },
      setHex(id, hex) {
        if (hexOf[id] === hex) return;
        hexOf[id] = hex;
        col.setHex(hex);
        pair.main.setColorAt(id, col);
        pair.line.setColorAt(id, col);
        if (++changed.c <= FULL_UPLOAD) {
          pair.main._colorsTexture.addUpdateRange(id * 4, 4);
          pair.line._colorsTexture.addUpdateRange(id * 4, 4);
        }
      },
      setV(id, v) {
        pair.main.setVisibleAt(id, v);
        pair.line.setVisibleAt(id, v);
      },
      setGeo(id, name) {
        const g = pair.ids.get(name);
        if (g === undefined) return;
        pair.main.setGeometryIdAt(id, g);
        pair.line.setGeometryIdAt(id, g);
      },
      /** 프레임 끝: 바뀐 것이 많았으면 줄 단위 대신 통째로 */
      flush() {
        if (changed.m > FULL_UPLOAD) {
          pair.main._matricesTexture.clearUpdateRanges();
          pair.line._matricesTexture.clearUpdateRanges();
        }
        if (changed.c > FULL_UPLOAD && pair.main._colorsTexture) {
          pair.main._colorsTexture.clearUpdateRanges();
          pair.line._colorsTexture.clearUpdateRanges();
        }
        changed.m = changed.c = 0;
      },
    };
  }
  const D = pairOps(dyn);
  let S = null;

  // ---------------------------------------------------------------- 동적(아이템 · 설치물 · 건물)
  const pools = new Map(); // 이름 → { ids, used, shown, names }
  function pool(name) {
    let p = pools.get(name);
    if (!p) {
      p = { ids: [], used: 0, shown: 0, names: [] };
      pools.set(name, p);
    }
    return p;
  }
  function begin() {
    for (const p of pools.values()) p.used = 0;
  }
  function end() {
    for (const p of pools.values()) {
      for (let i = p.used; i < p.shown; i++) D.setV(p.ids[i], false);
      p.shown = p.used;
    }
    D.flush();
    if (S) S.flush();
  }
  /** 동적 모델 하나: 가운데 (x, y, z), 도는 각, 색(0xRRGGBB), 크기 배율, (기울기 rx · rz) */
  function push(name, x, y, z, rot, hex, scale = 1, rx = 0, rz = 0) {
    if (!dynGeos.has(name)) return false;
    const p = pool(name);
    const want = lodName(name);
    if (p.used >= p.ids.length) {
      if (p.ids.length >= POOL * 4) return false;
      p.ids.push(D.add(want));
      p.names.push(want);
    }
    const k = p.used++;
    const id = p.ids[k];
    if (p.names[k] !== want) {
      D.setGeo(id, want);
      p.names[k] = want;
    }
    e3.set(rx, rot, rz);
    q.setFromEuler(e3);
    D.setM(id, m4.compose(p3.set(x, y, z), q, s3.setScalar(scale)));
    D.setHex(id, hex);
    if (p.used > p.shown) D.setV(id, true);
    return true;
  }

  // ---------------------------------------------------------------- 정적(칸 묶음)
  let G = null;
  let groups = [];
  let owner = new Int32Array(0);
  const grow = new Map();
  const jolts = new Map();
  let tempHex = (i) => 0xb9aee0;
  // 덩이: 칸 덩이마다 그 안의 묶음(가운데 칸 기준)
  let chunks = [];
  let CN = 0;
  const shownChunks = new Set();
  let visA = new Uint8Array(0); // 인스턴스 번호 → 지금 보이나

  function modelOf(g) {
    const n = G.n;
    const i = g.r * n + g.c;
    if (g.cls === "wall") return "wall1x1/0";
    if (g.cls === "board") return "board1x1/0";
    if (g.cls === "barrier") return "barrier1x1/0";
    if (g.cls === "tree") return `tree1x1/${Math.floor(hash(i, 21) * variantsOf("tree1x1")) % Math.max(1, variantsOf("tree1x1"))}`;
    const key = `${g.cls}${g.w}x${g.h}`;
    const nv = variantsOf(key);
    if (!nv) return `${g.cls}1x1/0`;
    return `${key}/${Math.floor(hash(i, 21) * nv) % nv}`;
  }
  const chunkOf = (g) => {
    const cx = Math.max(0, Math.min(CN - 1, Math.floor((g.c + g.w / 2) / CHUNK))), cz = Math.max(0, Math.min(CN - 1, Math.floor((g.r + g.h / 2) / CHUNK)));
    return chunks[cz * CN + cx];
  };

  function place(g) {
    const n = G.n;
    const i = g.r * n + g.c;
    g.model = modelOf(g);
    g.x = G.x0 + (g.c + g.w / 2) * G.size;
    g.z = G.z0 + (g.r + g.h / 2) * G.size;
    let rot = 0;
    if (g.cls === "wall") {
      // 둘레 벽: 경기장 안쪽을 본다
      const c = g.c, r = g.r;
      rot = r === n - 1 ? Math.PI : c === 0 ? Math.PI / 2 : c === n - 1 ? -Math.PI / 2 : 0;
      if (r === 0 || r === n - 1) rot = r === 0 ? 0 : Math.PI;
    } else if (g.cls !== "board") {
      const jit = 0.12;
      g.x += (hash(i, 22) - 0.5) * 2 * jit;
      g.z += (hash(i, 23) - 0.5) * 2 * jit;
      // 1×1 은 네 방향 중 하나 + 조금, 큰 묶음은 앞뒤 뒤집기 + 조금
      const quarter = g.w === g.h ? Math.floor(hash(i, 24) * 4) * (Math.PI / 2) : hash(i, 24) < 0.5 ? 0 : Math.PI;
      rot = quarter + (hash(i, 25) - 0.5) * 0.18;
    }
    g.rot = rot;
    g.scale = g.cls === "wall" || g.cls === "board" ? 1 : 0.94 + hash(i, 26) * 0.1;
    g.hex = g.cls === "barrier" ? tempHex(i) : g.cls === "wall" ? STYLE.props.wallNeon : ACCENTS[Math.floor(hash(i, 27) * ACCENTS.length)];
    g.cur = lodName(g.model);
    g.id = S.add(g.cur);
    S.hexOf[g.id] = -1;
    S.setHex(g.id, g.hex);
    pose(g, 0, 1);
    // 덩이에 넣고, 그 덩이가 지금 보이지 않으면 숨겨 둔다(다음 cull 이 다시 본다)
    const ch = chunkOf(g);
    g.chunk = ch;
    ch.list.add(g);
    if (visA.length <= g.id) {
      const nv = new Uint8Array(Math.max(g.id + 1, visA.length * 2));
      nv.set(visA);
      visA = nv;
    }
    if (shownChunks.has(ch)) {
      visA[g.id] = 1;
      ch.dirty = true;
    } else {
      S.setV(g.id, false);
      visA[g.id] = 0;
    }
  }
  function unplace(g) {
    if (g.chunk) g.chunk.list.delete(g);
    S.del(g.id);
    if (g.id < visA.length) visA[g.id] = 0;
  }
  function pose(g, jy, gr) {
    e3.set(0, g.rot, 0);
    q.setFromEuler(e3);
    S.setM(g.id, m4.compose(p3.set(g.x, jy, g.z), q, s3.set(g.scale, g.scale * gr, g.scale)));
  }
  function index() {
    owner.fill(-1);
    groups.forEach((g, k) => g.cells.forEach((i) => (owner[i] = k)));
  }

  /** 정적 묶음 쌍을 이 경기장 크기에 맞춰 새로 */
  function buildStatic(count) {
    if (st) {
      group.remove(st.main, st.line);
      st.main.dispose();
      st.line.dispose();
      st.main.material.dispose();
      st.line.material.dispose();
    }
    st = makePair(staticGeos, Math.max(64, Math.ceil(count * 1.15) + 64), lightU, fogU, false);
    group.add(st.main, st.line);
    S = pairOps(st);
  }

  // 화면 밖 버리기(칸 덩이 단위): rect = 바닥 사각형(월드 u). 덩이가 들면 그 안 묶음을 하나씩, 빠지면 통째로 숨긴다
  const M_X = 1.6, M_NEAR = 1.6, M_FAR = 3.4; // 묶음 반지름 · 높이만큼 여유(먼 쪽은 나무 · 기둥 키가 화면 위로 솟는다)
  const want = new Set();
  function cull(rect) {
    if (!G || !S) return;
    want.clear();
    const cs = CHUNK * G.size;
    const cx0 = Math.max(0, Math.floor((rect.x0 - M_X - 2 - G.x0) / cs)), cx1 = Math.min(CN - 1, Math.floor((rect.x1 + M_X + 2 - G.x0) / cs));
    const cz0 = Math.max(0, Math.floor((rect.z0 - M_FAR - 2 - G.z0) / cs)), cz1 = Math.min(CN - 1, Math.floor((rect.z1 + M_NEAR + 2 - G.z0) / cs));
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) want.add(chunks[cz * CN + cx]);
    for (const ch of shownChunks) {
      if (want.has(ch)) continue;
      for (const g of ch.list) if (visA[g.id]) { S.setV(g.id, false); visA[g.id] = 0; }
      shownChunks.delete(ch);
    }
    const x0 = rect.x0 - M_X, x1 = rect.x1 + M_X, z0 = rect.z0 - M_FAR, z1 = rect.z1 + M_NEAR;
    for (const ch of want) {
      // 덩이가 통째로 안이면(그리고 지난번에도 통째로 안이었으면) 볼 것이 없다
      const inside = ch.x0 >= x0 && ch.x1 <= x1 && ch.z0 >= z0 && ch.z1 <= z1;
      if (inside && ch.full && shownChunks.has(ch) && !ch.dirty) continue;
      for (const g of ch.list) {
        const v = g.x >= x0 && g.x <= x1 && g.z >= z0 && g.z <= z1 ? 1 : 0;
        if (visA[g.id] !== v) {
          if (v && g.cur !== lodName(g.model)) {
            g.cur = lodName(g.model);
            S.setGeo(g.id, g.cur);
          }
          S.setV(g.id, !!v);
          visA[g.id] = v;
        }
      }
      ch.full = inside;
      ch.dirty = false;
      shownChunks.add(ch);
    }
  }

  return {
    meshes: [group],
    group,
    get main() {
      return st ? st.main : dyn.main;
    },
    has: (name) => geos.has(name),
    get vertices() {
      return (st ? st.verts : 0) + dyn.verts;
    },
    /** 모델 한 개의 삼각형 수 */
    triangles: (name) => tri.get(name) || 0,
    /** 화면 안 삼각형(대략 — 보이는 인스턴스 합. 외곽선 포함 × 2) */
    visibleTriangles() {
      let t = 0;
      for (const g of groups) if (visA[g.id]) t += tri.get(g.cur) || 0;
      for (const [name, p] of pools) t += (tri.get(lodName(name)) || 0) * p.shown;
      return t * 2;
    },
    setTempColor(fn) {
      tempHex = fn;
    },
    /** [왕국전] 모델 단계: 0 = 고운 모델, 1 = 멀리 볼 때 가벼운 변형(나무 · 건물 · 광산) */
    setLod(v) {
      const L = v ? 1 : 0;
      if (L === lod) return;
      lod = L;
      // 보이는 정적 묶음만 바로 바꾼다(숨은 것은 다시 보일 때 cull 이 바꾼다)
      for (const g of groups) {
        if (!visA[g.id]) continue;
        const w = lodName(g.model);
        if (g.cur !== w) {
          g.cur = w;
          S.setGeo(g.id, w);
        }
      }
    },
    get lod() {
      return lod;
    },
    setArena(grid) {
      if (S) for (const g of groups) unplace(g);
      groups = [];
      G = grid;
      grow.clear();
      jolts.clear();
      shownChunks.clear();
      if (!G) return;
      owner = new Int32Array(G.n * G.n).fill(-1);
      const list = groupBlocks(G, null, { solid: ["2x2", "2x1", "1x2"], soft: ["2x1"] });
      buildStatic(list.length);
      visA = new Uint8Array(Math.max(64, Math.ceil(list.length * 1.15) + 64));
      CN = Math.ceil(G.n / CHUNK);
      chunks = [];
      for (let cz = 0; cz < CN; cz++) for (let cx = 0; cx < CN; cx++) {
        const x0 = G.x0 + cx * CHUNK * G.size, z0 = G.z0 + cz * CHUNK * G.size;
        // 묶음 가운데는 덩이 안 + 지터 · 2칸 묶음 반폭만큼 밖으로 나갈 수 있다
        chunks.push({ list: new Set(), x0: x0 - 2, z0: z0 - 2, x1: x0 + CHUNK * G.size + 2, z1: z0 + CHUNK * G.size + 2, full: false, dirty: true });
      }
      groups = list;
      groups.forEach(place);
      index();
    },
    /** [왕국전] 바닥에 구울 그림자 주인(floorshade.js): 정적 묶음마다 { x, z, rx, rz, h0, h1 }. r = { x0, z0, x1, z1 } 이면 그 둘레 덩이의 것만 */
    casters(r = null) {
      const out = [];
      let list = groups;
      if (r && G) {
        list = [];
        const cs = CHUNK * G.size;
        const cx0 = Math.max(0, Math.floor((r.x0 - 2 - G.x0) / cs)), cx1 = Math.min(CN - 1, Math.floor((r.x1 + 2 - G.x0) / cs));
        const cz0 = Math.max(0, Math.floor((r.z0 - 2 - G.z0) / cs)), cz1 = Math.min(CN - 1, Math.floor((r.z1 + 2 - G.z0) / cs));
        for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) for (const g of chunks[cz * CN + cx].list) list.push(g);
      }
      for (const g of list) {
        const geo = geos.get(g.model);
        if (!geo) continue;
        const bb = geo.boundingBox;
        const s = g.scale;
        let rx = Math.max(-bb.min.x, bb.max.x) * s, rz = Math.max(-bb.min.z, bb.max.z) * s;
        // 네 방향 중 옆으로 돌았으면(1×1 · 2×2) 축을 바꾼다
        if (Math.abs(Math.sin(g.rot)) > 0.7) [rx, rz] = [rz, rx];
        const h = bb.max.y * s;
        if (g.cls === "tree") {
          // 줄기(가늘게) + 둥근 잎(잎 높이에서) — 잎 그림자가 나무 오른쪽 아래로 떨어진다
          out.push({ x: g.x, z: g.z, rx: 0.22, rz: 0.22, h0: 0, h1: h * 0.45, ao: false });
          out.push({ x: g.x, z: g.z, rx: rx * 0.92, rz: rz * 0.92, h0: h * 0.45, h1: h * 0.82, ao: false });
          out.push({ x: g.x, z: g.z, rx: 0.5, rz: 0.5, h0: 0, h1: 0, k: 0.75 }); // 발밑 접지
        } else {
          out.push({ x: g.x, z: g.z, rx: rx * 0.88, rz: rz * 0.88, h0: 0, h1: h * 0.9, k: g.cls === "wall" ? 0.8 : 1 });
        }
      }
      return out;
    },
    /** 칸 i 의 블록이 부서졌다(on false) · 다시 자랐다(true): 그 묶음만 다시 나눈다 */
    changed(i, on) {
      if (!G) return;
      const k = owner[i];
      if (!on) {
        if (k >= 0) {
          const g = groups[k];
          groups.splice(k, 1);
          unplace(g);
          const rest = g.cells.filter((j) => j !== i && G.standing(j));
          for (const ng of groupBlocks(G, rest, { solid: ["2x2", "2x1", "1x2"], soft: ["2x1"] })) {
            place(ng);
            groups.push(ng);
          }
        }
      } else if (k < 0 && G.standing(i)) {
        const ng = { c: i % G.n, r: (i / G.n) | 0, w: 1, h: 1, cls: cellClass(G, i), cells: [i] };
        place(ng);
        groups.push(ng);
        grow.set(i, 0);
      }
      index();
    },
    jolt(x, z, radius, power = 1, delayPerU = 0) {
      if (!G) return;
      // [왕국전] 둘레 덩이만 본다(예전: 묶음 수천 개를 다 훑었다)
      const cs = CHUNK * G.size, rr = radius + 3;
      const cx0 = Math.max(0, Math.floor((x - rr - G.x0) / cs)), cx1 = Math.min(CN - 1, Math.floor((x + rr - G.x0) / cs));
      const cz0 = Math.max(0, Math.floor((z - rr - G.z0) / cs)), cz1 = Math.min(CN - 1, Math.floor((z + rr - G.z0) / cs));
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        for (const g of chunks[cz * CN + cx].list) {
          if (g.cls === "wall" || g.cls === "board") continue;
          const d = Math.hypot(g.x - x, g.z - z);
          if (d > radius + 1) continue;
          const k = Math.max(0, 1 - d / (radius + 1));
          jolts.set(g.cells[0], { g, y: 0, v: 3.2 * (power * k * 0.5 + 0.05 * power), wait: d * delayPerU });
        }
      }
    },
    update(dt) {
      const h = Math.min(dt, 1 / 30);
      for (const [i, j] of jolts) {
        if (j.wait > 0) {
          j.wait -= dt;
          continue;
        }
        j.v += (-160 * j.y - 9 * j.v) * h;
        j.y += j.v * h;
        if (j.y < 0) {
          j.y = 0;
          j.v *= -0.35;
        }
        const ok = owner[j.g.cells[0]];
        const alive = ok >= 0 && groups[ok] === j.g;
        if (alive) pose(j.g, j.y, 1);
        if (!alive || (Math.abs(j.v) < 0.02 && j.y < 0.002)) {
          if (alive) pose(j.g, 0, 1);
          jolts.delete(i);
        }
      }
      for (const [i, t] of grow) {
        const tt = t + dt;
        const k = owner[i];
        const g = k >= 0 ? groups[k] : null;
        if (g) {
          const e = Math.min(1, tt / GROW_T);
          const gr = Math.max(0.02, 1 - Math.pow(1 - e, 3) + Math.sin(e * Math.PI) * 0.12);
          pose(g, 0, gr);
        }
        if (tt >= GROW_T || !g) {
          if (g) pose(g, 0, 1);
          grow.delete(i);
        } else grow.set(i, tt);
      }
    },
    cull,
    begin,
    end,
    push,
    get groups() {
      return groups;
    },
    /** 개발용: 정적 묶음 중 지금 보이는 수 · 동적 모델 수 */
    get counts() {
      let s = 0;
      for (const g of groups) s += visA[g.id];
      let d = 0;
      for (const p of pools.values()) d += p.shown;
      return { static: s, staticAll: groups.length, dynamic: d };
    },
    dispose() {
      for (const pr of st ? [st, dyn] : [dyn]) {
        pr.main.dispose();
        pr.line.dispose(); // 정점 버퍼는 함께 쓰지만 행렬 · 색 텍스처는 따로
        pr.main.material.dispose();
        pr.line.material.dispose();
      }
    },
  };
}

export { OBSTACLES, LOD_MODELS };

/** 지금 쓰이는 묶음(층 스택 자리 표시 · 아이템이 3D 모델을 넣는 길 — world.js 가 정한다) */
let active = null;
export const setActiveProps = (p) => (active = p);
export const activeProps = () => active;
