import { describe, expect, it } from "vitest";

import type { AskEvent } from "@clippings/shared";

import {
  ASKING_ANSWER,
  CUT_OFF_MESSAGE,
  endAnswer,
  readEvents,
  reduceAnswer,
  type AnswerState,
} from "./answer.ts";

const text = (value: string): AskEvent => ({ type: "text", text: value });
const cite = (clippingId: string, title = `Title ${clippingId}`): AskEvent => ({
  type: "citation",
  clippingId,
  title,
  citedText: "quoted",
});

const apply = (events: AskEvent[]): AnswerState => events.reduce(reduceAnswer, ASKING_ANSWER);

describe("reduceAnswer", () => {
  it("joins the text that streams in", () => {
    const state = apply([text("It "), text("is "), text("high.")]);

    expect(state.parts).toEqual([{ type: "text", text: "It is high." }]);
    expect(state.status).toBe("asking");
  });

  it("numbers each cited clipping once, in the order it is first cited", () => {
    const state = apply([
      text("A."),
      cite("a"),
      text("B."),
      cite("b"),
      text("A again."),
      cite("a"),
    ]);

    expect(state.sources).toEqual([
      { id: "a", title: "Title a" },
      { id: "b", title: "Title b" },
    ]);
    expect(state.parts).toEqual([
      { type: "text", text: "A." },
      { type: "cite", number: 1 },
      { type: "text", text: "B." },
      { type: "cite", number: 2 },
      { type: "text", text: "A again." },
      { type: "cite", number: 1 },
    ]);
  });

  it("shows one marker for the same source cited twice in a row", () => {
    const state = apply([text("A."), cite("a"), cite("a"), cite("b"), cite("b")]);

    expect(state.parts).toEqual([
      { type: "text", text: "A." },
      { type: "cite", number: 1 },
      { type: "cite", number: 2 },
    ]);
  });

  it("is done on done and failed on error, keeping what streamed", () => {
    expect(apply([text("Hi"), { type: "done" }])).toMatchObject({ status: "done" });

    const failed = apply([text("Hi"), { type: "error", message: "Nope" }]);
    expect(failed).toMatchObject({ status: "error", error: "Nope" });
    expect(failed.parts).toEqual([{ type: "text", text: "Hi" }]);
  });
});

describe("endAnswer", () => {
  it("fails an answer the stream left unfinished, and leaves a finished one", () => {
    const unfinished = apply([text("Hi")]);
    expect(endAnswer(unfinished)).toMatchObject({ status: "error", error: CUT_OFF_MESSAGE });

    const done = apply([text("Hi"), { type: "done" }]);
    expect(endAnswer(done)).toBe(done);
    const failed = apply([{ type: "error", message: "Nope" }]);
    expect(endAnswer(failed)).toBe(failed);
  });
});

describe("readEvents", () => {
  const line = (event: AskEvent) => `${JSON.stringify(event)}\n`;

  it("reads each complete line of a chunk", () => {
    const { events, rest } = readEvents("", line(text("a")) + line({ type: "done" }));

    expect(events).toEqual([text("a"), { type: "done" }]);
    expect(rest).toBe("");
  });

  it("holds a line that is cut across chunks until it is whole", () => {
    const whole = line(cite("a"));
    const first = readEvents("", line(text("a")) + whole.slice(0, 12));
    const second = readEvents(first.rest, whole.slice(12));

    expect(first.events).toEqual([text("a")]);
    expect(second.events).toEqual([cite("a")]);
    expect(second.rest).toBe("");
  });

  it("keeps a last line with no newline as the rest", () => {
    const { events, rest } = readEvents("", `${line(text("a"))}{"type":"done"}`);

    expect(events).toEqual([text("a")]);
    expect(rest).toBe('{"type":"done"}');
  });

  it.each([
    ["blank lines", "\n\n"],
    ["a line that is not JSON", "not json\n"],
    ["JSON that is not an event", '{"type":"unknown"}\n'],
    ["an event missing a field", '{"type":"citation","clippingId":"a"}\n'],
  ])("skips %s", (_name, chunk) => {
    expect(readEvents("", chunk + line(text("ok")))).toEqual({ events: [text("ok")], rest: "" });
  });
});
