// (옛) 층 이미지 스택 묶음 자리(docs/DESIGN.md §3.10 — 아이템 · 설치물 · 정답 폭탄은 이제 three.js 3D 모델이다).
// 층 그림을 그리지 않는다. 남은 일은 셋:
//   1) 장면의 자리(mesh — 3D 캐릭터 묶음 figures.js 가 이 아래에 걸린다) · 공유 유니폼(섬광 점광 · 안개 · 팀 램프)
//   2) drawStack(characters.js — 퀴즈 판 · 설치물 · 아이템이 부른다)이 넘기는 "층"을 3D 모델로 옮긴다: stackatlas.js 가 만든 자리 표시 스택의
//      프레임은 sheet = MODEL_SHEET + 모델 번호라, 그 층 하나가 곧 모델 하나(props3d.js 의 동적 모델)다.
//   3) renderer.js 가 부르는 옛 함수(setSheets · setRamps · setOutline · begin · end · count)를 그대로 받아 준다.
import * as THREE from "three";
import { PALETTE } from "../shared/constants.js";
import { PROJ } from "./camera.js";
import { activeProps } from "./props3d.js";
import { MODEL_SHEET, STUB_MODELS } from "./stackatlas.js";

export const MAX_LAYERS = 0;
const shadeHex = (hex, k) => {
  const r = Math.min(255, ((hex >> 16) & 255) * k) | 0, g = Math.min(255, ((hex >> 8) & 255) * k) | 0, b = Math.min(255, (hex & 255) * k) | 0;
  return (r << 16) | (g << 8) | b;
};

export function createStackBatch(lights, fog) {
  const shared = {
    uKey: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(-9, -9, -9)) },
    uTeam: { value: Array.from({ length: 48 }, () => new THREE.Vector3(1, 1, 1)) }, // [왕국전] PALETTE 이 11색(8팀 + 중립)이라 32 → 48
    uView: { value: new THREE.Vector3(...PROJ.view) },
    ...lights,
    ...fog,
  };
  const mesh = new THREE.Group();
  mesh.name = "stacks-anchor";
  const outlineMesh = new THREE.Group();
  const xrayMesh = new THREE.Group();
  let n = 0;
  return {
    mesh,
    outlineMesh,
    xrayMesh,
    /** 공유 유니폼(섬광 점광 · 안개 · 팀 램프) — 3D 캐릭터(figures.js)도 같은 것을 읽는다 */
    uniforms: shared,
    get count() {
      return n;
    },
    get dropped() {
      return 0;
    },
    setSheets() {},
    /** 예약 램프 · 팀 램프([r,g,b] 0..1, sRGB) */
    setRamps(key, teams) {
      const c = new THREE.Color();
      key.forEach((k, i) => shared.uKey.value[i].copy(c.setRGB(k[0], k[1], k[2], THREE.SRGBColorSpace)));
      teams.forEach((ramp, t) => ramp.forEach((k, i) => shared.uTeam.value[t * 4 + i]?.copy(c.setRGB(k[0], k[1], k[2], THREE.SRGBColorSpace)))); // [왕국전] 넘치면 버린다
    },
    setOutline() {},
    begin() {
      n = 0;
    },
    /**
     * 층 하나 = 자리 표시 스택이면 3D 모델 하나: (x, y, z) 발밑, rot = 바라보는 각, shade = 밝기, team = PALETTE 번호(−1 = 모델 색),
     * sheet = MODEL_SHEET + 모델 번호, texel = 크기 배율. 그 밖의 층(옛 층 그림)은 버린다
     */
    layer(x, y, z, rot, shade, team, sheet, u, v, w, h, texel) {
      if (!(sheet >= MODEL_SHEET)) return;
      const name = STUB_MODELS[sheet - MODEL_SHEET];
      const P = activeProps();
      if (!P || !name) return;
      const hex = team >= 0 ? PALETTE[team % PALETTE.length].hex : 0xff2d95;
      const k = Math.min(1.2, shade / 0.86);
      // 꽂힌 집결 깃발은 바람에 흔들린다
      const sway = name === "gadget/rally" ? Math.sin(performance.now() / 260 + x) * 0.07 : 0;
      if (P.push(name, x, y, z, Math.PI / 2 - rot, k < 0.99 ? shadeHex(hex, k) : hex, texel, 0, sway)) n++;
    },
    end() {},
  };
}
