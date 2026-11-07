import { utc } from "@date-fns/utc";
import { startOfDay } from "date-fns";
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import type pg from "pg";

import {
  AUTOMATION_DEFAULTS,
  formatIsoUtc,
  MAX_BRIEF_LENGTH,
  RESEARCH_DEFAULTS,
  type Brief,
  type BriefSource,
  type ClippingKind,
} from "@clippings/shared";

import type { Clock } from "../clippings/ports.ts";
import { createDatabase, type Database } from "../database.ts";
import { clippings, clippingTexts, researchBriefs, userSettings } from "../schema.ts";

export interface ResearchServiceDeps {
  pool: pg.Pool;
  clock: Clock;
}

/** What the database client and a transaction on it share: `queueBrief` runs on either. */
export type BriefWriter = Pick<Database, "insert">;

export interface QueueBriefInput {
  userId: string;
  clippingId: string;
  /** The research domain the triage verdict named. */
  domain: string;
  /** The verdict's one-line reason. */
  reason: string;
}

export type RequestBriefNowResult =
  | { status: "started"; brief: Brief }
  /** The user has used today's research jobs. */
  | { status: "limit_reached" }
  /** Not the user's clipping, or deleted. */
  | { status: "not_found" }
  /** Already submitted, being written, or ready. */
  | { status: "busy" };

/** A brief and what the writer needs to write it. */
export interface BriefForWriting {
  /** Also the `custom_id` of its request in a batch. */
  id: string;
  userId: string;
  clippingId: string;
  /** The research domain; empty for a brief asked for by hand. */
  domain: string;
  reason: string;
  /** The user's "About me" text; may be empty. */
  profile: string;
  clipping: {
    kind: ClippingKind;
    /** Null on a note. */
    url: string | null;
    /** The title to show: the user's own, else the page's. */
    title: string;
    summary: string | null;
    excerpt: string | null;
    /** A note's text; null on a link. */
    body: string | null;
  };
  /** The page text a reading saved, or null when there is none (a note, or not read yet). */
  pageText: string | null;
}

/** A submission is retried once: a brief that fails on its second go is dropped. */
const MAX_ATTEMPTS = 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Not deleted: a deleted clipping's brief is neither shown nor written. */
const live = isNull(clippings.deletedAt);

/** Text a reading has used: any but a browser text still waiting for its first reading. */
const readPageText = or(ne(clippingTexts.origin, "browser"), isNotNull(clippingTexts.readAt));

const briefColumns = {
  id: researchBriefs.id,
  clippingId: researchBriefs.clippingId,
  domain: researchBriefs.domain,
  reason: researchBriefs.reason,
  status: researchBriefs.status,
  mode: researchBriefs.mode,
  body: researchBriefs.body,
  sources: researchBriefs.sources,
  note: researchBriefs.note,
  createdAt: researchBriefs.createdAt,
  updatedAt: researchBriefs.updatedAt,
  completedAt: researchBriefs.completedAt,
};

function toBrief(row: Pick<typeof researchBriefs.$inferSelect, keyof typeof briefColumns>): Brief {
  return {
    ...row,
    sources: row.sources as BriefSource[],
    createdAt: formatIsoUtc(row.createdAt),
    updatedAt: formatIsoUtc(row.updatedAt),
    completedAt: row.completedAt ? formatIsoUtc(row.completedAt) : null,
  };
}

/**
 * The research briefs: one per clipping, queued by enrichment or asked for by hand, written by the
 * daily batch or on request. The daily limit (`user_settings.research_jobs_per_day`) counts a
 * user's submissions in the UTC day. Operations that act for a user take them and scope their
 * queries by them; the batch operations (`claimForBatch` and what follows it) act on every user's
 * briefs by id, as the cron job does.
 */
