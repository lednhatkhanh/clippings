import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createGateway } from "@/lib/gateway/gateway.ts";
import { createLessonsService, type LessonsService } from "@clippings/db";
import {
  createServiceFixture,
  TEST_DATABASE_URL,
  type ServiceFixture,
} from "@clippings/db/testing";

import { createLessonWriter } from "./writer.ts";

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

describe.skipIf(!TEST_DATABASE_URL)("the lesson writer against the local Anthropic fake", () => {
  const DAY = "2026-11-10";
  const NEXT_DAY = "2026-11-13";

  let fakes: Awaited<ReturnType<typeof startFakes>>;
  let fixture: ServiceFixture;
  let lessons: LessonsService;
  let writer: ReturnType<typeof createLessonWriter>;
  let ana: string;
  let ben: string;

  beforeAll(async () => {
    fakes = await startFakes();
  });

  afterAll(() => fakes.stop());

  beforeEach(async () => {
    fixture = await createServiceFixture();
    const anthropic = new Anthropic({
      apiKey: "local",
      baseURL: fakes.anthropicUrl,
      maxRetries: 0,
    });
    const gateway = createGateway({ ledger: fixture.usage, anthropic: () => anthropic });
    lessons = createLessonsService({ pool: fixture.pool, clock: fixture.clock });
    writer = createLessonWriter({ lessons, gateway });
    ana = await fixture.createUser("ana");
    ben = await fixture.createUser("ben");
  });

  afterEach(async () => {
    await fixture.close();
  });

  async function clip(userId: string, name: string, tags: string[]) {
    await fixture.service.saveClipping(userId, {
      url: `https://example.com/${userId}/${name}`,
      tags,
      source: "web",
    });
    fixture.advanceClock(1000);
  }

  const seed = async (userId: string) => {
    for (const name of ["a", "b", "c"]) await clip(userId, name, ["api"]);
  };

  const ledger = async () =>
    (await fixture.pool.query(`select user_id, job_kind, model from model_usage`)).rows;

  it("writes a lesson the schemas accept, on the tag with the most to teach, and ledgers the call", async () => {
    await seed(ana);

    expect(await writer.write(ana, DAY)).toBe("written");

    const [lesson] = await lessons.listLessons(ana);
    expect(lesson).toMatchObject({ day: DAY, status: "ready", topic: "A first look at api" });
    expect(lesson!.body).toContain("## Why api matters");
    expect(lesson!.quiz).toMatchObject({ answerIndex: 0 });
    expect(lesson!.quiz!.choices).toHaveLength(4);
    expect(lesson!.recap).toBe("");
    expect(lesson!.sources).toHaveLength(2);
    expect(await ledger()).toEqual([
      { user_id: ana, job_kind: "lesson", model: "claude-sonnet-5-5" },
    ]);
  });

  it("stands down when the day's lesson is written, without calling the model again", async () => {
    await seed(ana);
    await writer.write(ana, DAY);

    expect(await writer.write(ana, DAY)).toBe("exists");

    expect(await ledger()).toHaveLength(1);
  });

  it("recaps the previous lesson and leaves its tag alone", async () => {
    await seed(ana);
    await writer.write(ana, DAY);

    expect(await writer.write(ana, NEXT_DAY)).toBe("written");

    const [second] = await lessons.listLessons(ana);
    expect(second).toMatchObject({ day: NEXT_DAY, topic: "A first look at recent reading" });
    expect(second!.recap).toContain("A first look at api");
  });

  it("writes only from the user's own library", async () => {
    await seed(ana);
    await clip(ben, "z", ["rust"]);

    await writer.write(ben, DAY);

    const [lesson] = await lessons.listLessons(ben);
    expect(lesson).toMatchObject({ topic: "A first look at rust" });
    expect(lesson!.sources).toHaveLength(1);
    expect(await lessons.listLessons(ana)).toEqual([]);
  });

  it("skips the lesson, saying why, when the day's cap is used up", async () => {
    await seed(ana);
    await fixture.settings.updateAutomationSettings(ana, { dailyCapMicros: 0 });

    expect(await writer.write(ana, DAY)).toBe("cap_reached");

    expect((await lessons.listLessons(ana))[0]).toMatchObject({
      status: "skipped",
      skipKind: "cap_reached",
      skipReason: "Today's spending cap was reached before the lesson was written.",
    });
    expect(await ledger()).toEqual([]);
  });

  it("skips an empty library as having nothing to teach", async () => {
    expect(await writer.write(ana, DAY)).toBe("nothing_to_teach");

    expect((await lessons.listLessons(ana))[0]).toMatchObject({
      status: "skipped",
      skipKind: "nothing_to_teach",
    });
  });

  it("skips the lesson as failed and throws, so the job is retried, when the provider is down", async () => {
    await fixture.service.saveNote(ana, {
      body: "Notes on APIs. [fake-error overloaded]",
      tags: ["api"],
      source: "web",
    });

    await expect(writer.write(ana, DAY)).rejects.toThrow();

    expect((await lessons.listLessons(ana))[0]).toMatchObject({
      status: "skipped",
      skipKind: "failed",
    });
  });

  it("treats the provider's spend limit as the cap", async () => {
    await fixture.service.saveNote(ana, {
      body: "Notes on APIs. [fake-error spend-limit]",
      tags: ["api"],
      source: "web",
    });

    expect(await writer.write(ana, DAY)).toBe("cap_reached");

    expect((await lessons.listLessons(ana))[0]).toMatchObject({
      skipKind: "cap_reached",
      skipReason: "The AI provider's spending limit was reached before the lesson was written.",
    });
  });
});
