import { connection } from "next/server";

import { handleDigestRequest } from "@/lib/digest/digest-request.ts";
import { getDigests } from "@/lib/digest/service.ts";
import { systemClock } from "@clippings/db";

export const maxDuration = 60;

/** Vercel Cron calls this daily (see `vercel.json`). */
export async function GET(request: Request) {
  await connection();
  return handleDigestRequest(request, {
    secret: process.env.CRON_SECRET,
    digests: getDigests(),
    clock: systemClock,
  });
}
