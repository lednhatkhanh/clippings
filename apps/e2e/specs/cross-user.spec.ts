import { expect, signIn, test } from "../support/fixtures.ts";

test.describe("one user's clipping, opened by another", () => {
  test("is not found on the page", async ({ page, user, createUser, clippings }) => {
    const owner = await createUser();
    const { clipping } = await clippings.saveClipping(owner.id, {
      url: "https://example.com/private",
      note: "Only for the owner",
      source: "web",
    });
    expect(user.id).not.toBe(owner.id);

    await page.goto(`/c/${clipping.id}`);

    await expect(page.getByRole("heading", { name: "This clipping isn't here." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "https://example.com/private" })).toHaveCount(0);
    await expect(page.getByText("Only for the owner")).toHaveCount(0);
  });

  test("is not found through the API, and stays out of the other user's list", async ({
    page,
    user,
    createUser,
    clippings,
  }) => {
    const owner = await createUser();
    const { clipping } = await clippings.saveClipping(owner.id, {
      url: "https://example.com/private",
      source: "web",
    });
    await clippings.saveClipping(user.id, { url: "https://example.com/mine", source: "web" });

    // The page's request context carries the signed-in user's cookie.
    const other = await page.request.get(`/api/clippings/${clipping.id}`);
    const list = await page.request.get("/api/clippings");

    expect(other.status()).toBe(404);
    expect(list.status()).toBe(200);
    const listed = JSON.stringify(await list.json());
    expect(listed).toContain("example.com/mine");
    expect(listed).not.toContain("example.com/private");
  });

  // The control: the same link opens for its owner, so the 404s above are about who is asking.
  test("opens for its owner", async ({ browser, createUser, clippings }) => {
    const owner = await createUser();
    const { clipping } = await clippings.saveClipping(owner.id, {
      url: "https://example.com/private",
      source: "web",
    });
    const context = await browser.newContext();
    await signIn(context, owner);
    const page = await context.newPage();

    await page.goto(`/c/${clipping.id}`);

    await expect(page.getByRole("heading", { name: "https://example.com/private" })).toBeVisible();
    await context.close();
  });
});
