import Anthropic from "@anthropic-ai/sdk";

import { getPool } from "@/lib/db.ts";
import { createUsageService, systemClock, type UsageService } from "@clippings/db";

import { createGateway, type Gateway } from "./gateway.ts";

let usage: UsageService | undefined;
let gateway: Gateway | undefined;
let anthropic: Anthropic | undefined;

/** The usage ledger on the shared pool. */
export function getUsage(): UsageService {
  return (usage ??= createUsageService({ pool: getPool(), clock: systemClock }));
}

/**
 * The model gateway on the shared pool and the real providers. Reads `ANTHROPIC_API_KEY` (and
 * `ANTHROPIC_BASE_URL`, for pointing at a fake) when the first Claude call is made.
 */
export function getGateway(): Gateway {
  return (gateway ??= createGateway({
    ledger: getUsage(),
    // No SDK retries: QStash retries the whole job, and a retry the SDK made would be billed
    // without the gateway seeing it. Each call brings its own timeout.
    anthropic: () => (anthropic ??= new Anthropic({ maxRetries: 0 })),
  }));
}
