import { constructNow } from "date-fns";
import { browser } from "wxt/browser";

import { cachedLookup, rememberLookup, type LookupCache } from "./lookup-cache.ts";

const KEY = "lookupCache";

/** The kept answers; empty when the session storage can't be read. It ends with the browser session. */
async function load(): Promise<LookupCache> {
  try {
    const stored = (await browser.storage.session.get(KEY)) as { [KEY]?: unknown };
    const cache = stored[KEY];
    return typeof cache === "object" && cache !== null ? (cache as LookupCache) : {};
  } catch {
    return {};
  }
}

/** The kept answer for a normalized address, if it is still fresh. */
export async function readLookup(url: string): Promise<"saved" | "not_saved" | undefined> {
  return cachedLookup(await load(), url, constructNow(undefined).getTime());
}

/**
 * Keeps the answer for a normalized address. A save sets it to saved at once, so the next load
 * of a page just saved doesn't show the old answer. A failed write only costs a lookup.
 */
export async function writeLookup(url: string, saved: boolean): Promise<void> {
  try {
    const cache = rememberLookup(await load(), url, saved, constructNow(undefined).getTime());
    await browser.storage.session.set({ [KEY]: cache });
  } catch (error) {
    console.error("Couldn't keep the lookup", error);
  }
}
