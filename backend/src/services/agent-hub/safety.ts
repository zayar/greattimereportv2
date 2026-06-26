import type { AgentDataStatus } from "./types.js";

export function nowIso() {
  return new Date().toISOString();
}

export function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function sanitizeError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    const message = error.message.trim();
    const normalized = message.toLowerCase();

    if (
      normalized.includes("prisma.$queryraw") ||
      normalized.includes("connection pool") ||
      normalized.includes("timed out fetching a new connection") ||
      normalized.includes("pris.ly/d/connection-pool")
    ) {
      return "Live appointment source is busy right now. Please retry in a moment.";
    }

    if (normalized.includes("gt.apicore graphql request timed out")) {
      return "Live GreatTime source timed out. Please retry in a moment.";
    }

    return message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]").slice(0, 240);
  }

  return "The source tool is temporarily unavailable.";
}

export function maskPhone(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  const digits = text.replace(/\D/g, "");

  if (digits.length < 5) {
    return text ? "***" : "";
  }

  return `${digits.slice(0, 2)}***${digits.slice(-3)}`;
}

export function statusRank(status: AgentDataStatus) {
  const ranks: Record<AgentDataStatus, number> = {
    ok: 0,
    no_activity: 1,
    not_found: 2,
    stale: 3,
    partial: 4,
    not_ready: 5,
    unavailable: 6,
  };

  return ranks[status];
}

export function combineStatuses(statuses: AgentDataStatus[]): AgentDataStatus {
  if (statuses.length === 0) {
    return "not_ready";
  }

  return statuses.reduce((worst, current) => (statusRank(current) > statusRank(worst) ? current : worst), "ok");
}

export function limitRows<T>(rows: T[], maxRows: number) {
  return rows.slice(0, Math.max(0, maxRows));
}
