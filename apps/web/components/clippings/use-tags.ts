import useSWR, { mutate } from "swr";

import type { Tag } from "@clippings/shared";

/** Where the tag picker reads the user's tags. */
const TAGS_KEY = "/api/tags";

async function fetchTags(url: string): Promise<Tag[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't load your tags (${response.status})`);
  return response.json();
}

/**
 * Forgets the tags read so far, wherever the picker is open or not: the next open reads them
 * again. For a change made away from the picker (the tags page, an import).
 */
export function refreshTags() {
  void mutate(TAGS_KEY, undefined, { revalidate: true });
}

/**
 * The user's tags, for the picker to offer. Empty until they load, or if they can't: a new tag can
 * still be typed. They are read once and kept, not read on each open: `refresh` reads them again
 * after a save may have created one, and `refreshTags` after a change made elsewhere.
 */
export function useTags() {
  const { data, mutate: revalidate } = useSWR(TAGS_KEY, fetchTags, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  });
  return { tags: data ?? [], refresh: () => void revalidate() };
}
