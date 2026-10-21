import { describe, expect, it } from "vitest";

import { newRowIds } from "./new-rows.ts";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

describe("newRowIds", () => {
  it.each([
    {
      name: "a row saved at the top",
      previous: ["b", "c"],
      next: ["a", "b", "c"],
      expected: ["a"],
    },
    { name: "nothing changed", previous: ["a", "b"], next: ["a", "b"], expected: [] },
    { name: "a row deleted", previous: ["a", "b"], next: ["b"], expected: [] },
    { name: "rows reordered", previous: ["a", "b"], next: ["b", "a"], expected: [] },
    { name: "several rows saved", previous: ["c"], next: ["a", "b", "c"], expected: ["a", "b"] },
  ])("$name", ({ previous, next, expected }) => {
    expect([...newRowIds(rows(...previous), rows(...next))]).toEqual(expected);
  });
});
