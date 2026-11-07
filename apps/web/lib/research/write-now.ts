import type { Gateway } from "@/lib/gateway/gateway.ts";
import type { ResearchService } from "@clippings/db";

import { buildBriefRequest } from "./brief-request.ts";
import { parseBrief } from "./parse-brief.ts";

/** A search-and-write call is slow; Hobby allows 300 s for the job, and this leaves room around it. */
const WRITE_TIMEOUT_MS = 240_000;

const HELD_NOTE = "Held: today's spending cap was reached. It'll go in the next batch.";

export interface BriefWriterDeps {
  research: Pick<
    ResearchService,
    "getBriefForWriting" | "claimWriter" | "completeBrief" | "failBrief" | "holdBrief"
  >;
  gateway: Pick<Gateway, "message">;
}

/**
 * What `writeNow` came to:
 * - `ready`: the brief is written;
 * - `failed`: the call or its reply failed, and the brief is back in the queue or dropped;
 * - `held`: the gateway turned the call away, and the brief is back in the queue;
 * - `skipped`: nothing to write: not this user's brief, its clipping is deleted, it isn't
 *   `writing`, or another job already took it up (a job delivered twice).
 */
export type WriteNowOutcome = "ready" | "failed" | "held" | "skipped";

function whyItFailed(error: unknown): string {
  const timedOut = error instanceof Error && /timed? ?out/i.test(`${error.name} ${error.message}`);
  return timedOut ? "the request timed out" : "the request failed";
}

/**
 * Writes one brief right away, for the "write it now" button. The brief is already `writing`
 * (`requestBriefNow` made it so, and counted it against the day's research jobs); this calls the
 * model and settles it. A failure is the brief's own business: it is retried once and then
 * dropped, so the caller doesn't need QStash to retry the job.
 */
export function createBriefWriter({ research, gateway }: BriefWriterDeps) {
  async function writeNow({
    briefId,
    userId,
  }: {
    briefId: string;
    userId: string;
  }): Promise<WriteNowOutcome> {
    const brief = await research.getBriefForWriting(userId, briefId);
    if (!brief) return "skipped";
    // Only the first of two deliveries of the job gets to call the model.
    if (!(await research.claimWriter(userId, briefId))) return "skipped";

    let reply: Awaited<ReturnType<Gateway["message"]>>;
    try {
      reply = await gateway.message({
        userId,
        jobKind: "brief",
        request: buildBriefRequest(brief),
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    } catch (error) {
      console.error(`Writing brief ${briefId} failed`, error);
      await research.failBrief(briefId, whyItFailed(error));
      return "failed";
    }

    if (reply.status === "cap_reached") {
      await research.holdBrief(briefId, HELD_NOTE);
      return "held";
    }
    const parsed = parseBrief(reply.value);
    if ("error" in parsed) {
      await research.failBrief(briefId, parsed.error);
      return "failed";
    }
    await research.completeBrief(briefId, parsed);
    return "ready";
  }

  return { writeNow };
}

export type BriefWriter = ReturnType<typeof createBriefWriter>;
