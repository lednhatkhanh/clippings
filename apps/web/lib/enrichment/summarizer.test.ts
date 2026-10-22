import { describe, expect, it } from "vitest";

import { parseReading, summaryRequest } from "./summarizer.ts";

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

describe("parseReading suggestions", () => {
  const mine = ["CSS", "web design", "Rust", "reading list"];
  const parse = (
    suggestions: Record<string, unknown>,
    userTags: readonly string[] | undefined = mine,
  ) => parseReading({ ...reading, ...suggestions }, userTags);

  it("leaves suggestedTags out when suggestions weren't asked for, even if the model sent some", () => {
    const parsed = parseReading({ ...reading, existing_tags: ["CSS"], new_tags: ["grids"] });
    expect(parsed).toEqual(reading);
    expect("suggestedTags" in parsed).toBe(false);
  });

  it.each<[string, Record<string, unknown>, string[]]>([
    ["no suggestions", { existing_tags: [], new_tags: [] }, []],
    [
      "the user's tags and a new one",
      { existing_tags: ["CSS", "Rust"], new_tags: ["grids"] },
      ["CSS", "Rust", "grids"],
    ],
    [
      "the user's spelling for a tag written in another case",
      { existing_tags: ["css", "WEB DESIGN"], new_tags: [] },
      ["CSS", "web design"],
    ],
    [
      "only tags the user has",
      { existing_tags: ["CSS", "typography", "Rust"], new_tags: [] },
      ["CSS", "Rust"],
    ],
    [
      "no more than 3 of the user's tags",
      { existing_tags: ["CSS", "web design", "Rust", "reading list"], new_tags: [] },
      ["CSS", "web design", "Rust"],
    ],
    [
      "each tag once",
      { existing_tags: ["CSS", "css", " css "], new_tags: ["grids", "Grids"] },
      ["CSS", "grids"],
    ],
    ["no more than 1 new tag", { existing_tags: [], new_tags: ["grids", "layout"] }, ["grids"]],
    [
      "no new tag the user already has",
      { existing_tags: [], new_tags: ["RUST", "layout"] },
      ["layout"],
    ],
    [
      "a new tag with whitespace tidied",
      { existing_tags: [], new_tags: ["  site   speed "] },
      ["site speed"],
    ],
    ["no blank tags", { existing_tags: ["", "  "], new_tags: [" "] }, []],
    [
      "a new tag that fits, skipping an over-long one",
      { existing_tags: [], new_tags: ["x".repeat(51), "grids"] },
      ["grids"],
    ],
    ["no over-long new tag", { existing_tags: [], new_tags: ["x".repeat(51)] }, []],
    [
      "a new tag exactly at the limit",
      { existing_tags: [], new_tags: ["x".repeat(50)] },
      ["x".repeat(50)],
    ],
  ])("suggests %s", (_label, suggestions, expected) => {
    expect(parse(suggestions).suggestedTags).toEqual(expected);
  });

  it("suggests only new tags to a user who has none yet", () => {
    expect(parse({ existing_tags: ["css"], new_tags: ["grids"] }, []).suggestedTags).toEqual([
      "grids",
    ]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["missing", {}],
    ["not arrays", { existing_tags: "CSS", new_tags: "grids" }],
    ["null", { existing_tags: null, new_tags: null }],
    ["an array with a non-string", { existing_tags: ["CSS", 4], new_tags: [] }],
    ["one list malformed", { existing_tags: ["CSS"], new_tags: { name: "grids" } }],
  ])("drops the suggestions when they are %s, and still reads the page", (_label, suggestions) => {
    const parsed = parse(suggestions);
    expect(parsed).toEqual(reading);
    expect("suggestedTags" in parsed).toBe(false);
  });

  it("still refuses a reading with no summary when the suggestions are fine", () => {
    const { summary: _dropped, ...rest } = reading;
    expect(() => parseReading({ ...rest, existing_tags: [], new_tags: [] }, mine)).toThrow(
      /no summary/,
    );
  });
});

describe("summaryRequest", () => {
  const html = { url: "https://example.com/a", title: "A page", text: "Some words." };
  const pdf = {
    url: "https://example.com/paper.pdf",
    title: "paper",
    text: "",
    document: { mediaType: "application/pdf" as const, data: "JVBERi0xLjc=" },
  };
  const blocks = (request: ReturnType<typeof summaryRequest>) => {
    const { content } = request.messages[0]!;
    return typeof content === "string" ? [] : content;
  };

  it("sends a PDF as a base64 document block ahead of the text", () => {
    const [first, second, ...rest] = blocks(summaryRequest(pdf));
    expect(first).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjc=" },
    });
    expect(second).toMatchObject({ type: "text", text: expect.stringContaining("PDF") });
    expect(rest).toEqual([]);
  });

  it("sends a page as text alone, with no document block", () => {
    const content = blocks(summaryRequest(html));
    expect(content.map((block) => block.type)).toEqual(["text"]);
    expect(content[0]).toMatchObject({ text: expect.stringContaining("Some words.") });
  });

  it("asks for the reading the same way for a PDF as for a page, tags included", () => {
    const request = summaryRequest({ ...pdf, userTags: ["papers"] });
    expect(request.tool_choice).toEqual({ type: "tool", name: "save_reading" });
    expect(request.tools?.[0]).toMatchObject({ name: "save_reading", strict: true });
    expect(JSON.stringify(blocks(request))).toContain("<your_tags>\\npapers\\n</your_tags>");
  });
});
