# Verifying a change yourself

Check what you can check; ask the user only for what needs their accounts, real credentials or
taste. Run the app and the database for real, report what you saw, and don't hand over a checklist.

## What you can check, and with what

| Change                                | How                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------- |
| Service, queries, migrations          | Vitest against Postgres (below)                                            |
| Any edit in `apps/web`                | `next-dev-loop` skill: `/_next/mcp` plus `agent-browser`, headless         |
| UI the user should see                | The Browser pane: `preview_start`, click, read, screenshot                 |
| QStash, Anthropic and Voyage AI calls | The fakes in `scripts/local/fakes.mjs` (below)                             |
| Route auth (signatures, cron secret)  | `curl` the route without and with the credential                           |
| Flows across browser, app and database | `pnpm e2e` (Playwright on a production build, port 3300 (`E2E_PORT` moves it, for two runs side by side), the built extension in its own project, database `clippings_e2e` and the fakes; the Postgres container below must be up, and `pnpm --filter @clippings/e2e browsers` installs Chromium once) |

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

The service worker registers only in a production build. Build with `local.env` loaded and
`BETTER_AUTH_URL=http://localhost:3200`, then `preview_start` `web-local-start` (`next start` on
3200). Production cookies are `__Secure-` prefixed, so set
`__Secure-better-auth.session_token=<value>; path=/; secure` instead. Stopping the server stands in
for going offline; a second build gets a new build id, so it triggers the update toast.

`get_request_insights` on `/_next/mcp` shows each request's render, fetch and cache spans
(`experimental.requestInsights`, dev only): use it when a page is slow or a cache misses.

## The fakes

- **QStash** accepts a publish, then delivers to the app with a valid signature and
  `Upstash-Retried`, retrying after a non-2xx answer like the real one. Its log shows each attempt.
  It takes batches (`/v2/batch`, as the import backlog publishes) and honours `Upstash-Delay`, capped
  at 5 seconds so a backlog spread over a day drains locally in moments.
- **Anthropic** answers the page-reading tool call after four seconds, so the pending state is
  visible. Its title is the page's own, prefixed with `Read:`. When the request asks for tag
  suggestions, it suggests the user's first two tags and one new tag, the first long word of the
  page title, each with `low` confidence (a suggestion). A `[fake-confidence high]` marker in the
  message makes them `high`, which auto-tagging (on by default for every user) applies and logs.
  When the user has research domains it also gives the research verdict: worth researching when
  the save's text names one of the domains (the default ones are `shipping` and `logistics`), and
  `[fake-research no]` in the message forces not worth it.
  Like the real API, it answers a forced `tool_choice` (`tool` or `any`) to Sonnet 5.5, Opus 5.5 or
  Fable 5.1 with a 400; the app asks for its tool by name instead (`lib/gateway/one-tool.ts`), and
  the fake reads which tool from that closing line.
  Every reply carries `usage` (input is the request's characters over four, output 10), which the
  model gateway prices into the ledger. Markers in the message text set it or make the call fail:
  `[fake-usage input=1000 output=200 cache_read=5000 cache_write=300 searches=2]`, and
  `[fake-error spend-limit|credit|tier-cap|rate-limit|overloaded]` for the HTTP 400 workspace
  limit, 400 empty credit, 429 without `retry-after`, an ordinary 429 and a 529. The gateway test
  starts the fakes itself on free ports (`FAKE_ANTHROPIC_PORT`, `FAKE_VOYAGE_PORT`,
  `FAKE_QSTASH_PORT`; `FAKE_MODEL_DELAY_MS=0` skips the four seconds). To see the cap locally, set
  the daily cap in Settings → Automation to `0.00` (or `UPDATE user_settings SET daily_cap_micros =
  0`) and save a link: it stays pending and the QStash log shows a 200.
- **Research briefs and batches**: a request that carries the `web_search_20260209` tool gets a
  short brief at once: text with two citations (`https://example.com/fake-source-1` and `-2`) and
  usage of two web searches. The Batches API (`/v1/messages/batches`) accepts a create as
  `in_progress`, reports `ended` once `FAKE_BATCH_DELAY_MS` (default 0) has passed, and serves
  JSONL results, each request answered as a normal call. `[fake-batch errored]` or `[fake-batch
  expired]` in a request's message gives that outcome, and `[fake-error spend-limit]` makes the
  create fail. Run the daily batch by hand with `curl -H "Authorization: Bearer $CRON_SECRET"
  http://localhost:3100/api/cron/briefs`: the first call submits the queued briefs, the next
  collects them (the research jobs per day, 3 by default, cap what a user submits).
- **The librarian**: a request for the librarian's forced tools (`plan_tags`, `plan_folders`,
  `plan_links`, `plan_topic_pages`, and Haiku's `confirm_links`) gets a deterministic plan read off
  the library in its system prompt: tags `x` and `xs` merge, a tag with capitals is renamed to
  lowercase, items and tags go in a folder named for their first tag (items with no tag in
  "Notes"), the first two items that share a tag are linked, a tag with three or more items gets a
  topic page, a tag with ten or more is flagged as too broad. Every change is `high` confidence
  unless the library holds `[fake-confidence low]` (put it in a note). Try it with the `run_librarian`
  MCP tool (a dry run, then `dryRun: false`), or by hand: `curl -H "Authorization: Bearer
  $CRON_SECRET" http://localhost:3100/api/cron/librarian` publishes a job per user to the fake
  QStash, which delivers it to `/api/jobs/librarian`. A user's first run only suggests, so the
  first call shows suggestions in `list_suggestions` (an idea already waiting, or dismissed, is not
  proposed again); to see high-confidence changes applied, save something new after the first run,
  or delete the user's `library_changes` rows to start again.
- **Lessons**: a request for the forced `write_lesson` tool gets a short stand-in lesson on the
  topic named in the message (`Topic: <name>.`, else "recent reading"): a Markdown body with
  headings, a four-choice quiz, a recap when the message holds a `<previous_lesson>` (empty when
  not) and the first two saved items it lists as sources. Run the Tuesday/Friday job by hand with
  `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/cron/lessons`: it
  publishes a `{ userId, day }` job per user with a library to the fake QStash, which delivers it
  to `/api/jobs/lessons` (the day is today's UTC day, and a lesson exists once per user per day, so
  a second call that day answers `exists`; delete the user's `lessons` row to write it again). Set
  the daily cap to `0.00` to see a lesson skipped as `cap_reached`; a note holding `[fake-error
  overloaded]` in the topic's items makes the job fail and QStash retry it once.
- **Voyage AI** embeds a text as its words (one hashed axis per word), so search by meaning finds
  texts that share a word even where keyword search wouldn't, such as a word in the summary.
  Real semantic quality stays with the user.
- Pages are fetched for real, so use a public URL such as `https://example.com`. The app refuses
  loopback and private addresses on purpose: a link to `http://127.0.0.1:...` ends as failed, which
  is also the way to see the failed row and Retry.

Call the sweep cron by hand with the secret from `local.env`: `curl -H "Authorization: Bearer
$CRON_SECRET" http://localhost:3100/api/cron/sweep`.

Read the fakes' output with `preview_logs`. Stop what you started when you are done:
`preview_stop` for the servers, `agent-browser close` for the browser session, and
`docker stop clippings-pg` for the container.
