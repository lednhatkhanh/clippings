import type { Gateway } from "@/lib/gateway/gateway.ts";
import { CapReachedError, type Embedder, type EmbeddingPurpose } from "@clippings/db";

/**
 * How long a call may take. A document is embedded in the enrichment job, which QStash retries; a
 * query is embedded while the user waits, and search falls back to words when it is slow.
 */
const TIMEOUT_MS: Record<EmbeddingPurpose, number> = { document: 20_000, query: 3_000 };

/** Most texts Voyage AI takes in one call. */
const MAX_INPUTS_PER_CALL = 128;

/**
 * Voyage AI's embeddings API (model and rate in the gateway), called through the model gateway.
 * Throws `CapReachedError` when the gateway refuses the call. The gateway reads `VOYAGE_API_KEY`,
 * and `VOYAGE_BASE_URL` only for pointing at a fake.
 */
export function createEmbedder(gateway: Pick<Gateway, "embed">): Embedder {
  /** One call for up to `MAX_INPUTS_PER_CALL` texts. */
  async function call(
    texts: readonly string[],
    purpose: EmbeddingPurpose,
    { userId, jobKind }: { userId: string; jobKind: "enrich" | "search" },
    signal?: AbortSignal,
  ): Promise<number[][]> {
    const result = await gateway.embed({
      userId,
      jobKind,
      texts,
      purpose,
      timeoutMs: TIMEOUT_MS[purpose],
      ...(signal && { signal }),
    });
    if (result.status === "cap_reached") throw new CapReachedError();
    return result.value;
  }

  return {
    async embed(text, purpose, owner, signal) {
      return (await call([text], purpose, owner, signal))[0]!;
    },
    async embedMany(texts, purpose, owner) {
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += MAX_INPUTS_PER_CALL) {
        vectors.push(
          ...(await call(texts.slice(start, start + MAX_INPUTS_PER_CALL), purpose, owner)),
        );
      }
      return vectors;
    },
  };
}
