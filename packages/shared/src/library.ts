import * as z from "zod";

import type { TagColor } from "./tag.ts";

/**
 * Whether automation applies tags itself, for a user with no `user_settings` row. The column's
 * default is the same, so it holds for every user, those who existed before auto-tagging included.
 */
export const AUTO_TAG_DEFAULT = true;

/** A change to the auto-tagging setting, as a client sends it. Anything else is refused. */
export const autoTagChangeSchema = z.strictObject({
  autoTag: z.boolean("Auto-tagging is on or off"),
});
export type AutoTagChange = z.infer<typeof autoTagChangeSchema>;

/** Who made a change to the library. */
export const LIBRARY_CHANGE_ACTORS = ["auto_tag", "librarian", "user_via_mcp"] as const;
export type LibraryChangeActor = (typeof LIBRARY_CHANGE_ACTORS)[number];
export const libraryChangeActorSchema = z.enum(LIBRARY_CHANGE_ACTORS);

/**
 * What a change does. The database stores it as plain text without a check, so a new action needs
 * no migration; this list is the code's side of it.
 *
 * - `add_tag`: an existing tag put on a clipping. `targetIds` is `[clippingId, tagId]`.
 * - `create_tag`: a new tag created and put on a clipping. `targetIds` is `[clippingId, tagId]`
 *   (the tag id is the one the tag got, or will get when a suggestion is applied).
 *
 * Phase 3 (the librarian) writes the rest.
 */
export const LIBRARY_CHANGE_ACTIONS = [
  "add_tag",
  "create_tag",
  "merge_tag",
  "rename_tag",
  "fold_tag",
  "set_tag_color",
  "create_folder",
  "move_to_folder",
  "link_items",
  "write_topic_page",
] as const;
export type LibraryChangeAction = (typeof LIBRARY_CHANGE_ACTIONS)[number];
export const libraryChangeActionSchema = z.enum(LIBRARY_CHANGE_ACTIONS);

/**
 * How sure the actor was. `high` changes are applied; `low` ones wait as suggestions. Null on a
 * change that carries no judgement, such as one the user asked for.
 */
export const LIBRARY_CHANGE_CONFIDENCES = ["high", "low"] as const;
export type LibraryChangeConfidence = (typeof LIBRARY_CHANGE_CONFIDENCES)[number];
export const libraryChangeConfidenceSchema = z.enum(LIBRARY_CHANGE_CONFIDENCES);

/** Where a change stands: done, proposed and waiting, turned down, or done and then reverted. */
export const LIBRARY_CHANGE_STATUSES = ["applied", "suggested", "dismissed", "undone"] as const;
export type LibraryChangeStatus = (typeof LIBRARY_CHANGE_STATUSES)[number];
export const libraryChangeStatusSchema = z.enum(LIBRARY_CHANGE_STATUSES);

/** One row of the change log, as every delivery surface sees it. JSON-safe. */
export interface LibraryChange {
  id: string;
  actor: LibraryChangeActor;
  action: LibraryChangeAction;
  /** Ids (clippings, tags, folders) the change touched. */
  targetIds: string[];
  /** The state the change replaced; enough to undo it. Null when nothing existed before. */
  before: unknown;
  after: unknown;
  confidence: LibraryChangeConfidence | null;
  status: LibraryChangeStatus;
  /** One line on why the actor made or proposed it. */
  reason: string;
  /** ISO 8601. */
  createdAt: string;
}

/** Longest folder name, in characters. Folder names are unique per user, ignoring case. */
export const MAX_FOLDER_NAME_LENGTH = 60;

/** Longest reason on a link between two clippings, in characters. */
export const MAX_LINK_REASON_LENGTH = 300;

/** Longest topic page body, in characters of Markdown. */
export const MAX_TOPIC_PAGE_LENGTH = 8_000;

/** Who made a link between two clippings. */
export const ITEM_LINK_CREATORS = ["librarian", "user_via_mcp", "user"] as const;
export type ItemLinkCreator = (typeof ITEM_LINK_CREATORS)[number];
export const itemLinkCreatorSchema = z.enum(ITEM_LINK_CREATORS);

/** Who wrote a topic page. Only the librarian does for now. */
export const TOPIC_PAGE_SOURCES = ["ai"] as const;
export type TopicPageSource = (typeof TOPIC_PAGE_SOURCES)[number];

/**
 * A folder a clipping or tag can sit in. The color is a `TAG_COLORS` name, rendered through each
 * palette's tag tokens, never a hex value.
 */
export interface Folder {
  id: string;
  name: string;
  color: TagColor;
}

/** A link between two clippings, with why they belong together. JSON-safe. */
export interface ItemLink {
  id: string;
  fromId: string;
  toId: string;
  reason: string;
  createdBy: ItemLinkCreator;
  /** ISO 8601. */
  createdAt: string;
}

/** The page the librarian writes for a tag. JSON-safe. */
export interface TopicPage {
  tagId: string;
  /** Markdown. */
  body: string;
  source: TopicPageSource;
  /** ISO 8601. */
  updatedAt: string;
}
