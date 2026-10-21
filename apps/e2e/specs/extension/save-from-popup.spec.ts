import type { BrowserContext, Page } from "@playwright/test";

import { sessionCookieName } from "@clippings/db/testing";

import { BASE_URL } from "../../support/env.ts";
import { expect, test as base } from "../../support/extension.ts";

/**
 * The page the popup saves. It is on the app's own origin because the extension may read a tab's
 * address only for a host it has permission for (the toolbar's `activeTab` grant has no stand-in
 * here), and the app's origin is its one host. Playwright answers the request, so the page needs
 * no route in the app.
 */
const ARTICLE = `${BASE_URL}/e2e-article`;

/**
 * The context's page whose address matches, once it is there. Not the next `page` event: the
 * extension's welcome page opens on install and may be the next one.
 */
function pageAt(
  context: BrowserContext,
  what: string,
  matches: (url: string) => boolean,
): Promise<Page> {
  return base.step(
    `wait for ${what}`,
    async () => {
      await expect
        .poll(() => context.pages().some((candidate) => matches(candidate.url())))
        .toBe(true);
      return context.pages().find((candidate) => matches(candidate.url()))!;
    },
    { box: true },
  );
}

const test = base.extend<{
  /** A tab showing `ARTICLE`, in front: the page the user has open when they click the toolbar button. */
  article: Page;
  /**
   * Opens the popup in a window of its own. Headless Chromium has no toolbar to click, so the
   * popup is an extension page, and its `tabs.query({ currentWindow })` would answer with the
   * popup itself. That one query stands in for the toolbar click: it asks for the open article's
   * window instead, which is the window a real popup is shown in.
   */
  openPopup: () => Promise<Page>;
}>({
  article: async ({ context }, use) => {
    await context.route(ARTICLE, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>An article worth keeping</title><p>Text</p>",
      }),
    );
    const article = await context.newPage();
    await article.goto(ARTICLE);
    await article.bringToFront();
    await use(article);
  },

  openPopup: async ({ context, serviceWorker, extensionId, article }, use) => {
    await use(() =>
      test.step(
        "open the popup",
        async () => {
          const windowId = await serviceWorker.evaluate(async (url) => {
            const [tab] = await chrome.tabs.query({ url });
            return tab!.windowId;
          }, article.url());
          // The extension's welcome page opens on install and may have taken the front: the
          // article is the tab the popup asks about, so it is the active one when the popup opens.
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
          return pageAt(context, "the popup", (url) => url === address);
        },
        { box: true },
      ),
    );
  },
});

test.describe("the extension", () => {
  test("signs in through the consent page and saves the open page", async ({
    context,
    openPopup,
    user,
    clippings,
    page,
  }) => {
    const popup = await openPopup();

    // Not signed in on this device: the popup offers to. The sign-in window is the real
    // `chrome.identity.launchWebAuthFlow` one, which Playwright sees as a page of the context.
    await test.step("allow the connection on the consent page", async () => {
      await popup.getByRole("button", { name: "Sign in" }).click();
      const consent = await pageAt(context, "the consent page", (url) =>
        url.startsWith(`${BASE_URL}/connect?`),
      );
      await expect(consent.getByText(user.email)).toBeVisible();
      await expect(consent.getByText("the Clippings extension")).toBeVisible();
      await consent.getByRole("button", { name: "Allow" }).click();
    });

    // The authorization code goes back to the extension, which trades it for tokens and saves.
    await expect(popup.getByRole("heading", { name: "Saved" })).toBeVisible();

    await test.step("the web app lists it for this user, saved by the extension", async () => {
      await expect
        .poll(async () => (await clippings.listClippings(user.id, {})).items.map((c) => c.source))
        .toEqual(["extension"]);
      await page.goto("/?sources=extension");
      const row = page.getByRole("grid", { name: "Your clippings" }).getByRole("row", {
        name: new RegExp(ARTICLE),
      });
      await expect(row).toBeVisible();
    });
  });

  test.describe("when the user denies the connection", () => {
    /**
     * Clicks Deny on the consent page the popup's sign-in opened, then opens a new popup: the
     * real one has closed by then, and the next one says why signing in didn't finish.
     */
    function denyAndReopen(
      context: BrowserContext,
      openPopup: () => Promise<Page>,
      { beforeDeny }: { beforeDeny?: () => Promise<void> } = {},
    ) {
      return test.step(
        "deny the connection and reopen the popup",
        async () => {
          const popup = await openPopup();
          await popup.getByRole("button", { name: "Sign in" }).click();
          const consent = await pageAt(context, "the consent page", (url) =>
            url.startsWith(`${BASE_URL}/connect?`),
          );
          await expect(consent.getByRole("button", { name: "Deny" })).toBeVisible();
          await beforeDeny?.();
          await consent.getByRole("button", { name: "Deny" }).click();

          // The sign-in window closes with the refusal, so the first popup is done.
          await expect.poll(() => consent.isClosed()).toBe(true);
          await popup.close();
          return openPopup();
        },
        { box: true },
      );
    }

    test("the popup says so, and not that sign-in was cancelled", async ({
      context,
      openPopup,
      user: _user,
    }) => {
      const popup = await denyAndReopen(context, openPopup);

      await expect(popup.getByRole("alert")).toHaveText("You chose not to connect the extension.");
      await expect(popup.getByRole("button", { name: "Sign in" })).toBeVisible();
    });

    test("the popup says so after the session has ended", async ({
      context,
      openPopup,
      user: _user,
    }) => {
      // As after "Not you?" and Back: the page is still open, but its session is gone.
      const popup = await denyAndReopen(context, openPopup, {
        beforeDeny: () => context.clearCookies({ name: sessionCookieName({ secure: true }) }),
      });

      await expect(popup.getByRole("alert")).toHaveText("You chose not to connect the extension.");
    });
  });
});
