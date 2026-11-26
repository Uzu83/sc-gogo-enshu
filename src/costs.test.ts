import { describe, expect, it } from "vitest";
import {
  balance,
  costsRequested,
  findMonth,
  formatMonth,
  fundingRefresh,
  isFunded,
  monthKey,
  supporterNames,
  supportLine,
  totalCost,
  type CostsFile,
} from "./costs";

const file: CostsFile = {
  months: [
    {
      month: "2026-11",
      costs: [
        { item: "Vercel", amount: 0, basis: "無料枠" },
        { item: "ドメイン", amount: 2000, basis: "例" },
      ],
      received: 2000,
    },
    {
      month: "2026-12",
      costs: [{ item: "ドメイン", amount: 2000, basis: "例" }],
      received: 0,
    },
  ],
};

describe("costs", () => {
  it("uses the Japan calendar month", () => {
    expect(monthKey(Date.parse("2026-11-30T14:59:00Z"))).toBe("2026-11");
    expect(monthKey(Date.parse("2026-11-30T15:00:00Z"))).toBe("2026-12");
    expect(formatMonth("2026-11")).toBe("2026年11月");
  });

  it("hides support only when this month's gifts cover the costs", () => {
    const november = findMonth(file, "2026-11");
    const december = findMonth(file, "2026-12");
    expect(totalCost(november!)).toBe(2000);
    expect(isFunded(november)).toBe(true);
    expect(balance(november!)).toBe(0);
    expect(isFunded(december)).toBe(false);
    expect(balance(december!)).toBe(-2000);
    expect(isFunded(findMonth(file, "2027-01"))).toBe(false);
    expect(supportLine(true)).toBe("今月の運営費は集まりました。ありがとうございます");
    expect(supportLine(false)).toContain("Ko-fi");
  });

  it("lists only nicknames", () => {
    expect(supporterNames([{ nickname: "青い鉛筆" }, { nickname: "  " }])).toEqual(["青い鉛筆"]);
  });

  it("refreshes support when the page stays open across a Japan month boundary", () => {
    const before = Date.parse("2026-11-30T14:59:00Z");
    const after = Date.parse("2026-11-30T15:00:00Z");
    expect(fundingRefresh("2026-11", before, true)).toEqual({
      month: "2026-11",
      changed: false,
      rerenderCosts: false,
    });
    const onCosts = fundingRefresh("2026-11", after, true);
    expect(onCosts).toEqual({ month: "2026-12", changed: true, rerenderCosts: true });
    expect(fundingRefresh("2026-11", after, false)).toEqual({
      month: "2026-12",
      changed: true,
      rerenderCosts: false,
    });
    expect(isFunded(findMonth(file, "2026-11"))).toBe(true);
    expect(isFunded(findMonth(file, onCosts.month))).toBe(false);
  });

  it("treats /costs and the hash route as the costs page", () => {
    expect(costsRequested("/costs", "")).toBe(true);
    expect(costsRequested("/costs/", "#/r07a")).toBe(true);
    expect(costsRequested("/", "#/costs")).toBe(true);
    expect(costsRequested("/", "#/r07a/1")).toBe(false);
  });
});
