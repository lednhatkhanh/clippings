import { UTCDate } from "@date-fns/utc";
import { format, parseISO } from "date-fns";

import { getSession } from "@/lib/auth/session.ts";
import { getClippings } from "@/lib/clippings/service.ts";

/** All of the signed-in user's clippings as a JSON download, from Settings. */
export async function GET() {
  // The proxy skips /api, so the session is checked here.
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });

  const data = await getClippings().exportClippings(session.user.id);
  const day = format(new UTCDate(parseISO(data.exportedAt)), "yyyy-MM-dd");
  return new Response(`${JSON.stringify(data, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="clippings-${day}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
