## Next.js in apps/web

@AGENTS.md

- Reuse the dev server `apps/web/.next/dev/lock` names rather than starting another.
- An error's `Learn more` page reads as Markdown at its URL plus `.md`
  (`https://nextjs.org/docs/messages/<name>.md`); those pages are not bundled.
- `next dev` rewrites `AGENTS.md` only when it detects an agent, and a `preview_start` server
  doesn't. After a Next.js upgrade, run `next dev` once from your shell and commit the change to
  `AGENTS.md`.
- A prerender error in `next build` stops at the first route: rerun with
  `next build --debug-prerender` for source maps and every failing route.
