import { constructNow } from "date-fns";

import { getPool } from "@/lib/db.ts";
import { getGateway } from "@/lib/gateway/service.ts";
import { createLibrarianService, systemClock, type LibrarianService } from "@clippings/db";

import { createPlanner } from "./planner.ts";
import { createLibrarianRunner, type LibrarianRunner } from "./run.ts";

let service: LibrarianService | undefined;
let runner: LibrarianRunner | undefined;

/**
 * The librarian on the shared pool: the one path that reshapes the library, for the MCP tools and
 * the weekly job alike.
 */
export function getLibrarian(): LibrarianService {
  return (service ??= createLibrarianService({ pool: getPool(), clock: systemClock }));
}

/**
 * The librarian's run: Sonnet 5.5 plans the library and Haiku 5.5 confirms links, both through
 * the model gateway; the changes go through `getLibrarian()`.
 */
export function getLibrarianRunner(): LibrarianRunner {
  const now = () => constructNow(undefined);
  return (runner ??= createLibrarianRunner({
    librarian: getLibrarian(),
    planner: createPlanner({ gateway: getGateway(), now }),
    now,
  }));
}
