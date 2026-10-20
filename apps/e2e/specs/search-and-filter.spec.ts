import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../support/fixtures.ts";

const SPICE = "https://example.com/spice";
const LEDGER = "https://example.com/ledger";

function listRow(page: Page, url: string): Locator {
  return page.getByRole("grid", { name: "Your clippings" }).getByRole("row", {
    name: new RegExp(url),
  });
}

test.describe("finding clippings in the list", () => {
  test.beforeEach(async ({ user, clippings }) => {
    await clippings.saveClipping(user.id, {
      url: SPICE,
      note: "Zanzibar cloves and cardamom, for the winter baking",
      tags: ["cooking"],
      source: "web",
    });
    await clippings.saveClipping(user.id, {
      url: LEDGER,
      note: "Quarterly figures for the accountant",
      tags: ["work"],
      source: "web",
    });
  });

  test("typing a query shows the matching clipping with its highlight", async ({ page }) => {
    await page.goto("/");
    await expect(listRow(page, LEDGER)).toBeVisible();

    await page.getByRole("searchbox", { name: "Search your clippings" }).fill("zanzibar");

    await expect(listRow(page, SPICE)).toBeVisible();
    await expect(listRow(page, LEDGER)).toHaveCount(0);
    // The words that matched are marked in the snippet.
    await expect(listRow(page, SPICE).locator("mark")).toHaveText("Zanzibar");
    await expect(page.getByText("1 clipping match")).toBeVisible();
    // The query is in the address, so a reload shows the same results.
    await expect(page).toHaveURL(/\?q=zanzibar$/);
    await page.reload();
    await expect(page.getByRole("searchbox", { name: "Search your clippings" })).toHaveValue(
      "zanzibar",
    );
    await expect(listRow(page, SPICE)).toBeVisible();
    await expect(listRow(page, LEDGER)).toHaveCount(0);
  });

  test("says so when nothing matches", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("searchbox", { name: "Search your clippings" }).fill("xylophone");

    await expect(
      page.getByRole("heading", { name: "No clippings match “xylophone”" }),
    ).toBeVisible();
    await expect(page.getByRole("grid", { name: "Your clippings" })).toHaveCount(0);
  });

  test("clicking a tag chip filters the list, and a reload keeps the filter", async ({ page }) => {
    await page.goto("/");

    await listRow(page, SPICE).getByRole("link", { name: "cooking" }).click();

    await expect(page).toHaveURL(/\/\?tag=cooking$/);
    await expect(
      page.getByRole("toolbar", { name: "Tags filtered by" }).getByRole("button", {
        name: "cooking",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(listRow(page, SPICE)).toBeVisible();
    await expect(listRow(page, LEDGER)).toHaveCount(0);

    await page.reload();

    await expect(page).toHaveURL(/\/\?tag=cooking$/);
    await expect(listRow(page, SPICE)).toBeVisible();
    await expect(listRow(page, LEDGER)).toHaveCount(0);

    // Deselecting the chip widens the list again, and the address follows.
    await page
      .getByRole("toolbar", { name: "Tags filtered by" })
      .getByRole("button", { name: "cooking" })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(listRow(page, LEDGER)).toBeVisible();
  });
});
