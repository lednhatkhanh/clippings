import { describe, expect, it } from "vitest";

import { refreshFirstPage } from "./refresh-first-page.ts";

const groups = (pinned: string[], rows: string[]) => ({
  pinned: pinned.map((id) => ({ id })),
  rows: rows.map((id) => ({ id })),
});
const ids = (result: ReturnType<typeof groups>) => ({
  pinned: result.pinned.map((row) => row.id),
  rows: result.rows.map((row) => row.id),
});

describe("refreshFirstPage", () => {
  it.each([
    {
      name: "no later page: the new first page replaces everything",
      current: groups([], ["a", "b"]),
      next: groups([], ["n", "a"]),
      loadedMore: false,
      expected: { pinned: [], rows: ["n", "a"] },
    },
    {
      name: "a deleted row leaves when nothing more was loaded",
      current: groups([], ["a", "b"]),
      next: groups([], ["b"]),
      loadedMore: false,
      expected: { pinned: [], rows: ["b"] },
    },
    {
      name: "a new save leads and the pushed-off row keeps its place before the loaded page",
      current: groups([], ["a", "b", "c", "d"]),
      next: groups([], ["n", "a", "b"]),
      loadedMore: true,
      expected: { pinned: [], rows: ["n", "a", "b", "c", "d"] },
    },
    {
      name: "loaded pages stay when the first page is unchanged",
      current: groups(["p"], ["a", "b", "c"]),
      next: groups(["p"], ["a", "b"]),
      loadedMore: true,
      expected: { pinned: ["p"], rows: ["a", "b", "c"] },
    },
    {
      name: "a row pinned elsewhere shows once, in the pinned group",
      current: groups([], ["a", "b", "c"]),
      next: groups(["b"], ["a"]),
      loadedMore: true,
      expected: { pinned: ["b"], rows: ["a", "c"] },
    },
  ])("$name", ({ current, next, loadedMore, expected }) => {
    expect(ids(refreshFirstPage(current, next, loadedMore))).toEqual(expected);
  });
});
