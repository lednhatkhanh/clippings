import type { Receiver } from "@upstash/qstash";

import type { ClippingsService } from "@clippings/db";

/**
 * How many times QStash redelivers a job after the first try. The delivery that carries this
 * count in `Upstash-Retried` is the last one.
 */
export const ENRICHMENT_RETRIES = 3;

export interface EnrichRequestDeps {
  receiver: Pick<Receiver, "verify">;
  service: Pick<ClippingsService, "enrichClipping">;
}

const NOT_RETRYABLE = { "Upstash-NonRetryable-Error": "true" };

function clippingIdOf(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    const id = (parsed as { clippingId?: unknown } | null)?.clippingId;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/**
 * A QStash delivery of an enrichment job. The signature is the only credential, so nothing runs
 * before it checks out. Any non-2xx answer makes QStash retry with backoff.
 */
export async function handleEnrichRequest(
  request: Request,
  { receiver, service }: EnrichRequestDeps,
): Promise<Response> {
  const signature = request.headers.get("Upstash-Signature");
  const body = await request.text();
  if (!signature) return new Response("Missing signature", { status: 401 });
  try {
    if (!(await receiver.verify({ signature, body }))) throw new Error("Bad signature");
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }

  const clippingId = clippingIdOf(body);
  if (!clippingId) {
    return new Response("Not an enrichment job", { status: 400, headers: NOT_RETRYABLE });
  }

  const retried = Number(request.headers.get("Upstash-Retried") ?? 0);
  try {
    const outcome = await service.enrichClipping(clippingId, {
      lastAttempt: retried >= ENRICHMENT_RETRIES,
    });
    return Response.json({ outcome });
  } catch (error) {
    console.error(`Enrichment of ${clippingId} failed (attempt ${retried + 1})`, error);
    return new Response("Enrichment failed", { status: 500 });
  }
}
