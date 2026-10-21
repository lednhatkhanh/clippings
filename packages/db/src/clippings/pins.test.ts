import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";

describe.skipIf(!TEST_DATABASE_URL)("pinning clippings", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  /** Saves a page a minute after the previous one, so newest first is well defined. */
  async function clip(
    userId: string,
    name: string,
    { tags, source = "web" }: { tags?: string[]; source?: "web" | "extension" } = {},
  ) {
    const { clipping } = await fixture.service.saveClipping(userId, {
      url: `https://example.com/${name}`,
      tags,
      source,
    });
    fixture.advanceClock(60_000);
    return clipping.id;
  }

  const urls = (clippings: { url: string }[]) =>
    clippings.map((clipping) => clipping.url.replace("https://example.com/", ""));

  it("puts pinned clippings above the list, most recently pinned first, and doesn't repeat them", async () => {
    const ana = await fixture.createUser("ana");
    const a = await clip(ana, "a");
    const b = await clip(ana, "b");
    await clip(ana, "c");
    await clip(ana, "d");

    expect((await fixture.service.setPinned(ana, a, true))?.pinned).toBe(true);
    fixture.advanceClock(1000);
    await fixture.service.setPinned(ana, b, true);

    const page = await fixture.service.listClippings(ana, {});
    expect(urls(page.pinned)).toEqual(["b", "a"]);
    expect(page.pinned.every((clipping) => clipping.pinned)).toBe(true);
    expect(urls(page.items)).toEqual(["d", "c"]);
    expect(page.items.some((clipping) => clipping.pinned)).toBe(false);
  });

  it("shows the pinned group on the first page only and pages the rest without gaps", async () => {
    const ana = await fixture.createUser("ana");
    const old = await clip(ana, "old");
    for (const name of ["1", "2", "3", "4", "5"]) await clip(ana, name);
    await fixture.service.setPinned(ana, old, true);

    const first = await fixture.service.listClippings(ana, { limit: 2 });
    const second = await fixture.service.listClippings(ana, {
      limit: 2,
      cursor: first.nextCursor!,
    });
    const third = await fixture.service.listClippings(ana, {
      limit: 2,
      cursor: second.nextCursor!,
    });

    expect(urls(first.pinned)).toEqual(["old"]);
    expect(second.pinned).toEqual([]);
    expect(third.pinned).toEqual([]);
    expect([...first.items, ...second.items, ...third.items].map((c) => c.url.slice(-1))).toEqual([
      "5",
      "4",
      "3",
      "2",
      "1",
    ]);
    expect(third.nextCursor).toBeNull();
  });

  it("keeps the order of an already pinned clipping when it is pinned again, and unpins it back into the list", async () => {
    const ana = await fixture.createUser("ana");
    const a = await clip(ana, "a");
    const b = await clip(ana, "b");
    await fixture.service.setPinned(ana, a, true);
    fixture.advanceClock(1000);
    await fixture.service.setPinned(ana, b, true);
    fixture.advanceClock(1000);
    await fixture.service.setPinned(ana, a, true);
    expect(urls((await fixture.service.listClippings(ana, {})).pinned)).toEqual(["b", "a"]);

    const unpinned = await fixture.service.setPinned(ana, a, false);

    expect(unpinned?.pinned).toBe(false);
    const page = await fixture.service.listClippings(ana, {});
    expect(urls(page.pinned)).toEqual(["b"]);
    expect(urls(page.items)).toEqual(["a"]);
  });

  it("applies the tag and source filters to the pinned group", async () => {
    const ana = await fixture.createUser("ana");
    const work = await clip(ana, "work", { tags: ["Work"] });
    const home = await clip(ana, "home", { tags: ["home"], source: "extension" });
    await fixture.service.setPinned(ana, work, true);
    await fixture.service.setPinned(ana, home, true);

    const byTag = await fixture.service.listClippings(ana, { tags: ["work"] });
    const bySource = await fixture.service.listClippings(ana, { sources: ["extension"] });
    const neither = await fixture.service.listClippings(ana, {
      tags: ["work"],
      sources: ["extension"],
    });

    expect(urls(byTag.pinned)).toEqual(["work"]);
    expect(urls(bySource.pinned)).toEqual(["home"]);
    expect(neither.pinned).toEqual([]);
    expect(byTag.items).toEqual([]);
  });

  it("leaves the pin alone through delete and undo, and hides a deleted pinned clipping", async () => {
    const ana = await fixture.createUser("ana");
    const a = await clip(ana, "a");
    await clip(ana, "b");
    await fixture.service.setPinned(ana, a, true);

    await fixture.service.deleteClipping(ana, a);
    const whileDeleted = await fixture.service.listClippings(ana, {});
    expect(whileDeleted.pinned).toEqual([]);
    expect(urls(whileDeleted.items)).toEqual(["b"]);
    expect(await fixture.service.setPinned(ana, a, false)).toBeNull();

    await fixture.service.restoreClipping(ana, a);
    const restored = await fixture.service.listClippings(ana, {});
    expect(urls(restored.pinned)).toEqual(["a"]);
    expect(urls(restored.items)).toEqual(["b"]);
  });

  it("starts over unpinned when a deleted clipping of the same page is saved again", async () => {
    const ana = await fixture.createUser("ana");
    const a = await clip(ana, "a");
    await fixture.service.setPinned(ana, a, true);
    await fixture.service.deleteClipping(ana, a);

    await clip(ana, "a");

    const page = await fixture.service.listClippings(ana, {});
    expect(page.pinned).toEqual([]);
    expect(urls(page.items)).toEqual(["a"]);
  });

  it("ignores pins in search, which ranks as usual", async () => {
    const ana = await fixture.createUser("ana");
    const older = await clip(ana, "gardening-older");
    await clip(ana, "gardening-newer");
    await fixture.service.setPinned(ana, older, true);

    const { items } = await fixture.service.searchClippings(ana, {
      q: "gardening",
      sort: "date",
    });

    expect(urls(items.map((hit) => hit.clipping))).toEqual(["gardening-newer", "gardening-older"]);
    expect(items.find((hit) => hit.clipping.id === older)?.clipping.pinned).toBe(true);
  });

  it("keeps users apart: B can't pin A's clipping, and A's pins never show in B's list", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    const anas = await clip(ana, "anas");
    await clip(ben, "bens");

    expect(await fixture.service.setPinned(ben, anas, true)).toBeNull();
    await fixture.service.setPinned(ana, anas, true);

    expect((await fixture.service.listClippings(ben, {})).pinned).toEqual([]);
    expect(await fixture.service.setPinned(ben, anas, false)).toBeNull();
    expect(urls((await fixture.service.listClippings(ana, {})).pinned)).toEqual(["anas"]);
    expect(await fixture.service.setPinned(ana, "not-an-id", true)).toBeNull();
  });
});

