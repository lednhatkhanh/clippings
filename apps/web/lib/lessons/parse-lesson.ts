import * as z from "zod";

import type { CompletedLesson } from "@clippings/db";
import {
  LESSON_QUIZ_CHOICES,
  MAX_LESSON_LENGTH,
  MAX_LESSON_RECAP_LENGTH,
  MAX_LESSON_TOPIC_LENGTH,
} from "@clippings/shared";

const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * The `write_lesson` tool's input. The tool is strict, so the shape is the model's to keep; what a
 * strict schema can't say (lengths, how many choices, the answer in range) is checked here.
 */
const lessonInputSchema = z.object({
  topic: text(MAX_LESSON_TOPIC_LENGTH),
  body: text(MAX_LESSON_LENGTH),
  // A first lesson has nothing to recap.
  recap: z.string().trim().max(MAX_LESSON_RECAP_LENGTH),
  quiz: z
    .object({
      question: text(1_000),
      choices: z.array(text(1_000)).min(LESSON_QUIZ_CHOICES.min).max(LESSON_QUIZ_CHOICES.max),
      answer_index: z.number().int().min(0),
      explanation: text(3_000),
    })
    .refine((quiz) => quiz.answer_index < quiz.choices.length, "answer_index is out of range"),
  source_refs: z.array(z.string()),
});

/** A written lesson but for the tag it was about, which the writer knows and the model doesn't. */
export type ParsedLesson = Omit<CompletedLesson, "tagId">;

export type LessonParse = { lesson: ParsedLesson } | { error: string };

/**
 * Reads a lesson out of the `write_lesson` input. `refs` maps the short references the model was
 * given (C1, C2…) to the ids of the clippings and notes they stand for; a reference not in it is
 * dropped, and a source named twice counts once. An error says why there is no lesson, for the
 * log.
 */
export function parseLesson(input: unknown, refs: ReadonlyMap<string, string>): LessonParse {
  const parsed = lessonInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `${issue?.path.join(".") || "input"}: ${issue?.message ?? "invalid"}` };
  }
  const { topic, body, recap, quiz, source_refs } = parsed.data;
  const sourceIds = new Set(source_refs.flatMap((ref) => refs.get(ref.trim().toUpperCase()) ?? []));
  return {
    lesson: {
      topic,
      body,
      recap,
      quiz: {
        question: quiz.question,
        choices: quiz.choices,
        answerIndex: quiz.answer_index,
        explanation: quiz.explanation,
      },
      sourceIds: [...sourceIds],
    },
  };
}
