import { describe, expect, it } from "vitest";

import {
  MAX_RESEARCH_DOMAIN_LENGTH,
  MAX_RESEARCH_DOMAINS,
  MAX_RESEARCH_PROFILE_LENGTH,
  parseResearchDomains,
  researchSettingsChangeSchema,
} from "./research.ts";

describe("parseResearchDomains", () => {
  it.each([
    { name: "commas", input: "shipping, logistics", expected: ["shipping", "logistics"] },
    { name: "newlines", input: "shipping\nlogistics", expected: ["shipping", "logistics"] },
    {
      name: "windows newlines",
      input: "shipping\r\nlogistics",
      expected: ["shipping", "logistics"],
    },
    { name: "both", input: "a, b\nc", expected: ["a", "b", "c"] },
    { name: "blanks dropped", input: " , a,,\n\n b ,", expected: ["a", "b"] },
    {
      name: "repeats ignoring case",
      input: "Shipping, shipping, SHIPPING",
      expected: ["Shipping"],
    },
    {
      name: "spaces inside a domain kept",
      input: "supply chain, last mile",
      expected: ["supply chain", "last mile"],
    },
    { name: "nothing", input: "  ", expected: [] },
  ])("$name", ({ input, expected }) => {
    expect(parseResearchDomains(input)).toEqual(expected);
  });
});

describe("researchSettingsChangeSchema", () => {
  it.each([
    { name: "a profile", input: { profile: "Backend dev" }, expected: { profile: "Backend dev" } },
    { name: "a trimmed profile", input: { profile: "  hi \n" }, expected: { profile: "hi" } },
    { name: "an empty profile", input: { profile: "" }, expected: { profile: "" } },
    { name: "domains", input: { domains: ["a", "b"] }, expected: { domains: ["a", "b"] } },
    {
      name: "domains normalized",
      input: { domains: [" a ", "A", "", "b"] },
      expected: { domains: ["a", "b"] },
    },
    { name: "no domains (research off)", input: { domains: [] }, expected: { domains: [] } },
    {
      name: "both",
      input: { profile: "p", domains: ["a"] },
      expected: { profile: "p", domains: ["a"] },
    },
    {
      name: "a profile at the limit",
      input: { profile: "x".repeat(MAX_RESEARCH_PROFILE_LENGTH) },
      expected: { profile: "x".repeat(MAX_RESEARCH_PROFILE_LENGTH) },
    },
    {
      name: "as many domains as allowed",
      input: { domains: Array.from({ length: MAX_RESEARCH_DOMAINS }, (_, i) => `d${i}`) },
      expected: { domains: Array.from({ length: MAX_RESEARCH_DOMAINS }, (_, i) => `d${i}`) },
    },
    {
      name: "a domain at the limit",
      input: { domains: ["x".repeat(MAX_RESEARCH_DOMAIN_LENGTH)] },
      expected: { domains: ["x".repeat(MAX_RESEARCH_DOMAIN_LENGTH)] },
    },
  ])("accepts $name", ({ input, expected }) => {
    expect(researchSettingsChangeSchema.parse(input)).toEqual(expected);
  });

  it.each([
    { name: "nothing", input: {} },
    { name: "an unknown key", input: { profile: "p", extra: 1 } },
    { name: "a profile too long", input: { profile: "x".repeat(MAX_RESEARCH_PROFILE_LENGTH + 1) } },
    { name: "a domain too long", input: { domains: ["x".repeat(MAX_RESEARCH_DOMAIN_LENGTH + 1)] } },
    {
      name: "too many domains",
      input: { domains: Array.from({ length: MAX_RESEARCH_DOMAINS + 1 }, (_, i) => `d${i}`) },
    },
    { name: "a domain that is not text", input: { domains: [1] } },
    { name: "domains that are not a list", input: { domains: "a, b" } },
  ])("refuses $name", ({ input }) => {
    expect(researchSettingsChangeSchema.safeParse(input).success).toBe(false);
  });

  it("counts domains after dropping repeats", () => {
    const repeats = Array.from({ length: MAX_RESEARCH_DOMAINS + 5 }, () => "same");
    expect(researchSettingsChangeSchema.parse({ domains: repeats })).toEqual({ domains: ["same"] });
  });
});
