/** A tag name as comparison sees it: the service matches names ignoring case. */
const fold = (name: string) => name.trim().toLowerCase();

/**
 * The suggestions to show: those the clipping doesn't carry as a tag yet (ignoring case) and the
 * user hasn't just accepted or dismissed here, each once, in the order given.
 */
export function visibleSuggestions(
  suggested: readonly string[],
  tagNames: readonly string[],
  gone: readonly string[],
): string[] {
  const hidden = new Set([...tagNames, ...gone].map(fold));
  const seen = new Set<string>();
  return suggested.filter((name) => {
    const key = fold(name);
    if (!key || hidden.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
