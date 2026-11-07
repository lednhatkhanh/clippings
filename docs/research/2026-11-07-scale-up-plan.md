# Clippings Scale-Up Plan: fact check against primary sources and the repo

Date: 2026-11-07 (vendor pages fetched and read that day; repo at `chore/deps-node-26`, `ee2f36f`). Every web claim cites a page that was opened in full, not a search snippet. Repo claims cite `path:line`.

**Summary.**
- **The rates and the $100 credit are right.** Haiku 5.5 is $0.10 in / $0.50 out up to 100K prompt tokens, 5x above that; Sonnet 5.5 is $2 / $10; the Batch API is 50% off. Max includes $100 a month in API credit, which does not roll over, stops API calls when it runs out, and applies to a key from the linked Console organization.
- **"Max 5x" is stale.** Anthropic now calls the $100 tier plain "Max" (5x Pro). The 20x tier is now "Ultra" ($200 credit). The $100 figure is unchanged.
- **A hard daily spend stop cannot live in the Console.** The Console has monthly spend limits only (organization and per workspace), and the Default Workspace cannot have one. The daily stop has to be app-side, and the key must belong to a non-default workspace for the workspace limit to apply.
- **The plan's budget omits web search.** A "cited brief" that searches the web costs $10 per 1,000 searches on top of tokens. It is the one line that can break the research-brief estimate.
- **"$2-5 weekly" for the librarian is ambiguous, and it matters.** Read as per run (about $9-22 a month), the plan's $15-35 total no longer holds; read as per month, it does.
- **Embeddings are already decided and built.** ADR 0001 picks Voyage `voyage-4` at 1,024 dimensions in a `vector(1024)` column. Search, `related_clippings` and a daily backfill already use it. Open question (b) is closed.
- **Haiku already runs on every save.** It reads each page and, if the user turned on `suggestTags` (default off), proposes tags that the user has to accept. It never applies them. "Haiku applies tags directly" is a behaviour change, not a new call.
- **Ask and This week exist exactly as the plan describes.** There is also a daily digest cron (Haiku) behind This week. Nothing logs tokens or dollars today.
- **No push, email or notification code exists.** Lessons need a new Lessons surface, or a new channel built from scratch (question c).
- **The scheduling limits are survivable on Hobby.** A weekly and a Tue/Fri job each run at most once a day. Vercel's own cron and schedules docs disagree about Hobby limits (see section 4), and Hobby cron timing is only accurate to the hour.
- **Not verifiable from primary sources:** whether Claude-app chats through a custom connector count against plan limits is inferred, not stated in so many words; whether the Batch API discounts the web search fee; and whether Voyage's `api.voyageai.com` endpoint stays supported.

## 1. Claim-by-claim check (pricing, credit, plan)

