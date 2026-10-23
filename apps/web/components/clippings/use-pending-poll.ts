import { useRef } from "react";
import useSWR from "swr";

import type { ClippingRowData } from "@/lib/clippings/rows.ts";

import { fetchRow } from "./fetch-row.ts";
import { pollDelay } from "./poll-schedule.ts";

/**
 * Asks for a clipping again while `active`, waiting longer after each answer
 * (`poll-schedule.ts`), and passes each row to `onRow`. Inactive, it asks nothing; the next
 * ask after it turns active is immediate, and the waits carry on from where they were.
 */
export function usePendingPoll(
  clippingId: string,
  active: boolean,
  onRow: (row: ClippingRowData) => void,
) {
  const answers = useRef(0);

  useSWR(active ? `/api/clippings/${clippingId}` : null, fetchRow, {
    // The first answer arrives before the first wait, so the waits start from one less.
    refreshInterval: () => pollDelay(answers.current - 1),
    onSuccess: (row) => {
      answers.current += 1;
      onRow(row);
    },
  });
}
