import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { MAX_BRIEF_LENGTH } from "@clippings/shared";

import { parseBrief } from "./parse-brief.ts";

type Block = Anthropic.ContentBlock;

const cite = (url: string, title: string | null = "A title") => ({
  type: "web_search_result_location" as const,
  url,
  title,
  cited_text: "…",
  encrypted_index: "x",
});

const text = (value: string, citations: unknown[] = []) =>
  ({ type: "text", text: value, citations: citations.length > 0 ? citations : null }) as Block;

const searched = (...urls: string[]) =>
  ({
    type: "web_search_tool_result",
    tool_use_id: "srvtoolu_1",
    content: urls.map((url) => ({
      type: "web_search_result",
      url,
      title: `Found ${url}`,
      encrypted_content: "x",
      page_age: null,
    })),
  }) as unknown as Block;

const reply = (content: Block[], stop_reason: Anthropic.StopReason = "end_turn") =>
  ({ content, stop_reason }) as Anthropic.Message;

describe("parseBrief", () => {
  it("joins the text blocks and lists the cited pages", () => {
    const parsed = parseBrief(
      reply([
        text("First. ", [cite("https://a.example/x", "Page A")]),
        text("Second.", [cite("https://c.example/z", "Page C")]),
        text(" Third."),
      ]),
    );

    expect(parsed).toEqual({
      body: "First. Second. Third.",
      sources: [
        { url: "https://a.example/x", title: "Page A" },
        { url: "https://c.example/z", title: "Page C" },
      ],
    });
  });

  it.each([
    [
      "text before the last search is left out",
      [
        text("Let me look that up. "),
        searched("https://a.example/x"),
        text("I'll search again. "),
        searched("https://b.example/y"),
        text("# The brief\n\nBody."),
      ],
      "# The brief\n\nBody.",
    ],
    [
      "every text block after the last search is kept",
      [text("Thinking. "), searched("https://a.example/x"), text("# The brief\n\n"), text("Body.")],
      "# The brief\n\nBody.",
    ],
    ["all the text is kept when there was no search", [text("One. "), text("Two.")], "One. Two."],
  ])("%s", (_what, content, body) => {
    expect(parseBrief(reply(content as Block[]))).toMatchObject({ body });
  });

  it("lists only the pages the kept text cites", () => {
    const parsed = parseBrief(
      reply([
        text("Searching. ", [cite("https://pre.example/p", "Before")]),
        searched("https://a.example/x"),
        text("The brief.", [cite("https://a.example/x", "After")]),
      ]),
    );

    expect("sources" in parsed && parsed.sources).toEqual([
      { url: "https://a.example/x", title: "After" },
    ]);
  });

  it("lists a page once, however often it is cited", () => {
    const parsed = parseBrief(
      reply([
        text("One. ", [cite("https://a.example/x", "Page A")]),
        text("Two.", [
          cite("https://a.example/x", "Page A again"),
          cite("https://a.example/x", null),
        ]),
      ]),
    );

    expect("sources" in parsed && parsed.sources).toEqual([
      { url: "https://a.example/x", title: "Page A" },
    ]);
  });

  it("falls back to the pages the searches found when nothing is cited", () => {
    const parsed = parseBrief(
      reply([
        searched("https://a.example/x", "https://a.example/x", "https://b.example/y"),
        text("Body."),
      ]),
    );

    expect("sources" in parsed && parsed.sources).toEqual([
      { url: "https://a.example/x", title: "Found https://a.example/x" },
      { url: "https://b.example/y", title: "Found https://b.example/y" },
    ]);
  });

  it("names a source by its address when it has no title, and drops addresses that aren't web pages", () => {
    const parsed = parseBrief(
      reply([
        text("Body.", [cite("https://a.example/x", null), cite("javascript:alert(1)", "Bad")]),
      ]),
    );

    expect("sources" in parsed && parsed.sources).toEqual([
      { url: "https://a.example/x", title: "https://a.example/x" },
    ]);
  });

  it("has no sources when there are none, and still gives the body", () => {
    expect(parseBrief(reply([text("Just words.")]))).toEqual({ body: "Just words.", sources: [] });
  });

  it("cuts a body that is too long", () => {
    const parsed = parseBrief(reply([text("x".repeat(MAX_BRIEF_LENGTH + 10))]));

    expect("body" in parsed && parsed.body).toHaveLength(MAX_BRIEF_LENGTH);
  });

  it.each([
    ["a refusal, whatever text it has", reply([text("I can't.")], "refusal")],
    ["a search that paused before the answer", reply([text("Let me look.")], "pause_turn")],
    ["no text at all", reply([searched("https://a.example/x")])],
    [
      "text only before the last search",
      reply([text("Looking."), searched("https://a.example/x")]),
    ],
    ["blank text", reply([text("  \n ")])],
    ["a reply that ran out of room before any text", reply([], "max_tokens")],
  ])("is an error for %s", (_what, message) => {
    expect(parseBrief(message)).toEqual({ error: expect.any(String) });
  });
});
