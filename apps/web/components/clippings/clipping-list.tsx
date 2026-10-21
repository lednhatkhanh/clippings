"use client";

import { useState } from "react";
import { GridList, GridListItem, GridListLoadMoreItem } from "react-aria-components";
import useSWR from "swr";

import { loadMoreClippingsAction, retryEnrichmentAction } from "@/app/(app)/actions.ts";
import { useOnline } from "@/components/online-status.tsx";
import { SheetTransition } from "@/components/page-transition.tsx";
import { hrefWithTag, loadBrowseParams } from "@/lib/clippings/browse-params.ts";
import type { ClippingRowData } from "@/lib/clippings/rows.ts";
import { Button, ProgressBar, TagChips } from "@clippings/ui";

import { useRowPresence, type RowPresence } from "./deleted-clippings.tsx";
import { Favicon } from "./favicon.tsx";
import { fetchRow, POLL_EVERY_MS } from "./fetch-row.ts";
import { HighlightedText } from "./highlighted-text.tsx";
import { StatusMotion } from "./status-motion.tsx";

/** Whether every animation on an element has finished: a row settles on its last one. */
const hasSettled = (element: Element) =>
  element.getAnimations().every((animation) => animation.playState === "finished");

function ClippingRow({
  row: initialRow,
  tagHref,
  presence,
  isNew,
  onSettle,
}: {
  row: ClippingRowData;
  /** Where a tag chip leads: this list, narrowed to the tag. */
  tagHref: (tag: string) => string;
  /** Set while a deleted row leaves or an undone one returns. */
  presence: Exclude<RowPresence, "gone"> | undefined;
  /** Saved while this list was on screen: it drops in once. */
  isNew: boolean;
  /** Its leaving or returning motion has finished. */
  onSettle: () => void;
}) {
  const [row, setRow] = useState(initialRow);
  const [retrying, setRetrying] = useState(false);
  const [entering, setEntering] = useState(isNew);
  const online = useOnline();

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
      className="group @container mb-2.5 row-presence rounded-lg"
      // CSS animates a row that is deleted, undone or new (`app/list-motion.css` says why not a
      // view transition), and the list drops the row once its last animation ends.
      data-presence={presence ?? (entering ? "entering" : undefined)}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget || !hasSettled(event.currentTarget)) return;
        if (presence) onSettle();
        else setEntering(false);
      }}
    >
      {/* The row's paper morphs into the detail page's sheet, and back. */}
      <SheetTransition clippingId={row.id} direction="back">
        <StatusMotion
          status={row.status}
          className="relative flex lift items-start gap-3.5 rounded-lg paper px-4 py-row-block"
        >
          <Favicon url={row.url} />
          <div className="flex min-w-0 flex-1 status-content flex-col gap-row-gap">
            <span className="truncate typescale-clipping-title">
              {row.highlights ? <HighlightedText segments={row.highlights.title} /> : row.title}
            </span>
            <span className="flex flex-wrap items-center gap-x-1.5 typescale-label-sm font-mono text-ink-faint">
              <span>{row.domain}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={row.dateTime}>{row.dateLabel}</time>
            </span>
            {row.highlights?.snippet ? (
              <span className="line-clamp-2 typescale-body-md text-ink-muted">
                <HighlightedText segments={row.highlights.snippet} />
              </span>
            ) : row.summary ? (
              <span className="line-clamp-2 typescale-body-md text-ink-muted">{row.summary}</span>
            ) : null}
            <TagChips aria-label="Tags" tags={row.tags} href={tagHref} className="mt-1" />
            {row.status === "pending" ? (
              <div className="flex flex-col gap-1.5 pt-1 @lg:max-w-xs">
                <span aria-hidden="true" className="typescale-label-sm text-ink-faint">
                  Reading the page…
                </span>
                <ProgressBar label="Reading the page" />
              </div>
            ) : null}
            {row.status === "failed" ? (
              <div className="flex flex-wrap items-center gap-x-3 typescale-body-sm text-ink-muted">
                <span>Couldn&apos;t read this page. Your link and note are saved.</span>
                <Button variant="text" onPress={retry} isPending={retrying} isDisabled={!online}>
                  Retry
                </Button>
              </div>
            ) : null}
          </div>
          {/* A quiet hint on the keyboard-focused row only; touch has no keyboard. */}
          <span
            aria-hidden="true"
            className="absolute end-4 bottom-3 hidden items-center gap-1.5 rounded-xs bg-paper ps-1 typescale-label-sm text-ink-faint group-data-focus-visible:pointer-fine:inline-flex"
          >
            <kbd className="inline-flex h-5.5 items-center rounded-sm bg-ground-sunk px-1.5 font-mono text-ink-muted">
              ↵
            </kbd>
            Open
          </span>
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
  newIds,
}: {
  query: string;
  initialRows: ClippingRowData[];
  initialCursor: string | null;
  /** Rows saved while this list was on screen, which drop in. */
  newIds: ReadonlySet<string>;
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
                isNew={newIds.has(row.id)}
                onSettle={() => settle(row.id)}
              />
            );
          })}
        {cursor && !failed ? (
          <GridListLoadMoreItem onLoadMore={loadMore} isLoading={isLoading} />
        ) : null}
      </GridList>
      {failed ? (
        <div role="alert" className="flex items-center gap-3 py-3 typescale-body-md text-danger">
          <span>Couldn&apos;t load more clippings.</span>
          <Button variant="text" onPress={loadMore}>
            Retry
          </Button>
        </div>
      ) : null}
    </>
  );
}
