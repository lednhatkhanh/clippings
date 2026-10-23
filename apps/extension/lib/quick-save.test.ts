import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { MAX_NOTE_LENGTH, type ExtensionSaveResponse } from "@clippings/shared";

import { lookupClipping, saveClipping, saveNote } from "./api.ts";
import { isSignedIn } from "./auth.ts";
import type { SaveResult } from "./messages.ts";
import { clearQueue, ensureRetrying, queuedSaves, RETRY_ALARM } from "./queue.ts";
import {
  lookUpTab,
  noteWithQuote,
  quickSave,
  saveFromPopup,
  sendOfflineSaves,
} from "./quick-save.ts";
import { MENU, menuSave } from "./save-triggers.ts";
import { SHOW_SAVED_KEY } from "./settings.ts";
import { SAVED_BADGE_MS } from "./toolbar.ts";

vi.mock("./api.ts", () => ({
  saveClipping: vi.fn(),
  saveNote: vi.fn(),
  lookupClipping: vi.fn(),
}));
vi.mock("./auth.ts", () => ({ isSignedIn: vi.fn() }));
// The service worker draws the icons on a canvas, which Node lacks.
vi.mock("./icons.ts", () => ({
  COLORS: {
    accent: "#5b7757",
    "on-accent": "#ffffff",
    danger: "#a9371b",
    "on-danger": "#ffffff",
    "accent-soft": "#d1e9c9",
    "on-accent-soft": "#253a24",
  },
  toolbarIcons: () => ({ unsaved: "unsaved-icon", saved: "saved-icon" }),
}));

const TAB = 7;
const PAGE = "https://example.com/essay";

function saved(note = "", status: "created" | "existing" = "created"): SaveResult {
  const response: ExtensionSaveResponse = {
    status,
    clipping: {
      id: "c1",
      url: PAGE,
      title: "Essay",
      note,
      tags: [],
      createdAt: "2026-10-20T10:00:00.000Z",
      link: "http://localhost:3100/c/c1",
    },
  };
  return { ok: true, saved: response };
}

const setIcon = vi.fn(async (_details: { tabId?: number; imageData: unknown }) => undefined);
const iconOf = (tabId: number) =>
  setIcon.mock.calls.filter(([details]) => details.tabId === tabId).at(-1)?.[0].imageData;
const badgeOf = (tabId: number) => browser.action.getBadgeText({ tabId });
const titleOf = (tabId: number) => browser.action.getTitle({ tabId });

let online = true;
/** What each tab shows now, as `tabs.get` reads it. */
const tabUrls = new Map<number, string>();

/** The page in the tab, as the script the extension injects reads it. */
const executeScript = vi.fn();
const PAGE_TEXT = { title: "Essay", text: "Words" };
const readsPage = (url = PAGE) =>
  executeScript.mockResolvedValue([{ result: { url, title: "Essay", text: "Words" } }]);

