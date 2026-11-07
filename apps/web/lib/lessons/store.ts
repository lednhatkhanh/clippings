import { getPool } from "@/lib/db.ts";
import { createLessonsService, systemClock, type LessonsService } from "@clippings/db";

let service: LessonsService | undefined;

/** The lessons on the shared pool: the Lessons pages read them here, the twice-weekly job writes them. */
export function getLessons(): LessonsService {
  return (service ??= createLessonsService({ pool: getPool(), clock: systemClock }));
}
