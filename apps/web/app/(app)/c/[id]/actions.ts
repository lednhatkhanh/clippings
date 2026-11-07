"use server";

import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/auth/session.ts";
import { getLibrarian } from "@/lib/librarian/service.ts";
import { publishBriefJob } from "@/lib/research/job-publisher.ts";
import { getResearch } from "@/lib/research/service.ts";
import { LibrarianInputError } from "@clippings/db";
import type { Folder } from "@clippings/shared";

/** Where to file a clipping: a folder the user has, or the name of one to make. */
export type FolderTarget = { folderId: string } | { newFolder: string };

export type MoveOutcome =
  | { status: "moved"; folder: Folder }
  | { status: "refused"; message: string };

const NOT_YOURS: MoveOutcome = { status: "refused", message: "That folder or clipping is gone." };

/**
 * Files one of the user's clippings or notes in a folder, creating the folder first when given a
 * name that isn't one of theirs. It goes through the librarian as the user's own change, so it is
 * logged and can be undone from the review screen.
 */
export async function moveToFolderAction(
  clippingId: string,
  target: FolderTarget,
): Promise<MoveOutcome> {
  const userId = await requireUserId();
  // A server action takes whatever a client sends.
  if (typeof clippingId !== "string" || typeof target !== "object" || target === null) {
    return NOT_YOURS;
  }
  const librarian = getLibrarian();

  try {
    let folder: Folder | null;
    if ("folderId" in target && typeof target.folderId === "string") {
      folder =
        (await librarian.listFolders(userId)).find((one) => one.id === target.folderId) ?? null;
    } else if ("newFolder" in target && typeof target.newFolder === "string") {
      const name = target.newFolder.trim().replace(/\s+/g, " ");
      folder = await librarian.findFolderByName(userId, name);
      if (!folder) {
        const created = await librarian.proposeChange(userId, "user_via_mcp", {
          action: "create_folder",
          name,
          reason: "Created by you while filing a clipping",
        });
        if (created.outcome !== "applied") return NOT_YOURS;
        folder = (created.change.after as { folder: Folder }).folder;
      }
    } else {
      return NOT_YOURS;
    }
    if (!folder) return NOT_YOURS;

    // Filing it where it already is does nothing, and is not a failure.
    await librarian.proposeChange(userId, "user_via_mcp", {
      action: "move_to_folder",
      itemKind: "clipping",
      itemId: clippingId,
      folderId: folder.id,
      reason: "Moved by you",
    });
    revalidatePath("/", "layout");
    return { status: "moved", folder: { id: folder.id, name: folder.name, color: folder.color } };
  } catch (error) {
    if (error instanceof LibrarianInputError) return { status: "refused", message: error.message };
    throw error;
  }
}

/** What asking for a brief now came to. */
export type BriefRequestOutcome =
  | { status: "started" }
  /** The user has used today's research jobs. */
  | { status: "limit_reached" }
  /** Already with the model, being written, or ready. */
  | { status: "busy" }
  | { status: "not_found" }
  /** The job couldn't be queued; the brief is back in the queue for the next batch. */
  | { status: "failed" };

/**
 * Starts writing the clipping's research brief now, for a queued or dropped brief or a clipping
 * with none. It counts against the day's research jobs, and the job runs in the background.
 */
export async function requestBriefNowAction(clippingId: string): Promise<BriefRequestOutcome> {
  const userId = await requireUserId();
  if (typeof clippingId !== "string") return { status: "not_found" };
  const request = await getResearch().requestBriefNow(userId, clippingId);
  if (request.status !== "started") return { status: request.status };

  revalidatePath(`/c/${clippingId}`);
  try {
    await publishBriefJob({ briefId: request.brief.id, userId });
  } catch (error) {
    console.error(`Couldn't queue the brief ${request.brief.id}`, error);
    // Back in the queue, without the research job it used: nothing is writing it.
    await getResearch()
      .holdBriefFor(userId, request.brief.id, "Couldn't start it; it'll go in the next batch.")
      .catch((holdError: unknown) => {
        console.error(`Couldn't put the brief ${request.brief.id} back`, holdError);
      });
    revalidatePath(`/c/${clippingId}`);
    return { status: "failed" };
  }
  return { status: "started" };
}
