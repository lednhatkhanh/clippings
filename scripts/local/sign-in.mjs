// Signs a local user in without Google: adds a user and session to the local database and prints
// the cookie to set in the browser. Run it after the migrations.
//
//   node scripts/local/sign-in.mjs
//
// Then, on http://localhost:3100 (Browser pane, javascript_tool):
//   document.cookie = "better-auth.session_token=<printed value>; path=/"
//
// Needs the Postgres container from docs/agents/verifying.md. Local development only. The
// end-to-end suite (apps/e2e) signs its users in with the same function.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { createTestSession } from "../../packages/db/src/test/session.ts";

const env = Object.fromEntries(
  readFileSync(new URL("./local.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

const pg = createRequire(new URL("../../packages/db/package.json", import.meta.url))("pg");
const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();
const { cookieValue } = await createTestSession({
  db: client,
  secret: env.BETTER_AUTH_SECRET,
  user: { id: "local-user", name: "Local", email: "local@example.com" },
  sessionId: "local-session",
  token: "local-session-token-0123456789abcdef",
});
await client.end();

console.log(cookieValue);
