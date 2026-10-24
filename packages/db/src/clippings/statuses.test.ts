import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";

describe.skipIf(!TEST_DATABASE_URL)("reading the status of several clippings", () => {
  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  async function save(userId: string, url: string) {
    const { clipping } = await fixture.service.saveClipping(userId, { url, source: "web" });
    return clipping.id;
  }

  it("answers with where each clipping is in enrichment", async () => {
    const ana = await fixture.createUser("ana");
    fixture.web.set("https://example.com/ready", {
      page: { title: "Ready", text: "A page." },
      summary: { title: "Ready", summary: "", excerpt: "" },
    });
    const ready = await save(ana, "https://example.com/ready");
    await fixture.service.enrichClipping(ready);
    const pending = await save(ana, "https://example.com/pending");

    const statuses = await fixture.service.getClippingStatuses(ana, [ready, pending]);

    expect(statuses.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { id: ready, status: "ready" },
        { id: pending, status: "pending" },
      ].toSorted((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it("leaves out ids that are deleted, not UUIDs or nobody's", async () => {
    const ana = await fixture.createUser("ana");
    const kept = await save(ana, "https://example.com/kept");
    const deleted = await save(ana, "https://example.com/deleted");
    await fixture.service.deleteClipping(ana, deleted);

    const statuses = await fixture.service.getClippingStatuses(ana, [
      kept,
      deleted,
      "not-an-id",
      "00000000-0000-4000-8000-000000000000",
    ]);

    expect(statuses).toEqual([{ id: kept, status: "pending" }]);
    expect(await fixture.service.getClippingStatuses(ana, [])).toEqual([]);
  });

  it("keeps users apart", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");
    const anas = await save(ana, "https://example.com/a");
    const bens = await save(ben, "https://example.com/b");

    const statuses = await fixture.service.getClippingStatuses(ana, [anas, bens]);

    expect(statuses).toEqual([{ id: anas, status: "pending" }]);
  });
});
