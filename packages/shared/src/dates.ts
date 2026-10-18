import { UTCDate } from "@date-fns/utc";
import { format } from "date-fns";

/** A moment as the UTC ISO 8601 string the DTOs carry, such as "2026-10-01T09:00:00.000Z". */
export const formatIsoUtc = (date: Date): string =>
  format(new UTCDate(date), "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
