import { describe, expect, it } from "vitest";

import { appendPage, applyPin } from "./pins.ts";

const row = (id: string, day: number, pinned = false) => ({
  id,
  dateTime: `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`,
  pinned,
});

const ids = (groups: { pinned: { id: string }[]; rows: { id: string }[] }) => ({
  pinned: groups.pinned.map((item) => item.id),
  rows: groups.rows.map((item) => item.id),
});

describe("applyPin", () => {
  const plain = { groupPins: true, hasMore: false };

  it.each([
    {
      name: "pinning moves the row to the top of the pinned group",
      groups: { pinned: [row("p", 1, true)], rows: [row("a", 5), row("b", 4)] },
      id: "b",
      pinned: true,
      expected: { pinned: ["b", "p"], rows: ["a"] },
    },
    {
      name: "unpinning puts the row back by its save date",
      groups: { pinned: [row("p", 4, true), row("q", 1, true)], rows: [row("a", 5), row("b", 3)] },
      id: "p",
      pinned: false,
      expected: { pinned: ["q"], rows: ["a", "p", "b"] },
    },
    {
      name: "an unpinned row older than all loaded rows goes last when nothing more can load",
      groups: { pinned: [row("p", 1, true)], rows: [row("a", 5)] },
      id: "p",
      pinned: false,
      expected: { pinned: [], rows: ["a", "p"] },
    },
    {
      name: "an unknown id changes nothing",
      groups: { pinned: [], rows: [row("a", 5)] },
      id: "zzz",
      pinned: true,
      expected: { pinned: [], rows: ["a"] },
    },
    {
      name: "pinning a pinned row changes nothing",
      groups: { pinned: [row("p", 1, true), row("q", 2, true)], rows: [] },
      id: "q",
      pinned: true,
      expected: { pinned: ["p", "q"], rows: [] },
    },
  ])("$name", ({ groups, id, pinned, expected }) => {
    expect(ids(applyPin(groups, id, pinned, plain))).toEqual(expected);
  });

  it("marks the row pinned or not", () => {
    const groups = { pinned: [], rows: [row("a", 5)] };
    const pinned = applyPin(groups, "a", true, plain);
    expect(pinned.pinned[0]?.pinned).toBe(true);
    expect(applyPin(pinned, "a", false, plain).rows[0]?.pinned).toBe(false);
  });

  it("leaves an older unpinned row to a later page", () => {
    const groups = { pinned: [row("p", 1, true)], rows: [row("a", 5)] };
    expect(ids(applyPin(groups, "p", false, { groupPins: true, hasMore: true }))).toEqual({
      pinned: [],
      rows: ["a"],
    });
  });

  it("keeps search results in place and only flips the flag", () => {
    const groups = { pinned: [], rows: [row("a", 5), row("b", 4), row("c", 3)] };
    const result = applyPin(groups, "b", true, { groupPins: false, hasMore: false });
    expect(ids(result)).toEqual({ pinned: [], rows: ["a", "b", "c"] });
    expect(result.rows.map((item) => item.pinned)).toEqual([false, true, false]);
  });
});

describe("appendPage", () => {
  it("adds the page after the loaded rows", () => {
    const result = appendPage({ pinned: [row("p", 1, true)], rows: [row("a", 5)] }, [row("b", 4)]);
    expect(ids(result)).toEqual({ pinned: ["p"], rows: ["a", "b"] });
  });

  it("skips rows already shown, in either group", () => {
    const result = appendPage({ pinned: [row("p", 1, true)], rows: [row("a", 5)] }, [
      row("p", 1),
      row("a", 5),
      row("b", 4),
    ]);
    expect(ids(result)).toEqual({ pinned: ["p"], rows: ["a", "b"] });
  });
});
