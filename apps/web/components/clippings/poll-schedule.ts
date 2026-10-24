import type { ClippingSource } from "@clippings/shared";

/** How soon a pending clipping first asks whether enrichment has finished. */
export const POLL_FIRST_MS = 2000;
/** The longest it waits between asks: a clipping sits pending for minutes at most. */
export const POLL_MAX_MS = 60_000;
/**
 * The longest an imported clipping waits between asks: the backlog is read over about a day, so
 * a row stays pending for hours and nobody is waiting for it.
 */
export const POLL_MAX_IMPORT_MS = 300_000;

/** The longest wait between asks for a clipping saved from `source`. */
export function pollMax(source: ClippingSource): number {
  return source === "import" ? POLL_MAX_IMPORT_MS : POLL_MAX_MS;
}

/**
 * The wait before ask number `attempt` (0 is the first after the row appears): it starts at
 * `POLL_FIRST_MS` and doubles up to `maxMs`, so a fresh save is noticed quickly and a row that
 * stays pending costs little.
 */
export function pollDelay(attempt: number, maxMs: number = POLL_MAX_MS): number {
  if (!(attempt > 0)) return POLL_FIRST_MS;
  return Math.min(POLL_FIRST_MS * 2 ** Math.floor(attempt), maxMs);
}
