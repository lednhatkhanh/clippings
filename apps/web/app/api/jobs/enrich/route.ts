import { Receiver } from "@upstash/qstash";

import { getClippings } from "@/lib/clippings/service.ts";
import { handleEnrichRequest } from "@/lib/enrichment/enrich-request.ts";

// Reading a page and asking Haiku about it can take a while.
export const maxDuration = 60;

/** QStash delivers each enrichment job here. The signature is checked before anything runs. */
export async function POST(request: Request) {
  return handleEnrichRequest(request, {
    receiver: new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    }),
    service: getClippings(),
  });
}
