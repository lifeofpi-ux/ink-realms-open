// [왕국전] 첫 화면 · 대기실 오른쪽 위의 🔊/🔇 빠른 단추(경기 중에는 숨는다 — 경기 중에는 ⚙ 설정 창 · M 키).
// 끄면 빨간 "🔇 소리 꺼짐"으로 바뀌어 한눈에 보인다. 설정은 settings.js 하나로 — ⚙ 설정 창에서 바꿔도 이 단추가 따라 바뀐다.
import { getSoundSettings, setSoundSettings, onSoundSettings } from "./settings.js";

let styled = false;
function addStyle() {
  if (styled) return;
  styled = true;
  const st = document.createElement("style");
  st.textContent = `
.snd-title { position: fixed; top: calc(10px + env(safe-area-inset-top, 0px)); right: calc(10px + env(safe-area-inset-right, 0px)); z-index: 11;
  display: flex; align-items: center; gap: 6px; padding: 7px 14px 7px 11px; border: 2px solid #00f0ff; background: #0b0716; color: #f3efff;
  font: 700 14px/1 system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; cursor: pointer;
  clip-path: polygon(7px 0, 100% 0, calc(100% - 7px) 100%, 0 100%); box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.35); }
.snd-title i { font-style: normal; font-size: 17px; }
.snd-title.off { border-color: #ff3b4e; background: #3a0d16; color: #ffb3bb; }
.snd-title:hover { filter: brightness(1.2); }
body.in-game .snd-title { display: none; }
@media (max-width: 560px) { .snd-title { padding: 6px 10px 6px 8px; } .snd-title span { display: none; } }
`;
  document.head.appendChild(st);
}

/** 🔊/🔇 단추를 body 에 붙인다 */
export function titleToggle() {
  addStyle();
  const b = document.createElement("button");
  b.type = "button";
  b.className = "snd-title";
  b.onclick = (e) => {
    e.stopPropagation();
    setSoundSettings({ mute: !getSoundSettings().mute });
  };
  function refresh() {
    const on = !getSoundSettings().mute;
    b.classList.toggle("off", !on);
    b.innerHTML = on ? "<i>🔊</i><span>소리</span>" : "<i>🔇</i><span>소리 꺼짐</span>"; // 좁은 화면은 그림만(빨간 테로 꺼짐이 보인다)
    b.title = on ? "소리 끄기 (M)" : "소리 켜기 (M)";
    b.setAttribute("aria-pressed", on ? "false" : "true");
    b.setAttribute("aria-label", on ? "소리 끄기" : "소리 켜기");
  }
  onSoundSettings(refresh);
  refresh();
  document.body.appendChild(b);
  return b;
}
