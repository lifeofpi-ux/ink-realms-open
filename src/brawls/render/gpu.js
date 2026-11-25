// GPU 시간 재기와 화질 자동 낮추기(docs/DESIGN.md §3.5 — ink-brawl 의 GPU 타이머 방식을 그대로 잇는다).
//
// 타이머: EXT_disjoint_timer_query_webgl2 로 한 프레임(월드 패스 ~ HD 레이어)을 잰다. 결과는 한두 프레임 뒤에 나온다.
//         타이머가 없는 브라우저(사파리 · 일부 맥 크롬)는 프레임 빠르기(fps)로 대신 판단한다.
// 낮추기(governor — 순수 함수라 Node 에서 시험한다): 그 단계의 예산을 넘는 상태가 STRIKE 초 이어지면 한 단계(고 → 중 → 저) 내린다.
//         막 바뀐 직후 WARMUP 개의 값은 믿지 않는다(셰이더 준비 · 버퍼 할당). 올리지는 않는다(사용자가 고르게).

export const GPU_BUDGET = { high: 9, mid: 7, low: 4 }; // ms(한 프레임 GPU 시간)
export const FPS_FLOOR = 24;
const STRIKE = 3; // 초
const WARMUP = 30;

/** 다음 단계(더 낮은). low 면 null */
export const lowerOf = (level) => (level === "high" ? "mid" : level === "mid" ? "low" : null);

/**
 * 자동 화질 판단기. feed 를 프레임마다(또는 측정값이 나올 때마다) 부르고, 낮춰야 하면 새 단계를 돌려준다.
 */
export function createGovernor() {
  const g = {
    ema: 0,
    n: 0,
    over: 0, // 예산을 넘은 채 흐른 시간(초)
    reset() {
      g.ema = 0;
      g.n = 0;
      g.over = 0;
    },
    /**
     * @param {string} level 지금 단계
     * @param {number} dt    지난 측정 뒤 흐른 시간(초)
     * @param {{ gpuMs?: number, fps?: number }} m  GPU 시간(있으면 우선) 또는 fps
     * @returns {string|null} 낮출 단계(없으면 null)
     */
    feed(level, dt, m) {
      let bad;
      if (Number.isFinite(m.gpuMs)) {
        g.ema = g.n === 0 ? m.gpuMs : g.ema + (m.gpuMs - g.ema) * 0.08;
        if (++g.n < WARMUP) return null;
        bad = g.ema > GPU_BUDGET[level];
      } else if (Number.isFinite(m.fps)) {
        bad = m.fps < FPS_FLOOR;
      } else return null;
      g.over = bad ? g.over + dt : 0;
      if (g.over < STRIKE) return null;
      const next = lowerOf(level);
      g.reset();
      return next;
    },
  };
  return g;
}

/** GPU 타이머(없으면 supported = false). begin/end 를 한 프레임의 처음 · 끝에서 부른다. lastMs = 가장 최근 값 */
export function createGpuTimer(gl) {
  const ext = gl && gl.getExtension ? gl.getExtension("EXT_disjoint_timer_query_webgl2") : null;
  const queue = [];
  let active = null;
  const t = {
    supported: !!ext,
    lastMs: NaN,
    begin() {
      if (!ext || active || queue.length > 3) return;
      active = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    },
    /** 끝낸다. 결과가 나온 것이 있으면 그 ms 를 돌려준다(없으면 NaN) */
    end() {
      if (!ext) return NaN;
      if (active) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        queue.push(active);
        active = null;
      }
      let ms = NaN;
      while (queue.length && gl.getQueryParameter(queue[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = queue.shift();
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        const v = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(q);
        if (!disjoint) ms = v;
      }
      if (Number.isFinite(ms)) t.lastMs = ms;
      return ms;
    },
    /** 그래픽 연결이 끊겼다 되살아났다 — 묵은 질의를 버린다 */
    reset() {
      queue.length = 0;
      active = null;
    },
  };
  return t;
}
