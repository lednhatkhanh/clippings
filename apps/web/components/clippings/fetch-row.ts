import type { ClippingRowData, RowsPage } from "@/lib/clippings/rows.ts";

/** How often a pending clipping asks whether enrichment has finished. */
export const POLL_EVERY_MS = 2000;

/** One clipping as a list row, from `/api/clippings/[id]`, for SWR. */
export async function fetchRow(url: string): Promise<ClippingRowData> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't load the clipping (${response.status})`);
  return response.json();
}

/** The first page of what the list shows, from `/api/clippings?…`, for SWR. */
export async function fetchRows(url: string): Promise<RowsPage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't load clippings (${response.status})`);
  return response.json();
}
