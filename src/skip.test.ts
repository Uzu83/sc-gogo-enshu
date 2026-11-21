import { describe, expect, it } from "vitest";
import exams from "./exams.json";
import { keepPageOnContentSkip, onSkipClick } from "./skip";

describe("skip link", () => {
  it("keeps the current page when the hash is only the content target", () => {
    expect(keepPageOnContentSkip("#main", true)).toBe(true);
    expect(keepPageOnContentSkip("#main", false)).toBe(false);
    expect(keepPageOnContentSkip("#/r07a/4", true)).toBe(false);
  });

  it("does not follow the link, and focuses the content", () => {
    let prevented = false;
    let focused = false;
    const content = { focus: () => { focused = true; } } as HTMLElement;
    onSkipClick({ preventDefault: () => { prevented = true; } } as Event, content);
    expect(prevented).toBe(true);
    expect(focused).toBe(true);
  });
});

describe("autumn question 4 answers", () => {
  const answer = exams.exams[0]?.questions[3]?.answer ?? "";

  it("keeps the model answers out of the grading notes", () => {
    expect(answer).toContain(
      "h SCADA 内の NC プログラムをバックアップ／リストアするための媒体とソフトウェア",
    );
    expect(answer).toContain("i SCADA に NC プログラムをリストアする手順");
    expect(answer).toContain(
      "j マルウェアに感染した一般 PC が，正常な通信を妨害するパケットを大量に送信して，SCADA と工作機械の間の通信ができなくなる。",
    );
    expect(answer).toContain(
      "k SCADA，工作機械及び製造監視用 PC だけの独立した LAN を構成するためのネットワーク機器",
    );
    expect(answer).toContain(
      "l SCADA，工作機械及び製造監視用 PC を L 社のネットワークから切り離す手順",
    );
    expect(answer).toContain(
      "備考 左の例に限らず，本文の状況に沿った仕組み，手順が記述されていること",
    );
    expect(answer).toContain(
      "備考 左の例に限らず，本文の状況に沿った被害のシナリオが記述されていて，有効な仕組み，手順が記述されていること",
    );
    expect(answer).not.toContain("左の例に限ら\n");
    expect(answer).not.toContain("ソフ\nず");
    expect(answer).not.toContain("i み，手順が記述");
  });
});
