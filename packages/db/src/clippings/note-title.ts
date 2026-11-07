import { noteLineText, noteTitleLineIndex } from "@clippings/shared";

/** Longest title made from a note's body, in characters: a line of a list row, not a paragraph. */
export const NOTE_TITLE_LENGTH = 80;

/** What a note with nothing to title it by is called. */
export const UNTITLED_NOTE = "Untitled note";

/**
 * The title for a note: its first line with the Markdown around it taken off (heading marks,
 * list and quote markers, emphasis, code ticks, links reduced to their text), cut at a word to
 * `NOTE_TITLE_LENGTH`. A body with no words, such as a rule or an image, is "Untitled note".
 */
export function noteTitle(body: string): string {
  const lines = body.split(/\r?\n/);
  const index = noteTitleLineIndex(lines);
  return index === -1 ? UNTITLED_NOTE : cutAtWord(noteLineText(lines[index]!));
}

function cutAtWord(text: string): string {
  if (text.length <= NOTE_TITLE_LENGTH) return text;
  const cut = text.slice(0, NOTE_TITLE_LENGTH - 1);
  const space = cut.lastIndexOf(" ");
  // A long word is cut where it stands; otherwise the title ends on a whole word.
  return `${(space > NOTE_TITLE_LENGTH / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
