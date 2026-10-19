import { EMBEDDING_DIMENSIONS, type Embedder, type EmbeddingPurpose } from "@clippings/db";

/** Voyage AI's general model (ADR 0001). Changing it means embedding every clipping again. */
export const EMBEDDING_MODEL = "voyage-4";

/**
 * How long a call may take. A document is embedded in the enrichment job, which QStash retries; a
 * query is embedded while the user waits, and search falls back to words when it is slow.
 */
const TIMEOUT_MS: Record<EmbeddingPurpose, number> = { document: 20_000, query: 3_000 };

/**
 * Voyage AI's embeddings API. Reads `VOYAGE_API_KEY`, and `VOYAGE_BASE_URL` only for pointing at
 * a fake.
 */
export function createEmbedder(): Embedder {
  return {
    async embed(text, purpose) {
      // Read on each call, so a missing key breaks embedding and not every page that loads.
      const key = process.env.VOYAGE_API_KEY;
      if (!key) throw new Error("VOYAGE_API_KEY is not set");
      const base = process.env.VOYAGE_BASE_URL ?? "https://api.voyageai.com";

      const response = await fetch(new URL("/v1/embeddings", base), {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          input: [text],
          model: EMBEDDING_MODEL,
          input_type: purpose,
          output_dimension: EMBEDDING_DIMENSIONS,
          // A long page is cut to the model's context rather than refused.
          truncation: true,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS[purpose]),
      });
      if (!response.ok) {
        throw new Error(`Voyage AI answered ${response.status}: ${await response.text()}`);
      }
      const body = (await response.json()) as { data?: { embedding?: unknown }[] };
      const vector = body.data?.[0]?.embedding;
      if (!Array.isArray(vector)) throw new Error("Voyage AI returned no embedding");
      // The service checks the length and that every entry is a number.
      return vector as number[];
    },
  };
}
