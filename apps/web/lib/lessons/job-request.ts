import type { Receiver } from "@upstash/qstash";
import { isValid, parseISO } from "date-fns";

import type { LessonWriter } from "./writer.ts";

/**
 * How many times QStash redelivers a lesson job after the first try. One: a lesson is a long
 * Sonnet call, and the next lesson comes in a few days.
 */
export const LESSON_RETRIES = 1;

export interface LessonJobDeps {
  /** This route's absolute URL, the destination QStash signed. */
  url: string;
  receiver: Pick<Receiver, "verify">;
  writer: Pick<LessonWriter, "write">;
}

const NOT_RETRYABLE = { "Upstash-NonRetryable-Error": "true" };

/** The user and day in a job's body, or null when it is not one. */
function jobOf(body: string): { userId: string; day: string } | null {
  try {
    const parsed = JSON.parse(body) as { userId?: unknown; day?: unknown } | null;
    const { userId, day } = parsed ?? {};
    if (typeof userId !== "string" || userId === "") return null;
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !isValid(parseISO(day))) {
      return null;
    }
    return { userId, day };
  } catch {
    return null;
  }
}

/**
 * A QStash delivery of the lesson job for one user and UTC day. The signature is the only
 * credential, so nothing runs before it checks out, and it must be for this route's URL.
 *
 * Whatever the writer settles on (a lesson, or a skip with its reason: the cap, nothing to teach,
 * an unusable reply) answers 2xx, so QStash doesn't retry against a closed door. A thrown error
 * answers 500 and QStash redelivers once.
 */
export async function handleLessonJob(
  request: Request,
  { url, receiver, writer }: LessonJobDeps,
): Promise<Response> {
  const signature = request.headers.get("Upstash-Signature");
  const body = await request.text();
  if (!signature) return new Response("Missing signature", { status: 401 });
  try {
    if (!(await receiver.verify({ signature, body, url }))) throw new Error("Bad signature");
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }

  const job = jobOf(body);
  if (!job) return new Response("Not a lesson job", { status: 400, headers: NOT_RETRYABLE });

  try {
    return Response.json({ outcome: await writer.write(job.userId, job.day) });
  } catch (error) {
    console.error(`The lesson for ${job.userId} on ${job.day} failed`, error);
    return new Response("The lesson failed", { status: 500 });
  }
}
