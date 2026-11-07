import { isAuthorized } from "@/lib/enrichment/sweep-request.ts";
import type { LibrarianService } from "@clippings/db";

/** What the cron needs from QStash: one job per user, spread over a window. */
export interface LibrarianJobPublisher {
  requestRuns(userIds: readonly string[], options: { spreadOverSeconds: number }): Promise<void>;
}

export interface LibrarianCronDeps {
  /** `CRON_SECRET`. Vercel sends it as a bearer token with each cron call. */
  secret: string | undefined;
  librarian: Pick<LibrarianService, "listUsersWithLibrary">;
  jobs: LibrarianJobPublisher;
}

/**
 * Users' jobs start over this long, so their runs (each a handful of model calls) don't all hit
 * Anthropic's rate limit at once.
 */
export const LIBRARIAN_SPREAD_SECONDS = 30 * 60;

/**
 * The weekly cron (Monday night UTC, see `vercel.json`): publishes one librarian job per user
 * with a library. The runs happen in `/api/jobs/librarian`, each with its own time limit.
 */
export async function handleLibrarianCron(
  request: Request,
  { secret, librarian, jobs }: LibrarianCronDeps,
): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userIds = await librarian.listUsersWithLibrary();
  try {
    await jobs.requestRuns(userIds, { spreadOverSeconds: LIBRARIAN_SPREAD_SECONDS });
  } catch (error) {
    console.error("Couldn't request the librarian runs", error);
    return new Response("Couldn't request the librarian runs", { status: 502 });
  }
  return Response.json({ requested: userIds.length });
}
