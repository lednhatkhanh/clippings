import { format, parseISO } from "date-fns";

/**
 * A lesson's day (`yyyy-MM-dd`) as "Tue 4 Nov 2026". It is a calendar day, not a moment: parsed and
 * worded in the same zone, so it reads as the day it names wherever it renders.
 */
export function formatLessonDay(day: string): string {
  return format(parseISO(day), "EEE d MMM yyyy");
}
