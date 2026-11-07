import { differenceInDays, parseISO } from "date-fns";

import type { LibraryView, LibraryViewItem, LibraryViewTag } from "@clippings/db";
import type { Folder } from "@clippings/shared";

/** A tag used at most this many times may be folded into a broader one. */
export const FOLD_MAX_USAGE = 1;

/** How old a tag must be before it may be folded: the grace period to be used again. */
export const FOLD_GRACE_DAYS = 28;

/** A tag needs this many clippings and notes before it gets a topic page. */
export const TOPIC_PAGE_MIN_ITEMS = 3;

/** The most items a topic page request lists for a tag. */
const TOPIC_PAGE_ITEM_LIMIT = 25;

/** One line of a summary: whitespace made single spaces, cut at `max` characters. */
function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** Whether the tag has been used at most once for at least the grace period. */
export function isFoldEligible(tag: LibraryViewTag, now: Date): boolean {
  return (
    tag.usage <= FOLD_MAX_USAGE && differenceInDays(now, parseISO(tag.createdAt)) >= FOLD_GRACE_DAYS
  );
}

/**
 * A library as the model reads it, with short references instead of ids (`C12` for a clipping or
 * note, `T3` for a tag, `F1` for a folder): they cost a tenth of a UUID's tokens and the model
 * can't mistype one into a different id. The index maps a reference back to what it names.
 * References follow the order of the view, so the same library always gets the same ones.
 */
export interface LibraryIndex {
  view: LibraryView;
  now: Date;
  item: (ref: string) => LibraryViewItem | undefined;
  tag: (ref: string) => LibraryViewTag | undefined;
  folder: (ref: string) => Folder | undefined;
  itemRef: (id: string) => string | undefined;
  tagRef: (id: string) => string | undefined;
  folderRef: (id: string) => string | undefined;
  /** The text of the library for the model's system prompt. */
  text: string;
  /** Tags that carry this tag's name, to list a topic page's items. */
  itemsOfTag: (tag: LibraryViewTag) => LibraryViewItem[];
}

export function indexLibrary(view: LibraryView, now: Date): LibraryIndex {
  const items = new Map(view.items.map((item, i) => [`C${i + 1}`, item]));
  const tags = new Map(view.tags.map((tag, i) => [`T${i + 1}`, tag]));
  const folders = new Map(view.folders.map((folder, i) => [`F${i + 1}`, folder]));
  const refs = {
    item: new Map(view.items.map((item, i) => [item.id, `C${i + 1}`])),
    tag: new Map(view.tags.map((tag, i) => [tag.id, `T${i + 1}`])),
    folder: new Map(view.folders.map((folder, i) => [folder.id, `F${i + 1}`])),
  };
  const folderName = (id: string | null) =>
    id === null ? "no folder" : `folder ${refs.folder.get(id) ?? "?"}`;

  const lines: string[] = [];
  lines.push(`## Folders (${view.folders.length})`);
  for (const [ref, folder] of folders) {
    lines.push(`${ref} "${folder.name}" color ${folder.color}`);
  }
  if (view.folders.length === 0) lines.push("(none yet)");

  lines.push("", `## Tags (${view.tags.length})`);
  for (const [ref, tag] of tags) {
    const age = differenceInDays(now, parseISO(tag.createdAt));
    const flags = [
      `${tag.usage} ${tag.usage === 1 ? "item" : "items"}`,
      folderName(tag.folderId),
      tag.colorOverridden ? "color chosen by the user" : null,
      isFoldEligible(tag, now) ? "fold-eligible" : null,
      `${age}d old`,
    ].filter(Boolean);
    lines.push(`${ref} "${tag.name}" (${flags.join(", ")})`);
  }
  if (view.tags.length === 0) lines.push("(none yet)");

  const shown = view.items.length;
  lines.push(
    "",
    `## Clippings and notes (${shown}${view.totalItems > shown ? ` newest of ${view.totalItems}` : ""})`,
  );
  for (const [ref, item] of items) {
    const tagNames = item.tags.length > 0 ? item.tags.join(", ") : "no tags";
    const summary = item.summary ? ` — ${oneLine(item.summary, 160)}` : "";
    lines.push(
      `${ref} ${item.kind} "${oneLine(item.title, 100)}" [${tagNames}] (${folderName(item.folderId)})${summary}`,
    );
  }
  if (view.items.length === 0) lines.push("(none yet)");

  const text = lines.join("\n");

  return {
    view,
    now,
    item: (ref) => items.get(ref),
    tag: (ref) => tags.get(ref),
    folder: (ref) => folders.get(ref),
    itemRef: (id) => refs.item.get(id),
    tagRef: (id) => refs.tag.get(id),
    folderRef: (id) => refs.folder.get(id),
    text,
    itemsOfTag: (tag) =>
      view.items.filter((item) => item.tags.includes(tag.name)).slice(0, TOPIC_PAGE_ITEM_LIMIT),
  };
}
