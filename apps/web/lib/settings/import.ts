import {
  MAX_BOOKMARKS_FILE_BYTES,
  MAX_BOOKMARKS_PER_IMPORT,
  parseBookmarksHtml,
  type ParsedBookmark,
} from "@clippings/shared";

/** What the import preview tells the user before they confirm. */
export interface ImportPreview {
  /** Bookmarks that become new clippings. */
  willImport: number;
  /** Bookmarks already saved (the same duplicate rules as saving a page). */
  alreadySaved: number;
  /** Links that are not web pages, plus bookmarks whose URL could not be used. */
  skipped: number;
}

/** What an import did, and how many imported clippings still wait to be read. */
export interface ImportDone {
  created: number;
  existing: number;
  skipped: number;
  /** Imported clippings not read yet, after this import. */
  pending: number;
}

/** What an import action returns: a result, or a message to show in its place. */
export type ImportActionResult<T> = { ok: true; value: T } | { ok: false; message: string };

const MEGABYTE = 1024 * 1024;
const MAX_FILE_MEGABYTES = MAX_BOOKMARKS_FILE_BYTES / MEGABYTE;

function count(value: number): string {
  return value.toLocaleString("en-US");
}

/** A clear message when a chosen file cannot be imported, or null when it can be tried. */
export function bookmarksFileProblem(file: { size: number }): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_BOOKMARKS_FILE_BYTES) {
    return `That file is too large. Bookmark files up to ${MAX_FILE_MEGABYTES} MB can be imported.`;
  }
  return null;
}

/**
 * Shown when the server action itself fails: the connection dropped, or the server turned the
 * request away (for example a file over the size it accepts) before the import ran.
 */
export const IMPORT_REQUEST_FAILED = `That file couldn't be sent to Clippings. Check your connection and try again; bookmark files up to ${MAX_FILE_MEGABYTES} MB can be imported.`;

const PARSE_ERRORS = {
  not_bookmarks:
    "That doesn't look like a bookmarks file. Export your bookmarks as HTML from your browser or bookmark service and choose that file.",
  too_many: `That file has too many bookmarks. Up to ${MAX_BOOKMARKS_PER_IMPORT.toLocaleString("en-US")} can be imported at once, so split it into smaller files.`,
} as const;

export type ParsedUpload =
  | { ok: true; bookmarks: ParsedBookmark[]; notWeb: number }
  | { ok: false; message: string };

/** Checks an uploaded file's size, then parses it, turning every failure into a message. */
export async function parseBookmarksUpload(file: {
  size: number;
  text: () => Promise<string>;
}): Promise<ParsedUpload> {
  const problem = bookmarksFileProblem(file);
  if (problem) return { ok: false, message: problem };
  const parsed = parseBookmarksHtml(await file.text());
  if (!parsed.ok) return { ok: false, message: PARSE_ERRORS[parsed.error] };
  return { ok: true, bookmarks: parsed.bookmarks, notWeb: parsed.skipped.length };
}

/** The preview as one to three short sentences. */
export function describePreview({ willImport, alreadySaved, skipped }: ImportPreview): string {
  const parts = [
    willImport === 0
      ? "No new bookmarks to import."
      : `${count(willImport)} ${willImport === 1 ? "bookmark" : "bookmarks"} will be imported.`,
  ];
  if (alreadySaved > 0) {
    parts.push(`${count(alreadySaved)} already saved.`);
  }
  if (skipped > 0) {
    parts.push(
      `${count(skipped)} ${skipped === 1 ? "link is" : "links are"} skipped (not web pages or unusable).`,
    );
  }
  return parts.join(" ");
}

/** What an import did, as a sentence. */
export function describeImported({ created, existing, skipped }: ImportDone): string {
  const parts = [
    created === 0
      ? "Nothing new was imported."
      : `Imported ${count(created)} ${created === 1 ? "clipping" : "clippings"}.`,
  ];
  if (existing > 0) parts.push(`${count(existing)} already saved.`);
  if (skipped > 0) {
    parts.push(`${count(skipped)} ${skipped === 1 ? "link was" : "links were"} skipped.`);
  }
  return parts.join(" ");
}

/** How many imported clippings still wait to be read, or null when none do. */
export function describePending(pending: number): string | null {
  if (pending <= 0) return null;
  const waiting =
    pending === 1 ? "1 imported clipping is" : `${count(pending)} imported clippings are`;
  return `${waiting} waiting to be read. A large import is read gradually over several days, so titles and summaries fill in as it goes.`;
}
