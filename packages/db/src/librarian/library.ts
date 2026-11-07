import { and, count, desc, eq, or, sql } from "drizzle-orm";
import type pg from "pg";

import {
  formatIsoUtc,
  type Folder,
  type ItemLinkCreator,
  type LibraryChange,
  type Tag,
  type TopicPage,
} from "@clippings/shared";

import { createDatabase } from "../database.ts";
import {
  clippings,
  clippingTags,
  folders,
  itemLinks,
  libraryChanges,
  tags,
  topicPages,
} from "../schema.ts";

export interface LibraryServiceDeps {
  pool: pg.Pool;
}

/** A clipping linked to another, as the other's detail page lists it. */
export interface LinkedClipping {
  linkId: string;
  id: string;
  /** The title to show: the user's own, else the page's. */
  title: string;
  /** The page's address; null on a note. */
  url: string | null;
  /** Why the two belong together. */
  reason: string;
  createdBy: ItemLinkCreator;
}

/** The folder a clipping sits in and what it links to. */
export interface ClippingPlacement {
  folder: Folder | null;
  links: LinkedClipping[];
}

/** Where a tag sits and whether the user chose its color. */
export interface TagPlacement {
  tagId: string;
  folder: Folder | null;
  /** True once the user chose the color: the librarian then leaves it alone. */
  colorOverridden: boolean;
  hasTopicPage: boolean;
}

/** A tag's topic page, with the tag and its folder. */
export interface TagTopic {
  tag: Tag;
  folder: Folder | null;
  clippingCount: number;
  /** Null until the librarian has written one. */
  page: TopicPage | null;
}

/** A change that took effect, with when. */
export interface AppliedChange extends LibraryChange {
  /** ISO 8601: when it took effect. A suggestion applied later has the later time. */
  appliedAt: string;
}

export const APPLIED_CHANGES_PAGE_SIZE = 30;
const MAX_APPLIED_CHANGES = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads of the librarian's work, for the pages that show it: where a clipping or tag is filed,
 * what a clipping links to, a tag's topic page and the log of applied changes. Every read is
 * scoped to the user. Writes go through the librarian service.
 */
