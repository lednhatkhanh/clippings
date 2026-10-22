import type Anthropic from "@anthropic-ai/sdk";

import type { AskEvent } from "@clippings/shared";

import type { AskCited } from "./search-results.ts";

/** Shown when the model gave no answer: it declined, or ran out of room before saying anything. */
export const ASK_UNANSWERED = "Couldn't get an answer. Try asking another way.";

/** Ends an answer that stopped at the token limit: what was written stays. */
export const ASK_CUT_OFF = "The answer was cut off.";

/**
 * The answer stream's events for the model's own: each text delta as it comes, and each citation
 * of one of `clippingsByLink`'s clippings. A citation of any other source, or of anything but a
 * search result, is dropped: the answer may link only to this request's hits. Ends with `done`, or
 * with `error`: the model declined, said nothing, or stopped at the token limit (the text and
 * citations before that stand).
 */
export async function* answerEvents(
  modelEvents: AsyncIterable<Anthropic.RawMessageStreamEvent>,
  clippingsByLink: ReadonlyMap<string, AskCited>,
): AsyncGenerator<AskEvent> {
  let wrote = false;
  let refused = false;
  let cutOff = false;
  for await (const event of modelEvents) {
    if (event.type === "message_delta") {
      refused ||= event.delta.stop_reason === "refusal";
      cutOff ||= event.delta.stop_reason === "max_tokens";
      continue;
    }
    if (event.type !== "content_block_delta") continue;

    const { delta } = event;
    if (delta.type === "text_delta") {
      if (!delta.text) continue;
      wrote = true;
      yield { type: "text", text: delta.text };
    } else if (delta.type === "citations_delta") {
      const { citation } = delta;
      if (citation.type !== "search_result_location") continue;
      const cited = clippingsByLink.get(citation.source);
      if (cited) {
        yield {
          type: "citation",
          clippingId: cited.id,
          title: cited.title,
          citedText: citation.cited_text,
        };
      }
    }
  }
  if (refused || !wrote) yield { type: "error", message: ASK_UNANSWERED };
  else if (cutOff) yield { type: "error", message: ASK_CUT_OFF };
  else yield { type: "done" };
}
