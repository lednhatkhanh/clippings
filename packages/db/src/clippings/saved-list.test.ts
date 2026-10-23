import { addMilliseconds, parseISO } from "date-fns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";

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
    await clip(ana, "a", ["x"]);
    const b = await clip(ana, "b", ["x", "y"]);
    const c = await clip(ana, "c", ["y"]);
    const savedAt = (clipping: { createdAt: string }) => parseISO(clipping.createdAt);

    const between = await fixture.service.listSavedClippings(ana, {
      savedSince: savedAt(b),
      savedBefore: addMilliseconds(savedAt(c), 1),
    });
    expect(names(between.items)).toEqual(["c", "b"]);

    const after = await fixture.service.listSavedClippings(ana, { savedSince: savedAt(c) });
    expect(names(after.items)).toEqual(["c"]);
    const before = await fixture.service.listSavedClippings(ana, { savedBefore: savedAt(b) });
    expect(names(before.items)).toEqual(["a"]);

    const tagged = await fixture.service.listSavedClippings(ana, {
      tags: ["Y"],
      savedBefore: savedAt(c),
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
  });

  it("doesn't let one user's page cursor reach another user's clippings", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    await clip(bob, "bob-old");
    await clip(ana, "ana-old");
    await clip(ana, "ana-new");
    await clip(bob, "bob-new");

    const anasFirst = await fixture.service.listSavedClippings(ana, { limit: 1 });
    expect(names(anasFirst.items)).toEqual(["ana-new"]);
    expect(anasFirst.nextCursor).not.toBeNull();

    // The cursor is a position in time: with it Bob pages his own clippings only.
    const bobs = await fixture.service.listSavedClippings(bob, { cursor: anasFirst.nextCursor! });
    expect(names(bobs.items)).toEqual(["bob-old"]);
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
