import { getPool } from "@/lib/db.ts";
import { createLibraryService, type LibraryService } from "@clippings/db";

let service: LibraryService | undefined;

/** The reads behind the library pages: folders, links, topic pages and the change log. */
export function getLibrary(): LibraryService {
  return (service ??= createLibraryService({ pool: getPool() }));
}
