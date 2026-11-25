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
    const firstBranch = excerptForPrompt(question.answer, "設問2（1）");
    expect(firstBranch).toContain("ロール管理");
    expect(firstBranch).not.toContain("タスク名");
  });

  it("sends each blank its own sample answer", () => {
    const deadline = excerptForPrompt(question.answer, "設問2（4） f");
    expect(deadline).toContain("締切日");
    expect(deadline).not.toContain("出題趣旨");
    expect(deadline).not.toContain("管理者");

    const upload = excerptForPrompt(question.answer, "設問2（5）");
    expect(upload).toContain("アップロード");
    expect(upload).not.toContain("ロール管理");

    const spring = exams.exams.find((exam) => exam.id === "r07h")?.questions.find((item) => item.number === 2);
    if (!spring) throw new Error("missing spring question 2");
    const labels = spring.prompts.map((prompt) => prompt.label);
    const currentValue = excerptForPrompt(spring.answer, "設問5（1） 現状値", labels);
    expect(currentValue).toContain("公開サイト");
    expect(currentValue).not.toContain("FIRST");
    const epss = excerptForPrompt(spring.answer, "設問5（1） EPSS値", labels);
    expect(epss).toContain("FIRST");
    expect(epss).not.toContain("公開サイト");

    for (const exam of exams.exams) {
      for (const item of exam.questions) {
        const names = item.prompts.map((prompt) => prompt.label);
        for (const prompt of item.prompts) {
          const excerpt = excerptForPrompt(item.answer, prompt.label, names);
          expect(excerpt.trim().length, `${exam.id} 問${item.number} ${prompt.label}`).toBeGreaterThan(0);
          expect(excerpt.includes("出題趣旨"), `${exam.id} 問${item.number} ${prompt.label}`).toBe(false);
        }
      }
    }
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
