import { browser } from "wxt/browser";

import {
  isSaveablePage,
  MAX_NOTE_LENGTH,
  parseWebUrl,
  type ExtensionPage,
} from "@clippings/shared";

import { saveClipping, saveNote } from "./api.ts";
import { isSignedIn } from "./auth.ts";
import { isRetryable, type SaveResult } from "./messages.ts";
import { readPage } from "./page.ts";
import { enqueue, pauseRetrying, sendQueued, type PendingSave, type SendOutcome } from "./queue.ts";
import { quoteSelection } from "./quote.ts";
import { flashSaved, resetTab, showError, showQueued, showSaved } from "./toolbar.ts";

const CANT_SAVE = "Clippings can't save this page.";

/**
 * The selection as a quote at the end of the note, in a block of its own, quoted as the popup
 * quotes it. A quote block the note holds already isn't added again, so saving the same selection
 * twice (or a queued save sent twice) leaves one copy. A quote too long for the note is cut to
 * fit, at a line where it can.
 */
export function noteWithQuote(note: string, selection: string): string {
  const quoted = quoteSelection(selection);
  if (!quoted) return note;
  const separator = note.trim() ? "\n\n" : "";
  const base = note.trim() ? note.trimEnd() : "";
  const room = MAX_NOTE_LENGTH - base.length - separator.length;
  let quote = room > 0 ? quoted.slice(0, room) : "";
  if (quote.length < quoted.length && quote.lastIndexOf("\n") > 0) {
    quote = quote.slice(0, quote.lastIndexOf("\n"));
  }
  if (!quote.replace(/^>\s*/, "")) return note;
  // A whole block: after a blank line (or at the start), and before one (or at the end).
  if (`\n\n${note.trim()}\n\n`.includes(`\n\n${quote}\n\n`)) return note;
  return `${base}${separator}${quote}`;
}

/**
 * How a save went. `note_failed`: the page saved, but the selection couldn't be added to its
 * note (or the clipping was deleted in between).
 */
export type QuickSaveResult = SaveResult | { ok: false; reason: "note_failed" };

/** Saves the page with its text, then adds the selection to its note when there is one. */
export async function sendSave(save: PendingSave): Promise<QuickSaveResult> {
  const result = await saveClipping(save.url, save.page);
  if (!result.ok || !save.quote) return result;

  const { clipping } = result.saved;
  const note = noteWithQuote(clipping.note, save.quote);
  if (note === clipping.note) return result;
  const outcome = await saveNote(clipping.id, note);
  if (outcome === "saved") {
    return { ok: true, saved: { ...result.saved, clipping: { ...clipping, note } } };
  }
  return {
    ok: false,
    reason: outcome === "failed" && !navigator.onLine ? "offline" : "note_failed",
  };
}

/** Whether a save from a tab is of the page the tab shows, so its icon can say it's saved. */
const isPageOf = (url: string, pageUrl: string | undefined) =>
  pageUrl !== undefined && parseWebUrl(url)?.normalized === parseWebUrl(pageUrl)?.normalized;

/**
 * Whether the tab still shows the page at `url`. A save or a lookup can end after the tab has
 * loaded another page; the icon must not say that one is saved. When the address can't be read
 * (no `activeTab` any more, no `tabs`), the answer is no.
 */
async function stillShows(tabId: number, url: string): Promise<boolean> {
  try {
    return isPageOf(url, (await browser.tabs.get(tabId)).url);
  } catch {
    return false;
  }
}

/**
 * A save from the context menu or the silent-save shortcut, with no popup: the toolbar button
 * says how it went. A save made offline waits in the queue, and the button says so.
 */
