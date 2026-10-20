import { browser, type Browser } from "wxt/browser";

/** "Show when a page is already saved": off until the user turns it on in the options page. */
export const SHOW_SAVED_KEY = "showSavedPages";

/**
 * The lookup reads each tab's address as it loads, which takes the `tabs` permission. It is
 * optional, asked for when the user turns the setting on and given back when they turn it off.
 */
export const LOOKUP_PERMISSIONS: Browser.permissions.Permissions = { permissions: ["tabs"] };

/** Whether the user turned the setting on, and the browser still grants what it needs. */
export async function showsSavedPages(): Promise<boolean> {
  const stored = (await browser.storage.local.get(SHOW_SAVED_KEY)) as {
    [SHOW_SAVED_KEY]?: boolean;
  };
  if (stored[SHOW_SAVED_KEY] !== true) return false;
  return browser.permissions.contains(LOOKUP_PERMISSIONS);
}
