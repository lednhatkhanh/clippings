import { utc } from "@date-fns/utc";
import { isBefore, startOfDay, subDays, subMilliseconds } from "date-fns";
import { and, count, desc, eq, inArray, isNull, lt, max, or, sql, type SQL } from "drizzle-orm";
import type pg from "pg";

import {
  formatIsoUtc,
  RESEARCH_DEFAULTS,
  type Lesson,
  type LessonQuiz,
  type LessonSkipKind,
  type LessonSourceItem,
} from "@clippings/shared";

import type { Clock } from "../clippings/ports.ts";
import { createDatabase, type Database } from "../database.ts";
import { clippings, clippingTags, lessons, tags, topicPages, userSettings } from "../schema.ts";
import {
  LESSON_NOTE_EXCERPT_LENGTH,
  LESSON_PAST_LIMIT,
  LESSON_RECENT_DAYS,
  LESSON_RECENT_LIMIT,
  LESSON_WRITER_STALE_MS,
  type ClaimLessonResult,
  type CompletedLesson,
  type LessonMaterial,
  type LessonMaterialItem,
  type LessonsService,
  type PastLesson,
} from "./types.ts";

export interface LessonsServiceDeps {
  pool: pg.Pool;
  clock: Clock;
}

const DEFAULT_LIST_LIMIT = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Not deleted: a deleted clipping is neither taught from nor shown as a source. */
const live = isNull(clippings.deletedAt);

const title = sql<string>`coalesce(${clippings.userTitle}, ${clippings.title})`;

