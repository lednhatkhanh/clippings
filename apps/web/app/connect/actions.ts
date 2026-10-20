"use server";

import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth, OAUTH_LOGIN_PAGE } from "@/lib/auth/auth.ts";
import { closedPage, INVALID_SIGNATURE } from "@/lib/auth/connection.ts";

const readOAuthQuery = (formData: FormData) => {
  const value = formData.get("oauth_query");
  return typeof value === "string" ? value : "";
};

/**
 * Allow: records the consent and sends the browser back to the client with its authorization
 * code. The consent endpoint checks the signed request, the session and the allowlist.
 */
export async function allowConnectionAction(formData: FormData): Promise<void> {
  let url: unknown;
  let expired = false;
  try {
    const requestHeaders = await headers();
    const auth = getAuth();
    const { baseURL } = await auth.$context;
    // Through the auth handler, as a browser client would call it: consent resumes the
    // authorization, which needs the request it came in on.
    const response = await auth.handler(
      new Request(`${baseURL}/oauth2/consent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          cookie: requestHeaders.get("cookie") ?? "",
          origin: requestHeaders.get("origin") ?? "",
        },
        body: JSON.stringify({ accept: true, oauth_query: readOAuthQuery(formData) }),
      }),
    );
    if (!response.ok) {
      const body = await response.text();
      // The signed request expired while the consent page was open (ten minutes).
      expired = body.includes(INVALID_SIGNATURE);
      throw new Error(`Consent answered ${response.status}: ${body}`);
    }
    ({ url } = (await response.json()) as { url?: unknown });
    if (typeof url !== "string" || !URL.canParse(url))
      throw new Error("Consent returned no redirect");
  } catch (error) {
    if (expired) redirect(closedPage("expired"));
    console.error("Couldn't complete the OAuth consent", error);
    redirect(closedPage("failed"));
  }
  // The client's redirect URI: claude.ai's callback or Claude Code's loopback port.
  redirect(url as Route);
}

/** Deny: no code for the client, and the closing page for the user. */
export async function denyConnectionAction(): Promise<void> {
  redirect(closedPage("denied"));
}

/** "Not you?": signs out and starts sign-in again, keeping the authorization request. */
export async function switchAccountAction(formData: FormData): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  const oauthQuery = readOAuthQuery(formData);
  redirect((oauthQuery ? `${OAUTH_LOGIN_PAGE}?${oauthQuery}` : OAUTH_LOGIN_PAGE) as Route);
}
