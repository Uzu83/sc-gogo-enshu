import { Temporal as PolyTemporal } from "temporal-polyfill";

const nativeTemporal = (globalThis as { Temporal?: typeof PolyTemporal }).Temporal;
const TemporalApi = nativeTemporal ?? PolyTemporal;

export const LOW_TIME_MS = 5 * 60 * 1000;

export type TimerState = {
  durationMs: number;
  running: boolean;
  /** 一時停止までに消化した時間。 */
  elapsedMs: number;
  /** 走行中の開始時刻。停止中は null。 */
  startedAt: number | null;
};

export function createTimer(durationMs: number, now: number, running = false): TimerState {
  return {
    durationMs,
    running,
    elapsedMs: 0,
    startedAt: running ? now : null,
  };
}

export function elapsedMs(state: TimerState, now: number): number {
  const runningMs =
    state.running && state.startedAt !== null ? Math.max(0, now - state.startedAt) : 0;
  return state.elapsedMs + runningMs;
}

export function remainingMs(state: TimerState, now: number): number {
  return Math.max(0, state.durationMs - elapsedMs(state, now));
}

export function pauseTimer(state: TimerState, now: number): TimerState {
  if (!state.running) return state;
  return {
    ...state,
    running: false,
    elapsedMs: Math.min(state.durationMs, elapsedMs(state, now)),
    startedAt: null,
  };
}

export function resumeTimer(state: TimerState, now: number): TimerState {
  if (state.running || remainingMs(state, now) === 0) return state;
  return { ...state, running: true, startedAt: now };
}

export function isLowTime(state: TimerState, now: number): boolean {
  const left = remainingMs(state, now);
  return left > 0 && left <= LOW_TIME_MS;
}

export function isFinished(state: TimerState, now: number): boolean {
  return remainingMs(state, now) === 0 && state.durationMs > 0;
}

/** 残り時間を H:MM:SS にする。Temporal.Duration は不変。 */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const duration = TemporalApi.Duration.from({ seconds: totalSeconds }).round({
    largestUnit: "hour",
    smallestUnit: "second",
  });
  // toLocaleString の digital は Intl.DurationFormat が無いと ISO（PT0S）になる。
  const minutes = String(duration.minutes).padStart(2, "0");
  const seconds = String(duration.seconds).padStart(2, "0");
  return `${duration.hours}:${minutes}:${seconds}`;
}
