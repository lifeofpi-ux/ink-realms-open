// HTTP + WebSocket 서버. 개발: Vite(5174)가 화면을, 이 서버(3100)가 /ws 를 맡는다. npm start: 이 서버가 dist/ 도 내보낸다.
// 공개판에는 접속 · 메시지 한도가 없다 — 여럿이 쓰는 공개 서버로 띄울 때는 직접 더하세요(README).
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Lobby } from "./lobby.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT) || 3100;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8",
};

const lobby = new Lobby();

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(DIST, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error("dir");
    const body = await readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      "content-type": TYPES[ext] || "application/octet-stream",
      "cache-control": p.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(body);
  } catch {
    try {
      const body = await readFile(path.join(DIST, "index.html"));
      res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-cache" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("화면 파일이 없어요. npm run build 를 먼저 하거나 npm run dev 로 여세요.");
    }
  }
}

const server = http.createServer(serveStatic);

// 죽은 접속은 핑으로 걷어 낸다
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024, perMessageDeflate: false });
wss.on("connection", (ws) => {
  ws.on("error", () => {});
  ws.alive = true;
  ws.on("pong", () => { ws.alive = true; });
  lobby.connect(ws);
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);
heartbeat.unref();

server.listen(PORT, () => console.log(`잉크 브로울스 왕국전 서버: http://localhost:${PORT}`));
