# Clippings

A small, private, multi-user knowledge inbox: you save web pages ("clippings") and notes, and
agents tag, file, link, research and teach. Save from the web app, the phone's share sheet, a
browser extension or Claude (MCP); the app reads each page in the background, then you search by
keyword and meaning. Sign-in is Google only, limited to an allowlist of emails, and every user's
data is private to them.

## Status

In use and released to production. It was built from three specs, all shipped:

- **v1**, [issue #1](https://github.com/lednhatkhanh/clippings/issues/1): saving from the web app,
  extension and Claude; background enrichment with Claude Haiku; hybrid keyword and meaning
  search; tags; related clippings; an installable PWA; the Paper & Glass design system.
- **v2**, [issue #101](https://github.com/lednhatkhanh/clippings/issues/101): renaming, tag
  suggestions, pins, sharing, editing from Claude, bookmark import and export, saved page text
  and PDFs, daily dead-link checks, and the Clippings plugin.
- **Scale-up**, [issue #136](https://github.com/lednhatkhanh/clippings/issues/136): a model
  gateway with a cost ledger and a daily cap; Markdown notes; auto-tagging; the weekly librarian
  (folders, tag colors, links between items, topic pages, an undoable change log); research
  briefs for saves in your chosen domains; and twice-weekly lessons. The in-app Ask and This week
  digest were removed in favour of using Claude over MCP.

New work starts as a GitHub issue ([`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 7 · Tailwind 4 · React Aria Components ·
Better Auth · Drizzle · Postgres 18 with pgvector on Neon · WXT (extension) · pnpm 12 + Turborepo ·
oxlint/oxfmt · Vitest and Playwright. Background jobs run on Upstash QStash and Vercel Cron; the
models are Claude Haiku 5.5 and Sonnet 5.5, with Voyage `voyage-4` embeddings
([ADR 0001](docs/adr/0001-embeddings-voyage-4.md)). Hosted on Vercel Hobby and Neon Launch. The
reasoning is in [`docs/research`](docs/research/2026-10-14-stack-and-design.md) and
[`docs/adr`](docs/adr).

## Layout

```text
apps/
├── web/          Next.js app: UI, auth, API routes
├── extension/    WXT browser extension: popup, context menu and shortcuts that save the page
└── e2e/          Playwright end-to-end tests against a production build of the web app
packages/
├── ui/           Design system: generated theme, tokens, icons, illustrations
├── db/           Drizzle schema, migrations, the migration runner and the data services
├── shared/       Zod schemas, DTO types, URL normalizer (shared by web and extension)
└── config/       Shared tsconfig presets
plugins/clippings Claude plugin: the MCP connector and a skill for using it
docs/             Deploy runbook, ADRs, research, agent docs
scripts/          CI helpers and local fakes
```

## Getting started

You need Node 26 (see `.node-version`), pnpm 12 and a Postgres to point at (a local one, or a Neon
branch).

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # then fill it in
DATABASE_URL_DIRECT=postgres://... pnpm --filter @clippings/db migrate
pnpm --filter @clippings/web dev --port 3100
```

The app is then on <http://localhost:3100>. Sign-in needs a Google OAuth client with
`http://localhost:3100/api/auth/callback/google` as an authorized redirect URI, and your email in
`ALLOWED_EMAILS`. Every variable is described in
[`apps/web/.env.example`](apps/web/.env.example).

## Commands

Run from the repo root.

| Command                   | What it does                                                          |
| ------------------------- | --------------------------------------------------------------------- |
| `pnpm lint`               | oxlint (type-aware) in every package, plus design-system lint         |
| `pnpm typecheck`          | `tsc` in every package                                                |
| `pnpm test`               | Vitest in every package                                               |
| `pnpm build`              | Production build of every app                                         |
| `pnpm e2e`                | End-to-end tests (Playwright) on a production build; needs the Postgres below and `pnpm --filter @clippings/e2e browsers` once |
| `pnpm format`             | Rewrite files with oxfmt                                              |
| `pnpm format:check`       | Check formatting without writing                                      |
| `pnpm check:root`         | Format, lint and icon checks for root files, `scripts/` and workflows |
| `node scripts/run-checks.mjs` | What CI runs: all of the above, affected packages only when safe |

Database tests need a Postgres server and are skipped without one:

```bash
docker run --rm -d -e POSTGRES_PASSWORD=postgres -p 55432:5432 pgvector/pgvector:pg18
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres pnpm test
```

## Connecting Claude

The MCP server is at `<BETTER_AUTH_URL>/mcp`. Every client gets
`save_clipping`, `search_clippings`, `list_recent`, `list_clippings` and `related_clippings`; one
that asks for the write scope also gets `save_note` (a text note with no URL, in Markdown),
`get_clipping`, `update_clipping`, `tag_clippings`, `list_tags`, `rename_tag`, `merge_tag`,
`delete_tag`, `list_tag_suggestions`, `accept_tag_suggestions`, `dismiss_tag_suggestions`,
`delete_clipping` and `restore_clipping`, and the librarian's tools: `set_tag_color`,
`list_folders`, `create_folder`, `move_to_folder`, `link_items`, `run_librarian` (a dry run by
default: the changes the weekly job would make), `list_suggestions`, `apply_suggestion`,
`dismiss_suggestion` and `undo_change`. Every change they make (and every
`rename_tag`, `merge_tag` and `delete_tag`) is logged with the state it replaced, so `undo_change` reverses it;
the librarian itself applies only high-confidence changes and leaves the rest as suggestions, and
nothing here deletes a clipping or note.

The app has no chat or digest of its own: to ask questions of your library or review the week, use
Claude over this connector. The old `/ask` and `/digest` URLs redirect to the library.

- **claude.ai**: Settings → Connectors → Add custom connector, with that URL.
- **Claude Code**: `claude mcp add --transport http clippings <BETTER_AUTH_URL>/mcp`, then `/mcp`
  to sign in.

Either one opens a browser window: sign in with an allowlisted Google account, then Allow.
Clippings is the OAuth authorization server (Better Auth's MCP plugin), so there are no keys to
copy.

### The Clippings plugin

`plugins/clippings` bundles that connector (pointed at the production `/mcp`) with a skill that
teaches Claude to search before saving, reuse your tags, cite links, and run a weekly review and a
tag tidy-up. This repo is also the plugin marketplace.

- **Claude Code**: run `/plugin marketplace add lednhatkhanh/clippings`, then
  `/plugin install clippings@clippings`, then `/mcp` to sign in.
- **claude.ai and Cowork**: Customize → Plugins, add the GitHub repository
  `lednhatkhanh/clippings` as a marketplace, install `clippings`, then connect Clippings from the
  plugin's Connectors tab. A plugin installed this way syncs to Claude Code at the next session
  start.

## Background jobs and costs

Each save is enriched by a QStash job: the page is read, then Haiku writes a title, summary and
excerpt, applies the tags it is sure of (the rest wait as suggestions), and decides whether the save
is worth a research brief. Voyage embeds it for search by meaning. Vercel Cron runs the rest (UTC,
in `apps/web/vercel.json`): the daily sweep at 04:00 retries stuck saves and checks links, briefs
are batched at 05:00, the librarian runs Monday at 22:00, and lessons are written Tuesday and Friday
at 07:00.

Every model and embedding call goes through one gateway that records its tokens and cost and stops
calling once the day's cap is reached ($3 by default). A save made past the cap waits as pending
and is picked up the next day. Settings shows today's and this month's spend, and is where the cap,
the research-job limit, auto-tagging, your profile and research domains are set.

Clippings' data is per user and never shown to anyone else, but it is not end-to-end encrypted: the
server, Anthropic (enrichment, briefs, librarian, lessons) and Voyage (embeddings) see the text of
pages and notes, and so does any Claude client you connect.

## The browser extension

The Chrome extension saves the page you're on from its toolbar popup, with a note. It sends the
page's title and text as your browser shows it, so enrichment reads that instead of fetching the
page, and a site that turns servers away (a bot wall) still gets read. That text is stored with
the clipping and goes to the summarizer like a fetched page, including what you see on a page
you're signed in to; "Save link" sends only the address. Build it for
your Clippings, then load `apps/extension/.output/chrome-mv3` as an unpacked extension
(`chrome://extensions`, Developer mode, Load unpacked):

```bash
CLIPPINGS_ORIGIN=https://<your Clippings> pnpm --filter @clippings/extension build
```

Without `CLIPPINGS_ORIGIN` it talks to `http://localhost:3100`. CI zips a build for the
`CLIPPINGS_ORIGIN` repository variable as the `clippings-extension` artifact. A key in the
manifest pins the extension's id, which the web app trusts for sign-in; a Chrome Web Store
listing gets its own id, which goes in the web app's `EXTENSION_IDS`.

## Environments and releases

Work lands on `main`, which deploys to the development environment on every push. A release is a
pull request from `main` into `production`; merging it migrates the production database and
deploys:

```bash
gh pr create --base production --head main --title "Release: <what ships>"
```

Each PR gets its own Neon branch and Vercel preview. The one-time setup, secrets, backups and
restore test are in [`docs/deploy.md`](docs/deploy.md).

## Working on it

- Issues and triage labels: [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md),
  [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).
- How code is written: [`CODING_STANDARDS.md`](CODING_STANDARDS.md).
- Workflow rules for people and Claude Code: [`CLAUDE.md`](CLAUDE.md).
