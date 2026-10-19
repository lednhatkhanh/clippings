import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
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
    title: text("title").notNull(),
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
    // What keyword search matches, kept up to date by Postgres. `simple` doesn't stem, so words
    // in any language are matched as written. The weights rank title over note over excerpt.
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('simple', ${clippings.title}), 'A') || setweight(to_tsvector('simple', ${clippings.note}), 'B') || setweight(to_tsvector('simple', coalesce(${clippings.excerpt}, '')), 'C')`,
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
    // Typo tolerance on titles: `<%` (word similarity) uses it.
    index("clippings_title_trgm_idx").using("gin", table.title.op("gin_trgm_ops")),
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
