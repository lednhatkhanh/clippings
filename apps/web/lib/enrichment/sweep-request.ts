import { timingSafeEqual } from "node:crypto";

import type { ClippingsService, DigestService } from "@clippings/db";

export interface SweepRequestDeps {
  /** `CRON_SECRET`. Vercel sends it as a bearer token with each cron call. */
  secret: string | undefined;
  service: Pick<ClippingsService, "sweepStuck" | "embedMissing" | "purgeDeleted" | "drainImports">;
  digests: Pick<DigestService, "generateWeeklyDigests">;
}

/** How many users' digests one sweep writes: the model calls run at once, inside the route's 60 s. */
const DIGESTS_PER_SWEEP = 10;

function isAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;
  const given = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The daily cron: requests enrichment again for clippings stuck in pending or failed, embeds ready
 * clippings that have no embedding, requests the day's share of the imported backlog, and removes
 * clippings deleted more than a day ago. The drain needs the queue, which can be down: its failure
 * is logged and reported as `importsFailed`, and the purge still runs, since a deleted clipping must
 * not outlive its day because of it. The weekly digests come last, as they take the longest, and
 * their failure is reported as `digestsFailed` and leaves the rest as it was.
 */
export async function handleSweepRequest(
  request: Request,
  { secret, service, digests }: SweepRequestDeps,
): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const requested = await service.sweepStuck();
  const embedded = await service.embedMissing();
  let imports: string[] = [];
  let importsFailed = false;
  try {
    imports = await service.drainImports();
  } catch (error) {
    importsFailed = true;
    console.error("Couldn't request the import backlog", error);
  }
  const purged = await service.purgeDeleted();
  let digested = 0;
  let digestsFailed = false;
  try {
    digested = await digests.generateWeeklyDigests({ limit: DIGESTS_PER_SWEEP });
  } catch (error) {
    digestsFailed = true;
    console.error("Couldn't write the weekly digests", error);
  }
  return Response.json({
    requested: requested.length,
    embedded,
    imports: imports.length,
    ...(importsFailed && { importsFailed }),
    purged,
    digests: digested,
    ...(digestsFailed && { digestsFailed }),
  });
}
