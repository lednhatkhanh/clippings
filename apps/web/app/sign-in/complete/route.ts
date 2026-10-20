import { NextResponse } from "next/server";

import { RETURN_TO_PARAM, safeReturnPath } from "@/lib/auth/return-path.ts";
import { getSession } from "@/lib/auth/session.ts";
import { getSettings } from "@/lib/settings/service.ts";
import { APPEARANCE_COOKIE, encodeAppearanceCookie } from "@clippings/ui";

/**
 * Where Google sign-in lands. Hands the user's saved appearance to the no-flash script in a
 * short-lived cookie, so a new device paints the first page in their theme, then goes home, or
 * back to the page that sent them to sign in.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in", request.url));

  const returnTo = safeReturnPath(new URL(request.url).searchParams.get(RETURN_TO_PARAM));
  const response = NextResponse.redirect(new URL(returnTo ?? "/", request.url));
  try {
    const value = encodeAppearanceCookie(await getSettings().getSettings(session.user.id));
    // Written by hand: `cookies().set` would encode the already encoded value a second time.
    // Readable by the script, which deletes it; a minute covers the redirect.
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.headers.append(
      "Set-Cookie",
      `${APPEARANCE_COOKIE}=${value}; Path=/; Max-Age=60; SameSite=Lax${secure}`,
    );
  } catch (error) {
    // The sign-in stands without it: the app layout applies the saved settings once it loads.
    console.error("Couldn't hand over the appearance settings", error);
  }
  return response;
}
