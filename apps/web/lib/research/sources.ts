import type { BriefSource } from "@clippings/shared";

/**
 * The sources a page may link to: only web addresses (a `javascript:` or `data:` URL the model
 * cited would run in the user's session), with the address standing in for a missing title.
 */
export function linkableSources(sources: readonly BriefSource[]): BriefSource[] {
  return sources.flatMap(({ url, title }) => {
    try {
      const { protocol } = new URL(url);
      if (protocol !== "https:" && protocol !== "http:") return [];
    } catch {
      return [];
    }
    return [{ url, title: title.trim() || url }];
  });
}
