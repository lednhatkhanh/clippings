/** The least a row needs for the list to place it. */
interface PinnableRow {
  id: string;
  /** ISO 8601 save date: the newest-first list orders by it. */
  dateTime: string;
  pinned: boolean;
}

/** What the list holds: the pinned group above the newest-first rows. */
export interface ListGroups<Row extends PinnableRow> {
  pinned: Row[];
  rows: Row[];
}

/**
 * The groups after pinning or unpinning one row, so the list answers before the server does.
 *
 * With `groupPins` (the plain list) a pinned row leaves `rows` for the top of the pinned group,
 * most recently pinned first, and an unpinned one goes back into `rows` by its save date. Search
 * results ignore pins, so there (`groupPins` false) the row stays where it is and only its flag
 * changes. An unpinned row older than every loaded row isn't added while more pages remain
 * (`hasMore`): the page that holds it will bring it. Unknown ids and no-op changes return the
 * same object.
 */
export function applyPin<Row extends PinnableRow>(
  groups: ListGroups<Row>,
  id: string,
  pinned: boolean,
  { groupPins, hasMore }: { groupPins: boolean; hasMore: boolean },
): ListGroups<Row> {
  const row = [...groups.pinned, ...groups.rows].find((candidate) => candidate.id === id);
  if (!row || row.pinned === pinned) return groups;
  const updated = { ...row, pinned };

  if (!groupPins) {
    const setFlag = (rows: Row[]) => rows.map((item) => (item.id === id ? updated : item));
    return { pinned: setFlag(groups.pinned), rows: setFlag(groups.rows) };
  }

  const others = (rows: Row[]) => rows.filter((item) => item.id !== id);
  if (pinned) {
    return { pinned: [updated, ...others(groups.pinned)], rows: others(groups.rows) };
  }

  const rows = others(groups.rows);
  const index = rows.findIndex((item) => item.dateTime < updated.dateTime);
  if (index === -1) {
    return { pinned: others(groups.pinned), rows: hasMore ? rows : [...rows, updated] };
  }
  return {
    pinned: others(groups.pinned),
    rows: [...rows.slice(0, index), updated, ...rows.slice(index)],
  };
}

/**
 * The rows after a later page loads: the page's rows that the list doesn't already show, so a row
 * that moved between groups meanwhile never appears twice.
 */
export function appendPage<Row extends PinnableRow>(
  groups: ListGroups<Row>,
  page: readonly Row[],
): ListGroups<Row> {
  const shown = new Set([...groups.pinned, ...groups.rows].map((row) => row.id));
  return {
    pinned: groups.pinned,
    rows: [...groups.rows, ...page.filter((row) => !shown.has(row.id))],
  };
}
