## Working in this repo

Clippings is a pnpm + Turborepo monorepo. [README](README.md) has the layout and commands; the v1
spec is GitHub issue #1. `apps/web` has its own [CLAUDE.md](apps/web/CLAUDE.md) with the Next.js
rules.

### Checks

Before a PR, run `pnpm format`, then `pnpm check:root` and `node scripts/run-checks.mjs`: CI runs
the same two, and the second runs lint, format, typecheck, test and build. Work is green only when
both pass. `CLAUDE.md` and `docs/` are outside oxfmt.

### Verifying your work

Check what you can check yourself and ask the user only for what needs their accounts, real
credentials or taste. After every edit in `apps/web`, verify at runtime with the `next-dev-loop`
skill against the `web` dev server (`preview_start`, port 3100,
`NEXT_MCP_URL=http://localhost:3100/_next/mcp`) and show the user UI in the Browser pane. Run
database code against Postgres and `curl` routes; `docs/agents/verifying.md` has the local setup,
including fakes for QStash and Anthropic and a sign-in without Google. Report what you saw, and
name what you couldn't check; don't hand the user a checklist.

### Dependencies

Versions live only in the `catalog:` of `pnpm-workspace.yaml` (`catalogMode: strict`); a package's
`package.json` says `catalog:`. Workspace packages are consumed as TypeScript source (their
`exports` point at `src/`), so changing one needs no build step.

### Coding standards

@CODING_STANDARDS.md

### Branches and releases

`main` is the development environment and deploys on every push. `production` is released by a
pull request from `main` that the user merges (`docs/deploy.md`): never push to it or force-push it,
and don't merge a release PR unasked. Secrets stay out of the repo: runtime secrets live in Vercel,
deploy credentials in GitHub.

### Skills

Call a skill at its trigger; a one-line tweak needs none.

| Skill | Trigger |
| --- | --- |
| `react-aria` | Changing a component in `packages/ui` or one built on React Aria Components |
| `vercel-react-best-practices` | Writing or reviewing `apps/web` data fetching, Server/Client Component splits or hot paths (React Compiler is on: skip its memoization advice) |
| `web-design-guidelines` | A UI or accessibility review, or a PR whose main change is UI |
| `vercel-react-view-transitions` | Adding a page or element transition |
| `next-bundle-optimizer` | A route's client bundle or first load is large or slow |
| `next-cache-components-optimizer`, `next-partial-prefetching-optimizer` | Making a navigation instant or tuning prefetching (`cacheComponents` and `partialPrefetching` are on) |
| `better-auth-best-practices` | Changing Better Auth config, sessions, plugins or `proxy.ts` |
| `create-auth` | Adding a new sign-in method or provider |
| `chrome-extensions` | Any work in `apps/extension` |
| `modern-web-guidance` | Raw HTML, CSS or client JS outside `@clippings/ui`, such as the extension's pages and content scripts; skip it for `apps/web` UI despite its "run first" wording |
| `recommend` | Hand-writing a utility (debounce, groupBy, chunk) once `es-toolkit` is in the catalog |
| `code-review`, `pr` | Before a PR, and to write its body |

### Claude Code setup

- A hook formats each file you edit with oxfmt.
- Run pinned tools through `pnpm dlx`: `npx` fails here on the root `devEngines` check.
- `.claude/skills/` is vendored and pinned by `skills-lock.json`: change a skill upstream, not here.

## Agent skills

### Issue tracker

Issues live in GitHub Issues, accessed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
