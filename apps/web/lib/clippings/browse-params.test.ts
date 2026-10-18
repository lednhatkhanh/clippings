import { describe, expect, it } from "vitest";

import { loadBrowseParams, toQueryString } from "./browse-params.ts";

describe("browse params", () => {
  it("reads the query, sources and sort from the URL", () => {
    expect(
      loadBrowseParams(new URLSearchParams("q=soup+recipes&source=mcp,web&sort=date")),
    ).toEqual({ q: "soup recipes", sources: ["web", "mcp"], sort: "date" });
  });

  it("falls back to everything, by relevance, for missing or unknown values", () => {
    expect(loadBrowseParams(new URLSearchParams("source=fax,,web&sort=random"))).toEqual({
      q: "",
      sources: ["web"],
      sort: "relevance",
    });
  });

  it("takes the record a page receives, using the first of repeated keys", () => {
    expect(loadBrowseParams({ q: ["tea", "coffee"], source: "digest" })).toEqual({
      q: "tea",
      sources: ["digest"],
      sort: "relevance",
    });
  });

  it("writes only what differs from the defaults, in a stable order", () => {
    expect(toQueryString({ q: "", sources: [], sort: "relevance" })).toBe("");
    expect(toQueryString({ q: " ", sources: [], sort: "date" })).toBe("");
    expect(toQueryString({ q: " soup ", sources: ["mcp", "web"], sort: "date" })).toBe(
      "q=soup&source=web,mcp&sort=date",
    );
  });

  it("round-trips", () => {
    const params = { q: "was ist", sources: ["extension" as const], sort: "relevance" as const };
    expect(loadBrowseParams(new URLSearchParams(toQueryString(params)))).toEqual(params);
  });
});
