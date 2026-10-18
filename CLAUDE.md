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

### Skills

Skill descriptions load on every turn, so each skill gets a trigger here and no more. Call a skill
at its trigger, not before, and never for a one-line tweak.

| Skill | Call it when |
| --- | --- |
| `react-aria` | Writing or changing a component in `packages/ui` or one that uses React Aria Components |
| `vercel-react-best-practices` | Writing or reviewing `apps/web` data fetching, Server/Client Component splits or anything on a hot path. React Compiler is on, so skip its memoization advice |
| `web-design-guidelines` | Asked to review UI or accessibility, or before opening a PR whose main change is UI |
| `vercel-react-view-transitions` | Adding a page or element transition |
| `next-bundle-optimizer` | A route's client bundle or first load is slow or large |
| `next-cache-components-optimizer`, `next-partial-prefetching-optimizer` | Making a route or navigation instant or tuning prefetching (both are adopted: `cacheComponents`, `partialPrefetching`) |
| `better-auth-best-practices` | Changing Better Auth config, sessions, plugins or `proxy.ts` |
| `create-auth` | Adding a new sign-in method or provider, not for editing existing auth |
| `chrome-extensions` | Any work in `apps/extension`: manifest, permissions, content scripts, background, publishing |
| `modern-web-guidance` | Raw HTML, CSS or client JS outside `@clippings/ui` (the extension's pages, content scripts). Not for `apps/web` UI built from the design system, whatever its description says about running first |
| `recommend` | Hand-writing a utility (debounce, groupBy, chunk, …) once `es-toolkit` is in the catalog; add it there first |
| `tdd`, `diagnosing-bugs`, `research`, `domain-modeling` | As their descriptions say |
| `code-review`, `pr` | Before a PR (`code-review`), and to write its body (`pr`) |

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

## Agent skills

### Issue tracker

Issues live in GitHub Issues, accessed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
