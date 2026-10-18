# Verifying a change yourself

Check what you can check; ask the user only for what needs their accounts, real credentials or
taste. Run the app and the database for real, report what you saw, and don't hand over a checklist.

## What you can check, and with what

| Change                                | How                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------- |
| Service, queries, migrations          | Vitest against Postgres (below)                                            |
| Any edit in `apps/web`                | `next-dev-loop` skill: `/_next/mcp` plus `agent-browser`, headless         |
| UI the user should see                | The Browser pane: `preview_start`, click, read, screenshot                 |
| QStash and Anthropic calls            | The fakes in `scripts/local/fakes.mjs` (below)                             |
| Route auth (signatures, cron secret)  | `curl` the route without and with the credential                           |

What stays with the user: real Google sign-in, real QStash delivery and Haiku output quality,
Vercel deploys and crons. Say that you couldn't check those, and why.

## Local setup

One Postgres container serves the tests and the app. Check `docker ps` before starting another.

```bash
docker run --rm -d --name clippings-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=clippings_local -p 55432:5432 pgvector/pgvector:pg18
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres
```

Run the migrations on the local app database. Use the CLI directly: `pnpm --filter @clippings/db migrate`
asks first because it is meant for real databases, and this one is a throwaway container.

```bash
cd packages/db && DATABASE_URL_DIRECT=postgres://postgres:postgres@localhost:55432/clippings_local node_modules/.bin/tsx src/migrate-cli.ts
```

Start the fakes and the app with `preview_start` (`fakes`, then `web-local`; both read
`scripts/local/local.env`, which holds dummy values only). Sign in without Google:

```bash
node scripts/local/sign-in.mjs
```

It prints a cookie value. Set it, then load `/`:

- `agent-browser`, after the `next-dev-loop` preflight `open`:
  `agent-browser cookies set better-auth.session_token <value> --url http://localhost:3100`.
  `--restore` keeps it for later loops.
- The Browser pane, with `javascript_tool`:
  `document.cookie = "better-auth.session_token=<value>; path=/"`.

`get_request_insights` on `/_next/mcp` shows each request's render, fetch and cache spans
(`experimental.requestInsights`, dev only): use it when a page is slow or a cache misses.

## The fakes

- **QStash** accepts a publish, then delivers to the app with a valid signature and
  `Upstash-Retried`, retrying after a non-2xx answer like the real one. Its log shows each attempt.
- **Anthropic** answers the page-reading tool call after four seconds, so the pending state is
  visible. Its title is the page's own, prefixed with `Read:`.
- Pages are fetched for real, so use a public URL such as `https://example.com`. The app refuses
  loopback and private addresses on purpose: a link to `http://127.0.0.1:...` ends as failed, which
  is also the way to see the failed row and Retry.

Read the fakes' output with `preview_logs`. Stop what you started when you are done:
`preview_stop` for the servers, `agent-browser close` for the browser session, and
`docker stop clippings-pg` for the container.
