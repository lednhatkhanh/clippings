"use server";

import { APIError } from "better-auth/api";
import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth, OAUTH_LOGIN_PAGE } from "@/lib/auth/auth.ts";
import { closedPage, INVALID_SIGNATURE } from "@/lib/auth/connection.ts";
import { RETURN_TO_PARAM, safeReturnPath, withReturnTo } from "@/lib/auth/return-path.ts";

/**
 * Starts Google sign-in. Also behind "Use another account": Google shows its chooser. The form's
 * return path rides along to `/sign-in/complete`, and back to `/sign-in` if it fails.
 *
 * During an OAuth authorization (Claude connecting), the sign-in page carries the signed request
 * in `oauth_query` instead. Passing it on lets the provider resume the authorization once the
 * session exists, and a refused account comes back to sign-in with the request still attached.
 *
 * It runs before there is a session, so it has none to check; it reads and writes no user data.
 */
// ast-grep-ignore: server-action-checks-session
export async function signInWithGoogle(formData: FormData) {
  const returnTo = safeReturnPath(formData.get(RETURN_TO_PARAM));
  const value = formData.get("oauth_query");
  const oauthQuery = typeof value === "string" && value ? value : undefined;

  let url: string | undefined;
  try {
    ({ url } = await getAuth().api.signInSocial({
      body: {
        provider: "google",
        callbackURL: withReturnTo("/sign-in/complete", returnTo),
        errorCallbackURL: oauthQuery
          ? `${OAUTH_LOGIN_PAGE}?${oauthQuery}`
          : withReturnTo(OAUTH_LOGIN_PAGE, returnTo),
        ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
      },
      headers: await headers(),
    }));
  } catch (error) {
    // The authorization request expired while the sign-in page was open (ten minutes).
    if (error instanceof APIError && error.body?.error === INVALID_SIGNATURE) {
      redirect(closedPage("expired"));
    }
    throw error;
  }
  if (!url) throw new Error("Google sign-in did not return a URL");
  // Google's authorization URL: external, so it is outside the typed routes.
  redirect(url as Route);
}
