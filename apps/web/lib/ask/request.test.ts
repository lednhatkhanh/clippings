import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createServiceFixture,
  TEST_DATABASE_URL,
  type ServiceFixture,
} from "@clippings/db/testing";

import { ASK_HIT_LIMIT, ASK_MODEL, prepareAsk } from "./request.ts";
import { clippingLink, MAX_PAGE_TEXT_CHARS } from "./search-results.ts";

const ORIGIN = "https://clippings.example";

describe.skipIf(!TEST_DATABASE_URL)("preparing a question for the model", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  /** Saves a page and reads it, so it has a title, a summary and its page text. */
  async function savePage(
    userId: string,
    page: { url: string; title: string; summary: string; text: string; note?: string },
  ) {
    fixture.web.set(page.url, {
      page: { title: page.title, text: page.text },
      summary: { title: page.title, summary: page.summary, excerpt: page.text.slice(0, 80) },
    });
    const { clipping } = await fixture.service.saveClipping(userId, {
      url: page.url,
      note: page.note,
      source: "web",
    });
    await fixture.service.enrichClipping(clipping.id);
    return clipping.id;
  }

  const prepare = (userId: string, question: string) =>
    prepareAsk(fixture.service, userId, question, ORIGIN);

  it("shows the model each hit as a search result with citations on", async () => {
    const ana = await fixture.createUser("ana");
    const id = await savePage(ana, {
      url: "https://example.com/tides",
      title: "Tide tables explained",
      summary: "How to read a tide table.",
      text: "High tide comes twice a day.",
      note: "for the boat trip",
    });

    const prepared = await prepare(ana, "when is high tide");

    expect(prepared?.params).toMatchObject({
      model: ASK_MODEL,
      stream: true,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "search_result",
              source: clippingLink(ORIGIN, id),
              title: "Tide tables explained",
              citations: { enabled: true },
              content: [
                { type: "text", text: "Summary: How to read a tide table." },
                { type: "text", text: "The user's note: for the boat trip" },
                { type: "text", text: "Page text: High tide comes twice a day." },
              ],
            },
            { type: "text", text: "when is high tide" },
          ],
        },
      ],
    });
    expect([...prepared!.clippingsByLink]).toEqual([
      [clippingLink(ORIGIN, id), { id, title: "Tide tables explained" }],
    ]);
  });

  it("cuts a long page text and searches for at most eight clippings", async () => {
    const ana = await fixture.createUser("ana");
    for (let n = 0; n < ASK_HIT_LIMIT + 2; n++) {
      await savePage(ana, {
        url: `https://example.com/tide-${n}`,
        title: `Tide notes ${n}`,
        summary: "About tides.",
        text: `tide ${"x".repeat(MAX_PAGE_TEXT_CHARS * 2)}`,
      });
    }

    const prepared = await prepare(ana, "tide");

    const [message] = prepared!.params.messages;
    const results = (message!.content as { type: string; content?: { text: string }[] }[]).filter(
      (block) => block.type === "search_result",
    );
    expect(results).toHaveLength(ASK_HIT_LIMIT);
    const pageText = results[0]!.content!.at(-1)!.text;
    expect(pageText).toBe(
      `Page text: ${`tide ${"x".repeat(MAX_PAGE_TEXT_CHARS)}`.slice(0, MAX_PAGE_TEXT_CHARS)}`,
    );
  });

  it("is null when nothing the user saved matches", async () => {
    const ana = await fixture.createUser("ana");
    await savePage(ana, {
      url: "https://example.com/bread",
      title: "Bread baking",
      summary: "Sourdough basics.",
      text: "Flour, water and salt.",
    });

    expect(await prepare(ana, "quantum chromodynamics")).toBeNull();
  });

  it("keeps users apart: another user's clippings never reach the request", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    const anas = await savePage(ana, {
      url: "https://example.com/ana-tides",
      title: "Ana's tide table",
      summary: "Ana's summary of tides.",
      text: "Ana's page text about tides.",
    });
    const bens = await savePage(ben, {
      url: "https://example.com/ben-tides",
      title: "Ben's tide table",
      summary: "Ben's secret summary of tides.",
      text: "Ben's secret page text about tides.",
      note: "Ben's private note about tides",
    });

    const forAna = await prepare(ana, "tides");
    const forBen = await prepare(ben, "tides");

    const sent = JSON.stringify(forAna!.params);
    expect(sent).toContain("Ana's page text");
    expect(sent).not.toMatch(/Ben|secret/);
    expect(sent).not.toContain(bens);
    expect([...forAna!.clippingsByLink.values()].map((cited) => cited.id)).toEqual([anas]);
    expect([...forBen!.clippingsByLink.values()].map((cited) => cited.id)).toEqual([bens]);
    expect(JSON.stringify(forBen!.params)).not.toContain("Ana");
  });

  it("is null for a user whose only match belongs to someone else", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    await savePage(ben, {
      url: "https://example.com/ben-tides",
      title: "Ben's tide table",
      summary: "Summary.",
      text: "Text about tides.",
    });

    expect(await prepare(ana, "tides")).toBeNull();
  });
});
