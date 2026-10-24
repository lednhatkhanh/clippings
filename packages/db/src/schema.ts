import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_VALUES,
  CLIPPING_SOURCES,
  CLIPPING_STATUSES,
  TAG_COLORS,
} from "@clippings/shared";

/**
 * Every table in the database. This file is the source of truth: `drizzle-kit generate` turns a
 * change here into the SQL migration in `drizzle/`, and `check:schema` fails when the two
 * disagree.
 */

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Postgres's text-search document. Only queries read it, so its value stays an opaque string. */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

// Better Auth's tables. Property and column names are the ones its Drizzle adapter looks up.

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique("user_email_key"),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  createdAt: timestamptz("createdAt").notNull().defaultNow(),
  updatedAt: timestamptz("updatedAt").notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamptz("expiresAt").notNull(),
    token: text("token").notNull().unique("session_token_key"),
    createdAt: timestamptz("createdAt").notNull().defaultNow(),
    updatedAt: timestamptz("updatedAt").notNull(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: timestamptz("accessTokenExpiresAt"),
    refreshTokenExpiresAt: timestamptz("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamptz("createdAt").notNull().defaultNow(),
    updatedAt: timestamptz("updatedAt").notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamptz("expiresAt").notNull(),
    createdAt: timestamptz("createdAt").notNull().defaultNow(),
    updatedAt: timestamptz("updatedAt").notNull().defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// The OAuth 2.1 authorization server's tables (`@better-auth/mcp` on `@better-auth/oauth-provider`,
// with the JWT plugin's signing keys). Claude and the extension are its clients. Same naming as
// above: the table and column names are Better Auth's model and field names.

/** The JWT plugin's signing keys: access tokens are JWTs that `/mcp` verifies against them. */
export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("publicKey").notNull(),
  // Encrypted with the Better Auth secret.
  privateKey: text("privateKey").notNull(),
  createdAt: timestamptz("createdAt").notNull(),
  expiresAt: timestamptz("expiresAt"),
  alg: text("alg"),
  crv: text("crv"),
});

/**
 * An OAuth client: one claude.ai or Claude Code registered (by its metadata document URL or
 * through dynamic registration).
 */
export const oauthClient = pgTable(
  "oauthClient",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId").notNull().unique("oauthClient_clientId_key"),
    clientSecret: text("clientSecret"),
    // "cimd" for a client discovered from its metadata document; null for one registered here.
    clientDiscoveryId: text("clientDiscoveryId"),
    disabled: boolean("disabled").default(false),
    skipConsent: boolean("skipConsent"),
    enableEndSession: boolean("enableEndSession"),
    subjectType: text("subjectType"),
    scopes: text("scopes").array(),
    clientCredentialsScopes: text("clientCredentialsScopes")
      .array()
      .default(sql`'{}'::text[]`),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamptz("createdAt"),
    updatedAt: timestamptz("updatedAt"),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("softwareId"),
    softwareVersion: text("softwareVersion"),
    softwareStatement: text("softwareStatement"),
    redirectUris: text("redirectUris").array().notNull(),
    postLogoutRedirectUris: text("postLogoutRedirectUris").array(),
    backchannelLogoutUri: text("backchannelLogoutUri"),
    backchannelLogoutSessionRequired: boolean("backchannelLogoutSessionRequired"),
    tokenEndpointAuthMethod: text("tokenEndpointAuthMethod"),
    applicationType: text("applicationType"),
    jwks: text("jwks"),
    jwksUri: text("jwksUri"),
    grantTypes: text("grantTypes").array(),
    responseTypes: text("responseTypes").array(),
    requirePKCE: boolean("requirePKCE"),
    dpopBoundAccessTokens: boolean("dpopBoundAccessTokens").default(false),
    referenceId: text("referenceId"),
    metadata: jsonb("metadata"),
  },
  (table) => [index("oauthClient_userId_idx").on(table.userId)],
);

