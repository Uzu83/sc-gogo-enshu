import costsFile from "../data/costs.json";
import supportersFile from "../data/supporters.json";
import {
  balance,
  costsRequested,
  findMonth,
  formatMonth,
  isFunded,
  monthKey,
  supporterNames,
  supportLine,
  totalCost,
  yen,
  type CostsFile,
  type Supporter,
} from "./costs";

const costs = costsFile as CostsFile;
const supporters = (supportersFile as { supporters: Supporter[] }).supporters;
const KOFI_URL = "https://ko-fi.com/uz_u83";

export function showingCosts(pathname: string, hash: string): boolean {
  return costsRequested(pathname, hash);
}

export function renderCostsPage(parent: HTMLElement, epochMs: number): void {
  parent.replaceChildren();
  const key = monthKey(epochMs);
  const month = findMonth(costs, key);
  const funded = isFunded(month);

  const heading = document.createElement("h1");
  heading.textContent = "運営費";

  const policy = document.createElement("p");
  policy.textContent =
    "非営利で運営し、運営費以上は受け取りません。集めた額が運営費を超えた分は、翌月の運営費に回します。";

  const how = document.createElement("p");
  how.textContent =
    "金額は data/costs.json、掲載するニックネームは data/supporters.json をプルリクエストで更新します。変更の履歴は GitHub に残ります。";

  const privacy = document.createElement("p");
  privacy.textContent =
    "支援してくださった方は、本人が掲載を希望したニックネームだけを出します。金額、メール、本名、Ko-fiのアカウント名は出しません。希望がなければ載せません。掲載を外してほしいときは、Ko-fiのメッセージで知らせてください。";

  parent.append(heading, policy, how, privacy, costTable(key, month), summary(month), supportSlot(funded), supporterList());
}

export function paintSupport(epochMs: number): void {
  const funded = isFunded(findMonth(costs, monthKey(epochMs)));
  const line = document.querySelector("#support-line");
  if (line) line.textContent = supportLine(funded);
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a.kofi")) {
    const holder = link.closest("p");
    if (holder) holder.hidden = funded;
  }
  const costsLink = document.querySelector<HTMLAnchorElement>('a[href="/costs"]');
  if (costsLink) {
    const here = showingCosts(location.pathname, location.hash);
    if (here) costsLink.setAttribute("aria-current", "page");
    else costsLink.removeAttribute("aria-current");
  }
}

function costTable(key: string, month: ReturnType<typeof findMonth>): HTMLElement {
  const region = document.createElement("div");
  region.className = "table-wrapper";
  region.tabIndex = 0;
  region.setAttribute("role", "region");
  region.setAttribute("aria-labelledby", "cost-caption");

  const table = document.createElement("table");
  table.className = "cost-table";
  const caption = document.createElement("caption");
  caption.id = "cost-caption";
  caption.textContent = `${formatMonth(key)}の運営費`;
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["項目", "金額", "根拠"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  if (!month || month.costs.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = "今月の数字はまだ記録されていません。";
    row.append(cell);
    body.append(row);
  } else {
    for (const line of month.costs) {
      const row = document.createElement("tr");
      const item = document.createElement("th");
      item.scope = "row";
      item.textContent = line.item;
      const amount = document.createElement("td");
      amount.textContent = yen(line.amount);
      const basis = document.createElement("td");
      basis.textContent = line.basis;
      row.append(item, amount, basis);
      body.append(row);
    }
  }
  table.append(caption, head, body);
  region.append(table);
  return region;
}

function summary(month: ReturnType<typeof findMonth>): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = "cost-summary";
  const total = month ? totalCost(month) : 0;
  const received = month?.received ?? 0;
  const diff = month ? balance(month) : 0;
  addPair(list, "運営費の合計", yen(total));
  addPair(list, "支援額の合計", yen(received));
  addPair(list, "差し引き", yen(diff));
  return list;
}

function addPair(list: HTMLDListElement, term: string, value: string): void {
  const group = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = value;
  group.append(dt, dd);
  list.append(group);
}

function supportSlot(funded: boolean): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  if (funded) {
    paragraph.textContent = supportLine(true);
    return paragraph;
  }
  const link = document.createElement("a");
  link.className = "kofi";
  link.href = KOFI_URL;
  link.textContent = "Ko-fiで支援する";
  paragraph.append(link);
  return paragraph;
}

function supporterList(): HTMLElement {
  const section = document.createElement("section");
  section.setAttribute("aria-labelledby", "supporters-heading");
  const heading = document.createElement("h2");
  heading.id = "supporters-heading";
  heading.textContent = "支援してくださった方";
  section.append(heading);
  const names = supporterNames(supporters);
  if (names.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "現在、掲載を希望された方はいません。";
    section.append(empty);
    return section;
  }
  const list = document.createElement("ul");
  for (const name of names) {
    const item = document.createElement("li");
    item.textContent = name;
    list.append(item);
  }
  section.append(list);
  return section;
}
