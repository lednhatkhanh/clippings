import { headers } from "next/headers";
import { cache } from "react";

import { getAuth } from "./auth.ts";

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
