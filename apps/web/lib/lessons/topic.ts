import { isBefore, parseISO } from "date-fns";

import type { LessonMaterial, LessonMaterialTag } from "@clippings/db";

/** How many of the latest lessons put their tag on cooldown. */
const COOLDOWN_LESSONS = 4;
/** A tag with this many items and no topic page is a gap the lesson can fill. */
const GAP_MIN_ITEMS = 3;

/**
 * What a lesson is about. A `tag` pick teaches that tag's subject from its items (`why`: it has
 * recent saves, or it is a gap in the library); `recent` teaches whatever was saved lately, when no
 * tag stands out.
 */
export type LessonTopic =
  | { kind: "tag"; tagId: string; name: string; why: "recent" | "gap" }
  | { kind: "recent" };

/**
 * No topic page yet for a tag with enough items, or a page older than the tag's newest item: the
 * library knows more than the page says.
 */
function isGap(tag: LessonMaterialTag): boolean {
  if (!tag.topicPage) return tag.itemCount >= GAP_MIN_ITEMS;
  return isBefore(parseISO(tag.topicPage.updatedAt), parseISO(tag.newestItemAt));
}

const byWeight = (a: { score: number; tag: LessonMaterialTag }, b: typeof a) =>
  b.score - a.score || b.tag.itemCount - a.tag.itemCount || a.tag.name.localeCompare(b.tag.name);

/**
 * Picks the subject of a user's lesson from their library, or null when there is nothing to teach
 * from.
 *
 * A tag a recent lesson was about (any of the last four) is left alone. Of the rest, a candidate
 * is a tag with a save in the last two weeks or a gap, scored `recentCount * 2`, plus 3 for a gap;
 * the best score wins, then the tag with more items, then the name. With no candidate, the recent
 * saves are the topic; with no recent saves either, the biggest tag off cooldown is.
 */
export function pickLessonTopic(material: LessonMaterial): LessonTopic | null {
  const cooling = new Set(
    material.past.slice(0, COOLDOWN_LESSONS).flatMap((lesson) => lesson.tagId ?? []),
  );
  const open = material.tags.filter((tag) => !cooling.has(tag.id));

  const candidates = open
    .map((tag) => ({ tag, gap: isGap(tag) }))
    .filter(({ tag, gap }) => tag.recentCount >= 1 || gap)
    .map(({ tag, gap }) => ({ tag, gap, score: tag.recentCount * 2 + (gap ? 3 : 0) }))
    .toSorted(byWeight);

  const best = candidates[0];
  if (best) {
    const why = best.gap && best.tag.recentCount === 0 ? "gap" : "recent";
    return { kind: "tag", tagId: best.tag.id, name: best.tag.name, why };
  }
  if (material.recent.length > 0) return { kind: "recent" };

  const biggest = open
    .map((tag) => ({ tag, score: 0 }))
    .toSorted(byWeight)
    .at(0);
  return biggest
    ? { kind: "tag", tagId: biggest.tag.id, name: biggest.tag.name, why: "recent" }
    : null;
}
