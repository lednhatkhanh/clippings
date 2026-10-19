import useSWR from "swr";

import type { Tag } from "@clippings/shared";

/** Where the tag picker reads the user's tags. */
const TAGS_KEY = "/api/tags";

async function fetchTags(url: string): Promise<Tag[]> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't load your tags (${response.status})`);
  return response.json();
}

/**
 * The user's tags, for the picker to offer. Empty until they load, or if they can't: a new tag can
 * still be typed. `refresh` reads them again after a save may have created one.
 */
export function useTags() {
  const { data, mutate } = useSWR(TAGS_KEY, fetchTags, { revalidateOnFocus: false });
  return { tags: data ?? [], refresh: () => void mutate() };
}
