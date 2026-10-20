import { parseWebUrl } from "./url.ts";

/** What a share sheet hands the app's share target: any of the three may be missing or blank. */
export interface SharedData {
  url?: string | null;
  text?: string | null;
  title?: string | null;
}

export type SharedLink =
  | { ok: true; url: string; quote?: string }
  /** The share had no http(s) address in any field. */
  | { ok: false; reason: "no-link" };

const WEB_ADDRESS = /https?:\/\/[^\s<>"]+/gi;
const WEB_SCHEME = /^https?:\/\//i;
/** Sentence punctuation that follows an address in prose rather than belonging to it. */
const TRAILING_PUNCTUATION = "[.,;:!?'\"]*";
const TRAILING = new RegExp(`${TRAILING_PUNCTUATION}$`);
/** What joins a title or a link to the rest of the text: spaces, dashes, colons, bars, bullets. */
const SEPARATORS = /^[\s\-–—:|·•]+|[\s\-–—:|·•]+$/g;

const count = (text: string, char: string) => text.split(char).length - 1;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * An address as written in prose, without the punctuation after it. A closing bracket stays only
 * when the address opens one too, as Wikipedia's addresses do.
 */
function trimAddress(written: string) {
  let address = written.replace(TRAILING, "");
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
  ] as const) {
    while (address.endsWith(close) && count(address, close) > count(address, open)) {
      address = address.slice(0, -1).replace(TRAILING, "");
    }
  }
  return address;
}

/** The first http(s) address written out in `text`, as written and as parsed. */
function findWebUrl(text: string) {
  for (const [match] of text.matchAll(WEB_ADDRESS)) {
    const written = trimAddress(match);
    const parsed = parseWebUrl(written);
    if (parsed) return { written, url: parsed.url };
  }
  return null;
}

/** `text` without the link and the title, tidied: no empty brackets, runs of spaces, space before punctuation or blank lines. */
function quoteFrom(text: string, link: string, title: string) {
  let quote = text.replace(new RegExp(`${escape(link)}${TRAILING_PUNCTUATION}`, "g"), " ");
  // Only where the title stands on its own: "Read" is not taken out of "Ready".
  if (title)
    quote = quote.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escape(title)}(?![\\p{L}\\p{N}])`, "u"),
      " ",
    );
  return quote
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[ \t]+/g, " ")
        .replace(/ ([.,;:!?])/g, "$1")
        .trim(),
    )
    .filter(Boolean)
    .join("\n")
    .replace(SEPARATORS, "");
}

/**
 * The link a share carries and the words that came with it. The `url` field wins when it holds an
 * http(s) address, then the first one in `text`, then in `title`. The quote is `text` without that
 * address and without the title, which apps repeat there; tracking parameters are left to the
 * normalizer.
 */
export function extractSharedUrl({ url, text, title }: SharedData): SharedLink {
  const field = url?.trim() ?? "";
  const parsedField = WEB_SCHEME.test(field) ? parseWebUrl(field) : null;
  const link = parsedField
    ? { written: field, url: parsedField.url }
    : (findWebUrl(text ?? "") ?? findWebUrl(title ?? ""));
  if (!link) return { ok: false, reason: "no-link" };

  const quote = quoteFrom(text ?? "", link.written, title?.trim() ?? "");
  return quote ? { ok: true, url: link.url, quote } : { ok: true, url: link.url };
}
