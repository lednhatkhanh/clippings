import type {
  LibraryChange,
  LibraryChangeAction,
  LibraryChangeActor,
  LibraryChangeConfidence,
} from "@clippings/shared";

/** Who made a change, as the review screen words it. */
export const ACTOR_LABELS: Record<LibraryChangeActor, string> = {
  auto_tag: "Auto-tagging",
  librarian: "Librarian",
  // The user's own change, from the app or through Claude.
  user_via_mcp: "You",
};

/** What a change does, in a few words. */
export const ACTION_LABELS: Record<LibraryChangeAction, string> = {
  add_tag: "Tag added",
  create_tag: "Tag created",
  merge_tag: "Tags merged",
  rename_tag: "Tag renamed",
  fold_tag: "Tag folded",
  set_tag_color: "Tag colored",
  create_folder: "Folder created",
  move_to_folder: "Filed in a folder",
  link_items: "Items linked",
  write_topic_page: "Topic page written",
};

export const CONFIDENCE_LABELS: Record<LibraryChangeConfidence, string> = {
  high: "Sure",
  low: "Not sure",
};

/** What the review screen shows of one change. */
export interface ChangeSummary {
  /** One sentence on what it does, or did. */
  summary: string;
  /** Who made it. */
  actor: string;
  /** What kind of change. */
  action: string;
  /** How sure the actor was; null for a change that carries no judgement. */
  confidence: string | null;
  /** The actor's one line on why. May be empty. */
  reason: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The sentence the librarian logged with the change (`after.summary`), else one made from what an
 * older kind of change kept, else the action's name. `after` is JSON written by other code, so
 * it is read defensively.
 */
export function summarizeChange(
  change: Pick<LibraryChange, "action" | "after" | "actor" | "confidence" | "reason">,
): ChangeSummary {
  const after = isRecord(change.after) ? change.after : {};
  let summary: string | undefined;
  if (typeof after.summary === "string" && after.summary.trim() !== "") {
    summary = after.summary.trim();
  } else if (
    (change.action === "add_tag" || change.action === "create_tag") &&
    isRecord(after.tag) &&
    typeof after.tag.name === "string"
  ) {
    summary = `Tag a clipping “${after.tag.name}”`;
  }
  return {
    summary: summary ?? ACTION_LABELS[change.action],
    actor: ACTOR_LABELS[change.actor],
    action: ACTION_LABELS[change.action],
    confidence: change.confidence ? CONFIDENCE_LABELS[change.confidence] : null,
    reason: change.reason.trim(),
  };
}
