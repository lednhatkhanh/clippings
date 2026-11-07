import { utc } from "@date-fns/utc";
import { startOfDay, startOfMonth } from "date-fns";
import { and, eq, gte, sql } from "drizzle-orm";
import type pg from "pg";

import { AUTOMATION_DEFAULTS, type ModelJobKind, type SpendSummary } from "@clippings/shared";

import type { Clock } from "../clippings/ports.ts";
import { createDatabase } from "../database.ts";
import { modelUsage, userSettings } from "../schema.ts";

export interface UsageServiceDeps {
  pool: pg.Pool;
  clock: Clock;
}

/** One paid model call, as the gateway records it. */
export interface ModelUsageEntry {
  jobKind: ModelJobKind;
  model: string;
  /** Whether the call ran through the Batch API. */
  batch: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  /** What the call cost, in micro-dollars. */
  costMicros: number;
  /**
   * Names the request this row is for. A second row with the same key is not written, so
   * recording a request again (a batch collected twice) bills it once.
   */
  requestKey?: string;
}

/** What the gateway checks before a call: today's spend against the user's daily cap. */
export interface UsageBudget {
  spentTodayMicros: number;
  dailyCapMicros: number;
}

/**
 * The ledger of what a user's model calls cost. Every operation takes the user and scopes its
 * queries by them. A day is a UTC day and a month a UTC month, whatever the user's own time zone.
 */
export function createUsageService({ pool, clock }: UsageServiceDeps) {
  const db = createDatabase(pool);

  /** The user's spend since `since`, in micro-dollars. */
  async function spentSince(userId: string, since: Date): Promise<number> {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${modelUsage.costMicros}), 0)::text` })
      .from(modelUsage)
      .where(and(eq(modelUsage.userId, userId), gte(modelUsage.createdAt, since)));
    return Number(row?.total ?? 0);
  }

  /** Writes one row to the user's ledger, stamped from the clock; none if its `requestKey` is already there. */
  async function recordUsage(userId: string, entry: ModelUsageEntry): Promise<void> {
    await db
      .insert(modelUsage)
      .values({ userId, ...entry, createdAt: clock.now() })
      .onConflictDoNothing();
  }

  /** Today's spend and the user's daily cap (the default for a user who never set one). */
  async function getBudget(userId: string): Promise<UsageBudget> {
    const [spentTodayMicros, [settings]] = await Promise.all([
      spentSince(userId, startOfDay(clock.now(), { in: utc })),
      db
        .select({ cap: userSettings.dailyCapMicros })
        .from(userSettings)
        .where(eq(userSettings.userId, userId)),
    ]);
    return {
      spentTodayMicros,
      dailyCapMicros: settings?.cap ?? AUTOMATION_DEFAULTS.dailyCapMicros,
    };
  }

  /** What the user has spent today and this month (UTC). */
  async function getSpend(userId: string): Promise<SpendSummary> {
    const now = clock.now();
    const [todayMicros, monthMicros] = await Promise.all([
      spentSince(userId, startOfDay(now, { in: utc })),
      spentSince(userId, startOfMonth(now, { in: utc })),
    ]);
    return { todayMicros, monthMicros };
  }

  return { recordUsage, getBudget, getSpend };
}

export type UsageService = ReturnType<typeof createUsageService>;
