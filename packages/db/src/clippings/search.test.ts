import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ClippingSource, SearchHit } from "@clippings/shared";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";

describe.skipIf(!TEST_DATABASE_URL)("searching clippings", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  /** Saves a page and lets enrichment read it, so it has a title and an excerpt. */
  async function clip(
    userId: string,
    page: { url: string; title: string; note?: string; excerpt?: string; source?: ClippingSource },
  ) {
    fixture.web.set(page.url, {
      page: { title: page.title, text: page.excerpt ?? "" },
      summary: { title: page.title, summary: "", excerpt: page.excerpt ?? "" },
    });
    const { clipping } = await fixture.service.saveClipping(userId, {
      url: page.url,
      note: page.note,
      source: page.source ?? "web",
    });
    await fixture.service.enrichClipping(clipping.id);
    // A minute apart, so newest first is well defined.
    fixture.advanceClock(60_000);
    return clipping.id;
  }

  const titles = (hits: SearchHit[]) => hits.map((hit) => hit.clipping.title);

  it("ranks a title match above a note match above an excerpt match", async () => {
    const ana = await fixture.createUser("ana");
    await clip(ana, {
      url: "https://example.com/excerpt",
      title: "Notes from a walk",
      excerpt: "We passed a compost heap on the way.",
    });
    await clip(ana, {
      url: "https://example.com/title",
      title: "Compost for small gardens",
    });
    await clip(ana, {
      url: "https://example.com/note",
      title: "Weekend reading",
      note: "has a good compost section",
    });
    await clip(ana, { url: "https://example.com/other", title: "Bread baking" });

    const { items } = await fixture.service.searchClippings(ana, { q: "compost" });

    expect(titles(items)).toEqual([
      "Compost for small gardens",
      "Weekend reading",
      "Notes from a walk",
    ]);
  });

  it("combines the source filter with either sort order", async () => {
    const ana = await fixture.createUser("ana");
    await clip(ana, {
      url: "https://a.example/1",
      title: "Soup recipes",
      note: "soup",
      source: "web",
    });
    await clip(ana, { url: "https://a.example/2", title: "Soup", source: "extension" });
    await clip(ana, { url: "https://a.example/3", title: "Bread", note: "soup", source: "mcp" });
    await clip(ana, { url: "https://a.example/4", title: "Soup again", source: "digest" });

    const sources: ClippingSource[] = ["extension", "mcp", "web"];
    const byRelevance = await fixture.service.searchClippings(ana, { q: "soup", sources });
    const byDate = await fixture.service.searchClippings(ana, { q: "soup", sources, sort: "date" });

    // "Soup recipes" matches in its title and note, "Soup" in its title, "Bread" only in its note.
    expect(titles(byRelevance.items)).toEqual(["Soup recipes", "Soup", "Bread"]);
    expect(titles(byDate.items)).toEqual(["Bread", "Soup", "Soup recipes"]);
  });

  it("never returns another user's clippings, nor deleted ones", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    const anas = await clip(ana, { url: "https://example.com/a", title: "Tide tables" });
    await clip(ben, { url: "https://example.com/a", title: "Tide tables" });
    const deleted = await clip(ana, { url: "https://example.com/b", title: "Tide pools" });
    await fixture.service.deleteClipping(ana, deleted);

    const { items } = await fixture.service.searchClippings(ana, { q: "tide" });

    expect(items.map((hit) => hit.clipping.id)).toEqual([anas]);
  });

  it("matches words as written in any language, without stemming or stop words", async () => {
    const ana = await fixture.createUser("ana");
    await clip(ana, { url: "https://example.com/de", title: "Was ist Kunst? Über die Straße" });
    await clip(ana, { url: "https://example.com/en", title: "What is art?" });

    // The English configuration drops "was", "what" and "is" as stop words.
    const german = await fixture.service.searchClippings(ana, { q: "was ist straße" });
    const english = await fixture.service.searchClippings(ana, { q: "what is" });

    expect(titles(german.items)).toEqual(["Was ist Kunst? Über die Straße"]);
    expect(titles(english.items)).toEqual(["What is art?"]);
  });

  it("takes one query that mixes languages as written", async () => {
    const ana = await fixture.createUser("ana");
    await clip(ana, { url: "https://example.com/a", title: "Pricing strategy für Häuser" });

    const { items } = await fixture.service.searchClippings(ana, { q: "häuser pricing" });

    expect(titles(items)).toEqual(["Pricing strategy für Häuser"]);
    expect(items[0]?.highlights.title.filter((segment) => segment.match)).toEqual([
      { text: "Pricing", match: true },
      { text: "Häuser", match: true },
    ]);
  });

  it("doesn't let a title that contains the highlight markers fake a match", async () => {
    const ana = await fixture.createUser("ana");
    await clip(ana, { url: "https://example.com/a", title: "Tea \u0001notes\u0002 and more" });

    const { items } = await fixture.service.searchClippings(ana, { q: "tea" });

    expect(items[0]?.highlights.title).toEqual([
      { text: "Tea", match: true },
      { text: " notes and more", match: false },
    ]);
  });

  it("marks the matched terms in the title and in a snippet of the note or excerpt", async () => {
    const ana = await fixture.createUser("ana");
    await clip(ana, {
      url: "https://example.com/a",
      title: "Sourdough starter guide",
      note: "try the rye starter",
    });
    await clip(ana, {
      url: "https://example.com/b",
      title: "Baking notes",
      excerpt: "Feed the starter twice a day.",
    });

    const { items } = await fixture.service.searchClippings(ana, { q: "starter" });

    expect(items.map((hit) => hit.highlights)).toEqual([
      {
        title: [
          { text: "Sourdough ", match: false },
          { text: "starter", match: true },
          { text: " guide", match: false },
        ],
        snippet: [
          { text: "try the rye ", match: false },
          { text: "starter", match: true },
        ],
      },
      {
        title: [{ text: "Baking notes", match: false }],
        snippet: [
          { text: "Feed the ", match: false },
          { text: "starter", match: true },
          { text: " twice a day.", match: false },
        ],
      },
    ]);
  });

  it("matches the last word as a prefix while it is being typed", async () => {
    const ana = await fixture.createUser("ana");
    await clip(ana, { url: "https://example.com/a", title: "Gardening for beginners" });

    const { items } = await fixture.service.searchClippings(ana, { q: "beginners gard" });

    expect(items[0]?.highlights.title).toEqual([
      { text: "Gardening", match: true },
      { text: " for ", match: false },
      { text: "beginners", match: true },
    ]);
  });

  it("finds a title one typo away, after the exact matches", async () => {
    const ana = await fixture.createUser("ana");
    await clip(ana, { url: "https://example.com/a", title: "Gardening for beginners" });
    await clip(ana, { url: "https://example.com/b", title: "Notes", note: "gardnening" });

    const { items } = await fixture.service.searchClippings(ana, { q: "gardnening" });

    expect(titles(items)).toEqual(["Notes", "Gardening for beginners"]);
  });

  it("needs every word of a typo match in the title", async () => {
    const ana = await fixture.createUser("ana");
    await clip(ana, { url: "https://example.com/a", title: "Gardening for beginners" });

    const oneWordOff = await fixture.service.searchClippings(ana, { q: "gardnening beginners" });
    const unrelated = await fixture.service.searchClippings(ana, { q: "gardening xyzzy" });

    expect(titles(oneWordOff.items)).toEqual(["Gardening for beginners"]);
    expect(unrelated.items).toEqual([]);
  });

  it("with words: any, finds a clipping by one word of a question, ranking more words higher", async () => {
    const ana = await fixture.createUser("ana");
    await clip(ana, {
      url: "https://example.com/a",
      title: "Notes",
      note: "turn the compost weekly",
    });
    await clip(ana, {
      url: "https://example.com/b",
      title: "Notes",
      note: "compost bins, reviewed",
    });
    await clip(ana, { url: "https://example.com/c", title: "Bread baking" });
    // The keyword half alone: the question can't be embedded.
    fixture.setEmbedding("down");
    const question = "how often do I turn the compost";

    const all = await fixture.service.searchClippings(ana, { q: question });
    const any = await fixture.service.searchClippings(ana, { q: question, words: "any" });

    expect(all.items).toEqual([]);
    // Both compost notes match; the one with more of the question's words comes first.
    expect(any.items.map((hit) => hit.clipping.note)).toEqual([
      "turn the compost weekly",
      "compost bins, reviewed",
    ]);
  });

  it("finds nothing for a blank query, and takes web-search syntax", async () => {
    const ana = await fixture.createUser("ana");
    await clip(ana, { url: "https://example.com/a", title: "Cold brew coffee" });
    await clip(ana, { url: "https://example.com/b", title: "Coffee shops in Hanoi" });

    const blank = await fixture.service.searchClippings(ana, { q: "   " });
    const without = await fixture.service.searchClippings(ana, { q: "coffee -hanoi" });
    const phrase = await fixture.service.searchClippings(ana, { q: '"brew coffee"' });

    expect(blank.items).toEqual([]);
    expect(titles(without.items)).toEqual(["Cold brew coffee"]);
    expect(titles(phrase.items)).toEqual(["Cold brew coffee"]);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("listing clippings by source", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  it("lists only the chosen sources, newest first, across pages", async () => {
    const ana = await fixture.createUser("ana");
    const ids: Record<string, string> = {};
    for (const [name, source] of [
      ["a", "web"],
      ["b", "mcp"],
      ["c", "extension"],
      ["d", "mcp"],
      ["e", "web"],
    ] as const) {
      const { clipping } = await fixture.service.saveClipping(ana, {
        url: `https://example.com/${name}`,
        source,
      });
      ids[name] = clipping.id;
      fixture.advanceClock(1000);
    }

    const first = await fixture.service.listClippings(ana, { sources: ["web", "mcp"], limit: 2 });
    const second = await fixture.service.listClippings(ana, {
      sources: ["web", "mcp"],
      limit: 2,
      cursor: first.nextCursor!,
    });

    expect(first.items.map((clipping) => clipping.id)).toEqual([ids.e, ids.d]);
    expect(second.items.map((clipping) => clipping.id)).toEqual([ids.b, ids.a]);
    expect(second.nextCursor).toBeNull();
  });
});
