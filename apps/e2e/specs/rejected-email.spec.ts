import { BASE_URL } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";

// What Better Auth redirects to when the allowlist refuses a Google account: the error code and
// description go in the query, and the app keeps the email in a short-lived cookie instead.
const REJECTED_URL =
  "/sign-in?error=not_allowlisted&error_description=This+account+is+not+on+the+allowlist.";
const REJECTED_EMAIL_COOKIE = "clippings-rejected-email";

test.describe("an account that isn't on the allowlist", () => {
  test.use({ signedIn: false });

  test("sees that the account isn't allowed, and the email stays out of the URL", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: REJECTED_EMAIL_COOKIE,
        value: "mallory@example.com",
        domain: new URL(BASE_URL).hostname,
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto(REJECTED_URL);

    await expect(page.getByRole("heading", { name: "This Clippings is private" })).toBeVisible();
    await expect(page.getByText("mallory@example.com")).toBeVisible();
    await expect(page.getByText(/isn't on the list\./)).toBeVisible();
    // The way out is another Google account.
    await expect(page.getByRole("button", { name: "Use another account" })).toBeVisible();
    expect(page.url()).not.toContain("mallory");
    expect(page.url()).not.toContain("example.com");
  });

  test("still says so when the email wasn't kept", async ({ page }) => {
    await page.goto(REJECTED_URL);

    await expect(page.getByRole("heading", { name: "This Clippings is private" })).toBeVisible();
    await expect(page.getByText("That account isn't on the list.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Use another account" })).toBeVisible();
  });

  test("a different error gets the generic sign-in failure, not the private message", async ({
    page,
  }) => {
    await page.goto("/sign-in?error=server_error");

    await expect(page.getByRole("heading", { name: "Your clippings, kept." })).toBeVisible();
    await expect(page.getByText("Couldn't sign you in. Try again.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "This Clippings is private" })).toHaveCount(0);
  });
});
