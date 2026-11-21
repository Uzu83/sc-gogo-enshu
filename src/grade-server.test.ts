import { afterEach, describe, expect, it, vi } from "vitest";
import { DISCLAIMER, LIMIT_MESSAGE, RateLimiter } from "./grade";
import { createGradeHandler, type GradeRequest, type GradeResponse } from "./grade-server";

const answer = "秘密の解答テキストUNIQUE";

function mockRes(): GradeResponse & { statusCode: number; body: unknown } {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
    },
  };
}

function post(body: unknown): GradeRequest {
  return {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.5" },
    body,
  };
}

const fields = {
  prompt: "設問1 a",
  maxChars: null,
  points: "出題趣旨の要約",
  officialAnswer: "できない",
  commentary: "語句の意味を問う",
  userAnswer: answer,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("grade handler", () => {
  it("disables grading when no key is configured and does not call the provider", async () => {
    const fetchImpl = vi.fn();
    const handler = createGradeHandler({
      fetch: fetchImpl as unknown as typeof fetch,
      env: () => ({}),
      limiter: new RateLimiter(),
    });
    const res = mockRes();
    await handler({ method: "GET" }, res);
    expect(res.body).toEqual({
      enabled: false,
      reason: "AI採点のキーがサーバーにないため、このボタンは使えません。",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a score without logging or echoing the answer", async () => {
    const logs: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"score":"8/10","comment":"概ね合っている"}' } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const handler = createGradeHandler({
      fetch: fetchImpl as unknown as typeof fetch,
      env: () => ({ OPENAI_API_KEY: "test-openai-key", OPENAI_MODEL: "gpt-4.1-nano" }),
      limiter: new RateLimiter(),
      now: () => Date.parse("2026-11-21T01:00:00Z"),
    });
    const res = mockRes();
    await handler(post(fields), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ score: "8/10", comment: "概ね合っている", disclaimer: DISCLAIMER });
    expect(JSON.stringify(res.body)).not.toContain(answer);
    expect(logs.join("\n")).not.toContain(answer);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call?.[0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(call?.[1]?.headers).toMatchObject({ Authorization: "Bearer test-openai-key" });
    expect(String(call?.[1]?.body)).toContain(answer);
    log.mockRestore();
    error.mockRestore();
  });

  it("stops on the provider quota error without a second request", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 }));
    const handler = createGradeHandler({
      fetch: fetchImpl as unknown as typeof fetch,
      env: () => ({ OPENAI_API_KEY: "test-openai-key" }),
      limiter: new RateLimiter(),
    });
    const res = mockRes();
    await handler(post(fields), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ error: "limit", message: LIMIT_MESSAGE });
    const again = mockRes();
    await handler(post(fields), again);
    expect(again.statusCode).toBe(429);
    expect(again.body).toMatchObject({ error: "limit", message: LIMIT_MESSAGE });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not call the provider for an empty or oversized answer", async () => {
    const fetchImpl = vi.fn();
    const handler = createGradeHandler({
      fetch: fetchImpl as unknown as typeof fetch,
      env: () => ({ OPENAI_API_KEY: "test-openai-key" }),
      limiter: new RateLimiter(),
    });
    const empty = mockRes();
    await handler(post({ ...fields, userAnswer: "  " }), empty);
    expect(empty.statusCode).toBe(400);
    const huge = mockRes();
    await handler(post({ ...fields, userAnswer: "あ".repeat(2001) }), huge);
    expect(huge.body).toEqual({ error: "too_long" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses Gemini only when the OpenAI key is absent", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"score":"5/10","comment":"用語が違う"}' }] } }] }),
        { status: 200 },
      );
    });
    const handler = createGradeHandler({
      fetch: fetchImpl as unknown as typeof fetch,
      env: () => ({ GEMINI_API_KEY: "test-gemini-key" }),
      limiter: new RateLimiter(),
    });
    const res = mockRes();
    await handler(post(fields), res);
    expect(res.statusCode).toBe(200);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(call?.[0])).toContain("generativelanguage.googleapis.com");
    expect(call?.[1]?.headers).toMatchObject({ "x-goog-api-key": "test-gemini-key" });
  });

  it("blocks the sixth request from the same address", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"score":"1/10","comment":"不足"}' } }] }), {
        status: 200,
      });
    });
    const handler = createGradeHandler({
      fetch: fetchImpl as unknown as typeof fetch,
      env: () => ({ OPENAI_API_KEY: "test-openai-key", GRADE_IP_DAILY_LIMIT: "5", GRADE_DAILY_LIMIT: "40" }),
      limiter: new RateLimiter(),
      now: () => Date.parse("2026-11-21T03:00:00Z"),
    });
    for (let i = 0; i < 5; i += 1) {
      const res = mockRes();
      await handler(post(fields), res);
      expect(res.statusCode).toBe(200);
    }
    const blocked = mockRes();
    await handler(post(fields), blocked);
    expect(blocked.statusCode).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("keeps the local daily cap across requests in one process", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"score":"1/10","comment":"不足"}' } }] }), {
        status: 200,
      });
    });
    const handler = createGradeHandler({
      fetch: fetchImpl as unknown as typeof fetch,
      env: () => ({ OPENAI_API_KEY: "test-openai-key", GRADE_DAILY_LIMIT: "1", GRADE_IP_DAILY_LIMIT: "1" }),
      now: () => Date.parse("2026-11-22T01:00:00Z"),
    });
    const first = mockRes();
    await handler(post(fields), first);
    expect(first.statusCode).toBe(200);
    const second = mockRes();
    await handler(post(fields), second);
    expect(second.statusCode).toBe(429);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not call the provider on Vercel when the shared counter is missing", async () => {
    const fetchImpl = vi.fn();
    const handler = createGradeHandler({
      fetch: fetchImpl as unknown as typeof fetch,
      env: () => ({ OPENAI_API_KEY: "test-openai-key", VERCEL: "1" }),
    });
    const status = mockRes();
    await handler({ method: "GET" }, status);
    expect(status.body).toMatchObject({ enabled: false });
    const res = mockRes();
    await handler(post(fields), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: "unconfigured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not call the provider when the shared counter fails", async () => {
    const fetchImpl = vi.fn();
    const handler = createGradeHandler({
      fetch: fetchImpl as unknown as typeof fetch,
      env: () => ({ OPENAI_API_KEY: "test-openai-key" }),
      limiter: {
        configured: true,
        allow() {
          return Promise.reject(new Error("counter"));
        },
        blockProvider() {
          return Promise.resolve();
        },
      },
    });
    const res = mockRes();
    await handler(post(fields), res);
    expect(res.statusCode).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
