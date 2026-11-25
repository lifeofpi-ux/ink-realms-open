// 전장의 안개(docs/DESIGN.md §3.8): 팀이 시야를 함께 쓴다 — 판정은 서버와 같은 shared/fog.js(makeVision · canSee, 수치 FOG).
// main.js 가 프레임마다 game.vision() 을 setVision 으로 넘긴다(안개가 꺼진 경기 · 진행자 · 대기 화면이면 null → 다 보인다).
// [왕국전] 칸에 한 점(2u)의 저해상도 텍스처 한 장(R = 지금 보임, G = 가 본 곳)을 초당 FOG_HZ 번 CPU 에서 다시 계산하고, 매 프레임 부드럽게
// 따라가게 해 올린다. 바닥 · 장애물 그림 · 층 스택 셰이더가 이것을 곱한다(glsl.js 의 GLSL_FOG — 그리기 호출은 늘지 않는다).
import { canSee } from "../shared/fog.js";

export const FOG_HZ = 6;

export function createFog(THREE, U) {
  let G = null;
  let W = 1, H = 1, x0 = 0, z0 = 0, cell = 1;
  let vis = new Float32Array(1); // 화면에 보이는 값(따라가는 중)
  let seenV = new Float32Array(1);
  let target = new Uint8Array(1); // 지금 보임(목표)
  let explored = new Uint8Array(1); // 가 본 곳
  let data = new Uint8Array(4);
  let tex = null;
  let wanted = true; // 꺼 두기(개발용 · 진행자)
  let active = false;
  let vision = null;
  let acc = 1;
  let settled = false; // 보이는 값이 목표에 다 닿았다(바이트가 더 바뀌지 않는다)

  function alloc() {
    tex && tex.dispose();
    tex = new THREE.DataTexture(data, W, H);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    U.uFog.value = tex;
    U.uFogInfo.value.set(x0, z0, 1 / (W * cell), 1 / (H * cell));
  }

  function recompute() {
    if (!vision) return;
    for (let j = 0; j < H; j++) {
      const z = z0 + (j + 0.5) * cell;
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        // [왕국전] vision.test 가 있으면 그것으로(유닛마다 시야가 다르다 — 서버와 같은 칸 시야)
        const on = (vision.test ? vision.test(x0 + (i + 0.5) * cell, z) : canSee(vision, x0 + (i + 0.5) * cell, z, 0.3)) ? 1 : 0;
        target[k] = on;
        if (on) explored[k] = 1;
      }
    }
  }

  return {
    /** 경기장이 바뀌었다(가 본 곳을 지운다) */
    setArena(A, grid) {
      G = grid;
      if (G) {
        // [왕국전] 칸마다 한 점(예전 반 칸 — 124칸 지도면 248² = 6만 점을 프레임마다 훑고 올렸다). 시야 판정이 칸 단위라
        //          보이는 자리는 같고, 선형으로 읽어 경계가 한 칸 너비로 더 부드럽게 번진다
        cell = G.size;
        W = H = G.n;
        x0 = G.x0;
        z0 = G.z0;
      } else {
        const R = (A && A.radius) || 20;
        cell = 1;
        W = H = Math.ceil(R * 2);
        x0 = z0 = -R;
      }
      vis = new Float32Array(W * H);
      seenV = new Float32Array(W * H);
      target = new Uint8Array(W * H);
      explored = new Uint8Array(W * H);
      data = new Uint8Array(W * H * 4);
      acc = 1;
      alloc();
    },
    /** false 면 늘 걷는다 */
    setEnabled(on) {
      wanted = !!on;
    },
    /** 우리 팀의 지금 시야(game.vision() — shared/fog.js makeVision). null = 안개 없음(꺼진 경기 · 진행자 · 대기 화면) */
    setVision(v) {
      vision = v && v.team >= 0 ? v : null;
    },
    get enabled() {
      return active;
    },
    /** 지금 (x, z) 가 보이는가(pad = 대상 반지름). 안개가 꺼졌으면 늘 true — 캐릭터 · 풍선 · 아이템 · 폭발 연출을 가린다 */
    visible(x, z, pad = 0) {
      return !active || !vision || (vision.test ? vision.test(x, z) : canSee(vision, x, z, pad));
    },
    /** 칸 i(c, r) 를 가 본 적이 있나(미니맵) */
    seen(i, c, r) {
      if (!active || !G) return true;
      if (c === undefined) {
        c = i % G.n;
        r = Math.floor(i / G.n);
      }
      return !!explored[r * W + c];
    },
    /** 미니맵용 자료(반 칸에 한 점): { w, h, x0, z0, cell, explored, visible, enabled } — 배열은 빌려 주는 것(고치지 말 것) */
    snapshot() {
      return { w: W, h: H, x0, z0, cell, explored, visible: target, enabled: active };
    },
    update(dt) {
      const on = wanted && !!vision && !!G;
      if (on !== active) {
        active = on;
        U.uFogOn.value = on ? 1 : 0;
        acc = 1;
        if (on) {
          // 켜지는 순간: 지금 시야를 곧바로(검은 화면에서 서서히 밝아지지 않게)
          recompute();
          for (let k = 0; k < W * H; k++) {
            vis[k] = target[k];
            seenV[k] = explored[k];
          }
        }
      }
      if (!active) return;
      acc += dt;
      if (acc >= 1 / FOG_HZ) {
        acc = 0;
        recompute();
        settled = false;
      }
      // 부드럽게 따라간다(보임 0.15초 · 가 본 곳 0.4초)
      const kv = Math.min(1, dt * 7);
      const ks = Math.min(1, dt * 2.5);
      if (settled) return; // [왕국전] 다 따라갔으면(다음 재계산까지) 훑지 않는다
      let dirty = false;
      for (let k = 0; k < W * H; k++) {
        const v = vis[k] + (target[k] - vis[k]) * kv;
        const s = seenV[k] + (explored[k] - seenV[k]) * ks;
        const bv = (v * 255 + 0.5) | 0, bs = (s * 255 + 0.5) | 0;
        vis[k] = v;
        seenV[k] = s;
        if (data[k * 4] !== bv || data[k * 4 + 1] !== bs) {
          data[k * 4] = bv;
          data[k * 4 + 1] = bs;
          dirty = true;
        }
      }
      if (dirty && tex) tex.needsUpdate = true;
      else settled = true;
    },
    /** 가 본 곳을 지운다(새 경기) */
    reset() {
      explored.fill(0);
      seenV.fill(0);
      vis.fill(0);
    },
    get bytes() {
      return W * H * 4;
    },
  };
}
