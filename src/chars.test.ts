import { describe, expect, it } from "vitest";
import { countChars, remainingChars } from "./chars";

describe("countChars", () => {
  it("counts characters without newlines", () => {
    expect(countChars("できない")).toBe(4);
    expect(countChars("40字\n以内")).toBe(5);
    expect(countChars("aｂ")).toBe(2);
  });

  it("reports remaining characters against the limit", () => {
    expect(remainingChars("できない", 5)).toBe(1);
    expect(remainingChars("できないです", 4)).toBe(-2);
  });
});