export async function quickSave(
  save: PendingSave,
  { tabId, pageUrl }: { tabId?: number; pageUrl?: string },
): Promise<void> {
  const feedback = async (show: (tabId: number) => Promise<void>) => {
    if (tabId === undefined || tabId < 0) return;
    try {
      await show(tabId);
    } catch (error) {
      // The tab has closed since.
      console.error("Couldn't update the toolbar button", error);
    }
  };

  if (!isSaveablePage(save.url)) {
    await feedback((id) => showError(id, CANT_SAVE));
    return;
  }
  // Only a save of the page the tab shows carries its text: a link points elsewhere. `readPage`
  // checks the tab still shows the page. The menu click and the shortcut grant `activeTab`.
  const page =
    tabId !== undefined && tabId >= 0 && isPageOf(save.url, pageUrl)
      ? await readPage(tabId, save.url)
      : undefined;
  const pending = page ? { ...save, page } : save;
  const result = await sendSave(pending);
  if (result.ok) {
    void sendOfflineSaves();
    await feedback(async (id) => {
      if (isPageOf(save.url, pageUrl) && (await stillShows(id, save.url))) await showSaved(id);
      await flashSaved(id);
    });
    return;
  }
  switch (result.reason) {
    case "offline":
    case "unreachable": {
      const reason = result.reason;
      await enqueue({ ...pending, tabId, pageUrl });
      await feedback((id) => showQueued(id, reason));
      return;
    }
    case "signed_out":
    case "not_allowlisted":
      await feedback((id) => showError(id, "Sign in to save: open Clippings from the toolbar."));
      return;
    case "invalid_url":
      await feedback((id) => showError(id, CANT_SAVE));
      return;
    case "note_failed":
      await feedback((id) => showError(id, "Saved, but couldn't add the selection to the note."));
      return;
    case "failed":
      await feedback((id) => showError(id, "Couldn't save to Clippings. Try again."));
      return;
  }
}

/**
 * The popup's save, with the page's text the popup read. When the page is saved, the tab's icon
 * fills; when the browser is offline or Clippings can't be reached, the save waits in the queue
 * like any other.
 */
export async function saveFromPopup(url: string, page?: ExtensionPage): Promise<SaveResult> {
  const result = await saveClipping(url, page);
  // A save that got through says the browser is online: send what waited.
  if (result.ok) void sendOfflineSaves();
  const reason = result.ok ? undefined : result.reason;
  if (result.ok || (reason !== undefined && isRetryable(reason))) {
    // `activeTab`: the toolbar click that opened the popup lets the tab's address be read.
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    const tabId = tab?.id !== undefined && isPageOf(url, tab.url) ? tab.id : undefined;
    if (result.ok && tabId !== undefined) await showSaved(tabId);
    if (reason !== undefined && isRetryable(reason)) {
      await enqueue({ url, page, tabId, pageUrl: url });
      if (tabId !== undefined) await showQueued(tabId, reason);
    }
  }
  return result;
}

/** How a queued save's try went, for the queue. */
export function outcomeOf(result: QuickSaveResult): SendOutcome {
  if (result.ok) return "sent";
  switch (result.reason) {
    case "offline":
    case "unreachable":
    case "signed_out":
    case "not_allowlisted":
      return "later";
    // The page is saved: only the selection is lost, and sending again could bring back a
    // clipping the user has deleted since.
    case "note_failed":
    case "invalid_url":
      return "drop";
    case "failed":
      return "failed";
  }
}

/**
 * Sends the saves made offline. Signed out, nothing can be sent: retrying pauses until the user
 * signs in. A tab still showing the save as waiting, and still on its page, shows it saved.
 */
export async function sendOfflineSaves(): Promise<void> {
  if (!navigator.onLine) return;
  if (!(await isSignedIn())) {
    await pauseRetrying();
    return;
  }
  await sendQueued(async (save) => {
    const result = await sendSave({ url: save.url, quote: save.quote, page: save.page });
    if (result.ok && save.tabId !== undefined) {
      const tabId = save.tabId;
      try {
        if ((await browser.action.getBadgeText({ tabId })) === "…") {
          await resetTab(tabId);
          if (await stillShows(tabId, save.url)) await showSaved(tabId);
          await flashSaved(tabId);
        }
      } catch {
        // The tab has closed.
      }
    }
    return outcomeOf(result);
  });
}
