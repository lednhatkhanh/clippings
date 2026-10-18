// Signs a local user in without Google: adds a user and session to the local database and prints
// the cookie to set in the browser. Run it after the migrations.
//
//   node scripts/local/sign-in.mjs
//
// Then, on http://localhost:3100 (Browser pane, javascript_tool):
//   document.cookie = "better-auth.session_token=<printed value>; path=/"
//
// Needs the Postgres container from docs/agents/verifying.md. Local development only.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const env = Object.fromEntries(
  readFileSync(new URL("./local.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

const pg = createRequire(new URL("../../packages/db/package.json", import.meta.url))("pg");
const token = "local-session-token-0123456789abcdef";
const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();
await client.query(
  `insert into "user" (id, name, email, "emailVerified") values ('local-user', 'Local', 'local@example.com', true)
   on conflict do nothing`,
);
await client.query(
  `insert into session (id, "expiresAt", token, "updatedAt", "userId")
   values ('local-session', now() + interval '7 days', $1, now(), 'local-user')
   on conflict (id) do update set "expiresAt" = excluded."expiresAt"`,
  [token],
);
await client.end();

const signature = createHmac("sha256", env.BETTER_AUTH_SECRET).update(token).digest("base64");
console.log(encodeURIComponent(`${token}.${signature}`));
