import { createHash } from "node:crypto";
import { env } from "../../config/env.js";
import { runWithAnalyticsQueryContext } from "../analytics-query-context.js";
import { formatDateKeyInTimeZone, formatTimeKeyInTimeZone, normalizeTimeZone } from "../telegram/time.js";
import { getPaymentReport } from "../reports/payment-report.service.js";
import { getSalesReport } from "../reports/sales-report.service.js";
import { runCustomerRelationshipLearning } from "../reports/customer-relationship-learning.service.js";
import { getServiceBehaviorReport } from "../reports/service-behavior.service.js";
import { getTherapistPortalReport } from "../reports/therapist-portal.service.js";
import { searchCustomerRelationshipProfiles } from "../reports/customer-relationship-profile.repository.js";
import { fetchLiveAppointmentSnapshot, isCountableTodayAppointment } from "./appointment-live.service.js";
import {
  AI_REVENUE_GENERATE_TODAY_OPPORTUNITIES_JOB,
  runScheduledAiRevenueGeneration,
} from "../ai-revenue-agent/scheduled-generation.service.js";
import { listUnprocessedAgentFeedback, markAgentFeedbackProcessed } from "./feedback.repository.js";
import {
  acquireAgentLearningLock,
  getAgentLearningWatermark,
  listAgentLearningSchedules,
  saveAgentLearningRun,
  saveAgentLearningWatermark,
  type AgentLearningJobType,
  type AgentLearningRunCounts,
  type AgentLearningScheduleRecord,
} from "./learning.repository.js";
import { learnMemoriesFromFeedbackEvents } from "./memory/memory-writer.js";
import {
  archiveExpiredMemories,
  getInsightCardById,
  listRecentRecommendationOutcomes,
  saveFactSnapshot,
  saveInsightCard,
  saveLatestFactSnapshot,
} from "./memory/memory.repository.js";
import type { AgentDataStatus } from "./types.js";

export const DEFAULT_JOB_TYPES: AgentLearningJobType[] = [
  "customer_profiles",
  "finance_daily_snapshot",
  "service_profiles",
  "practitioner_profiles",
  "appointment_operational_snapshot",
  "appointment_daily_profile",
  "feedback_learning",
  "recommendation_outcome_observer",
  "owner_insight_cards",
  "weekly_business_review",
  "memory_maintenance",
  AI_REVENUE_GENERATE_TODAY_OPPORTUNITIES_JOB,
];

type AgentLearningJobOutcome = {
  rowCount: number;
  counts: AgentLearningRunCounts;
  sourceWatermark: string;
  dataStatus?: AgentDataStatus;
};

const DAILY_JOBS = new Set<AgentLearningJobType>([
  "customer_profiles",
  "finance_daily_snapshot",
  "service_profiles",
  "practitioner_profiles",
  "service_practitioner_profiles",
  "appointment_daily_profile",
  "owner_insight_cards",
  AI_REVENUE_GENERATE_TODAY_OPPORTUNITIES_JOB,
]);
const HOURLY_JOBS = new Set<AgentLearningJobType>(["feedback_learning", "recommendation_outcome_observer"]);
const WEEKLY_JOBS = new Set<AgentLearningJobType>(["weekly_business_review", "memory_maintenance"]);
const SCHEDULER_TICK_WINDOW_MINUTES = 15;

const DEFAULT_DAILY_RUN_TIMES: Partial<Record<AgentLearningJobType, string>> = {
  appointment_daily_profile: "01:00",
  finance_daily_snapshot: "01:15",
  customer_profiles: "02:00",
  service_profiles: "02:15",
  practitioner_profiles: "02:30",
  service_practitioner_profiles: "02:45",
  owner_insight_cards: "08:00",
  [AI_REVENUE_GENERATE_TODAY_OPPORTUNITIES_JOB]: "06:00",
};

const DEFAULT_WEEKLY_RUNS: Partial<Record<AgentLearningJobType, { day: number; time: string }>> = {
  weekly_business_review: { day: 1, time: "08:00" },
  memory_maintenance: { day: 0, time: "03:00" },
};

function emptyCounts(overrides?: Partial<AgentLearningRunCounts>): AgentLearningRunCounts {
  return {
    scanned: overrides?.scanned ?? 0,
    created: overrides?.created ?? 0,
    updated: overrides?.updated ?? 0,
    skipped: overrides?.skipped ?? 0,
    failed: overrides?.failed ?? 0,
  };
}

