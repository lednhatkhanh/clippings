import type { Page } from "@playwright/test";

import { expect, test } from "../support/fixtures.ts";

/** The loopback address the page fetcher refuses, so nothing here reaches the internet. */
const PAGE = "http://127.0.0.1:9/article";

async function openNewClipping(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New clipping" }).click();
  const dialog = page.getByRole("dialog", { name: "New clipping" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("saving a clipping", () => {
  test("saves a new address with a tag, and lists it as pending", async ({ page }) => {
    const dialog = await openNewClipping(page);

    await dialog.getByRole("textbox", { name: "Address" }).fill(PAGE);
    await dialog.getByRole("combobox", { name: "Tags (optional)" }).fill("reading");
    await dialog.getByRole("combobox", { name: "Tags (optional)" }).press("Enter");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog).toBeHidden();
    const row = page.getByRole("grid", { name: "Your clippings" }).getByRole("row", {
      name: new RegExp(PAGE),
    });
    await expect(row).toBeVisible();
    await expect(row.getByRole("progressbar", { name: "Reading the page" })).toBeVisible();
    await expect(row.getByRole("link", { name: "reading" })).toBeVisible();
  });

  test("says so when the address is already saved", async ({ page, user, clippings }) => {
    await clippings.saveClipping(user.id, { url: PAGE, note: "Kept for later", source: "web" });
    const dialog = await openNewClipping(page);

    await dialog.getByRole("textbox", { name: "Address" }).fill(PAGE);
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog.getByText(/^Already saved on /)).toBeVisible();
    await expect(dialog.getByText("Kept for later")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Open" })).toBeVisible();
  });

  test("shows a field error for an address that isn't a web address", async ({ page }) => {
    const dialog = await openNewClipping(page);

    await dialog.getByRole("textbox", { name: "Address" }).fill("not a web address");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(dialog.getByText("That doesn't look like a web address.")).toBeVisible();
    // The dialog stays open, for the user to fix it.
    await expect(dialog.getByRole("textbox", { name: "Address" })).toBeVisible();
  });
});
