import {
  DISCLAIMER,
  LIMIT_MESSAGE,
  MAX_CONTEXT,
  MAX_USER_ANSWER,
  NO_COUNTER_REASON,
  NO_KEY_REASON,
  type GradeLimiter,
  RateLimiter,
  parseModelJson,
  readLimits,
  tokyoDay,
} from "./grade";
import { limiterFromEnv } from "./grade-limit";

export const DEFAULT_OPENAI_MODEL = "gpt-4.1-nano";
export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

type Env = Record<string, string | undefined>;

export type GradeRequest = {
  method?: string;
  headers?: Headers | Record<string, string | string[] | undefined>;
  body?: unknown;
};

export type GradeResponse = {
  status: (code: number) => GradeResponse;
  json: (body: unknown) => void;
};

type FetchImpl = typeof fetch;

type HandlerDeps = {
  fetch?: FetchImpl;
  limiter?: GradeLimiter;
  env?: () => Env;
  now?: () => number;
};

type GradeFields = {
  prompt: string;
  points: string;
  officialAnswer: string;
  commentary: string;
  userAnswer: string;
  maxChars: number | null;
};

export function createGradeHandler(deps: HandlerDeps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const readEnv = deps.env ?? readProcessEnv;
  const now = deps.now ?? Date.now;
  const memory = new RateLimiter();

  return async function gradeHandler(req: GradeRequest, res: GradeResponse): Promise<void> {
    const env = readEnv();
    const limiter = deps.limiter ?? limiterFromEnv(env, fetchImpl, now, memory);
    if (req.method === "GET") {
      if (!hasKey(env)) {
        res.status(200).json({ enabled: false, reason: NO_KEY_REASON });
        return;
      }
      if (!limiter.configured) {
        res.status(200).json({ enabled: false, reason: NO_COUNTER_REASON });
        return;
      }
      res.status(200).json({ enabled: true });
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "method" });
      return;
    }

    const fields = readFields(req.body);
    if (!fields) {
      res.status(400).json({ error: "empty" });
      return;
    }
    if (fields === "too_long") {
      res.status(400).json({ error: "too_long" });
      return;
    }
    if (!hasKey(env)) {
      res.status(503).json({ error: "unconfigured", reason: NO_KEY_REASON });
      return;
    }
    if (!limiter.configured) {
      res.status(503).json({ error: "unconfigured", reason: NO_COUNTER_REASON });
      return;
    }

    const day = tokyoDay(now());
    const ipHash = await hashIp(clientIp(req.headers), day);
    try {
      if (!(await limiter.allow(day, ipHash, readLimits(env)))) {
        res.status(429).json({ error: "limit", message: LIMIT_MESSAGE });
        return;
      }
    } catch {
      res.status(503).json({ error: "bad" });
      return;
    }

    const completed = await complete(env, fields, fetchImpl);
    if (completed.kind === "limit") {
      try {
        await limiter.blockProvider(day);
      } catch {
        // The provider call already stopped. A failed write must not change this response.
      }
      res.status(429).json({ error: "limit", message: LIMIT_MESSAGE });
      return;
    }
    if (completed.kind === "bad") {
      res.status(502).json({ error: "bad" });
      return;
    }
    const parsed = parseModelJson(completed.text);
    if (!parsed) {
      res.status(502).json({ error: "bad" });
      return;
    }
    res.status(200).json({ score: parsed.score, comment: parsed.comment, disclaimer: DISCLAIMER });
  };
}

function hasKey(env: Env): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim() || env.GEMINI_API_KEY?.trim());
}

function readProcessEnv(): Env {
  const proc = (globalThis as { process?: { env?: Env } }).process;
  return proc?.env ?? {};
}

