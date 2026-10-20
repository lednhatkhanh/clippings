import { browser } from "wxt/browser";

import { MAX_NOTE_LENGTH } from "@clippings/shared";

/**
 * Text selected on the page as the note's opening quote: each line marked with `> `, blank lines
 * kept as a bare `>` so the quote stays one block, and whitespace around it dropped. Empty when
 * nothing but whitespace was selected. Cut to fit a note, at a line where it can.
 */
export function quoteSelection(selection: string): string {
  const lines = selection
    .replace(/\r\n?/g, "\n")
    .trim()
    .split("\n")
    .map((line) => line.trimEnd());
  if (!lines[0]) return "";

  const quoted: string[] = [];
  for (const line of lines) {
    // Runs of blank lines become one: a quote paragraph break, not a gap.
    if (!line.trim() && quoted.at(-1) === ">") continue;
    quoted.push(line.trim() ? `> ${line}` : ">");
  }

  let quote = quoted.join("\n");
  if (quote.length <= MAX_NOTE_LENGTH) return quote;
  quote = quote.slice(0, MAX_NOTE_LENGTH);
  const lastBreak = quote.lastIndexOf("\n");
  return lastBreak > 0 ? quote.slice(0, lastBreak) : quote;
}

/**
 * What is selected in the tab's page, read with `scripting` under the `activeTab` grant the
 * toolbar click gave. Empty when nothing is, or when the page can't be scripted (another
 * extension's page, the PDF viewer, a page that has navigated since).
 */
export async function readSelection(tabId: number): Promise<string> {
  try {
    const [frame] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => globalThis.getSelection()?.toString() ?? "",
    });
    return typeof frame?.result === "string" ? frame.result : "";
  } catch {
    return "";
  }
}
