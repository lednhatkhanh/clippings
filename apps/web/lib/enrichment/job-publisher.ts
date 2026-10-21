import { Client } from "@upstash/qstash";

import type { JobPublisher } from "@clippings/db";

import { ENRICHMENT_RETRIES } from "./enrich-request.ts";

export const ENRICH_PATH = "/api/jobs/enrich";

/** Messages per QStash batch call (its limit is 100). */
const BATCH_SIZE = 100;

/**
 * Publishes enrichment jobs to QStash, which calls back the signed handler with retries. Reads
 * `QSTASH_TOKEN` (and `QSTASH_URL`, to publish to a local `qstash-cli dev` server) and calls the
 * app back at `BETTER_AUTH_URL`, its public origin.
 */
export function createJobPublisher(): JobPublisher {
  function connect() {
    const token = process.env.QSTASH_TOKEN;
    const origin = process.env.BETTER_AUTH_URL;
    if (!token) throw new Error("QSTASH_TOKEN is not set");
    if (!origin) throw new Error("BETTER_AUTH_URL is not set");

    // Lets QStash through Vercel's deployment protection, which guards non-production deploys.
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    return {
      client: new Client({ token }),
      message: (clippingId: string) => ({
        url: new URL(ENRICH_PATH, origin).href,
        body: { clippingId },
        retries: ENRICHMENT_RETRIES,
        ...(bypass ? { headers: { "x-vercel-protection-bypass": bypass } } : {}),
      }),
    };
  }

  return {
    async requestEnrichment(clippingId) {
      const { client, message } = connect();
      await client.publishJSON(message(clippingId));
    },

    async requestEnrichments(clippingIds, { spreadOverSeconds }) {
      if (clippingIds.length === 0) return;
      const { client, message } = connect();
      // The i-th job waits i/n of the window, so they arrive evenly instead of all at once.
      const messages = clippingIds.map((id, index) => ({
        ...message(id),
        delay: Math.floor((index * spreadOverSeconds) / clippingIds.length),
      }));
      for (let start = 0; start < messages.length; start += BATCH_SIZE) {
        await client.batchJSON(messages.slice(start, start + BATCH_SIZE));
      }
    },
  };
}
