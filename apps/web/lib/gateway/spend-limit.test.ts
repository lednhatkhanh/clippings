import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { isSpendLimitError } from "./spend-limit.ts";

/** The error the SDK throws for a reply with this status, error type, message and headers. */
function apiError(
  status: number,
  type: string,
  message: string,
  headers: Record<string, string> = {},
) {
  return Anthropic.APIError.generate(
    status,
    { type: "error", error: { type, message } },
    message,
    new Headers(headers),
  );
}

describe("isSpendLimitError", () => {
  it.each([
    [
      "the workspace usage limit (HTTP 400)",
      apiError(
        400,
        "invalid_request_error",
        "You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.",
      ),
      true,
    ],
    [
      "an empty credit balance (HTTP 400)",
      apiError(
        400,
        "invalid_request_error",
        "Your credit balance is too low to access the Anthropic API.",
      ),
      true,
    ],
    ["a billing error type", apiError(402, "billing_error", "Payment required"), true],
    [
      "a tier cap: HTTP 429 with no retry-after",
      apiError(429, "rate_limit_error", "This request would exceed your account's spend limit."),
      true,
    ],
    [
      "an ordinary rate limit: HTTP 429 with retry-after",
      apiError(429, "rate_limit_error", "Rate limited", { "retry-after": "5" }),
      false,
    ],
    [
      "a bad request",
      apiError(400, "invalid_request_error", "max_tokens: must be greater than 0"),
      false,
    ],
    ["an overloaded API", apiError(529, "overloaded_error", "Overloaded"), false],
    ["a server error", apiError(500, "api_error", "Internal server error"), false],
    ["a bad key", apiError(401, "authentication_error", "invalid x-api-key"), false],
    ["a plain error", new Error("credit balance is too low"), false],
    ["a thrown string", "usage limit", false],
  ])("%s: %s", (_what, error, expected) => {
    expect(isSpendLimitError(error)).toBe(expected);
  });
});
