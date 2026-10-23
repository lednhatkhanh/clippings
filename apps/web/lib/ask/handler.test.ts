import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createServiceFixture,
  TEST_DATABASE_URL,
  type ServiceFixture,
} from "@clippings/db/testing";
import { ASK_NO_MATCH, MAX_QUESTION_LENGTH, type AskEvent } from "@clippings/shared";

import { handleAsk, type AskDeps } from "./handler.ts";
import type { Answerer } from "./model.ts";
import { clippingLink } from "./search-results.ts";

const ORIGIN = "https://clippings.example";

function post(body: unknown, signal?: AbortSignal): Request {
  return new Request(`${ORIGIN}/api/ask`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function readEvents(response: Response): Promise<AskEvent[]> {
  const lines = (await response.text()).split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line) as AskEvent);
}

describe("POST /api/ask, before anything is searched", () => {
  const answer = vi.fn<Answerer>();
  const searchClippings = vi.fn();
  const deps = (userId: string | null): AskDeps => ({
    getUserId: async () => userId,
    // Reaching the service from here would be a bug.
    clippings: { searchClippings, getClippingText: vi.fn() },
    origin: ORIGIN,
    answer,
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("answers 401 without a session, and asks nothing", async () => {
    const response = await handleAsk(post({ question: "What?" }), deps(null));

    expect(response.status).toBe(401);
    expect(searchClippings).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
  });

  it.each([
    ["no body", ""],
    ["a body that is not JSON", "{nope"],
    ["no question", {}],
    ["a question that is not text", { question: 7 }],
    ["a blank question", { question: "   " }],
    ["a question over the limit", { question: "q".repeat(MAX_QUESTION_LENGTH + 1) }],
  ])("answers 400 for %s", async (_name, body) => {
    const response = await handleAsk(post(body), deps("ana"));

    expect(response.status).toBe(400);
    expect(searchClippings).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
  });
});

describe.skipIf(!TEST_DATABASE_URL)("POST /api/ask, answering from the clippings", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  const deltaOf = (delta: Anthropic.RawContentBlockDelta): Anthropic.RawMessageStreamEvent => ({
    type: "content_block_delta",
    index: 0,
    delta,
  });

  /** An answerer that streams `events` and records the requests it got. */
  function model(...events: Anthropic.RawMessageStreamEvent[]) {
    const requests: Parameters<Answerer>[0][] = [];
    const answer: Answerer = async (params) => {
      requests.push(params);
      return (async function* () {
        yield* events;
      })();
    };
    return { answer, requests };
  }

  const deps = (userId: string, answer: Answerer): AskDeps => ({
    getUserId: async () => userId,
    clippings: fixture.service,
    origin: ORIGIN,
    answer,
  });

  async function save(userId: string, note: string) {
    const { clipping } = await fixture.service.saveClipping(userId, {
      url: `https://example.com/${userId}/${note.length}`,
      note,
      source: "web",
    });
    return clipping;
  }

  it("streams the answer with its citations, as lines of JSON", async () => {
    const ana = await fixture.createUser("ana");
    const clipping = await save(ana, "Compost needs turning weekly");
    const { answer, requests } = model(
      deltaOf({ type: "text_delta", text: "Turn it weekly." }),
      deltaOf({
        type: "citations_delta",
        citation: {
          type: "search_result_location",
          cited_text: "Compost needs turning weekly",
          search_result_index: 0,
          source: clippingLink(ORIGIN, clipping.id),
          title: clipping.title,
          start_block_index: 0,
          end_block_index: 1,
        },
      }),
    );

    const response = await handleAsk(post({ question: "compost" }), deps(ana, answer));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/x-ndjson/);
    expect(await readEvents(response)).toEqual([
      { type: "text", text: "Turn it weekly." },
      {
        type: "citation",
        clippingId: clipping.id,
        title: clipping.title,
        citedText: "Compost needs turning weekly",
      },
      { type: "done" },
    ]);
    expect(requests).toHaveLength(1);
  });

  it("says nothing matches, without asking the model, when no clipping does", async () => {
    const ana = await fixture.createUser("ana");
    await save(ana, "Compost needs turning weekly");
    const { answer, requests } = model();

    const response = await handleAsk(
      post({ question: "quantum chromodynamics" }),
      deps(ana, answer),
    );

    expect(await readEvents(response)).toEqual([
      { type: "text", text: ASK_NO_MATCH },
      { type: "done" },
    ]);
    expect(requests).toEqual([]);
  });

  it("never offers the model, or the answer, another user's clipping", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    const bens = await save(ben, "Ben keeps his compost notes private");
    const { answer, requests } = model(
      deltaOf({ type: "text_delta", text: "From Ben." }),
      deltaOf({
        type: "citations_delta",
        citation: {
          type: "search_result_location",
          cited_text: "x",
          search_result_index: 0,
          source: clippingLink(ORIGIN, bens.id),
          title: null,
          start_block_index: 0,
          end_block_index: 1,
        },
      }),
    );

    const response = await handleAsk(post({ question: "compost" }), deps(ana, answer));

    expect(await readEvents(response)).toEqual([
      { type: "text", text: ASK_NO_MATCH },
      { type: "done" },
    ]);
    expect(requests).toEqual([]);
  });

  it("never asks the model for a caller that already left", async () => {
    const ana = await fixture.createUser("ana");
    await save(ana, "Compost needs turning weekly");
    const answer = vi.fn<Answerer>();

    const response = await handleAsk(
      post({ question: "compost" }, AbortSignal.abort()),
      deps(ana, answer),
    );

    expect(response.body).toBeNull();
    expect(answer).not.toHaveBeenCalled();
  });

  it("stops the model call when the caller cancels the stream", async () => {
    const ana = await fixture.createUser("ana");
    await save(ana, "Compost needs turning weekly");
    let given: AbortSignal | undefined;
    // A model that goes on until its call is aborted.
    const slow: Answerer = async (_params, signal) => {
      given = signal;
      const aborted = new Promise((resolve) =>
        signal.addEventListener("abort", resolve, { once: true }),
      );
      return {
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            await aborted;
            return { done: true, value: undefined };
          },
        }),
      };
    };

    const response = await handleAsk(post({ question: "compost" }), deps(ana, slow));
    const reader = response.body!.getReader();
    const reading = reader.read();
    await vi.waitFor(() => expect(given).toBeDefined());
    expect(given!.aborted).toBe(false);

    await reader.cancel();
    await reading;

    expect(given!.aborted).toBe(true);
  });

  it("ends the stream with an error when the model call fails", async () => {
    const ana = await fixture.createUser("ana");
    await save(ana, "Compost needs turning weekly");
    const failing: Answerer = async () => {
      throw new Error("overloaded");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleAsk(post({ question: "compost" }), deps(ana, failing));

    expect(response.status).toBe(200);
    expect(await readEvents(response)).toEqual([
      { type: "error", message: expect.stringContaining("Couldn't get an answer") },
    ]);
  });
});
