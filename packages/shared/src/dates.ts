import { UTCDate } from "@date-fns/utc";
import { format, isSameYear, parseISO } from "date-fns";

/** A moment as the UTC ISO 8601 string the DTOs carry, such as "2026-10-01T09:00:00.000Z". */
export const formatIsoUtc = (date: Date): string =>
  format(new UTCDate(date), "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");

/** "3 Oct", or "3 Oct 2025" when the year isn't the current one. Days are UTC days. */
export function formatAbsoluteDate(iso: string, now: Date): string {
  const date = new UTCDate(parseISO(iso));
  return format(date, isSameYear(date, new UTCDate(now)) ? "d MMM" : "d MMM yyyy");
}
