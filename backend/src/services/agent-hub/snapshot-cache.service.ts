import { env } from "../../config/env.js";
import { formatDateKeyInTimeZone, normalizeTimeZone } from "../telegram/time.js";
import {
  getFactSnapshotForPeriod as getFactSnapshotForPeriodRecord,
  getLatestFactSnapshot,
} from "./memory/memory.repository.js";
import type { GtAgentFactSnapshot } from "./memory/memory-types.js";
import type { AgentDataStatus, AgentSourceScope, GreatTimeAgentSource, GreatTimeAgentWarning } from "./types.js";

export type FactSnapshotLike = GtAgentFactSnapshot & {
  createdAt?: string | null;
};

export type FactSnapshotRequest = {
  clinicId: string;
  snapshotType: string;
  expectedFromDate?: string;
  expectedToDate?: string;
  maxAgeMs?: number;
  allowStale?: boolean;
  now?: Date;
};

export type FactSnapshotPeriodRequest = {
  clinicId: string;
  snapshotType: string;
  fromDate: string;
  toDate: string;
  maxAgeMs?: number;
  allowStale?: boolean;
  now?: Date;
};

export type FactSnapshotSourceParams = {
  snapshot: FactSnapshotLike;
  sourceName: string;
  toolName?: string;
  sourceScope?: AgentSourceScope;
  scope?: AgentSourceScope;
  live?: boolean;
};

export type SnapshotUnavailableReason = "missing" | "stale" | "expired" | "date_range_mismatch";

function isoToMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function checkedAtMs(snapshot: FactSnapshotLike) {
  const value = new Date(snapshot.checkedAt ?? "").getTime();
  return Number.isFinite(value) ? value : null;
}

function observedAtMs(snapshot: FactSnapshotLike) {
  return checkedAtMs(snapshot) ?? isoToMs(snapshot.createdAt);
}

function expiresAtMs(snapshot: FactSnapshotLike) {
  if (!snapshot.expiresAt) {
    return null;
  }

  const value = new Date(snapshot.expiresAt).getTime();
  return Number.isFinite(value) ? value : null;
}

function freshnessSeconds(snapshot: FactSnapshotLike, now: Date) {
  const observed = observedAtMs(snapshot);
  if (observed == null) {
    return snapshot.freshnessSeconds;
  }

  return Math.max(0, Math.floor((now.getTime() - observed) / 1_000));
}

function snapshotScope(snapshotType: string): AgentSourceScope {
  if (snapshotType === "finance_daily_snapshot" || snapshotType === "appointment_daily_profile") {
    return "historical";
  }

  return "learned";
}

export function isCompletedHistoricalDay(params: {
  fromDate: string;
  toDate: string;
  timezone?: string;
  now?: Date;
}) {
  if (params.fromDate !== params.toDate) {
    return false;
  }

  const timezone = normalizeTimeZone(params.timezone || env.DEFAULT_TIMEZONE);
  const today = formatDateKeyInTimeZone(params.now ?? new Date(), timezone);
  return params.toDate < today;
}

export function evaluateFactSnapshotForRequest(
  snapshot: FactSnapshotLike | null,
  params: FactSnapshotRequest,
) {
  if (!snapshot) {
    return null;
  }

  const now = params.now ?? new Date();

  if (snapshot.clinicId !== params.clinicId || snapshot.snapshotType !== params.snapshotType) {
    return null;
  }

  if (!params.allowStale && params.expectedFromDate && params.expectedToDate) {
    if (snapshot.dateRange?.fromDate !== params.expectedFromDate || snapshot.dateRange?.toDate !== params.expectedToDate) {
      return null;
    }
  }

  const expires = expiresAtMs(snapshot);
  if (!params.allowStale && expires != null && expires <= now.getTime()) {
    return null;
  }

  if (!params.allowStale && params.maxAgeMs) {
    const observed = observedAtMs(snapshot);
    if (observed == null || now.getTime() - observed > params.maxAgeMs) {
      return null;
    }
  }

  return {
    ...snapshot,
    freshnessSeconds: freshnessSeconds(snapshot, now),
  };
}

