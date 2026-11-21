import { describe, expect, it, vi } from "vitest";
import { counterTtlSeconds, limiterFromEnv, UpstashGradeLimiter } from "./grade-limit";

const day = "2026-11-22";
const hashA = "0123456789abcdef";
const hashB = "fedcba9876543210";
const limits = { daily: 2, perIp: 1 };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Mirrors the Redis script: reject when blocked or over the cap, and do not keep rejected increments. */
function fakeRedis() {
  const counts = new Map<string, number>();
  const blocked = new Set<string>();
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    expect(String(url).startsWith("https://example.upstash.io")).toBe(true);
    expect(init?.headers).toMatchObject({ authorization: "Bearer test-token" });
    const command = JSON.parse(String(init?.body)) as string[];
    expect(String(init?.body)).not.toContain("秘密の解答");
    if (command[0] === "SET") {
      blocked.add(command[1] ?? "");
      return json({ result: "OK" });
    }
    expect(command[0]).toBe("EVAL");
    const blockedKey = command[3] ?? "";
    const globalKey = command[4] ?? "";
    const ipKey = command[5] ?? "";
    const daily = Number(command[6]);
    const perIp = Number(command[7]);
    if (blocked.has(blockedKey)) return json({ result: 0 });
    const nextGlobal = (counts.get(globalKey) ?? 0) + 1;
    const nextIp = (counts.get(ipKey) ?? 0) + 1;
    if (nextGlobal > daily || nextIp > perIp) return json({ result: 0 });
    counts.set(globalKey, nextGlobal);
    counts.set(ipKey, nextIp);
    return json({ result: 1 });
  });
  return fetchImpl;
}

describe("shared grade counter", () => {
  it("expires an hour after the next Tokyo midnight", () => {
    const now = Date.parse("2026-11-22T14:00:00Z");
    expect(counterTtlSeconds(now)).toBe(2 * 60 * 60);
  });

  it("shares the daily cap and a provider block across limiters", async () => {
    const fetchImpl = fakeRedis();
    const options = {
      url: "https://example.upstash.io",
      token: "test-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => Date.parse("2026-11-22T01:00:00Z"),
    };
    const first = new UpstashGradeLimiter(options);
    const second = new UpstashGradeLimiter(options);
    expect(await first.allow(day, hashA, limits)).toBe(true);
    expect(await second.allow(day, hashA, limits)).toBe(false);
    expect(await second.allow(day, hashB, limits)).toBe(true);
    expect(await first.allow(day, hashB, limits)).toBe(false);
    await first.blockProvider(day);
    expect(await second.allow(day, hashB, limits)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("uses memory locally and refuses an unshared Vercel counter", async () => {
    const local = limiterFromEnv({}, fetch, () => 0);
    expect(local.configured).toBe(true);
    expect(await local.allow(day, hashA, limits)).toBe(true);

    const vercel = limiterFromEnv({ VERCEL: "1", OPENAI_API_KEY: "test-openai-key" }, fetch, () => 0);
    expect(vercel.configured).toBe(false);

    const broken = limiterFromEnv({ UPSTASH_REDIS_REST_URL: "http://example.upstash.io" }, fetch, () => 0);
    expect(broken.configured).toBe(false);
  });
});
