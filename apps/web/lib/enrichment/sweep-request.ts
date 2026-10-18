import { timingSafeEqual } from "node:crypto";

import type { ClippingsService } from "@clippings/db";

export interface SweepRequestDeps {
  /** `CRON_SECRET`. Vercel sends it as a bearer token with each cron call. */
  secret: string | undefined;
  service: Pick<ClippingsService, "sweepStuck" | "purgeDeleted">;
}

function isAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;
  const given = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The daily cron: requests enrichment again for clippings stuck in pending or failed, and removes
 * clippings deleted more than a day ago.
 */
export async function handleSweepRequest(
  request: Request,
  { secret, service }: SweepRequestDeps,
): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const requested = await service.sweepStuck();
  const purged = await service.purgeDeleted();
  return Response.json({ requested: requested.length, purged });
}
