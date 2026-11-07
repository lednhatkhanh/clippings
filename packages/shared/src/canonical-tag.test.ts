import { describe, expect, it } from "vitest";

import { checkCanonicalTagName, type NotCanonicalReason } from "./canonical-tag.ts";

describe("checkCanonicalTagName", () => {
  const mine = ["css", "web framework", "Machine Learning", "typescript", "library"];

  const accepted: [string, string][] = [
    ["logistics", "logistics"],
    ["container shipping", "container shipping"],
    ["  rust  ", "rust"],
    ["postgres", "postgres"],
    ["ios", "ios"],
    ["kubernetes", "kubernetes"],
    ["analysis", "analysis"],
    // Short names are not compared by edit distance: "go" is not "gc".
    ["go", "go"],
    ["web", "web"],
    // Not the same words as any one tag the user has.
    ["css layout", "css layout"],
  ];
  it.each(accepted)("accepts %j as %j", (candidate, stored) => {
    expect(checkCanonicalTagName(candidate, mine)).toEqual({ ok: true, name: stored });
  });

  const refused: [string, NotCanonicalReason][] = [
    ["", "empty"],
    ["   ", "empty"],
    ["x".repeat(51), "too_long"],
    ["Logistics", "not_lowercase"],
    ["TypeScript Tips", "not_lowercase"],
    ["web frameworks", "plural"],
    ["databases", "plural"],
    ["libraries", "plural"],
    ["boxes", "plural"],
    // The same words as a tag the user has.
    ["css", "near_duplicate"],
    ["web framework", "near_duplicate"],
    ["web-framework", "near_duplicate"],
    ["webframework", "near_duplicate"],
    ["machine learning", "near_duplicate"],
    ["typescript", "near_duplicate"],
    // One letter off a name of 5+ characters.
    ["typescrpt", "near_duplicate"],
    ["typescripr", "near_duplicate"],
    ["libary", "near_duplicate"],
  ];
  it.each(refused)("refuses %j: %s", (candidate, reason) => {
    expect(checkCanonicalTagName(candidate, mine)).toEqual({ ok: false, reason });
  });

  it("accepts any canonical name when the user has no tags yet", () => {
    expect(checkCanonicalTagName("typescript", [])).toEqual({ ok: true, name: "typescript" });
  });
});
