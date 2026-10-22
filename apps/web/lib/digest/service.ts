import { getClippings } from "@/lib/clippings/service.ts";
import { getPool } from "@/lib/db.ts";
import { createDigester } from "@/lib/enrichment/digester.ts";
import { createDigestService, systemClock, type DigestService } from "@clippings/db";

let service: DigestService | undefined;

/** The weekly digest service on the shared pool, with Haiku as the digester. */
export function getDigests(): DigestService {
  return (service ??= createDigestService({
    pool: getPool(),
    clock: systemClock,
    digester: createDigester(),
    clippings: getClippings(),
  }));
}
