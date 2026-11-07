import { describe, expect, it } from "vitest";

import { summarizeChange } from "./describe.ts";

const base = { actor: "librarian", confidence: "high", reason: " Same topic " } as const;

describe("summarizing a change for the review screen", () => {
  it("uses the sentence the librarian logged", () => {
    expect(
      summarizeChange({
        ...base,
        action: "merge_tag",
        after: { summary: 'Merge "ml" into "machine learning"', other: 1 },
      }),
    ).toEqual({
      summary: 'Merge "ml" into "machine learning"',
      actor: "Librarian",
      action: "Tags merged",
      confidence: "Sure",
      reason: "Same topic",
    });
  });

  it("words an auto-tag from the tag it kept, which has no sentence", () => {
    expect(
      summarizeChange({
        actor: "auto_tag",
        action: "add_tag",
        confidence: "high",
        reason: "",
        after: { tags: ["a"], tag: { id: "t", name: "reading" } },
      }).summary,
    ).toBe("Tag a clipping “reading”");
  });

  it.each([null, "text", [], { summary: "  " }, { summary: 4 }])(
    "falls back to the action's name when `after` is %j",
    (after) => {
      const summary = summarizeChange({
        actor: "user_via_mcp",
        action: "link_items",
        confidence: null,
        reason: "",
        after,
      });
      expect(summary).toMatchObject({ summary: "Items linked", actor: "You", confidence: null });
    },
  );
});
