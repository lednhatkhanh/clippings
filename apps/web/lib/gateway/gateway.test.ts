import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createServiceFixture,
  TEST_DATABASE_URL,
  type ServiceFixture,
} from "@clippings/db/testing";
import type { ModelJobKind } from "@clippings/shared";

import { createGateway, type BatchEntry } from "./gateway.ts";

const FAKES = fileURLToPath(new URL("../../../../scripts/local/fakes.mjs", import.meta.url));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Starts the local fakes (scripts/local/fakes.mjs) on free ports and waits until they listen. */
async function startFakes(env: Record<string, string> = {}) {
  const [qstash, anthropic, voyage] = await Promise.all([freePort(), freePort(), freePort()]);
  const child: ChildProcess = spawn(process.execPath, [FAKES], {
    env: {
      ...process.env,
      FAKE_QSTASH_PORT: String(qstash),
      FAKE_ANTHROPIC_PORT: String(anthropic),
      FAKE_VOYAGE_PORT: String(voyage),
      FAKE_MODEL_DELAY_MS: "0",
      ...env,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`The fakes exited with ${code}`)));
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("fake anthropic on") && output.includes("fake voyage on")) resolve();
    });
  });
  child.removeAllListeners("exit");
  return {
    anthropicUrl: `http://127.0.0.1:${anthropic}`,
    voyageUrl: `http://127.0.0.1:${voyage}`,
    stop: () => child.kill(),
  };
}

