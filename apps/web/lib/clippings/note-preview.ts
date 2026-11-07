import { isCodeFenceLine, noteTitleLineIndex } from "@clippings/shared";

/** Longest preview of a note under its title in a list row, in characters. */
const PREVIEW_LENGTH = 200;

/**
 * What a list row shows of a note that has no summary yet (or whose summary an edit cleared): the
 * body after its first line, which is the title, with the Markdown marks taken off and the
 * whitespace collapsed. Null when nothing is left.
 */
export function notePreview(body: string): string | null {
  const lines = body.split(/\r?\n/);
  const text = lines
    .slice(noteTitleLineIndex(lines) + 1)
    .filter((line) => !isCodeFenceLine(line))
    .join(" ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(?:^|\s)(?:#{1,6}|>|[-*+]|\d+[.)])(?=\s)/g, " ")
    .replace(/[*_`~|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[\p{L}\p{N}]/u.test(text)) return null;
  return text.length <= PREVIEW_LENGTH ? text : `${text.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…`;
}
