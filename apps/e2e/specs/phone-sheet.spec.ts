import { expect, test } from "../support/fixtures.ts";

// Below the medium size class, where a dialog is a bottom sheet.
test.use({ viewport: { width: 375, height: 812 } });

test.describe("the New clipping sheet on a phone", () => {
  test("slides in focused, and a swipe down closes it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New clipping" }).click();
    const sheet = page.getByRole("dialog", { name: "New clipping" });
    const address = sheet.getByRole("textbox", { name: "Address" });
    await expect(address).toBeInViewport();
    await expect(address).toBeFocused();

    // A swipe down scrolls the sheet's scroller back toward the top, the way a wheel does. Past
    // halfway it snaps shut; short of that it snaps back, so this goes the whole way.
    await sheet.hover();
    await page.mouse.wheel(0, -812);

    await expect(sheet).toBeHidden();
  });

  test("keeps what was typed when the phone turns sideways", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New clipping" }).click();
    const sheet = page.getByRole("dialog", { name: "New clipping" });
    await sheet.getByRole("textbox", { name: "Address" }).fill("https://example.com/draft");

    // Wider than the medium size class, where a closed modal would open as a centered dialog.
    await page.setViewportSize({ width: 812, height: 375 });

    await expect(sheet.getByRole("textbox", { name: "Address" })).toHaveValue(
      "https://example.com/draft",
    );
  });
});
