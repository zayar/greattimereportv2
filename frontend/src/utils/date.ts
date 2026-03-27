function toInputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function startOfCurrentYear() {
  const date = new Date();
  date.setUTCMonth(0, 1);
  date.setUTCHours(0, 0, 0, 0);
  return toInputDate(date);
}

export function startOfCurrentMonth() {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return toInputDate(date);
}

export function daysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return toInputDate(date);
}

export function daysAhead(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return toInputDate(date);
}

export function today() {
  return toInputDate(new Date());
}
