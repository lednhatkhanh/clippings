import { UTCDate } from "@date-fns/utc";
import { format, isSameMonth, isSameYear } from "date-fns";

/**
 * A week's span worded for the page, from its Monday and Sunday as `yyyy-MM-dd`: "21 – 27 Sep 2026"
 * inside a month, "28 Sep – 4 Oct 2026" across two, "29 Dec 2026 – 4 Jan 2027" across a year.
 */
export function formatWeekRange(weekStart: string, weekEnd: string): string {
  const start = new UTCDate(weekStart);
  const end = new UTCDate(weekEnd);
  if (!isSameYear(start, end))
    return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`;
  if (!isSameMonth(start, end)) return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
  return `${format(start, "d")} – ${format(end, "d MMM yyyy")}`;
}
