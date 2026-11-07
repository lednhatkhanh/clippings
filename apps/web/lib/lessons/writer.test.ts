import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import type { Gateway } from "@/lib/gateway/gateway.ts";
import type {
  ClaimLessonResult,
  CompletedLesson,
  LessonMaterial,
  LessonMaterialItem,
  LessonsService,
} from "@clippings/db";
import type { LessonSkipKind } from "@clippings/shared";

import { createLessonWriter } from "./writer.ts";

const item = (n: number): LessonMaterialItem => ({
  id: `item-${n}`,
  kind: "link",
  title: `Save ${n}`,
  summary: `About ${n}`,
  excerpt: null,
  tagIds: ["tag-css"],
  savedAt: "2026-11-05T00:00:00.000Z",
});

const material = (overrides: Partial<LessonMaterial> = {}): LessonMaterial => ({
  profile: "A backend developer",
  recent: [item(1), item(2)],
  tags: [
    {
      id: "tag-css",
      name: "css",
      itemCount: 3,
      recentCount: 2,
      newestItemAt: "2026-11-05T00:00:00.000Z",
      topicPage: { body: "CSS overview text", updatedAt: "2026-11-01T00:00:00.000Z" },
    },
  ],
  past: [],
  ...overrides,
});

const lessonInput = {
  topic: "Cascade layers",
  body: "## Layers\n\nText.",
  recap: "Last time: grid.",
  quiz: {
    question: "Which wins?",
    choices: ["a", "b", "c"],
    answer_index: 1,
    explanation: "Because.",
  },
  source_refs: ["C2", "C9"],
};

type Reply = { input: unknown } | "cap" | "provider" | Error;

function setup({
  claim = { status: "claimed", lessonId: "lesson-1" } as ClaimLessonResult,
  mat = material(),
  reply = { input: lessonInput } as Reply,
  complete = true,
  skipFails = false,
} = {}) {
  const skips: { kind: LessonSkipKind; reason: string }[] = [];
  const completed: CompletedLesson[] = [];
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const topicReads: { tagId: string; limit: number }[] = [];
  const lessons: Pick<
    LessonsService,
    "claimLesson" | "readLessonMaterial" | "readTopicItems" | "completeLesson" | "skipLesson"
  > = {
    claimLesson: async () => claim,
    readLessonMaterial: async () => mat,
    readTopicItems: async (_userId, tagId, limit) => {
      topicReads.push({ tagId, limit });
      return [item(7), item(8)];
    },
    completeLesson: async (_userId, _id, lesson) => {
      completed.push(lesson);
      return complete;
    },
    skipLesson: async (_userId, _id, skip) => {
      if (skipFails) throw new Error("the database is down");
      skips.push(skip);
      return true;
    },
  };
  const gateway: Pick<Gateway, "message"> = {
    async message({ request, jobKind }) {
      requests.push(request);
      expect(jobKind).toBe("lesson");
      if (reply instanceof Error) throw reply;
      if (reply === "cap") return { status: "cap_reached", reason: "daily_cap" };
      if (reply === "provider") return { status: "cap_reached", reason: "provider_limit" };
      return {
        status: "ok",
        costMicros: 1,
        value: {
          content: [{ type: "tool_use", id: "t", name: "write_lesson", input: reply.input }],
        } as unknown as Anthropic.Message,
      };
    },
  };
  return {
    writer: createLessonWriter({ lessons, gateway }),
    skips,
    completed,
    requests,
    topicReads,
  };
}

/** The request's text, which the writer builds as strings. */
function asText(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected the request to hold plain text");
  return value;
}

const promptOf = (request: Anthropic.MessageCreateParamsNonStreaming) =>
  asText(request.messages[0]!.content);

