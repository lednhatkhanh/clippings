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

  describe("confidence", () => {
    const tag = (name: string, confidence: unknown, reason: unknown = "Because.") => ({
      name,
      confidence,
      reason,
    });

    it("carries each tag's confidence and reason, with existing tags in the user's spelling", () => {
      const parsed = parse({
        existing_tags: [tag("css", "high", "  A page on CSS. "), tag("RUST", "low")],
        new_tags: [tag("grids", "high")],
      });

      expect(parsed.tagProposals).toEqual([
        { name: "CSS", existing: true, confidence: "high", reason: "A page on CSS." },
        { name: "Rust", existing: true, confidence: "low", reason: "Because." },
        { name: "grids", existing: false, confidence: "high", reason: "Because." },
      ]);
      expect(parsed.suggestedTags).toEqual(["CSS", "Rust", "grids"]);
    });

    it.each([["medium"], [undefined], [null], [true], ["HIGH"]])(
      "treats a confidence of %j as low",
      (confidence) => {
        const parsed = parse({ existing_tags: [tag("css", confidence)], new_tags: [] });
        expect(parsed.tagProposals?.map((proposal) => proposal.confidence)).toEqual(["low"]);
      },
    );

    it("treats a bare name as a low-confidence tag with no reason", () => {
      expect(parse({ existing_tags: ["css"], new_tags: ["grids"] }).tagProposals).toEqual([
        { name: "CSS", existing: true, confidence: "low", reason: "" },
        { name: "grids", existing: false, confidence: "low", reason: "" },
      ]);
    });

    it("cuts a long reason and ignores one that isn't text", () => {
      const parsed = parse({
        existing_tags: [tag("css", "high", "r".repeat(500)), tag("rust", "high", 7)],
        new_tags: [],
      });
      expect(parsed.tagProposals?.map((proposal) => proposal.reason)).toEqual([
        "r".repeat(200),
        "",
      ]);
    });

    it("drops the suggestions when a tag has no name", () => {
      const parsed = parse({ existing_tags: [{ confidence: "high" }], new_tags: [] });
      expect("tagProposals" in parsed).toBe(false);
      expect("suggestedTags" in parsed).toBe(false);
    });
  });

  it("still refuses a reading with no summary when the suggestions are fine", () => {
    const { summary: _dropped, ...rest } = reading;
    expect(() => parseReading({ ...rest, existing_tags: [], new_tags: [] }, mine)).toThrow(
      /no summary/,
    );
  });
});

