import { z } from "zod";
import { env } from "../../../config/env.js";
import { runWithAnalyticsQueryContext } from "../../analytics-query-context.js";
import { getDashboardOverview } from "../../reports/dashboard.service.js";
import { getDailyTreatmentReport } from "../../reports/daily-treatment.service.js";
import { getServiceBehaviorReport } from "../../reports/service-behavior.service.js";
import { getServicePortalList, getServicePortalOverview } from "../../reports/service-portal.service.js";
import { getTherapistPortalReport } from "../../reports/therapist-portal.service.js";
import { formatDateKeyInTimeZone, normalizeTimeZone } from "../../telegram/time.js";
import { listInsightCards } from "../memory/memory.repository.js";
import type { GtAgentFactSnapshot, GtAgentInsightCard } from "../memory/memory-types.js";
import { buildService360ToolResult } from "../service-360.service.js";
import { limitRows, nowIso } from "../safety.js";
import {
  factSnapshotToAgentSource,
  getFactSnapshotForPeriod,
  getFreshFactSnapshot,
  isCompletedHistoricalDay,
} from "../snapshot-cache.service.js";
import type { AgentDataStatus, AgentToolDefinition, AgentToolInput, AgentToolResult, GreatTimeAgentSource } from "../types.js";

const toolInputSchema = z.custom<AgentToolInput>(() => true);

function runBusinessBigQueryOperation<T>(params: {
  toolName: string;
  operationName: string;
  callback: () => Promise<T>;
}) {
  return runWithAnalyticsQueryContext(
    {
      queryNamePrefix: `agent.business.${params.toolName}.${params.operationName}`,
      labels: {
        app: "greattime",
        feature: "agent_hub",
        agent: "business",
        tool: params.toolName,
        operation: params.operationName,
      },
      timeoutMs: env.AGENT_BIGQUERY_TIMEOUT_MS,
      ttlMs: env.BQ_QUERY_DEFAULT_TTL_MS,
      readOnly: true,
    },
    params.callback,
  );
}