describe("the lesson writer", () => {
  it("writes a lesson on a tag from its items, with the topic page, and maps the sources", async () => {
    const { writer, completed, requests, topicReads, skips } = setup();

    expect(await writer.write("ada", "2026-11-10")).toBe("written");

    expect(topicReads).toEqual([{ tagId: "tag-css", limit: 20 }]);
    const prompt = promptOf(requests[0]!);
    expect(prompt).toContain("<topic>\ncss\n</topic>");
    expect(prompt).toContain("CSS overview text");
    expect(prompt).toContain("C1 (link, saved 2026-11-05) Save 7");
    expect(requests[0]).toMatchObject({
      model: "claude-sonnet-5-5",
      tool_choice: { type: "tool", name: "write_lesson" },
    });
    expect(asText(requests[0]!.system)).toContain("A backend developer");
    // C2 is the second item the tag read gave; C9 is a reference the model made up.
    expect(completed).toEqual([
      {
        topic: "Cascade layers",
        tagId: "tag-css",
        body: "## Layers\n\nText.",
        quiz: {
          question: "Which wins?",
          choices: ["a", "b", "c"],
          answerIndex: 1,
          explanation: "Because.",
        },
        // No past lesson: there is nothing to recap, whatever the model wrote.
        recap: "",
        sourceIds: ["item-8"],
      },
    ]);
    expect(skips).toEqual([]);
  });

  it("recaps the previous lesson and keeps the model's recap", async () => {
    const past = {
      id: "l0",
      day: "2026-11-06",
      topic: "CSS grid",
      tagId: null,
      body: "Grid body",
      quiz: { question: "Grid Q?", choices: ["x", "y", "z"], answerIndex: 2, explanation: "E" },
    };
    const { writer, completed, requests } = setup({ mat: material({ past: [past] }) });

    await writer.write("ada", "2026-11-10");

    const prompt = promptOf(requests[0]!);
    expect(prompt).toContain("<previous_lesson>");
    expect(prompt).toContain("Grid Q?");
    expect(prompt).toContain("Right answer: z");
    expect(completed[0]!.recap).toBe("Last time: grid.");
  });

  it("writes a lesson on the recent saves, with no tag, when no tag stands out", async () => {
    const { writer, completed, requests, topicReads } = setup({
      mat: material({
        tags: [
          {
            id: "tag-css",
            name: "css",
            itemCount: 1,
            recentCount: 0,
            newestItemAt: "2026-10-01T00:00:00.000Z",
            topicPage: null,
          },
        ],
      }),
    });

    expect(await writer.write("ada", "2026-11-10")).toBe("written");

    expect(topicReads).toEqual([]);
    expect(promptOf(requests[0]!)).toContain("C1 (link, saved 2026-11-05) Save 1");
    expect(completed[0]).toMatchObject({ tagId: null, sourceIds: ["item-2"] });
  });

  it("stands down when the day's lesson is there, calling nothing", async () => {
    const { writer, requests, skips, completed } = setup({
      claim: { status: "exists", lessonId: "l", lessonStatus: "ready" },
    });

    expect(await writer.write("ada", "2026-11-10")).toBe("exists");

    expect([requests, skips, completed]).toEqual([[], [], []]);
  });

  it("skips a library with nothing to teach from, without calling the model", async () => {
    const { writer, requests, skips } = setup({ mat: material({ recent: [], tags: [] }) });

    expect(await writer.write("ada", "2026-11-10")).toBe("nothing_to_teach");

    expect(requests).toEqual([]);
    expect(skips).toEqual([
      { kind: "nothing_to_teach", reason: "Nothing saved yet to build a lesson from." },
    ]);
  });

  it.each([
    ["cap", "Today's spending cap was reached before the lesson was written."],
    ["provider", "The AI provider's spending limit was reached before the lesson was written."],
  ] as const)(
    "skips the lesson, saying why, when the gateway stops it (%s)",
    async (reply, reason) => {
      const { writer, skips, completed } = setup({ reply });

      expect(await writer.write("ada", "2026-11-10")).toBe("cap_reached");

      expect(skips).toEqual([{ kind: "cap_reached", reason }]);
      expect(completed).toEqual([]);
    },
  );

  it.each([
    [
      "an answer past the choices",
      { ...lessonInput, quiz: { ...lessonInput.quiz, answer_index: 7 } },
    ],
    ["no input", undefined],
  ])("skips the lesson as failed for %s", async (_name, input) => {
    const { writer, skips, completed } = setup({ reply: { input } });

    expect(await writer.write("ada", "2026-11-10")).toBe("unusable");

    expect(skips).toEqual([{ kind: "failed", reason: expect.any(String) }]);
    expect(completed).toEqual([]);
  });

  it("skips the lesson as failed and rethrows when the call fails", async () => {
    const { writer, skips } = setup({ reply: new Error("timed out") });

    await expect(writer.write("ada", "2026-11-10")).rejects.toThrow("timed out");

    expect(skips).toEqual([{ kind: "failed", reason: "Something went wrong while writing it." }]);
  });

  it("rethrows the original error even when the lesson can't be marked failed", async () => {
    const { writer } = setup({ reply: new Error("timed out"), skipFails: true });

    await expect(writer.write("ada", "2026-11-10")).rejects.toThrow("timed out");
  });

  it("reports a lesson another job took over as existing", async () => {
    const { writer } = setup({ complete: false });

    expect(await writer.write("ada", "2026-11-10")).toBe("exists");
  });
});
