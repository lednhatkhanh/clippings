import { getPool } from "@/lib/db.ts";
import { createResearchService, systemClock, type ResearchService } from "@clippings/db";

let service: ResearchService | undefined;

/** The research briefs service on the shared pool. */
export function getResearch(): ResearchService {
  return (service ??= createResearchService({ pool: getPool(), clock: systemClock }));
}
