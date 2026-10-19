"use server";

import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/auth/session.ts";
import { getClippings } from "@/lib/clippings/service.ts";
import { InvalidTagColorError, InvalidTagsError, TagNameTakenError } from "@clippings/db";

export type RenameOutcome = { status: "renamed" } | { status: "invalid"; message: string };

/** A tag shows on every page that lists clippings, so a change to one refreshes them all. */
const revalidateTagged = () => revalidatePath("/", "layout");

/**
 * Renames one of the user's tags. Says why when the name can't be used; null when the tag isn't
 * theirs.
 */
export async function renameTagAction(tagId: string, name: string): Promise<RenameOutcome | null> {
  const userId = await requireUserId();
  // A server action takes whatever a client sends.
  if (typeof tagId !== "string" || typeof name !== "string") return null;

  try {
    const renamed = await getClippings().renameTag(userId, tagId, name);
    if (!renamed) return null;
    revalidateTagged();
    return { status: "renamed" };
  } catch (error) {
    if (error instanceof TagNameTakenError) {
      return { status: "invalid", message: "You already have a tag with this name." };
    }
    if (error instanceof InvalidTagsError) return { status: "invalid", message: error.message };
    throw error;
  }
}

/** Moves every clipping tagged `sourceId` to `targetId` and removes the source. */
export async function mergeTagAction(sourceId: string, targetId: string): Promise<boolean> {
  const userId = await requireUserId();
  if (typeof sourceId !== "string" || typeof targetId !== "string") return false;
  const merged = await getClippings().mergeTag(userId, sourceId, targetId);
  if (merged) revalidateTagged();
  return merged;
}

/** Deletes one of the user's tags; its clippings stay. */
export async function deleteTagAction(tagId: string): Promise<boolean> {
  const userId = await requireUserId();
  if (typeof tagId !== "string") return false;
  const deleted = await getClippings().deleteTag(userId, tagId);
  if (deleted) revalidateTagged();
  return deleted;
}

/** Sets one of the user's tags to a color from `TAG_COLORS`, by name. */
export async function setTagColorAction(tagId: string, color: string): Promise<boolean> {
  const userId = await requireUserId();
  if (typeof tagId !== "string" || typeof color !== "string") return false;

  try {
    const updated = await getClippings().setTagColor(userId, tagId, color);
    if (updated) revalidateTagged();
    return updated !== null;
  } catch (error) {
    if (error instanceof InvalidTagColorError) return false;
    throw error;
  }
}