export function createLibraryService({ pool }: LibraryServiceDeps) {
  const db = createDatabase(pool);

  /** The folder the clipping sits in and the live clippings it links to, either direction. */
  async function getClippingPlacement(
    userId: string,
    clippingId: string,
  ): Promise<ClippingPlacement> {
    if (!UUID.test(clippingId)) return { folder: null, links: [] };
    const [filed] = await db
      .select({ id: folders.id, name: folders.name, color: folders.color })
      .from(clippings)
      .innerJoin(
        folders,
        and(eq(folders.id, clippings.folderId), eq(folders.userId, clippings.userId)),
      )
      .where(and(eq(clippings.id, clippingId), eq(clippings.userId, userId)));

    const rows = await db
      .select({
        linkId: itemLinks.id,
        id: clippings.id,
        title: sql<string>`coalesce(${clippings.userTitle}, ${clippings.title})`,
        url: clippings.url,
        reason: itemLinks.reason,
        createdBy: itemLinks.createdBy,
      })
      .from(itemLinks)
      .innerJoin(
        clippings,
        and(
          eq(clippings.userId, itemLinks.userId),
          sql`${clippings.id} = case when ${itemLinks.fromId} = ${clippingId}::uuid then ${itemLinks.toId} else ${itemLinks.fromId} end`,
        ),
      )
      .where(
        and(
          eq(itemLinks.userId, userId),
          or(eq(itemLinks.fromId, clippingId), eq(itemLinks.toId, clippingId)),
          sql`${clippings.deletedAt} is null`,
        ),
      )
      .orderBy(desc(itemLinks.createdAt), desc(itemLinks.id));
    return { folder: filed ?? null, links: rows };
  }

  /** Where each of the user's tags sits: its folder, whether its color is the user's own, its page. */
  async function listTagPlacements(userId: string): Promise<TagPlacement[]> {
    const rows = await db
      .select({
        tagId: tags.id,
        colorOverridden: tags.colorOverridden,
        folderId: folders.id,
        folderName: folders.name,
        folderColor: folders.color,
        hasTopicPage: sql<boolean>`${topicPages.tagId} is not null`,
      })
      .from(tags)
      .leftJoin(folders, and(eq(folders.id, tags.folderId), eq(folders.userId, tags.userId)))
      .leftJoin(topicPages, and(eq(topicPages.tagId, tags.id), eq(topicPages.userId, tags.userId)))
      .where(eq(tags.userId, userId));
    return rows.map((row) => ({
      tagId: row.tagId,
      colorOverridden: row.colorOverridden,
      hasTopicPage: row.hasTopicPage,
      folder:
        row.folderId && row.folderName && row.folderColor
          ? { id: row.folderId, name: row.folderName, color: row.folderColor }
          : null,
    }));
  }

  /** The tag's topic page with the tag and its folder; null when the user has no such tag. */
  async function getTagTopic(userId: string, tagId: string): Promise<TagTopic | null> {
    if (!UUID.test(tagId)) return null;
    const [row] = await db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
        folderId: folders.id,
        folderName: folders.name,
        folderColor: folders.color,
        body: topicPages.body,
        source: topicPages.source,
        updatedAt: topicPages.updatedAt,
      })
      .from(tags)
      .leftJoin(folders, and(eq(folders.id, tags.folderId), eq(folders.userId, tags.userId)))
      .leftJoin(topicPages, and(eq(topicPages.tagId, tags.id), eq(topicPages.userId, tags.userId)))
      .where(and(eq(tags.id, tagId), eq(tags.userId, userId)));
    if (!row) return null;
    const [used] = await db
      .select({ n: count() })
      .from(clippingTags)
      .innerJoin(clippings, eq(clippings.id, clippingTags.clippingId))
      .where(
        and(
          eq(clippingTags.tagId, tagId),
          eq(clippingTags.userId, userId),
          sql`${clippings.deletedAt} is null`,
        ),
      );
    return {
      tag: { id: row.id, name: row.name, color: row.color },
      folder:
        row.folderId && row.folderName && row.folderColor
          ? { id: row.folderId, name: row.folderName, color: row.folderColor }
          : null,
      clippingCount: used?.n ?? 0,
      page:
        row.body === null || row.source === null || row.updatedAt === null
          ? null
          : { tagId, body: row.body, source: row.source, updatedAt: formatIsoUtc(row.updatedAt) },
    };
  }

  /**
   * The changes that took effect, most recent first: the librarian's, auto-tagging's and the
   * user's own through Claude. Undone, dismissed and waiting ones are not here.
   */
  async function listAppliedChanges(
    userId: string,
    limit = APPLIED_CHANGES_PAGE_SIZE,
  ): Promise<AppliedChange[]> {
    const size = Math.min(Math.max(Math.trunc(limit), 1), MAX_APPLIED_CHANGES);
    const tookEffect = sql`coalesce(${libraryChanges.appliedAt}, ${libraryChanges.createdAt})`;
    const rows = await db
      .select()
      .from(libraryChanges)
      .where(and(eq(libraryChanges.userId, userId), eq(libraryChanges.status, "applied")))
      .orderBy(desc(tookEffect), desc(libraryChanges.id))
      .limit(size);
    return rows.map((row) => ({
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
      appliedAt: formatIsoUtc(row.appliedAt ?? row.createdAt),
    }));
  }

  /** How many suggestions wait for the user's decision. */
  async function countSuggestions(userId: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(libraryChanges)
      .where(and(eq(libraryChanges.userId, userId), eq(libraryChanges.status, "suggested")));
    return row?.n ?? 0;
  }

  return {
    getClippingPlacement,
    listTagPlacements,
    getTagTopic,
    listAppliedChanges,
    countSuggestions,
  };
}

export type LibraryService = ReturnType<typeof createLibraryService>;
