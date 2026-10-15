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

Read [CODING_STANDARDS.md](CODING_STANDARDS.md) before you write, change or review code: TypeScript,
UI, database, auth and test rules live there.

### Branches and releases

`main` is the development environment and deploys on every push. `production` fast-forwards from
`main` and only the user moves it (`docs/deploy.md`): never force-push it or push to it unasked.
Secrets stay out of the repo: runtime secrets live in Vercel, deploy credentials in GitHub.

## Agent skills

### Issue tracker

Issues live in GitHub Issues, accessed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
