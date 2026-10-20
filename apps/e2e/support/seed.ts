import type pg from "pg";

import { EMBEDDING_DIMENSIONS } from "@clippings/db";

/**
 * Gives all of the user's clippings the same embedding, so each is "nearest in meaning" to the
 * others and shows up under Related on their detail pages. Enrichment would embed them, but a
 * seeded clipping stays pending and nothing is embedded.
 */
export async function makeAllRelated(database: pg.Pool, userId: string) {
  const vector = `[${new Array(EMBEDDING_DIMENSIONS).fill(0.1).join(",")}]`;
  await database.query("update clippings set embedding = $1::vector where user_id = $2", [
    vector,
    userId,
  ]);
}
