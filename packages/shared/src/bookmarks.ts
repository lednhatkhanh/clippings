import { fromUnixTime, getUnixTime, parseISO } from "date-fns";

import { MAX_TAGS_PER_CLIPPING, normalizeTagName, normalizeTagNames } from "./tag.ts";

/**
 * Largest bookmarks file the caller accepts, in bytes. The parser itself does not check it. Vercel
 * Functions refuse a request body over 4.5 MB before the app runs, so the limit stays under it.
 */
export const MAX_BOOKMARKS_FILE_BYTES = 4 * 1024 * 1024;

/** Most importable bookmarks one import takes. */
export const MAX_BOOKMARKS_PER_IMPORT = 5_000;

/**
 * One importable link. `folders` is the folder path from outermost to innermost, followed by the
 * link's own `TAGS` (Firefox and Raindrop write them): both become tags, so they share the list.
 * The browser's root folders ("Bookmarks bar", "Other bookmarks" and the like) are left out, since
 * they say where the browser keeps a bookmark and not what it is about. The list holds at most
 * `MAX_TAGS_PER_CLIPPING` names: folders nested deeper than that are not named, and the cap cuts
 * the `TAGS` last. `title` is empty when the file gave none. `addedAt` is null when `ADD_DATE` is missing or not a date.
 */
export interface ParsedBookmark {
  url: string;
  title: string;
  addedAt: Date | null;
  folders: string[];
}

/** `not_web`: the address is not http or https (`javascript:`, `file:`, `chrome://`, `place:`). */
export type SkipReason = "not_web";

/** A link the import leaves out, and why. */
export interface SkippedBookmark {
  url: string;
  title: string;
  reason: SkipReason;
}

export type BookmarksParseResult =
  | { ok: true; bookmarks: ParsedBookmark[]; skipped: SkippedBookmark[] }
  | { ok: false; error: "not_bookmarks" | "too_many" };

/** A link to write out. `createdAt` is an ISO 8601 string. */
export interface BookmarkToExport {
  url: string;
  title: string;
  createdAt: string;
  tags: readonly string[];
}

/**
 * Folders that are the browser's own roots, as `rootKey` spells them. They are dropped only at the
 * top of the tree: a folder of the user's own, nested elsewhere, keeps its name. A root that the
 * file marks with `PERSONAL_TOOLBAR_FOLDER` or `UNFILED_BOOKMARKS_FOLDER` is dropped whatever its
 * name, which covers translated browsers.
 */
const ROOT_FOLDER_NAMES: ReadonlySet<string> = new Set([
  "bookmarks bar",
  "bookmarks toolbar",
  "bookmarks menu",
  "favorites bar",
  "favorites",
  "other bookmarks",
  "other favorites",
  "mobile bookmarks",
  "bookmarksbar",
  "bookmarksmenu",
]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Deepest run of named folders the parser keeps names for; a folder below it adds no name. */
const MAX_FOLDER_DEPTH = MAX_TAGS_PER_CLIPPING;

const rootKey = (name: string): string => name.toLowerCase();

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,6});/g,
    (whole, body: string) => {
      if (body.startsWith("#")) {
        const code =
          body[1] === "x" || body[1] === "X"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
        return valid ? String.fromCodePoint(code) : whole;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    },
  );
}

