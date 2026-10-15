# Clippings

A small, private, multi-user app for saving web pages ("clippings") and finding them again. Save
from the web app, a browser extension or Claude (MCP); the app reads each page in the background,
then you search by keyword and meaning. Sign-in is Google only, limited to an allowlist of emails,
and every user's data is private to them.

The v1 spec is [issue #1](https://github.com/lednhatkhanh/clippings/issues/1); the rest of the
open issues are its slices.

## Status

v1 is under construction. What exists today:

- Monorepo, CI, and the design system (Material 3 tokens, four palettes, light/dark/contrast).
- The web app shell with Google sign-in and an email allowlist.
- Environments on Vercel and Neon, instant-restore backups, and a database per PR.

Saving, enrichment, search, tags, the extension and the MCP server are open issues.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 7 · Tailwind 4 · React Aria Components ·
Better Auth · Postgres 18 on Neon · WXT (extension) · pnpm 12 + Turborepo · oxlint/oxfmt · Vitest.
Hosted on Vercel Hobby and Neon Launch. The reasoning is in
[`docs/research`](docs/research/2026-10-14-stack-and-design.md).

## Layout

```text
apps/
├── web/          Next.js app: UI, auth, API routes
└── extension/    WXT browser extension (scaffold)
packages/
├── ui/           Design system: generated theme, tokens, icons, illustrations
├── db/           Postgres pool, SQL migrations and the migration runner
├── shared/       Zod schemas, DTO types, URL normalizer (shared by web and extension)
└── config/       Shared tsconfig presets
docs/             Deploy runbook, research, agent docs
scripts/          CI helpers
```

## Getting started

You need Node 24 (see `.node-version`), pnpm 12 and a Postgres to point at (a local one, or a Neon
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
| `pnpm format`             | Rewrite files with oxfmt                                              |
| `pnpm format:check`       | Check formatting without writing                                      |
| `pnpm check:root`         | Format, lint and icon checks for root files, `scripts/` and workflows |
| `node scripts/run-checks.mjs` | What CI runs: all of the above, affected packages only when safe |

Database tests need a Postgres server and are skipped without one:

```bash
docker run --rm -d -e POSTGRES_PASSWORD=postgres -p 55432:5432 pgvector/pgvector:pg18
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres pnpm test
```

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
