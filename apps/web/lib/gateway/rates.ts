/**
 * What model calls cost: the one place prices live. A price change is an edit to the tables
 * below, nothing else. Rates are micro-dollars per million tokens, which is the same number as
 * dollars per million tokens times 1,000,000 ($0.10 per MTok is 100,000). Whole numbers all the
 * way, so the arithmetic is exact; only the final cost is rounded, up.
 *
 * Verified 2026-11-07 against the Anthropic pricing page and Voyage AI's pricing page
 * (docs/research/2026-11-07-scale-up-plan.md, section 1).
 */

/** Rates for one prompt-length band of a model. */
interface RateBand {
  /** Longest prompt (input + cache reads + cache writes) this band covers, in tokens. */
  upToPromptTokens: number;
  inputMicrosPerMTok: number;
  outputMicrosPerMTok: number;
}

/**
 * Claude models, by the model id the app sends. A model with a long-prompt surcharge lists its
 * bands shortest first; the last one covers everything above.
 */
export const CLAUDE_RATES: Readonly<Record<string, readonly RateBand[]>> = {
  // $0.10 / $0.50 per MTok up to 100K prompt tokens, $0.50 / $2.50 above.
  "claude-haiku-5-5": [
    { upToPromptTokens: 100_000, inputMicrosPerMTok: 100_000, outputMicrosPerMTok: 500_000 },
    {
      upToPromptTokens: Infinity,
      inputMicrosPerMTok: 500_000,
      outputMicrosPerMTok: 2_500_000,
    },
  ],
  // $2 / $10 per MTok.
  "claude-sonnet-5-5": [
    {
      upToPromptTokens: Infinity,
      inputMicrosPerMTok: 2_000_000,
      outputMicrosPerMTok: 10_000_000,
    },
  ],
};

/** Voyage AI embedding models: $0.06 per MTok for `voyage-4`. */
export const VOYAGE_RATES: Readonly<Record<string, number>> = {
  "voyage-4": 60_000,
};

/** The web search tool: $10 per 1,000 searches, not discounted in a batch. */
export const WEB_SEARCH_MICROS_EACH = 10_000;

// Prompt caching, as multiples of the model's input rate (the pricing page's table). Written as
// fractions so a rate stays a whole number: reads cost a tenth, a 5-minute write 5/4, an hour 2.
const CACHE_READ_DIVISOR = 10;
const CACHE_WRITE_5M_NUMERATOR = 5;
const CACHE_WRITE_5M_DIVISOR = 4;
const CACHE_WRITE_1H_MULTIPLE = 2;

/** The Batch API takes half off tokens. */
const BATCH_DIVISOR = 2;

const MICROS_PER_MICRO_MTOK = 1_000_000;

export class UnknownModelError extends Error {
  constructor(model: string) {
    super(`No rate for model ${model}; add it to the rate table`);
    this.name = "UnknownModelError";
  }
}

/** Whether the rate table can price this Claude model. */
export function hasClaudeRate(model: string): boolean {
  return Object.hasOwn(CLAUDE_RATES, model);
}

/** Whether the rate table can price this Voyage AI model. */
export function hasVoyageRate(model: string): boolean {
  return Object.hasOwn(VOYAGE_RATES, model);
}

/** The tokens one Claude response used, as its `usage` reports them. */
export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** All cache writes, whatever their lifetime. */
  cacheWriteTokens: number;
  /** Of `cacheWriteTokens`, those written with the 1-hour lifetime. */
  cacheWrite1hTokens?: number;
  webSearches: number;
}

/**
 * What one Claude call cost, in micro-dollars, rounded up. The band is chosen by prompt length
 * (input plus cache reads plus cache writes), and applies to the whole call, output included.
 * Batch halves the tokens, not the searches.
 */
export function claudeCostMicros(
  model: string,
  usage: ClaudeUsage,
  { batch = false }: { batch?: boolean } = {},
): number {
  const bands = hasClaudeRate(model) ? CLAUDE_RATES[model] : undefined;
  if (!bands) throw new UnknownModelError(model);

  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const band = bands.find(({ upToPromptTokens }) => prompt <= upToPromptTokens) ?? bands.at(-1)!;
  const input = band.inputMicrosPerMTok;
  const write1h = Math.min(usage.cacheWrite1hTokens ?? 0, usage.cacheWriteTokens);
  const write5m = usage.cacheWriteTokens - write1h;

  // Micro-dollars times a million: tokens multiplied by a rate per million tokens.
  const scaled =
    usage.inputTokens * input +
    (usage.cacheReadTokens * input) / CACHE_READ_DIVISOR +
    (write5m * input * CACHE_WRITE_5M_NUMERATOR) / CACHE_WRITE_5M_DIVISOR +
    write1h * input * CACHE_WRITE_1H_MULTIPLE +
    usage.outputTokens * band.outputMicrosPerMTok;
  const tokens = Math.ceil((batch ? scaled / BATCH_DIVISOR : scaled) / MICROS_PER_MICRO_MTOK);
  return tokens + usage.webSearches * WEB_SEARCH_MICROS_EACH;
}

/** What embedding `tokens` tokens with a Voyage AI model cost, in micro-dollars, rounded up. */
export function voyageCostMicros(model: string, tokens: number): number {
  const rate = hasVoyageRate(model) ? VOYAGE_RATES[model] : undefined;
  if (rate === undefined) throw new UnknownModelError(model);
  return Math.ceil((tokens * rate) / MICROS_PER_MICRO_MTOK);
}
