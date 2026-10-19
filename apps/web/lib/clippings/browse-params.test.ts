import { describe, expect, it } from "vitest";

import { hrefWithTag, loadBrowseParams, toQueryString } from "./browse-params.ts";

describe("browse params", () => {
  it("reads the query, sources and sort from the URL", () => {
    expect(
      loadBrowseParams(new URLSearchParams("q=soup+recipes&source=mcp,web&sort=date")),
    ).toEqual({ q: "soup recipes", tags: [], sources: ["web", "mcp"], sort: "date" });
  });

  it("falls back to everything, by relevance, for missing or unknown values", () => {
    expect(loadBrowseParams(new URLSearchParams("source=fax,,web&sort=random"))).toEqual({
      q: "",
      tags: [],
      sources: ["web"],
      sort: "relevance",
    });
  });

  it("takes the record a page receives, using the first of repeated keys", () => {
    expect(loadBrowseParams({ q: ["tea", "coffee"], source: "digest" })).toEqual({
      q: "tea",
      tags: [],
      sources: ["digest"],
      sort: "relevance",
    });
  });

  it("writes only what differs from the defaults, in a stable order", () => {
    expect(toQueryString({ q: "", tags: [], sources: [], sort: "relevance" })).toBe("");
    expect(toQueryString({ q: " ", tags: [], sources: [], sort: "date" })).toBe("");
    expect(
      toQueryString({ q: " soup ", tags: ["work"], sources: ["mcp", "web"], sort: "date" }),
    ).toBe("q=soup&tag=work&source=web,mcp&sort=date");
  });

  it("reads each repeated tag, as stored: trimmed, once each ignoring case, empty ones dropped", () => {
    expect(
      loadBrowseParams(new URLSearchParams("tag=work&tag=+to++read+&tag=Work&tag=")).tags,
    ).toEqual(["work", "to read"]);
  });

  it("round-trips", () => {
    const params = {
      q: "was ist",
      tags: ["a, b & c", "work"],
      sources: ["extension" as const],
      sort: "relevance" as const,
    };
    expect(loadBrowseParams(new URLSearchParams(toQueryString(params)))).toEqual(params);
  });

  it("leads a tag chip to the same list narrowed to that tag as well", () => {
    const params = loadBrowseParams(new URLSearchParams("q=soup&tag=work&source=web"));
    expect(hrefWithTag(params, "to read")).toBe("/?q=soup&tag=work&tag=to+read&source=web");
    expect(hrefWithTag(params, "Work")).toBe("/?q=soup&tag=work&source=web");
    expect(hrefWithTag(loadBrowseParams(""), "work")).toBe("/?tag=work");
  });
});
