import type Anthropic from "@anthropic-ai/sdk";

import { MAX_BRIEF_LENGTH, type BriefSource } from "@clippings/shared";

/** Sources are shown as links, so only web addresses count. */
const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

export type ParsedBrief = { body: string; sources: BriefSource[] } | { error: string };

/**
 * Reads a written brief out of the model's reply: the body is its text blocks after the last web
 * search result (all of them when it searched nothing), since what the model says between
 * searches is it thinking aloud and not the brief. The sources are the pages the body cites (else
 * the pages the searches found), each once. An error says why there is no brief, for the note on a
 * dropped one.
 */
export function parseBrief(message: Anthropic.Message): ParsedBrief {
  const lastSearch = message.content.findLastIndex(
    (block) => block.type === "web_search_tool_result",
  );
  const written = message.content.slice(lastSearch + 1);
  const body = written
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();

  if (message.stop_reason === "refusal") return { error: "the model declined to write it" };
  // The search loop paused before the model wrote its answer: what text there is is partial.
  if (message.stop_reason === "pause_turn") return { error: "the web search didn't finish" };
  if (!body) {
    return {
      error:
        message.stop_reason === "max_tokens"
          ? "the model ran out of room before it wrote any text"
          : "the model wrote no text",
    };
  }

  const cited = new Map<string, string>();
  for (const block of written) {
    if (block.type !== "text") continue;
    for (const citation of block.citations ?? []) {
      if (citation.type === "web_search_result_location" && isWebUrl(citation.url)) {
        cited.set(citation.url, cited.get(citation.url) || citation.title?.trim() || "");
      }
    }
  }
  const found = new Map<string, string>();
  for (const block of message.content) {
    if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const result of block.content) {
      if (isWebUrl(result.url)) found.set(result.url, result.title.trim());
    }
  }

  const sources = [...(cited.size > 0 ? cited : found)].map(([url, title]) => ({
    url,
    title: title || url,
  }));
  return { body: body.slice(0, MAX_BRIEF_LENGTH), sources };
}
