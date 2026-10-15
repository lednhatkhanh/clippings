import { headers } from "next/headers";

import { getAuth } from "./auth";

/** The signed-in session, or null. Reads request headers, so call it inside a Suspense boundary. */
export async function getSession() {
  // Headers first: during prerendering this is where the render postpones, before auth needs
  // its runtime configuration.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
}
