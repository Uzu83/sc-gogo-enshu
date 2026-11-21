import { describe, expect, it } from "vitest";
import examFile from "./exams.json";
import {
  DISCLAIMER,
  LIMIT_MESSAGE,
  RateLimiter,
  excerptForPrompt,
  extractPoints,
  parseModelJson,
  presentGrade,
  readLimits,
  tokyoDay,
} from "./grade";
import type { ExamFile } from "./types";

const exams = examFile as ExamFile;

describe("grade copy", () => {
  it("shows the disclaimer beside every score", () => {
    expect(presentGrade({ score: "6/10", comment: "キーワードが足りない" })).toEqual({
      disclaimer: DISCLAIMER,
      score: "6/10",
      comment: "キーワードが足りない",
    });
  });

  it("turns a quota error into the self-check message", () => {
    expect(presentGrade({ error: "limit" }).message).toBe(LIMIT_MESSAGE);
  });
});

describe("official text", () => {
  const question = exams.exams[0]?.questions[0];
  if (!question) throw new Error("missing sample question");

  it("keeps the 出題趣旨 and the matching answer line", () => {
    expect(extractPoints(question.answer)).toContain("セキュアプログラミング");
    expect(excerptForPrompt(question.answer, "設問1 a")).toContain("できない");
    expect(excerptForPrompt(question.answer, "設問2（1）")).toContain("ロール管理");
  });
});

describe("limits", () => {
  it("resets on the Tokyo date and stops at the daily cap", async () => {
    expect(tokyoDay(Date.parse("2026-11-20T14:59:00Z"))).toBe("2026-11-20");
    expect(tokyoDay(Date.parse("2026-11-20T15:00:00Z"))).toBe("2026-11-21");

    const limiter = new RateLimiter();
    const limits = { daily: 2, perIp: 2 };
    expect(await limiter.allow("2026-11-20", "aaaa", limits)).toBe(true);
    expect(await limiter.allow("2026-11-20", "bbbb", limits)).toBe(true);
    expect(await limiter.allow("2026-11-20", "cccc", limits)).toBe(false);
    expect(await limiter.allow("2026-11-21", "cccc", limits)).toBe(true);
  });

  it("stops one address before the global cap", async () => {
    const limiter = new RateLimiter();
    const limits = { daily: 10, perIp: 1 };
    expect(await limiter.allow("2026-11-21", "aaaa", limits)).toBe(true);
    expect(await limiter.allow("2026-11-21", "aaaa", limits)).toBe(false);
    expect(await limiter.allow("2026-11-21", "bbbb", limits)).toBe(true);
  });

  it("keeps a provider block until the Tokyo day changes", async () => {
    const limiter = new RateLimiter();
    const limits = { daily: 10, perIp: 5 };
    expect(await limiter.allow("2026-11-21", "aaaa", limits)).toBe(true);
    await limiter.blockProvider("2026-11-21");
    expect(await limiter.allow("2026-11-21", "bbbb", limits)).toBe(false);
    expect(await limiter.allow("2026-11-22", "bbbb", limits)).toBe(true);
  });

  it("clamps env overrides", () => {
    expect(readLimits({ GRADE_DAILY_LIMIT: "9999", GRADE_IP_DAILY_LIMIT: "0" })).toEqual({
      daily: 200,
      perIp: 1,
    });
  });
});

describe("parseModelJson", () => {
  it("accepts a fenced JSON object and drops the raw answer", () => {
    const parsed = parseModelJson('```json\n{"score":"4/10","comment":"主体が違う","echo":"秘密"}\n```');
    expect(parsed).toEqual({ score: "4/10", comment: "主体が違う" });
  });
});
