"use client";

import { Copy, Ellipsis, Pin, PinOff, Share2 } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Button as AriaButton,
  GridList,
  GridListItem,
  GridListLoadMoreItem,
} from "react-aria-components";

import {
  loadMoreClippingsAction,
  reEnrichClippingAction,
  setPinnedAction,
} from "@/app/(app)/actions.ts";
import { useOnline } from "@/components/online-status.tsx";
import { SheetTransition } from "@/components/page-transition.tsx";
import { hrefWithTag, loadBrowseParams } from "@/lib/clippings/browse-params.ts";
import { appendPage, applyPin, type ListGroups } from "@/lib/clippings/pins.ts";
import type { ClippingRowData } from "@/lib/clippings/rows.ts";
import { Button, Menu, MenuItem, MenuTrigger, ProgressBar, TagChips, toasts } from "@clippings/ui";

import { useRowPresence, type RowPresence } from "./deleted-clippings.tsx";
import { Favicon } from "./favicon.tsx";
import { HighlightedText } from "./highlighted-text.tsx";
import { copyLinkWithToast, shareLinkWithToast, useCanShare } from "./link-actions.ts";
import { refreshFirstPage } from "./refresh-first-page.ts";
import { StatusMotion } from "./status-motion.tsx";
import { useListPoll } from "./use-list-poll.ts";
import { useOnScreen } from "./use-on-screen.ts";

/** Whether every animation on an element has finished: a row settles on its last one. */
const hasSettled = (element: Element) =>
  element.getAnimations().every((animation) => animation.playState === "finished");

