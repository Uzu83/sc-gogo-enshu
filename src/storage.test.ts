import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAnswer, saveAnswer } from "./storage";

function installMemoryStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  });
}

describe("saveAnswer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps an answer across a reload and does not call fetch", () => {
    installMemoryStorage();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    saveAnswer("r07a", 1, "s1", "できない");
    expect(loadAnswer("r07a", 1, "s1")).toBe("できない");
    expect(loadAnswer("r07a", 1, "other")).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