function stableId(prefix: string, parts: string[]) {
  return `${prefix}_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24)}`;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function previousDateKey(dateKey: string) {
  return addDays(dateKey, -1);
}

function nextExpiry(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export function buildLearningBucket(params: {
  jobType: AgentLearningJobType;
  now?: Date;
  timezone?: string;
  operationalIntervalMinutes?: 15 | 30 | 60;
  dateKey?: string;
  timeKey?: string;
}) {
  const now = params.now ?? new Date();
  const timezone = normalizeTimeZone(params.timezone || env.DEFAULT_TIMEZONE);
  const dateKey = params.dateKey ?? formatDateKeyInTimeZone(now, timezone);
  const timeKey = params.timeKey ?? formatTimeKeyInTimeZone(now, timezone);
  const [hour, minute] = timeKey.split(":").map(Number);

  if (params.jobType === "appointment_operational_snapshot") {
    const interval = params.operationalIntervalMinutes ?? 15;
    const bucketMinute = Math.floor(minute / interval) * interval;
    return `${dateKey}T${String(hour).padStart(2, "0")}:${String(bucketMinute).padStart(2, "0")}+${timezone}`;
  }

  if (HOURLY_JOBS.has(params.jobType)) {
    return `${dateKey}T${String(hour).padStart(2, "0")}:00+${timezone}`;
  }

  if (params.jobType === "weekly_business_review") {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    const diff = date.getUTCDay() === 0 ? -6 : 1 - date.getUTCDay();
    date.setUTCDate(date.getUTCDate() + diff);
    return `${date.toISOString().slice(0, 10)}+${timezone}`;
  }

  return `${dateKey}+${timezone}`;
}

function localScheduleParts(now: Date, timezone: string) {
  const normalized = normalizeTimeZone(timezone);
  const dateKey = formatDateKeyInTimeZone(now, normalized);
  const timeKey = formatTimeKeyInTimeZone(now, normalized);
  const [hour, minute] = timeKey.split(":").map(Number);
  const day = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();

  return { dateKey, timeKey, hour, minute, day };
}

function minutesSinceMidnight(timeKey: string) {
  const [hour, minute] = timeKey.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  return hour * 60 + minute;
}

function isWithinCadenceWindow(timeKey: string, targetTimeKey: string, windowMinutes = SCHEDULER_TICK_WINDOW_MINUTES) {
  const current = minutesSinceMidnight(timeKey);
  const target = minutesSinceMidnight(targetTimeKey);

  if (current == null || target == null) {
    return false;
  }

  return current >= target && current < target + windowMinutes;
}

function parseCadenceOverride(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["off", "disabled", "manual"].includes(normalized)) {
    return { kind: "off" as const };
  }

  const hourlyMatch = normalized.match(/^hourly(?:@(?<minute>\d{1,2}))?$/);
  if (hourlyMatch) {
    const minute = Math.min(59, Math.max(0, Number(hourlyMatch.groups?.minute ?? 0)));
    return { kind: "hourly" as const, minute };
  }

  const dailyMatch = normalized.match(/^(?:daily|nightly)(?:@(?<time>\d{2}:\d{2}))?$/);
  if (dailyMatch) {
    return { kind: "daily" as const, time: dailyMatch.groups?.time ?? "02:00" };
  }

  const weeklyMatch = normalized.match(/^weekly(?:@(?:(?<day>[0-6]|sun|mon|tue|wed|thu|fri|sat):)?(?<time>\d{2}:\d{2}))?$/);
  if (weeklyMatch) {
    const dayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const rawDay = weeklyMatch.groups?.day;
    const day = rawDay == null ? 1 : dayMap[rawDay] ?? Number(rawDay);
    return { kind: "weekly" as const, day, time: weeklyMatch.groups?.time ?? "08:00" };
  }

  return null;
}

function isWithinOperatingHours(schedule: AgentLearningScheduleRecord, now: Date) {
  const timezone = normalizeTimeZone(schedule.timezone);
  const { timeKey, day } = localScheduleParts(now, timezone);
  const operatingDays = schedule.operatingDays?.length ? schedule.operatingDays : [0, 1, 2, 3, 4, 5, 6];
  const opening = schedule.localOpeningTime ?? "00:00";
  const closing = schedule.localClosingTime ?? "23:59";

  return operatingDays.includes(day) && timeKey >= opening && timeKey <= closing;
}

function isOperationalCadenceDue(schedule: AgentLearningScheduleRecord, now: Date) {
  const interval = schedule.operationalSnapshotIntervalMinutes ?? 15;
  const { minute } = localScheduleParts(now, schedule.timezone);
  const schedulerBucketMinute = Math.floor(minute / SCHEDULER_TICK_WINDOW_MINUTES) * SCHEDULER_TICK_WINDOW_MINUTES;

  return schedulerBucketMinute % interval === 0;
}

function isDefaultCadenceDue(params: {
  schedule: AgentLearningScheduleRecord;
  jobType: AgentLearningJobType;
  now: Date;
}) {
  const parts = localScheduleParts(params.now, params.schedule.timezone);
  const override = parseCadenceOverride(params.schedule.cadenceOverrides?.[params.jobType]);

  if (override?.kind === "off") {
    return false;
  }

  if (override?.kind === "hourly") {
    return parts.minute >= override.minute && parts.minute < override.minute + SCHEDULER_TICK_WINDOW_MINUTES;
  }

  if (override?.kind === "daily") {
    return isWithinCadenceWindow(parts.timeKey, override.time);
  }

  if (override?.kind === "weekly") {
    return parts.day === override.day && isWithinCadenceWindow(parts.timeKey, override.time);
  }

  if (HOURLY_JOBS.has(params.jobType)) {
    return parts.minute < SCHEDULER_TICK_WINDOW_MINUTES;
  }

  if (DAILY_JOBS.has(params.jobType)) {
    return isWithinCadenceWindow(parts.timeKey, DEFAULT_DAILY_RUN_TIMES[params.jobType] ?? "02:00");
  }

  if (WEEKLY_JOBS.has(params.jobType)) {
    const cadence = DEFAULT_WEEKLY_RUNS[params.jobType] ?? { day: 1, time: "08:00" };
    return parts.day === cadence.day && isWithinCadenceWindow(parts.timeKey, cadence.time);
  }

  return false;
}

export function isScheduleDueForJob(params: {
  schedule: AgentLearningScheduleRecord;
  jobType: AgentLearningJobType;
  now?: Date;
}) {
  if (!params.schedule.enabled || !params.schedule.enabledJobTypes.includes(params.jobType)) {
    return false;
  }

  if (params.jobType === "appointment_operational_snapshot") {
    const now = params.now ?? new Date();
    const allowedHours = isWithinOperatingHours(params.schedule, now) || Boolean(params.schedule.offHoursOperationalSnapshotEnabled);
    return allowedHours && isOperationalCadenceDue(params.schedule, now);
  }

  return isDefaultCadenceDue({
    schedule: params.schedule,
    jobType: params.jobType,
    now: params.now ?? new Date(),
  });
}

async function saveSnapshot(params: {
  clinicId: string;
  clinicCode: string;
  snapshotType: string;
  bucket: string;
  source: string;
  checkedAt: string;
  dataStatus: AgentDataStatus;
  dateRange?: { fromDate: string; toDate: string; timezone?: string };
  summary: Record<string, unknown>;
  ttlHours?: number;
}) {
  const snapshot = {
    id: stableId("fact", [params.clinicId, params.snapshotType, params.bucket]),
    clinicId: params.clinicId,
    clinicCode: params.clinicCode,
    snapshotType: params.snapshotType,
    bucket: params.bucket,
    source: params.source,
    checkedAt: params.checkedAt,
    dataStatus: params.dataStatus,
    dateRange: params.dateRange,
    summary: params.summary,
    expiresAt: params.ttlHours ? nextExpiry(params.ttlHours) : null,
  };

  await Promise.all([saveFactSnapshot(snapshot), saveLatestFactSnapshot(snapshot)]);
}

async function runFeedbackLearningJob(params: { clinicId: string }): Promise<AgentLearningJobOutcome> {
  if (!env.AGENT_MEMORY_V2_ENABLED) {
    return {
      rowCount: 0,
      counts: emptyCounts({ skipped: 1 }),
      sourceWatermark: new Date().toISOString(),
      dataStatus: "not_ready",
    };
  }

  const feedbackEvents = await listUnprocessedAgentFeedback({ clinicId: params.clinicId, limit: 100 });
  const learned = await learnMemoriesFromFeedbackEvents(feedbackEvents);
  await markAgentFeedbackProcessed({
    feedbackIds: feedbackEvents.map((event) => event.id),
  });

  return {
    rowCount: feedbackEvents.length,
    counts: emptyCounts({
      scanned: feedbackEvents.length,
      created: learned.length,
      skipped: feedbackEvents.length - learned.length,
    }),
    sourceWatermark: feedbackEvents.at(-1)?.createdAt ?? new Date().toISOString(),
  };
}

async function runOwnerInsightCardsJob(params: {
  clinicId: string;
  clinicCode: string;
  bucket: string;
}): Promise<AgentLearningJobOutcome> {
  const result = await searchCustomerRelationshipProfiles({
    clinicId: params.clinicId,
    segment: "unused_package_balance",
    sortBy: "priorityScore",
    sortDirection: "desc",
    limit: 10,
    offset: 0,
  });
  const checkedAt = new Date().toISOString();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const profile of result.rows.filter((row) => row.remainingPackageSessions > 0).slice(0, 5)) {
    const dedupeKey = `unused_package_recovery:${profile.customerKey}`;
    const id = stableId("card", [params.clinicId, dedupeKey]);
    const existing = await getInsightCardById(id);

    if (
      existing &&
      ["dismissed", "remind_later", "done"].includes(existing.status) &&
      new Date(existing.expiresAt).getTime() > Date.now()
    ) {
      skipped += 1;
      continue;
    }

    await saveInsightCard({
      id,
      clinicId: params.clinicId,
      dedupeKey,
      type: "unused_package_recovery",
      impactArea: "customer_growth",
      title: "Unused package recovery opportunity",
      summary: `${profile.customerName} has ${profile.remainingPackageSessions} unused package session(s).`,
      basePriorityScore: Math.min(100, Math.max(30, profile.priorityScore)),
      personalizedPriorityScore: Math.min(100, Math.max(30, profile.priorityScore + 8)),
      evidenceRefs: [`customerRelationshipProfiles:${profile.customerKey}`],
      sourceTools: ["customer_profiles"],
      checkedAt,
      expiresAt: nextExpiry(7 * 24),
      status: existing?.status === "viewed" ? "viewed" : "new",
      verificationNeeded: true,
      createdAt: existing?.createdAt ?? checkedAt,
      updatedAt: checkedAt,
    });

    if (existing) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  return {
    rowCount: result.rows.length,
    counts: emptyCounts({ scanned: result.rows.length, created, updated, skipped }),
    sourceWatermark: checkedAt,
  };
}

async function runRecommendationOutcomeObserverJob(params: {
  clinicId: string;
  clinicCode: string;
  bucket: string;
  dateKey: string;
  timezone: string;
}): Promise<AgentLearningJobOutcome> {
  const observedSince = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const outcomes = await listRecentRecommendationOutcomes({
    clinicId: params.clinicId,
    since: observedSince,
    limit: 500,
  });
  const stateCounts = outcomes.reduce<Record<string, number>>((counts, outcome) => {
    counts[outcome.state] = (counts[outcome.state] ?? 0) + 1;
    return counts;
  }, {});
  const observedConversions = outcomes.filter((outcome) => ["booked", "paid", "visited"].includes(outcome.state)).length;
  const checkedAt = new Date().toISOString();

  await saveSnapshot({
    clinicId: params.clinicId,
    clinicCode: params.clinicCode,
    snapshotType: "recommendation_outcome_observer",
    bucket: params.bucket,
    source: "GT Agent recommendation outcome records",
    checkedAt,
    dataStatus: "ok",
    dateRange: {
      fromDate: observedSince.toISOString().slice(0, 10),
      toDate: params.dateKey,
      timezone: params.timezone,
    },
    summary: {
      totalOutcomes: outcomes.length,
      observedConversions,
      stateCounts,
      observationWindowDays: 30,
      note: "Outcome records are operational signals. They are not model retraining or source-system revenue attribution.",
    },
  });

  return {
    rowCount: outcomes.length,
    counts: emptyCounts({ scanned: outcomes.length, created: 1 }),
    sourceWatermark: outcomes[0]?.updatedAt ?? checkedAt,
  };
}

async function runMemoryMaintenanceJob(params: { clinicId: string }): Promise<AgentLearningJobOutcome> {
  if (!env.AGENT_MEMORY_V2_ENABLED) {
    return {
      rowCount: 0,
      counts: emptyCounts({ skipped: 1 }),
      sourceWatermark: new Date().toISOString(),
      dataStatus: "not_ready",
    };
  }

  const archived = await archiveExpiredMemories({ clinicId: params.clinicId });
  return {
    rowCount: archived,
    counts: emptyCounts({ scanned: archived, updated: archived }),
    sourceWatermark: new Date().toISOString(),
  };
}

async function runJob(params: {
  clinicId: string;
  clinicCode: string;
  jobType: AgentLearningJobType;
  dateKey: string;
  bucket: string;
  timezone: string;
}): Promise<AgentLearningJobOutcome> {
  switch (params.jobType) {
    case "customer_profiles": {
      const summary = await runCustomerRelationshipLearning({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        lookbackDays: Number(env.AGENT_LEARNING_DEFAULT_LOOKBACK_DAYS),
        snapshotDate: params.dateKey,
      });
      return {
        rowCount: summary.profilesSaved,
        counts: emptyCounts({
          scanned: summary.totalCustomersAnalyzed,
          created: summary.profilesSaved,
        }),
        sourceWatermark: summary.learnedAt,
      };
    }
    case "finance_daily_snapshot": {
      const [sales, payments] = await Promise.all([
        getSalesReport({
          clinicCode: params.clinicCode,
          fromDate: params.dateKey,
          toDate: params.dateKey,
          search: "",
          limit: 1,
          offset: 0,
        }),
        getPaymentReport({
          clinicId: params.clinicId,
          clinicCode: params.clinicCode,
          fromDate: params.dateKey,
          toDate: params.dateKey,
          search: "",
          paymentMethod: "",
          includeZeroValues: false,
          limit: 1,
          offset: 0,
        }),
      ]);
      const checkedAt = new Date().toISOString();
      await saveSnapshot({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        snapshotType: "finance_daily_snapshot",
        bucket: params.bucket,
        source: "BigQuery sales and payment reports",
        checkedAt,
        dataStatus: "ok",
        dateRange: { fromDate: params.dateKey, toDate: params.dateKey, timezone: params.timezone },
        summary: {
          sales: sales.summary,
          payments: payments.summary,
          paymentMethodCount: payments.methods.length,
        },
      });
      return {
        rowCount: sales.summary.invoiceCount + payments.methods.length,
        counts: emptyCounts({
          scanned: sales.summary.invoiceCount + payments.methods.length,
          created: 1,
        }),
        sourceWatermark: params.dateKey,
      };
    }
    case "service_practitioner_profiles":
    case "service_profiles": {
      const service = await getServiceBehaviorReport({
        clinicCode: params.clinicCode,
        fromDate: previousDateKey(params.dateKey),
        toDate: params.dateKey,
        granularity: "month",
      });
      const checkedAt = new Date().toISOString();
      await saveSnapshot({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        snapshotType: "service_profiles",
        bucket: params.bucket,
        source: "BigQuery service behavior report",
        checkedAt,
        dataStatus: "ok",
        dateRange: {
          fromDate: previousDateKey(params.dateKey),
          toDate: params.dateKey,
          timezone: params.timezone,
        },
        summary: {
          summary: service.summary,
          topServiceCount: service.topServices.length,
        },
      });
      return {
        rowCount: service.topServices.length,
        counts: emptyCounts({ scanned: service.topServices.length, created: 1 }),
        sourceWatermark: params.dateKey,
      };
    }
    case "practitioner_profiles": {
      const practitioner = await getTherapistPortalReport({
        clinicCode: params.clinicCode,
        fromDate: previousDateKey(params.dateKey),
        toDate: params.dateKey,
        search: "",
        serviceCategory: "",
        sortBy: "treatmentsCompleted",
        sortDirection: "desc",
      });
      const checkedAt = new Date().toISOString();
      await saveSnapshot({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        snapshotType: "practitioner_profiles",
        bucket: params.bucket,
        source: "BigQuery therapist portal report",
        checkedAt,
        dataStatus: "ok",
        dateRange: {
          fromDate: previousDateKey(params.dateKey),
          toDate: params.dateKey,
          timezone: params.timezone,
        },
        summary: {
          summary: practitioner.summary,
          leaderboardCount: practitioner.leaderboard.length,
        },
      });
      return {
        rowCount: practitioner.leaderboard.length,
        counts: emptyCounts({ scanned: practitioner.leaderboard.length, created: 1 }),
        sourceWatermark: params.dateKey,
      };
    }
    case "appointment_operational_snapshot": {
      const snapshot = await fetchLiveAppointmentSnapshot({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        dateKey: params.dateKey,
        timezone: params.timezone,
      });
      const bookingRows = snapshot.rows.filter((row) => row.sourceType !== "check_in");
      const checkInRows = snapshot.rows.filter((row) => row.sourceType !== "booking");
      await saveSnapshot({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        snapshotType: "appointment_operational_snapshot",
        bucket: params.bucket,
        source: "APICORE live appointment snapshot",
        checkedAt: snapshot.checkedAt,
        dataStatus: snapshot.dataStatus,
        dateRange: { fromDate: params.dateKey, toDate: params.dateKey, timezone: params.timezone },
        summary: {
          rowCount: snapshot.rows.length,
          bookingAppointmentCount: bookingRows.filter(isCountableTodayAppointment).length,
          bookingRowCount: bookingRows.length,
          checkInRowCount: checkInRows.length,
          lifecycleCounts: snapshot.countsByLifecycle,
        },
        ttlHours: 1,
      });
      return {
        rowCount: snapshot.rows.length,
        counts: emptyCounts({ scanned: snapshot.rows.length, created: 1 }),
        sourceWatermark: snapshot.checkedAt,
      };
    }
    case "appointment_daily_profile": {
      const settledDateKey = previousDateKey(params.dateKey);
      const snapshot = await fetchLiveAppointmentSnapshot({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        dateKey: settledDateKey,
        timezone: params.timezone,
      });
      const bookingRows = snapshot.rows.filter((row) => row.sourceType !== "check_in");
      const checkInRows = snapshot.rows.filter((row) => row.sourceType !== "booking");
      await saveSnapshot({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        snapshotType: "appointment_daily_profile",
        bucket: params.bucket,
        source: "APICORE daily appointment aggregate",
        checkedAt: snapshot.checkedAt,
        dataStatus: snapshot.dataStatus,
        dateRange: { fromDate: settledDateKey, toDate: settledDateKey, timezone: params.timezone },
        summary: {
          rowCount: snapshot.rows.length,
          bookingAppointmentCount: bookingRows.filter(isCountableTodayAppointment).length,
          bookingRowCount: bookingRows.length,
          checkInRowCount: checkInRows.length,
          lifecycleCounts: snapshot.countsByLifecycle,
        },
      });
      return {
        rowCount: snapshot.rows.length,
        counts: emptyCounts({ scanned: snapshot.rows.length, created: 1 }),
        sourceWatermark: snapshot.checkedAt,
      };
    }
    case "feedback_learning":
      return runFeedbackLearningJob({ clinicId: params.clinicId });
    case "owner_insight_cards":
      return runOwnerInsightCardsJob({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        bucket: params.bucket,
      });
    case "recommendation_outcome_observer":
      return runRecommendationOutcomeObserverJob({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        bucket: params.bucket,
        dateKey: params.dateKey,
        timezone: params.timezone,
      });
    case "memory_maintenance":
      return runMemoryMaintenanceJob({ clinicId: params.clinicId });
    case "weekly_business_review":
      return {
        rowCount: 0,
        counts: emptyCounts({ skipped: 1 }),
        sourceWatermark: params.dateKey,
        dataStatus: "not_ready",
      };
    default:
      return {
        rowCount: 0,
        counts: emptyCounts({ skipped: 1 }),
        sourceWatermark: params.dateKey,
        dataStatus: "not_ready",
      };
  }
}

async function runClinicJobs(params: {
  clinicId: string;
  clinicCode?: string;
  timezone: string;
  jobTypes: AgentLearningJobType[];
  dateKey: string;
  dryRun: boolean;
  operationalIntervalMinutes?: 15 | 30 | 60;
  now?: Date;
}) {
  const results: Array<{
    clinicId: string;
    jobType: AgentLearningJobType;
    status: "completed" | "skipped" | "failed";
    rowCount: number;
  }> = [];

  for (const jobType of params.jobTypes) {
    const bucket = buildLearningBucket({
      jobType,
      now: params.now,
      timezone: params.timezone,
      operationalIntervalMinutes: params.operationalIntervalMinutes,
      dateKey: params.dateKey,
    });

    if (!params.clinicCode) {
      await saveAgentLearningRun({
        clinicId: params.clinicId,
        jobType,
        bucket,
        status: "skipped",
        rowCount: 0,
        counts: emptyCounts({ skipped: 1 }),
        error: "Missing clinicCode for scheduled job.",
      });
      results.push({ clinicId: params.clinicId, jobType, status: "skipped", rowCount: 0 });
      continue;
    }
    const clinicCode = params.clinicCode;

    if (params.dryRun) {
      results.push({ clinicId: params.clinicId, jobType, status: "skipped", rowCount: 0 });
      continue;
    }

    const acquired = await acquireAgentLearningLock({ clinicId: params.clinicId, jobType, bucket });
    if (!acquired) {
      results.push({ clinicId: params.clinicId, jobType, status: "skipped", rowCount: 0 });
      continue;
    }

    await saveAgentLearningRun({
      clinicId: params.clinicId,
      clinicCode: params.clinicCode,
      jobType,
      bucket,
      status: "started",
    });

    try {
      const previousWatermark = await getAgentLearningWatermark({
        clinicId: params.clinicId,
        jobType,
      });
      if (previousWatermark.completedBucket === bucket) {
        await saveAgentLearningRun({
          clinicId: params.clinicId,
          clinicCode: params.clinicCode,
          jobType,
          bucket,
          status: "skipped",
          rowCount: 0,
          counts: emptyCounts({ skipped: 1 }),
          sourceWatermark: previousWatermark.sourceWatermark,
        });
        results.push({ clinicId: params.clinicId, jobType, status: "skipped", rowCount: 0 });
        continue;
      }

      const outcome = await runWithAnalyticsQueryContext(
        {
          queryNamePrefix: `learning.${jobType}.generate`,
          labels: {
            app: "greattime",
            feature: "agent_learning",
            job: jobType,
            operation: "generate",
          },
          // Learning jobs write durable snapshots, so they should stay close to source truth.
          ttlMs: 0,
          forceRefresh: true,
          useQueryCache: false,
        },
        () =>
          runJob({
            clinicId: params.clinicId,
            clinicCode,
            jobType,
            dateKey: params.dateKey,
            bucket,
            timezone: params.timezone,
          }),
      );
      await saveAgentLearningWatermark({
        clinicId: params.clinicId,
        jobType,
        bucket,
        sourceWatermark: outcome.sourceWatermark,
      });
      await saveAgentLearningRun({
        clinicId: params.clinicId,
        clinicCode,
        jobType,
        bucket,
        status: "completed",
        rowCount: outcome.rowCount,
        counts: outcome.counts,
        sourceWatermark: outcome.sourceWatermark,
      });
      results.push({ clinicId: params.clinicId, jobType, status: "completed", rowCount: outcome.rowCount });
    } catch (error) {
      await saveAgentLearningRun({
        clinicId: params.clinicId,
        clinicCode,
        jobType,
        bucket,
        status: "failed",
        rowCount: 0,
        counts: emptyCounts({ failed: 1 }),
        error,
      });
      results.push({ clinicId: params.clinicId, jobType, status: "failed", rowCount: 0 });
    }
  }

  return results;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let index = 0;

  async function runNext() {
    const currentIndex = index;
    index += 1;

    if (currentIndex >= items.length) {
      return;
    }

    results[currentIndex] = await worker(items[currentIndex]);
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runNext));
  return results;
}

