import type { ClippingRowData } from "@/lib/clippings/rows.ts";
import { MAX_STATUS_IDS, type ClippingSource, type ClippingStatus } from "@clippings/shared";

import { pollDelay, pollMax } from "./poll-schedule.ts";

/** Rows due within this long of a round join it, so rows that are nearly due share a request. */
const BATCH_WINDOW_MS = 500;

export interface PendingPollerDeps {
  /** One status read for up to `MAX_STATUS_IDS` clippings; one that is gone is left out. */
  fetchStatuses: (ids: string[]) => Promise<{ id: string; status: ClippingStatus }[]>;
  /** The clipping as a list row, once its status has changed. */
  fetchRow: (id: string) => Promise<ClippingRowData>;
  /** Milliseconds on a clock that only moves forward. */
  now: () => number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
  /** False while the tab is hidden or offline: nothing is asked, and `wake` resumes. */
  canPoll: () => boolean;
}

interface Watched {
  source: ClippingSource;
  onRow: (row: ClippingRowData) => void;
  /** When the next status read for it is due, on the `now` clock. */
  dueAt: number;
}

/**
 * Asks, for every pending row the list is watching, whether enrichment has finished: one status
 * request for all the rows that are due, not one request per row. A row waits longer after each
 * answer that says it is still pending (`poll-schedule.ts`), and when its status changes the
 * poller reads it once as a row and hands it to the row's `onRow`.
 */
export function createPendingPoller({
  fetchStatuses,
  fetchRow,
  now,
  setTimer,
  clearTimer,
  canPoll,
}: PendingPollerDeps) {
  const watched = new Map<string, Watched>();
  /** Answers each row has had that said pending, kept while it is off screen so its waits carry on. */
  const answers = new Map<string, number>();
  let timer: unknown;
  let running = false;

  function schedule() {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    if (running || watched.size === 0 || !canPoll()) return;
    const next = Math.min(...[...watched.values()].map(({ dueAt }) => dueAt));
    timer = setTimer(() => void run(), Math.max(next - now(), 0));
  }

  /** The row is still pending: asks again later than the last time. */
  function backOff(id: string, entry: Watched) {
    const count = (answers.get(id) ?? 0) + 1;
    answers.set(id, count);
    entry.dueAt = now() + pollDelay(count - 1, pollMax(entry.source));
  }

  function forget(id: string, entry: Watched) {
    if (watched.get(id) === entry) watched.delete(id);
    answers.delete(id);
  }

  async function read(ids: string[]) {
    let statuses: Awaited<ReturnType<PendingPollerDeps["fetchStatuses"]>>;
    try {
      statuses = await fetchStatuses(ids);
    } catch {
      // The request failed: try again later, as for a pending answer, rather than in a loop.
      for (const id of ids) {
        const entry = watched.get(id);
        if (entry) backOff(id, entry);
      }
      return;
    }
    const byId = new Map(statuses.map(({ id, status }) => [id, status]));
    await Promise.all(
      ids.map(async (id) => {
        const entry = watched.get(id);
        if (!entry) return;
        const status = byId.get(id);
        if (status === undefined) return forget(id, entry);
        if (status === "pending") return backOff(id, entry);
        try {
          const row = await fetchRow(id);
          forget(id, entry);
          entry.onRow(row);
        } catch {
          backOff(id, entry);
        }
      }),
    );
  }

  async function run() {
    timer = undefined;
    if (running || !canPoll()) return;
    running = true;
    try {
      const horizon = now() + BATCH_WINDOW_MS;
      const due = [...watched].filter(([, { dueAt }]) => dueAt <= horizon).map(([id]) => id);
      for (let start = 0; start < due.length; start += MAX_STATUS_IDS) {
        await read(due.slice(start, start + MAX_STATUS_IDS));
      }
    } finally {
      running = false;
      schedule();
    }
  }

  return {
    /**
     * Watches a pending row until its status changes, it is gone, or the returned function is
     * called. The first read is due at once, so rows that start watching together share it.
     */
    watch(id: string, source: ClippingSource, onRow: (row: ClippingRowData) => void) {
      const entry: Watched = { source, onRow, dueAt: now() };
      watched.set(id, entry);
      schedule();
      return () => {
        if (watched.get(id) === entry) watched.delete(id);
        if (watched.size === 0) schedule();
      };
    },
    /** Looks again at what is due, after the tab shows or the connection returns. */
    wake: schedule,
  };
}

export type PendingPoller = ReturnType<typeof createPendingPoller>;
