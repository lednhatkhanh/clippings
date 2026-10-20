import { expect, test } from "../support/fixtures.ts";

test.describe("the sign-in gate", () => {
  test.use({ signedIn: false });

  test("sends a signed-out visitor to sign-in, back to the page they asked for", async ({
    page,
  }) => {
    await page.goto("/tags");

    await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Ftags$/);
    await expect(page.getByRole("heading", { name: "Your clippings, kept." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  });
});

test.describe("what loads without a session", () => {
  test.use({ signedIn: false });

  test("the health check answers without a redirect", async ({ request }) => {
    const response = await request.get("/api/health", { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("the web manifest answers without a redirect", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest", { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ name: "Clippings", display: "standalone" });
  });

  test("the service worker answers without a redirect", async ({ request }) => {
    const response = await request.get("/sw.js", { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("javascript");
  });
});

test.describe("signed in", () => {
  test("shows the user their list", async ({ page, user, clippings }) => {
    await clippings.saveClipping(user.id, { url: "https://example.com/smoke", source: "web" });

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Clippings", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "New clipping" })).toBeVisible();
    await expect(
      page.getByRole("grid", { name: "Your clippings" }).getByRole("row", { name: /example\.com/ }),
    ).toBeVisible();
  });
});
