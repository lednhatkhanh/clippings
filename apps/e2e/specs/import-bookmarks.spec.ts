import { expect, test } from "../support/fixtures.ts";

const BOOKMARKS = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
  <DT><H3>Recipes</H3>
  <DL><p>
    <DT><A HREF="https://example.com/imported-soup" ADD_DATE="1262304000">Soup</A>
    <DT><A HREF="https://example.com/imported-bread" ADD_DATE="1262390400">Bread</A>
  </DL><p>
  <DT><A HREF="https://example.com/already-here" ADD_DATE="1262476800">Already here</A>
  <DT><A HREF="javascript:void(0)" ADD_DATE="1262563200">A bookmarklet</A>
</DL><p>
`;

test.describe("importing a bookmarks file", () => {
  test("previews the counts, then adds the new clippings to the list", async ({
    page,
    user,
    clippings,
  }) => {
    await clippings.saveClipping(user.id, {
      url: "https://example.com/already-here",
      source: "web",
    });

    await page.goto("/settings");
    await page.getByRole("tab", { name: "Library" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "bookmarks.html",
      mimeType: "text/html",
      buffer: Buffer.from(BOOKMARKS),
    });

    await expect(page.getByText("2 bookmarks will be imported.")).toBeVisible();
    await expect(page.getByText("1 already saved.")).toBeVisible();
    await expect(page.getByText("1 link is skipped")).toBeVisible();

    await page.getByRole("button", { name: "Import", exact: true }).click();

    await expect(page.getByText("Imported 2 clippings.")).toBeVisible();
    await expect(page.getByText("2 imported clippings are waiting to be read")).toBeVisible();

    await page.goto("/");
    const list = page.getByRole("grid", { name: "Your clippings" });
    // Unread, so the address is the title for now.
    await expect(list.getByRole("row", { name: /example\.com\/imported-soup/ })).toBeVisible();
    await expect(list.getByRole("row", { name: /example\.com\/imported-bread/ })).toBeVisible();
    // The bookmark's folder became a tag.
    await expect(
      list.getByRole("row", { name: /example\.com\/imported-soup/ }).getByRole("link", {
        name: "recipes",
      }),
    ).toBeVisible();
    await expect(list.getByRole("row", { name: /bookmarklet|javascript/ })).toHaveCount(0);
  });
});
