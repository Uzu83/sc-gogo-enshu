import { inject } from "@vercel/analytics";
import { remainingChars } from "./chars";
import { citation } from "./citation";
import examFile from "./exams.json";
import { NO_KEY_REASON, SEND_NOTICE, excerptForPrompt, extractPoints, presentGrade, type GradeView } from "./grade";
import { keepPageOnContentSkip, onSkipClick } from "./skip";
import { loadAnswer, saveAnswer } from "./storage";
import {
  createTimer,
  formatRemaining,
  isFinished,
  isLowTime,
  pauseTimer,
  remainingMs,
  resumeTimer,
  type TimerState,
} from "./timer";
import type { Exam, ExamFile, Prompt, Question } from "./types";

inject();

const data = examFile as ExamFile;
const main = document.querySelector("main");
const timeUp = document.querySelector<HTMLDialogElement>("#time-up");
if (!main || !timeUp) throw new Error("missing root");

const modes = [
  { id: "full", label: "午後 150分", minutes: 150 },
  { id: "pm1", label: "午後I 90分", minutes: 90 },
  { id: "pm2", label: "午後II 120分", minutes: 120 },
  { id: "one", label: "1問 75分", minutes: 75 },
] as const;

let timer: TimerState = createTimer(150 * 60 * 1000, Date.now());
let sawDone = false;
let tick = 0;

function findExam(id: string): Exam | undefined {
  return data.exams.find((exam) => exam.id === id);
}

function route(): { exam?: Exam; question?: Question } {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts.length === 0) return {};
  const exam = findExam(parts[0] ?? "");
  const number = Number(parts[1]);
  const question = exam?.questions.find((item) => item.number === number);
  return { exam, question };
}

function render(): void {
  if (keepPageOnContentSkip(location.hash, main!.childElementCount > 0)) return;
  const { exam, question } = route();
  if (!exam) {
    renderHome();
    return;
  }
  if (!question) {
    renderExam(exam);
    return;
  }
  renderQuestion(exam, question);
}

function renderHome(): void {
  main!.replaceChildren();
  const heading = document.createElement("h1");
  heading.textContent = "SC午後 過去問演習教室";
  const purpose = document.createElement("p");
  purpose.textContent =
    "情報セキュリティに詳しい日本の人材が増えることを目的に、非営利で運営しています。将来は信頼できる運営者に譲る予定です。";
  const list = document.createElement("ul");
  list.className = "exam-list";
  for (const exam of data.exams) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#/${exam.id}`;
    link.textContent = `${exam.year} ${exam.season} ${exam.section}`;
    item.append(link);
    list.append(item);
  }
  main!.append(heading, purpose, list);
}

function renderExam(exam: Exam): void {
  main!.replaceChildren();
  const heading = document.createElement("h1");
  heading.textContent = `${exam.year} ${exam.season} ${exam.section}`;
  const note = document.createElement("p");
  note.textContent = "4問中2問を選んで解きます。1問だけのときは75分です。";
  const list = document.createElement("ul");
  list.className = "question-list";
  for (const question of exam.questions) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#/${exam.id}/${question.number}`;
    link.textContent = `問${question.number}`;
    item.append(link);
    list.append(item);
  }
  main!.append(heading, note, list);
}

function renderQuestion(exam: Exam, question: Question): void {
  main!.replaceChildren();
  const source = citation(exam.year, exam.season, question.number);
  const heading = document.createElement("h1");
  heading.id = "question-title";
  heading.textContent = `${exam.year} ${exam.season} 問${question.number}`;

  const cite = document.createElement("p");
  cite.textContent = source;
  const alteration = document.createElement("p");
  alteration.className = "note";
  alteration.textContent =
    "改変：問題冊子はIPAが公開したPDFのページ画像です。解答例と採点講評は公開PDFからテキスト化し、改行は原典と異なります。";

  main!.append(heading, cite, alteration, renderTimer(), renderPaper(exam, question, source), renderForm(exam, question));
  paintTimer();
}

