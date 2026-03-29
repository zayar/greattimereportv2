import type { ChurnRiskLevel, RebookingStatus } from "./schemas.js";

export type CustomerRiskInput = {
  totalVisits: number;
  daysSinceLastVisit: number | null;
  avgVisitGapDays: number | null;
  remainingSessions: number;
  recent3MonthVisits: number;
  previous3MonthVisits: number;
};

export type CustomerRiskSignals = {
  daysSinceLastVisit: number | null;
  avgVisitGapDays: number | null;
  expectedReturnGapDays: number | null;
  dueSoonThresholdDays: number | null;
  overdueThresholdDays: number | null;
  overdueDays: number;
  packageRisk: "healthy" | "lowBalance" | "noActivePackage";
  frequencyTrend: "improving" | "steady" | "declining" | "unknown";
  healthScore: number;
  churnRiskLevel: ChurnRiskLevel;
  rebookingStatus: RebookingStatus;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundWhole(value: number) {
  return Math.round(value);
}

export function calculateCustomerRiskSignals(input: CustomerRiskInput): CustomerRiskSignals {
  const avgVisitGapDays =
    input.avgVisitGapDays != null && input.avgVisitGapDays > 0 ? roundWhole(input.avgVisitGapDays) : null;
  const daysSinceLastVisit =
    input.daysSinceLastVisit != null && input.daysSinceLastVisit >= 0
      ? roundWhole(input.daysSinceLastVisit)
      : null;

  const expectedReturnGapDays =
    avgVisitGapDays != null
      ? avgVisitGapDays
      : input.totalVisits >= 4
        ? 45
        : input.totalVisits >= 2
          ? 30
          : null;

  // These thresholds are intentionally explicit and conservative for Phase 1 so they are easy
  // to tune later against real clinic retention behavior.
  const dueSoonThresholdDays =
    expectedReturnGapDays != null ? Math.max(7, roundWhole(expectedReturnGapDays * 0.85)) : 21;
  const overdueThresholdDays =
    expectedReturnGapDays != null ? Math.max(14, roundWhole(expectedReturnGapDays * 1.15)) : 45;

  let rebookingStatus: RebookingStatus = "unknown";
  if (daysSinceLastVisit != null) {
    if (daysSinceLastVisit >= overdueThresholdDays) {
      rebookingStatus = "overdue";
    } else if (daysSinceLastVisit >= dueSoonThresholdDays) {
      rebookingStatus = "dueSoon";
    } else {
      rebookingStatus = "onTrack";
    }
  }

  const overdueDays =
    daysSinceLastVisit != null ? Math.max(0, daysSinceLastVisit - overdueThresholdDays) : 0;

  const frequencyTrend =
    input.previous3MonthVisits > 0
      ? input.recent3MonthVisits > input.previous3MonthVisits
        ? "improving"
        : input.recent3MonthVisits < input.previous3MonthVisits
          ? "declining"
          : "steady"
      : input.recent3MonthVisits > 0
        ? "steady"
        : "unknown";

  const packageRisk =
    input.remainingSessions > 3
      ? "healthy"
      : input.remainingSessions > 0
        ? "lowBalance"
        : "noActivePackage";

  let healthScore = 82;

  if (rebookingStatus === "overdue") {
    healthScore -= 28;
  } else if (rebookingStatus === "dueSoon") {
    healthScore -= 12;
  } else if (rebookingStatus === "unknown") {
    healthScore -= 10;
  }

  if (daysSinceLastVisit != null && daysSinceLastVisit >= 90) {
    healthScore -= 18;
  } else if (daysSinceLastVisit != null && daysSinceLastVisit >= 60) {
    healthScore -= 10;
  }

  if (packageRisk === "lowBalance") {
    healthScore -= 6;
  } else if (packageRisk === "noActivePackage" && rebookingStatus !== "onTrack") {
    healthScore -= 10;
  } else if (packageRisk === "healthy") {
    healthScore += 6;
  }

  if (frequencyTrend === "declining") {
    healthScore -= 14;
  } else if (frequencyTrend === "improving") {
    healthScore += 8;
  }

  if (input.totalVisits >= 6) {
    healthScore += 4;
  } else if (input.totalVisits <= 1) {
    healthScore -= 8;
  }

  if (input.recent3MonthVisits === 0 && input.previous3MonthVisits > 0) {
    healthScore -= 8;
  }

  healthScore = clamp(roundWhole(healthScore), 0, 100);

  const churnRiskLevel: ChurnRiskLevel =
    healthScore <= 39 || overdueDays >= 30
      ? "high"
      : healthScore <= 69 || rebookingStatus === "overdue" || frequencyTrend === "declining"
        ? "medium"
        : "low";

  return {
    daysSinceLastVisit,
    avgVisitGapDays,
    expectedReturnGapDays,
    dueSoonThresholdDays: daysSinceLastVisit == null ? null : dueSoonThresholdDays,
    overdueThresholdDays: daysSinceLastVisit == null ? null : overdueThresholdDays,
    overdueDays,
    packageRisk,
    frequencyTrend,
    healthScore,
    churnRiskLevel,
    rebookingStatus,
  };
}
