import type { Route } from "next";
import { headers } from "next/headers";
import { cache } from "react";

import { getAuth } from "./auth.ts";
import { REQUESTED_PATH_HEADER, signInPath } from "./return-path.ts";

/**
 * The signed-in session, or null. Reads request headers, so call it inside a Suspense boundary.
 * Deduplicated per request: the layout's gate and the page share one lookup.
 */
export const getSession = cache(async () => {
  // Headers first: during prerendering this is where the render postpones, before auth needs
  // its runtime configuration.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

/** The signed-in user's id, for server actions; throws when there is no session. */
export async function requireUserId(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  return session.user.id;
}

/**
 * Where to send a request whose session is invalid: sign-in, returning to the page asked for.
 * The proxy only sees that a cookie exists, so a revoked or expired session ends up here.
 */
export async function signInRedirect(): Promise<Route> {
  return signInPath((await headers()).get(REQUESTED_PATH_HEADER));
}
