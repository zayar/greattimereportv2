export function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function shiftRange(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  const dayMs = 24 * 60 * 60 * 1000;
  const span = Math.max(1, Math.round((to.getTime() - from.getTime()) / dayMs) + 1);

  const previousTo = new Date(from.getTime() - dayMs);
  const previousFrom = new Date(previousTo.getTime() - (span - 1) * dayMs);

  return {
    previousFromDate: toIsoDate(previousFrom),
    previousToDate: toIsoDate(previousTo),
  };
}

