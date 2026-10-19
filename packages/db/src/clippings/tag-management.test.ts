import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_TAG_LENGTH } from "@clippings/shared";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";
import { InvalidTagColorError, InvalidTagsError, TagNameTakenError } from "./service.ts";

describe.skipIf(!TEST_DATABASE_URL)("managing tags", () => {
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

  /** Each of the user's tags as `name: count`. */
  async function counts(userId: string) {
    const summaries = await fixture.service.listTagSummaries(userId);
    return summaries.map((tag) => `${tag.name}: ${tag.clippingCount}`);
  }

  it("lists each tag with how many of the user's clippings carry it, deleted ones left out", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    await clip(ana, "https://example.com/a", ["work", "reading"]);
    await clip(ana, "https://example.com/b", ["Work"]);
    const gone = await clip(ana, "https://example.com/c", ["work", "later"]);
    await clip(bob, "https://example.com/d", ["work"]);
    await fixture.service.deleteClipping(ana, gone.id);

    expect(await counts(ana)).toEqual(["later: 0", "reading: 1", "work: 2"]);
    expect(await counts(bob)).toEqual(["work: 1"]);
  });

  /** The user's tag with this name. */
  async function tagNamed(userId: string, name: string) {
    const tag = (await fixture.service.listTags(userId)).find((each) => each.name === name);
    if (!tag) throw new Error(`No tag named ${name}`);
    return tag;
  }

  const names = (clipping: { tags: { name: string }[] } | null) =>
    clipping?.tags.map((tag) => tag.name);

  it("renames a tag on every clipping that carries it, and in the tag filter", async () => {
    const ana = await fixture.createUser("ana");
    const first = await clip(ana, "https://example.com/a", ["work", "reading"]);
    const second = await clip(ana, "https://example.com/b", ["work"]);
    const work = await tagNamed(ana, "work");

    const renamed = await fixture.service.renameTag(ana, work.id, "  day   job ");

    expect(renamed).toEqual({ ...work, name: "day job" });
    expect(names(await fixture.service.getClipping(ana, first.id))).toEqual(["day job", "reading"]);
    expect(names(await fixture.service.getClipping(ana, second.id))).toEqual(["day job"]);
    const filtered = await fixture.service.listClippings(ana, { tags: ["Day Job"] });
    expect(filtered.items.map((clipping) => clipping.id)).toEqual([second.id, first.id]);
    // A change of case alone is the same tag, so it is not taken.
    expect(await fixture.service.renameTag(ana, work.id, "Day Job")).toMatchObject({
      name: "Day Job",
    });
  });

  it("rejects a rename to a name the user already has, ignoring case, or to no name", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    await clip(ana, "https://example.com/a", ["work", "reading"]);
    await clip(bob, "https://example.com/b", ["home"]);
    const work = await tagNamed(ana, "work");

    await expect(fixture.service.renameTag(ana, work.id, "Reading")).rejects.toThrow(
      TagNameTakenError,
    );
    await expect(fixture.service.renameTag(ana, work.id, "   ")).rejects.toThrow(InvalidTagsError);
    await expect(
      fixture.service.renameTag(ana, work.id, "x".repeat(MAX_TAG_LENGTH + 1)),
    ).rejects.toThrow(InvalidTagsError);
    // Another user's name is free, and another user's tag is out of reach.
    expect(await fixture.service.renameTag(ana, work.id, "home")).toMatchObject({ name: "home" });
    expect(await fixture.service.renameTag(bob, work.id, "mine")).toBeNull();
    expect(await fixture.service.renameTag(ana, "not-a-uuid", "mine")).toBeNull();
    expect((await fixture.service.listTags(ana)).map((tag) => tag.name)).toEqual([
      "home",
      "reading",
    ]);
  });

  it("merges a tag into another: every clipping carries the target once and the source is gone", async () => {
    const ana = await fixture.createUser("ana");
    const onlySource = await clip(ana, "https://example.com/a", ["reading"]);
    const both = await clip(ana, "https://example.com/b", ["reading", "to read"]);
    const onlyTarget = await clip(ana, "https://example.com/c", ["to read", "work"]);
    const reading = await tagNamed(ana, "reading");
    const toRead = await tagNamed(ana, "to read");

    expect(await fixture.service.mergeTag(ana, reading.id, toRead.id)).toBe(true);

    expect(names(await fixture.service.getClipping(ana, onlySource.id))).toEqual(["to read"]);
    expect(names(await fixture.service.getClipping(ana, both.id))).toEqual(["to read"]);
    expect(names(await fixture.service.getClipping(ana, onlyTarget.id))).toEqual([
      "to read",
      "work",
    ]);
    expect(await counts(ana)).toEqual(["to read: 3", "work: 1"]);
  });

  it("merges only two different tags of the same user", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    await clip(ana, "https://example.com/a", ["reading", "work"]);
    await clip(bob, "https://example.com/b", ["home"]);
    const reading = await tagNamed(ana, "reading");
    const home = await tagNamed(bob, "home");

    expect(await fixture.service.mergeTag(ana, reading.id, reading.id)).toBe(false);
    expect(await fixture.service.mergeTag(ana, reading.id, home.id)).toBe(false);
    expect(await fixture.service.mergeTag(bob, home.id, reading.id)).toBe(false);
    expect(await fixture.service.mergeTag(ana, "not-a-uuid", reading.id)).toBe(false);
    expect(await counts(ana)).toEqual(["reading: 1", "work: 1"]);
    expect(await counts(bob)).toEqual(["home: 1"]);
  });

  it("deletes a tag and keeps the clippings that carried it", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    const tagged = await clip(ana, "https://example.com/a", ["reading", "work"]);
    await clip(bob, "https://example.com/b", ["work"]);
    const work = await tagNamed(ana, "work");
    const bobsWork = await tagNamed(bob, "work");

    expect(await fixture.service.deleteTag(bob, work.id)).toBe(false);
    expect(await fixture.service.deleteTag(ana, work.id)).toBe(true);
    expect(await fixture.service.deleteTag(ana, work.id)).toBe(false);

    const kept = await fixture.service.getClipping(ana, tagged.id);
    expect(kept?.url).toBe("https://example.com/a");
    expect(names(kept)).toEqual(["reading"]);
    expect(await counts(ana)).toEqual(["reading: 1"]);
    expect(await fixture.service.listTags(bob)).toEqual([bobsWork]);
  });

  it("sets a tag's color by name and rejects a name it doesn't know", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    const tagged = await clip(ana, "https://example.com/a", ["work"]);
    const work = await tagNamed(ana, "work");
    expect(work.color).toBe("none");

    expect(await fixture.service.setTagColor(ana, work.id, "teal")).toEqual({
      ...work,
      color: "teal",
    });
    expect((await fixture.service.getClipping(ana, tagged.id))?.tags[0]?.color).toBe("teal");
    await expect(fixture.service.setTagColor(ana, work.id, "magenta")).rejects.toThrow(
      InvalidTagColorError,
    );
    expect(await fixture.service.setTagColor(bob, work.id, "red")).toBeNull();
    expect(await fixture.service.setTagColor(ana, work.id, "none")).toMatchObject({
      color: "none",
    });
  });
});
