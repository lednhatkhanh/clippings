"use server";

import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth/auth.ts";
import { RETURN_TO_PARAM, safeReturnPath, withReturnTo } from "@/lib/auth/return-path.ts";

/**
 * Starts Google sign-in. Also behind "Use another account": Google shows its chooser. The form's
 * return path rides along to `/sign-in/complete`, and back to `/sign-in` if it fails.
 */
export async function signInWithGoogle(formData: FormData) {
  const returnTo = safeReturnPath(formData.get(RETURN_TO_PARAM));
  const { url } = await getAuth().api.signInSocial({
    body: {
      provider: "google",
      callbackURL: withReturnTo("/sign-in/complete", returnTo),
      errorCallbackURL: withReturnTo("/sign-in", returnTo),
    },
    headers: await headers(),
  });
  if (!url) throw new Error("Google sign-in did not return a URL");
  // Google's authorization URL: external, so it is outside the typed routes.
  redirect(url as Route);
}
