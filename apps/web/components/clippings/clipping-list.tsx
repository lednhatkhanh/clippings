"use client";

import { useState } from "react";
import { GridList, GridListItem, GridListLoadMoreItem } from "react-aria-components";
import useSWR from "swr";

import { loadMoreClippingsAction, retryEnrichmentAction } from "@/app/(app)/actions.ts";
import { SheetTransition } from "@/components/page-transition.tsx";
import { hrefWithTag, loadBrowseParams } from "@/lib/clippings/browse-params.ts";
import type { ClippingRowData } from "@/lib/clippings/rows.ts";
import { Button, ProgressBar, TagChips } from "@clippings/ui";

import { useRowPresence, type RowPresence } from "./deleted-clippings.tsx";
import { Favicon } from "./favicon.tsx";
import { fetchRow, POLL_EVERY_MS } from "./fetch-row.ts";
import { HighlightedText } from "./highlighted-text.tsx";
import { StatusMotion } from "./status-motion.tsx";

/** The last animation of a row's leaving and returning motion (`app/list-motion.css`). */
const ROW_SETTLED_BY = new Set(["row-collapse", "row-fade-in"]);

function ClippingRow({
  row: initialRow,
  tagHref,
  presence,
  onSettle,
}: {
  row: ClippingRowData;
  /** Where a tag chip leads: this list, narrowed to the tag. */
  tagHref: (tag: string) => string;
  /** Set while a deleted row leaves or an undone one returns. */
  presence: Exclude<RowPresence, "gone"> | undefined;
  /** Its leaving or returning motion has finished. */
  onSettle: () => void;
}) {
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
      className="@container state-layer grid row-presence rounded-sm border-b border-outline-variant px-2 data-focus-visible:outline-solid"
      // CSS animates a deleted or undone row (`app/list-motion.css` says why not a view
      // transition), and the list drops the row once its last animation ends.
      data-presence={presence}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && ROW_SETTLED_BY.has(event.animationName)) {
          onSettle();
        }
      }}
    >
      {/* The row's sheet morphs into the detail page's, and back. */}
      <SheetTransition clippingId={row.id} direction="back">
        <StatusMotion
          status={row.status}
          className="flex items-start gap-3 py-row-block @lg:items-center"
        >
          <Favicon url={row.url} />
          <div className="flex min-w-0 flex-1 status-content flex-col gap-row-gap">
            <span className="truncate typescale-clipping-title">
              {row.highlights ? <HighlightedText segments={row.highlights.title} /> : row.title}
            </span>
            <span className="flex flex-wrap gap-x-2 typescale-label-sm font-mono text-on-surface-variant">
              <span>{row.domain}</span>
              <time dateTime={row.dateTime}>{row.dateLabel}</time>
            </span>
            <TagChips aria-label="Tags" tags={row.tags} href={tagHref} className="mt-1" />
            {row.highlights?.snippet ? (
              <span className="line-clamp-2 typescale-body-md text-on-surface-variant">
                <HighlightedText segments={row.highlights.snippet} />
              </span>
            ) : null}
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
        </StatusMotion>
      </SheetTransition>
    </GridListItem>
  );
}

/**
 * The rows the list shows. The first page is given; later pages of the list `query` describes
 * (a `toQueryString` result) load as the last row scrolls into view. Remount it (change its
 * `key`) when the first page changes.
 */
export function ClippingList({
  query,
  initialRows,
  initialCursor,
}: {
  query: string;
  initialRows: ClippingRowData[];
  initialCursor: string | null;
}) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const { presence, settle } = useRowPresence();
  const params = loadBrowseParams(query);
  const tagHref = (tag: string) => hrefWithTag(params, tag);

  async function loadMore() {
    if (!cursor || isLoading) return;
    setIsLoading(true);
    setFailed(false);
    try {
      const page = await loadMoreClippingsAction(query, cursor);
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
          .filter((row) => presence.get(row.id) !== "gone")
          .map((row) => {
            const rowPresence = presence.get(row.id);
            return (
              <ClippingRow
                key={row.id}
                row={row}
                tagHref={tagHref}
                presence={rowPresence === "gone" ? undefined : rowPresence}
                onSettle={() => settle(row.id)}
              />
            );
          })}
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
