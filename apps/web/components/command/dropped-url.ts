import { parseWebUrl } from "@clippings/shared";

/** What a drag carries that could be a link: its `text/uri-list` and `text/plain` data. */
export interface DroppedData {
  uriList: string;
  text: string;
}

const WEB_SCHEME = /^https?:\/\//i;

/**
 * The web address a drop carries, or null when it carries none. A link or a tab's URL comes as
 * `text/uri-list` (its first line that isn't a `#` comment); selected text counts only when the
 * whole of it is one http(s) address, so dropping a word never turns it into `https://word`.
 */
export function droppedUrl({ uriList, text }: DroppedData): string | null {
  const listed = uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  const candidate = (listed ?? text).trim();
  if (!WEB_SCHEME.test(candidate) || /\s/.test(candidate)) return null;
  return parseWebUrl(candidate)?.url ?? null;
}
