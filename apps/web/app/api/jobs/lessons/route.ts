import { Receiver } from "@upstash/qstash";

import { LESSONS_PATH } from "@/lib/lessons/job-publisher.ts";
import { handleLessonJob } from "@/lib/lessons/job-request.ts";
import { getLessonWriter } from "@/lib/lessons/service.ts";

// One Sonnet call of up to 3 minutes; Hobby allows 300 s per step.
export const maxDuration = 300;

/** QStash delivers each user's lesson job here. The signature is checked before anything runs. */
export async function POST(request: Request) {
  const origin = process.env.BETTER_AUTH_URL;
  if (!origin) return new Response("BETTER_AUTH_URL is not set", { status: 500 });
  return handleLessonJob(request, {
    url: new URL(LESSONS_PATH, origin).href,
    receiver: new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    }),
    writer: getLessonWriter(),
  });
}
