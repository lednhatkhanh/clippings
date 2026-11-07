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
import {
  autoTagChangeSchema,
  automationSettingsChangeSchema,
  parseResearchDomains,
  pickAppearance,
  researchSettingsChangeSchema,
  type Appearance,
  type AutomationSettings,
  type ResearchSettings,
} from "@clippings/shared";

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

/**
 * Turns auto-tagging on or off for the user and returns what was saved. On, the tags the model is
 * confident in are applied to new clippings (and logged, so each can be undone); off, they wait
 * as suggestions. The change is checked with the shared schema.
 */
export async function setAutoTagAction(change: unknown): Promise<boolean> {
  const userId = await requireUserId();
  const parsed = autoTagChangeSchema.safeParse(change);
  if (!parsed.success) throw new Error("Invalid setting");
  const on = await getSettings().setAutoTag(userId, parsed.data.autoTag);
  revalidatePath("/settings");
  return on;
}

/** The outcome of saving the automation limits: what is now stored, or why nothing was. */
export type AutomationActionResult =
  | { ok: true; value: AutomationSettings }
  | { ok: false; message: string };

/**
 * Saves the user's daily cap (micro-dollars) and/or research-job limit. The change is checked
 * with the shared schema, so a client can't store a negative, fractional or absurd limit.
 */
export async function saveAutomationSettingsAction(
  change: unknown,
): Promise<AutomationActionResult> {
  const userId = await requireUserId();
  const parsed = automationSettingsChangeSchema.safeParse(change);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid setting" };
  }
  const value = await getSettings().updateAutomationSettings(userId, parsed.data);
  revalidatePath("/settings");
  return { ok: true, value };
}

/** The outcome of saving the research settings: what is now stored, or why nothing was. */
export type ResearchActionResult =
  | { ok: true; value: ResearchSettings }
  | { ok: false; message: string };

/**
 * Saves the user's "About me" text and research domains. The form sends the domains as the text
 * of its field, which is split on commas and new lines here, and the result is checked with the
 * shared schema, so a client can't store more domains or longer text than the limits allow. An
 * empty list turns research off.
 */
export async function saveResearchSettingsAction(change: {
  profile: string;
  domains: string;
}): Promise<ResearchActionResult> {
  const userId = await requireUserId();
  if (typeof change?.profile !== "string" || typeof change.domains !== "string") {
    return { ok: false, message: "Invalid setting" };
  }
  const parsed = researchSettingsChangeSchema.safeParse({
    profile: change.profile,
    domains: parseResearchDomains(change.domains),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid setting" };
  }
  const value = await getSettings().updateResearchSettings(userId, parsed.data);
  revalidatePath("/settings");
  return { ok: true, value };
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
