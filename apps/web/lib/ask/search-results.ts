import type Anthropic from "@anthropic-ai/sdk";

import type { Clipping } from "@clippings/shared";

/** Most characters of a clipping's saved page text the model reads. */
export const MAX_PAGE_TEXT_CHARS = 6_000;

/** A clipping the question's search found, with what the model is shown of it. */
export interface AskSource {
  clipping: Pick<Clipping, "id" | "title" | "summary" | "note">;
  /** The page text kept when the page was read; null when there is none. */
  pageText: string | null;
}

/** The absolute link to a clipping's page in the app: a search result's `source`. */
export function clippingLink(origin: string, clippingId: string): string {
  return new URL(`/c/${clippingId}`, origin).toString();
}

/** The text blocks the model reads for one clipping: its summary, the user's note, its page text. */
function contentBlocks({ clipping, pageText }: AskSource): Anthropic.TextBlockParam[] {
  const parts = [
    clipping.summary?.trim() && `Summary: ${clipping.summary.trim()}`,
    clipping.note.trim() && `The user's note: ${clipping.note.trim()}`,
    pageText?.trim() && `Page text: ${pageText.trim().slice(0, MAX_PAGE_TEXT_CHARS)}`,
  ];
  return parts
    .filter((part): part is string => Boolean(part))
    .map((text) => ({ type: "text", text }));
}

/**
 * The `search_result` blocks for the clippings a question found, with citations on, and the
 * clipping each block's `source` link stands for. A clipping with nothing to read (no summary,
 * note or page text yet) is left out: the model could cite nothing from it.
 */
export function buildSearchResults(
  sources: readonly AskSource[],
  origin: string,
): { blocks: Anthropic.SearchResultBlockParam[]; clippingsByLink: Map<string, AskCited> } {
  const blocks: Anthropic.SearchResultBlockParam[] = [];
  const clippingsByLink = new Map<string, AskCited>();
  for (const source of sources) {
    const content = contentBlocks(source);
    if (content.length === 0) continue;
    const link = clippingLink(origin, source.clipping.id);
    blocks.push({
      type: "search_result",
      source: link,
      title: source.clipping.title,
      content,
      citations: { enabled: true },
    });
    clippingsByLink.set(link, { id: source.clipping.id, title: source.clipping.title });
  }
  return { blocks, clippingsByLink };
}

/** A clipping the answer may cite. */
export interface AskCited {
  id: string;
  title: string;
}