/** A protected resource tokens are issued for: the `/mcp` endpoint. */
export const oauthResource = pgTable("oauthResource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique("oauthResource_identifier_key"),
  name: text("name").notNull(),
  accessTokenTtl: integer("accessTokenTtl"),
  refreshTokenTtl: integer("refreshTokenTtl"),
  signingAlgorithm: text("signingAlgorithm"),
  signingKeyId: text("signingKeyId"),
  allowedScopes: text("allowedScopes").array(),
  customClaims: jsonb("customClaims"),
  dpopBoundAccessTokensRequired: boolean("dpopBoundAccessTokensRequired").default(false),
  disabled: boolean("disabled").default(false),
  createdAt: timestamptz("createdAt"),
  updatedAt: timestamptz("updatedAt"),
  policyVersion: integer("policyVersion").default(1),
  metadata: jsonb("metadata"),
});

export const oauthClientResource = pgTable(
  "oauthClientResource",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resourceId")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: jsonb("metadata"),
    createdAt: timestamptz("createdAt"),
  },
  (table) => [
    uniqueIndex("oauthClientResource_clientId_resourceId_uidx").on(
      table.clientId,
      table.resourceId,
    ),
    index("oauthClientResource_resourceId_idx").on(table.resourceId),
  ],
);

/** A refresh token, stored hashed. Each refresh rotates it. */
export const oauthRefreshToken = pgTable(
  "oauthRefreshToken",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique("oauthRefreshToken_token_key"),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("sessionId").references(() => session.id, { onDelete: "set null" }),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    authorizationCodeId: text("authorizationCodeId"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requestedUserInfoClaims").array(),
    expiresAt: timestamptz("expiresAt").notNull(),
    createdAt: timestamptz("createdAt").notNull(),
    revoked: timestamptz("revoked"),
    rotatedAt: timestamptz("rotatedAt"),
    rotationReplayResponse: text("rotationReplayResponse"),
    rotationReplayExpiresAt: timestamptz("rotationReplayExpiresAt"),
    authTime: timestamptz("authTime"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauthRefreshToken_clientId_idx").on(table.clientId),
    index("oauthRefreshToken_sessionId_idx").on(table.sessionId),
    index("oauthRefreshToken_userId_idx").on(table.userId),
    index("oauthRefreshToken_authorizationCodeId_idx").on(table.authorizationCodeId),
  ],
);

/** An opaque access token. JWT access tokens, which `/mcp` gets, are not stored. */
export const oauthAccessToken = pgTable(
  "oauthAccessToken",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique("oauthAccessToken_token_key"),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("sessionId").references(() => session.id, { onDelete: "set null" }),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    authorizationCodeId: text("authorizationCodeId"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requestedUserInfoClaims").array(),
    refreshId: text("refreshId").references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
    expiresAt: timestamptz("expiresAt").notNull(),
    createdAt: timestamptz("createdAt").notNull(),
    revoked: timestamptz("revoked"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauthAccessToken_clientId_idx").on(table.clientId),
    index("oauthAccessToken_sessionId_idx").on(table.sessionId),
    index("oauthAccessToken_userId_idx").on(table.userId),
    index("oauthAccessToken_authorizationCodeId_idx").on(table.authorizationCodeId),
    index("oauthAccessToken_refreshId_idx").on(table.refreshId),
  ],
);

/** What a user allowed a client, so a later authorization skips the consent page. */
export const oauthConsent = pgTable(
  "oauthConsent",
  {
    id: text("id").primaryKey(),
    clientId: text("clientId")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text("userId").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("referenceId"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requestedUserInfoClaims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamptz("createdAt").notNull(),
    updatedAt: timestamptz("updatedAt").notNull(),
  },
  (table) => [
    index("oauthConsent_clientId_idx").on(table.clientId),
    index("oauthConsent_userId_idx").on(table.userId),
  ],
);

/** Spent `private_key_jwt` assertion ids, so each is used once. */
export const oauthClientAssertion = pgTable("oauthClientAssertion", {
  id: text("id").primaryKey(),
  expiresAt: timestamptz("expiresAt").notNull(),
});

/**
 * What the app tracks about a client acting for a user, beside Better Auth's tokens: when it last
 * called, and when the user revoked it. Access tokens are JWTs nobody stores, so `/mcp` refuses
 * one issued at or before `revoked_at`. One row per user and client, created on first use.
 */
export const oauthConnections = pgTable(
  "oauth_connections",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    lastUsedAt: timestamptz("last_used_at"),
    revokedAt: timestamptz("revoked_at"),
  },
  (table) => [
    primaryKey({ name: "oauth_connections_pkey", columns: [table.userId, table.clientId] }),
    index("oauth_connections_client_id_idx").on(table.clientId),
  ],
);

/** Length of every embedding: the stored column's dimension (ADR 0001). */
export const EMBEDDING_DIMENSIONS = 1024;

const inList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

/** A page a user saved. */
export const clippings = pgTable(
  "clippings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    urlNormalized: text("url_normalized").notNull(),
    // The page's title, as enrichment wrote it. The title to show is `user_title` when set.
    title: text("title").notNull(),
    // The user's own title; null shows the page's. Enrichment never writes it.
    userTitle: text("user_title"),
    note: text("note").notNull().default(""),
    // Written by enrichment; null until the page has been read.
    summary: text("summary"),
    excerpt: text("excerpt"),
    status: text("status", { enum: CLIPPING_STATUSES }).notNull().default("pending"),
    source: text("source", { enum: CLIPPING_SOURCES }).notNull(),
    clientId: text("client_id"),
    // When enrichment was last requested or the status last changed: the sweep's "stuck for an
    // hour". Not `updated_at`, which an edit to the note moves too.
    statusChangedAt: timestamptz("status_changed_at").notNull().defaultNow(),
    // When the daily drain last requested this imported clipping's enrichment; null before that.
    // The drain counts these against its daily budget, so a second run the same day takes only
    // what is left and never requests the same clipping twice.
    importRequestedAt: timestamptz("import_requested_at"),
    // No default: the service stamps both from its clock, so tests control time and the list
    // cursor round-trips exactly.
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
    // What the page means, for search by meaning and related clippings. Written by enrichment from
    // the title, summary and excerpt; null until then, or when embedding failed. No ANN index:
    // an exact scan of one user's rows is fast enough (ADR 0001).
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    // Set when the user deletes the clipping, cleared by Undo. Every read skips deleted rows.
    deletedAt: timestamptz("deleted_at"),
    // When the user pinned it above the newest-first list; null when not pinned. Deleting and
    // undoing leave it alone.
    pinnedAt: timestamptz("pinned_at"),
    // When the weekly link check last looked at the page; null before the first look.
    linkCheckedAt: timestamptz("link_checked_at"),
    // Checks in a row that found the page gone. Any live answer resets it to 0.
    linkFailures: integer("link_failures").notNull().default(0),
    // When the page was first found gone for `LINK_DEAD_AFTER_FAILURES` checks in a row; null
    // while it answers. The first time stays through further failures.
    linkDeadSince: timestamptz("link_dead_since"),
    // What keyword search matches, kept up to date by Postgres. `simple` doesn't stem, so words
    // in any language are matched as written. The weights rank both titles over note over excerpt.
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('simple', ${clippings.title}), 'A') || setweight(to_tsvector('simple', coalesce(${clippings.userTitle}, '')), 'A') || setweight(to_tsvector('simple', ${clippings.note}), 'B') || setweight(to_tsvector('simple', coalesce(${clippings.excerpt}, '')), 'C')`,
    ),
  },
  (table) => [
    unique("clippings_user_id_url_normalized_key").on(table.userId, table.urlNormalized),
    // What `clipping_tags` points at, so a link can only join a user's clipping to their own tag.
    unique("clippings_id_user_id_key").on(table.id, table.userId),
    check("clippings_status_check", sql`${table.status} in (${inList(CLIPPING_STATUSES)})`),
    check("clippings_source_check", sql`${table.source} in (${inList(CLIPPING_SOURCES)})`),
    index("clippings_user_newest_idx").on(table.userId, table.createdAt.desc(), table.id.desc()),
    index("clippings_search_tsv_idx").using("gin", table.searchTsv),
    // Typo tolerance on the title to show: `<%` (word similarity) uses it, and the expression
    // must be the one `shownTitle` writes in the service.
    index("clippings_shown_title_trgm_idx").using(
      "gin",
      sql`coalesce(${table.userTitle}, ${table.title}) gin_trgm_ops`,
    ),
    // The pinned group of the browse read.
    index("clippings_user_pinned_idx")
      .on(table.userId, table.pinnedAt.desc())
      .where(sql`${table.pinnedAt} is not null and ${table.deletedAt} is null`),
    // The import backlog the daily drain takes from, oldest first.
    index("clippings_pending_imports_idx")
      .on(table.statusChangedAt, table.createdAt)
      .where(
        sql`${table.source} = 'import' and ${table.status} = 'pending' and ${table.deletedAt} is null`,
      ),
    // The daily sweep's clippings waiting on enrichment since before its cutoff.
    index("clippings_stuck_idx")
      .on(table.statusChangedAt)
      .where(sql`${table.status} in ('pending', 'failed') and ${table.deletedAt} is null`),
    // The daily link check's order: never checked first, then the longest unchecked.
    index("clippings_link_check_idx")
      .on(table.linkCheckedAt.asc().nullsFirst(), table.id)
      .where(sql`${table.status} = 'ready' and ${table.deletedAt} is null`),
    // The daily embedding backfill, newest first. Rows leave the index once embedded.
    index("clippings_unembedded_idx")
      // NULLS FIRST, as Postgres sorts `order by created_at desc`, so the index serves the order.
      .on(table.createdAt.desc().nullsFirst())
      .where(
        sql`${table.status} = 'ready' and ${table.embedding} is null and ${table.deletedAt} is null`,
      ),
    // The daily purge of clippings deleted a day ago.
    index("clippings_deleted_idx")
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} is not null`),
  ],
);

