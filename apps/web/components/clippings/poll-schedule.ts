/** How soon a pending clipping first asks whether enrichment has finished. */
export const POLL_FIRST_MS = 2000;
/** The longest it waits between asks: a backlog row sits pending for hours. */
export const POLL_MAX_MS = 60_000;

/**
 * The wait before ask number `attempt` (0 is the first after the row appears): it starts at
 * `POLL_FIRST_MS` and doubles up to `POLL_MAX_MS`, so a fresh save is noticed quickly and a row
 * that stays pending costs little.
 */
export function pollDelay(attempt: number): number {
  if (!(attempt > 0)) return POLL_FIRST_MS;
  return Math.min(POLL_FIRST_MS * 2 ** Math.floor(attempt), POLL_MAX_MS);
}
