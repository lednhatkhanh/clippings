"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { reEnrichClippingAction } from "@/app/(app)/actions.ts";
import { useOnline } from "@/components/online-status.tsx";
import type { ClippingKind, ClippingStatus } from "@clippings/shared";
import { Button, ProgressBar } from "@clippings/ui";

import { usePendingPoll } from "./use-pending-poll.ts";

/**
 * Stands in for the summary until the page has been read. A pending clipping polls, backing off, and the page
 * re-renders once enrichment finishes; a failed one offers Retry.
 */
export function EnrichmentStatus({
  clippingId,
  kind,
  status,
}: {
  clippingId: string;
  kind: ClippingKind;
  status: Exclude<ClippingStatus, "ready">;
}) {
  const what = kind === "note" ? "note" : "page";
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const online = useOnline();

  // The reader is looking at it, so it asks while pending; the waits grow (`poll-schedule.ts`).
  usePendingPoll(clippingId, status === "pending", (row) => {
    if (row.status !== "pending") router.refresh();
  });

  async function retry() {
    setRetrying(true);
    try {
      await reEnrichClippingAction(clippingId);
      router.refresh();
    } finally {
      setRetrying(false);
    }
  }

  if (status === "pending") {
    return (
      <div className="flex flex-col gap-2">
        <span aria-hidden="true" className="typescale-body-md text-ink-faint">
          Reading the {what}…
        </span>
        <ProgressBar label={`Reading the ${what}`} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 typescale-body-md text-ink-muted">
      <span>
        {kind === "note"
          ? "Couldn't read this note. Your text is saved."
          : "Couldn't read this page. Your link and note are saved."}
      </span>
      <Button variant="text" onPress={retry} isPending={retrying} isDisabled={!online}>
        Retry
      </Button>
    </div>
  );
}
