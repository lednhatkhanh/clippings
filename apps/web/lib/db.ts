import { createPool } from "@clippings/db";

let pool: ReturnType<typeof createPool> | undefined;

/** One pool per server instance, on Neon's pooled URL. Lazy, so `next build` needs no secrets. */
export function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = createPool(url);
  }
  return pool;
}
