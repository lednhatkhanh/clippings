import { useEffect } from "react";

import type { ClippingRowData } from "@/lib/clippings/rows.ts";
import type { ClippingSource } from "@clippings/shared";

import { fetchRow, fetchStatuses } from "./fetch-row.ts";
import { createPendingPoller, type PendingPoller } from "./pending-poller.ts";

let poller: PendingPoller | undefined;

/** The one poller every pending row in the list shares, made when the first row needs it. */
function sharedPoller(): PendingPoller {
  if (poller) return poller;
  poller = createPendingPoller({
    fetchStatuses,
    fetchRow: (id) => fetchRow(`/api/clippings/${id}`),
    now: () => performance.now(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    // Like SWR's refresh: nothing is asked of a hidden tab or while offline.
    canPoll: () => document.visibilityState === "visible" && navigator.onLine,
  });
  document.addEventListener("visibilitychange", poller.wake);
  window.addEventListener("online", poller.wake);
  return poller;
}

/**
 * Watches a pending list row while `active`, and passes the row to `onRow` once enrichment has
 * finished. All the rows watching at once share one status request per round, and wait longer
 * after each answer (`pending-poller.ts`). Inactive, it asks nothing.
 */
export function useListPoll(
  clippingId: string,
  source: ClippingSource,
  active: boolean,
  onRow: (row: ClippingRowData) => void,
) {
  useEffect(() => {
    if (!active) return;
    return sharedPoller().watch(clippingId, source, onRow);
  }, [clippingId, source, active, onRow]);
}
