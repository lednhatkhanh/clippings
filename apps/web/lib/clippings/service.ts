import { createClippingsService, systemClock, type ClippingsService } from "@clippings/db";

import { getPool } from "../db";
import { createJobPublisher } from "../enrichment/job-publisher";
import { createPageFetcher } from "../enrichment/page-fetcher";
import { createSummarizer } from "../enrichment/summarizer";

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
