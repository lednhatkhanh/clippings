# Clippings: stack and design research

Date: 2026-10-14 (versions checked against npm, nodejs.org and GitHub on that day). Baseline: the brief (CLIPPINGS_BRIEF.md). Where the brief and the user's requested changes conflict, the user's changes win.

**Summary.** The requested stack is current and fits together:
- Next.js 16.4.0 (React 19.3, Turbopack, Cache Components, Rust React Compiler)
- Node 24 LTS, pnpm 12, Turborepo 2.11
- Tailwind 4.3 + React Aria Components 1.22, SWR 2.5, WXT for the extension
- Cloud Run + Cloud SQL PG 18 (pgvector 0.8.5 + `pg_textsearch`, both available)
- Terraform google provider 8.7, GitHub Actions with Workload Identity Federation

Five things differ from what was assumed:
1. **`typescript@latest` is 7.0.2**, the native Go compiler, which has no JS API.
2. **Node 24 leaves Active LTS on 2026-10-20.**
3. **The MCP stack moved to SDK v2 and spec 2026-07-28**, and claude.ai connectors need **your own OAuth authorization server**.
4. **Next's `experimental.viewTransition` flag is gone.** `<ViewTransition>` is stable in React 19.3.
5. **Cloud Run's default billing throttles CPU after the response**, so `after()` can't replace Cloud Tasks.

"shadcn/lint" and "shadcn/cn" are real, but as the separate packages `@shadcn/lint` and `cn`.

## Recommended stack

