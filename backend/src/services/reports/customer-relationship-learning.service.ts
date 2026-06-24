import { createHash, randomUUID } from "node:crypto";
import { analyticsTables } from "../../config/bigquery.js";
import { env } from "../../config/env.js";
import { runAnalyticsQuery } from "../bigquery.service.js";
import { calculateCustomerRiskSignals } from "../ai/customer-risk.service.js";
import type {
  CustomerRelationshipBalanceStatus,
  CustomerRelationshipDataStatus,
  CustomerRelationshipLearningSummary,
  CustomerRelationshipMatchMethod,
  CustomerRelationshipPackageHolding,
  CustomerRelationshipPackageLifecycle,
  CustomerRelationshipPackagePurchase,
  CustomerRelationshipProfile,
  CustomerRelationshipRiskLevel,
  CustomerRelationshipSegment,
  CustomerRelationshipServiceUsage,
} from "../ai/customer-relationship-schemas.js";
import {
  saveCustomerRelationshipLearningRun,
  saveCustomerRelationshipProfiles,
} from "./customer-relationship-profile.repository.js";

export const CUSTOMER_RELATIONSHIP_DAILY_MEMORY_V2_RULE_VERSION = "customer_relationship_daily_memory_v2.2026-06-24";

export type CustomerRelationshipLearningRow = {
  customerName: string | null;
  phoneNumber: string | null;
  memberId: string | null;
  firstSeenDate: string | null;
  lastVisitDate: string | null;
  daysSinceLastVisit: number | null;
  lastPaymentDate: string | null;
  lastPackagePurchaseDate: string | null;
  lastPackageServiceName: string | null;
  lastPackageName: string | null;
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
  packageHoldingsJson: string | null;
  packagePurchasesJson: string | null;
  serviceUsageJson: string | null;
};

export type CustomerRelationshipPackageDailyMemoryRow = {
  snapshotDate: string;
  learningRunId: string;
  computedAt: string;
  sourceWatermark: string;
  ruleVersion: string;
  clinicId: string;
  clinicCode: string;
  customerKey: string;
  customerName: string;
  customerPhoneMasked: string;
  memberId: string | null;
  customerIdentityConfidence: number;
  purchaseKey: string;
  invoiceNumber: string | null;
  purchaseLineKey: string | null;
  serviceId: string | null;
  serviceName: string;
  packageId: string | null;
  packageName: string | null;
  purchaseDate: string | null;
  purchaseAgeDays: number | null;
  purchasedSessions: number | null;
  usedSessions: number | null;
  remainingSessions: number | null;
  balanceStatus: CustomerRelationshipBalanceStatus;
  firstMatchingUsageDate: string | null;
  lastMatchingUsageDate: string | null;
  lastCustomerVisitDate: string | null;
  daysSinceMatchingUsage: number | null;
  activationStatus: CustomerRelationshipPackageLifecycle["activationStatus"];
  matchMethod: CustomerRelationshipMatchMethod;
  matchConfidence: number;
  dataStatus: CustomerRelationshipDataStatus;
  evidenceReason: string;
};

export type CustomerRelationshipDailyMemoryRow = {
  snapshotDate: string;
  learningRunId: string;
  computedAt: string;
  sourceWatermark: string;
  ruleVersion: string;
  clinicId: string;
  clinicCode: string;
  customerKey: string;
  customerName: string;
  customerPhoneMasked: string;
  memberId: string | null;
  firstVisitDate: string | null;
  lastVisitDate: string | null;
  daysSinceLastVisit: number | null;
  lifetimeSpend: number;
  totalVisits: number;
  recent90DayVisits: number;
  previous90DayVisits: number;
  activePackageCount: number;
  remainingPackageSessions: number;
  unactivatedPurchaseCount: number;
  dormantActiveBalanceCount: number;
  primarySegment: CustomerRelationshipSegment | null;
  segments: CustomerRelationshipSegment[];
  riskLevel: CustomerRelationshipRiskLevel;
  relationshipHealthScore: number;
  priorityScore: number;
  reasons: string[];
  nextBestAction: string;
  dataStatus: CustomerRelationshipDataStatus;
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

function parseText(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value.trim() || fallback;
  }

  if (value == null) {
    return fallback;
  }

  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "object" && "value" in value) {
    return parseText((value as { value: unknown }).value, fallback);
  }

  return fallback;
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizePackageHoldings(value: unknown): CustomerRelationshipPackageHolding[] {
  return parseJsonArray(value)
    .map((item): CustomerRelationshipPackageHolding | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const serviceName = parseText(record.serviceName, "Unknown service");
      const packageTotal = parseNumber(record.packageTotal);
      const remainingCount = parseNumber(record.remainingCount);

      return {
        serviceId: parseText(record.serviceId) || null,
        packageId: parseText(record.packageId) || null,
        serviceName,
        packageName: parseText(record.packageName) || null,
        serviceCategory: parseText(record.serviceCategory, "Other"),
        packageTotal,
        usedCount: parseNumber(record.usedCount),
        remainingCount,
        latestUsageDate: parseText(record.latestUsageDate) || null,
        latestTherapist: parseText(record.latestTherapist) || null,
      } satisfies CustomerRelationshipPackageHolding;
    })
    .filter((item): item is CustomerRelationshipPackageHolding => item != null)
    .filter((item) => item.packageTotal > 0 || item.usedCount > 0 || item.remainingCount > 0)
    .slice(0, 12);
}

function normalizePackagePurchases(value: unknown): CustomerRelationshipPackagePurchase[] {
  return parseJsonArray(value)
    .map((item): CustomerRelationshipPackagePurchase | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;

      return {
        purchaseKey: parseText(record.purchaseKey) || null,
        invoiceNumber: parseText(record.invoiceNumber) || null,
        purchaseLineKey: parseText(record.purchaseLineKey) || null,
        serviceId: parseText(record.serviceId) || null,
        packageId: parseText(record.packageId) || null,
        serviceName: parseText(record.serviceName, "Unknown service"),
        packageName: parseText(record.packageName) || null,
        serviceCategory: parseText(record.serviceCategory, "Other"),
        purchaseCount: parseNumber(record.purchaseCount),
        latestPurchaseDate: parseText(record.latestPurchaseDate) || null,
        totalAmount: parseNumber(record.totalAmount),
      } satisfies CustomerRelationshipPackagePurchase;
    })
    .filter((item): item is CustomerRelationshipPackagePurchase => item != null)
    .filter((item) => item.purchaseCount > 0 || item.totalAmount > 0)
    .slice(0, 12);
}

