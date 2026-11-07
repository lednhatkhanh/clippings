import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_DAILY_CAP_MICROS } from "@clippings/shared";

import { createServiceFixture, type ServiceFixture } from "../test/service-fixture.ts";
import { TEST_DATABASE_URL } from "../test/temp-database.ts";
import type { ModelUsageEntry } from "./service.ts";

describe.skipIf(!TEST_DATABASE_URL)("usage ledger", () => {
  const HOUR = 60 * 60 * 1000;

  let fixture: ServiceFixture;

  beforeEach(async () => {
    fixture = await createServiceFixture();
  });

  afterEach(async () => {
    await fixture.close();
  });

  const call = (costMicros: number, overrides: Partial<ModelUsageEntry> = {}): ModelUsageEntry => ({
    jobKind: "enrich",
    model: "claude-haiku-5-5",
    batch: false,
    inputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearches: 0,
    costMicros,
    ...overrides,
  });

  it("starts at nothing spent and the default cap", async () => {
    const ana = await fixture.createUser("ana");

    expect(await fixture.usage.getBudget(ana)).toEqual({
      spentTodayMicros: 0,
      dailyCapMicros: DEFAULT_DAILY_CAP_MICROS,
    });
    expect(await fixture.usage.getSpend(ana)).toEqual({ todayMicros: 0, monthMicros: 0 });
  });

  it("sums what was recorded today and this month", async () => {
    const ana = await fixture.createUser("ana");

    await fixture.usage.recordUsage(ana, call(1_500));
    await fixture.usage.recordUsage(ana, call(2_500, { jobKind: "search", model: "voyage-4" }));

    expect(await fixture.usage.getSpend(ana)).toEqual({ todayMicros: 4_000, monthMicros: 4_000 });
    expect((await fixture.usage.getBudget(ana)).spentTodayMicros).toBe(4_000);
  });

  it("writes one row for a request key, however often the request is recorded", async () => {
    const ana = await fixture.createUser("ana");

    await fixture.usage.recordUsage(ana, call(1_500, { requestKey: "batch:b1:r1" }));
    await fixture.usage.recordUsage(ana, call(1_500, { requestKey: "batch:b1:r1" }));
    await fixture.usage.recordUsage(ana, call(2_000, { requestKey: "batch:b1:r2" }));
    // Rows without a key are separate calls, each its own row.
    await fixture.usage.recordUsage(ana, call(100));
    await fixture.usage.recordUsage(ana, call(100));

    expect((await fixture.usage.getSpend(ana)).todayMicros).toBe(3_700);
  });

  it("stores what the call used, so the ledger can be read back", async () => {
    const ana = await fixture.createUser("ana");

    await fixture.usage.recordUsage(
      ana,
      call(777, {
        jobKind: "brief",
        batch: true,
        inputTokens: 11,
        outputTokens: 22,
        cacheReadTokens: 33,
        cacheWriteTokens: 44,
        webSearches: 5,
      }),
    );

    const { rows } = await fixture.pool.query(
      `select job_kind, model, batch, input_tokens, output_tokens, cache_read_tokens,
              cache_write_tokens, web_searches, cost_micros::int as cost_micros
         from model_usage where user_id = $1`,
      [ana],
    );
    expect(rows).toEqual([
      {
        job_kind: "brief",
        model: "claude-haiku-5-5",
        batch: true,
        input_tokens: 11,
        output_tokens: 22,
        cache_read_tokens: 33,
        cache_write_tokens: 44,
        web_searches: 5,
        cost_micros: 777,
      },
    ]);
  });

  it("counts a UTC day: yesterday's spend is in the month but not today", async () => {
    const ana = await fixture.createUser("ana");
    // The clock starts at 09:00 UTC on 2026-10-01; go to 23:30 UTC the same day.
    fixture.advanceClock(14 * HOUR + 30 * 60 * 1000);
    await fixture.usage.recordUsage(ana, call(9_000));
    fixture.advanceClock(HOUR);
    await fixture.usage.recordUsage(ana, call(1_000));

    // 00:30 UTC on the 2nd: the first row belongs to the 1st, the second to today.
    expect(await fixture.usage.getSpend(ana)).toEqual({ todayMicros: 1_000, monthMicros: 10_000 });

    fixture.advanceClock(24 * HOUR);
    expect(await fixture.usage.getSpend(ana)).toEqual({ todayMicros: 0, monthMicros: 10_000 });
  });

  it("starts a new month on the 1st (UTC)", async () => {
    const ana = await fixture.createUser("ana");
    fixture.advanceClock(-(9 * HOUR + 30 * 60 * 1000)); // 2026-09-30 23:30 UTC
    await fixture.usage.recordUsage(ana, call(9_000));
    fixture.advanceClock(HOUR); // 2026-10-01 00:30 UTC
    await fixture.usage.recordUsage(ana, call(1_000));

    expect((await fixture.usage.getSpend(ana)).monthMicros).toBe(1_000);
  });

  it("uses the cap the user set", async () => {
    const ana = await fixture.createUser("ana");
    await fixture.settings.updateAutomationSettings(ana, { dailyCapMicros: 500_000 });

    expect((await fixture.usage.getBudget(ana)).dailyCapMicros).toBe(500_000);
  });

  it("keeps users apart: one user's spend and cap never show up for another", async () => {
    const ana = await fixture.createUser("ana");
    const ben = await fixture.createUser("ben");

    await fixture.usage.recordUsage(ana, call(8_000));
    await fixture.settings.updateAutomationSettings(ana, { dailyCapMicros: 1_000_000 });

    expect(await fixture.usage.getBudget(ben)).toEqual({
      spentTodayMicros: 0,
      dailyCapMicros: DEFAULT_DAILY_CAP_MICROS,
    });
    expect(await fixture.usage.getSpend(ben)).toEqual({ todayMicros: 0, monthMicros: 0 });
    expect((await fixture.usage.getSpend(ana)).todayMicros).toBe(8_000);
  });

  it("removes a user's ledger with the user", async () => {
    const ana = await fixture.createUser("ana");
    await fixture.usage.recordUsage(ana, call(100));

    await fixture.deleteUser(ana);

    const { rows } = await fixture.pool.query(`select 1 from model_usage`);
    expect(rows).toEqual([]);
  });
});
