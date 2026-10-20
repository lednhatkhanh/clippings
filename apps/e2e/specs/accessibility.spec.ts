import { wcagViolations } from "../support/axe.ts";
import { expect, test } from "../support/fixtures.ts";

// axe finds what a machine can find. It is not a replacement for keyboard and screen reader
// checks, but it catches the regressions that need no judgment: names, roles, contrast, structure.

test.describe("accessibility (WCAG 2.0 and 2.1, A and AA)", () => {
  test("the list has no violations", async ({ page, user, clippings }) => {
    await clippings.saveClipping(user.id, {
      url: "https://example.com/axe",
      note: "Something worth keeping",
      tags: ["reading"],
      source: "web",
    });

    await page.goto("/");
    await expect(page.getByRole("row", { name: /example\.com\/axe/ })).toBeVisible();

    expect(await wcagViolations(page)).toEqual([]);
  });

  test("the list with a search has no violations", async ({ page, user, clippings }) => {
    await clippings.saveClipping(user.id, {
      url: "https://example.com/axe",
      note: "Something worth keeping",
      tags: ["reading"],
      source: "web",
    });

    await page.goto("/?q=worth&tag=reading");
    await expect(page.getByRole("row", { name: /example\.com\/axe/ })).toBeVisible();
    await expect(page.locator("mark")).toBeVisible();

    expect(await wcagViolations(page)).toEqual([]);
  });

  test("the detail page has no violations", async ({ page, user, clippings }) => {
    const { clipping } = await clippings.saveClipping(user.id, {
      url: "https://example.com/axe",
      note: "Something worth keeping",
      tags: ["reading"],
      source: "web",
    });

    await page.goto(`/c/${clipping.id}`);
    await expect(page.getByRole("textbox", { name: "Note" })).toHaveValue(
      "Something worth keeping",
    );

    expect(await wcagViolations(page)).toEqual([]);
  });

  test("the Tags page has no violations", async ({ page, user, clippings }) => {
    await clippings.saveClipping(user.id, {
      url: "https://example.com/axe",
      tags: ["reading", "recipes"],
      source: "web",
    });

    await page.goto("/tags");
    await expect(page.getByRole("list", { name: "Your tags" })).toBeVisible();

    expect(await wcagViolations(page)).toEqual([]);
  });

  test("the Settings page has no violations", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible();

    for (const tab of ["Appearance", "Connections", "Account"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      expect(await wcagViolations(page), `the ${tab} tab`).toEqual([]);
    }
  });

  test.describe("signed out", () => {
    test.use({ signedIn: false });

    test("the sign-in page has no violations", async ({ page }) => {
      await page.goto("/sign-in");
      await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();

      expect(await wcagViolations(page)).toEqual([]);
    });
  });
});