describe("summaryRequest", () => {
  const html = {
    kind: "link" as const,
    url: "https://example.com/a",
    userId: "ana",
    title: "A page",
    text: "Some words.",
  };
  const pdf = {
    kind: "link" as const,
    url: "https://example.com/paper.pdf",
    userId: "ana",
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

  it("sends a note as its text alone, with no URL or page title, and asks about a note", () => {
    const request = summaryRequest({
      kind: "note",
      url: null,
      userId: "ana",
      title: null,
      text: "# Idea\n\nA body.",
    });
    expect(blocks(request)).toEqual([{ type: "text", text: "<note>\n# Idea\n\nA body.\n</note>" }]);
    expect(request.system).toContain("notes that someone wrote");
    expect(request.tools?.[0]).toMatchObject({ name: "save_reading" });
  });

  it("asks for the reading the same way for a PDF as for a page, tags included", () => {
    const request = summaryRequest({ ...pdf, userTags: ["papers"] });
    expect(request.tool_choice).toEqual({ type: "tool", name: "save_reading" });
    expect(request.tools?.[0]).toMatchObject({ name: "save_reading", strict: true });
    expect(JSON.stringify(blocks(request))).toContain("<your_tags>\\npapers\\n</your_tags>");
  });
});

describe("parseReading research verdict", () => {
  const domains = ["shipping", "Machine Learning"];
  const parse = (research: unknown, listed: readonly string[] | undefined = domains) =>
    parseReading({ ...reading, research }, undefined, listed).research;

  it("has no verdict when research wasn't asked for, even if the model sent one", () => {
    const parsed = parseReading({
      ...reading,
      research: { worth: true, domain: "shipping", reason: "Yes." },
    });
    expect(parsed).toEqual(reading);
    expect("research" in parsed).toBe(false);
  });

  it.each<[string, unknown, unknown]>([
    [
      "a verdict that is worth it",
      { worth: true, domain: "shipping", reason: "Ports matter." },
      { worth: true, domain: "shipping", reason: "Ports matter." },
    ],
    [
      "the user's spelling for a domain written in another case",
      { worth: true, domain: "machine learning", reason: "Ok." },
      { worth: true, domain: "Machine Learning", reason: "Ok." },
    ],
    [
      "a domain with stray spaces",
      { worth: true, domain: "  SHIPPING ", reason: "Ok." },
      { worth: true, domain: "shipping", reason: "Ok." },
    ],
    [
      "a verdict that is not worth it, with its domain cleared",
      { worth: false, domain: "shipping", reason: "A recipe." },
      { worth: false, domain: "", reason: "A recipe." },
    ],
    [
      "a worth in a domain the user does not have, which is not worth it",
      { worth: true, domain: "cooking", reason: "Tasty." },
      { worth: false, domain: "", reason: "Tasty." },
    ],
    [
      "a worth with no domain, which is not worth it",
      { worth: true, domain: "", reason: "Tasty." },
      { worth: false, domain: "", reason: "Tasty." },
    ],
    [
      "a reason trimmed and cut",
      { worth: true, domain: "shipping", reason: `  ${"r".repeat(400)}  ` },
      { worth: true, domain: "shipping", reason: "r".repeat(300) },
    ],
  ])("returns %s", (_label, verdict, expected) => {
    expect(parse(verdict)).toEqual(expected);
  });

  it.each<[string, unknown]>([
    ["missing", undefined],
    ["null", null],
    ["a string", "yes"],
    ["an array", [true]],
    ["worth as a string", { worth: "true", domain: "shipping", reason: "Ok." }],
    ["a domain that is not a string", { worth: true, domain: 3, reason: "Ok." }],
    ["a reason that is missing", { worth: true, domain: "shipping" }],
  ])("leaves the verdict out when it is %s, and the reading stands", (_label, verdict) => {
    expect(parseReading({ ...reading, research: verdict }, undefined, domains)).toEqual(reading);
  });
});

describe("summaryRequest research", () => {
  const page = {
    kind: "link" as const,
    url: "https://example.com/a",
    userId: "ana",
    title: "A page",
    text: "Some words.",
  };
  const research = { profile: "Developer at a shipping company", domains: ["shipping", "Rust"] };
  const schemaOf = (request: ReturnType<typeof summaryRequest>) =>
    (request.tools![0] as { input_schema: { properties: object; required: string[] } })
      .input_schema;

  it.each([
    ["the plain tool", {}],
    ["the tags tool", { userTags: ["css"] }],
  ])("%s has no research property when research isn't asked for", (_label, extra) => {
    const request = summaryRequest({ ...page, ...extra });
    expect(schemaOf(request).properties).not.toHaveProperty("research");
    expect(schemaOf(request).required).not.toContain("research");
    expect(request.system).not.toContain("<research_domains>");
  });

  it.each([
    ["the plain tool", {}, ["title", "summary", "excerpt", "research"]],
    [
      "the tags tool",
      { userTags: ["css"] },
      ["title", "summary", "excerpt", "existing_tags", "new_tags", "research"],
    ],
  ])("%s gets a strict research object when asked", (_label, extra, required) => {
    const request = summaryRequest({ ...page, ...extra, research });
    expect(request.tools?.[0]).toMatchObject({ strict: true });
    expect(request.tool_choice).toEqual({ type: "tool", name: "save_reading" });
    const schema = schemaOf(request);
    expect(schema).toMatchObject({ additionalProperties: false, required });
    expect(schema.properties).toMatchObject({
      research: {
        type: "object",
        required: ["worth", "domain", "reason"],
        additionalProperties: false,
        properties: {
          worth: { type: "boolean" },
          domain: { type: "string" },
          reason: { type: "string" },
        },
      },
    });
  });

  it("lists the profile and the domains one per line in the system prompt", () => {
    const { system } = summaryRequest({ ...page, research });
    expect(system).toContain("<about_me>\nDeveloper at a shipping company\n</about_me>");
    expect(system).toContain("<research_domains>\nshipping\nRust\n</research_domains>");
  });

  it("keeps the plain tool non-strict when research isn't asked for", () => {
    expect(summaryRequest(page).tools?.[0]).not.toHaveProperty("strict");
  });
});
