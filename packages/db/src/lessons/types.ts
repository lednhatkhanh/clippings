import type {
  ClippingKind,
  Lesson,
  LessonQuiz,
  LessonSkipKind,
  LessonStatus,
} from "@clippings/shared";

/**
 * How long a `writing` lesson's job may run before another delivery takes the lesson over: past the
 * job route's 300 s, so a live job is never taken over, and well short of the next lesson day.
 */
export const LESSON_WRITER_STALE_MS = 10 * 60 * 1000;

/** How far back "recent saves" reach, in days. */
export const LESSON_RECENT_DAYS = 14;
/** Most recent saves the material lists. */
export const LESSON_RECENT_LIMIT = 40;
/** How many past lessons the material lists, so topic picking can leave their tags alone. */
export const LESSON_PAST_LIMIT = 6;
/** Longest excerpt of a note's body the material carries, in characters. */
export const LESSON_NOTE_EXCERPT_LENGTH = 2_000;

export type ClaimLessonResult =
  /** The caller writes the lesson now. */
  | { status: "claimed"; lessonId: string }
  /** The day's lesson is ready, skipped for good, or being written by a live job: stand down. */
  | { status: "exists"; lessonId: string; lessonStatus: LessonStatus };

/** A live clipping or note, as the lesson writer sees it. */
export interface LessonMaterialItem {
  id: string;
  kind: ClippingKind;
  /** The title to show: the user's own, else the page's. */
  title: string;
  summary: string | null;
  /** A note's body, cut to `LESSON_NOTE_EXCERPT_LENGTH`; null on a link. */
  excerpt: string | null;
  tagIds: string[];
  /** ISO 8601. */
  savedAt: string;
}

/** A tag with at least one live item. */
export interface LessonMaterialTag {
  id: string;
  name: string;
  /** Live items carrying it. */
  itemCount: number;
  /** Of those, saved in the last `LESSON_RECENT_DAYS` days. */
  recentCount: number;
  /** ISO 8601: the newest live item carrying it. */
  newestItemAt: string;
  /** Its topic page, if the librarian wrote one. */
  topicPage: { body: string; updatedAt: string } | null;
}

/** A ready lesson, as the writer recaps it and topic picking avoids it. */
export interface PastLesson {
  id: string;
  /** `yyyy-MM-dd`. */
  day: string;
  topic: string;
  tagId: string | null;
  body: string;
  quiz: LessonQuiz;
}

/** What a lesson is written from. */
export interface LessonMaterial {
  /** The user's "About me" text; may be empty. */
  profile: string;
  /** Live items saved in the last `LESSON_RECENT_DAYS` days, newest first, at most `LESSON_RECENT_LIMIT`. */
  recent: LessonMaterialItem[];
  /** Every tag with a live item, most used first. */
  tags: LessonMaterialTag[];
  /** Ready lessons before `day`, newest first, at most `LESSON_PAST_LIMIT`. The first is the one to recap. */
  past: PastLesson[];
}

/** A written lesson, as the writer hands it over. */
export interface CompletedLesson {
  topic: string;
  tagId: string | null;
  body: string;
  quiz: LessonQuiz;
  recap: string;
  /** The clippings and notes it drew on; ids the user doesn't own, or deleted, are dropped. */
  sourceIds: string[];
}

/**
 * The lessons: one per user per UTC day, written by the twice-weekly job. Every operation takes
 * the user and scopes its queries by them.
 */
export interface LessonsService {
  /**
   * Claims the user's lesson for `day` (`yyyy-MM-dd`) for a writer: makes it `writing` when there
   * is none, when the one there is `writing` but its job started more than
   * `LESSON_WRITER_STALE_MS` ago, or when it was skipped as `failed`. Otherwise reports what is
   * there. Two claims at once claim it once.
   */
  claimLesson(userId: string, day: string): Promise<ClaimLessonResult>;
  /** What the lesson for `day` is written from. */
  readLessonMaterial(userId: string, day: string): Promise<LessonMaterial>;
  /** The live items carrying a tag, newest first. */
  readTopicItems(userId: string, tagId: string, limit: number): Promise<LessonMaterialItem[]>;
  /** Makes a `writing` lesson `ready`. False when it was not `writing` (or not the user's). */
  completeLesson(userId: string, lessonId: string, lesson: CompletedLesson): Promise<boolean>;
  /** Makes a `writing` lesson `skipped` with why. False when it was not `writing`. */
  skipLesson(
    userId: string,
    lessonId: string,
    skip: { kind: LessonSkipKind; reason: string },
  ): Promise<boolean>;
  /** The user's lessons, newest day first, sources resolved to their live items. */
  listLessons(userId: string, options?: { limit?: number }): Promise<Lesson[]>;
  /** One of the user's lessons, or null (also for an id that isn't a uuid). */
  getLesson(userId: string, lessonId: string): Promise<Lesson | null>;
}
