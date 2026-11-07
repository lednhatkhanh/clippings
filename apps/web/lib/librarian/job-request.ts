import type { Receiver } from "@upstash/qstash";

import type { LibrarianRunner } from "./run.ts";

/**
 * How many times QStash redelivers a librarian job after the first try. One: a run costs a Sonnet
 * call per stage, and a retry that repeats them is rarely worth it before next Monday.
 */
export const LIBRARIAN_RETRIES = 1;

export interface LibrarianJobDeps {
  /** This route's absolute URL, the destination QStash signed. */
  url: string;
  receiver: Pick<Receiver, "verify">;
  runner: Pick<LibrarianRunner, "run">;
}

const NOT_RETRYABLE = { "Upstash-NonRetryable-Error": "true" };

function userIdOf(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    const id = (parsed as { userId?: unknown } | null)?.userId;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}

/**
 * A QStash delivery of the weekly librarian job for one user. The signature is the only
 * credential, so nothing runs before it checks out, and it must be for this route's URL.
 *
 * The run is not a dry run, but a user's first one is forced to suggest only (`firstRun`). When
 * the model gateway stops the run (the day's cap or Anthropic's spend limit) the job ends quietly
 * with what was planned so far, answering 2xx so QStash doesn't retry against a closed door.
 */
export async function handleLibrarianJob(
  request: Request,
  { url, receiver, runner }: LibrarianJobDeps,
): Promise<Response> {
  const signature = request.headers.get("Upstash-Signature");
  const body = await request.text();
  if (!signature) return new Response("Missing signature", { status: 401 });
  try {
    if (!(await receiver.verify({ signature, body, url }))) throw new Error("Bad signature");
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }

  const userId = userIdOf(body);
  if (!userId) return new Response("Not a librarian job", { status: 400, headers: NOT_RETRYABLE });

  try {
    const run = await runner.run(userId, { dryRun: false });
    const count = (outcome: string) =>
      run.results.filter((result) => result.outcome === outcome).length;
    return Response.json({
      firstRun: run.firstRun,
      capReached: run.capReached,
      applied: count("applied"),
      suggested: count("suggested"),
      skipped: count("skipped"),
      notices: run.notices.length,
    });
  } catch (error) {
    console.error(`The librarian run for ${userId} failed`, error);
    return new Response("The librarian run failed", { status: 500 });
  }
}
