import type { LibraryChangeActor, LibraryChangeConfidence } from "@clippings/shared";

/** What the gate decides for a proposed change: do it now, or store it as a suggestion. */
export type GateDecision = "apply" | "suggest";

/**
 * The confidence gate. The librarian (and auto-tagging) applies only what it is sure of: a `high`
 * confidence change is applied, anything else, including a change with no stated confidence,
 * waits as a suggestion. A change the user asked for through Claude carries their own judgement,
 * so it is applied whatever the confidence says. It is the one place this rule lives; the
 * librarian service asks it for every change, whoever the caller is.
 */
export function gateChange(
  proposal: { confidence?: LibraryChangeConfidence | null },
  actor: LibraryChangeActor,
): GateDecision {
  if (actor === "user_via_mcp") return "apply";
  return proposal.confidence === "high" ? "apply" : "suggest";
}
