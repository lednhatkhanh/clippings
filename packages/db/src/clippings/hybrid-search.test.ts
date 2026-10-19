import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SearchHit } from "@clippings/shared";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";

describe.skipIf(!TEST_DATABASE_URL)("searching clippings by meaning", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
    // What the fake embedder understands: these words mean the same thing.
    for (const word of ["car", "automobile", "vehicle", "sedan"]) {
      fixture.meanings.set(word, "car");
    }
    for (const word of ["bread", "sourdough", "loaf"]) fixture.meanings.set(word, "bread");
  });

  afterEach(async () => {
    await fixture.close();
  });

  /** Saves a page and lets enrichment read it, so it has a title, an excerpt and an embedding. */
  async function clip(userId: string, page: { url: string; title: string; note?: string }) {
    fixture.web.set(page.url, {
      page: { title: page.title, text: "" },
      summary: { title: page.title, summary: "", excerpt: "" },
    });
    const { clipping } = await fixture.service.saveClipping(userId, {
      url: page.url,
      note: page.note,
      source: "web",
    });
    await fixture.service.enrichClipping(clipping.id);
    // A minute apart, so newest first is well defined.
    fixture.advanceClock(60_000);
    return clipping.id;
  }

  const titles = (hits: SearchHit[]) => hits.map((hit) => hit.clipping.title);

  it("finds a clipping that means what the query asks, with no word in common", async () => {
    const ana = await fixture.createUser("ana");
    await clip(ana, { url: "https://example.com/a", title: "Sedan maintenance checklist" });
    await clip(ana, { url: "https://example.com/b", title: "Sourdough at home" });

    const { items } = await fixture.service.searchClippings(ana, { q: "automobile" });

    expect(titles(items)).toEqual(["Sedan maintenance checklist"]);
    expect(items[0]?.highlights).toEqual({
      title: [{ text: "Sedan maintenance checklist", match: false }],
      snippet: null,
    });
  });

  it("ranks a clipping that matches on words and meaning above one that matches on either", async () => {
    const ana = await fixture.createUser("ana");
    // Saved first, so each ranking alone would put it last among its ties.
    await clip(ana, { url: "https://example.com/both", title: "Sedan reviews" });
    // A sedan chair isn't a car: the word matches, the meaning doesn't.
    fixture.meanings.delete("sedan");
    await clip(ana, { url: "https://example.com/words", title: "Sedan chair history" });
    fixture.meanings.set("sedan", "car");
    await clip(ana, { url: "https://example.com/meaning", title: "Automobile insurance" });

    const { items } = await fixture.service.searchClippings(ana, { q: "sedan" });

    // The two single matches tie, and the one whose words matched comes first.
    expect(titles(items)).toEqual(["Sedan reviews", "Sedan chair history", "Automobile insurance"]);
  });

  it("still finds clippings without an embedding by their words", async () => {
    const ana = await fixture.createUser("ana");
    const { clipping: pending } = await fixture.service.saveClipping(ana, {
      url: "https://example.com/pending",
      note: "sourdough to read",
      source: "web",
    });
    fixture.advanceClock(60_000);
    const { clipping: failed } = await fixture.service.saveClipping(ana, {
      url: "https://example.com/failed",
      note: "sourdough recipe",
      source: "web",
    });
    await fixture.service.enrichClipping(failed.id, { lastAttempt: true });
    fixture.advanceClock(60_000);
    await clip(ana, { url: "https://example.com/ready", title: "Sourdough at home" });

    const { items } = await fixture.service.searchClippings(ana, { q: "sourdough" });

    expect(items.map((hit) => [hit.clipping.id, hit.clipping.status])).toEqual(
      expect.arrayContaining([
        [pending.id, "pending"],
        [failed.id, "failed"],
      ]),
    );
    expect(items).toHaveLength(3);
  });

  it("searches by words alone while the query can't be embedded", async () => {
    const ana = await fixture.createUser("ana");
    await clip(ana, { url: "https://example.com/a", title: "Sedan reviews" });
    await clip(ana, { url: "https://example.com/b", title: "Automobile insurance" });
    fixture.setEmbedding("down");

    const { items } = await fixture.service.searchClippings(ana, { q: "sedan" });

    expect(titles(items)).toEqual(["Sedan reviews"]);
  });

  it("keeps a reading that couldn't be embedded, without asking for the page again", async () => {
    const ana = await fixture.createUser("ana");
    fixture.web.set("https://example.com/a", {
      page: { title: "Loaf", text: "" },
      summary: { title: "Rye loaf", summary: "A dense bread.", excerpt: "" },
    });
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: "https://example.com/a",
      source: "web",
    });
    fixture.setEmbedding("down");

    const outcome = await fixture.service.enrichClipping(clipping.id);
    fixture.setEmbedding("up");

    expect(outcome).toBe("ready");
    const byWords = await fixture.service.searchClippings(ana, { q: "rye" });
    const byMeaning = await fixture.service.searchClippings(ana, { q: "sourdough" });
    expect(titles(byWords.items)).toEqual(["Rye loaf"]);
    expect(byMeaning.items).toEqual([]);
  });

  it("embeds the clippings that have none, so they can be found by meaning", async () => {
    const ana = await fixture.createUser("ana");
    fixture.setEmbedding("down");
    await clip(ana, { url: "https://example.com/a", title: "Rye loaf" });
    const deleted = await clip(ana, { url: "https://example.com/b", title: "Sourdough" });
    await fixture.service.deleteClipping(ana, deleted);
    fixture.setEmbedding("up");

    const embedded = await fixture.service.embedMissing();
    const again = await fixture.service.embedMissing();

    expect(embedded).toBe(1);
    expect(again).toBe(0);
    const { items } = await fixture.service.searchClippings(ana, { q: "bread" });
    expect(titles(items)).toEqual(["Rye loaf"]);
  });

  it("embeds what the page is, as a document, and the query as a query", async () => {
    const ana = await fixture.createUser("ana");
    fixture.web.set("https://example.com/a", {
      page: { title: "Loaf", text: "" },
      summary: { title: "Rye loaf", summary: "A dense bread.", excerpt: "Rye and salt." },
    });
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: "https://example.com/a",
      note: "my private note",
      source: "web",
    });
    await fixture.service.enrichClipping(clipping.id);
    await fixture.service.searchClippings(ana, { q: "bread" });

    expect(fixture.embedded).toEqual([
      { text: "Rye loaf\n\nA dense bread.\n\nRye and salt.", purpose: "document" },
      { text: "bread", purpose: "query" },
    ]);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("related clippings", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
    for (const word of ["car", "automobile", "sedan", "engine"]) fixture.meanings.set(word, "car");
    fixture.meanings.set("tyres", "tyre");
    fixture.meanings.set("bread", "bread");
  });

  afterEach(async () => {
    await fixture.close();
  });

  async function clip(userId: string, url: string, title: string) {
    fixture.web.set(url, {
      page: { title, text: "" },
      summary: { title, summary: "", excerpt: "" },
    });
    const { clipping } = await fixture.service.saveClipping(userId, { url, source: "web" });
    await fixture.service.enrichClipping(clipping.id);
    fixture.advanceClock(60_000);
    return clipping.id;
  }

  it("lists the user's clippings nearest in meaning, nearest first", async () => {
    const ana = await fixture.createUser("ana");
    const sedan = await clip(ana, "https://example.com/sedan", "Sedan reviews");
    await clip(ana, "https://example.com/bread", "Bread");
    await clip(ana, "https://example.com/tyres", "Automobile tyres");
    await clip(ana, "https://example.com/engine", "Engine");

    const related = await fixture.service.relatedClippings(ana, sedan);

    // "Engine" means only a car; "Automobile tyres" means a car and tyres, so it is farther.
    expect(related.map((clipping) => clipping.title)).toEqual(["Engine", "Automobile tyres"]);
  });

  it("leaves out the clipping itself, deleted clippings and other users' clippings", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    const sedan = await clip(ana, "https://example.com/sedan", "Sedan reviews");
    const deleted = await clip(ana, "https://example.com/car", "Car care");
    await fixture.service.deleteClipping(ana, deleted);
    await clip(ben, "https://example.com/engine", "Engine");
    const kept = await clip(ana, "https://example.com/automobile", "Automobile");

    const related = await fixture.service.relatedClippings(ana, sedan);

    expect(related.map((clipping) => clipping.id)).toEqual([kept]);
  });

  it("finds nothing for a clipping without an embedding, or one the user doesn't have", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    await clip(ana, "https://example.com/car", "Car care");
    const { clipping: pending } = await fixture.service.saveClipping(ana, {
      url: "https://example.com/sedan",
      source: "web",
    });
    const bens = await clip(ben, "https://example.com/engine", "Engine");

    expect(await fixture.service.relatedClippings(ana, pending.id)).toEqual([]);
    expect(await fixture.service.relatedClippings(ana, bens)).toEqual([]);
    expect(await fixture.service.relatedClippings(ana, "not-a-uuid")).toEqual([]);
  });
});
