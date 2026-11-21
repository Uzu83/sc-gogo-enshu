const ANSWER_KEY = "sc-gogo-enshu:answers";

export type AnswerMap = Record<string, string>;

export function answerKey(examId: string, questionNumber: number, promptId: string): string {
  return `${examId}:${questionNumber}:${promptId}`;
}

function readMap(): AnswerMap {
  const raw = localStorage.getItem(ANSWER_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: AnswerMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

/** 解答は localStorage だけに書く。fetch や送信はしない。 */
export function loadAnswer(examId: string, questionNumber: number, promptId: string): string {
  return readMap()[answerKey(examId, questionNumber, promptId)] ?? "";
}

export function saveAnswer(
  examId: string,
  questionNumber: number,
  promptId: string,
  value: string,
): void {
  const map = readMap();
  map[answerKey(examId, questionNumber, promptId)] = value;
  localStorage.setItem(ANSWER_KEY, JSON.stringify(map));
}
