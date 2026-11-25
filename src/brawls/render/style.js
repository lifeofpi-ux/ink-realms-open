// 겉모습 설정 한 곳(docs/DESIGN.md §3.0 v8 — 격자가 보이지 않는 손그림풍 2D 맵 + 층 스택 캐릭터 + 입체 잉크 폭발, 블랙라이트 형광 팔레트).
// 구조(직교 카메라 · 지형 섞기 바닥 · 세운 2D 장애물 · 층 스택 · 잉크 캔버스 · 안개 · 입자 · 퀴즈 룸 · 화질 단계)와 떼어 여기 값만 바꿔 톤을 다듬는다.
// 기준 화면: docs/concept/remaster-v8.png.
//
//   world.ppu     0 = 기기 해상도로 그린다(v8). 0 보다 크면 v7 처럼 1u = ppu 화소의 저해상도 타깃을 최근접으로 확대(도트)
//   world.filter  확대 필터("linear" 매끈한 맵 | "nearest" 픽셀 아트)
//   world.scale   화질마다 장면 타깃 해상도 배율(저 0.75 — 글자 층은 늘 기기 해상도)
// 맵의 겉모습(v12 — §3.12 · §3.10): terrain.js(바닥 — 원본 ink-brawl "잉크 공장" 철판 셰이더, 값은 floor)와 models.js · props3d.js
// (장애물 · 아이템 · 설치물 3D 모델 — 툰 + 외곽선, 값은 props)에 있다. 그림 파일은 받지 않는다.
//   floor         철판 · 길 · 광장 · 바다 · 물 · 거품 · 유도등 · 점프 보드 색, 판 거칠기 범위, 그림자 짙기, 블랙라이트(주광 · 보조광 · 주변광 — 선형 배율)
//   props         3D 장애물 툰 단계 밝기(mid · dark) · 그늘 색 · 빛 세기 · 외곽선 두께(u) · 바깥 벽 네온 색
//   outline       층 스택 실루엣 두께(텍스처 px) · 짙은 외곽선(stackDark — 끄면 애셋의 outline) · 색(짙은 보라 — 장애물 그림과 같은 색)
//   colors        바탕 · 그림자 · 미니맵 대표 색(지형 · 장애물)
//   terrain       (옛 손그림 지형 — v12 에서 쓰지 않는다)
//   fog           안개: 가 본 곳 · 안 가 본 곳 밝기(안 가 본 곳도 어둡게 보인다), 채도, 경계 흔들기(u)
//   post          블룸 임계값 · 세기, 틸트 시프트, 색 보정
export const STYLE = Object.freeze({
  name: "remaster-v8",
  world: { ppu: 0, filter: "linear", scale: { low: 0.75, mid: 1, high: 1 } },
  outline: { stackPx: 1.25, stackDark: true, sphere: 0.1, color: 0x100922 },
  colors: {
    background: 0x07060f,
    // 미니맵 대표 색(지형 · 장애물 — 화면의 평균 톤)
    floorA: 0x2e2744, floorB: 0x362e50,
    path: 0x5a4250, plaza: 0x6a6190, moss: 0x24564f, river: 0x3b1d8f, bridge: 0x7a5a36,
    homeA: 0x0f3550, homeB: 0x134062,
    zoneA: 0x6a6190, zoneB: 0x8479ae,
    pad: 0x00ffa3,
    solid: [[0x3c3560, 0x6a5f96, 0x100922, 0x00f0ff], [0x3c3560, 0x6a5f96, 0x100922, 0xa24bff]],
    breakable: [[0x8a5a44, 0xaa7454, 0x2a1418, 0xff2d95], [0x8a5a44, 0xaa7454, 0x2a1418, 0xff7a00]],
    wall: [0x2a2540, 0x4a4468, 0x100922, 0x8a80b0],
    board: [0x2b1f55, 0x48308a, 0x0f0826, 0xa24bff],
    shadow: 0x05030c,
  },
  // 바닥(docs/DESIGN.md §3.12 — 원본 ink-brawl "잉크 공장"): 판 색(기본 · 길 · 광장), 바다 · 수로 물 · 거품, 유도등 · 점프 보드 · 광장 고리 네온,
  // 판 거칠기, 그림자 밝기, 블랙라이트(주광 · 보조광 · 주변광 — 선형 배율)
  floor: {
    plate: 0x363640, path: 0x4c4a56, plaza: 0x5c5a72, sea: 0x0b0b16, water: 0x160b2a, foam: 0x7af7ff,
    guide: 0x8ff4ff, guideGlow: 1.1, pad: 0x00ffa3, ring: 0xffffff, roughness: [0.3, 0.6], shadow: 0.45,
    key: [0.55, 0.62, 0.82], fill: [0.24, 0.13, 0.5], ambient: [0.27, 0.25, 0.4],
  },
  // 3D 캐릭터(ink-brawl 의 장난감 인형 — figures.js · characters.js): 그리는 크기(원본 비율 — 머리 반지름 = 판정 반지름), 무늬 시트 칸(px),
  // 툰 명암(빛 쪽 경계 · 가운데 · 그늘 밝기, 그늘 색), 형광 발광, 반짝, 외곽선 두께(u — 0 이면 끔)
  character: {
    scale: 1, cell: 192, cellLow: 96,
    bands: [0.25, -0.25], mid: 0.78, dark: 0.58, shadowTint: [0.7, 0.6, 1.0],
    emit: 0.2, spec: 0.35, outline: 0.03,
  },
  // 3D 장애물 · 아이템(props3d.js): 툰 명암(가운데 · 그늘 밝기, 그늘 색), 전체 밝기, 외곽선 두께(u), 바깥 벽 네온 색
  props: { mid: 0.76, dark: 0.55, shadowTint: [0.7, 0.6, 1.0], light: 1.0, outline: 0.035, wallNeon: 0x00f0ff },
  fog: { seen: 0.4, unseen: 0.2, seenSat: 0.35, edge: 0.9 },
  light: { ambient: 1 },
  post: { bloomThreshold: 1.0, bloom: 0.7, tilt: 0.35, vignette: 0.3, grade: 0.35 },
});
