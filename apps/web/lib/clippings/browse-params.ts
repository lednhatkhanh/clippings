import {
  createLoader,
  createParser,
  createSerializer,
  parseAsStringLiteral,
  type inferParserType,
} from "nuqs/server";

import { CLIPPING_SOURCES, MAX_QUERY_LENGTH, SEARCH_SORTS } from "@clippings/shared";

/**
 * The query as typed, cut to what search reads. Not trimmed: nuqs parses the URL again after
 * each write, and a trim there would eat the space the user just typed between two words.
 */
const parseAsQuery = createParser({
  parse: (value) => value.slice(0, MAX_QUERY_LENGTH),
  serialize: (value) => value,
});

/** Sources as `web,mcp`: unknown names dropped, always in the order of `CLIPPING_SOURCES`. */
const parseAsSources = createParser({
  parse: (value) => {
    const named = new Set(value.split(","));
    return CLIPPING_SOURCES.filter((source) => named.has(source));
  },
  serialize: (sources) => CLIPPING_SOURCES.filter((source) => sources.includes(source)).join(","),
  eq: (a, b) => a.join() === b.join(),
});

/**
 * What the clippings list shows, as the URL says: `?q=` searches, `source=web,mcp` filters and
 * `sort=date` orders search results newest first. The server page, the route handler, the server
 * action and the browser (`useQueryStates`) all read it through these.
 */
export const browseParsers = {
  q: parseAsQuery.withDefault(""),
  sources: parseAsSources.withDefault([]),
  sort: parseAsStringLiteral(SEARCH_SORTS).withDefault("relevance"),
};

export const browseUrlKeys = { sources: "source" } as const;

export type BrowseParams = inferParserType<typeof browseParsers>;

/** Reads `BrowseParams` from a page's `searchParams`, a `Request`, `URLSearchParams` or a string. */
export const loadBrowseParams = createLoader(browseParsers, { urlKeys: browseUrlKeys });

const serialize = createSerializer(browseParsers, { urlKeys: browseUrlKeys });

/**
 * The canonical query string for these params, without the `?`: the query trimmed, defaults left
 * out, and the sort only beside a query, since it orders search results only. Empty for the plain
 * list. Equal params give equal strings, so it keys fetches too.
 */
export function toQueryString({ q, sources, sort }: BrowseParams): string {
  const query = q.trim();
  return serialize({ q: query, sources, sort: query ? sort : null }).replace(/^\?/, "");
}
