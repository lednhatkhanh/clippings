import { connection } from "next/server";

import { handleBriefsCron } from "@/lib/research/cron-request.ts";
import { getBriefRunner } from "@/lib/research/runner.ts";

// Collecting a batch reads its results file; Hobby allows 300 s.
export const maxDuration = 300;

/** Vercel Cron calls this daily at 05:00 UTC (see `vercel.json`). */
export async function GET(request: Request) {
  await connection();
  return handleBriefsCron(request, {
    secret: process.env.CRON_SECRET,
    runner: getBriefRunner(),
  });
}
