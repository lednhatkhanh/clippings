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

import { createGateway } from "./gateway.ts";

const FAKES = fileURLToPath(new URL("../../../../scripts/local/fakes.mjs", import.meta.url));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Starts the local fakes (scripts/local/fakes.mjs) on free ports and waits until they listen. */
async function startFakes() {
  const [qstash, anthropic, voyage] = await Promise.all([freePort(), freePort(), freePort()]);
  const child: ChildProcess = spawn(process.execPath, [FAKES], {
    env: {
      ...process.env,
      FAKE_QSTASH_PORT: String(qstash),
      FAKE_ANTHROPIC_PORT: String(anthropic),
      FAKE_VOYAGE_PORT: String(voyage),
      FAKE_MODEL_DELAY_MS: "0",
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
});
