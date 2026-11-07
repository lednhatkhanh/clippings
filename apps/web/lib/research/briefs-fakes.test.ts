import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createGateway } from "@/lib/gateway/gateway.ts";
import { createDatabase } from "@clippings/db";
import {
  createServiceFixture,
  TEST_DATABASE_URL,
  type ServiceFixture,
} from "@clippings/db/testing";

import { createBriefRunner } from "./run-briefs.ts";
import { createBriefWriter } from "./write-now.ts";

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
  return { anthropicUrl: `http://127.0.0.1:${anthropic}`, stop: () => child.kill() };
}

describe.skipIf(!TEST_DATABASE_URL)("research briefs against the local Anthropic fake", () => {
  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;

  let fakes: Awaited<ReturnType<typeof startFakes>>;
  let fixture: ServiceFixture;
  let gateway: ReturnType<typeof createGateway>;
  let runner: ReturnType<typeof createBriefRunner>;
  let writer: ReturnType<typeof createBriefWriter>;
  let ana: string;
  let ben: string;

  beforeAll(async () => {
    fakes = await startFakes();
  });

  afterAll(() => {
    fakes.stop();
  });

  beforeEach(async () => {
    fixture = await createServiceFixture();
    const anthropic = new Anthropic({
      apiKey: "local",
      baseURL: fakes.anthropicUrl,
      maxRetries: 0,
    });
    gateway = createGateway({ ledger: fixture.usage, anthropic: () => anthropic });
    runner = createBriefRunner({ research: fixture.research, gateway, now: fixture.clock.now });
    writer = createBriefWriter({ research: fixture.research, gateway });
    ana = await fixture.createUser("ana");
    ben = await fixture.createUser("ben");
  });

  afterEach(async () => {
    await fixture.close();
  });

  /** Queues a brief for a new note of the user; `marker` goes in the note, where the fake reads it. */
  async function queue(userId: string, marker = "") {
    const note = await fixture.service.saveNote(userId, {
      body: `Notes on port fees. ${marker}`,
      source: "web",
    });
    fixture.advanceClock(MINUTE);
    await fixture.research.queueBrief(createDatabase(fixture.pool), {
      userId,
      clippingId: note.id,
      domain: "shipping",
      reason: "About ports",
    });
    const brief = await fixture.research.getBrief(userId, note.id);
    return brief!;
  }

  const get = async (userId: string, briefId: string, clippingId: string) => {
    const brief = await fixture.research.getBrief(userId, clippingId);
    expect(brief?.id).toBe(briefId);
    return brief!;
  };

  const ledger = async () =>
    (
      await fixture.pool.query(
        `select user_id, job_kind, batch, web_searches from model_usage order by created_at`,
      )
    ).rows;

  describe("the daily run", () => {
    it("submits a queued brief, then collects it as a ready brief with its sources", async () => {
      const queued = await queue(ana);

      const first = await runner.run();
      expect(first).toMatchObject({ submitted: 1, ready: 0 });
      expect((await get(ana, queued.id, queued.clippingId)).status).toBe("submitted");

      const second = await runner.run();
      expect(second).toMatchObject({ submitted: 0, ready: 1, pending: 0 });
      const brief = await get(ana, queued.id, queued.clippingId);
      expect(brief).toMatchObject({
        status: "ready",
        sources: [
          { url: "https://example.com/fake-source-1", title: "Fake source 1" },
          { url: "https://example.com/fake-source-2", title: "Fake source 2" },
        ],
      });
      expect(brief.body).toContain("A stand-in research brief");
      expect(await ledger()).toEqual([
        { user_id: ana, job_kind: "brief", batch: true, web_searches: 2 },
      ]);
    });

    it("retries a brief whose batch expired once, then drops it", async () => {
      const queued = await queue(ana, "[fake-batch expired]");

      await runner.run();
      const retried = await runner.run();
      expect(retried).toMatchObject({ retried: 1, dropped: 0, submitted: 1 });
      expect(await get(ana, queued.id, queued.clippingId)).toMatchObject({ status: "submitted" });

      const dropped = await runner.run();
      expect(dropped).toMatchObject({ retried: 0, dropped: 1, submitted: 0 });
      expect(await get(ana, queued.id, queued.clippingId)).toMatchObject({
        status: "dropped",
        note: "Dropped after 2 tries: the batch expired",
      });
      expect(await ledger()).toEqual([]);
    });

    it("keeps a brief past the user's daily research jobs queued for the next day", async () => {
      await fixture.settings.updateAutomationSettings(ana, { researchJobsPerDay: 1 });
      const first = await queue(ana);
      const second = await queue(ana);

      expect(await runner.run()).toMatchObject({ submitted: 1 });
      expect((await get(ana, second.id, second.clippingId)).status).toBe("queued");
      expect(await runner.run()).toMatchObject({ submitted: 0, ready: 1 });
      expect((await get(ana, first.id, first.clippingId)).status).toBe("ready");

      fixture.advanceClock(DAY);
      expect(await runner.run()).toMatchObject({ submitted: 1 });
      expect((await get(ana, second.id, second.clippingId)).status).toBe("submitted");
    });

    it("holds a brief of a user at the spending cap and sends the others", async () => {
      await fixture.settings.updateAutomationSettings(ana, { dailyCapMicros: 0 });
      const held = await queue(ana);
      const sent = await queue(ben);

      expect(await runner.run()).toMatchObject({ submitted: 1, held: 1 });

      expect((await get(ana, held.id, held.clippingId)).status).toBe("queued");
      expect((await get(ben, sent.id, sent.clippingId)).status).toBe("submitted");
    });

    it("puts the claimed briefs back, without using an attempt or a job, when the provider's limit refuses the batch", async () => {
      const queued = await queue(ana, "[fake-error spend-limit]");

      expect(await runner.run()).toMatchObject({ submitted: 0, held: 1 });

      expect(await get(ana, queued.id, queued.clippingId)).toMatchObject({
        status: "queued",
        note: "Held: the AI provider's spending limit was reached. It'll go in the next batch.",
      });
      expect(await fixture.research.submissionsToday(ana)).toBe(0);
      const { rows } = await fixture.pool.query(`select attempts from research_briefs`);
      expect(rows).toEqual([{ attempts: 0 }]);
    });

    it("puts the claimed briefs back, and says so, when the batch can't be created", async () => {
      const queued = await queue(ana);
      const unreachable = createBriefRunner({
        research: fixture.research,
        gateway: {
          collectBatch: gateway.collectBatch,
          submitBatch: async () => {
            throw new Error("connect ECONNREFUSED");
          },
        },
        now: fixture.clock.now,
      });

      await expect(unreachable.run()).rejects.toThrow("ECONNREFUSED");

      expect(await get(ana, queued.id, queued.clippingId)).toMatchObject({
        status: "queued",
        note: "Couldn't start it; it'll go in the next batch.",
      });
      expect(await fixture.research.submissionsToday(ana)).toBe(0);
      expect(await fixture.research.submittedBatchIds()).toEqual([]);
      // The next run sends it.
      expect(await runner.run()).toMatchObject({ submitted: 1 });
    });

    it("sends only as many briefs as the user's cap leaves room for, counting each at its estimate", async () => {
      // 80% of the cap is 160,000; a brief is reserved at 85,000 micro-dollars, so one fits.
      await fixture.settings.updateAutomationSettings(ana, { dailyCapMicros: 200_000 });
      const first = await queue(ana);
      const second = await queue(ana);
      const third = await queue(ana);

      expect(await runner.run()).toMatchObject({ submitted: 1, held: 2 });

      expect((await get(ana, first.id, first.clippingId)).status).toBe("submitted");
      for (const held of [second, third]) {
        expect(await get(ana, held.id, held.clippingId)).toMatchObject({
          status: "queued",
          note: "Held: today's spending cap was reached. It'll go in the next batch.",
        });
      }
      expect(await fixture.research.submissionsToday(ana)).toBe(1);
    });

    it("fails a claimed brief that never got a batch, once an hour has passed, and sends it again", async () => {
      const queued = await queue(ana);
      // The run that claimed it died before the batch was created.
      await fixture.research.claimForBatch(fixture.clock.now());
      expect((await get(ana, queued.id, queued.clippingId)).status).toBe("submitted");

      fixture.advanceClock(30 * MINUTE);
      expect(await runner.run()).toMatchObject({ unstarted: 0, submitted: 0 });

      fixture.advanceClock(31 * MINUTE);
      expect(await runner.run()).toMatchObject({ unstarted: 1, submitted: 1 });
      expect((await get(ana, queued.id, queued.clippingId)).status).toBe("submitted");
    });

    it("expires the briefs of a batch the provider no longer has, and retries them", async () => {
      const queued = await queue(ana);
      await fixture.research.claimForBatch(fixture.clock.now());
      await fixture.research.attachBatch([queued.id], "msgbatch_gone");

      const result = await runner.run();

      expect(result).toMatchObject({ failedBatches: 0, retried: 1 });
      expect(result.submitted).toBe(1);
      expect(await ledger()).toEqual([]);
    });

    it("fails the briefs of a batch that hasn't finished in three days", async () => {
      const queued = await queue(ana);
      await fixture.research.claimForBatch(fixture.clock.now());
      await fixture.research.attachBatch([queued.id], "msgbatch_slow");
      const waiting = createBriefRunner({
        research: fixture.research,
        gateway: {
          collectBatch: async () => ({ status: "in_progress" }),
          // Nothing goes out, so the retry stays in the queue for the test to see.
          submitBatch: async (entries) => ({
            batchId: null,
            accepted: [],
            held: entries.map(({ customId }) => ({ customId, reason: "daily_cap" as const })),
          }),
        },
        now: fixture.clock.now,
      });

      fixture.advanceClock(3 * DAY - MINUTE);
      expect(await waiting.run()).toMatchObject({ pending: 1, unfinished: 0 });

      fixture.advanceClock(2 * MINUTE);
      expect(await waiting.run()).toMatchObject({ unfinished: 1, retried: 0 });
      expect((await get(ana, queued.id, queued.clippingId)).status).toBe("queued");
      expect(await fixture.research.submittedBatchIds()).toEqual([]);
    });

    it("fails a brief stuck writing for over an hour", async () => {
      const clipping = await fixture.service.saveNote(ana, { body: "A note", source: "web" });
      const started = await fixture.research.requestBriefNow(ana, clipping.id);
      expect(started.status).toBe("started");
      fixture.advanceClock(61 * MINUTE);
      // The one research job of the day is used, so the retry stays in the queue for the test to see.
      await fixture.settings.updateAutomationSettings(ana, { researchJobsPerDay: 1 });

      expect(await runner.run()).toMatchObject({ stuck: 1, submitted: 0 });

      expect(await fixture.research.getBrief(ana, clipping.id)).toMatchObject({
        status: "queued",
        note: "Retrying after the writer stopped partway",
      });
    });
  });

  describe("writing one now", () => {
    async function start(userId: string, marker = "") {
      const note = await fixture.service.saveNote(userId, {
        body: `Notes on ports. ${marker}`,
        source: "web",
      });
      const started = await fixture.research.requestBriefNow(userId, note.id);
      if (started.status !== "started") throw new Error(`Not started: ${started.status}`);
      return { briefId: started.brief.id, clippingId: note.id };
    }

    it("writes the brief and records the call at full price", async () => {
      const { briefId, clippingId } = await start(ana);

      expect(await writer.writeNow({ briefId, userId: ana })).toBe("ready");

      expect(await fixture.research.getBrief(ana, clippingId)).toMatchObject({
        status: "ready",
        sources: [
          { url: "https://example.com/fake-source-1" },
          { url: "https://example.com/fake-source-2" },
        ],
      });
      expect(await ledger()).toEqual([
        { user_id: ana, job_kind: "brief", batch: false, web_searches: 2 },
      ]);
    });

    it("puts the brief back in the queue, with a note, when the cap is reached", async () => {
      await fixture.settings.updateAutomationSettings(ana, { dailyCapMicros: 0 });
      const { briefId, clippingId } = await start(ana);

      expect(await writer.writeNow({ briefId, userId: ana })).toBe("held");

      expect(await fixture.research.getBrief(ana, clippingId)).toMatchObject({
        status: "queued",
        note: "Held: today's spending cap was reached. It'll go in the next batch.",
      });
      expect(await ledger()).toEqual([]);
    });

    it("retries a failed call once through the brief's own rule", async () => {
      const { briefId, clippingId } = await start(ana, "[fake-error overloaded]");

      expect(await writer.writeNow({ briefId, userId: ana })).toBe("failed");

      expect(await fixture.research.getBrief(ana, clippingId)).toMatchObject({
        status: "queued",
        note: "Retrying after the request failed",
      });
    });

    it("calls the model once when the job is delivered twice at once", async () => {
      const { briefId, clippingId } = await start(ana);

      const outcomes = await Promise.all([
        writer.writeNow({ briefId, userId: ana }),
        writer.writeNow({ briefId, userId: ana }),
      ]);

      expect(outcomes.toSorted()).toEqual(["ready", "skipped"]);
      expect(await ledger()).toHaveLength(1);
      expect((await fixture.research.getBrief(ana, clippingId))?.status).toBe("ready");
    });

    it("writes nothing for another user's brief, or one that isn't being written", async () => {
      const { briefId, clippingId } = await start(ana);

      expect(await writer.writeNow({ briefId, userId: ben })).toBe("skipped");
      expect(await writer.writeNow({ briefId, userId: ana })).toBe("ready");
      // A job delivered a second time finds the brief ready already.
      expect(await writer.writeNow({ briefId, userId: ana })).toBe("skipped");
      expect(await ledger()).toHaveLength(1);
      expect((await fixture.research.getBrief(ana, clippingId))?.status).toBe("ready");
    });
  });
});
