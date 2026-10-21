"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";

import { reEnrichClippingAction } from "@/app/(app)/actions.ts";
import { useOnline } from "@/components/online-status.tsx";
import type { ClippingStatus } from "@clippings/shared";
import { Button, ProgressBar } from "@clippings/ui";

import { fetchRow, POLL_EVERY_MS } from "./fetch-row.ts";

/**
 * Stands in for the summary until the page has been read. A pending clipping polls, and the page
 * re-renders once enrichment finishes; a failed one offers Retry.
 */
export function EnrichmentStatus({
  clippingId,
  status,
}: {
  clippingId: string;
  status: Exclude<ClippingStatus, "ready">;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const online = useOnline();

  useSWR(status === "pending" ? `/api/clippings/${clippingId}` : null, fetchRow, {
    refreshInterval: POLL_EVERY_MS,
    onSuccess: (row) => {
      if (row.status !== "pending") router.refresh();
    },
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
          Reading the page…
        </span>
        <ProgressBar label="Reading the page" />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 typescale-body-md text-ink-muted">
      <span>Couldn&apos;t read this page. Your link and note are saved.</span>
      <Button variant="text" onPress={retry} isPending={retrying} isDisabled={!online}>
        Retry
      </Button>
    </div>
  );
}
