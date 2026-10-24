import { timingSafeEqual } from "node:crypto";

import type { ClippingsService, ConnectionsService } from "@clippings/db";

export interface SweepRequestDeps {
  /** `CRON_SECRET`. Vercel sends it as a bearer token with each cron call. */
  secret: string | undefined;
  service: Pick<
    ClippingsService,
    "sweepStuck" | "embedMissing" | "purgeDeleted" | "drainImports" | "checkLinks"
  >;
  connections: Pick<ConnectionsService, "purgeUnusedClients">;
}

/**
 * Links checked per run. Ten run at once with a 5 s budget each, so even a run of nothing but
 * timeouts takes 20 s and stays inside the route's 60 s. The check goes last, after the work that
 * must not be skipped, and each result is written as it arrives.
 */
const LINK_CHECK_LIMIT = 40;

export function isAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || !authorization) return false;
  const given = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The daily cron: requests enrichment again for clippings stuck in pending or failed, embeds ready
 * clippings that have no embedding, requests the day's share of the imported backlog, and removes
 * clippings deleted more than a day ago and the OAuth clients registered a month ago that no one
 * ever used, then checks the links that are due. The drain needs the
 * queue, which can be down: its failure is logged and reported as `importsFailed`, and the purge
 * still runs, since a deleted clipping must not outlive its day because of it.
 */
export async function handleSweepRequest(
  request: Request,
  { secret, service, connections }: SweepRequestDeps,
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
  let clientsPurged = 0;
  try {
    clientsPurged = await connections.purgeUnusedClients();
  } catch (error) {
    console.error("Couldn't purge unused OAuth clients", error);
  }
  let links = { checked: 0, dead: 0 };
  let linksFailed = false;
  try {
    links = await service.checkLinks({ limit: LINK_CHECK_LIMIT });
  } catch (error) {
    linksFailed = true;
    console.error("Couldn't check links", error);
  }
  return Response.json({
    requested: requested.length,
    embedded,
    imports: imports.length,
    ...(importsFailed && { importsFailed }),
    purged,
    clientsPurged,
    linksChecked: links.checked,
    linksDead: links.dead,
    ...(linksFailed && { linksFailed }),
  });
}
