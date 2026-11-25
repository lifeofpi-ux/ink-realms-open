// 섬광 점광(docs/DESIGN.md §3.1 · §3.5): 폭발 · 분수 · 빛 울타리의 팀 색 빛이 주변 블록 · 캐릭터를 잠깐 물들인다.
// 화질 단계마다 상한(저 0 · 중 4 · 고 8) 안에서 카메라 가운데에 가까운 것만 고른다. 고른 것은 두 곳에 들어간다:
// 셰이더의 유니폼 배열(glsl.js 의 lightUniforms — 바닥 · 장애물 그림 · 층 스택 · 구가 같이 읽는다).
import { MAX_LIGHTS } from "./glsl.js";

export function createLights(U) {
  const flashes = []; // 잠깐 켜졌다 꺼지는 것
  const steady = []; // 이번 프레임에만 켜는 것(울타리 등 — 프레임마다 다시 넣는다)
  const pick = [];
  const out = [];
  return {
    /** 잠깐 켜지는 빛: hex 색, r 반지름(u), power 세기, life 초 */
    flash(x, y, z, hex, r, power, life) {
      if (flashes.length > 32) flashes.shift();
      flashes.push({ x, y, z, hex, r, power, t: 0, life });
    },
    /** 이번 프레임만 켜는 빛 */
    add(x, y, z, hex, r, power) {
      if (steady.length < 32) steady.push({ x, y, z, hex, r, power, t: 0, life: 0 });
    },
    update(dt) {
      for (let i = flashes.length - 1; i >= 0; i--) {
        flashes[i].t += dt;
        if (flashes[i].t >= flashes[i].life) flashes.splice(i, 1);
      }
    },
    clear() {
      flashes.length = 0;
      steady.length = 0;
    },
    get count() {
      return U.uLightN.value;
    },
    /** 셰이더에 넣는다. max = 이 화질의 상한(0 이면 끈다), (cx, cz) = 카메라가 보는 곳. 고른 것(세기 반영)을 돌려준다 */
    apply(max, cx, cz) {
      const on = max > 0;
      U.uLightOn.value = on ? 1 : 0;
      U.uAmbient.value = 1;
      pick.length = 0;
      if (on) {
        for (const l of flashes) pick.push(l);
        for (const l of steady) pick.push(l);
        pick.sort((a, b) => (a.x - cx) ** 2 + (a.z - cz) ** 2 - ((b.x - cx) ** 2 + (b.z - cz) ** 2));
      }
      const n = Math.min(MAX_LIGHTS, max, pick.length);
      out.length = 0;
      for (let i = 0; i < n; i++) {
        const l = pick[i];
        const k = l.life > 0 ? 1 - l.t / l.life : 1;
        const power = l.power * k * k;
        U.uLightPos.value[i].set(l.x, l.y, l.z, l.r);
        U.uLightCol.value[i].set(((l.hex >> 16) & 255) / 255, ((l.hex >> 8) & 255) / 255, (l.hex & 255) / 255, power * 0.6);
        out.push({ x: l.x, y: l.y, z: l.z, hex: l.hex, r: l.r, power });
      }
      U.uLightN.value = n;
      steady.length = 0;
      return out;
    },
  };
}
