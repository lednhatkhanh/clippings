import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate: a request with no session cookie goes to sign-in without rendering anything.
 * It only checks the cookie exists. The `(app)` layout validates the session itself.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  return NextResponse.redirect(new URL("/sign-in", request.url));
}

export const config = {
  // Everything except the sign-in page, the API routes (auth callbacks, health), Next's own
  // assets and files with an extension.
  matcher: ["/((?!api|_next|sign-in|.*\\..*).*)"],
};
