import { describe, expect, it } from "vitest";

import { isPrefetchableHref } from "./next-links.tsx";

describe("isPrefetchableHref", () => {
  it.each([
    ["/", undefined, true],
    ["/c/0b1d", undefined, true],
    ["/?tag=reading", undefined, true],
    ["/apish", undefined, true],
    ["/api/export", undefined, false],
    ["/api/export/bookmarks", undefined, false],
    ["/api?x=1", undefined, false],
    ["/settings", true, false],
    ["/settings", "file.json", false],
    ["/settings", false, true],
    ["https://example.com/", undefined, false],
    ["//example.com/", undefined, false],
    ["#main", undefined, false],
  ])("%s with download=%s → %s", (href, download, expected) => {
    expect(isPrefetchableHref(href, download)).toBe(expected);
  });
});
