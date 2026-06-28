import { env } from "../../../config/env.js";
import { listKnownGtGrowthAiEnabledClinicIds } from "../../feature-access.service.js";
import { listRecentAgentFeedbackEvents, type AgentFeedbackEventRecord } from "../feedback.repository.js";
import {
  listRecentAgentLearningRuns,
  type AgentLearningJobType,
  type AgentLearningRunRecord,
} from "../learning.repository.js";
import {
  listRecentFactSnapshots,
  listRecentInsightCards,
  listRecentRecommendationOutcomes,
} from "../memory/memory.repository.js";
import type {
  GtAgentFactSnapshot,
  GtAgentInsightCard,
  GtAgentRecommendationOutcome,
} from "../memory/memory-types.js";
import { listRecentAgentRunTraces } from "../trace.repository.js";
import type { AgentDataStatus, AgentRunTrace } from "../types.js";

export type AgentStatusHealth = "healthy" | "degraded" | "critical" | "unknown";
export type AgentStatusRange = "24h" | "7d" | "30d";
export type AgentStatusAlertSeverity = "info" | "warning" | "critical";

export type AgentStatusAlert = {
  severity: AgentStatusAlertSeverity;
  code: string;
  message: string;
};

export type AgentStatusSlowTool = {
  toolName: string;
  count: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  timeoutCount: number;
  failureCount: number;
};

export type AgentStatusLatestLearningRun = {
  clinicId: string;
  jobType: AgentLearningJobType;
  status: AgentLearningRunRecord["status"];
  rowCount: number;
  createdAt: string;
  nextExpectedRunAt?: string | null;
  error?: string | null;
};

export type AgentStatusStaleLearningJob = {
  clinicId: string;
  jobType: AgentLearningJobType;
  status: AgentLearningRunRecord["status"];
  latestRunAt: string;
  ageHours: number;
  reason: string;
};

export type AgentStatusSnapshot = {
  clinicId: string;
  snapshotType: string;
  checkedAt: string;
  dataStatus: AgentDataStatus;
  ageSeconds: number;
  maxAgeSeconds: number;
  expired: boolean;
};

export type AgentStatusSnapshotIssue = AgentStatusSnapshot & {
  reason: string;
};

export type AgentStatusReport = {
  health: AgentStatusHealth;
  range: AgentStatusRange;
  summary: {
    totalAgentQuestions: number;
    timeoutCount: number;
    fallbackCount: number;
    narrativeFallbackCount: number;
    toolFailureCount: number;
    wrongDataFeedbackCount: number;
    alertCount: number;
  };
  performance: {
    averageLatencyMs: number;
    p95LatencyMs: number;
    timeoutCount: number;
    fallbackCount: number;
    narrativeFallbackCount: number;
    toolFailureCount: number;
    toolFailureRate: number;
    slowestTools: AgentStatusSlowTool[];
    bigQueryCache: {
      hits: number;
      misses: number;
      hitRate: number;
    };
  };
  learning: {
    totalRuns: number;
    failedRuns: number;
    latestRunByJobType: Record<string, AgentStatusLatestLearningRun>;
    staleJobs: AgentStatusStaleLearningJob[];
  };
  snapshots: {
    totalSnapshots: number;
    latestByType: Record<string, AgentStatusSnapshot>;
    staleSnapshots: AgentStatusSnapshotIssue[];
  };
  feedback: {
    totalFeedbackEvents: number;
    wrongDataFeedbackCount: number;
    recommendationOutcomesCount: number;
    activeInsightCardsCount: number;
  };
  alerts: AgentStatusAlert[];
  generatedAt: string;
  details?: {
    traces: AgentRunTrace[];
    learningRuns: AgentLearningRunRecord[];
    snapshots: GtAgentFactSnapshot[];
    feedbackEvents: AgentFeedbackEventRecord[];
    recommendationOutcomes: GtAgentRecommendationOutcome[];
    insightCards: GtAgentInsightCard[];
    premiumClinicsWithNoUsage: string[];
  };
};

export type AgentStatusDataSource = {
  listRunTraces: typeof listRecentAgentRunTraces;
  listLearningRuns: typeof listRecentAgentLearningRuns;
  listFeedbackEvents: typeof listRecentAgentFeedbackEvents;
  listRecommendationOutcomes: typeof listRecentRecommendationOutcomes;
  listInsightCards: typeof listRecentInsightCards;
  listFactSnapshots: typeof listRecentFactSnapshots;
  listEnabledClinicIds?: typeof listKnownGtGrowthAiEnabledClinicIds;
};