function normalizeServiceUsage(value: unknown): CustomerRelationshipServiceUsage[] {
  return parseJsonArray(value)
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const counts = parseJsonArray(record.counts).map(parseNumber);
      const totalUsage = parseNumber(record.totalUsage);

      return {
        serviceName: parseText(record.serviceName, "Unknown service"),
        serviceCategory: parseText(record.serviceCategory, "Other"),
        counts,
        totalUsage,
      } satisfies CustomerRelationshipServiceUsage;
    })
    .filter((item): item is CustomerRelationshipServiceUsage => item != null)
    .filter((item) => item.totalUsage > 0)
    .slice(0, 12);
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
      PackageHoldings AS (
        SELECT
          customerName,
          phoneNumber,
          TO_JSON_STRING(
            ARRAY_AGG(
              STRUCT(
                serviceName,
                CAST(NULL AS STRING) AS packageName,
                serviceCategory,
                packageTotal,
                usedCount,
                remainingCount,
                FORMAT_DATE('%Y-%m-%d', latestUsageDate) AS latestUsageDate,
                latestTherapist
              )
              ORDER BY remainingCount DESC, latestUsageDate DESC
              LIMIT 12
            )
          ) AS packageHoldingsJson
        FROM (
          SELECT
            customerName,
            phoneNumber,
            COALESCE(NULLIF(serviceName, ''), 'Unknown service') AS serviceName,
            COALESCE(NULLIF(serviceCategory, ''), 'Other') AS serviceCategory,
            MAX(GREATEST(packageCount, remainingPackageCount, 0)) AS packageTotal,
            SUM(IF(packageCount > 0, 1, 0)) AS usedCount,
            MAX(GREATEST(remainingPackageCount, 0)) AS remainingCount,
            MAX(DATE(checkInTime)) AS latestUsageDate,
            ARRAY_AGG(practitionerName ORDER BY checkInTime DESC LIMIT 1)[SAFE_OFFSET(0)] AS latestTherapist
          FROM DistinctVisits
          WHERE packageCount > 0 OR remainingPackageCount > 0
          GROUP BY customerName, phoneNumber, serviceName, serviceCategory
        )
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
          MAX(IF(COALESCE(servicePackageName, '') != '', DATE(orderCreatedDate), NULL)) AS lastPackagePurchaseDate,
          ARRAY_AGG(IF(COALESCE(servicePackageName, '') != '', serviceName, NULL) IGNORE NULLS ORDER BY orderCreatedDate DESC LIMIT 1)[SAFE_OFFSET(0)] AS lastPackageServiceName,
          ARRAY_AGG(IF(COALESCE(servicePackageName, '') != '', servicePackageName, NULL) IGNORE NULLS ORDER BY orderCreatedDate DESC LIMIT 1)[SAFE_OFFSET(0)] AS lastPackageName
        FROM InvoiceLevelPayments
        GROUP BY customerName, phoneNumber
      ),
      PackagePurchases AS (
        SELECT
          customerName,
          phoneNumber,
          TO_JSON_STRING(
            ARRAY_AGG(
              STRUCT(
                purchaseKey,
                invoiceNumber,
                purchaseLineKey,
                serviceId,
                serviceName,
                packageId,
                packageName,
                serviceCategory,
                purchaseCount,
                FORMAT_DATE('%Y-%m-%d', latestPurchaseDate) AS latestPurchaseDate,
                totalAmount
              )
              ORDER BY latestPurchaseDate DESC, totalAmount DESC
              LIMIT 12
            )
          ) AS packagePurchasesJson
        FROM (
          SELECT
            customerName,
            phoneNumber,
            TO_HEX(SHA256(CONCAT(
              COALESCE(invoiceNumber, ''),
              '|',
              COALESCE(serviceName, ''),
              '|',
              COALESCE(servicePackageName, ''),
              '|',
              FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', orderCreatedDate)
            ))) AS purchaseKey,
            invoiceNumber,
            CAST(NULL AS STRING) AS purchaseLineKey,
            CAST(NULL AS STRING) AS serviceId,
            COALESCE(NULLIF(serviceName, ''), 'Unknown service') AS serviceName,
            CAST(NULL AS STRING) AS packageId,
            NULLIF(servicePackageName, '') AS packageName,
            COALESCE(NULLIF(serviceCategory, ''), 'Other') AS serviceCategory,
            1 AS purchaseCount,
            DATE(orderCreatedDate) AS latestPurchaseDate,
            invoiceNetTotal AS totalAmount
          FROM InvoiceLevelPayments
          WHERE COALESCE(servicePackageName, '') != ''
        )
        GROUP BY customerName, phoneNumber
      ),
      ServiceUsageByMonth AS (
        SELECT
          customerName,
          phoneNumber,
          TO_JSON_STRING(
            ARRAY_AGG(
              STRUCT(serviceName, serviceCategory, counts, totalUsage)
              ORDER BY totalUsage DESC, serviceName ASC
              LIMIT 12
            )
          ) AS serviceUsageJson
        FROM (
          SELECT
            customerName,
            phoneNumber,
            serviceName,
            serviceCategory,
            ARRAY_AGG(usageCount ORDER BY monthStart ASC) AS counts,
            SUM(usageCount) AS totalUsage
          FROM (
            SELECT
              customerName,
              phoneNumber,
              COALESCE(NULLIF(serviceName, ''), 'Unknown service') AS serviceName,
              COALESCE(NULLIF(serviceCategory, ''), 'Other') AS serviceCategory,
              DATE_TRUNC(DATE(checkInTime), MONTH) AS monthStart,
              COUNT(*) AS usageCount
            FROM DistinctVisits
            GROUP BY customerName, phoneNumber, serviceName, serviceCategory, monthStart
          )
          GROUP BY customerName, phoneNumber, serviceName, serviceCategory
        )
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
      payment.lastPackageServiceName,
      payment.lastPackageName,
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
      packageHoldings.packageHoldingsJson,
      packagePurchases.packagePurchasesJson,
      serviceUsage.serviceUsageJson,
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
    LEFT JOIN PackageHoldings packageHoldings USING (customerName, phoneNumber)
    LEFT JOIN PackagePurchases packagePurchases USING (customerName, phoneNumber)
    LEFT JOIN ServiceUsageByMonth serviceUsage USING (customerName, phoneNumber)
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
    const packageHoldings = normalizePackageHoldings(row.packageHoldingsJson);
    const packagePurchases = normalizePackagePurchases(row.packagePurchasesJson);
    const serviceUsageByMonth = normalizeServiceUsage(row.serviceUsageJson);

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
      lastPackageServiceName: parseText(row.lastPackageServiceName) || null,
      lastPackageName: parseText(row.lastPackageName) || null,
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
      packageHoldings,
      packagePurchases,
      serviceUsageByMonth,
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

function normalizeIdentityText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u1000-\u109f]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameNullableIdentity(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeIdentityText(left);
  const normalizedRight = normalizeIdentityText(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function toDateKey(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const dateKey = trimmed.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (dateKey) {
    return dateKey;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function diffDays(fromDateKey: string, toDateKeyValue: string | null | undefined) {
  const dateKey = toDateKey(toDateKeyValue);
  if (!dateKey) {
    return null;
  }

  const from = new Date(`${fromDateKey}T00:00:00.000Z`).getTime();
  const to = new Date(`${dateKey}T00:00:00.000Z`).getTime();
  const diff = Math.floor((from - to) / 86_400_000);
  return Number.isFinite(diff) ? diff : null;
}

function isOnOrAfterDate(left: string | null | undefined, right: string | null | undefined) {
  const leftKey = toDateKey(left);
  const rightKey = toDateKey(right);
  return Boolean(leftKey && rightKey && leftKey >= rightKey);
}

function maxIsoTimestamp(values: Array<string | null | undefined>, fallback: string) {
  const candidates = values
    .map((value) => {
      const dateKey = toDateKey(value);
      return dateKey ? `${dateKey}T23:59:59.000Z` : null;
    })
    .filter((value): value is string => value != null)
    .sort();

  return candidates.at(-1) ?? fallback;
}

function buildLearningRunId(params: { clinicId: string; snapshotDate: string }) {
  return `crmem_${params.snapshotDate.replace(/-/g, "")}_${hashValue(`${params.clinicId}:${randomUUID()}`).slice(0, 16)}`;
}

function customerIdentityConfidence(row: CustomerRelationshipLearningRow) {
  if (parseText(row.memberId)) {
    return 0.9;
  }

  if (normalizePhoneDigits(row.phoneNumber)) {
    return 0.95;
  }

  return 0.55;
}

function matchPackageHolding(params: {
  purchase: CustomerRelationshipPackagePurchase;
  holdings: CustomerRelationshipPackageHolding[];
  row: CustomerRelationshipLearningRow;
}) {
  const exactIdMatch = params.holdings.find(
    (holding) =>
      (params.purchase.packageId && holding.packageId && params.purchase.packageId === holding.packageId) ||
      (params.purchase.serviceId && holding.serviceId && params.purchase.serviceId === holding.serviceId),
  );

  if (exactIdMatch) {
    return {
      holding: exactIdMatch,
      method: "stable_customer_service_identity" as const,
      confidence: 0.96,
    };
  }

  const serviceAndPackageMatch = params.holdings.find(
    (holding) =>
      sameNullableIdentity(holding.serviceName, params.purchase.serviceName) &&
      (!params.purchase.packageName || !holding.packageName || sameNullableIdentity(holding.packageName, params.purchase.packageName)),
  );

  if (!serviceAndPackageMatch) {
    return {
      holding: null,
      method: "unmatched" as const,
      confidence: 0,
    };
  }

  if (parseText(params.row.memberId)) {
    return {
      holding: serviceAndPackageMatch,
      method: "stable_customer_service_identity" as const,
      confidence: 0.9,
    };
  }

  if (normalizePhoneDigits(params.row.phoneNumber)) {
    return {
      holding: serviceAndPackageMatch,
      method: "phone_service_identity" as const,
      confidence: 0.82,
    };
  }

  return {
    holding: serviceAndPackageMatch,
    method: "name_service_identity" as const,
    confidence: 0.45,
  };
}

function buildPurchaseFallback(row: CustomerRelationshipLearningRow): CustomerRelationshipPackagePurchase[] {
  const purchaseDate = toDateKey(row.lastPackagePurchaseDate);
  const serviceName = parseText(row.lastPackageServiceName);
  const packageName = parseText(row.lastPackageName) || null;

  if (!purchaseDate && !serviceName && !packageName) {
    return [];
  }

  return [
    {
      purchaseKey: null,
      invoiceNumber: null,
      purchaseLineKey: null,
      serviceId: null,
      packageId: null,
      serviceName: serviceName || "Unknown service",
      packageName,
      serviceCategory: "Other",
      purchaseCount: Math.max(1, parseNumber(row.packagePurchaseCount)),
      latestPurchaseDate: purchaseDate,
      totalAmount: 0,
    },
  ];
}

function lifecycleEvidenceReason(params: {
  lifecycle: CustomerRelationshipPackageLifecycle;
  serviceLabel: string;
}) {
  const purchaseText = params.lifecycle.purchaseDate ? `purchased on ${params.lifecycle.purchaseDate}` : "purchase date is unknown";
  const lowConfidence =
    params.lifecycle.matchMethod === "name_service_identity";

  if (params.lifecycle.activationStatus === "activated") {
    return `${params.serviceLabel} was ${purchaseText}; matching usage was found on ${params.lifecycle.lastMatchingUsageDate}.`;
  }

  if (lowConfidence) {
    return `${params.serviceLabel} was ${purchaseText}; usage could not be confirmed from reliable package/service matching.`;
  }

  if (params.lifecycle.activationStatus === "purchase_pending_activation") {
    return `${params.serviceLabel} was ${purchaseText}; it is still inside the ${env.CUSTOMER_RELATIONSHIP_UNACTIVATED_GRACE_DAYS}-day start grace period.`;
  }

  if (params.lifecycle.activationStatus === "unactivated_purchase") {
    return `${params.serviceLabel} was ${purchaseText}; no matching usage after that purchase was found.`;
  }

  return `${params.serviceLabel} was ${purchaseText}; usage status is unavailable from the current source data.`;
}

function buildPackageLifecycleRows(params: {
  profile: CustomerRelationshipProfile;
  row: CustomerRelationshipLearningRow;
  learningRunId: string;
  snapshotDate: string;
  computedAt: string;
  sourceWatermark: string;
}) {
  const purchases = params.profile.packagePurchases.length
    ? params.profile.packagePurchases
    : buildPurchaseFallback(params.row);
  const customerConfidence = customerIdentityConfidence(params.row);

  return purchases.map((purchase, index) => {
    const purchaseDate = toDateKey(purchase.latestPurchaseDate);
    const match = matchPackageHolding({
      purchase,
      holdings: params.profile.packageHoldings,
      row: params.row,
    });
    const matchingUsageDate =
      match.holding && isOnOrAfterDate(match.holding.latestUsageDate, purchaseDate)
        ? toDateKey(match.holding.latestUsageDate)
        : null;
    const purchaseAgeDays = diffDays(params.snapshotDate, purchaseDate);
    const daysSinceMatchingUsage = matchingUsageDate ? diffDays(params.snapshotDate, matchingUsageDate) : null;
    const balanceIsConfirmed = Boolean(match.holding && match.method !== "name_service_identity");
    const remainingSessions = balanceIsConfirmed ? Math.max(0, parseNumber(match.holding?.remainingCount)) : null;
    const purchasedSessions =
      balanceIsConfirmed && match.holding
        ? Math.max(parseNumber(match.holding.packageTotal), parseNumber(match.holding.usedCount) + parseNumber(match.holding.remainingCount))
        : null;
    const usedSessions =
      balanceIsConfirmed && matchingUsageDate && match.holding
        ? Math.max(0, parseNumber(match.holding.usedCount))
        : matchingUsageDate
          ? 1
          : 0;
    const activationStatus: CustomerRelationshipPackageLifecycle["activationStatus"] = matchingUsageDate
      ? "activated"
      : purchaseAgeDays == null
        ? "unknown"
        : purchaseAgeDays >= env.CUSTOMER_RELATIONSHIP_UNACTIVATED_GRACE_DAYS
          ? "unactivated_purchase"
          : "purchase_pending_activation";
    const dataStatus: CustomerRelationshipDataStatus =
      match.method === "name_service_identity" || match.confidence < 0.6 || !purchaseDate ? "partial" : "ok";
    const serviceLabel = purchase.packageName
      ? `${purchase.serviceName} / ${purchase.packageName}`
      : purchase.serviceName;
    const lifecycle: CustomerRelationshipPackageLifecycle = {
      purchaseKey:
        purchase.purchaseKey ||
        hashValue(
          [
            params.profile.customerKey,
            purchase.invoiceNumber ?? "",
            purchase.serviceName,
            purchase.packageName ?? "",
            purchaseDate ?? "",
            index,
          ].join("|"),
        ).slice(0, 32),
      invoiceNumber: purchase.invoiceNumber ?? null,
      purchaseLineKey: purchase.purchaseLineKey ?? null,
      serviceId: purchase.serviceId ?? null,
      serviceName: purchase.serviceName,
      packageId: purchase.packageId ?? null,
      packageName: purchase.packageName ?? null,
      purchaseDate,
      purchaseAgeDays,
      purchasedSessions: purchasedSessions && purchasedSessions > 0 ? purchasedSessions : null,
      usedSessions,
      remainingSessions,
      balanceStatus: remainingSessions == null ? "unknown" : "confirmed",
      firstMatchingUsageDate: matchingUsageDate,
      lastMatchingUsageDate: matchingUsageDate,
      lastCustomerVisitDate: params.profile.lastVisitDate,
      daysSinceMatchingUsage,
      activationStatus,
      matchMethod: match.method,
      matchConfidence: match.confidence,
      dataStatus,
      evidenceReason: "",
    };

    lifecycle.evidenceReason = lifecycleEvidenceReason({
      lifecycle,
      serviceLabel,
    });

    return {
      ...lifecycle,
      snapshotDate: params.snapshotDate,
      learningRunId: params.learningRunId,
      computedAt: params.computedAt,
      sourceWatermark: params.sourceWatermark,
      ruleVersion: CUSTOMER_RELATIONSHIP_DAILY_MEMORY_V2_RULE_VERSION,
      clinicId: params.profile.clinicId,
      clinicCode: params.profile.clinicCode,
      customerKey: params.profile.customerKey,
      customerName: params.profile.customerName,
      customerPhoneMasked: params.profile.customerPhoneMasked,
      memberId: params.profile.memberId ?? null,
      customerIdentityConfidence: customerConfidence,
    } satisfies CustomerRelationshipPackageDailyMemoryRow & CustomerRelationshipPackageLifecycle;
  });
}

const LEGACY_PACKAGE_SEGMENTS = new Set<CustomerRelationshipSegment>([
  "package_bought_never_came",
  "package_bought_not_used",
  "unused_package_balance",
]);

const PRIMARY_SEGMENT_PRECEDENCE: CustomerRelationshipSegment[] = [
  "unactivated_purchase",
  "dormant_with_active_balance_90d",
  "lapsed_customer_90d",
  "purchase_pending_activation",
  "inactive_vip",
  "overdue_customer",
  "treatment_due",
  "high_value_no_recent_visit",
  "new_customer_no_second_visit",
  "declining_frequency",
  "loyal_vip",
  "healthy_active_customer",
];

function segmentLabel(segment: CustomerRelationshipSegment | null | undefined) {
  switch (segment) {
    case "purchase_pending_activation":
      return "Bought recently, not started yet";
    case "unactivated_purchase":
      return "Bought but not started";
    case "dormant_with_active_balance_90d":
      return "Dormant package customer";
    case "lapsed_customer_90d":
      return "Lapsed customer";
    case "reactivated_customer":
      return "Returned after follow-up";
    default:
      return segment ? segment.replace(/_/g, " ") : "Customer relationship profile";
  }
}

function buildV2Reasons(params: {
  baseReasons: string[];
  packageRows: CustomerRelationshipPackageDailyMemoryRow[];
  primarySegment: CustomerRelationshipSegment | null;
  daysSinceLastVisit: number | null;
}) {
  const reasons: string[] = [];
  const unactivated = params.packageRows.find((row) => row.activationStatus === "unactivated_purchase");
  const pending = params.packageRows.find((row) => row.activationStatus === "purchase_pending_activation");
  const dormant = params.packageRows.find(
    (row) =>
      row.balanceStatus === "confirmed" &&
      (row.remainingSessions ?? 0) > 0 &&
      ((row.daysSinceMatchingUsage ?? 0) >= env.CUSTOMER_RELATIONSHIP_DORMANT_ACTIVE_BALANCE_DAYS ||
        (!row.lastMatchingUsageDate && (row.purchaseAgeDays ?? 0) >= env.CUSTOMER_RELATIONSHIP_DORMANT_ACTIVE_BALANCE_DAYS)),
  );

  if (unactivated) {
    reasons.push(unactivated.evidenceReason);
  }

  if (dormant) {
    const inactiveDays =
      dormant.daysSinceMatchingUsage ??
      dormant.purchaseAgeDays ??
      params.daysSinceLastVisit;
    reasons.push(
      `${dormant.serviceName} has ${dormant.remainingSessions?.toLocaleString("en-US") ?? "unknown"} confirmed remaining session(s), with no matching usage for ${inactiveDays ?? "unknown"} days.`,
    );
  }

  if (params.primarySegment === "lapsed_customer_90d" && params.daysSinceLastVisit != null) {
    reasons.push(`Last customer visit was ${params.daysSinceLastVisit.toLocaleString("en-US")} days ago and no confirmed active package balance is available.`);
  }

  if (pending && reasons.length === 0) {
    reasons.push(pending.evidenceReason);
  }

  params.packageRows
    .filter((row) => row.matchMethod === "name_service_identity" || row.matchConfidence < 0.6)
    .slice(0, 1)
    .forEach((row) => {
      reasons.push(`${row.serviceName} usage could not be confirmed because matching confidence is low.`);
    });

  params.baseReasons.forEach((reason) => {
    if (reasons.length < 6 && !/Package purchase found|Package usage appears|package session/i.test(reason)) {
      reasons.push(reason);
    }
  });

  return reasons.slice(0, 6);
}

function buildV2NextAction(primarySegment: CustomerRelationshipSegment | null, fallback: string) {
  switch (primarySegment) {
    case "unactivated_purchase":
      return "Contact the customer with the purchased service name and help book the first usage visit.";
    case "dormant_with_active_balance_90d":
      return "Remind the customer about the remaining package sessions and offer an easy return appointment.";
    case "lapsed_customer_90d":
      return "Send a gentle return-visit message based on their last known service.";
    case "purchase_pending_activation":
      return "Keep this customer in light monitoring; follow up after the start grace period if no usage appears.";
    case "reactivated_customer":
      return "Record the successful return and review whether the follow-up script should be reused.";
    default:
      return fallback;
  }
}

function buildV2PriorityScore(params: {
  primarySegment: CustomerRelationshipSegment | null;
  riskLevel: CustomerRelationshipRiskLevel;
  lifetimeSpend: number;
  maxLifetimeSpend: number;
  daysSinceLastVisit: number | null;
  confirmedRemainingSessions: number;
}) {
  let score = params.riskLevel === "high" ? 62 : params.riskLevel === "medium" ? 42 : 18;
  const primaryWeights: Partial<Record<CustomerRelationshipSegment, number>> = {
    unactivated_purchase: 28,
    dormant_with_active_balance_90d: 24,
    lapsed_customer_90d: 18,
    purchase_pending_activation: 4,
    inactive_vip: 16,
    high_value_no_recent_visit: 14,
    overdue_customer: 12,
    treatment_due: 8,
    new_customer_no_second_visit: 8,
    declining_frequency: 8,
    loyal_vip: 3,
    healthy_active_customer: -10,
  };

  score += primaryWeights[params.primarySegment ?? "healthy_active_customer"] ?? 0;

  if (params.maxLifetimeSpend > 0) {
    score += Math.min(12, Math.round((params.lifetimeSpend / params.maxLifetimeSpend) * 12));
  }

  if ((params.daysSinceLastVisit ?? 0) >= 90) {
    score += 8;
  }

  if (params.confirmedRemainingSessions >= 5) {
    score += 6;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function deriveV2CustomerProfile(params: {
  profile: CustomerRelationshipProfile;
  packageRows: CustomerRelationshipPackageDailyMemoryRow[];
  learningRunId: string;
  snapshotDate: string;
  computedAt: string;
  sourceWatermark: string;
  maxLifetimeSpend: number;
}) {
  const confirmedActiveRows = params.packageRows.filter(
    (row) => row.balanceStatus === "confirmed" && (row.remainingSessions ?? 0) > 0,
  );
  const unactivatedRows = params.packageRows.filter((row) => row.activationStatus === "unactivated_purchase");
  const pendingRows = params.packageRows.filter((row) => row.activationStatus === "purchase_pending_activation");
  const dormantRows = confirmedActiveRows.filter(
    (row) =>
      ((row.daysSinceMatchingUsage ?? 0) >= env.CUSTOMER_RELATIONSHIP_DORMANT_ACTIVE_BALANCE_DAYS ||
        (!row.lastMatchingUsageDate && (row.purchaseAgeDays ?? 0) >= env.CUSTOMER_RELATIONSHIP_DORMANT_ACTIVE_BALANCE_DAYS)),
  );
  const confirmedRemainingSessions = confirmedActiveRows.reduce(
    (sum, row) => sum + Math.max(0, row.remainingSessions ?? 0),
    0,
  );
  const segments = new Set<CustomerRelationshipSegment>(
    params.profile.segments.filter((segment) => !LEGACY_PACKAGE_SEGMENTS.has(segment)),
  );

  if (unactivatedRows.length > 0) {
    segments.add("unactivated_purchase");
    segments.add("package_bought_never_came");
    segments.add("package_bought_not_used");
  }

  if (dormantRows.length > 0) {
    segments.add("dormant_with_active_balance_90d");
  }

  if (confirmedActiveRows.length > 0) {
    segments.add("unused_package_balance");
  }

  if (
    (params.profile.daysSinceLastVisit ?? 0) >= env.CUSTOMER_RELATIONSHIP_DORMANT_ACTIVE_BALANCE_DAYS &&
    confirmedActiveRows.length === 0
  ) {
    segments.add("lapsed_customer_90d");
  }

  if (pendingRows.length > 0) {
    segments.add("purchase_pending_activation");
  }

  if (segments.size === 0) {
    segments.add("healthy_active_customer");
  }

  const primarySegment = PRIMARY_SEGMENT_PRECEDENCE.find((segment) => segments.has(segment)) ?? null;
  if (primarySegment && primarySegment !== "healthy_active_customer") {
    segments.delete("healthy_active_customer");
  }

  const dataStatus: CustomerRelationshipDataStatus =
    params.packageRows.some((row) => row.dataStatus === "partial") ? "partial" : "ok";
  const riskLevel: CustomerRelationshipRiskLevel =
    primarySegment === "unactivated_purchase" || primarySegment === "dormant_with_active_balance_90d"
      ? "high"
      : primarySegment === "lapsed_customer_90d"
        ? "medium"
        : params.profile.riskLevel;
  const relationshipHealthScore =
    primarySegment === "unactivated_purchase"
      ? Math.min(params.profile.relationshipHealthScore, 35)
      : primarySegment === "dormant_with_active_balance_90d"
        ? Math.min(params.profile.relationshipHealthScore, 40)
        : primarySegment === "lapsed_customer_90d"
          ? Math.min(params.profile.relationshipHealthScore, 55)
          : params.profile.relationshipHealthScore;
  const reasons = buildV2Reasons({
    baseReasons: params.profile.reasons,
    packageRows: params.packageRows,
    primarySegment,
    daysSinceLastVisit: params.profile.daysSinceLastVisit,
  });
  const priorityScore = buildV2PriorityScore({
    primarySegment,
    riskLevel,
    lifetimeSpend: params.profile.lifetimeSpend,
    maxLifetimeSpend: params.maxLifetimeSpend,
    daysSinceLastVisit: params.profile.daysSinceLastVisit,
    confirmedRemainingSessions,
  });

  return {
    ...params.profile,
    learningRunId: params.learningRunId,
    snapshotDate: params.snapshotDate,
    learnedAt: params.computedAt,
    sourceWatermark: params.sourceWatermark,
    ruleVersion: CUSTOMER_RELATIONSHIP_DAILY_MEMORY_V2_RULE_VERSION,
    dataStatus,
    activePackageCount: confirmedActiveRows.length,
    unactivatedPurchaseCount: unactivatedRows.length,
    dormantActiveBalanceCount: dormantRows.length,
    totalPackageSessions: params.profile.totalPackageSessions,
    usedPackageSessions: params.profile.usedPackageSessions,
    remainingPackageSessions: confirmedRemainingSessions,
    packageLifecycles: params.packageRows.map((row) => ({
      purchaseKey: row.purchaseKey,
      invoiceNumber: row.invoiceNumber,
      purchaseLineKey: row.purchaseLineKey,
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      packageId: row.packageId,
      packageName: row.packageName,
      purchaseDate: row.purchaseDate,
      purchaseAgeDays: row.purchaseAgeDays,
      purchasedSessions: row.purchasedSessions,
      usedSessions: row.usedSessions,
      remainingSessions: row.remainingSessions,
      balanceStatus: row.balanceStatus,
      firstMatchingUsageDate: row.firstMatchingUsageDate,
      lastMatchingUsageDate: row.lastMatchingUsageDate,
      lastCustomerVisitDate: row.lastCustomerVisitDate,
      daysSinceMatchingUsage: row.daysSinceMatchingUsage,
      activationStatus: row.activationStatus,
      matchMethod: row.matchMethod,
      matchConfidence: row.matchConfidence,
      dataStatus: row.dataStatus,
      evidenceReason: row.evidenceReason,
    })),
    packageBoughtNeverCame: unactivatedRows.length > 0,
    packageBoughtButNoUsage: unactivatedRows.length > 0,
    hasUnusedPackageBalance: confirmedActiveRows.length > 0,
    relationshipHealthScore,
    riskLevel,
    primarySegment,
    segments: [...segments],
    reasons,
    nextBestAction: buildV2NextAction(primarySegment, params.profile.nextBestAction),
    priorityScore,
  } satisfies CustomerRelationshipProfile;
}

function buildDailyMemoryRow(profile: CustomerRelationshipProfile): CustomerRelationshipDailyMemoryRow {
  return {
    snapshotDate: profile.snapshotDate ?? profile.learnedAt.slice(0, 10),
    learningRunId: profile.learningRunId ?? "",
    computedAt: profile.learnedAt,
    sourceWatermark: profile.sourceWatermark ?? profile.learnedAt,
    ruleVersion: profile.ruleVersion ?? CUSTOMER_RELATIONSHIP_DAILY_MEMORY_V2_RULE_VERSION,
    clinicId: profile.clinicId,
    clinicCode: profile.clinicCode,
    customerKey: profile.customerKey,
    customerName: profile.customerName,
    customerPhoneMasked: profile.customerPhoneMasked,
    memberId: profile.memberId ?? null,
    firstVisitDate: profile.firstSeenDate,
    lastVisitDate: profile.lastVisitDate,
    daysSinceLastVisit: profile.daysSinceLastVisit,
    lifetimeSpend: profile.lifetimeSpend,
    totalVisits: profile.totalVisits,
    recent90DayVisits: profile.recent90DayVisits,
    previous90DayVisits: profile.previous90DayVisits,
    activePackageCount: profile.activePackageCount,
    remainingPackageSessions: profile.remainingPackageSessions,
    unactivatedPurchaseCount: profile.unactivatedPurchaseCount ?? 0,
    dormantActiveBalanceCount: profile.dormantActiveBalanceCount ?? 0,
    primarySegment: profile.primarySegment ?? null,
    segments: profile.segments,
    riskLevel: profile.riskLevel,
    relationshipHealthScore: profile.relationshipHealthScore,
    priorityScore: profile.priorityScore,
    reasons: profile.reasons,
    nextBestAction: profile.nextBestAction,
    dataStatus: profile.dataStatus ?? "ok",
  };
}

export function buildCustomerRelationshipDailyMemoryV2FromRows(params: {
  clinicId: string;
  clinicCode: string;
  rows: CustomerRelationshipLearningRow[];
  learnedAt: string;
  lookbackDays: number;
  learningRunId?: string;
  snapshotDate?: string;
}) {
  const snapshotDate = params.snapshotDate ?? params.learnedAt.slice(0, 10);
  const learningRunId = params.learningRunId ?? buildLearningRunId({ clinicId: params.clinicId, snapshotDate });
  const sourceWatermark = maxIsoTimestamp(
    params.rows.flatMap((row) => [row.lastPaymentDate, row.lastVisitDate, row.lastPackagePurchaseDate]),
    params.learnedAt,
  );
  const baseProfiles = buildCustomerRelationshipProfilesFromRows({
    clinicId: params.clinicId,
    clinicCode: params.clinicCode,
    rows: params.rows,
    learnedAt: params.learnedAt,
    lookbackDays: params.lookbackDays,
  });
  const maxLifetimeSpend = Math.max(...baseProfiles.map((profile) => profile.lifetimeSpend), 0);
  const packageRows: CustomerRelationshipPackageDailyMemoryRow[] = [];
  const profiles = baseProfiles.map((profile, index) => {
    const rowPackageRows = buildPackageLifecycleRows({
      profile,
      row: params.rows[index],
      learningRunId,
      snapshotDate,
      computedAt: params.learnedAt,
      sourceWatermark,
    });
    packageRows.push(...rowPackageRows);

    return deriveV2CustomerProfile({
      profile,
      packageRows: rowPackageRows,
      learningRunId,
      snapshotDate,
      computedAt: params.learnedAt,
      sourceWatermark,
      maxLifetimeSpend,
    });
  });

  const relationshipRows = profiles.map(buildDailyMemoryRow);
  const summary = buildLearningSummary(profiles, params.learnedAt);

  return {
    learningRunId,
    snapshotDate,
    sourceWatermark,
    ruleVersion: CUSTOMER_RELATIONSHIP_DAILY_MEMORY_V2_RULE_VERSION,
    packageRows,
    relationshipRows,
    profiles,
    summary: {
      ...summary,
      learningRunId,
      snapshotDate,
      sourceWatermark,
      ruleVersion: CUSTOMER_RELATIONSHIP_DAILY_MEMORY_V2_RULE_VERSION,
      dataStatus: profiles.some((profile) => profile.dataStatus === "partial") ? "partial" : "ok",
      packageRowsSaved: packageRows.length,
    } satisfies CustomerRelationshipLearningSummary,
  };
}

async function replaceBigQuerySnapshot(params: {
  table: string;
  clinicId: string;
  snapshotDate: string;
  rowsJson: string[];
  insertSelectSql: string;
}) {
  await runAnalyticsQuery(
    `
      DELETE FROM ${params.table}
      WHERE clinicId = @clinicId
        AND snapshotDate = DATE(@snapshotDate)
    `,
    {
      clinicId: params.clinicId,
      snapshotDate: params.snapshotDate,
    },
  );

  if (params.rowsJson.length === 0) {
    return;
  }

  await runAnalyticsQuery(
    `
      INSERT INTO ${params.table}
      ${params.insertSelectSql}
    `,
    {
      rowsJson: params.rowsJson,
    },
  );
}

async function writeDailyMemoryV2ToBigQuery(params: {
  clinicId: string;
  snapshotDate: string;
  packageRows: CustomerRelationshipPackageDailyMemoryRow[];
  relationshipRows: CustomerRelationshipDailyMemoryRow[];
}) {
  await replaceBigQuerySnapshot({
    table: analyticsTables.customerPackageDaily,
    clinicId: params.clinicId,
    snapshotDate: params.snapshotDate,
    rowsJson: params.packageRows.map((row) => JSON.stringify(row)),
    insertSelectSql: `
        (
          snapshotDate, learningRunId, computedAt, sourceWatermark, ruleVersion,
          clinicId, clinicCode, customerKey, customerName, customerPhoneMasked, memberId,
          customerIdentityConfidence, purchaseKey, invoiceNumber, purchaseLineKey, serviceId,
          serviceName, packageId, packageName, purchaseDate, purchaseAgeDays, purchasedSessions,
          usedSessions, remainingSessions, balanceStatus, firstMatchingUsageDate,
          lastMatchingUsageDate, lastCustomerVisitDate, daysSinceMatchingUsage, activationStatus,
          matchMethod, matchConfidence, dataStatus, evidenceReason
        )
        SELECT
          DATE(JSON_VALUE(row, '$.snapshotDate')),
          JSON_VALUE(row, '$.learningRunId'),
          TIMESTAMP(JSON_VALUE(row, '$.computedAt')),
          TIMESTAMP(JSON_VALUE(row, '$.sourceWatermark')),
          JSON_VALUE(row, '$.ruleVersion'),
          JSON_VALUE(row, '$.clinicId'),
          JSON_VALUE(row, '$.clinicCode'),
          JSON_VALUE(row, '$.customerKey'),
          JSON_VALUE(row, '$.customerName'),
          JSON_VALUE(row, '$.customerPhoneMasked'),
          JSON_VALUE(row, '$.memberId'),
          SAFE_CAST(JSON_VALUE(row, '$.customerIdentityConfidence') AS FLOAT64),
          JSON_VALUE(row, '$.purchaseKey'),
          JSON_VALUE(row, '$.invoiceNumber'),
          JSON_VALUE(row, '$.purchaseLineKey'),
          JSON_VALUE(row, '$.serviceId'),
          JSON_VALUE(row, '$.serviceName'),
          JSON_VALUE(row, '$.packageId'),
          JSON_VALUE(row, '$.packageName'),
          SAFE_CAST(JSON_VALUE(row, '$.purchaseDate') AS DATE),
          SAFE_CAST(JSON_VALUE(row, '$.purchaseAgeDays') AS INT64),
          SAFE_CAST(JSON_VALUE(row, '$.purchasedSessions') AS INT64),
          SAFE_CAST(JSON_VALUE(row, '$.usedSessions') AS INT64),
          SAFE_CAST(JSON_VALUE(row, '$.remainingSessions') AS INT64),
          JSON_VALUE(row, '$.balanceStatus'),
          SAFE_CAST(JSON_VALUE(row, '$.firstMatchingUsageDate') AS DATE),
          SAFE_CAST(JSON_VALUE(row, '$.lastMatchingUsageDate') AS DATE),
          SAFE_CAST(JSON_VALUE(row, '$.lastCustomerVisitDate') AS DATE),
          SAFE_CAST(JSON_VALUE(row, '$.daysSinceMatchingUsage') AS INT64),
          JSON_VALUE(row, '$.activationStatus'),
          JSON_VALUE(row, '$.matchMethod'),
          SAFE_CAST(JSON_VALUE(row, '$.matchConfidence') AS FLOAT64),
          JSON_VALUE(row, '$.dataStatus'),
          JSON_VALUE(row, '$.evidenceReason')
        FROM UNNEST(@rowsJson) AS rowJson,
        UNNEST([PARSE_JSON(rowJson)]) AS row
    `,
  });

  await replaceBigQuerySnapshot({
    table: analyticsTables.customerRelationshipDaily,
    clinicId: params.clinicId,
    snapshotDate: params.snapshotDate,
    rowsJson: params.relationshipRows.map((row) => JSON.stringify(row)),
    insertSelectSql: `
        (
          snapshotDate, learningRunId, computedAt, sourceWatermark, ruleVersion,
          clinicId, clinicCode, customerKey, customerName, customerPhoneMasked, memberId,
          firstVisitDate, lastVisitDate, daysSinceLastVisit, lifetimeSpend, totalVisits,
          recent90DayVisits, previous90DayVisits, activePackageCount, remainingPackageSessions,
          unactivatedPurchaseCount, dormantActiveBalanceCount, primarySegment, segments, riskLevel,
          relationshipHealthScore, priorityScore, reasons, nextBestAction, dataStatus
        )
        SELECT
          DATE(JSON_VALUE(row, '$.snapshotDate')),
          JSON_VALUE(row, '$.learningRunId'),
          TIMESTAMP(JSON_VALUE(row, '$.computedAt')),
          TIMESTAMP(JSON_VALUE(row, '$.sourceWatermark')),
          JSON_VALUE(row, '$.ruleVersion'),
          JSON_VALUE(row, '$.clinicId'),
          JSON_VALUE(row, '$.clinicCode'),
          JSON_VALUE(row, '$.customerKey'),
          JSON_VALUE(row, '$.customerName'),
          JSON_VALUE(row, '$.customerPhoneMasked'),
          JSON_VALUE(row, '$.memberId'),
          SAFE_CAST(JSON_VALUE(row, '$.firstVisitDate') AS DATE),
          SAFE_CAST(JSON_VALUE(row, '$.lastVisitDate') AS DATE),
          SAFE_CAST(JSON_VALUE(row, '$.daysSinceLastVisit') AS INT64),
          SAFE_CAST(JSON_VALUE(row, '$.lifetimeSpend') AS FLOAT64),
          SAFE_CAST(JSON_VALUE(row, '$.totalVisits') AS INT64),
          SAFE_CAST(JSON_VALUE(row, '$.recent90DayVisits') AS INT64),
          SAFE_CAST(JSON_VALUE(row, '$.previous90DayVisits') AS INT64),
          SAFE_CAST(JSON_VALUE(row, '$.activePackageCount') AS INT64),
          SAFE_CAST(JSON_VALUE(row, '$.remainingPackageSessions') AS INT64),
          SAFE_CAST(JSON_VALUE(row, '$.unactivatedPurchaseCount') AS INT64),
          SAFE_CAST(JSON_VALUE(row, '$.dormantActiveBalanceCount') AS INT64),
          JSON_VALUE(row, '$.primarySegment'),
          ARRAY(SELECT JSON_VALUE(segment) FROM UNNEST(JSON_QUERY_ARRAY(row, '$.segments')) AS segment),
          JSON_VALUE(row, '$.riskLevel'),
          SAFE_CAST(JSON_VALUE(row, '$.relationshipHealthScore') AS INT64),
          SAFE_CAST(JSON_VALUE(row, '$.priorityScore') AS INT64),
          ARRAY(SELECT JSON_VALUE(reason) FROM UNNEST(JSON_QUERY_ARRAY(row, '$.reasons')) AS reason),
          JSON_VALUE(row, '$.nextBestAction'),
          JSON_VALUE(row, '$.dataStatus')
        FROM UNNEST(@rowsJson) AS rowJson,
        UNNEST([PARSE_JSON(rowJson)]) AS row
    `,
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
  snapshotDate?: string;
}) {
  const lookbackDays = Math.min(730, Math.max(30, params.lookbackDays ?? 365));
  const learnedAt = new Date().toISOString();
  const rows = await runAnalyticsQuery<CustomerRelationshipLearningRow>(buildLearningQuery(), {
    clinicCode: params.clinicCode,
    lookbackDays,
  });

  if (env.CUSTOMER_RELATIONSHIP_DAILY_MEMORY_V2_ENABLED) {
    const memory = buildCustomerRelationshipDailyMemoryV2FromRows({
      clinicId: params.clinicId,
      clinicCode: params.clinicCode,
      rows,
      learnedAt,
      lookbackDays,
      snapshotDate: params.snapshotDate,
    });

    try {
      await writeDailyMemoryV2ToBigQuery({
        clinicId: params.clinicId,
        snapshotDate: memory.snapshotDate,
        packageRows: memory.packageRows,
        relationshipRows: memory.relationshipRows,
      });
      await saveCustomerRelationshipProfiles({
        clinicId: params.clinicId,
        profiles: memory.profiles,
      });
      await saveCustomerRelationshipLearningRun({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        summary: memory.summary,
        lookbackDays,
        learningRunId: memory.learningRunId,
        snapshotDate: memory.snapshotDate,
        sourceWatermark: memory.sourceWatermark,
        ruleVersion: memory.ruleVersion,
        status: "completed",
      });
    } catch (error) {
      await saveCustomerRelationshipLearningRun({
        clinicId: params.clinicId,
        clinicCode: params.clinicCode,
        summary: {
          ...memory.summary,
          dataStatus: "unavailable",
          profilesSaved: 0,
          packageRowsSaved: 0,
        },
        lookbackDays,
        learningRunId: memory.learningRunId,
        snapshotDate: memory.snapshotDate,
        sourceWatermark: memory.sourceWatermark,
        ruleVersion: memory.ruleVersion,
        status: "failed",
        error: error instanceof Error ? error.message : "Customer relationship daily memory V2 learning failed.",
      });
      throw error;
    }

    return memory.summary;
  }

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