beforeEach(() => {
  tabUrls.clear();
  tabUrls.set(TAB, PAGE);
  Object.assign(fakeBrowser.tabs, {
    get: async (tabId: number) => ({ id: tabId, url: tabUrls.get(tabId) }),
  });
  vi.mocked(isSignedIn).mockReset().mockResolvedValue(true);
  fakeBrowser.reset();
  vi.mocked(saveClipping).mockReset();
  vi.mocked(saveNote).mockReset();
  vi.mocked(lookupClipping).mockReset();
  executeScript.mockReset();
  readsPage();
  Object.assign(fakeBrowser, { scripting: { executeScript } });
  setIcon.mockClear();
  Object.assign(fakeBrowser.action, { setIcon });
  online = true;
  vi.stubGlobal("navigator", {
    get onLine() {
      return online;
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("noteWithQuote", () => {
  it("quotes the selection, line by line, after the note", () => {
    expect(noteWithQuote("", "  First line\nSecond line ")).toBe("> First line\n> Second line");
    expect(noteWithQuote("Mine.\n", "Theirs")).toBe("Mine.\n\n> Theirs");
    // As the popup quotes a selection: blank lines keep the quote one block.
    expect(noteWithQuote("", "One\n\n\nTwo")).toBe("> One\n>\n> Two");
  });

  it("doesn't add a quote the note holds already", () => {
    expect(noteWithQuote("Mine.\n\n> Theirs", "Theirs")).toBe("Mine.\n\n> Theirs");
    expect(noteWithQuote("> Theirs\n\nMine.", "Theirs")).toBe("> Theirs\n\nMine.");
  });

  it("adds a short quote that only appears inside a longer one", () => {
    expect(noteWithQuote("> the whole line", "the")).toBe("> the whole line\n\n> the");
  });

  it("cuts the quote to fit the note", () => {
    const note = "n".repeat(MAX_NOTE_LENGTH - 10);
    const added = noteWithQuote(note, "q".repeat(100));
    expect(added).toHaveLength(MAX_NOTE_LENGTH);
    expect(noteWithQuote("n".repeat(MAX_NOTE_LENGTH), "q")).toBe("n".repeat(MAX_NOTE_LENGTH));
  });
});

describe("the context menu", () => {
  const click = { editable: false, frameId: 0, pageUrl: PAGE };

  it("saves the page, the link, or the page with the selection", () => {
    expect(menuSave({ ...click, menuItemId: MENU.page })).toEqual({ url: PAGE });
    expect(
      menuSave({ ...click, menuItemId: MENU.link, linkUrl: "https://example.org/linked" }),
    ).toEqual({ url: "https://example.org/linked" });
    expect(menuSave({ ...click, menuItemId: MENU.selection, selectionText: "A line" })).toEqual({
      url: PAGE,
      quote: "A line",
    });
    expect(menuSave({ ...click, menuItemId: "something-else" })).toBeUndefined();
  });

  it("adds the selection to the note of the page it saved", async () => {
    vi.mocked(saveClipping).mockResolvedValue(saved("Read later", "existing"));
    vi.mocked(saveNote).mockResolvedValue("saved");

    await quickSave({ url: PAGE, quote: "A line" }, { tabId: TAB, pageUrl: PAGE });

    expect(saveClipping).toHaveBeenCalledWith(PAGE, PAGE_TEXT);
    expect(saveNote).toHaveBeenCalledWith("c1", "Read later\n\n> A line");
    expect(iconOf(TAB)).toBe("saved-icon");
  });

  it("saves a link without marking the page the link was on as saved", async () => {
    vi.mocked(saveClipping).mockResolvedValue(saved());

    await quickSave({ url: "https://example.org/linked" }, { tabId: TAB, pageUrl: PAGE });

    // The tab shows another page than the link: its text isn't read, let alone sent.
    expect(saveClipping).toHaveBeenCalledWith("https://example.org/linked", undefined);
    expect(executeScript).not.toHaveBeenCalled();
    expect(iconOf(TAB)).toBeUndefined();
    expect(await badgeOf(TAB)).toBe("✓");
  });
});

describe("sending the page's text", () => {
  it("sends the text of the page the menu saved", async () => {
    vi.mocked(saveClipping).mockResolvedValue(saved());

    await quickSave({ url: PAGE }, { tabId: TAB, pageUrl: PAGE });

    expect(saveClipping).toHaveBeenCalledExactlyOnceWith(PAGE, PAGE_TEXT);
  });

  it("saves without it when the tab has navigated since the click", async () => {
    vi.mocked(saveClipping).mockResolvedValue(saved());
    readsPage("https://example.com/next");

    await quickSave({ url: PAGE }, { tabId: TAB, pageUrl: PAGE });

    expect(saveClipping).toHaveBeenCalledExactlyOnceWith(PAGE, undefined);
  });

  it("saves without it when the tab can't be scripted", async () => {
    vi.mocked(saveClipping).mockResolvedValue(saved());
    executeScript.mockRejectedValue(new Error("Cannot access a chrome:// URL"));

    await quickSave({ url: PAGE }, { tabId: TAB, pageUrl: PAGE });

    expect(saveClipping).toHaveBeenCalledExactlyOnceWith(PAGE, undefined);
    expect(await badgeOf(TAB)).toBe("✓");
  });
});

describe("saving silently", () => {
  it("fills the icon and shows ✓ for two seconds, with no popup", async () => {
    vi.useFakeTimers();
    vi.mocked(saveClipping).mockResolvedValue(saved());

    await quickSave({ url: PAGE }, { tabId: TAB, pageUrl: PAGE });

    expect(iconOf(TAB)).toBe("saved-icon");
    expect(await badgeOf(TAB)).toBe("✓");
    expect(await browser.action.getBadgeBackgroundColor({ tabId: TAB })).toEqual([
      91, 119, 87, 255,
    ]);
    await vi.advanceTimersByTimeAsync(SAVED_BADGE_MS - 1);
    expect(await badgeOf(TAB)).toBe("✓");
    await vi.advanceTimersByTimeAsync(1);
    expect(await badgeOf(TAB)).toBe("");
    expect(iconOf(TAB)).toBe("saved-icon");
  });

  it("shows ! and says why when the save fails", async () => {
    vi.mocked(saveClipping).mockResolvedValue({ ok: false, reason: "signed_out" });

    await quickSave({ url: PAGE }, { tabId: TAB, pageUrl: PAGE });

    expect(await badgeOf(TAB)).toBe("!");
    expect(await browser.action.getBadgeBackgroundColor({ tabId: TAB })).toEqual([
      169, 55, 27, 255,
    ]);
    expect(await titleOf(TAB)).toMatch(/sign in/i);
  });

  it("doesn't fill the icon when the tab has loaded another page by the time the save ends", async () => {
    vi.mocked(saveClipping).mockImplementation(async () => {
      tabUrls.set(TAB, "https://example.com/next");
      return saved();
    });

    await quickSave({ url: PAGE }, { tabId: TAB, pageUrl: PAGE });

    expect(iconOf(TAB)).toBeUndefined();
  });

  it("says the page saved but the selection didn't, and doesn't queue it", async () => {
    vi.mocked(saveClipping).mockResolvedValue(saved());
    vi.mocked(saveNote).mockResolvedValue("failed");

    await quickSave({ url: PAGE, quote: "A line" }, { tabId: TAB, pageUrl: PAGE });

    expect(await badgeOf(TAB)).toBe("!");
    expect(await titleOf(TAB)).toMatch(/couldn't add the selection/i);
    expect(await queuedSaves()).toEqual([]);
  });

  it("shows ! for a page Clippings can't save, without a network call", async () => {
    await quickSave({ url: "chrome://settings" }, { tabId: TAB, pageUrl: "chrome://settings" });

    expect(saveClipping).not.toHaveBeenCalled();
    expect(await badgeOf(TAB)).toBe("!");
  });
});

describe("saving offline", () => {
  it("sends the save once the browser is back online, once", async () => {
    online = false;
    vi.mocked(saveClipping).mockResolvedValue({ ok: false, reason: "offline" });

    await quickSave({ url: PAGE }, { tabId: TAB, pageUrl: PAGE });
    await quickSave({ url: `${PAGE}?utm_source=feed` }, { tabId: TAB, pageUrl: PAGE });
    await saveFromPopup(PAGE);
    expect(await badgeOf(TAB)).toBe("…");
    expect(await queuedSaves()).toHaveLength(1);

    // Still offline: nothing is tried.
    await sendOfflineSaves();
    expect(saveClipping).toHaveBeenCalledTimes(3);

    online = true;
    vi.mocked(saveClipping).mockResolvedValue(saved());
    await Promise.all([sendOfflineSaves(), sendOfflineSaves()]);
    await sendOfflineSaves();

    expect(saveClipping).toHaveBeenCalledTimes(4);
    expect(await queuedSaves()).toEqual([]);
    expect(await badgeOf(TAB)).toBe("✓");
    expect(iconOf(TAB)).toBe("saved-icon");
  });

  it("keeps the page's text of a save made offline, and sends it with the retry", async () => {
    online = false;
    vi.mocked(saveClipping).mockResolvedValue({ ok: false, reason: "offline" });
    await quickSave({ url: PAGE }, { tabId: TAB, pageUrl: PAGE });
    await saveFromPopup(`${PAGE}?other`, PAGE_TEXT);
    expect(await queuedSaves()).toMatchObject([
      { url: PAGE, page: PAGE_TEXT },
      { url: `${PAGE}?other`, page: PAGE_TEXT },
    ]);

    online = true;
    vi.mocked(saveClipping).mockClear().mockResolvedValue(saved());
    await sendOfflineSaves();

    expect(saveClipping).toHaveBeenNthCalledWith(1, PAGE, PAGE_TEXT);
    expect(saveClipping).toHaveBeenNthCalledWith(2, `${PAGE}?other`, PAGE_TEXT);
    expect(await queuedSaves()).toEqual([]);
  });

  it("still sends a save queued before pages were kept, without one", async () => {
    await browser.storage.local.set({
      offlineSaves: [{ id: "old", url: PAGE, failures: 0, tabId: TAB, pageUrl: PAGE }],
    });
    vi.mocked(saveClipping).mockResolvedValue(saved());

    await sendOfflineSaves();

    expect(saveClipping).toHaveBeenCalledExactlyOnceWith(PAGE, undefined);
    expect(await queuedSaves()).toEqual([]);
  });

  it("keeps a selection made offline, and adds it to the note once", async () => {
    online = false;
    vi.mocked(saveClipping).mockResolvedValue({ ok: false, reason: "offline" });
    await quickSave({ url: PAGE, quote: "A line" }, { tabId: TAB, pageUrl: PAGE });

    online = true;
    vi.mocked(saveClipping).mockResolvedValue(saved());
    vi.mocked(saveNote).mockResolvedValue("saved");
    await sendOfflineSaves();

    expect(saveNote).toHaveBeenCalledExactlyOnceWith("c1", "> A line");
    expect(await queuedSaves()).toEqual([]);
  });
});

describe("the queue and the sign-in", () => {
  async function queueOne() {
    online = false;
    vi.mocked(saveClipping).mockResolvedValue({ ok: false, reason: "offline" });
    await quickSave({ url: PAGE }, { tabId: TAB, pageUrl: PAGE });
    online = true;
  }

  it("pauses retrying while signed out, and starts again after a sign-in", async () => {
    await queueOne();
    vi.mocked(isSignedIn).mockResolvedValue(false);

    await sendOfflineSaves();
    expect(saveClipping).toHaveBeenCalledTimes(1);
    expect(await browser.alarms.get(RETRY_ALARM)).toBeUndefined();
    expect(await queuedSaves()).toHaveLength(1);

    vi.mocked(isSignedIn).mockResolvedValue(true);
    await ensureRetrying();
    expect(await browser.alarms.get(RETRY_ALARM)).toBeDefined();
  });

  it("forgets the waiting saves on sign-out", async () => {
    await queueOne();

    await clearQueue();

    expect(await queuedSaves()).toEqual([]);
    expect(await browser.alarms.get(RETRY_ALARM)).toBeUndefined();
  });

  it("sets the retry alarm again as the service worker starts, without pushing it back", async () => {
    await queueOne();
    const first = await browser.alarms.get(RETRY_ALARM);
    await browser.alarms.clearAll();

    await ensureRetrying();
    const again = await browser.alarms.get(RETRY_ALARM);
    expect(again).toBeDefined();
    await ensureRetrying();
    expect(await browser.alarms.get(RETRY_ALARM)).toEqual(again);
    expect(first).toBeDefined();
  });
});

describe("showing when a page is already saved", () => {
  const permissions = { contains: vi.fn(async () => true) };

  beforeEach(() => {
    Object.assign(fakeBrowser, { permissions });
  });

  it("sends no address while the setting is off", async () => {
    await lookUpTab(TAB, PAGE);
    await browser.storage.local.set({ [SHOW_SAVED_KEY]: false });
    await lookUpTab(TAB, PAGE);

    expect(lookupClipping).not.toHaveBeenCalled();
  });

  it("sends no address when the tabs permission was taken back", async () => {
    await browser.storage.local.set({ [SHOW_SAVED_KEY]: true });
    permissions.contains.mockResolvedValueOnce(false);

    await lookUpTab(TAB, PAGE);

    expect(lookupClipping).not.toHaveBeenCalled();
  });

  it("fills the icon of a tab whose page is saved, once the user turns it on", async () => {
    await browser.storage.local.set({ [SHOW_SAVED_KEY]: true });
    vi.mocked(lookupClipping).mockResolvedValue("saved");

    tabUrls.set(TAB, `${PAGE}#access_token=secret`);
    await lookUpTab(TAB, `${PAGE}#access_token=secret`);
    await lookUpTab(TAB + 1, "chrome://newtab");

    // The normalized address: never the fragment.
    expect(lookupClipping).toHaveBeenCalledExactlyOnceWith(PAGE);
    expect(iconOf(TAB)).toBe("saved-icon");
  });
});
