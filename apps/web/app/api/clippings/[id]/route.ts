import { getSession } from "../../../../lib/auth/session";
import { loadRow } from "../../../../lib/clippings/rows";

/** One of the signed-in user's clippings as a list row. A pending row polls this until it is read. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // The proxy skips /api, so the session is checked here.
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });

  const row = await loadRow(session.user.id, (await params).id);
  return row ? Response.json(row) : new Response("Not found", { status: 404 });
}
