"use client";

import { Check, Undo2, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  approveSuggestionAction,
  dismissSuggestionAction,
  undoChangeAction,
  type DecisionOutcome,
} from "@/app/(app)/settings/library/actions.ts";
import { useOnline } from "@/components/online-status.tsx";
import type { ChangeSummary } from "@/lib/librarian/describe.ts";
import { Button, toasts } from "@clippings/ui";

/** One change as the review screen lists it, with its date already worded. */
export interface ReviewItem {
  id: string;
  summary: ChangeSummary;
  /** "2 days ago" or "3 Oct". */
  dateLabel: string;
  /** ISO 8601, for the `<time>` element. */
  dateTime: string;
}

type Decision = (changeId: string) => Promise<DecisionOutcome>;

const UNREACHABLE = "Couldn't reach the server. Try again.";

/** One change: what it does, why, who made it and when, with its actions beside it. */
function ChangeRow({
  item,
  refusal,
  children,
}: {
  item: ReviewItem;
  /** Why the last decision on it was refused. */
  refusal: string | undefined;
  children: ReactNode;
}) {
  const { summary, reason, actor, confidence } = item.summary;
  return (
    <li className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="typescale-title-sm text-pretty wrap-anywhere">{summary}</p>
          {reason ? (
            <p className="typescale-body-md text-pretty wrap-anywhere text-ink-muted">{reason}</p>
          ) : null}
          <p className="typescale-label-md text-ink-faint">
            {actor}
            {confidence ? ` · ${confidence}` : ""} ·{" "}
            <time dateTime={item.dateTime}>{item.dateLabel}</time>
          </p>
        </div>
        <div className="flex shrink-0 gap-1">{children}</div>
      </div>
      {refusal ? (
        <p role="alert" className="typescale-body-sm text-danger">
          {refusal}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The librarian's work for the user to review: what waits for a decision, with Approve and
 * Dismiss, and what was done lately, with Undo. A decision takes the row away at once; a refusal
 * (the library moved on, a later change touched the same things) keeps it and says why.
 */
export function LibraryReview({
  suggestions,
  applied,
  moreWaiting,
}: {
  suggestions: readonly ReviewItem[];
  applied: readonly ReviewItem[];
  /** Whether more suggestions wait than the list shows. */
  moreWaiting: boolean;
}) {
  const online = useOnline();
  // Changes decided here, hidden before the server's fresh list arrives.
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [refusals, setRefusals] = useState<Readonly<Record<string, string>>>({});

  async function decide(
    item: ReviewItem,
    list: "waiting" | "recent",
    decision: Decision,
    toast: string,
  ) {
    setBusy(item.id);
    setRefusals((current) => ({ ...current, [item.id]: "" }));
    const outcome = await decision(item.id).catch((): DecisionOutcome => ({
      status: "refused",
      message: UNREACHABLE,
    }));
    setBusy(null);
    if (outcome.status === "done") {
      // An approved suggestion leaves one list and joins the other, so the lists hide separately.
      setDecided((current) => new Set(current).add(`${list}:${item.id}`));
      toasts.show({ message: toast });
    } else {
      setRefusals((current) => ({ ...current, [item.id]: outcome.message }));
    }
  }

  const waiting = suggestions.filter((item) => !decided.has(`waiting:${item.id}`));
  const recent = applied.filter((item) => !decided.has(`recent:${item.id}`));
  const locked = !online || busy !== null;

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="waiting-heading" className="rounded-xl paper px-5 pt-5 pb-2">
        <h2 id="waiting-heading" className="typescale-title-lg">
          Waiting for you
        </h2>
        <p className="typescale-body-sm text-ink-faint">
          The librarian was not sure enough to do these alone. Nothing changes until you approve.
        </p>
        {waiting.length === 0 ? (
          <p className="py-6 typescale-body-md text-ink-muted">
            Nothing is waiting for a decision.
          </p>
        ) : (
          <ul aria-label="Suggested changes" className="flex flex-col divide-y divide-line">
            {waiting.map((item) => (
              <ChangeRow key={item.id} item={item} refusal={refusals[item.id]}>
                <Button
                  variant="text"
                  aria-label={`Dismiss: ${item.summary.summary}`}
                  isDisabled={locked}
                  onPress={() => void decide(item, "waiting", dismissSuggestionAction, "Dismissed")}
                >
                  <X className="size-4.5" />
                  Dismiss
                </Button>
                <Button
                  variant="paper"
                  aria-label={`Approve: ${item.summary.summary}`}
                  isDisabled={locked}
                  onPress={() => void decide(item, "waiting", approveSuggestionAction, "Approved")}
                >
                  <Check className="size-4.5" />
                  Approve
                </Button>
              </ChangeRow>
            ))}
          </ul>
        )}
        {moreWaiting ? (
          <p className="pb-3 typescale-body-sm text-ink-faint">
            More are waiting. They show once you have decided these.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="recent-heading" className="rounded-xl paper px-5 pt-5 pb-2">
        <h2 id="recent-heading" className="typescale-title-lg">
          Recent changes
        </h2>
        <p className="typescale-body-sm text-ink-faint">
          What was done to your library lately. Undo puts a change back, unless a later change
          touched the same things.
        </p>
        {recent.length === 0 ? (
          <p className="py-6 typescale-body-md text-ink-muted">No changes yet.</p>
        ) : (
          <ul aria-label="Recent changes" className="flex flex-col divide-y divide-line">
            {recent.map((item) => (
              <ChangeRow key={item.id} item={item} refusal={refusals[item.id]}>
                <Button
                  variant="text"
                  aria-label={`Undo: ${item.summary.summary}`}
                  isDisabled={locked}
                  onPress={() => void decide(item, "recent", undoChangeAction, "Undone")}
                >
                  <Undo2 className="size-4.5" />
                  Undo
                </Button>
              </ChangeRow>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
