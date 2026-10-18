"use server";

import { constructNow } from "date-fns";
import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/auth/session.ts";
import { loadRows, toRow, type ClippingRowData, type RowsPage } from "@/lib/clippings/rows.ts";
import { getClippings } from "@/lib/clippings/service.ts";
import { formatAbsoluteDate } from "@/lib/format-date.ts";
import { InvalidUrlError, NoteTooLongError } from "@clippings/db";

export type SaveOutcome =
  | { status: "created"; clippingId: string }
  | { status: "existing"; clippingId: string; url: string; note: string; savedOn: string }
  | { status: "invalid"; field: "url" | "note"; message: string };

async function requireUserId(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  return session.user.id;
}

const readString = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function saveClippingAction(formData: FormData): Promise<SaveOutcome> {
  const userId = await requireUserId();
  const url = readString(formData, "url").trim();
  const note = readString(formData, "note").trim();

  if (!url) {
    return { status: "invalid", field: "url", message: "Paste the address of the page to save." };
  }

  try {
    const { status, clipping } = await getClippings().saveClipping(userId, {
      url,
      note,
      source: "web",
    });
    if (status === "created") {
      revalidatePath("/");
      return { status: "created", clippingId: clipping.id };
    }
    return {
      status: "existing",
      clippingId: clipping.id,
      url: clipping.url,
      note: clipping.note,
      savedOn: formatAbsoluteDate(clipping.createdAt, constructNow(undefined)),
    };
  } catch (error) {
    if (error instanceof NoteTooLongError) {
      return { status: "invalid", field: "note", message: "That note is too long." };
    }
    if (error instanceof InvalidUrlError) {
      return {
        status: "invalid",
        field: "url",
        message: "That doesn't look like a web address.",
      };
    }
    throw error;
  }
}

/** Saves the note on one of the user's clippings. False when it isn't theirs or is too long. */
export async function updateClippingAction(clippingId: string, note: string): Promise<boolean> {
  const userId = await requireUserId();

  try {
    const updated = await getClippings().updateClipping(userId, clippingId, { note: note.trim() });
    // The detail page is rendered per request, but the router keeps a copy for Back.
    revalidatePath(`/c/${clippingId}`);
    return updated !== null;
  } catch (error) {
    if (error instanceof NoteTooLongError) return false;
    throw error;
  }
}

/** Deletes one of the user's clippings, so that Undo can restore it. False if it isn't theirs. */
export async function deleteClippingAction(clippingId: string): Promise<boolean> {
  const deleted = await getClippings().deleteClipping(await requireUserId(), clippingId);
  revalidatePath("/");
  revalidatePath(`/c/${clippingId}`);
  return deleted;
}

/** Undoes `deleteClippingAction`. False if the user has no such deleted clipping. */
export async function restoreClippingAction(clippingId: string): Promise<boolean> {
  const restored = await getClippings().restoreClipping(await requireUserId(), clippingId);
  revalidatePath("/");
  revalidatePath(`/c/${clippingId}`);
  return restored;
}

export async function loadMoreClippingsAction(cursor: string): Promise<RowsPage> {
  return loadRows(await requireUserId(), cursor);
}

/** Starts a failed clipping over. Returns its row as it now stands, or null if it isn't theirs. */
export async function retryEnrichmentAction(clippingId: string): Promise<ClippingRowData | null> {
  const clipping = await getClippings().retryEnrichment(await requireUserId(), clippingId);
  revalidatePath("/");
  return clipping ? toRow(clipping, constructNow(undefined)) : null;
}
