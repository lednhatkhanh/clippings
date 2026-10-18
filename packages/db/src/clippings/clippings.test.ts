import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_NOTE_LENGTH } from "@clippings/shared";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture";
import { TEST_DATABASE_URL } from "../test/temp-database";
import { InvalidUrlError, NoteTooLongError } from "./service";

describe.skipIf(!TEST_DATABASE_URL)("clippings service", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  const essay = {
    page: { title: "Essay | Example", text: "A long essay about gardening, from start to end." },
    summary: {
      title: "An essay about gardening",
      summary: "Why small gardens beat big ones.",
      excerpt: "A long essay about gardening",
    },
  };

  it("saves a new URL as a pending clipping titled by its URL, and lists it", async () => {
    const ana = await fixture.createUser("ana");

    const saved = await fixture.service.saveClipping(ana, {
      url: "https://example.com/essay",
      note: "for the weekend",
      source: "web",
    });

    expect(saved.status).toBe("created");
    expect(saved.clipping).toMatchObject({
      url: "https://example.com/essay",
      title: "https://example.com/essay",
      note: "for the weekend",
      status: "pending",
      source: "web",
    });
    expect(fixture.enrichmentRequests).toEqual([saved.clipping.id]);

    const page = await fixture.service.listClippings(ana, {});
    expect(page.items.map((clipping) => clipping.id)).toEqual([saved.clipping.id]);
    expect(page.nextCursor).toBeNull();
  });

  it("finds the existing clipping for a URL that differs only trivially, leaving its note alone", async () => {
    const ana = await fixture.createUser("ana");
    const first = await fixture.service.saveClipping(ana, {
      url: "https://example.com/essay?id=7",
      note: "original note",
      source: "web",
    });

    const trivialVariants = [
      "https://EXAMPLE.com/essay?id=7",
      "https://example.com/essay/?id=7",
      "https://example.com/essay?id=7#section-2",
      "https://example.com/essay?utm_source=newsletter&id=7&fbclid=abc",
      "example.com/essay?id=7",
    ];
    for (const url of trivialVariants) {
      const again = await fixture.service.saveClipping(ana, {
        url,
        note: "a different note",
        source: "extension",
      });

      expect(again.status, url).toBe("existing");
      expect(again.clipping.id, url).toBe(first.clipping.id);
      expect(again.clipping.note, url).toBe("original note");
      expect(again.clipping.source, url).toBe("web");
    }

    expect(fixture.enrichmentRequests).toEqual([first.clipping.id]);
    const page = await fixture.service.listClippings(ana, {});
    expect(page.items).toHaveLength(1);
  });

  it("treats a different path or query value as a different page", async () => {
    const ana = await fixture.createUser("ana");
    await fixture.service.saveClipping(ana, { url: "https://example.com/a?id=1", source: "web" });

    const other = await fixture.service.saveClipping(ana, {
      url: "https://example.com/a?id=2",
      source: "web",
    });

    expect(other.status).toBe("created");
  });

  it("rejects something that is not a web address", async () => {
    const ana = await fixture.createUser("ana");

    await expect(
      fixture.service.saveClipping(ana, { url: "javascript:alert(1)", source: "web" }),
    ).rejects.toThrow(InvalidUrlError);
    await expect(fixture.service.saveClipping(ana, { url: "   ", source: "web" })).rejects.toThrow(
      InvalidUrlError,
    );
  });

  it("keeps users apart: B neither sees nor saves over A's clipping of the same URL", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    const anas = await fixture.service.saveClipping(ana, {
      url: "https://example.com/shared",
      note: "ana's note",
      source: "web",
    });

    const bens = await fixture.service.saveClipping(ben, {
      url: "https://example.com/shared",
      note: "ben's note",
      source: "web",
    });

    expect(bens.status).toBe("created");
    expect(bens.clipping.id).not.toBe(anas.clipping.id);
    expect(bens.clipping.note).toBe("ben's note");
    const anasPage = await fixture.service.listClippings(ana, {});
    expect(anasPage.items.map((clipping) => clipping.note)).toEqual(["ana's note"]);
    const bensPage = await fixture.service.listClippings(ben, {});
    expect(bensPage.items.map((clipping) => clipping.note)).toEqual(["ben's note"]);

    // A cursor taken from A's list gives B nothing of A's.
    await fixture.service.saveClipping(ana, { url: "https://example.com/second", source: "web" });
    const anasFirst = await fixture.service.listClippings(ana, { limit: 1 });
    const bensWithAnasCursor = await fixture.service.listClippings(ben, {
      cursor: anasFirst.nextCursor ?? undefined,
    });
    expect(bensWithAnasCursor.items.map((clipping) => clipping.note)).not.toContain("ana's note");
  });

  it("pages newest first by cursor, without gaps or duplicates", async () => {
    const ana = await fixture.createUser("ana");
    const saved: string[] = [];
    for (let index = 0; index < 7; index++) {
      const { clipping } = await fixture.service.saveClipping(ana, {
        url: `https://example.com/${index}`,
        source: "web",
      });
      saved.push(clipping.id);
      // Saves 3 and 4 land at the same instant, so the order between them must still be stable.
      if (index !== 3) fixture.advanceClock(1000);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await fixture.service.listClippings(ana, { cursor, limit: 3 });
      seen.push(...page.items.map((clipping) => clipping.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);
    expect(new Set(seen)).toEqual(new Set(saved));
    // Newest first: later saves precede earlier ones.
    const positions = saved.map((id) => seen.indexOf(id));
    expect(positions[6]).toBeLessThan(positions[5]!);
    expect(positions[5]).toBeLessThan(positions[4]!);
    expect(positions[2]).toBeLessThan(positions[1]!);
    expect(positions[1]).toBeLessThan(positions[0]!);

    // Saves 3 and 4 share an instant: the higher id comes first, whichever page they fall on.
    const [earlier, later] = [saved[3]!, saved[4]!].toSorted();
    expect(seen.indexOf(later!)).toBeLessThan(seen.indexOf(earlier!));
  });

  it("updates the note of one's own clipping, and a later read returns it", async () => {
    const ana = await fixture.createUser("ana");
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: "https://example.com/a",
      note: "before",
      source: "web",
    });

    const updated = await fixture.service.updateClipping(ana, clipping.id, { note: "after" });

    expect(updated?.note).toBe("after");
    expect((await fixture.service.getClipping(ana, clipping.id))?.note).toBe("after");
    const page = await fixture.service.listClippings(ana, {});
    expect(page.items[0]?.note).toBe("after");
  });

  it("keeps users apart: B can't read, update, delete or restore A's clipping", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: "https://example.com/a",
      note: "ana's note",
      source: "web",
    });

    expect(await fixture.service.getClipping(ben, clipping.id)).toBeNull();
    expect(await fixture.service.updateClipping(ben, clipping.id, { note: "hijacked" })).toBeNull();
    expect(await fixture.service.deleteClipping(ben, clipping.id)).toBe(false);
    expect(await fixture.service.getClipping(ana, clipping.id)).toEqual(clipping);

    await fixture.service.deleteClipping(ana, clipping.id);
    expect(await fixture.service.restoreClipping(ben, clipping.id)).toBe(false);
    expect(await fixture.service.getClipping(ana, clipping.id)).toBeNull();
  });

  describe("deleting and restoring", () => {
    it("hides a deleted clipping from list and get, and restore brings it back as it was", async () => {
      const ana = await fixture.createUser("ana");
      const { clipping: kept } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/kept",
        source: "web",
      });
      fixture.advanceClock(1000);
      const { clipping } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/gone",
        note: "remember this",
        source: "web",
      });

      expect(await fixture.service.deleteClipping(ana, clipping.id)).toBe(true);

      expect(await fixture.service.getClipping(ana, clipping.id)).toBeNull();
      const afterDelete = await fixture.service.listClippings(ana, {});
      expect(afterDelete.items.map((item) => item.id)).toEqual([kept.id]);

      expect(await fixture.service.restoreClipping(ana, clipping.id)).toBe(true);

      expect(await fixture.service.getClipping(ana, clipping.id)).toEqual(clipping);
      const afterRestore = await fixture.service.listClippings(ana, {});
      expect(afterRestore.items.map((item) => item.id)).toEqual([clipping.id, kept.id]);
    });

    it("saving a deleted clipping's URL again starts the clipping over", async () => {
      const ana = await fixture.createUser("ana");
      fixture.web.set("https://example.com/essay", essay);
      const { clipping: old } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/essay",
        note: "old note",
        source: "web",
      });
      await fixture.service.enrichClipping(old.id);
      await fixture.service.deleteClipping(ana, old.id);
      fixture.advanceClock(60_000);
      fixture.enrichmentRequests.length = 0;

      const again = await fixture.service.saveClipping(ana, {
        url: "https://example.com/essay/",
        note: "new note",
        source: "extension",
      });

      expect(again.status).toBe("created");
      expect(again.clipping).toMatchObject({
        title: "https://example.com/essay/",
        note: "new note",
        summary: null,
        status: "pending",
        source: "extension",
        createdAt: "2026-10-01T09:01:00.000Z",
      });
      expect(fixture.enrichmentRequests).toEqual([again.clipping.id]);
      const page = await fixture.service.listClippings(ana, {});
      expect(page.items.map((item) => item.note)).toEqual(["new note"]);
    });

    it("a deleted clipping can't be edited or retried, and isn't swept", async () => {
      const ana = await fixture.createUser("ana");
      fixture.web.set("https://example.com/down", { error: new Error("503") });
      const { clipping } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/down",
        source: "web",
      });
      await fixture.service.enrichClipping(clipping.id, { lastAttempt: true });
      await fixture.service.deleteClipping(ana, clipping.id);
      fixture.advanceClock(2 * 60 * 60 * 1000);
      fixture.enrichmentRequests.length = 0;

      expect(await fixture.service.updateClipping(ana, clipping.id, { note: "x" })).toBeNull();
      expect(await fixture.service.retryEnrichment(ana, clipping.id)).toBeNull();
      expect(await fixture.service.deleteClipping(ana, clipping.id)).toBe(false);
      expect(await fixture.service.sweepStuck()).toEqual([]);
      expect(fixture.enrichmentRequests).toEqual([]);
    });
  });

  it("stores a bare domain with its scheme, so the clipping links to the page", async () => {
    const ana = await fixture.createUser("ana");

    const { clipping } = await fixture.service.saveClipping(ana, {
      url: " example.com/essay ",
      source: "web",
    });

    expect(clipping.url).toBe("https://example.com/essay");
    expect(clipping.title).toBe("https://example.com/essay");
  });

  it("returns the normalized URL alongside the one the user gave", async () => {
    const ana = await fixture.createUser("ana");

    const { clipping } = await fixture.service.saveClipping(ana, {
      url: "https://EXAMPLE.com/essay/?utm_source=newsletter&id=7#part-2",
      source: "web",
    });

    expect(await fixture.service.getClipping(ana, clipping.id)).toMatchObject({
      url: "https://example.com/essay/?utm_source=newsletter&id=7#part-2",
      urlNormalized: "https://example.com/essay?id=7",
    });
  });

  it("rejects addresses that only look like web addresses", async () => {
    const ana = await fixture.createUser("ana");

    for (const url of [
      "mailto:ana@example.com",
      'javascript:alert(1);"@example.com"',
      "data:text/html,hello",
      "https://ana:secret@example.com/private",
    ]) {
      await expect(fixture.service.saveClipping(ana, { url, source: "web" }), url).rejects.toThrow(
        InvalidUrlError,
      );
    }
  });

  it("keeps a note within the limit", async () => {
    const ana = await fixture.createUser("ana");
    const tooLong = "x".repeat(MAX_NOTE_LENGTH + 1);

    await expect(
      fixture.service.saveClipping(ana, {
        url: "https://example.com/a",
        note: tooLong,
        source: "web",
      }),
    ).rejects.toThrow(NoteTooLongError);

    const { clipping } = await fixture.service.saveClipping(ana, {
      url: "https://example.com/a",
      note: "x".repeat(MAX_NOTE_LENGTH),
      source: "web",
    });
    await expect(
      fixture.service.updateClipping(ana, clipping.id, { note: tooLong }),
    ).rejects.toThrow(NoteTooLongError);
  });

  describe("enrichment", () => {
    it("reads a pending clipping: title, summary and excerpt are written and it is ready", async () => {
      const ana = await fixture.createUser("ana");
      fixture.web.set("https://example.com/essay", essay);
      const { clipping } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/essay",
        source: "web",
      });

      const outcome = await fixture.service.enrichClipping(clipping.id);

      expect(outcome).toBe("ready");
      expect(await fixture.service.getClipping(ana, clipping.id)).toMatchObject({
        status: "ready",
        title: "An essay about gardening",
        summary: "Why small gardens beat big ones.",
        excerpt: "A long essay about gardening",
      });
    });

    it("does nothing when the same job is delivered again after the clipping is read", async () => {
      const ana = await fixture.createUser("ana");
      fixture.web.set("https://example.com/essay", essay);
      const { clipping } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/essay",
        source: "web",
      });
      await fixture.service.enrichClipping(clipping.id);
      fixture.web.set("https://example.com/essay", {
        page: { title: "Rewritten", text: "The page changed." },
        summary: { title: "Something else", summary: "Other.", excerpt: "Other" },
      });

      const outcome = await fixture.service.enrichClipping(clipping.id);

      expect(outcome).toBe("skipped");
      expect((await fixture.service.getClipping(ana, clipping.id))?.title).toBe(
        "An essay about gardening",
      );
    });

    it("ignores a job for a clipping that does not exist", async () => {
      expect(await fixture.service.enrichClipping("00000000-0000-4000-8000-000000000000")).toBe(
        "skipped",
      );
      expect(await fixture.service.enrichClipping("not-an-id")).toBe("skipped");
    });

    it("leaves the user's note alone, whether it was written before or during enrichment", async () => {
      const ana = await fixture.createUser("ana");
      fixture.web.set("https://example.com/essay", essay);
      const { clipping } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/essay",
        note: "for the weekend",
        source: "web",
      });
      await fixture.service.updateClipping(ana, clipping.id, {
        note: "for the weekend, then share with Ben",
      });

      await fixture.service.enrichClipping(clipping.id);

      expect((await fixture.service.getClipping(ana, clipping.id))?.note).toBe(
        "for the weekend, then share with Ben",
      );
    });

    it("fails on a page that can't be read: an early attempt throws and stays pending, the last one marks it failed", async () => {
      const ana = await fixture.createUser("ana");
      fixture.web.set("https://example.com/down", { error: new Error("503 from the site") });
      const { clipping } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/down",
        note: "keep this",
        source: "web",
      });

      await expect(fixture.service.enrichClipping(clipping.id)).rejects.toThrow("503");
      expect((await fixture.service.getClipping(ana, clipping.id))?.status).toBe("pending");

      const outcome = await fixture.service.enrichClipping(clipping.id, { lastAttempt: true });

      expect(outcome).toBe("failed");
      expect(await fixture.service.getClipping(ana, clipping.id)).toMatchObject({
        status: "failed",
        title: "https://example.com/down",
        note: "keep this",
        summary: null,
      });
    });

    it("retry puts a failed clipping back to pending and publishes it again; it leaves others alone", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      fixture.web.set("https://example.com/down", { error: new Error("503") });
      const { clipping } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/down",
        source: "web",
      });
      await fixture.service.enrichClipping(clipping.id, { lastAttempt: true });
      fixture.enrichmentRequests.length = 0;

      expect(await fixture.service.retryEnrichment(ben, clipping.id)).toBeNull();
      expect(fixture.enrichmentRequests).toEqual([]);
      const retried = await fixture.service.retryEnrichment(ana, clipping.id);

      expect(retried?.status).toBe("pending");
      expect(fixture.enrichmentRequests).toEqual([clipping.id]);

      // Retrying a clipping that isn't failed changes nothing and publishes nothing.
      fixture.web.set("https://example.com/down", essay);
      await fixture.service.enrichClipping(clipping.id);
      fixture.enrichmentRequests.length = 0;
      const again = await fixture.service.retryEnrichment(ana, clipping.id);
      expect(again?.status).toBe("ready");
      expect(fixture.enrichmentRequests).toEqual([]);
    });

    it("retry that can't publish leaves the clipping failed and tells the caller", async () => {
      const ana = await fixture.createUser("ana");
      fixture.web.set("https://example.com/down", { error: new Error("503") });
      const { clipping } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/down",
        source: "web",
      });
      await fixture.service.enrichClipping(clipping.id, { lastAttempt: true });
      fixture.setPublishing("down");

      await expect(fixture.service.retryEnrichment(ana, clipping.id)).rejects.toThrow(
        "unreachable",
      );

      expect((await fixture.service.getClipping(ana, clipping.id))?.status).toBe("failed");
    });
  });

  describe("saving while the queue is down", () => {
    it("keeps the clipping, since enrichment can be requested again later", async () => {
      const ana = await fixture.createUser("ana");
      fixture.setPublishing("down");

      const saved = await fixture.service.saveClipping(ana, {
        url: "https://example.com/essay",
        source: "web",
      });

      expect(saved.status).toBe("created");
      const page = await fixture.service.listClippings(ana, {});
      expect(page.items.map((clipping) => clipping.status)).toEqual(["pending"]);
    });
  });

  describe("sweeping stuck clippings", () => {
    const HOUR = 60 * 60 * 1000;

    it("re-publishes only clippings pending or failed for more than an hour, and starts failed ones over", async () => {
      const ana = await fixture.createUser("ana");
      const save = async (name: string) =>
        (
          await fixture.service.saveClipping(ana, {
            url: `https://example.com/${name}`,
            source: "web",
          })
        ).clipping;
      fixture.web.set("https://example.com/failed-old", { error: new Error("503") });
      fixture.web.set("https://example.com/failed-new", { error: new Error("503") });
      fixture.web.set("https://example.com/ready-old", essay);

      const pendingOld = await save("pending-old");
      const failedOld = await save("failed-old");
      const readyOld = await save("ready-old");
      await fixture.service.enrichClipping(failedOld.id, { lastAttempt: true });
      await fixture.service.enrichClipping(readyOld.id);
      fixture.advanceClock(HOUR + 1);
      const pendingNew = await save("pending-new");
      const failedNew = await save("failed-new");
      await fixture.service.enrichClipping(failedNew.id, { lastAttempt: true });
      fixture.advanceClock(HOUR - 1000);
      fixture.enrichmentRequests.length = 0;

      const swept = await fixture.service.sweepStuck();

      expect(swept.toSorted()).toEqual([pendingOld.id, failedOld.id].toSorted());
      expect(fixture.enrichmentRequests.toSorted()).toEqual(
        [pendingOld.id, failedOld.id].toSorted(),
      );
      const statusOf = async (id: string) => (await fixture.service.getClipping(ana, id))?.status;
      expect(await statusOf(failedOld.id)).toBe("pending");
      expect(await statusOf(failedNew.id)).toBe("failed");
      expect(await statusOf(pendingNew.id)).toBe("pending");
      expect(await statusOf(readyOld.id)).toBe("ready");

      // Swept just now, so the next sweep leaves them alone until another hour has passed.
      fixture.enrichmentRequests.length = 0;
      expect(await fixture.service.sweepStuck()).toEqual([]);
    });
  });
});
