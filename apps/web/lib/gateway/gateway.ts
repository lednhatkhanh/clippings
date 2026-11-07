import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageBatchIndividualResponse,
  MessageBatchResult,
} from "@anthropic-ai/sdk/resources/messages/batches";

import type { UsageService } from "@clippings/db";
import { EMBEDDING_DIMENSIONS } from "@clippings/db";
import type { ModelJobKind } from "@clippings/shared";

import { mayCall, spendLimitMicros } from "./cap.ts";
import {
  claudeCostMicros,
  hasClaudeRate,
  hasVoyageRate,
  UnknownModelError,
  voyageCostMicros,
} from "./rates.ts";
import { isSpendLimitError } from "./spend-limit.ts";

/** Voyage AI's general model (ADR 0001). Changing it means embedding every clipping again. */
export const EMBEDDING_MODEL = "voyage-4";

/** Why the gateway made no call (or the provider made none for it). */
export type CapReason =
  /** The user's ledger for today is at their cap, or at 80% of it for a job that stops there. */
  | "daily_cap"
  /** Anthropic refused: a workspace spend limit, an empty credit balance or a tier cap. */
  | "provider_limit";

/**
 * What a gateway call came to: its result, or a refusal. Callers branch on the status; none reads
 * tokens or prices.
 */
export type GatewayResult<T> =
  | { status: "ok"; value: T; costMicros: number }
  | { status: "cap_reached"; reason: CapReason };

export interface GatewayDeps {
  /** The ledger: today's spend against the cap before a call, and one row after it. */
  ledger: Pick<UsageService, "getBudget" | "recordUsage">;
  /** The Anthropic client, built on first use so a missing key breaks calls, not every page. */
  anthropic: () => Anthropic;
}

export interface MessageCall {
  userId: string;
  jobKind: ModelJobKind;
  request: Anthropic.MessageCreateParamsNonStreaming;
  timeoutMs?: number;
}

/** One request of a batch. */
export interface BatchEntry {
  /** The id its result comes back under; unique within the batch. */
  customId: string;
  userId: string;
  jobKind: ModelJobKind;
  request: Anthropic.MessageCreateParamsNonStreaming;
  /**
   * About what the request will cost, in micro-dollars. A batch is paid for when it ends, so
   * `submitBatch` counts the estimates of a user's accepted entries as spent and holds the rest
   * once they would carry the user past the cap. Left out, the entry reserves nothing.
   */
  estimateMicros?: number;
}

export interface BatchSubmission {
  /** Null when no entry was accepted, so no batch was made. */
  batchId: string | null;
  /** The `customId`s that went into the batch. */
  accepted: string[];
  /** The entries that didn't: the caller keeps them for another day. */
  held: { customId: string; reason: CapReason }[];
}

/** One request of an ended batch. */
export type BatchItemResult =
  | { customId: string; outcome: "succeeded"; message: Anthropic.Message; costMicros: number }
  | {
      customId: string;
      outcome: "errored" | "expired" | "canceled";
      /** What went wrong, in a phrase fit for a log or a note. */
      detail: string;
    };

export type BatchCollection =
  | { status: "in_progress" }
  | { status: "ended"; results: BatchItemResult[] };

export interface EmbedCall {
  userId: string;
  jobKind: ModelJobKind;
  texts: readonly string[];
  /** Retrieval models embed a query and the document it should find differently. */
  purpose: "document" | "query";
  timeoutMs: number;
  signal?: AbortSignal;
}

/** How long a call to the Batch API may take; the results file can be large. */
const BATCH_TIMEOUT_MS = 120_000;

/** What a response's `usage` came to, in the units the ledger and the rate table share. */
function countUsage(usage: Anthropic.Usage) {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    cacheWrite1hTokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    webSearches: usage.server_tool_use?.web_search_requests ?? 0,
  };
}

/** Why a batch request produced no message, in a phrase fit for a log or a note. */
function failureDetail(result: Exclude<MessageBatchResult, { type: "succeeded" }>): string {
  switch (result.type) {
    case "errored":
      return `${result.error.error.type}: ${result.error.error.message}`;
    case "expired":
      return "The request expired before it was processed";
    case "canceled":
      return "The request was canceled";
  }
}

/**
 * The one door to the paid models. Every Claude and Voyage AI call goes through it:
 *
 * 1. It reads the user's spend today and cap from the ledger and, past the limit for the call's
 *    job kind (`mayCall`), returns "cap_reached" without calling.
 * 2. It calls.
 * 3. It writes a ledger row from the response's own usage, priced from the rate table.
 *
 * Anthropic's own refusals for money (see `isSpendLimitError`) return the same "cap_reached", so
 * callers hold the work instead of failing it. Every other error is thrown as it came.
 *
 * The check and the call are not one step: calls in flight at the same moment can each pass and
 * overshoot the cap by what they cost. The cap bounds a runaway loop to a day's cap plus a
 * handful of calls, which is what it is for.
 */
