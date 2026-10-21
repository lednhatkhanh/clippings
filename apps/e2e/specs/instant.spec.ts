import { instant } from "@next/playwright";
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../support/fixtures.ts";
import { makeAllRelated } from "../support/seed.ts";
import { serveStaticShell } from "../support/static-shell.ts";

// `instant()` holds back everything that waits for the request (the session, the database), so
// what a test asserts inside it is what a person sees first, before any data arrives: the app's
// static shell. What comes after the lock is released is the data streaming in.
//
// Each route and way of arriving is its own test, so one regression names the route it broke.
// Every test also asserts that its data is absent inside the lock and present after it: if the
// build lacked the testing API (`EXPOSE_TESTING_API=1`), the lock would not engage, the data
// would already be there and the test would fail instead of passing without testing anything.
//
// Two ways of arriving, two ways to test:
// - A navigation from another page clicks the real link. The lock holds back the destination's
//   data, and the router commits what it prefetched.
// - A first load serves the route's prerendered static shell as the document (`serveStaticShell`
//   says why), then lets the client hydrate it under the lock.
//
// What the first load shows is the navigation only: each page's glass header belongs to the page.
// The signed-in layout reads the session inside one Suspense boundary around the whole page
// (`app/(app)/layout.tsx`), so the page's header and its actions arrive with the data on a first
// load, and are in the shell only when navigating from another page.

const URL_ON_LIST = "https://example.com/instant";

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const navLink = (page: Page, name: string) => nav(page).getByRole("link", { name });
const row = (page: Page) =>
  page
    .getByRole("grid", { name: "Your clippings" })
    .getByRole("row", { name: /example\.com\/instant/ });

/** What every app page shows at once: the navigation, with its three places. */
function expectAppShell(page: Page) {
  return test.step(
    "the navigation is on screen",
    async () => {
      await expect(nav(page)).toBeVisible();
      for (const name of ["Clippings", "Tags", "Settings"]) {
        await expect(navLink(page, name)).toBeVisible();
      }
    },
    { box: true },
  );
}

/**
 * Lands on `path` and waits until the page is settled, outside any lock: hydrated, so a click is
 * a client navigation and not a page load, and with its links' own prefetches finished, so the
 * lock doesn't catch them half-way.
 */
function startOn(page: Page, path: string, ready: Locator) {
  return test.step(
    `start on ${path}`,
    async () => {
      await page.goto(path);
      await expect(ready).toBeVisible();
      // React marks the document it hydrated. (As a string: this package has no DOM types.)
      await page.waitForFunction(
        "Object.keys(document).some((key) => key.startsWith('__reactContainer$'))",
      );
      await page.waitForLoadState("networkidle");
    },
    { box: true },
  );
}

test.describe("the list (/)", () => {
  test.beforeEach(async ({ user, clippings }) => {
    await clippings.saveClipping(user.id, { url: URL_ON_LIST, tags: ["reading"], source: "web" });
  });

  test("is instant on a first load", async ({ page, baseURL }) => {
    await instant(
      page,
      async () => {
        const serveLive = await serveStaticShell(page, "/", "index.html");
        await page.goto("/");
        await expectAppShell(page);
        await expect(row(page)).toHaveCount(0);
        await serveLive();
      },
      { baseURL },
    );

    await expect(row(page)).toBeVisible();
  });

  test("is instant on a navigation from Tags", async ({ page }) => {
    await startOn(page, "/tags", page.getByRole("heading", { name: "Tags", level: 1 }));

    await instant(page, async () => {
      await navLink(page, "Clippings").click();
      await page.waitForURL((url) => url.pathname === "/");
      await expectAppShell(page);
      await expect(page.getByRole("heading", { name: "Clippings", level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "New clipping" })).toBeVisible();
      await expect(row(page)).toHaveCount(0);
    });

    await expect(row(page)).toBeVisible();
  });
});

