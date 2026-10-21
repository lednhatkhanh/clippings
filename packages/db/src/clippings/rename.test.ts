import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_TITLE_LENGTH, type SearchHit } from "@clippings/shared";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";
import { TitleTooLongError } from "./service.ts";

describe.skipIf(!TEST_DATABASE_URL)("renaming a clipping", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  /** Saves a page and lets enrichment read it, a minute after the previous one. */
  async function clip(userId: string, url: string, title: string, note = "") {
    fixture.web.set(url, {
      page: { title, text: "" },
      summary: { title, summary: "", excerpt: "" },
    });
    const { clipping } = await fixture.service.saveClipping(userId, { url, note, source: "web" });
    await fixture.service.enrichClipping(clipping.id);
    fixture.advanceClock(60_000);
    return clipping.id;
  }

  const titles = (hits: SearchHit[]) => hits.map((hit) => hit.clipping.title);

  it("shows the user's title everywhere and keeps the page's title beside it", async () => {
    const ana = await fixture.createUser("ana");
    const id = await clip(ana, "https://example.com/a", "Gardening | Example");

    const renamed = await fixture.service.updateClipping(ana, id, { title: "  My garden notes " });

    expect(renamed).toMatchObject({
      title: "My garden notes",
      pageTitle: "Gardening | Example",
      titleEdited: true,
    });
    expect(await fixture.service.getClipping(ana, id)).toMatchObject({ title: "My garden notes" });
    const page = await fixture.service.listClippings(ana, {});
    expect(page.items.map((clipping) => clipping.title)).toEqual(["My garden notes"]);
    const exported = await fixture.service.exportClippings(ana);
    expect(exported.clippings[0]).toMatchObject({
      title: "My garden notes",
      pageTitle: "Gardening | Example",
      titleEdited: true,
    });
  });

  it("goes back to the page's title for an empty or null title, and leaves it when the title is left out", async () => {
    const ana = await fixture.createUser("ana");
    const id = await clip(ana, "https://example.com/a", "Page title");

    await fixture.service.updateClipping(ana, id, { title: "Mine" });
    const noteOnly = await fixture.service.updateClipping(ana, id, { note: "a note" });
    expect(noteOnly).toMatchObject({ title: "Mine", titleEdited: true });

    const blank = await fixture.service.updateClipping(ana, id, { title: "   " });
    expect(blank).toMatchObject({ title: "Page title", titleEdited: false });

    await fixture.service.updateClipping(ana, id, { title: "Mine again" });
    const reset = await fixture.service.updateClipping(ana, id, { title: null });
    expect(reset).toMatchObject({
      title: "Page title",
      pageTitle: "Page title",
      titleEdited: false,
    });
  });

  it("caps the title's length and changes nothing when it is too long", async () => {
    const ana = await fixture.createUser("ana");
    const id = await clip(ana, "https://example.com/a", "Page title");

    await expect(
      fixture.service.updateClipping(ana, id, {
        title: "x".repeat(MAX_TITLE_LENGTH + 1),
        note: "not saved",
      }),
    ).rejects.toThrow(TitleTooLongError);
    const atTheLimit = await fixture.service.updateClipping(ana, id, {
      title: "x".repeat(MAX_TITLE_LENGTH),
    });

    expect(atTheLimit?.title).toHaveLength(MAX_TITLE_LENGTH);
    expect(atTheLimit?.note).toBe("");
  });

  it("is never undone by enrichment, which still refreshes the page's title", async () => {
    const ana = await fixture.createUser("ana");
    const id = await clip(ana, "https://example.com/a", "Old page title");
    await fixture.service.updateClipping(ana, id, { title: "Mine" });
    fixture.web.set("https://example.com/a", {
      page: { title: "x", text: "" },
      summary: { title: "New page title", summary: "", excerpt: "" },
    });

    await fixture.service.reEnrichClipping(ana, id);
    await fixture.service.enrichClipping(id);

    expect(await fixture.service.getClipping(ana, id)).toMatchObject({
      title: "Mine",
      pageTitle: "New page title",
    });
  });

  it("starts over when a deleted clipping of the same page is saved again", async () => {
    const ana = await fixture.createUser("ana");
    const id = await clip(ana, "https://example.com/a", "Page title");
    await fixture.service.updateClipping(ana, id, { title: "Mine" });
    await fixture.service.deleteClipping(ana, id);

    const { clipping } = await fixture.service.saveClipping(ana, {
      url: "https://example.com/a",
      source: "web",
    });

    expect(clipping).toMatchObject({ titleEdited: false, title: "https://example.com/a" });
  });

  it("keeps users apart: B can't rename A's clipping, and B's search never finds A's title", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    const id = await clip(ana, "https://example.com/a", "Page title");

    expect(await fixture.service.updateClipping(ben, id, { title: "Hijacked" })).toBeNull();
    await fixture.service.updateClipping(ana, id, { title: "Zanzibar spices" });

    expect(await fixture.service.getClipping(ana, id)).toMatchObject({ title: "Zanzibar spices" });
    const bens = await fixture.service.searchClippings(ben, { q: "zanzibar" });
    expect(bens.items).toEqual([]);
  });

  describe("search", () => {
    it("finds a renamed clipping by its new title and by the page's title", async () => {
      const ana = await fixture.createUser("ana");
      await clip(ana, "https://example.com/a", "Seasonal vegetables guide");
      await clip(ana, "https://example.com/b", "Unrelated page");
      const [renamed] = (await fixture.service.listClippings(ana, {})).items.filter(
        (clipping) => clipping.pageTitle === "Seasonal vegetables guide",
      );
      await fixture.service.updateClipping(ana, renamed!.id, { title: "Allotment plan" });

      const byNewTitle = await fixture.service.searchClippings(ana, { q: "allotment" });
      const byPageTitle = await fixture.service.searchClippings(ana, { q: "vegetables" });

      expect(titles(byNewTitle.items)).toEqual(["Allotment plan"]);
      expect(titles(byPageTitle.items)).toEqual(["Allotment plan"]);
      expect(byNewTitle.items[0]?.highlights.title).toEqual([
        { text: "Allotment", match: true },
        { text: " plan", match: false },
      ]);
    });

    it("ranks the user's title as a title match, above a note match", async () => {
      const ana = await fixture.createUser("ana");
      await clip(ana, "https://example.com/note", "Reading list", "mentions sourdough once");
      const id = await clip(ana, "https://example.com/title", "Bread page");
      await fixture.service.updateClipping(ana, id, { title: "Sourdough starter" });

      const { items } = await fixture.service.searchClippings(ana, { q: "sourdough" });

      expect(titles(items)).toEqual(["Sourdough starter", "Reading list"]);
    });

    it("finds a renamed clipping by a misspelling of the user's title", async () => {
      const ana = await fixture.createUser("ana");
      const id = await clip(ana, "https://example.com/a", "Page title");
      await fixture.service.updateClipping(ana, id, { title: "Kubernetes primer" });

      const { items } = await fixture.service.searchClippings(ana, { q: "kubernets" });

      expect(titles(items)).toEqual(["Kubernetes primer"]);
    });

    it("stops finding the user's title once it is reset", async () => {
      const ana = await fixture.createUser("ana");
      const id = await clip(ana, "https://example.com/a", "Page title");
      await fixture.service.updateClipping(ana, id, { title: "Zanzibar spices" });
      await fixture.service.updateClipping(ana, id, { title: null });

      const { items } = await fixture.service.searchClippings(ana, { q: "zanzibar" });

      expect(items).toEqual([]);
    });
  });
});
