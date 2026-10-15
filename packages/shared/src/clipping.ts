/** Where a clipping was saved from. */
export const CLIPPING_SOURCES = ["web", "extension", "mcp", "digest"] as const;
export type ClippingSource = (typeof CLIPPING_SOURCES)[number];

/** Where a clipping is in enrichment. */
export const CLIPPING_STATUSES = ["pending", "ready", "failed"] as const;
export type ClippingStatus = (typeof CLIPPING_STATUSES)[number];

/** Longest note a clipping can carry, in characters. */
export const MAX_NOTE_LENGTH = 10_000;

/** A clipping as every delivery surface sees it. JSON-safe, so it crosses the server/client line. */
export interface Clipping {
  id: string;
  url: string;
  /** The URL until enrichment reads the page. */
  title: string;
  note: string;
  status: ClippingStatus;
  source: ClippingSource;
  /** The OAuth client that saved it, when one did. */
  clientId: string | null;
  /** ISO 8601. */
  createdAt: string;
}
