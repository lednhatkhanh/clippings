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
- Add icons to the subset font with `pnpm --filter @clippings/ui build:icons`. `check:icons` fails
  on a name the font lacks.

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
fails an exported async function in a `"use server"` file unless its first statement awaits
`requireUserId()` or `getSession()`. A public action (sign-in, sign-out) opts out with an
`// ast-grep-ignore: server-action-checks-session` comment above it.

## Tests

- Tests sit next to the code as `*.test.ts` and run with Vitest.
- Database tests need `TEST_DATABASE_URL` and are skipped without it. Each test gets a fresh
  temporary database from `createTempDatabase()`, so tests never share migration state.
- Test behavior through the module's public interface, not its internals.
