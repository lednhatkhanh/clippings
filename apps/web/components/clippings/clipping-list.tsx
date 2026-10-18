"use client";

import { useState } from "react";
import { GridList, GridListItem, GridListLoadMoreItem } from "react-aria-components";
import useSWR from "swr";

import { loadMoreClippingsAction, retryEnrichmentAction } from "@/app/(app)/actions.ts";
import type { ClippingRowData } from "@/lib/clippings/rows.ts";
import { Button, ProgressBar } from "@clippings/ui";

import { useHiddenClippings } from "./deleted-clippings.tsx";
import { Favicon } from "./favicon.tsx";
import { fetchRow, POLL_EVERY_MS } from "./fetch-row.ts";

function ClippingRow({ row: initialRow }: { row: ClippingRowData }) {
  const [row, setRow] = useState(initialRow);
  const [retrying, setRetrying] = useState(false);

  // A pending row asks for itself until enrichment has finished, then shows the result in place.
  useSWR(row.status === "pending" ? `/api/clippings/${row.id}` : null, fetchRow, {
    refreshInterval: POLL_EVERY_MS,
    onSuccess: setRow,
  });

  async function retry() {
    setRetrying(true);
    try {
      const restarted = await retryEnrichmentAction(row.id);
      if (restarted) setRow(restarted);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <GridListItem
      id={row.id}
      textValue={row.title}
      href={`/c/${row.id}`}
      className="@container state-layer block rounded-sm border-b border-outline-variant px-2 data-focus-visible:outline-solid"
    >
      <div className="flex items-start gap-3 py-row-block @lg:items-center">
        <Favicon url={row.url} />
        <div className="flex min-w-0 flex-1 flex-col gap-row-gap">
          <span className="truncate typescale-clipping-title">{row.title}</span>
          <span className="flex flex-wrap gap-x-2 typescale-label-sm font-mono text-on-surface-variant">
            <span>{row.domain}</span>
            <time dateTime={row.dateTime}>{row.dateLabel}</time>
          </span>
          {row.status === "pending" ? (
            <div className="flex flex-col gap-1 pt-1 @lg:max-w-xs">
              <span aria-hidden="true" className="typescale-label-sm text-on-surface-variant">
                Reading the page…
              </span>
              <ProgressBar label="Reading the page" />
            </div>
          ) : null}
          {row.status === "failed" ? (
            <div className="flex flex-wrap items-center gap-x-3 typescale-body-sm text-on-surface-variant">
              <span>Couldn&apos;t read this page. Your link and note are saved.</span>
              <Button variant="text" onPress={retry} isPending={retrying}>
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </GridListItem>
  );
}

/**
 * Newest first. The first page comes from the server; later pages load as the last row scrolls
 * into view. Remount it (change its `key`) when the first page changes.
 */
export function ClippingList({
  initialRows,
  initialCursor,
}: {
  initialRows: ClippingRowData[];
  initialCursor: string | null;
}) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const hidden = useHiddenClippings();

  async function loadMore() {
    if (!cursor || isLoading) return;
    setIsLoading(true);
    setFailed(false);
    try {
      const page = await loadMoreClippingsAction(cursor);
      setRows((current) => [...current, ...page.rows]);
      setCursor(page.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <GridList aria-label="Your clippings" className="flex flex-col">
        {rows
          .filter((row) => !hidden.has(row.id))
          .map((row) => (
            <ClippingRow key={row.id} row={row} />
          ))}
        {cursor && !failed ? (
          <GridListLoadMoreItem onLoadMore={loadMore} isLoading={isLoading} />
        ) : null}
      </GridList>
      {failed ? (
        <div role="alert" className="flex items-center gap-3 py-3 typescale-body-md text-error">
          <span>Couldn&apos;t load more clippings.</span>
          <Button variant="text" onPress={loadMore}>
            Retry
          </Button>
        </div>
      ) : null}
    </>
  );
}
