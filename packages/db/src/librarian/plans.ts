import { addMilliseconds, isAfter, parseISO } from "date-fns";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  AUTOMATIC_TAG_COLOR,
  formatIsoUtc,
  isTagColor,
  isTagColorChoice,
  MAX_FOLDER_NAME_LENGTH,
  MAX_LINK_REASON_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_CLIPPING,
  MAX_TOPIC_PAGE_LENGTH,
  normalizeTagName,
  tagNameKey,
  type ItemLinkCreator,
  type LibraryChangeAction,
  type LibraryChangeActor,
  type LibraryChangeConfidence,
  type TagColor,
  type TagColorChoice,
} from "@clippings/shared";

import { ChangeConflictError, ChangeNotUndoableError } from "../changes/service.ts";
import { InvalidTagsError, TagNameTakenError } from "../clippings/service.ts";
import type { Database } from "../database.ts";
import {
  clippings,
  clippingTags,
  clippingTagSuggestions,
  folders,
  itemLinks,
  libraryChanges,
  tags,
  topicPages,
} from "../schema.ts";

/** What `db.transaction` hands its callback. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Who can propose a change through the librarian service. */
export type ProposingActor = Extract<LibraryChangeActor, "librarian" | "user_via_mcp">;

/**
 * A change someone wants made. `reason` is the one line the change log keeps (and, for a link, the
 * link's own reason). `confidence` is the proposer's, for the gate; leave it out for a change the
 * user asked for. `id` fixes the id of the folder or link the change creates, so a later change in
 * the same list can name a folder that does not exist yet.
 */
export type ProposedChange = {
  reason: string;
  confidence?: LibraryChangeConfidence | null;
} & (
  | { action: "add_tag"; clippingId: string; tagId: string }
  | { action: "set_tag_color"; tagId: string; color: TagColorChoice }
  | { action: "create_folder"; name: string; color?: TagColor; id?: string }
  | { action: "move_to_folder"; itemKind: "clipping" | "tag"; itemId: string; folderId: string }
  | { action: "link_items"; fromId: string; toId: string; id?: string }
  | { action: "write_topic_page"; tagId: string; body: string }
  | { action: "rename_tag"; tagId: string; name: string }
  | { action: "delete_tag"; tagId: string }
  | { action: "merge_tag" | "fold_tag"; sourceId: string; targetId: string }
);

/** The proposal does not name things the user has, or asks for something not allowed. */
export class LibrarianInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibrarianInputError";
  }
}

/** A tag, clipping, note or folder the proposal names is not the user's. */
export class LibrarianNotFoundError extends LibrarianInputError {
  constructor(what: "tag" | "clipping" | "folder" | "change") {
    super(`There is no such ${what}`);
    this.name = "LibrarianNotFoundError";
  }
}

/** The change does not make sense as asked (a bad name, a color, a blank body, a tag used often). */
export class LibrarianInvalidError extends LibrarianInputError {
  constructor(message: string) {
    super(message);
    this.name = "LibrarianInvalidError";
  }
}

/** What a plan needs to write the change. */
export interface ApplyContext {
  userId: string;
  actor: ProposingActor;
  /** When the change takes effect. */
  at: Date;
}

/**
 * What a change would do, worked out against the library as it is now: the targets, the state it
 * replaces and the state it writes (enough to undo it), and the write itself.
 */
export interface Plan {
  action: LibraryChangeAction;
  targetIds: string[];
  before: unknown;
  after: unknown;
  /**
   * Set when the change cannot be applied yet, only suggested: it needs a folder that is itself
   * only a suggestion. The text says what it waits for.
   */
  waitingFor: string | null;
  write: (tx: Transaction, context: ApplyContext) => Promise<void>;
}

export type PlanOutcome = { plan: Plan } | { skip: string };

/** Folders that earlier proposals in the same list create, by id. */
export type PendingFolders = Map<string, { name: string; color: TagColor; willExist: boolean }>;

