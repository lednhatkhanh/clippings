import { describe, expect, it } from "vitest";

import type { LibraryChangeActor, LibraryChangeConfidence } from "@clippings/shared";

import { gateChange, type GateDecision } from "./gate.ts";

describe("the confidence gate", () => {
  const cases: [LibraryChangeActor, LibraryChangeConfidence | null | undefined, GateDecision][] = [
    ["librarian", "high", "apply"],
    ["librarian", "low", "suggest"],
    ["librarian", null, "suggest"],
    ["librarian", undefined, "suggest"],
    ["auto_tag", "high", "apply"],
    ["auto_tag", "low", "suggest"],
    ["user_via_mcp", null, "apply"],
    ["user_via_mcp", "low", "apply"],
    ["user_via_mcp", "high", "apply"],
  ];

  it.each(cases)("%s with %s confidence: %s", (actor, confidence, decision) => {
    expect(gateChange({ confidence }, actor)).toBe(decision);
  });
});
