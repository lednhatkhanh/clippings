import { Receiver } from "@upstash/qstash";

import { BRIEF_JOB_PATH, handleBriefJob } from "@/lib/research/job-request.ts";
import { getBriefWriter } from "@/lib/research/runner.ts";

// One Sonnet call with web search, up to 240 s (`WRITE_TIMEOUT_MS`); Hobby allows 300 s per step.
export const maxDuration = 300;

/** QStash delivers each "write it now" job here. The signature is checked before anything runs. */
export async function POST(request: Request) {
  const origin = process.env.BETTER_AUTH_URL;
  if (!origin) return new Response("BETTER_AUTH_URL is not set", { status: 500 });
  return handleBriefJob(request, {
    url: new URL(BRIEF_JOB_PATH, origin).href,
    receiver: new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    }),
    writer: getBriefWriter(),
  });
}
