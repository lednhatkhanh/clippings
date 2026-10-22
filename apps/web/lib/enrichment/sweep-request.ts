import { timingSafeEqual } from "node:crypto";

import type { ClippingsService } from "@clippings/db";

export interface SweepRequestDeps {
  /** `CRON_SECRET`. Vercel sends it as a bearer token with each cron call. */
  secret: string | undefined;
  service: Pick<ClippingsService, "sweepStuck" | "embedMissing" | "purgeDeleted" | "drainImports">;
}

export function isAuthorized(authorization: string | null, secret: string | undefined): boolean {
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
 * not outlive its day because of it.
 */
export async function handleSweepRequest(
  request: Request,
  { secret, service }: SweepRequestDeps,
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
  return Response.json({
    requested: requested.length,
    embedded,
    imports: imports.length,
    ...(importsFailed && { importsFailed }),
    purged,
  });
}
