import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { lookupClipping } from "./api.ts";
import { forgetTokens } from "./auth.ts";
import { lookUpTabCached } from "./saved-lookup.ts";
import { SHOW_SAVED_KEY } from "./settings.ts";
import { showSaved } from "./toolbar.ts";

vi.mock("./api.ts", () => ({ lookupClipping: vi.fn() }));
// The service worker draws the icons on a canvas, which Node lacks.
vi.mock("./icons.ts", () => ({
  COLORS: {},
  toolbarIcons: () => ({ unsaved: "unsaved-icon", saved: "saved-icon" }),
}));

const TAB = 7;
const PAGE = "https://example.com/essay";

const contains = vi.fn(async () => true);
const setIcon = vi.fn(async (_details: { tabId?: number; imageData: unknown }) => undefined);
const iconOf = (tabId: number) =>
  setIcon.mock.calls.filter(([details]) => details.tabId === tabId).at(-1)?.[0].imageData;

/** What each tab shows now, as `tabs.get` reads it. */
const tabUrls = new Map<number, string>();

beforeEach(async () => {
  fakeBrowser.reset();
  tabUrls.clear();
  tabUrls.set(TAB, PAGE);
  Object.assign(fakeBrowser.tabs, {
    get: async (tabId: number) => ({ id: tabId, url: tabUrls.get(tabId) }),
  });
  contains.mockReset().mockResolvedValue(true);
  Object.assign(fakeBrowser, { permissions: { contains } });
  setIcon.mockClear();
  Object.assign(fakeBrowser.action, { setIcon });
  vi.mocked(lookupClipping).mockReset();
  await browser.storage.local.set({ [SHOW_SAVED_KEY]: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("looking up the page of a tab", () => {
  it("asks the server once for a page loaded again and again", async () => {
    vi.mocked(lookupClipping).mockResolvedValue("not_saved");

    await lookUpTabCached(TAB, PAGE);
    await lookUpTabCached(TAB, PAGE);
    await lookUpTabCached(TAB, `${PAGE}#section`);

    expect(lookupClipping).toHaveBeenCalledExactlyOnceWith(PAGE);
  });

  it("fills the icon from a kept answer too", async () => {
    vi.mocked(lookupClipping).mockResolvedValue("saved");

    await lookUpTabCached(TAB, PAGE);
    setIcon.mockClear();
    await lookUpTabCached(TAB, PAGE);

    expect(lookupClipping).toHaveBeenCalledOnce();
    expect(iconOf(TAB)).toBe("saved-icon");
  });

  it("asks again after ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.mocked(lookupClipping).mockResolvedValue("not_saved");

    await lookUpTabCached(TAB, PAGE);
    vi.advanceTimersByTime(9 * 60_000);
    await lookUpTabCached(TAB, PAGE);
    expect(lookupClipping).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(2 * 60_000);
    await lookUpTabCached(TAB, PAGE);
    expect(lookupClipping).toHaveBeenCalledTimes(2);
  });

  it("doesn't keep an answer it couldn't get", async () => {
    vi.mocked(lookupClipping).mockResolvedValue("unknown");

    await lookUpTabCached(TAB, PAGE);
    await lookUpTabCached(TAB, PAGE);

    expect(lookupClipping).toHaveBeenCalledTimes(2);
  });

  it("shows a page saved since it was last looked up as saved", async () => {
    vi.mocked(lookupClipping).mockResolvedValue("not_saved");
    await lookUpTabCached(TAB, PAGE);

    // The user saves the page: the toolbar fills the icon, which sets the kept answer.
    await showSaved(TAB);
    setIcon.mockClear();
    await lookUpTabCached(TAB, PAGE);

    expect(lookupClipping).toHaveBeenCalledOnce();
    expect(iconOf(TAB)).toBe("saved-icon");
  });

  it("keeps an answer per address", async () => {
    vi.mocked(lookupClipping).mockResolvedValue("not_saved");
    tabUrls.set(TAB + 1, "https://example.com/other");

    await lookUpTabCached(TAB, PAGE);
    await lookUpTabCached(TAB + 1, "https://example.com/other");

    expect(lookupClipping).toHaveBeenCalledTimes(2);
  });

  it("doesn't use a kept answer after the user signs out", async () => {
    vi.mocked(lookupClipping).mockResolvedValue("saved");
    await lookUpTabCached(TAB, PAGE);

    await forgetTokens();
    vi.mocked(lookupClipping).mockResolvedValue("not_saved");
    setIcon.mockClear();
    await lookUpTabCached(TAB, PAGE);

    expect(lookupClipping).toHaveBeenCalledTimes(2);
    expect(iconOf(TAB)).toBeUndefined();
  });

  it("sends only the normalized address, and none for a page that can't be saved", async () => {
    vi.mocked(lookupClipping).mockResolvedValue("saved");
    tabUrls.set(TAB, `${PAGE}#access_token=secret`);

    await lookUpTabCached(TAB, `${PAGE}#access_token=secret`);
    await lookUpTabCached(TAB + 1, "chrome://newtab");

    expect(lookupClipping).toHaveBeenCalledExactlyOnceWith(PAGE);
    expect(iconOf(TAB)).toBe("saved-icon");
  });

  it("sends no address when the tabs permission was taken back", async () => {
    contains.mockResolvedValueOnce(false);

    await lookUpTabCached(TAB, PAGE);

    expect(lookupClipping).not.toHaveBeenCalled();
  });

  it("sends no address while the setting is off", async () => {
    await browser.storage.local.set({ [SHOW_SAVED_KEY]: false });

    await lookUpTabCached(TAB, PAGE);

    expect(lookupClipping).not.toHaveBeenCalled();
  });
});