function renderTimer(): HTMLElement {
  const box = document.createElement("section");
  box.className = "timer";
  box.setAttribute("aria-labelledby", "timer-legend");

  const legend = document.createElement("p");
  legend.id = "timer-legend";
  legend.textContent = "タイマー";

  const fieldset = document.createElement("fieldset");
  const fieldLegend = document.createElement("legend");
  fieldLegend.textContent = "制限時間";
  fieldset.append(fieldLegend);
  for (const mode of modes) {
    const id = `mode-${mode.id}`;
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "duration";
    input.id = id;
    input.value = String(mode.minutes);
    input.checked = timer.durationMs === mode.minutes * 60 * 1000;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = mode.label;
    fieldset.append(input, label);
  }

  const barLabel = document.createElement("label");
  barLabel.htmlFor = "remain-bar";
  barLabel.textContent = "残り時間";
  const bar = document.createElement("progress");
  bar.id = "remain-bar";
  bar.max = timer.durationMs / 1000;
  const clock = document.createElement("p");
  clock.id = "clock";
  clock.className = "clock";
  const status = document.createElement("p");
  status.id = "timer-status";
  status.setAttribute("role", "status");

  const row = document.createElement("div");
  row.className = "timer-row";
  const start = button("開始", () => {
    const selected = fieldset.querySelector<HTMLInputElement>("input:checked");
    const minutes = Number(selected?.value ?? 150);
    timer = createTimer(minutes * 60 * 1000, Date.now(), true);
    sawDone = false;
    paintTimer();
  });
  const pause = button("一時停止", () => {
    timer = pauseTimer(timer, Date.now());
    paintTimer();
  });
  const resume = button("再開", () => {
    timer = resumeTimer(timer, Date.now());
    paintTimer();
  });
  row.append(start, pause, resume);
  box.append(legend, fieldset, barLabel, bar, clock, status, row);
  return box;
}

function renderPaper(exam: Exam, question: Question, source: string): HTMLElement {
  const wrap = document.createElement("div");
  for (const page of question.pages) {
    const figure = document.createElement("figure");
    figure.className = "paper";
    const image = document.createElement("img");
    image.src = `/papers/${exam.id}/${page}`;
    image.alt = `${source} の問題冊子 ${page.replace("p", "").replace(".jpg", "")}ページ`;
    image.width = 800;
    image.height = 1132;
    const caption = document.createElement("figcaption");
    caption.textContent = `問題冊子 ${Number(page.slice(1, 3))}ページ`;
    figure.append(image, caption);
    wrap.append(figure);
  }
  return wrap;
}

