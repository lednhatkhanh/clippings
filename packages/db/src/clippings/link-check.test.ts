import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";

const DAY = 24 * 60 * 60 * 1000;

describe.skipIf(!TEST_DATABASE_URL)("the link check", () => {
  let fixture: ServiceFixture;
  let ana: string;

  beforeEach(async () => {
    fixture = await createServiceFixture();
    ana = await fixture.createUser("ana");
  });

  afterEach(async () => {
    await fixture.close();
  });

  const urlOf = (name: string) => `https://example.com/${name}`;

  /**
   * Saves a clipping of `/name` and reads it, so it is ready, then forgets the check the reading
   * counts as, so it is due like a clipping read long ago.
   */
  async function saveReady(name: string, userId = ana) {
    const url = urlOf(name);
    fixture.web.set(url, {
      page: { title: name, text: `Text of ${name}.` },
      summary: { title: name, summary: `About ${name}.`, excerpt: name },
    });
    const { clipping } = await fixture.service.saveClipping(userId, { url, source: "web" });
    await fixture.service.enrichClipping(clipping.id);
    await fixture.pool.query("update clippings set link_checked_at = null where id = $1", [
      clipping.id,
    ]);
    return clipping.id;
  }

  const deadSince = async (id: string) =>
    (await fixture.service.getClipping(ana, id))?.linkDeadSince;

  /** Runs the check `days` after the last step, long enough that a link checked then is due. */
  async function checkAfter(days: number, limit = 100) {
    fixture.advanceClock(days * DAY);
    return fixture.service.checkLinks({ limit });
  }

  it("checks a ready clipping that was never checked, and reports the counts", async () => {
    await saveReady("alive");
    await saveReady("gone");
    fixture.links.set(urlOf("gone"), "dead");

    const result = await fixture.service.checkLinks({ limit: 10 });

    expect(result).toEqual({ checked: 2, dead: 1 });
    expect([...fixture.checkedLinks].sort()).toEqual([urlOf("alive"), urlOf("gone")]);
  });

  it("leaves pending, failed and deleted clippings alone", async () => {
    const { clipping: pending } = await fixture.service.saveClipping(ana, {
      url: urlOf("pending"),
      source: "web",
    });
    fixture.web.set(urlOf("failed"), { error: new Error("no") });
    const { clipping: failed } = await fixture.service.saveClipping(ana, {
      url: urlOf("failed"),
      source: "web",
    });
    await fixture.service.enrichClipping(failed.id, { lastAttempt: true });
    const deleted = await saveReady("deleted");
    await fixture.service.deleteClipping(ana, deleted);
    await saveReady("ready");

    expect(pending.status).toBe("pending");
    expect(await fixture.service.checkLinks({ limit: 10 })).toEqual({ checked: 1, dead: 0 });
    expect(fixture.checkedLinks).toEqual([urlOf("ready")]);
  });

  it("checks every user's clippings, since it is a system job", async () => {
    const ben = await fixture.createUser("ben");
    await saveReady("one");
    await saveReady("two", ben);

    expect(await fixture.service.checkLinks({ limit: 10 })).toEqual({ checked: 2, dead: 0 });
  });

  describe("how often", () => {
    it("leaves a clipping alone for a week after it was read, which just fetched the page", async () => {
      const { clipping } = await fixture.service.saveClipping(ana, {
        url: urlOf("fresh"),
        source: "web",
      });
      fixture.web.set(urlOf("fresh"), {
        page: { title: "fresh", text: "Fresh." },
        summary: { title: "fresh", summary: "Fresh.", excerpt: "Fresh" },
      });
      await fixture.service.enrichClipping(clipping.id);

      expect((await checkAfter(6)).checked).toBe(0);
      expect((await checkAfter(2)).checked).toBe(1);
    });

    it("checks a link again only once its last check is more than 7 days old", async () => {
      await saveReady("page");
      await fixture.service.checkLinks({ limit: 10 });

      expect((await checkAfter(6)).checked).toBe(0);
      expect((await checkAfter(1)).checked).toBe(0); // exactly 7 days
      fixture.advanceClock(1000);
      expect((await fixture.service.checkLinks({ limit: 10 })).checked).toBe(1);
      expect(fixture.checkedLinks).toEqual([urlOf("page"), urlOf("page")]);
    });

    it("takes at most the limit, never-checked first and then the longest unchecked", async () => {
      const a = await saveReady("a");
      await fixture.service.checkLinks({ limit: 10 }); // a at day 0
      fixture.advanceClock(DAY);
      await saveReady("b");
      await fixture.service.checkLinks({ limit: 10 }); // b at day 1; a is not due
      fixture.advanceClock(8 * DAY);
      await saveReady("c"); // never checked
      fixture.checkedLinks.length = 0;

      await fixture.service.checkLinks({ limit: 2 });
      expect(fixture.checkedLinks).toEqual([urlOf("c"), urlOf("a")]);

      fixture.checkedLinks.length = 0;
      await fixture.service.checkLinks({ limit: 1 });
      expect(fixture.checkedLinks).toEqual([urlOf("b")]);
      expect(await deadSince(a)).toBeNull();
    });
  });

  describe("a link whose site won't say", () => {
    it("is neither a strike nor a reset", async () => {
      const id = await saveReady("walled");
      const url = urlOf("walled");
      fixture.links.set(url, "dead");
      await fixture.service.checkLinks({ limit: 10 });
      await checkAfter(8);
      fixture.links.set(url, "unknown");
      expect(await checkAfter(8)).toEqual({ checked: 1, dead: 0 });
      // Still two strikes: the next dead answer is the third.
      fixture.links.set(url, "dead");
      await checkAfter(8);
      expect(await deadSince(id)).not.toBeNull();
    });

    it("only stamps the check, so the link waits a week for the next one", async () => {
      await saveReady("walled");
      fixture.links.set(urlOf("walled"), "unknown");
      await fixture.service.checkLinks({ limit: 10 });

      expect((await checkAfter(6)).checked).toBe(0);
    });

    it("does not clear a dead mark", async () => {
      const id = await saveReady("walled");
      const url = urlOf("walled");
      fixture.links.set(url, "dead");
      await fixture.service.checkLinks({ limit: 10 });
      await checkAfter(8);
      await checkAfter(8);
      const first = await deadSince(id);

      fixture.links.set(url, "unknown");
      await checkAfter(8);

      expect(await deadSince(id)).toBe(first);
    });
  });

  describe("a clipping that starts over", () => {
    async function makeDead(name: string) {
      const id = await saveReady(name);
      fixture.links.set(urlOf(name), "dead");
      await fixture.service.checkLinks({ limit: 10 });
      await checkAfter(8);
      await checkAfter(8);
      expect(await deadSince(id)).not.toBeNull();
      return id;
    }

    it("is not dead any more when deleted and saved again", async () => {
      const id = await makeDead("revived");
      await fixture.service.deleteClipping(ana, id);

      await fixture.service.saveClipping(ana, { url: urlOf("revived"), source: "web" });

      expect(await deadSince(id)).toBeNull();
    });

    it("is not dead any more when deleted and imported again", async () => {
      const id = await makeDead("revived");
      await fixture.service.deleteClipping(ana, id);

      await fixture.service.importClippings(
        ana,
        [{ url: urlOf("revived"), addedAt: null, folders: [] }],
        { foldersAsTags: false },
      );

      expect(await deadSince(id)).toBeNull();
    });

    it("starts the count over: the old strikes don't carry into the new life", async () => {
      const id = await makeDead("revived");
      await fixture.service.deleteClipping(ana, id);
      await fixture.service.saveClipping(ana, { url: urlOf("revived"), source: "web" });
      await fixture.service.enrichClipping(id);

      // Two strikes in the new life are not three.
      await checkAfter(8);
      await checkAfter(8);
      expect(await deadSince(id)).toBeNull();
      await checkAfter(8);
      expect(await deadSince(id)).not.toBeNull();
    });

    it("is not dead any more once it is read again, and is not checked for a week", async () => {
      const id = await makeDead("reread");
      await fixture.service.reEnrichClipping(ana, id);
      await fixture.service.enrichClipping(id);

      expect(await deadSince(id)).toBeNull();
      expect((await checkAfter(6)).checked).toBe(0);
    });
  });

  describe("a check that overlaps something else", () => {
    const rows = (id: string) =>
      fixture.pool.query<{ link_failures: number; link_checked_at: Date | null }>(
        "select link_failures, link_checked_at from clippings where id = $1",
        [id],
      );

    it("counts one strike when two runs check the same link at once", async () => {
      const id = await saveReady("twice");
      fixture.links.set(urlOf("twice"), "dead");
      // Both runs have chosen the link before either writes.
      let inFlight = 0;
      let release!: () => void;
      const bothIn = new Promise<void>((resolve) => (release = resolve));
      fixture.duringLinkCheck.set(urlOf("twice"), async () => {
        if (++inFlight === 2) release();
        await bothIn;
      });

      const results = await Promise.all([
        fixture.service.checkLinks({ limit: 10 }),
        fixture.service.checkLinks({ limit: 10 }),
      ]);

      expect(results.map((result) => result.checked).toSorted((a, b) => a - b)).toEqual([0, 1]);
      expect(results.reduce((sum, result) => sum + result.dead, 0)).toBe(1);
      expect((await rows(id)).rows[0]!.link_failures).toBe(1);
    });

    it("writes nothing for a clipping deleted and saved and read again while it was checked", async () => {
      const id = await saveReady("replaced");
      fixture.links.set(urlOf("replaced"), "dead");
      fixture.duringLinkCheck.set(urlOf("replaced"), async () => {
        await fixture.service.deleteClipping(ana, id);
        await fixture.service.saveClipping(ana, { url: urlOf("replaced"), source: "web" });
        await fixture.service.enrichClipping(id);
      });

      expect(await fixture.service.checkLinks({ limit: 10 })).toEqual({ checked: 0, dead: 0 });

      expect((await rows(id)).rows[0]!.link_failures).toBe(0);
    });

    it("writes nothing for a clipping deleted while it was checked", async () => {
      const id = await saveReady("removed");
      fixture.links.set(urlOf("removed"), "dead");
      fixture.duringLinkCheck.set(urlOf("removed"), async () => {
        await fixture.service.deleteClipping(ana, id);
      });

      expect(await fixture.service.checkLinks({ limit: 10 })).toEqual({ checked: 0, dead: 0 });

      expect((await rows(id)).rows[0]).toEqual({ link_failures: 0, link_checked_at: null });
    });
  });

  describe("a link that stops answering", () => {
    it("is marked dead at the third failed check in a row, as of that check", async () => {
      const id = await saveReady("rotting");
      fixture.links.set(urlOf("rotting"), "dead");

      await fixture.service.checkLinks({ limit: 10 });
      expect(await deadSince(id)).toBeNull();
      await checkAfter(8);
      expect(await deadSince(id)).toBeNull();
      await checkAfter(8);
      expect(await deadSince(id)).toBe("2026-10-17T09:00:00.000Z");
    });

    it("keeps the first time it was found dead through further failures", async () => {
      const id = await saveReady("rotting");
      fixture.links.set(urlOf("rotting"), "dead");
      await fixture.service.checkLinks({ limit: 10 });
      await checkAfter(8);
      await checkAfter(8);
      const first = await deadSince(id);

      await checkAfter(8);
      await checkAfter(8);

      expect(first).not.toBeNull();
      expect(await deadSince(id)).toBe(first);
    });

    it("starts the count over when the link answers in between", async () => {
      const id = await saveReady("flaky");
      const url = urlOf("flaky");
      fixture.links.set(url, "dead");
      await fixture.service.checkLinks({ limit: 10 });
      await checkAfter(8);
      fixture.links.set(url, "alive");
      await checkAfter(8);
      fixture.links.set(url, "dead");
      await checkAfter(8);
      await checkAfter(8);
      expect(await deadSince(id)).toBeNull();

      await checkAfter(8);
      expect(await deadSince(id)).not.toBeNull();
    });

    it("is cleared when the link answers again", async () => {
      const id = await saveReady("back");
      const url = urlOf("back");
      fixture.links.set(url, "dead");
      await fixture.service.checkLinks({ limit: 10 });
      await checkAfter(8);
      await checkAfter(8);
      expect(await deadSince(id)).not.toBeNull();

      fixture.links.set(url, "alive");
      await checkAfter(8);

      expect(await deadSince(id)).toBeNull();
    });

    it("shows on the clipping in the list too", async () => {
      const id = await saveReady("rotting");
      fixture.links.set(urlOf("rotting"), "dead");
      await fixture.service.checkLinks({ limit: 10 });
      await checkAfter(8);
      await checkAfter(8);

      const page = await fixture.service.listClippings(ana, {});
      const all = [...page.pinned, ...page.items];
      expect(all.find((clipping) => clipping.id === id)?.linkDeadSince).toBe(
        "2026-10-17T09:00:00.000Z",
      );
    });
  });
});
