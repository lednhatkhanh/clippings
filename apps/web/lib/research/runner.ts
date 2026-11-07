import { constructNow } from "date-fns";

import { getGateway } from "@/lib/gateway/service.ts";

import { createBriefRunner, type BriefRunner } from "./run-briefs.ts";
import { getResearch } from "./service.ts";
import { createBriefWriter, type BriefWriter } from "./write-now.ts";

let runner: BriefRunner | undefined;
let writer: BriefWriter | undefined;

/** The daily run: collects ended batches and submits the queued briefs. */
export function getBriefRunner(): BriefRunner {
  return (runner ??= createBriefRunner({
    research: getResearch(),
    gateway: getGateway(),
    now: () => constructNow(undefined),
  }));
}

/** Writes one brief right away, for the "write it now" job. */
export function getBriefWriter(): BriefWriter {
  return (writer ??= createBriefWriter({ research: getResearch(), gateway: getGateway() }));
}