function readFields(body: unknown): GradeFields | "too_long" | null {
  let value = body;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const prompt = asText(record.prompt);
  const points = asText(record.points);
  const officialAnswer = asText(record.officialAnswer);
  const commentary = asText(record.commentary);
  const userAnswer = asText(record.userAnswer).trim();
  if (!prompt || !userAnswer) return null;
  const maxChars = record.maxChars === null || record.maxChars === undefined ? null : record.maxChars;
  if (maxChars !== null && (typeof maxChars !== "number" || !Number.isFinite(maxChars))) return null;
  const lengths = [prompt, points, officialAnswer, commentary];
  if (lengths.some((item) => item.length > MAX_CONTEXT) || userAnswer.length > MAX_USER_ANSWER) return "too_long";
  return { prompt, points, officialAnswer, commentary, userAnswer, maxChars };
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clientIp(headers: GradeRequest["headers"]): string {
  const forwarded = header(headers, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return header(headers, "x-real-ip") || "unknown";
}

function header(headers: GradeRequest["headers"], name: string): string {
  if (!headers) return "";
  if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.get(name) ?? "";
  const record = headers as Record<string, string | string[] | undefined>;
  const value = record[name] ?? record[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

async function hashIp(ip: string, day: string): Promise<string> {
  const data = new TextEncoder().encode(`${day}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function complete(
  env: Env,
  fields: GradeFields,
  fetchImpl: FetchImpl,
): Promise<{ kind: "ok"; text: string } | { kind: "limit" } | { kind: "bad" }> {
  const openai = env.OPENAI_API_KEY?.trim();
  if (openai) return callOpenAI(openai, env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL, fields, fetchImpl);
  const gemini = env.GEMINI_API_KEY?.trim();
  if (gemini) return callGemini(gemini, env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL, fields, fetchImpl);
  return { kind: "bad" };
}

function instruction(fields: GradeFields): string {
  const limit = fields.maxChars === null ? "字数制限なし" : `${fields.maxChars}字以内`;
  return [
    "次の1設問だけを採点する。JSONだけを返す。形は {\"score\":\"満点に対する目安\",\"comment\":\"足りないキーワードとずれ\"}。",
    "commentは200字以内。受験者の解答をそのまま書き戻さない。",
    `設問: ${fields.prompt}`,
    `字数制限: ${limit}`,
    `出題趣旨: ${fields.points}`,
    `解答例: ${fields.officialAnswer}`,
    `採点講評: ${fields.commentary}`,
    `受験者の解答: ${fields.userAnswer}`,
  ].join("\n");
}

async function callOpenAI(
  key: string,
  model: string,
  fields: GradeFields,
  fetchImpl: FetchImpl,
): Promise<{ kind: "ok"; text: string } | { kind: "limit" } | { kind: "bad" }> {
  const response = await requestJson(
    fetchImpl,
    "https://api.openai.com/v1/chat/completions",
    {
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    {
      model,
      max_completion_tokens: 300,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "あなたは情報処理安全確保支援士の午後試験の採点補助です。点数は目安です。" },
        { role: "user", content: instruction(fields) },
      ],
    },
  );
  if (response.kind !== "ok") return response;
  const content = response.json as { choices?: { message?: { content?: string } }[] };
  const text = content.choices?.[0]?.message?.content;
  return typeof text === "string" ? { kind: "ok", text } : { kind: "bad" };
}

async function callGemini(
  key: string,
  model: string,
  fields: GradeFields,
  fetchImpl: FetchImpl,
): Promise<{ kind: "ok"; text: string } | { kind: "limit" } | { kind: "bad" }> {
  const response = await requestJson(
    fetchImpl,
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      "content-type": "application/json",
      "x-goog-api-key": key,
    },
    {
      contents: [{ parts: [{ text: instruction(fields) }] }],
      generationConfig: { maxOutputTokens: 300, responseMimeType: "application/json" },
    },
  );
  if (response.kind !== "ok") return response;
  const content = response.json as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = content.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === "string" ? { kind: "ok", text } : { kind: "bad" };
}

async function requestJson(
  fetchImpl: FetchImpl,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ kind: "ok"; json: unknown } | { kind: "limit" } | { kind: "bad" }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (isQuota(response.status, raw)) return { kind: "limit" };
    if (!response.ok) return { kind: "bad" };
    try {
      return { kind: "ok", json: JSON.parse(raw) };
    } catch {
      return { kind: "bad" };
    }
  } catch {
    return { kind: "bad" };
  } finally {
    clearTimeout(timer);
  }
}

function isQuota(status: number, body: string): boolean {
  if (status === 429 || status === 402) return true;
  return /insufficient_quota|billing_hard_limit|rate_limit_exceeded/i.test(body);
}
