## Working in this repo

Clippings is a pnpm + Turborepo monorepo: `apps/web` (Next.js), `apps/extension` (WXT), and
`packages/{ui,db,shared,config}`. [README](README.md) has the layout and commands; the v1 spec is
GitHub issue #1.

### Checks

Before a PR, run `pnpm format`, then `pnpm check:root` and `node scripts/run-checks.mjs`: CI runs
the same two, and the second runs lint, format, typecheck, test and build. Work is green only when
both pass. `CLAUDE.md` and `docs/` are outside oxfmt.

### Verifying your work

Check what you can check yourself and ask the user only for what needs their accounts, real
credentials or taste. After every edit in `apps/web`, verify at runtime with the `next-dev-loop`
skill; show the user UI in the Browser pane (`preview_start`). Run database code against Postgres
and `curl` routes; `docs/agents/verifying.md` has the local setup, including fakes for QStash and
Anthropic and a sign-in without Google. Report what you saw, and name what you couldn't check;
don't hand the user a checklist.

### Next.js

@apps/web/AGENTS.md

- The dev server runs on port 3100: `NEXT_MCP_URL=http://localhost:3100/_next/mcp`. Reuse the one
  `apps/web/.next/dev/lock` names rather than starting another.
- An error's `Learn more` page reads as Markdown at its URL plus `.md`
  (`https://nextjs.org/docs/messages/<name>.md`); those pages are not bundled.
- `next dev` rewrites `apps/web/AGENTS.md` only when it detects an agent, and a `preview_start`
  server doesn't. After a Next.js upgrade, run `next dev` once from your shell and commit the
  change to `AGENTS.md`.
- A prerender error in `next build` stops at the first route: rerun with
  `next build --debug-prerender` for source maps and every failing route.

### Dependencies

Versions live only in the `catalog:` of `pnpm-workspace.yaml` (`catalogMode: strict`); a package's
`package.json` says `catalog:`. Workspace packages are consumed as TypeScript source (their
`exports` point at `src/`), so changing one needs no build step.

### Coding standards

@CODING_STANDARDS.md

### Branches and releases

`main` is the development environment and deploys on every push. `production` is released by a
pull request from `main` that the user merges (`docs/deploy.md`): never push to it or force-push it,
and don't merge a release PR unasked.
Secrets stay out of the repo: runtime secrets live in Vercel, deploy credentials in GitHub.

### Claude Code setup

- `.claude/settings.json` allows the repo's check and read-only git/gh commands and the dev loop
  (`agent-browser`, `curl` to `/_next/mcp`, the `next-devtools` MCP server), asks before
  migrations and `vercel`, and denies force-push, pushes to `production`, reading `.env*` files and
  editing `packages/ui/src/generated/`. A hook formats each file you edit with oxfmt.
- `/check` runs the three check commands above and fixes what fails.
- `.claude/launch.json` defines the `web` dev server on port 3100; start it with `preview_start`.
- `.mcp.json` adds `next-devtools` (the dev server's `/_next/mcp` as MCP tools). It runs through
  `pnpm dlx`, pinned: `npx` fails here on the root `devEngines` check.
- `.claude/skills/` is vendored and pinned by `skills-lock.json`: change a skill upstream, not here.
- Personal overrides go in `.claude/settings.local.json`, which is gitignored.

### Sub-agents

The main session runs on Opus 5.5 (`model` in `.claude/settings.json`) and keeps the judgement: the
design, the plan, reading results, talking to the user. It hands legwork to the agents in
`.claude/agents/`, which override the user-level ones of the same name:

| Agent         | Model         | Hand it                                                        |
| ------------- | ------------- | -------------------------------------------------------------- |
| `scout`       | Haiku 5.5     | one lookup: where is X, who calls Y                            |
| `Explore`     | Sonnet 5.5    | a broad sweep across packages                                  |
| `checker`     | Haiku 5.5     | the CI checks, returning only failures                         |
| `implementer` | Sonnet 5.5    | a planned change, with tests; several run in parallel          |
| `verifier`    | Sonnet 5.5    | runtime checks after an `apps/web` or `packages/db` change     |
| `reviewer`    | Opus 5.5      | auth, schema, migrations, per-user access, shared interfaces   |
| `Plan`        | Opus (main)   | a plan for a change across several packages                    |

Any other agent (`general-purpose`, `claude`) defaults to Sonnet 5.5 via `CLAUDE_CODE_SUBAGENT_MODEL`.
Do a task yourself when it is a few tool calls; a sub-agent pays off when its output would flood
your context or when independent pieces can run at once. Brief each one with the plan and file
pointers, since it starts without this conversation. `verifier` checks headless with
`agent-browser`; showing the user UI in the Browser pane (`preview_start`) stays with you.

## Agent skills

### Issue tracker

Issues live in GitHub Issues, accessed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
