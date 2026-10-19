import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_TAG_LENGTH, MAX_TAGS_PER_CLIPPING, type ClippingSource } from "@clippings/shared";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";
import { InvalidTagsError } from "./service.ts";

describe.skipIf(!TEST_DATABASE_URL)("tags on clippings", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  /** Saves a page from the web app with these tags, a minute after the previous one. */
  async function clip(userId: string, url: string, tags: string[] = []) {
    const { clipping } = await fixture.service.saveClipping(userId, { url, tags, source: "web" });
    fixture.advanceClock(60_000);
    return clipping;
  }

  const names = (clipping: { tags: { name: string }[] }) => clipping.tags.map((tag) => tag.name);

  it("keeps one tag per name for a user, ignoring case, while another user has their own", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");

    const first = await clip(ana, "https://example.com/a", ["work", "reading"]);
    const second = await clip(ana, "https://example.com/b", ["Work"]);
    const bobs = await clip(bob, "https://example.com/c", ["work"]);

    expect(names(first)).toEqual(["reading", "work"]);
    // "Work" is the tag Ana already has, under the name she first gave it.
    expect(second.tags).toEqual([first.tags.find((tag) => tag.name === "work")]);
    expect(names(bobs)).toEqual(["work"]);
    expect(bobs.tags[0]!.id).not.toBe(second.tags[0]!.id);
    expect(await fixture.service.listTags(ana)).toEqual(first.tags);
    expect(await fixture.service.listTags(bob)).toEqual(bobs.tags);
  });

  it("replaces a clipping's tags on update, creating new ones and keeping the note", async () => {
    const ana = await fixture.createUser("ana");
    const { id } = await clip(ana, "https://example.com/a", ["work", "reading"]);
    await fixture.service.updateClipping(ana, id, { note: "for Monday" });

    const updated = await fixture.service.updateClipping(ana, id, { tags: [" to  read ", "work"] });

    expect(updated && names(updated)).toEqual(["to read", "work"]);
    expect(updated?.note).toBe("for Monday");
    expect((await fixture.service.getClipping(ana, id))?.tags).toEqual(updated?.tags);
    // "reading" is off the clipping but still one of Ana's tags.
    expect((await fixture.service.listTags(ana)).map((tag) => tag.name)).toEqual([
      "reading",
      "to read",
      "work",
    ]);
  });

  it("leaves the tags alone when the same page is saved again, or a field is left out", async () => {
    const ana = await fixture.createUser("ana");
    const { id } = await clip(ana, "https://example.com/a", ["work"]);

    const again = await fixture.service.saveClipping(ana, {
      url: "https://example.com/a",
      tags: ["other"],
      source: "extension",
    });
    await fixture.service.updateClipping(ana, id, { note: "a note" });

    expect(again.status).toBe("existing");
    expect(names(again.clipping)).toEqual(["work"]);
    expect(names((await fixture.service.getClipping(ana, id))!)).toEqual(["work"]);
  });

  it("starts a deleted page's tags over when it is saved again", async () => {
    const ana = await fixture.createUser("ana");
    const { id } = await clip(ana, "https://example.com/a", ["work"]);
    await fixture.service.deleteClipping(ana, id);

    const saved = await fixture.service.saveClipping(ana, {
      url: "https://example.com/a",
      tags: ["home"],
      source: "web",
    });

    expect(saved.status).toBe("created");
    expect(names(saved.clipping)).toEqual(["home"]);
  });

  it("never changes the tags when enrichment reads the page", async () => {
    const ana = await fixture.createUser("ana");
    fixture.web.set("https://example.com/a", {
      page: { title: "A page", text: "Some text" },
      summary: { title: "A page", summary: "About a page.", excerpt: "Some text" },
    });
    const { id, tags } = await clip(ana, "https://example.com/a", ["work"]);

    expect(await fixture.service.enrichClipping(id)).toBe("ready");

    const read = await fixture.service.getClipping(ana, id);
    expect(read?.title).toBe("A page");
    expect(read?.tags).toEqual(tags);
  });

  it("attaches and filters by a name whose letters change length when lowercased", async () => {
    const ana = await fixture.createUser("ana");
    // JavaScript lowercases "İ" to two characters; Postgres doesn't, so only one of them may decide.
    const { id } = await clip(ana, "https://example.com/a", ["home"]);

    const updated = await fixture.service.updateClipping(ana, id, { tags: ["home", "İstanbul"] });

    expect(updated && names(updated)).toEqual(["home", "İstanbul"]);
    expect(
      (await fixture.service.listClippings(ana, { tags: ["İstanbul"] })).items.map((c) => c.id),
    ).toEqual([id]);
  });

  it("saves two clippings at once that create the same new tags in opposite orders", async () => {
    const ana = await fixture.createUser("ana");

    const [first, second] = await Promise.all([
      fixture.service.saveClipping(ana, {
        url: "https://e.com/1",
        tags: ["a", "b", "c"],
        source: "web",
      }),
      fixture.service.saveClipping(ana, {
        url: "https://e.com/2",
        tags: ["c", "b", "a"],
        source: "web",
      }),
    ]);

    expect(names(first.clipping)).toEqual(["a", "b", "c"]);
    expect(names(second.clipping)).toEqual(["a", "b", "c"]);
    expect(await fixture.service.listTags(ana)).toHaveLength(3);
  });

  it("rejects a tag name that is too long, or too many tags", async () => {
    const ana = await fixture.createUser("ana");
    const { id } = await clip(ana, "https://example.com/a");

    await expect(
      fixture.service.updateClipping(ana, id, { tags: ["x".repeat(MAX_TAG_LENGTH + 1)] }),
    ).rejects.toThrow(InvalidTagsError);
    await expect(
      fixture.service.saveClipping(ana, {
        url: "https://example.com/b",
        tags: Array.from({ length: MAX_TAGS_PER_CLIPPING + 1 }, (_, index) => `tag ${index}`),
        source: "web",
      }),
    ).rejects.toThrow(InvalidTagsError);
    expect(await fixture.service.listTags(ana)).toEqual([]);
  });

  it("never lets one user attach, see or filter by another user's tag", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    const anas = await clip(ana, "https://example.com/a", ["secret plans"]);
    const bobs = await clip(bob, "https://example.com/b");

    // Bob can't tag Ana's clipping, and his own "secret plans" is a new tag of his.
    expect(await fixture.service.updateClipping(bob, anas.id, { tags: ["mine"] })).toBeNull();
    const tagged = await fixture.service.updateClipping(bob, bobs.id, { tags: ["secret plans"] });

    expect(tagged?.tags[0]?.id).not.toBe(anas.tags[0]!.id);
    expect((await fixture.service.getClipping(ana, anas.id))?.tags).toEqual(anas.tags);
    expect(await fixture.service.listTags(bob)).toEqual(tagged?.tags);
    expect(
      (await fixture.service.listClippings(bob, { tags: ["secret plans"] })).items.map(
        (clipping) => clipping.id,
      ),
    ).toEqual([bobs.id]);
    expect((await fixture.service.listClippings(ana, { tags: ["mine"] })).items).toEqual([]);
  });

  it("exports each clipping's tags by name", async () => {
    const ana = await fixture.createUser("ana");
    await clip(ana, "https://example.com/a", ["work", "reading"]);

    const { clippings } = await fixture.service.exportClippings(ana);

    expect(clippings.map((clipping) => clipping.tags)).toEqual([["reading", "work"]]);
  });

  describe("filtering by tag", () => {
    /** Saves a page that enrichment has read, so search can find it by its title. */
    async function readClip(
      userId: string,
      page: { url: string; title: string; tags: string[]; source?: ClippingSource },
    ) {
      fixture.web.set(page.url, {
        page: { title: page.title, text: "" },
        summary: { title: page.title, summary: "", excerpt: "" },
      });
      const { clipping } = await fixture.service.saveClipping(userId, {
        url: page.url,
        tags: page.tags,
        source: page.source ?? "web",
      });
      await fixture.service.enrichClipping(clipping.id);
      fixture.advanceClock(60_000);
    }

    async function seed() {
      const ana = await fixture.createUser("ana");
      await readClip(ana, { url: "https://e.com/1", title: "Compost basics", tags: ["garden"] });
      await readClip(ana, {
        url: "https://e.com/2",
        title: "Compost at work",
        tags: ["garden", "work"],
        source: "extension",
      });
      await readClip(ana, { url: "https://e.com/3", title: "Quarterly plan", tags: ["work"] });
      await readClip(ana, { url: "https://e.com/4", title: "Compost myths", tags: [] });
      return ana;
    }

    const listed = async (userId: string, input: { tags?: string[]; sources?: ClippingSource[] }) =>
      (await fixture.service.listClippings(userId, input)).items.map((clipping) => clipping.title);
    const searched = async (
      userId: string,
      input: { q: string; tags?: string[]; sources?: ClippingSource[] },
    ) =>
      (await fixture.service.searchClippings(userId, input)).items.map((hit) => hit.clipping.title);

    it("lists only clippings with every tag asked for, ignoring case", async () => {
      const ana = await seed();

      expect(await listed(ana, { tags: ["garden"] })).toEqual([
        "Compost at work",
        "Compost basics",
      ]);
      expect(await listed(ana, { tags: ["Garden", "WORK"] })).toEqual(["Compost at work"]);
      expect(await listed(ana, { tags: ["nowhere"] })).toEqual([]);
      expect(await listed(ana, { tags: [] })).toHaveLength(4);
    });

    it("combines tags with the source filter", async () => {
      const ana = await seed();

      expect(await listed(ana, { tags: ["garden"], sources: ["web"] })).toEqual(["Compost basics"]);
      expect(await listed(ana, { tags: ["work"], sources: ["extension"] })).toEqual([
        "Compost at work",
      ]);
    });

    it("combines tags with the query and the source filter in search", async () => {
      const ana = await seed();

      expect((await searched(ana, { q: "compost", tags: ["garden"] })).toSorted()).toEqual([
        "Compost at work",
        "Compost basics",
      ]);
      expect(await searched(ana, { q: "compost", tags: ["work"] })).toEqual(["Compost at work"]);
      expect(
        await searched(ana, { q: "compost", tags: ["garden"], sources: ["extension"] }),
      ).toEqual(["Compost at work"]);
      expect(await searched(ana, { q: "plan", tags: ["garden"] })).toEqual([]);
    });
  });
});
