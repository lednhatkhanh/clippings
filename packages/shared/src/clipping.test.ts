import { describe, expect, it } from "vitest";

import { clippingStatusIdsSchema, MAX_STATUS_IDS } from "./clipping.ts";

const ids = (count: number) => Array.from({ length: count }, () => crypto.randomUUID());

describe("clippingStatusIdsSchema", () => {
  const one = crypto.randomUUID();
  const two = crypto.randomUUID();

  it.each([
    { name: "one id", input: one, expected: [one] },
    { name: "a list", input: `${one},${two}`, expected: [one, two] },
    {
      name: "as many as are allowed",
      input: ids(MAX_STATUS_IDS).join(","),
      expected: "valid",
    },
    { name: "an empty string", input: "", expected: "refused" },
    {
      name: "one more than allowed",
      input: ids(MAX_STATUS_IDS + 1).join(","),
      expected: "refused",
    },
    { name: "a value that is not a UUID", input: `${one},not-an-id`, expected: "refused" },
    { name: "a trailing comma", input: `${one},`, expected: "refused" },
    { name: "a leading comma", input: `,${one}`, expected: "refused" },
    { name: "a space around an id", input: `${one}, ${two}`, expected: "refused" },
  ])("$name", ({ input, expected }) => {
    const result = clippingStatusIdsSchema.safeParse(input);

    if (Array.isArray(expected)) expect(result.data).toEqual(expected);
    else expect(result.success).toBe(expected === "valid");
  });
});
