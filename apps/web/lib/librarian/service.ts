import { getPool } from "@/lib/db.ts";
import { createLibrarianService, systemClock, type LibrarianService } from "@clippings/db";

let service: LibrarianService | undefined;

/**
 * The librarian on the shared pool: the one path that reshapes the library, for the MCP tools and
 * the weekly job alike.
 */
export function getLibrarian(): LibrarianService {
  return (service ??= createLibrarianService({ pool: getPool(), clock: systemClock }));
}
