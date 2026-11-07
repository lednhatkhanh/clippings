import type { Page } from "@playwright/test";

import { expect, test } from "../support/fixtures.ts";

const LEARNING = "https://example.com/learning";
const SOUP = "https://example.com/soup";

function tagRow(page: Page, name: string) {
  return page
    .getByRole("list", { name: "Your tags" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: `Actions for ${name}`, exact: true }) });
}

test.describe("library review", () => {
  test("approves a suggestion, undoes a merge, and says why an undo is refused", async ({
    page,
    user,
    clippings,
    librarian,
  }) => {
    await clippings.saveClipping(user.id, { url: LEARNING, tags: ["ml", "soup"], source: "web" });
    await clippings.saveClipping(user.id, {
      url: SOUP,
      tags: ["machine learning"],
      source: "web",
    });
    const tagId = async (name: string) => (await clippings.findTagByName(user.id, name))!.id;

    // The user merged `ml` into `machine learning`, and colored `soup` twice; the librarian is
    // not sure `machine learning` should be green.
    await librarian.proposeChange(user.id, "user_via_mcp", {
      action: "merge_tag",
      sourceId: await tagId("ml"),
      targetId: await tagId("machine learning"),
      reason: "The same thing",
    });
    const soup = await tagId("soup");
    for (const color of ["red", "blue"] as const) {
      await librarian.proposeChange(user.id, "user_via_mcp", {
        action: "set_tag_color",
        tagId: soup,
        color,
        reason: `Soup is ${color}`,
      });
    }
    await librarian.proposeChange(user.id, "librarian", {
      action: "set_tag_color",
      tagId: await tagId("machine learning"),
      color: "green",
      reason: "Its folder is green",
      confidence: "low",
    });

    await page.goto("/settings/library");
    const waiting = page.getByRole("list", { name: "Suggested changes" });
    const recent = page.getByRole("list", { name: "Recent changes" });
    await expect(waiting.getByRole("listitem")).toHaveCount(1);
    await expect(waiting).toContainText("Its folder is green");

    // Approving moves the suggestion from the waiting list to the recent changes.
    await waiting
      .getByRole("button", { name: 'Approve: Color the tag "machine learning" green' })
      .click();
    await expect(page.getByText("Nothing is waiting for a decision.")).toBeVisible();
    await expect(
      recent.getByRole("button", { name: 'Undo: Color the tag "machine learning" green' }),
    ).toBeVisible();

    // A later change to `soup` blocks undoing the earlier one, and the reason shows in place.
    await recent.getByRole("button", { name: 'Undo: Color the tag "soup" red' }).click();
    await expect(
      recent.getByRole("alert").filter({ hasText: "A later change touched the same things" }),
    ).toBeVisible();
    await expect(
      recent.getByRole("button", { name: 'Undo: Color the tag "soup" red' }),
    ).toBeVisible();

    // The merge can be undone: `ml` is back, carried by its clipping.
    await recent.getByRole("button", { name: /^Undo: Merge the tag "ml"/ }).click();
    await expect(recent.getByRole("button", { name: /^Undo: Merge the tag "ml"/ })).toHaveCount(0);

    await page.goto("/tags");
    await expect(tagRow(page, "ml").getByRole("link")).toContainText("1");
    await expect(tagRow(page, "machine learning").getByRole("link")).toContainText("1");
    // The approved color is the tag's now.
    await expect(tagRow(page, "machine learning").locator(".bg-tag-green-dot")).toBeVisible();
  });

  test("opens a tag's topic page from the Tags page, marked as AI content, and shows links on the detail page", async ({
    page,
    user,
    clippings,
    librarian,
  }) => {
    const first = await clippings.saveClipping(user.id, {
      url: LEARNING,
      tags: ["bread"],
      source: "web",
    });
    const second = await clippings.saveClipping(user.id, { url: SOUP, source: "web" });
    const bread = (await clippings.findTagByName(user.id, "bread"))!.id;
    await librarian.proposeChange(user.id, "librarian", {
      action: "write_topic_page",
      tagId: bread,
      body: "# Bread\n\nSourdough needs a **long** rise.",
      reason: "Two clippings on baking",
      confidence: "high",
    });
    await librarian.proposeChange(user.id, "user_via_mcp", {
      action: "link_items",
      fromId: first.clipping.id,
      toId: second.clipping.id,
      reason: "Both are about the kitchen",
    });

    await page.goto("/tags");
    await page.getByRole("button", { name: "Actions for bread", exact: true }).click();
    await page.getByRole("menuitem", { name: "Topic page" }).click();

    await expect(page).toHaveURL(new RegExp(`/tags/${bread}$`));
    await expect(page.getByText("AI-written")).toBeVisible();
    await expect(page.locator("strong", { hasText: "long" })).toBeVisible();

    // The linked clipping shows the link's reason, on both sides.
    await page.goto(`/c/${second.clipping.id}`);
    const linked = page.getByRole("region", { name: "Linked" });
    await expect(linked).toContainText("Both are about the kitchen");
    await linked.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/c/${first.clipping.id}$`));
  });

  test("files a clipping in a new folder and then an existing one, and filters the list by folder", async ({
    page,
    user,
    clippings,
  }) => {
    const first = await clippings.saveClipping(user.id, { url: LEARNING, source: "web" });
    const second = await clippings.saveClipping(user.id, { url: SOUP, source: "web" });

    await page.goto(`/c/${first.clipping.id}`);
    await expect(page.getByText("Not filed yet")).toBeVisible();
    await page.getByRole("button", { name: "New folder" }).click();
    const dialog = page.getByRole("dialog", { name: "New folder" });
    await dialog.getByRole("textbox", { name: "Folder name" }).fill("Cooking");
    await dialog.getByRole("button", { name: "Create and move" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("link", { name: "Cooking" })).toBeVisible();

    // The folder is there to choose for another clipping.
    await page.goto(`/c/${second.clipping.id}`);
    await page.getByRole("button", { name: "Move to a folder" }).click();
    await page.getByRole("menuitemradio", { name: "Cooking" }).click();
    await expect(page.getByRole("link", { name: "Cooking" })).toBeVisible();

    // A third clipping stays out of it, and the list filters to the folder and back.
    await clippings.saveClipping(user.id, { url: "https://example.com/other", source: "web" });
    await page.goto("/");
    const list = page.getByRole("grid", { name: "Your clippings" });
    await expect(list.getByRole("row", { name: /example\.com\/other/ })).toBeVisible();
    const folders = page.getByRole("toolbar", { name: "Folders" });
    await folders.getByRole("button", { name: "Cooking" }).click();
    await expect(page).toHaveURL(/folder=/);
    await expect(list.getByRole("row", { name: new RegExp(LEARNING) })).toBeVisible();
    await expect(list.getByRole("row", { name: new RegExp(SOUP) })).toBeVisible();
    await expect(list.getByRole("row", { name: /example\.com\/other/ })).toHaveCount(0);
    await folders.getByRole("button", { name: "Cooking" }).click();
    await expect(list.getByRole("row", { name: /example\.com\/other/ })).toBeVisible();
  });
});
