import * as z from "zod";

import { MAX_QUERY_LENGTH } from "./search.ts";

/**
 * Longest question `POST /api/ask` takes, in characters: as much as search reads of a query, so
 * the search and the model see the same question.
 */
export const MAX_QUESTION_LENGTH = MAX_QUERY_LENGTH;

/** `POST /api/ask`: a question to answer from the signed-in user's own clippings. */
export const askRequestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
});
export type AskRequest = z.infer<typeof askRequestSchema>;

/** What the answer says when no clipping matches the question. The model is not asked. */
export const ASK_NO_MATCH = "Nothing in your clippings matches that.";

/**
 * One line of the answer stream (newline-delimited JSON): text as the model writes it, a clipping
 * it cites (the marker goes after the text streamed so far), then `done` or `error`.
 */
export const askEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("citation"),
    clippingId: z.string(),
    title: z.string(),
    citedText: z.string(),
  }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type AskEvent = z.infer<typeof askEventSchema>;
