import { utc } from "@date-fns/utc";
import { format } from "date-fns";

import { isAuthorized } from "@/lib/enrichment/sweep-request.ts";
import type { LibrarianService } from "@clippings/db";

/** What the cron needs from QStash: one job per user, spread over a window. */
export interface LessonJobPublisher {
  requestLessons(
    userIds: readonly string[],
    options: { day: string; spreadOverSeconds: number },
  ): Promise<void>;
}

export interface LessonsCronDeps {
  /** `CRON_SECRET`. Vercel sends it as a bearer token with each cron call. */
  secret: string | undefined;
  /** Users with a library are the ones with something to learn from. */
  librarian: Pick<LibrarianService, "listUsersWithLibrary">;
  jobs: LessonJobPublisher;
  now: () => Date;
}

/**
 * Users' jobs start over this long, so their lessons (each a long Sonnet call) don't all hit
 * Anthropic's rate limit at once.
 */
export const LESSONS_SPREAD_SECONDS = 30 * 60;

/**
 * The Tuesday and Friday cron (07:00 UTC, see `vercel.json`): publishes one lesson job per user
 * with a library. The job carries the UTC day it was called for, so a delivery that arrives late
 * still writes that day's lesson, and a redelivery finds it. The lessons are written in
 * `/api/jobs/lessons`, each with its own time limit.
 */
export async function handleLessonsCron(
  request: Request,
  { secret, librarian, jobs, now }: LessonsCronDeps,
): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const day = format(now(), "yyyy-MM-dd", { in: utc });
  const userIds = await librarian.listUsersWithLibrary();
  try {
    await jobs.requestLessons(userIds, { day, spreadOverSeconds: LESSONS_SPREAD_SECONDS });
  } catch (error) {
    console.error("Couldn't request the lessons", error);
    return new Response("Couldn't request the lessons", { status: 502 });
  }
  return Response.json({ day, requested: userIds.length });
}
