import { createHash, createHmac } from "node:crypto";

import { Receiver } from "@upstash/qstash";
import { constructNow, getUnixTime, parseISO } from "date-fns";
import { describe, expect, it } from "vitest";

import { handleLessonsCron, LESSONS_SPREAD_SECONDS } from "./cron-request.ts";
import { handleLessonJob } from "./job-request.ts";
import type { WriteOutcome } from "./writer.ts";

const KEY = "current-signing-key";
const URL = "https://clippings.example/api/jobs/lessons";

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

function job(result: WriteOutcome | Error = "written") {
  const calls: { userId: string; day: string }[] = [];
  const deps = {
    url: URL,
    receiver: new Receiver({ currentSigningKey: KEY, nextSigningKey: "next" }),
    writer: {
      write: async (userId: string, day: string) => {
        calls.push({ userId, day });
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
  const deliver = (body: string, headers: Record<string, string>) =>
    handleLessonJob(new Request(URL, { method: "POST", body, headers }), deps);
  return { calls, deliver };
}

const body = JSON.stringify({ userId: "ada", day: "2026-11-10" });

describe("the lesson job", () => {
  it("writes the lesson for the user and day in the signed message", async () => {
    const { calls, deliver } = job("written");

    const response = await deliver(body, { "Upstash-Signature": sign(body) });

    expect(response.status).toBe(200);
    expect(calls).toEqual([{ userId: "ada", day: "2026-11-10" }]);
    expect(await response.json()).toEqual({ outcome: "written" });
  });

  it.each<WriteOutcome>(["exists", "cap_reached", "nothing_to_teach", "unusable"])(
    "ends quietly, answering 200, when the lesson came to %s",
    async (outcome) => {
      const { deliver } = job(outcome);

      const response = await deliver(body, { "Upstash-Signature": sign(body) });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ outcome });
    },
  );

  it("answers 500, so QStash retries, when writing fails", async () => {
    const { deliver } = job(new Error("the database is down"));

    const response = await deliver(body, { "Upstash-Signature": sign(body) });

    expect(response.status).toBe(500);
  });

  it("writes nothing without a valid signature for this URL", async () => {
    const { calls, deliver } = job();

    const missing = await deliver(body, {});
    const forged = await deliver(body, { "Upstash-Signature": sign(body).slice(0, -3) + "abc" });
    const elsewhere = await deliver(body, {
      "Upstash-Signature": sign(body, "https://clippings.example/api/jobs/librarian"),
    });
    const tampered = await deliver(JSON.stringify({ userId: "bob", day: "2026-11-10" }), {
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
    [JSON.stringify({ userId: 7, day: "2026-11-10" })],
    [JSON.stringify({ userId: "ada" })],
    [JSON.stringify({ userId: "ada", day: "tomorrow" })],
    [JSON.stringify({ userId: "ada", day: "2026-02-30" })],
    [JSON.stringify({ userId: "ada", day: "2026-11-10T07:00:00Z" })],
  ])("refuses %s without retrying", async (bad) => {
    const { calls, deliver } = job();

    const response = await deliver(bad, { "Upstash-Signature": sign(bad) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Upstash-NonRetryable-Error")).toBe("true");
    expect(calls).toEqual([]);
  });
});

describe("the lessons cron", () => {
  function cron(failPublishing = false) {
    const published: { ids: readonly string[]; day: string; spread: number }[] = [];
    const deps = {
      secret: "cron-secret",
      librarian: { listUsersWithLibrary: async () => ["ada", "bob"] },
      // Evening in New York is already the next day in UTC.
      now: () => parseISO("2026-11-10T23:30:00-05:00"),
      jobs: {
        requestLessons: async (
          ids: readonly string[],
          { day, spreadOverSeconds }: { day: string; spreadOverSeconds: number },
        ) => {
          if (failPublishing) throw new Error("QStash is down");
          published.push({ ids, day, spread: spreadOverSeconds });
        },
      },
    };
    const call = (authorization?: string) =>
      handleLessonsCron(
        new Request("https://clippings.example/api/cron/lessons", {
          headers: authorization ? { authorization } : {},
        }),
        deps,
      );
    return { published, call };
  }

  it("publishes one job per user with a library, for today's UTC day, spread over a window", async () => {
    const { published, call } = cron();

    const response = await call("Bearer cron-secret");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ day: "2026-11-11", requested: 2 });
    expect(published).toEqual([
      { ids: ["ada", "bob"], day: "2026-11-11", spread: LESSONS_SPREAD_SECONDS },
    ]);
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
