import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";

describe.skipIf(!TEST_DATABASE_URL)("the saved page text", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  const DAY = 24 * 60 * 60 * 1000;
  const URL = "https://example.com/essay";

  const summary = {
    title: "An essay about gardening",
    summary: "Why small gardens beat big ones.",
    excerpt: "A long essay about gardening",
  };

  function setPage(text: string) {
    fixture.web.set(URL, { page: { title: "Essay | Example", text }, summary });
  }

  async function saveAndRead(userId: string) {
    const { clipping } = await fixture.service.saveClipping(userId, { url: URL, source: "web" });
    await fixture.service.enrichClipping(clipping.id);
    return clipping.id;
  }

  it("keeps the text the page was read with, stamped with the read time", async () => {
    const ana = await fixture.createUser("ana");
    setPage("A long essay about gardening, from start to end.");

    const id = await saveAndRead(ana);

    expect(await fixture.service.getClippingText(ana, id)).toEqual({
      text: "A long essay about gardening, from start to end.",
      fetchedAt: "2026-10-01T09:00:00.000Z",
    });
  });

  it("has no text for a clipping that is still pending or failed", async () => {
    const ana = await fixture.createUser("ana");
    const { clipping } = await fixture.service.saveClipping(ana, { url: URL, source: "web" });
    expect(await fixture.service.getClippingText(ana, clipping.id)).toBeNull();

    fixture.web.set(URL, { error: new Error("boom") });
    await fixture.service.enrichClipping(clipping.id, { lastAttempt: true });
    expect(await fixture.service.getClippingText(ana, clipping.id)).toBeNull();
  });

  it("replaces the text when the page is read again", async () => {
    const ana = await fixture.createUser("ana");
    setPage("The first reading.");
    const id = await saveAndRead(ana);

    fixture.advanceClock(DAY);
    setPage("The second reading.");
    await fixture.service.reEnrichClipping(ana, id);
    await fixture.service.enrichClipping(id);

    expect(await fixture.service.getClippingText(ana, id)).toEqual({
      text: "The second reading.",
      fetchedAt: "2026-10-02T09:00:00.000Z",
    });
  });

  it("stores no text for a page without any, and drops the old text when a re-read finds none", async () => {
    const ana = await fixture.createUser("ana");
    setPage("");
    const empty = await saveAndRead(ana);
    expect(await fixture.service.getClippingText(ana, empty)).toBeNull();
    const rows = await fixture.pool.query(`select 1 from clipping_texts`);
    expect(rows.rowCount).toBe(0);

    setPage("Some text.");
    const id = (await fixture.service.saveClipping(ana, { url: URL, source: "web" })).clipping.id;
    expect(id).toBe(empty);
    await fixture.service.reEnrichClipping(ana, id);
    await fixture.service.enrichClipping(id);
    expect(await fixture.service.getClippingText(ana, id)).toMatchObject({ text: "Some text." });

    setPage("");
    await fixture.service.reEnrichClipping(ana, id);
    await fixture.service.enrichClipping(id);
    expect(await fixture.service.getClippingText(ana, id)).toBeNull();
  });

  it("keeps users apart: another user's clipping has no readable text", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    setPage("Ana's page.");
    const id = await saveAndRead(ana);
    const bens = await saveAndRead(ben);

    expect(await fixture.service.getClippingText(ben, id)).toBeNull();
    expect(await fixture.service.getClippingText(ana, id)).toMatchObject({ text: "Ana's page." });
    expect(await fixture.service.getClippingText(ben, bens)).toMatchObject({
      text: "Ana's page.",
    });
    expect(await fixture.service.getClippingText(ana, "not-an-id")).toBeNull();
  });

  it("hides the text of a deleted clipping, and shows it again after an undo", async () => {
    const ana = await fixture.createUser("ana");
    setPage("A page.");
    const id = await saveAndRead(ana);

    await fixture.service.deleteClipping(ana, id);
    expect(await fixture.service.getClippingText(ana, id)).toBeNull();

    await fixture.service.restoreClipping(ana, id);
    expect(await fixture.service.getClippingText(ana, id)).toMatchObject({ text: "A page." });
  });

  it("removes the text with the clipping when the purge runs", async () => {
    const ana = await fixture.createUser("ana");
    setPage("A page.");
    const id = await saveAndRead(ana);
    await fixture.service.deleteClipping(ana, id);
    fixture.advanceClock(DAY + 1);

    expect(await fixture.service.purgeDeleted()).toBe(1);

    const rows = await fixture.pool.query(`select 1 from clipping_texts`);
    expect(rows.rowCount).toBe(0);
  });

  it("puts each clipping's text in the export, null where there is none, only for the user's own", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    setPage("Ana's page.");
    const withText = await saveAndRead(ana);
    fixture.advanceClock(1000);
    const pending = (
      await fixture.service.saveClipping(ana, { url: "https://example.com/pending", source: "web" })
    ).clipping.id;
    await saveAndRead(ben);

    const { clippings } = await fixture.service.exportClippings(ana);

    expect(clippings.map(({ id, text }) => ({ id, text }))).toEqual([
      { id: pending, text: null },
      { id: withText, text: "Ana's page." },
    ]);
  });
});
