import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MAX_NOTE_BODY_LENGTH } from "@clippings/shared";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";
import { EmptyNoteBodyError, NoteBodyTooLongError, NotANoteError } from "./service.ts";

describe.skipIf(!TEST_DATABASE_URL)("notes", () => {
  const HOUR = 60 * 60 * 1000;

  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
    for (const word of ["car", "automobile", "sedan"]) fixture.meanings.set(word, "car");
    for (const word of ["bread", "sourdough"]) fixture.meanings.set(word, "bread");
  });

  afterEach(async () => {
    await fixture.close();
  });

  const note = (userId: string, body: string, extra: { tags?: string[] } = {}) =>
    fixture.service.saveNote(userId, { body, source: "web", ...extra });

  /** Saves a note and lets enrichment read it. */
  async function readNote(userId: string, body: string) {
    const saved = await note(userId, body);
    await fixture.service.enrichClipping(saved.id);
    fixture.advanceClock(60_000);
    return saved.id;
  }

  describe("saving", () => {
    it("saves text with no URL as a pending note titled by its first line, and requests its reading", async () => {
      const ana = await fixture.createUser("ana");

      const saved = await note(ana, "## Gearbox ideas\n\n- a **wider** ratio\n- a lighter case", {
        tags: ["cars"],
      });

      expect(saved).toMatchObject({
        kind: "note",
        url: null,
        urlNormalized: null,
        body: "## Gearbox ideas\n\n- a **wider** ratio\n- a lighter case",
        title: "Gearbox ideas",
        note: "",
        status: "pending",
        source: "web",
        tags: [{ name: "cars" }],
      });
      expect(fixture.enrichmentRequests).toEqual([saved.id]);
      expect((await fixture.service.listClippings(ana, {})).items.map((c) => c.id)).toEqual([
        saved.id,
      ]);
    });

    it("keeps the body exactly as written", async () => {
      const ana = await fixture.createUser("ana");
      const body = "  indented\r\n\r\n\ttabbed  \n";

      const saved = await note(ana, body);

      expect((await fixture.service.getClipping(ana, saved.id))?.body).toBe(body);
    });

    it("refuses a blank body and one that is too long, saving nothing", async () => {
      const ana = await fixture.createUser("ana");

      await expect(note(ana, " \n\t ")).rejects.toThrow(EmptyNoteBodyError);
      await expect(note(ana, "x".repeat(MAX_NOTE_BODY_LENGTH + 1))).rejects.toThrow(
        NoteBodyTooLongError,
      );
      await expect(note(ana, "x".repeat(MAX_NOTE_BODY_LENGTH))).resolves.toBeDefined();
      expect((await fixture.service.listClippings(ana, {})).items).toHaveLength(1);
    });

    it("is not a duplicate of an identical note, and does not make a link a duplicate", async () => {
      const ana = await fixture.createUser("ana");

      const first = await note(ana, "same words");
      const second = await note(ana, "same words");
      const link = await fixture.service.saveClipping(ana, {
        url: "https://example.com/a",
        source: "web",
      });

      expect(new Set([first.id, second.id, link.clipping.id]).size).toBe(3);
      expect(link.status).toBe("created");
      // Duplicate detection is for links: a note has no address to match.
      expect(await fixture.service.hasClippingOfUrl(ana, "https://example.com/a")).toBe(true);
      expect(await fixture.service.hasClippingOfUrl(ana, "https://example.com/b")).toBe(false);
      expect((await fixture.service.listClippings(ana, {})).items).toHaveLength(3);
    });

    it("keeps users apart: a note is in its owner's list, search and tags alone", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      const saved = await note(ana, "my sourdough starter notes", { tags: ["baking"] });

      expect((await fixture.service.listClippings(ben, {})).items).toEqual([]);
      expect((await fixture.service.searchClippings(ben, { q: "sourdough" })).items).toEqual([]);
      expect(await fixture.service.getClipping(ben, saved.id)).toBeNull();
      expect(await fixture.service.listTags(ben)).toEqual([]);
      expect((await fixture.service.exportClippings(ben)).clippings).toEqual([]);
    });
  });

  describe("enrichment", () => {
    it("reads the body without fetching a page, keeps the title made from the body, and embeds the body", async () => {
      const ana = await fixture.createUser("ana");
      const body = "Sedan servicing\n\nChange the oil every 10,000 km.";
      fixture.noteReadings.set(body, {
        title: "A different title",
        summary: "How often to service a sedan.",
        excerpt: "Change the oil every 10,000 km.",
      });
      const saved = await note(ana, body);

      const outcome = await fixture.service.enrichClipping(saved.id);

      expect(outcome).toBe("ready");
      expect(fixture.summarizedNotes).toEqual([body]);
      expect(fixture.fetchedPages).toEqual([]);
      expect(await fixture.service.getClippingText(ana, saved.id)).toBeNull();
      // What is embedded is the body itself, for the user's cap and as "enrich" work.
      expect(fixture.embedded).toEqual([{ text: body, purpose: "document" }]);
      expect(fixture.embeddedFor).toEqual([{ userId: ana, jobKind: "enrich" }]);
      expect(await fixture.service.getClipping(ana, saved.id)).toMatchObject({
        status: "ready",
        title: "Sedan servicing",
        summary: "How often to service a sedan.",
        excerpt: "Change the oil every 10,000 km.",
        body,
      });
      // No link to verify.
      const { rows } = await fixture.pool.query<{ link_checked_at: Date | null }>(
        `select link_checked_at from clippings where id = $1`,
        [saved.id],
      );
      expect(rows[0]?.link_checked_at).toBeNull();
    });

    it("holds a note the cap refuses: it stays pending and the sweep takes it again later", async () => {
      const ana = await fixture.createUser("ana");
      const saved = await note(ana, "a thought");
      fixture.setCapReached(true);

      const outcome = await fixture.service.enrichClipping(saved.id, { lastAttempt: true });

      expect(outcome).toBe("held");
      expect((await fixture.service.getClipping(ana, saved.id))?.status).toBe("pending");
      fixture.setCapReached(false);
      fixture.advanceClock(2 * HOUR);
      expect(await fixture.service.sweepStuck()).toEqual([saved.id]);
    });

    it("saves the reading without an embedding when only the embedder refuses, and embedMissing embeds the body later", async () => {
      const ana = await fixture.createUser("ana");
      const saved = await note(ana, "sourdough hydration");
      fixture.setEmbeddingCapReached(true);

      expect(await fixture.service.enrichClipping(saved.id)).toBe("ready");
      fixture.setEmbeddingCapReached(false);
      expect(await fixture.service.embedMissing()).toBe(1);

      expect(fixture.embedded).toEqual([{ text: "sourdough hydration", purpose: "document" }]);
    });

    it("does not overwrite a body edited while the note was being read", async () => {
      const ana = await fixture.createUser("ana");
      const saved = await note(ana, "sedan draft");
      fixture.duringNoteReading.set("sedan draft", async () => {
        await fixture.service.updateClipping(ana, saved.id, { body: "sourdough draft" });
      });

      const outcome = await fixture.service.enrichClipping(saved.id);

      // The reading was of the old text: it doesn't land, and the edit's own embedding stands.
      expect(outcome).toBe("skipped");
      expect(await fixture.service.getClipping(ana, saved.id)).toMatchObject({
        body: "sourdough draft",
        status: "pending",
        summary: null,
      });
      const byMeaning = async (q: string) =>
        (await fixture.service.searchClippings(ana, { q })).items.map((hit) => hit.clipping.id);
      expect(await byMeaning("bread")).toEqual([saved.id]);
      expect(await byMeaning("automobile")).toEqual([]);
    });

    it("starts a failed note over on retry, and leaves a ready note alone", async () => {
      const ana = await fixture.createUser("ana");
      const ready = await readNote(ana, "this one reads fine");
      const failing = await note(ana, "this one fails");
      fixture.duringNoteReading.set("this one fails", async () => {
        throw new Error("the model is down");
      });
      await fixture.service.enrichClipping(failing.id, { lastAttempt: true });
      expect((await fixture.service.getClipping(ana, failing.id))?.status).toBe("failed");
      fixture.enrichmentRequests.length = 0;

      expect((await fixture.service.reEnrichClipping(ana, ready))?.status).toBe("ready");
      expect((await fixture.service.reEnrichClipping(ana, failing.id))?.status).toBe("pending");

      // A ready note has no page to read again; only the failed one was requested.
      expect(fixture.enrichmentRequests).toEqual([failing.id]);
    });
  });

  describe("editing the body", () => {
    it("re-embeds the new body, follows it with the title and clears the summary that described the old text", async () => {
      const ana = await fixture.createUser("ana");
      const id = await readNote(ana, "Sedan servicing\n\nOil every 10,000 km.");
      fixture.embedded.length = 0;
      fixture.embeddedFor.length = 0;

      const updated = await fixture.service.updateClipping(ana, id, {
        body: "# Sourdough starter\n\nFeed it twice a day.",
      });

      expect(updated).toMatchObject({
        body: "# Sourdough starter\n\nFeed it twice a day.",
        title: "Sourdough starter",
        summary: null,
        excerpt: null,
        status: "ready",
      });
      expect(fixture.embedded).toEqual([
        { text: "# Sourdough starter\n\nFeed it twice a day.", purpose: "document" },
      ]);
      expect(fixture.embeddedFor).toEqual([{ userId: ana, jobKind: "enrich" }]);
      // Search follows what the note says now, by meaning and by words.
      const bread = await fixture.service.searchClippings(ana, { q: "bread" });
      expect(bread.items.map((hit) => hit.clipping.id)).toEqual([id]);
      expect((await fixture.service.searchClippings(ana, { q: "sedan" })).items).toEqual([]);
    });

    it("saves the new body without an embedding while the cap is reached, and embedMissing catches up", async () => {
      const ana = await fixture.createUser("ana");
      const id = await readNote(ana, "sedan notes");
      fixture.setEmbeddingCapReached(true);

      const updated = await fixture.service.updateClipping(ana, id, { body: "sourdough notes" });

      expect(updated?.body).toBe("sourdough notes");
      // Without an embedding the old meaning must not linger: the note is found by words only.
      expect((await fixture.service.searchClippings(ana, { q: "bread" })).items).toEqual([]);
      fixture.setEmbeddingCapReached(false);
      expect(await fixture.service.embedMissing()).toBe(1);
      expect(
        (await fixture.service.searchClippings(ana, { q: "bread" })).items.map(
          (h) => h.clipping.id,
        ),
      ).toEqual([id]);
    });

    it("refuses a blank or too long body, and a body for a link", async () => {
      const ana = await fixture.createUser("ana");
      const id = await readNote(ana, "keep me");
      const { clipping: link } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/a",
        source: "web",
      });

      await expect(fixture.service.updateClipping(ana, id, { body: "  " })).rejects.toThrow(
        EmptyNoteBodyError,
      );
      await expect(
        fixture.service.updateClipping(ana, id, { body: "x".repeat(MAX_NOTE_BODY_LENGTH + 1) }),
      ).rejects.toThrow(NoteBodyTooLongError);
      await expect(
        fixture.service.updateClipping(ana, link.id, { body: "text for a link" }),
      ).rejects.toThrow(NotANoteError);

      expect((await fixture.service.getClipping(ana, id))?.body).toBe("keep me");
      expect((await fixture.service.getClipping(ana, link.id))?.body).toBeNull();
    });

    it("keeps users apart: another user's edit finds nothing and changes nothing", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      const id = await readNote(ana, "ana's private note");
      fixture.embedded.length = 0;

      const updated = await fixture.service.updateClipping(ben, id, { body: "ben was here" });

      expect(updated).toBeNull();
      // Not even an embedding is spent on text for a note that isn't theirs.
      expect(fixture.embedded).toEqual([]);
      expect((await fixture.service.getClipping(ana, id))?.body).toBe("ana's private note");
    });

    it("still takes a title, a comment and tags like any clipping", async () => {
      const ana = await fixture.createUser("ana");
      const id = await readNote(ana, "some body");

      const updated = await fixture.service.updateClipping(ana, id, {
        title: "My name for it",
        note: "a comment",
        tags: ["idea"],
      });

      expect(updated).toMatchObject({
        title: "My name for it",
        titleEdited: true,
        note: "a comment",
        tags: [{ name: "idea" }],
        body: "some body",
      });
    });
  });

  describe("finding notes", () => {
    it("finds a note by the words in its body, with a snippet from the body", async () => {
      const ana = await fixture.createUser("ana");
      const body = "Weekend plan\n\nRemember to repot the monstera before it outgrows the pot.";
      const id = await readNote(ana, body);
      await readNote(ana, "Something unrelated");

      const { items } = await fixture.service.searchClippings(ana, { q: "monstera" });

      expect(items.map((hit) => hit.clipping.id)).toEqual([id]);
      expect(items[0]?.highlights.snippet?.filter((s) => s.match).map((s) => s.text)).toEqual([
        "monstera",
      ]);
    });

    it("finds a note by meaning and relates it to a link close in meaning", async () => {
      const ana = await fixture.createUser("ana");
      fixture.web.set("https://example.com/car", {
        page: { title: "Sedan review", text: "" },
        summary: { title: "Sedan review", summary: "", excerpt: "" },
      });
      const { clipping: link } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/car",
        source: "web",
      });
      await fixture.service.enrichClipping(link.id);
      const id = await readNote(ana, "thinking about an automobile for the commute");
      await readNote(ana, "sourdough");

      const found = await fixture.service.searchClippings(ana, { q: "sedan" });
      const related = await fixture.service.relatedClippings(ana, link.id);

      expect(found.items.map((hit) => hit.clipping.id).toSorted()).toEqual(
        [id, link.id].toSorted(),
      );
      expect(related.map((clipping) => clipping.id)).toEqual([id]);
      expect(related[0]).toMatchObject({ kind: "note", url: null });
    });

    it("lists notes among links, under the same tag filter", async () => {
      const ana = await fixture.createUser("ana");
      const tagged = await note(ana, "a tagged note", { tags: ["work"] });
      await note(ana, "an untagged note");
      const { clipping: link } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/a",
        tags: ["work"],
        source: "web",
      });

      const page = await fixture.service.listClippings(ana, { tags: ["work"] });

      expect(page.items.map((clipping) => clipping.id).toSorted()).toEqual(
        [tagged.id, link.id].toSorted(),
      );
      expect(page.items.map((clipping) => clipping.kind).toSorted()).toEqual(["link", "note"]);
    });
  });

  describe("deleting, link checks and export", () => {
    it("deletes and restores a note within 24 hours, then purges it for good", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      const id = await readNote(ana, "to be deleted");

      expect(await fixture.service.deleteClipping(ben, id)).toBe(false);
      expect(await fixture.service.deleteClipping(ana, id)).toBe(true);
      expect(await fixture.service.getClipping(ana, id)).toBeNull();
      expect((await fixture.service.searchClippings(ana, { q: "deleted" })).items).toEqual([]);
      expect(await fixture.service.restoreClipping(ben, id)).toBe(false);
      expect(await fixture.service.restoreClipping(ana, id)).toBe(true);
      expect((await fixture.service.getClipping(ana, id))?.body).toBe("to be deleted");

      await fixture.service.deleteClipping(ana, id);
      fixture.advanceClock(25 * HOUR);
      expect(await fixture.service.purgeDeleted()).toBe(1);
      expect(await fixture.service.restoreClipping(ana, id)).toBe(false);
    });

    it("leaves notes out of link checks", async () => {
      const ana = await fixture.createUser("ana");
      await readNote(ana, "no link to check");
      fixture.web.set("https://example.com/a", {
        page: { title: "A", text: "" },
        summary: { title: "A", summary: "", excerpt: "" },
      });
      const { clipping: link } = await fixture.service.saveClipping(ana, {
        url: "https://example.com/a",
        source: "web",
      });
      await fixture.service.enrichClipping(link.id);
      // Reading the link counted as a check; a week on, both are due.
      fixture.advanceClock(8 * 24 * HOUR);

      const result = await fixture.service.checkLinks({ limit: 10 });

      expect(result).toEqual({ checked: 1, dead: 0 });
      expect(fixture.checkedLinks).toEqual(["https://example.com/a"]);
    });

    it("exports a note with its body and no address", async () => {
      const ana = await fixture.createUser("ana");
      const id = await readNote(ana, "exported text");

      const { clippings } = await fixture.service.exportClippings(ana);

      expect(clippings).toHaveLength(1);
      expect(clippings[0]).toMatchObject({ id, kind: "note", url: null, body: "exported text" });
    });
  });
});
