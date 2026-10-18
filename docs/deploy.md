# Environments, releases and backups

Clippings runs on Vercel Hobby and Neon Launch, in two long-lived environments. Neon is
usage-based (storage, compute and instant restore); Vercel Hobby is free. GitHub Actions does all
the deploying; the dashboards hold settings and secrets.

|                 | Development                                  | Production                              |
| --------------- | -------------------------------------------- | --------------------------------------- |
| Git branch      | `main` (where work lands)                    | `production` (moved by release PRs)     |
| Deploys on      | every push to `main`                         | every push to `production`              |
| Workflow        | [`development`](../.github/workflows/development.yml) | [`release`](../.github/workflows/release.yml) |
| Vercel          | Preview environment, fixed alias `DEVELOPMENT_ALIAS` | Production environment, the production domain |
| Neon branch     | `development` (child of `production`)        | `production` (the default branch)       |
| Sign-in         | works, on the alias                          | works, on the production domain         |

Besides those:

- [`preview-db`](../.github/workflows/preview-db.yml): each PR gets Neon branch `preview/pr-<n>`
  (a child of `development`), migrated, with its own Vercel preview. Deleted when the PR closes.
  Google sign-in isn't supported on per-deploy preview URLs.
- **Backups** are Neon's instant restore on `production`: any point inside the restore window can
  become a branch. The window is set to 1 day (Neon → Project → Settings → Instant restore; Launch
  allows up to 7 days), so a mistake older than a day is not recoverable. There is no copy outside
  Neon, so a lost Neon project or account is not either.
- Vercel's own Git deploys are off for every branch ([`apps/web/vercel.json`](../apps/web/vercel.json)),
  so the workflows above are the only way code reaches Vercel. Every migration runs before the
  code that needs it.

## Releasing

A ruleset on `production` ("Protect default and production branches") requires a pull request and
passing checks, with no bypass, so nothing is pushed to the branch directly. A release is a pull
request from `main` into `production`:

```bash
gh pr create --base production --head main --title "Release: <what ships>"
```

Wait for its checks, then merge it with **Create a merge commit**. Merging pushes to `production`,
which starts `release`: migrate production (direct URL), then `vercel pull`, `build --prod`,
`deploy --prebuilt --prod`. Only commits that are on `main` (so CI has run on them) can be in the
pull request; to release less than all of `main`, branch from the commit you want and use that as
`--head`.

Production now carries merge commits that `main` doesn't, so a direct fast-forward push is no longer
possible and every release is a pull request. Roll back with **Instant Rollback** in Vercel, or fix
forward on `main` and release again. A rollback doesn't undo migrations, which is why they're written
expand/contract.

## What's already in place

| Thing        | Value                                                                                 |
| ------------ | ------------------------------------------------------------------------------------- |
| Neon project | `clippings`, id `young-forest-43160496`, PG 18, `aws-ap-southeast-1` (Singapore)      |
| Neon branch  | `production` (default), database `neondb`, role `neondb_owner`. No `development` yet. |
| Vercel team  | `Khanh Le's projects` (Hobby), id `team_qJyGOMbid155EAi33r67nuvY`                     |
| Vercel project | `clippings`, id `prj_lkLLi6zhR1BiGMIQ5JCP5BOgzwMV`, Next.js, Node 24.x, no env vars yet |

## One-time setup

### 1. Neon

Nothing to create by hand: the first `development` run creates branch `development` from
`production`. Create an **API key** (Console → Account settings → API keys) for GitHub.

### 2. Vercel project settings

Project → Settings:

1. **General → Root Directory**: `apps/web`, with "Include source files outside of the Root
   Directory" on.
2. **Functions → Function Region**: `sin1` (Singapore), next to Neon's `aws-ap-southeast-1`.
3. **Git → Production Branch**: `production`. It only labels things, since the CLI decides what is
   production, but it keeps the dashboard honest.
4. **Deployment Protection → Vercel Authentication**: it's on for `*.vercel.app` today. That puts
   production behind a Vercel login, so your friends can't open it. Set it to **Only Preview
   Deployments** (or add a custom domain, which it excludes). Leave previews and the
   development alias protected; they're only for you.
5. **Domains**: add the production domain if you have one.

The `main` deployment Vercel made on its own already shows an error page: it has no env vars. The
workflows replace it.

### 3. Vercel environment variables

Project → Settings → Environment Variables. Mark every secret **Sensitive**. Sensitive values can't
be pulled into a build, which is fine: the web app reads them only at runtime.

