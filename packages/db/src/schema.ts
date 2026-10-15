import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { CLIPPING_SOURCES, CLIPPING_STATUSES } from "@clippings/shared";

/**
 * Tables the app queries, mirroring `migrations/*.sql`, which stay the source of truth: they are
 * reviewed SQL, written expand/contract. `schema.test.ts` fails when the two drift. Better Auth
 * owns its own tables (`user`, `session`, ...) and they are not declared here.
 */
export const clippings = pgTable(
  "clippings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    url: text("url").notNull(),
    urlNormalized: text("url_normalized").notNull(),
    title: text("title").notNull(),
    note: text("note").notNull().default(""),
    status: text("status", { enum: CLIPPING_STATUSES }).notNull().default("pending"),
    source: text("source", { enum: CLIPPING_SOURCES }).notNull(),
    clientId: text("client_id"),
    // No default: the service stamps both from its clock (see 0003_clippings.sql).
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [unique("clippings_user_id_url_normalized_key").on(table.userId, table.urlNormalized)],
);
