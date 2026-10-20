import { expect, test } from "../support/fixtures.ts";

// A loopback address: the page fetcher refuses it by design, so the clipping can only end failed,
// and the spec needs no internet.
const LOOPBACK_PAGE = "http://127.0.0.1:9/article";

test.describe("enrichment that can't read the page", () => {
  test("ends failed, and Retry puts the clipping back to pending", async ({ page }) => {
    // The fake QStash retries after a second, three times; the last try marks the clipping failed.
    test.setTimeout(60_000);

    // Through the dialog: the save publishes the job, QStash delivers it, the fetcher refuses it.
    await page.goto("/");
    await page.getByRole("button", { name: "New clipping" }).click();
    const dialog = page.getByRole("dialog", { name: "New clipping" });
    await dialog.getByRole("textbox", { name: "Address" }).fill(LOOPBACK_PAGE);
    await dialog.getByRole("button", { name: "Save" }).click();

    const row = page.getByRole("grid", { name: "Your clippings" }).getByRole("row", {
      name: new RegExp(LOOPBACK_PAGE),
    });
    await expect(row.getByRole("progressbar", { name: "Reading the page" })).toBeVisible();
    await expect(row.getByText("Couldn't read this page.")).toBeVisible({ timeout: 30_000 });

    await row.getByRole("button", { name: "Retry" }).click();

    await expect(row.getByRole("progressbar", { name: "Reading the page" })).toBeVisible();
    await expect(row.getByText("Couldn't read this page.")).toBeHidden();
  });
});
