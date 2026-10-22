import { utc, UTCDate } from "@date-fns/utc";
import {
  addDays,
  addWeeks,
  format,
  isBefore,
  isValid,
  parseISO,
  startOfWeek,
  subWeeks,
} from "date-fns";
import { and, desc, eq, gte, inArray, isNull, lt, notExists, sql } from "drizzle-orm";
import type pg from "pg";

import type { Clock, DigestClipping, Digester, WeeklyDigest } from "../clippings/ports.ts";
import type { ClippingsService } from "../clippings/service.ts";
import { createDatabase } from "../database.ts";
import { clippings, clippingTags, tags, weeklyDigests } from "../schema.ts";

export interface DigestServiceDeps {
  pool: pg.Pool;
  clock: Clock;
  digester: Digester;
  /** Where the older clippings that bring a week back come from. */
  clippings: Pick<ClippingsService, "relatedClippings">;
}

/** The most clippings of one week the digester reads; the newest, when there are more. */
const MAX_WEEK_CLIPPINGS = 60;
/** The older clippings a digest may bring back. */
const MAX_RELATED = 3;
/** How many of the week's clippings are asked for related ones, newest first. */
const RELATED_FROM = 10;
/** A note longer than this is cut before the digester reads it. */
const MAX_NOTE_LENGTH_READ = 500;
/** The earlier weeks the page lists. */
const MAX_LISTED_WEEKS = 52;

const WEEK_FORMAT = "yyyy-MM-dd";

/** A clipping a digest points at, by its current title. */
export interface DigestClippingRef {
  id: string;
  url: string;
  title: string;
}

/** A week by its Monday and Sunday, `yyyy-MM-dd` (UTC). */
export interface DigestWeek {
  weekStart: string;
  weekEnd: string;
}

/** One finished week's digest, ready to show: ids replaced by the clippings as they are now. */
export interface WeeklyDigestView extends DigestWeek {
  groups: { title: string; summary: string; clippings: DigestClippingRef[] }[];
  resurfaced: { clipping: DigestClippingRef; why: string }[];
}

/**
 * The Monday (UTC) of the most recent week that has fully finished at `now`, as `yyyy-MM-dd`.
 * During a week this is the Monday of the one before it, and on its Monday at midnight the week
 * that just ended becomes the one.
 */
export function lastFinishedWeek(now: Date): string {
  return format(subWeeks(startOfWeek(now, { weekStartsOn: 1, in: utc }), 1), WEEK_FORMAT);
}

/** The Sunday (UTC) of the week that starts on this Monday. */
function weekEndOf(weekStart: string): string {
  return format(addDays(new UTCDate(weekStart), 6), WEEK_FORMAT);
}

/** Whether this is a real calendar day written as `yyyy-MM-dd`. */
function isWeekParam(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value));
}

/** Reads a stored digest, tolerating nothing: a row that doesn't have the shape is skipped. */
function readDigest(value: unknown): WeeklyDigest | null {
  if (typeof value !== "object" || value === null) return null;
  const { groups, resurfaced } = value as Partial<WeeklyDigest>;
  if (!Array.isArray(groups) || !Array.isArray(resurfaced)) return null;
  return { groups, resurfaced };
}

/**
 * The weekly digest: a model-written look back at each finished week, made by the daily cron and
 * read by the "This week" page. Every read takes the acting user and scopes its queries by them;
 * `generateWeeklyDigests` is a system job that acts across users, reached only through the cron
 * secret.
 */
