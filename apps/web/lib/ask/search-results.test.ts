import { describe, expect, it } from "vitest";

import {
  buildSearchResults,
  clippingLink,
  MAX_NOTE_CHARS,
  MAX_PAGE_TEXT_CHARS,
  type AskSource,
} from "./search-results.ts";

const ORIGIN = "https://clippings.example";

function source(overrides: Partial<AskSource["clipping"]> = {}, pageText: string | null = null) {
  return {
    clipping: { id: "c1", title: "A page", summary: null, note: "", excerpt: null, ...overrides },
    pageText,
  } satisfies AskSource;
}

describe("buildSearchResults", () => {
  it("makes a cited search result of each clipping, linked to its page in the app", () => {
    const { blocks, clippingsByLink } = buildSearchResults(
      [source({ id: "c1", title: "First", summary: "About first." }, "Text of first.")],
      ORIGIN,
    );

    expect(blocks).toEqual([
      {
        type: "search_result",
        source: "https://clippings.example/c/c1",
        title: "First",
        citations: { enabled: true },
        content: [
          { type: "text", text: "Summary: About first." },
          { type: "text", text: "Page text: Text of first." },
        ],
      },
    ]);
    expect(clippingsByLink.get(clippingLink(ORIGIN, "c1"))).toEqual({ id: "c1", title: "First" });
  });

  it.each([
    ["only a summary", { summary: "S" }, null, ["Summary: S"]],
    ["only a note", { note: "N" }, null, ["The user's note: N"]],
    ["only page text", {}, "P", ["Page text: P"]],
    [
      "all three, in that order",
      { summary: "S", note: "N" },
      "P",
      ["Summary: S", "The user's note: N", "Page text: P"],
    ],
    ["blank parts left out", { summary: "  ", note: "\n" }, "  P  ", ["Page text: P"]],
    ["only an excerpt, as a fallback", { excerpt: "E" }, null, ["Excerpt: E"]],
    [
      "no excerpt when there is anything else",
      { note: "N", excerpt: "E" },
      null,
      ["The user's note: N"],
    ],
  ])("reads %s", (_name, clipping, pageText, expected) => {
    const { blocks } = buildSearchResults([source(clipping, pageText)], ORIGIN);

    expect(blocks[0]?.content.map((block) => block.text)).toEqual(expected);
  });

  it("cuts the page text to its limit", () => {
    const { blocks } = buildSearchResults(
      [source({}, "y".repeat(MAX_PAGE_TEXT_CHARS + 500))],
      ORIGIN,
    );

    expect(blocks[0]?.content[0]?.text).toBe(`Page text: ${"y".repeat(MAX_PAGE_TEXT_CHARS)}`);
  });

  it("cuts a long note to its limit", () => {
    const { blocks } = buildSearchResults(
      [source({ note: "n".repeat(MAX_NOTE_CHARS + 500) })],
      ORIGIN,
    );

    expect(blocks[0]?.content[0]?.text).toBe(`The user's note: ${"n".repeat(MAX_NOTE_CHARS)}`);
  });

  it("leaves out a clipping with nothing to read", () => {
    const { blocks, clippingsByLink } = buildSearchResults(
      [source({ id: "empty" }), source({ id: "c2", note: "N" })],
      ORIGIN,
    );

    expect(blocks.map((block) => block.source)).toEqual([clippingLink(ORIGIN, "c2")]);
    expect([...clippingsByLink.keys()]).toEqual([clippingLink(ORIGIN, "c2")]);
  });
});