export function createResearchService({ pool, clock }: ResearchServiceDeps) {
  const db = createDatabase(pool);

  const dayStart = (at: Date) => startOfDay(at, { in: utc });

  /** How many briefs of each user were submitted since `since`. */
  async function submissionCounts(userIds: readonly string[], since: Date) {
    const counts = new Map<string, number>();
    if (userIds.length === 0) return counts;
    const rows = await db
      .select({ userId: researchBriefs.userId, submitted: count() })
      .from(researchBriefs)
      .where(
        and(inArray(researchBriefs.userId, [...userIds]), gte(researchBriefs.submittedAt, since)),
      )
      .groupBy(researchBriefs.userId);
    for (const row of rows) counts.set(row.userId, row.submitted);
    return counts;
  }

  /**
   * Queues a brief for a clipping that a verdict found worth researching. Takes the database or
   * the transaction the caller is in, so enrichment can queue it in the transaction that marks the
   * clipping ready. A clipping that already has a brief keeps it. True when a brief was queued.
   * The clipping must be the user's: another user's id fails the composite foreign key.
   */
  async function queueBrief(
    executor: BriefWriter,
    { userId, clippingId, domain, reason }: QueueBriefInput,
  ): Promise<boolean> {
    const now = clock.now();
    const queued = await executor
      .insert(researchBriefs)
      .values({
        userId,
        clippingId,
        domain,
        reason,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: researchBriefs.clippingId })
      .returning({ id: researchBriefs.id });
    return queued.length > 0;
  }

  /** The clipping's brief, whatever its status; null when it has none or is not the user's or is deleted. */
  async function getBrief(userId: string, clippingId: string): Promise<Brief | null> {
    if (!UUID.test(clippingId)) return null;
    const [row] = await db
      .select(briefColumns)
      .from(researchBriefs)
      .innerJoin(
        clippings,
        and(
          eq(clippings.id, researchBriefs.clippingId),
          eq(clippings.userId, researchBriefs.userId),
        ),
      )
      .where(
        and(eq(researchBriefs.clippingId, clippingId), eq(researchBriefs.userId, userId), live),
      );
    return row ? toBrief(row) : null;
  }

  /** How many briefs the user has submitted since 00:00 UTC today. */
  async function submissionsToday(userId: string): Promise<number> {
    return (await submissionCounts([userId], dayStart(clock.now()))).get(userId) ?? 0;
  }

  /**
   * Starts writing the clipping's brief now, for the user who asked: a queued or dropped brief is
   * taken up, and a clipping with none gets one made by hand. Counts as a submission, so it is
   * refused with `limit_reached` once the user has used today's research jobs, and with `busy`
   * when the brief is already submitted, being written or ready.
   */
  async function requestBriefNow(
    userId: string,
    clippingId: string,
  ): Promise<RequestBriefNowResult> {
    if (!UUID.test(clippingId)) return { status: "not_found" };
    return db.transaction(async (tx) => {
      // The count and the write after it can't be split by another request of the same user.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`research:${userId}`}, 0))`,
      );
      const now = clock.now();

      const [owned] = await tx
        .select({ id: clippings.id })
        .from(clippings)
        .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId), live));
      if (!owned) return { status: "not_found" };

      const [existing] = await tx
        .select({ id: researchBriefs.id, status: researchBriefs.status })
        .from(researchBriefs)
        .where(and(eq(researchBriefs.clippingId, clippingId), eq(researchBriefs.userId, userId)));
      if (existing && existing.status !== "queued" && existing.status !== "dropped") {
        return { status: "busy" };
      }

      const [settings] = await tx
        .select({ limit: userSettings.researchJobsPerDay })
        .from(userSettings)
        .where(eq(userSettings.userId, userId));
      const limit = settings?.limit ?? AUTOMATION_DEFAULTS.researchJobsPerDay;
      const [usage] = await tx
        .select({ used: count() })
        .from(researchBriefs)
        .where(
          and(eq(researchBriefs.userId, userId), gte(researchBriefs.submittedAt, dayStart(now))),
        );
      if ((usage?.used ?? 0) >= limit) return { status: "limit_reached" };

      const writing = {
        status: "writing",
        mode: "now",
        batchId: null,
        note: null,
        submittedAt: now,
        completedAt: null,
        updatedAt: now,
      } as const;
      const [brief] = existing
        ? await tx
            .update(researchBriefs)
            .set({ ...writing, attempts: sql`${researchBriefs.attempts} + 1` })
            .where(and(eq(researchBriefs.id, existing.id), eq(researchBriefs.userId, userId)))
            .returning(briefColumns)
        : await tx
            .insert(researchBriefs)
            .values({
              ...writing,
              userId,
              clippingId,
              domain: "",
              reason: "Asked for by hand",
              attempts: 1,
              createdAt: now,
            })
            .onConflictDoNothing({ target: researchBriefs.clippingId })
            .returning(briefColumns);
      // Enrichment queued a brief for the clipping between the check and the insert.
      return brief ? { status: "started", brief: toBrief(brief) } : { status: "busy" };
    });
  }

  /** The briefs with these ids and what the writer needs, in the order given; one the clipping of which is deleted is left out. */
  async function loadForWriting(briefIds: readonly string[]): Promise<BriefForWriting[]> {
    if (briefIds.length === 0) return [];
    const rows = await db
      .select({
        id: researchBriefs.id,
        userId: researchBriefs.userId,
        clippingId: researchBriefs.clippingId,
        domain: researchBriefs.domain,
        reason: researchBriefs.reason,
        profile: userSettings.researchProfile,
        kind: clippings.kind,
        url: clippings.url,
        title: sql<string>`coalesce(${clippings.userTitle}, ${clippings.title})`,
        summary: clippings.summary,
        excerpt: clippings.excerpt,
        body: clippings.body,
        pageText: clippingTexts.text,
      })
      .from(researchBriefs)
      .innerJoin(
        clippings,
        and(
          eq(clippings.id, researchBriefs.clippingId),
          eq(clippings.userId, researchBriefs.userId),
        ),
      )
      .leftJoin(userSettings, eq(userSettings.userId, researchBriefs.userId))
      .leftJoin(
        clippingTexts,
        and(
          eq(clippingTexts.clippingId, researchBriefs.clippingId),
          eq(clippingTexts.userId, researchBriefs.userId),
          readPageText,
        ),
      )
      .where(and(inArray(researchBriefs.id, [...briefIds]), live));
    const byId = new Map(
      rows.map((row): [string, BriefForWriting] => [
        row.id,
        {
          id: row.id,
          userId: row.userId,
          clippingId: row.clippingId,
          domain: row.domain,
          reason: row.reason,
          profile: row.profile ?? RESEARCH_DEFAULTS.profile,
          clipping: {
            kind: row.kind,
            url: row.url,
            title: row.title,
            summary: row.summary,
            excerpt: row.excerpt,
            body: row.body,
          },
          pageText: row.pageText,
        },
      ]),
    );
    return briefIds.flatMap((id) => byId.get(id) ?? []);
  }

  /** One of the user's briefs with what the writer needs; null when it isn't theirs or its clipping is deleted. */
  async function getBriefForWriting(
    userId: string,
    briefId: string,
  ): Promise<BriefForWriting | null> {
    if (!UUID.test(briefId)) return null;
    const [brief] = await loadForWriting([briefId]);
    return brief && brief.userId === userId ? brief : null;
  }

  /**
   * What the daily batch should submit: per user, their oldest queued briefs of clippings that
   * are not deleted, as many as the user has research jobs left for the UTC day of `now`. Changes
   * nothing: `markSubmitted` does, once the batch is created.
   */
  async function claimForBatch(
    now: Date,
  ): Promise<{ userId: string; briefs: BriefForWriting[] }[]> {
    const queued = await db
      .select({
        id: researchBriefs.id,
        userId: researchBriefs.userId,
        limit: sql<number>`coalesce(${userSettings.researchJobsPerDay}, ${AUTOMATION_DEFAULTS.researchJobsPerDay})`,
      })
      .from(researchBriefs)
      .innerJoin(
        clippings,
        and(
          eq(clippings.id, researchBriefs.clippingId),
          eq(clippings.userId, researchBriefs.userId),
        ),
      )
      .leftJoin(userSettings, eq(userSettings.userId, researchBriefs.userId))
      .where(and(eq(researchBriefs.status, "queued"), live))
      .orderBy(asc(researchBriefs.createdAt), asc(researchBriefs.id));

    const used = await submissionCounts(
      [...new Set(queued.map((row) => row.userId))],
      dayStart(now),
    );
    const chosen = new Map<string, string[]>();
    for (const { id, userId, limit } of queued) {
      const ids = chosen.get(userId) ?? [];
      if (ids.length + (used.get(userId) ?? 0) >= limit) continue;
      chosen.set(userId, [...ids, id]);
    }

    const loaded = await loadForWriting([...chosen.values()].flat());
    const claims = new Map<string, BriefForWriting[]>();
    for (const brief of loaded)
      claims.set(brief.userId, [...(claims.get(brief.userId) ?? []), brief]);
    return [...chosen.keys()].flatMap((userId) => {
      const briefs = claims.get(userId);
      return briefs ? [{ userId, briefs }] : [];
    });
  }

  /**
   * Records that these queued briefs went into the batch: each is `submitted`, one more attempt
   * made, and counts toward its user's research jobs today. Returns how many it moved.
   */
  async function markSubmitted(briefIds: readonly string[], batchId: string): Promise<number> {
    if (briefIds.length === 0) return 0;
    const now = clock.now();
    const moved = await db
      .update(researchBriefs)
      .set({
        status: "submitted",
        mode: "batch",
        batchId,
        note: null,
        attempts: sql`${researchBriefs.attempts} + 1`,
        submittedAt: now,
        updatedAt: now,
      })
      .where(and(inArray(researchBriefs.id, [...briefIds]), eq(researchBriefs.status, "queued")))
      .returning({ id: researchBriefs.id });
    return moved.length;
  }

  /** The ids of the batches that hold submitted briefs: the ones to ask the provider about. */
  async function submittedBatchIds(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ batchId: researchBriefs.batchId })
      .from(researchBriefs)
      .where(and(eq(researchBriefs.status, "submitted"), isNotNull(researchBriefs.batchId)))
      .orderBy(asc(researchBriefs.batchId));
    return rows.map((row) => row.batchId!);
  }

  /** The briefs still waiting on this batch: their ids (the batch's `custom_id`s) and owners. */
  async function briefsInBatch(batchId: string): Promise<{ id: string; userId: string }[]> {
    return db
      .select({ id: researchBriefs.id, userId: researchBriefs.userId })
      .from(researchBriefs)
      .where(and(eq(researchBriefs.batchId, batchId), eq(researchBriefs.status, "submitted")))
      .orderBy(asc(researchBriefs.createdAt), asc(researchBriefs.id));
  }

  /**
   * Stores the written brief and marks it `ready`. The body is cut to `MAX_BRIEF_LENGTH`. Only a
   * submitted or writing brief takes it; true when this one did.
   */
  async function completeBrief(
    id: string,
    { body, sources }: { body: string; sources: BriefSource[] },
  ): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const now = clock.now();
    const done = await db
      .update(researchBriefs)
      .set({
        status: "ready",
        body: body.slice(0, MAX_BRIEF_LENGTH),
        sources,
        batchId: null,
        note: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(researchBriefs.id, id), inArray(researchBriefs.status, ["submitted", "writing"])),
      )
      .returning({ id: researchBriefs.id });
    return done.length > 0;
  }

  /**
   * Fails the in-flight briefs that match `where`: one with an attempt to spare goes back to
   * `queued` with a note saying it will be retried, any other is `dropped` with a note saying why.
   * Returns the status each ended up in.
   */
  async function failWhere(where: ReturnType<typeof and>, why: string) {
    const now = clock.now();
    const retry = sql`${researchBriefs.attempts} < ${MAX_ATTEMPTS}`;
    return db
      .update(researchBriefs)
      .set({
        status: sql`case when ${retry} then 'queued' else 'dropped' end`,
        batchId: null,
        note: sql`case when ${retry} then ${`Retrying after ${why}`} else ${`Dropped after ${MAX_ATTEMPTS} tries: ${why}`} end`,
        completedAt: sql`case when ${retry} then null else ${now}::timestamptz end`,
        updatedAt: now,
      })
      .where(and(inArray(researchBriefs.status, ["submitted", "writing"]), where))
      .returning({ status: researchBriefs.status });
  }

  /**
   * The provider failed or expired this submitted or writing brief. The first time it goes back to
   * `queued` for the next batch with the note "Retrying after <why>"; the second time it is
   * `dropped`, with a note, and `completed_at` set. `why` is a short phrase such as "the batch
   * expired". Returns the status it is in now, or null when it was not in flight.
   */
  async function failBrief(id: string, why: string): Promise<"queued" | "dropped" | null> {
    if (!UUID.test(id)) return null;
    const [failed] = await failWhere(eq(researchBriefs.id, id), why);
    return (failed?.status as "queued" | "dropped" | undefined) ?? null;
  }

  /**
   * Fails the briefs that have been `writing` since before `olderThan`: the job that was writing
   * them died. Same rule as `failBrief`. Returns how many it failed.
   */
  async function failStuckWriting(olderThan: Date): Promise<number> {
    const failed = await failWhere(
      and(eq(researchBriefs.status, "writing"), lt(researchBriefs.submittedAt, olderThan)),
      "the writer stopped partway",
    );
    return failed.length;
  }

  /**
   * Puts an in-flight brief back in the queue without counting the go: the model was never called
   * (the daily spending cap was reached), so it takes no attempt and no research job of the day.
   * `note` tells the user why. True when the brief was in flight.
   */
  async function holdBrief(id: string, note: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const held = await db
      .update(researchBriefs)
      .set({
        status: "queued",
        mode: "batch",
        batchId: null,
        note,
        attempts: sql`greatest(${researchBriefs.attempts} - 1, 0)`,
        submittedAt: null,
        updatedAt: clock.now(),
      })
      .where(
        and(eq(researchBriefs.id, id), inArray(researchBriefs.status, ["submitted", "writing"])),
      )
      .returning({ id: researchBriefs.id });
    return held.length > 0;
  }

  return {
    queueBrief,
    getBrief,
    getBriefForWriting,
    requestBriefNow,
    claimForBatch,
    markSubmitted,
    submittedBatchIds,
    briefsInBatch,
    completeBrief,
    failBrief,
    failStuckWriting,
    holdBrief,
    submissionsToday,
  };
}

export type ResearchService = ReturnType<typeof createResearchService>;
