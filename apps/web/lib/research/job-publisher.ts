import { Client } from "@upstash/qstash";

import { BRIEF_JOB_PATH, BRIEF_JOB_RETRIES } from "./job-request.ts";

/**
 * Asks QStash to call back the signed brief handler, which writes one brief right away. Reads
 * `QSTASH_TOKEN` (and `QSTASH_URL`, to publish to a local `qstash-cli dev` server) and calls the
 * app back at `BETTER_AUTH_URL`, its public origin.
 */
export async function publishBriefJob(job: { briefId: string; userId: string }): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  const origin = process.env.BETTER_AUTH_URL;
  if (!token) throw new Error("QSTASH_TOKEN is not set");
  if (!origin) throw new Error("BETTER_AUTH_URL is not set");
  // Lets QStash through Vercel's deployment protection, which guards non-production deploys.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  await new Client({ token }).publishJSON({
    url: new URL(BRIEF_JOB_PATH, origin).href,
    body: job,
    retries: BRIEF_JOB_RETRIES,
    ...(bypass ? { headers: { "x-vercel-protection-bypass": bypass } } : {}),
  });
}
