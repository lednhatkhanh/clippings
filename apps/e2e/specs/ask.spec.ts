import { wcagViolations } from "../support/axe.ts";
import { expect, test } from "../support/fixtures.ts";

// The Anthropic fake answers a question over search results by quoting the first result and
// citing it, so the spec checks the path from the form to the cited clipping, not the model.
const SPICE = "https://example.com/spice";

test.describe("asking your clippings", () => {
  test("answers from a clipping and lists it as a source that opens", async ({
    page,
    user,
    clippings,
  }) => {
    const { clipping } = await clippings.saveClipping(user.id, {
      url: SPICE,
      note: "Zanzibar cloves and cardamom, for the winter baking",
      source: "web",
    });
    await clippings.saveClipping(user.id, {
      url: "https://example.com/ledger",
      note: "Quarterly figures for the accountant",
      source: "web",
    });

    await page.goto("/ask");
    await expect(page.getByRole("heading", { name: "Ask your clippings" })).toBeVisible();
    const submit = page.getByRole("button", { name: "Ask", exact: true });
    await expect(submit).toBeDisabled();

    await page.getByRole("textbox", { name: "Your question" }).fill("zanzibar");
    await submit.click();

    const answer = page.getByRole("region", { name: "Answer" });
    await expect(answer).toContainText("Zanzibar cloves and cardamom");
    // The marker after the cited passage, and the clipping it stands for.
    await expect(answer.locator("sup")).toHaveText("Source 1");
    const source = answer.getByRole("listitem").getByRole("link");
    await expect(source).toHaveCount(1);
    await expect(source).toHaveAttribute("href", `/c/${clipping.id}`);
    // Another clipping of the user's that doesn't match is not offered.
    await expect(answer).not.toContainText("accountant");

    await source.click();
    await expect(page).toHaveURL(new RegExp(`/c/${clipping.id}$`));
  });

  test("has no accessibility violations, empty or answered", async ({ page, user, clippings }) => {
    await clippings.saveClipping(user.id, {
      url: SPICE,
      note: "Zanzibar cloves and cardamom, for the winter baking",
      source: "web",
    });

    await page.goto("/ask");
    await expect(page.getByRole("heading", { name: "Ask your clippings" })).toBeVisible();
    expect(await wcagViolations(page), "the empty page").toEqual([]);

    await page.getByRole("textbox", { name: "Your question" }).fill("zanzibar");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("region", { name: "Answer" }).getByRole("link")).toBeVisible();
    expect(await wcagViolations(page), "the answered page").toEqual([]);
  });

  test("says so, without citing anything, when no clipping matches", async ({
    page,
    user,
    clippings,
  }) => {
    await clippings.saveClipping(user.id, {
      url: SPICE,
      note: "Zanzibar cloves and cardamom, for the winter baking",
      source: "web",
    });

    await page.goto("/ask");
    await page.getByRole("textbox", { name: "Your question" }).fill("xylophone");
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    const answer = page.getByRole("region", { name: "Answer" });
    await expect(answer).toContainText("Nothing in your clippings matches that.");
    await expect(answer.getByRole("link")).toHaveCount(0);
  });

  test("never answers from another user's clippings", async ({ page, createUser, clippings }) => {
    const other = await createUser();
    await clippings.saveClipping(other.id, {
      url: "https://example.com/private",
      note: "Zanzibar notes that only the other person saved",
      source: "web",
    });

    await page.goto("/ask");
    await page.getByRole("textbox", { name: "Your question" }).fill("zanzibar");
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    const answer = page.getByRole("region", { name: "Answer" });
    await expect(answer).toContainText("Nothing in your clippings matches that.");
    await expect(answer).not.toContainText("other person");
  });
});