/** The part of a log row that turns back into a proposal. */
export interface StoredChange {
  action: string;
  targetIds: string[];
  after: unknown;
  reason: string;
  confidence: LibraryChangeConfidence | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lets one user's librarian writes take turns, so a check and the write after it can't be split. */
export async function lockUser(tx: Transaction, userId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`librarian:${userId}`}, 0))`,
  );
}

/** The latest moment a change of this user took effect, or null before the first. */
export async function latestChangeAt(tx: Transaction, userId: string): Promise<Date | null> {
  const [row] = await tx
    .select({
      at: sql<Date | null>`max(coalesce(${libraryChanges.appliedAt}, ${libraryChanges.createdAt}))`.mapWith(
        libraryChanges.createdAt,
      ),
    })
    .from(libraryChanges)
    .where(and(eq(libraryChanges.userId, userId), eq(libraryChanges.status, "applied")));
  return row?.at ?? null;
}

/** `now`, or a millisecond past the latest change when the clock has not moved: changes of one user take effect in strict order. */
export function effectiveAt(now: Date, latest: Date | null): Date {
  return latest && !isAfter(now, latest) ? addMilliseconds(latest, 1) : now;
}

const isUuid = (id: string) => UUID.test(id);

async function loadTag(tx: Transaction, userId: string, tagId: string) {
  if (!isUuid(tagId)) throw new LibrarianNotFoundError("tag");
  const [tag] = await tx
    .select()
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.userId, userId)));
  if (!tag) throw new LibrarianNotFoundError("tag");
  return tag;
}

async function loadLiveClipping(tx: Transaction, userId: string, clippingId: string) {
  if (!isUuid(clippingId)) throw new LibrarianNotFoundError("clipping");
  const [clipping] = await tx
    .select({
      id: clippings.id,
      folderId: clippings.folderId,
      title: sql<string>`coalesce(${clippings.userTitle}, ${clippings.title})`,
    })
    .from(clippings)
    .where(
      and(eq(clippings.id, clippingId), eq(clippings.userId, userId), isNull(clippings.deletedAt)),
    );
  if (!clipping) throw new LibrarianNotFoundError("clipping");
  return clipping;
}

function checkedReason(reason: string): string {
  const text = reason.trim();
  if (text === "") throw new LibrarianInvalidError("A change needs a one-line reason");
  if (text.length > MAX_LINK_REASON_LENGTH) {
    throw new LibrarianInvalidError(`A reason can be at most ${MAX_LINK_REASON_LENGTH} characters`);
  }
  return text;
}

/** Works out what the change would do against the library as it is now. Throws `LibrarianInputError` when it names things that are not the user's or asks for something not allowed. */
export async function planChange(
  tx: Transaction,
  userId: string,
  actor: ProposingActor,
  proposal: ProposedChange,
  pending: PendingFolders,
): Promise<PlanOutcome> {
  checkedReason(proposal.reason);
  switch (proposal.action) {
    case "add_tag":
      return planAddTag(tx, userId, actor, proposal);
    case "set_tag_color":
      return planColor(tx, userId, actor, proposal);
    case "create_folder":
      return planCreateFolder(tx, userId, proposal);
    case "move_to_folder":
      return planMove(tx, userId, proposal, pending);
    case "link_items":
      return planLink(tx, userId, actor, proposal);
    case "write_topic_page":
      return planTopicPage(tx, userId, proposal);
    case "rename_tag":
      return planRename(tx, userId, proposal);
    case "delete_tag":
      return planDelete(tx, userId, actor, proposal);
    case "merge_tag":
    case "fold_tag":
      return planMerge(tx, userId, proposal);
  }
}

async function planAddTag(
  tx: Transaction,
  userId: string,
  actor: ProposingActor,
  proposal: Extract<ProposedChange, { action: "add_tag" }>,
): Promise<PlanOutcome> {
  const clipping = await loadLiveClipping(tx, userId, proposal.clippingId);
  const tag = await loadTag(tx, userId, proposal.tagId);
  const carried = await tx
    .select({ id: tags.id, name: tags.name })
    .from(clippingTags)
    .innerJoin(tags, and(eq(tags.id, clippingTags.tagId), eq(tags.userId, clippingTags.userId)))
    .where(and(eq(clippingTags.clippingId, clipping.id), eq(clippingTags.userId, userId)))
    .orderBy(sql`lower(${tags.name})`, tags.name);
  if (carried.some((other) => other.id === tag.id)) {
    return { skip: `It already has the tag "${tag.name}"` };
  }
  if (carried.length >= MAX_TAGS_PER_CLIPPING) {
    return { skip: `It already has ${MAX_TAGS_PER_CLIPPING} tags, the most a clipping can have` };
  }

  // The librarian doesn't put back a tag the user turned down: dismissed as a suggestion, or
  // taken off after it was added (the link is gone now, so any earlier add, by anyone, was undone
  // or removed by hand). The user asking through Claude overrides that.
  if (actor === "librarian") {
    const [dismissed] = await tx
      .select({ name: clippingTagSuggestions.name })
      .from(clippingTagSuggestions)
      .where(
        and(
          eq(clippingTagSuggestions.clippingId, clipping.id),
          eq(clippingTagSuggestions.userId, userId),
          sql`${clippingTagSuggestions.dismissedAt} is not null`,
          sql`lower(${clippingTagSuggestions.name}) = ${tagNameKey(tag.name)}`,
        ),
      );
    if (dismissed) return { skip: "The user dismissed this tag for this clipping" };
    const [taken] = await tx
      .select({ id: libraryChanges.id })
      .from(libraryChanges)
      .where(
        and(
          eq(libraryChanges.userId, userId),
          inArray(libraryChanges.action, ["add_tag", "create_tag"]),
          inArray(libraryChanges.status, ["applied", "undone"]),
          sql`${libraryChanges.targetIds}[1] = ${clipping.id}::uuid`,
          sql`${libraryChanges.targetIds}[2] = ${tag.id}::uuid`,
        ),
      )
      .limit(1);
    if (taken) return { skip: "The user took this tag off this clipping before" };
  }

  const namesBefore = carried.map((other) => other.name);
  return {
    plan: {
      action: "add_tag",
      targetIds: [clipping.id, tag.id],
      before: { tags: namesBefore },
      after: {
        tags: [...namesBefore, tag.name],
        tag: { id: tag.id, name: tag.name },
        summary: `Add the tag "${tag.name}" to "${clipping.title}"`,
      },
      waitingFor: null,
      write: async (writer) => {
        await writer
          .insert(clippingTags)
          .values({ clippingId: clipping.id, tagId: tag.id, userId })
          .onConflictDoNothing();
        // The tag no longer waits as a suggestion.
        await writer
          .delete(clippingTagSuggestions)
          .where(
            and(
              eq(clippingTagSuggestions.clippingId, clipping.id),
              eq(clippingTagSuggestions.userId, userId),
              sql`lower(${clippingTagSuggestions.name}) = ${tagNameKey(tag.name)}`,
            ),
          );
      },
    },
  };
}

async function planColor(
  tx: Transaction,
  userId: string,
  actor: ProposingActor,
  proposal: Extract<ProposedChange, { action: "set_tag_color" }>,
): Promise<PlanOutcome> {
  if (!isTagColorChoice(proposal.color)) throw new LibrarianInvalidError("Not a tag color");
  const tag = await loadTag(tx, userId, proposal.tagId);
  if (proposal.color === AUTOMATIC_TAG_COLOR) return planAutomaticColor(tx, userId, actor, tag);
  const color = proposal.color;
  // A color the user chose stays: only the user, here through Claude, changes it again.
  if (actor === "librarian" && tag.colorOverridden) {
    return { skip: "The user chose this tag's color, so the librarian leaves it" };
  }
  const overridden = actor === "user_via_mcp" ? true : tag.colorOverridden;
  if (tag.color === color && overridden === tag.colorOverridden) {
    return { skip: `The tag is already ${color}` };
  }
  return {
    plan: {
      action: "set_tag_color",
      targetIds: [tag.id],
      before: { color: tag.color, colorOverridden: tag.colorOverridden },
      after: {
        color,
        colorOverridden: overridden,
        summary: `Color the tag "${tag.name}" ${color}`,
      },
      waitingFor: null,
      write: async (writer) => {
        await writer
          .update(tags)
          .set({ color, colorOverridden: overridden })
          .where(and(eq(tags.id, tag.id), eq(tags.userId, userId)));
      },
    },
  };
}

/**
 * Hands a tag's color back: the user's own choice is dropped and the tag takes its folder's color,
 * or none outside a folder, and the librarian may color it again.
 */
async function planAutomaticColor(
  tx: Transaction,
  userId: string,
  actor: ProposingActor,
  tag: typeof tags.$inferSelect,
): Promise<PlanOutcome> {
  if (actor !== "user_via_mcp") {
    throw new LibrarianInvalidError("Only the user can give a tag back its automatic color");
  }
  let color: TagColor = "none";
  if (tag.folderId) {
    const [folder] = await tx
      .select({ color: folders.color })
      .from(folders)
      .where(and(eq(folders.id, tag.folderId), eq(folders.userId, userId)));
    color = folder?.color ?? "none";
  }
  if (!tag.colorOverridden && tag.color === color) {
    return { skip: "The tag already has its automatic color" };
  }
  return {
    plan: {
      action: "set_tag_color",
      targetIds: [tag.id],
      before: { color: tag.color, colorOverridden: tag.colorOverridden },
      after: {
        color,
        colorOverridden: false,
        summary: `Give the tag "${tag.name}" its automatic color`,
      },
      waitingFor: null,
      write: async (writer) => {
        await writer
          .update(tags)
          .set({ color, colorOverridden: false })
          .where(and(eq(tags.id, tag.id), eq(tags.userId, userId)));
      },
    },
  };
}

async function planCreateFolder(
  tx: Transaction,
  userId: string,
  proposal: Extract<ProposedChange, { action: "create_folder" }>,
): Promise<PlanOutcome> {
  const name = normalizeTagName(proposal.name);
  if (name === "") throw new LibrarianInvalidError("A folder needs a name");
  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    throw new LibrarianInvalidError(
      `A folder name can be at most ${MAX_FOLDER_NAME_LENGTH} characters`,
    );
  }
  const color = proposal.color ?? "none";
  if (!isTagColor(color)) throw new LibrarianInvalidError("Not a folder color");
  if (proposal.id !== undefined && !isUuid(proposal.id)) {
    throw new LibrarianInvalidError("A folder id is a UUID");
  }
  const [taken] = await tx
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.userId, userId), sql`lower(${folders.name}) = ${tagNameKey(name)}`));
  if (taken) return { skip: `A folder named ${name} already exists` };
  const id = proposal.id ?? crypto.randomUUID();
  return {
    plan: {
      action: "create_folder",
      targetIds: [id],
      before: null,
      after: { folder: { id, name, color }, summary: `Create the folder "${name}"` },
      waitingFor: null,
      write: async (writer, { at }) => {
        await writer
          .insert(folders)
          .values({ id, userId, name, color, createdAt: at, updatedAt: at });
      },
    },
  };
}

async function planMove(
  tx: Transaction,
  userId: string,
  proposal: Extract<ProposedChange, { action: "move_to_folder" }>,
  pending: PendingFolders,
): Promise<PlanOutcome> {
  if (!isUuid(proposal.folderId)) throw new LibrarianNotFoundError("folder");
  const [folder] = await tx
    .select({ id: folders.id, name: folders.name, color: folders.color })
    .from(folders)
    .where(and(eq(folders.id, proposal.folderId), eq(folders.userId, userId)));
  let folderColor: TagColor;
  let folderName: string;
  let waitingFor: string | null = null;
  if (folder) {
    folderColor = folder.color;
    folderName = folder.name;
  } else {
    // A folder an earlier proposal creates, or a suggestion to create it, still counts as the
    // folder; the move then waits for it unless the list is only being planned and would create it.
    const queued = pending.get(proposal.folderId);
    if (queued) {
      folderColor = queued.color;
      folderName = queued.name;
      if (!queued.willExist) waitingFor = "the folder it moves into, which is only a suggestion";
    } else {
      const [suggestion] = await tx
        .select({ after: libraryChanges.after })
        .from(libraryChanges)
        .where(
          and(
            eq(libraryChanges.userId, userId),
            eq(libraryChanges.action, "create_folder"),
            eq(libraryChanges.status, "suggested"),
            sql`${libraryChanges.targetIds} @> array[${proposal.folderId}]::uuid[]`,
          ),
        )
        .limit(1);
      const suggested = (suggestion?.after as { folder?: { name?: string; color?: string } } | null)
        ?.folder;
      const color = suggested?.color;
      if (!suggestion) throw new LibrarianNotFoundError("folder");
      folderColor = color && isTagColor(color) ? color : "none";
      folderName = suggested?.name ?? "a new folder";
      waitingFor = "the folder it moves into, which is only a suggestion";
    }
  }

  if (proposal.itemKind === "clipping") {
    const clipping = await loadLiveClipping(tx, userId, proposal.itemId);
    if (clipping.folderId === proposal.folderId) return { skip: "It is already in that folder" };
    return {
      plan: {
        action: "move_to_folder",
        targetIds: [clipping.id, proposal.folderId],
        before: { itemKind: "clipping", folderId: clipping.folderId },
        after: {
          itemKind: "clipping",
          folderId: proposal.folderId,
          summary: `Move "${clipping.title}" into the folder "${folderName}"`,
        },
        waitingFor,
        write: async (writer) => {
          await writer
            .update(clippings)
            .set({ folderId: proposal.folderId })
            .where(and(eq(clippings.id, clipping.id), eq(clippings.userId, userId)));
        },
      },
    };
  }

  const tag = await loadTag(tx, userId, proposal.itemId);
  if (tag.folderId === proposal.folderId) return { skip: "It is already in that folder" };
  // The tag's color follows its folder, unless the user chose one.
  const color = tag.colorOverridden ? tag.color : folderColor;
  return {
    plan: {
      action: "move_to_folder",
      targetIds: [tag.id, proposal.folderId],
      before: {
        itemKind: "tag",
        folderId: tag.folderId,
        color: tag.color,
        colorOverridden: tag.colorOverridden,
      },
      after: {
        itemKind: "tag",
        folderId: proposal.folderId,
        color,
        summary: `Move the tag "${tag.name}" into the folder "${folderName}"`,
      },
      waitingFor,
      write: async (writer) => {
        await writer
          .update(tags)
          .set({ folderId: proposal.folderId, color })
          .where(and(eq(tags.id, tag.id), eq(tags.userId, userId)));
      },
    },
  };
}

async function planLink(
  tx: Transaction,
  userId: string,
  actor: ProposingActor,
  proposal: Extract<ProposedChange, { action: "link_items" }>,
): Promise<PlanOutcome> {
  const reason = checkedReason(proposal.reason);
  if (proposal.fromId === proposal.toId)
    throw new LibrarianInvalidError("Can't link an item to itself");
  if (proposal.id !== undefined && !isUuid(proposal.id)) {
    throw new LibrarianInvalidError("A link id is a UUID");
  }
  const from = await loadLiveClipping(tx, userId, proposal.fromId);
  const to = await loadLiveClipping(tx, userId, proposal.toId);
  const [existing] = await tx
    .select({ id: itemLinks.id })
    .from(itemLinks)
    .where(
      and(
        eq(itemLinks.userId, userId),
        sql`least(${itemLinks.fromId}, ${itemLinks.toId}) = least(${from.id}::uuid, ${to.id}::uuid)`,
        sql`greatest(${itemLinks.fromId}, ${itemLinks.toId}) = greatest(${from.id}::uuid, ${to.id}::uuid)`,
      ),
    );
  if (existing) return { skip: "They are linked already" };
  const id = proposal.id ?? crypto.randomUUID();
  const createdBy: ItemLinkCreator = actor;
  return {
    plan: {
      action: "link_items",
      targetIds: [from.id, to.id],
      before: null,
      after: {
        link: { id, fromId: from.id, toId: to.id, reason, createdBy },
        summary: `Link "${from.title}" and "${to.title}"`,
      },
      waitingFor: null,
      write: async (writer, { at }) => {
        await writer
          .insert(itemLinks)
          .values({ id, userId, fromId: from.id, toId: to.id, reason, createdBy, createdAt: at });
      },
    },
  };
}

async function planTopicPage(
  tx: Transaction,
  userId: string,
  proposal: Extract<ProposedChange, { action: "write_topic_page" }>,
): Promise<PlanOutcome> {
  const body = proposal.body.trim();
  if (body === "") throw new LibrarianInvalidError("A topic page needs some text");
  if (body.length > MAX_TOPIC_PAGE_LENGTH) {
    throw new LibrarianInvalidError(
      `A topic page can be at most ${MAX_TOPIC_PAGE_LENGTH} characters`,
    );
  }
  const tag = await loadTag(tx, userId, proposal.tagId);
  const [existing] = await tx
    .select({ body: topicPages.body, updatedAt: topicPages.updatedAt })
    .from(topicPages)
    .where(and(eq(topicPages.tagId, tag.id), eq(topicPages.userId, userId)));
  if (existing?.body === body) return { skip: "The topic page already says that" };
  return {
    plan: {
      action: "write_topic_page",
      targetIds: [tag.id],
      before: existing
        ? { body: existing.body, updatedAt: formatIsoUtc(existing.updatedAt) }
        : null,
      after: { body, summary: `Write the topic page for the tag "${tag.name}"` },
      waitingFor: null,
      write: async (writer, { at }) => {
        await writer
          .insert(topicPages)
          .values({ tagId: tag.id, userId, body, source: "ai", updatedAt: at })
          .onConflictDoUpdate({
            target: topicPages.tagId,
            set: { body, source: "ai", updatedAt: at },
          });
      },
    },
  };
}

async function planRename(
  tx: Transaction,
  userId: string,
  proposal: Extract<ProposedChange, { action: "rename_tag" }>,
): Promise<PlanOutcome> {
  const name = normalizeTagName(proposal.name);
  if (name === "") throw new InvalidTagsError("A tag needs a name");
  if (name.length > MAX_TAG_LENGTH) {
    throw new InvalidTagsError(`A tag can be at most ${MAX_TAG_LENGTH} characters`);
  }
  const tag = await loadTag(tx, userId, proposal.tagId);
  if (tag.name === name) return { skip: "The tag already has that name" };
  const [clash] = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(
      and(
        eq(tags.userId, userId),
        sql`lower(${tags.name}) = ${tagNameKey(name)}`,
        sql`${tags.id} <> ${tag.id}::uuid`,
      ),
    );
  if (clash) throw new TagNameTakenError(name);
  return {
    plan: {
      action: "rename_tag",
      targetIds: [tag.id],
      before: { name: tag.name },
      after: { name, summary: `Rename the tag "${tag.name}" to "${name}"` },
      waitingFor: null,
      write: async (writer) => {
        await writer
          .update(tags)
          .set({ name })
          .where(and(eq(tags.id, tag.id), eq(tags.userId, userId)));
      },
    },
  };
}

/** A tag row as the log keeps it, enough to recreate the tag. */
interface TagSnapshot {
  id: string;
  name: string;
  color: TagColor;
  colorOverridden: boolean;
  folderId: string | null;
  createdAt: string;
}

/** What goes with a tag when it is removed: its clippings and its topic page (both cascade). */
interface TagContents {
  /** Every clipping that carried the tag. */
  clippingIds: string[];
  topicPage: { body: string; updatedAt: string } | null;
}

/** What a merge removes, kept so that undoing it can put it all back. */
interface MergeBefore extends TagContents {
  source: TagSnapshot;
  target: { id: string; name: string };
  /** The ones among the clippings that did not carry the target and so gained it. */
  addedToTarget: string[];
}

/** What deleting a tag removes, kept so that undoing it can put it all back. */
interface DeleteBefore extends TagContents {
  tag: TagSnapshot;
}

const snapshotTag = (tag: typeof tags.$inferSelect): TagSnapshot => ({
  id: tag.id,
  name: tag.name,
  color: tag.color,
  colorOverridden: tag.colorOverridden,
  folderId: tag.folderId,
  createdAt: formatIsoUtc(tag.createdAt),
});

/** The clippings carrying the tag and its topic page: what removing the tag takes with it. */
async function tagContents(tx: Transaction, userId: string, tagId: string): Promise<TagContents> {
  const carriers = await tx
    .select({ clippingId: clippingTags.clippingId })
    .from(clippingTags)
    .where(and(eq(clippingTags.tagId, tagId), eq(clippingTags.userId, userId)))
    .orderBy(clippingTags.clippingId);
  const [page] = await tx
    .select({ body: topicPages.body, updatedAt: topicPages.updatedAt })
    .from(topicPages)
    .where(and(eq(topicPages.tagId, tagId), eq(topicPages.userId, userId)));
  return {
    clippingIds: carriers.map((row) => row.clippingId),
    topicPage: page ? { body: page.body, updatedAt: formatIsoUtc(page.updatedAt) } : null,
  };
}

async function planDelete(
  tx: Transaction,
  userId: string,
  actor: ProposingActor,
  proposal: Extract<ProposedChange, { action: "delete_tag" }>,
): Promise<PlanOutcome> {
  // Deleting a tag is the user's call, never a librarian suggestion.
  if (actor !== "user_via_mcp") {
    throw new LibrarianInvalidError("Only the user can delete a tag");
  }
  const tag = await loadTag(tx, userId, proposal.tagId);
  const contents = await tagContents(tx, userId, tag.id);
  const before: DeleteBefore = { tag: snapshotTag(tag), ...contents };
  const n = contents.clippingIds.length;
  return {
    plan: {
      action: "delete_tag",
      targetIds: [tag.id],
      before,
      after: {
        deleted: true,
        summary: `Delete the tag "${tag.name}" from ${n} clipping${n === 1 ? "" : "s"}`,
      },
      waitingFor: null,
      write: async (writer) => {
        // The clippings' links and the topic page go with it: both cascade on the tag.
        await writer.delete(tags).where(and(eq(tags.id, tag.id), eq(tags.userId, userId)));
      },
    },
  };
}

async function planMerge(
  tx: Transaction,
  userId: string,
  proposal: Extract<ProposedChange, { action: "merge_tag" | "fold_tag" }>,
): Promise<PlanOutcome> {
  if (proposal.sourceId === proposal.targetId) {
    throw new LibrarianInvalidError("That is one tag: there is nothing to merge");
  }
  const source = await loadTag(tx, userId, proposal.sourceId);
  const target = await loadTag(tx, userId, proposal.targetId);
  const { clippingIds, topicPage } = await tagContents(tx, userId, source.id);
  if (proposal.action === "fold_tag" && clippingIds.length > 1) {
    throw new LibrarianInvalidError("Only a tag used once can be folded into another");
  }
  const alreadyTarget = new Set(
    (
      await tx
        .select({ clippingId: clippingTags.clippingId })
        .from(clippingTags)
        .where(and(eq(clippingTags.tagId, target.id), eq(clippingTags.userId, userId)))
    ).map((row) => row.clippingId),
  );
  const before: MergeBefore = {
    source: snapshotTag(source),
    target: { id: target.id, name: target.name },
    clippingIds,
    addedToTarget: clippingIds.filter((id) => !alreadyTarget.has(id)),
    topicPage,
  };
  return {
    plan: {
      action: proposal.action,
      targetIds: [source.id, target.id],
      before,
      after: {
        targetId: target.id,
        targetName: target.name,
        moved: before.addedToTarget.length,
        summary: `${proposal.action === "fold_tag" ? "Fold" : "Merge"} the tag "${source.name}" (${clippingIds.length} clipping${clippingIds.length === 1 ? "" : "s"}) into "${target.name}"`,
      },
      waitingFor: null,
      write: async (writer) => {
        await writer
          .insert(clippingTags)
          .select(
            writer
              .select({
                clippingId: clippingTags.clippingId,
                tagId: sql`${target.id}::uuid`.as("tag_id"),
                userId: clippingTags.userId,
              })
              .from(clippingTags)
              .where(and(eq(clippingTags.tagId, source.id), eq(clippingTags.userId, userId))),
          )
          .onConflictDoNothing();
        // The source's links and topic page go with it: both cascade on the tag.
        await writer.delete(tags).where(and(eq(tags.id, source.id), eq(tags.userId, userId)));
      },
    },
  };
}

/**
 * The ids a change owns, which a later change must not have touched for it to be undone alone.
 * A move owns the item, not the folder (other items move into the same folder), and a merge owns
 * the tag it removed, not the one that took its clippings (which keeps being used).
 */
export function ownedTargets(action: string, targetIds: readonly string[]): string[] {
  if (action === "move_to_folder" || action === "merge_tag" || action === "fold_tag") {
    return targetIds.slice(0, 1);
  }
  return [...targetIds];
}

/** The proposal a stored change was made from, so a suggestion can be planned again. */
export function proposalOf(change: StoredChange): ProposedChange {
  const after = (change.after ?? {}) as Record<string, any>;
  const [first = "", second = ""] = change.targetIds;
  const common = { reason: change.reason, confidence: change.confidence };
  switch (change.action) {
    case "add_tag":
      return { ...common, action: "add_tag", clippingId: first, tagId: second };
    case "set_tag_color":
      return { ...common, action: "set_tag_color", tagId: first, color: after.color };
    case "create_folder":
      return {
        ...common,
        action: "create_folder",
        id: after.folder?.id,
        name: after.folder?.name,
        color: after.folder?.color,
      };
    case "move_to_folder":
      return {
        ...common,
        action: "move_to_folder",
        itemKind: after.itemKind,
        itemId: first,
        folderId: second,
      };
    case "link_items":
      return { ...common, action: "link_items", id: after.link?.id, fromId: first, toId: second };
    case "write_topic_page":
      return { ...common, action: "write_topic_page", tagId: first, body: after.body };
    case "rename_tag":
      return { ...common, action: "rename_tag", tagId: first, name: after.name };
    case "merge_tag":
    case "fold_tag":
      return { ...common, action: change.action, sourceId: first, targetId: second };
    case "delete_tag":
      // Only the user proposes it, and what the user proposes is applied: it is never stored as a
      // suggestion, so nothing needs to plan it again.
      throw new LibrarianInvalidError("A delete_tag change is never a suggestion");
    default:
      throw new LibrarianInvalidError(`Nothing here applies a ${change.action} change`);
  }
}

/** What re-proposing the same change would repeat: two changes with one signature are one idea. */
export function signatureOf(change: Pick<StoredChange, "action" | "targetIds" | "after">): string {
  const after = (change.after ?? {}) as Record<string, any>;
  const ids = change.targetIds.join(":");
  switch (change.action) {
    case "set_tag_color":
      return `${ids}:${after.color}`;
    case "create_folder":
      return tagNameKey(String(after.folder?.name ?? ""));
    case "link_items":
      return [...change.targetIds].toSorted().join(":");
    case "write_topic_page":
      return `${ids}:${after.body}`;
    case "rename_tag":
      return `${ids}:${tagNameKey(String(after.name ?? ""))}`;
    default:
      return ids;
  }
}

interface UndoableChange {
  id: string;
  userId: string;
  action: string;
  targetIds: string[];
  before: unknown;
  after: unknown;
}

const gone = (what: string) => new ChangeNotUndoableError(`${what} no longer exists`);

/** Puts back what the change replaced. Throws `ChangeNotUndoableError` or `ChangeConflictError` when it can't. */
export async function undoEffect(tx: Transaction, change: UndoableChange): Promise<void> {
  const { userId } = change;
  const [first = ""] = change.targetIds;
  const before = (change.before ?? {}) as Record<string, any>;
  const after = (change.after ?? {}) as Record<string, any>;
  switch (change.action) {
    case "set_tag_color": {
      const tag = await tx
        .update(tags)
        .set({ color: before.color, colorOverridden: before.colorOverridden })
        .where(and(eq(tags.id, first), eq(tags.userId, userId)))
        .returning({ id: tags.id });
      if (tag.length === 0) throw gone("The tag");
      return;
    }
    case "create_folder": {
      const [inClippings] = await tx
        .select({ n: count() })
        .from(clippings)
        .where(and(eq(clippings.folderId, first), eq(clippings.userId, userId)));
      const [inTags] = await tx
        .select({ n: count() })
        .from(tags)
        .where(and(eq(tags.folderId, first), eq(tags.userId, userId)));
      if ((inClippings?.n ?? 0) + (inTags?.n ?? 0) > 0) {
        throw new ChangeConflictError("The folder has things in it now, so it can't be removed");
      }
      await tx.delete(folders).where(and(eq(folders.id, first), eq(folders.userId, userId)));
      return;
    }
    case "move_to_folder": {
      // Back to the old folder, unless it has gone since.
      let folderId: string | null = null;
      if (before.folderId) {
        const [kept] = await tx
          .select({ id: folders.id })
          .from(folders)
          .where(and(eq(folders.id, before.folderId), eq(folders.userId, userId)));
        folderId = kept?.id ?? null;
      }
      if (after.itemKind === "tag") {
        const moved = await tx
          .update(tags)
          .set({ folderId, color: before.color, colorOverridden: before.colorOverridden })
          .where(and(eq(tags.id, first), eq(tags.userId, userId)))
          .returning({ id: tags.id });
        if (moved.length === 0) throw gone("The tag");
      } else {
        const moved = await tx
          .update(clippings)
          .set({ folderId })
          .where(and(eq(clippings.id, first), eq(clippings.userId, userId)))
          .returning({ id: clippings.id });
        if (moved.length === 0) throw gone("The item");
      }
      return;
    }
    case "link_items": {
      await tx
        .delete(itemLinks)
        .where(and(eq(itemLinks.id, after.link.id), eq(itemLinks.userId, userId)));
      return;
    }
    case "write_topic_page": {
      const [tag] = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.id, first), eq(tags.userId, userId)));
      if (!tag) throw gone("The tag");
      if (change.before === null) {
        await tx
          .delete(topicPages)
          .where(and(eq(topicPages.tagId, first), eq(topicPages.userId, userId)));
      } else {
        await tx
          .insert(topicPages)
          .values({
            tagId: first,
            userId,
            body: before.body,
            source: "ai",
            updatedAt: parseISO(before.updatedAt),
          })
          .onConflictDoUpdate({
            target: topicPages.tagId,
            set: { body: before.body, updatedAt: parseISO(before.updatedAt) },
          });
      }
      return;
    }
    case "rename_tag": {
      const [clash] = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(
          and(
            eq(tags.userId, userId),
            sql`lower(${tags.name}) = ${tagNameKey(before.name)}`,
            sql`${tags.id} <> ${first}::uuid`,
          ),
        );
      if (clash) throw new ChangeConflictError(`The user has another tag named ${before.name} now`);
      const renamed = await tx
        .update(tags)
        .set({ name: before.name })
        .where(and(eq(tags.id, first), eq(tags.userId, userId)))
        .returning({ id: tags.id });
      if (renamed.length === 0) throw gone("The tag");
      return;
    }
    case "delete_tag": {
      const { tag, clippingIds, topicPage } = change.before as DeleteBefore;
      await restoreTag(tx, userId, tag, { clippingIds, topicPage });
      return;
    }
    case "merge_tag":
    case "fold_tag": {
      await undoMerge(tx, userId, change.before as MergeBefore);
      return;
    }
    default:
      throw new ChangeNotUndoableError(`A ${change.action} change can't be undone here`);
  }
}

