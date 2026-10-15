const LOCALE = "en-US";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

const dateParts = (date: Date, options: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(
    new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC", ...options })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );

/** "3 Oct", or "3 Oct 2025" when the year isn't the current one. Days are UTC days. */
export function formatAbsoluteDate(iso: string, now: Date): string {
  const date = new Date(iso);
  const { day, month, year } = dateParts(date, { day: "numeric", month: "short", year: "numeric" });
  return date.getUTCFullYear() === now.getUTCFullYear()
    ? `${day} ${month}`
    : `${day} ${month} ${year}`;
}

/** "2 days ago" for the last seven days, the absolute date after that. */
export function formatClippingDate(iso: string, now: Date): string {
  const elapsed = now.getTime() - new Date(iso).getTime();

  if (elapsed < MINUTE) return "Just now";
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), "hour");
  if (elapsed < 7 * DAY) return relative.format(-Math.floor(elapsed / DAY), "day");
  return formatAbsoluteDate(iso, now);
}