type RunAgentLearningForSchedulesDependencies = {
  listSchedules: typeof listAgentLearningSchedules;
  runAiRevenueGeneration: typeof runScheduledAiRevenueGeneration;
};

const defaultScheduleRunnerDependencies: RunAgentLearningForSchedulesDependencies = {
  listSchedules: listAgentLearningSchedules,
  runAiRevenueGeneration: runScheduledAiRevenueGeneration,
};

export function shouldRunAiRevenueGenerationForScheduledJobs(jobTypes?: AgentLearningJobType[]) {
  const requestedJobTypes = jobTypes?.length ? jobTypes : null;
  return requestedJobTypes
    ? requestedJobTypes.includes(AI_REVENUE_GENERATE_TODAY_OPPORTUNITIES_JOB)
    : true;
}

export async function runAgentLearningTick(params: {
  clinicIds?: string[];
  clinicCodesById?: Record<string, string>;
  jobTypes?: AgentLearningJobType[];
  dateKey?: string;
  now?: Date;
  timezone?: string;
  dryRun?: boolean;
  operationalIntervalMinutes?: 15 | 30 | 60;
}) {
  const jobTypes = params.jobTypes?.length ? params.jobTypes : DEFAULT_JOB_TYPES;
  const shouldRunAiRevenueGeneration = jobTypes.includes(AI_REVENUE_GENERATE_TODAY_OPPORTUNITIES_JOB);
  if (!env.AGENT_LEARNING_ENABLED && !shouldRunAiRevenueGeneration) {
    return {
      enabled: false,
      results: [],
    };
  }

  const timezone = normalizeTimeZone(params.timezone || env.DEFAULT_TIMEZONE);
  const now = params.now ?? new Date();
  const dateKey = params.dateKey ?? formatDateKeyInTimeZone(now, timezone);
  const clinicJobTypes = jobTypes.filter((jobType) => jobType !== AI_REVENUE_GENERATE_TODAY_OPPORTUNITIES_JOB);
  const clinicIds = env.AGENT_LEARNING_ENABLED ? params.clinicIds ?? Object.keys(params.clinicCodesById ?? {}) : [];
  const perClinicResults = env.AGENT_LEARNING_ENABLED
    ? await mapWithConcurrency(
        clinicIds,
        env.AGENT_LEARNING_MAX_CLINIC_CONCURRENCY,
        (clinicId) =>
          runClinicJobs({
            clinicId,
            clinicCode: params.clinicCodesById?.[clinicId],
            timezone,
            jobTypes: clinicJobTypes,
            dateKey,
            dryRun: Boolean(params.dryRun),
            operationalIntervalMinutes: params.operationalIntervalMinutes,
            now,
          }),
      )
    : [];
  const aiRevenue = shouldRunAiRevenueGeneration
    ? await runScheduledAiRevenueGeneration({
        now,
        dateKey: params.dateKey,
        timezone,
        dryRun: params.dryRun,
      })
    : null;

  return {
    enabled: env.AGENT_LEARNING_ENABLED || Boolean(aiRevenue),
    dryRun: Boolean(params.dryRun),
    results: perClinicResults.flat(),
    aiRevenue,
    ...(aiRevenue
      ? {
          totalClinics: aiRevenue.totalClinics,
          processedClinics: aiRevenue.processedClinics,
          skippedClinics: aiRevenue.skippedClinics,
          failedClinics: aiRevenue.failedClinics,
          totalCreated: aiRevenue.totalCreated,
          totalDuplicateSkipped: aiRevenue.totalDuplicateSkipped,
          totalSuppressedSkipped: aiRevenue.totalSuppressedSkipped,
        }
      : {}),
  };
}

