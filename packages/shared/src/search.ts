import type { Clipping } from "./clipping.ts";

/** How search results are ordered: best match first, or newest first. */
export const SEARCH_SORTS = ["relevance", "date"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

/** Most results one search returns, best first. */
export const SEARCH_RESULT_LIMIT = 50;

/** Longest query search reads, in characters. The rest is ignored. */
export const MAX_QUERY_LENGTH = 200;

/** A run of text, marked when it is a term the query matched. */
export interface TextSegment {
  text: string;
  match: boolean;
}

/** Where a clipping matched a query. */
export interface SearchHighlights {
  /** The whole title, with its matched terms marked. */
  title: TextSegment[];
  /** A passage of the note, or else the excerpt, around the terms it matched; null when neither did. */
  snippet: TextSegment[] | null;
}

/** One search result. */
export interface SearchHit {
  clipping: Clipping;
  highlights: SearchHighlights;
}
