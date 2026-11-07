import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "../database.ts";
import { clippingTagSuggestions, libraryChanges } from "../schema.ts";

/** What `db.transaction` hands its callback. */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/*
 * A tag the model proposes for a clipping can wait in two lists: the clipping's own tag
 * suggestions (`clipping_tag_suggestions`) and, once the librarian files it as an unsure
 * `add_tag`, the library review (`library_changes`, status `suggested`). Deciding one decides the
 * other, so the user is not asked again about something they settled.
 */

/**
 * Dismisses the librarian's `add_tag` suggestions for this clipping, for the tags with these names
 * (ignoring case) or for every tag when `names` is left out. A tag is matched by its name now.
 */
export async function dismissAddTagChanges(
  tx: Transaction,
  userId: string,
  clippingId: string,
  names?: readonly string[],
): Promise<void> {
  await tx
    .update(libraryChanges)
    .set({ status: "dismissed" })
    .where(
      and(
        eq(libraryChanges.userId, userId),
        eq(libraryChanges.action, "add_tag"),
        eq(libraryChanges.status, "suggested"),
        sql`${libraryChanges.targetIds}[1] = ${clippingId}::uuid`,
        names === undefined
          ? undefined
          : sql`exists (
              select 1 from tags
              where tags.id = ${libraryChanges.targetIds}[2]
                and tags.user_id = ${userId}
                and lower(tags.name) in (
                  select distinct lower(name) from unnest(${sql.param([...names])}::text[]) as name
                )
            )`,
      ),
    );
}

/**
 * Marks the clipping's own tag suggestion for this tag name (ignoring case) dismissed, when it has
 * one that is still pending.
 */
export async function dismissTagSuggestionNamed(
  tx: Transaction,
  userId: string,
  clippingId: string,
  tagName: string,
  at: Date,
): Promise<void> {
  await tx
    .update(clippingTagSuggestions)
    .set({ dismissedAt: at })
    .where(
      and(
        eq(clippingTagSuggestions.clippingId, clippingId),
        eq(clippingTagSuggestions.userId, userId),
        isNull(clippingTagSuggestions.dismissedAt),
        sql`lower(${clippingTagSuggestions.name}) = lower(${tagName})`,
      ),
    );
}
