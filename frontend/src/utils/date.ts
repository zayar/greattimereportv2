function toInputDate(date: Date) {
  return date.toISOString().slice(0, 10);
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

