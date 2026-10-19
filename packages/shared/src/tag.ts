/**
 * The colors a tag can have, stored as names and rendered through each palette's tag tokens.
 * `none` keeps the tag quiet: its chip shows the name alone.
 */
export const TAG_COLORS = [
  "none",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

/** Longest tag name, in characters. */
export const MAX_TAG_LENGTH = 50;

/** Most tags one clipping can carry. */
export const MAX_TAGS_PER_CLIPPING = 20;

/** One of the user's tags. Names are unique per user, ignoring case. */
export interface Tag {
  id: string;
  name: string;
  color: TagColor;
}

/** A tag name as uniqueness sees it: "Work" and "work" are the same tag. */
export const tagNameKey = (name: string): string => name.toLowerCase();

/**
 * The name as stored: trimmed, with runs of whitespace made one space. Empty when there is no
 * name left.
 */
export const normalizeTagName = (name: string): string => name.trim().replace(/\s+/g, " ");

/**
 * The names as stored, empty ones dropped and each kept once, ignoring case: the first spelling
 * wins.
 */
export function normalizeTagNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const name of names.map(normalizeTagName)) {
    const key = tagNameKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    kept.push(name);
  }
  return kept;
}
