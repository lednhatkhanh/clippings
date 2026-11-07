import { describe, expect, it } from "vitest";

import { linkableSources } from "./sources.ts";

describe("linkableSources", () => {
  it("keeps web addresses and uses the address for a blank title", () => {
    expect(
      linkableSources([
        { url: "https://example.com/a", title: "A" },
        { url: "http://example.com/b", title: "  " },
      ]),
    ).toEqual([
      { url: "https://example.com/a", title: "A" },
      { url: "http://example.com/b", title: "http://example.com/b" },
    ]);
  });

  it("drops addresses that are not web pages", () => {
    expect(
      linkableSources([
        { url: "javascript:alert(1)", title: "Bad" },
        { url: "data:text/html,<p>x</p>", title: "Bad" },
        { url: "not a url", title: "Bad" },
        { url: "https://example.com/ok", title: "Fine" },
      ]),
    ).toEqual([{ url: "https://example.com/ok", title: "Fine" }]);
  });
});