export async function runAgentLearningForSchedules(params?: {
  clinicIds?: string[];
  jobTypes?: AgentLearningJobType[];
  dryRun?: boolean;
  now?: Date;
}, dependencies: RunAgentLearningForSchedulesDependencies = defaultScheduleRunnerDependencies) {
  const shouldRunAiRevenueGeneration = shouldRunAiRevenueGenerationForScheduledJobs(params?.jobTypes);
  if (!env.AGENT_LEARNING_ENABLED && !shouldRunAiRevenueGeneration) {
    return {
      enabled: false,
      schedules: 0,
      results: [],
    };
  }

  const now = params?.now ?? new Date();
  const schedules = env.AGENT_LEARNING_ENABLED
    ? await dependencies.listSchedules({ clinicIds: params?.clinicIds })
    : [];
  const requestedJobTypes = params?.jobTypes?.length ? params.jobTypes : null;
  const perScheduleResults = env.AGENT_LEARNING_ENABLED
    ? await mapWithConcurrency(schedules, env.AGENT_LEARNING_MAX_CLINIC_CONCURRENCY, async (schedule) => {
    const jobTypes = (requestedJobTypes ?? schedule.enabledJobTypes)
      .filter((jobType) => jobType !== AI_REVENUE_GENERATE_TODAY_OPPORTUNITIES_JOB)
      .filter((jobType) => isScheduleDueForJob({ schedule, jobType, now }));

    if (jobTypes.length === 0) {
      return [];
    }

    const dateKey = formatDateKeyInTimeZone(now, schedule.timezone);
    return runClinicJobs({
      clinicId: schedule.clinicId,
      clinicCode: schedule.clinicCode,
      timezone: schedule.timezone,
      jobTypes,
      dateKey,
      dryRun: Boolean(params?.dryRun),
      operationalIntervalMinutes: schedule.operationalSnapshotIntervalMinutes ?? 15,
      now,
    });
      })
    : [];
  const aiRevenue = shouldRunAiRevenueGeneration
    ? await dependencies.runAiRevenueGeneration({
        now,
        dryRun: params?.dryRun,
      })
    : null;

  return {
    enabled: env.AGENT_LEARNING_ENABLED || Boolean(aiRevenue),
    dryRun: Boolean(params?.dryRun),
    schedules: schedules.length,
    results: perScheduleResults.flat(),
    aiRevenue,
    ...(aiRevenue
      ? {
          totalClinics: aiRevenue.totalClinics,
          processedClinics: aiRevenue.processedClinics,
          skippedClinics: aiRevenue.skippedClinics,
          failedClinics: aiRevenue.failedClinics,
          totalCreated: aiRevenue.totalCreated,
          totalDuplicateSkipped: aiRevenue.totalDuplicateSkipped,
          totalSuppressedSkipped: aiRevenue.totalSuppressedSkipped,
        }
      : {}),
  };
}
