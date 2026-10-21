/**
 * The ids in `next` that `previous` did not have: clippings saved while the same list was on
 * screen, which drop in when the list refreshes. A different list (another search or filter) has
 * no new rows, only different ones, so callers pass the previous rows only for the same list.
 */
export function newRowIds(
  previous: readonly { id: string }[],
  next: readonly { id: string }[],
): ReadonlySet<string> {
  const had = new Set(previous.map((row) => row.id));
  return new Set(next.filter((row) => !had.has(row.id)).map((row) => row.id));
}
