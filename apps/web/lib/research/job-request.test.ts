import { createHash, createHmac } from "node:crypto";

import { Receiver } from "@upstash/qstash";
import { constructNow, getUnixTime } from "date-fns";
import { describe, expect, it } from "vitest";

import { handleBriefsCron } from "./cron-request.ts";
import { BRIEF_JOB_PATH, handleBriefJob } from "./job-request.ts";
import type { BriefRunCounts } from "./run-briefs.ts";
import type { WriteNowOutcome } from "./write-now.ts";

const KEY = "current-signing-key";
const URL = `https://clippings.example${BRIEF_JOB_PATH}`;
const BRIEF_ID = "6f1c2f3e-8a41-4a8e-9a53-0d4f5a1b2c3d";

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

function job(outcome: WriteNowOutcome | Error = "ready") {
  const calls: { briefId: string; userId: string }[] = [];
  const deps = {
    url: URL,
    receiver: new Receiver({ currentSigningKey: KEY, nextSigningKey: "next" }),
    writer: {
      writeNow: async (input: { briefId: string; userId: string }) => {
        calls.push(input);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    },
  };
  const deliver = (body: string, headers: Record<string, string>) =>
    handleBriefJob(new Request(URL, { method: "POST", body, headers }), deps);
  return { calls, deliver };
}

const body = JSON.stringify({ briefId: BRIEF_ID, userId: "ada" });

describe("the brief job", () => {
  it("writes the brief named in the signed message", async () => {
    const { calls, deliver } = job();

    const response = await deliver(body, { "Upstash-Signature": sign(body) });

    expect(response.status).toBe(200);
    expect(calls).toEqual([{ briefId: BRIEF_ID, userId: "ada" }]);
    expect(await response.json()).toEqual({ outcome: "ready" });
  });

  it.each<WriteNowOutcome>(["failed", "held", "skipped"])(
    "answers 2xx when the brief came to %s, so QStash doesn't write it again",
    async (outcome) => {
      const response = await job(outcome).deliver(body, { "Upstash-Signature": sign(body) });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ outcome });
    },
  );

  it("answers 2xx even when the writer throws", async () => {
    const response = await job(new Error("the database is down")).deliver(body, {
      "Upstash-Signature": sign(body),
    });

    expect(response.status).toBe(200);
  });

  it("runs nothing without a valid signature for this URL", async () => {
    const { calls, deliver } = job();

    const missing = await deliver(body, {});
    const forged = await deliver(body, { "Upstash-Signature": sign(body).slice(0, -3) + "abc" });
    const elsewhere = await deliver(body, {
      "Upstash-Signature": sign(body, "https://clippings.example/api/jobs/librarian"),
    });
    const tampered = await deliver(JSON.stringify({ briefId: BRIEF_ID, userId: "bob" }), {
      "Upstash-Signature": sign(body),
    });

    expect([missing.status, forged.status, elsewhere.status, tampered.status]).toEqual([
      401, 401, 401, 401,
    ]);
    expect(calls).toEqual([]);
  });

  it.each([
    ["not json"],
    [JSON.stringify({})],
    [JSON.stringify({ userId: "ada" })],
    [JSON.stringify({ briefId: "not-a-uuid", userId: "ada" })],
    [JSON.stringify({ briefId: BRIEF_ID, userId: 7 })],
  ])("refuses %s without retrying", async (bad) => {
    const { calls, deliver } = job();

    const response = await deliver(bad, { "Upstash-Signature": sign(bad) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Upstash-NonRetryable-Error")).toBe("true");
    expect(calls).toEqual([]);
  });
});

describe("the briefs cron", () => {
  const counts: BriefRunCounts = {
    stuck: 0,
    unstarted: 0,
    unfinished: 0,
    pending: 0,
    failedBatches: 0,
    ready: 2,
    retried: 0,
    dropped: 0,
    submitted: 3,
    held: 0,
  };

  function cron(run: () => Promise<BriefRunCounts> = async () => counts) {
    let runs = 0;
    const deps = {
      secret: "cron-secret",
      runner: {
        run: async () => {
          runs += 1;
          return run();
        },
      },
    };
    const call = (authorization?: string) =>
      handleBriefsCron(
        new Request("https://clippings.example/api/cron/briefs", {
          headers: authorization ? { authorization } : {},
        }),
        deps,
      );
    return { runs: () => runs, call };
  }

  it("runs the briefs and reports what they did", async () => {
    const { runs, call } = cron();

    const response = await call("Bearer cron-secret");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(counts);
    expect(runs()).toBe(1);
  });

  it.each([[undefined], ["Bearer wrong"], ["cron-secret"]])(
    "runs nothing for the credential %s",
    async (authorization) => {
      const { runs, call } = cron();

      expect((await call(authorization)).status).toBe(401);
      expect(runs()).toBe(0);
    },
  );

  it("answers 500 when the run fails", async () => {
    const { call } = cron(async () => {
      throw new Error("the database is down");
    });

    expect((await call("Bearer cron-secret")).status).toBe(500);
  });
});
