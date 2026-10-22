import { parseISO } from "date-fns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_TAG_LENGTH, MAX_TAGS_PER_CLIPPING } from "@clippings/shared";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";
import { InvalidTagsError, MAX_BULK_CLIPPINGS, TooManyClippingsError } from "./service.ts";

describe.skipIf(!TEST_DATABASE_URL)("tagging many clippings at once", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  /** Saves a page from the web app with these tags, a minute after the previous one. */
  async function clip(userId: string, name: string, tags: string[] = []) {
    const { clipping } = await fixture.service.saveClipping(userId, {
      url: `https://example.com/${name}`,
      tags,
      source: "web",
    });
    fixture.advanceClock(60_000);
    return clipping;
  }

  /** The names of the tags on a clipping, sorted. */
  async function tagsOf(userId: string, id: string) {
    const clipping = await fixture.service.getClipping(userId, id);
    return clipping?.tags.map((tag) => tag.name).toSorted();
  }

  it("adds and removes tags on every clipping and keeps each one's other tags", async () => {
    const ana = await fixture.createUser("ana");
    const a = await clip(ana, "a", ["keep a", "old"]);
    const b = await clip(ana, "b", ["old", "old too"]);
    const c = await clip(ana, "c");

    const outcome = await fixture.service.tagClippings(ana, [a.id, b.id, c.id], {
      add: ["new"],
      remove: ["Old"],
    });

    expect(outcome).toEqual({ changed: 3, notFound: [] });
    expect(await tagsOf(ana, a.id)).toEqual(["keep a", "new"]);
    expect(await tagsOf(ana, b.id)).toEqual(["new", "old too"]);
    expect(await tagsOf(ana, c.id)).toEqual(["new"]);
  });

  it("counts only the clippings that changed, so a repeat changes nothing", async () => {
    const ana = await fixture.createUser("ana");
    const a = await clip(ana, "a", ["x"]);
    const b = await clip(ana, "b");

    const first = await fixture.service.tagClippings(ana, [a.id, b.id], { add: ["X"] });
    expect(first.changed).toBe(1);
    expect(await tagsOf(ana, a.id)).toEqual(["x"]);

    const again = await fixture.service.tagClippings(ana, [a.id, b.id], { add: ["x"] });
    expect(again.changed).toBe(0);
    const gone = await fixture.service.tagClippings(ana, [a.id, b.id], { remove: ["nothing"] });
    expect(gone.changed).toBe(0);
  });

  it("matches names ignoring case, keeping the spelling a tag was created with", async () => {
    const ana = await fixture.createUser("ana");
    const a = await clip(ana, "a", ["Reading"]);
    const b = await clip(ana, "b");

    await fixture.service.tagClippings(ana, [b.id], { add: ["reading"] });
    expect(await tagsOf(ana, b.id)).toEqual(["Reading"]);
    expect((await fixture.service.listTags(ana)).map((tag) => tag.name)).toEqual(["Reading"]);

    await fixture.service.tagClippings(ana, [a.id], { remove: ["READING"] });
    expect(await tagsOf(ana, a.id)).toEqual([]);
  });

  it("reports ids that aren't the user's clippings and touches nothing of another user's", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    const mine = await clip(ana, "mine");
    const theirs = await clip(bob, "theirs", ["private"]);
    const deleted = await clip(ana, "deleted");
    await fixture.service.deleteClipping(ana, deleted.id);
    const missing = "00000000-0000-4000-8000-000000000000";

    const outcome = await fixture.service.tagClippings(
      ana,
      [mine.id, theirs.id, deleted.id, missing, "not-an-id", mine.id],
      { add: ["shared"], remove: ["private"] },
    );

    expect(outcome).toEqual({
      changed: 1,
      notFound: [theirs.id, deleted.id, missing, "not-an-id"],
    });
    expect(await tagsOf(ana, mine.id)).toEqual(["shared"]);
    expect(await tagsOf(bob, theirs.id)).toEqual(["private"]);
    expect((await fixture.service.listTags(bob)).map((tag) => tag.name)).toEqual(["private"]);
    // Bob's clipping keeps its tag even though Ana named one of the same name.
    expect(await fixture.service.tagClippings(ana, [theirs.id], { add: ["x"] })).toEqual({
      changed: 0,
      notFound: [theirs.id],
    });
    expect((await fixture.service.listTags(ana)).map((tag) => tag.name)).toEqual(["shared"]);
  });

  it("changes nothing when one clipping would end up with too many tags", async () => {
    const ana = await fixture.createUser("ana");
    const full = await clip(
      ana,
      "full",
      Array.from({ length: MAX_TAGS_PER_CLIPPING }, (_, index) => `tag ${index}`),
    );
    const roomy = await clip(ana, "roomy");

    await expect(
      fixture.service.tagClippings(ana, [roomy.id, full.id], { add: ["one more"] }),
    ).rejects.toBeInstanceOf(InvalidTagsError);

    expect(await tagsOf(ana, roomy.id)).toEqual([]);
    expect((await tagsOf(ana, full.id))?.length).toBe(MAX_TAGS_PER_CLIPPING);
    expect((await fixture.service.listTags(ana)).some((tag) => tag.name === "one more")).toBe(
      false,
    );

    // Removing in the same call makes room.
    const ok = await fixture.service.tagClippings(ana, [full.id], {
      add: ["one more"],
      remove: ["tag 0"],
    });
    expect(ok.changed).toBe(1);
  });

  it("refuses a tag name that is too long, one both added and removed, and too many ids", async () => {
    const ana = await fixture.createUser("ana");
    const a = await clip(ana, "a");

    await expect(
      fixture.service.tagClippings(ana, [a.id], { add: ["x".repeat(MAX_TAG_LENGTH + 1)] }),
    ).rejects.toBeInstanceOf(InvalidTagsError);
    await expect(
      fixture.service.tagClippings(ana, [a.id], { add: ["Same"], remove: ["same"] }),
    ).rejects.toBeInstanceOf(InvalidTagsError);
    const ids = Array.from({ length: MAX_BULK_CLIPPINGS + 1 }, (_, index) => `id-${index}`);
    await expect(fixture.service.tagClippings(ana, ids, { add: ["x"] })).rejects.toBeInstanceOf(
      TooManyClippingsError,
    );
    expect(await tagsOf(ana, a.id)).toEqual([]);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("listing saved clippings", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  /** Saves a page a minute after the previous one; returns it with the time it was saved. */
  async function clip(userId: string, name: string, tags?: string[]) {
    const { clipping } = await fixture.service.saveClipping(userId, {
      url: `https://example.com/${name}`,
      tags,
      source: "web",
    });
    fixture.advanceClock(60_000);
    return clipping;
  }

  const names = (clippings: { url: string }[]) =>
    clippings.map((clipping) => clipping.url.replace("https://example.com/", ""));

  it("lists everything newest first with pinned clippings among the rest, and pages without gaps", async () => {
    const ana = await fixture.createUser("ana");
    const old = await clip(ana, "old");
    for (const name of ["1", "2", "3", "4"]) await clip(ana, name);
    await fixture.service.setPinned(ana, old.id, true);

    const first = await fixture.service.listSavedClippings(ana, { limit: 2 });
    expect(names(first.items)).toEqual(["4", "3"]);
    const second = await fixture.service.listSavedClippings(ana, {
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(names(second.items)).toEqual(["2", "1"]);
    const third = await fixture.service.listSavedClippings(ana, {
      limit: 2,
      cursor: second.nextCursor!,
    });
    expect(names(third.items)).toEqual(["old"]);
    expect(third.nextCursor).toBeNull();
  });

  it("filters by pinned: only pinned, only unpinned, or both", async () => {
    const ana = await fixture.createUser("ana");
    const a = await clip(ana, "a");
    await clip(ana, "b");
    const c = await clip(ana, "c");
    await fixture.service.setPinned(ana, a.id, true);
    await fixture.service.setPinned(ana, c.id, true);

    const only = async (pinned?: boolean) =>
      names((await fixture.service.listSavedClippings(ana, { pinned })).items);
    expect(await only(true)).toEqual(["c", "a"]);
    expect(await only(false)).toEqual(["b"]);
    expect(await only()).toEqual(["c", "b", "a"]);
  });

  it("filters by the time saved, both ends included, and by tags together with it", async () => {
    const ana = await fixture.createUser("ana");
    const a = await clip(ana, "a", ["x"]);
    const b = await clip(ana, "b", ["x", "y"]);
    const c = await clip(ana, "c", ["y"]);
    const savedAt = (clipping: { createdAt: string }) => parseISO(clipping.createdAt);

    const between = await fixture.service.listSavedClippings(ana, {
      savedSince: savedAt(b),
      savedUntil: savedAt(c),
    });
    expect(names(between.items)).toEqual(["c", "b"]);

    const after = await fixture.service.listSavedClippings(ana, { savedSince: savedAt(c) });
    expect(names(after.items)).toEqual(["c"]);
    const before = await fixture.service.listSavedClippings(ana, { savedUntil: savedAt(a) });
    expect(names(before.items)).toEqual(["a"]);

    const tagged = await fixture.service.listSavedClippings(ana, {
      tags: ["Y"],
      savedUntil: savedAt(b),
    });
    expect(names(tagged.items)).toEqual(["b"]);
  });

  it("keeps users apart and leaves deleted clippings out", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    await clip(ana, "ana");
    const gone = await clip(ana, "gone");
    await clip(bob, "bob");
    await fixture.service.deleteClipping(ana, gone.id);

    expect(names((await fixture.service.listSavedClippings(ana, {})).items)).toEqual(["ana"]);
    expect(names((await fixture.service.listSavedClippings(bob, {})).items)).toEqual(["bob"]);
    // A page boundary from Ana's list gives Bob nothing of hers.
    const page = await fixture.service.listSavedClippings(ana, { limit: 1 });
    expect(page.nextCursor).toBeNull();
  });

  it("finds a tag by name ignoring case, and only the user's own", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    await clip(ana, "a", ["Work"]);
    await clip(bob, "b", ["Secret"]);

    expect(await fixture.service.findTagByName(ana, "  work ")).toMatchObject({ name: "Work" });
    expect(await fixture.service.findTagByName(ana, "secret")).toBeNull();
    expect(await fixture.service.findTagByName(ana, "")).toBeNull();
  });
});
