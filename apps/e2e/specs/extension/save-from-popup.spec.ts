import type { BrowserContext, Page, Worker } from "@playwright/test";

import { sessionCookieName } from "@clippings/db/testing";

import { BASE_URL } from "../../support/env.ts";
import { expect, test } from "../../support/extension.ts";

/**
 * The page the popup saves. It is on the app's own origin because the extension may read a tab's
 * address only for a host it has permission for (the toolbar's `activeTab` grant has no stand-in
 * here), and the app's origin is its one host. Playwright answers the request, so the page needs
 * no route in the app.
 */
const ARTICLE = `${BASE_URL}/e2e-article`;

/** A tab showing `ARTICLE`, in front: the page the user has open when they click the toolbar button. */
async function openArticle(context: BrowserContext) {
  await context.route(ARTICLE, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>An article worth keeping</title><p>Text</p>",
    }),
  );
  const article = await context.newPage();
  await article.goto(ARTICLE);
  await article.bringToFront();
  return article;
}

/**
 * Opens the popup in a window of its own. Headless Chromium has no toolbar to click, so the popup
 * is an extension page, and its `tabs.query({ currentWindow })` would answer with the popup
 * itself. That one query stands in for the toolbar click: it asks for the open article's window
 * instead, which is the window a real popup is shown in.
 */
async function openPopup(
  context: BrowserContext,
  serviceWorker: Worker,
  extensionId: string,
  article: Page,
) {
  const windowId = await serviceWorker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return tab!.windowId;
  }, article.url());
  // The extension's welcome page opens on install and may have taken the front: the article is
  // the tab the popup asks about, so it is the active one when the popup opens.
  await expect
    .poll(async () => {
      await article.bringToFront();
      return serviceWorker.evaluate(
        async (windowId) =>
          (await chrome.tabs.query({ active: true, windowId })).map((tab) => tab.url),
        windowId,
      );
    })
    .toEqual([article.url()]);
  await context.addInitScript((windowId) => {
    // Only the extension's own pages have `chrome.tabs`.
    if (!("tabs" in chrome)) return;
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (info) => query({ ...info, currentWindow: undefined, windowId });
  }, windowId);

  const address = `chrome-extension://${extensionId}/popup.html`;
  await serviceWorker.evaluate(async (url) => {
    await chrome.windows.create({ url, type: "popup" });
  }, address);
  return pageAt(context, (url) => url === address);
}

/**
 * The context's page whose address matches, once it is there. Not the next `page` event: the
 * extension's welcome page opens on install and may be the next one.
 */
async function pageAt(context: BrowserContext, matches: (url: string) => boolean): Promise<Page> {
  await expect.poll(() => context.pages().some((candidate) => matches(candidate.url()))).toBe(true);
  return context.pages().find((candidate) => matches(candidate.url()))!;
}

test.describe("the extension", () => {
  test("signs in through the consent page and saves the open page", async ({
    context,
    serviceWorker,
    extensionId,
    user,
    clippings,
    page,
  }) => {
    const article = await openArticle(context);
    const popup = await openPopup(context, serviceWorker, extensionId, article);

    // Not signed in on this device: the popup offers to. The sign-in window is the real
    // `chrome.identity.launchWebAuthFlow` one, which Playwright sees as a page of the context.
    await popup.getByRole("button", { name: "Sign in" }).click();
    const consent = await pageAt(context, (url) => url.startsWith(`${BASE_URL}/connect?`));
    await expect(consent.getByText(user.email)).toBeVisible();
    await expect(consent.getByText("the Clippings extension")).toBeVisible();
    await consent.getByRole("button", { name: "Allow" }).click();

    // The authorization code goes back to the extension, which trades it for tokens and saves.
    await expect(popup.getByRole("heading", { name: "Saved" })).toBeVisible();

    // Saved for this user, by the extension, in the web app's list.
    await expect
      .poll(async () => (await clippings.listClippings(user.id, {})).items.map((c) => c.source))
      .toEqual(["extension"]);
    await page.goto("/?sources=extension");
    const row = page.getByRole("grid", { name: "Your clippings" }).getByRole("row", {
      name: new RegExp(ARTICLE),
    });
    await expect(row).toBeVisible();
  });

  test.describe("when the user denies the connection", () => {
    /**
     * Clicks Deny on the consent page the popup's sign-in opened, then opens a new popup: the
     * real one has closed by then, and the next one says why signing in didn't finish.
     */
    async function denyAndReopen(
      context: BrowserContext,
      serviceWorker: Worker,
      extensionId: string,
      article: Page,
      { beforeDeny }: { beforeDeny?: () => Promise<void> } = {},
    ) {
      const popup = await openPopup(context, serviceWorker, extensionId, article);
      await popup.getByRole("button", { name: "Sign in" }).click();
      const consent = await pageAt(context, (url) => url.startsWith(`${BASE_URL}/connect?`));
      await expect(consent.getByRole("button", { name: "Deny" })).toBeVisible();
      await beforeDeny?.();
      await consent.getByRole("button", { name: "Deny" }).click();

      // The sign-in window closes with the refusal, so the first popup is done.
      await expect.poll(() => consent.isClosed()).toBe(true);
      await popup.close();
      return openPopup(context, serviceWorker, extensionId, article);
    }

    test("the popup says so, and not that sign-in was cancelled", async ({
      context,
      serviceWorker,
      extensionId,
      user: _user,
    }) => {
      const article = await openArticle(context);

      const popup = await denyAndReopen(context, serviceWorker, extensionId, article);

      await expect(popup.getByRole("alert")).toHaveText("You chose not to connect the extension.");
      await expect(popup.getByRole("button", { name: "Sign in" })).toBeVisible();
    });

    test("the popup says so after the session has ended", async ({
      context,
      serviceWorker,
      extensionId,
      user: _user,
    }) => {
      const article = await openArticle(context);

      // As after "Not you?" and Back: the page is still open, but its session is gone.
      const popup = await denyAndReopen(context, serviceWorker, extensionId, article, {
        beforeDeny: () => context.clearCookies({ name: sessionCookieName({ secure: true }) }),
      });

      await expect(popup.getByRole("alert")).toHaveText("You chose not to connect the extension.");
    });
  });
});
