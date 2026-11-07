"use server";

import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/auth/session.ts";
import { getClippings } from "@/lib/clippings/service.ts";
import { getLibrarian } from "@/lib/librarian/service.ts";
import {
  InvalidTagsError,
  LibrarianInputError,
  LibrarianNotFoundError,
  TagNameTakenError,
} from "@clippings/db";
import { isTagColor } from "@clippings/shared";

export type RenameOutcome = { status: "renamed" } | { status: "invalid"; message: string };

/** A tag shows on every page that lists clippings, so a change to one refreshes them all. */
const revalidateTagged = () => revalidatePath("/", "layout");

/**
 * Renames one of the user's tags, as the user's own change: logged, and undone from the review
 * screen. Says why when the name can't be used; null when the tag isn't theirs.
 */
export async function renameTagAction(tagId: string, name: string): Promise<RenameOutcome | null> {
  const userId = await requireUserId();
  // A server action takes whatever a client sends.
  if (typeof tagId !== "string" || typeof name !== "string") return null;

  try {
    await getLibrarian().proposeChange(userId, "user_via_mcp", {
      action: "rename_tag",
      tagId,
      name,
      reason: "Renamed by you on the Tags page",
    });
    revalidateTagged();
    return { status: "renamed" };
  } catch (error) {
    if (error instanceof LibrarianNotFoundError) return null;
    if (error instanceof TagNameTakenError) {
      return { status: "invalid", message: "You already have a tag with this name." };
    }
    if (error instanceof InvalidTagsError) return { status: "invalid", message: error.message };
    throw error;
  }
}

/**
 * Moves every clipping tagged `sourceId` to `targetId` and removes the source, as the user's own
 * change: logged, and it can be undone from the review screen.
 */
export async function mergeTagAction(sourceId: string, targetId: string): Promise<boolean> {
  const userId = await requireUserId();
  if (typeof sourceId !== "string" || typeof targetId !== "string") return false;
  try {
    const merged = await getLibrarian().proposeChange(userId, "user_via_mcp", {
      action: "merge_tag",
      sourceId,
      targetId,
      reason: "Merged by you on the Tags page",
    });
    if (merged.outcome === "skipped") return false;
  } catch (error) {
    if (error instanceof LibrarianInputError) return false;
    throw error;
  }
  revalidateTagged();
  return true;
}

/** Deletes one of the user's tags; its clippings stay. */
export async function deleteTagAction(tagId: string): Promise<boolean> {
  const userId = await requireUserId();
  if (typeof tagId !== "string") return false;
  const deleted = await getClippings().deleteTag(userId, tagId);
  if (deleted) revalidateTagged();
  return deleted;
}

/**
 * Sets one of the user's tags to a color from `TAG_COLORS`, by name. The color is then the
 * user's own choice: the librarian leaves it alone. Logged, so it can be undone.
 */
export async function setTagColorAction(tagId: string, color: string): Promise<boolean> {
  const userId = await requireUserId();
  if (typeof tagId !== "string" || typeof color !== "string" || !isTagColor(color)) return false;

  try {
    // For the user's own change a skip only means the tag is already that color, and already
    // the user's choice: nothing to change, and nothing wrong.
    await getLibrarian().proposeChange(userId, "user_via_mcp", {
      action: "set_tag_color",
      tagId,
      color,
      reason: "Chosen by you on the Tags page",
    });
  } catch (error) {
    if (error instanceof LibrarianInputError) return false;
    throw error;
  }
  revalidateTagged();
  return true;
}
