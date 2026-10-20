import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { REQUESTED_PATH_HEADER, signInPath } from "@/lib/auth/return-path.ts";

/**
 * Optimistic gate: a request with no session cookie goes to sign-in without rendering anything.
 * It only checks the cookie exists. The `(app)` layout validates the session itself. Sign-in comes
 * back to the page asked for, so a share from the phone survives an expired session. With a cookie,
 * the requested path travels on as a header, so the layout can do the same when the session behind
 * the cookie turns out revoked or expired.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const requested = `${pathname}${search}`;
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL(signInPath(requested), request.url));
  }
  const headers = new Headers(request.headers);
  headers.set(REQUESTED_PATH_HEADER, requested);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything except the sign-in and offline pages, the API routes (auth callbacks, health),
  // Next's own assets and files with an extension (the service worker, icons, the manifest).
  matcher: ["/((?!api|_next|sign-in|offline|.*\\..*).*)"],
};
