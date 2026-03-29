import { env } from "../../config/env.js";

function formatParts(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    ...options,
  }).formatToParts(date);
}

function getPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function normalizeTimeZone(value: string | null | undefined) {
  return value?.trim() || env.DEFAULT_TIMEZONE;
}

export function normalizeReportTime(value: string | null | undefined) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value ?? "") ? value! : env.TELEGRAM_REPORT_DEFAULT_TIME;
}

export function formatDateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = formatParts(date, normalizeTimeZone(timeZone), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return `${getPart(parts, "year")}-${getPart(parts, "month")}-${getPart(parts, "day")}`;
}

export function formatTimeKeyInTimeZone(date: Date, timeZone: string) {
  const parts = formatParts(date, normalizeTimeZone(timeZone), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  return `${getPart(parts, "hour")}:${getPart(parts, "minute")}`;
}

export function formatDisplayTimeInTimeZone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: normalizeTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function buildUtcDayRangeForDateKey(dateKey: string) {
  return {
    startIso: new Date(`${dateKey}T00:00:00.000Z`).toISOString(),
    endIso: new Date(`${dateKey}T23:59:59.999Z`).toISOString(),
  };
}
