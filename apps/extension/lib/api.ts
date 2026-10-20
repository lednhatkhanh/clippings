import {
  EXTENSION_API_ERRORS,
  extensionClippingSchema,
  extensionSaveResponseSchema,
  extensionSettingsSchema,
  extensionTagsResponseSchema,
  type ExtensionApiError,
  type ExtensionUpdateRequest,
  type PaletteName,
  type Tag,
} from "@clippings/shared";

import { accessToken, API_RESOURCE, CLIPPINGS_ORIGIN, forgetTokens } from "./auth.ts";
import type { SaveResult, TagsReply } from "./messages.ts";
import { storePalette } from "./palette.ts";

const SIGNED_OUT = "signed_out";

/**
 * Calls the extension API with the bearer token, never cookies. A refused token is refreshed and
 * the call tried once more. Only a refused refresh signs the user out (`accessToken` drops the
 * tokens then): a second refusal after a good refresh is answered as it is.
 */
async function call(
  path: string,
  method: string,
  body?: unknown,
): Promise<Response | "signed_out"> {
  const send = (token: string) =>
    fetch(`${API_RESOURCE}${path}`, {
      method,
      credentials: "omit",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const token = await accessToken();
  if (!token) return SIGNED_OUT;
  const response = await send(token);
  if (response.status !== 401) return response;

  const retried = await accessToken({ stale: true });
  if (!retried) return SIGNED_OUT;
  return send(retried);
}

/** The API's reason for refusing a request, from its error body. */
async function errorOf(response: Response): Promise<ExtensionApiError | undefined> {
  try {
    const { error } = (await response.json()) as { error?: unknown };
    return EXTENSION_API_ERRORS.find((known) => known === error);
  } catch {
    return undefined;
  }
}

/** Saves the page, or finds it when it is already saved. */
export async function saveClipping(url: string): Promise<SaveResult> {
  let response: Response | "signed_out";
  try {
    response = await call("/clippings", "POST", { url });
  } catch (error) {
    console.error("Couldn't reach Clippings", error);
    return { ok: false, reason: navigator.onLine ? "failed" : "offline" };
  }
  if (response === SIGNED_OUT) return { ok: false, reason: "signed_out" };
  if (!response.ok) {
    const error = await errorOf(response);
    if (error === "not_allowlisted") {
      // Taken off the allowlist: signing in again is how to use another account.
      await forgetTokens();
      return { ok: false, reason: "not_allowlisted" };
    }
    return { ok: false, reason: error === "invalid_url" ? "invalid_url" : "failed" };
  }

  const saved = extensionSaveResponseSchema.safeParse(await response.json());
  // The popup links to the clipping: only ever to this Clippings.
  if (!saved.success || new URL(saved.data.clipping.link).origin !== CLIPPINGS_ORIGIN) {
    return { ok: false, reason: "failed" };
  }
  return { ok: true, saved: saved.data };
}

/** Changes the clipping's note or tags: "gone" when it was deleted in the meantime. */
async function updateClipping(clippingId: string, changes: ExtensionUpdateRequest) {
  try {
    const response = await call(`/clippings/${encodeURIComponent(clippingId)}`, "PATCH", changes);
    if (response === SIGNED_OUT) return "failed";
    if (response.status === 404) return "gone";
    if (!response.ok) return "failed";
    const updated = extensionClippingSchema.safeParse(await response.json());
    return updated.success ? updated.data : "failed";
  } catch (error) {
    console.error("Couldn't save the clipping", error);
    return "failed";
  }
}

/** Replaces the clipping's note: "gone" when it was deleted in the meantime. */
export async function saveNote(
  clippingId: string,
  note: string,
): Promise<"saved" | "gone" | "failed"> {
  const outcome = await updateClipping(clippingId, { note });
  return typeof outcome === "string" ? outcome : "saved";
}

/**
 * Makes `names` the clipping's tags, creating the ones the user doesn't have yet, as the web app
 * does. Answers the tags as stored.
 */
export async function saveTags(clippingId: string, names: string[]): Promise<TagsReply> {
  const outcome = await updateClipping(clippingId, { tags: names });
  return typeof outcome === "string" ? { type: outcome } : { type: "saved", tags: outcome.tags };
}

/** Every tag the user has, for the tag picker to offer. Null when they can't be read. */
export async function listTags(): Promise<Tag[] | null> {
  try {
    const response = await call("/tags", "GET");
    if (response === SIGNED_OUT || !response.ok) return null;
    const tags = extensionTagsResponseSchema.safeParse(await response.json());
    return tags.success ? tags.data : null;
  } catch (error) {
    console.error("Couldn't load the tags", error);
    return null;
  }
}

/**
 * Reads the user's palette from their Clippings settings into sync storage, where the extension's
 * pages paint it from. Null when it can't be read: the stored one stays.
 */
export async function refreshPalette(): Promise<PaletteName | null> {
  try {
    const response = await call("/settings", "GET");
    if (response === SIGNED_OUT || !response.ok) return null;
    const settings = extensionSettingsSchema.safeParse(await response.json());
    if (!settings.success) return null;
    await storePalette(settings.data.palette);
    return settings.data.palette;
  } catch (error) {
    console.error("Couldn't read the palette", error);
    return null;
  }
}
