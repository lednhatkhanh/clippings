import { describe, expect, it } from "vitest";

import { sectionIndex, sectionTransitionType } from "./nav-sections.ts";

describe("sectionIndex", () => {
  it.each([
    ["/", 0],
    ["/c/abc", 0],
    ["/tags", 1],
    ["/tags/anything", 1],
    ["/settings", 2],
    ["/share", -1],
    ["/tagsmith", -1],
    ["/sign-in", -1],
  ])("puts %s at %i", (pathname, expected) => {
    expect(sectionIndex(pathname)).toBe(expected);
  });
});

describe("sectionTransitionType", () => {
  it.each([
    ["/", "/tags", "section-lower"],
    ["/", "/settings", "section-lower"],
    ["/c/abc", "/settings", "section-lower"],
    ["/tags", "/settings", "section-lower"],
    ["/settings", "/tags", "section-higher"],
    ["/settings", "/", "section-higher"],
    ["/tags", "/", "section-higher"],
    ["/c/abc", "/", "nav-back"],
    ["/", "/", undefined],
    ["/tags", "/tags", undefined],
    ["/share", "/tags", undefined],
    ["/tags", "/share", undefined],
  ])("from %s to %s is %s", (from, to, expected) => {
    expect(sectionTransitionType(from, to)).toBe(expected);
  });
});
