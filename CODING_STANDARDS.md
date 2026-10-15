# Coding standards

How code is written in this repo. Tooling already enforces formatting (oxfmt), lint (oxlint,
type-aware) and types (`tsc`); this file holds what none of them says.

## TypeScript

- `erasableSyntaxOnly` is on: use unions and `as const` objects where you would reach for `enum`,
  `namespace` or constructor parameter properties.
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

- Add a new numbered file to `packages/db/migrations/`. Applied files are recorded by name, so edit
  none of them.
- Write expand/contract: the previous app version runs against the new schema during a deploy, and
  a rollback never undoes a migration.
- Better Auth's tables use its camelCase column names, quoted.
- Every row belongs to one user: scope every query by user id.
- Migrations run on Neon's direct URL (`DATABASE_URL_DIRECT`); the app uses the pooled one.

## Auth

`apps/web/proxy.ts` only checks that a session cookie exists. Server code that reads or writes user
data validates the session itself, as the `(app)` layout does.

## Tests

- Tests sit next to the code as `*.test.ts` and run with Vitest.
- Database tests need `TEST_DATABASE_URL` and are skipped without it. Each test gets a fresh
  temporary database from `createTempDatabase()`, so tests never share migration state.
- Test behavior through the module's public interface, not its internals.