/** A name a user files clippings under. */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // As the user first typed it, normalized: "Work" and "work" are one tag.
    name: text("name").notNull(),
    // A name from `TAG_COLORS`, never a hex value: each palette renders it.
    color: text("color", { enum: TAG_COLORS }).notNull().default("none"),
    // No default: the service stamps it from its clock.
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("tags_user_id_name_key").on(table.userId, sql`lower(${table.name})`),
    unique("tags_id_user_id_key").on(table.id, table.userId),
    check("tags_color_check", sql`${table.color} in (${inList(TAG_COLORS)})`),
  ],
);

/**
 * Which tags each clipping carries. The user id is on every link, and both foreign keys include
 * it, so the database refuses to join one user's clipping to another user's tag.
 */
export const clippingTags = pgTable(
  "clipping_tags",
  {
    clippingId: uuid("clipping_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (table) => [
    primaryKey({ name: "clipping_tags_pkey", columns: [table.clippingId, table.tagId] }),
    foreignKey({
      name: "clipping_tags_clipping_fkey",
      columns: [table.clippingId, table.userId],
      foreignColumns: [clippings.id, clippings.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "clipping_tags_tag_fkey",
      columns: [table.tagId, table.userId],
      foreignColumns: [tags.id, tags.userId],
    }).onDelete("cascade"),
    // Filtering by a tag starts from the tag.
    index("clipping_tags_tag_id_idx").on(table.tagId),
  ],
);

/** Who read a clipping's page text: the server fetching the URL, or the user's browser. */
export const PAGE_TEXT_ORIGINS = ["fetch", "browser"] as const;

/**
 * The readable text of a clipping's page, as the last enrichment read it (cut to what the
 * summarizer takes). One row per clipping, replaced on every re-read and absent when the page had
 * no text. The foreign key includes the user id, as in `clipping_tags`.
 *
 * `origin` says who read the page. A "browser" text came with a save from the extension, as the
 * user's browser showed the page, with the title the browser gave: enrichment reads it instead of
 * fetching, so a site that turns servers away (a bot wall) still gets read. A "fetch" text is what
 * the server fetched, and has no title here (the clipping's own title holds it).
 */
export const clippingTexts = pgTable(
  "clipping_texts",
  {
    clippingId: uuid("clipping_id").primaryKey(),
    userId: text("user_id").notNull(),
    text: text("text").notNull(),
    origin: text("origin", { enum: PAGE_TEXT_ORIGINS }).notNull().default("fetch"),
    // The page title the browser gave; null for a fetched text.
    title: text("title"),
    // No default: the service stamps it from its clock.
    fetchedAt: timestamptz("fetched_at").notNull(),
    // When a reading used the text. Null on a "browser" text means no reading has yet: it is for
    // the next one, which uses it without fetching. A "fetch" text is written by its reading (a
    // null there is a row from before this column, and counts as read).
    readAt: timestamptz("read_at"),
  },
  (table) => [
    foreignKey({
      name: "clipping_texts_clipping_fkey",
      columns: [table.clippingId, table.userId],
      foreignColumns: [clippings.id, clippings.userId],
    }).onDelete("cascade"),
    check("clipping_texts_origin_check", sql`${table.origin} in (${inList(PAGE_TEXT_ORIGINS)})`),
  ],
);

/** Where a tag suggestion came from. */
export const SUGGESTION_ORIGINS = ["model", "neighbours"] as const;

/**
 * A tag enrichment suggests for a clipping. Never applied by itself: the user accepts it (it
 * becomes a `clipping_tags` link and this row goes) or dismisses it (`dismissed_at` is set, and
 * the row stays so a re-read doesn't suggest the name again). The user id is on every row and the
 * foreign key includes it, as in `clipping_tags`.
 */
export const clippingTagSuggestions = pgTable(
  "clipping_tag_suggestions",
  {
    clippingId: uuid("clipping_id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    origin: text("origin", { enum: SUGGESTION_ORIGINS }).notNull(),
    dismissedAt: timestamptz("dismissed_at"),
    // No default: the service stamps it from its clock.
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "clipping_tag_suggestions_clipping_fkey",
      columns: [table.clippingId, table.userId],
      foreignColumns: [clippings.id, clippings.userId],
    }).onDelete("cascade"),
    // A name is suggested once per clipping, ignoring case, like the user's tag names.
    uniqueIndex("clipping_tag_suggestions_name_key").on(
      table.clippingId,
      sql`lower(${table.name})`,
    ),
    check(
      "clipping_tag_suggestions_origin_check",
      sql`${table.origin} in (${inList(SUGGESTION_ORIGINS)})`,
    ),
  ],
);

/** A user's appearance settings: one row per user, created the first time they change one. */
export const userSettings = pgTable(
  "user_settings",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    theme: text("theme", { enum: APPEARANCE_VALUES.theme })
      .notNull()
      .default(APPEARANCE_DEFAULTS.theme),
    palette: text("palette", { enum: APPEARANCE_VALUES.palette })
      .notNull()
      .default(APPEARANCE_DEFAULTS.palette),
    contrast: text("contrast", { enum: APPEARANCE_VALUES.contrast })
      .notNull()
      .default(APPEARANCE_DEFAULTS.contrast),
    density: text("density", { enum: APPEARANCE_VALUES.density })
      .notNull()
      .default(APPEARANCE_DEFAULTS.density),
    // Whether enrichment proposes tags for the user's clippings. Off until they turn it on.
    suggestTags: boolean("suggest_tags").notNull().default(false),
    // No default: the service stamps it from its clock.
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    check("user_settings_theme_check", sql`${table.theme} in (${inList(APPEARANCE_VALUES.theme)})`),
    check(
      "user_settings_palette_check",
      sql`${table.palette} in (${inList(APPEARANCE_VALUES.palette)})`,
    ),
    check(
      "user_settings_contrast_check",
      sql`${table.contrast} in (${inList(APPEARANCE_VALUES.contrast)})`,
    ),
    check(
      "user_settings_density_check",
      sql`${table.density} in (${inList(APPEARANCE_VALUES.density)})`,
    ),
  ],
);

/**
 * A user's digest of one finished week (Monday to Sunday, UTC), written once by the daily cron.
 * `week_start` is that Monday. `digest` is the model's grouping of the week's clippings and the
 * older ones it brought back, as clipping ids with the model's words; titles are read from the
 * clippings when the page is shown, so a rename or a delete shows through.
 */
export const weeklyDigests = pgTable(
  "weekly_digests",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    digest: jsonb("digest").notNull(),
    // No default: the service stamps it from its clock.
    createdAt: timestamptz("created_at").notNull(),
  },
  (table) => [
    primaryKey({ name: "weekly_digests_pkey", columns: [table.userId, table.weekStart] }),
  ],
);
