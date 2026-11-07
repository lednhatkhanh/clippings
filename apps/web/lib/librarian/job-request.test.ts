import { createHash, createHmac } from "node:crypto";

import { Receiver } from "@upstash/qstash";
import { constructNow, getUnixTime } from "date-fns";
import { describe, expect, it } from "vitest";

import { handleLibrarianCron, LIBRARIAN_SPREAD_SECONDS } from "./cron-request.ts";
import { handleLibrarianJob } from "./job-request.ts";
import type { LibrarianRun } from "./run.ts";

const KEY = "current-signing-key";
const URL = "https://clippings.example/api/jobs/librarian";

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** What QStash attaches to a delivery: an HS256 JWT over the URL and a hash of the body. */
function sign(body: string, destination = URL): string {
  const now = getUnixTime(constructNow(undefined));
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: "Upstash",
      sub: destination,
      exp: now + 300,
      nbf: now - 10,
      iat: now,
      jti: "jwt_test",
      body: createHash("sha256").update(body).digest("base64url"),
    }),
  );
  const signature = createHmac("sha256", KEY).update(`${header}.${claims}`).digest("base64url");
  return `${header}.${claims}.${signature}`;
}

const run = (overrides: Partial<LibrarianRun> = {}): LibrarianRun => ({
  dryRun: false,
  firstRun: false,
  capReached: false,
  results: [],
  proposals: [],
  notices: [],
  costMicros: 0,
  ...overrides,
});

function job(result: LibrarianRun | Error = run()) {
  const calls: { userId: string; dryRun: boolean }[] = [];
  const deps = {
    url: URL,
    receiver: new Receiver({ currentSigningKey: KEY, nextSigningKey: "next" }),
    runner: {
      run: async (userId: string, options: { dryRun: boolean }) => {
        calls.push({ userId, dryRun: options.dryRun });
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
  const deliver = (body: string, headers: Record<string, string>) =>
    handleLibrarianJob(new Request(URL, { method: "POST", body, headers }), deps);
  return { calls, deliver };
}

const body = JSON.stringify({ userId: "ada" });

describe("the librarian job", () => {
  it("runs the librarian for the user in the signed message, for real", async () => {
    const { calls, deliver } = job(run({ firstRun: true }));

    const response = await deliver(body, { "Upstash-Signature": sign(body) });

    expect(response.status).toBe(200);
    expect(calls).toEqual([{ userId: "ada", dryRun: false }]);
    expect(await response.json()).toMatchObject({ firstRun: true, capReached: false });
  });

  it("counts what the run did", async () => {
    const change = { id: "c" } as never;
    const { deliver } = job(
      run({
        results: [
          { outcome: "applied", change },
          { outcome: "suggested", change },
          { outcome: "suggested", change },
          { outcome: "skipped", action: "link_items", reason: "Linked already" },
        ],
      }),
    );

    const response = await deliver(body, { "Upstash-Signature": sign(body) });

    expect(await response.json()).toMatchObject({ applied: 1, suggested: 2, skipped: 1 });
  });

  it("ends quietly when the gateway stopped the run", async () => {
    const { deliver } = job(run({ capReached: true }));

    const response = await deliver(body, { "Upstash-Signature": sign(body) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ capReached: true });
  });

  it("answers 500, so QStash retries, when the run fails", async () => {
    const { deliver } = job(new Error("the database is down"));

    const response = await deliver(body, { "Upstash-Signature": sign(body) });

    expect(response.status).toBe(500);
  });

  it("runs nothing without a valid signature for this URL", async () => {
    const { calls, deliver } = job();

    const missing = await deliver(body, {});
    const forged = await deliver(body, { "Upstash-Signature": sign(body).slice(0, -3) + "abc" });
    const elsewhere = await deliver(body, {
      "Upstash-Signature": sign(body, "https://clippings.example/api/jobs/enrich"),
    });
    const tampered = await deliver(JSON.stringify({ userId: "bob" }), {
      "Upstash-Signature": sign(body),
    });

    expect([missing.status, forged.status, elsewhere.status, tampered.status]).toEqual([
      401, 401, 401, 401,
    ]);
    expect(calls).toEqual([]);
  });

  it.each([["not json"], [JSON.stringify({})], [JSON.stringify({ userId: 7 })]])(
    "refuses %s without retrying",
    async (bad) => {
      const { calls, deliver } = job();

      const response = await deliver(bad, { "Upstash-Signature": sign(bad) });

      expect(response.status).toBe(400);
      expect(response.headers.get("Upstash-NonRetryable-Error")).toBe("true");
      expect(calls).toEqual([]);
    },
  );
});

describe("the librarian cron", () => {
  function cron(failPublishing = false) {
    const published: { ids: readonly string[]; spread: number }[] = [];
    const deps = {
      secret: "cron-secret",
      librarian: { listUsersWithLibrary: async () => ["ada", "bob"] },
      jobs: {
        requestRuns: async (
          ids: readonly string[],
          { spreadOverSeconds }: { spreadOverSeconds: number },
        ) => {
          if (failPublishing) throw new Error("QStash is down");
          published.push({ ids, spread: spreadOverSeconds });
        },
      },
    };
    const call = (authorization?: string) =>
      handleLibrarianCron(
        new Request("https://clippings.example/api/cron/librarian", {
          headers: authorization ? { authorization } : {},
        }),
        deps,
      );
    return { published, call };
  }

  it("publishes one job per user with a library, spread over a window", async () => {
    const { published, call } = cron();

    const response = await call("Bearer cron-secret");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ requested: 2 });
    expect(published).toEqual([{ ids: ["ada", "bob"], spread: LIBRARIAN_SPREAD_SECONDS }]);
  });

  it.each([[undefined], ["Bearer wrong"], ["cron-secret"]])(
    "publishes nothing for the credential %s",
    async (authorization) => {
      const { published, call } = cron();

      expect((await call(authorization)).status).toBe(401);
      expect(published).toEqual([]);
    },
  );

  it("reports a queue that can't be reached", async () => {
    expect((await cron(true).call("Bearer cron-secret")).status).toBe(502);
  });
});
