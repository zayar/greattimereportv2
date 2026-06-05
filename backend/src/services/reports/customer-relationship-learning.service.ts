import { createHash } from "node:crypto";
import { analyticsTables } from "../../config/bigquery.js";
import { runAnalyticsQuery } from "../bigquery.service.js";
import { calculateCustomerRiskSignals } from "../ai/customer-risk.service.js";
import type {
  CustomerRelationshipLearningSummary,
  CustomerRelationshipProfile,
  CustomerRelationshipRiskLevel,
  CustomerRelationshipSegment,
} from "../ai/customer-relationship-schemas.js";
import {
  saveCustomerRelationshipLearningRun,
  saveCustomerRelationshipProfiles,
} from "./customer-relationship-profile.repository.js";

export type CustomerRelationshipLearningRow = {
  customerName: string | null;
  phoneNumber: string | null;
  memberId: string | null;
  firstSeenDate: string | null;
  lastVisitDate: string | null;
  daysSinceLastVisit: number | null;
  lastPaymentDate: string | null;
  lastPackagePurchaseDate: string | null;
  totalVisits: number | string | null;
  lifetimeSpend: number | string | null;
  averageSpend: number | string | null;
  recent90DayVisits: number | string | null;
  previous90DayVisits: number | string | null;
  avgVisitGapDays: number | string | null;
  preferredService: string | null;
  preferredServiceCategory: string | null;
  preferredTherapist: string | null;
  preferredDayOfWeek: string | null;
  preferredHour: number | string | null;
  lastService: string | null;
  lastPaymentMethod: string | null;
  packagePurchaseCount: number | string | null;
  activePackageCount: number | string | null;
  totalPackageSessions: number | string | null;
  remainingPackageSessions: number | string | null;
  visitsAfterLastPackagePurchase: number | string | null;
};

function parseNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (value && typeof value === "object" && "value" in value) {
    return Number((value as { value: unknown }).value ?? 0);
  }

  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNullableNumber(value: unknown) {
  if (value == null) {
    return null;
  }
  const parsed = parseNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePhoneDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function normalizeName(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function maskPhone(value: string | null | undefined) {
  const digits = normalizePhoneDigits(value);
  if (!digits) {
    return "";
  }

  if (digits.length <= 4) {
    return "*".repeat(digits.length);
  }

  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function buildCustomerKey(params: {
  clinicId: string;
  phoneNumber: string | null | undefined;
  customerName: string | null | undefined;
}) {
  const digits = normalizePhoneDigits(params.phoneNumber);
  if (digits) {
    return hashValue(`${params.clinicId}:phone:${digits}`).slice(0, 32);
  }

  return hashValue(`${params.clinicId}:name:${normalizeName(params.customerName)}`).slice(0, 32);
}

function buildServiceCategoryExpression(serviceField: string, packageField: string) {
  return `
    CASE
      WHEN REGEXP_CONTAINS(
        LOWER(CONCAT(COALESCE(${serviceField}, ''), ' ', COALESCE(${packageField}, ''))),
        r'laser|fractional|ipl|hifu|ultraformer|hair removal|lhr|co2|revlite'
      ) THEN 'Laser'
      WHEN REGEXP_CONTAINS(
        LOWER(CONCAT(COALESCE(${serviceField}, ''), ' ', COALESCE(${packageField}, ''))),
        r'facial|hydra|hydro|skin|peel|aqua|bright|rejuv|glow|oxygen|cleanup|whitening|micro'
      ) THEN 'Facial'
      WHEN REGEXP_CONTAINS(
        LOWER(CONCAT(COALESCE(${serviceField}, ''), ' ', COALESCE(${packageField}, ''))),
        r'botox|filler|meso|inject|toxin|thread|prp|rejuran|profhilo|collagen stim'
      ) THEN 'Injectables'
      WHEN REGEXP_CONTAINS(
        LOWER(CONCAT(COALESCE(${serviceField}, ''), ' ', COALESCE(${packageField}, ''))),
        r'body|slim|fat|contour|cellulite|cool|emsculpt|shape|underarm|bikini|thigh'
      ) THEN 'Body'
      WHEN REGEXP_CONTAINS(
        LOWER(CONCAT(COALESCE(${serviceField}, ''), ' ', COALESCE(${packageField}, ''))),
        r'hair|scalp'
      ) THEN 'Hair'
      WHEN REGEXP_CONTAINS(
        LOWER(CONCAT(COALESCE(${serviceField}, ''), ' ', COALESCE(${packageField}, ''))),
        r'wellness|vitamin|therapy|drip|massage|lymph'
      ) THEN 'Wellness'
      ELSE 'Other'
    END
  `;
}

function buildLearningQuery() {
  return `
    WITH
      DistinctVisits AS (
        SELECT
          CustomerName AS customerName,
          CustomerPhoneNumber AS phoneNumber,
          COALESCE(CAST(CustomerID AS STRING), '') AS memberId,
          COALESCE(
            CAST(BookingID AS STRING),
            CONCAT(FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', CheckInTime), '-', COALESCE(ServiceName, ''))
          ) AS visitKey,
          MAX(CheckInTime) AS checkInTime,
          MAX(CheckOutTime) AS checkOutTime,
          ARRAY_AGG(COALESCE(ServiceName, '') IGNORE NULLS ORDER BY CheckInTime DESC LIMIT 1)[SAFE_OFFSET(0)] AS serviceName,
          ARRAY_AGG(COALESCE(PractitionerName, 'Unknown') IGNORE NULLS ORDER BY CheckInTime DESC LIMIT 1)[SAFE_OFFSET(0)] AS practitionerName,
          MAX(CAST(COALESCE(Price, 0) AS FLOAT64)) AS price,
          MAX(CAST(COALESCE(PackageCount, 0) AS INT64)) AS packageCount,
          MAX(CAST(COALESCE(RemainingPackageCount, 0) AS INT64)) AS remainingPackageCount,
          ARRAY_AGG(
            ${buildServiceCategoryExpression("ServiceName", "CAST(NULL AS STRING)")}
            ORDER BY CheckInTime DESC
            LIMIT 1
          )[SAFE_OFFSET(0)] AS serviceCategory
        FROM ${analyticsTables.mainDataView}
        WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
          AND CustomerName IS NOT NULL
          AND CheckInTime IS NOT NULL
          AND DATE(CheckInTime) >= DATE_SUB(CURRENT_DATE(), INTERVAL @lookbackDays DAY)
        GROUP BY customerName, phoneNumber, memberId, visitKey
      ),
      InvoiceLevelPayments AS (
        SELECT
          CustomerName AS customerName,
          CustomerPhoneNumber AS phoneNumber,
          MAX(COALESCE(MemberID, '')) AS memberId,
          InvoiceNumber AS invoiceNumber,
          MAX(OrderCreatedDate) AS orderCreatedDate,
          MAX(COALESCE(PaymentMethod, 'Unknown')) AS paymentMethod,
          MAX(CAST(COALESCE(NetTotal, Total, 0) AS FLOAT64)) AS invoiceNetTotal,
          ARRAY_AGG(ServicePackageName IGNORE NULLS ORDER BY ServicePackageName ASC LIMIT 1)[SAFE_OFFSET(0)] AS servicePackageName,
          ARRAY_AGG(COALESCE(ServiceName, '') IGNORE NULLS ORDER BY ServiceName ASC LIMIT 1)[SAFE_OFFSET(0)] AS serviceName,
          ARRAY_AGG(
            ${buildServiceCategoryExpression("ServiceName", "ServicePackageName")}
            ORDER BY ServiceName ASC
            LIMIT 1
          )[SAFE_OFFSET(0)] AS serviceCategory
        FROM ${analyticsTables.mainPaymentView}
        WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
          AND CustomerName IS NOT NULL
          AND PaymentStatus = 'PAID'
          AND NOT STARTS_WITH(InvoiceNumber, 'CO-')
          AND COALESCE(PaymentMethod, '') != 'PASS'
          AND DATE(OrderCreatedDate) >= DATE_SUB(CURRENT_DATE(), INTERVAL @lookbackDays DAY)
        GROUP BY customerName, phoneNumber, invoiceNumber
      ),
      VisitSummary AS (
        SELECT
          customerName,
          phoneNumber,
          MAX(memberId) AS memberId,
          MIN(DATE(checkInTime)) AS firstSeenDate,
          MAX(DATE(COALESCE(checkOutTime, checkInTime))) AS lastVisitDate,
          COUNT(*) AS totalVisits,
          COUNTIF(DATE(checkInTime) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) AND CURRENT_DATE()) AS recent90DayVisits,
          COUNTIF(DATE(checkInTime) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 91 DAY)) AS previous90DayVisits,
          ARRAY_AGG(serviceName ORDER BY checkInTime DESC LIMIT 1)[SAFE_OFFSET(0)] AS lastService
        FROM DistinctVisits
        GROUP BY customerName, phoneNumber
      ),
      VisitIntervals AS (
        SELECT
          customerName,
          phoneNumber,
          DATE_DIFF(DATE(checkInTime), DATE(previousCheckInTime), DAY) AS gapDays
        FROM (
          SELECT
            customerName,
            phoneNumber,
            checkInTime,
            LAG(checkInTime) OVER (PARTITION BY customerName, phoneNumber ORDER BY checkInTime) AS previousCheckInTime
          FROM DistinctVisits
        )
        WHERE previousCheckInTime IS NOT NULL
      ),
      IntervalSummary AS (
        SELECT
          customerName,
          phoneNumber,
          ROUND(AVG(gapDays), 1) AS avgVisitGapDays
        FROM VisitIntervals
        GROUP BY customerName, phoneNumber
      ),
      PreferredService AS (
        SELECT customerName, phoneNumber, serviceName, serviceCategory
        FROM (
          SELECT
            customerName,
            phoneNumber,
            serviceName,
            serviceCategory,
            COUNT(*) AS usageCount,
            MAX(checkInTime) AS latestVisitDate,
            ROW_NUMBER() OVER (
              PARTITION BY customerName, phoneNumber
              ORDER BY COUNT(*) DESC, MAX(checkInTime) DESC, serviceName ASC
            ) AS rowNum
          FROM DistinctVisits
          WHERE COALESCE(serviceName, '') != ''
          GROUP BY customerName, phoneNumber, serviceName, serviceCategory
        )
        WHERE rowNum = 1
      ),
      PreferredTherapist AS (
        SELECT customerName, phoneNumber, practitionerName
        FROM (
          SELECT
            customerName,
            phoneNumber,
            practitionerName,
            COUNT(*) AS usageCount,
            MAX(checkInTime) AS latestVisitDate,
            ROW_NUMBER() OVER (
              PARTITION BY customerName, phoneNumber
              ORDER BY COUNT(*) DESC, MAX(checkInTime) DESC, practitionerName ASC
            ) AS rowNum
          FROM DistinctVisits
          WHERE COALESCE(practitionerName, '') != ''
          GROUP BY customerName, phoneNumber, practitionerName
        )
        WHERE rowNum = 1
      ),
      PreferredTime AS (
        SELECT customerName, phoneNumber, dayOfWeek, visitHour
        FROM (
          SELECT
            customerName,
            phoneNumber,
            FORMAT_DATE('%A', DATE(checkInTime)) AS dayOfWeek,
            EXTRACT(HOUR FROM checkInTime) AS visitHour,
            COUNT(*) AS usageCount,
            MAX(checkInTime) AS latestVisitDate,
            ROW_NUMBER() OVER (
              PARTITION BY customerName, phoneNumber
              ORDER BY COUNT(*) DESC, MAX(checkInTime) DESC
            ) AS rowNum
          FROM DistinctVisits
          GROUP BY customerName, phoneNumber, dayOfWeek, visitHour
        )
        WHERE rowNum = 1
      ),
      PackageSummary AS (
        SELECT
          customerName,
          phoneNumber,
          COUNTIF(remainingPackageCount > 0) AS activePackageCount,
          SUM(GREATEST(packageCount, 0)) AS totalPackageSessions,
          SUM(GREATEST(remainingPackageCount, 0)) AS remainingPackageSessions
        FROM DistinctVisits
        GROUP BY customerName, phoneNumber
      ),
      PaymentSummary AS (
        SELECT
          customerName,
          phoneNumber,
          MAX(memberId) AS memberId,
          MAX(DATE(orderCreatedDate)) AS lastPaymentDate,
          SUM(invoiceNetTotal) AS lifetimeSpend,
          SAFE_DIVIDE(SUM(invoiceNetTotal), COUNT(*)) AS averageSpend,
          ARRAY_AGG(paymentMethod ORDER BY orderCreatedDate DESC LIMIT 1)[SAFE_OFFSET(0)] AS lastPaymentMethod,
          COUNTIF(COALESCE(servicePackageName, '') != '') AS packagePurchaseCount,
          MAX(IF(COALESCE(servicePackageName, '') != '', DATE(orderCreatedDate), NULL)) AS lastPackagePurchaseDate
        FROM InvoiceLevelPayments
        GROUP BY customerName, phoneNumber
      ),
      ScopedCustomers AS (
        SELECT customerName, phoneNumber FROM VisitSummary
        UNION DISTINCT
        SELECT customerName, phoneNumber FROM PaymentSummary
      )
    SELECT
      scoped.customerName,
      scoped.phoneNumber,
      COALESCE(payment.memberId, visit.memberId, '') AS memberId,
      FORMAT_DATE('%Y-%m-%d', visit.firstSeenDate) AS firstSeenDate,
      FORMAT_DATE('%Y-%m-%d', visit.lastVisitDate) AS lastVisitDate,
      CASE
        WHEN visit.lastVisitDate IS NULL THEN NULL
        ELSE DATE_DIFF(CURRENT_DATE(), visit.lastVisitDate, DAY)
      END AS daysSinceLastVisit,
      FORMAT_DATE('%Y-%m-%d', payment.lastPaymentDate) AS lastPaymentDate,
      FORMAT_DATE('%Y-%m-%d', payment.lastPackagePurchaseDate) AS lastPackagePurchaseDate,
      COALESCE(visit.totalVisits, 0) AS totalVisits,
      COALESCE(payment.lifetimeSpend, 0) AS lifetimeSpend,
      COALESCE(payment.averageSpend, 0) AS averageSpend,
      COALESCE(visit.recent90DayVisits, 0) AS recent90DayVisits,
      COALESCE(visit.previous90DayVisits, 0) AS previous90DayVisits,
      intervals.avgVisitGapDays,
      preferredService.serviceName AS preferredService,
      preferredService.serviceCategory AS preferredServiceCategory,
      preferredTherapist.practitionerName AS preferredTherapist,
      preferredTime.dayOfWeek AS preferredDayOfWeek,
      preferredTime.visitHour AS preferredHour,
      visit.lastService,
      COALESCE(payment.lastPaymentMethod, 'Unknown') AS lastPaymentMethod,
      COALESCE(payment.packagePurchaseCount, 0) AS packagePurchaseCount,
      COALESCE(packageSummary.activePackageCount, 0) AS activePackageCount,
      COALESCE(packageSummary.totalPackageSessions, 0) AS totalPackageSessions,
      COALESCE(packageSummary.remainingPackageSessions, 0) AS remainingPackageSessions,
      (
        SELECT COUNT(*)
        FROM DistinctVisits visitAfterPackage
        WHERE visitAfterPackage.customerName = scoped.customerName
          AND COALESCE(visitAfterPackage.phoneNumber, '') = COALESCE(scoped.phoneNumber, '')
          AND payment.lastPackagePurchaseDate IS NOT NULL
          AND DATE(visitAfterPackage.checkInTime) > payment.lastPackagePurchaseDate
      ) AS visitsAfterLastPackagePurchase
    FROM ScopedCustomers scoped
    LEFT JOIN VisitSummary visit USING (customerName, phoneNumber)
    LEFT JOIN PaymentSummary payment USING (customerName, phoneNumber)
    LEFT JOIN IntervalSummary intervals USING (customerName, phoneNumber)
    LEFT JOIN PreferredService preferredService USING (customerName, phoneNumber)
    LEFT JOIN PreferredTherapist preferredTherapist USING (customerName, phoneNumber)
    LEFT JOIN PreferredTime preferredTime USING (customerName, phoneNumber)
    LEFT JOIN PackageSummary packageSummary USING (customerName, phoneNumber)
    WHERE scoped.customerName IS NOT NULL
    ORDER BY COALESCE(payment.lifetimeSpend, 0) DESC, scoped.customerName ASC
  `;
}

function buildNextBestAction(input: {
  segments: CustomerRelationshipSegment[];
  remainingPackageSessions: number;
  daysSinceLastVisit: number | null;
  preferredServiceCategory: string | null;
}) {
  if (input.segments.includes("package_bought_never_came")) {
    return "Call or message with a soft package reminder and help book the first usage visit.";
  }

  if (input.segments.includes("package_bought_not_used")) {
    return "Explain the unused package benefit and offer an easy booking time.";
  }

  if (input.segments.includes("unused_package_balance")) {
    return `Remind the customer about ${input.remainingPackageSessions} remaining package session${input.remainingPackageSessions === 1 ? "" : "s"}.`;
  }

  if (input.segments.includes("inactive_vip") || input.segments.includes("high_value_no_recent_visit")) {
    return "Handle as a high-value retention follow-up from the owner or senior team.";
  }

  if (input.segments.includes("treatment_due") || input.segments.includes("overdue_customer")) {
    return "Send a gentle return-visit reminder based on their usual visit pattern.";
  }

  if (input.preferredServiceCategory && input.preferredServiceCategory !== "Other") {
    return `Suggest a follow-up around ${input.preferredServiceCategory.toLowerCase()} care.`;
  }

  return "Keep this customer in the regular follow-up review list.";
}

function buildSegments(input: {
  packagePurchaseCount: number;
  totalVisits: number;
  visitsAfterLastPackagePurchase: number;
  totalPackageSessions: number;
  remainingPackageSessions: number;
  usedPackageSessions: number;
  daysSinceLastVisit: number | null;
  lifetimeSpend: number;
  vipSpendThreshold: number;
  riskLevel: CustomerRelationshipRiskLevel;
  rebookingStatus: "onTrack" | "dueSoon" | "overdue" | "unknown";
  recent90DayVisits: number;
  previous90DayVisits: number;
}) {
  const segments: CustomerRelationshipSegment[] = [];

  if (input.packagePurchaseCount > 0 && input.visitsAfterLastPackagePurchase === 0) {
    segments.push("package_bought_never_came");
  }

  if (
    input.packagePurchaseCount > 0 &&
    (input.usedPackageSessions === 0 || input.visitsAfterLastPackagePurchase === 0)
  ) {
    segments.push("package_bought_not_used");
  }

  if (input.remainingPackageSessions > 0) {
    segments.push("unused_package_balance");
  }

  if (input.lifetimeSpend >= input.vipSpendThreshold && (input.daysSinceLastVisit ?? 0) >= 60) {
    segments.push("inactive_vip");
  }

  if (input.rebookingStatus === "dueSoon") {
    segments.push("treatment_due");
  }

  if (input.rebookingStatus === "overdue") {
    segments.push("overdue_customer");
  }

  if (input.lifetimeSpend >= input.vipSpendThreshold && (input.daysSinceLastVisit ?? 0) >= 45) {
    segments.push("high_value_no_recent_visit");
  }

  if (input.totalVisits === 1 && (input.daysSinceLastVisit ?? 0) >= 30) {
    segments.push("new_customer_no_second_visit");
  }

  if (input.previous90DayVisits > 0 && input.recent90DayVisits < input.previous90DayVisits) {
    segments.push("declining_frequency");
  }

  if (input.lifetimeSpend >= input.vipSpendThreshold && input.riskLevel === "low" && input.totalVisits >= 4) {
    segments.push("loyal_vip");
  }

  if (segments.length === 0 || (input.riskLevel === "low" && input.rebookingStatus === "onTrack")) {
    segments.push("healthy_active_customer");
  }

  return [...new Set(segments)];
}

function buildReasons(input: {
  packagePurchaseCount: number;
  packageBoughtNeverCame: boolean;
  packageBoughtButNoUsage: boolean;
  remainingPackageSessions: number;
  daysSinceLastVisit: number | null;
  lifetimeSpend: number;
  riskLevel: CustomerRelationshipRiskLevel;
  rebookingStatus: string;
  recent90DayVisits: number;
  previous90DayVisits: number;
}) {
  const reasons: string[] = [];

  if (input.packageBoughtNeverCame) {
    reasons.push("Package purchase found, but no visit after package purchase.");
  }

  if (input.packageBoughtButNoUsage) {
    reasons.push("Package usage appears to be zero or cannot be confirmed from package usage visits.");
  }

  if (input.remainingPackageSessions > 0) {
    reasons.push(`${input.remainingPackageSessions} package session${input.remainingPackageSessions === 1 ? "" : "s"} remain.`);
  }

  if (input.daysSinceLastVisit != null) {
    reasons.push(`Last visit was ${input.daysSinceLastVisit} day${input.daysSinceLastVisit === 1 ? "" : "s"} ago.`);
  }

  if (input.lifetimeSpend > 0) {
    reasons.push(`Lifetime spend is ${Math.round(input.lifetimeSpend).toLocaleString("en-US")} MMK.`);
  }

  if (input.rebookingStatus === "dueSoon" || input.rebookingStatus === "overdue") {
    reasons.push(`Rebooking status is ${input.rebookingStatus}.`);
  }

  if (input.previous90DayVisits > 0 && input.recent90DayVisits < input.previous90DayVisits) {
    reasons.push(`Visits declined from ${input.previous90DayVisits} to ${input.recent90DayVisits} in the 90-day comparison.`);
  }

  if (reasons.length === 0) {
    reasons.push(`Customer relationship health is ${input.riskLevel} risk based on current profile rules.`);
  }

  return reasons.slice(0, 6);
}

function buildPriorityScore(input: {
  riskLevel: CustomerRelationshipRiskLevel;
  segments: CustomerRelationshipSegment[];
  remainingPackageSessions: number;
  lifetimeSpend: number;
  maxLifetimeSpend: number;
  daysSinceLastVisit: number | null;
}) {
  let score = input.riskLevel === "high" ? 68 : input.riskLevel === "medium" ? 45 : 20;

  const segmentWeights: Partial<Record<CustomerRelationshipSegment, number>> = {
    package_bought_never_came: 25,
    package_bought_not_used: 20,
    unused_package_balance: 12,
    inactive_vip: 18,
    high_value_no_recent_visit: 18,
    overdue_customer: 16,
    treatment_due: 10,
    new_customer_no_second_visit: 10,
    declining_frequency: 12,
    loyal_vip: 4,
    healthy_active_customer: -10,
  };

  input.segments.forEach((segment) => {
    score += segmentWeights[segment] ?? 0;
  });

  if (input.maxLifetimeSpend > 0) {
    score += Math.min(12, Math.round((input.lifetimeSpend / input.maxLifetimeSpend) * 12));
  }

  if ((input.daysSinceLastVisit ?? 0) >= 90) {
    score += 8;
  }

  if (input.remainingPackageSessions >= 5) {
    score += 6;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function buildCustomerRelationshipProfilesFromRows(params: {
  clinicId: string;
  clinicCode: string;
  rows: CustomerRelationshipLearningRow[];
  learnedAt: string;
  lookbackDays: number;
}) {
  const spends = params.rows.map((row) => parseNumber(row.lifetimeSpend)).filter((value) => value > 0);
  const sortedSpends = [...spends].sort((left, right) => left - right);
  const p75Index = sortedSpends.length > 0 ? Math.floor((sortedSpends.length - 1) * 0.75) : 0;
  const vipSpendThreshold = Math.max(sortedSpends[p75Index] ?? 0, 500_000);
  const maxLifetimeSpend = Math.max(...spends, 0);

  return params.rows.map((row) => {
    const totalVisits = parseNumber(row.totalVisits);
    const lifetimeSpend = parseNumber(row.lifetimeSpend);
    const averageSpend = parseNumber(row.averageSpend);
    const recent90DayVisits = parseNumber(row.recent90DayVisits);
    const previous90DayVisits = parseNumber(row.previous90DayVisits);
    const totalPackageSessions = parseNumber(row.totalPackageSessions);
    const remainingPackageSessions = parseNumber(row.remainingPackageSessions);
    const usedPackageSessions = Math.max(0, totalPackageSessions - remainingPackageSessions);
    const packagePurchaseCount = parseNumber(row.packagePurchaseCount);
    const activePackageCount = parseNumber(row.activePackageCount);
    const daysSinceLastVisit = parseNullableNumber(row.daysSinceLastVisit);
    const visitsAfterLastPackagePurchase = parseNumber(row.visitsAfterLastPackagePurchase);
    const riskSignals = calculateCustomerRiskSignals({
      totalVisits,
      daysSinceLastVisit,
      avgVisitGapDays: parseNullableNumber(row.avgVisitGapDays),
      remainingSessions: remainingPackageSessions,
      recent3MonthVisits: recent90DayVisits,
      previous3MonthVisits: previous90DayVisits,
    });
    const packageBoughtNeverCame = packagePurchaseCount > 0 && visitsAfterLastPackagePurchase === 0;
    const packageBoughtButNoUsage =
      packagePurchaseCount > 0 && (usedPackageSessions === 0 || visitsAfterLastPackagePurchase === 0);
    const hasUnusedPackageBalance = remainingPackageSessions > 0;
    const segments = buildSegments({
      packagePurchaseCount,
      totalVisits,
      visitsAfterLastPackagePurchase,
      totalPackageSessions,
      remainingPackageSessions,
      usedPackageSessions,
      daysSinceLastVisit,
      lifetimeSpend,
      vipSpendThreshold,
      riskLevel: riskSignals.churnRiskLevel,
      rebookingStatus: riskSignals.rebookingStatus,
      recent90DayVisits,
      previous90DayVisits,
    });
    const reasons = buildReasons({
      packagePurchaseCount,
      packageBoughtNeverCame,
      packageBoughtButNoUsage,
      remainingPackageSessions,
      daysSinceLastVisit,
      lifetimeSpend,
      riskLevel: riskSignals.churnRiskLevel,
      rebookingStatus: riskSignals.rebookingStatus,
      recent90DayVisits,
      previous90DayVisits,
    });
    const priorityScore = buildPriorityScore({
      riskLevel: riskSignals.churnRiskLevel,
      segments,
      remainingPackageSessions,
      lifetimeSpend,
      maxLifetimeSpend,
      daysSinceLastVisit,
    });
    const customerPhoneDigits = normalizePhoneDigits(row.phoneNumber);

    return {
      clinicId: params.clinicId,
      clinicCode: params.clinicCode,
      customerKey: buildCustomerKey({
        clinicId: params.clinicId,
        phoneNumber: row.phoneNumber,
        customerName: row.customerName,
      }),
      customerName: row.customerName?.trim() || "Unknown customer",
      customerPhoneMasked: maskPhone(row.phoneNumber),
      ...(customerPhoneDigits
        ? {
            customerPhoneDigitsHash: hashValue(customerPhoneDigits),
          }
        : {}),
      memberId: row.memberId?.trim() || null,
      firstSeenDate: row.firstSeenDate ?? null,
      lastVisitDate: row.lastVisitDate ?? null,
      daysSinceLastVisit,
      lastPaymentDate: row.lastPaymentDate ?? null,
      lastPackagePurchaseDate: row.lastPackagePurchaseDate ?? null,
      totalVisits,
      lifetimeSpend,
      averageSpend,
      recent90DayVisits,
      previous90DayVisits,
      preferredService: row.preferredService?.trim() || null,
      preferredServiceCategory: row.preferredServiceCategory?.trim() || null,
      preferredTherapist: row.preferredTherapist?.trim() || null,
      preferredDayOfWeek: row.preferredDayOfWeek?.trim() || null,
      preferredHour: parseNullableNumber(row.preferredHour),
      lastService: row.lastService?.trim() || null,
      lastPaymentMethod: row.lastPaymentMethod?.trim() || null,
      packagePurchaseCount,
      activePackageCount,
      totalPackageSessions,
      usedPackageSessions,
      remainingPackageSessions,
      packageBoughtNeverCame,
      packageBoughtButNoUsage,
      hasUnusedPackageBalance,
      relationshipHealthScore: riskSignals.healthScore,
      riskLevel: riskSignals.churnRiskLevel,
      rebookingStatus: riskSignals.rebookingStatus,
      segments,
      reasons,
      nextBestAction: buildNextBestAction({
        segments,
        remainingPackageSessions,
        daysSinceLastVisit,
        preferredServiceCategory: row.preferredServiceCategory,
      }),
      priorityScore,
      lastFollowUpAt: null,
      lastFollowUpOutcome: null,
      followUpCount: 0,
      learnedAt: params.learnedAt,
      sourceLookbackDays: params.lookbackDays,
    } satisfies CustomerRelationshipProfile;
  });
}

function buildLearningSummary(profiles: CustomerRelationshipProfile[], learnedAt: string): CustomerRelationshipLearningSummary {
  const segmentCounts: Record<string, number> = {};

  profiles.forEach((profile) => {
    profile.segments.forEach((segment) => {
      segmentCounts[segment] = (segmentCounts[segment] ?? 0) + 1;
    });
  });

  return {
    learnedAt,
    totalCustomersAnalyzed: profiles.length,
    profilesSaved: profiles.length,
    highRiskCount: profiles.filter((profile) => profile.riskLevel === "high").length,
    mediumRiskCount: profiles.filter((profile) => profile.riskLevel === "medium").length,
    lowRiskCount: profiles.filter((profile) => profile.riskLevel === "low").length,
    segmentCounts,
  };
}

export async function runCustomerRelationshipLearning(params: {
  clinicId: string;
  clinicCode: string;
  lookbackDays?: number;
}) {
  const lookbackDays = Math.min(730, Math.max(30, params.lookbackDays ?? 365));
  const learnedAt = new Date().toISOString();
  const rows = await runAnalyticsQuery<CustomerRelationshipLearningRow>(buildLearningQuery(), {
    clinicCode: params.clinicCode,
    lookbackDays,
  });
  const profiles = buildCustomerRelationshipProfilesFromRows({
    clinicId: params.clinicId,
    clinicCode: params.clinicCode,
    rows,
    learnedAt,
    lookbackDays,
  });
  const summary = buildLearningSummary(profiles, learnedAt);

  await saveCustomerRelationshipProfiles({
    clinicId: params.clinicId,
    profiles,
  });
  await saveCustomerRelationshipLearningRun({
    clinicId: params.clinicId,
    clinicCode: params.clinicCode,
    summary,
    lookbackDays,
  });

  return summary;
}
