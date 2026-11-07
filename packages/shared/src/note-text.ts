const CODE_FENCE_LINE = /^\s*(?:```+|~~~+)\s*\S*\s*$/;

/** The line opens or closes a fenced code block (the fence and its language, nothing else). */
export function isCodeFenceLine(line: string): boolean {
  return CODE_FENCE_LINE.test(line);
}

/**
 * One line of a note's body with the Markdown around it taken off (a code fence, heading marks,
 * list and quote markers, emphasis, code ticks, links reduced to their text).
 */
export function noteLineText(line: string): string {
  return line
    .replace(CODE_FENCE_LINE, "")
    .replace(/^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The index of the line that titles a note, the first with a word in it; -1 when none has. */
export function noteTitleLineIndex(lines: readonly string[]): number {
  return lines.findIndex((line) => /[\p{L}\p{N}]/u.test(noteLineText(line)));
}