function renderForm(exam: Exam, question: Question): HTMLFormElement {
  const form = document.createElement("form");
  form.setAttribute("aria-labelledby", "question-title");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
  });

  for (const prompt of question.prompts) {
    const field = document.createElement("div");
    field.className = "field";
    const id = `${exam.id}-${question.number}-${prompt.id}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = prompt.maxChars === null ? prompt.label : `${prompt.label}（${prompt.maxChars}字以内）`;
    const area = document.createElement("textarea");
    area.id = id;
    area.value = loadAnswer(exam.id, question.number, prompt.id);
    const remain = document.createElement("p");
    remain.className = "remain";
    remain.id = `${id}-remain`;
    if (prompt.maxChars !== null) {
      area.setAttribute("aria-describedby", remain.id);
      const limit = prompt.maxChars;
      const paint = () => {
        const left = remainingChars(area.value, limit);
        remain.textContent = left >= 0 ? `残り${left}字` : `${-left}字オーバー`;
        remain.classList.toggle("over", left < 0);
      };
      area.addEventListener("input", () => {
        saveAnswer(exam.id, question.number, prompt.id, area.value);
        paint();
        if (limit !== null && remainingChars(area.value, limit) >= 0) {
          area.removeAttribute("aria-invalid");
        }
      });
      area.addEventListener("blur", () => {
        if (remainingChars(area.value, limit) < 0) area.setAttribute("aria-invalid", "true");
      });
      paint();
    } else {
      area.addEventListener("input", () => {
        saveAnswer(exam.id, question.number, prompt.id, area.value);
      });
    }
    field.append(label, area);
    if (prompt.maxChars !== null) field.append(remain);
    field.append(renderGrade(question, prompt, area));
    form.append(field);
  }

  const reveal = button("解答例と採点講評を見る", () => {
    official.hidden = !official.hidden;
    reveal.setAttribute("aria-expanded", String(!official.hidden));
  });
  reveal.setAttribute("aria-expanded", "false");
  reveal.setAttribute("aria-controls", "official");

  const official = document.createElement("div");
  official.id = "official";
  official.hidden = true;
  const answerHeading = document.createElement("h2");
  answerHeading.textContent = "解答例";
  const answer = document.createElement("pre");
  answer.className = "official";
  answer.textContent = question.answer;
  const commentHeading = document.createElement("h2");
  commentHeading.textContent = "採点講評";
  const comment = document.createElement("pre");
  comment.className = "official";
  comment.textContent = question.commentary;
  const self = document.createElement("p");
  self.className = "note";
  self.textContent = "解答例と見比べて、自分で採点してください。書いた解答はこのブラウザの中だけに残ります。";
  official.append(answerHeading, answer, commentHeading, comment, self);
  form.append(reveal, official);
  return form;
}

let gradeAvailability: Promise<{ enabled: boolean; reason?: string }> | null = null;

function loadGradeAvailability(): Promise<{ enabled: boolean; reason?: string }> {
  if (!gradeAvailability) {
    gradeAvailability = fetch("/api/grade")
      .then((response) => response.json() as Promise<{ enabled?: boolean; reason?: string }>)
      .then((payload) => ({
        enabled: payload.enabled === true,
        reason: payload.enabled === true ? undefined : payload.reason || NO_KEY_REASON,
      }))
      .catch(() => ({ enabled: false, reason: "AI採点の状態を確認できません。" }));
  }
  return gradeAvailability;
}

function renderGrade(question: Question, prompt: Prompt, area: HTMLTextAreaElement): HTMLElement {
  const box = document.createElement("div");
  box.className = "grade";
  const notice = document.createElement("p");
  notice.className = "note";
  notice.id = `${area.id}-grade-notice`;
  notice.textContent = SEND_NOTICE;
  const reason = document.createElement("p");
  reason.className = "note";
  reason.id = `${area.id}-grade-reason`;
  const result = document.createElement("div");
  result.className = "grade-result";
  result.id = `${area.id}-grade-result`;
  result.setAttribute("role", "status");
  let enabled = false;
  const gradeButton = button("AIで採点（目安）", () => {
    void run();
  });
  gradeButton.disabled = true;
  gradeButton.setAttribute("aria-describedby", `${notice.id} ${reason.id}`);
  box.append(notice, gradeButton, reason, result);

  void loadGradeAvailability().then((state) => {
    enabled = state.enabled;
    gradeButton.disabled = !enabled;
    reason.textContent = enabled ? "" : state.reason ?? NO_KEY_REASON;
  });

  async function run(): Promise<void> {
    if (!enabled) return;
    const userAnswer = area.value.trim();
    result.replaceChildren();
    if (!userAnswer) {
      result.textContent = "解答を書いてから採点してください。";
      return;
    }
    gradeButton.disabled = true;
    result.textContent = "採点しています…";
    try {
      const response = await fetch("/api/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.label,
          maxChars: prompt.maxChars,
          points: extractPoints(question.answer),
          officialAnswer: excerptForPrompt(question.answer, prompt.label),
          commentary: question.commentary.slice(0, 1500),
          userAnswer,
        }),
      });
      const payload: unknown = await response.json();
      paintGrade(result, presentGrade(payload));
    } catch {
      result.textContent = "採点できませんでした。しばらくしてからもう一度押してください。";
    } finally {
      gradeButton.disabled = !enabled;
    }
  }

  return box;
}

function paintGrade(result: HTMLElement, view: GradeView): void {
  result.replaceChildren();
  if (view.message) {
    const message = document.createElement("p");
    message.textContent = view.message;
    result.append(message);
    return;
  }
  const disclaimer = document.createElement("p");
  disclaimer.className = "note grade-disclaimer";
  disclaimer.textContent = view.disclaimer ?? "";
  const score = document.createElement("p");
  score.textContent = `目安: ${view.score ?? ""}`;
  const comment = document.createElement("p");
  comment.textContent = view.comment ?? "";
  result.append(disclaimer, score, comment);
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.addEventListener("click", onClick);
  return element;
}

function paintTimer(): void {
  const now = Date.now();
  const left = remainingMs(timer, now);
  const bar = document.querySelector<HTMLProgressElement>("#remain-bar");
  const clock = document.querySelector("#clock");
  const status = document.querySelector("#timer-status");
  if (bar) {
    bar.max = timer.durationMs / 1000;
    bar.value = left / 1000;
  }
  if (clock) {
    clock.textContent = formatRemaining(left);
    clock.classList.toggle("low", isLowTime(timer, now));
  }
  if (isFinished(timer, now) && timer.running) {
    timer = pauseTimer(timer, now);
    if (!sawDone) {
      sawDone = true;
      if (!timeUp!.open) timeUp!.showModal();
    }
  }
  if (!status) return;
  const notice = isFinished(timer, now)
    ? "時間です。"
    : isLowTime(timer, now)
      ? "残り時間が少なくなっています。"
      : "";
  if (status.textContent !== notice) status.textContent = notice;
}

document.querySelector("a.skip")?.addEventListener("click", (event) => {
  onSkipClick(event, main!);
});

window.addEventListener("hashchange", render);
render();
tick = window.setInterval(paintTimer, 1000);
void tick;
