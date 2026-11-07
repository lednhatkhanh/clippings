import { isAuthorized } from "@/lib/enrichment/sweep-request.ts";

import type { BriefRunner } from "./run-briefs.ts";

export interface BriefsCronDeps {
  /** `CRON_SECRET`. Vercel sends it as a bearer token with each cron call. */
  secret: string | undefined;
  runner: Pick<BriefRunner, "run">;
}

/**
 * The daily cron (05:00 UTC, after the sweep: see `vercel.json`): collects the research batches
 * that ended and submits the briefs that are queued. Answers with what the run did.
 */
export async function handleBriefsCron(
  request: Request,
  { secret, runner }: BriefsCronDeps,
): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    return Response.json(await runner.run());
  } catch (error) {
    console.error("The research briefs run failed", error);
    return new Response("The research briefs run failed", { status: 500 });
  }
}
