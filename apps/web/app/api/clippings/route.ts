import { getSession } from "@/lib/auth/session.ts";
import { loadBrowseParams } from "@/lib/clippings/browse-params.ts";
import { loadRows } from "@/lib/clippings/rows.ts";

/**
 * The first page of what the list shows for `?q=&source=&sort=`, as list rows. Search-as-you-type
 * asks this while the user types.
 */
export async function GET(request: Request) {
  // The proxy skips /api, so the session is checked here.
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });

  const params = loadBrowseParams(request);
  try {
    return Response.json(await loadRows(session.user.id, params, undefined, request.signal));
  } catch (error) {
    // The reader typed past this search and the client cancelled it: nobody is waiting.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    throw error;
  }
}
