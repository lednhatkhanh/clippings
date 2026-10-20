import { browser, type Browser } from "wxt/browser";

import { ensureRetrying, RETRY_ALARM } from "./queue.ts";
import { lookUpTab, quickSave, sendOfflineSaves } from "./quick-save.ts";
import { SHOW_SAVED_KEY } from "./settings.ts";
import { resetTab, showDefaultIcon } from "./toolbar.ts";

/** The context-menu entries, by id. */
export const MENU = {
  page: "save-page",
  link: "save-link",
  selection: "save-selection",
} as const;

/** The shortcut that saves the page without opening the popup (`commands` in the manifest). */
export const SAVE_SILENTLY_COMMAND = "save-silently";

/**
 * The menu persists across browser restarts, so it is made on install and update only. Each
 * entry shows where it applies: a page with nothing under the pointer, a link, a selection.
 */
async function createMenu() {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: MENU.page,
    title: "Save page to Clippings",
    contexts: ["page"],
  });
  browser.contextMenus.create({
    id: MENU.link,
    title: "Save link to Clippings",
    contexts: ["link"],
  });
  browser.contextMenus.create({
    id: MENU.selection,
    title: "Save selection as note",
    contexts: ["selection"],
  });
}

/** What a context-menu entry saves: the page, the link, or the page with the selection as note. */
export function menuSave(info: Browser.contextMenus.OnClickData) {
  switch (info.menuItemId) {
    case MENU.page:
      return { url: info.pageUrl ?? "" };
    case MENU.link:
      return { url: info.linkUrl ?? "" };
    case MENU.selection:
      return { url: info.pageUrl ?? "", quote: info.selectionText ?? "" };
    default:
      return undefined;
  }
}

/** Looks up the page in each window's current tab, once the user turns the setting on. */
async function lookUpCurrentTabs() {
  for (const tab of await browser.tabs.query({ active: true })) {
    if (tab.id !== undefined && !tab.incognito) await lookUpTab(tab.id, tab.url);
  }
}

/**
 * Saving without the popup: the context menu, the silent-save shortcut, the toolbar button's
 * per-tab state, and the saves made offline, sent when the browser is back online. Listeners
 * are added as the service worker starts, so the events that wake it reach them.
 */
export function registerQuickSave() {
  void showDefaultIcon().catch((error: unknown) => console.error("Couldn't draw the icon", error));

  // Chrome drops alarms when the extension updates, and may on a restart: set it again.
  void ensureRetrying();

  browser.runtime.onInstalled.addListener(() => {
    void createMenu().catch((error: unknown) => console.error("Couldn't make the menu", error));
    void sendOfflineSaves();
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    const save = menuSave(info);
    if (save) void quickSave(save, { tabId: tab?.id, pageUrl: info.pageUrl });
  });

  // The open-and-save shortcut is `_execute_action`: it opens the popup, which saves.
  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== SAVE_SILENTLY_COMMAND || !tab) return;
    // The shortcut grants `activeTab`, so the tab's address is readable.
    void quickSave({ url: tab.url ?? "" }, { tabId: tab.id, pageUrl: tab.url });
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "loading") void resetTab(tabId).catch(() => undefined);
    // Only with "Show when a page is already saved" on, which grants `tabs` and so `tab.url`.
    // Private windows are never looked up.
    if (changeInfo.status === "complete" && !tab.incognito) void lookUpTab(tabId, tab.url);
  });

  browser.storage.local.onChanged.addListener((changes) => {
    if (changes[SHOW_SAVED_KEY]?.newValue === true) void lookUpCurrentTabs();
  });

  // Back online: found by the retry alarm, or by the next save that gets through.
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RETRY_ALARM) void sendOfflineSaves();
  });
  browser.runtime.onStartup.addListener(() => void sendOfflineSaves());
}
