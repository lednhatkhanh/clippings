import { utc } from "@date-fns/utc";
import { format, isSameMonth, isSameYear, parseISO } from "date-fns";

/**
 * A week's span worded for the page, from its Monday and Sunday as `yyyy-MM-dd`: "21 – 27 Sep 2026"
 * inside a month, "28 Sep – 4 Oct 2026" across two, "28 Dec 2026 – 3 Jan 2027" across a year.
 */
export function formatWeekRange(weekStart: string, weekEnd: string): string {
  const start = parseISO(weekStart, { in: utc });
  const end = parseISO(weekEnd, { in: utc });
  if (!isSameYear(start, end))
    return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`;
  if (!isSameMonth(start, end)) return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
  return `${format(start, "d")} – ${format(end, "d MMM yyyy")}`;
}
