import { getPool } from "@/lib/db.ts";
import { createJobPublisher } from "@/lib/enrichment/job-publisher.ts";
import { createPageFetcher } from "@/lib/enrichment/page-fetcher.ts";
import { createSummarizer } from "@/lib/enrichment/summarizer.ts";
import { createClippingsService, systemClock, type ClippingsService } from "@clippings/db";

let service: ClippingsService | undefined;

/** The Clippings service on the shared pool, with the real page fetcher, Haiku and QStash. */
export function getClippings(): ClippingsService {
  return (service ??= createClippingsService({
    pool: getPool(),
    jobs: createJobPublisher(),
    clock: systemClock,
    fetcher: createPageFetcher(),
    summarizer: createSummarizer(),
  }));
}
