import { askEventSchema, type AskEvent } from "@clippings/shared";

/** A run of the answer: text, or the marker of a source the text before it relies on. */
export type AnswerPart = { type: "text"; text: string } | { type: "cite"; number: number };

/** A clipping the answer cites. Its marker is its position in `sources`, counted from 1. */
export interface AnswerSource {
  id: string;
  title: string;
}

export interface AnswerState {
  status: "idle" | "asking" | "done" | "error";
  parts: AnswerPart[];
  /** Each cited clipping once, in the order they were first cited. */
  sources: AnswerSource[];
  error: string | null;
}

export const IDLE_ANSWER: AnswerState = { status: "idle", parts: [], sources: [], error: null };

/** The state once a question is sent: nothing of the answer yet. */
export const ASKING_ANSWER: AnswerState = { ...IDLE_ANSWER, status: "asking" };

/** Shown when the stream ends before the answer says it is complete. */
export const CUT_OFF_MESSAGE = "The answer was cut off. Try again.";

/** The answer with one more event of the stream applied. */
export function reduceAnswer(state: AnswerState, event: AskEvent): AnswerState {
  switch (event.type) {
    case "text": {
      if (!event.text) return state;
      const last = state.parts.at(-1);
      const parts: AnswerPart[] =
        last?.type === "text"
          ? [...state.parts.slice(0, -1), { type: "text", text: last.text + event.text }]
          : [...state.parts, { type: "text", text: event.text }];
      return { ...state, parts };
    }
    case "citation": {
      const known = state.sources.findIndex((source) => source.id === event.clippingId);
      const sources =
        known === -1
          ? [...state.sources, { id: event.clippingId, title: event.title }]
          : state.sources;
      const number = known === -1 ? sources.length : known + 1;
      const last = state.parts.at(-1);
      // The same source right after itself (two cited sentences in a row) is one marker.
      if (last?.type === "cite" && last.number === number) return { ...state, sources };
      return { ...state, sources, parts: [...state.parts, { type: "cite", number }] };
    }
    case "done":
      return { ...state, status: "done" };
    case "error":
      return { ...state, status: "error", error: event.message };
  }
}

/** The `href` a citation marker has in the answer's Markdown, followed by its number. */
const CITE_HREF = "#cite-";

/** A line that opens or closes a fenced code block. */
const FENCE = /(^|\n)[ \t]*(```|~~~)[^\n]*$/;

/**
 * The answer as Markdown, each citation marker a link to `#cite-<number>` for the renderer to show
 * as a marker (see `citeNumber`). A marker goes before the whitespace that ends the text it
 * follows, so one that closes a list item or paragraph stays on its line. Two places it can't
 * simply follow: a `!` before it would make it an image, so that is escaped, and on a fence line it
 * would become the fence's info string, so it starts a line of its own.
 */
export function answerMarkdown(parts: readonly AnswerPart[]): string {
  let markdown = "";
  for (const part of parts) {
    if (part.type === "text") {
      markdown += part.text;
      continue;
    }
    const marker = `[${part.number}](${CITE_HREF}${part.number})`;
    let body = markdown.trimEnd();
    const after = markdown.slice(body.length);
    if (FENCE.test(body)) {
      markdown = `${body}\n\n${marker}${after}`;
      continue;
    }
    if (body.endsWith("!") && !body.endsWith("\\!")) body = `${body.slice(0, -1)}\\!`;
    markdown = `${body}${marker}${after}`;
  }
  return markdown;
}

/** The source number a link in the answer stands for, or null when it is an ordinary link. */
export function citeNumber(href: string | undefined): number | null {
  const match = href?.match(/^#cite-(\d+)$/);
  return match ? Number(match[1]) : null;
}

/** The answer when the stream closes: one still asking was cut off. */
export function endAnswer(state: AnswerState): AnswerState {
  return state.status === "asking" ? { ...state, status: "error", error: CUT_OFF_MESSAGE } : state;
}

/**
 * The events in the next chunk of a newline-delimited stream, given the unfinished line left by
 * the chunks before it (`rest`). A line that isn't an event is skipped. Returns the new `rest`.
 */
export function readEvents(rest: string, chunk: string): { events: AskEvent[]; rest: string } {
  const lines = (rest + chunk).split("\n");
  const unfinished = lines.pop() ?? "";
  const events: AskEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = askEventSchema.safeParse(JSON.parse(line));
      if (event.success) events.push(event.data);
    } catch {
      // Not JSON: nothing to show.
    }
  }
  return { events, rest: unfinished };
}
