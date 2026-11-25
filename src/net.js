// 서버 연결: JSON 글자 프레임 + 바이너리 스냅숏. 끊기면 다시 잇고, 다시 이으면 hello 와 채널 다시 들어가기를 보낸다.
import { decodeSnapshot } from "../shared/protocol.js";

export function createNet({ onMessage, onSnapshot, onStatus }) {
  let ws = null;
  let open = false;
  let retry = 0;
  let hello = null;
  let rejoin = null;
  const queue = [];

  function url() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  }

  function connect() {
    ws = new WebSocket(url());
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      open = true;
      retry = 0;
      onStatus?.("open");
      if (hello) ws.send(JSON.stringify(hello));
      if (rejoin) ws.send(JSON.stringify({ t: "join", code: rejoin }));
      for (const m of queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        onMessage(msg);
      } else {
        const s = decodeSnapshot(ev.data);
        if (s) onSnapshot(s);
      }
    };
    ws.onclose = () => {
      open = false;
      onStatus?.("closed");
      const wait = Math.min(5000, 400 * 2 ** retry++);
      setTimeout(connect, wait);
    };
    ws.onerror = () => {};
  }
  connect();

  return {
    send(msg) {
      const s = JSON.stringify(msg);
      if (open) ws.send(s);
      else if (queue.length < 20) queue.push(s);
    },
    setHello(m) { hello = m; if (open) ws.send(JSON.stringify(m)); },
    setRejoin(code) { rejoin = code; },
    get open() { return open; },
  };
}
