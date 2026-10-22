import { describe, expect, it } from "vitest";

import { sectionIndex, sectionTransitionType } from "./nav-sections.ts";

describe("sectionIndex", () => {
  it.each([
    ["/", 0],
    ["/c/abc", 0],
    ["/ask", 1],
    ["/tags", 2],
    ["/tags/anything", 2],
    ["/digest", 3],
    ["/settings", 4],
    ["/share", -1],
    ["/tagsmith", -1],
    ["/asking", -1],
    ["/digests", -1],
    ["/sign-in", -1],
  ])("puts %s at %i", (pathname, expected) => {
    expect(sectionIndex(pathname)).toBe(expected);
  });
});

describe("sectionTransitionType", () => {
  it.each([
    ["/", "/tags", "section-lower"],
    ["/", "/ask", "section-lower"],
    ["/", "/settings", "section-lower"],
    ["/", "/digest", "section-lower"],
    ["/c/abc", "/settings", "section-lower"],
    ["/ask", "/tags", "section-lower"],
    ["/tags", "/digest", "section-lower"],
    ["/tags", "/settings", "section-lower"],
    ["/digest", "/settings", "section-lower"],
    ["/settings", "/tags", "section-higher"],
    ["/settings", "/digest", "section-higher"],
    ["/digest", "/tags", "section-higher"],
    ["/tags", "/ask", "section-higher"],
    ["/settings", "/", "section-higher"],
    ["/tags", "/", "section-higher"],
    ["/c/abc", "/", "nav-back"],
    ["/", "/", undefined],
    ["/tags", "/tags", undefined],
    ["/digest", "/digest", undefined],
    ["/share", "/tags", undefined],
    ["/tags", "/share", undefined],
  ])("from %s to %s is %s", (from, to, expected) => {
    expect(sectionTransitionType(from, to)).toBe(expected);
  });
});
