"use server";

import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/auth/session.ts";
import { getLibrarian } from "@/lib/librarian/service.ts";
import {
  ChangeConflictError,
  ChangeNotFoundError,
  ChangeNotSuggestedError,
  ChangeNotUndoableError,
  LibrarianInputError,
  SuggestionStaleError,
} from "@clippings/db";

/** How a decision on a change ended: done, or why it wasn't. */
export type DecisionOutcome = { status: "done" } | { status: "refused"; message: string };

const GONE: DecisionOutcome = { status: "refused", message: "That change is gone." };

/** A change shows on the review screen, the tags page, the list and the clippings it touched. */
function revalidateLibrary() {
  revalidatePath("/", "layout");
}

/** The reason to show when the librarian refuses a decision; anything else is a fault. */
function refusal(error: unknown): DecisionOutcome {
  if (error instanceof ChangeNotFoundError) return GONE;
  if (
    error instanceof ChangeNotSuggestedError ||
    error instanceof SuggestionStaleError ||
    error instanceof ChangeNotUndoableError ||
    error instanceof ChangeConflictError ||
    error instanceof LibrarianInputError
  ) {
    return { status: "refused", message: error.message };
  }
  throw error;
}

/** Applies one of the user's suggestions, as the library is now. Refused, with why, when it no longer fits. */
export async function approveSuggestionAction(changeId: string): Promise<DecisionOutcome> {
  const userId = await requireUserId();
  if (typeof changeId !== "string") return GONE;
  try {
    await getLibrarian().applySuggestion(userId, changeId);
  } catch (error) {
    return refusal(error);
  }
  revalidateLibrary();
  return { status: "done" };
}

/** Turns one of the user's suggestions down; the librarian won't propose it again. */
export async function dismissSuggestionAction(changeId: string): Promise<DecisionOutcome> {
  const userId = await requireUserId();
  if (typeof changeId !== "string") return GONE;
  try {
    await getLibrarian().dismissSuggestion(userId, changeId);
  } catch (error) {
    return refusal(error);
  }
  revalidateLibrary();
  return { status: "done" };
}

/**
 * Takes back one of the user's applied changes. Refused, with the reason to show, when a later
 * change touched the same things or it can't be undone.
 */
export async function undoChangeAction(changeId: string): Promise<DecisionOutcome> {
  const userId = await requireUserId();
  if (typeof changeId !== "string") return GONE;
  try {
    await getLibrarian().undoChange(userId, changeId);
  } catch (error) {
    return refusal(error);
  }
  revalidateLibrary();
  return { status: "done" };
}
