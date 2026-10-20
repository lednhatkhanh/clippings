import { expect, test } from "../support/fixtures.ts";

const PAGE = "https://example.com/edit-me";

test.describe("editing a clipping on its detail page", () => {
  test("keeps an edited note after a reload", async ({ page, user, clippings }) => {
    const { clipping } = await clippings.saveClipping(user.id, { url: PAGE, source: "web" });
    await page.goto(`/c/${clipping.id}`);

    await page.getByRole("textbox", { name: "Note" }).fill("Read this on the train");
    // The note saves itself a moment after typing stops.
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.reload();

    await expect(page.getByRole("textbox", { name: "Note" })).toHaveValue("Read this on the train");
  });

  test("changes the tags, and keeps them after a reload", async ({ page, user, clippings }) => {
    const { clipping } = await clippings.saveClipping(user.id, {
      url: PAGE,
      tags: ["old"],
      source: "web",
    });
    await page.goto(`/c/${clipping.id}`);
    const chosen = page.getByRole("grid", { name: "Tags: chosen" });
    await expect(chosen.getByRole("row", { name: "old" })).toBeVisible();

    const field = page.getByRole("combobox", { name: "Tags", exact: true });
    await field.fill("fresh");
    await field.press("Enter");
    await expect(chosen.getByRole("row", { name: "fresh" })).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Remove old" }).click();
    await expect(chosen.getByRole("row", { name: "old" })).toBeHidden();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.reload();

    await expect(chosen.getByRole("row", { name: "fresh" })).toBeVisible();
    await expect(chosen.getByRole("row", { name: "old" })).toBeHidden();
  });
});

test.describe("deleting a clipping", () => {
  test("removes it from the list, and Undo brings it back", async ({ page, user, clippings }) => {
    const { clipping } = await clippings.saveClipping(user.id, { url: PAGE, source: "web" });
    // A second clipping keeps the list on screen, not the empty state.
    await clippings.saveClipping(user.id, { url: "https://example.com/stays", source: "web" });
    const list = page.getByRole("grid", { name: "Your clippings" });

    // Delete lives on the detail page, which returns to the list, where Undo waits.
    await page.goto(`/c/${clipping.id}`);
    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Clipping deleted.")).toBeVisible();
    await expect(list.getByRole("row", { name: /example\.com\/stays/ })).toBeVisible();
    await expect(list.getByRole("row", { name: /example\.com\/edit-me/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Undo" }).click();

    await expect(list.getByRole("row", { name: /example\.com\/edit-me/ })).toBeVisible();
    // The undo reached the server: the clipping is still there after a reload.
    await expect
      .poll(async () => (await page.request.get(`/api/clippings/${clipping.id}`)).status())
      .toBe(200);
    await page.reload();
    await expect(list.getByRole("row", { name: /example\.com\/edit-me/ })).toBeVisible();
  });

  test("stays deleted after a reload", async ({ page, user, clippings }) => {
    const { clipping } = await clippings.saveClipping(user.id, { url: PAGE, source: "web" });
    await clippings.saveClipping(user.id, { url: "https://example.com/stays", source: "web" });

    await page.goto(`/c/${clipping.id}`);
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Clipping deleted.")).toBeVisible();
    // The page hides the row at once; wait for the server to have deleted it before reloading.
    await expect
      .poll(async () => (await page.request.get(`/api/clippings/${clipping.id}`)).status())
      .toBe(404);
    await page.reload();

    const list = page.getByRole("grid", { name: "Your clippings" });
    await expect(list.getByRole("row", { name: /example\.com\/stays/ })).toBeVisible();
    await expect(list.getByRole("row", { name: /example\.com\/edit-me/ })).toHaveCount(0);
  });
});
