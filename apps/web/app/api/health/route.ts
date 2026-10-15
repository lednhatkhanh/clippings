import { connection } from "next/server";

// `connection()` opts the handler out of build-time prerendering. Without it Cache
// Components serves a static constant (from the CDN on Vercel), which would stay
// green while the function runtime was broken.
export async function GET() {
  await connection();
  return Response.json({ status: "ok" });
}
