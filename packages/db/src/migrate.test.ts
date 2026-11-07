import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "./migrate.ts";
import { TEST_DATABASE_URL, createTempDatabase, type TempDatabase } from "./test/temp-database.ts";

const SHIPPED = fileURLToPath(new URL("../drizzle", import.meta.url));
const LEGACY = fileURLToPath(new URL("./test/legacy-migrations", import.meta.url));
// What the old runner's three files add up to; it is adopted as already applied.
const BASELINE = "20261015180735_baseline";

async function withClient<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const tableNames = (url: string) =>
  withClient(url, async (client) => {
    const { rows } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    return rows.map((row) => row.table_name);
  });

/** What the old hand-written runner left behind: its SQL files applied and recorded by name. */
async function applyLegacyRunner(url: string, names: string[]) {
  await withClient(url, async (client) => {
    await client.query(
      "create table schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    for (const name of names) {
      await client.query(readFileSync(join(LEGACY, name), "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [name]);
    }
  });
}

/** A copy of the shipped migrations plus one that comes after them. */
function foldersWithExtraMigration(sql: string) {
  const folder = mkdtempSync(join(tmpdir(), "clippings-migrations-"));
  for (const name of readdirSync(SHIPPED)) {
    cpSync(join(SHIPPED, name), join(folder, name), { recursive: true });
  }
  const extra = "29990101000000_add_probe";
  mkdirSync(join(folder, extra));
  writeFileSync(join(folder, extra, "migration.sql"), sql);
  return { folder, extra };
}

/** A copy of the shipped migrations without one of them. */
function foldersWithout(skipped: string) {
  const folder = mkdtempSync(join(tmpdir(), "clippings-migrations-"));
  for (const name of readdirSync(SHIPPED)) {
    if (name.endsWith(skipped)) continue;
    cpSync(join(SHIPPED, name), join(folder, name), { recursive: true });
  }
  return folder;
}

/** A copy of the shipped migrations before one of them, and the names that were left out. */
function foldersBefore(first: string) {
  const folder = mkdtempSync(join(tmpdir(), "clippings-migrations-"));
  const left: string[] = [];
  for (const name of readdirSync(SHIPPED).toSorted()) {
    if (left.length > 0 || name.endsWith(first)) {
      left.push(name);
      continue;
    }
    cpSync(join(SHIPPED, name), join(folder, name), { recursive: true });
  }
  return { folder, left };
}

describe.skipIf(!TEST_DATABASE_URL)("migrate", () => {
  let database: TempDatabase;

  beforeEach(async () => {
    database = await createTempDatabase();
  });

  afterEach(async () => {
    await database.drop();
  });

  it("builds the whole schema and the extensions on an empty database, once", async () => {
    const first = await migrate({ connectionString: database.url });
    const second = await migrate({ connectionString: database.url });

    expect(first).toEqual(readdirSync(SHIPPED).toSorted());
    expect(second).toEqual([]);
    expect(await tableNames(database.url)).toEqual(
      expect.arrayContaining(["user", "session", "account", "verification", "clippings"]),
    );
    const extensions = await withClient(database.url, async (client) => {
      const { rows } = await client.query<{ extname: string }>("select extname from pg_extension");
      return rows.map((row) => row.extname);
    });
    expect(extensions).toEqual(expect.arrayContaining(["pg_trgm", "vector"]));
  });

  it("adopts a database the old runner migrated: keeps its data, runs only what comes after", async () => {
    await applyLegacyRunner(database.url, [
      "0001_better_auth.sql",
      "0002_extensions.sql",
      "0003_clippings.sql",
    ]);
    await withClient(database.url, async (client) => {
      await client.query(
        `insert into "user" ("id", "name", "email", "emailVerified") values ('u1', 'U', 'u@example.com', true)`,
      );
      await client.query(
        `insert into clippings (user_id, url, url_normalized, title, source, created_at, updated_at)
         values ('u1', 'https://example.com', 'https://example.com', 'https://example.com', 'web', now(), now())`,
      );
    });
    const { folder, extra } = foldersWithExtraMigration(
      "alter table clippings add column probe text;",
    );

    const applied = await migrate({ connectionString: database.url, migrationsFolder: folder });
    const again = await migrate({ connectionString: database.url, migrationsFolder: folder });

    expect(applied).toEqual([
      ...readdirSync(SHIPPED)
        .filter((name) => name !== BASELINE)
        .toSorted(),
      extra,
    ]);
    expect(again).toEqual([]);
    await withClient(database.url, async (client) => {
      const { rows } = await client.query("select probe, title from clippings");
      expect(rows).toEqual([{ probe: null, title: "https://example.com" }]);
    });
  });

  it("refuses a database the old runner left before its last migration", async () => {
    await applyLegacyRunner(database.url, ["0001_better_auth.sql"]);

    await expect(migrate({ connectionString: database.url })).rejects.toThrow(/old runner/);
  });

  it("allows clippings:write on OAuth clients registered before v2, except the extension's", async () => {
    await migrate({
      connectionString: database.url,
      migrationsFolder: foldersWithout("_oauth_clients_write_scope"),
    });
    const v1Scopes = ["openid", "profile", "email", "offline_access"];
    await withClient(database.url, async (client) => {
      const insert = (id: string, scopes: string[] | null, redirectUri: string) =>
        client.query(
          `insert into "oauthClient" ("id", "clientId", "scopes", "redirectUris") values ($1, $1, $2, $3)`,
          [id, scopes, [redirectUri]],
        );
      await insert("mcp", v1Scopes, "https://claude.ai/api/mcp/auth_callback");
      await insert("done", [...v1Scopes, "clippings:write"], "http://localhost:6274/callback");
      await insert("none", null, "https://example.com/callback");
      await insert("empty", [], "https://example.com/callback");
      await insert("extension", ["offline_access"], `https://${"a".repeat(32)}.chromiumapp.org/`);
    });

    expect(await migrate({ connectionString: database.url })).toHaveLength(1);

    await withClient(database.url, async (client) => {
      const { rows } = await client.query<{ id: string; scopes: string[] | null }>(
        `select "id", "scopes" from "oauthClient" order by "id"`,
      );
      expect(Object.fromEntries(rows.map((row) => [row.id, row.scopes]))).toEqual({
        mcp: [...v1Scopes, "clippings:write"],
        done: [...v1Scopes, "clippings:write"],
        none: null,
        empty: [],
        extension: ["offline_access"],
      });
    });
  });

  it("leaves auto-tagging on for every user, those who existed before the migration included", async () => {
    const { folder, left } = foldersBefore("_light_the_watchers");
    await migrate({ connectionString: database.url, migrationsFolder: folder });
    await withClient(database.url, async (client) => {
      await client.query(
        `insert into "user" ("id", "name", "email", "emailVerified") values ('with-row', 'with-row', 'with-row@example.com', true)`,
      );
      await client.query(
        `insert into user_settings (user_id, suggest_tags, updated_at) values ('with-row', true, now())`,
      );
    });

    expect(await migrate({ connectionString: database.url })).toEqual(left);

    await withClient(database.url, async (client) => {
      await client.query(
        `insert into "user" ("id", "name", "email", "emailVerified") values ('later', 'later', 'later@example.com', true)`,
      );
      await client.query(`insert into user_settings (user_id, updated_at) values ('later', now())`);
      const { rows } = await client.query<{
        user_id: string;
        auto_tag: boolean;
        suggest_tags: boolean;
      }>(`select user_id, auto_tag, suggest_tags from user_settings order by user_id`);
      expect(rows).toEqual([
        { user_id: "later", auto_tag: true, suggest_tags: false },
        { user_id: "with-row", auto_tag: true, suggest_tags: true },
      ]);
    });
  });

  it("lets a note have a body and no URL, and refuses any other mix of link and note", async () => {
    await migrate({ connectionString: database.url });
    await withClient(database.url, async (client) => {
      await client.query(
        `insert into "user" ("id", "name", "email", "emailVerified") values ('u1', 'U', 'u@example.com', true)`,
      );
      const insert = (kind: string, url: string | null, body: string | null) =>
        client.query(
          `insert into clippings (user_id, kind, url, url_normalized, body, title, source, created_at, updated_at)
           values ('u1', $1, $2, $2, $3, 't', 'web', now(), now())`,
          [kind, url, body],
        );

      await insert("link", "https://example.com", null);
      await insert("note", null, "my own words");
      // Notes have no URL, so two of them never count as duplicates.
      await insert("note", null, "more words");
      await expect(insert("link", null, null)).rejects.toThrow(/clippings_kind_shape_check/);
      await expect(insert("link", "https://example.org", "body")).rejects.toThrow(
        /clippings_kind_shape_check/,
      );
      await expect(insert("note", "https://example.net", "body")).rejects.toThrow(
        /clippings_kind_shape_check/,
      );
      await expect(insert("note", null, null)).rejects.toThrow(/clippings_kind_shape_check/);
      await expect(insert("link", "https://example.com", null)).rejects.toThrow(
        /clippings_user_id_url_normalized_key/,
      );

      // Keyword search finds a note by its body.
      const { rows } = await client.query(
        `select kind from clippings where search_tsv @@ plainto_tsquery('simple', 'words') order by body`,
      );
      expect(rows).toEqual([{ kind: "note" }, { kind: "note" }]);
    });
  });

  it("keeps folders, links and topic pages inside one user, and a deleted folder only unfiles", async () => {
    await migrate({ connectionString: database.url });
    await withClient(database.url, async (client) => {
      for (const id of ["u1", "u2"]) {
        await client.query(
          `insert into "user" ("id", "name", "email", "emailVerified") values ($1, $1, $1 || '@example.com', true)`,
          [id],
        );
      }
      const one = async (text: string, values: unknown[]) =>
        (await client.query<{ id: string }>(text, values)).rows[0]!.id;
      const clipping = (user: string, url: string) =>
        one(
          `insert into clippings (user_id, url, url_normalized, title, source, created_at, updated_at)
           values ($1, $2, $2, 't', 'web', now(), now()) returning id`,
          [user, url],
        );
      const folder = (user: string, name: string, color = "none") =>
        one(
          `insert into folders (user_id, name, color, created_at, updated_at)
           values ($1, $2, $3, now(), now()) returning id`,
          [user, name, color],
        );
      const tag = (user: string, name: string) =>
        one(`insert into tags (user_id, name, created_at) values ($1, $2, now()) returning id`, [
          user,
          name,
        ]);
      const link = (
        user: string,
        from: string,
        to: string,
        reason = "same topic",
        by = "librarian",
      ) =>
        client.query(
          `insert into item_links (user_id, from_id, to_id, reason, created_by, created_at)
           values ($1, $2, $3, $4, $5, now())`,
          [user, from, to, reason, by],
        );

      // Folders: names are unique per user ignoring case; colors are palette names.
      const work = await folder("u1", "Work", "blue");
      await folder("u2", "work");
      await expect(folder("u1", "WORK")).rejects.toThrow(/folders_user_id_name_key/);
      await expect(folder("u1", "Hex", "#ff0000")).rejects.toThrow(/folders_color_check/);
      await expect(folder("u1", "")).rejects.toThrow(/folders_name_check/);
      await expect(folder("u1", "x".repeat(61))).rejects.toThrow(/folders_name_check/);

      // An item sits in its own user's folder only, and existing rows have none.
      const a = await clipping("u1", "https://a.example");
      const b = await clipping("u1", "https://b.example");
      const other = await clipping("u2", "https://other.example");
      const filed = await tag("u1", "filed");
      await client.query(`update clippings set folder_id = $1 where id = $2`, [work, a]);
      await client.query(`update tags set folder_id = $1 where id = $2`, [work, filed]);
      await expect(
        client.query(`update clippings set folder_id = $1 where id = $2`, [work, other]),
      ).rejects.toThrow(/clippings_folder_fkey/);
      const foreignTag = await tag("u2", "foreign");
      await expect(
        client.query(`update tags set folder_id = $1 where id = $2`, [work, foreignTag]),
      ).rejects.toThrow(/tags_folder_fkey/);

      // Deleting a folder unfiles its items and keeps them (and their owner).
      await client.query(`delete from folders where id = $1`, [work]);
      const left = await client.query(
        `select (select folder_id from clippings where id = $1) as clipping_folder,
                (select user_id from clippings where id = $1) as clipping_user,
                (select folder_id from tags where id = $2) as tag_folder,
                (select color_overridden from tags where id = $2) as overridden`,
        [a, filed],
      );
      expect(left.rows).toEqual([
        { clipping_folder: null, clipping_user: "u1", tag_folder: null, overridden: false },
      ]);

      // Links: one per unordered pair, no self-links, no cross-user links.
      await link("u1", a, b);
      await expect(link("u1", b, a)).rejects.toThrow(/item_links_user_pair_key/);
      await expect(link("u1", a, b)).rejects.toThrow(/item_links_user_pair_key/);
      await expect(link("u1", a, a)).rejects.toThrow(/item_links_no_self_check/);
      await expect(link("u1", a, other)).rejects.toThrow(/item_links_to_fkey/);
      await expect(link("u1", other, a)).rejects.toThrow(/item_links_from_fkey/);
      await expect(link("u1", b, a, "")).rejects.toThrow(/item_links_reason_check/);
      await expect(link("u1", b, a, "x".repeat(301))).rejects.toThrow(/item_links_reason_check/);
      await expect(link("u1", b, a, "ok", "robot")).rejects.toThrow(/item_links_created_by_check/);
      const c = await clipping("u1", "https://c.example");
      await link("u1", c, a, "ok", "user_via_mcp");

      // A link goes with either of its clippings.
      await client.query(`delete from clippings where id = $1`, [c]);
      const links = await client.query(`select count(*)::int as n from item_links`);
      expect(links.rows).toEqual([{ n: 1 }]);

      // Topic pages: one per tag, only on the owner's tag, and gone with the tag.
      const insertPage = (user: string, tagId: string, body: string, source = "ai") =>
        client.query(
          `insert into topic_pages (tag_id, user_id, body, source, updated_at)
           values ($1, $2, $3, $4, now())`,
          [tagId, user, body, source],
        );
      await insertPage("u1", filed, "# Filed");
      await expect(insertPage("u1", filed, "again")).rejects.toThrow(/topic_pages_pkey/);
      await expect(insertPage("u1", foreignTag, "stolen")).rejects.toThrow(/topic_pages_tag_fkey/);
      await expect(insertPage("u2", foreignTag, "x".repeat(8_001))).rejects.toThrow(
        /topic_pages_body_check/,
      );
      await expect(insertPage("u2", foreignTag, "body", "user")).rejects.toThrow(
        /topic_pages_source_check/,
      );
      await client.query(`delete from tags where id = $1`, [filed]);
      const pages = await client.query(`select count(*)::int as n from topic_pages`);
      expect(pages.rows).toEqual([{ n: 0 }]);
    });
  });
});
