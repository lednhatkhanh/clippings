interface Groups<Row> {
  pinned: Row[];
  rows: Row[];
}

/**
 * The groups after the server renders the list's first page again (a save, a pin or a delete
 * elsewhere refreshed it), without dropping the later pages already loaded.
 *
 * Until a later page has loaded, the new first page is all there is. After that, the new first
 * page leads and the rows loaded before follow, minus those it already shows: a row pushed off
 * the first page by a new save keeps its place, so no gap opens before the next page's cursor.
 * A row deleted in this tab stays hidden by the list's presence, not here.
 */
export function refreshFirstPage<Row extends { id: string }>(
  current: Groups<Row>,
  next: Groups<Row>,
  hasLoadedMore: boolean,
): Groups<Row> {
  if (!hasLoadedMore) return next;
  const shown = new Set([...next.pinned, ...next.rows].map((row) => row.id));
  return {
    pinned: next.pinned,
    rows: [...next.rows, ...current.rows.filter((row) => !shown.has(row.id))],
  };
}
