import { connection } from "next/server";

import { handleLibrarianCron } from "@/lib/librarian/cron-request.ts";
import { createLibrarianJobPublisher } from "@/lib/librarian/job-publisher.ts";
import { getLibrarian } from "@/lib/librarian/service.ts";

export const maxDuration = 60;

/** Vercel Cron calls this on Monday night UTC (see `vercel.json`). */
export async function GET(request: Request) {
  await connection();
  return handleLibrarianCron(request, {
    secret: process.env.CRON_SECRET,
    librarian: getLibrarian(),
    jobs: createLibrarianJobPublisher(),
  });
}