function periodLabel(input: AgentToolInput) {
  return `${input.period.fromDate} to ${input.period.toDate}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nestedRecord(value: unknown, key: string) {
  if (!isRecord(value)) {
    return {};
  }

  const child = value[key];
  if (!isRecord(child)) {
    return {};
  }

  return isRecord(child.summary) ? child.summary : child;
}

function numberFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value && typeof value === "object" && "value" in value) {
    return Number((value as { value: unknown }).value);
  }

  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumberFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value && typeof value === "object" && "value" in value) {
    const parsed = Number((value as { value: unknown }).value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function latestCheckedAt(sources: GreatTimeAgentSource[]) {
  return sources
    .map((source) => source.checkedAt)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? nowIso();
}

function secondsSince(value: string | null | undefined, now = new Date()) {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.max(0, Math.floor((now.getTime() - parsed) / 1_000));
}

async function getCompletedDayFinanceSnapshot(input: AgentToolInput) {
  if (!env.AGENT_SNAPSHOT_CACHE_ENABLED || !env.AGENT_COMPLETED_DAY_SNAPSHOT_ENABLED) {
    return null;
  }

  if (
    !isCompletedHistoricalDay({
      fromDate: input.period.fromDate,
      toDate: input.period.toDate,
      timezone: input.request.timezone,
    })
  ) {
    return null;
  }

  return getFactSnapshotForPeriod({
    clinicId: input.clinic.clinicId,
    snapshotType: "finance_daily_snapshot",
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    maxAgeMs: env.AGENT_SNAPSHOT_MAX_AGE_MINUTES * 60_000,
  }).catch(() => null);
}

async function getExactProfileSnapshot(input: AgentToolInput, snapshotType: "service_profiles" | "practitioner_profiles") {
  if (!env.AGENT_SNAPSHOT_CACHE_ENABLED) {
    return null;
  }

  return getFactSnapshotForPeriod({
    clinicId: input.clinic.clinicId,
    snapshotType,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    maxAgeMs: env.AGENT_SNAPSHOT_MAX_AGE_MINUTES * 60_000,
  }).catch(() => null);
}

export function buildBusinessHealthResultFromFinanceSnapshot(params: {
  input: AgentToolInput;
  snapshot: GtAgentFactSnapshot;
}): AgentToolResult {
  const sales = nestedRecord(params.snapshot.summary, "sales");
  const payments = nestedRecord(params.snapshot.summary, "payments");
  const revenue = numberFromRecord(sales, "totalRevenue");
  const invoices = numberFromRecord(sales, "invoiceCount");
  const customers = numberFromRecord(sales, "customerCount");
  const collected = numberFromRecord(payments, "totalAmount");
  const source = factSnapshotToAgentSource({
    snapshot: params.snapshot,
    toolName: "get_business_health_snapshot",
    sourceName: "GreatTime learned finance daily snapshot",
    scope: "historical",
    live: false,
  });

  return {
    toolName: "get_business_health_snapshot",
    sourceName: "GreatTime learned finance daily snapshot",
    checkedAt: params.snapshot.checkedAt,
    period: periodLabel(params.input),
    dataStatus: params.snapshot.dataStatus === "ok" ? "partial" : params.snapshot.dataStatus,
    live: false,
    summary: `Business health for ${params.input.period.label}: revenue ${revenue.toLocaleString("en-US")}, collected ${collected.toLocaleString("en-US")}.`,
    metrics: [
      { label: "Revenue", value: revenue, unit: "amount" },
      { label: "Invoices", value: invoices },
      { label: "Customers", value: customers },
      { label: "Collected", value: collected, unit: "amount" },
    ],
    sources: [source],
    warnings: [
      {
        type: "business_health_snapshot_partial",
        title: "Business health snapshot is partial",
        message: "The fast snapshot path covers finance metrics for this completed day. Ask for appointment or service details for the full source view.",
      },
    ],
  };
}

function buildServiceProfileSnapshotResult(input: AgentToolInput, snapshot: GtAgentFactSnapshot): AgentToolResult {
  const summary = nestedRecord(snapshot.summary, "summary");
  const totalBookings = numberFromRecord(summary, "totalBookings");
  const distinctServices = numberFromRecord(summary, "distinctServices");
  const avgBookingsPerService = numberFromRecord(summary, "avgBookingsPerService");
  const topServiceCount = numberFromRecord(snapshot.summary, "topServiceCount");

  return {
    toolName: "get_service_overview",
    sourceName: "GreatTime learned service profiles",
    checkedAt: snapshot.checkedAt,
    period: periodLabel(input),
    dataStatus: snapshot.dataStatus,
    live: false,
    summary: `Service profile snapshot has ${distinctServices.toLocaleString("en-US")} services and ${totalBookings.toLocaleString("en-US")} bookings for ${input.period.label}.`,
    metrics: [
      { label: "Services", value: distinctServices },
      { label: "Bookings", value: totalBookings },
      { label: "Avg bookings/service", value: avgBookingsPerService },
      { label: "Top service rows", value: topServiceCount },
    ],
    sources: [
      factSnapshotToAgentSource({
        snapshot,
        toolName: "get_service_overview",
        sourceName: "GreatTime learned service profiles",
        scope: "learned",
        live: false,
      }),
    ],
  };
}

function buildPractitionerProfileSnapshotResult(input: AgentToolInput, snapshot: GtAgentFactSnapshot): AgentToolResult {
  const summary = nestedRecord(snapshot.summary, "summary");
  const activeTherapists = numberFromRecord(summary, "activeTherapists");
  const totalTreatments = numberFromRecord(summary, "totalTreatments");
  const customersServed = numberFromRecord(summary, "customersServed");
  const averageUtilizationScore = numberFromRecord(summary, "averageUtilizationScore");
  const leaderboardCount = numberFromRecord(snapshot.summary, "leaderboardCount");

  return {
    toolName: "get_practitioner_overview",
    sourceName: "GreatTime learned practitioner profiles",
    checkedAt: snapshot.checkedAt,
    period: periodLabel(input),
    dataStatus: snapshot.dataStatus,
    live: false,
    summary: `Practitioner profile snapshot has ${activeTherapists.toLocaleString("en-US")} active practitioners and ${totalTreatments.toLocaleString("en-US")} treatments for ${input.period.label}.`,
    metrics: [
      { label: "Active practitioners", value: activeTherapists },
      { label: "Treatments", value: totalTreatments },
      { label: "Customers served", value: customersServed },
      { label: "Average utilization", value: averageUtilizationScore },
      { label: "Leaderboard rows", value: leaderboardCount },
    ],
    sources: [
      factSnapshotToAgentSource({
        snapshot,
        toolName: "get_practitioner_overview",
        sourceName: "GreatTime learned practitioner profiles",
        scope: "learned",
        live: false,
      }),
    ],
  };
}

export function selectOwnerDailyBriefDate(input: AgentToolInput, now = new Date()) {
  if (
    isCompletedHistoricalDay({
      fromDate: input.period.fromDate,
      toDate: input.period.toDate,
      timezone: input.request.timezone,
      now,
    })
  ) {
    return input.period.toDate;
  }

  const timezone = normalizeTimeZone(input.request.timezone || env.DEFAULT_TIMEZONE);
  return addDays(formatDateKeyInTimeZone(now, timezone), -1);
}

export function selectOwnerDailyBriefPeriod(input: AgentToolInput, now = new Date()) {
  const timezone = normalizeTimeZone(input.request.timezone || env.DEFAULT_TIMEZONE);

  if (input.request.fromDate && input.request.toDate) {
    return {
      fromDate: input.request.fromDate,
      toDate: input.request.toDate,
      timezone,
    };
  }

  const briefDate = selectOwnerDailyBriefDate(input, now);
  return {
    fromDate: briefDate,
    toDate: briefDate,
    timezone,
  };
}

type OwnerBriefMetric = {
  label: string;
  value: string | number;
  unit?: string;
  sourceSnapshotType?: string;
};

type OwnerBriefRisk = {
  title: string;
  reason: string;
  severity?: "low" | "medium" | "high";
  sourceInsightCardId?: string;
};

type OwnerBriefOpportunity = {
  title: string;
  reason: string;
  estimatedValue?: number;
  sourceInsightCardId?: string;
};

type OwnerBriefRecommendedAction = {
  title: string;
  reason: string;
  actionKind?: string;
  priority?: number;
  sourceInsightCardId?: string;
};

const OWNER_BRIEF_RISK_CARD_TYPES = new Set([
  "rising_cancellations_no_shows",
  "declining_service_usage",
  "collections_below_sales",
  "practitioner_capacity_gap",
]);

function cardSeverity(card: GtAgentInsightCard): OwnerBriefRisk["severity"] {
  if (card.personalizedPriorityScore >= 80) {
    return "high";
  }
  if (card.personalizedPriorityScore >= 50) {
    return "medium";
  }
  return "low";
}

function cardToRisk(card: GtAgentInsightCard): OwnerBriefRisk {
  return {
    title: card.title,
    reason: card.summary,
    severity: cardSeverity(card),
    sourceInsightCardId: card.id,
  };
}

function cardToOpportunity(card: GtAgentInsightCard): OwnerBriefOpportunity {
  return {
    title: card.title,
    reason: card.summary,
    sourceInsightCardId: card.id,
  };
}

function cardToRecommendedAction(card: GtAgentInsightCard): OwnerBriefRecommendedAction {
  return {
    title: card.title,
    reason: card.summary,
    actionKind: card.type,
    priority: card.personalizedPriorityScore,
    sourceInsightCardId: card.id,
  };
}

function addBriefMetric(params: {
  resultMetrics: NonNullable<AgentToolResult["metrics"]>;
  briefMetrics: OwnerBriefMetric[];
  label: string;
  value: number | null;
  unit?: string;
  sourceSnapshotType: string;
}) {
  if (params.value == null) {
    return;
  }

  params.resultMetrics.push({
    label: params.label,
    value: params.value,
    unit: params.unit,
  });
  params.briefMetrics.push({
    label: params.label,
    value: params.value,
    unit: params.unit,
    sourceSnapshotType: params.sourceSnapshotType,
  });
}

function firstAvailableNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = optionalNumberFromRecord(record, key);
    if (value != null) {
      return value;
    }
  }

  return null;
}

export function buildOwnerDailyBriefFromSnapshots(params: {
  input: AgentToolInput;
  briefDate: string;
  period?: { fromDate: string; toDate: string; timezone: string };
  financeSnapshot?: GtAgentFactSnapshot | null;
  appointmentSnapshot?: GtAgentFactSnapshot | null;
  operationalSnapshot?: GtAgentFactSnapshot | null;
  serviceSnapshot?: GtAgentFactSnapshot | null;
  practitionerSnapshot?: GtAgentFactSnapshot | null;
  insightCards?: GtAgentInsightCard[];
}): AgentToolResult {
  const period = params.period ?? {
    fromDate: params.briefDate,
    toDate: params.briefDate,
    timezone: normalizeTimeZone(params.input.request.timezone || env.DEFAULT_TIMEZONE),
  };
  const sources: GreatTimeAgentSource[] = [];
  const metrics: NonNullable<AgentToolResult["metrics"]> = [];
  const briefMetrics: OwnerBriefMetric[] = [];
  const recommendations: NonNullable<AgentToolResult["recommendations"]> = [];
  const warnings: NonNullable<AgentToolResult["warnings"]> = [];
  const insightCards = params.insightCards ?? [];

  if (params.financeSnapshot) {
    const sales = nestedRecord(params.financeSnapshot.summary, "sales");
    const payments = nestedRecord(params.financeSnapshot.summary, "payments");
    addBriefMetric({
      resultMetrics: metrics,
      briefMetrics,
      label: "Revenue",
      value: optionalNumberFromRecord(sales, "totalRevenue"),
      unit: "amount",
      sourceSnapshotType: "finance_daily_snapshot",
    });
    addBriefMetric({
      resultMetrics: metrics,
      briefMetrics,
      label: "Invoices",
      value: optionalNumberFromRecord(sales, "invoiceCount"),
      sourceSnapshotType: "finance_daily_snapshot",
    });
    addBriefMetric({
      resultMetrics: metrics,
      briefMetrics,
      label: "Collected",
      value: optionalNumberFromRecord(payments, "totalAmount"),
      unit: "amount",
      sourceSnapshotType: "finance_daily_snapshot",
    });
    sources.push(
      factSnapshotToAgentSource({
        snapshot: params.financeSnapshot,
        toolName: "get_owner_daily_brief",
        sourceName: "GreatTime learned finance daily snapshot",
        scope: "historical",
        live: false,
      }),
    );
  }

  if (params.appointmentSnapshot) {
    const summary = params.appointmentSnapshot.summary;
    const lifecycleCounts = isRecord(summary.lifecycleCounts) ? summary.lifecycleCounts : {};
    addBriefMetric({
      resultMetrics: metrics,
      briefMetrics,
      label: "Appointments",
      value: firstAvailableNumber(summary, ["bookingAppointmentCount", "bookingRowCount", "rowCount"]),
      sourceSnapshotType: "appointment_daily_profile",
    });
    addBriefMetric({
      resultMetrics: metrics,
      briefMetrics,
      label: "Checked out",
      value: optionalNumberFromRecord(lifecycleCounts, "checked_out"),
      sourceSnapshotType: "appointment_daily_profile",
    });
    sources.push(
      factSnapshotToAgentSource({
        snapshot: params.appointmentSnapshot,
        toolName: "get_owner_daily_brief",
        sourceName: "GreatTime learned appointment daily profile",
        scope: "historical",
        live: false,
      }),
    );
  }

  if (params.operationalSnapshot) {
    const summary = params.operationalSnapshot.summary;
    const lifecycleCounts = isRecord(summary.lifecycleCounts) ? summary.lifecycleCounts : {};
    addBriefMetric({
      resultMetrics: metrics,
      briefMetrics,
      label: "Today appointments",
      value: firstAvailableNumber(summary, ["bookingAppointmentCount", "bookingRowCount", "rowCount"]),
      sourceSnapshotType: "appointment_operational_snapshot",
    });
    addBriefMetric({
      resultMetrics: metrics,
      briefMetrics,
      label: "Checked in now",
      value:
        optionalNumberFromRecord(lifecycleCounts, "arrived_start_unknown") ??
        optionalNumberFromRecord(lifecycleCounts, "treatment_in_progress"),
      sourceSnapshotType: "appointment_operational_snapshot",
    });
    sources.push(
      factSnapshotToAgentSource({
        snapshot: params.operationalSnapshot,
        toolName: "get_owner_daily_brief",
        sourceName: "GreatTime learned appointment operational snapshot",
        scope: "learned",
        live: false,
      }),
    );
  }

  if (params.serviceSnapshot) {
    const summary = nestedRecord(params.serviceSnapshot.summary, "summary");
    addBriefMetric({
      resultMetrics: metrics,
      briefMetrics,
      label: "Distinct services",
      value: optionalNumberFromRecord(summary, "distinctServices"),
      sourceSnapshotType: "service_profiles",
    });
    sources.push(
      factSnapshotToAgentSource({
        snapshot: params.serviceSnapshot,
        toolName: "get_owner_daily_brief",
        sourceName: "GreatTime learned service profiles",
        scope: "learned",
        live: false,
      }),
    );
  }

  if (params.practitionerSnapshot) {
    const summary = nestedRecord(params.practitionerSnapshot.summary, "summary");
    addBriefMetric({
      resultMetrics: metrics,
      briefMetrics,
      label: "Active practitioners",
      value: optionalNumberFromRecord(summary, "activeTherapists"),
      sourceSnapshotType: "practitioner_profiles",
    });
    sources.push(
      factSnapshotToAgentSource({
        snapshot: params.practitionerSnapshot,
        toolName: "get_owner_daily_brief",
        sourceName: "GreatTime learned practitioner profiles",
        scope: "learned",
        live: false,
      }),
    );
  }

  const risks = insightCards.filter((card) => OWNER_BRIEF_RISK_CARD_TYPES.has(card.type)).slice(0, 3).map(cardToRisk);
  const opportunities = insightCards
    .filter((card) => !OWNER_BRIEF_RISK_CARD_TYPES.has(card.type))
    .slice(0, 3)
    .map(cardToOpportunity);
  const recommendedActions = insightCards.slice(0, 3).map(cardToRecommendedAction);

  recommendedActions.forEach((action) => {
    recommendations.push({
      recommendationId: action.sourceInsightCardId,
      recommendationType: action.actionKind,
      opportunityKey: action.sourceInsightCardId,
      title: action.title,
      message: action.reason,
      sourceTools: ["get_owner_daily_brief"],
    });
  });

  if (insightCards.length > 0) {
    sources.push({
      tool: "get_owner_daily_brief",
      sourceName: "GreatTime owner insight cards",
      checkedAt: insightCards[0].checkedAt,
      period: params.briefDate,
      dataStatus: "ok",
      freshnessSeconds: secondsSince(insightCards[0].checkedAt),
      live: false,
      scope: "learned",
    });
  }

  const hasFinance = Boolean(params.financeSnapshot);
  const hasAppointments = Boolean(params.appointmentSnapshot);
  const missingSnapshotLabels = [
    ...(hasFinance ? [] : ["finance daily snapshot"]),
    ...(hasAppointments ? [] : ["appointment daily profile"]),
    ...(params.operationalSnapshot ? [] : ["appointment operational snapshot"]),
    ...(params.serviceSnapshot ? [] : ["service profiles"]),
    ...(params.practitionerSnapshot ? [] : ["practitioner profiles"]),
  ];
  const dataStatus: AgentDataStatus = hasFinance && hasAppointments ? "ok" : sources.length ? "partial" : "not_ready";
  if (dataStatus !== "ok") {
    warnings.push({
      type: "owner_daily_brief_partial",
      title: dataStatus === "not_ready" ? "Daily brief snapshots are not ready" : "Daily brief is partial",
      message: missingSnapshotLabels.length
        ? `This answer uses available source-backed snapshots only. Missing: ${missingSnapshotLabels.join(", ")}.`
        : "Some daily brief snapshots are not ready yet, so this answer includes only available source-backed snapshots.",
    });
  }

  const revenue = briefMetrics.find((metric) => metric.label === "Revenue")?.value ?? "not ready";
  const appointments = briefMetrics.find((metric) => metric.label === "Appointments")?.value ?? "not ready";
  const headline =
    dataStatus === "not_ready"
      ? `Owner daily brief for ${period.fromDate === period.toDate ? period.toDate : `${period.fromDate} to ${period.toDate}`} is not ready because no source-backed snapshots were available.`
      : `Owner daily brief for ${period.fromDate === period.toDate ? period.toDate : `${period.fromDate} to ${period.toDate}`}: revenue ${typeof revenue === "number" ? revenue.toLocaleString("en-US") : revenue}, appointments ${typeof appointments === "number" ? appointments.toLocaleString("en-US") : appointments}.`;
  const tables: NonNullable<AgentToolResult["tables"]> = [];

  if (risks.length > 0) {
    tables.push({
      title: "Top risks",
      columns: [
        { key: "title", title: "Risk" },
        { key: "reason", title: "Reason" },
        { key: "severity", title: "Severity" },
      ],
      rows: risks,
    });
  }

  if (opportunities.length > 0) {
    tables.push({
      title: "Top opportunities",
      columns: [
        { key: "title", title: "Opportunity" },
        { key: "reason", title: "Reason" },
      ],
      rows: opportunities,
    });
  }

  return {
    toolName: "get_owner_daily_brief",
    sourceName: "GreatTime owner daily brief snapshots",
    checkedAt: latestCheckedAt(sources),
    period: period.fromDate === period.toDate ? period.toDate : `${period.fromDate} to ${period.toDate}`,
    dataStatus,
    live: false,
    summary: headline,
    metrics: metrics.slice(0, 6),
    tables: tables.length ? tables : undefined,
    recommendations: recommendations.length ? recommendations : undefined,
    sources,
    warnings: warnings.length ? warnings : undefined,
    data: {
      period,
      headline,
      metrics: briefMetrics.slice(0, 6),
      risks,
      opportunities,
      recommendedActions,
      sources,
    },
  };
}

async function getBusinessHealthSnapshot(input: AgentToolInput): Promise<AgentToolResult> {
  const snapshot = await getCompletedDayFinanceSnapshot(input);
  if (snapshot) {
    return buildBusinessHealthResultFromFinanceSnapshot({ input, snapshot });
  }

  const data = await runBusinessBigQueryOperation({
    toolName: "get_business_health_snapshot",
    operationName: "snapshot_fallback",
    callback: () =>
      getDashboardOverview({
        clinicCode: input.clinic.clinicCode,
        fromDate: input.period.fromDate,
        toDate: input.period.toDate,
      }),
  });

  return {
    toolName: "get_business_health_snapshot",
    sourceName: "BigQuery dashboard overview",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: "ok",
    live: false,
    summary: `Business health for ${input.period.label}: revenue ${data.summary.revenue.value.toLocaleString("en-US")}, appointments ${data.summary.appointments.value.toLocaleString("en-US")}.`,
    metrics: [
      { label: "Revenue", value: data.summary.revenue.value, unit: "amount", helperText: `${data.summary.revenue.change}% vs previous` },
      { label: "Invoices", value: data.summary.invoices.value, helperText: `${data.summary.invoices.change}% vs previous` },
      { label: "Customers", value: data.summary.customers.value, helperText: `${data.summary.customers.change}% vs previous` },
      { label: "Appointments", value: data.summary.appointments.value, helperText: `${data.summary.appointments.change}% vs previous` },
      { label: "Services delivered", value: data.summary.servicesDelivered.value },
    ],
    tables: [
      {
        title: "Top services",
        columns: [
          { key: "serviceName", title: "Service" },
          { key: "revenue", title: "Revenue" },
          { key: "bookings", title: "Bookings" },
          { key: "contributionPct", title: "Contribution %" },
        ],
        rows: limitRows(data.topServices, 8),
      },
    ],
    recommendations: data.insights.map((insight) => ({
      title: insight.title,
      message: insight.detail,
      sourceTools: ["get_business_health_snapshot"],
    })),
  };
}

async function getServiceBehavior(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await getServiceBehaviorReport({
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    granularity: "month",
  });

  return {
    toolName: "get_service_behavior",
    sourceName: "BigQuery service behavior report",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: data.summary.totalBookings > 0 ? "ok" : "no_activity",
    live: false,
    metrics: [
      { label: "Total bookings", value: data.summary.totalBookings },
      { label: "Distinct services", value: data.summary.distinctServices },
      { label: "Avg bookings/service", value: data.summary.avgBookingsPerService },
    ],
    tables: [
      {
        title: "Top services by bookings",
        columns: [
          { key: "serviceName", title: "Service" },
          { key: "bookingCount", title: "Bookings" },
        ],
        rows: limitRows(data.topServices, 20),
      },
      {
        title: "Practitioner service mix",
        columns: [
          { key: "practitionerName", title: "Practitioner" },
          { key: "serviceName", title: "Service" },
          { key: "bookingCount", title: "Bookings" },
        ],
        rows: limitRows(data.practitionerServices, 20),
      },
    ],
    entityRefs: data.topServices.map((row, index) => ({
      entityType: "service",
      entityId: row.serviceName,
      displayName: row.serviceName,
      serviceName: row.serviceName,
      rank: index + 1,
    })),
  };
}

async function getServiceOverview(input: AgentToolInput): Promise<AgentToolResult> {
  const serviceName = input.entityContext?.serviceName ?? input.entityContext?.displayName;

  if (serviceName) {
    const data = await getServicePortalOverview({
      clinicCode: input.clinic.clinicCode,
      fromDate: input.period.fromDate,
      toDate: input.period.toDate,
      serviceName,
    });

    return {
      toolName: "get_service_overview",
      sourceName: "BigQuery service portal",
      checkedAt: nowIso(),
      period: periodLabel(input),
      dataStatus: "ok",
      live: false,
      summary: `${data.service.serviceName} is ${data.service.status.toLowerCase()} with ${data.service.bookingCount.toLocaleString("en-US")} bookings.`,
      metrics: [
        { label: "Revenue", value: data.service.totalRevenue, unit: "amount" },
        { label: "Bookings", value: data.service.bookingCount },
        { label: "Customers", value: data.service.customerCount },
        { label: "Growth", value: data.service.growthRate, unit: "%" },
      ],
    };
  }

  const snapshot = await getExactProfileSnapshot(input, "service_profiles");
  if (snapshot) {
    return buildServiceProfileSnapshotResult(input, snapshot);
  }

  const list = await runBusinessBigQueryOperation({
    toolName: "get_service_overview",
    operationName: "snapshot_fallback",
    callback: () =>
      getServicePortalList({
        clinicCode: input.clinic.clinicCode,
        fromDate: input.period.fromDate,
        toDate: input.period.toDate,
        search: "",
        serviceCategory: "",
        sortBy: "totalRevenue",
        sortDirection: "desc",
      }),
  });

  return {
    toolName: "get_service_overview",
    sourceName: "BigQuery service portal",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: list.rows.length ? "ok" : "no_activity",
    live: false,
    metrics: [
      { label: "Services", value: list.summary.serviceCount },
      { label: "Revenue", value: list.summary.totalRevenue, unit: "amount" },
      { label: "Bookings", value: list.summary.totalBookings },
      { label: "Customers", value: list.summary.totalCustomers },
    ],
    tables: [
      {
        title: "Service performance",
        columns: [
          { key: "serviceName", title: "Service" },
          { key: "totalRevenue", title: "Revenue" },
          { key: "bookingCount", title: "Bookings" },
          { key: "growthRate", title: "Growth %" },
        ],
        rows: limitRows(list.rows, 20),
      },
    ],
    entityRefs: list.rows.map((row, index) => ({
      entityType: "service",
      entityId: row.serviceName,
      displayName: row.serviceName,
      serviceName: row.serviceName,
      rank: index + 1,
    })),
  };
}

async function getPractitionerOverview(input: AgentToolInput): Promise<AgentToolResult> {
  const snapshot = await getExactProfileSnapshot(input, "practitioner_profiles");
  if (snapshot && !input.entityContext?.practitionerName && !input.entityContext?.displayName) {
    return buildPractitionerProfileSnapshotResult(input, snapshot);
  }

  const data = await runBusinessBigQueryOperation({
    toolName: "get_practitioner_overview",
    operationName: "snapshot_fallback",
    callback: () =>
      getTherapistPortalReport({
        clinicCode: input.clinic.clinicCode,
        fromDate: input.period.fromDate,
        toDate: input.period.toDate,
        search: input.entityContext?.practitionerName ?? input.entityContext?.displayName ?? "",
        serviceCategory: "",
        sortBy: "treatmentsCompleted",
        sortDirection: "desc",
      }),
  });

  return {
    toolName: "get_practitioner_overview",
    sourceName: "BigQuery practitioner portal",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: data.leaderboard.length ? "ok" : "no_activity",
    live: false,
    summary: data.highlight
      ? `${data.highlight.therapistName} leads volume with ${data.highlight.treatmentsCompleted.toLocaleString("en-US")} treatments.`
      : "No practitioner activity was found for this period.",
    metrics: [
      { label: "Active practitioners", value: data.summary.activeTherapists },
      { label: "Treatments", value: data.summary.totalTreatments },
      { label: "Customers served", value: data.summary.customersServed },
      { label: "Average utilization", value: data.summary.averageUtilizationScore },
    ],
    tables: [
      {
        title: "Practitioner performance",
        columns: [
          { key: "therapistName", title: "Practitioner" },
          { key: "treatmentsCompleted", title: "Treatments" },
          { key: "customersServed", title: "Customers" },
          { key: "topService", title: "Top service" },
          { key: "utilizationScore", title: "Utilization" },
        ],
        rows: limitRows(data.leaderboard, 20),
      },
    ],
    entityRefs: data.leaderboard.map((row, index) => ({
      entityType: "practitioner",
      entityId: row.therapistName,
      displayName: row.therapistName,
      practitionerName: row.therapistName,
      rank: index + 1,
    })),
  };
}

async function getDailyTreatments(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await getDailyTreatmentReport({
    clinicCode: input.clinic.clinicCode,
    date: input.period.toDate,
  });

  return {
    toolName: "get_daily_treatments",
    sourceName: "BigQuery daily treatment report",
    checkedAt: nowIso(),
    period: data.selectedDate,
    dataStatus: data.summary.totalTreatments > 0 ? "ok" : "no_activity",
    live: false,
    metrics: [
      { label: "Treatments", value: data.summary.totalTreatments },
      { label: "Practitioners", value: data.summary.therapists },
      { label: "Services", value: data.summary.uniqueServices },
    ],
    tables: [
      {
        title: "Daily treatment records",
        columns: [
          { key: "checkInTime", title: "Time" },
          { key: "therapistName", title: "Practitioner" },
          { key: "serviceName", title: "Service" },
          { key: "customerName", title: "Customer" },
        ],
        rows: limitRows(data.records, 25),
      },
    ],
  };
}

async function getOwnerDailyBrief(input: AgentToolInput): Promise<AgentToolResult> {
  const period = selectOwnerDailyBriefPeriod(input);
  const briefDate = period.fromDate === period.toDate ? period.toDate : selectOwnerDailyBriefDate(input);
  const shouldLoadDailySnapshots = isCompletedHistoricalDay({
    fromDate: period.fromDate,
    toDate: period.toDate,
    timezone: period.timezone,
  });
  const today = formatDateKeyInTimeZone(new Date(), period.timezone);

  if (!env.AGENT_SNAPSHOT_CACHE_ENABLED) {
    return buildOwnerDailyBriefFromSnapshots({
      input,
      briefDate,
      period,
      financeSnapshot: null,
      appointmentSnapshot: null,
      operationalSnapshot: null,
      serviceSnapshot: null,
      practitionerSnapshot: null,
      insightCards: [],
    });
  }

  const [financeSnapshot, appointmentSnapshot, operationalSnapshot, serviceSnapshot, practitionerSnapshot, insightCards] = await Promise.all([
    shouldLoadDailySnapshots
      ? getFactSnapshotForPeriod({
          clinicId: input.clinic.clinicId,
          snapshotType: "finance_daily_snapshot",
          fromDate: period.fromDate,
          toDate: period.toDate,
          maxAgeMs: env.AGENT_SNAPSHOT_MAX_AGE_MINUTES * 60_000,
        }).catch(() => null)
      : Promise.resolve(null),
    shouldLoadDailySnapshots
      ? getFactSnapshotForPeriod({
          clinicId: input.clinic.clinicId,
          snapshotType: "appointment_daily_profile",
          fromDate: period.fromDate,
          toDate: period.toDate,
          maxAgeMs: env.AGENT_SNAPSHOT_MAX_AGE_MINUTES * 60_000,
        }).catch(() => null)
      : Promise.resolve(null),
    getFreshFactSnapshot({
      clinicId: input.clinic.clinicId,
      snapshotType: "appointment_operational_snapshot",
      expectedFromDate: today,
      expectedToDate: today,
      maxAgeMs: env.AGENT_OPERATIONAL_SNAPSHOT_MAX_AGE_MINUTES * 60_000,
    }).catch(() => null),
    getFreshFactSnapshot({
      clinicId: input.clinic.clinicId,
      snapshotType: "service_profiles",
      maxAgeMs: env.AGENT_SNAPSHOT_MAX_AGE_MINUTES * 60_000,
    }).catch(() => null),
    getFreshFactSnapshot({
      clinicId: input.clinic.clinicId,
      snapshotType: "practitioner_profiles",
      maxAgeMs: env.AGENT_SNAPSHOT_MAX_AGE_MINUTES * 60_000,
    }).catch(() => null),
    listInsightCards({ clinicId: input.clinic.clinicId, limit: 6 })
      .then((cards) => cards.filter((card) => ["new", "viewed", "accepted"].includes(card.status)).slice(0, 6))
      .catch(() => []),
  ]);

  return buildOwnerDailyBriefFromSnapshots({
    input,
    briefDate,
    period,
    financeSnapshot,
    appointmentSnapshot,
    operationalSnapshot,
    serviceSnapshot,
    practitionerSnapshot,
    insightCards,
  });
}

export function createBusinessTools(): AgentToolDefinition[] {
  const tools: AgentToolDefinition[] = [
    {
      name: "get_owner_daily_brief",
      agentId: "business",
      description: "Build a fast owner daily brief from source-backed snapshots.",
      inputSchema: toolInputSchema,
      sourceName: "GreatTime owner daily brief snapshots",
      live: false,
      maxRows: 25,
      timeoutMs: 3_000,
      execute: getOwnerDailyBrief,
    },
    {
      name: "get_service_360",
      agentId: "business",
      description: "Build a one-shot Service 360 fact pack for a named service.",
      inputSchema: toolInputSchema,
      sourceName: "Service 360 fact pack",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: buildService360ToolResult,
    },
    {
      name: "get_service_behavior",
      agentId: "business",
      description: "Get historical service behavior.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery service behavior report",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getServiceBehavior,
    },
    {
      name: "get_service_overview",
      agentId: "business",
      description: "Get service portal overview or ranked services.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery service portal",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getServiceOverview,
    },
    {
      name: "get_service_customers",
      agentId: "business",
      description: "Get customers for a service.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery service portal",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getServiceOverview,
    },
    {
      name: "get_service_payments",
      agentId: "business",
      description: "Get payments for a service.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery service portal",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getServiceOverview,
    },
    {
      name: "get_practitioner_overview",
      agentId: "business",
      description: "Get practitioner performance overview.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery practitioner portal",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getPractitionerOverview,
    },
    {
      name: "get_practitioner_customers",
      agentId: "business",
      description: "Get practitioner customer relationships.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery practitioner portal",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getPractitionerOverview,
    },
    {
      name: "get_practitioner_treatments",
      agentId: "business",
      description: "Get practitioner treatments.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery practitioner portal",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getPractitionerOverview,
    },
    {
      name: "get_daily_treatments",
      agentId: "business",
      description: "Get daily treatment activity.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery daily treatment report",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getDailyTreatments,
    },
    {
      name: "compare_service_periods",
      agentId: "business",
      description: "Compare service periods.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery service portal",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getServiceOverview,
    },
    {
      name: "get_business_health_snapshot",
      agentId: "business",
      description: "Get overall clinic trends.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery dashboard overview",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getBusinessHealthSnapshot,
    },
  ];

  return tools.map((tool) => ({ ...tool, capability: "read_only" }));
}