/** Creates the lessons service; see `LessonsService` for what each operation does. */
export function createLessonsService({ pool, clock }: LessonsServiceDeps): LessonsService {
  const db = createDatabase(pool);

  /** The start of the UTC day `LESSON_RECENT_DAYS` before now: "recent" has the same edge all day. */
  const recentSince = () => startOfDay(subDays(clock.now(), LESSON_RECENT_DAYS), { in: utc });

  /** The user's live items matching `where`, newest first, with the tags each carries. */
  async function loadItems(
    userId: string,
    limit: number,
    where: SQL | undefined,
    tagId?: string,
  ): Promise<LessonMaterialItem[]> {
    const base = db
      .select({
        id: clippings.id,
        kind: clippings.kind,
        title,
        summary: clippings.summary,
        excerpt: sql<
          string | null
        >`case when ${clippings.kind} = 'note' then left(${clippings.body}, ${LESSON_NOTE_EXCERPT_LENGTH}) end`,
        createdAt: clippings.createdAt,
      })
      .from(clippings);
    const rows = await (
      tagId === undefined
        ? base
        : base.innerJoin(
            clippingTags,
            and(
              eq(clippingTags.clippingId, clippings.id),
              eq(clippingTags.userId, clippings.userId),
              eq(clippingTags.tagId, tagId),
            ),
          )
    )
      .where(and(eq(clippings.userId, userId), live, where))
      .orderBy(desc(clippings.createdAt), desc(clippings.id))
      .limit(limit);
    if (rows.length === 0) return [];

    const links = await db
      .select({ clippingId: clippingTags.clippingId, tagId: clippingTags.tagId })
      .from(clippingTags)
      .where(
        and(
          eq(clippingTags.userId, userId),
          inArray(
            clippingTags.clippingId,
            rows.map((row) => row.id),
          ),
        ),
      );
    const tagIds = new Map<string, string[]>();
    for (const link of links) {
      tagIds.set(link.clippingId, [...(tagIds.get(link.clippingId) ?? []), link.tagId]);
    }
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      excerpt: row.excerpt,
      tagIds: tagIds.get(row.id) ?? [],
      savedAt: formatIsoUtc(row.createdAt),
    }));
  }

  async function claimLesson(userId: string, day: string): Promise<ClaimLessonResult> {
    const now = clock.now();
    const staleBefore = subMilliseconds(now, LESSON_WRITER_STALE_MS);
    // One statement, so two claims at once can't both win: the loser waits for the winner's row
    // lock, then finds a fresh `writing` row that the condition refuses.
    const [claimed] = await db
      .insert(lessons)
      .values({
        userId,
        day,
        status: "writing",
        writerStartedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [lessons.userId, lessons.day],
        set: {
          status: "writing",
          writerStartedAt: now,
          skipKind: null,
          skipReason: null,
          updatedAt: now,
        },
        setWhere: or(
          and(
            eq(lessons.status, "writing"),
            or(isNull(lessons.writerStartedAt), lt(lessons.writerStartedAt, staleBefore)),
          ),
          and(eq(lessons.status, "skipped"), eq(lessons.skipKind, "failed")),
        ),
      })
      .returning({ id: lessons.id });
    if (claimed) return { status: "claimed", lessonId: claimed.id };

    const [existing] = await db
      .select({ id: lessons.id, status: lessons.status })
      .from(lessons)
      .where(and(eq(lessons.userId, userId), eq(lessons.day, day)));
    if (!existing) throw new Error(`Lesson for ${day} vanished while it was being claimed`);
    return { status: "exists", lessonId: existing.id, lessonStatus: existing.status };
  }

  async function readLessonMaterial(userId: string, day: string): Promise<LessonMaterial> {
    const since = recentSince();

    const [settings] = await db
      .select({ profile: userSettings.researchProfile })
      .from(userSettings)
      .where(eq(userSettings.userId, userId));

    const recent = await loadItems(
      userId,
      LESSON_RECENT_LIMIT,
      sql`${clippings.createdAt} >= ${since}`,
    );

    const tagRows = await db
      .select({
        id: tags.id,
        name: tags.name,
        itemCount: count(),
        recentCount: sql<number>`(count(*) filter (where ${clippings.createdAt} >= ${since}))::int`,
        newestItemAt: max(clippings.createdAt),
        topicBody: topicPages.body,
        topicUpdatedAt: topicPages.updatedAt,
      })
      .from(tags)
      .innerJoin(
        clippingTags,
        and(eq(clippingTags.tagId, tags.id), eq(clippingTags.userId, tags.userId)),
      )
      .innerJoin(
        clippings,
        and(eq(clippings.id, clippingTags.clippingId), eq(clippings.userId, tags.userId), live),
      )
      .leftJoin(topicPages, and(eq(topicPages.tagId, tags.id), eq(topicPages.userId, tags.userId)))
      .where(eq(tags.userId, userId))
      .groupBy(tags.id, topicPages.tagId)
      .orderBy(desc(count()), sql`lower(${tags.name})`, tags.id);

    const pastRows = await db
      .select()
      .from(lessons)
      .where(and(eq(lessons.userId, userId), eq(lessons.status, "ready"), lt(lessons.day, day)))
      .orderBy(desc(lessons.day))
      .limit(LESSON_PAST_LIMIT);

    return {
      profile: settings?.profile ?? RESEARCH_DEFAULTS.profile,
      recent,
      tags: tagRows.map((row) => ({
        id: row.id,
        name: row.name,
        itemCount: row.itemCount,
        recentCount: row.recentCount,
        // The join guarantees at least one live item.
        newestItemAt: formatIsoUtc(row.newestItemAt!),
        topicPage:
          row.topicBody !== null && row.topicUpdatedAt !== null
            ? { body: row.topicBody, updatedAt: formatIsoUtc(row.topicUpdatedAt) }
            : null,
      })),
      past: pastRows.map((row): PastLesson => ({
        id: row.id,
        day: row.day,
        topic: row.topic,
        tagId: row.tagId,
        body: row.body ?? "",
        quiz: row.quiz as LessonQuiz,
      })),
    };
  }

  async function readTopicItems(
    userId: string,
    tagId: string,
    limit: number,
  ): Promise<LessonMaterialItem[]> {
    if (!UUID.test(tagId)) return [];
    return loadItems(userId, limit, undefined, tagId);
  }

  async function completeLesson(
    userId: string,
    lessonId: string,
    lesson: CompletedLesson,
  ): Promise<boolean> {
    if (!UUID.test(lessonId)) return false;
    const wanted = [...new Set(lesson.sourceIds.filter((id) => UUID.test(id)))];
    const owned =
      wanted.length === 0
        ? []
        : await db
            .select({ id: clippings.id })
            .from(clippings)
            .where(and(eq(clippings.userId, userId), live, inArray(clippings.id, wanted)));
    const ownedIds = new Set(owned.map((row) => row.id));

    const now = clock.now();
    const done = await db
      .update(lessons)
      .set({
        status: "ready",
        topic: lesson.topic,
        tagId: lesson.tagId,
        body: lesson.body,
        quiz: lesson.quiz,
        recap: lesson.recap,
        sourceIds: wanted.filter((id) => ownedIds.has(id)),
        skipKind: null,
        skipReason: null,
        writerStartedAt: null,
        updatedAt: now,
      })
      .where(
        and(eq(lessons.id, lessonId), eq(lessons.userId, userId), eq(lessons.status, "writing")),
      )
      .returning({ id: lessons.id });
    return done.length > 0;
  }

  async function skipLesson(
    userId: string,
    lessonId: string,
    skip: { kind: LessonSkipKind; reason: string },
  ): Promise<boolean> {
    if (!UUID.test(lessonId)) return false;
    const done = await db
      .update(lessons)
      .set({
        status: "skipped",
        skipKind: skip.kind,
        skipReason: skip.reason,
        writerStartedAt: null,
        updatedAt: clock.now(),
      })
      .where(
        and(eq(lessons.id, lessonId), eq(lessons.userId, userId), eq(lessons.status, "writing")),
      )
      .returning({ id: lessons.id });
    return done.length > 0;
  }

  /** The DTOs for these rows, each with its sources resolved to the user's live items. */
  async function toLessons(
    reader: Pick<Database, "select">,
    userId: string,
    rows: (typeof lessons.$inferSelect)[],
  ): Promise<Lesson[]> {
    const sourceIds = [...new Set(rows.flatMap((row) => row.sourceIds))];
    const items =
      sourceIds.length === 0
        ? []
        : await reader
            .select({ id: clippings.id, kind: clippings.kind, title })
            .from(clippings)
            .where(and(eq(clippings.userId, userId), live, inArray(clippings.id, sourceIds)));
    const byId = new Map(items.map((item): [string, LessonSourceItem] => [item.id, item]));
    const staleBefore = subMilliseconds(clock.now(), LESSON_WRITER_STALE_MS);
    return rows.map((row) => {
      // Its job died without settling it, and the retry (if any) is past: say so rather than
      // promise it for ever. A later delivery can still claim and write it.
      const abandoned =
        row.status === "writing" &&
        (row.writerStartedAt === null || isBefore(row.writerStartedAt, staleBefore));
      return {
        id: row.id,
        day: row.day,
        status: abandoned ? "skipped" : row.status,
        topic: row.topic,
        body: row.body,
        quiz: row.quiz as LessonQuiz | null,
        recap: row.recap,
        sources: row.sourceIds.flatMap((id) => byId.get(id) ?? []),
        skipKind: abandoned ? "failed" : row.skipKind,
        skipReason: abandoned ? "The job stopped before the lesson was written." : row.skipReason,
        createdAt: formatIsoUtc(row.createdAt),
        updatedAt: formatIsoUtc(row.updatedAt),
      };
    });
  }

  async function listLessons(
    userId: string,
    { limit = DEFAULT_LIST_LIMIT }: { limit?: number } = {},
  ): Promise<Lesson[]> {
    const rows = await db
      .select()
      .from(lessons)
      .where(eq(lessons.userId, userId))
      .orderBy(desc(lessons.day))
      .limit(limit);
    return toLessons(db, userId, rows);
  }

  async function getLesson(userId: string, lessonId: string): Promise<Lesson | null> {
    if (!UUID.test(lessonId)) return null;
    const [row] = await db
      .select()
      .from(lessons)
      .where(and(eq(lessons.id, lessonId), eq(lessons.userId, userId)));
    if (!row) return null;
    const [lesson] = await toLessons(db, userId, [row]);
    return lesson ?? null;
  }

  return {
    claimLesson,
    readLessonMaterial,
    readTopicItems,
    completeLesson,
    skipLesson,
    listLessons,
    getLesson,
  };
}