export function createGateway({ ledger, anthropic }: GatewayDeps) {
  /** Null when the call may go ahead. */
  async function refusal(userId: string, jobKind: ModelJobKind): Promise<CapReason | null> {
    const budget = await ledger.getBudget(userId);
    return mayCall({ jobKind, ...budget }) ? null : "daily_cap";
  }

  /**
   * The row is written after the money is spent, so a failed write is logged and not thrown: it
   * would throw away a result that was paid for (and a retry would pay again).
   */
  async function record(...args: Parameters<UsageService["recordUsage"]>): Promise<void> {
    try {
      await ledger.recordUsage(...args);
    } catch (error) {
      console.error(`Couldn't record ${args[1].model} usage for ${args[0]}`, error);
    }
  }

  /**
   * Writes a response's usage to the ledger and returns what it cost. `message` and
   * `collectBatch` both use it, so they count tokens and searches the same way; only `batch`
   * differs.
   */
  async function recordClaude(
    userId: string,
    jobKind: ModelJobKind,
    model: string,
    usage: Anthropic.Usage,
    batch: boolean,
    requestKey?: string,
  ): Promise<number> {
    const counted = countUsage(usage);
    const costMicros = claudeCostMicros(model, counted, { batch });
    const { cacheWrite1hTokens: _lifetime, ...entry } = counted;
    await record(userId, {
      jobKind,
      model,
      batch,
      costMicros,
      ...entry,
      ...(requestKey === undefined ? {} : { requestKey }),
    });
    return costMicros;
  }

  /** A Messages API call. */
  async function message({
    userId,
    jobKind,
    request,
    timeoutMs,
  }: MessageCall): Promise<GatewayResult<Anthropic.Message>> {
    const { model } = request;
    if (!hasClaudeRate(model)) throw new UnknownModelError(model);
    const reason = await refusal(userId, jobKind);
    if (reason) return { status: "cap_reached", reason };

    let response: Anthropic.Message;
    try {
      response = await anthropic().messages.create(
        request,
        timeoutMs === undefined ? undefined : { timeout: timeoutMs },
      );
    } catch (error) {
      if (isSpendLimitError(error)) return { status: "cap_reached", reason: "provider_limit" };
      throw error;
    }

    const costMicros = await recordClaude(userId, jobKind, model, response.usage, false);
    return { status: "ok", value: response, costMicros };
  }

  /**
   * Sends requests to the Batch API, which answers within a day for half the token price. Each
   * entry is checked against its user's cap first, as `message` does, but a batch is paid for only
   * when it ends, so the check counts what the user's earlier entries in this batch will cost
   * (`estimateMicros`) as already spent: a user's entries are accepted only while today's spend plus
   * those estimates stays within the limit for the job kind. The ones past it are `held` and left
   * out. Nothing is recorded yet: `collectBatch` writes the ledger rows when the results
   * arrive. A workspace spend limit on the create holds every entry (`provider_limit`). Any other
   * error is thrown.
   */
  async function submitBatch(entries: readonly BatchEntry[]): Promise<BatchSubmission> {
    const accepted: BatchEntry[] = [];
    const held: BatchSubmission["held"] = [];
    const budgets = new Map<string, ReturnType<UsageService["getBudget"]>>();
    const reserved = new Map<string, number>();
    for (const entry of entries) {
      if (!hasClaudeRate(entry.request.model)) throw new UnknownModelError(entry.request.model);
      const { userId, jobKind, estimateMicros = 0 } = entry;
      let pending = budgets.get(userId);
      if (!pending) budgets.set(userId, (pending = ledger.getBudget(userId)));
      const { spentTodayMicros, dailyCapMicros } = await pending;
      const projected = spentTodayMicros + (reserved.get(userId) ?? 0);
      const limit = spendLimitMicros(jobKind, dailyCapMicros);
      if (projected >= limit || projected + estimateMicros > limit) {
        held.push({ customId: entry.customId, reason: "daily_cap" });
        continue;
      }
      reserved.set(userId, (reserved.get(userId) ?? 0) + estimateMicros);
      accepted.push(entry);
    }
    if (accepted.length === 0) return { batchId: null, accepted: [], held };

    try {
      const batch = await anthropic().messages.batches.create(
        {
          requests: accepted.map(({ customId, request }) => ({
            custom_id: customId,
            params: request,
          })),
        },
        { timeout: BATCH_TIMEOUT_MS },
      );
      return { batchId: batch.id, accepted: accepted.map((entry) => entry.customId), held };
    } catch (error) {
      if (!isSpendLimitError(error)) throw error;
      const refused = accepted.map(({ customId }) => ({
        customId,
        reason: "provider_limit" as const,
      }));
      return { batchId: null, accepted: [], held: [...held, ...refused] };
    }
  }

  /**
   * Asks whether a batch has ended and, once it has, reads its results and writes a ledger row
   * (`batch: true`) for each request that produced a message. `owners` maps a `customId` to whom
   * to bill: a result with no owner is skipped, which keeps a request that was already handled
   * from being billed twice. A row is keyed by the batch and request, so collecting the same
   * batch again writes none. A batch the provider no longer has (`NotFoundError`: its results are
   * kept for 29 days) ends with every owner's request `expired`.
   */
  async function collectBatch(
    batchId: string,
    owners: ReadonlyMap<string, { userId: string; jobKind: ModelJobKind }>,
  ): Promise<BatchCollection> {
    const options = { timeout: BATCH_TIMEOUT_MS };
    const items: MessageBatchIndividualResponse[] = [];
    try {
      const batch = await anthropic().messages.batches.retrieve(batchId, undefined, options);
      if (batch.processing_status !== "ended") return { status: "in_progress" };
      const decoder = await anthropic().messages.batches.results(batchId, undefined, options);
      for await (const item of decoder) {
        if (owners.has(item.custom_id)) items.push(item);
      }
    } catch (error) {
      if (!(error instanceof Anthropic.NotFoundError)) throw error;
      // Asked about for ever otherwise.
      return {
        status: "ended",
        results: [...owners.keys()].map((customId) => ({
          customId,
          outcome: "expired" as const,
          detail: "The provider no longer has the batch",
        })),
      };
    }
    // Before any row is written, so a model with no rate fails the collection whole and a retry
    // doesn't bill the first results twice.
    for (const { result } of items) {
      if (result.type === "succeeded" && !hasClaudeRate(result.message.model)) {
        throw new UnknownModelError(result.message.model);
      }
    }

    const results: BatchItemResult[] = [];
    for (const { custom_id: customId, result } of items) {
      if (result.type !== "succeeded") {
        results.push({ customId, outcome: result.type, detail: failureDetail(result) });
        continue;
      }
      const { userId, jobKind } = owners.get(customId)!;
      const { message } = result;
      const costMicros = await recordClaude(
        userId,
        jobKind,
        message.model,
        message.usage,
        true,
        `batch:${batchId}:${customId}`,
      );
      results.push({ customId, outcome: "succeeded", message, costMicros });
    }
    return { status: "ended", results };
  }

  /** One Voyage AI embeddings call for up to 128 texts: one vector per text, in order. */
  async function embed({
    userId,
    jobKind,
    texts,
    purpose,
    timeoutMs,
    signal,
  }: EmbedCall): Promise<GatewayResult<number[][]>> {
    if (!hasVoyageRate(EMBEDDING_MODEL)) throw new UnknownModelError(EMBEDDING_MODEL);
    const reason = await refusal(userId, jobKind);
    if (reason) return { status: "cap_reached", reason };

    // Read on each call, so a missing key breaks embedding and not every page that loads.
    const key = process.env.VOYAGE_API_KEY;
    if (!key) throw new Error("VOYAGE_API_KEY is not set");
    const base = process.env.VOYAGE_BASE_URL ?? "https://api.voyageai.com";

    const timeout = AbortSignal.timeout(timeoutMs);
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
    // A 2xx was billed, whatever the body says: record it before the body is checked, so a reply
    // that is malformed (or not JSON at all) still reaches the ledger.
    const body = (await response.json().catch(() => null)) as {
      data?: { embedding?: unknown; index?: number }[];
      usage?: { total_tokens?: unknown };
    } | null;

    // Voyage AI reports the tokens it counted. Should a reply leave them out, price the text at
    // about four characters a token rather than record the call as free.
    const reported = body?.usage?.total_tokens;
    const tokens =
      typeof reported === "number" && Number.isFinite(reported)
        ? reported
        : Math.ceil(texts.reduce((sum, text) => sum + text.length, 0) / 4);
    const costMicros = voyageCostMicros(EMBEDDING_MODEL, tokens);
    await record(userId, {
      jobKind,
      model: EMBEDDING_MODEL,
      batch: false,
      inputTokens: tokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearches: 0,
      costMicros,
    });

    const data = body?.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new Error("Voyage AI returned the wrong number of embeddings");
    }
    // The service checks the length and that every entry is a number.
    const vectors = data
      .toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(({ embedding }) => {
        if (!Array.isArray(embedding)) throw new Error("Voyage AI returned no embedding");
        return embedding as number[];
      });
    return { status: "ok", value: vectors, costMicros };
  }

  /**
   * Whether a call of this kind would be let through right now. A look ahead for work that is
   * costly before the call (fetching a page): `message` and `embed` still check for themselves,
   * and that check is the one that counts.
   */
  async function canSpend(userId: string, jobKind: ModelJobKind): Promise<boolean> {
    return (await refusal(userId, jobKind)) === null;
  }

  return { message, submitBatch, collectBatch, embed, canSpend };
}

export type Gateway = ReturnType<typeof createGateway>;
