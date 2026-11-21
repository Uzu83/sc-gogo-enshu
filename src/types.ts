export type Prompt = {
  id: string;
  label: string;
  /** 字数制限。制限がない設問は null。 */
  maxChars: number | null;
};

export type Question = {
  number: number;
  pages: string[];
  prompts: Prompt[];
  answer: string;
  commentary: string;
};

export type Exam = {
  id: string;
  year: string;
  season: string;
  section: string;
  /** 本番の制限時間（分）。 */
  durationMin: number;
  /** 1問だけのときの目安（分）。 */
  perQuestionMin: number;
  questions: Question[];
};

export type ExamFile = {
  exams: Exam[];
};
