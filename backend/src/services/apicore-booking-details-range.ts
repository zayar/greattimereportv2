import { buildUtcDayRangeForDateKey } from "./telegram/time.js";

export function buildApicoreBookingDetailsDateRange(input: {
  fromDate: string;
  toDate: string;
  timezone?: string | null;
}) {
  // APICORE getBookingDetails expects appointment wall-clock date boundaries.
  // Do not convert the clinic's local day to a UTC instant range here; doing so
  // pulls previous-evening booking rows into "today" for Asia/Yangon.
  const startRange = buildUtcDayRangeForDateKey(input.fromDate);
  const endRange = buildUtcDayRangeForDateKey(input.toDate);

  return {
    startIso: startRange.startIso,
    endIso: endRange.endIso,
  };
}

export function apicoreBookingWallClockDateKey(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim().replace(/(?:Z|[+-]\d{2}:?\d{2})$/i, "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function isApicoreBookingWallClockDateInRange(value: unknown, fromDate: string, toDate: string) {
  const dateKey = apicoreBookingWallClockDateKey(value);
  return Boolean(dateKey && dateKey >= fromDate && dateKey <= toDate);
}
