export const PACKAGE_PORTAL_THRESHOLDS = {
  newWindowDays: 14,
  inactive30Days: 30,
  inactive60Days: 60,
  inactive90Days: 90,
  nearCompletionUnits: 2,
  atRiskMinRemainingUnits: 4,
  atRiskMinInactiveDays: 60,
} as const;

export type PackageUsageStatus =
  | "new"
  | "in_progress"
  | "near_completion"
  | "completed"
  | "inactive_30"
  | "inactive_60"
  | "inactive_90"
  | "at_risk";

export type InactivityBucket = "0_29" | "30_59" | "60_89" | "90_plus" | "never_used";

function toUtcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function differenceInDays(fromDate: string, toDate: string) {
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = toUtcDate(toDate).getTime() - toUtcDate(fromDate).getTime();
  return Math.max(0, Math.floor(diff / dayMs));
}

export function getInactivityBucket(input: {
  usedUnits: number;
  remainingUnits: number;
  daysSinceActivity: number;
}): InactivityBucket {
  if (input.usedUnits === 0 && input.remainingUnits > 0) {
    return "never_used";
  }

  if (input.daysSinceActivity >= PACKAGE_PORTAL_THRESHOLDS.inactive90Days) {
    return "90_plus";
  }

  if (input.daysSinceActivity >= PACKAGE_PORTAL_THRESHOLDS.inactive60Days) {
    return "60_89";
  }

  if (input.daysSinceActivity >= PACKAGE_PORTAL_THRESHOLDS.inactive30Days) {
    return "30_59";
  }

  return "0_29";
}

export function getPackageUsageStatus(input: {
  usedUnits: number;
  remainingUnits: number;
  daysSinceActivity: number;
}) {
  if (input.remainingUnits <= 0) {
    return "completed" satisfies PackageUsageStatus;
  }

  if (
    input.daysSinceActivity >= PACKAGE_PORTAL_THRESHOLDS.atRiskMinInactiveDays &&
    input.remainingUnits >= PACKAGE_PORTAL_THRESHOLDS.atRiskMinRemainingUnits
  ) {
    return "at_risk" satisfies PackageUsageStatus;
  }

  if (input.daysSinceActivity >= PACKAGE_PORTAL_THRESHOLDS.inactive90Days) {
    return "inactive_90" satisfies PackageUsageStatus;
  }

  if (input.daysSinceActivity >= PACKAGE_PORTAL_THRESHOLDS.inactive60Days) {
    return "inactive_60" satisfies PackageUsageStatus;
  }

  if (input.daysSinceActivity >= PACKAGE_PORTAL_THRESHOLDS.inactive30Days) {
    return "inactive_30" satisfies PackageUsageStatus;
  }

  if (input.usedUnits === 0) {
    return "new" satisfies PackageUsageStatus;
  }

  if (input.remainingUnits <= PACKAGE_PORTAL_THRESHOLDS.nearCompletionUnits) {
    return "near_completion" satisfies PackageUsageStatus;
  }

  return "in_progress" satisfies PackageUsageStatus;
}

export function needsPackageFollowUp(input: {
  remainingUnits: number;
  daysSinceActivity: number;
  status: PackageUsageStatus;
}) {
  return (
    input.remainingUnits > 0 &&
    (input.daysSinceActivity >= PACKAGE_PORTAL_THRESHOLDS.inactive30Days || input.status === "at_risk")
  );
}

export function getPackageStatusPriority(status: PackageUsageStatus) {
  switch (status) {
    case "at_risk":
      return 0;
    case "inactive_90":
      return 1;
    case "inactive_60":
      return 2;
    case "inactive_30":
      return 3;
    case "near_completion":
      return 4;
    case "in_progress":
      return 5;
    case "new":
      return 6;
    case "completed":
      return 7;
    default:
      return 8;
  }
}
