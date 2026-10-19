import { getSession } from "@/lib/auth/session.ts";
import { getClippings } from "@/lib/clippings/service.ts";

/** The signed-in user's tags, by name: what the tag picker offers. */
export async function GET() {
  // The proxy skips /api, so the session is checked here.
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });

  return Response.json(await getClippings().listTags(session.user.id));
}
