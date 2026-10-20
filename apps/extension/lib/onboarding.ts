import { browser, type Browser } from "wxt/browser";

/** The page that shows a new user how to pin the extension, its shortcut and how to sign in. */
export const ONBOARDING_PAGE = "/onboarding.html";

/** Opens the onboarding page once, when the extension is installed: not on updates. */
export async function openOnboarding({ reason }: Browser.runtime.InstalledDetails): Promise<void> {
  if (reason !== "install") return;
  await browser.tabs.create({ url: browser.runtime.getURL(ONBOARDING_PAGE) });
}