export async function getFreshFactSnapshot(params: FactSnapshotRequest) {
  if (!env.AGENT_SNAPSHOT_CACHE_ENABLED) {
    return null;
  }

  const maxAgeMs = params.maxAgeMs ?? env.AGENT_SNAPSHOT_MAX_AGE_MINUTES * 60_000;
  const snapshot =
    params.expectedFromDate && params.expectedToDate
      ? await getFactSnapshotForPeriodRecord({
          clinicId: params.clinicId,
          snapshotType: params.snapshotType,
          fromDate: params.expectedFromDate,
          toDate: params.expectedToDate,
          includeExpired: Boolean(params.allowStale),
        })
      : await getLatestFactSnapshot({
          clinicId: params.clinicId,
          snapshotType: params.snapshotType,
          includeExpired: Boolean(params.allowStale),
        });

  return evaluateFactSnapshotForRequest(snapshot, {
    ...params,
    maxAgeMs,
  });
}

export async function getFactSnapshotForPeriod(params: FactSnapshotPeriodRequest) {
  return getFreshFactSnapshot({
    clinicId: params.clinicId,
    snapshotType: params.snapshotType,
    expectedFromDate: params.fromDate,
    expectedToDate: params.toDate,
    maxAgeMs: params.maxAgeMs,
    allowStale: params.allowStale,
    now: params.now,
  });
}

export function factSnapshotToAgentSource(params: FactSnapshotSourceParams): GreatTimeAgentSource {
  const snapshot = params.snapshot;
  const checkedAt = snapshot.checkedAt ?? snapshot.createdAt ?? new Date(0).toISOString();
  const period =
    snapshot.dateRange?.fromDate && snapshot.dateRange?.toDate
      ? snapshot.dateRange.fromDate === snapshot.dateRange.toDate
        ? snapshot.dateRange.fromDate
        : `${snapshot.dateRange.fromDate} to ${snapshot.dateRange.toDate}`
      : undefined;

  return {
    tool: params.toolName ?? snapshot.snapshotType,
    sourceName: params.sourceName,
    checkedAt,
    period,
    dataStatus: snapshot.dataStatus ?? "ok",
    freshnessSeconds: snapshot.freshnessSeconds,
    live: params.live ?? params.sourceScope === "live",
    scope: params.sourceScope ?? params.scope ?? snapshotScope(snapshot.snapshotType),
    dateRange: snapshot.dateRange,
  };
}

export function buildSnapshotUnavailableWarning(params: {
  snapshotType: string;
  reason?: SnapshotUnavailableReason;
  title?: string;
  message?: string;
  checkedAt?: string;
  expectedFromDate?: string;
  expectedToDate?: string;
}): GreatTimeAgentWarning {
  const reason = params.reason ?? "missing";
  const defaultTitle: Record<SnapshotUnavailableReason, string> = {
    missing: "Snapshot unavailable",
    stale: "Snapshot may be stale",
    expired: "Snapshot expired",
    date_range_mismatch: "Snapshot date range mismatch",
  };
  const expectedPeriod =
    params.expectedFromDate && params.expectedToDate
      ? params.expectedFromDate === params.expectedToDate
        ? params.expectedFromDate
        : `${params.expectedFromDate} to ${params.expectedToDate}`
      : null;
  const defaultMessage: Record<SnapshotUnavailableReason, string> = {
    missing: `A fresh ${params.snapshotType} snapshot was not available.`,
    stale: params.checkedAt
      ? `The ${params.snapshotType} snapshot was checked at ${params.checkedAt}.`
      : `The ${params.snapshotType} snapshot is older than the configured freshness window.`,
    expired: `The ${params.snapshotType} snapshot expired before this request.`,
    date_range_mismatch: expectedPeriod
      ? `The ${params.snapshotType} snapshot did not match ${expectedPeriod}.`
      : `The ${params.snapshotType} snapshot did not match the requested date range.`,
  };

  return {
    type: `snapshot_${reason}`,
    title: params.title ?? defaultTitle[reason],
    message: params.message ?? defaultMessage[reason],
  };
}

export function buildSnapshotStaleWarning(params: {
  snapshotType: string;
  checkedAt?: string;
}): GreatTimeAgentWarning {
  return buildSnapshotUnavailableWarning({
    snapshotType: params.snapshotType,
    reason: "stale",
    checkedAt: params.checkedAt,
  });
}