test.describe("a clipping (/c/<id>)", () => {
  test("is instant on a first load", async ({ page, baseURL, user, clippings }) => {
    const { clipping } = await clippings.saveClipping(user.id, {
      url: URL_ON_LIST,
      source: "web",
    });
    const path = `/c/${clipping.id}`;

    await instant(
      page,
      async () => {
        const serveLive = await serveStaticShell(page, path, "c/[id].html");
        await page.goto(path);
        await expectAppShell(page);
        await expect(page.getByRole("textbox", { name: "Note" })).toHaveCount(0);
        await serveLive();
      },
      { baseURL },
    );

    await expect(page.getByRole("heading", { name: URL_ON_LIST, level: 1 })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Note" })).toBeVisible();
  });

  // The way in from another page is a Related link, not a list row. A row isn't a link, so nothing
  // prefetches its page before the click, and the prefetch the router then starts under the lock
  // intermittently never lets the navigation commit (about half the runs here). Asking for the
  // prefetch first makes the lock hand over the whole page instead of the shell.
  test("is instant on a navigation from another clipping", async ({
    page,
    user,
    clippings,
    database,
  }) => {
    const first = await clippings.saveClipping(user.id, {
      url: "https://example.com/a",
      source: "web",
    });
    const second = await clippings.saveClipping(user.id, {
      url: "https://example.com/b",
      source: "web",
    });
    await makeAllRelated(database, user.id);
    const related = page.getByRole("link", { name: /example\.com\/b/ });
    await startOn(page, `/c/${first.clipping.id}`, related);

    await instant(page, async () => {
      await related.click();
      await page.waitForURL((url) => url.pathname === `/c/${second.clipping.id}`);
      await expectAppShell(page);
      await expect(
        page.getByRole("main").getByRole("link", { name: "Clippings", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Note" })).toHaveCount(0);
    });

    await expect(
      page.getByRole("heading", { name: "https://example.com/b", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Note" })).toBeVisible();
  });
});

test.describe("Tags (/tags)", () => {
  const tagList = (page: Page) => page.getByRole("list", { name: "Your tags" });

  test.beforeEach(async ({ user, clippings }) => {
    await clippings.saveClipping(user.id, { url: URL_ON_LIST, tags: ["reading"], source: "web" });
  });

  test("is instant on a first load", async ({ page, baseURL }) => {
    await instant(
      page,
      async () => {
        const serveLive = await serveStaticShell(page, "/tags", "tags.html");
        await page.goto("/tags");
        await expectAppShell(page);
        await expect(tagList(page)).toHaveCount(0);
        await serveLive();
      },
      { baseURL },
    );

    await expect(tagList(page)).toBeVisible();
  });

  test("is instant on a navigation from the list", async ({ page }) => {
    await startOn(page, "/", row(page));

    await instant(page, async () => {
      await navLink(page, "Tags").click();
      await page.waitForURL((url) => url.pathname === "/tags");
      await expectAppShell(page);
      await expect(page.getByRole("heading", { name: "Tags", level: 1 })).toBeVisible();
      await expect(tagList(page)).toHaveCount(0);
    });

    await expect(tagList(page)).toBeVisible();
  });
});

test.describe("Settings (/settings)", () => {
  const tabs = (page: Page) => page.getByRole("tablist", { name: "Settings" });

  test("is instant on a first load", async ({ page, baseURL }) => {
    await instant(
      page,
      async () => {
        const serveLive = await serveStaticShell(page, "/settings", "settings.html");
        await page.goto("/settings");
        await expectAppShell(page);
        await expect(tabs(page)).toHaveCount(0);
        await serveLive();
      },
      { baseURL },
    );

    await expect(tabs(page)).toBeVisible();
  });

  test("is instant on a navigation from the list", async ({ page, user, clippings }) => {
    await clippings.saveClipping(user.id, { url: URL_ON_LIST, source: "web" });
    await startOn(page, "/", row(page));

    await instant(page, async () => {
      await navLink(page, "Settings").click();
      await page.waitForURL((url) => url.pathname === "/settings");
      await expectAppShell(page);
      await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
      await expect(tabs(page)).toHaveCount(0);
    });

    await expect(tabs(page)).toBeVisible();
  });
});

test.describe("sign-in (/sign-in)", () => {
  test.use({ signedIn: false });

  test("is instant on a first load", async ({ page, baseURL }) => {
    const failure = page.getByText("Couldn't sign you in. Try again.");

    await instant(
      page,
      async () => {
        const serveLive = await serveStaticShell(page, "/sign-in", "sign-in.html");
        await page.goto("/sign-in?error=server_error");
        await expect(page.getByRole("heading", { name: "Your clippings, kept." })).toBeVisible();
        await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
        // What the request decides (here, that the sign-in failed) waits for it.
        await expect(failure).toHaveCount(0);
        await serveLive();
      },
      { baseURL },
    );

    await expect(failure).toBeVisible();
  });
});
