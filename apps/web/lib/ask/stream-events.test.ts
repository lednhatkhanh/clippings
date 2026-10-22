import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import type { AskEvent } from "@clippings/shared";

import { answerEvents, ASK_CUT_OFF, ASK_UNANSWERED } from "./stream-events.ts";

type ModelEvent = Anthropic.RawMessageStreamEvent;

const LINK = "https://clippings.example/c/c1";
const CLIPPINGS = new Map([[LINK, { id: "c1", title: "First" }]]);

const text = (value: string): ModelEvent => ({
  type: "content_block_delta",
  index: 0,
  delta: { type: "text_delta", text: value },
});

const cite = (source: string, citedText = "quoted"): ModelEvent => ({
  type: "content_block_delta",
  index: 0,
  delta: {
    type: "citations_delta",
    citation: {
      type: "search_result_location",
      cited_text: citedText,
      search_result_index: 0,
      source,
      title: "ignored: the clipping's own title is used",
      start_block_index: 0,
      end_block_index: 1,
    },
  },
});

const stop = (reason: "end_turn" | "refusal" | "max_tokens"): ModelEvent =>
  ({
    type: "message_delta",
    delta: { stop_reason: reason, stop_sequence: null },
    usage: { output_tokens: 1 },
  }) as ModelEvent;

async function events(...modelEvents: ModelEvent[]): Promise<AskEvent[]> {
  async function* stream() {
    yield* modelEvents;
  }
  const out: AskEvent[] = [];
  for await (const event of answerEvents(stream(), CLIPPINGS)) out.push(event);
  return out;
}

describe("answerEvents", () => {
  it("passes text on as it comes and cites the clipping a citation names", async () => {
    expect(
      await events(text("It is "), text("high."), cite(LINK, "High tide"), stop("end_turn")),
    ).toEqual([
      { type: "text", text: "It is " },
      { type: "text", text: "high." },
      { type: "citation", clippingId: "c1", title: "First", citedText: "High tide" },
      { type: "done" },
    ]);
  });

  it("drops a citation of a source that is not one of the request's hits", async () => {
    const result = await events(
      text("Answer."),
      cite("https://clippings.example/c/someone-elses"),
      cite("https://evil.example/"),
      stop("end_turn"),
    );

    expect(result).toEqual([{ type: "text", text: "Answer." }, { type: "done" }]);
  });

  it("drops a citation that is not of a search result", async () => {
    const other: ModelEvent = {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "citations_delta",
        citation: {
          type: "web_search_result_location",
          cited_text: "x",
          encrypted_index: "e",
          title: null,
          url: LINK,
        },
      },
    };

    expect(await events(text("Answer."), other)).toEqual([
      { type: "text", text: "Answer." },
      { type: "done" },
    ]);
  });

  it("ignores events that carry no answer", async () => {
    const start: ModelEvent = { type: "content_block_stop", index: 0 };

    expect(await events(start, text("Hi"), stop("end_turn"))).toEqual([
      { type: "text", text: "Hi" },
      { type: "done" },
    ]);
  });

  it("keeps the answer and says it was cut off when the model hit its token limit", async () => {
    expect(await events(text("Half of "), cite(LINK), text("an ans"), stop("max_tokens"))).toEqual([
      { type: "text", text: "Half of " },
      { type: "citation", clippingId: "c1", title: "First", citedText: "quoted" },
      { type: "text", text: "an ans" },
      { type: "error", message: ASK_CUT_OFF },
    ]);
  });

  it.each([
    ["the model declines", [stop("refusal")]],
    ["the model says nothing", [text(""), stop("end_turn")]],
    ["the model hit its token limit before saying anything", [stop("max_tokens")]],
  ])("ends in an error when %s", async (_name, modelEvents) => {
    const result = await events(...modelEvents);

    expect(result.at(-1)).toEqual({ type: "error", message: ASK_UNANSWERED });
  });
});
