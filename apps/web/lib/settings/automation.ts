import { MICROS_PER_DOLLAR } from "@clippings/shared";

/**
 * Dollars as typed in the cap field ("3", "$3.50", "0.005") in micro-dollars, or null when it is
 * not an amount: no sign, no thousands separators, at most six decimals (a micro-dollar is the
 * ledger's finest unit). Done on the digits, not in floating point, so "0.1" is exactly 100,000.
 */
export function parseDollars(input: string): number | null {
  const match = /^\$?\s*(\d{1,7})(?:\.(\d{1,6}))?$/.exec(input.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(6, "0"));
  return whole * MICROS_PER_DOLLAR + fraction;
}

/** A whole number of jobs as typed, or null. */
export function parseCount(input: string): number | null {
  const trimmed = input.trim();
  return /^\d{1,6}$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * Micro-dollars for people: "$3.00", "$0.42". An amount that rounds to nothing but isn't zero
 * reads "less than $0.01", so spend never looks free.
 */
export function formatDollars(micros: number): string {
  if (micros > 0 && micros < MICROS_PER_DOLLAR / 100) return "less than $0.01";
  return `$${(micros / MICROS_PER_DOLLAR).toFixed(2)}`;
}

/** The cap as the field shows it for editing: "3", "3.5", "0.005" (no trailing zeros). */
export function dollarsFieldValue(micros: number): string {
  return String(micros / MICROS_PER_DOLLAR);
}
