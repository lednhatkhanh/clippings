import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createGateway } from "@/lib/gateway/gateway.ts";
import {
  createServiceFixture,
  TEST_DATABASE_URL,
  type ServiceFixture,
} from "@clippings/db/testing";

import { createPlanner } from "./planner.ts";
import { createLibrarianRunner } from "./run.ts";

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

describe.skipIf(!TEST_DATABASE_URL)("the librarian run against the local Anthropic fake", () => {
  let fakes: Awaited<ReturnType<typeof startFakes>>;
  let fixture: ServiceFixture;
  let runner: ReturnType<typeof createLibrarianRunner>;
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
    const now = () => fixture.clock.now();
    runner = createLibrarianRunner({
      librarian: fixture.librarian,
      planner: createPlanner({ gateway, now }),
      now,
    });
    ana = await fixture.createUser("ana");
    ben = await fixture.createUser("ben");
  });

  afterEach(async () => {
    await fixture.close();
  });

  async function clip(userId: string, name: string, tags: string[]) {
    const { clipping } = await fixture.service.saveClipping(userId, {
      url: `https://example.com/${userId}/${name}`,
      tags,
      source: "web",
    });
    fixture.advanceClock(1000);
    return clipping.id;
  }

  /** Four pages about apis (one also tagged "apis"), three about db and one about Rust. */
  async function seed(userId: string) {
    await clip(userId, "a", ["api", "apis"]);
    await clip(userId, "b", ["api"]);
    await clip(userId, "c", ["api"]);
    await clip(userId, "d", ["api"]);
    await clip(userId, "e", ["Rust"]);
    await clip(userId, "f", ["db"]);
    await clip(userId, "g", ["db"]);
    await clip(userId, "h", ["db"]);
    await clip(userId, "f", ["db"]);
    await clip(userId, "g", ["db"]);
    await clip(userId, "h", ["db"]);
  }

  const actions = (run: Awaited<ReturnType<typeof runner.run>>) =>
    run.results.map((result) =>
      result.outcome === "skipped" ? `skipped ${result.action}` : result.change.action,
    );

  it("plans a library the schemas accept and reports the changes of a dry run without writing", async () => {
    await seed(ana);

    const run = await runner.run(ana, { dryRun: true });

    expect(run.firstRun).toBe(true);
    expect(run.capReached).toBe(false);
    expect(new Set(actions(run))).toEqual(
      new Set([
        "merge_tag",
        "rename_tag",
        "create_folder",
        "move_to_folder",
        "link_items",
        "write_topic_page",
      ]),
    );
    expect(run.results.every((result) => result.outcome === "would_suggest")).toBe(true);
    const { rows } = await fixture.pool.query(`select count(*)::int as n from library_changes`);
    expect(rows[0].n).toBe(0);
  });

  it("gives the same list on every run of the same library, dry or real", async () => {
    await seed(ana);

    const first = await runner.run(ana, { dryRun: true });
    const second = await runner.run(ana, { dryRun: true });
    const forced = await runner.run(ana, { dryRun: false });

    const shape = (run: typeof first) =>
      run.results.map((result) =>
        result.outcome === "skipped"
          ? result
          : {
              action: result.change.action,
              targetIds: result.change.targetIds,
              reason: result.change.reason,
              after: result.change.after,
            },
      );
    expect(shape(second)).toEqual(shape(first));
    expect(shape(forced)).toEqual(shape(first));
    expect(forced.results.every((result) => result.outcome === "suggested")).toBe(true);
  });

  it("doesn't bring back what the user dismissed, and ledgers its calls as the librarian's", async () => {
    await seed(ana);
    await runner.run(ana, { dryRun: false });
    expect(await fixture.librarian.hasLibrarianRun(ana)).toBe(true);
    // The first run's ideas wait as suggestions; dismiss them so the second run proposes afresh.
    for (const suggestion of (await fixture.librarian.listSuggestions(ana, { limit: 100 })).items) {
      await fixture.librarian.dismissSuggestion(ana, suggestion.id);
    }
    fixture.advanceClock(1000);

    const second = await runner.run(ana, { dryRun: false });

    // Dismissed ideas are not proposed again.
    expect(second.results.every((result) => result.outcome === "skipped")).toBe(true);

    const spent = await fixture.pool.query(
      `select distinct job_kind, model from model_usage where user_id = $1 order by model`,
      [ana],
    );
    expect(spent.rows).toEqual([
      { job_kind: "librarian", model: "claude-haiku-5-5" },
      { job_kind: "librarian", model: "claude-sonnet-5-5" },
    ]);
  });

  it("applies high-confidence changes, and a merge can be undone", async () => {
    await seed(ana);
    await fixture.librarian.markLibrarianRun(ana);

    const dry = await runner.run(ana, { dryRun: true });
    const real = await runner.run(ana, { dryRun: false });

    expect(dry.results.every((result) => result.outcome === "would_apply")).toBe(true);
    expect(actions(real)).toEqual(actions(dry));
    expect(real.results.every((result) => result.outcome === "applied")).toBe(true);
    expect(await fixture.service.findTagByName(ana, "apis")).toBeNull();

    const merge = real.results.find(
      (result) => result.outcome === "applied" && result.change.action === "merge_tag",
    );
    if (merge?.outcome !== "applied") throw new Error("No merge was applied");
    await fixture.librarian.undoChange(ana, merge.change.id);

    expect(await fixture.service.findTagByName(ana, "apis")).not.toBeNull();
  });

  it("files only the library it is given, never another user's", async () => {
    await seed(ana);
    await seed(ben);

    await runner.run(ana, { dryRun: false });

    const { rows } = await fixture.pool.query(
      `select count(*)::int as n from library_changes where user_id = $1`,
      [ben],
    );
    expect(rows[0].n).toBe(0);
  });

  it("stops quietly when the day's cap is used up", async () => {
    await seed(ana);
    await fixture.pool.query(
      `insert into user_settings (user_id, daily_cap_micros, updated_at) values ($1, 0, now())
         on conflict (user_id) do update set daily_cap_micros = 0`,
      [ana],
    );

    const run = await runner.run(ana, { dryRun: false });

    expect(run.capReached).toBe(true);
    expect(run.results).toEqual([]);
  });

  it("does nothing for an empty library", async () => {
    const run = await runner.run(ana, { dryRun: false });

    expect(run.results).toEqual([]);
    expect(run.costMicros).toBe(0);
  });
});
