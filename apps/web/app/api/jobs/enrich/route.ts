import { Receiver } from "@upstash/qstash";

import { getClippings } from "@/lib/clippings/service.ts";
import { handleEnrichRequest } from "@/lib/enrichment/enrich-request.ts";
import { ENRICH_PATH } from "@/lib/enrichment/job-publisher.ts";

// Reading a page and asking Haiku about it can take a while.
export const maxDuration = 60;

/** QStash delivers each enrichment job here. The signature is checked before anything runs. */
export async function POST(request: Request) {
  const origin = process.env.BETTER_AUTH_URL;
  if (!origin) return new Response("BETTER_AUTH_URL is not set", { status: 500 });
  return handleEnrichRequest(request, {
    url: new URL(ENRICH_PATH, origin).href,
    receiver: new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    }),
    service: getClippings(),
  });
}
