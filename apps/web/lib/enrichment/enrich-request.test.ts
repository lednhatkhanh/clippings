import { createHash, createHmac } from "node:crypto";

import { Receiver } from "@upstash/qstash";
import { describe, expect, it } from "vitest";

import { ENRICHMENT_RETRIES, handleEnrichRequest } from "./enrich-request.ts";

const CURRENT_KEY = "current-signing-key";
const NEXT_KEY = "next-signing-key";
const URL = "https://clippings.example/api/jobs/enrich";
const CLIPPING_ID = "5b0b3f3e-5b43-4a52-9e0e-0d0e6e0a6c11";

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** What QStash attaches to a delivery: an HS256 JWT over the URL and a hash of the body. */
function sign(body: string, key: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: "Upstash",
      sub: URL,
      exp: now + 300,
      nbf: now - 10,
      iat: now,
      jti: "jwt_test",
      body: createHash("sha256").update(body).digest("base64url"),
    }),
  );
  const signature = createHmac("sha256", key).update(`${header}.${claims}`).digest("base64url");
  return `${header}.${claims}.${signature}`;
}

function setup() {
  const enriched: Array<{ id: string; lastAttempt: boolean | undefined }> = [];
  let failWith: Error | null = null;
  const deps = {
    receiver: new Receiver({ currentSigningKey: CURRENT_KEY, nextSigningKey: NEXT_KEY }),
    service: {
      enrichClipping: async (id: string, options?: { lastAttempt?: boolean }) => {
        enriched.push({ id, lastAttempt: options?.lastAttempt });
        if (failWith) throw failWith;
        return "ready" as const;
      },
    },
  };
  const deliver = (body: string, headers: Record<string, string>): Promise<Response> =>
    handleEnrichRequest(new Request(URL, { method: "POST", body, headers }), deps);
  return {
    enriched,
    deliver,
    failWith: (error: Error) => {
      failWith = error;
    },
  };
}

const job = JSON.stringify({ clippingId: CLIPPING_ID });

describe("handleEnrichRequest", () => {
  it("rejects a request with no signature, without enriching anything", async () => {
    const { deliver, enriched } = setup();

    const response = await deliver(job, {});

    expect(response.status).toBe(401);
    expect(enriched).toEqual([]);
  });

  it("rejects a signature made with another key, or for another body", async () => {
    const { deliver, enriched } = setup();

    const wrongKey = await deliver(job, { "Upstash-Signature": sign(job, "someone-elses-key") });
    const otherBody = await deliver(job, {
      "Upstash-Signature": sign(JSON.stringify({ clippingId: "another" }), CURRENT_KEY),
    });

    expect(wrongKey.status).toBe(401);
    expect(otherBody.status).toBe(401);
    expect(enriched).toEqual([]);
  });

  it("enriches the clipping when the signature is valid, with the current or the next key", async () => {
    const { deliver, enriched } = setup();

    const withCurrent = await deliver(job, { "Upstash-Signature": sign(job, CURRENT_KEY) });
    const withNext = await deliver(job, { "Upstash-Signature": sign(job, NEXT_KEY) });

    expect(withCurrent.status).toBe(200);
    expect(withNext.status).toBe(200);
    expect(enriched.map((call) => call.id)).toEqual([CLIPPING_ID, CLIPPING_ID]);
  });

  it("tells the service when this is the last delivery the queue will make", async () => {
    const { deliver, enriched } = setup();
    const signed = { "Upstash-Signature": sign(job, CURRENT_KEY) };

    await deliver(job, { ...signed, "Upstash-Retried": "0" });
    await deliver(job, { ...signed, "Upstash-Retried": String(ENRICHMENT_RETRIES - 1) });
    await deliver(job, { ...signed, "Upstash-Retried": String(ENRICHMENT_RETRIES) });

    expect(enriched.map((call) => call.lastAttempt)).toEqual([false, false, true]);
  });

  it("answers 500 when reading fails before the last attempt, so the queue retries", async () => {
    const { deliver, failWith } = setup();
    failWith(new Error("503 from the site"));

    const response = await deliver(job, {
      "Upstash-Signature": sign(job, CURRENT_KEY),
      "Upstash-Retried": "0",
    });

    expect(response.status).toBe(500);
  });

  it("refuses a signed body that is not a job, and asks the queue not to retry it", async () => {
    const { deliver, enriched } = setup();
    const notAJob = JSON.stringify({ something: "else" });

    const response = await deliver(notAJob, { "Upstash-Signature": sign(notAJob, CURRENT_KEY) });

    expect(response.status).toBe(400);
    expect(response.headers.get("Upstash-NonRetryable-Error")).toBe("true");
    expect(enriched).toEqual([]);
  });
});
