import { handleAsk } from "@/lib/ask/handler.ts";
import { createAnswerer } from "@/lib/ask/model.ts";
import { getSession } from "@/lib/auth/session.ts";
import { getClippings } from "@/lib/clippings/service.ts";

// The answer streams for as long as the model writes.
export const maxDuration = 60;

const answer = createAnswerer();

/** Answers a question from the signed-in user's clippings, streamed with its citations. */
export async function POST(request: Request) {
  return handleAsk(request, {
    // The proxy skips /api, so the session is checked here.
    getUserId: async () => (await getSession())?.user.id ?? null,
    clippings: getClippings(),
    origin: new URL(process.env.BETTER_AUTH_URL ?? request.url).origin,
    answer,
  });
}
