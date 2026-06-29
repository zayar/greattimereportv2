import { listRecentAgentFeedbackEvents, type AgentFeedbackEventRecord } from "../feedback.repository.js";
import {
  listRecentAgentLearningRuns,
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
import {
  getAgentRunTraceByRunId,
  listRecentAgentRunTraces,
} from "../trace.repository.js";
import type { AgentDataStatus, AgentRunTrace, GreatTimeAgentId } from "../types.js";
import {
  buildAgentStatusReport,
  normalizeAgentStatusRange,
  type AgentStatusAlert,
  type AgentStatusHealth,
  type AgentStatusRange,
  type AgentStatusReport,
} from "./agent-status-monitoring.js";

export type AiAgentMonitoringRange = AgentStatusRange;
export type AiAgentMonitoringStatus =
  | "queued"
  | "running"
  | "planning"
  | "calling_tools"
  | "generating_response"
  | "sending_response"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled"
  | "stuck"
  | "unknown";

export type AiAgentMonitoringToolStatus = "started" | "completed" | "failed" | "timeout";

export type AiAgentMonitoringErrorCategory =
  | "llm_timeout"
  | "llm_provider_error"
  | "tool_timeout"
  | "tool_failed"
  | "bigquery_error"
  | "firestore_error"
  | "telegram_send_failed"
  | "telegram_callback_expired"
  | "customer_not_found"
  | "customer_duplicate_name"
  | "appointment_context_missing"
  | "appointment_query_failed"
  | "data_stale"
  | "data_unavailable"
  | "response_too_long"
  | "unknown_error";

export type AiAgentMonitoringFilters = {
  clinicId?: string;
  channel?: "web" | "telegram" | "system" | "unknown";
  agent?: string;
  status?: string;
  search?: string;
};

export type AiAgentMonitoringToolRow = {
  toolName: string;
  status: AiAgentMonitoringToolStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  latencyMs?: number | null;
  dataStatus?: AgentDataStatus | null;
  errorCategory?: string | null;
  errorMessage?: string | null;
};

export type AiAgentMonitoringRunRow = {
  runId: string;
  status: AiAgentMonitoringStatus;
  currentStep?: string | null;
  clinicId?: string | null;
  clinicCode?: string | null;
  clinicName?: string | null;
  channel: "web" | "telegram" | "system" | "unknown";
  userEmail?: string | null;
  requestedAgent?: string | null;
  resolvedAgent?: string | null;
  agentLabel: string;
  intent?: string | null;
  questionPreview?: string | null;
  answerPreview?: string | null;
  toolNames: string[];
  dataStatus?: AgentDataStatus | null;
  fallbackUsed?: boolean;
  totalLatencyMs?: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  errorCategory?: string | null;
  sanitizedError?: string | null;
  telegramDeliveryStatus?: string | null;
  telegramDeliveryLatencyMs?: number | null;
  buttonCount?: number | null;
  messageLength?: number | null;
};

export type AiAgentMonitoringSummary = {
  health: AgentStatusHealth;
  generatedAt: string;
  summary: {
    activeNow: number;
    stuckRuns: number;
    completedRuns: number;
    failedRuns: number;
    timeoutRuns: number;
    totalRuns: number;
    totalQuestions: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
    toolFailureRate: number;
    fallbackRate: number;
    wrongDataFeedbackCount: number;
    telegramDeliveryFailureCount: number;
  };
  byAgent: Array<{
    agentId: string;
    agentLabel: string;
    totalRuns: number;
    activeRuns: number;
    failedRuns: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
  }>;
  byChannel: Array<{
    channel: string;
    totalRuns: number;
    failedRuns: number;
    averageLatencyMs: number;
  }>;
  alerts: AgentStatusAlert[];
  slowestTools: Array<{
    toolName: string;
    count: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
    maxLatencyMs: number;
    timeoutCount: number;
    failureCount: number;
  }>;
  failingTools: Array<{
    toolName: string;
    failureCount: number;
    timeoutCount: number;
    latestError?: string | null;
  }>;
  learning: {
    totalRuns: number;
    failedRuns: number;
    rows: Array<{
      clinicId: string;
      clinicCode?: string | null;
      jobType: string;
      latestRunAt: string;
      status: string;
      rowCount: number;
      nextExpectedRunAt?: string | null;
      error?: string | null;
    }>;
  };
  snapshots: Array<{
    clinicId: string;
    clinicCode: string;
    snapshotType: string;
    checkedAt: string;
    dataStatus: AgentDataStatus;
    freshnessSeconds?: number | null;
    expiresAt?: string | null;
  }>;
  feedback: Array<{
    id: string;
    createdAt: string;
    clinicId: string;
    agent?: string | null;
    feedbackType: string;
    note?: string | null;
    questionPreview?: string | null;
  }>;
};

export type AiAgentMonitoringRunDetail = {
  run: AiAgentMonitoringRunRow & {
    requestId: string;
    responseId?: string | null;
    sessionId?: string | null;
    telegramChatIdHash?: string | null;
    telegramUserIdHash?: string | null;
    telegramMessageId?: string | null;
    telegramCallbackDataType?: string | null;
    callbackExpired?: boolean | null;
    callbackResolved?: boolean | null;
    tools: AiAgentMonitoringToolRow[];
    warnings: string[];
    cacheStats?: AgentRunTrace["cacheStats"];
    model?: string | null;
    provider?: string | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
    estimatedCostUsd?: number | null;
  };
  timeline: Array<{
    label: string;
    status: string;
    at: string;
    detail?: string | null;
  }>;
  feedback: Array<{
    id: string;
    createdAt: string;
    feedbackType: string;
    rating: string;
    note?: string | null;
  }>;
};

export type AiAgentMonitoringDataSource = {
  listRunTraces: typeof listRecentAgentRunTraces;
  getRunTraceByRunId: typeof getAgentRunTraceByRunId;
  listLearningRuns: typeof listRecentAgentLearningRuns;
  listFeedbackEvents: typeof listRecentAgentFeedbackEvents;
  listRecommendationOutcomes: typeof listRecentRecommendationOutcomes;
  listInsightCards: typeof listRecentInsightCards;
  listFactSnapshots: typeof listRecentFactSnapshots;
};

const DEFAULT_DATA_SOURCE: AiAgentMonitoringDataSource = {
  listRunTraces: listRecentAgentRunTraces,
  getRunTraceByRunId: getAgentRunTraceByRunId,
  listLearningRuns: listRecentAgentLearningRuns,
  listFeedbackEvents: listRecentAgentFeedbackEvents,
  listRecommendationOutcomes: listRecentRecommendationOutcomes,
  listInsightCards: listRecentInsightCards,
  listFactSnapshots: listRecentFactSnapshots,
};

const RANGE_TO_MS: Record<AiAgentMonitoringRange, number> = {
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
};

const STUCK_AFTER_MS = 2 * 60_000;
const LIVE_RECENT_MS = 5 * 60_000;
const SECRET_VALUE_PATTERN = /\b(?:bearer\s+[A-Za-z0-9._-]+|(?:token|api[-_ ]?key|secret|authorization|password)\s*[:=]\s*(?:bearer\s+)?["']?[^"'\s,;}]+)/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const PHONE_PATTERN = /(?<!\d)(?:\+?95|09)\d[\d\s().-]{5,}\d/g;

const ACTIVE_STATUSES = new Set<AiAgentMonitoringStatus>([
  "queued",
  "running",
  "planning",
  "calling_tools",
  "generating_response",
  "sending_response",
]);

const AGENT_LABELS: Record<string, string> = {
  supervisor: "Supervisor",
  appointment_agent: "Appointment Agent",
  customer_relationship_agent: "Customer Relationship Agent",
  customer_360_agent: "Customer 360 Agent",
  service_360_agent: "Service 360 Agent",
  finance_agent: "Finance Agent",
  growth_ai_sales_assistant: "Growth AI Sales Assistant",
  report_ai_agent: "Report AI Agent",
  telegram_agent: "Telegram Agent",
  unknown: "Unknown Agent",
};

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

function isoMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function rangeSince(range: AiAgentMonitoringRange, now: Date) {
  return new Date(now.getTime() - RANGE_TO_MS[range]);
}

export function normalizeAiAgentMonitoringRange(value: unknown): AiAgentMonitoringRange {
  return normalizeAgentStatusRange(value);
}

function maskPhoneValue(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 6) {
    return value;
  }

  const prefix = digits.startsWith("959") ? digits.slice(0, 3) : digits.startsWith("09") ? digits.slice(0, 2) : digits.slice(0, 3);
  return `${prefix}****${digits.slice(-3)}`;
}

export function redactMonitoringText(value?: string | null, maxLength = 500) {
  if (!value) {
    return null;
  }

  const redacted = value
    .replace(SECRET_VALUE_PATTERN, (match) => {
      if (/^bearer\s/i.test(match)) {
        return "[redacted-token]";
      }
      return `${match.split(/[:=]/)[0]}=[redacted]`;
    })
    .replace(JWT_PATTERN, "[redacted-token]")
    .replace(PHONE_PATTERN, (match) => maskPhoneValue(match))
    .replace(EMAIL_PATTERN, (match, domain: string) => {
      const [local] = match.split("@");
      const safeLocal = local.length <= 2 ? `${local[0] ?? ""}***` : `${local.slice(0, 2)}***`;
      return `${safeLocal}@${domain.toLowerCase()}`;
    })
    .trim();

  if (redacted.length <= maxLength) {
    return redacted;
  }

  return `${redacted.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function normalizeMonitoringErrorCategory(value?: string | null): AiAgentMonitoringErrorCategory | null {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();
  if (normalized.includes("telegram") && normalized.includes("callback") && normalized.includes("expired")) {
    return "telegram_callback_expired";
  }
  if (normalized.includes("callback_data_invalid")) {
    return "telegram_callback_expired";
  }
  if (normalized.includes("csv_export_failed")) {
    return "telegram_send_failed";
  }
  if (normalized.includes("telegram") || normalized.includes("sendmessage")) {
    return "telegram_send_failed";
  }
  if (normalized.includes("timeout") && normalized.includes("llm")) {
    return "llm_timeout";
  }
  if (normalized.includes("provider") || normalized.includes("openai") || normalized.includes("model")) {
    return "llm_provider_error";
  }
  if (normalized.includes("timeout")) {
    return "tool_timeout";
  }
  if (normalized.includes("bigquery")) {
    return "bigquery_error";
  }
  if (normalized.includes("firestore") || normalized.includes("firebase")) {
    return "firestore_error";
  }
  if (normalized.includes("customer_not_found") || normalized.includes("not_found")) {
    return "customer_not_found";
  }
  if (normalized.includes("duplicate") || normalized.includes("ambiguous")) {
    return "customer_duplicate_name";
  }
  if (normalized.includes("appointment_context")) {
    return "appointment_context_missing";
  }
  if (normalized.includes("appointment")) {
    return "appointment_query_failed";
  }
  if (normalized.includes("stale")) {
    return "data_stale";
  }
  if (normalized.includes("unavailable")) {
    return "data_unavailable";
  }
  if (normalized.includes("too_long") || normalized.includes("message_too_long")) {
    return "response_too_long";
  }
  if (normalized.includes("tool")) {
    return "tool_failed";
  }

  return "unknown_error";
}

function canonicalAgentId(trace: AgentRunTrace) {
  if (trace.channel === "telegram" && !trace.resolvedAgent && !trace.requestedAgent) {
    return "telegram_agent";
  }

  const agent = trace.resolvedAgent ?? trace.requestedAgent ?? "unknown";
  const intent = trace.intent ?? "";
  if (agent === "appointment") {
    return "appointment_agent";
  }
  if (agent === "customer_relationship") {
    return intent === "customer_360" ? "customer_360_agent" : "customer_relationship_agent";
  }
  if (agent === "finance") {
    return "finance_agent";
  }
  if (agent === "business") {
    if (intent === "service_360") {
      return "service_360_agent";
    }
    if (/sales_assistant|growth/i.test(intent)) {
      return "growth_ai_sales_assistant";
    }
    return "report_ai_agent";
  }

  return "unknown";
}

function agentLabel(agentId: string) {
  return AGENT_LABELS[agentId] ?? agentId.replace(/_/g, " ");
}

function traceRunId(trace: AgentRunTrace) {
  return trace.runId ?? trace.requestId ?? trace.responseId;
}

function traceUpdatedAt(trace: AgentRunTrace) {
  return trace.updatedAt ?? trace.completedAt ?? trace.createdAt;
}

function traceChannel(trace: AgentRunTrace): AiAgentMonitoringRunRow["channel"] {
  return trace.channel ?? "unknown";
}

function deriveTraceStatus(trace: AgentRunTrace, now: Date): AiAgentMonitoringStatus {
  const explicit = trace.status ?? (trace.sanitizedError ? "failed" : trace.completedAt || trace.responseId ? "completed" : "unknown");
  const status = explicit as AiAgentMonitoringStatus;
  const updatedAtMs = isoMs(traceUpdatedAt(trace)) ?? isoMs(trace.createdAt) ?? now.getTime();

  if (ACTIVE_STATUSES.has(status) && now.getTime() - updatedAtMs > STUCK_AFTER_MS) {
    return "stuck";
  }

  return status;
}

function isActive(status: AiAgentMonitoringStatus) {
  return ACTIVE_STATUSES.has(status);
}

function toToolStatus(row: {
  timedOut?: boolean;
  errorCategory?: string | null;
  dataStatus?: AgentDataStatus | null;
}): AiAgentMonitoringToolStatus {
  if (row.timedOut || row.errorCategory === "timeout" || row.errorCategory === "tool_timeout") {
    return "timeout";
  }
  if (row.errorCategory || row.dataStatus === "unavailable") {
    return "failed";
  }
  return "completed";
}

function toolRowsFromTrace(trace: AgentRunTrace): AiAgentMonitoringToolRow[] {
  const rows = trace.tools ?? [];
  if (rows.length > 0) {
    return rows.map((row) => ({
      toolName: row.toolName,
      status: row.status,
      startedAt: row.startedAt ?? null,
      completedAt: row.completedAt ?? null,
      latencyMs: row.latencyMs ?? null,
      dataStatus: row.dataStatus ?? null,
      errorCategory: normalizeMonitoringErrorCategory(row.errorCategory ?? row.errorMessage) ?? row.errorCategory ?? null,
      errorMessage: redactMonitoringText(row.errorMessage, 500),
    }));
  }

  const toolExecutionResults = trace.toolExecutionResults ?? [];
  if (toolExecutionResults.length > 0) {
    return toolExecutionResults.map((row) => ({
      toolName: row.toolName,
      status: toToolStatus(row),
      startedAt: null,
      completedAt: trace.completedAt ?? trace.updatedAt ?? null,
      latencyMs: row.latencyMs,
      dataStatus: row.dataStatus,
      errorCategory: normalizeMonitoringErrorCategory(row.errorCategory) ?? row.errorCategory ?? null,
      errorMessage: null,
    }));
  }

  return (trace.sourceDurations ?? []).map((row) => ({
    toolName: row.toolName,
    status: toToolStatus(row),
    startedAt: null,
    completedAt: trace.completedAt ?? trace.updatedAt ?? null,
    latencyMs: row.durationMs,
    dataStatus: row.dataStatus,
    errorCategory: normalizeMonitoringErrorCategory(row.errorCategory) ?? row.errorCategory ?? null,
    errorMessage: null,
  }));
}

function sanitizedQuestion(trace: AgentRunTrace) {
  return redactMonitoringText(trace.questionPreview, 500);
}

function sanitizedAnswer(trace: AgentRunTrace) {
  return redactMonitoringText(trace.answerPreview, 500);
}

function sanitizedError(trace: AgentRunTrace) {
  return redactMonitoringText(trace.sanitizedError, 500);
}

function buildRunRow(trace: AgentRunTrace, now: Date): AiAgentMonitoringRunRow {
  const agentId = canonicalAgentId(trace);
  const errorCategory =
    normalizeMonitoringErrorCategory(trace.errorCategory ?? trace.sanitizedError) ?? trace.errorCategory ?? null;

  return {
    runId: traceRunId(trace),
    status: deriveTraceStatus(trace, now),
    currentStep: trace.currentStep ?? null,
    clinicId: trace.clinicId ?? null,
    clinicCode: trace.clinicCode ?? null,
    clinicName: trace.clinicName ?? null,
    channel: traceChannel(trace),
    userEmail: redactMonitoringText(trace.userEmail, 120),
    requestedAgent: trace.requestedAgent ?? null,
    resolvedAgent: agentId,
    agentLabel: agentLabel(agentId),
    intent: trace.intent ?? null,
    questionPreview: sanitizedQuestion(trace),
    answerPreview: sanitizedAnswer(trace),
    toolNames: trace.toolNames ?? toolRowsFromTrace(trace).map((row) => row.toolName),
    dataStatus: trace.dataStatus ?? null,
    fallbackUsed: trace.fallbackUsed === true,
    totalLatencyMs: trace.totalLatencyMs ?? null,
    createdAt: trace.createdAt,
    updatedAt: traceUpdatedAt(trace),
    completedAt: trace.completedAt ?? null,
    errorCategory,
    sanitizedError: sanitizedError(trace),
    telegramDeliveryStatus: trace.telegramDeliveryStatus ?? null,
    telegramDeliveryLatencyMs: trace.telegramDeliveryLatencyMs ?? null,
    buttonCount: trace.buttonCount ?? null,
    messageLength: trace.messageLength ?? null,
  };
}

function filterRows(rows: AiAgentMonitoringRunRow[], filters: AiAgentMonitoringFilters) {
  const search = filters.search?.trim().toLowerCase() ?? "";
  return rows.filter((row) => {
    if (filters.clinicId && row.clinicId !== filters.clinicId) {
      return false;
    }
    if (filters.channel && row.channel !== filters.channel) {
      return false;
    }
    if (filters.status && row.status !== filters.status) {
      return false;
    }
    if (filters.agent && row.resolvedAgent !== filters.agent && row.requestedAgent !== filters.agent) {
      return false;
    }
    if (!search) {
      return true;
    }

    return [
      row.runId,
      row.currentStep,
      row.clinicId,
      row.clinicCode,
      row.clinicName,
      row.userEmail,
      row.resolvedAgent,
      row.agentLabel,
      row.intent,
      row.questionPreview,
      row.answerPreview,
      row.sanitizedError,
      ...row.toolNames,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
  });
}

function buildSlowestToolsFromRows(toolRows: AiAgentMonitoringToolRow[]) {
  const byTool = new Map<string, AiAgentMonitoringToolRow[]>();
  toolRows.forEach((row) => {
    const current = byTool.get(row.toolName) ?? [];
    current.push(row);
    byTool.set(row.toolName, current);
  });

  return [...byTool.entries()]
    .map(([toolName, rows]) => {
      const latencies = rows
        .map((row) => row.latencyMs ?? 0)
        .filter((value) => Number.isFinite(value) && value > 0);
      return {
        toolName,
        count: rows.length,
        averageLatencyMs: round(average(latencies)),
        p95LatencyMs: round(percentile(latencies, 95)),
        maxLatencyMs: round(Math.max(0, ...latencies)),
        timeoutCount: rows.filter((row) => row.status === "timeout").length,
        failureCount: rows.filter((row) => row.status === "failed" || row.status === "timeout").length,
      };
    })
    .sort((left, right) => right.p95LatencyMs - left.p95LatencyMs || right.maxLatencyMs - left.maxLatencyMs)
    .slice(0, 12);
}

function buildFailingTools(toolRows: AiAgentMonitoringToolRow[]) {
  const byTool = new Map<string, AiAgentMonitoringToolRow[]>();
  toolRows
    .filter((row) => row.status === "failed" || row.status === "timeout")
    .forEach((row) => {
      const current = byTool.get(row.toolName) ?? [];
      current.push(row);
      byTool.set(row.toolName, current);
    });

  return [...byTool.entries()]
    .map(([toolName, rows]) => ({
      toolName,
      failureCount: rows.filter((row) => row.status === "failed").length,
      timeoutCount: rows.filter((row) => row.status === "timeout").length,
      latestError: rows.find((row) => row.errorMessage)?.errorMessage ?? rows.find((row) => row.errorCategory)?.errorCategory ?? null,
    }))
    .sort((left, right) => right.failureCount + right.timeoutCount - (left.failureCount + left.timeoutCount))
    .slice(0, 12);
}

function buildLearningRows(runs: AgentLearningRunRecord[]) {
  const latest = new Map<string, AgentLearningRunRecord>();
  runs.forEach((run) => {
    const key = `${run.clinicId}:${run.jobType}`;
    const existing = latest.get(key);
    if (!existing || new Date(run.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      latest.set(key, run);
    }
  });

  return [...latest.values()]
    .map((run) => ({
      clinicId: run.clinicId,
      clinicCode: run.clinicCode ?? null,
      jobType: run.jobType,
      latestRunAt: run.createdAt,
      status: run.status,
      rowCount: run.rowCount ?? 0,
      nextExpectedRunAt: run.nextExpectedRunAt ?? null,
      error: redactMonitoringText(run.error, 300),
    }))
    .sort((left, right) => new Date(right.latestRunAt).getTime() - new Date(left.latestRunAt).getTime());
}

function buildFeedbackRows(feedbackEvents: AgentFeedbackEventRecord[], traces: AgentRunTrace[]) {
  const traceByResponse = new Map(traces.map((trace) => [trace.responseId, trace]));
  const traceByRequest = new Map(traces.map((trace) => [trace.requestId, trace]));

  return feedbackEvents.slice(0, 50).map((event) => {
    const trace = traceByResponse.get(event.responseId) ?? (event.requestId ? traceByRequest.get(event.requestId) : undefined);
    return {
      id: event.id,
      createdAt: event.createdAt,
      clinicId: event.clinicId,
      agent: event.resolvedAgent ?? trace?.resolvedAgent ?? null,
      feedbackType: event.feedbackType,
      note: redactMonitoringText(event.note, 300),
      questionPreview: trace ? sanitizedQuestion(trace) : null,
    };
  });
}

function telegramDeliveryFailed(trace: AgentRunTrace) {
  return (
    trace.channel === "telegram" &&
    (trace.telegramDeliveryStatus === "failed" ||
      trace.errorCategory === "telegram_send_failed" ||
      trace.sanitizedError?.toLowerCase().includes("telegram") === true)
  );
}

function buildHealthFromStatus(params: {
  statusReport: AgentStatusReport;
  stuckRuns: number;
  failedRuns: number;
  telegramDeliveryFailureCount: number;
}) {
  if (params.stuckRuns > 0 || params.telegramDeliveryFailureCount > 0) {
    return "critical";
  }
  if (params.failedRuns > 0 && params.statusReport.health === "healthy") {
    return "degraded";
  }
  return params.statusReport.health;
}

function buildMonitoringAlerts(params: {
  statusReport: AgentStatusReport;
  stuckRuns: number;
  telegramDeliveryFailureCount: number;
  failingTools: ReturnType<typeof buildFailingTools>;
}) {
  const alerts = [...params.statusReport.alerts];
  if (params.stuckRuns > 0) {
    alerts.unshift({
      severity: "critical",
      code: "stuck_agent_runs",
      message: `${params.stuckRuns} stuck agent run${params.stuckRuns === 1 ? "" : "s"} found.`,
    });
  }
  if (params.telegramDeliveryFailureCount > 0) {
    alerts.unshift({
      severity: "critical",
      code: "telegram_delivery_failed",
      message: `Telegram delivery failed ${params.telegramDeliveryFailureCount} time${params.telegramDeliveryFailureCount === 1 ? "" : "s"}.`,
    });
  }
  const customerResolverFailures = params.failingTools.find((tool) => /customer|resolver/i.test(tool.toolName));
  if (customerResolverFailures) {
    alerts.push({
      severity: "warning",
      code: "customer_resolver_failed",
      message: `Customer resolver failed ${customerResolverFailures.failureCount + customerResolverFailures.timeoutCount} time${customerResolverFailures.failureCount + customerResolverFailures.timeoutCount === 1 ? "" : "s"}.`,
    });
  }
  return alerts;
}

export function buildAiAgentMonitoringSummary(params: {
  range: AiAgentMonitoringRange;
  traces: AgentRunTrace[];
  learningRuns: AgentLearningRunRecord[];
  feedbackEvents: AgentFeedbackEventRecord[];
  recommendationOutcomes?: GtAgentRecommendationOutcome[];
  insightCards?: GtAgentInsightCard[];
  factSnapshots: GtAgentFactSnapshot[];
  filters?: AiAgentMonitoringFilters;
  now?: Date;
}): AiAgentMonitoringSummary {
  const now = params.now ?? new Date();
  const allRows = params.traces.map((trace) => buildRunRow(trace, now));
  const rows = filterRows(allRows, params.filters ?? {});
  const tracesByRunId = new Map(params.traces.map((trace) => [traceRunId(trace), trace]));
  const filteredTraces = rows.map((row) => tracesByRunId.get(row.runId)).filter((trace): trace is AgentRunTrace => Boolean(trace));
  const toolRows = filteredTraces.flatMap(toolRowsFromTrace);
  const latencies = rows
    .map((row) => row.totalLatencyMs ?? 0)
    .filter((value) => Number.isFinite(value) && value > 0);
  const completedRuns = rows.filter((row) => row.status === "completed").length;
  const failedRuns = rows.filter((row) => row.status === "failed").length;
  const timeoutRuns = rows.filter((row) => row.status === "timeout").length;
  const stuckRuns = rows.filter((row) => row.status === "stuck").length;
  const activeNow = rows.filter((row) => isActive(row.status)).length;
  const fallbackRuns = rows.filter((row) => row.fallbackUsed).length;
  const toolFailureCount = toolRows.filter((row) => row.status === "failed" || row.status === "timeout").length;
  const telegramDeliveryFailureCount = filteredTraces.filter(telegramDeliveryFailed).length;
  const statusReport = buildAgentStatusReport({
    range: params.range,
    traces: filteredTraces,
    learningRuns: params.learningRuns,
    feedbackEvents: params.feedbackEvents,
    recommendationOutcomes: params.recommendationOutcomes ?? [],
    insightCards: params.insightCards ?? [],
    factSnapshots: params.factSnapshots,
    now,
  });
  const slowestTools = buildSlowestToolsFromRows(toolRows);
  const failingTools = buildFailingTools(toolRows);
  const alerts = buildMonitoringAlerts({
    statusReport,
    stuckRuns,
    telegramDeliveryFailureCount,
    failingTools,
  });
  const byAgent = [...new Map(rows.map((row) => [row.resolvedAgent ?? "unknown", row.resolvedAgent ?? "unknown"])).keys()]
    .map((agentId) => {
      const agentRows = rows.filter((row) => (row.resolvedAgent ?? "unknown") === agentId);
      const agentLatencies = agentRows
        .map((row) => row.totalLatencyMs ?? 0)
        .filter((value) => Number.isFinite(value) && value > 0);
      return {
        agentId,
        agentLabel: agentLabel(agentId),
        totalRuns: agentRows.length,
        activeRuns: agentRows.filter((row) => isActive(row.status)).length,
        failedRuns: agentRows.filter((row) => row.status === "failed" || row.status === "timeout").length,
        averageLatencyMs: round(average(agentLatencies)),
        p95LatencyMs: round(percentile(agentLatencies, 95)),
      };
    })
    .sort((left, right) => right.totalRuns - left.totalRuns);
  const byChannel = [...new Set(rows.map((row) => row.channel))]
    .map((channel) => {
      const channelRows = rows.filter((row) => row.channel === channel);
      const channelLatencies = channelRows
        .map((row) => row.totalLatencyMs ?? 0)
        .filter((value) => Number.isFinite(value) && value > 0);
      return {
        channel,
        totalRuns: channelRows.length,
        failedRuns: channelRows.filter((row) => row.status === "failed" || row.status === "timeout").length,
        averageLatencyMs: round(average(channelLatencies)),
      };
    })
    .sort((left, right) => right.totalRuns - left.totalRuns);

  return {
    health: buildHealthFromStatus({
      statusReport,
      stuckRuns,
      failedRuns,
      telegramDeliveryFailureCount,
    }),
    generatedAt: now.toISOString(),
    summary: {
      activeNow,
      stuckRuns,
      completedRuns,
      failedRuns,
      timeoutRuns,
      totalRuns: rows.length,
      totalQuestions: rows.length,
      averageLatencyMs: round(average(latencies)),
      p95LatencyMs: round(percentile(latencies, 95)),
      toolFailureRate: toolRows.length ? toolFailureCount / toolRows.length : 0,
      fallbackRate: rows.length ? fallbackRuns / rows.length : 0,
      wrongDataFeedbackCount: params.feedbackEvents.filter((event) => event.feedbackType === "wrong_data").length,
      telegramDeliveryFailureCount,
    },
    byAgent,
    byChannel,
    alerts,
    slowestTools,
    failingTools,
    learning: {
      totalRuns: params.learningRuns.length,
      failedRuns: params.learningRuns.filter((run) => run.status === "failed").length,
      rows: buildLearningRows(params.learningRuns),
    },
    snapshots: params.factSnapshots.slice(0, 50).map((snapshot) => ({
      clinicId: snapshot.clinicId,
      clinicCode: snapshot.clinicCode,
      snapshotType: snapshot.snapshotType,
      checkedAt: snapshot.checkedAt,
      dataStatus: snapshot.dataStatus,
      freshnessSeconds: snapshot.freshnessSeconds ?? null,
      expiresAt: snapshot.expiresAt ?? null,
    })),
    feedback: buildFeedbackRows(params.feedbackEvents, filteredTraces),
  };
}

export function buildAiAgentMonitoringRuns(params: {
  traces: AgentRunTrace[];
  filters?: AiAgentMonitoringFilters;
  limit?: number;
  cursor?: string | null;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const offset = Math.max(Number.parseInt(params.cursor ?? "0", 10) || 0, 0);
  const rows = filterRows(params.traces.map((trace) => buildRunRow(trace, now)), params.filters ?? {});
  const page = rows.slice(offset, offset + limit);
  const nextOffset = offset + page.length;

  return {
    rows: page,
    nextCursor: nextOffset < rows.length ? String(nextOffset) : null,
  };
}

function buildTimeline(trace: AgentRunTrace, tools: AiAgentMonitoringToolRow[]) {
  const timeline = [...(trace.timeline ?? [])];
  if (timeline.length === 0) {
    timeline.push({ label: "Request received", status: "completed", at: trace.createdAt });
    if (trace.intent || trace.resolvedAgent) {
      timeline.push({
        label: "Intent planned",
        status: "completed",
        at: trace.updatedAt ?? trace.createdAt,
        detail: [trace.resolvedAgent, trace.intent].filter(Boolean).join(" · ") || null,
      });
    }
    tools.forEach((tool) => {
      timeline.push({
        label: `${tool.toolName} tool`,
        status: tool.status,
        at: tool.completedAt ?? tool.startedAt ?? trace.updatedAt ?? trace.createdAt,
        detail: tool.errorCategory ?? tool.dataStatus ?? null,
      });
    });
    if (trace.answerPreview || trace.responseId) {
      timeline.push({
        label: "Response generated",
        status: trace.sanitizedError ? "failed" : "completed",
        at: trace.updatedAt ?? trace.completedAt ?? trace.createdAt,
      });
    }
    if (trace.channel === "telegram" && trace.telegramDeliveryStatus) {
      timeline.push({
        label: "Telegram delivery",
        status: trace.telegramDeliveryStatus,
        at: trace.completedAt ?? trace.updatedAt ?? trace.createdAt,
        detail: trace.telegramDeliveryLatencyMs == null ? null : `${trace.telegramDeliveryLatencyMs}ms`,
      });
    }
  }

  return timeline
    .map((item) => ({
      label: item.label,
      status: item.status,
      at: item.at,
      detail: redactMonitoringText(item.detail, 300),
    }))
    .sort((left, right) => (isoMs(left.at) ?? 0) - (isoMs(right.at) ?? 0));
}

export function buildAiAgentMonitoringRunDetail(params: {
  trace: AgentRunTrace;
  feedbackEvents?: AgentFeedbackEventRecord[];
  now?: Date;
}): AiAgentMonitoringRunDetail {
  const now = params.now ?? new Date();
  const row = buildRunRow(params.trace, now);
  const tools = toolRowsFromTrace(params.trace);
  const feedback = (params.feedbackEvents ?? [])
    .filter((event) => event.responseId === params.trace.responseId || event.requestId === params.trace.requestId)
    .map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      feedbackType: event.feedbackType,
      rating: event.rating,
      note: redactMonitoringText(event.note, 300),
    }));

  return {
    run: {
      ...row,
      requestId: params.trace.requestId,
      responseId: params.trace.responseId ?? null,
      sessionId: params.trace.sessionId ?? null,
      telegramChatIdHash: params.trace.telegramChatIdHash ?? null,
      telegramUserIdHash: params.trace.telegramUserIdHash ?? null,
      telegramMessageId: params.trace.telegramMessageId ?? null,
      telegramCallbackDataType: params.trace.telegramCallbackDataType ?? null,
      callbackExpired: params.trace.callbackExpired ?? null,
      callbackResolved: params.trace.callbackResolved ?? null,
      tools,
      warnings: (params.trace.warnings ?? []).map((warning) => redactMonitoringText(warning, 300) ?? ""),
      cacheStats: params.trace.cacheStats,
      model: params.trace.model ?? null,
      provider: params.trace.provider ?? null,
      promptTokens: params.trace.promptTokens ?? null,
      completionTokens: params.trace.completionTokens ?? null,
      estimatedCostUsd: params.trace.estimatedCostUsd ?? null,
    },
    timeline: buildTimeline(params.trace, tools),
    feedback,
  };
}

async function optionalList<T>(callback: () => Promise<T[]>) {
  try {
    return await callback();
  } catch {
    return [];
  }
}

async function loadMonitoringData(params: {
  range: AiAgentMonitoringRange;
  clinicId?: string;
  dataSource?: AiAgentMonitoringDataSource;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const since = rangeSince(params.range, now);
  const dataSource = params.dataSource ?? DEFAULT_DATA_SOURCE;
  const [traces, learningRuns, feedbackEvents, recommendationOutcomes, insightCards, factSnapshots] = await Promise.all([
    optionalList(() => dataSource.listRunTraces({ clinicId: params.clinicId, since, limit: 2_000 })),
    optionalList(() => dataSource.listLearningRuns({ clinicId: params.clinicId, since, limit: 1_000 })),
    optionalList(() => dataSource.listFeedbackEvents({ clinicId: params.clinicId, since, limit: 1_000 })),
    optionalList(() => dataSource.listRecommendationOutcomes({ clinicId: params.clinicId, since, limit: 1_000 })),
    optionalList(() => dataSource.listInsightCards({ clinicId: params.clinicId, since, limit: 1_000 })),
    optionalList(() => dataSource.listFactSnapshots({ clinicId: params.clinicId, since: rangeSince("30d", now), limit: 1_000 })),
  ]);

  return {
    traces,
    learningRuns,
    feedbackEvents,
    recommendationOutcomes,
    insightCards,
    factSnapshots,
  };
}

export async function getAiAgentMonitoringSummary(params: {
  range?: AiAgentMonitoringRange;
  filters?: AiAgentMonitoringFilters;
  dataSource?: AiAgentMonitoringDataSource;
  now?: Date;
}) {
  const range = params.range ?? "24h";
  const now = params.now ?? new Date();
  const data = await loadMonitoringData({
    range,
    clinicId: params.filters?.clinicId,
    dataSource: params.dataSource,
    now,
  });

  return buildAiAgentMonitoringSummary({
    range,
    ...data,
    filters: params.filters,
    now,
  });
}

export async function getAiAgentMonitoringRuns(params: {
  range?: AiAgentMonitoringRange;
  filters?: AiAgentMonitoringFilters;
  limit?: number;
  cursor?: string | null;
  dataSource?: AiAgentMonitoringDataSource;
  now?: Date;
}) {
  const range = params.range ?? "24h";
  const now = params.now ?? new Date();
  const data = await loadMonitoringData({
    range,
    clinicId: params.filters?.clinicId,
    dataSource: params.dataSource,
    now,
  });

  return buildAiAgentMonitoringRuns({
    traces: data.traces,
    filters: params.filters,
    limit: params.limit,
    cursor: params.cursor,
    now,
  });
}

export async function getAiAgentMonitoringLive(params: {
  filters?: AiAgentMonitoringFilters;
  dataSource?: AiAgentMonitoringDataSource;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const data = await loadMonitoringData({
    range: "1h",
    clinicId: params.filters?.clinicId,
    dataSource: params.dataSource,
    now,
  });
  const recentCutoff = now.getTime() - LIVE_RECENT_MS;
  const rows = data.traces.map((trace) => buildRunRow(trace, now)).filter((row) => {
    if (isActive(row.status) || row.status === "stuck") {
      return true;
    }
    const updatedAtMs = isoMs(row.updatedAt) ?? 0;
    return updatedAtMs >= recentCutoff && ["completed", "failed", "timeout"].includes(row.status);
  });

  return {
    rows: filterRows(rows, params.filters ?? {}).slice(0, 100),
    generatedAt: now.toISOString(),
  };
}

export async function getAiAgentMonitoringRunDetail(params: {
  runId: string;
  dataSource?: AiAgentMonitoringDataSource;
  now?: Date;
}) {
  const dataSource = params.dataSource ?? DEFAULT_DATA_SOURCE;
  const trace = await dataSource.getRunTraceByRunId(params.runId);
  if (!trace) {
    return null;
  }

  const since = rangeSince("30d", params.now ?? new Date());
  const feedbackEvents = await optionalList(() => dataSource.listFeedbackEvents({ clinicId: trace.clinicId, since, limit: 1_000 }));
  return buildAiAgentMonitoringRunDetail({
    trace,
    feedbackEvents,
    now: params.now,
  });
}