| # | Claim | Verdict | Source and correct fact |
|---|---|---|---|
| 1 | Haiku 5.5: $0.10 in / $0.50 out per MTok for prompts up to 100K tokens | **Confirmed** | [Pricing](https://platform.claude.com/docs/en/about-claude/pricing), "Claude Haiku 5.5 (for prompts up to 100,000 tokens)": $0.10 input, $0.50 output; cache read $0.01 |
| 2 | 5x above 100K | **Confirmed** | Same table: over 100,000 tokens is $0.50 / $2.50. "A request's prompt length counts all of its input tokens, including cache reads and cache writes", and each request is priced on its own ([Long context pricing](https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing)). Sonnet 5.5 has no such step: Claude 4.6 and later models other than Haiku 5.5 "include the full 1M token context window at standard pricing" |
| 3 | Sonnet 5.5: $2 in / $10 out | **Confirmed** | Same pricing page. Cache read $0.10, 5-minute cache write $2.50 |
| 4 | Batch API is half price | **Confirmed** | Same page, [Batch processing](https://platform.claude.com/docs/en/about-claude/pricing#batch-processing): "50 percent discount on both input and output tokens". Sonnet 5.5 batch $1 / $5; Haiku 5.5 batch $0.05 / $0.25 (up to 100K), $0.25 / $1.25 (over). [Batch doc](https://platform.claude.com/docs/en/build-with-claude/batch-processing): most batches finish within 1 hour, a batch expires at 24 hours (expired requests are not billed), results are kept 29 days, up to 100,000 requests or 256 MB per batch. Server tools, web search included, work in batches |
| 5 | Max 5x includes a $100 monthly API credit | **Confirmed, name stale** | [API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers): Max $100, Ultra $200, Team up to $500 pooled. [What is the Max plan?](https://support.claude.com/en/articles/11049741-what-is-the-max-plan): Max is $100 a month and "five times the Pro plan's usage". The 20x tier is now Ultra ([pricing page](https://claude.com/pricing)) |
| 6 | The credit does not roll over | **Confirmed** | "Unused credits expire at the end of each billing cycle ... and don't roll over" ([API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)) |
| 7 | API calls stop when it runs out | **Confirmed, with a condition** | "If the organization has no credits left, API requests stop until your next monthly API credits arrive. Usage is never charged to your Claude plan." Purchased credits or auto-reload would keep requests going. The error text is "Your credit balance is too low to access the Anthropic API" (same page) |
| 8 | Use an API key from the Console organization linked to the plan | **Confirmed** | "Every API key and workspace in the linked organization draws from the same balance" (same page). Linking is on claude.ai under Settings > Billing; one organization per plan, and you cannot change it yourself. Not in the plan: a new subscriber can claim only "after 7 days on an eligible plan", and credits show under "Promotional credits" in Console billing ([support article](https://support.claude.com/en/articles/17154008-api-credits-for-max-and-team-plans)) |
| 9 | Claude-app MCP chats use plan limits, not the API credit | **Supported by inference, not stated verbatim** | The credit "doesn't cover" "Extra usage in the Claude apps" and "doesn't change your usage limits in Claude" ([API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)). Usage in the apps depends on the model, effort level, and "Tools and connectors are token-intensive" ([usage and length limits](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)). The custom-connector article says nothing about usage ([custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)). No page says in one sentence "connector chats count against plan limits" |
| 10 | Chat in the Claude app is "any model, on plan limits" | **Partly wrong** | Other models draw from the same pool. Fable models are included on Max only up to 50% of the weekly limit, and on Pro they are not in plan limits at all ([Fable on your plan](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan)). The Max plan also has a five-hour limit and a weekly limit, so a long agent chat can be cut off, which API credit would not |
| 11 | A Console workspace spend limit exists | **Confirmed, monthly only** | [Workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces#setting-workspace-limits): "Cap monthly spending for a workspace" plus alerts at thresholds, set on the Workspaces page. "You cannot set spend limits on the Default Workspace." Workspace limits can be lower than, not above, the organization's. The credit page points to this: give the project its own workspace |
| 12 | Hard daily spend stop (as a Console feature) | **Not found; the Console has no daily limit** | [Rate limits](https://platform.claude.com/docs/en/api/rate-limits#spend-limits): spend limits are monthly (organization caps Start $500, Build $1,000). At a limit you set, requests return HTTP 400 `invalid_request_error`, "You have reached your specified workspace API usage limits"; at a tier cap, HTTP 429 with no `retry-after`, so retries fail until the 1st at 00:00 UTC. A daily stop is the app's job |
| 13 | Credit and spend limit reset together | **Not stated, and they differ** | Credits refresh each billing cycle; spend caps "reset on the first of each calendar month" ([API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers#spend-limits-and-rate-limits)). A limit of $X counts credit-paid usage too |
| 14 | A custom remote MCP connector works in the Claude app on Max | **Confirmed** | Available on Free, Pro, Max, Ultra, Team, Enterprise ([support](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)); the server must be reachable from Anthropic's IP ranges. Limits that bind the librarian tools: about 150,000 characters per tool result and 240 s per tool call on claude.ai and Desktop ([building connectors](https://claude.com/docs/connectors/building)) |

As of 2026-11-07. Dates: the credits were announced 2026-10-07 per the [Agent SDK plan article](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan); the amounts on the docs page carry no date.

One more fact the plan does not use: `claude -p` and the Agent SDK draw on the credit only with an API key from the linked organization; signed in with the plan they "still draw from your subscription limits" ([Agent SDK plan article](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)). The Claude Code desktop app, GitHub Action and IDE runs are not covered by the credit ([support article](https://support.claude.com/en/articles/17154008-api-credits-for-max-and-team-plans)).

## 2. The budget, recomputed

Rates are the verified ones above. The token counts are my assumptions, and each is the thing to change if usage differs. Token estimates use 4 characters per token (my arithmetic).

**Tagging, per save (Haiku 5.5, not batched).** The summarizer already feeds up to 20,000 characters of page text into one Haiku call (`packages/shared/src/clipping.ts:20`, `apps/web/lib/enrichment/summarizer.ts:6`). Assume 5,000 tokens of page, 700 of system prompt and tool schema, 1,000 of the user's tag list, 300 output.
- Cost: 6,700 x $0.10/M = $0.00067, plus 300 x $0.50/M = $0.00015, about **$0.0008 per save**.
- At 10 saves a day (300 a month): $0.25. At 30 a day: $0.75. At 100 a day: $2.50.
- The plan's $1-2 a month matches roughly 40-80 saves a day. "Fraction of a cent per save" is correct.
- A PDF goes in as a `document` block (`summarizer.ts:138`) and costs more input. I did not price that.
- **Most of this line is already being spent**: the reading call exists, and the tag proposal rides in the same call when `suggestTags` is on. The new cost of "Haiku applies tags" is a few output tokens.

**Research briefs (Sonnet 5.5, about 3 a day, so 90 a month).** The plan costs tokens only; web search is billed on top at **$10 per 1,000 searches** ([pricing](https://platform.claude.com/docs/en/about-claude/pricing#web-search-tool)); web fetch has no extra charge. Search results count as input tokens in every later turn.

| Scenario | Input | Output | Searches | Per brief, standard | Per brief, batch | 90 briefs, standard | 90 briefs, batch |
|---|---|---|---|---|---|---|---|
| Light | 40K | 3K | 5 | $0.08 + $0.03 + $0.05 = $0.16 | $0.04 + $0.015 + $0.05 = $0.105 | $14.40 | $9.45 |
| Heavy | 120K | 6K | 10 | $0.24 + $0.06 + $0.10 = $0.40 | $0.12 + $0.03 + $0.10 = $0.25 | $36.00 | $22.50 |

- Batch rows assume the search fee is not discounted. The pricing page states the 50% only for input and output tokens, so I did not assume it covers searches.
- The plan's $10-25 holds only if the briefs run in batch. Run at standard price, the heavy case is $36.
- Haiku's triage ("is this worth researching") is a short call, about $0.001 each, and negligible.

**Lessons (Sonnet 5.5, 9 a month).** Assume 30K input, 3K output: $0.06 + $0.03 = $0.09 each, **$0.81 a month**. At 100K input and 5K output it is $0.25 each, $2.25 a month. "Under $1" holds only for lessons built from roughly 35K tokens or less.

**Librarian (Sonnet 5.5, weekly, 4.33 runs a month).** Assume the run reads every clipping once as id, title, tags and a one-line summary at about 120 tokens, and writes 8K tokens of output.

| Library | Input per run | Per run | Per month |
|---|---|---|---|
| 1,000 clippings | 120K | $0.24 + $0.08 = $0.32 | $1.40 |
| 3,000 | 360K | $0.72 + $0.08 = $0.80 | $3.50 |
| 5,000 | 600K | $1.20 + $0.08 = $1.28 | $5.55 |

- That is a single pass. A tool-using run that re-sends the context on each turn multiplies it: ten turns over 360K tokens without caching is 3.6M input tokens, about $7.20 a run. With prompt caching, reads cost $0.10/M instead of $2/M, so caching decides this line.
- I did not measure the real library size, so the table is the only estimate.

**Total.**

| Case | Tagging | Briefs | Lessons | Librarian | Month |
|---|---|---|---|---|---|
| Low (light, batch, 1,000 clippings) | $0.25 | $9.45 | $0.81 | $1.40 | **$11.90** |
| High (heavy, batch, 5,000 clippings) | $2.50 | $22.50 | $2.25 | $5.55 | **$32.80** |
| High, briefs not batched | $2.50 | $36.00 | $2.25 | $5.55 | **$46.30** |

- The plan's **$15-35 is reproducible** if the briefs are batched and "$2-5 weekly" means $2-5 a month.
- If it means $2-5 per weekly run ($9-22 a month), the plan's own line items sum to about $20-50, which does not fit $15-35.
- Every case sits **well inside $100**, so the credit claim holds. The only way to fail it is a runaway loop, which is why the app-side daily cap matters more than the monthly Console limit.
- The existing digest cron is a small line already: one Haiku call per user per week, at most 60 clippings read (`packages/db/src/digest/service.ts:32`). Removing it saves almost nothing.

## 3. What the repo already does

### Embeddings (question b): already chosen and built

- **Decision**: `docs/adr/0001-embeddings-voyage-4.md`. Voyage `voyage-4`, 1,024 dimensions, exact cosine search, no ANN index, `input_type` `document` and `query`.
- **Model and call**: `apps/web/lib/enrichment/embedder.ts:4` (`voyage-4`), the request at `:29-45` (default base `https://api.voyageai.com`, key from `VOYAGE_API_KEY`).
- **Column**: `clippings.embedding vector(1024)` at `packages/db/src/schema.ts:386`; `EMBEDDING_DIMENSIONS = 1024` at `:342`.
- **What is embedded**: title, summary and excerpt (`packages/db/src/clippings/service.ts:464-465`), not the note, by design in the ADR. A text note type would need its body embedded; the ADR's "never call the provider when a note is edited" rule would have to change.
- **Search**: keyword (`tsvector`, GIN at `schema.ts:413`) and meaning merged by reciprocal rank fusion with k = 60, 50 semantic candidates, cosine distance cut-off 0.6 (`service.ts:429-437`, fusion at `:1164`). So "search and related move onto embeddings" is already true.
- **Related**: `relatedClippings` at `service.ts:1211`, exposed as the MCP tool `related_clippings` (`apps/web/lib/mcp/tools.ts:350`).
- **Backfill**: the daily sweep embeds up to 50 ready clippings that have no embedding (`service.ts:2374`, batch size at `:441`; `apps/web/lib/enrichment/sweep-request.ts`). The partial index for it is at `schema.ts:443`.
- **Voyage facts, re-verified**: `voyage-4` is $0.06 per 1M tokens with the first 200M tokens free per model ([pricing](https://docs.voyageai.com/docs/pricing)); `voyage-4-lite` $0.02, `voyage-4-large` $0.12. Rate limits are 2,000 RPM and 8M TPM for `voyage-4` at Tier 1, which needs a payment method ([rate limits](https://docs.voyageai.com/docs/rate-limits)); `docs/deploy.md` already says to add one. The statement that Anthropic has no embedding model is confirmed: "Anthropic does not offer its own embedding model" ([Embeddings](https://platform.claude.com/docs/en/build-with-claude/embeddings)).
- **A risk the repo does not mention**: Anthropic's embeddings page now sends readers to a MongoDB Atlas "model API key" and `https://ai.mongodb.com/v1/embeddings`. MongoDB's [migration page](https://www.mongodb.com/docs/voyageai/tutorials/migrate-to-atlas/) maps `https://api.voyageai.com/v1/embeddings` to that endpoint and says to delete the old key afterwards, but gives no end-of-support date. The repo's default endpoint is the old one (`embedder.ts:29`); `VOYAGE_BASE_URL` can repoint it. I could not tell whether new accounts can still get a Voyage-platform key.

### Ask and This week: both implemented

| Piece | Where |
|---|---|
| Ask page | `apps/web/app/(app)/ask/page.tsx`; route `apps/web/app/api/ask/route.ts` (streams, `maxDuration = 60`) |
| Ask logic | `apps/web/lib/ask/` (`handler.ts`, `model.ts`, `request.ts`, `search-results.ts`, `stream-events.ts`), `apps/web/components/ask/`, `packages/shared/src/ask.ts` |
| Ask model | `claude-sonnet-5-5`, `apps/web/lib/ask/request.ts:12` (Sonnet, not Haiku; this is the code that goes away) |
| This week page | `apps/web/app/(app)/digest/page.tsx`, `apps/web/components/digest/digest-view.tsx` |
| Digest generation | daily cron `apps/web/app/api/cron/digest/route.ts` -> `apps/web/lib/digest/` -> `packages/db/src/digest/service.ts`; Haiku in `apps/web/lib/enrichment/digester.ts:5` |
| Digest storage | table `weekly_digests`, `packages/db/src/schema.ts:626` (one row per user and finished week; a migration is needed to drop it) |
| Nav | `apps/web/components/app-nav.tsx:69` (Ask), `:75` (This week); `SECTION_HREFS` at `apps/web/components/nav-sections.ts:4` (a section's index drives the page transition direction) |
| Cron entries | `apps/web/vercel.json:6-9`, plus the `docs/deploy.md` paragraph that describes them |

Removing them also touches `apps/web/lib/ask/*.test.ts`, the digest tests, `components/nav-sections.test.ts`, and the `weeklyDigests` export of `@clippings/db`. `apps/e2e/specs` exists; I did not search it for Ask or digest specs.

### Tagging (phase 2)

- `suggestTags` is a per-user switch that defaults to `false` (`schema.ts:598-599`), set under Settings (`components/settings/suggest-tags-settings.tsx`).
- With it on, the reading call adds `existing_tags` (up to 3 of the user's own) and `new_tags` (at most 1, "only when none of their tags fits well") through a strict tool schema (`summarizer.ts:16-26, 42-57, 79-95`).
- The result is stored in `clipping_tag_suggestions` (`schema.ts:550`). The table comment says: "Never applied by itself: the user accepts it ... or dismisses it" (`schema.ts:545-549`). A second source, `neighbours`, votes from the tags of the nearest clippings (`service.ts:1747-1762, 1926`).
- So the plan's "new tags only when confident" is already the prompt's rule, but "applies directly" is not. Auto-applying needs the confidence rule defined (the schema has no score field) and an undo path.
- **Text note type**: not present. `clippings.url` and `url_normalized` are `notNull` (`schema.ts:355-356`) and `note` is the user's comment on a page (`:361`). A note-as-item needs a schema change and a rule for `save_clipping`, duplicate detection and enrichment.

### Scheduling, notification and limits (phases 3 and 5, question c)

- **Existing cron**: two daily Vercel Crons, 04:00 UTC sweep and 05:00 UTC digest (`apps/web/vercel.json:6-9`), both `maxDuration = 60` (`app/api/cron/*/route.ts:7`), both guarded by a `CRON_SECRET` bearer check (`sweep-request.ts`, `digest-request.ts`). `docs/deploy.md` says Vercel runs crons only on the production deployment.
- **QStash is used only to publish enrichment jobs** (`apps/web/lib/enrichment/job-publisher.ts`, 3 retries at `enrich-request.ts:9`). No QStash schedule exists. Its tokens and signing keys are already configured (`apps/web/.env.example`).
- **Notifications**: none. I searched `apps`, `packages` and the service worker for web-push, `PushManager`, `showNotification`, `Notification`, and for an email sender (resend, nodemailer, `sendMail`), and found no hit in code. The hand-written service worker (`apps/web/lib/pwa/service-worker.ts`, ADR 0003) has no push handler; the manifest has none either. Lessons would land in a page (a new section like This week) unless a channel is built.
- **Failure behaviour that matters for a spend stop**: an enrichment failure returns 500 so QStash retries; after the last try the clipping is marked `failed`, and the daily sweep restarts it, limited by `sweepAttempts` (`schema.ts:374`). If the credit runs out, or a workspace limit returns HTTP 400, saves would go to `failed` and be re-tried by the sweep until it gives up. The app has no "model unavailable, hold the queue" state today.
- **Token and dollar logging**: none. I found no `usage`, `input_tokens` or cost capture in `apps/web/lib` or `packages/db/src`. The SDK returns `usage` on every response; the three call sites are `summarizer.ts:167`, `digester.ts`, `ask/model.ts:21`. Voyage returns `usage.total_tokens` per call ([embeddings reply](https://platform.claude.com/docs/en/build-with-claude/embeddings)); the embedder currently discards it.

### MCP surface versus the plan's "Exists" list

`apps/web/lib/mcp/tools.ts` registers (line = `registerTool`):

| Tool | Line | Scope |
|---|---|---|
| `save_clipping` | 183 | read |
| `search_clippings` | 229 | read |
| `list_recent` | 262 | read |
| `list_clippings` | 283 | read |
| `related_clippings` | 350 | read |
| `get_clipping` | 369 | write |
| `get_page_text` | 386 | write |
| `update_clipping` | 413 | write |
| `tag_clippings` | 465 | write |
| `list_tags` | 502 | write |
| `rename_tag` | 523 | write |
| `merge_tag` | 557 | write |
| `delete_clipping` | 584 | write |
| `restore_clipping` | 609 | write |

- The write tools sit behind `if (!write) return` (`tools.ts:366`) and the `clippings:write` OAuth scope (`apps/web/lib/mcp/scopes.ts`).
- **All seven tools the plan marks "existing" do exist** (`list_tags`, `tag_clippings`, `merge_tag`, `rename_tag`, `related_clippings`, `update_clipping`, `restore_clipping`). Missing from the plan's list but present: `save_clipping`, `search_clippings`, `list_recent`, `list_clippings`, `get_clipping`, `get_page_text`, `delete_clipping`.
- **None of the new tools exist** (`set_tag_color`, `create_folder`, `move_to_folder`, `link_items`, `run_librarian`, `list_suggestions`, `apply_suggestion`, `undo_change`). There is also no folder or link table and no tag colour column in `schema.ts`.
- **Undo today**: only `restore_clipping`, for deletes within 24 hours. `merge_tag` says in its own description "This can't be undone" (`tools.ts:561`). An auto-applied merge therefore needs the undo log before it is safe; the current tool is `destructiveHint: true`, `idempotentHint: false`.
- **Doc drift**: the README's list of write tools (`README.md:88-91`) omits `get_page_text`, while the plugin skill lists it (`plugins/clippings/skills/clippings/SKILL.md`). The plugin already teaches a "weekly review" and a "tidy tags" routine run from the Claude app, with the user approving each change.
- **Protocol**: the MCP spec (version 2026-07-28) says there SHOULD always be a human able to deny a tool call and that annotations are untrusted unless they come from trusted servers ([tools spec](https://modelcontextprotocol.io/specification/latest/server/tools)); it also says servers MUST rate limit tool invocations. A server-side librarian is not an MCP client, so it is outside that human-in-the-loop wording; run from the Claude app, each tool call goes through the client's own confirmation.

## 4. Vercel Hobby and QStash limits for a weekly librarian and a Tue/Fri lessons job

**Vercel cron on Hobby** ([usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing), last updated 2026-07-15):
- 100 cron jobs per project; "once per day" minimum interval; precision "Per-hour (±59 min)". An expression that would run more than once a day fails the deployment. A job "configured as `0 1 * * *` ... will trigger anywhere between 1:00 am and 1:59 am."
- A weekly job (`0 6 * * 1`) and a Tue/Fri job (`0 7 * * 2,5`) each run at most once a day, so both are allowed. The existing two daily crons use 2 of the 100.
- The same page calls Cron Jobs "a legacy feature" being migrated to Vercel Schedules, which are in beta. The [Schedules limits](https://vercel.com/docs/schedules/limits) page says Hobby has a fixed 15-minute jitter window, a most-frequent cron of every 15 minutes, 100 static schedules per deployment, and **5,000 scheduled runs per billing period** (runs over the limit are skipped). **The two pages disagree** about whether Hobby may run more often than daily, and I could not tell which rules a `crons` entry in `vercel.json` gets today. Neither page's limits are hit by the plan's cadence.
- **Function time**: Hobby default and maximum is 300 s with Fluid compute ([duration](https://vercel.com/docs/functions/configuring-functions/duration), updated 2026-08-24). The repo's cron and job routes set 60 s (`maxDuration = 60`). A librarian or a Sonnet brief that runs longer than 60 s must raise `maxDuration` (up to 300 s) or be split across QStash messages. A Batch API brief avoids the wait: submit, then collect later (results are kept 29 days).
- **Crons are not run on previews**: `docs/deploy.md` says so; the development environment never fires them.

**QStash free tier** ([pricing](https://upstash.com/pricing/qstash)):
- 1,000 messages a day; "each retry is counted as an additional message"; 1 MB message; 7-day maximum delay; 15-minute maximum HTTP response duration; 10 active schedules.
- Pay-as-you-go is $1 per 100K messages. The page contradicts itself on schedules for the free plan (a table says 10, a detail line says up to 1,000), so I rely on the table's 10.
- Today's load: one message per save plus up to the sweep's retries and the import drain. The plan adds a few messages a day for research polling. This is far from 1,000 unless an import is large; the existing import drain already spreads its backlog over a daily budget (`schema.ts:378`).
- A 15-minute response limit on QStash is the longest of the three, so a long librarian run is easier to fit as a QStash callback than as a cron route.

**Neon**: `docs/deploy.md` says production runs on Neon **Launch**, while ADR 0001 and the 2026-10-15 hosting research assume Free. Neon's [plans page](https://neon.com/docs/introduction/plans) (updated 2026-11-04) lists Free at 1 GB per project, 100 CU-hours a month, and Launch at $0.106 per CU-hour, $0.35 per GB-month, no minimum. Embeddings at 1,024 floats are about 4 KB a row, so 3,000 rows is about 12 MB (the earlier research's figure). A text-note type, more link rows and research briefs add rows, not a different tier.

## 5. Open questions: what the evidence settles

| Plan question | Status |
|---|---|
| (a) Repo location, stack, database | **Answered by the repo**: `/Users/klausle/workspace/clippings`; pnpm and Turborepo monorepo; Next.js on Vercel Hobby; Postgres on Neon (Launch per `docs/deploy.md`) with Drizzle, `pgvector` and `pg_trgm`; Better Auth plus its OAuth server for MCP; QStash for jobs; Chrome extension in `apps/extension`. |
| (b) Embeddings provider | **Already decided and implemented**: Voyage `voyage-4`, 1,024 dimensions (ADR 0001). The open item is only the endpoint/key migration risk above. |
| (c) Where lessons land | **Not decided by the repo.** There is no push or email code. The cheapest consistent option is a page in the app, as This week is today; push needs a service-worker handler and a subscription store, and email needs a sender and an address policy. The repo's allowlist-only sign-in (`apps/web/lib/auth/allowlist.ts`) means the address is already known. I have no evidence to pick between them. |
| (d) Domains besides shipping | **Not answerable from sources.** The repo has no domain concept; tags are free text. |
| (e) Starting daily cap and jobs per day ($3 and 3) | **Consistent with the numbers**: $3 a day is up to about $90 a month, so it is a runaway stop, not a budget. From section 2, the steady state is about $0.4-1.5 a day; $3 allows 2-7x headroom. Three research jobs a day matches the 90-a-month used above. |

## 6. Where the plan and the sources disagree, or the repo does it differently

1. **"Max 5x"** is now "Max"; the plan's $100 is right, the label is not.
2. **A hard daily stop** is not a Console feature. Only monthly caps exist, and not on the Default Workspace, so the key must belong to a workspace the user creates. The app needs its own daily ledger, which requires the missing per-call usage log.
3. **The credit period and the spend-limit period differ** (billing cycle versus calendar month). A $100 workspace limit does not line up with a credit that renews mid-month; a limit set below the credit is the safe choice, and a limit above the remaining credit is moot because the credit stops requests first.
4. **Web search cost** is missing from the brief estimate ($10 per 1,000 searches).
5. **"$2-5 weekly"** needs a stated unit; it decides whether the total fits.
6. **Haiku "applies tags directly"** reverses a deliberate repo rule (suggestions are never auto-applied, off by default).
7. **Ask is Sonnet, This week is Haiku**: removing Ask drops the only Sonnet call in the app today; Sonnet 5.5 first returns as the brief, lesson and librarian model.
8. **"Any model, on plan limits"**: Fable has the 50% weekly rule on Max; other models share one pool; a five-hour limit also applies.
9. **Auto-applied merges** cannot be undone with today's tools.
10. **Error handling** has no "spend stop reached" path: a 400 or 429 spend error would mark saves `failed` and the sweep would retry them.
11. **Hobby cron timing** is accurate to the hour, not the minute, so "Tue/Fri morning" is a window of up to an hour.

## What I could not verify

- A primary statement that Claude-app chats through a custom connector count against plan limits (inferred from the credit and usage pages; see claim 9).
- Whether the 50% Batch discount applies to the $10 per 1,000 web search fee.
- Which Vercel limits a `crons` entry in `vercel.json` gets now that Cron Jobs are called legacy: the two Vercel pages differ (section 4).
- Whether `api.voyageai.com` and Voyage-platform keys remain supported, and whether the 200M free tokens carry over to the Atlas model API keys.
- Real usage figures: the library size, saves a day, and tokens per call. The repo records none, so every dollar figure here rests on the stated assumptions.
- Whether the plan's research-job quality needs web search at all, or the model can write a brief from the saved page text. That is a product question, not a sourced fact.
- Whether `apps/e2e/specs` has specs for Ask or This week (not searched).

## Sources

**Anthropic**
- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/docs/en/build-with-claude/batch-processing
- https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers
- https://platform.claude.com/docs/en/manage-claude/workspaces
- https://platform.claude.com/docs/en/api/rate-limits
- https://platform.claude.com/docs/en/build-with-claude/embeddings
- https://support.claude.com/en/articles/17154008-api-credits-for-max-and-team-plans
- https://support.claude.com/en/articles/11049741-what-is-the-max-plan
- https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work
- https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan
- https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- https://claude.com/pricing
- https://claude.com/docs/connectors/building

**MCP**: https://modelcontextprotocol.io/specification/latest/server/tools

**Voyage**: https://docs.voyageai.com/docs/pricing · https://docs.voyageai.com/docs/rate-limits · https://www.mongodb.com/docs/voyageai/tutorials/migrate-to-atlas/

**Vercel**: https://vercel.com/docs/cron-jobs/usage-and-pricing · https://vercel.com/docs/schedules/limits · https://vercel.com/docs/functions/configuring-functions/duration

**Upstash and Neon**: https://upstash.com/pricing/qstash · https://neon.com/docs/introduction/plans

**Repo**: `docs/adr/0001-embeddings-voyage-4.md`, `docs/deploy.md`, `README.md`, `apps/web/vercel.json`, `apps/web/lib/mcp/tools.ts`, `apps/web/lib/enrichment/{summarizer,digester,embedder,sweep-request,job-publisher,enrich-request}.ts`, `apps/web/lib/ask/request.ts`, `packages/db/src/schema.ts`, `packages/db/src/clippings/service.ts`, `packages/db/src/digest/service.ts`
