import { describe, expect, it } from "vitest";

import { NOTE_TITLE_LENGTH, noteTitle, UNTITLED_NOTE } from "./note-title.ts";

describe("noteTitle", () => {
  it.each([
    [
      "a plain first line",
      "Remember to call the dentist\nthen the bank",
      "Remember to call the dentist",
    ],
    ["a heading", "## Trip to Rotterdam\n\nDay one...", "Trip to Rotterdam"],
    ["leading blank lines", "\n\n  Ideas for the week", "Ideas for the week"],
    ["a list item", "- [ ] buy *oat* milk", "buy oat milk"],
    ["a numbered item", "1. Read the **spec**", "Read the spec"],
    ["a quote", "> The map is not the territory", "The map is not the territory"],
    ["a link", "See [the docs](https://example.com/docs) first", "See the docs first"],
    ["inline code", "Run `pnpm test` twice", "Run pnpm test twice"],
    ["a code fence before the text", "```ts\nconst x = 1;\n```", "const x = 1;"],
    ["a rule then text", "---\nReal title", "Real title"],
    ["Windows line endings", "First\r\nSecond", "First"],
  ])("takes the title from %s", (_name, body, title) => {
    expect(noteTitle(body)).toBe(title);
  });

  it.each([
    ["an empty body", ""],
    ["only whitespace", "  \n \t"],
    ["only a rule", "---"],
    ["only punctuation marks", "* * *\n***"],
  ])("falls back for %s", (_name, body) => {
    expect(noteTitle(body)).toBe(UNTITLED_NOTE);
  });

  it("cuts a long line at a word, with an ellipsis, within the limit", () => {
    const title = noteTitle(`${"word ".repeat(40)}end`);
    expect(title.length).toBeLessThanOrEqual(NOTE_TITLE_LENGTH);
    expect(title.endsWith("word…")).toBe(true);
  });

  it("cuts a line that is one long word where it stands", () => {
    const title = noteTitle("x".repeat(300));
    expect(title).toHaveLength(NOTE_TITLE_LENGTH);
    expect(title.endsWith("…")).toBe(true);
  });
});
