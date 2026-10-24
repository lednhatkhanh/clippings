import { EMBEDDING_DIMENSIONS, type Embedder, type EmbeddingPurpose } from "@clippings/db";

/** Voyage AI's general model (ADR 0001). Changing it means embedding every clipping again. */
export const EMBEDDING_MODEL = "voyage-4";

/**
 * How long a call may take. A document is embedded in the enrichment job, which QStash retries; a
 * query is embedded while the user waits, and search falls back to words when it is slow.
 */
const TIMEOUT_MS: Record<EmbeddingPurpose, number> = { document: 20_000, query: 3_000 };

/** Most texts Voyage AI takes in one call. */
const MAX_INPUTS_PER_CALL = 128;

/**
 * Voyage AI's embeddings API. Reads `VOYAGE_API_KEY`, and `VOYAGE_BASE_URL` only for pointing at
 * a fake.
 */
export function createEmbedder(): Embedder {
  /** One call for up to `MAX_INPUTS_PER_CALL` texts. */
  async function call(
    texts: readonly string[],
    purpose: EmbeddingPurpose,
    signal?: AbortSignal,
  ): Promise<number[][]> {
    // Read on each call, so a missing key breaks embedding and not every page that loads.
    const key = process.env.VOYAGE_API_KEY;
    if (!key) throw new Error("VOYAGE_API_KEY is not set");
    const base = process.env.VOYAGE_BASE_URL ?? "https://api.voyageai.com";

    const timeout = AbortSignal.timeout(TIMEOUT_MS[purpose]);
    const response = await fetch(new URL("/v1/embeddings", base), {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        input: texts,
        model: EMBEDDING_MODEL,
        input_type: purpose,
        output_dimension: EMBEDDING_DIMENSIONS,
        // A long page is cut to the model's context rather than refused.
        truncation: true,
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      throw new Error(`Voyage AI answered ${response.status}: ${await response.text()}`);
    }
    const body = (await response.json()) as { data?: { embedding?: unknown; index?: number }[] };
    const data = body.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new Error("Voyage AI returned the wrong number of embeddings");
    }
    // The service checks the length and that every entry is a number.
    return data
      .toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(({ embedding }) => {
        if (!Array.isArray(embedding)) throw new Error("Voyage AI returned no embedding");
        return embedding as number[];
      });
  }

  return {
    async embed(text, purpose, signal) {
      return (await call([text], purpose, signal))[0]!;
    },
    async embedMany(texts, purpose) {
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += MAX_INPUTS_PER_CALL) {
        vectors.push(...(await call(texts.slice(start, start + MAX_INPUTS_PER_CALL), purpose)));
      }
      return vectors;
    },
  };
}
