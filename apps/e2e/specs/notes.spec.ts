import { expect, test } from "../support/fixtures.ts";

const LINK = "https://example.com/ledger";

test.describe("notes", () => {
  test("writes a note in New clipping, finds it by search among the links, and reads it formatted", async ({
    page,
    user,
    clippings,
  }) => {
    await clippings.saveClipping(user.id, { url: LINK, note: "Quarterly figures", source: "web" });
    await page.goto("/");
    await page.getByRole("button", { name: "New clipping" }).click();
    const dialog = page.getByRole("dialog", { name: "New clipping" });

    await dialog.getByRole("radio", { name: "Note" }).click();
    await dialog
      .getByRole("textbox", { name: "Note (Markdown)" })
      .fill("# Monstera repotting\n\nUse **chunky** bark, and check the roots first.");
    await dialog.getByRole("button", { name: "Save note" }).click();

    await expect(dialog).toBeHidden();
    const list = page.getByRole("grid", { name: "Your clippings" });
    await expect(list.getByRole("row", { name: /Monstera repotting/ })).toBeVisible();

    // Search finds the note by a word in its body, and the link is not a match.
    await page.getByRole("searchbox", { name: "Search your clippings" }).fill("chunky");
    const row = list.getByRole("row", { name: /Monstera repotting/ });
    await expect(row).toBeVisible();
    await expect(row.getByText("Note", { exact: true })).toBeVisible();
    await expect(row.locator("mark")).toHaveText("chunky");
    await expect(list.getByRole("row", { name: new RegExp(LINK) })).toHaveCount(0);

    // The detail page shows the Markdown formatted, and Edit shows its source.
    await row.click();
    await expect(page.getByRole("heading", { name: "Monstera repotting", level: 3 })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Monstera repotting", level: 2 })).toBeVisible();
    await expect(page.locator("strong", { hasText: "chunky" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open original" })).toHaveCount(0);

    await page.getByRole("radio", { name: "Edit" }).click();
    await expect(page.getByRole("textbox", { name: "Text (Markdown)" })).toHaveValue(
      "# Monstera repotting\n\nUse **chunky** bark, and check the roots first.",
    );
  });

  test("previews an edit before saving it, and keeps the saved text after a reload", async ({
    page,
    user,
    clippings,
  }) => {
    const note = await clippings.saveNote(user.id, {
      body: "# Draft\n\nfirst version",
      source: "web",
    });
    await page.goto(`/c/${note.id}`);

    await page.getByRole("radio", { name: "Edit" }).click();
    await page
      .getByRole("textbox", { name: "Text (Markdown)" })
      .fill("# Draft\n\nsecond **version**\n\n- [x] done");
    await page.getByRole("radio", { name: "Preview" }).click();

    await expect(page.locator("strong", { hasText: "version" })).toBeVisible();
    await expect(page.getByRole("checkbox", { checked: true })).toBeVisible();
    await expect(page.getByText("Not saved yet")).toBeVisible();

    await page.getByRole("radio", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();

    await expect(page.locator("strong", { hasText: "version" })).toBeVisible();
    await expect(page.getByText("first version")).toHaveCount(0);
  });

  test("keeps a user's note out of another user's search", async ({
    page,
    user,
    clippings,
    createUser,
  }) => {
    const other = await createUser();
    await clippings.saveNote(other.id, { body: "Zanzibar secrets", source: "web" });
    await clippings.saveNote(user.id, { body: "Zanzibar holiday plan", source: "web" });

    await page.goto("/?q=zanzibar");

    const list = page.getByRole("grid", { name: "Your clippings" });
    await expect(list.getByRole("row", { name: /Zanzibar holiday plan/ })).toBeVisible();
    await expect(list.getByRole("row")).toHaveCount(1);
  });
});
