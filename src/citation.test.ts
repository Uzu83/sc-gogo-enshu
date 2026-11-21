import { describe, expect, it } from "vitest";
import { citation } from "./citation";
import exams from "./exams.json";

describe("citation", () => {
  it("uses the IPA source line", () => {
    expect(citation("令和7年度", "秋期", 1)).toBe(
      "出典：令和7年度 秋期 情報処理安全確保支援士試験 午後 問1",
    );
  });
});

describe("exam data", () => {
  it("includes the two latest published afternoon exams, four questions each", () => {
    expect(exams.exams.map((exam) => exam.id)).toEqual(["r07a", "r07h"]);
    for (const exam of exams.exams) {
      expect(exam.section).toBe("午後");
      expect(exam.durationMin).toBe(150);
      expect(exam.perQuestionMin).toBe(75);
      expect(exam.questions.map((question) => question.number)).toEqual([1, 2, 3, 4]);
      for (const question of exam.questions) {
        expect(question.pages.length).toBeGreaterThan(0);
        expect(question.answer.length).toBeGreaterThan(20);
        expect(question.commentary.length).toBeGreaterThan(20);
        expect(question.prompts.length).toBeGreaterThan(0);
      }
    }
    const autumn = exams.exams[0];
    const spring = exams.exams[1];
    expect(autumn?.questions[2]?.prompts[0]).toMatchObject({ id: "s1-1", maxChars: 10 });
    expect(spring?.questions[0]?.prompts[1]).toMatchObject({ id: "s1-2", maxChars: 50 });
    expect(spring?.questions[1]?.prompts).toEqual(
      expect.arrayContaining([
        { id: "s2-f", label: "設問2 f", maxChars: 20 },
        { id: "s2-g", label: "設問2 g", maxChars: 20 },
      ]),
    );
    expect(spring?.questions[1]?.prompts.some((prompt) => prompt.id === "s2")).toBe(false);
    expect(spring?.questions[3]?.prompts.some((prompt) => prompt.maxChars === 60)).toBe(true);
  });
});
