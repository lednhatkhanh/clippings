import { sql } from "drizzle-orm";

import type { Database } from "../database.ts";

/** What `db.transaction` hands its callback. */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Lets one user's librarian writes take turns, so a check and the write after it can't be split.
 * Anything that reads then writes the change log or the tags a change touches (a proposal, a
 * decision on a suggestion, an undo) takes it first.
 */
export async function lockUser(tx: Transaction, userId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`librarian:${userId}`}, 0))`,
  );
}