export function createDigestService({
  pool,
  clock,
  digester,
  clippings: related,
}: DigestServiceDeps) {
  const db = createDatabase(pool);

  const shownTitle = sql<string>`coalesce(${clippings.userTitle}, ${clippings.title})`;

  /** The week's live clippings of the user, newest first, with their tag names. */
  async function weekClippings(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<(DigestClipping & { createdAt: Date })[]> {
    const rows = await db
      .select({
        id: clippings.id,
        title: shownTitle,
        summary: clippings.summary,
        note: clippings.note,
        createdAt: clippings.createdAt,
      })
      .from(clippings)
      .where(
        and(
          eq(clippings.userId, userId),
          isNull(clippings.deletedAt),
          gte(clippings.createdAt, start),
          lt(clippings.createdAt, end),
        ),
      )
      .orderBy(desc(clippings.createdAt), desc(clippings.id))
      .limit(MAX_WEEK_CLIPPINGS);
    const tagRows =
      rows.length === 0
        ? []
        : await db
            .select({ clippingId: clippingTags.clippingId, name: tags.name })
            .from(clippingTags)
            .innerJoin(tags, eq(tags.id, clippingTags.tagId))
            .where(
              and(
                eq(clippingTags.userId, userId),
                inArray(
                  clippingTags.clippingId,
                  rows.map((row) => row.id),
                ),
              ),
            )
            .orderBy(tags.name);
    return rows.map((row) => ({
      ...row,
      note: row.note.slice(0, MAX_NOTE_LENGTH_READ),
      tags: tagRows.filter((tag) => tag.clippingId === row.id).map((tag) => tag.name),
    }));
  }

  /**
   * Up to 3 clippings saved before the week that are close in meaning to the week's, found by
   * asking for the related ones of the week's newest clippings in turn. Never one of the week's.
   */
  async function olderRelated(
    userId: string,
    week: readonly { id: string }[],
    start: Date,
  ): Promise<DigestClipping[]> {
    const inWeek = new Set(week.map((clipping) => clipping.id));
    const found = new Map<string, DigestClipping>();
    for (const { id } of week.slice(0, RELATED_FROM)) {
      if (found.size >= MAX_RELATED) break;
      for (const clipping of await related.relatedClippings(userId, id)) {
        if (inWeek.has(clipping.id) || found.has(clipping.id)) continue;
        if (!isBefore(parseISO(clipping.createdAt), start)) continue;
        found.set(clipping.id, {
          id: clipping.id,
          title: clipping.title,
          summary: clipping.summary,
          tags: clipping.tags.map((tag) => tag.name),
          note: clipping.note.slice(0, MAX_NOTE_LENGTH_READ),
        });
        if (found.size >= MAX_RELATED) break;
      }
    }
    return [...found.values()];
  }

  /** Writes the user's digest of the week, unless they have one already. True when it wrote one. */
  async function generateFor(userId: string, weekStart: string): Promise<boolean> {
    const start = new UTCDate(weekStart);
    const end = addWeeks(start, 1);
    const week = await weekClippings(userId, start, end);
    // Everything of the week was deleted since the user was picked.
    if (week.length === 0) return false;

    const digest = await digester.digest({
      weekStart,
      clippings: week.map(({ createdAt: _createdAt, ...clipping }) => clipping),
      related: await olderRelated(userId, week, start),
    });
    const inserted = await db
      .insert(weeklyDigests)
      .values({ userId, weekStart, digest, createdAt: clock.now() })
      .onConflictDoNothing()
      .returning({ userId: weeklyDigests.userId });
    return inserted.length > 0;
  }

  /**
   * For the daily cron: writes the digest of the last finished week (Monday to Sunday, UTC) for
   * up to `limit` users who saved a live clipping in it and have no digest of it yet, and returns
   * how many it wrote. A second run the same week finds those users done and does nothing for
   * them. A user whose digest fails is logged and left for the next run; the others are not held
   * up by them. Users are picked in no particular order, so users that keep failing can't crowd
   * out the rest.
   */
  async function generateWeeklyDigests({ limit }: { limit: number }): Promise<number> {
    const weekStart = lastFinishedWeek(clock.now());
    const start = new UTCDate(weekStart);
    const end = addWeeks(start, 1);
    const pending = await db
      .select({ userId: clippings.userId })
      .from(clippings)
      .where(
        and(
          isNull(clippings.deletedAt),
          gte(clippings.createdAt, start),
          lt(clippings.createdAt, end),
          notExists(
            db
              .select({ one: sql`1` })
              .from(weeklyDigests)
              .where(
                and(
                  eq(weeklyDigests.userId, clippings.userId),
                  eq(weeklyDigests.weekStart, weekStart),
                ),
              ),
          ),
        ),
      )
      .groupBy(clippings.userId)
      .orderBy(sql`random()`)
      .limit(limit);

    const outcomes = await Promise.allSettled(
      pending.map(({ userId }) => generateFor(userId, weekStart)),
    );
    let written = 0;
    outcomes.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") {
        if (outcome.value) written += 1;
      } else {
        console.error(
          `Couldn't write the digest of ${weekStart} for user ${pending[index]!.userId}`,
          outcome.reason,
        );
      }
    });
    return written;
  }

  /** The weeks the user has a digest of, newest first, each by its Monday and Sunday. */
  async function listDigestWeeks(userId: string): Promise<DigestWeek[]> {
    const rows = await db
      .select({ weekStart: weeklyDigests.weekStart })
      .from(weeklyDigests)
      .where(eq(weeklyDigests.userId, userId))
      .orderBy(desc(weeklyDigests.weekStart))
      .limit(MAX_LISTED_WEEKS);
    return rows.map(({ weekStart }) => ({ weekStart, weekEnd: weekEndOf(weekStart) }));
  }

  /**
   * The user's digest of the week that starts on `week` (a Monday, `yyyy-MM-dd`), or their latest
   * when `week` is left out. Null when there is none, or `week` isn't a date. Each clipping shows
   * under its current title, and a deleted one is left out, with a group or a resurfaced clipping
   * that is left with nothing.
   */
  async function getDigest(userId: string, week?: string): Promise<WeeklyDigestView | null> {
    if (week !== undefined && !isWeekParam(week)) return null;
    const [row] = await db
      .select({ weekStart: weeklyDigests.weekStart, digest: weeklyDigests.digest })
      .from(weeklyDigests)
      .where(
        and(
          eq(weeklyDigests.userId, userId),
          week === undefined ? undefined : eq(weeklyDigests.weekStart, week),
        ),
      )
      .orderBy(desc(weeklyDigests.weekStart))
      .limit(1);
    const digest = row && readDigest(row.digest);
    if (!row || !digest) return null;

    const ids = [
      ...new Set([
        ...digest.groups.flatMap((group) => group.clippingIds),
        ...digest.resurfaced.map((item) => item.clippingId),
      ]),
    ];
    const live =
      ids.length === 0
        ? []
        : await db
            .select({ id: clippings.id, url: clippings.url, title: shownTitle })
            .from(clippings)
            .where(
              and(
                eq(clippings.userId, userId),
                isNull(clippings.deletedAt),
                inArray(clippings.id, ids),
              ),
            );
    const byId = new Map(live.map((clipping) => [clipping.id, clipping]));
    const refs = (clippingIds: readonly string[]) =>
      clippingIds.flatMap((id) => byId.get(id) ?? []);

    return {
      weekStart: row.weekStart,
      weekEnd: weekEndOf(row.weekStart),
      groups: digest.groups
        .map(({ title, summary, clippingIds }) => ({
          title,
          summary,
          clippings: refs(clippingIds),
        }))
        .filter((group) => group.clippings.length > 0),
      resurfaced: digest.resurfaced.flatMap(({ clippingId, why }) => {
        const [clipping] = refs([clippingId]);
        return clipping ? [{ clipping, why }] : [];
      }),
    };
  }

  return { generateWeeklyDigests, listDigestWeeks, getDigest };
}

export type DigestService = ReturnType<typeof createDigestService>;
