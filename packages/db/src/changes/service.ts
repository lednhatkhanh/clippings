import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type pg from "pg";

import type { LibraryChangeConfidence } from "@clippings/shared";

import { createDatabase } from "../database.ts";
import { clippingTags, libraryChanges, tags } from "../schema.ts";

export interface ChangesServiceDeps {
  pool: pg.Pool;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Actions that put a tag on a clipping; their `targetIds` are `[clippingId, tagId]`. */
const TAG_ON_CLIPPING = ["add_tag", "create_tag"] as const;

export class ChangeNotFoundError extends Error {
  constructor() {
    super("There is no such change");
    this.name = "ChangeNotFoundError";
  }
}

/** The change is not one that can be undone now: already undone, never applied, or not a tag. */
export class ChangeNotUndoableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangeNotUndoableError";
  }
}

/** A later change touched the same targets, so undoing this one could undo that too. */
export class ChangeConflictError extends Error {
  constructor(message = "A later change touched this tag, so this one can't be undone on its own") {
    super(message);
    this.name = "ChangeConflictError";
  }
}

/** A tag that auto-tagging put on a clipping and that is still there. */
export interface AutoAppliedTag {
  changeId: string;
  tagId: string;
  /** The tag's name now, which may differ from when it was applied. */
  name: string;
  /** Why the model chose it. */
  reason: string;
  confidence: LibraryChangeConfidence | null;
}

/** What undoing a change did. */
export interface UndoResult {
  changeId: string;
  /** The clipping the tag was on and the tag's id. */
  clippingId: string;
  tagId: string;
  /** False when the tag was no longer on the clipping (the user had taken it off already). */
  removed: boolean;
}

/**
 * The library change log: what automation did and the way back. Every operation takes the acting
 * user and scopes its queries by them. Auto-tagging writes the rows (see `applyAutoTags`, inside
 * the enrichment transaction); this reads them and reverts them.
 */
export function createChangesService({ pool }: ChangesServiceDeps) {
  const db = createDatabase(pool);

  /**
   * The tags auto-tagging applied to this clipping that it still carries, oldest first and by tag name within a reading. Empty for
   * a clipping that isn't the user's.
   */
  async function listAutoApplied(userId: string, clippingId: string): Promise<AutoAppliedTag[]> {
    if (!UUID.test(clippingId)) return [];
    return (
      db
        .select({
          changeId: libraryChanges.id,
          tagId: tags.id,
          name: tags.name,
          reason: libraryChanges.reason,
          confidence: libraryChanges.confidence,
        })
        .from(libraryChanges)
        .innerJoin(
          clippingTags,
          and(
            eq(clippingTags.clippingId, clippingId),
            sql`${clippingTags.tagId} = ${libraryChanges.targetIds}[2]`,
            eq(clippingTags.userId, libraryChanges.userId),
          ),
        )
        .innerJoin(
          tags,
          and(eq(tags.id, clippingTags.tagId), eq(tags.userId, libraryChanges.userId)),
        )
        .where(
          and(
            eq(libraryChanges.userId, userId),
            eq(libraryChanges.actor, "auto_tag"),
            eq(libraryChanges.status, "applied"),
            inArray(libraryChanges.action, [...TAG_ON_CLIPPING]),
            sql`${libraryChanges.targetIds}[1] = ${clippingId}::uuid`,
          ),
        )
        // Changes applied in one reading share a timestamp, so the tag name settles their order.
        .orderBy(asc(libraryChanges.createdAt), asc(sql`lower(${tags.name})`), asc(tags.name))
    );
  }

  /**
   * Reverts one auto-applied tag: takes the tag off the clipping and marks the change undone. A
   * tag that auto-tagging created and that no other clipping carries is removed with it. The tag
   * is never put back by a later read of the page.
   *
   * Throws `ChangeNotFoundError` for a change that isn't the user's, `ChangeNotUndoableError` for
   * one that isn't an applied auto-tag (or was undone already) and `ChangeConflictError` when a
   * later applied change touched the same clipping and tag, or the tag itself (a rename or a
   * merge). Nothing is changed in any of these cases.
   */
  async function undoChange(userId: string, changeId: string): Promise<UndoResult> {
    if (!UUID.test(changeId)) throw new ChangeNotFoundError();
    return db.transaction(async (tx) => {
      const [change] = await tx
        .select()
        .from(libraryChanges)
        .where(and(eq(libraryChanges.id, changeId), eq(libraryChanges.userId, userId)))
        .for("update");
      if (!change) throw new ChangeNotFoundError();
      if (change.status === "undone") {
        throw new ChangeNotUndoableError("That change was already undone");
      }
      const [clippingId, tagId] = change.targetIds;
      if (
        change.status !== "applied" ||
        change.actor !== "auto_tag" ||
        !TAG_ON_CLIPPING.some((action) => action === change.action) ||
        !clippingId ||
        !tagId
      ) {
        throw new ChangeNotUndoableError("Only a tag added automatically can be undone here");
      }

      const [later] = await tx
        .select({ id: libraryChanges.id })
        .from(libraryChanges)
        .where(
          and(
            eq(libraryChanges.userId, userId),
            sql`${libraryChanges.id} <> ${changeId}::uuid`,
            eq(libraryChanges.status, "applied"),
            // When it took effect: a suggestion applied later counts from then, not from its creation.
            sql`coalesce(${libraryChanges.appliedAt}, ${libraryChanges.createdAt}) >= ${change.appliedAt ?? change.createdAt}`,
            sql`(
              ${libraryChanges.targetIds} @> array[${clippingId}, ${tagId}]::uuid[]
              or (
                ${libraryChanges.action} not in ('add_tag', 'create_tag')
                and ${libraryChanges.targetIds} @> array[${tagId}]::uuid[]
              )
            )`,
          ),
        )
        .limit(1);
      if (later) throw new ChangeConflictError();

      const removedLinks = await tx
        .delete(clippingTags)
        .where(
          and(
            eq(clippingTags.clippingId, clippingId),
            eq(clippingTags.tagId, tagId),
            eq(clippingTags.userId, userId),
          ),
        )
        .returning({ tagId: clippingTags.tagId });
      if (change.action === "create_tag") {
        // The tag came with this change; leave it only if something else has come to use it.
        await tx.delete(tags).where(
          and(
            eq(tags.id, tagId),
            eq(tags.userId, userId),
            sql`not exists (
              select 1 from ${clippingTags}
              where ${clippingTags.tagId} = ${tagId}::uuid and ${clippingTags.userId} = ${userId}
            )`,
          ),
        );
      }
      await tx
        .update(libraryChanges)
        .set({ status: "undone" })
        .where(and(eq(libraryChanges.id, changeId), eq(libraryChanges.userId, userId)));
      return { changeId, clippingId, tagId, removed: removedLinks.length > 0 };
    });
  }

  return { listAutoApplied, undoChange };
}

export type ChangesService = ReturnType<typeof createChangesService>;
