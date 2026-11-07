import type { ModelJobKind } from "@clippings/shared";

/**
 * How much of the daily cap a job kind may use before it stops. Tagging, summarizing and
 * embedding on save (`enrich`) is the cheapest, most useful job and may use all of it; everything
 * else (search, briefs, lessons, the librarian) stops at 80%, which keeps the last fifth of the
 * day's cap for saves.
 */
const NON_ENRICH_SHARE = { numerator: 4, denominator: 5 };

/** The most a job of this kind may have spent today before it is refused, in micro-dollars. */
export function spendLimitMicros(jobKind: ModelJobKind, dailyCapMicros: number): number {
  if (jobKind === "enrich") return dailyCapMicros;
  return Math.floor((dailyCapMicros * NON_ENRICH_SHARE.numerator) / NON_ENRICH_SHARE.denominator);
}

/**
 * Whether a job of this kind may start a call now. At the limit it may not: a cap of $3 stops
 * calls once $3 is spent (80%: $2.40 for the other kinds), and a cap of $0 holds everything.
 */
export function mayCall({
  jobKind,
  spentTodayMicros,
  dailyCapMicros,
}: {
  jobKind: ModelJobKind;
  spentTodayMicros: number;
  dailyCapMicros: number;
}): boolean {
  return spentTodayMicros < spendLimitMicros(jobKind, dailyCapMicros);
}
