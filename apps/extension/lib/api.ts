import {
  EXTENSION_API_ERRORS,
  extensionClippingSchema,
  extensionLookupResponseSchema,
  extensionSaveResponseSchema,
  extensionSettingsSchema,
  extensionTagsResponseSchema,
  type ExtensionApiError,
  type ExtensionPage,
  type ExtensionUpdateRequest,
  type PaletteName,
  type Tag,
} from "@clippings/shared";

import { accessToken, API_RESOURCE, CLIPPINGS_ORIGIN, forgetTokens } from "./auth.ts";
import type { SaveResult, TagsReply } from "./messages.ts";
import { storePalette } from "./palette.ts";
import { NetworkError, request } from "./request.ts";

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
    request(`${API_RESOURCE}${path}`, {
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

/**
 * Saves the page, or finds it when it is already saved. `page` is what the user's browser shows
 * of it, for the server to read when it can't fetch the page itself.
 */
export async function saveClipping(url: string, page?: ExtensionPage): Promise<SaveResult> {
  let response: Response | "signed_out";
  try {
    // An absent `page` is left out of the JSON.
    response = await call("/clippings", "POST", { url, page });
  } catch (error) {
    console.error("Couldn't reach Clippings", error);
    // No answer at all, offline or not (the server may be down): the save waits and is retried.
    if (!navigator.onLine) return { ok: false, reason: "offline" };
    return { ok: false, reason: error instanceof NetworkError ? "unreachable" : "failed" };
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

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    // A 200 that isn't JSON (a proxy's page), or a body cut off by the timeout.
    console.error("Clippings answered with something unreadable", error);
    return { ok: false, reason: "failed" };
  }
  const saved = extensionSaveResponseSchema.safeParse(body);
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

/**
 * Whether the user has saved the page, for the toolbar icon. Only called when the user turned on
 * "Show when a page is already saved"; "unknown" when the answer couldn't be had.
 */
export async function lookupClipping(url: string): Promise<"saved" | "not_saved" | "unknown"> {
  try {
    const response = await call("/lookup", "POST", { url });
    if (response === SIGNED_OUT || !response.ok) return "unknown";
    const answer = extensionLookupResponseSchema.safeParse(await response.json());
    if (!answer.success) return "unknown";
    return answer.data.saved ? "saved" : "not_saved";
  } catch (error) {
    console.error("Couldn't look the page up", error);
    return "unknown";
  }
}
