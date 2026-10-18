"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth/auth.ts";
import { getSession } from "@/lib/auth/session.ts";
import { getSettings } from "@/lib/settings/service.ts";
import { pickAppearance, type Appearance } from "@clippings/shared";

/** Saves the appearance settings the user changed. Values the app doesn't know are dropped. */
export async function saveAppearanceAction(changes: Partial<Appearance>): Promise<void> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  await getSettings().updateSettings(session.user.id, pickAppearance(changes));
}

/** Ends the session on the server, clears its cookie and goes to sign-in. */
export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
