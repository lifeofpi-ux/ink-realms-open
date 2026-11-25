import { defineConfig } from "vite";

// 글꼴 조각(woff2)은 CSS 에 박지 않고 파일로 둔다 — 화면에 그 글자가 나올 때 그 조각만 받는다.
const FONT = /\.(woff2?|ttf|otf|eot)(\?.*)?$/i;

// 개발: Vite(5174)가 화면을 내보내고 /ws 는 게임 서버(3100)로 넘긴다. 운영: 게임 서버가 dist/ 를 직접 내보낸다.
export default defineConfig({
  server: {
    port: 5174,
    proxy: { "/ws": { target: "ws://localhost:3100", ws: true } },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    assetsInlineLimit: (file) => (FONT.test(file) ? false : undefined),
  },
});
