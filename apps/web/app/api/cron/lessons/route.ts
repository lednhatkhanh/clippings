import { constructNow } from "date-fns";
import { connection } from "next/server";

import { handleLessonsCron } from "@/lib/lessons/cron-request.ts";
import { createLessonJobPublisher } from "@/lib/lessons/job-publisher.ts";
import { getLibrarian } from "@/lib/librarian/service.ts";

export const maxDuration = 60;

/** Vercel Cron calls this on Tuesday and Friday at 07:00 UTC (see `vercel.json`). */
export async function GET(request: Request) {
  await connection();
  return handleLessonsCron(request, {
    secret: process.env.CRON_SECRET,
    librarian: getLibrarian(),
    jobs: createLessonJobPublisher(),
    now: () => constructNow(undefined),
  });
}
