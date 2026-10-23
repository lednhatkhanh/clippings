import { addSeconds } from "date-fns";

import { isAuthorized } from "@/lib/enrichment/sweep-request.ts";
import type { Clock, DigestService } from "@clippings/db";

export interface DigestRequestDeps {
  /** `CRON_SECRET`. Vercel sends it as a bearer token with each cron call. */
  secret: string | undefined;
  digests: Pick<DigestService, "generateWeeklyDigests">;
  clock: Clock;
}

/** Users per run. A run that starts few calls near its end leaves the rest to the next day. */
export const DIGESTS_PER_RUN = 20;
/** The route's `maxDuration` (seconds): the run stops starting model calls well before it. */
export const ROUTE_SECONDS = 60;

/**
 * The daily digest cron: writes the weekly digest of the last finished week for users who have
 * none yet, up to `DIGESTS_PER_RUN`, and answers with how many it wrote. When the run itself fails
 * (the database is down) it is logged, reported as `digestsFailed` and answered with a 500, so the
 * cron shows as failed.
 */
export async function handleDigestRequest(
  request: Request,
  { secret, digests, clock }: DigestRequestDeps,
): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const deadline = addSeconds(clock.now(), ROUTE_SECONDS);
  try {
    const written = await digests.generateWeeklyDigests({ limit: DIGESTS_PER_RUN, deadline });
    return Response.json({ digests: written });
  } catch (error) {
    console.error("Couldn't write the weekly digests", error);
    return Response.json({ digests: 0, digestsFailed: true }, { status: 500 });
  }
}