function ClippingRow({
  row: initialRow,
  pinned,
  onTogglePin,
  tagHref,
  presence,
  isNew,
  onSettle,
}: {
  row: ClippingRowData;
  /** Whether the list has it pinned: the list moves it between groups, so it decides. */
  pinned: boolean;
  onTogglePin: () => void;
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
  // The list keeps its rows mounted across a server refresh, so a row the server sends again
  // (renamed, retagged, read while off screen) replaces what this row last polled.
  const [lastInitialRow, setLastInitialRow] = useState(initialRow);
  if (initialRow !== lastInitialRow) {
    setLastInitialRow(initialRow);
    setRow(initialRow);
  }
  const [retrying, setRetrying] = useState(false);
  const [entering, setEntering] = useState(isNew);
  const online = useOnline();
  const canShare = useCanShare();
  const router = useRouter();
  // State, not a ref object: React Aria renders the item's element after this component commits.
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const href = `/c/${row.id}`;

  // A pending row asks for itself until enrichment has finished, then shows the result in place.
  // Only while on screen, and ever more slowly (`poll-schedule.ts`): an imported backlog stays
  // pending for hours. The rows asking at once share one status request (`pending-poller.ts`).
  const pending = row.status === "pending";
  const onScreen = useOnScreen(element, pending);
  useListPoll(row.id, row.source, pending && onScreen, setRow);

  // The row can't be a link (it's a grid list item), so it warms the detail page itself. Under
  // partial prefetching the shell is shared by every `/c/<id>`, so this is cheap after the first.
  const prefetch = () => router.prefetch(href as Route);
  // A grid list item has no focus prop, so keyboard focus (arrow keys) is listened for here.
  useEffect(() => {
    const onFocusIn = () => router.prefetch(href as Route);
    element?.addEventListener("focusin", onFocusIn);
    return () => element?.removeEventListener("focusin", onFocusIn);
  }, [element, router, href]);

  async function retry() {
    setRetrying(true);
    try {
      const restarted = await reEnrichClippingAction(row.id);
      if (restarted) setRow(restarted);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <GridListItem
      ref={setElement}
      id={row.id}
      textValue={row.title}
      href={href}
      onHoverStart={prefetch}
      onPressStart={prefetch}
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
            <span className="flex min-w-0 items-center gap-1.5">
              {pinned ? (
                <>
                  <Pin aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
                  <span className="sr-only">Pinned:&nbsp;</span>
                </>
              ) : null}
              <span className="truncate typescale-clipping-title">
                {row.highlights ? <HighlightedText segments={row.highlights.title} /> : row.title}
              </span>
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
          <MenuTrigger>
            <AriaButton
              aria-label={`Actions for ${row.title}`}
              className="state-layer -me-2 -mt-2.5 flex size-11 shrink-0 cursor-default items-center justify-center rounded-md text-ink-muted"
            >
              <Ellipsis className="size-5" />
            </AriaButton>
            <Menu aria-label={`Actions for ${row.title}`}>
              <MenuItem icon={pinned ? PinOff : Pin} isDisabled={!online} onAction={onTogglePin}>
                {pinned ? "Unpin" : "Pin"}
              </MenuItem>
              {canShare ? (
                <MenuItem
                  icon={Share2}
                  onAction={() => void shareLinkWithToast({ title: row.title, url: row.url })}
                >
                  Share
                </MenuItem>
              ) : null}
              <MenuItem icon={Copy} onAction={() => void copyLinkWithToast(row.url)}>
                Copy link
              </MenuItem>
            </Menu>
          </MenuTrigger>
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
 * The rows the list shows. The first page is given, with the pinned group above it; later pages
 * of the list `query` describes (a `toQueryString` result) load as the last row scrolls into
 * view. Pinned rows are the first rows of the same list, so the arrow keys run through them.
 * Pinning moves a row between the groups at once. Remount it (change its `key`) when `query`
 * changes; a new first page for the same query (a save or delete refreshed it) merges in, and the
 * pages already loaded stay.
 */
export function ClippingList({
  query,
  initialPinned,
  initialRows,
  initialCursor,
  newIds,
}: {
  query: string;
  initialPinned: ClippingRowData[];
  initialRows: ClippingRowData[];
  initialCursor: string | null;
  /** Rows saved while this list was on screen, which drop in. */
  newIds: ReadonlySet<string>;
}) {
  const [groups, setGroups] = useState<ListGroups<ClippingRowData>>({
    pinned: initialPinned,
    rows: initialRows,
  });
  const [cursor, setCursor] = useState(initialCursor);
  const [loadedMore, setLoadedMore] = useState(false);
  const [firstPage, setFirstPage] = useState({ pinned: initialPinned, rows: initialRows });
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const { presence, settle } = useRowPresence();
  const router = useRouter();

  if (firstPage.pinned !== initialPinned || firstPage.rows !== initialRows) {
    const next = { pinned: initialPinned, rows: initialRows };
    setFirstPage(next);
    setGroups((current) => refreshFirstPage(current, next, loadedMore));
    if (!loadedMore) setCursor(initialCursor);
  }

  // The first row is the likeliest one to open, and under partial prefetching warming it warms
  // the detail page's shell for every row. The others prefetch when the pointer or focus reaches
  // them.
  const firstId = (groups.pinned[0] ?? groups.rows[0])?.id;
  useEffect(() => {
    if (firstId) router.prefetch(`/c/${firstId}` as Route);
  }, [firstId, router]);

  const params = loadBrowseParams(query);
  const tagHref = (tag: string) => hrefWithTag(params, tag);
  // Search results ignore pins: a pinned result stays where it ranks.
  const groupPins = params.q.trim() === "";

  async function togglePin(clippingId: string, pinned: boolean) {
    const options = { groupPins, hasMore: cursor !== null };
    setGroups((current) => applyPin(current, clippingId, pinned, options));
    const done = await setPinnedAction(clippingId, pinned).catch(() => false);
    if (done) return;
    setGroups((current) => applyPin(current, clippingId, !pinned, options));
    toasts.show({
      message: pinned ? "Couldn't pin the clipping." : "Couldn't unpin the clipping.",
    });
  }

  async function loadMore() {
    if (!cursor || isLoading) return;
    setIsLoading(true);
    setFailed(false);
    try {
      const page = await loadMoreClippingsAction(query, cursor);
      setGroups((current) => appendPage(current, page.rows));
      setCursor(page.nextCursor);
      setLoadedMore(true);
    } catch {
      setFailed(true);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <GridList aria-label="Your clippings" className="flex flex-col">
        {[...groups.pinned, ...groups.rows]
          .filter((row) => presence.get(row.id) !== "gone")
          .map((row) => {
            const rowPresence = presence.get(row.id);
            return (
              <ClippingRow
                key={row.id}
                row={row}
                pinned={row.pinned}
                onTogglePin={() => void togglePin(row.id, !row.pinned)}
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
