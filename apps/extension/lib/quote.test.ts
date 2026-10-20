import { describe, expect, it } from "vitest";

import { MAX_NOTE_LENGTH } from "@clippings/shared";

import { quoteSelection } from "./quote.ts";

describe("quoteSelection", () => {
  it("marks each line as a quote", () => {
    expect(quoteSelection("One line")).toBe("> One line");
    expect(quoteSelection("First\r\nSecond")).toBe("> First\n> Second");
  });

  it("keeps paragraphs in one quote block, with one break between them", () => {
    expect(quoteSelection("First paragraph.\n\n\n  \nSecond paragraph.")).toBe(
      "> First paragraph.\n>\n> Second paragraph.",
    );
  });

  it("drops whitespace around the selection, and keeps indentation inside it", () => {
    expect(quoteSelection("\n\n   Indented\n  more   \n\n")).toBe("> Indented\n>   more");
  });

  it("is empty when nothing but whitespace was selected", () => {
    expect(quoteSelection("")).toBe("");
    expect(quoteSelection(" \n\t\n ")).toBe("");
  });

  it("fits a note, cut at a line", () => {
    const line = "x".repeat(99);
    const quote = quoteSelection(Array.from({ length: 200 }, () => line).join("\n"));
    expect(quote.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH);
    expect(quote.split("\n").every((quoted) => quoted === `> ${line}`)).toBe(true);
  });
});
