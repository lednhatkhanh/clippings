import { constructNow } from "date-fns";

import { formatClippingDate } from "@/lib/format-date.ts";
import type { Clipping, ClippingStatus } from "@clippings/shared";

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

export function toRow(clipping: Clipping, now: Date): ClippingRowData {
  return {
    id: clipping.id,
    url: clipping.url,
    title: clipping.title,
    domain: domainOf(clipping.url),
    dateLabel: formatClippingDate(clipping.createdAt, now),
    dateTime: clipping.createdAt,
    status: clipping.status,
  };
}

/** One page of a user's clippings as list rows, worded as of now. */
export async function loadRows(userId: string, cursor?: string): Promise<RowsPage> {
  const page = await getClippings().listClippings(userId, { cursor });
  const now = constructNow(undefined);
  return { rows: page.items.map((clipping) => toRow(clipping, now)), nextCursor: page.nextCursor };
}

/** One of the user's clippings as a list row, or null when they have no such clipping. */
export async function loadRow(userId: string, clippingId: string): Promise<ClippingRowData | null> {
  const clipping = await getClippings().getClipping(userId, clippingId);
  return clipping ? toRow(clipping, constructNow(undefined)) : null;
}