/** Decoded text of a link or folder, without inner tags, with runs of whitespace made one space. */
const cleanText = (raw: string): string =>
  decodeEntities(raw.replace(/<[^<>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

interface Token {
  name: string;
  closing: boolean;
  /** Offset where the tag begins. */
  start: number;
  /** Offset just after the tag's `>`. */
  end: number;
  /** Lower-cased attribute names to decoded values; only read for `a` and `h3`. */
  attrs: Map<string, string> | null;
}

const WATCHED = new Set(["a", "h3", "dl", "dt", "dd"]);
const HAS_ATTRS = new Set(["a", "h3"]);

const isSpace = (char: string): boolean =>
  char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
const isNameChar = (code: number): boolean =>
  (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || (code >= 48 && code <= 57);

/**
 * The tags the parser follows, in order. Hand-written so that odd markup (a quote that never
 * closes, a `<` that starts nothing) costs one pass over the input and never throws.
 */
function scanTags(html: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  while (pos < html.length) {
    const lt = html.indexOf("<", pos);
    if (lt === -1) break;
    if (html.startsWith("<!--", lt)) {
      const close = html.indexOf("-->", lt + 4);
      if (close === -1) break;
      pos = close + 3;
      continue;
    }
    let cursor = lt + 1;
    const closing = html[cursor] === "/";
    if (closing) cursor++;
    const nameStart = cursor;
    while (cursor < html.length && isNameChar(html.charCodeAt(cursor))) cursor++;
    if (cursor === nameStart) {
      pos = lt + 1;
      continue;
    }
    const name = html.slice(nameStart, cursor).toLowerCase();
    const wanted = WATCHED.has(name);
    const attrs = wanted && !closing && HAS_ATTRS.has(name) ? new Map<string, string>() : null;

    // Walk the attributes to the closing `>`, honouring quotes.
    let done = false;
    while (cursor < html.length && !done) {
      const char = html[cursor] as string;
      if (char === ">") {
        cursor++;
        done = true;
      } else if (isSpace(char) || char === "/") {
        cursor++;
      } else {
        const attrStart = cursor;
        while (
          cursor < html.length &&
          !isSpace(html[cursor] as string) &&
          !"=>/".includes(html[cursor] as string)
        ) {
          cursor++;
        }
        const attrName = html.slice(attrStart, cursor).toLowerCase();
        if (cursor === attrStart) {
          // A stray `=`: step over it so the loop always moves.
          cursor++;
          continue;
        }
        while (cursor < html.length && isSpace(html[cursor] as string)) cursor++;
        let value = "";
        if (html[cursor] === "=") {
          cursor++;
          while (cursor < html.length && isSpace(html[cursor] as string)) cursor++;
          const quote = html[cursor];
          if (quote === '"' || quote === "'") {
            const close = html.indexOf(quote, cursor + 1);
            if (close === -1) {
              // An unclosed quote: read to the next `>` and let the tag end there.
              const gt = html.indexOf(">", cursor + 1);
              const stop = gt === -1 ? html.length : gt;
              value = html.slice(cursor + 1, stop);
              cursor = stop;
            } else {
              value = html.slice(cursor + 1, close);
              cursor = close + 1;
            }
          } else {
            const valueStart = cursor;
            while (cursor < html.length && !isSpace(html[cursor] as string) && html[cursor] !== ">")
              cursor++;
            value = html.slice(valueStart, cursor);
          }
        }
        if (attrs && !attrs.has(attrName)) attrs.set(attrName, decodeEntities(value));
      }
    }
    if (!done) break; // No `>` left: nothing after this can be a tag.
    pos = cursor;
    if (wanted) tokens.push({ name, closing, start: lt, end: cursor, attrs });
  }
  return tokens;
}

/** ADD_DATE as a date. Seconds are the norm; milliseconds and microseconds are told by size. */
function parseAddDate(raw: string | undefined): Date | null {
  const text = raw?.trim();
  if (!text || !/^\d{1,18}$/.test(text)) return null;
  const value = Number(text);
  if (value <= 0) return null;
  let seconds: number;
  if (value < 1e11) seconds = value;
  else if (value < 1e14) seconds = Math.floor(value / 1e3);
  else if (value < 1e17) seconds = Math.floor(value / 1e6);
  else return null;
  return fromUnixTime(seconds);
}

const isTrue = (value: string | undefined): boolean => value?.trim().toLowerCase() === "true";

function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Reads a Netscape bookmarks file, the "bookmarks.html" that Chrome, Firefox, Safari, Raindrop.io
 * and most other bookmark tools export. Works on any string without a DOM and never throws.
 *
 * Folders (`<H3>` followed by `<DL>`) become `folders`; see `ParsedBookmark`. Only http and https
 * links are returned; the rest are in `skipped`. Duplicates are kept: the import service decides.
 * The result is an error when the text has no bookmark structure (`not_bookmarks`) or holds more
 * than `MAX_BOOKMARKS_PER_IMPORT` importable links (`too_many`).
 */
export function parseBookmarksHtml(html: string): BookmarksParseResult {
  const text = html.charCodeAt(0) === 0xfeff ? html.slice(1) : html;
  const tokens = scanTags(text);

  const hasDoctype = /^\s*<!DOCTYPE\s+NETSCAPE-Bookmark-file/i.test(text.slice(0, 512));
  const hasStructure =
    hasDoctype || (tokens.some((t) => t.name === "dl") && tokens.some((t) => t.name === "dt"));
  if (!hasStructure) return { ok: false, error: "not_bookmarks" };

  const bookmarks: ParsedBookmark[] = [];
  const skipped: SkippedBookmark[] = [];
  // One entry per open `<DL>`: whether it pushed a folder name onto `names`. False for the file's
  // top level, for root folders, and for folders below `MAX_FOLDER_DEPTH`. Both are updated
  // incrementally, so a link or a folder never walks the stack.
  const stack: boolean[] = [];
  const names: string[] = [];
  let pendingFolder: string | null | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as Token;
    if (token.name === "dl") {
      if (token.closing) {
        if (stack.pop()) names.pop();
      } else {
        const name = names.length < MAX_FOLDER_DEPTH ? pendingFolder : null;
        if (typeof name === "string") names.push(name);
        stack.push(typeof name === "string");
        pendingFolder = undefined;
      }
    } else if (token.name === "h3" && !token.closing) {
      const textEnd = tokens[i + 1]?.start ?? text.length;
      const name = cleanText(text.slice(token.end, textEnd));
      const topLevel = names.length === 0;
      const marked =
        isTrue(token.attrs?.get("personal_toolbar_folder")) ||
        isTrue(token.attrs?.get("unfiled_bookmarks_folder"));
      const root = marked || (topLevel && ROOT_FOLDER_NAMES.has(rootKey(name)));
      pendingFolder = name && !root ? name : null;
    } else if (token.name === "a" && !token.closing) {
      pendingFolder = undefined;
      const url = (token.attrs?.get("href") ?? "").trim();
      if (!url) continue;
      const textEnd = tokens[i + 1]?.start ?? text.length;
      const title = cleanText(text.slice(token.end, textEnd));
      if (!isWebUrl(url)) {
        skipped.push({ url, title, reason: "not_web" });
        continue;
      }
      if (bookmarks.length >= MAX_BOOKMARKS_PER_IMPORT) return { ok: false, error: "too_many" };
      const tags = (token.attrs?.get("tags") ?? "").split(",");
      bookmarks.push({
        url,
        title,
        addedAt: parseAddDate(token.attrs?.get("add_date")),
        folders: [...names, ...normalizeTagNames(tags)].slice(0, MAX_TAGS_PER_CLIPPING),
      });
    }
  }
  return { ok: true, bookmarks, skipped };
}

const escapeHtml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * Writes the clippings as a Netscape bookmarks file any browser or bookmark service imports: one
 * flat list of links with `ADD_DATE` (unix seconds) and `TAGS`. A tag's commas become spaces,
 * since a comma separates tags in the file. A link with no title is titled with its address.
 * `parseBookmarksHtml` reads the result back to the same url, title, second-precision date and tags.
 */
export function serializeBookmarksHtml(items: readonly BookmarkToExport[]): string {
  const lines = items.map((item) => {
    const attrs = [`HREF="${escapeHtml(item.url)}"`];
    const created = parseISO(item.createdAt);
    if (!Number.isNaN(created.getTime())) attrs.push(`ADD_DATE="${getUnixTime(created)}"`);
    const tags = normalizeTagNames(
      item.tags.map((tag) => normalizeTagName(tag.replaceAll(",", " "))),
    );
    if (tags.length > 0) attrs.push(`TAGS="${escapeHtml(tags.join(","))}"`);
    return `    <DT><A ${attrs.join(" ")}>${escapeHtml(item.title.trim() || item.url)}</A>`;
  });
  return [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<!-- This is an automatically generated file.",
    "     It will be read and overwritten.",
    "     DO NOT EDIT! -->",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
    ...lines,
    "</DL><p>",
    "",
  ].join("\n");
}
