import { describe, expect, it } from "vitest";

import { parseDigest } from "./digester.ts";

const clipping = (id: string) => ({ id, title: id, summary: null, tags: [], note: "" });
const input = {
  clippings: [clipping("a"), clipping("b"), clipping("c")],
  related: [clipping("x"), clipping("y")],
};

const group = (clippingIds: unknown, extra: Record<string, unknown> = {}) => ({
  title: "A theme",
  summary: "Two pages about a theme.",
  clippingIds,
  ...extra,
});

describe("parseDigest", () => {
  it("returns the groups and the resurfaced clippings as the model wrote them", () => {
    const raw = {
      groups: [group(["a", "b"]), group(["c"], { title: "Another" })],
      resurfaced: [{ clippingId: "x", why: "It continues this." }],
    };

    expect(parseDigest(raw, input)).toEqual({
      groups: [
        { title: "A theme", summary: "Two pages about a theme.", clippingIds: ["a", "b"] },
        { title: "Another", summary: "Two pages about a theme.", clippingIds: ["c"] },
      ],
      resurfaced: [{ clippingId: "x", why: "It continues this." }],
    });
  });

  it("drops ids that are not in the week and groups that are left empty", () => {
    const raw = {
      groups: [group(["a", "nope", 7, null]), group(["ghost"]), group([]), group("a")],
      resurfaced: [],
    };

    expect(parseDigest(raw, input).groups).toEqual([
      { title: "A theme", summary: "Two pages about a theme.", clippingIds: ["a"] },
    ]);
  });

  it("puts a clipping in one group only, the first that names it", () => {
    const raw = {
      groups: [group(["a", "a", "b"]), group(["b", "c"], { title: "Second" })],
      resurfaced: [],
    };

    expect(parseDigest(raw, input).groups.map((g) => g.clippingIds)).toEqual([["a", "b"], ["c"]]);
  });

  it("does not take an archive clipping into a group, nor a week's into resurfaced", () => {
    const raw = {
      groups: [group(["a", "x"])],
      resurfaced: [
        { clippingId: "b", why: "In the week already." },
        { clippingId: "nope", why: "Unknown." },
        { clippingId: "y", why: "Fits." },
      ],
    };

    expect(parseDigest(raw, input)).toEqual({
      groups: [{ title: "A theme", summary: "Two pages about a theme.", clippingIds: ["a"] }],
      resurfaced: [{ clippingId: "y", why: "Fits." }],
    });
  });

  it("brings back each archive clipping once, and not without a reason", () => {
    const raw = {
      groups: [group(["a"])],
      resurfaced: [
        { clippingId: "x", why: "First." },
        { clippingId: "x", why: "Again." },
        { clippingId: "y", why: "  " },
        { clippingId: "y" },
      ],
    };

    expect(parseDigest(raw, input).resurfaced).toEqual([{ clippingId: "x", why: "First." }]);
  });

  it.each([
    ["title", 120],
    ["summary", 400],
  ] as const)("trims a group's %s and cuts it at %i characters", (name, cap) => {
    const raw = {
      groups: [group(["a"], { [name]: `  ${"x".repeat(cap + 20)} ` })],
      resurfaced: [],
    };

    expect(parseDigest(raw, input).groups[0]![name]).toBe("x".repeat(cap));
  });

  it("cuts a reason at 300 characters", () => {
    const raw = {
      groups: [group(["a"])],
      resurfaced: [{ clippingId: "x", why: "w".repeat(350) }],
    };

    expect(parseDigest(raw, input).resurfaced[0]!.why).toBe("w".repeat(300));
  });

  it("drops a group without a title or a summary", () => {
    const raw = {
      groups: [group(["a"], { title: " " }), group(["b"], { summary: 3 }), group(["c"])],
      resurfaced: [],
    };

    expect(parseDigest(raw, input).groups.map((g) => g.clippingIds)).toEqual([["c"]]);
  });

  it("keeps at most 12 groups", () => {
    const many = Array.from({ length: 15 }, (_, i) => clipping(`p${i}`));
    const raw = { groups: many.map(({ id }) => group([id])), resurfaced: [] };

    expect(parseDigest(raw, { clippings: many, related: [] }).groups).toHaveLength(12);
  });

  it.each([
    ["no groups", { groups: [], resurfaced: [] }],
    ["groups of nothing known", { groups: [group(["ghost"])], resurfaced: [] }],
    ["groups that are not a list", { groups: "a", resurfaced: [] }],
    ["nothing at all", {}],
  ])("refuses a digest with %s, so none is stored", (_label, raw) => {
    expect(() => parseDigest(raw, input)).toThrow("no usable group");
  });

  it("tolerates resurfaced that is missing or malformed", () => {
    expect(parseDigest({ groups: [group(["a"])] }, input).resurfaced).toEqual([]);
    expect(
      parseDigest({ groups: [group(["a"])], resurfaced: [null, 3, "x"] }, input).resurfaced,
    ).toEqual([]);
  });
});
