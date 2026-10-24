import { browser } from "wxt/browser";

import { isSaveablePage, parseWebUrl } from "@clippings/shared";

import { lookupClipping } from "./api.ts";
import { readLookup, writeLookup } from "./lookup-cache-storage.ts";
import { showsSavedPages } from "./settings.ts";
import { showSaved } from "./toolbar.ts";

/** Whether the tab still shows the page at the normalized address `normalized`. */
async function stillShows(tabId: number, normalized: string): Promise<boolean> {
  try {
    return parseWebUrl((await browser.tabs.get(tabId)).url ?? "")?.normalized === normalized;
  } catch {
    return false;
  }
}

/**
 * When the user turned on "Show when a page is already saved", fills the icon of the tab if the
 * page it has loaded is saved. The answer is kept for ten minutes (`lookup-cache.ts`), so
 * reloading and switching between pages asks the server once, and a save of the page sets it
 * (`showSaved`). With the setting off, nothing is sent. Only the normalized address goes: no
 * fragment, which can hold a token.
 */
export async function lookUpTabCached(tabId: number, url: string | undefined): Promise<void> {
  if (!url || !isSaveablePage(url) || !(await showsSavedPages())) return;
  const normalized = parseWebUrl(url)?.normalized;
  if (!normalized) return;
  let answer = await readLookup(normalized);
  if (!answer) {
    const asked = await lookupClipping(normalized);
    if (asked === "unknown") return;
    answer = asked;
    await writeLookup(normalized, asked === "saved");
  }
  if (answer === "saved" && (await stillShows(tabId, normalized))) await showSaved(tabId);
}
