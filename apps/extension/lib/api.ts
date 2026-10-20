import {
  EXTENSION_API_ERRORS,
  extensionClippingSchema,
  extensionSaveResponseSchema,
  type ExtensionApiError,
} from "@clippings/shared";

import { accessToken, API_RESOURCE, CLIPPINGS_ORIGIN, forgetTokens } from "./auth.ts";
import type { SaveResult } from "./messages.ts";

const SIGNED_OUT = "signed_out";

/**
 * Calls the extension API with the bearer token, never cookies. A refused token is refreshed and
 * the call tried once more. Only a refused refresh signs the user out (`accessToken` drops the
 * tokens then): a second refusal after a good refresh is answered as it is.
 */
async function call(path: string, method: string, body: unknown): Promise<Response | "signed_out"> {
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

/** Replaces the clipping's note: "gone" when it was deleted in the meantime. */
export async function saveNote(
  clippingId: string,
  note: string,
): Promise<"saved" | "gone" | "failed"> {
  try {
    const response = await call(`/clippings/${encodeURIComponent(clippingId)}`, "PATCH", { note });
    if (response === SIGNED_OUT) return "failed";
    if (response.status === 404) return "gone";
    if (!response.ok) return "failed";
    return extensionClippingSchema.safeParse(await response.json()).success ? "saved" : "failed";
  } catch (error) {
    console.error("Couldn't save the note", error);
    return "failed";
  }
}
