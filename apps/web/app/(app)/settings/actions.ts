"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth/auth.ts";
import { getConnections } from "@/lib/auth/connections.ts";
import { getSession, requireUserId } from "@/lib/auth/session.ts";
import { getSettings } from "@/lib/settings/service.ts";
import { pickAppearance, type Appearance } from "@clippings/shared";

/** Saves the appearance settings the user changed. Values the app doesn't know are dropped. */
export async function saveAppearanceAction(changes: Partial<Appearance>): Promise<void> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  await getSettings().updateSettings(session.user.id, pickAppearance(changes));
}

/**
 * Ends the session on the server, clears its cookie and goes to sign-in. Signing out is for
 * whoever holds the cookie, and with none it does nothing, so there is no user data to guard.
 */
// ast-grep-ignore: server-action-checks-session
export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}

/**
 * Revokes one of the user's connected clients: its tokens stop working at once, and it has to be
 * connected again. False when the client isn't connected to this user.
 */
export async function revokeConnectionAction(clientId: string): Promise<boolean> {
  const userId = await requireUserId();
  if (typeof clientId !== "string") return false;
  const revoked = await getConnections().revokeConnection(userId, clientId);
  if (revoked) revalidatePath("/settings");
  return revoked;
}
