import { parseISO } from "date-fns";
import { and, count, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type pg from "pg";

import { formatIsoUtc, type Folder, type LibraryChange } from "@clippings/shared";

import { lockUser } from "../changes/lock-user.ts";
import {
  ChangeConflictError,
  ChangeNotFoundError,
  ChangeNotUndoableError,
  createChangesService,
} from "../changes/service.ts";
import { dismissTagSuggestionNamed } from "../changes/tag-suggestions.ts";
import type { Clock } from "../clippings/ports.ts";
import { InvalidTagsError, TagNameTakenError } from "../clippings/service.ts";
import { createDatabase } from "../database.ts";
import { clippings, folders, libraryChanges, tags, userSettings } from "../schema.ts";
import { gateChange } from "./gate.ts";
import { readLibraryView, type LibraryView } from "./library-view.ts";
import {
  effectiveAt,
  latestChangeAt,
  LibrarianInputError,
  ownedTargets,
  planChange,
  proposalOf,
  signatureOf,
  undoEffect,
  type PendingFolders,
  type ProposedChange,
  type ProposingActor,
  type Transaction,
} from "./plans.ts";

export interface LibrarianServiceDeps {
  pool: pg.Pool;
  clock: Clock;
}

/** The change is not a suggestion waiting for a decision: it was applied, dismissed or undone. */
export class ChangeNotSuggestedError extends Error {
  constructor() {
    super("That change is not a suggestion waiting for a decision");
    this.name = "ChangeNotSuggestedError";
  }
}

/** The library has moved on and the suggestion no longer applies as proposed. Nothing was changed. */
export class SuggestionStaleError extends Error {
  constructor(why: string) {
    super(`That suggestion no longer applies: ${why}`);
    this.name = "SuggestionStaleError";
  }
}

/** Options for proposing changes. */
export interface ProposeOptions {
  /** Work out and report what would happen, and write nothing. */
  dryRun?: boolean;
  /**
   * Store every change as a suggestion, however sure the proposer is: for a user's first
   * librarian run, which only proposes.
   */
  suggestOnly?: boolean;
}

/** A change as it would be logged, before it is: what a dry run reports. */
export type PlannedChange = Omit<LibraryChange, "id" | "createdAt">;

/** What happened to one proposed change. */
export type ProposalResult =
  /** Logged: applied now, or stored as a suggestion. */
  | { outcome: "applied" | "suggested"; change: LibraryChange }
  /** A dry run: what would have been logged. */
  | { outcome: "would_apply" | "would_suggest"; change: PlannedChange }
  /** Nothing to do, or nothing allowed: already so, the user's color, a repeat of a dismissed idea, a bad reference. */
  | { outcome: "skipped"; action: ProposedChange["action"]; reason: string };

/** A folder with what is in it. */
export interface FolderSummary extends Folder {
  clippingCount: number;
  tagCount: number;
}

export interface ListSuggestionsInput {
  limit?: number;
  cursor?: string;
}

export interface SuggestionsPage {
  items: LibraryChange[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

export class InvalidSuggestionCursorError extends Error {
  constructor() {
    super("That isn't a cursor list_suggestions returned");
    this.name = "InvalidSuggestionCursorError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SUGGESTIONS_PAGE_SIZE = 25;
const MAX_SUGGESTIONS_PAGE_SIZE = 100;

type ChangeRow = typeof libraryChanges.$inferSelect;

const toChange = (row: ChangeRow): LibraryChange => ({
  id: row.id,
  actor: row.actor,
  action: row.action as LibraryChange["action"],
  targetIds: row.targetIds,
  before: row.before,
  after: row.after,
  confidence: row.confidence,
  status: row.status,
  reason: row.reason,
  createdAt: formatIsoUtc(row.createdAt),
});

const isMergeAction = (action: string) => action === "merge_tag" || action === "fold_tag";

/**
 * Whether a merge or fold applied after `since` into the same tag carried a clipping that this
 * merge only gave the tag. That later change saw the tag already on the clipping and added
 * nothing, so it now depends on the tag staying there: taking it off would leave the clipping
 * without what the later change folded in.
 */
async function laterMergeLeansOn(
  tx: Transaction,
  userId: string,
  row: ChangeRow,
  since: Date,
): Promise<boolean> {
  const targetId = row.targetIds[1];
  const added = (row.before as { addedToTarget?: string[] } | null)?.addedToTarget ?? [];
  if (!isMergeAction(row.action) || !targetId || added.length === 0) return false;
  const later = await tx
    .select({ before: libraryChanges.before })
    .from(libraryChanges)
    .where(
      and(
        eq(libraryChanges.userId, userId),
        sql`${libraryChanges.id} <> ${row.id}::uuid`,
        eq(libraryChanges.status, "applied"),
        inArray(libraryChanges.action, ["merge_tag", "fold_tag"]),
        sql`(${libraryChanges.targetIds})[2] = ${targetId}::uuid`,
        sql`coalesce(${libraryChanges.appliedAt}, ${libraryChanges.createdAt}) > ${since}`,
      ),
    );
  const addedSet = new Set(added);
  return later.some((change) =>
    ((change.before as { clippingIds?: string[] } | null)?.clippingIds ?? []).some((id) =>
      addedSet.has(id),
    ),
  );
}

/**
 * The librarian: the one code path that reshapes a user's library (tag colors, folders, links,
 * topic pages, merges and renames), whether the weekly job or Claude over MCP asks. Every change
 * goes through the confidence gate, is logged in `library_changes` with the state it replaced
 * (so it can be undone), and is scoped to the acting user. Nothing here deletes a clipping or
 * note.
 */
export function createLibrarianService({ pool, clock }: LibrarianServiceDeps) {
  const db = createDatabase(pool);
  const changes = createChangesService({ pool });

  const isUuid = (id: string) => UUID.test(id);

  /** The ids of identical ideas already waiting, turned down or undone: not worth proposing again. */
  async function repeatOf(tx: Transaction, userId: string, planned: PlannedChange) {
    const signature = signatureOf(planned);
    const rows = await tx
      .select({
        action: libraryChanges.action,
        targetIds: libraryChanges.targetIds,
        after: libraryChanges.after,
        status: libraryChanges.status,
      })
      .from(libraryChanges)
      .where(
        and(
          eq(libraryChanges.userId, userId),
          eq(libraryChanges.action, planned.action),
          inArray(libraryChanges.status, ["suggested", "dismissed", "undone"]),
        ),
      );
    return rows.find((row) => signatureOf(row) === signature)?.status ?? null;
  }

  async function proposeInTransaction(
    tx: Transaction,
    userId: string,
    actor: ProposingActor,
    proposal: ProposedChange,
    options: ProposeOptions,
    pending: PendingFolders,
  ): Promise<ProposalResult> {
    await lockUser(tx, userId);
    const skipped = (reason: string): ProposalResult => ({
      outcome: "skipped",
      action: proposal.action,
      reason,
    });
    const planned = await planChange(tx, userId, actor, proposal, pending);
    if ("skip" in planned) return skipped(planned.skip);
    const { plan } = planned;

    const confidence = proposal.confidence ?? null;
    const reason = proposal.reason.trim();
    const preview = (status: "applied" | "suggested"): PlannedChange => ({
      actor,
      action: plan.action,
      targetIds: plan.targetIds,
      before: plan.before,
      after: plan.after,
      confidence,
      status,
      reason,
    });

    // The librarian doesn't bring back an idea the user dismissed or undid, or one still waiting.
    if (actor === "librarian") {
      const earlier = await repeatOf(tx, userId, preview("suggested"));
      if (earlier === "suggested") return skipped("It is already waiting as a suggestion");
      if (earlier)
        return skipped(`The user ${earlier === "undone" ? "undid" : "dismissed"} this before`);
    }

    const status =
      options.suggestOnly || plan.waitingFor || gateChange(proposal, actor) === "suggest"
        ? "suggested"
        : "applied";
    if (options.dryRun) {
      return {
        outcome: status === "applied" ? "would_apply" : "would_suggest",
        change: preview(status),
      };
    }

    const now = clock.now();
    const at = status === "applied" ? effectiveAt(now, await latestChangeAt(tx, userId)) : now;
    if (status === "applied") await plan.write(tx, { userId, actor, at });
    const [row] = await tx
      .insert(libraryChanges)
      .values({
        userId,
        actor,
        action: plan.action,
        targetIds: plan.targetIds,
        before: plan.before,
        after: plan.after,
        confidence,
        status,
        reason,
        appliedAt: status === "applied" ? at : null,
        createdAt: at,
      })
      .returning();
    return { outcome: status, change: toChange(row!) };
  }

  /**
   * Proposes one change. Through the confidence gate the librarian's `high` confidence changes
   * are applied and the rest stored as suggestions; the user's own (`user_via_mcp`) are applied.
   * A change that would do nothing (already so, the user's color, an idea the user turned down)
   * comes back `skipped`. Throws `LibrarianInputError` (or `TagNameTakenError`,
   * `InvalidTagsError`) when it names something that is not the user's or asks for what isn't
   * allowed; nothing is changed then.
   */
  async function proposeChange(
    userId: string,
    actor: ProposingActor,
    proposal: ProposedChange,
    options: ProposeOptions = {},
  ): Promise<ProposalResult> {
    return db.transaction((tx) =>
      proposeInTransaction(tx, userId, actor, proposal, options, new Map()),
    );
  }

  /**
   * Proposes a list of changes in order, each in a transaction of its own, and reports what
   * happened to each, in the same order. A change that names something that is not the user's, or
   * is otherwise refused, comes back `skipped` with the reason and the rest go on. This is the
   * entry point the weekly job and `run_librarian` call; with `dryRun` the same list is
   * planned and reported and nothing is written. A change into a folder an earlier change in the
   * list creates is planned as if that folder exists when the earlier one is (or would be)
   * applied, and waits as a suggestion when the folder itself is only suggested.
   */
  async function proposeChanges(
    userId: string,
    actor: ProposingActor,
    proposals: readonly ProposedChange[],
    options: ProposeOptions = {},
  ): Promise<ProposalResult[]> {
    const results: ProposalResult[] = [];
    const pending: PendingFolders = new Map();
    for (const proposal of proposals) {
      let result: ProposalResult;
      try {
        result = await db.transaction((tx) =>
          proposeInTransaction(tx, userId, actor, proposal, options, pending),
        );
      } catch (error) {
        if (!isRefusal(error)) throw error;
        result = { outcome: "skipped", action: proposal.action, reason: error.message };
      }
      if (proposal.action === "create_folder" && result.outcome !== "skipped") {
        const folder = (
          result.change.after as { folder: { id: string; name: string; color: never } }
        ).folder;
        pending.set(folder.id, {
          name: folder.name,
          color: folder.color,
          willExist: result.outcome === "would_apply",
        });
      }
      results.push(result);
    }
    return results;
  }

  /** The user's suggestions waiting for a decision, newest first. */
  async function listSuggestions(
    userId: string,
    { limit = SUGGESTIONS_PAGE_SIZE, cursor }: ListSuggestionsInput = {},
  ): Promise<SuggestionsPage> {
    const size = Math.min(Math.max(Math.trunc(limit), 1), MAX_SUGGESTIONS_PAGE_SIZE);
    let after: { at: Date; id: string } | null = null;
    if (cursor !== undefined) {
      const [iso, id] = cursor.split("_");
      const at = iso ? parseISO(iso) : null;
      if (!at || Number.isNaN(at.getTime()) || !id || !isUuid(id)) {
        throw new InvalidSuggestionCursorError();
      }
      after = { at, id };
    }
    const rows = await db
      .select()
      .from(libraryChanges)
      .where(
        and(
          eq(libraryChanges.userId, userId),
          eq(libraryChanges.status, "suggested"),
          after
            ? or(
                lt(libraryChanges.createdAt, after.at),
                and(eq(libraryChanges.createdAt, after.at), lt(libraryChanges.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(libraryChanges.createdAt), desc(libraryChanges.id))
      .limit(size + 1);
    const page = rows.slice(0, size);
    const last = page.at(-1);
    return {
      items: page.map(toChange),
      nextCursor: rows.length > size && last ? `${formatIsoUtc(last.createdAt)}_${last.id}` : null,
    };
  }

  /** One of the user's logged changes, or null. */
  async function getChange(userId: string, changeId: string): Promise<LibraryChange | null> {
    if (!isUuid(changeId)) return null;
    const [row] = await db
      .select()
      .from(libraryChanges)
      .where(and(eq(libraryChanges.id, changeId), eq(libraryChanges.userId, userId)));
    return row ? toChange(row) : null;
  }

  /**
   * Applies a suggestion: plans it again against the library as it is now, writes it and flips
   * the change to `applied`, with the before-state of today. Throws `ChangeNotFoundError` for a
   * change that is not the user's, `ChangeNotSuggestedError` for one that is not waiting, and
   * `SuggestionStaleError`, changing nothing, when it no longer applies.
   */
  async function applySuggestion(userId: string, changeId: string): Promise<LibraryChange> {
    if (!isUuid(changeId)) throw new ChangeNotFoundError();
    return db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const [row] = await tx
        .select()
        .from(libraryChanges)
        .where(and(eq(libraryChanges.id, changeId), eq(libraryChanges.userId, userId)))
        .for("update");
      if (!row) throw new ChangeNotFoundError();
      if (row.status !== "suggested") throw new ChangeNotSuggestedError();
      const actor = row.actor === "user_via_mcp" ? "user_via_mcp" : "librarian";

      let planned;
      try {
        planned = await planChange(tx, userId, actor, proposalOf(row), new Map());
      } catch (error) {
        if (!isRefusal(error)) throw error;
        throw new SuggestionStaleError(error.message);
      }
      if ("skip" in planned) throw new SuggestionStaleError(planned.skip);
      const { plan } = planned;
      if (plan.waitingFor) throw new SuggestionStaleError(`it waits for ${plan.waitingFor}`);

      const at = effectiveAt(clock.now(), await latestChangeAt(tx, userId));
      try {
        await plan.write(tx, { userId, actor, at });
      } catch (error) {
        // The write looks again under a lock: what the plan saw may have changed since.
        if (!isRefusal(error)) throw error;
        throw new SuggestionStaleError(error.message);
      }
      const [applied] = await tx
        .update(libraryChanges)
        .set({ status: "applied", before: plan.before, after: plan.after, appliedAt: at })
        .where(and(eq(libraryChanges.id, changeId), eq(libraryChanges.userId, userId)))
        .returning();
      return toChange(applied!);
    });
  }

  /**
   * Turns a suggestion down. The librarian won't propose the same change again. Dismissing an
   * `add_tag` suggestion also dismisses the clipping's own suggestion of that tag, so it is not
   * offered again on the clipping.
   */
  async function dismissSuggestion(userId: string, changeId: string): Promise<LibraryChange> {
    if (!isUuid(changeId)) throw new ChangeNotFoundError();
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select({ status: libraryChanges.status })
        .from(libraryChanges)
        .where(and(eq(libraryChanges.id, changeId), eq(libraryChanges.userId, userId)));
      if (!row) throw new ChangeNotFoundError();
      // The status check is in the update, so two decisions at once can't both succeed.
      const [dismissed] = await tx
        .update(libraryChanges)
        .set({ status: "dismissed" })
        .where(
          and(
            eq(libraryChanges.id, changeId),
            eq(libraryChanges.userId, userId),
            eq(libraryChanges.status, "suggested"),
          ),
        )
        .returning();
      if (!dismissed) throw new ChangeNotSuggestedError();
      const [clippingId, tagId] = dismissed.targetIds;
      if (dismissed.action === "add_tag" && clippingId && tagId) {
        const [tag] = await tx
          .select({ name: tags.name })
          .from(tags)
          .where(and(eq(tags.id, tagId), eq(tags.userId, userId)));
        const name = tag?.name ?? (dismissed.after as { tag?: { name?: string } })?.tag?.name;
        if (name) await dismissTagSuggestionNamed(tx, userId, clippingId, name, clock.now());
      }
      return toChange(dismissed);
    });
  }

  /**
   * Undoes one applied change by putting back what it replaced, and marks it `undone`. Throws
   * `ChangeNotFoundError` for a change that is not the user's, `ChangeNotUndoableError` for one
   * that was never applied or was undone already, and `ChangeConflictError`, changing nothing,
   * when a later applied change touched the same things (or the world has moved so that the old
   * state can't come back, such as a name now taken). Undoing a merge or a tag's deletion
   * recreates the tag, its color, folder and topic page, and puts it back on its clippings.
   */
  async function undoChange(userId: string, changeId: string): Promise<LibraryChange> {
    if (!isUuid(changeId)) throw new ChangeNotFoundError();
    const [peek] = await db
      .select({ action: libraryChanges.action })
      .from(libraryChanges)
      .where(and(eq(libraryChanges.id, changeId), eq(libraryChanges.userId, userId)));
    if (!peek) throw new ChangeNotFoundError();
    if (peek.action === "add_tag" || peek.action === "create_tag") {
      // Tags put on a clipping by auto-tagging, and the librarian's add_tag, share one way back.
      await changes.undoChange(userId, changeId);
      return (await getChange(userId, changeId))!;
    }

    return db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const [row] = await tx
        .select()
        .from(libraryChanges)
        .where(and(eq(libraryChanges.id, changeId), eq(libraryChanges.userId, userId)))
        .for("update");
      if (!row) throw new ChangeNotFoundError();
      if (row.status === "undone")
        throw new ChangeNotUndoableError("That change was already undone");
      if (row.status !== "applied") {
        throw new ChangeNotUndoableError(
          "That change was never applied, so there is nothing to undo",
        );
      }

      const since = row.appliedAt ?? row.createdAt;
      const owned = ownedTargets(row.action, row.targetIds);
      const [later] = await tx
        .select({ id: libraryChanges.id })
        .from(libraryChanges)
        .where(
          and(
            eq(libraryChanges.userId, userId),
            sql`${libraryChanges.id} <> ${changeId}::uuid`,
            eq(libraryChanges.status, "applied"),
            sql`coalesce(${libraryChanges.appliedAt}, ${libraryChanges.createdAt}) > ${since}`,
            sql`${libraryChanges.targetIds} && array[${sql.join(
              owned.map((id) => sql`${id}`),
              sql`, `,
            )}]::uuid[]`,
          ),
        )
        .limit(1);
      if (later) {
        throw new ChangeConflictError(
          "A later change touched the same things, so this one can't be undone on its own",
        );
      }

      if (await laterMergeLeansOn(tx, userId, row, since)) {
        throw new ChangeConflictError(
          "A later merge into the same tag relies on the clippings this one tagged, so this one can't be undone on its own",
        );
      }

      await undoEffect(tx, row);
      const [undone] = await tx
        .update(libraryChanges)
        .set({ status: "undone" })
        .where(and(eq(libraryChanges.id, changeId), eq(libraryChanges.userId, userId)))
        .returning();
      return toChange(undone!);
    });
  }

  /** The user's folders by name, each with how many clippings and tags are in it. */
  async function listFolders(userId: string): Promise<FolderSummary[]> {
    const rows = await db
      .select({ id: folders.id, name: folders.name, color: folders.color })
      .from(folders)
      .where(eq(folders.userId, userId))
      .orderBy(sql`lower(${folders.name})`, folders.name);
    const clippingCounts = new Map(
      (
        await db
          .select({ folderId: clippings.folderId, n: count() })
          .from(clippings)
          .where(and(eq(clippings.userId, userId), sql`${clippings.deletedAt} is null`))
          .groupBy(clippings.folderId)
      ).map((row) => [row.folderId, row.n]),
    );
    const tagCounts = new Map(
      (
        await db
          .select({ folderId: tags.folderId, n: count() })
          .from(tags)
          .where(eq(tags.userId, userId))
          .groupBy(tags.folderId)
      ).map((row) => [row.folderId, row.n]),
    );
    return rows.map((row) => ({
      ...row,
      clippingCount: clippingCounts.get(row.id) ?? 0,
      tagCount: tagCounts.get(row.id) ?? 0,
    }));
  }

  /** The user's folder with this name, ignoring case; null when they have none. */
  async function findFolderByName(userId: string, name: string): Promise<Folder | null> {
    const [folder] = await db
      .select({ id: folders.id, name: folders.name, color: folders.color })
      .from(folders)
      .where(
        and(eq(folders.userId, userId), sql`lower(${folders.name}) = ${name.trim().toLowerCase()}`),
      );
    return folder ?? null;
  }

  /** The user's library in the compact form the librarian plans from. */
  async function readLibrary(userId: string): Promise<LibraryView> {
    return readLibraryView(db, userId);
  }

  /**
   * Whether the user's first librarian run has finished (`markLibrarianRun`). The change log
   * can't say: a first run cut off partway leaves rows behind, and its redelivery must still only
   * suggest.
   */
  async function hasLibrarianRun(userId: string): Promise<boolean> {
    const [row] = await db
      .select({ at: userSettings.librarianFirstRunAt })
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    return row?.at != null;
  }

  /**
   * Records that the user's first librarian run finished, so later runs may apply what they are
   * sure of. Keeps the first time if called again.
   */
  async function markLibrarianRun(userId: string): Promise<void> {
    const now = clock.now();
    await db
      .insert(userSettings)
      .values({ userId, librarianFirstRunAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { librarianFirstRunAt: sql`coalesce(${userSettings.librarianFirstRunAt}, ${now})` },
      });
  }

  /**
   * The users the weekly librarian job runs for: everyone with at least one clipping or note not
   * deleted. The one query here across users; it returns ids only.
   */
  async function listUsersWithLibrary(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ userId: clippings.userId })
      .from(clippings)
      .where(sql`${clippings.deletedAt} is null`)
      .orderBy(clippings.userId);
    return rows.map((row) => row.userId);
  }

  return {
    readLibrary,
    hasLibrarianRun,
    markLibrarianRun,
    listUsersWithLibrary,
    proposeChange,
    proposeChanges,
    listSuggestions,
    getChange,
    applySuggestion,
    dismissSuggestion,
    undoChange,
    listFolders,
    findFolderByName,
  };
}

export type LibrarianService = ReturnType<typeof createLibrarianService>;

/** Whether the error is the user's proposal being refused, not a fault. */
function isRefusal(error: unknown): error is Error {
  return (
    error instanceof LibrarianInputError ||
    error instanceof TagNameTakenError ||
    error instanceof InvalidTagsError
  );
}
