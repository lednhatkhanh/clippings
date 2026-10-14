# Clippings: hosting alternatives to GCP

Date: 2026-10-15 (prices, limits, ToS and versions checked against the vendors' own pages that day). Baseline: the GCP plan in `2026-10-14-stack-and-design.md` §3 and §12. That plan is Cloud Run on request-based billing (free tier), Cloud SQL PG 18 `db-f1-micro` (≈ $9.4/mo + backups), Cloud Tasks, Secret Manager, Artifact Registry, and Terraform + WIF. It costs **≈ $10–12/mo**, almost all of it Cloud SQL.

**Summary.**
- **The cheapest workable stack is Vercel Hobby + Neon Free + Upstash QStash, at $0/mo** (plus the domain). It runs every Next.js 16.4 feature natively, needs no Docker, WIF or Terraform, and keeps the Cloud Tasks shape: an HTTP callback with retries.
- **What you lose is `pg_textsearch` (BM25).** No managed Postgres host other than Cloud SQL offers it. Neon removed ParadeDB `pg_search` on 2026-09-21. Use the documented fallback (`tsvector` + GIN + `ts_rank_cd`), or Neon's own `lakebase_text`, which ties you to Neon.
- **Vercel Hobby ToS**: Hobby is "non-commercial personal use only". A free tool for ~5 friends with no revenue fits Vercel's own definition. Hobby pauses features when you hit a limit instead of billing you.
- **The smallest change, if leaving GCP is optional, is to keep Cloud Run + Cloud Tasks and swap only Cloud SQL for Neon Free.** That costs $0/mo and changes only the DB connection.
- **For full parity off GCP (BM25 included), self-host on a Hetzner ARM VPS with Docker Postgres + pg-boss for ≈ €7–8/mo.** You take on OS, backup and TLS ops, and Hetzner's cheap shared plans currently show "Currently not available".
- **Avoid**:
  - Cloudflare Workers via OpenNext: there are open Cache Components bugs, and the Free plan allows only 10 ms CPU per request.
  - Netlify: streaming is capped at 60 s, and running out of credits pauses every project.
  - Supabase Free: no backups, and PG 17 at most. Supabase Pro costs $25.
  - Fly Managed Postgres: from $38.
  - AWS: App Runner is closed to new customers, and Aurora takes ~15 s to resume from zero.

## Recommended stack (if adopted)

Only the rows that change from the 2026-10-14 table are listed.

| Area | Choice | Exact version (2026-10-15) | Source |
|---|---|---|---|
| App host | Vercel Hobby (Fluid compute, 300 s max duration) | — | [Hobby plan](https://vercel.com/docs/plans/hobby), [duration](https://vercel.com/docs/functions/configuring-functions/duration) |
| Framework output | Default Vercel build (drop `output: 'standalone'` and the Dockerfile, or keep them only as an exit path) | next 16.4.0 | [Next 16.4](https://nextjs.org/blog/next-16-4) |
| DB | Neon Free, PG 18, pgvector 0.8.6, `pg_trgm`; region close to the Vercel function region | PG 18.6 | [plans](https://neon.com/docs/introduction/plans), [extensions](https://neon.com/docs/extensions/pg-extensions) |
| Full-text search | `tsvector` (`setweight`) + GIN + `ts_rank_cd` (the §3 fallback); optional `lakebase_text` BM25 later | — | [lakebase search](https://neon.com/docs/ai/lakebase-search-get-started) |
| DB driver | `pg` with Neon's pooled URL for the app and the direct URL for migrations; or `@neondatabase/serverless` | pg 8.23.1 | [serverless driver](https://neon.com/docs/serverless/serverless-driver), [pooling](https://neon.com/docs/connect/connection-pooling) |
| Async jobs | Upstash QStash → Route Handler, verified with `verifySignatureAppRouter` | @upstash/qstash 2.12.0 | [QStash pricing](https://upstash.com/pricing/qstash), [Next.js quickstart](https://upstash.com/docs/qstash/quickstarts/vercel-nextjs) |
| Secrets | Vercel env vars (Sensitive) + GitHub Actions secrets | — | [env vars](https://vercel.com/docs/environment-variables) |
| IaC | None (dashboards + `vercel.json`). Optional: Terraform `vercel/vercel` only | provider 5.21.1 | [registry](https://registry.terraform.io/providers/vercel/vercel) |
| CI/CD | GitHub Actions: migrate (Neon direct URL) → `vercel build` → `vercel deploy --prebuilt --prod`. Neon branch per PR | neondatabase/create-branch-action v6.3.1 | [create-branch-action](https://github.com/neondatabase/create-branch-action) |
| Backups | Neon Free's 6 h restore window + nightly `pg_dump` from a scheduled GitHub Action to Cloudflare R2 (free up to 10 GB) | — | [Neon plans](https://neon.com/docs/introduction/plans), [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |

## 1. What the workload needs

From §10 of the stack research:
- ~5 allowlisted users and a few thousand rows. Embeddings for 3,000 rows at 1,024 floats each come to ~12 MB (my arithmetic).
- A few enrichment jobs a day. Each one fetches a page, calls Claude Haiku (~5–20 s) and writes an embedding. Each needs retries.
- An MCP endpoint (stateless, JSON or request-scoped SSE). Claude needs OAuth responses in under 10 s ([Claude connector auth](https://claude.com/docs/connectors/building/authentication)), so a database cold start must stay well under that.
- Better Auth tables live in the same Postgres.

Constraints that rule options in or out:
1. **Next.js 16.4 with Cache Components, `after()`, proxy and streaming** must work.
2. **pgvector** is required.
3. **BM25** would be nice to have; `tsvector` is acceptable.
4. **Durable background work** is required.
5. **Idle cost** should be near zero, because the app sits idle most of the day.

## 2. Postgres hosts

| Host | Cheapest usable tier | Idle behaviour | PG / pgvector | BM25 | Backups on that tier | Source |
|---|---|---|---|---|---|---|
| **Cloud SQL** (baseline) | `db-f1-micro` ≈ $9.4/mo + backups | Always on | 18 / 0.8.5 | `pg_textsearch` ✓ | Automated | §3 of the stack research |
| **Neon Free** | $0: 100 CU-h/project/mo, 1 GB storage/project, 5 GB egress, 10 branches | Suspends after 5 min idle; wakes in "a few hundred milliseconds" | 14–18 / **0.8.6** on PG 18 | ✗ (`pg_search` retired 2026-09-21); `lakebase_text` instead | 6 h restore window, 1 GB of changes, 1 snapshot | [plans](https://neon.com/docs/introduction/plans), [lifecycle](https://neon.com/docs/introduction/compute-lifecycle), [extensions](https://neon.com/docs/extensions/pg-extensions), [pg_search](https://neon.com/docs/extensions/pg_search) |
| **Neon Launch** | Usage-based, no minimum: $0.106/CU-h, $0.35/GB-mo, $0.20/GB-mo restore history | Same; can be made always-on | same | same | Up to 7 days (1 day by default) | [pricing](https://neon.com/pricing) |
| **Supabase Free** | $0: 500 MB DB, 2 projects, 5 GB egress | **Pauses after 1 week of inactivity** | 15 / 17 only (no 18); pgvector ≤ 0.8.2 | ✗ | **None** | [pricing](https://supabase.com/pricing), [image versions](https://raw.githubusercontent.com/supabase/postgres/develop/nix/ext/versions.json) |
| **Supabase Pro** | $25/mo (includes $10 compute credit) | Never paused | same | ✗ | Daily, 7 days; PITR +$100/mo | [pricing](https://supabase.com/pricing) |
| **Prisma Postgres** | Free: 200k operations/mo, 2 GB; Starter $10/mo | Not documented | 17; `vector` listed (version not given) | `pg_search` listed | Free: none listed; Starter: daily, 7 days | [pricing](https://www.prisma.io/pricing), [extensions](https://www.prisma.io/docs/postgres/database/postgres-extensions) |
| **Xata** | No free cloud tier; micro ≈ $9/mo ($0.012/h) | Scale-to-zero after 30 min; ~1 s wake; the HTTP proxy returns `409 BRANCH_HIBERNATED` | 14–18 / 0.8.1 | ✗ | Not documented | [pricing](https://xata.io/pricing), [scale-to-zero](https://xata.io/docs/core-concepts/scale-to-zero), [extensions](https://xata.io/docs/platform/extensions) |
| **Nile** | Free: 1 GB; Pro $15 | Not documented | ? / 0.8.0 | ✗ | Free: none; paid restores go through support | [pricing](https://www.thenile.dev/pricing), [backups](https://thenile.dev/docs/support/backup_restore.md) |
| **Aiven Free** | $0: 1 GB RAM, 1 GB disk, 20 connections; Developer $5/mo (8 GB) | Free service may be **powered off** when inactive; you can't pick the region | pgvector ✓ | ✗ (only `rum`) | Included (retention not stated) | [free tier](https://aiven.io/docs/products/postgresql/concepts/pg-free-tier), [free plan](https://aiven.io/docs/platform/concepts/free-plan), [extensions](https://aiven.io/docs/products/postgresql/reference/list-of-extensions) |
| **Render** | Free expires after **30 days**; Basic-256mb $6/mo | Always on | pgvector ✓ | ✗ | Paid: 3-day PITR on Hobby | [free](https://render.com/docs/free), [pricing](https://render.com/pricing), [backups](https://render.com/docs/postgresql-backups) |
| **Railway** | Hobby $5/mo includes $5 of usage; RAM $10/GB-mo, volume $0.15/GB-mo | Always on (container) | Any image: a pgvector template, and a community template with **`pg_textsearch`** | ✓ via template | Volume backups: daily, kept 6 days | [plans](https://docs.railway.com/reference/pricing/plans), [Postgres guide](https://docs.railway.com/guides/postgresql), [template](https://railway.com/deploy/postgresql-with-pgvectorscale-and-pg_textsearch--postgresql-with-pgvectorscale-and-pgtext), [backups](https://docs.railway.com/reference/backups) |
| **Self-hosted (VPS)** | VPS cost only | Always on | `pgvector/pgvector:pg18` (0.8.7) | ✓ `pg_textsearch` v1.5.1 (PG 17/18, PostgreSQL License, needs `shared_preload_libraries`) or ParadeDB `pg_search` 0.26.1 (AGPL) | Your job (pgBackRest 2.59.3, WAL-G 3.0.9) | [pgvector](https://github.com/pgvector/pgvector), [pg_textsearch](https://github.com/timescale/pg_textsearch), [releases](https://github.com/timescale/pg_textsearch/releases), [ParadeDB](https://github.com/paradedb/paradedb/releases), [pgBackRest](https://github.com/pgbackrest/pgbackrest/releases) |

**Notes**
- **BM25 is the main casualty of leaving Cloud SQL.**
  - No managed host here lists `pg_textsearch`.
  - Neon's replacement `lakebase_text` uses the same `<@>` operator style (`body_tsv <@> to_bm25query(...)`), needs PG 16+, and is Neon-only ([get started](https://neon.com/docs/ai/lakebase-search-get-started)).
  - At a few thousand rows per user, `ts_rank_cd` over a weighted `tsvector` with a GIN index is good enough. Wrap search behind one function in `packages/db` so the ranking can be swapped later.
- **Neon details that matter**:
  - The pooler is PgBouncer in transaction mode, so no session `SET`, LISTEN/NOTIFY or session advisory locks. Use the direct URL for migrations ([pooling](https://neon.com/docs/connect/connection-pooling)).
  - `pg_cron` runs only while compute is active ([extensions](https://neon.com/docs/extensions/pg-extensions)).
  - `pgmq` is not supported.
  - EU regions are AWS Frankfurt and London ([regions](https://neon.com/docs/introduction/regions)).
  - Neon (part of Databricks) cut Launch compute to $0.106/CU-h in Nov 2025 ([blog](https://neon.com/blog/major-compute-price-reduction-on-neon)) and raised Free storage to 1 GB per project on 2026-10-02 ([changelog](https://neon.com/docs/changelog/2026-10-02)).
- **Neon Launch at this scale** (my estimate): about 2 active hours a day at 0.25 CU is 15 CU-h × $0.106 ≈ $1.60, plus cents of storage and history, so **≈ $2/mo**. That buys up to 7 days of restore.
- **Supabase**:
  - A daily digest write probably prevents the one-week pause, but Free has **no backups**. Pro at $25/mo costs more than the GCP baseline.
  - `pgmq` (Supabase Queues) is the one thing Supabase offers that Neon doesn't ([queues](https://supabase.com/docs/guides/queues)).
  - Direct connections are IPv6-only unless you buy the IPv4 add-on; the Supavisor pooler works over IPv4 ([connecting](https://supabase.com/docs/guides/database/connecting-to-postgres)).
- **Fly Managed Postgres** starts at $38/mo ([MPG](https://docs.fly.io/mpg)). **Aurora Serverless v2** scales to 0 ACU but takes ~15 s to resume (30 s+ after 24 h), which breaks Claude's 10 s OAuth budget ([auto-pause](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html)). Both are out.

**Recommendation**: **Neon Free** (PG 18, pgvector 0.8.6, max autoscale 0.25–0.5 CU) with `tsvector` search. Move to Launch (≈ $2/mo) if you want more than 6 h of restore history. Alternatively, keep Free and add a nightly `pg_dump` (§6).

## 3. Non-Postgres options (Cloudflare D1, Turso)

| | Cloudflare D1 | Turso (libSQL) |
|---|---|---|
| Free tier | 500 MB/DB, 5M rows read and 100k written per day (hard stop) | 100 DBs, 5 GB, 500M reads and 10M writes per month |
| Vectors | None in D1; a separate **Vectorize** index (free: 30M queried and 5M stored dimensions per month, max 1,536 dims) | Native `F32_BLOB` + DiskANN `libsql_vector_idx` + `vector_top_k` |
| Full-text | FTS5 with `bm25()` | FTS5; a Tantivy FTS in the new engine (experimental) |
| Status | GA | **Supabase is acquiring Turso** (announced 2026-10-02); the Rust rewrite is v0.8.3, pre-1.0 |
| Sources | [limits](https://developers.cloudflare.com/d1/platform/limits/), [pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Vectorize](https://developers.cloudflare.com/vectorize/platform/pricing/) | [pricing](https://turso.tech/pricing), [vectors](https://docs.turso.tech/features/ai-and-embeddings), [acquisition](https://supabase.com/blog/supabase-is-acquiring-turso), [releases](https://github.com/tursodatabase/turso/releases) |

What would break:
- The SQL dialect changes from Postgres to SQLite, so every migration and query in `packages/db` changes.
- `embedding <=> $1` becomes a libSQL vector function, or on D1 a second service with no joins.
- `ts_rank_cd` / `pg_textsearch` becomes FTS5 `bm25()`.
- Better Auth works with D1 through its Kysely adapter, but its CLI can't reach D1, so migrations have to run in code ([Better Auth DB](https://www.better-auth.com/docs/concepts/database)).

**Recommendation**: not worth it. Postgres is already free on Neon, so there's no saving to justify the rewrite.

## 4. App hosts for Next.js 16.4

| Host | Price at this scale | Next 16.4 features | Background work after the response | MCP streaming | Notes / risk |
|---|---|---|---|---|---|
| **Vercel Hobby** | $0 | Native; Cache Components, `after()`, proxy and streaming all work | `after()`/`waitUntil` share the function timeout: **300 s** default and max | Within 300 s | Non-commercial only; one user; pauses on limits; can't connect org-owned Git repos |
| **Cloudflare Workers + OpenNext** | Free is unrealistic (10 ms CPU/request); Paid **$5/mo** | `@opennextjs/cloudflare` 1.20.11 peers `next >=16.3.8`. Docs list `after`, PPR and `'use cache'`, but **Cache Components issues are open** (#1450: HTTP 500 / hang on 16.3.8). `proxy.ts` is experimental | `waitUntil` up to **30 s** | No wall-clock limit on HTTP | Postgres through Hyperdrive (free: 100k queries/day) |
| **Netlify** | Free: 300 credits/mo, hard cap; Personal $9 | OpenNext adapter 5.16.2; `after`, Cache Components and streaming marked supported | Within the 60 s function limit; background functions up to 15 min | **60 s streaming cap** | 15 credits per production deploy (~20 deploys/mo). Running out **pauses all projects** |
| **Fly.io** | No free tier. shared-cpu-1x 512 MB $3.69/mo always on; ≈ $0–2 with auto-stop | Docker `standalone`: full parity | Works while the Machine runs; auto-stop can cut it off | No limit | ~2 s cold start from stopped; Terraform provider archived |
| **Railway** | Hobby $5 (includes $5 of usage) | Docker: full parity | Works (always-on) | No limit | "Serverless" sleep after 5 min idle; first request "may return a 502" |
| **Render** | Free sleeps after 15 min (~1 min wake); Starter $7 | Docker/Node: full parity | Works on paid | No limit | Free cold start is far too slow for MCP OAuth |
| **Hetzner VPS** | CAX11 €5.99 / CX23 €5.49 + IPv4 €0.50 (+20% backups), excl. VAT | Docker: full parity | Unlimited (always-on) | No limit (Kamal proxy `response_timeout` defaults to 30 s, so raise it) | You run the OS, TLS and backups. EU only; cheapest US type is CPX11 €17.49 |
| **AWS (OpenNext/SST + Lambda)** | Lambda 1M requests + 400k GB-s free per month | OpenNext AWS 4.1.10 has open Next 16.3 bugs; SST docs don't mention Next 16 | Lambda timeout | Lambda timeout | App Runner closed to new customers since 2026-04-30 |

Details and sources:
- **Vercel Hobby**
  - **ToS**: "You shall only use the Services under a Hobby plan for your personal or non-commercial use" ([terms](https://vercel.com/legal/terms)). Commercial means "financial gain of anyone involved" ([fair use](https://vercel.com/docs/limits/fair-use-guidelines)).
  - **Monthly allowance**: 4 Active CPU-hours, 360 GB-h memory, 1M invocations, 100 GB Fast Data Transfer, 10 GB Fast Origin Transfer ([Hobby](https://vercel.com/docs/plans/hobby)).
  - **Other limits**: cron at most once a day, firing anywhere within the hour ([cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)); 100 deployments a day; no org-owned repos ([limits](https://vercel.com/docs/limits)).
  - **Over a limit** you "wait until 30 days have passed"; Hobby cannot buy more ([Hobby](https://vercel.com/docs/plans/hobby)).
  - **`waitUntil` promises** "have the same timeout as the function itself" ([functions API](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)).
  - **Pro** is $20/mo with $20 of usage: 800 s functions, per-minute cron, overage billing instead of pausing ([Pro](https://vercel.com/docs/plans/pro-plan)).
  - **MCP**: Vercel documents `mcp-handler` 2 over Streamable HTTP. The handler "does not issue tokens or run an authorization server", so Better Auth keeps that job ([deploy MCP](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel)).
- **Cloudflare**
  - **Worker size**: the old 3/10 MB caps are gone; the limit is now 64 MiB uncompressed ([changelog](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/)).
  - **CPU**: Free gets 10 ms per request; Paid gets 30 s by default, up to 5 min. `waitUntil` runs up to 30 s ([limits](https://developers.cloudflare.com/workers/platform/limits/)).
  - **OpenNext support**: [docs](https://opennext.js.org/cloudflare), [releases](https://github.com/opennextjs/opennextjs-cloudflare/releases), [Cache Components issues](https://github.com/opennextjs/opennextjs-cloudflare/issues?q=cacheComponents).
  - **Hyperdrive** needs `pg` ≥ 8.16.3 ([pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/), [connect](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-postgres/)).
- **Netlify**: [credits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/), [paused projects](https://docs.netlify.com/manage/accounts-and-billing/billing/resume-paused-projects/), [Next.js support](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), [function limits](https://docs.netlify.com/build/functions/configuration/).
- **Fly.io**
  - "New organizations don't have a free tier or a monthly free usage allowance". A stopped Machine pays only for its rootfs, at $0.15/GB-mo. Shared IPv4 is free ([pricing](https://docs.fly.io/about/pricing)).
  - Auto-stop: [autostop](https://docs.fly.io/launch/autostop-autostart). Resume timings: [suspend](https://fly.io/docs/reference/suspend-resume/).
- **Railway**: [pricing](https://railway.com/pricing), [app sleeping](https://docs.railway.com/reference/app-sleeping).
- **Render**: [free](https://render.com/docs/free), [pricing](https://render.com/pricing).
- **Hetzner**
  - Prices rose on 2026-04-01 and again on 2026-06-15: CX23 €3.99 → €5.49, CAX11 €4.49 → €5.99, and neither is sold in the US ([price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)).
  - Primary IPv4 is €0.50/mo ([IPv4](https://docs.hetzner.com/general/others/ipv4-pricing/)). Backups cost 20% of the server price ([billing FAQ](https://docs.hetzner.com/cloud/billing/faq/)).
  - The cloud page shows "Currently not available" under shared plans ([cloud](https://www.hetzner.com/cloud/)).
- **Other VPS options**
  - DigitalOcean: $4 (512 MiB, too small for Next + Postgres) or $6 (1 GiB) ([pricing](https://www.digitalocean.com/pricing/droplets)).
  - Oracle Always Free A1 is now "equivalent to 2 OCPUs and 12 GB". Instances are reclaimed if CPU p95, network and memory all stay under 20% for 7 days, and a low-traffic app is exactly that ([Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)).
- **VPS deploy tools**
  - Kamal 2.12.0: `proxy.ssl: true` gives Let's Encrypt on a single host ([proxy](https://kamal-deploy.org/docs/configuration/proxy/), [releases](https://github.com/basecamp/kamal/releases)).
  - Coolify 4.4.6 needs 2 cores, 2 GB RAM and 10 GB disk ([install](https://coolify.io/docs/get-started/installation)).
  - Dokploy 0.30.8 needs 2 GB RAM and 30 GB disk ([install](https://docs.dokploy.com/docs/core/installation)).
  - Kamal adds no RAM overhead, so prefer it on a small box.
- **AWS**
  - OpenNext AWS 4.1.10 and its open Next 16.3 bugs: [releases](https://github.com/opennextjs/opennextjs-aws/releases), [#1237](https://github.com/opennextjs/opennextjs-aws/issues/1237).
  - SST 4.17.2 component docs: [nextjs](https://sst.dev/docs/component/aws/nextjs/).
  - The new-account Free plan ends after 6 months or when the credits run out ([FAQ](https://aws.amazon.com/free/free-tier-faqs/)).
  - App Runner: [notice](https://aws.amazon.com/apprunner/).

**Recommendation**: **Vercel Hobby**. Next.js 16.4 is first-class there and it costs nothing at this scale. Its 300 s function cap covers a 5–20 s enrichment, and the use is plainly personal and non-commercial. Keep the code portable (Route Handlers, no Vercel-only APIs except optionally `@vercel/functions`) so the Docker exit path stays open.

## 5. Background jobs (replacing Cloud Tasks)

| Option | Free tier | Fit | Source |
|---|---|---|---|
| **`after()` on Vercel** | Included | Runs up to 300 s after the response, but **no retries or durability**. Fine as a fast path if a sweeper re-queues `pending` rows | [functions API](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package) |
| **Upstash QStash** | 1,000 messages/day (retries count), **15 min response time**, 3-day DLQ, 10 queues | HTTP push to a Route Handler with retries and backoff: the same shape as Cloud Tasks. Works from any host. Verify with `verifySignatureAppRouter` (`QSTASH_CURRENT_SIGNING_KEY` / `_NEXT_`) | [pricing](https://upstash.com/pricing/qstash), [retry](https://upstash.com/docs/qstash/features/retry), [quickstart](https://upstash.com/docs/qstash/quickstarts/vercel-nextjs) |
| **Vercel Queues** | **Beta**, all plans; first 1M operations included on Hobby | At-least-once; `handleCallback` route + `experimentalTriggers` in `vercel.json`; no built-in DLQ; messages tied to the sending deployment. `@vercel/queue` 0.8.0 | [queues](https://vercel.com/docs/queues), [pricing](https://vercel.com/docs/queues/pricing), [concepts](https://vercel.com/docs/queues/concepts) |
| **Vercel Workflow** | Hobby: 50k events + 1 GB written per month, 1-day run state; GA since 2026-04-16 | Durable steps; ~3 events per step. `workflow` 5.2.2 | [pricing](https://vercel.com/docs/workflows/pricing), [GA post](https://vercel.com/blog/a-new-programming-model-for-durable-execution) |
| **Inngest** | 50k executions/mo, 5 concurrent steps, 24 h history; runs pause when the quota is hit | `serve()` at `app/api/inngest/route.ts`. `inngest` 4.24.0 | [pricing](https://www.inngest.com/pricing), [Next quickstart](https://www.inngest.com/docs/getting-started/nextjs-quick-start) |
| **Trigger.dev** | $5/mo usage credit | Task code deploys separately to Trigger.dev compute, which is a second deploy target. SDK 4.7.4 | [pricing](https://trigger.dev/pricing), [how it works](https://trigger.dev/docs/how-it-works) |
| **Cloudflare Queues / Workflows** | Queues on Free since 2026-02-04: 10k ops/day, 24 h retention. Workflows Free: 3,000 steps/day, 10 ms CPU/step | Only if the app is on Workers | [queues free](https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/), [pricing](https://developers.cloudflare.com/queues/platform/pricing/), [workflows](https://developers.cloudflare.com/workflows/reference/pricing/) |
| **pg-boss / graphile-worker** | $0 (your Postgres) | Need an **always-on** process for `work()` polling, so VPS, Railway or Fly only. pg-boss 12.38.0 (Node ≥ 22.12, PG ≥ 13); graphile-worker 0.18.0. Starting pg-boss from `instrumentation.ts` `register()` is plausible but not documented by either project | [pg-boss](https://github.com/timgit/pg-boss), [workers](https://pgboss.io/api/workers), [graphile-worker](https://worker.graphile.org/docs/requirements), [instrumentation](https://nextjs.org/docs/app/guides/instrumentation) |
| **pgmq** | Supabase Queues only; not on Neon | Pull-based, so it still needs a consumer. pgmq 1.13.0 | [pgmq](https://github.com/pgmq/pgmq/releases), [Supabase Queues](https://supabase.com/docs/guides/queues) |

**Recommendation**: **QStash**. It is the closest drop-in for Cloud Tasks: the app still publishes an HTTP task and a Route Handler still does the work, with retries and backoff. It costs $0 at a few jobs a day and works the same on Vercel, Fly, a VPS or Cloud Run.
- Swap `@google-cloud/tasks` + OIDC verification for `@upstash/qstash` `publishJSON` + `verifySignatureAppRouter`.
- Keep the `pending` status column and a daily Vercel cron sweeper that re-publishes rows stuck in `pending`/`failed`.
- **Runner-up**: Vercel Workflow, if you're happy tying jobs to Vercel. Vercel Queues is still beta.

## 6. Secrets, CI/deploy, IaC

| Stack | Secrets | Deploy from GitHub Actions | IaC | Preview deployments |
|---|---|---|---|---|
| Vercel + Neon | Vercel env vars per environment (Sensitive = write-only, 64 KB per deployment) ([env](https://vercel.com/docs/environment-variables)) | `VERCEL_TOKEN` + `vercel build` / `vercel deploy --prebuilt`, or the Git integration | Optional: `vercel/vercel` 5.21.1 ([registry](https://registry.terraform.io/providers/vercel/vercel)). Neon has only the **archived** community `kislerdm/neon` 0.18.0; Neon's own `neondatabase/neon` is not on the registry yet ([kislerdm](https://github.com/kislerdm/terraform-provider-neon), [Neon docs](https://neon.com/docs/reference/terraform), [neondatabase repo](https://github.com/neondatabase/terraform-provider-neon)) | Built in, with Vercel Authentication on Hobby ([Hobby](https://vercel.com/docs/plans/hobby)). Neon branch per PR via `create-branch-action` v6 (outputs `db_url`, `db_url_pooled`) or the Neon GitHub App ([action](https://github.com/neondatabase/create-branch-action), [integration](https://neon.com/docs/guides/neon-github-integration)) |
| Cloudflare | `wrangler secret` | `cloudflare/wrangler-action@v4` + `CLOUDFLARE_API_TOKEN` ([CI](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)) | `cloudflare/cloudflare` 5.28.0 ([registry](https://registry.terraform.io/providers/cloudflare/cloudflare)) | Worker versions/previews |
| Fly.io | `fly secrets set` (restarts Machines; `--stage` to batch) ([secrets](https://docs.fly.io/apps/secrets/)) | `superfly/flyctl-actions/setup-flyctl` + `FLY_API_TOKEN` ([action](https://github.com/superfly/flyctl-actions)) | **None maintained** (`fly-apps/fly` archived 2024-03-01) ([repo](https://github.com/fly-apps/terraform-provider-fly)) | Manual (separate app) |
| Hetzner + Kamal | `.kamal/secrets` from GitHub secrets | SSH key in GitHub secrets, `kamal deploy` | `hetznercloud/hcloud` 1.70.0 ([repo](https://github.com/hetznercloud/terraform-provider-hcloud)) | None (single box) |
| Railway / Render | Dashboard variables | Git integration or CLI | Community `railway` 0.6.2 / official `render-oss/render` 1.9.1 ([railway](https://github.com/terraform-community-providers/terraform-provider-railway), [render](https://render.com/docs/terraform-provider)) | Railway PR environments; Render previews |
| Upstash | Dashboard tokens | — | `upstash/upstash` 2.1.0 (no release in over a year) ([registry](https://registry.terraform.io/providers/upstash/upstash)) | — |

**Recommendation for Vercel + Neon + QStash**: **drop Terraform**. The whole setup is three dashboards and about ten env vars, and Neon's provider is in transition. Keep `ci.yml` unchanged. Replace `deploy.yml` with:
1. Run migrations against Neon's **direct** URL (from a GitHub secret).
2. `vercel pull --environment=production`, `vercel build --prod`, `vercel deploy --prebuilt --prod`.

Migrations must run before traffic, as in §12, so production deploys come from Actions, not the Git integration. Previews can stay on the Git integration, pointing at a Neon branch per PR. Free allows 10 branches per project, so delete branches on PR close ([delete-branch-action](https://github.com/neondatabase/delete-branch-action)).

**Backups on Neon Free**: add a scheduled workflow that runs `pg_dump -Fc` on the direct URL each night and uploads to R2. R2 is free up to 10 GB with free egress ([R2](https://developers.cloudflare.com/r2/pricing/)). Neon Free keeps only 6 h of restore history.

## 7. Cross-cutting impacts

- **MCP over HTTP**: the 2026-07-28 spec is stateless, so serverless is fine. Ceilings per request: Vercel Hobby 300 s, Netlify 60 s (streaming included), Cloudflare unlimited wall-clock, VPS/Fly/Railway unlimited. MCP tool calls here (search, save) take well under a second, so only Netlify's cap is a concern, and only for long SSE responses.
- **OAuth callback URLs**:
  - Add the new production origin to the Google OAuth client's redirect URIs and to Better Auth's `baseURL`/trusted origins.
  - `https://claude.ai/api/mcp/auth_callback` and the extension's `chromiumapp.org` redirect don't change.
  - Preview URLs change per deployment, so either don't use Google sign-in on previews or give previews one fixed alias.
- **Custom domain + TLS**: free and automatic on Vercel (50 domains/project), Fly (first 10 certs free), Railway (2 domains on Hobby) and Kamal (Let's Encrypt). Cloud Run domain mapping is no longer needed.
- **Cold starts**:
  - Neon wakes in a few hundred ms; it suspends after 5 min idle.
  - Vercel Fluid compute: no number was found (see Unverified).
  - Fly from stopped: ~2 s.
  - Render Free: ~1 min. Aurora from zero: ~15 s. Both are too slow for the 10 s OAuth budget.
  - Cloud Run with min 0 had a cold start too, so Vercel + Neon is no worse.
- **Region and latency**: put Neon and the Vercel function region in the same place, e.g. AWS Frankfurt (`aws-eu-central-1`) with Vercel `fra1`, or `us-east-1` with `iad1`. A function and database on different continents add ~100 ms per query round trip.
- **Backups / PITR**:

  | Host | What you get |
  |---|---|
  | Cloud SQL | Automated backups (billed) |
  | Neon Free | 6 h restore window |
  | Neon Launch | Up to 7 days |
  | Supabase Free / Render Free | None |
  | VPS | Whatever you build |

- **Egress**: Vercel Hobby includes 100 GB of Fast Data Transfer; Neon Free includes 5 GB per project. Both are orders of magnitude above this app's needs. QStash bills per message, not per byte.

## 8. Full-stack combinations

Costs are monthly estimates at this scale (~5 users, a few jobs a day, <100 MB of data). They exclude the domain, the Anthropic API and GitHub Actions, which are the same for every option.

| # | Combination | Est. cost/mo | What changes in the plan / codebase | Risks | Ops burden |
|---|---|---|---|---|---|
| 0 | **GCP baseline**: Cloud Run + Cloud SQL f1-micro + Cloud Tasks | **≈ $10–12** | — | f1-micro has no SLA and only 0.6 GB RAM | Medium: Terraform, WIF, AR cleanup |
| 1 | **Vercel Hobby + Neon Free + QStash** | **$0** (≈ $2 with Neon Launch for 7-day restore) | Drop Dockerfile/standalone, Terraform, WIF, AR, Cloud Run Job. Cloud Tasks → QStash. `pg_textsearch` → `tsvector` + GIN. Unix socket → Neon pooled URL | Hobby ToS (personal only), pauses at limits, single seat, no org repos. Neon Free 6 h restore. BM25 lost | **Low** |
| 2 | **Cloud Run + Neon Free + Cloud Tasks** (GCP minus Cloud SQL) | **≈ $0** (+ AR storage beyond 0.5 GB) | Only the DB connection changes (TLS URL instead of the Cloud SQL socket) and `pg_textsearch` → `tsvector`. §12 stays almost intact | Cross-cloud hop (GCP ↔ AWS; pick the same metro). Still Terraform + WIF | Medium |
| 3 | **Cloudflare Workers Paid + OpenNext + Neon via Hyperdrive + Queues** | **$5** | OpenNext build + `wrangler.jsonc`, Hyperdrive binding, Queues consumer instead of a Route Handler callback, `waitUntil` ≤ 30 s | **Open Cache Components bugs in OpenNext**, so the core rendering model is at risk. Most lock-in of all the options | Medium |
| 4 | **Fly.io (512 MB, auto-stop) + Neon Free + QStash** | **≈ $0–4** | Keep the Docker `standalone` image; `fly.toml` instead of Terraform; QStash replaces Cloud Tasks (its HTTP call wakes the Machine) | No free tier, so the card is charged from the first dollar. ~2 s cold start. Terraform provider dead. `after()` can be cut off when the Machine stops | Low–medium |
| 5 | **Vercel Hobby + Supabase Free (+ pgmq or QStash)** | **$0** (or $25 with Supabase Pro) | Like #1, but PG 17 and pgvector 0.8.2; Supavisor transaction mode needs `prepare: false` | Free pauses after a week idle and **has no backups**. Pro costs twice the baseline | Low |
| 6 | **Hetzner CAX11 VPS + Docker Postgres (pgvector + `pg_textsearch`) + pg-boss + Kamal** | **≈ €7.7 (~$9)**: €5.99 + €0.50 IPv4 + 20% backups, excl. VAT | Keep the Docker image; add a Postgres image with `pg_textsearch` in `shared_preload_libraries`. Cloud Tasks → pg-boss worker in-process. `kamal-proxy` for TLS. pgBackRest/`pg_dump` → R2 | You own patching, TLS, backups and monitoring. Hetzner shows "Currently not available" for cheap shared plans. EU-only pricing | **High** |

Rejected (no combo row): Netlify (60 s streaming cap; credit exhaustion pauses everything), Render (Free DB expires after 30 days, and paid $7 + $6 beats nothing), Railway (≈ $5–10 for always-on app + DB, the same as GCP, though it is the easiest way to keep `pg_textsearch` managed), AWS (App Runner closed, Aurora resume ~15 s, too much setup), Oracle Free (idle reclamation), D1/Turso (§3).

## 9. Recommendation

**Adopt #1: Vercel Hobby + Neon Free + Upstash QStash. It costs $0/mo against ≈ $10–12/mo on GCP.**
- **Why**:
  - It is the cheapest option, with the least ops.
  - Next.js 16.4 runs natively (Cache Components, `after()`, proxy, streaming).
  - QStash keeps the Cloud Tasks pattern, so the enrichment route barely changes.
  - Neon has PG 18 with a newer pgvector (0.8.6) and wakes in a few hundred ms.
- **Accept**:
  1. `tsvector` ranking instead of BM25.
  2. The Hobby terms: personal, non-commercial, one seat, the repo under a personal GitHub account, and features pause at limits.
  3. A 6 h restore window, mitigated by a nightly `pg_dump` to R2, or Neon Launch at ≈ $2/mo.
- **Exit path**: the app stays a plain Next.js app with Route Handlers and `pg`, and QStash is host-agnostic, so moving to #4 or #6 later means adding a Dockerfile, not a rewrite.

**Runner-up (still off GCP, keeps BM25): #6, Hetzner VPS + Kamal.** Pick it if `pg_textsearch` matters more than ops time, or if Vercel's Hobby terms stop fitting, for example if the app ever earns money. It costs ≈ €7.7/mo.

**If leaving GCP isn't required: #2.** Keep Cloud Run + Cloud Tasks and replace only Cloud SQL with Neon Free. That removes ~90% of the bill with the smallest change to the plan.

## 10. Edits to `2026-10-14-stack-and-design.md` if #1 is adopted

1. **Summary bullets**:
   - Replace "Cloud Run + Cloud SQL PG 18 (pgvector 0.8.5 + `pg_textsearch`)" with "Vercel Hobby + Neon Free PG 18 (pgvector 0.8.6; `tsvector` search) + QStash".
   - Replace "Terraform google provider 8.7, GitHub Actions with WIF" with "GitHub Actions + Vercel CLI; no Terraform".
   - Rewrite "Five things differ" item 5: on Vercel, `after()` runs up to 300 s but isn't durable, so QStash provides retries.
2. **Recommended stack table**:
   - **Framework**: drop `output: 'standalone'`, or keep it only as an exit path.
   - **DB driver**: `pg` with the Neon pooled URL (app) and direct URL (migrations); remove `@google-cloud/cloud-sql-connector`.
   - **DB**: Neon Free PG 18, pgvector 0.8.6, `pg_trgm`; no `pg_textsearch`.
   - **Async jobs**: `@upstash/qstash` 2.12.0 instead of `@google-cloud/tasks`.
   - **IaC**: none (optional `vercel/vercel` 5.21.1).
   - **CI/CD**: remove `google-github-actions/*`, `docker/*` and `hashicorp/setup-terraform`; add the Vercel CLI and `neondatabase/create-branch-action` v6 / `delete-branch-action` v3.
3. **§3** becomes "Infra on Vercel + Neon":
   - The Neon project: region matched to the Vercel function region, PG 18, max 0.25–0.5 CU, 5 min suspend.
   - Search: a weighted `tsvector` column (generated) + GIN + `ts_rank_cd`, behind one `searchClippings()` function.
   - QStash: retries/backoff, signature verification, and the `pending` sweeper on a daily Vercel cron.
   - The Hobby limits table from §4 above.
   - Delete the Cloud SQL, Cloud Run, Cloud Tasks and Terraform subsections, or move them to an appendix as "GCP option".
4. **§4**:
   - "Cloud Tasks callback" row → "QStash callback: `POST app/api/tasks/enrich/route.ts` wrapped in `verifySignatureAppRouter`".
   - "Background work" row → `after()` is bounded by the 300 s function limit on Vercel; QStash does the durable work.
   - "Deploy" row → one Vercel project.
   - "Docker for Cloud Run" bullets: drop them or mark them as exit-path only.
   - Remove the "max-instances 1–2 sidesteps the shared cache" reasoning, since Vercel scales instances itself. Re-check how `'use cache'` behaves across Vercel instances (see Unverified).
5. **§10**:
   - "Smallest Cloud SQL tier" → "Neon Free".
   - "Keep Cloud Tasks" → "QStash (free tier: 1,000 messages/day)".
   - "`max-instances` 1–2 on Cloud Run" → remove.
6. **§12**:
   - Remove WIF, Artifact Registry, the Cloud Run Job, `deploy-cloudrun`, `terraform.yml` and the bootstrap steps.
   - New `deploy.yml`: checkout → pnpm/node setup → `pnpm --filter db migrate` (direct `DATABASE_URL` secret) → `vercel pull/build/deploy --prebuilt --prod` with `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
   - New `preview-db.yml`: a Neon branch per PR, deleted on close.
   - New `backup.yml`: nightly `pg_dump` → R2.
   - Runtime secrets (`ANTHROPIC_API_KEY`, `BETTER_AUTH_SECRET`, Google OAuth secret, `DATABASE_URL`, `QSTASH_*`) move to Vercel env vars.
   - The cost notes lose the Artifact Registry line.
7. **"Changes to the brief"**: in the DB and save-flow decisions, replace Cloud SQL / Cloud Tasks with Neon / QStash. In M0, replace "Terraform bootstrap + WIF" with "Vercel + Neon + QStash projects, GitHub secrets". Add "Not using: GCP, Terraform, Docker (for now)".

## Unverified / could not confirm

- **Cloud SQL `pg_textsearch` status**: Google's extensions page lists it with no Preview label ([extensions](https://docs.cloud.google.com/sql/docs/postgres/extensions)). Tiger Data's 2026-09-21 press release calls it "public preview", with GA "expected later this year" ([press release](https://www.tigerdata.com/newsroom/google-cloud-brings-native-bm25-full-text-search-to-alloydb-and-cloud-sql-via-tiger-datas-pg_textsearch)).
- Whether Neon's `lakebase_text` is available on the Free plan, whether it needs a compute restart, and its price. The get-started page doesn't say.
- How many build minutes Vercel Hobby includes (the pricing page says only "Basic machines included"). Whether Hobby lets you pick the function region. Vercel Fluid compute cold-start times.
- How `'use cache'` / Cache Components data is shared across Vercel function instances, and whether Vercel handles the `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` / `deploymentId` concerns from the self-hosting guide automatically. Not checked.
- Whether `vercel deploy --prebuilt` from Actions works for a Hobby project in an org-owned repo (the limit documented is for the Git integration).
- The QStash maximum retry count on Free; the pricing page doesn't state it.
- Railway: the Hobby volume cap (5 GB in the docs vs "1 TB" on the pricing page), whether Railway Postgres is always-on by default, and the ~$5–10/mo estimate for app + DB.
- Hetzner: snapshot price per GB; whether backups are still 20% after the June 2026 change; what the "Currently not available" label covers and how long it will last; CAX11/CX23 vCPU and RAM sizes (not re-read today).
- Fly.io: no "bills under $5 waived" policy appears on the current pricing or billing pages. Assume none.
- Prisma Postgres scale-to-zero behaviour and PITR; Nile's PG version and cold starts; Xata backup retention.
- Cloud Run → Neon (internet) egress cost: assumed negligible at this volume, not priced.
- Free-tier ToS for commercial use at Neon, Upstash, Supabase and Prisma (not read; irrelevant for a non-commercial app).
- Whether OpenNext Cloudflare has been tested on Next 16.4.0 stable; only a 16.4 canary issue exists.

## Sources

**Postgres hosts**
- Neon: https://neon.com/docs/introduction/plans · https://neon.com/pricing · https://neon.com/docs/introduction/compute-lifecycle · https://neon.com/docs/extensions/pg-extensions · https://neon.com/docs/extensions/pg_search · https://neon.com/docs/ai/lakebase-search-get-started · https://neon.com/docs/changelog/2026-06-26 · https://neon.com/docs/changelog/2026-10-02 · https://neon.com/blog/major-compute-price-reduction-on-neon · https://neon.com/docs/serverless/serverless-driver · https://neon.com/docs/connect/connection-pooling · https://neon.com/docs/introduction/regions · https://neon.com/docs/postgresql/postgres-version-policy · https://neon.com/docs/reference/terraform · https://neon.com/docs/guides/neon-github-integration
- Supabase: https://supabase.com/pricing · https://supabase.com/docs/guides/platform/upgrading · https://github.com/supabase/postgres · https://supabase.com/docs/guides/database/connecting-to-postgres · https://supabase.com/docs/guides/queues · https://supabase.com/docs/guides/deployment/terraform
- Prisma Postgres: https://www.prisma.io/pricing · https://www.prisma.io/docs/postgres · https://www.prisma.io/docs/postgres/database/postgres-extensions · https://www.prisma.io/docs/postgres/database/direct-connections · https://www.prisma.io/docs/postgres/iac/terraform
- Xata: https://xata.io/pricing · https://xata.io/docs/core-concepts/scale-to-zero · https://xata.io/docs/platform/extensions · https://xata.io/docs/changelog
- Nile: https://www.thenile.dev/pricing · https://thenile.dev/docs/support/backup_restore.md · https://thenile.dev/docs/extensions/vector.md
- Aiven: https://aiven.io/docs/products/postgresql/concepts/pg-free-tier · https://aiven.io/docs/platform/concepts/free-plan · https://aiven.io/pricing?product=pg · https://aiven.io/docs/products/postgresql/reference/list-of-extensions
- Render / Railway: https://render.com/pricing · https://render.com/docs/free · https://render.com/docs/postgresql-backups · https://render.com/docs/postgresql-extensions · https://docs.railway.com/reference/pricing/plans · https://docs.railway.com/guides/postgresql · https://docs.railway.com/reference/backups
- Fly MPG / Aurora: https://docs.fly.io/mpg · https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html · https://aws.amazon.com/rds/aurora/pricing/
- Extensions: https://github.com/timescale/pg_textsearch · https://github.com/paradedb/paradedb · https://hub.docker.com/r/paradedb/paradedb · https://github.com/pgvector/pgvector · https://github.com/pgmq/pgmq/releases · https://docs.cloud.google.com/sql/docs/postgres/extensions · https://www.tigerdata.com/newsroom/google-cloud-brings-native-bm25-full-text-search-to-alloydb-and-cloud-sql-via-tiger-datas-pg_textsearch
- Backups / storage: https://github.com/pgbackrest/pgbackrest/releases · https://github.com/wal-g/wal-g/releases · https://developers.cloudflare.com/r2/pricing/

**Non-Postgres**
- https://developers.cloudflare.com/d1/platform/limits/ · https://developers.cloudflare.com/d1/platform/pricing/ · https://developers.cloudflare.com/vectorize/platform/pricing/ · https://www.better-auth.com/docs/concepts/database
- https://turso.tech/pricing · https://docs.turso.tech/features/ai-and-embeddings · https://docs.turso.tech/features/sqlite-extensions · https://github.com/tursodatabase/turso · https://supabase.com/blog/supabase-is-acquiring-turso

**App hosts**
- Vercel: https://vercel.com/legal/terms · https://vercel.com/docs/limits/fair-use-guidelines · https://vercel.com/docs/plans/hobby · https://vercel.com/docs/plans/pro-plan · https://vercel.com/docs/limits · https://vercel.com/pricing · https://vercel.com/docs/functions/configuring-functions/duration · https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package · https://vercel.com/docs/cron-jobs/usage-and-pricing · https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel · https://vercel.com/docs/environment-variables
- Cloudflare: https://opennext.js.org/cloudflare · https://github.com/opennextjs/opennextjs-cloudflare/releases · https://developers.cloudflare.com/workers/platform/limits/ · https://developers.cloudflare.com/workers/platform/pricing/ · https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/ · https://developers.cloudflare.com/hyperdrive/platform/pricing/ · https://developers.cloudflare.com/hyperdrive/configuration/connect-to-postgres/ · https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- Netlify: https://www.netlify.com/pricing/ · https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/ · https://docs.netlify.com/manage/accounts-and-billing/billing/resume-paused-projects/ · https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/ · https://docs.netlify.com/build/functions/configuration/ · https://www.netlify.com/legal/self-serve-subscription-agreement/
- Fly.io: https://docs.fly.io/about/pricing · https://docs.fly.io/launch/autostop-autostart · https://fly.io/docs/reference/suspend-resume/ · https://docs.fly.io/apps/secrets/ · https://github.com/superfly/flyctl-actions · https://github.com/fly-apps/terraform-provider-fly
- Railway / Render: https://railway.com/pricing · https://docs.railway.com/reference/app-sleeping · https://docs.railway.com/reference/cron-jobs · https://render.com/docs/terraform-provider
- VPS: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ · https://www.hetzner.com/cloud/ · https://docs.hetzner.com/general/others/ipv4-pricing/ · https://docs.hetzner.com/cloud/billing/faq/ · https://www.digitalocean.com/pricing/droplets · https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm · https://kamal-deploy.org/docs/configuration/proxy/ · https://github.com/basecamp/kamal/releases · https://coolify.io/docs/get-started/installation · https://docs.dokploy.com/docs/core/installation
- AWS: https://github.com/opennextjs/opennextjs-aws/releases · https://sst.dev/docs/component/aws/nextjs/ · https://aws.amazon.com/lambda/pricing/ · https://aws.amazon.com/free/free-tier-faqs/ · https://aws.amazon.com/rds/free/ · https://aws.amazon.com/apprunner/ · https://aws.amazon.com/sqs/pricing/

**Background jobs**
- https://upstash.com/pricing/qstash · https://upstash.com/docs/qstash/features/retry · https://upstash.com/docs/qstash/quickstarts/vercel-nextjs · https://upstash.com/docs/qstash/howto/signature · https://upstash.com/pricing/workflow
- https://vercel.com/docs/queues · https://vercel.com/docs/queues/pricing · https://vercel.com/docs/queues/concepts · https://vercel.com/docs/workflows/pricing · https://vercel.com/blog/a-new-programming-model-for-durable-execution
- https://www.inngest.com/pricing · https://www.inngest.com/docs/usage-limits/inngest · https://trigger.dev/pricing · https://trigger.dev/docs/how-it-works
- https://github.com/timgit/pg-boss · https://pgboss.io/api/workers · https://worker.graphile.org/docs/requirements · https://nextjs.org/docs/app/guides/instrumentation
- https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/ · https://developers.cloudflare.com/queues/platform/pricing/ · https://developers.cloudflare.com/workflows/reference/pricing/

**IaC and CI**
- https://registry.terraform.io/providers/vercel/vercel · https://registry.terraform.io/providers/cloudflare/cloudflare · https://registry.terraform.io/providers/supabase/supabase · https://registry.terraform.io/providers/hetznercloud/hcloud · https://registry.terraform.io/providers/upstash/upstash · https://github.com/kislerdm/terraform-provider-neon · https://github.com/neondatabase/terraform-provider-neon · https://github.com/terraform-community-providers/terraform-provider-railway
- https://github.com/neondatabase/create-branch-action · https://github.com/neondatabase/delete-branch-action
