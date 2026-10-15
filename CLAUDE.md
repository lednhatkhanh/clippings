## Working in this repo

Clippings is a pnpm + Turborepo monorepo: `apps/web` (Next.js), `apps/extension` (WXT), and
`packages/{ui,db,shared,config}`. [README](README.md) has the layout and commands; the v1 spec is
GitHub issue #1.

### Checks

Before a PR, run `pnpm format`, then `pnpm check:root` and `node scripts/run-checks.mjs`: CI runs
the same two, and the second runs lint, format, typecheck, test and build. Work is green only when
both pass. `CLAUDE.md` and `docs/` are outside oxfmt.

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

- `.claude/settings.json` allows the repo's check and read-only git/gh commands, asks before
  migrations and `vercel`, and denies force-push, pushes to `production`, reading `.env*` files and
  editing `packages/ui/src/generated/`. A hook formats each file you edit with oxfmt.
- `/check` runs the three check commands above and fixes what fails.
- `.claude/launch.json` defines the `web` dev server on port 3100; start it with `preview_start`.
- `.claude/skills/` is vendored and pinned by `skills-lock.json`: change a skill upstream, not here.
- Personal overrides go in `.claude/settings.local.json`, which is gitignored.

## Agent skills

### Issue tracker

Issues live in GitHub Issues, accessed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
