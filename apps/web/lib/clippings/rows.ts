import { constructNow } from "date-fns";

import { formatClippingDate } from "@/lib/format-date.ts";
import type { Clipping, ClippingStatus, SearchHighlights } from "@clippings/shared";

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
  /** Where it matched, when the row is a search result. */
  highlights?: SearchHighlights;
}

export interface RowsPage {
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
  };
}

/**
 * What the list shows for these params, worded as of now: search results when there is a query
 * (one page, no cursor), else one page of the user's clippings, newest first.
 */
export async function loadRows(
  userId: string,
  { q, sources, sort }: BrowseParams,
  cursor?: string,
): Promise<RowsPage> {
  const now = constructNow(undefined);
  if (q.trim()) {
    const { items } = await getClippings().searchClippings(userId, { q, sources, sort });
    return {
      rows: items.map((hit) => toRow(hit.clipping, now, hit.highlights)),
      nextCursor: null,
    };
  }
  const page = await getClippings().listClippings(userId, { cursor, sources });
  return { rows: page.items.map((clipping) => toRow(clipping, now)), nextCursor: page.nextCursor };
}

/** One of the user's clippings as a list row, or null when they have no such clipping. */
export async function loadRow(userId: string, clippingId: string): Promise<ClippingRowData | null> {
  const clipping = await getClippings().getClipping(userId, clippingId);
  return clipping ? toRow(clipping, constructNow(undefined)) : null;
}
