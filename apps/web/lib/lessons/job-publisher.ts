import { Client } from "@upstash/qstash";

import { LESSON_WRITER_STALE_MS } from "@clippings/db";

import type { LessonJobPublisher } from "./cron-request.ts";
import { LESSON_RETRIES } from "./job-request.ts";

export const LESSONS_PATH = "/api/jobs/lessons";

/**
 * How long QStash waits before redelivering a failed job: past the window after which a lesson
 * left `writing` may be claimed again, so a job that died mid-write (killed, or unable to mark the
 * lesson failed) is taken over by its retry instead of finding it busy and standing down.
 */
export const LESSON_RETRY_DELAY_MS = LESSON_WRITER_STALE_MS + 60_000;

/** Messages per QStash batch call (its limit is 100). */
const BATCH_SIZE = 100;

/**
 * Publishes the lesson jobs to QStash, which calls back the signed handler. Reads `QSTASH_TOKEN`
 * (and `QSTASH_URL`, to publish to a local `qstash-cli dev` server) and calls the app back at
 * `BETTER_AUTH_URL`, its public origin.
 */
export function createLessonJobPublisher(): LessonJobPublisher {
  return {
    async requestLessons(userIds, { day, spreadOverSeconds }) {
      if (userIds.length === 0) return;
      const token = process.env.QSTASH_TOKEN;
      const origin = process.env.BETTER_AUTH_URL;
      if (!token) throw new Error("QSTASH_TOKEN is not set");
      if (!origin) throw new Error("BETTER_AUTH_URL is not set");
      // Lets QStash through Vercel's deployment protection, which guards non-production deploys.
      const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      const client = new Client({ token });
      // The i-th job waits i/n of the window, so they arrive evenly instead of all at once.
      const messages = userIds.map((userId, index) => ({
        url: new URL(LESSONS_PATH, origin).href,
        body: { userId, day },
        retries: LESSON_RETRIES,
        retryDelay: String(LESSON_RETRY_DELAY_MS),
        delay: Math.floor((index * spreadOverSeconds) / userIds.length),
        ...(bypass ? { headers: { "x-vercel-protection-bypass": bypass } } : {}),
      }));
      for (let start = 0; start < messages.length; start += BATCH_SIZE) {
        await client.batchJSON(messages.slice(start, start + BATCH_SIZE));
      }
    },
  };
}
