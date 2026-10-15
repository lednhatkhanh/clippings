import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture";
import { TEST_DATABASE_URL } from "../test/temp-database";
import { InvalidUrlError } from "./service";

describe.skipIf(!TEST_DATABASE_URL)("clippings service", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

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
  });

  it("updates the note of one's own clipping, and not anyone else's", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    const { clipping } = await fixture.service.saveClipping(ana, {
      url: "https://example.com/a",
      note: "before",
      source: "web",
    });

    const foreign = await fixture.service.updateNote(ben, clipping.id, "hijacked");
    const own = await fixture.service.updateNote(ana, clipping.id, "after");

    expect(foreign).toBeNull();
    expect(own?.note).toBe("after");
    const page = await fixture.service.listClippings(ana, {});
    expect(page.items[0]?.note).toBe("after");
  });
});
