import { expect, test } from "../support/fixtures.ts";

// Read for real, so the spec needs the internet: its title is "Example Domain", and the Anthropic
// fake suggests the user's first two tags plus the first long word of that title.
const READ_PAGE = "https://example.com/";

test.describe("tag suggestions", () => {
  test("turned on, a read clipping offers suggestions, and accepting one adds the tag", async ({
    page,
    database,
    user,
    clippings,
  }) => {
    // The fake Anthropic answers after four seconds.
    test.setTimeout(60_000);
    // The user's vocabulary, which the suggestions are drawn from.
    await clippings.saveClipping(user.id, {
      url: "https://example.com/vocabulary",
      tags: ["cooking", "travel"],
      source: "web",
    });

    await page.goto("/settings");
    await page.getByRole("tab", { name: "Library" }).click();
    await page.getByRole("radio", { name: "On" }).first().click();
    await expect
      .poll(async () => {
        const { rows } = await database.query<{ on: boolean }>(
          "select suggest_tags as on from user_settings where user_id = $1",
          [user.id],
        );
        return rows[0]?.on;
      })
      .toBe(true);

    // Saved through the dialog, so the job goes to the fake QStash and back to the app.
    await page.goto("/");
    await page.getByRole("button", { name: "New clipping" }).click();
    const dialog = page.getByRole("dialog", { name: "New clipping" });
    await dialog.getByRole("textbox", { name: "Address" }).fill(READ_PAGE);
    await dialog.getByRole("button", { name: "Save" }).click();
    const row = page.getByRole("grid", { name: "Your clippings" }).getByRole("row", {
      name: /Read: Example Domain/,
    });
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.getByText("Read: Example Domain").click();

    await expect(page.getByText("Suggested", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add tag cooking" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add tag travel" })).toBeVisible();
    const chosen = page.getByRole("grid", { name: "Tags: chosen" });
    await expect(chosen.getByRole("row", { name: "example" })).toHaveCount(0);

    await page.getByRole("button", { name: "Add tag example" }).click();

    await expect(chosen.getByRole("row", { name: "example" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add tag example" })).toHaveCount(0);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    // The other suggestions stay on offer, and the added tag survives a reload.
    await page.reload();
    await expect(chosen.getByRole("row", { name: "example" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add tag cooking" })).toBeVisible();
  });
});
