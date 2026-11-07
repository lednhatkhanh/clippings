import { describe, expect, it } from "vitest";

import {
  MAX_LESSON_LENGTH,
  MAX_LESSON_RECAP_LENGTH,
  MAX_LESSON_TOPIC_LENGTH,
} from "@clippings/shared";

import { parseLesson } from "./parse-lesson.ts";

const refs = new Map([
  ["C1", "id-1"],
  ["C2", "id-2"],
]);

const input = (overrides: Record<string, unknown> = {}) => ({
  topic: "  How a B-tree stays balanced ",
  body: "## Why\n\nA lesson.\n",
  recap: "Last time: indexes.",
  quiz: {
    question: "What keeps it balanced?",
    choices: ["Splits", "Rotations", "Luck"],
    answer_index: 0,
    explanation: "Nodes split when full.",
  },
  source_refs: ["C2", "C1"],
  ...overrides,
});

const withQuiz = (quiz: Record<string, unknown>) => input({ quiz: { ...input().quiz, ...quiz } });

describe("parseLesson", () => {
  it("reads a lesson, trimming text and mapping source references to ids in the given order", () => {
    expect(parseLesson(input(), refs)).toEqual({
      lesson: {
        topic: "How a B-tree stays balanced",
        body: "## Why\n\nA lesson.",
        recap: "Last time: indexes.",
        quiz: {
          question: "What keeps it balanced?",
          choices: ["Splits", "Rotations", "Luck"],
          answerIndex: 0,
          explanation: "Nodes split when full.",
        },
        sourceIds: ["id-2", "id-1"],
      },
    });
  });

  it("drops references it wasn't given, and a source named twice counts once", () => {
    const parsed = parseLesson(input({ source_refs: ["C1", "C9", "c1", "nonsense"] }), refs);

    expect(parsed).toMatchObject({ lesson: { sourceIds: ["id-1"] } });
  });

  it("allows an empty recap and no sources", () => {
    expect(parseLesson(input({ recap: "", source_refs: [] }), refs)).toMatchObject({
      lesson: { recap: "", sourceIds: [] },
    });
  });

  const unusable: [string, unknown][] = [
    ["no input at all", undefined],
    ["a string", "a lesson"],
    ["a missing body", input({ body: undefined })],
    ["a blank body", input({ body: "   " })],
    ["a blank topic", input({ topic: " " })],
    ["a topic past the limit", input({ topic: "x".repeat(MAX_LESSON_TOPIC_LENGTH + 1) })],
    ["a body past the limit", input({ body: "x".repeat(MAX_LESSON_LENGTH + 1) })],
    ["a recap past the limit", input({ recap: "x".repeat(MAX_LESSON_RECAP_LENGTH + 1) })],
    ["two choices", withQuiz({ choices: ["a", "b"] })],
    ["six choices", withQuiz({ choices: ["a", "b", "c", "d", "e", "f"] })],
    ["a blank choice", withQuiz({ choices: ["a", " ", "c"] })],
    ["an answer past the last choice", withQuiz({ answer_index: 3 })],
    ["a negative answer", withQuiz({ answer_index: -1 })],
    ["a fractional answer", withQuiz({ answer_index: 1.5 })],
    ["no explanation", withQuiz({ explanation: "" })],
  ];

  it.each(unusable)("returns an error, not a throw, for %s", (_name, value) => {
    expect(parseLesson(value, refs)).toEqual({ error: expect.any(String) });
  });

  it("accepts the limits themselves", () => {
    const parsed = parseLesson(
      input({
        topic: "t".repeat(MAX_LESSON_TOPIC_LENGTH),
        body: "b".repeat(MAX_LESSON_LENGTH),
        recap: "r".repeat(MAX_LESSON_RECAP_LENGTH),
        quiz: { ...input().quiz, choices: ["a", "b", "c", "d", "e"], answer_index: 4 },
      }),
      refs,
    );

    expect(parsed).toMatchObject({ lesson: { quiz: { answerIndex: 4 } } });
  });
});
