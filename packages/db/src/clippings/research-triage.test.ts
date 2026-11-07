import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";
import type { ResearchVerdict } from "./ports.ts";

describe.skipIf(!TEST_DATABASE_URL)("research triage in enrichment", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  const worthIt: ResearchVerdict = {
    worth: true,
    domain: "shipping",
    reason: "A port strike changes how freight is routed.",
  };

  /** Saves a page the fake model reads with this verdict (none: it gave no verdict). */
  async function save(userId: string, url: string, research?: ResearchVerdict) {
    fixture.web.set(url, {
      page: { title: url, text: "A page." },
      summary: { title: url, summary: "About freight.", excerpt: "Freight.", research },
    });
    const { clipping } = await fixture.service.saveClipping(userId, { url, source: "web" });
    return clipping.id;
  }

  const briefsOf = async () =>
    (
      await fixture.pool.query<{
        user_id: string;
        clipping_id: string;
        domain: string;
        reason: string;
        status: string;
        mode: string;
      }>(
        `select user_id, clipping_id, domain, reason, status, mode from research_briefs order by created_at`,
      )
    ).rows;

  it("queues one brief when the verdict says the save is worth researching", async () => {
    const ana = await fixture.createUser("ana");
    const id = await save(ana, "https://example.com/strike", worthIt);

    expect(await fixture.service.enrichClipping(id)).toBe("ready");

    expect(await briefsOf()).toEqual([
      {
        user_id: ana,
        clipping_id: id,
        domain: "shipping",
        reason: "A port strike changes how freight is routed.",
        status: "queued",
        mode: "batch",
      },
    ]);
    expect((await fixture.research.getBrief(ana, id))?.status).toBe("queued");
  });

  it("gives the summarizer the user's profile and domains", async () => {
    const ana = await fixture.createUser("ana");
    await fixture.settings.updateResearchSettings(ana, {
      profile: "Backend developer at a shipping company",
      domains: ["shipping", "Rust"],
    });
    const id = await save(ana, "https://example.com/strike");

    await fixture.service.enrichClipping(id);

    expect(fixture.summarizedWithResearch).toEqual([
      { profile: "Backend developer at a shipping company", domains: ["shipping", "Rust"] },
    ]);
  });

  it("queues nothing when the verdict says the save is not worth it", async () => {
    const ana = await fixture.createUser("ana");
    const id = await save(ana, "https://example.com/recipe", {
      worth: false,
      domain: "",
      reason: "A recipe.",
    });

    expect(await fixture.service.enrichClipping(id)).toBe("ready");

    expect(await briefsOf()).toEqual([]);
  });

  it("queues nothing when the model gave no verdict", async () => {
    const ana = await fixture.createUser("ana");
    const id = await save(ana, "https://example.com/recipe");

    expect(await fixture.service.enrichClipping(id)).toBe("ready");

    expect(await briefsOf()).toEqual([]);
  });

  it("sends no research to the summarizer and queues nothing when the user has no domains", async () => {
    const ana = await fixture.createUser("ana");
    await fixture.settings.updateResearchSettings(ana, { domains: [] });
    // Even a verdict that slipped through would not queue a brief.
    const id = await save(ana, "https://example.com/strike", worthIt);

    expect(await fixture.service.enrichClipping(id)).toBe("ready");

    expect(fixture.summarizedWithResearch).toEqual([undefined]);
    expect(await briefsOf()).toEqual([]);
  });

  it("sends no research and queues nothing for a clipping that came from an import", async () => {
    const ana = await fixture.createUser("ana");
    const url = "https://example.com/old-bookmark";
    fixture.web.set(url, {
      page: { title: url, text: "A page." },
      summary: { title: url, summary: "About freight.", excerpt: "Freight.", research: worthIt },
    });
    await fixture.service.importClippings(ana, [{ url, addedAt: null, folders: [] }], {
      foldersAsTags: false,
    });
    const [imported] = (await fixture.pool.query(`select id from clippings`)).rows as {
      id: string;
    }[];

    expect(await fixture.service.enrichClipping(imported!.id)).toBe("ready");

    expect(fixture.summarizedWithResearch).toEqual([undefined]);
    expect(await briefsOf()).toEqual([]);
  });

  it("uses the default domains for a user who never changed their settings", async () => {
    const ana = await fixture.createUser("ana");
    const id = await save(ana, "https://example.com/strike");

    await fixture.service.enrichClipping(id);

    expect(fixture.summarizedWithResearch).toEqual([
      { profile: "", domains: ["shipping", "logistics"] },
    ]);
  });

  it("queues a brief for a note the user wrote", async () => {
    const ana = await fixture.createUser("ana");
    fixture.noteReadings.set("Ideas on freight routing", {
      title: "Freight routing",
      summary: "Ideas.",
      excerpt: "Ideas",
      research: worthIt,
    });
    const clipping = await fixture.service.saveNote(ana, {
      body: "Ideas on freight routing",
      source: "web",
    });

    expect(await fixture.service.enrichClipping(clipping.id)).toBe("ready");

    expect((await briefsOf()).map((brief) => brief.clipping_id)).toEqual([clipping.id]);
  });

  it("keeps the first brief when the page is read again", async () => {
    const ana = await fixture.createUser("ana");
    const id = await save(ana, "https://example.com/strike", worthIt);
    await fixture.service.enrichClipping(id);

    await fixture.service.reEnrichClipping(ana, id);
    await fixture.service.enrichClipping(id);

    expect(await briefsOf()).toHaveLength(1);
  });

  it("queues no brief for a reading that failed", async () => {
    const ana = await fixture.createUser("ana");
    const url = "https://example.com/gone";
    fixture.web.set(url, { error: new Error("404") });
    const { clipping } = await fixture.service.saveClipping(ana, { url, source: "web" });

    expect(await fixture.service.enrichClipping(clipping.id, { lastAttempt: true })).toBe("failed");

    expect(await briefsOf()).toEqual([]);
  });

  it("queues no brief while the spend cap holds the reading", async () => {
    const ana = await fixture.createUser("ana");
    const id = await save(ana, "https://example.com/strike", worthIt);
    fixture.setCapReached(true);

    expect(await fixture.service.enrichClipping(id)).toBe("held");

    expect(await briefsOf()).toEqual([]);
  });

  it("keeps users apart: each brief belongs to its clipping's owner, and each user's domains steer their own reading", async () => {
    const ana = await fixture.createUser("ana");
    const bob = await fixture.createUser("bob");
    await fixture.settings.updateResearchSettings(bob, { domains: [] });
    const anas = await save(ana, "https://example.com/a", worthIt);
    const bobs = await save(bob, "https://example.com/b", worthIt);

    await fixture.service.enrichClipping(anas);
    await fixture.service.enrichClipping(bobs);

    expect((await briefsOf()).map(({ user_id, clipping_id }) => [user_id, clipping_id])).toEqual([
      [ana, anas],
    ]);
    expect(await fixture.research.getBrief(bob, anas)).toBeNull();
    expect(await fixture.research.getBrief(ana, bobs)).toBeNull();
  });
});