describe.skipIf(!TEST_DATABASE_URL)("model gateway against the local fakes", () => {
  let fakes: Awaited<ReturnType<typeof startFakes>>;
  let fixture: ServiceFixture;
  let anthropic: Anthropic;
  let gateway: ReturnType<typeof createGateway>;

  beforeAll(async () => {
    fakes = await startFakes();
    vi.stubEnv("VOYAGE_API_KEY", "local");
    vi.stubEnv("VOYAGE_BASE_URL", fakes.voyageUrl);
    anthropic = new Anthropic({ apiKey: "local", baseURL: fakes.anthropicUrl, maxRetries: 0 });
  });

  afterAll(() => {
    fakes.stop();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    fixture = await createServiceFixture();
    gateway = createGateway({ ledger: fixture.usage, anthropic: () => anthropic });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fixture.close();
  });

  const ask = (
    userId: string,
    text: string,
    {
      jobKind = "enrich",
      model = "claude-haiku-5-5",
    }: { jobKind?: ModelJobKind; model?: string } = {},
  ) =>
    gateway.message({
      userId,
      jobKind,
      request: { model, max_tokens: 100, messages: [{ role: "user", content: text }] },
    });

  const setCap = (userId: string, dailyCapMicros: number) =>
    fixture.settings.updateAutomationSettings(userId, { dailyCapMicros });

  /** Puts `micros` of spend on the user's ledger today. */
  const spend = (userId: string, micros: number) =>
    fixture.usage.recordUsage(userId, {
      jobKind: "enrich",
      model: "claude-haiku-5-5",
      batch: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearches: 0,
      costMicros: micros,
    });

  const ledger = async () =>
    (
      await fixture.pool.query(
        `select user_id, job_kind, model, batch, input_tokens, output_tokens, cache_read_tokens,
                cache_write_tokens, web_searches, cost_micros::int as cost_micros
           from model_usage order by created_at`,
      )
    ).rows;

  describe("recording", () => {
    it("writes the response's tokens and the priced cost to the ledger", async () => {
      const ana = await fixture.createUser("ana");

      const result = await ask(ana, "Read this. [fake-usage input=100000 output=100000]");

      // $0.01 for 100,000 input tokens plus $0.05 for 100,000 output tokens.
      expect(result).toMatchObject({ status: "ok", costMicros: 60_000 });
      expect(await ledger()).toEqual([
        {
          user_id: ana,
          job_kind: "enrich",
          model: "claude-haiku-5-5",
          batch: false,
          input_tokens: 100_000,
          output_tokens: 100_000,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          web_searches: 0,
          cost_micros: 60_000,
        },
      ]);
      expect(await fixture.usage.getSpend(ana)).toEqual({
        todayMicros: 60_000,
        monthMicros: 60_000,
      });
    });

    it("prices cache reads, cache writes and web searches from the response's usage", async () => {
      const ana = await fixture.createUser("ana");

      await ask(
        ana,
        "[fake-usage input=1000 output=500 cache_read=2000 cache_write=400 searches=2]",
        { jobKind: "brief", model: "claude-sonnet-5-5" },
      );

      expect(await ledger()).toMatchObject([
        {
          job_kind: "brief",
          model: "claude-sonnet-5-5",
          input_tokens: 1_000,
          output_tokens: 500,
          cache_read_tokens: 2_000,
          cache_write_tokens: 400,
          web_searches: 2,
          cost_micros: 28_400,
        },
      ]);
    });

    it("returns the model's reply untouched", async () => {
      const ana = await fixture.createUser("ana");

      const result = await ask(ana, "Page title: A page\n\nthe page");

      expect(result.status === "ok" && result.value.content).toMatchObject([
        { type: "tool_use", name: "save_reading", input: { title: "Read: A page" } },
      ]);
    });

    it("still returns the reply when the ledger can't be written", async () => {
      const ana = await fixture.createUser("ana");
      vi.spyOn(fixture.usage, "recordUsage").mockRejectedValue(new Error("db down"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await ask(ana, "Read this.");

      expect(result.status).toBe("ok");
    });

    it("records a Voyage AI call's tokens and cost", async () => {
      const ana = await fixture.createUser("ana");

      const result = await gateway.embed({
        userId: ana,
        jobKind: "enrich",
        texts: ["x".repeat(400)],
        purpose: "document",
        timeoutMs: 5_000,
      });

      // The fake counts a token per four characters: 100 tokens at $0.06 per MTok.
      expect(result.status === "ok" && result.value).toHaveLength(1);
      expect(result.status === "ok" && result.value[0]).toHaveLength(1024);
      expect(await ledger()).toMatchObject([
        {
          user_id: ana,
          job_kind: "enrich",
          model: "voyage-4",
          input_tokens: 100,
          output_tokens: 0,
          cost_micros: 6,
        },
      ]);
    });
  });

  describe("a paid Voyage AI reply that can't be used", () => {
    const embedOnce = (userId: string, text = "x".repeat(400)) =>
      gateway.embed({
        userId,
        jobKind: "enrich",
        texts: [text],
        purpose: "document",
        timeoutMs: 5_000,
      });

    it("still reaches the ledger when the body has the wrong number of embeddings", async () => {
      const ana = await fixture.createUser("ana");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        Response.json({ data: [], usage: { total_tokens: 250 } }),
      );

      await expect(embedOnce(ana)).rejects.toThrow(/wrong number of embeddings/);

      // 250 tokens at $0.06 per MTok is 15 micro-dollars.
      expect(await ledger()).toMatchObject([
        { user_id: ana, model: "voyage-4", input_tokens: 250, cost_micros: 15 },
      ]);
    });

    it("still reaches the ledger, priced from the text, when the 2xx body isn't JSON", async () => {
      const ana = await fixture.createUser("ana");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>oops</html>"));

      await expect(embedOnce(ana)).rejects.toThrow(/wrong number of embeddings/);

      expect(await ledger()).toMatchObject([
        { user_id: ana, model: "voyage-4", input_tokens: 100 },
      ]);
    });

    it("records nothing for a reply that isn't a 2xx", async () => {
      const ana = await fixture.createUser("ana");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 503 }));

      await expect(embedOnce(ana)).rejects.toThrow(/answered 503/);

      expect(await ledger()).toEqual([]);
    });
  });

  describe("looking ahead with canSpend", () => {
    it("says no past the limit for the job kind, and yes below it, without calling anyone", async () => {
      const ana = await fixture.createUser("ana");
      await setCap(ana, 1_000_000);
      await spend(ana, 800_000);
      const create = vi.spyOn(anthropic.messages, "create");
      const fetch = vi.spyOn(globalThis, "fetch");

      expect(await gateway.canSpend(ana, "enrich")).toBe(true);
      expect(await gateway.canSpend(ana, "librarian")).toBe(false);

      await spend(ana, 200_000);
      expect(await gateway.canSpend(ana, "enrich")).toBe(false);
      expect(create).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("keeps users apart", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await setCap(ana, 100_000);
      await spend(ana, 100_000);

      expect(await gateway.canSpend(ana, "enrich")).toBe(false);
      expect(await gateway.canSpend(ben, "enrich")).toBe(true);
    });
  });

  describe("the cap", () => {
    it("refuses a call past the cap without making it", async () => {
      const ana = await fixture.createUser("ana");
      await setCap(ana, 1_000_000);
      await spend(ana, 1_000_000);
      const create = vi.spyOn(anthropic.messages, "create");

      const result = await ask(ana, "Read this.");

      expect(result).toEqual({ status: "cap_reached", reason: "daily_cap" });
      expect(create).not.toHaveBeenCalled();
      expect(await ledger()).toHaveLength(1);
    });

    it("refuses an embedding past the cap without calling Voyage AI", async () => {
      const ana = await fixture.createUser("ana");
      await setCap(ana, 100);
      await spend(ana, 100);
      const fetch = vi.spyOn(globalThis, "fetch");

      const result = await gateway.embed({
        userId: ana,
        jobKind: "search",
        texts: ["query"],
        purpose: "query",
        timeoutMs: 1_000,
      });

      expect(result).toEqual({ status: "cap_reached", reason: "daily_cap" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("lets calls through until the spend reaches the cap, then stops", async () => {
      const ana = await fixture.createUser("ana");
      await setCap(ana, 20_000);

      // Each call costs $0.01 (100,000 Haiku input tokens).
      const first = await ask(ana, "[fake-usage input=100000]");
      const second = await ask(ana, "[fake-usage input=100000]");
      const third = await ask(ana, "[fake-usage input=100000]");

      expect([first.status, second.status, third.status]).toEqual(["ok", "ok", "cap_reached"]);
    });

    it("stops every job but enrich at 80% of the cap", async () => {
      const ana = await fixture.createUser("ana");
      await setCap(ana, 1_000_000);
      await spend(ana, 800_000);

      const librarian = await ask(ana, "Plan.", { jobKind: "librarian" });
      const lesson = await ask(ana, "Teach.", { jobKind: "lesson" });
      const enrich = await ask(ana, "Read this.", { jobKind: "enrich" });

      expect(librarian).toEqual({ status: "cap_reached", reason: "daily_cap" });
      expect(lesson).toEqual({ status: "cap_reached", reason: "daily_cap" });
      expect(enrich.status).toBe("ok");
    });

    it("starts a new day's allowance at midnight UTC", async () => {
      const ana = await fixture.createUser("ana");
      await setCap(ana, 100_000);
      await spend(ana, 100_000);
      expect((await ask(ana, "Read this.")).status).toBe("cap_reached");

      fixture.advanceClock(24 * 60 * 60 * 1000);

      expect((await ask(ana, "Read this.")).status).toBe("ok");
    });

    it("keeps users apart: one user at their cap doesn't hold another", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await setCap(ana, 100_000);
      await spend(ana, 100_000);

      expect((await ask(ana, "Read this.")).status).toBe("cap_reached");
      expect((await ask(ben, "Read this.")).status).toBe("ok");
    });

    it("refuses a model it has no rate for, before calling", async () => {
      const ana = await fixture.createUser("ana");
      const create = vi.spyOn(anthropic.messages, "create");

      await expect(ask(ana, "Read this.", { model: "claude-mystery-9" })).rejects.toThrow(
        /No rate for model claude-mystery-9/,
      );
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("Anthropic's own limits", () => {
    it.each([
      ["a workspace spend limit", "spend-limit"],
      ["an empty credit balance", "credit"],
      ["an account tier cap", "tier-cap"],
    ])("treats %s as the cap being reached, and records nothing", async (_what, marker) => {
      const ana = await fixture.createUser("ana");

      const result = await ask(ana, `Read this. [fake-error ${marker}]`);

      expect(result).toEqual({ status: "cap_reached", reason: "provider_limit" });
      expect(await ledger()).toEqual([]);
    });

    it.each([
      ["an ordinary rate limit", "rate-limit", 429],
      ["an overloaded API", "overloaded", 529],
    ])("throws %s, which is a failure and not the cap", async (_what, marker, status) => {
      const ana = await fixture.createUser("ana");

      await expect(ask(ana, `Read this. [fake-error ${marker}]`)).rejects.toMatchObject({
        status,
      });
      expect(await ledger()).toEqual([]);
    });
  });
  describe("batches", () => {
    const entry = (customId: string, userId: string, text: string): BatchEntry => ({
      customId,
      userId,
      jobKind: "brief",
      request: {
        model: "claude-sonnet-5-5",
        max_tokens: 100,
        messages: [{ role: "user", content: text }],
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      },
    });
    const owners = (...pairs: [string, string][]) =>
      new Map(pairs.map(([customId, userId]) => [customId, { userId, jobKind: "brief" as const }]));

    it("records a succeeded request at batch prices, with its web searches", async () => {
      const ana = await fixture.createUser("ana");
      const submission = await gateway.submitBatch([
        entry("b1", ana, "Title: A page [fake-usage input=1000 output=500 searches=2]"),
      ]);
      expect(submission).toMatchObject({ accepted: ["b1"], held: [] });

      const collected = await gateway.collectBatch(submission.batchId!, owners(["b1", ana]));

      // Half of $0.002 for the input and $0.005 for the output, plus two searches at $0.01.
      expect(collected).toMatchObject({
        status: "ended",
        results: [{ customId: "b1", outcome: "succeeded", costMicros: 23_500 }],
      });
      expect(await ledger()).toMatchObject([
        {
          user_id: ana,
          job_kind: "brief",
          model: "claude-sonnet-5-5",
          batch: true,
          input_tokens: 1_000,
          output_tokens: 500,
          web_searches: 2,
          cost_micros: 23_500,
        },
      ]);
    });

    it("bills each request to its own user, and skips a result nobody owns", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      const { batchId } = await gateway.submitBatch([
        entry("b1", ana, "Title: One"),
        entry("b2", ben, "Title: Two"),
        entry("b3", ana, "Title: Three"),
      ]);

      const collected = await gateway.collectBatch(batchId!, owners(["b1", ana], ["b2", ben]));

      expect(collected.status === "ended" && collected.results.map((r) => r.customId)).toEqual([
        "b1",
        "b2",
      ]);
      const rows = await ledger();
      expect(rows.map((row) => row.user_id)).toEqual([ana, ben]);
    });

    it("holds an entry past its user's cap and sends the rest", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      await setCap(ana, 100_000);
      await spend(ana, 100_000);

      const submission = await gateway.submitBatch([
        entry("b1", ana, "Title: One"),
        entry("b2", ben, "Title: Two"),
      ]);

      expect(submission).toMatchObject({
        accepted: ["b2"],
        held: [{ customId: "b1", reason: "daily_cap" }],
      });
      expect(submission.batchId).toEqual(expect.any(String));
    });

    it("counts what the accepted entries will cost against the cap, so a big batch can't pass it", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      // A brief stops at 80% of the cap: 320,000. Ana has spent 50,000, so two 100,000 estimates
      // fit (250,000) and a third would carry her to 350,000.
      await setCap(ana, 400_000);
      await spend(ana, 50_000);
      const estimated = (customId: string, userId: string): BatchEntry => ({
        ...entry(customId, userId, `Title: ${customId}`),
        estimateMicros: 100_000,
      });

      const submission = await gateway.submitBatch([
        estimated("a1", ana),
        estimated("a2", ana),
        estimated("a3", ana),
        estimated("b1", ben),
        estimated("b2", ben),
      ]);

      expect(submission).toMatchObject({
        accepted: ["a1", "a2", "b1", "b2"],
        held: [{ customId: "a3", reason: "daily_cap" }],
      });
      // The estimates were only reserved: nothing is on the ledger until the batch ends.
      expect((await fixture.usage.getBudget(ana)).spentTodayMicros).toBe(50_000);
    });

    it("accepts an entry with no estimate while the user is under the limit", async () => {
      const ana = await fixture.createUser("ana");
      await setCap(ana, 100_000);
      await spend(ana, 79_999);

      const submission = await gateway.submitBatch([
        entry("b1", ana, "Title: One"),
        entry("b2", ana, "Title: Two"),
      ]);

      expect(submission).toMatchObject({ accepted: ["b1", "b2"], held: [] });
    });

    it("bills a batch's requests once, however often it is collected", async () => {
      const ana = await fixture.createUser("ana");
      const ben = await fixture.createUser("ben");
      const { batchId } = await gateway.submitBatch([
        entry("b1", ana, "Title: One [fake-usage input=1000 output=500 searches=2]"),
        entry("b2", ben, "Title: Two"),
      ]);
      const both = owners(["b1", ana], ["b2", ben]);

      const first = await gateway.collectBatch(batchId!, both);
      const second = await gateway.collectBatch(batchId!, both);

      expect(second).toEqual(first);
      expect(await ledger()).toHaveLength(2);
      expect((await fixture.usage.getBudget(ana)).spentTodayMicros).toBe(23_500);
    });

    it("ends a batch the provider no longer has, with every request expired and nothing billed", async () => {
      const ana = await fixture.createUser("ana");

      const collected = await gateway.collectBatch(
        "msgbatch_missing",
        owners(["b1", ana], ["b2", ana]),
      );

      expect(collected).toEqual({
        status: "ended",
        results: [
          { customId: "b1", outcome: "expired", detail: expect.any(String) },
          { customId: "b2", outcome: "expired", detail: expect.any(String) },
        ],
      });
      expect(await ledger()).toEqual([]);
    });

    it("makes no batch when every entry is held", async () => {
      const ana = await fixture.createUser("ana");
      await setCap(ana, 100_000);
      await spend(ana, 100_000);
      const create = vi.spyOn(anthropic.messages.batches, "create");

      const submission = await gateway.submitBatch([entry("b1", ana, "Title: One")]);

      expect(submission).toEqual({
        batchId: null,
        accepted: [],
        held: [{ customId: "b1", reason: "daily_cap" }],
      });
      expect(create).not.toHaveBeenCalled();
    });

    it("holds every entry when Anthropic's spend limit refuses the batch", async () => {
      const ana = await fixture.createUser("ana");

      const submission = await gateway.submitBatch([
        entry("b1", ana, "Title: One [fake-error spend-limit]"),
        entry("b2", ana, "Title: Two"),
      ]);

      expect(submission).toEqual({
        batchId: null,
        accepted: [],
        held: [
          { customId: "b1", reason: "provider_limit" },
          { customId: "b2", reason: "provider_limit" },
        ],
      });
    });

    it("says in_progress until the batch ends, and bills nothing", async () => {
      const slow = await startFakes({ FAKE_BATCH_DELAY_MS: "3600000" });
      try {
        const ana = await fixture.createUser("ana");
        const waiting = createGateway({
          ledger: fixture.usage,
          anthropic: () =>
            new Anthropic({ apiKey: "local", baseURL: slow.anthropicUrl, maxRetries: 0 }),
        });
        const { batchId } = await waiting.submitBatch([entry("b1", ana, "Title: One")]);

        expect(await waiting.collectBatch(batchId!, owners(["b1", ana]))).toEqual({
          status: "in_progress",
        });
        expect(await ledger()).toEqual([]);
      } finally {
        slow.stop();
      }
    });

    it("reports errored and expired requests without billing them", async () => {
      const ana = await fixture.createUser("ana");
      const { batchId } = await gateway.submitBatch([
        entry("b1", ana, "Title: One [fake-batch errored]"),
        entry("b2", ana, "Title: Two [fake-batch expired]"),
      ]);

      const collected = await gateway.collectBatch(batchId!, owners(["b1", ana], ["b2", ana]));

      expect(collected).toMatchObject({
        status: "ended",
        results: [
          {
            customId: "b1",
            outcome: "errored",
            detail: expect.stringContaining("Fake batch error"),
          },
          { customId: "b2", outcome: "expired" },
        ],
      });
      expect(await ledger()).toEqual([]);
    });
  });
});
