import { getPool } from "@/lib/db.ts";
import { createChangesService, type ChangesService } from "@clippings/db";

let service: ChangesService | undefined;

/** The library change log on the shared pool: what automation did, and undoing it. */
export function getChanges(): ChangesService {
  return (service ??= createChangesService({ pool: getPool() }));
}
