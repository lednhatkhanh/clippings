import { UTCDate } from "@date-fns/utc";
import { format, parseISO } from "date-fns";

import { getSession } from "@/lib/auth/session.ts";
import { getClippings } from "@/lib/clippings/service.ts";
import { serializeBookmarksHtml } from "@clippings/shared";

/**
 * All of the signed-in user's clippings as a bookmarks HTML download (the Netscape format every
 * browser imports), from Settings: shown title, saved date and tags.
 */
export async function GET() {
  // The proxy skips /api, so the session is checked here.
  const session = await getSession();
  if (!session) return new Response("Not signed in", { status: 401 });

  const data = await getClippings().exportClippings(session.user.id);
  const day = format(new UTCDate(parseISO(data.exportedAt)), "yyyy-MM-dd");
  const html = serializeBookmarksHtml(
    data.clippings.map((clipping) => ({
      url: clipping.url,
      title: clipping.title,
      createdAt: clipping.createdAt,
      tags: clipping.tags,
    })),
  );
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="clippings-${day}.html"`,
      "Cache-Control": "private, no-store",
    },
  });
}
