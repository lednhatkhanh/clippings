import { Receiver } from "@upstash/qstash";

import { LIBRARIAN_PATH } from "@/lib/librarian/job-publisher.ts";
import { handleLibrarianJob } from "@/lib/librarian/job-request.ts";
import { getLibrarianRunner } from "@/lib/librarian/service.ts";

// A run is a handful of Sonnet calls over the whole library; Hobby allows 300 s per step. The
// planner stops starting calls with time to spare (`RUN_BUDGET_MS`).
export const maxDuration = 300;

/** QStash delivers each user's weekly librarian job here. The signature is checked before anything runs. */
export async function POST(request: Request) {
  const origin = process.env.BETTER_AUTH_URL;
  if (!origin) return new Response("BETTER_AUTH_URL is not set", { status: 500 });
  return handleLibrarianJob(request, {
    url: new URL(LIBRARIAN_PATH, origin).href,
    receiver: new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    }),
    runner: getLibrarianRunner(),
  });
}
