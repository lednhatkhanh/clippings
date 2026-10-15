"use server";

import { revalidatePath } from "next/cache";

import { InvalidUrlError } from "@clippings/db";

import { getSession } from "../../lib/auth/session";
import { MAX_NOTE_LENGTH } from "../../lib/clippings/note";
import { loadRows, type RowsPage } from "../../lib/clippings/rows";
import { getClippings } from "../../lib/clippings/service";
import { formatAbsoluteDate } from "../../lib/format-date";

export type SaveOutcome =
  | { status: "created" }
  | { status: "existing"; clippingId: string; url: string; note: string; savedOn: string }
  | { status: "invalid"; field: "url" | "note"; message: string };

async function requireUserId(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  return session.user.id;
}

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function saveClippingAction(formData: FormData): Promise<SaveOutcome> {
  const userId = await requireUserId();
  const url = text(formData, "url").trim();
  const note = text(formData, "note").trim();

  if (!url) {
    return { status: "invalid", field: "url", message: "Paste the address of the page to save." };
  }
  if (note.length > MAX_NOTE_LENGTH) {
    return { status: "invalid", field: "note", message: "That note is too long." };
  }

  try {
    const { status, clipping } = await getClippings().saveClipping(userId, {
      url,
      note,
      source: "web",
    });
    if (status === "created") {
      revalidatePath("/");
      return { status: "created" };
    }
    return {
      status: "existing",
      clippingId: clipping.id,
      url: clipping.url,
      note: clipping.note,
      savedOn: formatAbsoluteDate(clipping.createdAt, new Date()),
    };
  } catch (error) {
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

export async function updateNoteAction(clippingId: string, formData: FormData): Promise<boolean> {
  const userId = await requireUserId();
  const note = text(formData, "note").trim();
  if (note.length > MAX_NOTE_LENGTH) return false;

  const updated = await getClippings().updateNote(userId, clippingId, note);
  revalidatePath("/");
  return updated !== null;
}

export async function loadMoreClippingsAction(cursor: string): Promise<RowsPage> {
  return loadRows(await requireUserId(), cursor);
}
