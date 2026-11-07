import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";
import { SWEEP_BATCH_SIZE } from "./service.ts";

describe.skipIf(!TEST_DATABASE_URL)("clippings held by the spend cap", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  const essay = {
    page: { title: "Essay | Example", text: "A long essay about gardening, from start to end." },
    summary: {
      title: "An essay about gardening",
      summary: "Why small gardens beat big ones.",
      excerpt: "A long essay about gardening",
    },
  };

  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
    fixture.web.set("https://example.com/essay", essay);
  });

  afterEach(async () => {
    await fixture.close();
  });

  async function save(userId: string, url = "https://example.com/essay") {
    const { clipping } = await fixture.service.saveClipping(userId, { url, source: "web" });
    return clipping.id;
  }

  const sweepAttempts = async (id: string) =>
    (
      await fixture.pool.query<{ sweep_attempts: number }>(
        `select sweep_attempts from clippings where id = $1`,
        [id],
      )
    ).rows[0]?.sweep_attempts;

  it("leaves the clipping pending and does not throw, so the queue doesn't retry", async () => {
    const ana = await fixture.createUser("ana");
    const id = await save(ana);
    fixture.setCapReached(true);

    // Not even on the queue's last delivery does it become failed.
    const outcome = await fixture.service.enrichClipping(id, { lastAttempt: true });

    expect(outcome).toBe("held");
    expect((await fixture.service.getClipping(ana, id))?.status).toBe("pending");
  });

  it("holds a clipping before fetching its page when the budget has no room", async () => {
    const ana = await fixture.createUser("ana");
    const id = await save(ana);
    fixture.setBudgetShut(ana, true);

    const outcome = await fixture.service.enrichClipping(id, { lastAttempt: true });

    expect(outcome).toBe("held");
    expect(fixture.fetchedPages).toEqual([]);
    expect(fixture.summarizedPages).toEqual([]);
    expect(fixture.budgetAsked).toEqual([{ userId: ana, jobKind: "enrich" }]);
    expect((await fixture.service.getClipping(ana, id))?.status).toBe("pending");
    expect(await sweepAttempts(id)).toBe(0);
  });

  it("asks about the clipping's own user, so another user's spent budget holds nothing", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    fixture.web.set("https://example.com/other", essay);
    const anas = await save(ana);
    const bobs = await save(bob, "https://example.com/other");
    fixture.setBudgetShut(ana, true);

    expect(await fixture.service.enrichClipping(anas)).toBe("held");
    expect(await fixture.service.enrichClipping(bobs)).toBe("ready");
    expect(fixture.fetchedPages).toEqual(["https://example.com/other"]);
  });

  it("reads the clipping once the cap allows, on the next job", async () => {
    const ana = await fixture.createUser("ana");
    const id = await save(ana);
    fixture.setCapReached(true);
    await fixture.service.enrichClipping(id);
    fixture.setCapReached(false);

    const outcome = await fixture.service.enrichClipping(id);

    expect(outcome).toBe("ready");
    expect((await fixture.service.getClipping(ana, id))?.title).toBe("An essay about gardening");
  });

  it("is requested again by the sweep on a later day without spending a sweep attempt", async () => {
    const ana = await fixture.createUser("ana");
    const id = await save(ana);

    for (let day = 1; day <= 5; day++) {
      fixture.setCapReached(true);
      await fixture.service.enrichClipping(id, { lastAttempt: true });
      fixture.advanceClock(DAY);
      fixture.batchedEnrichmentRequests.length = 0;

      expect(await fixture.service.sweepStuck()).toEqual([id]);
      expect(fixture.batchedEnrichmentRequests.flatMap((batch) => batch.ids)).toEqual([id]);
    }

    expect(await sweepAttempts(id)).toBe(0);
    fixture.setCapReached(false);
    expect(await fixture.service.enrichClipping(id)).toBe("ready");
  });

  describe("the daily sweep", () => {
    const saveMany = async (userId: string, count: number, prefix: string) => {
      const ids: string[] = [];
      for (let n = 0; n < count; n++) {
        ids.push(await save(userId, `https://example.com/${prefix}-${n}`));
      }
      return ids;
    };

    /** A clipping of Ben's that has failed, so the sweep wants to start it over. */
    const failedClipping = async (userId: string) => {
      fixture.web.set("https://example.com/ben-gone", { error: new Error("404") });
      const id = await save(userId, "https://example.com/ben-gone");
      await fixture.service.enrichClipping(id, { lastAttempt: true });
      return id;
    };

    it("leaves out a user with a cap of 0, so their backlog doesn't take the batch from others", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await fixture.settings.updateAutomationSettings(ana, { dailyCapMicros: 0 });
      const held = await saveMany(ana, SWEEP_BATCH_SIZE + 1, "ana");
      fixture.advanceClock(HOUR);
      const bens = await failedClipping(ben);
      fixture.advanceClock(2 * HOUR);

      expect(await fixture.service.sweepStuck()).toEqual([bens]);

      // Raising the cap lets the next sweep take the backlog.
      await fixture.settings.updateAutomationSettings(ana, { dailyCapMicros: 3_000_000 });
      fixture.advanceClock(DAY);
      const swept = await fixture.service.sweepStuck();
      expect(swept).toHaveLength(SWEEP_BATCH_SIZE);
      expect(held).toEqual(expect.arrayContaining(swept.filter((id) => id !== bens)));
    });

    it("leaves out a user whose spend today has reached their cap, until the UTC day turns over", async () => {
      const ana = await fixture.createUser("ana");
      await fixture.settings.updateAutomationSettings(ana, { dailyCapMicros: 1_000_000 });
      const id = await save(ana);
      fixture.advanceClock(2 * HOUR);
      await fixture.usage.recordUsage(ana, {
        jobKind: "enrich",
        model: "claude-haiku-5-5",
        batch: false,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        webSearches: 0,
        costMicros: 1_000_000,
      });

      expect(await fixture.service.sweepStuck()).toEqual([]);

      fixture.advanceClock(DAY);
      expect(await fixture.service.sweepStuck()).toEqual([id]);
    });

    it("takes the clippings that have waited longest first, so a held backlog rotates", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await saveMany(ana, SWEEP_BATCH_SIZE + 1, "ana");
      fixture.advanceClock(HOUR);
      const bens = await save(ben, "https://example.com/ben");
      fixture.advanceClock(2 * HOUR);

      const first = await fixture.service.sweepStuck();
      expect(first).toHaveLength(SWEEP_BATCH_SIZE);
      expect(first).not.toContain(bens);

      // The first batch's status time moved on, so the one left behind and Ben's come first.
      fixture.advanceClock(DAY);
      const second = await fixture.service.sweepStuck();
      expect(second).toHaveLength(SWEEP_BATCH_SIZE);
      expect(second).toContain(bens);
    });
  });

  it("does not hold a clipping that fails for another reason", async () => {
    const ana = await fixture.createUser("ana");
    fixture.web.set("https://example.com/gone", { error: new Error("404") });
    const id = await save(ana, "https://example.com/gone");

    expect(await fixture.service.enrichClipping(id, { lastAttempt: true })).toBe("failed");
    expect((await fixture.service.getClipping(ana, id))?.status).toBe("failed");
  });

  it("saves a reading without its embedding when only the embedding is refused", async () => {
    const ana = await fixture.createUser("ana");
    const id = await save(ana);
    fixture.setEmbeddingCapReached(true);

    const outcome = await fixture.service.enrichClipping(id);

    expect(outcome).toBe("ready");
    expect(await fixture.service.embedMissing()).toBe(0);
    fixture.setEmbeddingCapReached(false);
    expect(await fixture.service.embedMissing()).toBe(1);
  });

  it("embeds the missing clippings per user, and a user at their cap waits while others go on", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    fixture.setEmbedding("down");
    fixture.web.set("https://example.com/ben", essay);
    const anas = await save(ana);
    const bens = await save(ben, "https://example.com/ben");
    await fixture.service.enrichClipping(anas);
    await fixture.service.enrichClipping(bens);
    fixture.setEmbedding("up");
    fixture.capEmbeddingFor(ana);

    const embedded = await fixture.service.embedMissing();

    expect(embedded).toBe(1);
    expect(fixture.embeddedFor).toEqual([{ userId: ben, jobKind: "enrich" }]);
  });

  it("falls back to keyword results when the search query's embedding is refused", async () => {
    const ana = await fixture.createUser("ana");
    const id = await save(ana);
    await fixture.service.enrichClipping(id);
    fixture.setEmbeddingCapReached(true);

    const { items } = await fixture.service.searchClippings(ana, { q: "gardening" });

    expect(items.map((hit) => hit.clipping.id)).toEqual([id]);
    // Search embedded nothing, and it is not billed as an enrichment.
    expect(fixture.embeddedFor.filter((owner) => owner.jobKind === "search")).toEqual([]);
  });

  it("asks for the query embedding on behalf of the searching user's search job", async () => {
    const ana = await fixture.createUser("ana");
    await fixture.service.searchClippings(ana, { q: "gardening" });

    expect(fixture.embeddedFor).toEqual([{ userId: ana, jobKind: "search" }]);
  });
});
