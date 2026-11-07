import type Anthropic from "@anthropic-ai/sdk";

import type { UsageService } from "@clippings/db";
import { EMBEDDING_DIMENSIONS } from "@clippings/db";
import type { ModelJobKind } from "@clippings/shared";

import { mayCall } from "./cap.ts";
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

export interface EmbedCall {
  userId: string;
  jobKind: ModelJobKind;
  texts: readonly string[];
  /** Retrieval models embed a query and the document it should find differently. */
  purpose: "document" | "query";
  timeoutMs: number;
  signal?: AbortSignal;
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

    const { usage } = response;
    const counted = {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      cacheWrite1hTokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
      webSearches: usage.server_tool_use?.web_search_requests ?? 0,
    };
    const batch = false;
    const costMicros = claudeCostMicros(model, counted, { batch });
    const { cacheWrite1hTokens: _lifetime, ...entry } = counted;
    await record(userId, { jobKind, model, batch, costMicros, ...entry });
    return { status: "ok", value: response, costMicros };
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
    const body = (await response.json()) as {
      data?: { embedding?: unknown; index?: number }[];
      usage?: { total_tokens?: unknown };
    };
    const data = body.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new Error("Voyage AI returned the wrong number of embeddings");
    }

    // Voyage AI reports the tokens it counted. Should a reply leave them out, price the text at
    // about four characters a token rather than record the call as free.
    const reported = body.usage?.total_tokens;
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

    // The service checks the length and that every entry is a number.
    const vectors = data
      .toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(({ embedding }) => {
        if (!Array.isArray(embedding)) throw new Error("Voyage AI returned no embedding");
        return embedding as number[];
      });
    return { status: "ok", value: vectors, costMicros };
  }

  return { message, embed };
}

export type Gateway = ReturnType<typeof createGateway>;