const DEFAULT_DATA_SOURCE: AgentStatusDataSource = {
  listRunTraces: listRecentAgentRunTraces,
  listLearningRuns: listRecentAgentLearningRuns,
  listFeedbackEvents: listRecentAgentFeedbackEvents,
  listRecommendationOutcomes: listRecentRecommendationOutcomes,
  listInsightCards: listRecentInsightCards,
  listFactSnapshots: listRecentFactSnapshots,
  listEnabledClinicIds: listKnownGtGrowthAiEnabledClinicIds,
};

const RANGE_TO_MS: Record<AgentStatusRange, number> = {
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
};

const DAILY_SNAPSHOT_TYPES = new Set(["finance_daily_snapshot", "appointment_daily_profile"]);

function round(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function msToHours(ms: number) {
  return Math.round((ms / 60 / 60_000) * 10) / 10;
}

function isoMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function rangeSince(range: AgentStatusRange, now: Date) {
  return new Date(now.getTime() - RANGE_TO_MS[range]);
}

export function normalizeAgentStatusRange(value: unknown): AgentStatusRange {
  return value === "7d" || value === "30d" || value === "24h" ? value : "24h";
}

function toolRowsFromTrace(trace: AgentRunTrace) {
  const toolExecutionResults = trace.toolExecutionResults ?? [];
  if (toolExecutionResults.length > 0) {
    return toolExecutionResults.map((result) => ({
      toolName: result.toolName,
      latencyMs: result.latencyMs,
      timedOut: result.timedOut,
      dataStatus: result.dataStatus,
      errorCategory: result.errorCategory,
    }));
  }

  return (trace.sourceDurations ?? []).map((result) => ({
    toolName: result.toolName,
    latencyMs: result.durationMs,
    timedOut: result.timedOut === true || result.errorCategory === "timeout",
    dataStatus: result.dataStatus,
    errorCategory: result.errorCategory,
  }));
}

function buildSlowestTools(traces: AgentRunTrace[]) {
  const byTool = new Map<string, Array<ReturnType<typeof toolRowsFromTrace>[number]>>();

  traces.flatMap(toolRowsFromTrace).forEach((row) => {
    const current = byTool.get(row.toolName) ?? [];
    current.push(row);
    byTool.set(row.toolName, current);
  });

  return [...byTool.entries()]
    .map(([toolName, rows]) => {
      const latencies = rows.map((row) => row.latencyMs).filter((value) => Number.isFinite(value));
      return {
        toolName,
        count: rows.length,
        averageLatencyMs: round(average(latencies)),
        p95LatencyMs: round(percentile(latencies, 95)),
        maxLatencyMs: round(Math.max(0, ...latencies)),
        timeoutCount: rows.filter((row) => row.timedOut).length,
        failureCount: rows.filter((row) => row.dataStatus === "unavailable" || Boolean(row.errorCategory)).length,
      };
    })
    .sort((left, right) => {
      if (right.p95LatencyMs !== left.p95LatencyMs) {
        return right.p95LatencyMs - left.p95LatencyMs;
      }

      return right.maxLatencyMs - left.maxLatencyMs;
    })
    .slice(0, 8);
}

function traceTimedOutToolCount(trace: AgentRunTrace) {
  const timedOutTools = trace.timedOutTools ?? [];
  if (timedOutTools.length > 0) {
    return timedOutTools.length;
  }

  return toolRowsFromTrace(trace).filter((row) => row.timedOut).length;
}

function traceUnavailableToolCount(trace: AgentRunTrace) {
  const unavailableTools = trace.unavailableTools ?? [];
  if (unavailableTools.length > 0) {
    return unavailableTools.length;
  }

  return toolRowsFromTrace(trace).filter((row) => row.dataStatus === "unavailable" || Boolean(row.errorCategory)).length;
}

function isFallbackTrace(trace: AgentRunTrace) {
  return (
    trace.fallbackUsed ||
    trace.dataStatus === "partial" ||
    trace.dataStatus === "not_ready" ||
    trace.dataStatus === "unavailable" ||
    trace.sourceStatuses.includes("unavailable")
  );
}

function isNarrativeFallbackTrace(trace: AgentRunTrace) {
  if (typeof trace.narrativeFallbackUsed === "boolean") {
    return trace.narrativeFallbackUsed;
  }

  return trace.fallbackUsed && (trace.narrativeLatencyMs ?? 0) > 0;
}

function latestLearningRunsByJobType(runs: AgentLearningRunRecord[]) {
  const latest = new Map<string, AgentLearningRunRecord>();

  runs.forEach((run) => {
    const key = `${run.clinicId}:${run.jobType}`;
    const existing = latest.get(key);
    if (!existing || new Date(run.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      latest.set(key, run);
    }
  });

  return latest;
}

function learningMaxAgeMs(jobType: AgentLearningJobType) {
  if (jobType === "appointment_operational_snapshot") {
    return Math.max(env.AGENT_OPERATIONAL_SNAPSHOT_MAX_AGE_MINUTES * 3 * 60_000, 60 * 60_000);
  }

  if (["finance_daily_snapshot", "appointment_daily_profile", "owner_insight_cards"].includes(jobType)) {
    return 36 * 60 * 60_000;
  }

  return env.AGENT_STALE_THRESHOLD_HOURS * 60 * 60_000;
}

function buildLatestLearningRun(run: AgentLearningRunRecord): AgentStatusLatestLearningRun {
  return {
    clinicId: run.clinicId,
    jobType: run.jobType,
    status: run.status,
    rowCount: run.rowCount ?? 0,
    createdAt: run.createdAt,
    nextExpectedRunAt: run.nextExpectedRunAt ?? null,
    error: run.error ?? null,
  };
}

function buildLearningStatus(runs: AgentLearningRunRecord[], now: Date) {
  const latestRuns = latestLearningRunsByJobType(runs);
  const clinicCount = new Set([...latestRuns.values()].map((run) => run.clinicId)).size;
  const latestRunByJobType = [...latestRuns.values()].reduce<Record<string, AgentStatusLatestLearningRun>>((acc, run) => {
    const key = clinicCount <= 1 ? run.jobType : `${run.clinicId}:${run.jobType}`;
    acc[key] = buildLatestLearningRun(run);
    return acc;
  }, {});
  const staleJobs = [...latestRuns.values()]
    .map((run) => {
      const latestRunMs = isoMs(run.createdAt) ?? 0;
      const nextExpectedMs = isoMs(run.nextExpectedRunAt);
      const maxAgeMs = learningMaxAgeMs(run.jobType);
      const ageMs = now.getTime() - latestRunMs;
      const staleByNextExpected = nextExpectedMs != null && nextExpectedMs + 60 * 60_000 < now.getTime();
      const staleByAge = latestRunMs > 0 && ageMs > maxAgeMs;
      const failed = run.status === "failed";

      if (!failed && !staleByNextExpected && !staleByAge) {
        return null;
      }

      return {
        clinicId: run.clinicId,
        jobType: run.jobType,
        status: run.status,
        latestRunAt: run.createdAt,
        ageHours: msToHours(ageMs),
        reason: failed ? "latest run failed" : staleByNextExpected ? "past next expected run" : "older than expected cadence",
      };
    })
    .filter((job): job is AgentStatusStaleLearningJob => Boolean(job));

  return {
    totalRuns: runs.length,
    failedRuns: runs.filter((run) => run.status === "failed").length,
    latestRunByJobType,
    staleJobs,
  };
}

function snapshotMaxAgeSeconds(snapshotType: string) {
  if (snapshotType === "appointment_operational_snapshot") {
    return env.AGENT_OPERATIONAL_SNAPSHOT_MAX_AGE_MINUTES * 60;
  }

  if (DAILY_SNAPSHOT_TYPES.has(snapshotType)) {
    return 36 * 60 * 60;
  }

  return env.AGENT_SNAPSHOT_MAX_AGE_MINUTES * 60;
}

function buildSnapshotStatus(snapshot: GtAgentFactSnapshot, now: Date): AgentStatusSnapshot {
  const checkedAtMs = isoMs(snapshot.checkedAt) ?? 0;
  const expiresAtMs = isoMs(snapshot.expiresAt);
  const ageSeconds = checkedAtMs > 0 ? Math.max(0, Math.floor((now.getTime() - checkedAtMs) / 1_000)) : Number.MAX_SAFE_INTEGER;
  const maxAgeSeconds = snapshotMaxAgeSeconds(snapshot.snapshotType);

  return {
    clinicId: snapshot.clinicId,
    snapshotType: snapshot.snapshotType,
    checkedAt: snapshot.checkedAt,
    dataStatus: snapshot.dataStatus,
    ageSeconds,
    maxAgeSeconds,
    expired: expiresAtMs != null && expiresAtMs <= now.getTime(),
  };
}

function buildSnapshotStatusBlock(snapshots: GtAgentFactSnapshot[], now: Date) {
  const latestByKey = new Map<string, GtAgentFactSnapshot>();

  snapshots.forEach((snapshot) => {
    const key = `${snapshot.clinicId}:${snapshot.snapshotType}`;
    const existing = latestByKey.get(key);
    if (!existing || new Date(snapshot.checkedAt).getTime() > new Date(existing.checkedAt).getTime()) {
      latestByKey.set(key, snapshot);
    }
  });

  const latestStatuses = [...latestByKey.values()].map((snapshot) => buildSnapshotStatus(snapshot, now));
  const clinicCount = new Set(latestStatuses.map((snapshot) => snapshot.clinicId)).size;
  const latestByType = latestStatuses.reduce<Record<string, AgentStatusSnapshot>>((acc, snapshot) => {
    const key = clinicCount <= 1 ? snapshot.snapshotType : `${snapshot.clinicId}:${snapshot.snapshotType}`;
    acc[key] = snapshot;
    return acc;
  }, {});
  const staleSnapshots = latestStatuses
    .map((snapshot) => {
      const stale = snapshot.ageSeconds > snapshot.maxAgeSeconds;
      const badStatus = ["stale", "unavailable", "not_ready"].includes(snapshot.dataStatus);

      if (!snapshot.expired && !stale && !badStatus) {
        return null;
      }

      return {
        ...snapshot,
        reason: snapshot.expired ? "expired" : stale ? "older than freshness target" : `data status is ${snapshot.dataStatus}`,
      };
    })
    .filter((snapshot): snapshot is AgentStatusSnapshotIssue => Boolean(snapshot));

  return {
    totalSnapshots: snapshots.length,
    latestByType,
    staleSnapshots,
  };
}

function buildAlerts(params: {
  totalQuestions: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  timeoutCount: number;
  fallbackCount: number;
  narrativeFallbackCount: number;
  toolFailureCount: number;
  wrongDataFeedbackCount: number;
  staleLearningJobs: AgentStatusStaleLearningJob[];
  staleSnapshots: AgentStatusSnapshotIssue[];
  premiumClinicsWithNoUsage: string[];
}) {
  const alerts: AgentStatusAlert[] = [];
  const questionCount = Math.max(params.totalQuestions, 1);
  const toolFailureRate = params.toolFailureCount / questionCount;
  const timeoutRate = params.timeoutCount / questionCount;
  const fallbackRate = params.fallbackCount / questionCount;

  if (params.totalQuestions === 0) {
    alerts.push({
      severity: "info",
      code: "no_agent_usage",
      message: "No Agent Hub questions were found in this range.",
    });
  }

  if (params.p95LatencyMs >= 8_000) {
    alerts.push({
      severity: "critical",
      code: "p95_latency_critical",
      message: `P95 latency is ${params.p95LatencyMs.toLocaleString("en-US")}ms.`,
    });
  } else if (params.p95LatencyMs >= 4_000) {
    alerts.push({
      severity: "warning",
      code: "p95_latency_degraded",
      message: `P95 latency is ${params.p95LatencyMs.toLocaleString("en-US")}ms.`,
    });
  }

  if (timeoutRate >= 0.25 && params.timeoutCount > 0) {
    alerts.push({
      severity: "critical",
      code: "tool_timeouts_high",
      message: `${params.timeoutCount} timed out tool execution${params.timeoutCount === 1 ? "" : "s"} found.`,
    });
  } else if (params.timeoutCount > 0) {
    alerts.push({
      severity: "warning",
      code: "tool_timeouts_present",
      message: `${params.timeoutCount} timed out tool execution${params.timeoutCount === 1 ? "" : "s"} found.`,
    });
  }

  if (toolFailureRate >= 0.25 && params.toolFailureCount > 0) {
    alerts.push({
      severity: "critical",
      code: "tool_failures_high",
      message: `${params.toolFailureCount} unavailable or failed tool execution${params.toolFailureCount === 1 ? "" : "s"} found.`,
    });
  }

  if (fallbackRate >= 0.2 && params.fallbackCount > 0) {
    alerts.push({
      severity: "warning",
      code: "fallback_rate_high",
      message: `${params.fallbackCount} deterministic fallback response${params.fallbackCount === 1 ? "" : "s"} found.`,
    });
  }

  if (params.narrativeFallbackCount > 0) {
    alerts.push({
      severity: "warning",
      code: "narrative_fallbacks_present",
      message: `${params.narrativeFallbackCount} narrative fallback${params.narrativeFallbackCount === 1 ? "" : "s"} found.`,
    });
  }

  if (params.wrongDataFeedbackCount > 0) {
    alerts.push({
      severity: "critical",
      code: "wrong_data_feedback",
      message: `${params.wrongDataFeedbackCount} wrong-data feedback event${params.wrongDataFeedbackCount === 1 ? "" : "s"} found.`,
    });
  }

  if (params.staleLearningJobs.length > 0) {
    alerts.push({
      severity: "warning",
      code: "stale_learning_jobs",
      message: `${params.staleLearningJobs.length} learning job${params.staleLearningJobs.length === 1 ? "" : "s"} need attention.`,
    });
  }

  if (params.staleSnapshots.length > 0) {
    alerts.push({
      severity: "warning",
      code: "stale_snapshots",
      message: `${params.staleSnapshots.length} fact snapshot${params.staleSnapshots.length === 1 ? "" : "s"} are stale or expired.`,
    });
  }

  if (params.premiumClinicsWithNoUsage.length > 0) {
    alerts.push({
      severity: "info",
      code: "premium_clinics_no_usage",
      message: `${params.premiumClinicsWithNoUsage.length} GT Growth AI clinic${params.premiumClinicsWithNoUsage.length === 1 ? "" : "s"} had no Agent Hub usage in this range.`,
    });
  }

  return alerts;
}

function healthFromAlerts(alerts: AgentStatusAlert[], hasAnyData: boolean): AgentStatusHealth {
  if (!hasAnyData) {
    return "unknown";
  }

  if (alerts.some((alert) => alert.severity === "critical")) {
    return "critical";
  }

  if (alerts.some((alert) => alert.severity === "warning")) {
    return "degraded";
  }

  return "healthy";
}

export function buildAgentStatusReport(params: {
  range: AgentStatusRange;
  traces: AgentRunTrace[];
  learningRuns: AgentLearningRunRecord[];
  feedbackEvents: AgentFeedbackEventRecord[];
  recommendationOutcomes: GtAgentRecommendationOutcome[];
  insightCards: GtAgentInsightCard[];
  factSnapshots: GtAgentFactSnapshot[];
  enabledClinicIds?: string[];
  includeDetails?: boolean;
  now?: Date;
}): AgentStatusReport {
  const now = params.now ?? new Date();
  const latencies = params.traces
    .map((trace) => trace.totalLatencyMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const totalAgentQuestions = params.traces.length;
  const timeoutCount = params.traces.reduce((sum, trace) => sum + traceTimedOutToolCount(trace), 0);
  const fallbackCount = params.traces.filter(isFallbackTrace).length;
  const narrativeFallbackCount = params.traces.filter(isNarrativeFallbackTrace).length;
  const toolFailureCount = params.traces.reduce((sum, trace) => sum + traceUnavailableToolCount(trace), 0);
  const wrongDataFeedbackCount = params.feedbackEvents.filter((event) => event.feedbackType === "wrong_data").length;
  const learning = buildLearningStatus(params.learningRuns, now);
  const snapshots = buildSnapshotStatusBlock(params.factSnapshots, now);
  const activeInsightCards = params.insightCards.filter((card) => ["new", "viewed", "accepted", "remind_later"].includes(card.status));
  const usedClinicIds = new Set(params.traces.map((trace) => trace.clinicId));
  const premiumClinicsWithNoUsage = (params.enabledClinicIds ?? []).filter((clinicId) => !usedClinicIds.has(clinicId));
  const averageLatencyMs = round(average(latencies));
  const p95LatencyMs = round(percentile(latencies, 95));
  const cacheHits = params.traces.reduce((sum, trace) => sum + (trace.cacheStats?.bigQueryHits ?? 0), 0);
  const cacheMisses = params.traces.reduce((sum, trace) => sum + (trace.cacheStats?.bigQueryMisses ?? 0), 0);
  const alerts = buildAlerts({
    totalQuestions: totalAgentQuestions,
    averageLatencyMs,
    p95LatencyMs,
    timeoutCount,
    fallbackCount,
    narrativeFallbackCount,
    toolFailureCount,
    wrongDataFeedbackCount,
    staleLearningJobs: learning.staleJobs,
    staleSnapshots: snapshots.staleSnapshots,
    premiumClinicsWithNoUsage,
  });
  const hasAnyData =
    totalAgentQuestions > 0 ||
    params.learningRuns.length > 0 ||
    params.feedbackEvents.length > 0 ||
    params.recommendationOutcomes.length > 0 ||
    params.factSnapshots.length > 0;

  return {
    health: healthFromAlerts(alerts, hasAnyData),
    range: params.range,
    summary: {
      totalAgentQuestions,
      timeoutCount,
      fallbackCount,
      narrativeFallbackCount,
      toolFailureCount,
      wrongDataFeedbackCount,
      alertCount: alerts.length,
    },
    performance: {
      averageLatencyMs,
      p95LatencyMs,
      timeoutCount,
      fallbackCount,
      narrativeFallbackCount,
      toolFailureCount,
      toolFailureRate: totalAgentQuestions ? toolFailureCount / totalAgentQuestions : 0,
      slowestTools: buildSlowestTools(params.traces),
      bigQueryCache: {
        hits: cacheHits,
        misses: cacheMisses,
        hitRate: cacheHits + cacheMisses ? cacheHits / (cacheHits + cacheMisses) : 0,
      },
    },
    learning,
    snapshots,
    feedback: {
      totalFeedbackEvents: params.feedbackEvents.length,
      wrongDataFeedbackCount,
      recommendationOutcomesCount: params.recommendationOutcomes.length,
      activeInsightCardsCount: activeInsightCards.length,
    },
    alerts,
    generatedAt: now.toISOString(),
    ...(params.includeDetails
      ? {
          details: {
            traces: params.traces,
            learningRuns: params.learningRuns,
            snapshots: params.factSnapshots,
            feedbackEvents: params.feedbackEvents,
            recommendationOutcomes: params.recommendationOutcomes,
            insightCards: params.insightCards,
            premiumClinicsWithNoUsage,
          },
        }
      : {}),
  };
}

async function optionalList<T>(callback: () => Promise<T[]>) {
  try {
    return await callback();
  } catch {
    return [];
  }
}

export async function getAgentStatusReport(params: {
  clinicId?: string;
  range?: AgentStatusRange;
  includeDetails?: boolean;
  dataSource?: AgentStatusDataSource;
  now?: Date;
}) {
  const range = params.range ?? "24h";
  const now = params.now ?? new Date();
  const since = rangeSince(range, now);
  const dataSource = params.dataSource ?? DEFAULT_DATA_SOURCE;
  const [traces, learningRuns, feedbackEvents, recommendationOutcomes, insightCards, factSnapshots, enabledClinicIds] = await Promise.all([
    optionalList(() => dataSource.listRunTraces({ clinicId: params.clinicId, since, limit: 1_000 })),
    optionalList(() => dataSource.listLearningRuns({ clinicId: params.clinicId, since, limit: 1_000 })),
    optionalList(() => dataSource.listFeedbackEvents({ clinicId: params.clinicId, since, limit: 1_000 })),
    optionalList(() => dataSource.listRecommendationOutcomes({ clinicId: params.clinicId, since, limit: 1_000 })),
    optionalList(() => dataSource.listInsightCards({ clinicId: params.clinicId, since, limit: 1_000 })),
    optionalList(() => dataSource.listFactSnapshots({ clinicId: params.clinicId, since: rangeSince("30d", now), limit: 1_000 })),
    params.clinicId || !dataSource.listEnabledClinicIds ? Promise.resolve([]) : optionalList(() => dataSource.listEnabledClinicIds!()),
  ]);

  return buildAgentStatusReport({
    range,
    traces,
    learningRuns,
    feedbackEvents,
    recommendationOutcomes,
    insightCards,
    factSnapshots,
    enabledClinicIds,
    includeDetails: params.includeDetails,
    now,
  });
}
