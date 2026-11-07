import { getPool } from "@/lib/db.ts";
import { createEmbedder } from "@/lib/enrichment/embedder.ts";
import { createJobPublisher } from "@/lib/enrichment/job-publisher.ts";
import { createPageFetcher } from "@/lib/enrichment/page-fetcher.ts";
import { createSummarizer } from "@/lib/enrichment/summarizer.ts";
import { getGateway } from "@/lib/gateway/service.ts";
import { createClippingsService, systemClock, type ClippingsService } from "@clippings/db";

let service: ClippingsService | undefined;

/**
 * The Clippings service on the shared pool, with the real page fetcher and QStash, and Haiku and
 * Voyage AI through the model gateway (which keeps the ledger and enforces the cap).
 */
export function getClippings(): ClippingsService {
  return (service ??= createClippingsService({
    pool: getPool(),
    jobs: createJobPublisher(),
    clock: systemClock,
    fetcher: createPageFetcher(),
    summarizer: createSummarizer(getGateway()),
    embedder: createEmbedder(getGateway()),
  }));
}
