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

type ParsedLabel = {
  question: number;
  sub: number | null;
  marker: string;
};

/** 設問ラベルを、設問番号・枝番・空欄や語句に分ける。 */
function parseLabel(label: string): ParsedLabel | null {
  const match = /^設問\s*(\d+)\s*(?:\(\s*(\d+)\s*\))?\s*(?:\(\s*([^\s)]+)\s*\))?\s*([\s\S]*)$/.exec(
    fold(label).trim(),
  );
  if (!match) return null;
  const sub = match[2] === undefined ? null : Number(match[2]);
  const marker = [match[3]?.trim() ?? "", match[4]?.trim() ?? ""].filter(Boolean).join(" ");
  return { question: Number(match[1]), sub, marker };
}

function sliceSection(text: string, question: number): string | null {
  const start = new RegExp(`設問\\s*${question}(?!\\d)`).exec(text);
  if (!start) return null;
  const rest = text.slice(start.index);
  const next = /設問\s*(\d+)/g;
  next.lastIndex = start[0].length;
  let end = rest.length;
  let match = next.exec(rest);
  while (match) {
    if (Number(match[1]) !== question) {
      end = match.index;
      break;
    }
    match = next.exec(rest);
  }
  return rest.slice(0, end);
}

function sliceSub(text: string, sub: number): string | null {
  const marks = subMarks(text);
  const current = marks.find((mark) => mark.n === sub);
  if (!current) return null;
  const following = marks.find((mark) => mark.index > current.index);
  return text.slice(current.index, following?.index ?? text.length);
}

function subMarks(text: string): { n: number; index: number }[] {
  const marks: { n: number; index: number }[] = [];
  const pattern = /(?:^|[\n\s])\(\s*(\d+)\s*\)/g;
  let match = pattern.exec(text);
  while (match) {
    const lead = /^\s*/.exec(match[0])?.[0].length ?? 0;
    marks.push({ n: Number(match[1]), index: match.index + lead });
    match = pattern.exec(text);
  }
  return marks;
}

function sliceAtMarker(text: string, marker: string, siblings: readonly string[]): string | null {
  const index = findMarker(text, marker);
  if (index < 0) return null;
  const lines = text.slice(index).split("\n");
  const kept = [lines[0] ?? ""];
  for (const line of lines.slice(1)) {
    if (isNextSlot(line, siblings)) break;
    kept.push(line);
  }
  return kept.join("\n");
}

function findMarker(text: string, marker: string): number {
  const wrapped = text.indexOf(`(${marker})`);
  if (wrapped >= 0) return wrapped;
  if ([...marker].length === 1) {
    const match = new RegExp(`(?:^|[\\s(])(${escapeRegExp(marker)})(?=[\\s)]|$)`).exec(text);
    if (!match) return -1;
    return match.index + match[0].length - marker.length;
  }
  return text.indexOf(marker);
}

/** 同じ設問の次の空欄・枝番。ここから先は別の解答なので渡さない。 */
function isNextSlot(line: string, siblings: readonly string[]): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("備考")) return trimmed.startsWith("備考");
  if (siblings.some((marker) => trimmed.startsWith(marker))) return true;
  if (/^\(\s*\d+\s*\)/.test(trimmed)) return true;
  if (/^\(\s*[ぁ-んァ-ヶ]\s*\)/.test(trimmed)) return true;
  if (/^[a-zA-Z]\s/.test(trimmed)) return true;
  if (/^[ぁ-ん]\s/.test(trimmed)) return true;
  return /^(する場合|しない場合|変更内容|サーバ名|項番\s*\d+)/.test(trimmed);
}

export function excerptForPrompt(
  answer: string,
  label: string,
  siblingLabels: readonly string[] = [],
): string {
  const folded = fold(answer);
  const parsed = parseLabel(label);
  if (!parsed) return folded.slice(0, MAX_CONTEXT);
  const section = sliceSection(folded, parsed.question) ?? folded;
  const scoped = parsed.sub === null ? section : (sliceSub(section, parsed.sub) ?? section);
  const siblings = siblingLabels
    .map((item) => parseLabel(item))
    .filter(
      (item): item is ParsedLabel =>
        item !== null &&
        item.question === parsed.question &&
        item.sub === parsed.sub &&
        item.marker !== "" &&
        item.marker !== parsed.marker,
    )
    .map((item) => item.marker);
  const focused = parsed.marker ? (sliceAtMarker(scoped, parsed.marker, siblings) ?? scoped) : scoped;
  return focused.trim().slice(0, MAX_CONTEXT);
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
