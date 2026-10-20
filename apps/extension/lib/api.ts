import { extensionClippingSchema, extensionSaveResponseSchema } from "@clippings/shared";

import { accessToken, API_RESOURCE, forgetTokens } from "./auth.ts";
import type { SaveResult } from "./messages.ts";

const SIGNED_OUT = "signed_out";

/**
 * Calls the extension API with the bearer token, never cookies. A refused token is refreshed and
 * the call tried once more; refused again, the user is signed out.
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
  const again = await send(retried);
  if (again.status !== 401) return again;
  await forgetTokens();
  return SIGNED_OUT;
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
  if (response.status === 403) {
    // Taken off the allowlist: signing in again is how to use another account.
    await forgetTokens();
    return { ok: false, reason: "not_allowlisted" };
  }
  if (response.status === 400) return { ok: false, reason: "invalid_url" };
  if (!response.ok) return { ok: false, reason: "failed" };

  const saved = extensionSaveResponseSchema.safeParse(await response.json());
  return saved.success ? { ok: true, saved: saved.data } : { ok: false, reason: "failed" };
}

/** Replaces the clipping's note. Returns whether it was saved. */
export async function saveNote(clippingId: string, note: string): Promise<boolean> {
  try {
    const response = await call(`/clippings/${encodeURIComponent(clippingId)}`, "PATCH", { note });
    if (response === SIGNED_OUT || !response.ok) return false;
    return extensionClippingSchema.safeParse(await response.json()).success;
  } catch (error) {
    console.error("Couldn't save the note", error);
    return false;
  }
}
