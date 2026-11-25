import { RateLimiter, tokyoDay, type GradeLimiter, type GradeLimits } from "./grade";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HASH = /^[0-9a-f]{16}$/;

/** Seconds until the next Tokyo midnight, plus one hour so a late request still expires. */
export function counterTtlSeconds(now: number): number {
  const day = tokyoDay(now);
  const start = Date.parse(`${day}T00:00:00+09:00`);
  const seconds = Math.ceil((start + 24 * 60 * 60 * 1000 - now) / 1000) + 60 * 60;
  if (!Number.isFinite(seconds)) return 48 * 60 * 60;
  return Math.min(48 * 60 * 60, Math.max(60, seconds));
}

export class UnconfiguredLimiter implements GradeLimiter {
  readonly configured = false;

  async allow(): Promise<boolean> {
    return false;
  }

  async blockProvider(): Promise<void> {}
}

type Env = Record<string, string | undefined>;

/**
 * One atomic Redis script shared by every Vercel instance.
 * Returns 1 when this call may use the paid API, otherwise 0.
 * Over-limit increments are rolled back so a rejected call does not consume a slot.
 */
const CONSUME_SCRIPT = `
local blocked = redis.call('GET', KEYS[1])
if blocked then
  return 0
end
local g = redis.call('INCR', KEYS[2])
local i = redis.call('INCR', KEYS[3])
local ttl = tonumber(ARGV[3])
if g == 1 then
  redis.call('EXPIRE', KEYS[2], ttl)
end
if i == 1 then
  redis.call('EXPIRE', KEYS[3], ttl)
end
if g > tonumber(ARGV[1]) or i > tonumber(ARGV[2]) then
  redis.call('DECR', KEYS[2])
  redis.call('DECR', KEYS[3])
  return 0
end
return 1
`;

export class UpstashGradeLimiter implements GradeLimiter {
  readonly configured = true;

  constructor(
    private readonly options: {
      url: string;
      token: string;
      fetchImpl: typeof fetch;
      now: () => number;
    },
  ) {}

  async allow(day: string, ipHash: string, limits: GradeLimits): Promise<boolean> {
    const keys = counterKeys(day, ipHash);
    const ttl = String(counterTtlSeconds(this.options.now()));
    const result = await redisCommand(this.options, [
      "EVAL",
      CONSUME_SCRIPT,
      "3",
      keys.blocked,
      keys.global,
      keys.ip,
      String(limits.daily),
      String(limits.perIp),
      ttl,
    ]);
    if (result !== 0 && result !== 1 && result !== "0" && result !== "1") throw new Error("counter");
    return result === 1 || result === "1";
  }

  async blockProvider(day: string): Promise<void> {
    if (!DAY.test(day)) throw new Error("counter");
    const ttl = String(counterTtlSeconds(this.options.now()));
    await redisCommand(this.options, ["SET", `sc-grade:${day}:blocked`, "1", "EX", ttl]);
  }
}

export function limiterFromEnv(
  env: Env,
  fetchImpl: typeof fetch,
  now: () => number,
  memory: GradeLimiter = new RateLimiter(),
): GradeLimiter {
  const url = env.UPSTASH_REDIS_REST_URL?.trim() ?? "";
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? "";
  if (url || token) {
    if (url.startsWith("https://") && token) return new UpstashGradeLimiter({ url, token, fetchImpl, now });
    return new UnconfiguredLimiter();
  }
  if (env.VERCEL) return new UnconfiguredLimiter();
  return memory;
}

function counterKeys(day: string, ipHash: string): { blocked: string; global: string; ip: string } {
  if (!DAY.test(day) || !HASH.test(ipHash)) throw new Error("counter");
  return {
    blocked: `sc-grade:${day}:blocked`,
    global: `sc-grade:${day}:g`,
    ip: `sc-grade:${day}:i:${ipHash}`,
  };
}

async function redisCommand(
  options: { url: string; token: string; fetchImpl: typeof fetch },
  command: string[],
): Promise<unknown> {
  const endpoint = new URL(options.url);
  if (endpoint.protocol !== "https:") throw new Error("counter");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await options.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error("counter");
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("counter");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("counter");
    const record = data as Record<string, unknown>;
    if (record.error) throw new Error("counter");
    return record.result;
  } finally {
    clearTimeout(timer);
  }
}
