import { describe, expect, it } from "vitest";
import {
  createTimer,
  formatRemaining,
  isFinished,
  isLowTime,
  pauseTimer,
  remainingMs,
  resumeTimer,
} from "./timer";

describe("timer", () => {
  it("counts down only while running", () => {
    const started = createTimer(90_000, 1_000, true);
    expect(remainingMs(started, 1_000)).toBe(90_000);
    expect(remainingMs(started, 11_000)).toBe(80_000);

    const paused = pauseTimer(started, 11_000);
    expect(remainingMs(paused, 50_000)).toBe(80_000);

    const resumed = resumeTimer(paused, 50_000);
    expect(remainingMs(resumed, 55_000)).toBe(75_000);
  });

  it("stops at zero and flags the last five minutes", () => {
    const state = createTimer(6 * 60 * 1000, 0, true);
    expect(isLowTime(state, 30_000)).toBe(false);
    expect(isLowTime(state, 90_000)).toBe(true);
    expect(isFinished(state, 6 * 60 * 1000)).toBe(true);
    expect(remainingMs(state, 9 * 60 * 1000)).toBe(0);
    expect(resumeTimer(pauseTimer(state, 9 * 60 * 1000), 9 * 60 * 1000).running).toBe(false);
  });

  it("formats the remaining duration with hours, minutes, and seconds", () => {
    expect(formatRemaining(0)).toMatch(/0:00:00/);
    expect(formatRemaining(75 * 60 * 1000)).toMatch(/1:15:00/);
    expect(formatRemaining(50_000)).toMatch(/0:00:50/);
  });
});
