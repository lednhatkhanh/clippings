import Anthropic from "@anthropic-ai/sdk";

/** The wording of a 400 that says the workspace's spend limit or the credit is used up. */
const EXHAUSTED_MESSAGE = /usage limit|spend limit|credit balance is too low/i;

/**
 * Whether Anthropic refused a call because money ran out, not because the call was wrong or the
 * service was busy: a workspace spend limit (HTTP 400 "…workspace API usage limits…"), an empty
 * credit balance (HTTP 400 "credit balance is too low", or a billing error) or an account's tier
 * cap (HTTP 429 with no `retry-after`, since an ordinary rate limit always says when to come
 * back). Such a call will fail until the limit resets, so retrying only burns attempts: the work
 * is held instead.
 *
 * Wording is a last resort (the API offers no stable code for these); the status, error type and
 * header are checked first.
 */
export function isSpendLimitError(error: unknown): boolean {
  if (!(error instanceof Anthropic.APIError)) return false;
  if (error.status === 402 || error.type === "billing_error") return true;
  if (error.status === 400) return EXHAUSTED_MESSAGE.test(error.message);
  if (error.status === 429) return !error.headers?.get("retry-after");
  return false;
}