| Area | Choice | Exact version (2026-10-14) | Source |
|---|---|---|---|
| Runtime | Node.js 24 LTS "Krypton" (plan to move to 26 after 2026-10-28) | 24.22.0 | [nodejs dist index](https://nodejs.org/dist/index.json), [Release schedule](https://github.com/nodejs/Release/blob/main/schedule.json) |
| Package manager | pnpm 12 + catalogs, pinned via `packageManager` + `devEngines.packageManager` | 12.11.2 (`latest`) | [npm](https://www.npmjs.com/package/pnpm), [v12.0.0](https://github.com/pnpm/pnpm/releases/tag/v12.0.0) |
| Monorepo | Turborepo, JIT internal packages | turbo 2.11.8 | [npm](https://www.npmjs.com/package/turbo), [internal packages](https://turborepo.dev/docs/core-concepts/internal-packages) |
| Framework | Next.js App Router, Turbopack, Cache Components, `typedRoutes`, `output: 'standalone'` | next 16.4.0 | [Next 16.4](https://nextjs.org/blog/next-16-4) |
| UI runtime | React + react-dom | 19.3.1 | [npm](https://www.npmjs.com/package/react), [React 19.3](https://react.dev/blog/2026/09/09/react-19-3) |
| React Compiler | Rust port only: `reactCompiler: true` + `experimental.turbopackRustReactCompiler: true` (experimental; no Babel, no `babel-plugin-react-compiler`) | built into next 16.4.0; upstream crate `react_compiler` 0.1.0 | [docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackRustReactCompiler), [crates](https://github.com/facebook/react/tree/main/compiler/crates) |
| Language | TypeScript, `strict`, `erasableSyntaxOnly` | 7.0.2 (fallback 6.0.3) | [npm](https://www.npmjs.com/package/typescript), [Next + TS 7](https://nextjs.org/docs/app/api-reference/config/typescript#using-typescript-7) |
| Components | React Aria Components directly (no shadcn components or registries) | 1.22.1 | [npm](https://www.npmjs.com/package/react-aria-components) |
| Styling | Tailwind CSS v4 via `@tailwindcss/postcss` | 4.3.3 | [npm](https://www.npmjs.com/package/tailwindcss) |
| Theme generation | `@material/material-color-utilities` (build-time script → `themes.css`) | 0.4.0 | [npm](https://www.npmjs.com/package/@material/material-color-utilities) |
| `cn()` ("shadcn/cn") | `cn` package, a drop-in clsx + tailwind-merge replacement from the shadcn team; extend for M3 type/radius classes | cn 0.4.0 | [shadcn-ui/cn](https://github.com/shadcn-ui/cn) |
| Design-system lint ("shadcn/lint") | `@shadcn/lint` as an oxlint `jsPlugins` entry | 0.2.1 | [shadcn-ui/lint](https://github.com/shadcn-ui/lint) |
| Client data | SWR (search, polling only) | 2.5.1 | [npm](https://www.npmjs.com/package/swr), [Next SWR guide](https://nextjs.org/docs/app/guides/client-side-data-fetching/swr) |
| Validation | zod | 4.6.7 | [npm](https://www.npmjs.com/package/zod) |
| Dates / utils | date-fns + @date-fns/tz; es-toolkit | 4.4.0 / 1.5.0; 1.52.0 | npm |
| MCP | `mcp-handler` 2 on `@modelcontextprotocol/server` 2 (spec 2026-07-28, stateless) | 2.3.0 / 2.3.1 | [mcp-handler](https://github.com/vercel/mcp-handler) |
| Auth + OAuth AS | Better Auth (Google provider, `mcp()` plugin, CIMD); allowlist of ~5 emails | better-auth 1.7.7 | [npm](https://www.npmjs.com/package/better-auth), [mcp plugin](https://www.better-auth.com/docs/plugins/mcp) |
| Extension | WXT (MV3, React, Vite) | wxt 0.21.4 (vite 8.3.4) | [npm](https://www.npmjs.com/package/wxt) |
| Lint | oxlint with `react`, `nextjs`, `jsx-a11y`, `import` plugins + native React Compiler rules + type-aware (oxlint-tsgolint, needs TS 7) | 1.88.0 / 7.0.2004 | [plugins](https://oxc.rs/docs/guide/usage/linter/plugins.html), [type-aware](https://oxc.rs/docs/guide/usage/linter/type-aware.html) |
| Format | oxfmt with `sortImports` + `sortTailwindcss` (beta) | 0.73.0 | [config reference](https://oxc.rs/docs/guide/usage/formatter/config-file-reference.html) |
| DB driver | `pg` + Cloud SQL Node connector (or Cloud Run's built-in Unix socket) | pg 8.23.1, @google-cloud/cloud-sql-connector 1.12.1 | npm |
| DB | Cloud SQL for PostgreSQL 18, Enterprise edition `db-f1-micro` (~$9/mo with 10 GiB SSD), pgvector + `pg_textsearch` (BM25) | PG 18.6, pgvector 0.8.5 | [extensions](https://docs.cloud.google.com/sql/docs/postgres/extensions), [pricing](https://cloud.google.com/sql/pricing) |
| Async jobs | Cloud Tasks → Route Handler (Cloud Run throttles CPU after the response, so `after()` is not enough) | @google-cloud/tasks 7.3.0 | [billing settings](https://docs.cloud.google.com/run/docs/configuring/billing-settings) |
| IaC | Terraform + google provider, GCS backend | terraform 1.16.6, provider 8.7.0 | [GitHub releases](https://github.com/hashicorp/terraform-provider-google/releases) |
| CI/CD | GitHub Actions + WIF, SHA-pinned; Cloud Run Job for migrations | checkout v7.0.1, setup-node v7.1.0, pnpm/action-setup v6.1.0, google-github-actions/auth v3.0.0, deploy-cloudrun v3.0.1, setup-gcloud v3.0.1, setup-terraform v4.0.1, docker/build-push-action v7.4.0 | §12 |
| Browsers | `last 2 Chrome versions, last 2 Firefox versions, last 2 Safari versions, last 2 iOS versions` | browserslist 4.29.3 → Chrome 153–154, Firefox 156–157, Safari/iOS 26.6–27 | §7 |

## 1. Material 3 paper theme

**How Material Theme Builder exports.**
- The GitHub repo was archived on 2026-07-23 and holds only a README ([repo](https://github.com/material-foundation/material-theme-builder)). These details come from the deployed app bundle ([app](https://material-foundation.github.io/material-theme-builder/)).
- Export targets: Android Views (XML), Jetpack Compose, Flutter, **Web (CSS)**, **Material Theme (JSON)**.
- **Web (CSS)** is a zip containing `css/light.css`, `light-mc.css`, `light-hc.css`, `dark.css`, `dark-mc.css`, `dark-hc.css`.
  - Each file is one class (`.light`, `.light-medium-contrast`, `.light-high-contrast`, `.dark`, …) holding 49 roles as `--md-sys-color-<kebab-role>: rgb(R G B)`.
  - Custom colors appear as `--md-extended-color-<name>-color|on-color|color-container|on-color-container`.
- **JSON** has these keys: `seed`, `coreColors`, `extendedColors`, `schemes` (light, light-medium-contrast, light-high-contrast, dark, …), and `palettes` (primary … neutral-variant, as tone→hex).
- Contrast levels are 0, 0.5 and 1.
- The bundle contains all variants (monochrome, neutral, tonalSpot, vibrant, expressive, content, fidelity, rainbow, fruitSalad). The visible UI offers only a "Color match" toggle, which appears to switch to Fidelity.

**Generating the themes in code: `@material/material-color-utilities` 0.4.0** (2026-01-21). Facts below come from the shipped `.d.ts`; see the [repo](https://github.com/material-foundation/material-color-utilities/tree/main/typescript).
- Constructor: `new SchemeTonalSpot(sourceColorHct, isDark, contrastLevel, specVersion?: '2021'|'2025', platform?: 'phone'|'watch')`. Fidelity, Content, Neutral, Vibrant and Expressive take the same arguments. The default spec is `'2021'`.
- `new DynamicScheme({ sourceColorHct, variant, contrastLevel, isDark, primaryPalette?, …, neutralPalette?, neutralVariantPalette? })` lets you **override any palette**.
- `MaterialDynamicColors` is now **instance-based**: `scheme.getArgb(scheme.colors.surfaceContainer())`. The old static properties are deprecated.
- `themeFromSourceColor` / `applyTheme` are legacy. They have no surface-container roles, so don't use them.
- **Packaging bug**: 0.4.0 fails to import in plain Node ESM because its imports have no `.js` extension ([issue #195](https://github.com/material-foundation/material-color-utilities/issues/195)). Run the generator with `tsx`.

**Neutral palette by variant, which decides how "paper" the surfaces look** (from `dynamic_scheme.js`):

| Variant | 2021 spec | 2025 spec, phone |
|---|---|---|
| Tonal Spot | 6 (neutral-variant 8) | 5 |
| Neutral | 2 | 1.4 |
| Fidelity / Content | seed chroma ÷ 8 | — |
| Expressive | 8 at hue + 15 | — |
| Vibrant | 10 | — |

- **Tonal Spot** always uses chroma 6 at the seed hue.
- **Fidelity / Content** go grey for a muted olive seed: chroma 22 ÷ 8 ≈ 2.75 gives `#fdf9f2`.
- **The 2025 spec** pushes light surfaces to tone 99, which is almost white. **Use spec `'2021'`.**

**Generated values** (spec 2021, contrast 0; produced by the research agent with the library). Surface family is surface / container-low / container / container-high.

| Theme (seed → setup) | Light surfaces | Dark surfaces | Primary L / D |
|---|---|---|---|
| Olive `#7C7A4E` → TS + neutral(88, 8) | `#fff8f2` `#fef2e0` `#f8ecda` `#f2e7d5` | `#171308` `#201b10` `#241f14` `#2f291d` | `#636117` / `#ceca75` |
| Yellow `#E6B800` → TS + neutral(85, 9) | `#fff8f2` `#fff2df` `#faecd8` `#f4e6d2` | `#181307` `#211b0e` `#251f12` `#30291c` | `#735c0c` / `#e3c46d` |
| Orange `#E07A2E` → TS + neutral(72, 9) | `#fff8f4` `#fff1e5` `#fdebd8` `#f8e5d3` | `#1a1208` `#231a0f` `#271e13` `#32281c` | `#8b4f25` / `#ffb689` |
| (control) Olive TS default, neutral(109, 6) | `#fdf9ec` `#f8f4e6` `#f2eee0` `#ece8db` | `#14140c` `#1c1c14` `#212018` `#2b2a22` | same |
| (control) Orange TS default, neutral(51, 6) | `#fff8f5` … `#f6e5dc` (peach/pink) | | |

- Keep neutral chroma **≤ 12**; above that the containers turn tan.
- Set neutral-variant chroma to the neutral chroma + 4.
- The override:
  ```ts
  const src = Hct.fromInt(argbFromHex('#7C7A4E'));
  const base = new SchemeTonalSpot(src, isDark, 0);
  const s = new DynamicScheme({ sourceColorHct: src, variant: Variant.TONAL_SPOT, contrastLevel: 0, isDark,
    primaryPalette: base.primaryPalette, secondaryPalette: base.secondaryPalette, tertiaryPalette: base.tertiaryPalette,
    neutralPalette: TonalPalette.fromHueAndChroma(88, 8), neutralVariantPalette: TonalPalette.fromHueAndChroma(88, 12) });
  ```

**Switching themes at runtime**
- The script writes `themes.css` with `:root[data-palette="olive|yellow|orange"] { --md-sys-color-<role>: light-dark(<light>, <dark>); }`.
- Add `:root { color-scheme: light dark }` and `[data-theme=light|dark] { color-scheme: … }` ([MDN light-dark()](https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark)).
- In Tailwind, `@theme inline { --color-*: initial; --color-surface: var(--md-sys-color-surface); … }`. `inline` is required "when defining theme variables that reference other variables" ([Tailwind theme](https://tailwindcss.com/docs/theme)).
- **Reference implementation**: Material Web 2.5.0 (2026-07-14) labs ships `@material/web/labs/gb/styles/tailwind.css`. It uses this exact pattern (`@theme inline` + `light-dark()`) and also maps shape tokens to `--radius-*` and typescale to utilities ([tailwind.scss](https://github.com/material-components/material-web/blob/main/labs/gb/styles/tailwind.scss), [v2.5.0](https://github.com/material-components/material-web/releases/tag/v2.5.0)). Material Web's README still says "maintenance mode", so copy the pattern rather than depend on the package.

**Shape, type, motion and state tokens**
- **Shape**: none 0, xs 4, sm 8, md 12, lg 16, **lg-increased 20**, xl 28, **xl-increased 32**, **xxl 48**, full. The bold steps are M3 Expressive additions ([corner radius scale](https://m3.material.io/styles/shape/corner-radius-scale)).
- **Type**: the M3 baseline scale (display L/M/S 57/45/36px … label S 11px), plus 15 Expressive "emphasized" styles ([type scale tokens](https://m3.material.io/styles/typography/type-scale-tokens)). Map display/headline to the serif (EB Garamond or Fraunces) and body/label to Roboto Flex.
- **Motion**: M3 Expressive spring tokens `md.sys.motion.spring.{fast|default|slow}.{spatial|effects}`, in two schemes (standard, expressive) ([motion specs](https://m3.material.io/styles/motion/overview/specs)). Web cubic-bezier equivalents:

  | Token | Curve | Duration |
  |---|---|---|
  | Expressive default spatial | `cubic-bezier(.38, 1.21, .22, 1)` | 500 ms |
  | Standard spatial | `cubic-bezier(.27, 1.06, .18, 1)` | 350 / 500 / 750 ms |
  | Effects | `cubic-bezier(.34, .80, .34, 1)` | 200 ms |

- **State layers**: hover 8%, focus 10%, pressed 10%, dragged 16% ([state layers](https://m3.material.io/foundations/interaction/states/state-layers)). Implement with React Aria `data-*` attributes + `color-mix()`.
- **Elevation**: M3 separates surfaces by **tonal** surface-container roles rather than shadows ([applying elevation](https://m3.material.io/styles/elevation/applying-elevation)), which suits the paper look.

**Paper grain**: an `feTurbulence type="fractalNoise" baseFrequency≈.85 numOctaves=3 stitchTiles="stitch"` SVG data URI, tiled on a `body::before` with `position: fixed; inset: 0; pointer-events: none; opacity: .04–.07; mix-blend-mode: multiply` (`soft-light`, ~.05 in dark mode) ([MDN feTurbulence](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feTurbulence), [mix-blend-mode](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/mix-blend-mode)). A small tile rasterizes once. Switch to a PNG tile only if profiling shows compositing cost.

**Illustrations**: M3 has no illustration guidance page; imagery appears only in blog posts. Use original flat inline-SVG spot illustrations whose fills are tokens (`fill="var(--md-sys-color-tertiary-container)"`, `currentColor`), so they re-tint for every palette and mode. Mark them `aria-hidden="true"`.

**Recommendation**
- Build-time `tsx` script on material-color-utilities 0.4.0: Tonal Spot, spec 2021, neutral override (hue 72–88, chroma 8–9). Seeds: olive `#7C7A4E`, yellow `#E6B800`, orange `#E07A2E`.
- Output `light-dark()` tokens per `data-palette`, mapped through `@theme inline`.
- Optionally generate contrast 0.5 and 1 variants later.

**Open questions**: final seed hexes (review the swatches above); whether the yellow theme should keep Fidelity's exact-seed `primaryContainer` (`#e6b800`). Fidelity turns tertiary blue, which may clash with the paper look.

## 2. Runtime + toolchain versions

Verified with `npm view` / nodejs.org / GitHub releases on 2026-10-14.

| Package | Latest stable | Notes | Source |
|---|---|---|---|
| next | 16.4.0 (2026-10-06) | canary 16.5.0-canary.10; `engines.node >=20.9.0`; peer `react ^19.0.0` | [npm](https://www.npmjs.com/package/next), [blog](https://nextjs.org/blog/next-16-4) |
| react / react-dom | 19.3.1 (published today) | 19.3.0 on 2026-09-09; Next 16.4 "ships with React 19.3" | [npm](https://www.npmjs.com/package/react), [Next 16.4](https://nextjs.org/blog/next-16-4) |
| Node.js | 24.22.0 "Krypton" (2026-10-14) | 24 = Active LTS **until 2026-10-20**, then Maintenance until 2028-04-30. Node 26 becomes Active LTS **2026-10-28** (26.12.0 today) | [dist index](https://nodejs.org/dist/index.json), [schedule.json](https://github.com/nodejs/Release/blob/main/schedule.json) |
| pnpm | 12.11.2 (`latest`); 12.13.0 on `next-12` | pnpm 12.0.0 released 2026-08-26; 11.0.0 on 2026-04-28 | [npm dist-tags](https://www.npmjs.com/package/pnpm), [v12.0.0 release](https://github.com/pnpm/pnpm/releases/tag/v12.0.0) |
| typescript | **7.0.2** (2026-07-08) | `typescript@latest` is now the native (Go) compiler; 6.0.3 is the last JS-based line; `next` tag 7.1.0-dev | [npm](https://www.npmjs.com/package/typescript), [typescript-go release](https://github.com/microsoft/typescript-go/releases) |
| turbo | 2.11.8 | | [npm](https://www.npmjs.com/package/turbo) |
| date-fns | 4.4.0 | `next` = 5.0.0-alpha.0 | [npm](https://www.npmjs.com/package/date-fns) |
| @date-fns/tz | 1.5.0 | `TZDate` / `tz()` helpers for v4 | [npm](https://www.npmjs.com/package/@date-fns/tz) |
| es-toolkit | 1.52.0 | | [npm](https://www.npmjs.com/package/es-toolkit) |
| swr | 2.5.1 | 2.6.0-beta.0 on `beta`; peer `react ^19.0.0` ok | [npm](https://www.npmjs.com/package/swr) |
| zod | 4.6.7 | | [npm](https://www.npmjs.com/package/zod) |

### Next.js 16.4 facts relevant here
- **Node 24**: minimum Node is 20.9 ([installation](https://nextjs.org/docs/app/getting-started/installation)), so 24 and 26 both work. One caveat: the experimental `turbopackPluginRuntimeStrategy: 'workerThreads'` falls back to child processes on Node ≥ 24.13.1 because of a Node bug ([16.4 blog](https://nextjs.org/blog/next-16-4)).
- **Turbopack** is the default for `next dev` and `next build`; `--webpack` opts out ([installation](https://nextjs.org/docs/app/getting-started/installation)).
- **React**: the App Router uses React canary builds bundled inside Next, but you should still declare `react`/`react-dom` ([installation](https://nextjs.org/docs/app/getting-started/installation)). 16.4 ships React 19.3, which includes "stable View Transitions and Fragment Refs" ([16.4 blog](https://nextjs.org/blog/next-16-4)).
- **Cache Components**: recommended for every app from 16.4. `create-next-app` now enables it by default. Enable it with `cacheComponents: true` + `partialPrefetching: true`. It becomes the default in Next 17 ([16.4 blog](https://nextjs.org/blog/next-16-4)).
- **typedRoutes**: top-level `typedRoutes: true` (no longer under `experimental`). It types `Link href` plus `router.push/replace/prefetch`. Route type helpers `PageProps` / `LayoutProps` / `RouteContext` are generated by `next dev|build|typegen` ([TypeScript config](https://nextjs.org/docs/app/api-reference/config/typescript)).
- **React Compiler**: `reactCompiler: true` (top-level). The **Rust port** is real: `experimental.turbopackRustReactCompiler: true` runs it natively inside Turbopack and needs no `babel-plugin-react-compiler` install. It is experimental, Turbopack-only, and arrived in 16.3. 16.4 cut its memory use by 30% and compile time by 15% ([option docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackRustReactCompiler), [16.4 blog](https://nextjs.org/blog/next-16-4)). `create-next-app` defaults to "No React Compiler" ([installation](https://nextjs.org/docs/app/getting-started/installation)).
- **TypeScript 7**: `next build` now runs the project-local `tsc` CLI by default (`experimental.useTypeScriptCli`, default on). This is how Next supports TS 7, which "does not currently provide the JavaScript compiler API". With the CLI checker you lose Next-specific error code frames ([useTypeScriptCli](https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli), [TS config](https://nextjs.org/docs/app/api-reference/config/typescript#using-typescript-7)).
- **Linting**: `next build` no longer lints, and `next lint` was removed in 16. `create-next-app` only offers ESLint or Biome; oxlint is not an option there ([installation](https://nextjs.org/docs/app/getting-started/installation)).
- **View transitions**: there is a guide at [/docs/app/guides/view-transitions](https://nextjs.org/docs/app/guides/view-transitions). The old `experimental.viewTransition` config page returns 404 today (see §8).

### pnpm 12: it exists and is stable
- pnpm 12.0.0 shipped 2026-08-26. `latest` = 12.11.2, and the `next-12` tag = 12.13.0 ([npm](https://www.npmjs.com/package/pnpm)). pnpm 11 still gets fixes (`latest-11` = 11.28.2).
- Breaking changes that matter here ([v12.0.0 notes](https://github.com/pnpm/pnpm/releases/tag/v12.0.0)):
  - Unknown keys in `pnpm-workspace.yaml` now fail with `ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS` when the project pins a pnpm version.
  - `--frozen-lockfile false` was removed; use `--no-frozen-lockfile`.
  - Lockfiles are now deterministic for dependency cycles.
- Inherited from v11 ([v11.0.0 notes](https://github.com/pnpm/pnpm/releases/tag/v11.0.0)):
  - pnpm requires Node 22+.
  - `minimumReleaseAge` defaults to 1 day: packages published in the last 24h are not resolved. **This matters for CI on the day of a release.**
  - `allowBuilds` replaces `onlyBuiltDependencies`.
  - `.npmrc` holds auth/registry only; every other setting lives in `pnpm-workspace.yaml`.
  - `pmOnFail` replaces `managePackageManagerVersions` and `packageManagerStrict*` ([cli settings](https://github.com/pnpm/pnpm.io/blob/main/docs/settings/cli.md)).
- `useNodeVersion` is gone. `pnpm migrate` converts it into a `devEngines.runtime` entry ([migration](https://github.com/pnpm/pnpm.io/blob/main/docs/migration.md)).

### `devEngines` and `.node-version`
- **`devEngines` (npm semantics)**:
  - Keys: `cpu`, `os`, `libc`, `runtime`, `packageManager`.
  - `onFail` is `warn` | `error` | `ignore`; the default behaves as `error`.
  - It is checked before `install`, `ci` and `run`.
  - npm does **not** download runtimes ([npm docs](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#devengines)).
- **`devEngines.runtime` (pnpm, since 10.14)**:
  - `{ "name": "node", "version": "^24.x", "onFail": "download" }`. pnpm resolves the range, records the exact version and checksum in the lockfile, and runs scripts with that Node.
  - Since 12.0, a bare `node` typed inside the project also follows the pin (the `globalShims` setting).
  - `runtimeOnFail` overrides `onFail` locally.
  - Sources: [package.json docs](https://pnpm.io/package_json), [v12.0.0 notes](https://github.com/pnpm/pnpm/releases/tag/v12.0.0).
- **`devEngines.packageManager` (pnpm, since 11.0)**: accepts ranges, e.g. `">=12.0.0 <13.0.0"`. The resolved version is stored in `pnpm-lock.yaml` (`packageManagerDependencies`) ([package.json docs](https://pnpm.io/package_json)).

| Tool | Reads `.node-version`? | Notes / source |
|---|---|---|
| pnpm 12 | Only for the global `node` shim (since 12.7), as a fallback when `package.json` declares no runtime | Precedence: `package.json` (`devEngines.runtime` / `engines.runtime`) > `.node-version` > `.nvmrc` ([12.7 release](https://github.com/pnpm/pnpm.io/blob/main/blog/releases/12.7.md)) |
| fnm | Yes (and `.nvmrc`) with `--use-on-cd` | `--resolve-engines` reads `engines.node` (experimental); devEngines isn't mentioned ([fnm config](https://github.com/Schniz/fnm/blob/master/docs/configuration.md)) |
| mise | Yes, but **opt-in** via `idiomatic_version_file_enable_tools = ["node"]` | Also reads `devEngines.runtime`, not `engines.node` ([mise node](https://mise.jdx.dev/lang/node.html)) |
| Volta | Not documented; **Volta is unmaintained** and recommends mise | [volta README](https://github.com/volta-cli/volta) |
| actions/setup-node | Yes: `node-version-file: .node-version` | With `package.json` it reads `volta.node`, then `devEngines.runtime`, then `engines.node` ([advanced usage](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md)) |
| GCP buildpacks | No (`engines.node` or `GOOGLE_NODEJS_VERSION`; pnpm version from `engines.pnpm`) | [buildpacks Node.js](https://docs.cloud.google.com/docs/buildpacks/nodejs). Not used here: we deploy a Dockerfile |

**Recommendation**
- Pin the runtime in two places that agree:
  - root `package.json` → `"devEngines": { "runtime": { "name": "node", "version": "24.22.0", "onFail": "download" }, "packageManager": { "name": "pnpm", "version": "^12.11.2", "onFail": "download" } }`
  - `.node-version` → `24.22.0`, for fnm/mise/editors and so `setup-node` can use `node-version-file`.
  - The Dockerfile `FROM node:24.22.0-...` must match.
- Keep `packageManager: "pnpm@12.11.2"` as well, because `pnpm/action-setup` and Corepack read it (see §12).
- Rule of thumb: an exact version in `.node-version`, and the same exact version in `devEngines.runtime`, so the two can't drift.
- **Node 24 vs 26**: start on 24.x. It is supported until 2028-04-30, and Cloud Run base images and every tool here support it. Plan a switch to 26 after 2026-10-28 (Active LTS). Not urgent for a personal app.
- **TypeScript**: use `typescript@7.0.2` for `tsc --noEmit` speed, keeping the caveats in §6 in mind (no JS API, so the Next IDE plugin and any type-aware tool that uses the TS JS API may not work). The safe fallback is `typescript@6.0.3`. Use `strict: true` and `erasableSyntaxOnly: true` (§6).
- date-fns 4.4 + @date-fns/tz 1.5 (`TZDate`) for display. es-toolkit 1.52 instead of lodash.

**Open questions**: Does the user want Node 26 from day one? (LTS on 2026-10-28; check Cloud Run / `node:26` image availability then.)

## 3. Infra on GCP

**Cloud SQL for PostgreSQL**
- **Version and edition**
  - **PG 18 is GA** (2025-11-20) and the **default** major (18.6) ([release notes](https://docs.cloud.google.com/sql/docs/postgres/release-notes), [db versions](https://docs.cloud.google.com/sql/docs/db-versions)).
  - ⚠ For PG 16+, an unset `edition` defaults to **Enterprise Plus**, which rejects shared-core tiers. **Set `edition = "ENTERPRISE"`** ([Terraform resource](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/sql_database_instance)).
- **Extensions**
  - **pgvector** is 0.8.5 on PG 13+. Enable it with `CREATE EXTENSION vector;` as a `cloudsqlsuperuser` on the primary; no flag is needed ([extensions](https://docs.cloud.google.com/sql/docs/postgres/extensions)).
  - **`pg_textsearch` (BM25) is supported**. It was added 2026-09-14 and needs **PG 17+** and maintenance version **R20260712.01_06** or later ([extensions](https://docs.cloud.google.com/sql/docs/postgres/extensions), [release notes](https://docs.cloud.google.com/sql/docs/postgres/release-notes)). The brief's plan works.
  - `pg_trgm` is supported. `pg_bigm` needs the flag `cloudsql.enable_pg_bigm`. `rum` and ParadeDB `pg_search` are not available.
  - You cannot install custom extensions.
  - Fallback if `pg_textsearch` misbehaves: a `tsvector` column with `setweight`, a GIN index, and `ts_rank_cd`.
- **Cheapest tier** (us-central1, [pricing](https://cloud.google.com/sql/pricing)):

  | Item | Price |
  |---|---|
  | `db-f1-micro` (shared, 0.6 GB) | $0.0105/h ≈ **$7.7/mo** |
  | `db-g1-small` (1.7 GB) | ≈ $25.6/mo |
  | Smallest dedicated (1 vCPU / 3.75 GB) | ≈ $49/mo |
  | SSD | ≈ $0.17/GiB-mo |
  | Backups | ≈ $0.08/GiB-mo |
  | Public IPv4 while idle | $0.01/h |

  - **f1-micro + 10 GiB SSD ≈ $9.4/mo plus backups.**
  - Shared-core is available on Enterprise edition only and is **not covered by the SLA** ([SLA](https://cloud.google.com/sql/sla)).
  - 0.6 GB RAM is tight for pgvector plus BM25 indexes. Start with f1-micro and move to g1-small if memory errors appear.
  - There is no scale-to-zero. Activation policy `NEVER` stops instance charges, but storage and IP are still billed ([start/stop](https://docs.cloud.google.com/sql/docs/postgres/start-stop-restart-instance)).
- **Connecting from Cloud Run**
  - Use the **built-in Cloud SQL connection** (`--add-cloudsql-instances` / a `cloud_sql_instance` volume in Terraform) over a Unix socket at `/cloudsql/PROJECT:REGION:INSTANCE`. The connection is encrypted, needs the `roles/cloudsql.client` role, and allows 100 connections per instance ([connect from Cloud Run](https://docs.cloud.google.com/sql/docs/postgres/connect-run)).
  - Alternative: `@google-cloud/cloud-sql-connector` 1.12.1 (supports IAM DB auth) ([repo](https://github.com/GoogleCloudPlatform/cloud-sql-nodejs-connector)).
  - Private IP needs Direct VPC egress plus PSC or PSA, which isn't worth it here.
  - The Cloud SQL Auth Proxy's current line is **v2.26.0**. v1.38.4 is legacy maintenance ([releases](https://github.com/GoogleCloudPlatform/cloud-sql-proxy/releases)).

**Cloud Run** ([pricing](https://cloud.google.com/run/pricing))
- **Request-based billing**:
  - Free each month: 180k vCPU-s, 360k GiB-s and 2M requests.
  - Idle instances that aren't minimum instances cost nothing, and `min_instance_count` defaults to 0.
- **Instance-based billing**: free each month 240k vCPU-s and 450k GiB-s. Set it with `--no-cpu-throttling` / `cpu_idle = false`, and it needs at least 512 MiB.
- Request timeout: maximum **3600 s**, default 300 s ([request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout)).
- ⚠ **With request-based billing, CPU is "only allocated during request processing"** ([billing settings](https://docs.cloud.google.com/run/docs/configuring/billing-settings)). After the response, access to CPU is "disabled or severely limited" ([tips](https://docs.cloud.google.com/run/docs/tips/general)).
  - **So Next.js `after()` work (fetch + Haiku + embedding) will stall on the default billing mode.**
  - The SIGTERM grace period is only 10 s, versus the 10–30 s drain Next recommends.

**Cloud Tasks vs `after()`**
- Cloud Tasks is free for the first 1M operations a month ([pricing](https://cloud.google.com/tasks/pricing)).
- It targets Cloud Run over HTTP with an OIDC token. The invoking SA needs `run.invoker`, and the Tasks service agent needs `iam.serviceAccountUser` on it. The `dispatchDeadline` is up to **30 min** ([HTTP target tasks](https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks)).
- The enrichment runs inside its own request, so CPU is allocated, with durable retries and backoff.
- **Verdict: keep Cloud Tasks** (the brief's choice). It costs $0 at this scale and fixes the CPU-throttling problem.
- `after()` is acceptable only with instance-based billing plus a re-sweep of `pending` rows, and loses work on shutdown.
- Use `after()` only to *enqueue* the task after responding, or enqueue synchronously, since it's a ~50 ms call.

**Terraform**
- terraform **1.16.6**; `hashicorp/google` **8.7.0** (2026-10-13) ([releases](https://github.com/hashicorp/terraform-provider-google/releases)).
- **v7→v8 breaking changes for these resources** ([v8 upgrade guide](https://github.com/hashicorp/terraform-provider-google/blob/main/website/docs/guides/version_8_upgrade.html.markdown)): only `google_secret_manager_secret_version` changes.
  - `secret_data_wo_version` is now a string.
  - `secret_data_wo` requires it.
- **Resources and the settings to remember**:
  - `google_sql_database_instance`: `edition = "ENTERPRISE"`, `tier = "db-f1-micro"`, `deletion_protection` (Terraform guard) and `settings.deletion_protection_enabled` (API guard).
  - `google_cloud_run_v2_service`: `deletion_protection` defaults to true; set `cpu_idle` explicitly when you add a `resources` block; secrets go through `env.value_source.secret_key_ref`.
  - `google_cloud_tasks_queue`: use `http_target` for queue-level OIDC.
  - `google_artifact_registry_repository` with `cleanup_policies` ([cleanup](https://docs.cloud.google.com/artifact-registry/docs/repositories/cleanup-policy)).
  - `google_iam_workload_identity_pool` / `_provider` (`attribute_condition` in CEL).
  - `google_service_account_iam_member` (`roles/iam.workloadIdentityUser`, `principalSet://…/attribute.repository_id/ID`, using the project **number**) ([WIF for pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)).
  - The GCS backend supports locking ([gcs backend](https://developer.hashicorp.com/terraform/language/backend/gcs)).

**Recommendation**
- One Cloud Run service on request-based billing with `min 0` / `max 2`.
- Cloud SQL Enterprise `db-f1-micro`, PG 18, pgvector 0.8.5 + `pg_textsearch`.
- The built-in Unix-socket connection.
- **Keep Cloud Tasks** for enrichment.
- Terraform 1.16 with google provider 8.7 and a GCS backend.

**Open questions**: europe-west1 prices weren't extracted (check the pricing page for your region); whether `pg_textsearch` needs `shared_preload_libraries` (none is listed).

## 4. Fastify vs API inside Next.js

| Concern | All-in Next.js (Route Handlers + Server Actions + `after()`) | Separate Fastify 5.12.7 service |
|---|---|---|
| REST for extension | `app/api/**/route.ts`. Web `Request`/`Response`, manual CORS headers + `OPTIONS` export | `@fastify/cors` 11.3.1, schema validation, hooks |
| Remote MCP | `mcp-handler` 2.3.0 returns a Web `(Request)=>Response` handler. Mount it in `app/api/mcp/route.ts` (or `app/mcp/route.ts`). It is framework-agnostic and not tied to Vercel ([README](https://github.com/vercel/mcp-handler)) | Official `@modelcontextprotocol/node` / `express` / `hono` 2.x adapters |
| OAuth AS for claude.ai | Better Auth `mcp()` plugin (OAuth 2.1 AS, RFC 8414 + RFC 9728 metadata, optional DCR, CIMD via `@better-auth/cimd`) ([docs](https://www.better-auth.com/docs/plugins/mcp)) | Same library works on Fastify |
| Cloud Tasks callback | `POST app/api/tasks/enrich/route.ts`. Verify the OIDC token audience/SA email | Same |
| Web UI data | Server Components + Server Actions, no API layer needed | Web app still needs an API client → duplicated contracts |
| Background work | `after()` is stable since 15.1 and "fully supported when self-hosting with `next start`" ([after](https://nextjs.org/docs/app/api-reference/functions/after), [self-hosting](https://nextjs.org/docs/app/guides/self-hosting#after)). On Cloud Run request-based billing, CPU is throttled after the response, so heavy work goes through Cloud Tasks → a Route Handler (§3) | Same constraint |
| Deploy | One `output: 'standalone'` image, one Cloud Run service | Two images and services, two cold starts, CORS between them |
| Cost (Cloud Run) | One service, scale to zero | About the same idle cost (both scale to zero) but double the config, logs, IAM, deploy steps |

MCP specifics, verified today:
- **Package rename**: MCP TypeScript SDK **v2** is split into `@modelcontextprotocol/server` 2.3.1, `/client` 2.3.1, `/core`, `/node` 2.1.1, `/express`, `/hono`. The legacy single package `@modelcontextprotocol/sdk` is still at 1.32.1 (npm). `mcp-handler@2` peers on `@modelcontextprotocol/server ^2` and `next >=13` (npm).
- **Spec version**: the current MCP spec is **2026-07-28** and is stateless: each message is an HTTP POST, and replies come as JSON or a request-scoped SSE stream ([transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)). `mcp-handler` 2.x serves it natively and falls back to stateless 2025-era Streamable HTTP. It no longer needs Redis; the HTTP+SSE transport was removed ([README](https://github.com/vercel/mcp-handler)). Stateless serving fits Cloud Run scale-to-zero and multiple instances.
- **Auth for claude.ai**:
  - Claude needs a `401` with `WWW-Authenticate: Bearer resource_metadata=...`, uses only the **first** `authorization_servers` entry, and needs PKCE S256.
  - Register the redirect `https://claude.ai/api/mcp/auth_callback`. For Claude Code, accept a loopback redirect on any port.
  - Refresh-token rotation, an `application/x-www-form-urlencoded` token endpoint, and responses under 10s.
  - Client identity is CIMD (needs `client_id_metadata_document_supported: true` **and** `"none"` in `token_endpoint_auth_methods_supported`), DCR, or a client ID/secret the user enters in the custom-connector dialog ([Claude connector auth](https://claude.com/docs/connectors/building/authentication)).
  - Google sign-in alone can't serve as the MCP authorization server, because Google has no DCR/CIMD. **You must run an authorization server.** Simplest: Better Auth inside the Next app, with Google as the social provider and the `mcp()` plugin as the AS.
- **Chrome extension**:
  - The extension service worker can fetch the API origin cross-origin when `host_permissions` lists it. Content scripts cannot ([Chrome docs](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)). Do fetches from the service worker.
  - Sign-in: `chrome.identity.launchWebAuthFlow` against the same AS, redirect `https://<extension-id>.chromiumapp.org/*` ([identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)). Store the access/refresh token and send `Authorization: Bearer`.
  - Still answer `OPTIONS` + `Access-Control-Allow-Origin: chrome-extension://<id>` in case requests come from extension pages. Do not use cookies cross-site.
- **Docker for Cloud Run**:
  - Use `output: 'standalone'` ([output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)).
  - For multiple instances or rolling deploys: set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` at **build** time, `deploymentId` for version-skew protection, and `generateBuildId` from the git SHA ([self-hosting](https://nextjs.org/docs/app/guides/self-hosting)).
  - The default cache is in memory per instance and not shared. At ~5 users with max-instances 1–2 that's acceptable. Otherwise add `'use cache: remote'` + a cache handler.
  - Env vars are server-side and read at runtime under dynamic rendering; `NEXT_PUBLIC_*` are inlined at build time.

**Recommendation**: Go all-in on Next.js with one Cloud Run service. Route Handlers for `/api/*` (extension + Cloud Tasks callback + health), Server Actions for web-app mutations, `mcp-handler@2` at `/mcp`, and Better Auth (Google provider + `mcp()` AS + CIMD) for both the web session and OAuth tokens for claude.ai / Claude Code / the extension. Fastify adds nothing this app needs.

**Open questions**: Better Auth vs Firebase Auth / Identity Platform (the brief's choice). Identity Platform can't be the MCP authorization server, so you'd need an AS anyway. Better Auth covers both and stores sessions in the same Postgres. Check that the custom-connector flow works end-to-end before M4.

## 5. Monorepo with Turborepo

Needed? **Yes, lightly.** There are two deployables (Next app, extension) sharing zod schemas, types and UI tokens. pnpm workspaces alone would work. Turborepo 2.11.8 adds task graph caching (`lint`, `typecheck`, `build`) and `--affected` for CI, at the cost of one `turbo.json`.

Proposed layout:
```
apps/
  web/          Next.js 16.4 (UI + /api + /mcp + auth), output: 'standalone'
  extension/    WXT 0.21 MV3 extension (React)
packages/
  shared/       zod schemas, DTO types, URL normalizer (JIT TS package)
  db/           Drizzle/SQL schema, migrations, query helpers (server-only)
  ui/           React Aria components + Tailwind tokens/themes.css (JIT)
  themes/       (optional, or inside ui) M3 token generator script → themes.css
  config/       tsconfig bases, oxlint/oxfmt configs
infra/          Terraform
```
- **Internal packages**: use **Just-in-Time** packages (`exports` pointing at `./src/*.ts(x)`, no build step). Both consumers (Turbopack, Vite in WXT) transpile TS. Trade-offs: no `compilerOptions.paths` inside packages (use subpath imports), and type errors surface in consumers ([Turborepo internal packages](https://turborepo.dev/docs/core-concepts/internal-packages)).
- **`transpilePackages`**: not needed for workspace packages. "Turbopack transpiles workspace packages ... automatically under both routers" ([transpilePackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages)).
- **Catalogs**: put shared versions (react, react-dom, typescript, zod, tailwindcss, react-aria-components) in `pnpm-workspace.yaml` `catalog:` and reference them as `"react": "catalog:"`. `catalogMode: strict` stops drift. `catalogPrune` (11.22+) removes unused entries ([catalogs](https://pnpm.io/catalogs)).
- **Standalone + monorepo**: set `outputFileTracingRoot` to the repo root so traced files from `packages/*` land in `.next/standalone` (check [output docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)). The Docker build uses `turbo prune web --docker`.

Chrome extension build tool:

| Option | Version | Status | Notes |
|---|---|---|---|
| **WXT** | 0.21.4 (2026-08-11); repo active (commit 2026-10-13) | pre-1.0 | Vite-based (peer `vite ^6.3.4 \|\| ^7 \|\| ^8`), Node ≥22, file-based entrypoints, MV3 manifest generation, HMR, `wxt zip`, `wxt submit` via `publish-browser-extension` (npm) |
| CRXJS `@crxjs/vite-plugin` | 3.0.0 (2026-09-24) | stable major | A plain Vite plugin; less scaffolding; you write `manifest.json` |
| Plain Vite 8.3.4 | | | Manual multi-entry config |

**Recommendation**: Turborepo + pnpm catalogs, JIT internal packages, WXT for the extension (zip + store-submit tooling built in, Vite 8 compatible). Keep the extension thin: popup + service worker + context menu calling the `/api` with a bearer token.

## 6. Lint, format and compiler tooling

**React Compiler: Rust port only (decided; Babel is never used)**
- **What and where**:
  - The native port lives in `facebook/react` at [`compiler/crates/`](https://github.com/facebook/react/tree/main/compiler/crates): `react_compiler` plus `_hir`, `_inference`, `_validation`, `_ssa`, `_lowering`, `_reactive_scopes`, `_diagnostics`, and others.
  - The crate [`react_compiler`](https://crates.io/crates/react_compiler) **0.1.0** was published 2026-08-31.
  - **There is no npm package to install**: Next.js compiles the port into its native Turbopack binary (`@next/swc-*`).
  - Status: **experimental** in Next ("released as experimental to gather feedback before it becomes the default") ([option docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackRustReactCompiler)).
  - Upstream parity snapshot in [`compiler/crates/TODO.md`](https://github.com/facebook/react/blob/main/compiler/crates/TODO.md): the **SWC frontend passes 1786/1802** fixtures. The 16 failures include real SWC bugs, e.g. lone-surrogate strings, and a bail-out on very many reactive scopes.
- **Next.js wiring** (needs **Next ≥ 16.3**, where the flag landed; use 16.4.0 for the 30% memory / 15% compile-time cuts — [16.4 blog](https://nextjs.org/blog/next-16-4)):
  ```ts
  // next.config.ts
  reactCompiler: { compilationMode: 'infer' /* default */, panicThreshold: 'none',
                   environment: { enablePreserveExistingMemoizationGuarantees: true } },
  experimental: { turbopackRustReactCompiler: true },
  ```
  - Guards confirmed in `next@16.4.0` `dist/server/config.js`:
    - the flag throws unless running under Turbopack ("only supported with Turbopack");
    - it throws unless `reactCompiler` is enabled.
  - Turbopack is the default for `next dev` and `next build`, so the flag works on our setup (Node 24, Turbopack).
  - It needs the **native** SWC bindings. The WASM fallback bindings stub out compiler support (`dist/build/swc/index.js`). Use the glibc or musl `@next/swc-linux-*` binaries, which pnpm installs automatically for the Docker build platform.
  - `compilationMode: 'annotation'` compiles only functions with `'use memo'`; `'use no memo'` opts out ([reactCompiler](https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler)). Recommendation: default `infer` mode, and use `'use no memo'` on any component that hits a Rust-port bug.
  - Set `enablePreserveExistingMemoizationGuarantees` explicitly, because "defaults may differ between compiler implementations" (same page).
  - `panicThreshold` was ignored by the Rust path until [#99455](https://github.com/vercel/next.js/issues/99455) was closed (2026-09-30). Confirm it is honoured in 16.4.
- **Proving Babel isn't in the build**:
  1. Do **not** install `babel-plugin-react-compiler`. Fail CI if `pnpm why --filter web babel-plugin-react-compiler` finds it (a `scripts/assert-no-babel` step). `@babel/core` can still arrive transitively through unrelated tools; that's harmless as long as nothing configures Babel for `apps/web`.
  2. Keep no `babel.config.*` / `.babelrc` anywhere. Next switches the whole app to Babel when one exists.
  3. Never pass `--webpack`. The webpack path only has the Babel compiler loader (`dist/build/webpack-config.js` → `getReactCompilerLoader`), and the Rust flag throws there.
  4. Check that the compiler actually ran: production chunks for client components import `react/compiler-runtime` (`c as _c` / `_c(N)` memo-cache calls). Grep `.next/static/chunks` for `compiler-runtime` in a CI smoke step. With no Babel plugin installed, those can only come from the Rust port.
  5. React DevTools shows the "Memo ✨" badge on compiled components.
- **Lint and diagnostics without eslint-plugin-react-hooks**: oxlint ships the compiler-derived rules **natively** in its `react` plugin, using its own vendored Rust port of the compiler ([oxc blog](https://oxc.rs/blog/2026-08-18-react-compiler-support), [rule example](https://oxc.rs/docs/guide/usage/linter/rules/react/purity.html)):
  - `react/purity`, `refs`, `set-state-in-render`, `set-state-in-effect`, `immutability`, `static-components`, `preserve-manual-memoization`, `use-memo`, `incompatible-library`, `globals`, `error-boundaries`, `unsupported-syntax`
  - plus `react/rules-of-hooks` and `react/exhaustive-deps`
  - The plugins page calls them experimental and off by default, so enable each one explicitly ([plugins](https://oxc.rs/docs/guide/usage/linter/plugins.html)).
  - **The build compiler and the lint compiler are separate Rust ports** (Next's vs oxc's), so a lint pass does not guarantee the build compiled a component.
  - Build-time bail-outs show up only as missing memoization: Next prints no per-file compiler report. Use `'use no memo'` deliberately and the React DevTools badge to check.
- **Known limitations** (open issues as of 2026-10-14, all on `vercel/next.js`):
  - [#100085](https://github.com/vercel/next.js/issues/100085): the Rust path drops dev options the other path sets. Fast Refresh memo-cache reset, anonymous function names and TS source type are missing, so **dev HMR may keep stale memoized values**. A full reload fixes it.
  - [#98820](https://github.com/vercel/next.js/issues/98820): a lazy `useState` initializer throws a TDZ error when helper functions are declared later in the same hook. Workaround: declare helpers above, or `'use no memo'`.
  - [#95557](https://github.com/vercel/next.js/issues/95557): a shadowed local named like an intrinsic tag (`const table`) renders `<table_0>`, causing a hydration error. Avoid shadowing intrinsic names.
  - [#97392](https://github.com/vercel/next.js/issues/97392): inaccurate source maps for hoisted expressions.
  - [#99580](https://github.com/vercel/next.js/issues/99580): `swcPlugins` run after the compiler. Irrelevant here.
- **Extension (WXT/Vite)**: Next's flag doesn't apply there. The only Rust option is oxc's port through `@vitejs/plugin-react` ≥ 6.1 `compiler: true`, which is experimental ([oxc blog](https://oxc.rs/blog/2026-08-18-react-compiler-support)). Otherwise leave the compiler off for the tiny popup.
- **Verdict**: **it runs in our setup today** (Next 16.4.0 + Turbopack + Node 24 + React 19.3). Nothing is missing, but it is experimental with the bugs above. Watch #100085 in dev, and keep `'use no memo'` as the escape hatch.

**oxlint 1.88.0**
- Plugins on by default: `eslint`, `typescript`, `unicorn`, `oxc`. Opt-in: `react`, `react-perf`, `nextjs`, `jsx-a11y`, `import`, `promise`, `node`, `vitest`, and others ([plugins](https://oxc.rs/docs/guide/usage/linter/plugins.html)).
- Hooks rules live under `react/*` (`react/rules-of-hooks`, `react/exhaustive-deps`).
- React Compiler-powered rules are native and need no JS plugin: `react/purity` (since 1.79), `refs`, `set-state-in-render`, `set-state-in-effect`, `immutability`, `static-components`, and more ([rule](https://oxc.rs/docs/guide/usage/linter/rules/react/purity.html), [source](https://github.com/oxc-project/oxc/tree/main/crates/oxc_linter/src/rules/react)).
  - The docs disagree on their status: the plugins page footnote says "experimental and off by default", while the blog puts them in `correctness`. Enable them explicitly.
- **Type-aware linting**: `oxlint --type-aware` or `"options": { "typeAware": true }`.
  - Needs `oxlint-tsgolint` 7.0.2004 and **TypeScript ≥ 7.0**. `baseUrl` is unsupported.
  - Covers 59 of 61 typescript-eslint type-aware rules ([type-aware](https://oxc.rs/docs/guide/usage/linter/type-aware.html)).
- `jsPlugins` is **alpha** and offers an ESLint v9-compatible API. It isn't needed here ([js-plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html)).
- Config lives in `.oxlintrc.json` or `oxlint.config.ts` (`defineConfig`).
- `next lint` is removed in Next 16, so oxlint runs directly from turbo tasks ([v16 upgrade](https://nextjs.org/docs/app/guides/upgrading/version-16)).

**oxfmt 0.73.0**
- **Beta** since 2026-02-24, with no stable announcement yet. It claims 100% of Prettier's JS/TS conformance tests ([beta post](https://oxc.rs/blog/2026-02-24-oxfmt-beta)) and is "compatible with Prettier v3.9.9 for many configurations" ([migrate](https://oxc.rs/docs/guide/usage/formatter/migrate-from-prettier.html)).
- Built-in options ([reference](https://oxc.rs/docs/guide/usage/formatter/config-file-reference.html)):
  - `sortImports`: off by default.
  - **`sortTailwindcss`**: off by default. Based on prettier-plugin-tailwindcss; takes `stylesheet`, `functions` (add `cn`) and `attributes`.
  - `sortPackageJson`: on by default.
- CLI: `oxfmt --check`. Prettier plugins are not supported, but oxfmt needs none for this stack.
- Fallback if the beta bites: Prettier 3.9.10 + prettier-plugin-tailwindcss 0.8.1.

**"shadcn/lint" and "shadcn/cn": what exists (scope: only these two; no shadcn components or registries)**
- **Neither is a subpath of the `shadcn` package.** `shadcn@4.21.5` exports `.`, `./mcp`, `./icons`, `./utils`, `./preset`, `./schema`, `./registry` and `./tailwind.css` (`npm view shadcn exports`). `shadcn/utils` contains codemod transforms, not `cn`. The CLI has no `lint` command. Both tools exist as **separate packages from the shadcn team**:

| What the user calls it | Real package | Version (2026-10-14) | Import | Source |
|---|---|---|---|---|
| `shadcn/lint` | **`@shadcn/lint`** | 0.2.1 (first release 2026-09-14, so pre-1.0) | `.oxlintrc.json` → `"jsPlugins": ["@shadcn/lint"]`; rules `shadcn/*` | [shadcn-ui/lint](https://github.com/shadcn-ui/lint), [npm](https://www.npmjs.com/package/@shadcn/lint) |
| `shadcn/cn` | **`cn`** | 0.4.0 (2026-09-22) | `import { cn } from "cn"`; `createCn` from `"cn/config"` | [shadcn-ui/cn](https://github.com/shadcn-ui/cn), [npm](https://www.npmjs.com/package/cn) |

**`@shadcn/lint`**
- "An agent-first linter for Tailwind design systems". It "works with Tailwind v4 projects (**shadcn/ui not required**)" and is available for ESLint (≥ 9.30) **and Oxlint (≥ 1.80, through `jsPlugins`)** ([README](https://github.com/shadcn-ui/lint)).
- Rules:

  | Rule | Catches |
  |---|---|
  | `no-restyle` | `className` overrides on design-system components; per-component `contracts` set what's allowed |
  | `no-raw-colors` | e.g. `bg-pink-500` instead of theme tokens |
  | `no-arbitrary-values` | e.g. `p-[13px]` |
  | `no-inline-styles` | `style={{…}}` and `<style>` |
  | `no-unknown-classes` | classes Tailwind can't generate |
  | `require-static-classes` | e.g. `` `bg-${c}` `` |

  Each error suggests a fix drawn from your components, variants and theme.
- **Without shadcn components**: configure `settings.shadcn.ui` / `componentImports` (e.g. `"^@clippings/ui(/|$)"`) and `themeImports` (e.g. `"^@clippings/ui/"`, so the M3 `@theme` tokens in `packages/ui/themes.css` count as vocabulary). It recognizes `cn`, `cva`, `tv`, `clsx`, `twMerge` by default.
- **Monorepo**: the README documents the root `.oxlintrc.json` with `"ui": "@workspace/ui/components"`.
- **Why it fits Clippings**: `no-raw-colors` + `no-arbitrary-values` enforce the brief's "**No hardcoded colors**" rule, so an agent writing `bg-amber-100` instead of `bg-surface-container` gets a corrective message.
- **React Aria Components caveats** (inferred, not tested):
  - RAC's `className={({isHovered}) => …}` render functions are not in the documented "what is read" table. Prefer static strings with Tailwind v4's `data-[hovered]:` / `data-hovered:` variants against RAC's `data-*` attributes. Those are plain static classes, which the linter reads and `require-static-classes` accepts.
  - Component identity is the export name, so RAC wrappers exported from `packages/ui` get `no-restyle` contracts.
- **Package facts** (from [packages/lint/package.json](https://github.com/shadcn-ui/lint/blob/main/packages/lint/package.json)): ESM, Node ≥ 20.19, depends on `cn` 0.4.0. `eslint` / `@typescript-eslint/parser` are *optional* peers, so **oxlint alone is enough**. It is a plugin only, with no standalone CLI (`bin` is null).
- **Theme discovery**: without `components.json` it finds the stylesheet that imports Tailwind, follows its `@import`s, and reads the `--color-*` declarations in `@theme` / `@theme inline`. The M3 mapping in §1 (`--color-surface: var(--md-sys-color-surface)`) therefore becomes the allowed palette, and Tailwind's built-in palette does not count. `no-unknown-classes` asks the installed Tailwind v4 (in a worker thread) whether each class generates CSS ([how it works](https://github.com/shadcn-ui/lint/blob/main/docs/how-it-works.md)).
- **Install and config**: `pnpm add -D @shadcn/lint` at the root, then in `.oxlintrc.json`:
  ```json
  { "jsPlugins": ["@shadcn/lint"],
    "settings": { "shadcn": { "ui": "@clippings/ui", "themeImports": ["^@clippings/ui/"] } },
    "rules": { "shadcn/no-raw-colors": "error", "shadcn/no-arbitrary-values": "error",
               "shadcn/no-inline-styles": "warn", "shadcn/no-unknown-classes": "error",
               "shadcn/require-static-classes": "error", "shadcn/no-restyle": ["error", { "allow": ["layout"] }] } }
  ```
  `themeImports` is needed because `packages/ui/themes.css` is imported as a workspace package. Add the `note` setting to point agents at `docs/design/`.
- **Overlap with oxlint/oxfmt**: none that conflicts. `@shadcn/lint` doesn't sort or format. Class ordering stays with oxfmt `sortTailwindcss` and import order with oxfmt `sortImports`. Its rules don't duplicate any native oxlint rule; oxlint has no Tailwind rules.
- **Oxlint fit**: it runs as an oxlint **JS plugin**. jsPlugins is **alpha** in oxlint ([js-plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html)), so expect slower runs than native rules. Formatting is unaffected.

**`cn`**
- A new engine that "replaces `tailwind-merge` and `clsx`. Same APIs. Full parity." It is claimed ~30× faster and verified by "356,000 differential tests" against tailwind-merge. Zero dependencies, 26 KB minified. "**You don't need shadcn/ui.**" Supports Tailwind v4 only, like tailwind-merge v3 ([README](https://github.com/shadcn-ui/cn)).
- API:
  - `cn`, `twMerge`, `twJoin`, `clsx` from `"cn"`.
  - `createCn` / `extendTailwindMerge` from `"cn/config"`.
  - `cn/lite` (strings-only join).
  - Optional build-time tables via `cn/next` (`withCn(nextConfig)`) or `cn/vite`.
- **With React Aria + Tailwind v4 + M3 tokens** (inferred from tailwind-merge semantics, which `cn` claims parity with; not tested):
  - Variant prefixes such as `data-hovered:` / `data-[pressed]:` / `dark:` are handled generically. A conflict is resolved only between classes with the same variant set, so `bg-surface data-hovered:bg-surface-container-high` is kept intact.
  - Custom **color** tokens (`bg-surface-container`, `text-on-surface`) are accepted as colors.
  - **Watch custom non-color tokens that share a prefix**: an M3 type utility such as `text-body-large` would be classed as a text *color* and wrongly merged against `text-on-surface`. The same applies to custom radius names such as `rounded-xl-increased`.
  - Fix: register them once, e.g. `createCn({ extend: { classGroups: { "font-size": [{ text: ["display-lg", "body-lg", …] }] } } })` (or `extend.theme`), and export that `cn` from `packages/ui`. Alternatively, name typescale utilities without the `text-` prefix (e.g. `@utility typescale-body-lg`, as Material Web's labs Tailwind sheet does) to avoid the clash.
- **How `cn` differs from clsx + tailwind-merge**:
  - One package (`cn`, zero dependencies) instead of two plus a local wrapper.
  - Same outputs (tested differentially) but a different engine: it caches repeated call sequences, which accounts for the 30× / 37× benchmark claims.
  - Optional build-time compiled tables (`cn build`, `withCn` for Next) for a smaller bundle. With `cn build`, dynamically built class names need `--safelist`.
  - `experimentalParseClassName` is not supported.
  - Node ≥ 22 for its CLI.
- **Install**: `pnpm add cn`, then in `packages/ui/src/cn.ts`: `export const cn = createCn({ extend: { classGroups: { … } } })` from `"cn/config"`. Use it everywhere. Skip `withCn` at first; it's an optimization.
- **Fit with oxlint/oxfmt**: oxfmt's `sortTailwindcss.functions: ["cn"]` sorts classes inside `cn()` calls. `@shadcn/lint` reads `cn()` arguments by default. No conflict.

**Recommendation**:
- Use `cn` 0.4.0 (via a `createCn` instance with the M3 typescale/radius class groups) as the only class helper; drop clsx + tailwind-merge.
- Add `@shadcn/lint` 0.2.1 as an oxlint jsPlugin with `no-raw-colors`, `no-arbitrary-values`, `no-inline-styles`, `no-unknown-classes`, `require-static-classes`, and `no-restyle` with `allow: ["layout"]` for `@clippings/ui` components.
- Both are young (September 2026), so pin exact versions.

**TypeScript 7.0.2**
- A native Go port. Builds are 8–12× faster, and the binary is still `tsc` ([announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)).
- `strict` has defaulted to true since 6.0 ([TS 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)).
- **Hard errors in 7.0**: `baseUrl`, `moduleResolution node/node10/classic`, `target es5`, `esModuleInterop:false`, and others.
  - Note: Next's docs still show `baseUrl` for path aliases. Use `paths` without `baseUrl`, or subpath imports.
- **No JS API in 7.0** (planned for 7.1). Next works around this with the `tsc` CLI. `@typescript/typescript6` (`tsc6`) is available for tools that need the old API.
- **`erasableSyntaxOnly`** ([TS 5.8 notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html)) forbids:
  - `enum`
  - namespaces with runtime code
  - class parameter properties
  - `import x = require()` / `import X = ns.X`
  - `export =`
  Pair it with `verbatimModuleSyntax`.

**Recommendation**
- **Lint**: oxlint with `react`, `nextjs`, `jsx-a11y`, `import`, plus `categories.correctness: error`, the compiler rules enabled explicitly, and `typeAware: true`.
- **Format**: oxfmt with `sortImports`, and `sortTailwindcss` with `functions: ["cn"]`.
- **Compiler**: `reactCompiler` + `experimental.turbopackRustReactCompiler`, no Babel anywhere, CI asserts there is no `babel-plugin-react-compiler` and checks for `compiler-runtime` in the output.
- **TypeScript**: TS 7 with `strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, and no `baseUrl`.
- **`cn()`**: the `cn` package with a `createCn` extension for M3 classes.
- **Design-system lint**: `@shadcn/lint` as an oxlint jsPlugin.

**Open questions**: does the Next TS IDE plugin load under TS 7's native language server? Probably not (unverified). If editor-side Next diagnostics matter, keep `typescript@6.0.3` for the editor via `typescript.tsdk`.

## 7. Browser support: last 2 Chrome, Firefox, Safari

- **Query**: `last 2 Chrome versions, last 2 Firefox versions, last 2 Safari versions, last 2 iOS versions`.
  - It is valid syntax ([browserslist README](https://github.com/browserslist/browserslist#queries)). Add iOS explicitly: `ios_saf` is a separate target.
  - Resolved today with browserslist 4.29.3 / caniuse-lite 1.0.30001816: **Chrome 154, 153; Firefox 157, 156; Safari 27, 26.6; iOS 27.0, 26.6**.
  - Chrome and Firefox now ship about every two weeks (inferred from caniuse release dates), so "last 2" covers only ~4 weeks of releases. The README advises direct browser selection only for kiosk-like apps. That is acceptable for a 5-user tool.
  - `last 2 Safari versions` counts minor releases. `last 2 Safari major versions` would lower the floor to 26.0.
- **Where to put it**: the `browserslist` key in root `package.json` (or `.browserslistrc`). Next uses it instead of its default `chrome 111, edge 111, firefox 111, safari 16.4` ([supported browsers](https://nextjs.org/docs/architecture/supported-browsers)).
  - Turbopack's CSS pipeline is Lightning CSS, which reads those targets.
  - **Tailwind v4 ignores browserslist.** `@tailwindcss/node` 4.3.3 hard-codes Safari 16.4 / Chrome 111 / Firefox 128 and always flattens nesting and media-range syntax. It runs Lightning CSS only in production ([compatibility](https://tailwindcss.com/docs/compatibility); verified in the package source).
  - Raising the targets therefore removes Next's down-levelling but not Tailwind's own. That is harmless.

Feature safety across the target set. Data: web-features 3.42.0 (Baseline) + MDN BCD 8.1.5 (minimum versions), equivalent to [webstatus.dev](https://webstatus.dev).

| Feature | Baseline | Chrome / Firefox / Safari min | Safe for targets? |
|---|---|---|---|
| `light-dark()` | newly | 123 / 120 / 17.5 | Yes |
| `color-mix()` | widely | 111 / 113 / 16.2 | Yes |
| `oklch()` | widely | 111 / 113 / 15.4 | Yes |
| Relative color syntax | newly | 125 / 128 / 18 | Yes |
| `@property` | newly | 85 / 128 / 16.4 | Yes |
| Container size queries | widely | 105 / 110 / 16 | Yes |
| Container style queries (custom props) | newly | 111 / 151 / 18 | Yes |
| `:has()` | widely | 105 / 121 / 15.4 | Yes |
| CSS nesting | widely | 120 / 117 / 17.2 | Yes |
| Anchor positioning (core) | newly 2026-01 | 125 / 147 / 26 | Yes (`position-visibility` partial) |
| `@scope` | newly 2026-03 | 118 / 146 / 26.4 | Yes |
| View transitions, same-document | newly 2025-10 | 111 / 144 / 18 | Yes |
| `view-transition-class`, transition types | newly | 125 / 144–147 / 18.2 | Yes |
| Cross-document `@view-transition` | limited | 126 / **no** / 18.2 | **No** (Firefox) |
| Scroll-driven animations | limited | 115 / **no** / 26 | **No**; use `@supports` |
| `field-sizing` | newly 2026-06 | 123 / 152 / 26.2 | Yes |
| `interpolate-size` / `calc-size()` | limited | 129 / no / no | **No** |
| `@starting-style` | newly | 117 / 129 / 17.5 | Yes |
| `popover` | newly | 114 / 125 / 17 | Yes |
| `popover="hint"` | limited | 151 / 153 / no | **No** (Safari) |
| Customizable `<select>` (`appearance: base-select`) | limited | 135 / flag / 27 | **No** (Firefox, Safari 26.6) |
| `text-wrap: balance` / `pretty` | newly / limited | 114/121/17.5 · 117/no/26 | balance yes; pretty as enhancement |
| CSS `if()` | limited | 137 / no / no | **No** |
| `sibling-index()` / `sibling-count()` | newly 2026-08 | 138 / 154 / 26.2 | Yes |
| `:user-valid` | widely | 119 / 88 / 16.5 | Yes |

**Recommendation**: use the query above. Use freely: `light-dark()`, `color-mix()`/oklch, relative colors, `@property`, container queries, `:has()`, nesting, anchor positioning, `@scope`, same-document view transitions, `@starting-style`, popover, `field-sizing`. Treat as progressive enhancement only: cross-document view transitions, scroll-driven animations, `interpolate-size`, `popover=hint`, customizable select, `if()`.

## 8. View Transitions

- **React**: `<ViewTransition>` and `addTransitionType` are **stable in React 19.3.0** (2026-09-09) ([CHANGELOG](https://github.com/facebook/react/blob/main/CHANGELOG.md), [React 19.3 blog](https://react.dev/blog/2026/09/09/react-19-3)).
- **Next**: `experimental.viewTransition` was **removed** (PR [#96098](https://github.com/vercel/next.js/pull/96098), merged 2026-07-23, in 16.3.0), and its docs page now returns 404.
  - Next's guide: "View transitions work in the App Router with no configuration" ([guide](https://nextjs.org/docs/app/guides/view-transitions)).
  - `<Link transitionTypes={[…]}>` (16.2+) and `router.push(url, { transitionTypes })` tag navigations ([Link](https://nextjs.org/docs/app/api-reference/components/link#transitiontypes)).
  - Back/forward navigation carries no type. React skips animation on back-button popstate.
- **Browsers**: same-document view transitions and transition types work in all targets (§7). Cross-document ones do not, and aren't needed in an SPA-style App Router.
- **Where to use them**:
  - **Feed → detail**: wrap the card image/title and the detail hero in `<ViewTransition name={`clipping-${id}`} share="morph">` on both sides.
    - The morph needs the destination to render in the same commit: prefetch the detail with `<Link prefetch>`, which Cache Components makes cheap.
    - Use `transitionTypes={['nav-forward']}` for directional slides.
    - Add `::view-transition { pointer-events: none }`.
  - **Theme/palette switch**: changing an attribute on `<html>` is outside React. Use `document.startViewTransition({ update, types: ['theme'] })` with a short crossfade scoped by `:active-view-transition-type(theme)`. Skip it under `prefers-reduced-motion: reduce`.
    - React says manual transitions may be interrupted by React-driven ones. Keep it short. This is a judgement call, not documented.
  - **Reduced motion**: zero out `::view-transition-*` animations under `prefers-reduced-motion` (snippet in the Next guide), or keep only crossfades.

**Recommendation**: integrate. React 19.3 stable plus no Next flag makes it cheap. Use it for feed↔detail and the theme switch only. Avoid list-reorder animations on the feed initially.

## 9. SWR

- **Version**: `swr` 2.5.1 (beta 2.6.0-beta.0); peer `react ^16.11 || ^17 || ^18 || ^19` (npm).
- **App Router rules**: hooks only in Client Components. `SWRConfig`, `preload` and `unstable_serialize` can be imported in Server Components ([SWR with Next.js](https://swr.vercel.app/docs/with-nextjs)).
- **Passing server data to SWR**, three verified patterns:
  1. `SWRConfig value={{ fallback: { [key]: getX(id) } }}` with an **unawaited promise** (SWR ≥ 2.3 + React 19). Only the component reading that key suspends. Pair it with `useSWR(key, fetcher, { suspense: true })` ([Next.js SWR guide](https://nextjs.org/docs/app/guides/client-side-data-fetching/swr)).
  2. `preload(key, fetcher)` in a Server Component → `SWRConfig cacheData`. Experimental, needs ≥ 2.5.0-beta.1, and skips the duplicate first client request ([SWR with Next.js](https://swr.vercel.app/docs/with-nextjs)).
  3. Keep the key and the server cache tag in one shared "cache contract" module (`key(id)`, `tag(id)`). Mutations use SWR `mutate(key, action, { optimisticData, rollbackOnError })`, and the Server Action calls `updateTag(tag)` ([guide](https://nextjs.org/docs/app/guides/client-side-data-fetching/swr)).
- **Fallback data is stale by default**: SWR revalidates after hydration. Use `revalidateIfStale: false` to skip that ([guide](https://nextjs.org/docs/app/guides/client-side-data-fetching/swr)).
- **Performance**: deduping (`dedupingInterval`), deep compare (`compare`), dependency collection (only the fields you read cause re-renders), tree-shakeable ([performance](https://swr.vercel.app/docs/advanced/performance)).
- **UX**: `isLoading` = no data yet; `isValidating` = any request in flight; `keepPreviousData: true` for search-as-you-type ([understanding](https://swr.vercel.app/docs/advanced/understanding)).

Where client fetching actually earns its place in Clippings:

| Use | SWR? | Pattern |
|---|---|---|
| Feed first paint, detail page | No | RSC + `'use cache'` + `cacheTag('clippings:<user>')` |
| Search-as-you-type | **Yes** | `useSWR(q ? '/api/search?q=' : null, f, { keepPreviousData: true })`, debounce 200 ms. The URL `?q=` also drives RSC for shareable/initial results |
| Polling `pending` enrichment | **Yes** | `refreshInterval: (data) => data?.status === 'pending' ? 2000 : 0` on `/api/clippings/:id/status` |
| Tag edits (optimistic) | Either | Server Action + `useOptimistic` is enough; SWR `mutate` only if that list is SWR-managed |
| Tag management, settings | No | Server Actions + `updateTag` |

**Recommendation**: Use SWR narrowly: search, pending-status polling, and maybe the tag picker. Everything else is RSC + Server Actions. Use the unawaited-promise `fallback` pattern where a list starts server-rendered and then becomes client-managed.

## 10. Scope adjustments

- **Daily digest → separate spec.** Hooks the core app should keep:
  - `source` enum includes `digest`.
  - MCP `save_clipping(url, note?, source?)` accepts `source` (default `mcp`). The digest agent (claude.ai scheduled task) then saves through MCP with the normal OAuth.
  - `search_clippings` / `list_recent` let it dedupe and learn interests.
  - Optional `created_by` / `client_id` column from the OAuth token, to audit who saved what.
  - Nothing digest-specific in the schema beyond that.
- **~5 users instead of single-user**:
  - Add `users` (Better Auth tables) and a `user_id` FK on `clippings`, `tags` (tags per user, `unique(user_id, name)`), and `clipping_tags`.
  - `url_normalized` becomes `unique(user_id, url_normalized)`.
  - Allowlist: an `ALLOWED_EMAILS` env/secret, or an `allowed_users` table, checked in the Better Auth sign-in hook (reject other Google accounts). The same check applies to OAuth consent for MCP clients and the extension.
  - Every query is scoped by `user_id`. Search ranking is per user. Optionally use Postgres RLS later; not needed now.
- **Simplifications at this scale**:
  - No ANN index: exact `ORDER BY embedding <=> $1` over a few thousand rows is fine (the brief already says this).
  - Smallest Cloud SQL tier (see §3).
  - Keep Cloud Tasks: it costs $0 at this volume and avoids Cloud Run's post-response CPU throttling (§3).
  - `max-instances` 1–2 on Cloud Run, which also sidesteps the shared Next cache issue.
  - No Redis. No separate API service.

## 11. Light/dark + modern CSS (recommended approach)

1. **Tokens**: every `--md-sys-color-*` is `light-dark(L, D)` inside `:root[data-palette=…]` (§1). Set `:root { color-scheme: light dark; }`, `:root[data-theme=light] { color-scheme: light }`, `:root[data-theme=dark] { color-scheme: dark }`. "System" means no `data-theme` attribute, and `light-dark()` follows the OS.
2. **No flash (Next's official pattern)** ([preventing flash](https://nextjs.org/docs/app/guides/preventing-flash-before-hydration#themes)):
   - `<html suppressHydrationWarning>` and an inline `<script>` in `<head>` that reads `localStorage` (try/catch) and sets `data-theme` / `data-palette` before paint.
   - Do **not** read the theme cookie with `cookies()` in the root layout. That opts the whole app out of static prerendering and, under Cache Components, blocks every segment below it.
   - Re-apply the theme in a `useLayoutEffect` in the toggle, because Strict Mode's dev remount resets `<html>` attributes.
   - Under a strict CSP, the inline script needs a nonce.
3. **Meta**: `export const viewport = { colorScheme: 'light dark' }` emits `<meta name="color-scheme">` ([generateViewport](https://nextjs.org/docs/app/api-reference/functions/generate-viewport#colorscheme)).
4. **Tailwind v4**: `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));` ([dark mode](https://tailwindcss.com/docs/dark-mode)). Note that with `light-dark()` tokens you rarely need `dark:`. Keep the variant for one-off overrides only. "System" mode under `dark:` needs the script to set `data-theme` from `matchMedia`, or `dark:` won't match.
5. **next-themes** (0.4.6, last released 2025-03) isn't needed; the official pattern is about 15 lines.

## 12. GitHub CI + deploy to GCP via GitHub Actions

Action versions and commit SHAs were read from the GitHub Releases/Git refs API on 2026-10-14. The other facts come from the linked docs.

| Action | Latest | Commit SHA (pin this) |
|---|---|---|
| actions/checkout | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| actions/setup-node | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| pnpm/action-setup | v6.1.0 | `ea17c68df8912ef543352723c149a84f56e3d413` |
| google-github-actions/auth | v3.0.0 | `7c6bc770dae815cd3e89ee6cdf493a5fab2cc093` |
| google-github-actions/deploy-cloudrun | v3.0.1 | `2028e2d7d30a78c6910e0632e48dd561b064884d` |
| google-github-actions/setup-gcloud | v3.0.1 | (resolve from the tag) |
| actions/github-script | v9.0.0 | (resolve from the tag) |
| pnpm/setup (alternative to action-setup + setup-node) | v3.1.1 | `a0881977cd8ea73b1ed212236c99ca10dcc80cf4` |
| hashicorp/setup-terraform | v4.0.1 | `dfe3c3f87815947d99a8997f908cb6525fc44e9e` |
| docker/build-push-action | v7.4.0 | `c3c9e263c25d99ce0380d002d59b67737d91b0dc` |
| docker/setup-buildx-action | v4.4.1 | `f87e5991a6d7451dcb8d9637bfbc97413f497069` |
| actions/cache | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |
| actions/upload-artifact | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

Sources: the GitHub Releases API for each repo (e.g. [auth releases](https://github.com/google-github-actions/auth/releases), [deploy-cloudrun releases](https://github.com/google-github-actions/deploy-cloudrun/releases)).
- Pin every action to a full commit SHA with a `# vX.Y.Z` comment, and check the SHA belongs to the action's own repo, not a fork ([secure use](https://docs.github.com/en/actions/reference/security/secure-use)).
  - That page now also documents "workflow dependency lockfiles" as superseding SHA pinning. Their GA/preview status was not verified.
  - Dependabot does not alert on SHA-pinned actions, so schedule a version-update job for them.

**CI (`ci.yml`, on `pull_request` + push to `main`)**
- `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`. Give the deploy workflow its own group *without* cancel so a deploy never stops halfway ([concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)).
- Steps:
  - checkout with `fetch-depth: 0`. `--affected` equals `--filter=...[main...HEAD]`, auto-detects GitHub Actions base/head, and **treats every package as changed on a shallow clone** ([run reference](https://turborepo.dev/docs/reference/run), [constructing CI](https://turborepo.dev/docs/crafting-your-repository/constructing-ci)).
  - `pnpm/action-setup` with no `version` input: it reads `packageManager` **or `devEngines.packageManager`** and supports pnpm 12 ([README](https://github.com/pnpm/action-setup)).
  - Alternative: `pnpm/setup` v3.1.1 installs pnpm plus Node and runs install in one step ([repo](https://github.com/pnpm/setup)). It is newer, so the two-step setup is the conservative choice.
  - `actions/setup-node` with `node-version-file: .node-version` and `cache: pnpm`. setup-node supports `.node-version` and `devEngines.runtime` in package.json, and its pnpm caching example installs pnpm first ([advanced usage](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md)).
  - `pnpm install --frozen-lockfile`. pnpm 12 removed `--frozen-lockfile false` ([v12](https://github.com/pnpm/pnpm/releases/tag/v12.0.0)).
  - `pnpm turbo run lint format:check typecheck test build --affected`, where `format:check` = `oxfmt --check`.
- **Turbo cache**:
  - Simplest: `actions/cache` on `.turbo` keyed by `${{ runner.os }}-turbo-${{ github.sha }}` with restore-keys.
  - Vercel Remote Cache is free on all plans. Connect it via OIDC (`vercel/setup-turborepo-remote-cache-action`) or `TURBO_TOKEN` / `TURBO_TEAM`. It is better but needs a Vercel account. Self-hosting is possible through the OpenAPI spec ([GitHub Actions guide](https://turborepo.dev/docs/guides/ci-vendors/github-actions), [remote caching](https://turborepo.dev/docs/core-concepts/remote-caching)).
- **pnpm 11+ `minimumReleaseAge` = 1 day**: a dependency bumped to a version published that day won't resolve. That is fine with a frozen lockfile, but `pnpm update` in CI would hit it.

**Deploy (`deploy.yml`, on push to `main` + `workflow_dispatch`)**
- `permissions: { contents: read, id-token: write }`.
- ⚠ **GitHub Environments are not available for private repos on GitHub Free.** "Users with GitHub Free plans can only configure environments for public repositories", and required reviewers and wait timers are public-only on Free/Pro/Team ([manage environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)).
  - On a private Free repo, drop `environment:` and rely on the WIF `ref == refs/heads/main` condition plus branch protection.
- Auth with `google-github-actions/auth@v3` using `workload_identity_provider` + `service_account`, never a JSON key.
  - The WIF provider has `attribute_condition = "assertion.repository_id == '<id>' && assertion.ref == 'refs/heads/main'"`. Google recommends the numeric `*_id` claims against cybersquatting ([WIF for pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)). The auth README says "Always add an Attribute Condition" ([auth](https://github.com/google-github-actions/auth)).
  - Direct WIF without a service account is possible, but Docker/AR login needs `token_format: access_token`, which needs a service account. Use the SA path.
- **Build**: `docker/build-push-action` with `cache-from/to: type=gha` and a `turbo prune web --docker` multi-stage Dockerfile. Push to `REGION-docker.pkg.dev/PROJECT/clippings/web:${{ github.sha }}` after `gcloud auth configure-docker REGION-docker.pkg.dev`.
  - Or `docker/login-action` (v4.6.0) with `username: oauth2accesstoken` and `password: steps.auth.outputs.access_token` ([login-action GAR](https://github.com/docker/login-action#google-artifact-registry-gar)).
  - The GHA cache backend is subject to GitHub cache limits ([gha cache](https://github.com/docker/docs/blob/main/content/manuals/build/cache/backends/gha.md)).
  - Alternative: `gcloud builds submit` (2,500 free build-minutes/month on e2-standard-2, [pricing](https://cloud.google.com/build/pricing)). Prefer GHA, because pnpm/turbo state is already there.
- **Migrations before traffic**: a **Cloud Run Job** ([execute jobs](https://docs.cloud.google.com/run/docs/execute/jobs)) using the same image (`node packages/db/migrate.js`), run with `gcloud run jobs deploy … && gcloud run jobs execute migrate --wait`. It connects through the same Cloud SQL socket, so CI needs no proxy. Then deploy the service.
  - Make migrations backward-compatible (expand/contract) so the old revision keeps working while the job runs.
- **Deploy**: `google-github-actions/deploy-cloudrun@v3` with `image`, `service`, `region`. It needs `roles/run.admin` + `roles/iam.serviceAccountUser` on the runtime SA. Non-empty `env_vars` / `secrets` **replace** the existing set ([deploy-cloudrun](https://github.com/google-github-actions/deploy-cloudrun)). Use `flags: --add-cloudsql-instances=… --max-instances=2`. Use `secrets:` mapping env names to `secret-name:latest` from Secret Manager.
  - Keep `ANTHROPIC_API_KEY`, `BETTER_AUTH_SECRET`, Google OAuth client secret, DB password (or IAM auth) in Secret Manager, not GitHub secrets. Env-var secrets resolve at instance start, so pin versions. The runtime SA needs `roles/secretmanager.secretAccessor` ([Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets)).
  - `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is needed at **build** time, so pass it as a build secret.

**Terraform (`terraform.yml`)**
- Triggers: `pull_request` on `infra/**` → `terraform fmt -check`, `init`, `validate`, `plan -no-color`. Post the plan as a PR comment via `actions/github-script` (v9.0.0). The setup-terraform wrapper exposes `stdout` / `stderr` / `exitcode`, and its README has the update-existing-comment example ([setup-terraform](https://github.com/hashicorp/setup-terraform)).
- On push to `main` (or `workflow_dispatch`) → `apply` in the `production` environment.
- `hashicorp/setup-terraform@v4` with `terraform_version: 1.16.6`.
- Use **separate service accounts**:
  - `gh-deploy`: `roles/run.admin` (required by deploy-cloudrun; it also covers jobs), `roles/artifactregistry.writer`, and `roles/iam.serviceAccountUser` on the runtime SA only.
  - `gh-terraform`: broader, project-level `roles/editor` + `roles/resourcemanager.projectIamAdmin`, or a curated set.
  - Each SA has its own WIF `principalSet` binding (`roles/iam.workloadIdentityUser`, `principalSet://…/attribute.repository_id/ID`, using the project number).
  - Restrict apply to `main`. A read-only plan SA (`roles/viewer` + state-bucket access) is a good pattern, but plan may need extra read roles; this is my judgement.
- **Bootstrap by hand once** (a `bootstrap/` Terraform dir with local state, or a short gcloud script):
  1. project + billing
  2. enable the APIs (`iam`, `iamcredentials`, `sts`, `run`, `sqladmin`, `artifactregistry`, `secretmanager`, `cloudtasks`)
  3. the GCS state bucket with versioning
  4. the WIF pool + provider + the two SAs
  Then migrate the bootstrap state into the bucket (`terraform init -migrate-state`). This is Google's documented flow ([store state](https://docs.cloud.google.com/docs/terraform/resource-management/store-state)). Everything else lives in `infra/` with the GCS backend.

**Chrome extension**
- CI runs `pnpm turbo run build --filter=extension` then `wxt zip`, and uploads the zip with `actions/upload-artifact`.
- Publishing is feasible.
  - The official **Chrome Web Store API v2** has upload/publish/fetchStatus endpoints and supports **service accounts**: add the SA email in the Developer Dashboard, scope `https://www.googleapis.com/auth/chromewebstore` ([using the API](https://developer.chrome.com/docs/webstore/using-api), [service accounts](https://developer.chrome.com/docs/webstore/service-accounts)).
  - Keyless publishing through WIF (`auth@v3` + `access_token_scopes`) is plausible but untested.
  - `wxt submit` and `mnao305/chrome-extension-upload` v7.0.0 also exist.
  - For 5 users, an **unlisted** listing or loading the unpacked zip is enough.

**Cost notes (~5 users)**
- GitHub Actions on Free (private repos): **2,000 min/month**, 500 MB artifacts, 10 GB cache per repo. Linux 2-core costs $0.006/min beyond that; public repos are free ([billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)). At ~5 min per CI run plus ~6 min per deploy, that's ~150 pushes/month inside the free tier.
- Artifact Registry: the first **0.5 GiB-month is free**, then about $0.10/GiB-month ([pricing](https://cloud.google.com/artifact-registry/pricing)). A Next standalone image is a few hundred MB, so add `cleanup_policies` (keep the 5 most recent versions, delete untagged after 7 days). Keep policies win over delete policies ([cleanup](https://docs.cloud.google.com/artifact-registry/docs/repositories/cleanup-policy)).

YAML sketch (outline only):
```yaml
# .github/workflows/ci.yml
on: { pull_request: {}, push: { branches: [main] } }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with: { node-version-file: .node-version, cache: pnpm }
      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with: { path: .turbo, key: turbo-${{ github.sha }}, restore-keys: turbo- }
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run lint format:check typecheck test build --affected
      - run: pnpm --filter extension zip   # + upload-artifact v7.0.2

# .github/workflows/deploy.yml
on: { push: { branches: [main] }, workflow_dispatch: {} }
concurrency: { group: deploy-prod, cancel-in-progress: false }
permissions: { contents: read, id-token: write }
jobs:
  deploy:
    # environment: production   # only if repo is public or plan is Pro/Team
    steps:
      - checkout (v7.0.1)
      - google-github-actions/auth@7c6bc770dae815cd3e89ee6cdf493a5fab2cc093 # v3.0.0
        with: { workload_identity_provider: ..., service_account: gh-deploy@..., token_format: access_token }
      - google-github-actions/setup-gcloud (v3.0.1); gcloud auth configure-docker $REGION-docker.pkg.dev
      - docker/setup-buildx-action (v4.4.1)
      - docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
        with: { push: true, tags: $AR/web:${{ github.sha }}, cache-from: type=gha, cache-to: type=gha,mode=max }
      - run: gcloud run jobs deploy migrate --image ... && gcloud run jobs execute migrate --wait
      - google-github-actions/deploy-cloudrun@2028e2d7d30a78c6910e0632e48dd561b064884d # v3.0.1
        with: { service: clippings, region: ..., image: $AR/web:${{ github.sha }}, secrets: ..., flags: --add-cloudsql-instances=... }

# .github/workflows/terraform.yml
on: { pull_request: { paths: [infra/**] }, push: { branches: [main], paths: [infra/**] }, workflow_dispatch: {} }
permissions: { contents: read, id-token: write, pull-requests: write }
jobs:
  plan:   # PR: auth as gh-terraform-plan, setup-terraform@dfe3c3f8... (v4.0.1), init/validate/plan, github-script comment
  apply:  # main/dispatch: environment production, auth as gh-terraform, terraform apply -auto-approve
```

**Recommendation**: three workflows as sketched. WIF with a `repository_id` + ref condition, SHA-pinned actions, GHA Docker layer cache, a Cloud Run Job for migrations, Secret Manager for runtime secrets, and a one-time bootstrap Terraform dir for state bucket + WIF.

## Changes to the brief (edits to CLIPPINGS_BRIEF.md)

1. **Architecture diagram**: replace "Cloud Run service (Node, Hono)" and "static React SPA" with **one Next.js 16.4 app** (`output: 'standalone'`) serving the UI (RSC), `/api/*` Route Handlers, `/mcp` (`mcp-handler` 2) and auth routes.
2. **Decisions table**:
   - **Repo**: pnpm 12 + Turborepo 2.11 monorepo: `apps/web` (Next), `apps/extension` (WXT), `packages/shared`, `packages/ui`, `packages/db`, `packages/config`. Remove `apps/server`. Use pnpm catalogs and JIT internal packages.
   - **Backend**: Next.js Route Handlers + Server Actions; no Hono, no Fastify.
   - **Frontend**: Next.js App Router (not Vite), React 19.3, React Aria Components 1.22, Tailwind 4.3. Drop `tailwindcss-react-aria-components`; Tailwind v4 `data-*` variants cover RAC states. Add SWR 2.5 for search, polling and optimistic tag edits only.
   - **Auth**: replace "Firebase Auth / Identity Platform, single user" with **Better Auth** (Google provider) plus an **allowlist of ~5 emails**. Its `mcp()` plugin is the OAuth 2.1 authorization server for claude.ai / Claude Code (CIMD, PKCE S256, redirect `https://claude.ai/api/mcp/auth_callback`) and for the extension (`launchWebAuthFlow`).
   - **DB**: Cloud SQL PG 18, **edition ENTERPRISE**, `db-f1-micro`. pgvector 0.8.5 + `pg_textsearch` (needs PG 17+ and maintenance ≥ R20260712.01_06).
   - **Save flow**: keep Cloud Tasks, and note why: Cloud Run CPU throttling after the response.
3. **Data model**: add `users` (Better Auth tables) and `user_id` on `clippings` / `tags` / `clipping_tags`. Change `url_normalized` to `unique(user_id, url_normalized)` and tags to `unique(user_id, name)`. Keep `source` incl. `digest`.
4. **MCP tools**: `save_clipping(url, note?, source?)`. Pin the protocol to spec 2026-07-28 with stateless fallback. Prefer CIMD over DCR for client identity.
5. **Design**:
   - Generate tokens with `@material/material-color-utilities` 0.4.0 (Tonal Spot, spec 2021, neutral override hue 72–88 / chroma 8–9) for **olive, yellow, orange × light/dark**, as `light-dark()` tokens under `data-palette`, mapped via `@theme inline`.
   - Material Theme Builder becomes a visual cross-check only (its repo is archived).
   - Add the M3 Expressive shape steps (20/32/48) and spring motion curves.
   - `cn` 0.4.0 replaces clsx + tailwind-merge. `@shadcn/lint` enforces "No hardcoded colors".
6. **Resources**: add Material Web 2.5 `labs/gb/styles/tailwind.css` as the reference for the Tailwind token mapping.
7. **New sections**:
   - **Toolchain**: Node 24.22 via `.node-version` + `devEngines.runtime`; TypeScript 7.0.2 (`strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, no `baseUrl`); oxlint 1.88 (+ tsgolint, React Compiler rules, `@shadcn/lint`); oxfmt 0.73 (`sortImports`, `sortTailwindcss`); Rust React Compiler only.
   - **Browsers**: last 2 Chrome / Firefox / Safari / iOS.
   - **CI/CD**: §12 workflows.
8. **Milestones**:
   - M0: Next + Turborepo scaffold, Terraform bootstrap + WIF, CI.
   - M4: Better Auth AS + `/mcp` (stateless).
   - M5: theme generator + 3 palettes.
   - Add a CI/deploy milestone.
9. **Later**: daily digest moves to its own spec. Keep `source = digest` and MCP `save_clipping` as its entry points.
10. **Not using**: Hono, Vite (for the web app), Firebase Auth, Babel / `babel-plugin-react-compiler`, shadcn components and registries, next-themes, Redis.

## Unverified / could not confirm

- Whether the Next.js TS IDE plugin loads under TypeScript 7's native language server (likely not, since there is no JS API). Keep `typescript@6.0.3` as the editor TSDK if needed.
- oxlint React Compiler rules: the plugins page says "experimental, off by default", while the blog files them under `correctness`.
- oxfmt still labelled beta (no stable announcement found).
- Rust React Compiler: whether `panicThreshold` is honoured in 16.4.0 (#99455 closed 2026-09-30). There is no per-file compiler report from Next.
- `cn` / tailwind-merge behaviour with M3 typescale and custom radius class names (inferred from tailwind-merge semantics; test it).
- Whether `@shadcn/lint` reads RAC `className` render functions (not in its documented table).
- That Lightning CSS in Turbopack leaves `light-dark()` / nesting untranspiled under the new browserslist (implied by docs, not tested).
- Chrome / Firefox ~2-week release cadence (inferred from caniuse release dates).
- Combining a manual `document.startViewTransition` (theme switch) with React-driven transitions.
- Cloud SQL / Cloud Run prices for europe-west1 (only us-central1 extracted). Whether `pg_textsearch` needs `shared_preload_libraries` on Cloud SQL.
- GitHub "workflow dependency lockfiles" GA status. Whether `mnao305/chrome-extension-upload` v7 uses the CWS v2 API. Keyless CWS publishing via WIF.
- Material Theme Builder: exact CSS number formatting, and whether the UI exposes a full variant picker.
- `@material/material-color-utilities` 0.4.0 resolving through Turbopack (fails in plain Node ESM; run the generator with `tsx` at build time, so this doesn't matter).
- M3 Expressive spring damping/stiffness values were read under the "Standard, Android" table only.
- pnpm `devEngines.runtime` `onFail` values beyond `download` (pnpm docs only show `download`; `runtimeOnFail` accepts download / error / warn / ignore).

## Sources

**Versions**
- npm registry (`npm view`, 2026-10-14): next, react, typescript, pnpm, turbo, swr, zod, date-fns, @date-fns/tz, es-toolkit, oxlint, oxfmt, oxlint-tsgolint, tailwindcss, react-aria-components, wxt, @crxjs/vite-plugin, vite, shadcn, cn, @shadcn/lint, mcp-handler, @modelcontextprotocol/*, better-auth, pg, @google-cloud/*, @material/material-color-utilities.
- Node: https://nodejs.org/dist/index.json · https://github.com/nodejs/Release/blob/main/schedule.json
- GitHub Releases API: actions/*, pnpm/action-setup, pnpm/setup, google-github-actions/*, hashicorp/setup-terraform, docker/*, hashicorp/terraform, hashicorp/terraform-provider-google, GoogleCloudPlatform/cloud-sql-proxy, vercel/turborepo, vercel/next.js.

**Next.js**
- https://nextjs.org/blog/next-16-4
- https://nextjs.org/docs/app/getting-started/installation
- https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackRustReactCompiler
- https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler
- https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli
- https://nextjs.org/docs/app/api-reference/config/typescript
- https://nextjs.org/docs/app/api-reference/functions/after
- https://nextjs.org/docs/app/guides/self-hosting
- https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages
- https://nextjs.org/docs/app/guides/client-side-data-fetching/swr
- https://nextjs.org/docs/app/guides/view-transitions
- https://nextjs.org/docs/app/guides/preventing-flash-before-hydration
- https://nextjs.org/docs/architecture/supported-browsers
- https://nextjs.org/docs/app/guides/upgrading/version-16
- https://github.com/vercel/next.js/pull/96098
- Rust React Compiler issues: #100085, #98820, #95557, #97392, #99455

**React and the React Compiler**
- https://react.dev/blog/2026/09/09/react-19-3
- https://github.com/facebook/react/blob/main/CHANGELOG.md
- https://github.com/facebook/react/tree/main/compiler/crates
- https://crates.io/crates/react_compiler

**pnpm and Node version managers**
- https://github.com/pnpm/pnpm/releases/tag/v12.0.0 · https://github.com/pnpm/pnpm/releases/tag/v11.0.0
- https://pnpm.io/package_json · https://pnpm.io/catalogs
- https://github.com/pnpm/pnpm.io/blob/main/docs/settings/cli.md · https://github.com/pnpm/pnpm.io/blob/main/blog/releases/12.7.md
- https://docs.npmjs.com/cli/v11/configuring-npm/package-json#devengines
- https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md
- https://mise.jdx.dev/lang/node.html · https://github.com/Schniz/fnm/blob/master/docs/configuration.md · https://github.com/volta-cli/volta
- https://docs.cloud.google.com/docs/buildpacks/nodejs

**Turborepo**
- https://turborepo.dev/docs/core-concepts/internal-packages
- https://turborepo.dev/docs/guides/ci-vendors/github-actions
- https://turborepo.dev/docs/reference/run
- https://turborepo.dev/docs/crafting-your-repository/constructing-ci

**MCP, auth and the extension**
- https://github.com/vercel/mcp-handler (README, docs/AUTHORIZATION.md)
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
- https://claude.com/docs/connectors/building/authentication
- https://www.better-auth.com/docs/plugins/mcp
- https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- https://developer.chrome.com/docs/extensions/reference/api/identity
- https://developer.chrome.com/docs/webstore/using-api · https://developer.chrome.com/docs/webstore/service-accounts

**SWR**
- https://swr.vercel.app/docs/with-nextjs
- https://swr.vercel.app/docs/advanced/performance
- https://swr.vercel.app/docs/advanced/understanding

**Lint, format and the shadcn packages**
- https://oxc.rs/docs/guide/usage/linter/plugins.html
- https://oxc.rs/docs/guide/usage/linter/type-aware.html
- https://oxc.rs/docs/guide/usage/linter/js-plugins.html
- https://oxc.rs/blog/2026-08-18-react-compiler-support
- https://oxc.rs/blog/2026-02-24-oxfmt-beta
- https://oxc.rs/docs/guide/usage/formatter/config-file-reference.html
- https://github.com/shadcn-ui/lint (README, docs/how-it-works.md, packages/lint/package.json)
- https://github.com/shadcn-ui/cn (README, packages/cn/package.json)

**TypeScript**
- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-8.html

**Browsers and CSS**
- https://github.com/browserslist/browserslist
- https://github.com/web-platform-dx/web-features (3.42.0)
- https://github.com/mdn/browser-compat-data (8.1.5)
- https://tailwindcss.com/docs/compatibility · https://tailwindcss.com/docs/theme · https://tailwindcss.com/docs/dark-mode
- https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark
- https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feTurbulence

**Material 3**
- https://github.com/material-foundation/material-theme-builder
- https://github.com/material-foundation/material-color-utilities (and issue #195)
- https://github.com/material-components/material-web/blob/main/labs/gb/styles/tailwind.scss
- https://m3.material.io/styles/shape/corner-radius-scale
- https://m3.material.io/styles/motion/overview/specs
- https://m3.material.io/foundations/interaction/states/state-layers

**GCP**
- https://docs.cloud.google.com/sql/docs/postgres/release-notes · https://docs.cloud.google.com/sql/docs/db-versions · https://docs.cloud.google.com/sql/docs/postgres/extensions
- https://cloud.google.com/sql/pricing · https://cloud.google.com/sql/sla
- https://docs.cloud.google.com/sql/docs/postgres/connect-run
- https://cloud.google.com/run/pricing · https://docs.cloud.google.com/run/docs/configuring/billing-settings · https://docs.cloud.google.com/run/docs/tips/general
- https://cloud.google.com/tasks/pricing · https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks
- https://registry.terraform.io/providers/hashicorp/google/latest/docs · https://github.com/hashicorp/terraform-provider-google/blob/main/website/docs/guides/version_8_upgrade.html.markdown
- https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines
- https://docs.cloud.google.com/docs/terraform/resource-management/store-state
- https://cloud.google.com/artifact-registry/pricing

**GitHub**
- https://github.com/google-github-actions/auth · https://github.com/google-github-actions/deploy-cloudrun
- https://github.com/hashicorp/setup-terraform · https://github.com/pnpm/action-setup
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- https://docs.github.com/en/actions/reference/security/secure-use
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
