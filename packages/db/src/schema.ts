import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { CLIPPING_SOURCES, CLIPPING_STATUSES } from "@clippings/shared";

/**
 * Every table in the database. This file is the source of truth: `drizzle-kit generate` turns a
 * change here into the SQL migration in `drizzle/`, and `check:schema` fails when the two
 * disagree.
 */

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

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
    status: text("status", { enum: CLIPPING_STATUSES }).notNull().default("pending"),
    source: text("source", { enum: CLIPPING_SOURCES }).notNull(),
    clientId: text("client_id"),
    // No default: the service stamps both from its clock, so tests control time and the list
    // cursor round-trips exactly.
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (table) => [
    unique("clippings_user_id_url_normalized_key").on(table.userId, table.urlNormalized),
    check("clippings_status_check", sql`${table.status} in (${inList(CLIPPING_STATUSES)})`),
    check("clippings_source_check", sql`${table.source} in (${inList(CLIPPING_SOURCES)})`),
    index("clippings_user_newest_idx").on(table.userId, table.createdAt.desc(), table.id.desc()),
  ],
);
