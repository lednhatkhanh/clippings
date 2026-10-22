import Anthropic from "@anthropic-ai/sdk";

import type { PreparedAsk } from "./request.ts";

/** Asks the model and returns its stream of events. */
export type Answerer = (
  params: PreparedAsk["params"],
  signal: AbortSignal,
) => Promise<AsyncIterable<Anthropic.RawMessageStreamEvent>>;

const MODEL_TIMEOUT_MS = 60_000;

/**
 * Claude, streaming. Reads `ANTHROPIC_API_KEY` and, for the local fake, `ANTHROPIC_BASE_URL`,
 * both through the SDK.
 */
export function createAnswerer(): Answerer {
  // Built on first use, so a missing key breaks asking and not every page that loads.
  let client: Anthropic | undefined;
  return (params, signal) => {
    // One retry covers a dropped connection before the answer starts; a stream is never replayed.
    client ??= new Anthropic({ maxRetries: 1, timeout: MODEL_TIMEOUT_MS });
    return client.messages.create(params, { signal });
  };
}
