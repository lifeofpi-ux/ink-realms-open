// 휴대폰 · 태블릿 조작부(docs/DESIGN.md §2 터치): 왼쪽 아래 이동 판(누른 자리가 가운데 — 떠다니는 스틱),
// 오른쪽 단추 줄 = 무기 바꾸기 · 대시 · 따라와 · 지휘(점프는 뺐다 — U20)(켜면 화면 누르기가 던지기 대신 고르기 · 명령) · 모두 따라와.
// 화면(캔버스)을 누르는 것은 control.js 가 받는다(누르면 그쪽으로 겨누고, 떼면 던진다 — 꾹 = 충전).
// 손가락은 pointerId 로 나눈다(이동 판과 던지기를 두 엄지로 같이 써도 섞이지 않는다).

const DEAD = 0.14;
const FOLLOW = 1.35;

export function createTouch(h) {
  const root = document.createElement("div");
  root.className = "touch";
  root.hidden = true;
  root.innerHTML = `
    <div class="t-pad"><div class="t-stick"><i class="t-ring"></i><b class="t-knob"></b></div><span class="t-cap">이동</span></div>
    <div class="t-btns">
      <button class="t-btn t-weapon" data-b="weapon"><span class="ic"></span><small>무기</small></button>
      <button class="t-btn t-dash" data-b="dash"><span class="ic">»</span><small>대시</small></button>
      <button class="t-btn t-follow" data-b="follow"><span class="ic">⟲</span><small>따라와</small></button>
      <button class="t-btn t-cmd" data-b="cmd"><span class="ic">⚑</span><small>지휘</small></button>
    </div>`;
  document.body.appendChild(root);
  const pad = root.querySelector(".t-pad");
  const stick = root.querySelector(".t-stick");
  const knob = root.querySelector(".t-knob");
  const cmdBtn = root.querySelector(".t-cmd");
  const wBtn = root.querySelector(".t-weapon .ic");
  const out = { mx: 0, my: 0, active: false, command: false };
  let moveId = null;
  let ox = 0, oy = 0, hx = 0, hy = 0, rad = 50;

  function measure() {
    stick.style.transform = "";
    const r = stick.getBoundingClientRect();
    hx = r.left + r.width / 2;
    hy = r.top + r.height / 2;
    rad = Math.max(28, r.width * 0.36);
  }
  function moveTo(x, y) {
    let dx = x - ox, dy = y - oy;
    let d = Math.hypot(dx, dy);
    const far = rad * FOLLOW;
    if (d > far) {
      const k = (d - far) / d;
      ox += dx * k; oy += dy * k;
      dx = x - ox; dy = y - oy;
      d = far;
    }
    stick.style.transform = `translate3d(${(ox - hx).toFixed(1)}px,${(oy - hy).toFixed(1)}px,0)`;
    const c = d > rad ? rad / d : 1;
    knob.style.transform = `translate3d(${(dx * c).toFixed(1)}px,${(dy * c).toFixed(1)}px,0)`;
    const k = Math.min(1, d / rad);
    if (k < DEAD || d === 0) { out.mx = 0; out.my = 0; }
    else { const s = (k - DEAD) / (1 - DEAD) / d; out.mx = dx * s; out.my = dy * s; }
  }
  function release() {
    moveId = null;
    out.mx = out.my = 0;
    stick.style.transform = "";
    knob.style.transform = "";
    pad.classList.remove("on");
  }
  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (moveId !== null) return;
    measure();
    moveId = e.pointerId;
    pad.setPointerCapture?.(e.pointerId);
    ox = e.clientX; oy = e.clientY;
    pad.classList.add("on");
    moveTo(e.clientX, e.clientY);
  });
  pad.addEventListener("pointermove", (e) => { if (e.pointerId === moveId) moveTo(e.clientX, e.clientY); });
  const up = (e) => { if (e.pointerId === moveId) release(); };
  pad.addEventListener("pointerup", up);
  pad.addEventListener("pointercancel", up);
  pad.addEventListener("lostpointercapture", up);

  root.querySelectorAll(".t-btn").forEach((b) => {
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.classList.add("down");
      const k = b.dataset.b;
      if (k === "cmd") {
        out.command = !out.command;
        cmdBtn.classList.toggle("on", out.command);
        document.body.classList.toggle("t-command", out.command);
        h.onCommandMode?.(out.command);
      } else h.onButton?.(k);
    });
    const off = () => b.classList.remove("down");
    b.addEventListener("pointerup", off);
    b.addEventListener("pointercancel", off);
    b.addEventListener("pointerleave", off);
  });

  return {
    state: out,
    show(on) {
      root.hidden = !on;
      out.active = on;
      if (!on) release();
    },
    setWeapon(label, color) {
      wBtn.textContent = label;
      wBtn.style.color = color || "";
    },
    setCommand(on) {
      out.command = !!on;
      cmdBtn.classList.toggle("on", out.command);
      document.body.classList.toggle("t-command", out.command);
    },
    root,
  };
}
