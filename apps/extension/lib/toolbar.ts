import { browser } from "wxt/browser";

import { parseWebUrl } from "@clippings/shared";

import { COLORS, toolbarIcons } from "./icons.ts";
import { readLookup, writeLookup } from "./lookup-cache-storage.ts";

/** How long the ✓ stays on the toolbar button after a save made without the popup. */
export const SAVED_BADGE_MS = 2000;

const SAVED_BADGE = "✓";
const ERROR_BADGE = "!";
const QUEUED_BADGE = "…";

/** The button's tooltip when there is nothing to say about the tab: the popup's own title. */
const DEFAULT_TITLE = "Save to Clippings";

/** Sets the icon every tab starts with, as the service worker starts. */
export async function showDefaultIcon() {
  await browser.action.setIcon({ imageData: toolbarIcons().unsaved });
}

/** Back to how a tab starts, as it loads a new page: whatever was shown was for the old one. */
export async function resetTab(tabId: number) {
  await Promise.all([
    browser.action.setIcon({ tabId, imageData: toolbarIcons().unsaved }),
    browser.action.setBadgeText({ tabId, text: "" }),
    browser.action.setTitle({ tabId, title: DEFAULT_TITLE }),
  ]);
}

/**
 * The filled icon: the page in this tab is saved. The kept answer to "is this page saved?"
 * (`lookup-cache.ts`) becomes saved too, so loading the page again doesn't show the old one.
 */
export async function showSaved(tabId: number) {
  await Promise.all([
    browser.action.setIcon({ tabId, imageData: toolbarIcons().saved }),
    browser.action.setTitle({ tabId, title: "Saved to Clippings" }),
  ]);
  await rememberSaved(tabId);
}

/** Sets the kept answer for the tab's page to saved, unless it says so already. */
async function rememberSaved(tabId: number) {
  try {
    const normalized = parseWebUrl((await browser.tabs.get(tabId)).url ?? "")?.normalized;
    if (normalized && (await readLookup(normalized)) !== "saved") {
      await writeLookup(normalized, true);
    }
  } catch {
    // The tab has closed, or its address can't be read: the answer expires on its own.
  }
}

async function setBadge(tabId: number, text: string, background: string, color: string) {
  await Promise.all([
    browser.action.setBadgeText({ tabId, text }),
    browser.action.setBadgeBackgroundColor({ tabId, color: background }),
    browser.action.setBadgeTextColor({ tabId, color }),
  ]);
}

/** The timer that takes each tab's ✓ off, so a second save restarts its two seconds. */
const savedBadgeTimers = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * The ✓ for two seconds, after a save made without the popup. A timer is enough: the service
 * worker stays up for 30 seconds after the event that saved. A badge set since (an error) stays.
 */
export async function flashSaved(tabId: number) {
  clearTimeout(savedBadgeTimers.get(tabId));
  await setBadge(tabId, SAVED_BADGE, COLORS.accent, COLORS["on-accent"]);
  savedBadgeTimers.set(
    tabId,
    setTimeout(() => {
      savedBadgeTimers.delete(tabId);
      void (async () => {
        try {
          if ((await browser.action.getBadgeText({ tabId })) !== SAVED_BADGE) return;
          await browser.action.setBadgeText({ tabId, text: "" });
        } catch {
          // The tab has closed.
        }
      })();
    }, SAVED_BADGE_MS),
  );
}

/** The !, with what went wrong as the button's tooltip, until the tab loads another page. */
export async function showError(tabId: number, title: string) {
  await Promise.all([
    setBadge(tabId, ERROR_BADGE, COLORS.danger, COLORS["on-danger"]),
    browser.action.setTitle({ tabId, title }),
  ]);
}

/** The save waits for the browser to be back online. */
export async function showQueued(tabId: number) {
  await Promise.all([
    setBadge(tabId, QUEUED_BADGE, COLORS["accent-soft"], COLORS["on-accent-soft"]),
    browser.action.setTitle({
      tabId,
      title: "You're offline. Clippings will save this when you're back online.",
    }),
  ]);
}