describe.skipIf(!TEST_DATABASE_URL)("deleting and restoring clippings, as Claude does", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  it("deletes a clipping out of every read and restores it whole, with its title, note and tags", async () => {
    const ana = await fixture.createUser("ana");
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: "https://example.com/a",
      note: "keep",
      tags: ["work"],
      source: "mcp",
    });
    await fixture.service.updateClipping(ana, clipping.id, { title: "Mine" });

    expect(await fixture.service.deleteClipping(ana, clipping.id)).toBe(true);
    expect(await fixture.service.getClipping(ana, clipping.id)).toBeNull();
    expect((await fixture.service.listClippings(ana, {})).items).toEqual([]);
    expect(await fixture.service.deleteClipping(ana, clipping.id)).toBe(false);

    expect(await fixture.service.restoreClipping(ana, clipping.id)).toBe(true);
    expect(await fixture.service.getClipping(ana, clipping.id)).toMatchObject({
      title: "Mine",
      note: "keep",
      tags: [expect.objectContaining({ name: "work" })],
    });
    expect(await fixture.service.restoreClipping(ana, clipping.id)).toBe(false);
  });

  it("keeps users apart: B can neither delete nor restore A's clipping", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: "https://example.com/a",
      source: "web",
    });

    expect(await fixture.service.deleteClipping(ben, clipping.id)).toBe(false);
    await fixture.service.deleteClipping(ana, clipping.id);
    expect(await fixture.service.restoreClipping(ben, clipping.id)).toBe(false);
    expect(await fixture.service.getClipping(ana, clipping.id)).toBeNull();
  });
});
