import type { Page } from "@playwright/test";

import { expect, signIn, test } from "../support/fixtures.ts";

const SEARCH = "Search your clippings";

/** Presses `keys` until `done` holds: the first press may land before the page has hydrated. */
async function pressUntil(page: Page, keys: string[], done: () => Promise<void>) {
  await expect(async () => {
    for (const key of keys) await page.keyboard.press(key);
    await done();
  }).toPass({ timeout: 10_000 });
}

test.describe("keyboard shortcuts", () => {
  test.use({ colorScheme: "light" });

  test.beforeEach(async ({ user, clippings }) => {
    // One clipping, so the list and its search field are on screen rather than the empty state.
    await clippings.saveClipping(user.id, { url: "https://example.com/keys", source: "web" });
  });

  test("? opens the shortcuts sheet and Esc closes it", async ({ page }) => {
    await page.goto("/");
    const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });

    await pressUntil(page, ["Shift+Slash"], () => expect(sheet).toBeVisible({ timeout: 1_000 }));
    await expect(
      sheet.getByRole("heading", { name: "Keyboard shortcuts", level: 2 }),
    ).toBeVisible();
    await expect(sheet.getByText("Shortcuts are off while you type in a field.")).toBeVisible();
    for (const group of ["Anywhere", "On a clipping", "Menus and dialogs"]) {
      await expect(sheet.getByRole("heading", { name: group })).toBeVisible();
    }
    await expect(sheet.getByText("Jump to anything")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("g then t goes to Tags, and g then c back to Clippings", async ({ page }) => {
    await page.goto("/");

    await pressUntil(page, ["g", "t"], () => expect(page).toHaveURL(/\/tags$/, { timeout: 1_000 }));
    await page.keyboard.press("g");
    await page.keyboard.press("c");
    await expect(page).toHaveURL(/\/$/);
  });

  test("/ focuses the search field, from the list and from another page", async ({ page }) => {
    const search = page.getByRole("searchbox", { name: SEARCH });
    await page.goto("/");
    await pressUntil(page, ["Slash"], () => expect(search).toBeFocused({ timeout: 1_000 }));

    await page.goto("/tags");
    await pressUntil(page, ["Slash"], () => expect(search).toBeFocused({ timeout: 1_000 }));
    await expect(page).toHaveURL(/\/$/);
  });

  test("turning single-key shortcuts off in Settings stops them, on this device", async ({
    page,
  }) => {
    await page.goto("/settings");
    const setting = page.getByRole("radiogroup", { name: "Single-key shortcuts" });
    await setting.getByRole("radio", { name: "Off" }).click();
    await expect(setting.getByRole("radio", { name: "Off" })).toBeChecked();

    await page.goto("/");
    await expect(page.getByRole("searchbox", { name: SEARCH })).toBeVisible();
    await page.keyboard.press("g");
    await page.keyboard.press("t");
    await page.keyboard.press("n");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("dialog", { name: "New clipping" })).toBeHidden();

    await page.goto("/settings");
    await setting.getByRole("radio", { name: "On" }).click();
    await page.goto("/");
    await pressUntil(page, ["g", "t"], () => expect(page).toHaveURL(/\/tags$/, { timeout: 1_000 }));
  });

  test("shortcuts stay off while typing in a field", async ({ page }) => {
    await page.goto("/");
    const search = page.getByRole("searchbox", { name: SEARCH });
    await pressUntil(page, ["Slash"], () => expect(search).toBeFocused({ timeout: 1_000 }));

    await page.keyboard.type("gt?n");

    await expect(search).toHaveValue("gt?n");
    await expect(page).not.toHaveURL(/\/tags/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Esc on a clipping goes back to the list, unless a field has focus", async ({
    page,
    user,
    clippings,
  }) => {
    const { clipping } = await clippings.saveClipping(user.id, {
      url: "https://example.com/esc",
      source: "web",
    });
    await page.goto(`/c/${clipping.id}`);
    const note = page.getByRole("textbox", { name: "Note" });
    await note.focus();

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`/c/${clipping.id}$`));

    await note.blur();
    await pressUntil(page, ["Escape"], () => expect(page).toHaveURL(/\/$/, { timeout: 1_000 }));
  });

  test("Shift+D switches light and dark, and the choice is saved", async ({
    page,
    browser,
    user,
  }) => {
    await page.goto("/");
    const root = page.locator("html");

    // Following a light device, so the opposite is dark.
    await pressUntil(page, ["Shift+D"], () =>
      expect(root).toHaveAttribute("data-theme", "dark", { timeout: 1_000 }),
    );

    // Another device: no local copy, so what it shows came from the server.
    const other = await browser.newContext({ colorScheme: "light" });
    try {
      await signIn(other, user);
      const otherPage = await other.newPage();
      await expect(async () => {
        await otherPage.goto("/");
        await expect(otherPage.locator("html")).toHaveAttribute("data-theme", "dark", {
          timeout: 1_000,
        });
      }).toPass({ timeout: 10_000 });
    } finally {
      await other.close();
    }
  });
});
