import { browser } from "wxt/browser";

import {
  MAX_PAGE_TEXT,
  MAX_TITLE_LENGTH,
  parseWebUrl,
  type ExtensionPage,
} from "@clippings/shared";

/**
 * How much of the page's text is read in the tab: past `MAX_PAGE_TEXT` because collapsing blank
 * lines shrinks it, and short of a whole long page crossing the messaging boundary.
 */
const READ_LIMIT = MAX_PAGE_TEXT * 2;

/**
 * How long a save waits for the tab to hand back its text. Reading is meant to be quick, but a
 * busy or frozen page (or one still loading) can hold the script back, and the save, which the
 * user is waiting on, must not wait with it: past this, the page is saved without its text.
 */
export const READ_TIMEOUT_MS = 1000;

/** What the tab hands back: the address it shows, its title and the text it renders. */
export interface RawPage {
  url: string;
  title: string;
  text: string;
}

/** Cuts to `max` characters without leaving half of a surrogate pair at the end. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = /[\ud800-\udbff]/.test(text[max - 1] ?? "") ? max - 1 : max;
  return text.slice(0, end);
}

/**
 * The page as the server takes it: the text with line breaks as `\n`, each line trimmed and runs
 * of blank lines made one, cut to `MAX_PAGE_TEXT`; the title trimmed, or null when empty.
 * Undefined when the tab no longer shows `url` (it navigated while the save was under way, and
 * another page's text must not be saved as this one's) or when there is no text.
 */
export function pageFrom(raw: RawPage, url: string): ExtensionPage | undefined {
  const shown = parseWebUrl(raw.url)?.normalized;
  if (!shown || shown !== parseWebUrl(url)?.normalized) return undefined;

  const lines: string[] = [];
  // Postgres rejects NUL in text, and a page can hold one.
  const clean = (value: string) => value.replaceAll("\u0000", "");
  for (const line of clean(raw.text).replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed && (lines.length === 0 || lines.at(-1) === "")) continue;
    lines.push(trimmed);
  }
  const text = cut(lines.join("\n"), MAX_PAGE_TEXT).trimEnd();
  if (!text) return undefined;

  const title = cut(clean(raw.title).trim(), MAX_TITLE_LENGTH).trimEnd();
  return { title: title || null, text };
}

/** The text read in the tab, or undefined when it can't be. */
async function readFrame(tabId: number, url: string): Promise<ExtensionPage | undefined> {
  try {
    const [frame] = await browser.scripting.executeScript({
      target: { tabId },
      // Run now rather than after the page has loaded: the user is waiting on the save.
      injectImmediately: true,
      // Serialized into the tab: it can't see this module, so the limit comes in as an argument.
      func: (limit: number) => {
        // The longest article, so an index page of teasers doesn't stand for one teaser.
        let root: HTMLElement | null = null;
        let longest = 0;
        for (const article of document.querySelectorAll("article")) {
          const length = article.innerText.length;
          if (length > longest) {
            root = article;
            longest = length;
          }
        }
        root ??= document.querySelector("main") ?? document.body;
        return {
          url: location.href,
          title: document.title,
          text: (root?.innerText ?? "").slice(0, limit),
        };
      },
      args: [READ_LIMIT],
    });
    const raw: unknown = frame?.result;
    if (!raw || typeof raw !== "object") return undefined;
    const { url: shown, title, text } = raw as Record<string, unknown>;
    if (typeof shown !== "string" || typeof title !== "string" || typeof text !== "string") {
      return undefined;
    }
    return pageFrom({ url: shown, title, text }, url);
  } catch {
    return undefined;
  }
}

/**
 * The page in the tab, for the server to read instead of fetching it: a site that turns servers
 * away (a bot wall) has already let the user's browser in. Read with `scripting` under the
 * `activeTab` grant the toolbar click, menu click or shortcut gave, from the top frame only.
 * Undefined when the tab doesn't show `url`, has no text, can't be scripted (the PDF viewer,
 * another extension's page, a page that has navigated since) or doesn't answer within
 * `READ_TIMEOUT_MS`: the save then goes without it.
 */
export async function readPage(tabId: number, url: string): Promise<ExtensionPage | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, READ_TIMEOUT_MS, undefined);
  });
  try {
    return await Promise.race([readFrame(tabId, url), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
