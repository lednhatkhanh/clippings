/**
 * A lesson's state. A job claims the day's lesson as `writing`, then it becomes `ready`, or
 * `skipped` with a reason the Lessons page shows, so a lesson that didn't arrive is never just
 * missing.
 */
export const LESSON_STATUSES = ["writing", "ready", "skipped"] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

/**
 * Why a lesson was skipped. `cap_reached`: the day's spending cap (or Anthropic's spend limit)
 * stopped it. `nothing_to_teach`: the library had nothing to draw on. `failed`: the job broke; a
 * redelivery of the job may take it up again.
 */
export const LESSON_SKIP_KINDS = ["cap_reached", "nothing_to_teach", "failed"] as const;
export type LessonSkipKind = (typeof LESSON_SKIP_KINDS)[number];

/** Who wrote a lesson. Only the model does. */
export const LESSON_SOURCES = ["ai"] as const;
export type LessonAuthor = (typeof LESSON_SOURCES)[number];

/** Longest lesson body, in characters of Markdown: about 10 minutes of reading, with room. */
export const MAX_LESSON_LENGTH = 30_000;
/** Longest recap of the previous lesson, in characters of Markdown. */
export const MAX_LESSON_RECAP_LENGTH = 3_000;
/** Longest topic (the lesson's title), in characters. */
export const MAX_LESSON_TOPIC_LENGTH = 120;
/** A quiz offers this many choices, at least and at most. */
export const LESSON_QUIZ_CHOICES = { min: 3, max: 5 } as const;

/** The lesson's one quiz question: multiple choice, with the right answer explained. */
export interface LessonQuiz {
  question: string;
  choices: string[];
  /** Index into `choices`. */
  answerIndex: number;
  /** Why that answer is right, shown once the reader has answered. */
  explanation: string;
}

/** A clipping or note a lesson drew on, as it is now (deleted ones are left out). */
export interface LessonSourceItem {
  id: string;
  kind: "link" | "note";
  title: string;
}

/** A lesson as the app shows it. JSON-safe. */
export interface Lesson {
  id: string;
  /** The UTC day it was written for, `yyyy-MM-dd`. One lesson per user per day. */
  day: string;
  status: LessonStatus;
  /** The lesson's title; empty until ready. */
  topic: string;
  /** Markdown; null until ready. */
  body: string | null;
  /** Null until ready. */
  quiz: LessonQuiz | null;
  /** Markdown recap of the previous lesson; empty when there was none. */
  recap: string;
  /** What it drew on, in the order the model gave. */
  sources: LessonSourceItem[];
  /** Null unless skipped. */
  skipKind: LessonSkipKind | null;
  /** Why it was skipped, for the user. */
  skipReason: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}
