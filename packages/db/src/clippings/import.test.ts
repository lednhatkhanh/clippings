import { addMinutes, parseISO } from "date-fns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatIsoUtc, MAX_TAG_LENGTH, MAX_TAGS_PER_CLIPPING } from "@clippings/shared";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";
import { IMPORT_DAILY_BUDGET, IMPORT_SPREAD_SECONDS, type ImportItem } from "./service.ts";

const HOUR = 60 * 60 * 1000;
const asDate = (iso: string) => parseISO(iso);

describe.skipIf(!TEST_DATABASE_URL)("importing bookmarks", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  const bookmark = (
    url: string,
    addedAt: string | null = null,
    folders: string[] = [],
  ): ImportItem => ({
    url,
    addedAt: addedAt ? asDate(addedAt) : null,
    folders,
  });
  const listAll = async (userId: string) =>
    (await fixture.service.listClippings(userId, { limit: 100 })).items;

  it("creates pending clippings titled by their URL, from the import source, without requesting any job", async () => {
    const ana = await fixture.createUser("ana");

    const counts = await fixture.service.importClippings(
      ana,
      [bookmark("https://example.com/a"), bookmark("example.org/b")],
      { foldersAsTags: false },
    );

    expect(counts).toEqual({ created: 2, existing: 0, skipped: 0 });
    const items = await listAll(ana);
    expect(items.map((clipping) => clipping.url).toSorted()).toEqual([
      "https://example.com/a",
      "https://example.org/b",
    ]);
    for (const clipping of items) {
      expect(clipping).toMatchObject({
        title: clipping.url,
        status: "pending",
        source: "import",
        note: "",
        tags: [],
      });
    }
    expect(fixture.enrichmentRequests).toEqual([]);
    expect(fixture.batchedEnrichmentRequests).toEqual([]);
  });

  it("keeps the bookmark's date, so imports sit at the right place in the newest-first list", async () => {
    const ana = await fixture.createUser("ana");
    await fixture.service.saveClipping(ana, { url: "https://example.com/saved", source: "web" });

    await fixture.service.importClippings(
      ana,
      [
        bookmark("https://example.com/2020", "2020-05-01T10:00:00.000Z"),
        bookmark("https://example.com/2024", "2024-05-01T10:00:00.000Z"),
      ],
      { foldersAsTags: false },
    );

    const items = await listAll(ana);
    expect(items.map((clipping) => [clipping.url.split("/").pop(), clipping.createdAt])).toEqual([
      ["saved", "2026-10-01T09:00:00.000Z"],
      ["2024", "2024-05-01T10:00:00.000Z"],
      ["2020", "2020-05-01T10:00:00.000Z"],
    ]);
  });

  it("replaces a date in the future, before 1990 or missing with now", async () => {
    const ana = await fixture.createUser("ana");

    await fixture.service.importClippings(
      ana,
      [
        bookmark("https://example.com/future", "2026-10-01T09:00:01.000Z"),
        bookmark("https://example.com/epoch", "1970-01-01T00:00:00.000Z"),
        bookmark("https://example.com/none"),
        bookmark("https://example.com/now", "2026-10-01T09:00:00.000Z"),
        bookmark("https://example.com/floor", "1990-01-01T00:00:00.000Z"),
      ],
      { foldersAsTags: false },
    );

    const createdAt = Object.fromEntries(
      (await listAll(ana)).map((clipping) => [clipping.url.split("/").pop(), clipping.createdAt]),
    );
    expect(createdAt).toEqual({
      future: "2026-10-01T09:00:00.000Z",
      epoch: "2026-10-01T09:00:00.000Z",
      none: "2026-10-01T09:00:00.000Z",
      now: "2026-10-01T09:00:00.000Z",
      floor: "1990-01-01T00:00:00.000Z",
    });
  });

  it("skips what isn't a web page, recognises pages already saved as saving does, and counts a repeat once", async () => {
    const ana = await fixture.createUser("ana");
    const { clipping: saved } = await fixture.service.saveClipping(ana, {
      url: "https://example.com/essay?id=7",
      note: "my note",
      source: "web",
    });
    const items = [
      bookmark("javascript:alert(1)"),
      bookmark("file:///etc/passwd"),
      bookmark("chrome://settings"),
      bookmark("https://EXAMPLE.com/essay/?id=7&utm_source=x#frag"),
      bookmark("https://example.com/new"),
      bookmark("https://example.com/new/?utm_medium=y"),
      bookmark("https://example.com/other"),
    ];

    const preview = await fixture.service.previewImport(ana, items);
    expect(preview).toEqual({ created: 2, existing: 1, skipped: 3 });
    expect(await listAll(ana)).toHaveLength(1);

    const counts = await fixture.service.importClippings(ana, items, { foldersAsTags: false });

    expect(counts).toEqual(preview);
    expect((await listAll(ana)).map((clipping) => clipping.url).toSorted()).toEqual([
      "https://example.com/essay?id=7",
      "https://example.com/new",
      "https://example.com/other",
    ]);
    expect(await fixture.service.getClipping(ana, saved.id)).toMatchObject({
      note: "my note",
      source: "web",
    });
    // Importing the same file again adds nothing.
    expect(await fixture.service.importClippings(ana, items, { foldersAsTags: false })).toEqual({
      created: 0,
      existing: 3,
      skipped: 3,
    });
  });

  it("starts a deleted clipping of the same page over, with the bookmark's date and no old tags", async () => {
    const ana = await fixture.createUser("ana");
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: "https://example.com/a",
      note: "old note",
      tags: ["old"],
      source: "web",
    });
    await fixture.service.updateClipping(ana, clipping.id, { title: "Mine" });
    await fixture.service.setPinned(ana, clipping.id, true);
    await fixture.service.deleteClipping(ana, clipping.id);
    const items = [bookmark("https://example.com/a", "2021-03-04T05:06:07.000Z", ["fresh"])];

    expect(await fixture.service.previewImport(ana, items)).toEqual({
      created: 1,
      existing: 0,
      skipped: 0,
    });
    const counts = await fixture.service.importClippings(ana, items, { foldersAsTags: true });

    expect(counts).toEqual({ created: 1, existing: 0, skipped: 0 });
    const revived = await fixture.service.getClipping(ana, clipping.id);
    expect(revived).toMatchObject({
      status: "pending",
      source: "import",
      note: "",
      title: "https://example.com/a",
      titleEdited: false,
      pinned: false,
      createdAt: "2021-03-04T05:06:07.000Z",
    });
    expect(revived?.tags.map((tag) => tag.name)).toEqual(["fresh"]);
  });

  describe("folders as tags", () => {
    it("tags each bookmark with its folders, reusing the user's tags ignoring case and merging a page repeated in two folders", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.service.saveClipping(ana, {
        url: "https://example.com/other",
        tags: ["Recipes"],
        source: "web",
      });

      await fixture.service.importClippings(
        ana,
        [
          bookmark("https://example.com/a", null, ["Bookmarks bar", "recipes", " Soup  stock "]),
          bookmark("https://example.com/b", null, ["RECIPES"]),
          bookmark("https://example.com/a/", null, ["Later"]),
        ],
        { foldersAsTags: true },
      );

      const byUrl = Object.fromEntries(
        (await listAll(ana)).map((clipping) => [
          clipping.url,
          clipping.tags.map((tag) => tag.name).toSorted(),
        ]),
      );
      expect(byUrl["https://example.com/a"]).toEqual([
        "Bookmarks bar",
        "Later",
        "Recipes",
        "Soup stock",
      ]);
      expect(byUrl["https://example.com/b"]).toEqual(["Recipes"]);
      expect((await fixture.service.listTags(ana)).map((tag) => tag.name)).toEqual([
        "Bookmarks bar",
        "Later",
        "Recipes",
        "Soup stock",
      ]);
    });

    it("drops names that are too long and keeps at most the tags a clipping can carry", async () => {
      const ana = await fixture.createUser("ana");
      const many = Array.from({ length: MAX_TAGS_PER_CLIPPING + 5 }, (_, n) => `folder ${n}`);

      await fixture.service.importClippings(
        ana,
        [bookmark("https://example.com/a", null, ["x".repeat(MAX_TAG_LENGTH + 1), "ok"])],
        { foldersAsTags: true },
      );
      await fixture.service.importClippings(ana, [bookmark("https://example.com/b", null, many)], {
        foldersAsTags: true,
      });

      const byUrl = Object.fromEntries(
        (await listAll(ana)).map((clipping) => [clipping.url, clipping.tags.length]),
      );
      expect(byUrl).toEqual({
        "https://example.com/a": 1,
        "https://example.com/b": MAX_TAGS_PER_CLIPPING,
      });
    });

    it("leaves the folders out when the user didn't ask for them", async () => {
      const ana = await fixture.createUser("ana");

      await fixture.service.importClippings(
        ana,
        [bookmark("https://example.com/a", null, ["Recipes"])],
        { foldersAsTags: false },
      );

      expect((await listAll(ana))[0]?.tags).toEqual([]);
      expect(await fixture.service.listTags(ana)).toEqual([]);
    });
  });

  it("imports 5,000 bookmarks in one go", async () => {
    const ana = await fixture.createUser("ana");
    const items = Array.from({ length: 5000 }, (_, n) =>
      bookmark(`https://example.com/page-${n}`, "2022-01-01T00:00:00.000Z", [`folder ${n % 40}`]),
    );

    const started = performance.now();
    const counts = await fixture.service.importClippings(ana, items, { foldersAsTags: true });
    const seconds = (performance.now() - started) / 1000;

    expect(counts).toEqual({ created: 5000, existing: 0, skipped: 0 });
    expect(await fixture.service.countPendingImports(ana)).toBe(5000);
    expect(await fixture.service.listTags(ana)).toHaveLength(40);
    console.info(`imported 5,000 bookmarks in ${seconds.toFixed(2)} s`);
    expect(seconds).toBeLessThan(15);
  }, 30_000);

  it("does nothing for an empty import", async () => {
    const ana = await fixture.createUser("ana");

    expect(await fixture.service.importClippings(ana, [], { foldersAsTags: true })).toEqual({
      created: 0,
      existing: 0,
      skipped: 0,
    });
    expect(await fixture.service.previewImport(ana, [bookmark("mailto:a@b.c")])).toEqual({
      created: 0,
      existing: 0,
      skipped: 1,
    });
  });

  it("keeps users apart: B's page isn't a duplicate for A, and imports never touch another user's clippings", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    await fixture.service.saveClipping(ben, {
      url: "https://example.com/shared",
      note: "ben's note",
      tags: ["bens"],
      source: "web",
    });
    const items = [bookmark("https://example.com/shared", null, ["Recipes"])];

    expect(await fixture.service.previewImport(ana, items)).toEqual({
      created: 1,
      existing: 0,
      skipped: 0,
    });
    await fixture.service.importClippings(ana, items, { foldersAsTags: true });

    expect(await fixture.service.countPendingImports(ana)).toBe(1);
    expect(await fixture.service.countPendingImports(ben)).toBe(0);
    const bens = await listAll(ben);
    expect(bens).toHaveLength(1);
    expect(bens[0]).toMatchObject({ note: "ben's note", source: "web" });
    expect(bens[0]?.tags.map((tag) => tag.name)).toEqual(["bens"]);
    expect((await fixture.service.listTags(ben)).map((tag) => tag.name)).toEqual(["bens"]);
    expect((await fixture.service.listTags(ana)).map((tag) => tag.name)).toEqual(["Recipes"]);
  });

  describe("counting what waits", () => {
    it("counts the user's pending imports, not read, deleted or saved-by-hand clippings", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.service.saveClipping(ana, { url: "https://example.com/hand", source: "web" });
      await fixture.service.importClippings(
        ana,
        ["a", "b", "c", "d"].map((name) => bookmark(`https://example.com/${name}`)),
        { foldersAsTags: false },
      );
      const [a, b] = (await listAll(ana)).filter((clipping) => clipping.source === "import");
      fixture.web.set(a!.url, {
        page: { title: "a", text: "" },
        summary: { title: "a", summary: "", excerpt: "" },
      });
      await fixture.service.enrichClipping(a!.id);
      await fixture.service.deleteClipping(ana, b!.id);

      expect(await fixture.service.countPendingImports(ana)).toBe(2);
    });
  });

  describe("draining the backlog", () => {
    const importBookmarks = (userId: string, count: number, prefix = "page") =>
      fixture.service.importClippings(
        userId,
        Array.from({ length: count }, (_, n) =>
          // A later number was saved later, so page-0 is the oldest.
          bookmark(
            `https://example.com/${prefix}-${String(n).padStart(4, "0")}`,
            formatIsoUtc(addMinutes(asDate("2020-01-01T00:00:00.000Z"), n)),
          ),
        ),
        { foldersAsTags: false },
      );

    it("requests the oldest imports first, spread over the day, and nothing when nothing waits", async () => {
      const ana = await fixture.createUser("ana");
      expect(await fixture.service.drainImports()).toEqual([]);
      expect(fixture.batchedEnrichmentRequests).toEqual([]);
      await importBookmarks(ana, 3);
      fixture.advanceClock(HOUR);

      const ids = await fixture.service.drainImports();

      const byId = new Map((await listAll(ana)).map((clipping) => [clipping.id, clipping.url]));
      expect(ids.map((id) => byId.get(id)?.slice(-4))).toEqual(["0000", "0001", "0002"]);
      expect(fixture.batchedEnrichmentRequests).toEqual([
        { ids, spreadOverSeconds: IMPORT_SPREAD_SECONDS },
      ]);
      expect(fixture.enrichmentRequests).toEqual([]);
    });

    it("takes at most the daily budget, and the next run starts with what the last one left", async () => {
      const ana = await fixture.createUser("ana");
      await importBookmarks(ana, IMPORT_DAILY_BUDGET + 5);
      fixture.advanceClock(HOUR);

      const first = await fixture.service.drainImports();
      fixture.advanceClock(24 * HOUR);
      const second = await fixture.service.drainImports();

      expect(first).toHaveLength(IMPORT_DAILY_BUDGET);
      expect(second).toHaveLength(IMPORT_DAILY_BUDGET);
      const left = (await listAll(ana)).filter((clipping) => !first.includes(clipping.id));
      expect(left).toHaveLength(5);
      // The five not yet requested come first, the rest are tried again behind them.
      expect(new Set(second.slice(0, 5))).toEqual(new Set(left.map((clipping) => clipping.id)));
    });

    it("leaves out clippings that are read, deleted or not imports, and requests an import once it is read no more", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.service.saveClipping(ana, { url: "https://example.com/hand", source: "web" });
      await importBookmarks(ana, 3);
      const imports = (await listAll(ana)).filter((clipping) => clipping.source === "import");
      const [readOne, deleted, waiting] = imports.toSorted((a, b) => a.url.localeCompare(b.url));
      fixture.web.set(readOne!.url, {
        page: { title: "x", text: "" },
        summary: { title: "x", summary: "", excerpt: "" },
      });
      await fixture.service.enrichClipping(readOne!.id);
      await fixture.service.deleteClipping(ana, deleted!.id);
      fixture.enrichmentRequests.length = 0;

      expect(await fixture.service.drainImports()).toEqual([waiting!.id]);
    });

    it("drains every user's backlog, oldest first across users", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await importBookmarks(ana, 1, "ana");
      await importBookmarks(ben, 1, "ben");

      const ids = await fixture.service.drainImports();

      expect(ids).toHaveLength(2);
    });

    it("tells the caller when the queue can't be reached, and takes the same imports on the next run", async () => {
      const ana = await fixture.createUser("ana");
      await importBookmarks(ana, 2);
      fixture.setPublishing("down");

      await expect(fixture.service.drainImports()).rejects.toThrow("unreachable");

      fixture.setPublishing("up");
      fixture.advanceClock(HOUR);
      expect(await fixture.service.drainImports()).toHaveLength(2);
    });

    it("takes only what is left of the day's budget on a second run, and never the same import twice", async () => {
      const ana = await fixture.createUser("ana");
      await importBookmarks(ana, 300, "first");
      fixture.advanceClock(HOUR);
      const first = await fixture.service.drainImports();
      await importBookmarks(ana, 200, "second");
      fixture.advanceClock(HOUR);

      const second = await fixture.service.drainImports();
      fixture.advanceClock(HOUR);
      const third = await fixture.service.drainImports();

      expect(first).toHaveLength(300);
      expect(second).toHaveLength(IMPORT_DAILY_BUDGET - 300);
      expect(third).toEqual([]);
      expect(new Set([...first, ...second]).size).toBe(IMPORT_DAILY_BUDGET);
    });

    it("gives a full budget again once the spread window has passed", async () => {
      const ana = await fixture.createUser("ana");
      await importBookmarks(ana, IMPORT_DAILY_BUDGET + 10);
      fixture.advanceClock(HOUR);
      await fixture.service.drainImports();

      fixture.advanceClock((IMPORT_SPREAD_SECONDS * 1000) / 2);
      expect(await fixture.service.drainImports()).toEqual([]);

      fixture.advanceClock((IMPORT_SPREAD_SECONDS * 1000) / 2 + 60_000);
      expect(await fixture.service.drainImports()).toHaveLength(IMPORT_DAILY_BUDGET);
    });

    it("lets overlapping runs share the backlog without taking an import twice or passing the budget", async () => {
      const ana = await fixture.createUser("ana");
      await importBookmarks(ana, IMPORT_DAILY_BUDGET + 50);
      fixture.advanceClock(HOUR);

      const runs = await Promise.all([
        fixture.service.drainImports(),
        fixture.service.drainImports(),
        fixture.service.drainImports(),
      ]);

      const all = runs.flat();
      expect(all).toHaveLength(IMPORT_DAILY_BUDGET);
      expect(new Set(all).size).toBe(IMPORT_DAILY_BUDGET);
    });

    it("counts a deleted import's request against the budget, and an import added since is not a request", async () => {
      const ana = await fixture.createUser("ana");
      await importBookmarks(ana, IMPORT_DAILY_BUDGET, "old");
      fixture.advanceClock(HOUR);
      const first = await fixture.service.drainImports();
      await fixture.service.deleteClipping(ana, first[0]!);
      await importBookmarks(ana, 5, "new");
      fixture.advanceClock(HOUR);

      expect(await fixture.service.drainImports()).toEqual([]);
    });

    it("is not undone by the sweep, which leaves pending imports to the drain but still restarts failed ones", async () => {
      const ana = await fixture.createUser("ana");
      await importBookmarks(ana, 2);
      const [first, second] = (await listAll(ana)).toSorted((a, b) => a.url.localeCompare(b.url));
      fixture.web.set(first!.url, { error: new Error("503") });
      await fixture.service.enrichClipping(first!.id, { lastAttempt: true });
      const { clipping: byHand } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/hand",
        source: "web",
      });
      fixture.advanceClock(2 * HOUR);
      fixture.enrichmentRequests.length = 0;

      const swept = await fixture.service.sweepStuck();

      expect(swept.toSorted()).toEqual([first!.id, byHand.id].toSorted());
      expect((await fixture.service.getClipping(ana, second!.id))?.status).toBe("pending");
      // The restarted import is pending again, so from now on it is the drain's.
      fixture.advanceClock(2 * HOUR);
      expect(await fixture.service.sweepStuck()).toEqual([byHand.id]);
    });
  });
});
