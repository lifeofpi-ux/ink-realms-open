// [왕국전] ?debug 확인용(경기 화면에서는 불러오지 않는다 — game.js 가 필요할 때 import 한다).
// OfflineAudioContext 위에 엔진을 하나 더 만들어 소리 하나씩 렌더하고, 조용하지 않은지 · 찌그러지지 않는지 숫자로 본다.
//   peak = 가장 큰 표본(출력은 소프트 클립 뒤라 1 을 넘지 않는다) · rms = 평균 세기(dB) · hot = |표본| > 0.98 인 비율(찌그러짐)
//   len = -50dB 보다 큰 소리가 이어진 길이(초)
import { createAudio } from "./index.js";

const SR = 44100;

function measure(buf) {
  let peak = 0, sum = 0, hot = 0, last = 0;
  const n = buf.length;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      sum += d[i] * d[i];
      if (a > 0.98) hot++;
      if (a > 0.00316 && i > last) last = i; // -50dB
    }
  }
  const rms = Math.sqrt(sum / (n * buf.numberOfChannels));
  return {
    peak: +peak.toFixed(3),
    rmsDb: rms > 0 ? +(20 * Math.log10(rms)).toFixed(1) : -Infinity,
    hot: +(hot / (n * buf.numberOfChannels)).toFixed(4),
    len: +(last / SR).toFixed(2),
  };
}

/** names 의 소리를 하나씩(세기 power · 위치 없음) 렌더해 숫자로 */
export async function offlineCheck(names, { seconds = 3, power = 0.8, volumes = { master: 1, music: 0, sfx: 1 } } = {}) {
  const out = {};
  for (const name of names) {
    const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
    const a = createAudio({ context: ctx });
    a.unlock();
    a.setVolumes(volumes);
    const ok = a.play(name, { power });
    const buf = await ctx.startRendering();
    out[name] = ok ? measure(buf) : { error: "play 실패" };
  }
  return out;
}

/** 음악 상태마다 seconds 초를 렌더해 숫자로(강도 intensity) */
export async function offlineMusic({ states = ["menu", "play", "final", "results"], seconds = 6, intensity = 0.5 } = {}) {
  const out = {};
  for (const st of states) {
    const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
    const a = createAudio({ context: ctx });
    a.unlock();
    a.setVolumes({ master: 1, music: 1, sfx: 0 });
    a.music.setState(st);
    a.music.setIntensity(intensity);
    a.music.renderAhead(seconds);
    const buf = await ctx.startRendering();
    out[st] = measure(buf);
  }
  return out;
}
