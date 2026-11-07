import { createHash } from "node:crypto";

import type { ProposedChange } from "@clippings/db";
import {
  checkCanonicalTagName,
  isTagColor,
  MAX_FOLDER_NAME_LENGTH,
  MAX_LINK_REASON_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TOPIC_PAGE_LENGTH,
  normalizeTagName,
  tagNameKey,
  type TagColor,
} from "@clippings/shared";

import { isFoldEligible, TOPIC_PAGE_MIN_ITEMS, type LibraryIndex } from "./library-index.ts";
import type { LibraryPlan } from "./plan.ts";

export interface ProposalList {
  proposals: ProposedChange[];
  /** Things the user should hear about that are not changes: tags too broad, plans set aside. */
  notices: string[];
}

/**
 * A UUID made from what it names, so the same library and plan give the same ids on every run:
 * a dry run and the real run (or the MCP tool and the weekly job) report identical change lists.
 */
export function stableId(userId: string, kind: string, key: string): string {
  const hex = createHash("sha256").update(`${userId}\0${kind}\0${key}`).digest("hex");
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A reason as the log keeps it: trimmed and cut to the limit; empty when the model gave none. */
function reasonOf(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_LINK_REASON_LENGTH
    ? `${line.slice(0, MAX_LINK_REASON_LENGTH - 1).trimEnd()}…`
    : line;
}

/** Markdown link text with the characters that would break the link made plain. */
const linkText = (text: string) =>
  text
    .replace(/[[\]\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Page text from the model, with raw HTML tags dropped: the page is shown as Markdown, never as HTML. */
const plainText = (text: string) => text.replace(/<[^>]*>/g, "").trim();

/**
 * Turns what the planner decided into the list of changes to propose. Pure: the same library and
 * plan always give the same list, whichever path (the `run_librarian` tool or the weekly job)
 * asks, and nothing in it depends on the order the model happened to list things in beyond the
 * order of the plan itself.
 *
 * It is also where the rules the model might break are held:
 * - a reference the library doesn't have is dropped (the model made it up);
 * - a tag takes part in at most one tag change, and a moved or documented tag is not one of
 *   them, so no change in the list depends on another one having happened first;
 * - a fold needs a tag used at most once and past its grace period;
 * - a rename needs a canonical name that is not near another tag's;
 * - a topic page is for a tag with enough items and none yet, and lists only items the tag has.
 *
 * The order is: tag merges, folds and renames, folders, moves, links, topic pages.
 */
export function proposalsFromPlan(
  index: LibraryIndex,
  plan: LibraryPlan,
  { userId }: { userId: string },
): ProposalList {
  const proposals: ProposedChange[] = [];
  const notices: string[] = [];
  let unknown = 0;
  let setAside = 0;

  /** Tags that take part in a tag change in this list. */
  const touched = new Set<string>();

  // Merges and folds.
  for (const merge of plan.merges) {
    const source = index.tag(merge.source);
    const target = index.tag(merge.target);
    const reason = reasonOf(merge.reason);
    if (!source || !target) {
      unknown += 1;
    } else if (
      source.id === target.id ||
      touched.has(source.id) ||
      touched.has(target.id) ||
      !reason
    ) {
      setAside += 1;
    } else {
      touched.add(source.id).add(target.id);
      proposals.push({
        action: "merge_tag",
        sourceId: source.id,
        targetId: target.id,
        reason,
        confidence: merge.confidence,
      });
    }
  }
  for (const fold of plan.folds) {
    const source = index.tag(fold.tag);
    const target = index.tag(fold.into);
    const reason = reasonOf(fold.reason);
    if (!source || !target) {
      unknown += 1;
    } else if (
      source.id === target.id ||
      !isFoldEligible(source, index.now) ||
      touched.has(source.id) ||
      touched.has(target.id) ||
      !reason
    ) {
      setAside += 1;
    } else {
      touched.add(source.id).add(target.id);
      proposals.push({
        action: "fold_tag",
        sourceId: source.id,
        targetId: target.id,
        reason,
        confidence: fold.confidence,
      });
    }
  }

  // Renames. The names other tags have, and the names renames earlier in the list give, are taken.
  const renamedTo: string[] = [];
  for (const rename of plan.renames) {
    const tag = index.tag(rename.tag);
    const reason = reasonOf(rename.reason);
    if (!tag) {
      unknown += 1;
      continue;
    }
    const name = normalizeTagName(rename.name);
    const others = index.view.tags
      .filter((other) => other.id !== tag.id)
      .map((other) => other.name)
      .concat(renamedTo);
    const verdict = checkCanonicalTagName(name, others);
    if (
      touched.has(tag.id) ||
      !reason ||
      name.length > MAX_TAG_LENGTH ||
      !verdict.ok ||
      verdict.name === tag.name
    ) {
      setAside += 1;
      continue;
    }
    touched.add(tag.id);
    renamedTo.push(verdict.name);
    proposals.push({
      action: "rename_tag",
      tagId: tag.id,
      name: verdict.name,
      reason,
      confidence: rename.confidence,
    });
  }

  for (const broad of plan.tooBroad) {
    const tag = index.tag(broad.tag);
    if (!tag) unknown += 1;
    else notices.push(`The tag "${tag.name}" may be too broad: ${reasonOf(broad.reason)}`);
  }

  // Folders: an existing folder is reused by name, a new one gets an id made from its name.
  const folderByName = new Map<string, { id: string; name: string; reason: string }>(
    index.view.folders.map((folder) => [
      tagNameKey(folder.name),
      { id: folder.id, name: folder.name, reason: "" },
    ]),
  );
  for (const folder of plan.folders) {
    const name = normalizeTagName(folder.name);
    const reason = reasonOf(folder.reason);
    const key = tagNameKey(name);
    if (!name || name.length > MAX_FOLDER_NAME_LENGTH || !reason) {
      setAside += 1;
      continue;
    }
    const known = folderByName.get(key);
    if (known) {
      // A folder the user has, or one already planned: only its reason is new.
      if (!known.reason) known.reason = reason;
      continue;
    }
    const id = stableId(userId, "folder", key);
    const color: TagColor = isTagColor(folder.color) ? folder.color : "none";
    folderByName.set(key, { id, name, reason });
    proposals.push({
      action: "create_folder",
      id,
      name,
      color,
      reason,
      confidence: folder.confidence,
    });
  }

  // Moves: tags first, then clippings and notes. Each thing goes in one folder.
  const moved = new Set<string>();
  const moves: ProposedChange[] = [];
  for (const move of plan.moves) {
    const tag = index.tag(move.ref);
    const item = tag ? undefined : index.item(move.ref);
    const folder = folderByName.get(tagNameKey(normalizeTagName(move.folder)));
    if ((!tag && !item) || !folder) {
      unknown += 1;
      continue;
    }
    const target = tag ?? item!;
    if (moved.has(target.id) || target.folderId === folder.id || (tag && touched.has(tag.id))) {
      setAside += 1;
      continue;
    }
    moved.add(target.id);
    moves.push({
      action: "move_to_folder",
      itemKind: tag ? "tag" : "clipping",
      itemId: target.id,
      folderId: folder.id,
      reason: reasonOf(
        folder.reason
          ? `Fits the folder "${folder.name}": ${folder.reason}`
          : `Fits the folder "${folder.name}"`,
      ),
      confidence: move.confidence,
    });
  }
  proposals.push(
    ...moves.filter((move) => move.action === "move_to_folder" && move.itemKind === "tag"),
    ...moves.filter((move) => move.action === "move_to_folder" && move.itemKind === "clipping"),
  );

  // Links: a pair once, whichever way round, the lower id first.
  const linked = new Set<string>();
  for (const link of plan.links) {
    const a = index.item(link.a);
    const b = index.item(link.b);
    const reason = reasonOf(link.reason);
    if (!a || !b) {
      unknown += 1;
      continue;
    }
    const [from, to] = a.id < b.id ? [a, b] : [b, a];
    const pair = `${from.id}:${to.id}`;
    if (a.id === b.id || linked.has(pair) || !reason) {
      setAside += 1;
      continue;
    }
    linked.add(pair);
    proposals.push({
      action: "link_items",
      id: stableId(userId, "link", pair),
      fromId: from.id,
      toId: to.id,
      reason,
      confidence: link.confidence,
    });
  }

  // Topic pages, rendered here from the model's overview and its one-line summaries.
  const documented = new Set<string>();
  for (const page of plan.pages) {
    const tag = index.tag(page.tag);
    if (!tag) {
      unknown += 1;
      continue;
    }
    const members = new Map(index.itemsOfTag(tag).map((item) => [index.itemRef(item.id), item]));
    const overview = plainText(page.overview);
    const lines: string[] = [];
    for (const entry of page.items) {
      const item = members.get(entry.ref);
      const summary = plainText(entry.summary).replace(/\s+/g, " ");
      if (item && summary) {
        lines.push(`- [${linkText(item.title)}](/c/${item.id}): ${summary}`);
      }
    }
    if (
      documented.has(tag.id) ||
      touched.has(tag.id) ||
      tag.hasTopicPage ||
      tag.usage < TOPIC_PAGE_MIN_ITEMS ||
      !overview ||
      lines.length === 0
    ) {
      setAside += 1;
      continue;
    }
    documented.add(tag.id);
    let body = `${overview}\n\n## Notes\n\n`;
    for (const line of lines) {
      if (body.length + line.length + 1 > MAX_TOPIC_PAGE_LENGTH) break;
      body += `${line}\n`;
    }
    proposals.push({
      action: "write_topic_page",
      tagId: tag.id,
      body: body.trimEnd(),
      reason: `Summarizes the ${tag.usage} items tagged "${tag.name}"`,
      confidence: page.confidence,
    });
  }

  if (unknown > 0) {
    notices.push(
      `Ignored ${unknown} planned ${unknown === 1 ? "change" : "changes"} naming something the library doesn't have.`,
    );
  }
  if (setAside > 0) {
    notices.push(
      `Set aside ${setAside} planned ${setAside === 1 ? "change" : "changes"} that broke a librarian rule or overlapped another.`,
    );
  }
  return { proposals, notices };
}
