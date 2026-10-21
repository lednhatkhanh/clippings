import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";

describe.skipIf(!TEST_DATABASE_URL)("tag suggestions", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
    fixture.meanings.set("car", "car");
    fixture.meanings.set("bread", "bread");
  });

  afterEach(async () => {
    await fixture.close();
  });

  /** Saves a page, tells the fake model what to suggest for it, and reads it. */
  async function clip(
    userId: string,
    url: string,
    {
      title = url,
      suggested,
      tags,
    }: { title?: string; suggested?: string[]; tags?: string[] } = {},
  ) {
    fixture.web.set(url, {
      page: { title, text: "" },
      summary: { title, summary: "", excerpt: "", suggestedTags: suggested },
    });
    const { clipping } = await fixture.service.saveClipping(userId, { url, tags, source: "web" });
    await fixture.service.enrichClipping(clipping.id);
    fixture.advanceClock(60_000);
    return clipping.id;
  }

  /** Reads the page again, as the user asking for it would. */
  async function readAgain(userId: string, id: string) {
    await fixture.service.reEnrichClipping(userId, id);
    await fixture.service.enrichClipping(id);
  }

  const suggestedFor = async (userId: string, id: string) =>
    (await fixture.service.getClipping(userId, id))?.suggestedTags;
  const tagNamesOf = async (userId: string, id: string) =>
    (await fixture.service.getClipping(userId, id))?.tags.map((tag) => tag.name);

  describe("with the setting off", () => {
    it("is off by default, sends no tag names to the model and stores and returns nothing", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.service.saveClipping(ana, {
        url: "https://example.com/other",
        tags: ["css"],
        source: "web",
      });

      const id = await clip(ana, "https://example.com/a", { suggested: ["css", "layout"] });

      expect(await fixture.settings.getSuggestTags(ana)).toBe(false);
      expect(fixture.summarizedWithTags).toEqual([undefined]);
      expect(await suggestedFor(ana, id)).toEqual([]);
      const { rows } = await fixture.pool.query("select 1 from clipping_tag_suggestions");
      expect(rows).toEqual([]);
    });

    it("hides stored suggestions when the user turns the setting off, and brings them back when it is on again", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.setSuggestTags(ana, true);
      const id = await clip(ana, "https://example.com/a", { suggested: ["css"] });

      await fixture.settings.setSuggestTags(ana, false);
      expect(await suggestedFor(ana, id)).toEqual([]);

      await fixture.settings.setSuggestTags(ana, true);
      expect(await suggestedFor(ana, id)).toEqual(["css"]);
    });
  });

  describe("with the setting on", () => {
    it("gives the model the user's most-used tag names, up to 50, and none when they have no tags", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.setSuggestTags(ana, true);
      await clip(ana, "https://example.com/first");
      expect(fixture.summarizedWithTags).toEqual([[]]);

      for (let page = 0; page < 3; page++) {
        const own = Array.from(
          { length: 19 },
          (_, n) => `tag ${page}-${String(n).padStart(2, "0")}`,
        );
        await clip(ana, `https://example.com/p${page}`, { tags: ["popular", ...own] });
      }
      fixture.summarizedWithTags.length = 0;
      await clip(ana, "https://example.com/last");

      const [userTags] = fixture.summarizedWithTags;
      expect(userTags).toHaveLength(50);
      expect(userTags?.[0]).toBe("popular");
    });

    it("stores what the model suggests without ever tagging the clipping, and only the detail read shows it", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.setSuggestTags(ana, true);

      const id = await clip(ana, "https://example.com/a", { suggested: ["css", "layout"] });

      expect(await suggestedFor(ana, id)).toEqual(["css", "layout"]);
      expect(await tagNamesOf(ana, id)).toEqual([]);
      const { items } = await fixture.service.listClippings(ana, {});
      expect(items[0]?.suggestedTags).toEqual([]);
      expect(await fixture.service.listTags(ana)).toEqual([]);
    });

    it("does not store a name the clipping already carries, ignoring case, and stops showing one the user adds", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.setSuggestTags(ana, true);

      const id = await clip(ana, "https://example.com/a", {
        tags: ["CSS"],
        suggested: ["css", "layout", "grid"],
      });
      expect(await suggestedFor(ana, id)).toEqual(["grid", "layout"]);

      await fixture.service.updateClipping(ana, id, { tags: ["CSS", "Grid"] });
      expect(await suggestedFor(ana, id)).toEqual(["layout"]);
    });

    it("accepting adds the tag under the user's own spelling and removes only that suggestion", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.setSuggestTags(ana, true);
      await clip(ana, "https://example.com/other", { tags: ["css"] });
      const id = await clip(ana, "https://example.com/a", {
        tags: ["web"],
        suggested: ["CSS", "layout"],
      });

      const accepted = await fixture.service.acceptTagSuggestion(ana, id, "css");

      expect(accepted?.tags.map((tag) => tag.name)).toEqual(["css", "web"]);
      expect(accepted?.suggestedTags).toEqual(["layout"]);
      // One "css" tag, not two.
      expect((await fixture.service.listTags(ana)).map((tag) => tag.name)).toEqual(["css", "web"]);
    });

    it("accepting a name that isn't a suggestion changes nothing", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.setSuggestTags(ana, true);
      const id = await clip(ana, "https://example.com/a", { suggested: ["css"] });

      const result = await fixture.service.acceptTagSuggestion(ana, id, "unrelated");

      expect(result?.tags).toEqual([]);
      expect(await fixture.service.listTags(ana)).toEqual([]);
      expect(await fixture.service.acceptTagSuggestion(ana, "not-an-id", "css")).toBeNull();
    });

    it("dismisses one suggestion or all, and a dismissed name stays gone after the page is read again", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.setSuggestTags(ana, true);
      const id = await clip(ana, "https://example.com/a", { suggested: ["css", "layout", "grid"] });

      expect(await fixture.service.dismissTagSuggestions(ana, id, ["CSS"])).toBe(true);
      expect(await suggestedFor(ana, id)).toEqual(["grid", "layout"]);

      fixture.web.set("https://example.com/a", {
        page: { title: "a", text: "" },
        summary: {
          title: "a",
          summary: "",
          excerpt: "",
          suggestedTags: ["css", "layout", "flexbox"],
        },
      });
      await readAgain(ana, id);
      expect(await suggestedFor(ana, id)).toEqual(["flexbox", "layout"]);

      expect(await fixture.service.dismissTagSuggestions(ana, id)).toBe(true);
      expect(await suggestedFor(ana, id)).toEqual([]);
      await readAgain(ana, id);
      expect(await suggestedFor(ana, id)).toEqual([]);
    });

    it("a read replaces undismissed model suggestions: an empty answer clears them, a missing one keeps them, and tags are never touched", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.setSuggestTags(ana, true);
      const id = await clip(ana, "https://example.com/a", { suggested: ["css"], tags: ["mine"] });
      const reply = (suggestedTags: string[] | undefined) =>
        fixture.web.set("https://example.com/a", {
          page: { title: "a", text: "" },
          summary: { title: "a", summary: "", excerpt: "", suggestedTags },
        });

      reply(undefined);
      await readAgain(ana, id);
      expect(await suggestedFor(ana, id)).toEqual(["css"]);

      reply(["grid"]);
      await readAgain(ana, id);
      expect(await suggestedFor(ana, id)).toEqual(["grid"]);

      reply([]);
      await readAgain(ana, id);
      expect(await suggestedFor(ana, id)).toEqual([]);
      expect(await tagNamesOf(ana, id)).toEqual(["mine"]);
    });

    it("a clipping saved again after a delete starts over, dismissed names included", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.setSuggestTags(ana, true);
      const id = await clip(ana, "https://example.com/a", { suggested: ["css", "grid"] });
      await fixture.service.dismissTagSuggestions(ana, id, ["css"]);
      await fixture.service.deleteClipping(ana, id);

      await clip(ana, "https://example.com/a", { suggested: ["css"] });

      expect(await suggestedFor(ana, id)).toEqual(["css"]);
    });

    it("leaves a clipping ready when the model said nothing about tags", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.setSuggestTags(ana, true);

      const id = await clip(ana, "https://example.com/a");

      expect((await fixture.service.getClipping(ana, id))?.status).toBe("ready");
      expect(await suggestedFor(ana, id)).toEqual([]);
    });
  });

  describe("neighbour votes", () => {
    /** A clipping whose reading is these words, so its meaning is theirs. */
    async function neighbour(userId: string, name: string, words: string, tags: string[] = []) {
      return clip(userId, `https://example.com/${name}`, { title: words, tags });
    }

    it("suggests a tag that at least two of the five nearest clippings carry", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.setSuggestTags(ana, true);
      // Nearest first: two identical in meaning, two a little off, then farther and farther.
      await neighbour(ana, "n1", "car", ["votes", "once"]);
      await neighbour(ana, "n2", "car", ["votes"]);
      await neighbour(ana, "n3", "car car bread");
      await neighbour(ana, "n4", "car car bread");
      await neighbour(ana, "n5", "car bread", ["sixth"]);
      // The sixth nearest does not vote, and nor does one too far in meaning to count.
      await neighbour(ana, "n6", "car bread bread", ["sixth"]);
      await neighbour(ana, "far", "bread", ["votes"]);

      const id = await neighbour(ana, "target", "car");

      expect(await suggestedFor(ana, id)).toEqual(["votes"]);
      expect(await tagNamesOf(ana, id)).toEqual([]);
    });

    it("stores a name both the model and the votes suggest once, and replaces old votes on a read", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.setSuggestTags(ana, true);
      const first = await neighbour(ana, "n1", "car", ["votes", "extra"]);
      const second = await neighbour(ana, "n2", "car", ["votes", "extra"]);
      fixture.web.set("https://example.com/target", {
        page: { title: "car", text: "" },
        summary: { title: "car", summary: "", excerpt: "", suggestedTags: ["votes"] },
      });
      const { clipping } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/target",
        source: "web",
      });
      await fixture.service.enrichClipping(clipping.id);

      expect(await suggestedFor(ana, clipping.id)).toEqual(["votes", "extra"]);
      const { rows } = await fixture.pool.query(
        "select name, origin from clipping_tag_suggestions order by name",
      );
      expect(rows).toEqual([
        { name: "extra", origin: "neighbours" },
        { name: "votes", origin: "model" },
      ]);

      // The neighbours lose the tag; a read drops the votes that no longer hold.
      await fixture.service.updateClipping(ana, first, { tags: ["votes"] });
      await fixture.service.updateClipping(ana, second, { tags: [] });
      await readAgain(ana, clipping.id);
      expect(await suggestedFor(ana, clipping.id)).toEqual(["votes"]);
    });

    it("counts only the user's own live clippings and needs the setting on", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await fixture.settings.setSuggestTags(ana, true);
      await neighbour(ben, "b1", "car", ["bens"]);
      await neighbour(ben, "b2", "car", ["bens"]);
      const gone1 = await neighbour(ana, "g1", "car", ["gone"]);
      const gone2 = await neighbour(ana, "g2", "car", ["gone"]);
      await fixture.service.deleteClipping(ana, gone1);
      await fixture.service.deleteClipping(ana, gone2);

      const anas = await neighbour(ana, "target", "car");
      const bens = await neighbour(ben, "target-b", "car");

      expect(await suggestedFor(ana, anas)).toEqual([]);
      // Ben's setting is off: nothing stored, though his own clippings would vote.
      expect(await suggestedFor(ben, bens)).toEqual([]);
      const { rows } = await fixture.pool.query("select 1 from clipping_tag_suggestions");
      expect(rows).toEqual([]);
    });
  });

  it("keeps users apart: B can't accept, dismiss or see A's suggestions, and their settings are separate", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    await fixture.settings.setSuggestTags(ana, true);
    const id = await clip(ana, "https://example.com/a", { suggested: ["css"] });

    expect(await fixture.service.acceptTagSuggestion(ben, id, "css")).toBeNull();
    expect(await fixture.service.dismissTagSuggestions(ben, id)).toBe(false);

    expect(await suggestedFor(ana, id)).toEqual(["css"]);
    expect(await tagNamesOf(ana, id)).toEqual([]);
    expect(await fixture.settings.getSuggestTags(ben)).toBe(false);
    expect(await fixture.service.listTags(ben)).toEqual([]);
  });

  it("removes suggestions with the clipping and with the user", async () => {
    const ana = await fixture.createUser("ana");
    await fixture.settings.setSuggestTags(ana, true);
    await clip(ana, "https://example.com/a", { suggested: ["css"] });

    await fixture.service.deleteClipping(
      ana,
      (await fixture.service.listClippings(ana, {})).items[0]!.id,
    );
    fixture.advanceClock(25 * 60 * 60 * 1000);
    await fixture.service.purgeDeleted();

    const { rows } = await fixture.pool.query("select 1 from clipping_tag_suggestions");
    expect(rows).toEqual([]);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("the tag suggestions setting", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  it("is off until turned on, and turning it on keeps the appearance defaults", async () => {
    const ana = await fixture.createUser("ana");
    const before = await fixture.settings.getSettings(ana);

    expect(await fixture.settings.getSuggestTags(ana)).toBe(false);
    expect(await fixture.settings.setSuggestTags(ana, true)).toBe(true);

    expect(await fixture.settings.getSuggestTags(ana)).toBe(true);
    expect(await fixture.settings.getSettings(ana)).toEqual(before);
    expect(await fixture.settings.setSuggestTags(ana, false)).toBe(false);
  });

  it("survives an appearance change, and keeps users apart", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    await fixture.settings.setSuggestTags(ana, true);

    await fixture.settings.updateSettings(ana, { theme: "dark" });

    expect(await fixture.settings.getSuggestTags(ana)).toBe(true);
    expect(await fixture.settings.getSuggestTags(ben)).toBe(false);
    await fixture.settings.setSuggestTags(ben, true);
    await fixture.settings.setSuggestTags(ben, false);
    expect(await fixture.settings.getSuggestTags(ana)).toBe(true);
  });
});
