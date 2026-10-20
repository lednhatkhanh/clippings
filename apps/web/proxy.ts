import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { withReturnTo } from "@/lib/auth/return-path.ts";

/**
 * Optimistic gate: a request with no session cookie goes to sign-in without rendering anything.
 * It only checks the cookie exists. The `(app)` layout validates the session itself. Sign-in comes
 * back to the page asked for, so a share from the phone survives an expired session.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const returnTo = pathname === "/" && !search ? null : `${pathname}${search}`;
  return NextResponse.redirect(new URL(withReturnTo("/sign-in", returnTo), request.url));
}

export const config = {
  // Everything except the sign-in and offline pages, the API routes (auth callbacks, health),
  // Next's own assets and files with an extension (the service worker, icons, the manifest).
  matcher: ["/((?!api|_next|sign-in|offline|.*\\..*).*)"],
};
