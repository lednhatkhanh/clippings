import { UTCDate } from "@date-fns/utc";
import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  format,
  isSameYear,
  parseISO,
} from "date-fns";

const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** "3 Oct", or "3 Oct 2025" when the year isn't the current one. Days are UTC days. */
export function formatAbsoluteDate(iso: string, now: Date): string {
  const date = new UTCDate(parseISO(iso));
  return format(date, isSameYear(date, new UTCDate(now)) ? "d MMM" : "d MMM yyyy");
}

/** "2 days ago" for the last seven days, the absolute date after that. */
export function formatClippingDate(iso: string, now: Date): string {
  const date = parseISO(iso);
  const minutes = differenceInMinutes(now, date);
  const hours = differenceInHours(now, date);
  const days = differenceInDays(now, date, { in: (value) => new UTCDate(value) });

  if (minutes < 1) return "Just now";
  if (hours < 1) return relative.format(-minutes, "minute");
  if (days < 1) return relative.format(-hours, "hour");
  if (days < 7) return relative.format(-days, "day");
  return formatAbsoluteDate(iso, now);
}

/** "Last used 3 hours ago", "Last used on 3 Oct", or "Not used yet" for a connected client. */
export function formatLastUsed(iso: string | null, now: Date): string {
  if (!iso) return "Not used yet";
  if (differenceInMinutes(now, parseISO(iso)) < 1) return "Last used just now";
  const label = formatClippingDate(iso, now);
  return label === formatAbsoluteDate(iso, now) ? `Last used on ${label}` : `Last used ${label}`;
}
