"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth/auth.ts";
import { getConnections } from "@/lib/auth/connections.ts";
import { getSession, requireUserId } from "@/lib/auth/session.ts";
import { getClippings } from "@/lib/clippings/service.ts";
import {
  parseBookmarksUpload,
  type ImportActionResult,
  type ImportDone,
  type ImportPreview,
} from "@/lib/settings/import.ts";
import { getSettings } from "@/lib/settings/service.ts";
import { pickAppearance, type Appearance } from "@clippings/shared";

/** Saves the appearance settings the user changed. Values the app doesn't know are dropped. */
export async function saveAppearanceAction(changes: Partial<Appearance>): Promise<void> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  await getSettings().updateSettings(session.user.id, pickAppearance(changes));
}

/**
 * Ends the session on the server, clears its cookie and goes to sign-in. Signing out is for
 * whoever holds the cookie, and with none it does nothing, so there is no user data to guard.
 */
// ast-grep-ignore: server-action-checks-session
export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}

/**
 * Revokes one of the user's connected clients: its tokens stop working at once, and it has to be
 * connected again. False when the client isn't connected to this user.
 */
export async function revokeConnectionAction(clientId: string): Promise<boolean> {
  const userId = await requireUserId();
  if (typeof clientId !== "string") return false;
  const revoked = await getConnections().revokeConnection(userId, clientId);
  if (revoked) revalidatePath("/settings");
  return revoked;
}

/**
 * Turns tag suggestions on or off for the user and returns what was saved. Off by default: while
 * on, the user's tag names go to the model with each page that is read.
 */
export async function setSuggestTagsAction(on: boolean): Promise<boolean> {
  const userId = await requireUserId();
  if (typeof on !== "boolean") throw new Error("Invalid setting");
  return getSettings().setSuggestTags(userId, on);
}

/** The bookmarks file from the import form, or null when the form carries none. */
function uploadedFile(formData: FormData): File | null {
  const file = formData.get("file");
  return file instanceof File ? file : null;
}

const NO_FILE = "Choose a bookmarks file first.";

/**
 * Reads the uploaded bookmarks file and counts what an import would do, writing nothing. The
 * file is parsed here, on the server, so the client never decides what is a bookmark.
 */
export async function previewBookmarksImportAction(
  formData: FormData,
): Promise<ImportActionResult<ImportPreview>> {
  const userId = await requireUserId();
  const file = uploadedFile(formData);
  if (!file) return { ok: false, message: NO_FILE };
  const upload = await parseBookmarksUpload(file);
  if (!upload.ok) return upload;

  const counts = await getClippings().previewImport(userId, upload.bookmarks);
  return {
    ok: true,
    value: {
      willImport: counts.created,
      alreadySaved: counts.existing,
      skipped: counts.skipped + upload.notWeb,
    },
  };
}

/**
 * Imports the uploaded bookmarks as pending clippings, folders as tags when asked. They are read
 * gradually in the background, so the result also says how many still wait.
 */
export async function importBookmarksAction(
  formData: FormData,
): Promise<ImportActionResult<ImportDone>> {
  const userId = await requireUserId();
  const file = uploadedFile(formData);
  if (!file) return { ok: false, message: NO_FILE };
  const upload = await parseBookmarksUpload(file);
  if (!upload.ok) return upload;

  const clippings = getClippings();
  const counts = await clippings.importClippings(userId, upload.bookmarks, {
    foldersAsTags: formData.get("foldersAsTags") === "true",
  });
  const pending = await clippings.countPendingImports(userId);
  revalidatePath("/");
  revalidatePath("/settings");
  return {
    ok: true,
    value: { ...counts, skipped: counts.skipped + upload.notWeb, pending },
  };
}
