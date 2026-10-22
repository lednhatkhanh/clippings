import {
  ASK_NO_MATCH,
  askRequestSchema,
  MAX_QUESTION_LENGTH,
  type AskEvent,
} from "@clippings/shared";

import type { Answerer } from "./model.ts";
import { prepareAsk, type AskClippings } from "./request.ts";
import { answerEvents, ASK_UNANSWERED } from "./stream-events.ts";

export interface AskDeps {
  /** The signed-in user's id, or null without a session. */
  getUserId: () => Promise<string | null>;
  clippings: AskClippings;
  /** The app's origin, for the links the answer cites. */
  origin: string;
  answer: Answerer;
}

const encoder = new TextEncoder();

/** The answer to a request whose caller already left (nginx's 499): nobody reads it. */
const gone = () => new Response(null, { status: 499 });

/** The events as a newline-delimited JSON response, ended early when the caller goes away. */
function ndjson(events: AsyncGenerator<AskEvent>, abort: AbortController): Response {
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await events.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
    },
    async cancel() {
      abort.abort();
      await events.return(undefined);
    },
  });
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

async function* fixed(...events: AskEvent[]): AsyncGenerator<AskEvent> {
  yield* events;
}

/** `answerEvents` for a model call that may fail, before or during the stream: it ends in `error`. */
async function* answered(
  deps: AskDeps,
  prepared: NonNullable<Awaited<ReturnType<typeof prepareAsk>>>,
  signal: AbortSignal,
): AsyncGenerator<AskEvent> {
  try {
    yield* answerEvents(await deps.answer(prepared.params, signal), prepared.clippingsByLink);
  } catch (error) {
    if (signal.aborted) return;
    console.error("Couldn't answer from the clippings", error);
    yield { type: "error", message: ASK_UNANSWERED };
  }
}

/**
 * `POST /api/ask`: answers a question from the signed-in user's own clippings, streamed as
 * newline-delimited `AskEvent`s. The question searches only that user's clippings; with no match
 * the answer is fixed and the model is not asked.
 */
export async function handleAsk(request: Request, deps: AskDeps): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return new Response("Not signed in", { status: 401 });

  const body = askRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return new Response(`Send a question of 1 to ${MAX_QUESTION_LENGTH} characters`, {
      status: 400,
    });
  }

  let prepared: Awaited<ReturnType<typeof prepareAsk>>;
  try {
    prepared = await prepareAsk(
      deps.clippings,
      userId,
      body.data.question,
      deps.origin,
      request.signal,
    );
  } catch (error) {
    if (request.signal.aborted) return gone();
    console.error("Couldn't search the clippings for a question", error);
    return new Response("Couldn't search your clippings", { status: 500 });
  }
  // The caller left while the clippings were read: nobody is waiting for an answer.
  if (request.signal.aborted) return gone();

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const events = prepared
    ? answered(deps, prepared, abort.signal)
    : fixed({ type: "text", text: ASK_NO_MATCH }, { type: "done" });
  return ndjson(events, abort);
}
