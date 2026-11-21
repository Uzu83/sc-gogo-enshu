import { Temporal as PolyTemporal } from "temporal-polyfill";

const nativeTemporal = (globalThis as { Temporal?: typeof PolyTemporal }).Temporal;
const TemporalApi = nativeTemporal ?? PolyTemporal;

/** 運営費の月は日本時間の暦月。時刻は持たない。 */
export const COST_TIME_ZONE = "Asia/Tokyo";

export const SUPPORT_ASKING = "非営利・運営費のみKo-fiで支援を募っています";
export const SUPPORT_THANKS = "今月の運営費は集まりました。ありがとうございます";

export type CostLine = {
  item: string;
  amount: number;
  basis: string;
};

export type MonthCosts = {
  month: string;
  costs: CostLine[];
  received: number;
};

export type CostsFile = {
  months: MonthCosts[];
};

export type Supporter = {
  nickname: string;
};

export function monthKey(epochMs: number): string {
  const zoned = TemporalApi.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(COST_TIME_ZONE);
  return TemporalApi.PlainYearMonth.from({
    year: zoned.year,
    month: zoned.month,
    calendar: "iso8601",
  }).toString();
}

/** 開いたまま月をまたいだとき、支援表示を戻し、運営費ページなら内訳も描き直す。 */
export function fundingRefresh(
  previousMonth: string,
  epochMs: number,
  onCostsPage: boolean,
): { month: string; changed: boolean; rerenderCosts: boolean } {
  const month = monthKey(epochMs);
  const changed = !TemporalApi.PlainYearMonth.from(month).equals(
    TemporalApi.PlainYearMonth.from(previousMonth),
  );
  return { month, changed, rerenderCosts: changed && onCostsPage };
}

export function formatMonth(key: string): string {
  const month = TemporalApi.PlainYearMonth.from(key);
  return `${month.year}年${month.month}月`;
}

export function findMonth(file: CostsFile, key: string): MonthCosts | undefined {
  return file.months.find((month) => month.month === key);
}

export function totalCost(month: MonthCosts): number {
  return month.costs.reduce((sum, line) => sum + line.amount, 0);
}

/** 記録がない月は未達。翌月の記録が無ければ受付を戻す。 */
export function isFunded(month: MonthCosts | undefined): boolean {
  if (!month) return false;
  return month.received >= totalCost(month);
}

/** 支援額から運営費を引いた額。プラスは翌月へ回す余り。 */
export function balance(month: MonthCosts): number {
  return month.received - totalCost(month);
}

export function supportLine(funded: boolean): string {
  return funded ? SUPPORT_THANKS : SUPPORT_ASKING;
}

export function yen(amount: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function supporterNames(supporters: Supporter[]): string[] {
  return supporters.map((supporter) => supporter.nickname).filter((name) => name.trim() !== "");
}

export function costsRequested(pathname: string, hash: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/costs") return true;
  return hash.replace(/^#\/?/, "") === "costs";
}
