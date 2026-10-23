# Coding standards

How code is written in this repo. Tooling already enforces formatting (oxfmt), lint (oxlint,
type-aware) and types (`tsc`); this file holds what none of them says.

## TypeScript

- `erasableSyntaxOnly` is on: use unions and `as const` objects where you would reach for `enum`,
  `namespace` or constructor parameter properties.
- Relative imports name the file with its `.ts` or `.tsx` extension (`allowImportingTsExtensions`);
  `import/extensions` enforces it. Packages (`@clippings/ui`) and CSS keep their usual specifiers.
- In `apps/web`, reach a file outside the current directory with the `@/` alias for the app root
  (`@/lib/auth/session.ts`) instead of `../`; `import/no-relative-parent-imports` enforces it.
  Siblings stay `./`.
- Dates and times go through `date-fns` (`@date-fns/utc` for UTC days), never the `Date` global:
  `constructNow()` for now, `parseISO` to parse, `addHours`, `differenceInDays` and the like for
  arithmetic, `format` to word one. `Date` stays a type (a column, a `Clock`). `no-restricted-globals`
  flags `new Date`, `Date.now` and friends; `formatIsoUtc` in `@clippings/shared` is the DTO's
  ISO string.
- TypeScript 7 is the native compiler, so there is no JS compiler API to import.
- Workspace packages are consumed as source (their `exports` point at `src/`): importing one needs
  no build step, and a new export is added to that package's `src/index.ts`.
- Shared zod schemas, DTO types and the URL normalizer live in `@clippings/shared`, so web and
  extension agree on them.

## UI

- Build UI from `@clippings/ui` and React Aria Components.
- The design-system lint is `error`-level: tokens and `typescale-*` utilities only, with no raw
  colors, arbitrary values or restyling of design-system components. Layout classes are allowed.
- Design-system components that wrap React Aria Components start with `"use client"`: the root
  layout imports `@clippings/ui` on the server, and RAC can't be evaluated there.
- A `"use server"` file exports only async functions. Constants and helpers it shares with
  components live in a separate module.
- `packages/ui/src/generated/` is output. Edit `src/theme/` and run
  `pnpm --filter @clippings/ui generate`; CI fails on a stale file.
- Paper & Glass: content sits on `paper` (cards, sheets, sections); only what floats above it uses
  glass: `glass` for the frame (rail, header, tab bar), `glass-float` for menus, dialogs, toasts and
  the command palette. Filled actions use `accent-fill`. The vocabulary is in
  `packages/ui/src/styles/theme.css`.
- Icons are `lucide-react` components (`<Bookmark className="size-5" />`), stroke 1.75 set
  globally; an icon-only button needs an `aria-label`. Design-system props that show an icon take
  the component (`icon={Palette}`).
- Motion: entrances settle (`ease-settle` or the paper spring), exits are quicker (`ease-exit`),
  only the saved check and a new tag pop. Multiply any travel distance by
  `--motion-spatial-factor`, which reduced motion sets to 0.
- After changing `apps/web/lib/pwa/app-icon.ts` or `launch-screen.ts` (the iOS launch screens), run
  `pnpm --filter @clippings/web build:app-icons`; `manifest.test.ts` fails on a stale image.

## Database

- `packages/db/src/schema.ts` is the schema, for every table including Better Auth's. Queries use
  Drizzle (`drizzle-orm/node-postgres` on the shared `pg` pool, so tests run on plain Postgres and
  Better Auth shares the pool).
- Change the schema, then `pnpm --filter @clippings/db generate`. Review the SQL it writes to
  `packages/db/drizzle/` before committing (edit it by hand when needed, for example to split a
  drop into expand/contract steps). `check:schema`, part of `lint`, fails when `schema.ts` and the
  migrations disagree.
- Never edit a migration that has been applied; add a new one. Drizzle records each by hash.
- Write expand/contract: the previous app version runs against the new schema during a deploy, and
  a rollback never undoes a migration.
- `pnpm --filter @clippings/db migrate` applies them on Neon's direct URL (`DATABASE_URL_DIRECT`);
  the app uses the pooled one. It takes an advisory lock and runs pending migrations in one
  transaction.
- Browse a local database with `pnpm --filter @clippings/db studio` (set `DATABASE_URL`).
- Better Auth's tables use its camelCase column names, quoted.
- Every row belongs to one user: scope every query by user id.

## Auth

`apps/web/proxy.ts` only checks that a session cookie exists. Server code that reads or writes user
data validates the session itself, as the `(app)` layout does.

An ast-grep rule (`ast-grep/rules/server-action-checks-session.yml`, run by `apps/web`'s `lint`)
requires every export of a `"use server"` file, types aside, to be `export async function` whose
first statement is `await requireUserId();`, `const userId = await requireUserId();` or
`const session = await getSession();` followed by an `if (!session …)`. `export { x }`,
`export … from` and `export const x = …` hide the check, so they fail too. An action that reads or
writes no user data (sign-in, sign-out, the consent page's redirects) opts out with a
`// ast-grep-ignore: server-action-checks-session` comment above it and a reason in the doc
comment.

## Tests

- Tests sit next to the code as `*.test.ts` and run with Vitest.
- Database tests need `TEST_DATABASE_URL` and are skipped without it. Each test gets a fresh
  temporary database from `createTempDatabase()`, so tests never share migration state.
- Test behavior through the module's public interface, not its internals. A good test fails on a
  real bug, not on a refactor. Don't test third parties (React Aria, Better Auth, Drizzle), only
  our use of them, and don't test what types, lint or the generated-file checks prove.
- Test each behavior once, at the lowest layer that can see it: data rules in the database
  service tests on real Postgres, pure logic as a table, and only a flow that crosses server and
  client end to end. An end-to-end test that finds a bug no lower test caught gets a lower test too.
- A change needs a test when it adds or alters:
  - a branch a user or attacker can reach: validation, error mapping, an auth check;
  - data access (every new query gets a "keeps users apart" case with a second user);
  - a state machine or time rule (use the injected clock);
  - the parsing or normalising of external input;
  - a flow that crosses server and client;
  - a bug fix (the test fails before the fix).
- No test for pure presentation (layout, class names, copy, motion, snapshots), a thin
  pass-through to a library, a constant, or anything reachable only by mocking what it calls.
  "Does it look right" is a manual check in the browser.
- No component-test layer and no jsdom: pull pure logic out of a client component and unit-test
  it. If an interaction can neither be reached end to end nor extracted, add a Vitest Browser Mode
  project for it.
- End-to-end specs live in `apps/e2e` and run with `pnpm e2e`, against a production build, local
  Postgres and the local fakes. A new page, server action, API route or extension flow gets a spec
  when its value is the path from browser to database: the sign-in gate, per-user access, a core
  flow, an instant shell. Seed through the database service and use the UI only for the step
  under test. Anything a service or unit test can show stays there.
- No coverage target; coverage is an occasional map of untested files, not a gate.
