"use server";

import { constructNow } from "date-fns";
import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/auth/session.ts";
import { loadBrowseParams } from "@/lib/clippings/browse-params.ts";
import { loadRows, toRow, type ClippingRowData, type RowsPage } from "@/lib/clippings/rows.ts";
import { getClippings } from "@/lib/clippings/service.ts";
import { InvalidTagsError, InvalidUrlError, NoteTooLongError } from "@clippings/db";
import { formatAbsoluteDate, type Tag } from "@clippings/shared";

export type SaveOutcome =
  | { status: "created"; clippingId: string }
  | {
      status: "existing";
      clippingId: string;
      url: string;
      note: string;
      tags: Tag[];
      savedOn: string;
    }
  | { status: "invalid"; field: "url" | "note" | "tags"; message: string };

const readString = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** Every value of a repeated field, such as one `tags` field per chosen tag. */
const readStrings = (formData: FormData, name: string) =>
  formData.getAll(name).filter((value): value is string => typeof value === "string");

export async function saveClippingAction(formData: FormData): Promise<SaveOutcome> {
  const userId = await requireUserId();
  const url = readString(formData, "url").trim();
  const note = readString(formData, "note").trim();
  const tags = readStrings(formData, "tags");

  if (!url) {
    return { status: "invalid", field: "url", message: "Paste the address of the page to save." };
  }

  try {
    const { status, clipping } = await getClippings().saveClipping(userId, {
      url,
      note,
      tags,
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
      tags: clipping.tags,
      savedOn: formatAbsoluteDate(clipping.createdAt, constructNow(undefined)),
    };
  } catch (error) {
    if (error instanceof NoteTooLongError) {
      return { status: "invalid", field: "note", message: "That note is too long." };
    }
    if (error instanceof InvalidTagsError) {
      return { status: "invalid", field: "tags", message: `${error.message}.` };
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

/**
 * Makes `tags` the tags on one of the user's clippings, creating new ones. Returns them as
 * stored, or null when the clipping isn't theirs or the tags aren't valid.
 */
export async function updateClippingTagsAction(
  clippingId: string,
  tags: string[],
): Promise<Tag[] | null> {
  const userId = await requireUserId();
  // A server action takes whatever a client sends.
  if (typeof clippingId !== "string") return null;
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string")) return null;

  try {
    const updated = await getClippings().updateClipping(userId, clippingId, { tags });
    revalidatePath("/");
    revalidatePath(`/c/${clippingId}`);
    return updated?.tags ?? null;
  } catch (error) {
    if (error instanceof InvalidTagsError) return null;
    throw error;
  }
}

/** Deletes one of the user's clippings, so that Undo can restore it. False if it isn't theirs. */
export async function deleteClippingAction(clippingId: string): Promise<boolean> {
  const userId = await requireUserId();
  const deleted = await getClippings().deleteClipping(userId, clippingId);
  revalidatePath("/");
  revalidatePath(`/c/${clippingId}`);
  return deleted;
}

/** Undoes `deleteClippingAction`. False if the user has no such deleted clipping. */
export async function restoreClippingAction(clippingId: string): Promise<boolean> {
  const userId = await requireUserId();
  const restored = await getClippings().restoreClipping(userId, clippingId);
  revalidatePath("/");
  revalidatePath(`/c/${clippingId}`);
  return restored;
}

/** The page after `cursor` of the list that `query` (a `toQueryString` result) describes. */
export async function loadMoreClippingsAction(query: string, cursor: string): Promise<RowsPage> {
  const userId = await requireUserId();
  return loadRows(userId, loadBrowseParams(query), cursor);
}

/** Starts a failed clipping over. Returns its row as it now stands, or null if it isn't theirs. */
export async function retryEnrichmentAction(clippingId: string): Promise<ClippingRowData | null> {
  const userId = await requireUserId();
  const clipping = await getClippings().retryEnrichment(userId, clippingId);
  revalidatePath("/");
  return clipping ? toRow(clipping, constructNow(undefined)) : null;
}
