// [왕국전] 바닥에 구운 그림자 · 접지 어둠(순수 함수 — 그리기 없이 CPU 에서 한 번).
// 예전에는 프레임마다 빛 카메라로 장애물 · 캐릭터 · 몬스터를 한 번 더 그려(그림자 맵 1024²) 바닥이 읽었다 — 숲 지도에서는 그것만 삼각형 수십만 개.
// 나무 · 블록 · 금광 · 건물은 제자리에 서 있으니, 그 그림자를 바닥 칸 격자에 맞춘 작은 텍스처(칸마다 T×T 텍셀)에 미리 구워 둔다:
//   R = 드리운 그림자(빛은 왼쪽 위 — 높이 h 의 점은 바닥에서 (LX, LZ)·h 만큼 오른쪽 아래로 떨어진다): 그림자 주인(caster)마다
//       높이 h0 → h1 를 훑으며 타원을 찍는다(나무 = 줄기 + 둥근 잎, 블록 = 상자 몸, 건물 = 받침 + 몸)
//   G = 접지 어둠(AO): 바닥에 닿은 둘레가 조금 어둡다(장난감이 바닥에 놓인 느낌)
// 둘 다 마지막에 흐려서 가장자리가 부드럽다. 움직이는 것(캐릭터 · 몬스터 · 풍선)은 발밑 얼룩(데칼)이 맡는다.
//
// caster = { x, z(월드 u), rx, rz(타원 반지름 u), h0, h1(그림자를 드리우는 높이 범위 u), k(짙기 0..1, 기본 1), ao(접지 어둠 쓰기, 기본 true) }

/** 빛 방향(world.js 의 옛 그림자 빛과 같다): 높이 1u 당 바닥에서 떨어지는 거리(오른쪽 · 아래) */
export const LIGHT_OFF = { x: 0.55, z: 0.42 };

/**
 * @param {{ n:number, size:number, x0:number, z0:number }} G  바닥 칸 격자
 * @param {Array} casters
 * @param {number} T  칸마다 텍셀 수
 * @param {Uint8Array} [out]  RG 자료(W·W·2) — 다시 쓸 때
 * @param {{ c0, r0, c1, r1 }} [region]  이 칸 사각형만 다시 굽는다(블록이 부서졌을 때 — 그 둘레 casters 만 넘기면 된다). out 이 있어야 한다
 * @returns {{ W:number, data:Uint8Array }}
 */
