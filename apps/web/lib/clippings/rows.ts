import type { Clipping } from "@clippings/shared";

import { formatClippingDate } from "../format-date";
import { getClippings } from "./service";

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
  pending: boolean;
}

export interface RowsPage {
  rows: ClippingRowData[];
  nextCursor: string | null;
}

function domainOf(url: string): string {
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
    pending: clipping.status === "pending",
  };
}

/** One page of a user's clippings as list rows, worded as of now. */
export async function loadRows(userId: string, cursor?: string): Promise<RowsPage> {
  const page = await getClippings().listClippings(userId, { cursor });
  const now = new Date();
  return { rows: page.items.map((clipping) => toRow(clipping, now)), nextCursor: page.nextCursor };
}
