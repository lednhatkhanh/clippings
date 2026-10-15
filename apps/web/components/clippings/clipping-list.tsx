"use client";

import { useState } from "react";
import { GridList, GridListItem, GridListLoadMoreItem } from "react-aria-components";

import { Button } from "@clippings/ui";

import { loadMoreClippingsAction } from "../../app/(app)/actions";
import type { ClippingRowData } from "../../lib/clippings/rows";
import { Favicon } from "./favicon";

function ClippingRow({ row }: { row: ClippingRowData }) {
  return (
    <GridListItem
      id={row.id}
      textValue={row.title}
      // The detail page arrives with its own slice; until then a row opens the original page.
      href={row.url}
      target="_blank"
      rel="noopener noreferrer"
      className="@container state-layer block rounded-sm border-b border-outline-variant px-2 data-focus-visible:outline-solid"
    >
      <div className="flex items-start gap-3 py-3 @lg:items-center">
        <Favicon url={row.url} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate typescale-clipping-title">{row.title}</span>
          <span className="flex flex-wrap gap-x-2 typescale-label-sm font-mono text-on-surface-variant">
            <span>{row.domain}</span>
            <time dateTime={row.dateTime}>{row.dateLabel}</time>
            {row.pending ? <span>Reading the page…</span> : null}
          </span>
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
        {rows.map((row) => (
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
