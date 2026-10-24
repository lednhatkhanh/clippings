import type { ClippingRowData, RowsPage } from "@/lib/clippings/rows.ts";
import type { ClippingStatuses } from "@clippings/shared";

/** One clipping as a list row, from `/api/clippings/[id]`, for SWR. */
export async function fetchRow(url: string): Promise<ClippingRowData> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't load the clipping (${response.status})`);
  return response.json();
}

/** Where each of these clippings is in enrichment, from `/api/clippings/status`. */
export async function fetchStatuses(ids: string[]): Promise<ClippingStatuses["statuses"]> {
  const response = await fetch(`/api/clippings/status?ids=${ids.join(",")}`);
  if (!response.ok) throw new Error(`Couldn't load the statuses (${response.status})`);
  return ((await response.json()) as ClippingStatuses).statuses;
}

/** The first page of what the list shows, from `/api/clippings?…`, for SWR. */
export async function fetchRows(url: string, signal?: AbortSignal): Promise<RowsPage> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Couldn't load clippings (${response.status})`);
  return response.json();
}
