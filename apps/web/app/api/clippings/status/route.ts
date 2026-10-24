import { getSession } from "@/lib/auth/session.ts";
import { getClippings } from "@/lib/clippings/service.ts";
import { clippingStatusIdsSchema, type ClippingStatuses } from "@clippings/shared";

/**
 * Where each of the signed-in user's clippings in `?ids=a,b,c` is in enrichment (at most
 * `MAX_STATUS_IDS`). The list polls its pending rows with one of these instead of one request per
 * row; a clipping that is not the user's or is deleted is left out.
 */
export async function GET(request: Request) {
  // The proxy skips /api, so the session is checked here.
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });

  const ids = clippingStatusIdsSchema.safeParse(new URL(request.url).searchParams.get("ids") ?? "");
  if (!ids.success) return new Response("Bad ids", { status: 400 });

  const statuses = await getClippings().getClippingStatuses(session.user.id, ids.data);
  return Response.json({ statuses } satisfies ClippingStatuses);
}
