import { expect, test } from "../support/fixtures.ts";

const PAGE = "https://example.com/rename-me";

test.describe("renaming a clipping on its detail page", () => {
  test("keeps the new title after a reload, and Reset brings the page title back", async ({
    page,
    user,
    clippings,
  }) => {
    // A seeded clipping is unread, so its page title is its address.
    const { clipping } = await clippings.saveClipping(user.id, { url: PAGE, source: "web" });
    await page.goto(`/c/${clipping.id}`);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(PAGE);

    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByRole("textbox", { name: "Title" }).fill("My own name");
    // The title saves itself a moment after typing stops.
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.reload();

    await expect(heading).toHaveText("My own name");
    await expect(page.getByRole("button", { name: "Reset to page title" })).toBeVisible();

    await page.getByRole("button", { name: "Reset to page title" }).click();

    await expect(heading).toHaveText(PAGE);
    await expect(page.getByRole("button", { name: "Reset to page title" })).toHaveCount(0);
    await page.reload();
    await expect(heading).toHaveText(PAGE);
  });

  test("shows the new title in the list", async ({ page, user, clippings }) => {
    const { clipping } = await clippings.saveClipping(user.id, { url: PAGE, source: "web" });
    await page.goto(`/c/${clipping.id}`);
    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByRole("textbox", { name: "Title" }).fill("Listed under this name");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.goto("/");

    const list = page.getByRole("grid", { name: "Your clippings" });
    await expect(list.getByRole("row", { name: /Listed under this name/ })).toBeVisible();
  });
});