export function bakeFloorShade(G, casters, T = 4, out = null, region = null) {
  const W = G.n * T;
  const tex = G.size / T; // 텍셀 한 변(u)
  const PAD = 3; // 흐림이 창 가장자리에서 끊기지 않게
  const part = !!(region && out && out.length === W * W * 2);
  // 작업 창(텍셀): 전체 또는 region + 여유
  const fx0 = part ? Math.max(0, region.c0 * T - PAD) : 0, fz0 = part ? Math.max(0, region.r0 * T - PAD) : 0;
  const fx1 = part ? Math.min(W, (region.c1 + 1) * T + PAD) : W, fz1 = part ? Math.min(W, (region.r1 + 1) * T + PAD) : W;
  const WW = fx1 - fx0, WH = fz1 - fz0;
  const sh = new Float32Array(WW * WH);
  const ao = new Float32Array(WW * WH);
  const inv = 1 / tex;
  const ox = G.x0 + fx0 * tex, oz = G.z0 + fz0 * tex;
  // 타원 하나를 최댓값으로 찍는다(가장자리 0.35 텍셀 부드럽게)
  function stamp(buf, cx, cz, rx, rz, k) {
    const px = (cx - ox) * inv - 0.5, pz = (cz - oz) * inv - 0.5;
    const ex = rx * inv + 1, ez = rz * inv + 1;
    const i0 = Math.max(0, Math.floor(px - ex)), i1 = Math.min(WW - 1, Math.ceil(px + ex));
    const j0 = Math.max(0, Math.floor(pz - ez)), j1 = Math.min(WH - 1, Math.ceil(pz + ez));
    if (i0 > i1 || j0 > j1) return;
    const irx = 1 / Math.max(1e-3, rx * inv), irz = 1 / Math.max(1e-3, rz * inv);
    const soft = 0.6 * Math.min(irx, irz); // 정규화 거리에서 부드러운 띠(약 0.6 텍셀)
    for (let j = j0; j <= j1; j++) {
      const dz = (j - pz) * irz;
      const row = j * WW;
      for (let i = i0; i <= i1; i++) {
        const dx = (i - px) * irx;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d >= 1 + soft) continue;
        const v = d <= 1 - soft ? k : k * (1 + soft - d) / (2 * soft);
        if (v > buf[row + i]) buf[row + i] = v;
      }
    }
  }
  for (const c of casters) {
    const k = c.k ?? 1;
    const h0 = Math.max(0, c.h0 || 0), h1 = Math.max(h0, c.h1 || 0);
    // 높이를 훑으며 그림자 타원을 찍는다(한 걸음 = 바닥에서 약 반 텍셀)
    const len = (h1 - h0) * Math.hypot(LIGHT_OFF.x, LIGHT_OFF.z);
    const steps = Math.max(1, Math.ceil(len / (tex * 0.6)));
    for (let s = 0; s <= steps; s++) {
      const h = h0 + ((h1 - h0) * s) / steps;
      stamp(sh, c.x + LIGHT_OFF.x * h, c.z + LIGHT_OFF.z * h, c.rx, c.rz, k);
    }
    if (c.ao !== false) {
      // 접지 어둠: 바닥 자국보다 조금 넓게(0.55u) — 흐림이 둘레로 번지게 한다
      stamp(ao, c.x, c.z, c.rx + 0.35, c.rz + 0.35, 0.85 * k);
    }
  }
  // 흐림(가로 · 세로, 반지름 2 텍셀 — 삼각 가중)
  const tmp = new Float32Array(WW * WH);
  const wts = [1, 2, 3, 2, 1];
  const blur = (src, r = 2) => {
    for (let j = 0; j < WH; j++) {
      const row = j * WW;
      for (let i = 0; i < WW; i++) {
        let s = 0, ws = 0;
        for (let k = -r; k <= r; k++) {
          const ii = i + k;
          if (ii < 0 || ii >= WW) continue;
          const w = wts[k + 2];
          s += src[row + ii] * w;
          ws += w;
        }
        tmp[row + i] = s / ws;
      }
    }
    for (let j = 0; j < WH; j++) {
      for (let i = 0; i < WW; i++) {
        let s = 0, ws = 0;
        for (let k = -r; k <= r; k++) {
          const jj = j + k;
          if (jj < 0 || jj >= WH) continue;
          const w = wts[k + 2];
          s += tmp[jj * WW + i] * w;
          ws += w;
        }
        src[j * WW + i] = s / ws;
      }
    }
  };
  blur(sh);
  blur(ao);
  const data = out && out.length === W * W * 2 ? out : new Uint8Array(W * W * 2);
  // 써넣기: 전체면 창 전부, 부분이면 region 안쪽만(여유 띠는 흐림 계산용)
  const wx0 = part ? region.c0 * T : 0, wz0 = part ? region.r0 * T : 0;
  const wx1 = part ? Math.min(W, (region.c1 + 1) * T) : W, wz1 = part ? Math.min(W, (region.r1 + 1) * T) : W;
  for (let j = Math.max(0, wz0); j < wz1; j++) {
    for (let i = Math.max(0, wx0); i < wx1; i++) {
      const a = (j - fz0) * WW + (i - fx0), o = (j * W + i) * 2;
      data[o] = Math.min(255, Math.round(sh[a] * 255));
      data[o + 1] = Math.min(255, Math.round(ao[a] * 255));
    }
  }
  return { W, data };
}
