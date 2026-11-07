import { subDays, subHours } from "date-fns";

import type { CapReason, Gateway } from "@/lib/gateway/gateway.ts";
import { BRIEF_COST_ESTIMATE_MICROS } from "@/lib/gateway/rates.ts";
import type { ResearchService } from "@clippings/db";

import { buildBriefRequest } from "./brief-request.ts";
import { parseBrief } from "./parse-brief.ts";

/** A brief `writing` for longer than this lost its job: the daily run fails it. */
const STUCK_AFTER_HOURS = 1;

const COULDNT_START_NOTE = "Couldn't start it; it'll go in the next batch.";

const HELD_NOTES: Record<CapReason, string> = {
  daily_cap: "Held: today's spending cap was reached. It'll go in the next batch.",
  provider_limit: "Held: the AI provider's spending limit was reached. It'll go in the next batch.",
};

/** A claimed brief with no batch after this long was lost between the claim and the create. */
const UNSTARTED_AFTER_HOURS = 1;

/** A batch ends within a day, so a brief still waiting on one after this long is lost. */
const UNFINISHED_AFTER_DAYS = 3;

export interface BriefRunDeps {
  research: Pick<
    ResearchService,
    | "failStuckWriting"
    | "failUnstartedBatch"
    | "failUnfinishedBatch"
    | "submittedBatchIds"
    | "briefsInBatch"
    | "completeBrief"
    | "failBrief"
    | "claimForBatch"
    | "attachBatch"
    | "holdBrief"
  >;
  gateway: Pick<Gateway, "submitBatch" | "collectBatch">;
  now: () => Date;
}

/** What one daily run did. */
export interface BriefRunCounts {
  /** Briefs whose writer died partway and were failed. */
  stuck: number;
  /** Briefs claimed for a batch that was never created, and failed. */
  unstarted: number;
  /** Briefs whose batch never came back, and failed. */
  unfinished: number;
  /** Submitted batches the provider hasn't finished. */
  pending: number;
  /** Batches that couldn't be collected; their briefs stay submitted for the next run. */
  failedBatches: number;
  /** Briefs written. */
  ready: number;
  /** Briefs that failed and went back in the queue for one more try. */
  retried: number;
  /** Briefs that failed a second time and were dropped. */
  dropped: number;
  /** Briefs sent to the provider in a new batch. */
  submitted: number;
  /** Queued briefs the gateway turned away (the spending cap); they wait for the next run. */
  held: number;
}

/**
 * The daily research run:
 *
 * 1. a brief stuck `writing` for an hour, or claimed for a batch an hour ago that was never
 *    created, is failed;
 * 2. each submitted batch is asked about, and the ones that ended give their briefs a body and
 *    sources, or fail them (a failure is retried once, then dropped); a brief whose batch has
 *    been out for three days is failed;
 * 3. queued briefs, up to each user's research jobs for the day, are claimed (they become
 *    `submitted` before the provider hears of them, so nothing else can take them), sent in one
 *    batch, and given its id.
 *
 * Collecting comes before submitting, so a batch that ended overnight frees its jobs' place in
 * the queue. A brief the gateway holds, and every brief when the batch can't be created, goes
 * back to the queue without using an attempt or a research job.
 */
export function createBriefRunner({ research, gateway, now }: BriefRunDeps) {
  async function collect(batchId: string, counts: BriefRunCounts): Promise<void> {
    const owners = new Map(
      (await research.briefsInBatch(batchId)).map(({ id, userId }) => [
        id,
        { userId, jobKind: "brief" as const },
      ]),
    );
    const collection = await gateway.collectBatch(batchId, owners);
    if (collection.status === "in_progress") {
      counts.pending += 1;
      return;
    }

    const settle = async (briefId: string, why: string) => {
      const status = await research.failBrief(briefId, why);
      if (status === "queued") counts.retried += 1;
      if (status === "dropped") counts.dropped += 1;
    };

    const answered = new Set<string>();
    for (const result of collection.results) {
      answered.add(result.customId);
      switch (result.outcome) {
        case "succeeded": {
          const brief = parseBrief(result.message);
          if ("error" in brief) {
            await settle(result.customId, brief.error);
          } else if (await research.completeBrief(result.customId, brief)) {
            counts.ready += 1;
          }
          break;
        }
        case "expired":
          await settle(result.customId, "the batch expired");
          break;
        case "canceled":
          await settle(result.customId, "the batch was canceled");
          break;
        case "errored":
          console.error(`Brief ${result.customId} errored in batch ${batchId}: ${result.detail}`);
          await settle(result.customId, "the request errored");
          break;
      }
    }
    // The batch ended without a word on these, and would be asked about again for ever.
    for (const briefId of owners.keys()) {
      if (!answered.has(briefId)) await settle(briefId, "the batch returned no result");
    }
  }

  async function run(): Promise<BriefRunCounts> {
    const counts: BriefRunCounts = {
      stuck: 0,
      unstarted: 0,
      unfinished: 0,
      pending: 0,
      failedBatches: 0,
      ready: 0,
      retried: 0,
      dropped: 0,
      submitted: 0,
      held: 0,
    };
    const at = now();

    counts.stuck = await research.failStuckWriting(subHours(at, STUCK_AFTER_HOURS));
    counts.unstarted = await research.failUnstartedBatch(subHours(at, UNSTARTED_AFTER_HOURS));

    for (const batchId of await research.submittedBatchIds()) {
      try {
        await collect(batchId, counts);
      } catch (error) {
        counts.failedBatches += 1;
        console.error(`Couldn't collect batch ${batchId}`, error);
      }
    }

    counts.unfinished = await research.failUnfinishedBatch(subDays(at, UNFINISHED_AFTER_DAYS));

    // From here the briefs are `submitted` with no batch: whatever happens, they are attached to
    // one, or put back.
    const claimed = (await research.claimForBatch(at)).flatMap(({ briefs }) => briefs);
    if (claimed.length === 0) return counts;
    const putBack = async (briefIds: readonly string[], note: string) => {
      for (const id of briefIds) await research.holdBrief(id, note);
    };

    let submission: Awaited<ReturnType<Gateway["submitBatch"]>>;
    try {
      submission = await gateway.submitBatch(
        claimed.map((brief) => ({
          customId: brief.id,
          userId: brief.userId,
          jobKind: "brief" as const,
          request: buildBriefRequest(brief),
          estimateMicros: BRIEF_COST_ESTIMATE_MICROS,
        })),
      );
    } catch (error) {
      await putBack(
        claimed.map(({ id }) => id),
        COULDNT_START_NOTE,
      );
      throw error;
    }

    counts.held = submission.held.length;
    for (const { customId, reason } of submission.held) {
      await research.holdBrief(customId, HELD_NOTES[reason]);
    }
    if (submission.batchId) {
      counts.submitted = await research.attachBatch(submission.accepted, submission.batchId);
    } else {
      // No batch was made, so none of the claimed briefs is in one.
      await putBack(submission.accepted, COULDNT_START_NOTE);
    }
    return counts;
  }

  return { run };
}

export type BriefRunner = ReturnType<typeof createBriefRunner>;
