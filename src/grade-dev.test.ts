import { createServer } from "vite";
import { describe, expect, it } from "vitest";
import { gradeDevMiddleware } from "./grade-dev";
import type { GradeRequest, GradeResponse } from "./grade-server";

function request(method: string, url: string, body = ""): {
  method: string;
  url: string;
  headers: Record<string, string>;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
} {
  return {
    method,
    url,
    headers: { "x-forwarded-for": "203.0.113.8" },
    async *[Symbol.asyncIterator]() {
      if (body) yield new TextEncoder().encode(body);
    },
  };
}

function response(): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
} {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(body = "") {
      this.body = body;
    },
  };
}

describe("local grade route", () => {
  it("serves /api/grade and leaves other paths alone", async () => {
    const seen: GradeRequest[] = [];
    const middleware = gradeDevMiddleware(async (req: GradeRequest, res: GradeResponse) => {
      seen.push(req);
      res.status(200).json({ enabled: true });
    });
    const other = response();
    let passed = false;
    await middleware(request("GET", "/"), other, () => {
      passed = true;
    });
    expect(passed).toBe(true);
    expect(seen).toHaveLength(0);

    const graded = response();
    const payload = JSON.stringify({ prompt: "設問1", userAnswer: "できない" });
    await middleware(request("POST", "/api/grade?x=1", payload), graded, () => {
      throw new Error("next");
    });
    expect(graded.statusCode).toBe(200);
    expect(graded.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(graded.body)).toEqual({ enabled: true });
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.body).toBe(payload);
  });

  it("answers GET /api/grade from the dev server", async () => {
    const server = await createServer({
      configFile: new URL("../vite.config.ts", import.meta.url).pathname,
      server: { host: "127.0.0.1", port: 0 },
      logLevel: "silent",
    });
    await server.listen();
    try {
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("no port");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/grade`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      const body = (await response.json()) as { enabled?: boolean };
      expect(typeof body.enabled).toBe("boolean");
    } finally {
      await server.close();
    }
  });
});
