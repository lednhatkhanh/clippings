import { and, eq, isNotNull, or, sql } from "drizzle-orm";

import {
  checkCanonicalTagName,
  MAX_TAGS_PER_CLIPPING,
  tagNameKey,
  type LibraryChangeAction,
} from "@clippings/shared";

import type { TagProposal } from "../clippings/ports.ts";
import type { Database } from "../database.ts";
import { clippingTags, clippingTagSuggestions, libraryChanges, tags } from "../schema.ts";

/** What `db.transaction` hands its callback. */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** What `applyAutoTags` did with the model's proposals. */
export interface AutoTagResult {
  /** The tags put on the clipping, in the order applied. */
  applied: string[];
  /** The proposals not applied that should wait as suggestions, in order. */
  suggested: string[];
}

/**
 * Applies the tags the model is confident in to a clipping, inside the transaction that makes
 * the clipping ready, and logs each in `library_changes` (actor `auto_tag`, status `applied`).
 *
 * - A `high` proposal naming one of the user's tags is applied (`add_tag`).
 * - A `high` proposal for a new tag is applied (`create_tag`) only when its name passes the
 *   canonical-name rule against all of the user's tags; otherwise it waits as a suggestion.
 * - A `low` proposal is a suggestion. So is one that would take the clipping past its tag limit.
 * - A tag the clipping already carries, one the user dismissed for this clipping, and one the
 *   user undid or took off by hand earlier are neither applied nor suggested again.
 *
 * It only adds links and tags: it never removes or renames anything. The caller has checked that
 * the clipping is the user's.
 */
export async function applyAutoTags(
  tx: Transaction,
  {
    userId,
    clippingId,
    proposals,
    at,
  }: { userId: string; clippingId: string; proposals: readonly TagProposal[]; at: Date },
): Promise<AutoTagResult> {
  const result: AutoTagResult = { applied: [], suggested: [] };
  if (proposals.length === 0) return result;

  const mine = await tx
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.userId, userId));
  const byKey = new Map(mine.map((tag) => [tagNameKey(tag.name), tag]));
  const carried = await tx
    .select({ tagId: clippingTags.tagId })
    .from(clippingTags)
    .where(and(eq(clippingTags.clippingId, clippingId), eq(clippingTags.userId, userId)));
  const carriedIds = new Set(carried.map((link) => link.tagId));
  const namesBefore = mine.filter((tag) => carriedIds.has(tag.id)).map((tag) => tag.name);

  const dismissed = await tx
    .select({ name: clippingTagSuggestions.name })
    .from(clippingTagSuggestions)
    .where(
      and(
        eq(clippingTagSuggestions.clippingId, clippingId),
        eq(clippingTagSuggestions.userId, userId),
        isNotNull(clippingTagSuggestions.dismissedAt),
      ),
    );
  // Undone, or still `applied` but no longer on the clipping: the user took it off by hand (the
  // tag picker, a bulk edit), which says the same as Undo.
  const undone = await tx
    .select({ name: sql<string>`${libraryChanges.after}->'tag'->>'name'` })
    .from(libraryChanges)
    .where(
      and(
        eq(libraryChanges.userId, userId),
        eq(libraryChanges.actor, "auto_tag"),
        sql`${libraryChanges.targetIds}[1] = ${clippingId}::uuid`,
        or(
          eq(libraryChanges.status, "undone"),
          and(
            eq(libraryChanges.status, "applied"),
            sql`not exists (
              select 1 from ${clippingTags}
              where ${clippingTags.clippingId} = ${clippingId}::uuid
                and ${clippingTags.tagId} = ${libraryChanges.targetIds}[2]
                and ${clippingTags.userId} = ${userId}
            )`,
          ),
        ),
      ),
    );
  const refused = new Set([...dismissed, ...undone].map(({ name }) => tagNameKey(name ?? "")));

  const namesNow = [...namesBefore];
  for (const proposal of proposals) {
    const key = tagNameKey(proposal.name);
    const known = byKey.get(key);
    if (known && carriedIds.has(known.id)) continue;
    if (refused.has(key)) continue;
    if (proposal.confidence !== "high" || namesNow.length >= MAX_TAGS_PER_CLIPPING) {
      result.suggested.push(proposal.name);
      continue;
    }

    let tag: { id: string; name: string } | undefined = known;
    let action: LibraryChangeAction = "add_tag";
    if (!tag) {
      // The model called it one of the user's tags, but it is gone: not worth creating blind.
      const canonical = proposal.existing
        ? ({ ok: false } as const)
        : checkCanonicalTagName(
            proposal.name,
            mine.map((other) => other.name),
          );
      if (!canonical.ok) {
        result.suggested.push(proposal.name);
        continue;
      }
      const [created] = await tx
        .insert(tags)
        .values({ userId, name: canonical.name, createdAt: at })
        .onConflictDoNothing()
        .returning({ id: tags.id, name: tags.name });
      if (!created) {
        // Another save created it between the read above and now.
        result.suggested.push(proposal.name);
        continue;
      }
      tag = created;
      action = "create_tag";
      mine.push(created);
      byKey.set(tagNameKey(created.name), created);
    }

    const [linked] = await tx
      .insert(clippingTags)
      .values({ clippingId, tagId: tag.id, userId })
      .onConflictDoNothing()
      .returning({ tagId: clippingTags.tagId });
    if (!linked) continue;
    carriedIds.add(tag.id);
    const namesAfter = [...namesNow, tag.name];
    await tx.insert(libraryChanges).values({
      userId,
      actor: "auto_tag",
      action,
      targetIds: [clippingId, tag.id],
      before: { tags: namesNow },
      after: { tags: namesAfter, tag: { id: tag.id, name: tag.name } },
      confidence: proposal.confidence,
      status: "applied",
      reason: proposal.reason || "The model judged that it fits this page",
      createdAt: at,
    });
    namesNow.push(tag.name);
    result.applied.push(tag.name);
  }
  return result;
}