/** Recreates the tag a merge removed, with its color, folder, topic page and clippings. */
async function undoMerge(tx: Transaction, userId: string, before: MergeBefore) {
  const [target] = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.id, before.target.id), eq(tags.userId, userId)));
  if (!target) throw gone("The tag it was merged into");
  await restoreTag(tx, userId, before.source, before);
  if (before.addedToTarget.length > 0) {
    await tx
      .delete(clippingTags)
      .where(
        and(
          eq(clippingTags.tagId, before.target.id),
          eq(clippingTags.userId, userId),
          inArray(clippingTags.clippingId, before.addedToTarget),
        ),
      );
  }
}

/**
 * Recreates a removed tag under its old id, with its color, folder, topic page and clippings.
 * Throws `ChangeConflictError` when the user has a tag of that name again. A folder or clipping
 * that has gone since is left out.
 */
async function restoreTag(
  tx: Transaction,
  userId: string,
  tag: TagSnapshot,
  { clippingIds, topicPage }: TagContents,
) {
  const [clash] = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), sql`lower(${tags.name}) = ${tagNameKey(tag.name)}`));
  if (clash) throw new ChangeConflictError(`The user has a tag named ${tag.name} again`);
  let folderId: string | null = null;
  if (tag.folderId) {
    const [folder] = await tx
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, tag.folderId), eq(folders.userId, userId)));
    folderId = folder?.id ?? null;
  }
  await tx.insert(tags).values({
    id: tag.id,
    userId,
    name: tag.name,
    color: tag.color,
    colorOverridden: tag.colorOverridden,
    folderId,
    createdAt: parseISO(tag.createdAt),
  });
  if (clippingIds.length > 0) {
    // Only clippings that still exist: one removed for good since has nothing to be tagged.
    await tx
      .insert(clippingTags)
      .select(
        tx
          .select({
            clippingId: clippings.id,
            tagId: sql`${tag.id}::uuid`.as("tag_id"),
            userId: clippings.userId,
          })
          .from(clippings)
          .where(and(eq(clippings.userId, userId), inArray(clippings.id, clippingIds))),
      )
      .onConflictDoNothing();
  }
  if (topicPage) {
    await tx.insert(topicPages).values({
      tagId: tag.id,
      userId,
      body: topicPage.body,
      source: "ai",
      updatedAt: parseISO(topicPage.updatedAt),
    });
  }
}
