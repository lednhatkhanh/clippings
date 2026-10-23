import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";

describe.skipIf(!TEST_DATABASE_URL)("the page text the browser sends with a save", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  const DAY = 24 * 60 * 60 * 1000;
  const URL = "https://example.com/essay";
  const SAVED_AT = "2026-10-01T09:00:00.000Z";

  const summary = {
    title: "An essay about gardening",
    summary: "Why small gardens beat big ones.",
    excerpt: "A long essay about gardening",
  };
  const page = { title: "Essay (as the browser shows it)", text: "What the browser showed." };

  /** The server is turned away, as a bot wall does. */
  function blockServer() {
    fixture.web.set(URL, { error: new Error("403"), summary });
  }

  function openServer(text = "What the server fetched.") {
    fixture.web.set(URL, { page: { title: "Essay | Example", text }, summary });
  }

  /** The columns `getClippingText` doesn't show: who read the text, and whether a reading used it. */
  async function stored(clippingId: string) {
    const { rows } = await fixture.pool.query<{
      user_id: string;
      origin: string;
      title: string | null;
      read: boolean;
    }>(
      `select user_id, origin, title, read_at is not null as read from clipping_texts where clipping_id = $1`,
      [clippingId],
    );
    return rows.map(({ user_id, origin, title, read }) => ({
      userId: user_id,
      origin,
      title,
      read,
    }));
  }

  async function textOf(userId: string, clippingId: string) {
    return (await fixture.service.getClippingText(userId, clippingId))?.text;
  }

  it("makes a new clipping ready from the browser's text without fetching the page", async () => {
    const ana = await fixture.createUser("ana");
    blockServer();

    const { status, clipping } = await fixture.service.saveClipping(ana, {
      url: URL,
      source: "extension",
      page,
    });
    expect(status).toBe("created");
    expect(clipping.status).toBe("pending");
    expect(fixture.enrichmentRequests).toEqual([clipping.id]);

    expect(await fixture.service.enrichClipping(clipping.id)).toBe("ready");

    expect(fixture.fetchedPages).toEqual([]);
    expect(fixture.summarizedPages).toEqual([{ url: URL, ...page }]);
    expect(await fixture.service.getClipping(ana, clipping.id)).toMatchObject({
      status: "ready",
      summary: summary.summary,
    });
    expect(await fixture.service.getClippingText(ana, clipping.id)).toMatchObject({
      text: page.text,
      fetchedAt: SAVED_AT,
    });
    expect(await stored(clipping.id)).toEqual([
      { userId: ana, origin: "browser", title: page.title, read: true },
    ]);
  });

  it("still fetches the page when the save comes without one", async () => {
    const ana = await fixture.createUser("ana");
    openServer();

    const { clipping } = await fixture.service.saveClipping(ana, { url: URL, source: "web" });
    expect(await fixture.service.enrichClipping(clipping.id)).toBe("ready");

    expect(fixture.fetchedPages).toEqual([URL]);
    expect(fixture.summarizedPages).toEqual([
      { url: URL, title: "Essay | Example", text: "What the server fetched." },
    ]);
    expect(await textOf(ana, clipping.id)).toBe("What the server fetched.");
    expect(await stored(clipping.id)).toMatchObject([{ origin: "fetch", title: null }]);
  });

  it("fetches on a re-read, and writes what it fetched over the browser's text", async () => {
    const ana = await fixture.createUser("ana");
    blockServer();
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: URL,
      source: "extension",
      page,
    });
    await fixture.service.enrichClipping(clipping.id);

    fixture.advanceClock(DAY);
    openServer();
    await fixture.service.reEnrichClipping(ana, clipping.id);
    await fixture.service.enrichClipping(clipping.id);

    expect(fixture.fetchedPages).toEqual([URL]);
    expect(await textOf(ana, clipping.id)).toBe("What the server fetched.");
    expect(await stored(clipping.id)).toMatchObject([{ origin: "fetch", title: null }]);
  });

  it("falls back to the browser's text when a re-read can't fetch the page", async () => {
    const ana = await fixture.createUser("ana");
    blockServer();
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: URL,
      source: "extension",
      page,
    });
    await fixture.service.enrichClipping(clipping.id);

    fixture.advanceClock(DAY);
    await fixture.service.reEnrichClipping(ana, clipping.id);
    expect(await fixture.service.enrichClipping(clipping.id)).toBe("ready");

    expect(fixture.fetchedPages).toEqual([URL]);
    expect(fixture.summarizedPages.at(-1)).toEqual({ url: URL, ...page });
    expect(await fixture.service.getClipping(ana, clipping.id)).toMatchObject({ status: "ready" });
    // The text keeps who read it and when, though this reading used it again.
    expect(await fixture.service.getClippingText(ana, clipping.id)).toMatchObject({
      text: page.text,
      fetchedAt: SAVED_AT,
    });
    expect(await stored(clipping.id)).toMatchObject([{ origin: "browser", title: page.title }]);
  });

  it("falls back to the browser's text when a re-read fetches a page with no text", async () => {
    const ana = await fixture.createUser("ana");
    blockServer();
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: URL,
      source: "extension",
      page,
    });
    await fixture.service.enrichClipping(clipping.id);

    // A login wall answers 200 with a page that has nothing to read.
    fixture.advanceClock(DAY);
    openServer("");
    await fixture.service.reEnrichClipping(ana, clipping.id);
    expect(await fixture.service.enrichClipping(clipping.id)).toBe("ready");

    expect(fixture.fetchedPages).toEqual([URL]);
    expect(fixture.summarizedPages.at(-1)).toEqual({ url: URL, ...page });
    expect(await textOf(ana, clipping.id)).toBe(page.text);
    expect(await stored(clipping.id)).toMatchObject([{ origin: "browser" }]);
  });

  it("takes a PDF the fetch reads as a reading, not as an empty page", async () => {
    const ana = await fixture.createUser("ana");
    blockServer();
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: URL,
      source: "extension",
      page,
    });
    await fixture.service.enrichClipping(clipping.id);

    fixture.advanceClock(DAY);
    fixture.web.set(URL, {
      page: {
        title: "Paper",
        text: "",
        document: { mediaType: "application/pdf", data: "JVBERi0=" },
      },
      summary,
    });
    await fixture.service.reEnrichClipping(ana, clipping.id);
    expect(await fixture.service.enrichClipping(clipping.id)).toBe("ready");

    // The PDF has no text of its own, and the old browser text must not outlive the re-read.
    expect(await fixture.service.getClippingText(ana, clipping.id)).toBeNull();
    expect(await stored(clipping.id)).toEqual([]);
  });

  it("keeps the link verdict when the reading used the browser's text", async () => {
    const ana = await fixture.createUser("ana");
    blockServer();
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: URL,
      source: "extension",
      page,
    });
    await fixture.service.enrichClipping(clipping.id);
    await fixture.pool.query(
      `update clippings set link_checked_at = now(), link_failures = 3, link_dead_since = now() where id = $1`,
      [clipping.id],
    );
    const dead = await fixture.service.getClipping(ana, clipping.id);
    expect(dead?.linkDeadSince).not.toBeNull();

    // Retry: the fetch finds the page gone, and the reading falls back to the browser's text.
    fixture.advanceClock(DAY);
    fixture.web.set(URL, { error: new Error("404"), summary });
    await fixture.service.reEnrichClipping(ana, clipping.id);
    expect(await fixture.service.enrichClipping(clipping.id)).toBe("ready");

    expect(await fixture.service.getClipping(ana, clipping.id)).toMatchObject({
      status: "ready",
      linkDeadSince: dead?.linkDeadSince,
    });
  });

  it("clears the link verdict when a reading fetched the page", async () => {
    const ana = await fixture.createUser("ana");
    openServer();
    const { clipping } = await fixture.service.saveClipping(ana, { url: URL, source: "web" });
    await fixture.service.enrichClipping(clipping.id);
    await fixture.pool.query(
      `update clippings set link_failures = 3, link_dead_since = now() where id = $1`,
      [clipping.id],
    );

    await fixture.service.reEnrichClipping(ana, clipping.id);
    await fixture.service.enrichClipping(clipping.id);

    expect((await fixture.service.getClipping(ana, clipping.id))?.linkDeadSince).toBeNull();
  });

  it("fails a clipping only when it has no text to fall back on", async () => {
    const ana = await fixture.createUser("ana");
    blockServer();
    const { clipping } = await fixture.service.saveClipping(ana, { url: URL, source: "web" });

    await expect(fixture.service.enrichClipping(clipping.id)).rejects.toThrow("403");
    expect(await fixture.service.enrichClipping(clipping.id, { lastAttempt: true })).toBe("failed");
  });

  it("reads the browser's text on a retry of the job, without fetching", async () => {
    const ana = await fixture.createUser("ana");
    blockServer();
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: URL,
      source: "extension",
      page,
    });
    // The first delivery died after the save; the redelivery finds the same pending clipping.
    fixture.advanceClock(1000);

    expect(await fixture.service.enrichClipping(clipping.id)).toBe("ready");
    expect(fixture.fetchedPages).toEqual([]);
  });

  it("reads the browser's text, not a fetch, when the queue was down and the sweep restarted it", async () => {
    const ana = await fixture.createUser("ana");
    fixture.setPublishing("down");
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: URL,
      source: "extension",
      page,
    });
    fixture.setPublishing("up");
    fixture.advanceClock(2 * 60 * 60 * 1000);
    expect(await fixture.service.sweepStuck()).toEqual([clipping.id]);
    // The page now answers 200, with a wall in place of the article.
    openServer("Please sign in to continue.");

    expect(await fixture.service.enrichClipping(clipping.id)).toBe("ready");

    expect(fixture.fetchedPages).toEqual([]);
    expect(await textOf(ana, clipping.id)).toBe(page.text);
  });

  it("restarts a failed clipping when it is saved again with a page", async () => {
    const ana = await fixture.createUser("ana");
    blockServer();
    const { clipping } = await fixture.service.saveClipping(ana, { url: URL, source: "web" });
    await fixture.service.enrichClipping(clipping.id, { lastAttempt: true });
    expect((await fixture.service.getClipping(ana, clipping.id))?.status).toBe("failed");
    fixture.advanceClock(DAY);

    const again = await fixture.service.saveClipping(ana, {
      url: URL,
      source: "extension",
      page,
    });

    expect(again).toMatchObject({
      status: "existing",
      clipping: { id: clipping.id, status: "pending" },
    });
    expect(fixture.enrichmentRequests).toEqual([clipping.id, clipping.id]);
    fixture.advanceClock(1000);
    const fetchesBefore = fixture.fetchedPages.length;

    expect(await fixture.service.enrichClipping(clipping.id)).toBe("ready");

    expect(fixture.fetchedPages).toHaveLength(fetchesBefore);
    expect(fixture.summarizedPages.at(-1)).toEqual({ url: URL, ...page });
    expect(await fixture.service.getClippingText(ana, clipping.id)).toMatchObject({
      text: page.text,
      fetchedAt: "2026-10-02T09:00:00.000Z",
    });
  });

  it("keeps the save and the text when the queue is down for a failed clipping's restart", async () => {
    const ana = await fixture.createUser("ana");
    blockServer();
    const { clipping } = await fixture.service.saveClipping(ana, { url: URL, source: "web" });
    await fixture.service.enrichClipping(clipping.id, { lastAttempt: true });
    fixture.setPublishing("down");

    const again = await fixture.service.saveClipping(ana, {
      url: URL,
      source: "extension",
      page,
    });

    // Pending for the daily sweep to request, which then reads the stored text.
    expect(again.clipping.status).toBe("pending");
    expect(await stored(clipping.id)).toMatchObject([{ origin: "browser", read: false }]);
    fixture.setPublishing("up");
    fixture.advanceClock(2 * 60 * 60 * 1000);
    expect(await fixture.service.sweepStuck()).toEqual([clipping.id]);
    expect(await fixture.service.enrichClipping(clipping.id)).toBe("ready");
    expect(await textOf(ana, clipping.id)).toBe(page.text);
  });

  it("gives a pending clipping the browser's text and leaves its place in the queue", async () => {
    const ana = await fixture.createUser("ana");
    blockServer();
    const { clipping } = await fixture.service.saveClipping(ana, { url: URL, source: "web" });
    fixture.advanceClock(1000);

    const again = await fixture.service.saveClipping(ana, {
      url: URL,
      source: "extension",
      page,
    });

    expect(again).toMatchObject({ status: "existing", clipping: { status: "pending" } });
    expect(fixture.enrichmentRequests).toEqual([clipping.id]);
    expect(await fixture.service.enrichClipping(clipping.id)).toBe("ready");
    expect(fixture.fetchedPages).toEqual([]);
  });

  it("ignores the page when the existing clipping is ready", async () => {
    const ana = await fixture.createUser("ana");
    openServer();
    const { clipping } = await fixture.service.saveClipping(ana, { url: URL, source: "web" });
    await fixture.service.enrichClipping(clipping.id);
    const before = await fixture.service.getClipping(ana, clipping.id);
    fixture.advanceClock(DAY);

    const again = await fixture.service.saveClipping(ana, {
      url: URL,
      source: "extension",
      page,
    });

    expect(again).toEqual({ status: "existing", clipping: before });
    expect(fixture.enrichmentRequests).toEqual([clipping.id]);
    expect(await textOf(ana, clipping.id)).toBe("What the server fetched.");
  });

  it("replaces the old text when a deleted clipping is saved again with a page", async () => {
    const ana = await fixture.createUser("ana");
    openServer();
    const { clipping } = await fixture.service.saveClipping(ana, { url: URL, source: "web" });
    await fixture.service.enrichClipping(clipping.id);
    await fixture.service.deleteClipping(ana, clipping.id);
    fixture.advanceClock(DAY);

    const again = await fixture.service.saveClipping(ana, {
      url: URL,
      source: "extension",
      page,
    });

    expect(again).toMatchObject({ status: "created", clipping: { id: clipping.id } });
    // Not read yet, so it is the new reading's text and the old fetched one is gone.
    expect(await fixture.service.getClippingText(ana, clipping.id)).toBeNull();
    expect(await stored(clipping.id)).toMatchObject([{ origin: "browser", read: false }]);
  });

  it("keeps users apart: another user's save of the same page leaves the text alone", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    openServer("Ana's reading.");
    const anas = (await fixture.service.saveClipping(ana, { url: URL, source: "web" })).clipping;
    await fixture.service.enrichClipping(anas.id);

    const bens = (
      await fixture.service.saveClipping(ben, {
        url: URL,
        source: "extension",
        page: { title: null, text: "Ben's browser text." },
      })
    ).clipping;

    expect(bens.id).not.toBe(anas.id);
    expect(await textOf(ana, anas.id)).toBe("Ana's reading.");
    expect(await stored(anas.id)).toMatchObject([{ userId: ana, origin: "fetch" }]);
    expect(await stored(bens.id)).toMatchObject([{ userId: ben, origin: "browser", title: null }]);
  });

  it("keeps users apart: another user's page doesn't restart a failed clipping", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    blockServer();
    const anas = (await fixture.service.saveClipping(ana, { url: URL, source: "web" })).clipping;
    await fixture.service.enrichClipping(anas.id, { lastAttempt: true });

    await fixture.service.saveClipping(ben, { url: URL, source: "extension", page });

    expect((await fixture.service.getClipping(ana, anas.id))?.status).toBe("failed");
    expect(await stored(anas.id)).toEqual([]);
  });
});
