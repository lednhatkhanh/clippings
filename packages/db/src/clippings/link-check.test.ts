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

  /** Saves a clipping of `/name` and reads it, so it is ready. */
  async function saveReady(name: string, userId = ana) {
    const url = urlOf(name);
    fixture.web.set(url, {
      page: { title: name, text: `Text of ${name}.` },
      summary: { title: name, summary: `About ${name}.`, excerpt: name },
    });
    const { clipping } = await fixture.service.saveClipping(userId, { url, source: "web" });
    await fixture.service.enrichClipping(clipping.id);
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
