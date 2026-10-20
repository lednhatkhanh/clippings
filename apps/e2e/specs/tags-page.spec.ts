import type { Locator, Page } from "@playwright/test";

import type { ClippingsService } from "@clippings/db";

import { expect, test } from "../support/fixtures.ts";

const READING = "https://example.com/reading";
const RECIPE = "https://example.com/recipe";

/** The user's two clippings: one tagged `reading`, one tagged `recipes` and `weekend`. */
async function seed(clippings: ClippingsService, userId: string) {
  await clippings.saveClipping(userId, { url: READING, tags: ["reading"], source: "web" });
  await clippings.saveClipping(userId, {
    url: RECIPE,
    tags: ["recipes", "weekend"],
    source: "web",
  });
}

function tagRow(page: Page, name: string): Locator {
  return page
    .getByRole("list", { name: "Your tags" })
    .getByRole("listitem")
    .filter({
      has: page.getByRole("button", { name: `Actions for ${name}`, exact: true }),
    });
}

async function openActions(page: Page, name: string) {
  await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).click();
}

/** The clipping's row on the list, which shows its tags as chips. */
function listRow(page: Page, url: string): Locator {
  return page.getByRole("grid", { name: "Your clippings" }).getByRole("row", {
    name: new RegExp(url),
  });
}

test.describe("managing tags", () => {
  test("renames a tag, and the list's chips and filter use the new name", async ({
    page,
    user,
    clippings,
  }) => {
    await seed(clippings, user.id);
    await page.goto("/tags");

    await openActions(page, "reading");
    await page.getByRole("menuitem", { name: "Rename…" }).click();
    const dialog = page.getByRole("dialog", { name: "Rename tag" });
    await dialog.getByRole("textbox", { name: "Name" }).fill("to read");
    await dialog.getByRole("button", { name: "Rename" }).click();

    await expect(dialog).toBeHidden();
    await expect(tagRow(page, "to read")).toBeVisible();
    await expect(tagRow(page, "reading")).toHaveCount(0);

    // The list carries the new name on the clipping, and filtering by it finds the clipping.
    await page.goto("/");
    await expect(listRow(page, READING).getByRole("link", { name: "to read" })).toBeVisible();
    await expect(listRow(page, READING).getByRole("link", { name: "reading" })).toHaveCount(0);
    await listRow(page, READING).getByRole("link", { name: "to read" }).click();
    await expect(page).toHaveURL(/\/\?tag=to\+read$/);
    await expect(
      page
        .getByRole("toolbar", { name: "Tags filtered by" })
        .getByRole("button", { name: "to read" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(listRow(page, READING)).toBeVisible();
    await expect(listRow(page, RECIPE)).toHaveCount(0);
  });

  test("recolors a tag, and the list's chip shows the color", async ({ page, user, clippings }) => {
    await seed(clippings, user.id);
    await page.goto("/tags");

    await openActions(page, "reading");
    await page.getByRole("menuitem", { name: "Color" }).click();
    await page.getByRole("menuitemradio", { name: "Red" }).click();

    // The menu closes and the choice is the tag's color the next time it opens.
    await openActions(page, "reading");
    await page.getByRole("menuitem", { name: "Color" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Red" })).toBeChecked();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await page.goto("/");
    // The dot is decoration (hidden from assistive technology), so it is found by its color class.
    const chip = listRow(page, READING).getByRole("link", { name: "reading" });
    await expect(chip.locator(".bg-tag-red-dot")).toBeVisible();
    await expect(
      listRow(page, RECIPE).getByRole("link", { name: "recipes" }).locator(".bg-tag-red-dot"),
    ).toHaveCount(0);
  });

  test("merges a tag into another, and the list's clippings carry the target", async ({
    page,
    user,
    clippings,
  }) => {
    await seed(clippings, user.id);
    await page.goto("/tags");

    await openActions(page, "reading");
    await page.getByRole("menuitem", { name: "Merge into" }).click();
    await page.getByRole("menuitem", { name: "recipes" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Merge into “recipes”?" });
    await dialog.getByRole("button", { name: "Merge" }).click();

    await expect(dialog).toBeHidden();
    await expect(tagRow(page, "reading")).toHaveCount(0);
    // `recipes` now carries both clippings.
    await expect(tagRow(page, "recipes").getByRole("link")).toContainText("2");

    await page.goto("/");
    await expect(listRow(page, READING).getByRole("link", { name: "recipes" })).toBeVisible();
    await expect(listRow(page, READING).getByRole("link", { name: "reading" })).toHaveCount(0);
    await page.goto("/?tag=recipes");
    await expect(listRow(page, READING)).toBeVisible();
    await expect(listRow(page, RECIPE)).toBeVisible();
  });

  test("deletes a tag, and the clippings stay without it", async ({ page, user, clippings }) => {
    await seed(clippings, user.id);
    await page.goto("/tags");

    await openActions(page, "weekend");
    await page.getByRole("menuitem", { name: "Delete…" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete “weekend”?" });
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect(dialog).toBeHidden();
    await expect(tagRow(page, "weekend")).toHaveCount(0);

    await page.goto("/");
    await expect(listRow(page, RECIPE)).toBeVisible();
    await expect(listRow(page, RECIPE).getByRole("link", { name: "recipes" })).toBeVisible();
    await expect(listRow(page, RECIPE).getByRole("link", { name: "weekend" })).toHaveCount(0);
  });
});
