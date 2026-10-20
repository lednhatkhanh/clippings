import { describe, expect, it } from "vitest";

import { parseReading } from "./summarizer.ts";

const reading = { title: "A title", summary: "A summary.", excerpt: "An excerpt." };

describe("parseReading", () => {
  it("returns the three fields as the model wrote them", () => {
    expect(parseReading(reading)).toEqual(reading);
  });

  it("ignores fields the model added", () => {
    expect(parseReading({ ...reading, confidence: 0.9 })).toEqual(reading);
  });

  it.each([
    ["title", 300],
    ["summary", 1_000],
    ["excerpt", 500],
  ] as const)("trims %s and cuts it at %i characters", (name, cap) => {
    const parsed = parseReading({ ...reading, [name]: `  ${"x".repeat(cap + 50)}  ` });
    expect(parsed[name]).toBe("x".repeat(cap));
  });

  it("keeps a field that is exactly at its cap", () => {
    expect(parseReading({ ...reading, title: "t".repeat(300) }).title).toHaveLength(300);
  });

  it("trims surrounding whitespace but keeps the text inside", () => {
    expect(parseReading({ ...reading, summary: "\n  One.  Two.\t" }).summary).toBe("One.  Two.");
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["a number", 7],
    ["an array", ["a title"]],
    ["empty", ""],
    ["only whitespace", " \n\t "],
  ])("refuses a title that is %s, naming the field", (_label, title) => {
    expect(() => parseReading({ ...reading, title })).toThrow(/no title/);
  });

  it.each(["summary", "excerpt"] as const)("refuses a reading with no %s", (name) => {
    const { [name]: _dropped, ...rest } = reading;
    expect(() => parseReading(rest)).toThrow(new RegExp(`no ${name}`));
  });
});