| Name                   | Production                          | Preview (development and PR previews)   |
| ---------------------- | ----------------------------------- | --------------------------------------- |
| `DATABASE_URL`         | Neon `production`, **pooled** URL   | none: the workflows pass the branch's   |
| `BETTER_AUTH_SECRET`   | `openssl rand -base64 32`           | a different value                       |
| `BETTER_AUTH_URL`      | `https://<production domain>`       | `https://<DEVELOPMENT_ALIAS>`           |
| `GOOGLE_CLIENT_ID`     | the Google OAuth client             | same                                    |
| `GOOGLE_CLIENT_SECRET` | the Google OAuth client             | same                                    |
| `ALLOWED_EMAILS`       | comma-separated emails              | same                                    |
| `QSTASH_TOKEN`         | the QStash token                    | same                                    |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash signing key            | same                                    |
| `QSTASH_NEXT_SIGNING_KEY`    | QStash next signing key       | same                                    |
| `QSTASH_URL`           | only if the QStash console shows one (a regional endpoint); not a secret | same |
| `ANTHROPIC_API_KEY`    | an Anthropic key (Haiku)            | same                                    |
| `CRON_SECRET`          | `openssl rand -base64 32`           | a different value                       |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | none: production isn't protected | the project's "Protection Bypass for Automation" secret |

Enrichment runs through QStash: saving publishes `{ clippingId }`, and QStash calls
`/api/jobs/enrich` on `BETTER_AUTH_URL` with a signature the handler checks, so that variable must be
the environment's public origin. The development alias is behind Vercel Authentication, which would
block QStash; the bypass secret lets it through. `QSTASH_URL` is where the app publishes to: the SDK
defaults to `https://qstash.upstash.io`, so an account in another region must set the endpoint its
console lists, or the token is rejected. A daily Vercel Cron (`vercel.json`, 04:00 UTC) calls
`/api/cron/sweep` with `CRON_SECRET` as a bearer token and re-publishes clippings stuck in pending or
failed for more than an hour. Vercel only runs crons on the production deployment.

### 4. Google OAuth client

Google Cloud Console → APIs & Services → Credentials → the client. Add to **Authorized JavaScript
origins** and **Authorized redirect URIs** (`<origin>/api/auth/callback/google`):

- `https://<production domain>`
- `https://<DEVELOPMENT_ALIAS>`
- `http://localhost:3100`

### 5. GitHub

Repo → Settings → Secrets and variables → Actions.

**Repository secrets**

| Secret                            | Value                                                       |
| --------------------------------- | ----------------------------------------------------------- |
| `VERCEL_TOKEN`                    | Vercel → Account Settings → Tokens                          |
| `VERCEL_ORG_ID`                   | `team_qJyGOMbid155EAi33r67nuvY`                             |
| `VERCEL_PROJECT_ID`               | `prj_lkLLi6zhR1BiGMIQ5JCP5BOgzwMV`                          |
| `NEON_PROJECT_ID`                 | `young-forest-43160496`                                     |
| `NEON_API_KEY`                    | the Neon API key from step 1                                |
| `PRODUCTION_DATABASE_URL_DIRECT`  | Neon `production` branch, **direct** (not pooled) URL       |

**Repository variable** (not a secret): `DEVELOPMENT_ALIAS`, a free `*.vercel.app` hostname for the
development environment, such as `clippings-dev.vercel.app`. If it's unset, development still
deploys, just without a stable URL.

**Hardening**: Settings → Rules has "Protect default and production branches" (pull request, status
checks, no force-push, no deletion) covering `main` and `production`. Optionally, Settings →
Environments → `production` → add yourself as a required reviewer, and limit deployment branches to
`production`.

Runtime secrets live only in Vercel; deploy and database credentials live only in GitHub.
Nothing goes in the repo. The development and preview databases need no stored URL: the workflows
ask Neon for it.

## Verify

1. **Development**: push to `main`. `development` creates branch `development`, migrates it and
   deploys; open `https://<DEVELOPMENT_ALIAS>` and sign in.
2. **Preview DB**: open a PR. Neon shows `preview/pr-<n>` with `drizzle.__drizzle_migrations` filled, and the
   run summary links the preview. Close the PR and the branch disappears.
3. **Release**: run the `git push` above. `release` migrates production and deploys. Sign in on the
   production domain from an allowlisted account that isn't yours, to check Vercel
   Authentication is off for production.
4. **Restore test** (optional; not run yet, the owner trusts Neon's restore). Branch `production`
   from a point in time inside the restore window, check a few rows, then delete the branch:

   ```bash
   neon branches create --project-id young-forest-43160496 --name restore-test \
     --parent <timestamp inside the window>
   psql "<restore-test direct URL>" -c 'select count(*) from "user"'
   neon branches delete restore-test --project-id young-forest-43160496
   ```

   Check `neon branches create --help` if the `--parent` form has changed.

## Things to know

- **Failed migration, no deploy.** Each deploy workflow migrates first and stops on error, so the
  environment keeps running the previous code.
- **Queued deploys.** A running deploy is never cancelled. GitHub keeps one pending run per
  concurrency group, so several pushes during one deploy collapse into the newest.
- **Development drifts.** The `development` branch is created from production once and then
  evolves with `main`'s migrations. To refresh it from production: Neon → Branches →
  `development` → Reset from parent.
- **Branch limit.** Launch includes 10 branches per project: `production`, `development` and one
  per open PR. Close PRs to free them.
- **Cost.** Storage is $0.35/GB-month and instant restore $0.20/GB-month, so a longer restore window
  raises the bill. Check Neon's billing page after changing it.
- **Fork PRs** get no preview database or deploy: they have no access to secrets.
