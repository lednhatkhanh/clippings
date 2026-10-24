import * as z from "zod";

import type { Tag } from "./tag.ts";

/** Where a clipping was saved from. */
export const CLIPPING_SOURCES = ["web", "extension", "mcp", "digest", "import"] as const;
export type ClippingSource = (typeof CLIPPING_SOURCES)[number];

/** Where a clipping is in enrichment. */
export const CLIPPING_STATUSES = ["pending", "ready", "failed"] as const;
export type ClippingStatus = (typeof CLIPPING_STATUSES)[number];

/** Longest note a clipping can carry, in characters. */
export const MAX_NOTE_LENGTH = 10_000;

/** Longest title the user can give a clipping, in characters: as long as enrichment writes. */
export const MAX_TITLE_LENGTH = 300;

/** Most of a page's readable text enrichment reads and keeps, in characters. */
export const MAX_PAGE_TEXT = 20_000;

/** Most clippings one status read (`GET /api/clippings/status`) asks about. */
export const MAX_STATUS_IDS = 50;

/**
 * `GET /api/clippings/status?ids=a,b,c`: the ids of clippings whose status the list wants, comma
 * separated. Refused when empty, over `MAX_STATUS_IDS`, or when any is not a UUID.
 */
export const clippingStatusIdsSchema = z
  .string()
  .transform((ids) => ids.split(","))
  .pipe(z.array(z.uuid()).min(1).max(MAX_STATUS_IDS));

/** The answer to a status read: each clipping the user has, with where it is in enrichment. */
export interface ClippingStatuses {
  statuses: { id: string; status: ClippingStatus }[];
}

/** A clipping as every delivery surface sees it. JSON-safe, so it crosses the server/client line. */
export interface Clipping {
  id: string;
  url: string;
  /** What duplicate detection compares: `url` without tracking parameters, fragment and the like. */
  urlNormalized: string;
  /**
   * The title to show: the user's own when they renamed the clipping, otherwise the page's. The
   * URL until enrichment reads the page.
   */
  title: string;
  /** The page's title as enrichment wrote it, whether or not the user renamed the clipping. */
  pageTitle: string;
  /** Whether `title` is the user's own. */
  titleEdited: boolean;
  note: string;
  /** What the page is about, once enrichment has read it. */
  summary: string | null;
  /** A passage worth keeping, once enrichment has read the page. */
  excerpt: string | null;
  status: ClippingStatus;
  source: ClippingSource;
  /** The OAuth client that saved it, when one did. */
  clientId: string | null;
  /** The user's tags on it, by name. Only the user sets them; enrichment never does. */
  tags: Tag[];
  /** Whether the user pinned it above the newest-first list. */
  pinned: boolean;
  /**
   * ISO 8601: when the page was first found gone, after several weekly checks in a row. Null while
   * the link answers or hasn't been found gone.
   */
  linkDeadSince: string | null;
  /**
   * Tag names enrichment suggests and the user has neither added nor dismissed. Only the detail
   * read fills it, and only while the user has tag suggestions on; empty everywhere else.
   */
  suggestedTags: string[];
  /** ISO 8601. */
  createdAt: string;
}
