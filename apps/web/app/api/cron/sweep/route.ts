import { connection } from "next/server";

import { getClippings } from "../../../../lib/clippings/service";
import { handleSweepRequest } from "../../../../lib/enrichment/sweep-request";

export const maxDuration = 60;

/** Vercel Cron calls this daily (see `vercel.json`). */
export async function GET(request: Request) {
  await connection();
  return handleSweepRequest(request, {
    secret: process.env.CRON_SECRET,
    service: getClippings(),
  });
}
