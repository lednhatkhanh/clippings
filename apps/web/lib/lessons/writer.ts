import type { Gateway, CapReason } from "@/lib/gateway/gateway.ts";
import type { LessonMaterialItem, LessonsService } from "@clippings/db";

import { buildLessonRequest, MAX_LESSON_ITEMS, WRITE_LESSON } from "./lesson-request.ts";
import { parseLesson } from "./parse-lesson.ts";
import { pickLessonTopic } from "./topic.ts";

/** The model call is the bulk of the job; Hobby allows 300 s for the route, and this leaves room. */
const WRITE_TIMEOUT_MS = 180_000;

/**
 * What `write` came to:
 * - `written`: the lesson is ready;
 * - `exists`: the day's lesson is ready, skipped for good or being written by a live job, so this
 *   job stood down;
 * - `cap_reached`, `nothing_to_teach`: the lesson was skipped for that reason;
 * - `unusable`: the model's reply couldn't be used and the lesson was skipped as failed.
 */
export type WriteOutcome = "written" | "exists" | "cap_reached" | "nothing_to_teach" | "unusable";

export interface LessonWriterDeps {
  lessons: Pick<
    LessonsService,
    "claimLesson" | "readLessonMaterial" | "readTopicItems" | "completeLesson" | "skipLesson"
  >;
  gateway: Pick<Gateway, "message">;
}

const capReason = (reason: CapReason) =>
  reason === "daily_cap"
    ? "Today's spending cap was reached before the lesson was written."
    : "The AI provider's spending limit was reached before the lesson was written.";

/**
 * Writes the lesson of one user for one UTC day (`yyyy-MM-dd`), for the twice-weekly job: claims
 * it, picks a topic from the library (`pickLessonTopic`), has Sonnet 5.5 write it through the
 * model gateway, and settles it as ready or as skipped with a reason, so a lesson that didn't
 * arrive is never just missing.
 *
 * A thrown error (the database, the network, a timeout) skips the lesson as `failed` if it can and
 * is rethrown, so the job answers 500 and QStash redelivers it; a redelivery claims a `failed`
 * lesson again.
 */
export function createLessonWriter({ lessons, gateway }: LessonWriterDeps) {
  async function writeClaimed(
    userId: string,
    day: string,
    lessonId: string,
  ): Promise<WriteOutcome> {
    const skip = async (
      kind: "cap_reached" | "nothing_to_teach" | "failed",
      reason: string,
    ): Promise<void> => {
      await lessons.skipLesson(userId, lessonId, { kind, reason });
    };

    const material = await lessons.readLessonMaterial(userId, day);
    const topic = pickLessonTopic(material);
    if (!topic) {
      await skip("nothing_to_teach", "Nothing saved yet to build a lesson from.");
      return "nothing_to_teach";
    }

    let items: readonly LessonMaterialItem[] = material.recent;
    let topicPage: string | null = null;
    if (topic.kind === "tag") {
      items = await lessons.readTopicItems(userId, topic.tagId, MAX_LESSON_ITEMS);
      topicPage = material.tags.find((tag) => tag.id === topic.tagId)?.topicPage?.body ?? null;
    }
    if (items.length === 0) {
      await skip("nothing_to_teach", "Nothing saved yet to build a lesson from.");
      return "nothing_to_teach";
    }

    const { request, refs } = buildLessonRequest({
      day,
      profile: material.profile,
      topicName: topic.kind === "tag" ? topic.name : null,
      why: topic.kind === "tag" ? topic.why : "recent",
      topicPage,
      items,
      past: material.past,
    });
    const reply = await gateway.message({
      userId,
      jobKind: "lesson",
      request,
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    if (reply.status === "cap_reached") {
      await skip("cap_reached", capReason(reply.reason));
      return "cap_reached";
    }

    const block = reply.value.content.find(
      (part) => part.type === "tool_use" && part.name === WRITE_LESSON,
    );
    const parsed = parseLesson(block?.type === "tool_use" ? block.input : undefined, refs);
    if ("error" in parsed) {
      console.error(`The lesson for ${userId} on ${day} was unusable: ${parsed.error}`);
      await skip("failed", "The lesson came back unusable, so it wasn't kept.");
      return "unusable";
    }

    const { lesson } = parsed;
    const written = await lessons.completeLesson(userId, lessonId, {
      ...lesson,
      tagId: topic.kind === "tag" ? topic.tagId : null,
      // Nothing to recap in a first lesson, whatever the model wrote.
      recap: material.past.length > 0 ? lesson.recap : "",
    });
    // Another job took the lesson over (this one ran past `LESSON_WRITER_STALE_MS`).
    return written ? "written" : "exists";
  }

  async function write(userId: string, day: string): Promise<WriteOutcome> {
    const claim = await lessons.claimLesson(userId, day);
    if (claim.status === "exists") return "exists";
    try {
      return await writeClaimed(userId, day, claim.lessonId);
    } catch (error) {
      try {
        await lessons.skipLesson(userId, claim.lessonId, {
          kind: "failed",
          reason: "Something went wrong while writing it.",
        });
      } catch (skipError) {
        console.error(`Couldn't mark the lesson ${claim.lessonId} failed`, skipError);
      }
      throw error;
    }
  }

  return { write };
}

export type LessonWriter = ReturnType<typeof createLessonWriter>;
