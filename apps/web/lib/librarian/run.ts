import type { LibrarianService, ProposalResult, ProposedChange } from "@clippings/db";

import { indexLibrary } from "./library-index.ts";
import type { Planner } from "./planner.ts";
import { proposalsFromPlan } from "./proposals.ts";

/** How long a run may plan, in milliseconds: the job route's 300 s, less the time to write. */
export const RUN_BUDGET_MS = 240_000;

export interface LibrarianRun {
  /** Nothing was written; `results` is what would happen. */
  dryRun: boolean;
  /**
   * The user's first run: every change is a suggestion, applied or reported as one, whatever the
   * confidence says, so they can judge the librarian before it touches anything.
   */
  firstRun: boolean;
  /** The model gateway stopped the run (the day's cap): what was planned before is included. */
  capReached: boolean;
  /** One per proposed change, in order. */
  results: ProposalResult[];
  proposals: ProposedChange[];
  /** Things worth telling the user that are not changes. */
  notices: string[];
  costMicros: number;
}

export type LibrarianRunner = ReturnType<typeof createLibrarianRunner>;

/**
 * The librarian's run, which `run_librarian` over MCP and the weekly job both call: read the
 * library, have the planner plan it, turn the plan into proposals (`proposalsFromPlan`) and hand
 * them to the librarian service, which applies the sure ones, stores the rest as suggestions and
 * logs everything. A dry run stops before the last step's writes.
 *
 * Both paths go through here, so the same library and plan give the same change list.
 */
export function createLibrarianRunner({
  librarian,
  planner,
  now,
}: {
  librarian: Pick<LibrarianService, "readLibrary" | "hasLibrarianRun" | "proposeChanges">;
  planner: Planner;
  now: () => Date;
}) {
  return {
    async run(
      userId: string,
      { dryRun, budgetMs = RUN_BUDGET_MS }: { dryRun: boolean; budgetMs?: number },
    ): Promise<LibrarianRun> {
      const view = await librarian.readLibrary(userId);
      const firstRun = !(await librarian.hasLibrarianRun(userId));
      if (view.totalItems === 0) {
        return {
          dryRun,
          firstRun,
          capReached: false,
          results: [],
          proposals: [],
          notices: ["The library has no clippings or notes yet."],
          costMicros: 0,
        };
      }

      const index = indexLibrary(view, now());
      const planned = await planner.plan(userId, index, { budgetMs });
      const { proposals, notices } = proposalsFromPlan(index, planned.plan, { userId });
      const results = await librarian.proposeChanges(userId, "librarian", proposals, {
        dryRun,
        suggestOnly: firstRun,
      });
      return {
        dryRun,
        firstRun,
        capReached: planned.capReached,
        results,
        proposals,
        notices: [...planned.notices, ...notices],
        costMicros: planned.costMicros,
      };
    },
  };
}
