import { constructNow } from "date-fns";

import { formatClippingDate } from "@/lib/format-date.ts";
import type {
  Clipping,
  ClippingSource,
  ClippingStatus,
  SearchHighlights,
  Tag,
} from "@clippings/shared";

import type { BrowseParams } from "./browse-params.ts";
import { getClippings } from "./service.ts";

/** What one row of the list needs, with dates already worded so rows render the same anywhere. */
export interface ClippingRowData {
  id: string;
  url: string;
  title: string;
  domain: string;
  /** "2 days ago" or "3 Oct". */
  dateLabel: string;
  /** ISO 8601, for the `<time>` element. */
  dateTime: string;
  status: ClippingStatus;
  /** Where it was saved from: an imported one stays pending for hours, so its poll is slower. */
  source: ClippingSource;
  /** The page's summary once it has been read, shown under the title when there's no snippet. */
  summary: string | null;
  tags: Tag[];
  /** Whether it is pinned above the newest-first list. */
  pinned: boolean;
  /** Where it matched, when the row is a search result. */
  highlights?: SearchHighlights;
}

export interface RowsPage {
  /**
   * The pinned clippings that match the list's filters, shown above `rows`: on the first page
   * only, and never for search results, which ignore pins.
   */
  pinned: ClippingRowData[];
  rows: ClippingRowData[];
  nextCursor: string | null;
}

/** The host a reader recognizes: "example.com" for "https://www.example.com/a". */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function toRow(
  clipping: Clipping,
  now: Date,
  highlights?: SearchHighlights,
): ClippingRowData {
  return {
    ...(highlights ? { highlights } : {}),
    id: clipping.id,
    url: clipping.url,
    title: clipping.title,
    domain: domainOf(clipping.url),
    dateLabel: formatClippingDate(clipping.createdAt, now),
    dateTime: clipping.createdAt,
    status: clipping.status,
    source: clipping.source,
    summary: clipping.summary,
    tags: clipping.tags,
    pinned: clipping.pinned,
  };
}

/**
 * What the list shows for these params, worded as of now: search results when there is a query
 * (one page, no cursor), else one page of the user's clippings, newest first, with the pinned
 * ones that match the filters above them on the first page. `signal` cancels a search: the
 * request that asked has gone away.
 */
export async function loadRows(
  userId: string,
  { q, tags, sources, sort }: BrowseParams,
  cursor?: string,
  signal?: AbortSignal,
): Promise<RowsPage> {
  const now = constructNow(undefined);
  if (q.trim()) {
    const { items } = await getClippings().searchClippings(userId, {
      q,
      tags,
      sources,
      sort,
      signal,
    });
    return {
      pinned: [],
      rows: items.map((hit) => toRow(hit.clipping, now, hit.highlights)),
      nextCursor: null,
    };
  }
  const page = await getClippings().listClippings(userId, { cursor, tags, sources });
  return {
    pinned: page.pinned.map((clipping) => toRow(clipping, now)),
    rows: page.items.map((clipping) => toRow(clipping, now)),
    nextCursor: page.nextCursor,
  };
}

/**
 * One of the user's clippings as a list row, or null when they have no such clipping. A pending
 * row polls this every few seconds, and a row shows no tag suggestions, so they aren't read.
 */
export async function loadRow(userId: string, clippingId: string): Promise<ClippingRowData | null> {
  const clipping = await getClippings().getClipping(userId, clippingId, { suggestions: false });
  return clipping ? toRow(clipping, constructNow(undefined)) : null;
}
