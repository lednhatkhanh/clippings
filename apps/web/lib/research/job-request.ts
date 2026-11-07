import type { Receiver } from "@upstash/qstash";
import * as z from "zod";

import type { BriefWriter } from "./write-now.ts";

/** This route's path: what QStash calls, and what its signature is for. */
export const BRIEF_JOB_PATH = "/api/jobs/brief";

/**
 * QStash redeliveries after the first try: none. A failed brief is retried once by its own rule
 * (it goes back to the queue), and a redelivery would call the model again for the same brief.
 */
export const BRIEF_JOB_RETRIES = 0;

export interface BriefJobDeps {
  /** This route's absolute URL, the destination QStash signed. */
  url: string;
  receiver: Pick<Receiver, "verify">;
  writer: Pick<BriefWriter, "writeNow">;
}

const jobSchema = z.object({ briefId: z.uuid(), userId: z.string().min(1) });

const NOT_RETRYABLE = { "Upstash-NonRetryable-Error": "true" };

/**
 * A QStash delivery of a "write it now" job for one brief. The signature is the only credential,
 * so nothing runs before it checks out, and it must be for this route's URL.
 *
 * Answers 2xx whatever the brief came to (written, failed, held at the cap, nothing to write):
 * the outcome lives on the brief, and QStash retrying would only spend the model again.
 */
export async function handleBriefJob(
  request: Request,
  { url, receiver, writer }: BriefJobDeps,
): Promise<Response> {
  const signature = request.headers.get("Upstash-Signature");
  const body = await request.text();
  if (!signature) return new Response("Missing signature", { status: 401 });
  try {
    if (!(await receiver.verify({ signature, body, url }))) throw new Error("Bad signature");
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }

  let job: z.infer<typeof jobSchema>;
  try {
    job = jobSchema.parse(JSON.parse(body));
  } catch {
    return new Response("Not a brief job", { status: 400, headers: NOT_RETRYABLE });
  }

  try {
    return Response.json({ outcome: await writer.writeNow(job) });
  } catch (error) {
    // The brief is left `writing`; the daily run fails it after an hour and it gets its retry.
    console.error(`Writing brief ${job.briefId} failed`, error);
    return Response.json({ outcome: "failed" });
  }
}
