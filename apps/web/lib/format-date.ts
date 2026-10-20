import { UTCDate } from "@date-fns/utc";
import { differenceInDays, differenceInHours, differenceInMinutes, parseISO } from "date-fns";

import { formatAbsoluteDate } from "@clippings/shared";

const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

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
