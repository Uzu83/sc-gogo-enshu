import { createGradeHandler, type GradeRequest, type GradeResponse } from "./grade-server";

type GradeHandler = (req: GradeRequest, res: GradeResponse) => Promise<void>;

type DevRequest = {
  method?: string;
  url?: string;
  headers?: GradeRequest["headers"];
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>;
};

type DevResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
};

export function gradeDevMiddleware(handler: GradeHandler = createGradeHandler()) {
  return async (req: DevRequest, res: DevResponse, next: (err?: unknown) => void): Promise<void> => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/api/grade") {
      next();
      return;
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
    }
    const raw = new TextDecoder().decode(concatBytes(chunks));
    let settled = false;
    const gradeRes: GradeResponse = {
      status(code: number) {
        res.statusCode = code;
        return gradeRes;
      },
      json(body: unknown) {
        if (settled) return;
        const text = JSON.stringify(body);
        settled = true;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(text);
      },
    };
    try {
      await handler({ method: req.method, headers: req.headers, body: raw || undefined }, gradeRes);
    } catch {
      if (!settled) {
        settled = true;
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "bad" }));
      }
    }
  };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
