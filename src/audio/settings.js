// [왕국전] 소리 설정 — 한 곳에서 들고 기억한다(localStorage "ibr-sound", 막혀 있으면 이번 접속 동안만).
//   getSoundSettings()        → { mute, master, music, sfx }(음량은 0..1)
//   setSoundSettings(patch)   → 바꾸고 기억하고 알린다(바뀐 뒤의 설정을 돌려준다)
//   onSoundSettings(cb)       → 바뀔 때마다 cb(설정). 돌려준 함수를 부르면 그만 듣는다
// 소리 엔진(game.js)과 첫 화면 🔊/🔇 단추(ui.js)와 ⚙ 설정 창(src/ui/settings.js)이 모두 이것만 쓴다 — 어디서 바꿔도 서로 맞는다.
// 교실에는 기기가 수십 대라 기본 음량을 낮게 둔다.

const KEY = "ibr-sound";
export const SOUND_DEFAULT = Object.freeze({ mute: false, master: 0.6, music: 0.45, sfx: 0.8 });
const clamp01 = (v) => Math.max(0, Math.min(1, v));

const cur = { ...SOUND_DEFAULT };
try {
  const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
  if (typeof raw.mute === "boolean") cur.mute = raw.mute;
  for (const k of ["master", "music", "sfx"]) if (Number.isFinite(raw[k])) cur[k] = clamp01(raw[k]);
} catch {
  /* 사생활 보호 모드 등 — 기본값 */
}
const subs = new Set();

/** 지금 소리 설정(복사본) */
export function getSoundSettings() {
  return { ...cur };
}

/** 소리 설정을 바꾼다 — patch = { mute?, master?, music?, sfx? } */
export function setSoundSettings(patch = {}) {
  let changed = false;
  if (typeof patch.mute === "boolean" && patch.mute !== cur.mute) { cur.mute = patch.mute; changed = true; }
  for (const k of ["master", "music", "sfx"]) {
    const v = Number(patch[k]);
    if (patch[k] != null && Number.isFinite(v) && clamp01(v) !== cur[k]) { cur[k] = clamp01(v); changed = true; }
  }
  if (!changed) return getSoundSettings();
  try {
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch {
    /* 저장소를 못 쓰면 이번 접속 동안만 */
  }
  const s = getSoundSettings();
  for (const cb of [...subs]) {
    try {
      cb(s);
    } catch (err) {
      console.warn("[sound] 설정 알림", err);
    }
  }
  return s;
}

/** 바뀔 때마다 cb(설정). 돌려준 함수로 그만 듣는다 */
export function onSoundSettings(cb) {
  if (typeof cb !== "function") return () => {};
  subs.add(cb);
  return () => subs.delete(cb);
}
