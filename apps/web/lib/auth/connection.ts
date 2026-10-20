import type { Route } from "next";

/** Why a connection ended on the closing page. */
export type ClosedReason = "denied" | "private" | "expired" | "failed";

/** Where an OAuth connection that can't go ahead ends: a page that says so and nothing more. */
export function closedPage(reason: ClosedReason): Route {
  return `/connect/closed?reason=${reason}` as Route;
}

/**
 * Errors the OAuth provider reports at the sign-in page (Better Auth's error page) when it can't
 * trust the client or its redirect URI enough to send the error back to it. None of them comes
 * from Google sign-in, so the sign-in page can tell a failed connection from a failed sign-in.
 */
export const AUTHORIZATION_ERRORS: ReadonlySet<string> = new Set([
  "invalid_client",
  "invalid_request",
  "invalid_target",
  "client_disabled",
  "unauthorized_client",
  "invalid_redirect",
  "unsupported_response_type",
  "unsupported_prompt_select_account",
  "request_not_supported",
  "request_uri_not_supported",
]);

/** The provider's answer to a signed authorization request that was altered or is too old. */
export const INVALID_SIGNATURE = "invalid_signature";
