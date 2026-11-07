import * as z from "zod";

/**
 * The kinds of job that call a model. The model gateway tags every ledger row with one, and its
 * cap rule is by kind: `enrich` is the cheap, useful job that keeps running up to the whole cap.
 * `search` is the query embedding behind a search the reader is waiting on.
 */
export const MODEL_JOB_KINDS = ["enrich", "search", "brief", "lesson", "librarian"] as const;
export type ModelJobKind = (typeof MODEL_JOB_KINDS)[number];

/** Micro-dollars in a dollar: the unit the ledger, the rate table and the cap are kept in. */
export const MICROS_PER_DOLLAR = 1_000_000;

export const DEFAULT_DAILY_CAP_MICROS = 3 * MICROS_PER_DOLLAR;
export const DEFAULT_RESEARCH_JOBS_PER_DAY = 3;

/** Highest daily cap the settings take: $1,000, far past the $100 of credit that comes with Max. */
export const MAX_DAILY_CAP_MICROS = 1_000 * MICROS_PER_DOLLAR;
export const MAX_RESEARCH_JOBS_PER_DAY = 100;

/** The per-user limits on what automation may spend. */
export interface AutomationSettings {
  /** Most the app spends on model calls in one UTC day, in micro-dollars. */
  dailyCapMicros: number;
  /** Most research jobs submitted in one UTC day. */
  researchJobsPerDay: number;
}

export const AUTOMATION_DEFAULTS: AutomationSettings = {
  dailyCapMicros: DEFAULT_DAILY_CAP_MICROS,
  researchJobsPerDay: DEFAULT_RESEARCH_JOBS_PER_DAY,
};

/**
 * A change to the automation settings, as a client sends it: either or both, whole numbers in
 * range. Refused with a message, never clamped, so a typo doesn't quietly become a different cap.
 */
export const automationSettingsChangeSchema = z
  .object({
    dailyCapMicros: z
      .int("The cap must be a whole number of micro-dollars")
      .min(0, "The cap can't be negative")
      .max(MAX_DAILY_CAP_MICROS, "The cap can't be above $1,000"),
    researchJobsPerDay: z
      .int("Research jobs must be a whole number")
      .min(0, "Research jobs can't be negative")
      .max(MAX_RESEARCH_JOBS_PER_DAY, `At most ${MAX_RESEARCH_JOBS_PER_DAY} research jobs a day`),
  })
  .partial()
  .strict()
  .refine((change) => Object.keys(change).length > 0, "Nothing to change");

export type AutomationSettingsChange = z.infer<typeof automationSettingsChangeSchema>;

/** What the user has spent on model calls, in micro-dollars. */
export interface SpendSummary {
  /** Since 00:00 UTC today. */
  todayMicros: number;
  /** Since 00:00 UTC on the 1st of this month. */
  monthMicros: number;
}
