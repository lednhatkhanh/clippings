/**
 * Fewest characters, spaces left out, a search query needs before it is worth embedding. Search
 * runs as the reader types, and a prefix of a word has no meaning to find yet, so it searches by
 * words alone until the query has enough to mean something.
 */
const MIN_EMBEDDED_QUERY_CHARACTERS = 4;

/** Whether `query` is long enough to search by meaning as well as by words. */
export function isWorthEmbedding(query: string): boolean {
  let count = 0;
  for (const character of query) {
    if (/\s/u.test(character)) continue;
    count += 1;
    if (count >= MIN_EMBEDDED_QUERY_CHARACTERS) return true;
  }
  return false;
}
