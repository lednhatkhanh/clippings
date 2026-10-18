"use server";

import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth/auth.ts";

/** Starts Google sign-in. Also behind "Use another account": Google shows its chooser. */
export async function signInWithGoogle() {
  const { url } = await getAuth().api.signInSocial({
    body: { provider: "google", callbackURL: "/", errorCallbackURL: "/sign-in" },
    headers: await headers(),
  });
  if (!url) throw new Error("Google sign-in did not return a URL");
  // Google's authorization URL: external, so it is outside the typed routes.
  redirect(url as Route);
}
