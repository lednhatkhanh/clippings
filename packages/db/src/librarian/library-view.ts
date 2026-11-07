import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

import { formatIsoUtc, type Folder, type TagColor } from "@clippings/shared";

import type { Database } from "../database.ts";
import { clippings, clippingTags, folders, tags, topicPages } from "../schema.ts";

/** Most clippings and notes the librarian's view of a library lists, newest first. */
export const LIBRARY_VIEW_ITEM_LIMIT = 1_500;

/** Longest summary a view item carries, in characters: the view is read by a model, so it stays small. */
const SUMMARY_LENGTH = 400;

/** One clipping or note as the librarian reads it. */
export interface LibraryViewItem {
  id: string;
  kind: "link" | "note";
  /** The title the user sees. */
  title: string;
  /** The page's summary, or the start of a note's text; null before enrichment wrote one. */
  summary: string | null;
  tags: string[];
  folderId: string | null;
  /** ISO 8601. */
  savedAt: string;
}

/** One tag as the librarian reads it. */
export interface LibraryViewTag {
  id: string;
  name: string;
  /** How many of the user's clippings and notes carry it. */
  usage: number;
  folderId: string | null;
  color: TagColor;
  colorOverridden: boolean;
  /** ISO 8601. */
  createdAt: string;
  hasTopicPage: boolean;
}

/** A user's library in the compact form the librarian plans from. */
export interface LibraryView {
  /** Newest first, at most `LIBRARY_VIEW_ITEM_LIMIT` of them. */
  items: LibraryViewItem[];
  /** How many live clippings and notes the user has, whether or not `items` lists them all. */
  totalItems: number;
  tags: LibraryViewTag[];
  folders: Folder[];
}

/** The user's library as the librarian reads it. Every query is scoped to the user. */
export async function readLibraryView(
  db: Database,
  userId: string,
  limit = LIBRARY_VIEW_ITEM_LIMIT,
): Promise<LibraryView> {
  const live = and(eq(clippings.userId, userId), isNull(clippings.deletedAt));

  const [total] = await db.select({ n: count() }).from(clippings).where(live);

  const rows = await db
    .select({
      id: clippings.id,
      kind: clippings.kind,
      title: sql<string>`coalesce(${clippings.userTitle}, ${clippings.title})`,
      summary: sql<
        string | null
      >`left(coalesce(${clippings.summary}, ${clippings.body}, ${clippings.excerpt}), ${SUMMARY_LENGTH})`,
      folderId: clippings.folderId,
      createdAt: clippings.createdAt,
    })
    .from(clippings)
    .where(live)
    .orderBy(desc(clippings.createdAt), desc(clippings.id))
    .limit(limit);

  const links = await db
    .select({ clippingId: clippingTags.clippingId, tagId: clippingTags.tagId })
    .from(clippingTags)
    .innerJoin(clippings, eq(clippings.id, clippingTags.clippingId))
    .where(and(eq(clippingTags.userId, userId), isNull(clippings.deletedAt)));

  const tagRows = await db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      colorOverridden: tags.colorOverridden,
      folderId: tags.folderId,
      createdAt: tags.createdAt,
      topicPage: topicPages.tagId,
    })
    .from(tags)
    .leftJoin(topicPages, eq(topicPages.tagId, tags.id))
    .where(eq(tags.userId, userId))
    .orderBy(sql`lower(${tags.name})`, tags.name);

  const folderRows = await db
    .select({ id: folders.id, name: folders.name, color: folders.color })
    .from(folders)
    .where(eq(folders.userId, userId))
    .orderBy(sql`lower(${folders.name})`, folders.name);

  const nameOf = new Map(tagRows.map((tag) => [tag.id, tag.name]));
  const usage = new Map<string, number>();
  const tagNames = new Map<string, string[]>();
  for (const { clippingId, tagId } of links) {
    usage.set(tagId, (usage.get(tagId) ?? 0) + 1);
    const name = nameOf.get(tagId);
    if (name !== undefined) tagNames.set(clippingId, [...(tagNames.get(clippingId) ?? []), name]);
  }

  return {
    totalItems: total?.n ?? 0,
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      tags: (tagNames.get(row.id) ?? []).toSorted((a, b) => a.localeCompare(b)),
      folderId: row.folderId,
      savedAt: formatIsoUtc(row.createdAt),
    })),
    tags: tagRows.map((tag) => ({
      id: tag.id,
      name: tag.name,
      usage: usage.get(tag.id) ?? 0,
      folderId: tag.folderId,
      color: tag.color,
      colorOverridden: tag.colorOverridden,
      createdAt: formatIsoUtc(tag.createdAt),
      hasTopicPage: tag.topicPage !== null,
    })),
    folders: folderRows,
  };
}
