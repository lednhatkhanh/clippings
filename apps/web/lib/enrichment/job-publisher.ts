import { Client } from "@upstash/qstash";

import type { JobPublisher } from "@clippings/db";

import { ENRICHMENT_RETRIES } from "./enrich-request";

export const ENRICH_PATH = "/api/jobs/enrich";

/**
 * Publishes enrichment jobs to QStash, which calls back the signed handler with retries. Reads
 * `QSTASH_TOKEN` (and `QSTASH_URL`, to publish to a local `qstash-cli dev` server) and calls the
 * app back at `BETTER_AUTH_URL`, its public origin.
 */
export function createJobPublisher(): JobPublisher {
  return {
    async requestEnrichment(clippingId) {
      const token = process.env.QSTASH_TOKEN;
      const origin = process.env.BETTER_AUTH_URL;
      if (!token) throw new Error("QSTASH_TOKEN is not set");
      if (!origin) throw new Error("BETTER_AUTH_URL is not set");

      // Lets QStash through Vercel's deployment protection, which guards non-production deploys.
      const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      await new Client({ token }).publishJSON({
        url: new URL(ENRICH_PATH, origin).href,
        body: { clippingId },
        retries: ENRICHMENT_RETRIES,
        ...(bypass ? { headers: { "x-vercel-protection-bypass": bypass } } : {}),
      });
    },
  };
}
