export const DISCLAIMER =
  "IPAの採点基準は公表されていません。この採点はAIによる目安で、実際の得点とは異なります。";

export const SEND_NOTICE = "この解答だけをAIに送ります。こちらには保存しません";

export const LIMIT_MESSAGE = "今日はAI採点の上限に達しました。自己採点をご利用ください";

export const NO_KEY_REASON = "AI採点のキーがサーバーにないため、このボタンは使えません。";

export const NO_COUNTER_REASON =
  "AI採点の回数を日をまたいで数える保存先がないため、このボタンは使えません。";

export const DEFAULT_DAILY_LIMIT = 40;
export const DEFAULT_IP_LIMIT = 5;
/** Env overrides cannot raise the cap past these, so a typo cannot open the budget. */
export const MAX_DAILY_LIMIT = 200;
export const MAX_IP_LIMIT = 50;

export const MAX_USER_ANSWER = 2000;
export const MAX_CONTEXT = 1500;

export type GradeView = {
  disclaimer?: string;
  score?: string;
  comment?: string;
  message?: string;
};

export function presentGrade(payload: unknown): GradeView {
  if (!payload || typeof payload !== "object") {
    return { message: "採点できませんでした。しばらくしてからもう一度押してください。" };
  }
  const data = payload as Record<string, unknown>;
  if (data.error === "limit") return { message: LIMIT_MESSAGE };
  if (data.error === "empty") return { message: "解答を書いてから採点してください。" };
  if (data.error === "too_long") return { message: "解答が長すぎるため、AI採点を止めました。" };
  if (data.error === "unconfigured") {
    return { message: typeof data.reason === "string" ? data.reason : NO_KEY_REASON };
  }
  if (typeof data.score === "string" && typeof data.comment === "string" && data.score && data.comment) {
    return { disclaimer: DISCLAIMER, score: data.score, comment: data.comment };
  }
  return { message: "採点できませんでした。しばらくしてからもう一度押してください。" };
}

export function tokyoDay(now: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function readLimits(env: Record<string, string | undefined>): { daily: number; perIp: number } {
  return {
    daily: clampInt(env.GRADE_DAILY_LIMIT, DEFAULT_DAILY_LIMIT, 1, MAX_DAILY_LIMIT),
    perIp: clampInt(env.GRADE_IP_DAILY_LIMIT, DEFAULT_IP_LIMIT, 1, MAX_IP_LIMIT),
  };
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export type GradeLimits = { daily: number; perIp: number };

export interface GradeLimiter {
  readonly configured: boolean;
  allow(day: string, ipHash: string, limits: GradeLimits): Promise<boolean>;
  blockProvider(day: string): Promise<void>;
}

export class RateLimiter implements GradeLimiter {
  readonly configured = true;
  private day = "";
  private counts = new Map<string, number>();
  private providerBlocked = false;

  async allow(day: string, ipHash: string, limits: GradeLimits): Promise<boolean> {
    this.roll(day);
    if (this.providerBlocked) return false;
    const globalKey = "g";
    const ipKey = `i:${ipHash}`;
    const globalCount = this.counts.get(globalKey) ?? 0;
    const ipCount = this.counts.get(ipKey) ?? 0;
    if (globalCount >= limits.daily || ipCount >= limits.perIp) return false;
    this.counts.set(globalKey, globalCount + 1);
    this.counts.set(ipKey, ipCount + 1);
    return true;
  }

  async blockProvider(day: string): Promise<void> {
    this.roll(day);
    this.providerBlocked = true;
  }

  private roll(day: string): void {
    if (this.day === day) return;
    this.counts.clear();
    this.providerBlocked = false;
    this.day = day;
  }
}

function fold(text: string): string {
  return text
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/（/g, "(")
    .replace(/）/g, ")");
}

export function extractPoints(answer: string): string {
  const folded = fold(answer);
  const start = folded.indexOf("出題趣旨");
  if (start < 0) return "";
  const after = folded.slice(start + "出題趣旨".length).replace(/^\s+/, "");
  const end = after.search(/\n\s*設問/);
  return (end < 0 ? after : after.slice(0, end)).trim().slice(0, MAX_CONTEXT);
}

export function excerptForPrompt(answer: string, label: string): string {
  const folded = fold(answer);
  const needle = fold(label).replace(/\s+/g, "");
  if (!needle) return folded.slice(0, MAX_CONTEXT);
  const pattern = [...needle].map((ch) => `${escapeRegExp(ch)}\\s*`).join("");
  const match = new RegExp(pattern).exec(folded);
  if (!match) return folded.slice(0, MAX_CONTEXT);
  const rest = folded.slice(match.index);
  const next = rest.slice(match[0].length).search(/設問\s*\d/);
  const end = next < 0 ? Math.min(rest.length, 500) : match[0].length + next;
  return rest.slice(0, end).trim().slice(0, MAX_CONTEXT);
}

function escapeRegExp(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseModelJson(text: string): { score: string; comment: string } | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const data: unknown = JSON.parse(trimmed);
    if (!data || typeof data !== "object") return null;
    const record = data as Record<string, unknown>;
    if (typeof record.score !== "string" || typeof record.comment !== "string") return null;
    const score = record.score.trim().slice(0, 40);
    const comment = record.comment.trim().slice(0, 400);
    if (!score || !comment) return null;
    return { score, comment };
  } catch {
    return null;
  }
}
