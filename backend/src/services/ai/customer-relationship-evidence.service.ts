import { analyticsTables } from "../../config/bigquery.js";
import { runAnalyticsQuery } from "../bigquery.service.js";
import { getCustomerRelationshipProfileByKey } from "../reports/customer-relationship-profile.repository.js";
import type {
  CustomerRelationshipEvidence,
  CustomerRelationshipEvidenceMetric,
  CustomerRelationshipEvidenceType,
  CustomerRelationshipJourneyEvent,
  CustomerRelationshipPackageHolding,
  CustomerRelationshipPaymentEvidence,
  CustomerRelationshipProfile,
  CustomerRelationshipServiceUsage,
  CustomerRelationshipUsageHeatmap,
} from "./customer-relationship-schemas.js";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

function buildCustomerKeyCondition(phoneField: string, nameField: string) {
  return `
    (
      (
        REGEXP_REPLACE(COALESCE(${phoneField}, ''), r'[^0-9]', '') != ''
        AND SUBSTR(
          LOWER(TO_HEX(SHA256(CONCAT(@clinicId, ':phone:', REGEXP_REPLACE(COALESCE(${phoneField}, ''), r'[^0-9]', ''))))),
          1,
          32
        ) = @customerKey
      )
      OR (
        SUBSTR(
          LOWER(TO_HEX(SHA256(CONCAT(@clinicId, ':name:', LOWER(TRIM(REGEXP_REPLACE(COALESCE(${nameField}, ''), r'\\s+', ' '))))))),
          1,
          32
        ) = @customerKey
      )
    )
  `;
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

function packageStatus(row: Pick<CustomerRelationshipPackageHolding, "packageTotal" | "usedCount" | "remainingCount">) {
  if (row.remainingCount > 3) {
    return "Active";
  }

  if (row.remainingCount > 0) {
    return "Low remaining";
  }

  if (row.packageTotal > 0 && row.usedCount === 0) {
    return "Not started";
  }

  return "Completed";
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString("en-US")} MMK`;
}

function riskTone(riskLevel: CustomerRelationshipProfile["riskLevel"]): CustomerRelationshipEvidenceMetric["tone"] {
  return riskLevel === "high" ? "attention" : riskLevel === "medium" ? "neutral" : "positive";
}

function buildMetrics(profile: CustomerRelationshipProfile): CustomerRelationshipEvidenceMetric[] {
  return [
    { label: "Health score", value: String(profile.relationshipHealthScore), tone: riskTone(profile.riskLevel) },
    { label: "Risk level", value: profile.riskLevel, tone: riskTone(profile.riskLevel) },
    {
      label: "Remaining sessions",
      value: profile.remainingPackageSessions.toLocaleString("en-US"),
      tone: profile.remainingPackageSessions > 0 ? "attention" : "neutral",
    },
    {
      label: "Days since visit",
      value: profile.daysSinceLastVisit == null ? "Unknown" : profile.daysSinceLastVisit.toLocaleString("en-US"),
      tone: (profile.daysSinceLastVisit ?? 0) >= 60 ? "attention" : "neutral",
    },
    { label: "Lifetime spend", value: formatMoney(profile.lifetimeSpend), tone: "neutral" },
  ];
}

function buildTitle(type: CustomerRelationshipEvidenceType, profile: CustomerRelationshipProfile) {
  if (type === "package_usage") {
    return `Package evidence for ${profile.customerName}`;
  }

  if (type === "visit_pattern") {
    return `Visit pattern for ${profile.customerName}`;
  }

  if (type === "risk_explanation") {
    return `Risk evidence for ${profile.customerName}`;
  }

  if (type === "renewal_opportunity") {
    return `Renewal opportunity for ${profile.customerName}`;
  }

  return `Evidence for ${profile.customerName}`;
}

function buildInsight(type: CustomerRelationshipEvidenceType, profile: CustomerRelationshipProfile, packages: CustomerRelationshipPackageHolding[]) {
  if (type === "package_usage") {
    const remaining = packages.reduce((sum, item) => sum + item.remainingCount, 0);
    if (remaining > 0) {
      return `${profile.customerName} has ${remaining.toLocaleString("en-US")} remaining package session${remaining === 1 ? "" : "s"} visible in usage records.`;
    }

    return profile.reasons[0] ?? "Package history is visible, but no remaining balance was confirmed.";
  }

  if (type === "visit_pattern") {
    return profile.daysSinceLastVisit == null
      ? "No completed visit date is available in the learned profile."
      : `Last completed visit was ${profile.daysSinceLastVisit.toLocaleString("en-US")} day${profile.daysSinceLastVisit === 1 ? "" : "s"} ago.`;
  }

  if (type === "risk_explanation") {
    return profile.reasons[0] ?? `The learned profile classifies this customer as ${profile.riskLevel} risk.`;
  }

  return profile.nextBestAction;
}

function buildJourney(params: {
  profile: CustomerRelationshipProfile;
  evidenceType: CustomerRelationshipEvidenceType;
  packagePurchaseDate: string | null;
  latestUsageDate: string | null;
}) {
  const journey: CustomerRelationshipJourneyEvent[] = [];

  if (params.packagePurchaseDate) {
    journey.push({
      date: params.packagePurchaseDate,
      title: "Package purchase",
      detail: params.profile.lastPackageName
        ? `${params.profile.lastPackageName} purchased for ${params.profile.lastPackageServiceName ?? "service"}`
        : "Latest package purchase found.",
      tone: "neutral",
    });
  }

  if (params.latestUsageDate) {
    journey.push({
      date: params.latestUsageDate,
      title: "Latest package usage",
      detail: "Most recent package usage visible in visit records.",
      tone: "positive",
    });
  }

  if (params.profile.lastVisitDate) {
    journey.push({
      date: params.profile.lastVisitDate,
      title: "Last visit",
      detail: params.profile.lastService ?? "Completed customer visit.",
      tone: params.evidenceType === "risk_explanation" ? "attention" : "neutral",
    });
  }

  journey.push({
    date: null,
    title: "Current risk",
    detail: `${params.profile.riskLevel} risk, ${params.profile.relationshipHealthScore} health score.`,
    tone: riskTone(params.profile.riskLevel),
  });
  journey.push({
    date: null,
    title: "Recommended action",
    detail: params.profile.nextBestAction,
    tone: "neutral",
  });

  return journey.slice(0, 6);
}

async function fetchPackages(params: {
  clinicId: string;
  clinicCode: string;
  customerKey: string;
}) {
  const rows = await runAnalyticsQuery<{
    serviceName: string;
    packageName: string | null;
    serviceCategory: string;
    packageTotal: number;
    usedCount: number;
    remainingCount: number;
    latestUsageDate: string | null;
    latestTherapist: string | null;
  }>(
    `
      SELECT
        COALESCE(ServiceName, 'Unknown service') AS serviceName,
        CAST(NULL AS STRING) AS packageName,
        ${buildServiceCategoryExpression("ServiceName", "CAST(NULL AS STRING)")} AS serviceCategory,
        MAX(CAST(COALESCE(PackageCount, 0) AS INT64)) AS packageTotal,
        GREATEST(
          MAX(CAST(COALESCE(PackageCount, 0) AS INT64)) - MAX(CAST(COALESCE(RemainingPackageCount, 0) AS INT64)),
          0
        ) AS usedCount,
        GREATEST(MAX(CAST(COALESCE(RemainingPackageCount, 0) AS INT64)), 0) AS remainingCount,
        FORMAT_DATE('%Y-%m-%d', MAX(DATE(CheckInTime))) AS latestUsageDate,
        ARRAY_AGG(COALESCE(PractitionerName, 'Unknown') ORDER BY CheckInTime DESC LIMIT 1)[SAFE_OFFSET(0)] AS latestTherapist
      FROM ${analyticsTables.mainDataView}
      WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
        AND CustomerName IS NOT NULL
        AND CheckInTime IS NOT NULL
        AND ${buildCustomerKeyCondition("CustomerPhoneNumber", "CustomerName")}
        AND (
          CAST(COALESCE(PackageCount, 0) AS INT64) > 0
          OR CAST(COALESCE(RemainingPackageCount, 0) AS INT64) > 0
        )
      GROUP BY serviceName, serviceCategory
      ORDER BY remainingCount DESC, latestUsageDate DESC, serviceName ASC
      LIMIT 12
    `,
    params,
  );

  return rows.map((row) => {
    const packageRow = {
      serviceName: parseText(row.serviceName, "Unknown service"),
      packageName: parseText(row.packageName) || null,
      serviceCategory: parseText(row.serviceCategory, "Other"),
      packageTotal: parseNumber(row.packageTotal),
      usedCount: parseNumber(row.usedCount),
      remainingCount: parseNumber(row.remainingCount),
      latestUsageDate: parseText(row.latestUsageDate) || null,
      latestTherapist: parseText(row.latestTherapist) || null,
    };

    return {
      ...packageRow,
      status: packageStatus(packageRow),
    };
  });
}

async function fetchUsageHeatmap(params: {
  clinicId: string;
  clinicCode: string;
  customerKey: string;
  year: number;
}) {
  const rows = await runAnalyticsQuery<{
    serviceName: string;
    serviceCategory: string;
    monthNumber: number;
    usageCount: number;
    totalUsage: number;
  }>(
    `
      WITH MonthlyUsage AS (
        SELECT
          COALESCE(ServiceName, 'Unknown service') AS serviceName,
          ${buildServiceCategoryExpression("ServiceName", "CAST(NULL AS STRING)")} AS serviceCategory,
          EXTRACT(MONTH FROM DATE(CheckInTime)) AS monthNumber,
          COUNT(*) AS usageCount
        FROM ${analyticsTables.mainDataView}
        WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
          AND CustomerName IS NOT NULL
          AND CheckInTime IS NOT NULL
          AND EXTRACT(YEAR FROM DATE(CheckInTime)) = @year
          AND ${buildCustomerKeyCondition("CustomerPhoneNumber", "CustomerName")}
        GROUP BY serviceName, serviceCategory, monthNumber
      ),
      RankedServices AS (
        SELECT
          serviceName,
          serviceCategory,
          SUM(usageCount) AS totalUsage
        FROM MonthlyUsage
        GROUP BY serviceName, serviceCategory
      )
      SELECT
        monthly.serviceName,
        monthly.serviceCategory,
        monthly.monthNumber,
        monthly.usageCount,
        ranked.totalUsage
      FROM MonthlyUsage monthly
      INNER JOIN (
        SELECT *
        FROM RankedServices
        ORDER BY totalUsage DESC, serviceName ASC
        LIMIT 12
      ) ranked
        ON monthly.serviceName = ranked.serviceName
        AND monthly.serviceCategory = ranked.serviceCategory
      ORDER BY ranked.totalUsage DESC, monthly.serviceName ASC, monthly.monthNumber ASC
    `,
    params,
  );

  const grouped = new Map<string, CustomerRelationshipServiceUsage>();

  rows.forEach((row) => {
    const key = `${row.serviceName}::${row.serviceCategory}`;
    const existing =
      grouped.get(key) ??
      {
        serviceName: parseText(row.serviceName, "Unknown service"),
        serviceCategory: parseText(row.serviceCategory, "Other"),
        counts: new Array(12).fill(0),
        totalUsage: parseNumber(row.totalUsage),
      };

    existing.counts[Math.max(0, parseNumber(row.monthNumber) - 1)] = parseNumber(row.usageCount);
    existing.totalUsage = parseNumber(row.totalUsage);
    grouped.set(key, existing);
  });

  const services = [...grouped.values()].sort((left, right) => right.totalUsage - left.totalUsage);

  return {
    year: params.year,
    months: MONTH_LABELS,
    services,
    summary: {
      totalUsage: rows.reduce((sum, row) => sum + parseNumber(row.usageCount), 0),
      distinctServices: services.length,
    },
  } satisfies CustomerRelationshipUsageHeatmap;
}

async function fetchPayments(params: {
  clinicId: string;
  clinicCode: string;
  customerKey: string;
}) {
  const ctes = `
    WITH InvoiceLevelPayments AS (
      SELECT
        CustomerName AS customerName,
        CustomerPhoneNumber AS phoneNumber,
        InvoiceNumber AS invoiceNumber,
        MAX(OrderCreatedDate) AS orderCreatedDate,
        MAX(COALESCE(PaymentMethod, 'Unknown')) AS paymentMethod,
        MAX(COALESCE(PaymentStatus, '')) AS paymentStatus,
        MAX(COALESCE(SellerName, 'Unknown')) AS salePerson,
        MAX(CAST(COALESCE(NetTotal, 0) AS FLOAT64)) AS invoiceNetTotal,
        MAX(CAST(COALESCE(Total, 0) AS FLOAT64)) AS invoiceTotal,
        MAX(CAST(COALESCE(Discount, 0) AS FLOAT64)) AS discount,
        MAX(CAST(COALESCE(OrderBalance, 0) AS FLOAT64)) AS orderBalance,
        ARRAY_AGG(COALESCE(ServiceName, '') IGNORE NULLS ORDER BY ServiceName ASC LIMIT 1)[SAFE_OFFSET(0)] AS serviceName,
        ARRAY_AGG(ServicePackageName IGNORE NULLS ORDER BY ServicePackageName ASC LIMIT 1)[SAFE_OFFSET(0)] AS servicePackageName
      FROM ${analyticsTables.mainPaymentView}
      WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
        AND CustomerName IS NOT NULL
        AND PaymentStatus = 'PAID'
        AND NOT STARTS_WITH(InvoiceNumber, 'CO-')
        AND COALESCE(PaymentMethod, '') != 'PASS'
        AND ${buildCustomerKeyCondition("CustomerPhoneNumber", "CustomerName")}
      GROUP BY customerName, phoneNumber, invoiceNumber
    )
  `;
  const [summaryRows, paymentRows] = await Promise.all([
    runAnalyticsQuery<{
      totalSpent: number;
      invoiceCount: number;
      averageInvoice: number;
      outstandingAmount: number;
    }>(
      `
        ${ctes}
        SELECT
          COALESCE(SUM(invoiceNetTotal), 0) AS totalSpent,
          COUNT(*) AS invoiceCount,
          COALESCE(AVG(invoiceNetTotal), 0) AS averageInvoice,
          COALESCE(SUM(orderBalance), 0) AS outstandingAmount
        FROM InvoiceLevelPayments
      `,
      params,
    ),
    runAnalyticsQuery<{
      dateLabel: string;
      invoiceNumber: string;
      serviceName: string;
      servicePackageName: string | null;
      paymentMethod: string;
      salePerson: string;
      invoiceTotal: number;
      discount: number;
      netAmount: number;
      outstandingAmount: number;
      paymentStatus: string;
    }>(
      `
        ${ctes}
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(orderCreatedDate)) AS dateLabel,
          invoiceNumber,
          COALESCE(serviceName, '') AS serviceName,
          servicePackageName,
          COALESCE(paymentMethod, 'Unknown') AS paymentMethod,
          COALESCE(salePerson, 'Unknown') AS salePerson,
          invoiceTotal,
          discount,
          invoiceNetTotal AS netAmount,
          orderBalance AS outstandingAmount,
          COALESCE(paymentStatus, '') AS paymentStatus
        FROM InvoiceLevelPayments
        ORDER BY orderCreatedDate DESC, invoiceNumber DESC
        LIMIT 8
      `,
      params,
    ),
  ]);
  const summary = summaryRows[0];
  const payments: CustomerRelationshipPaymentEvidence = {
    summary: {
      totalSpent: parseNumber(summary?.totalSpent),
      invoiceCount: parseNumber(summary?.invoiceCount),
      averageInvoice: parseNumber(summary?.averageInvoice),
      outstandingAmount: parseNumber(summary?.outstandingAmount),
    },
    rows: paymentRows.map((row) => ({
      dateLabel: row.dateLabel,
      invoiceNumber: row.invoiceNumber,
      serviceName: row.serviceName,
      servicePackageName: row.servicePackageName,
      paymentMethod: row.paymentMethod,
      salePerson: row.salePerson,
      invoiceTotal: parseNumber(row.invoiceTotal),
      discount: parseNumber(row.discount),
      netAmount: parseNumber(row.netAmount),
      outstandingAmount: parseNumber(row.outstandingAmount),
      paymentStatus: row.paymentStatus,
    })),
    totalCount: parseNumber(summary?.invoiceCount),
  };

  return payments;
}

function heatmapFromProfile(profile: CustomerRelationshipProfile, year: number) {
  const services = profile.serviceUsageByMonth.slice(0, 12);

  return {
    year,
    months: MONTH_LABELS,
    services,
    summary: {
      totalUsage: services.reduce((sum, service) => sum + service.totalUsage, 0),
      distinctServices: services.length,
    },
  } satisfies CustomerRelationshipUsageHeatmap;
}

export async function buildCustomerRelationshipEvidence(params: {
  clinicId: string;
  clinicCode: string;
  customerKey: string;
  evidenceType: CustomerRelationshipEvidenceType;
  year?: number;
}): Promise<CustomerRelationshipEvidence | null> {
  if (params.evidenceType === "none") {
    return null;
  }

  const profile = await getCustomerRelationshipProfileByKey({
    clinicId: params.clinicId,
    customerKey: params.customerKey,
  });

  if (!profile) {
    return null;
  }

  const year = params.year ?? new Date().getFullYear();
  let packages = profile.packageHoldings.map((row) => ({
    ...row,
    status: row.status ?? packageStatus(row),
  }));
  let usageHeatmap = heatmapFromProfile(profile, year);
  let payments: CustomerRelationshipPaymentEvidence | null = null;

  try {
    const [freshPackages, freshUsageHeatmap, freshPayments] = await Promise.all([
      fetchPackages(params),
      fetchUsageHeatmap({ ...params, year }),
      fetchPayments(params),
    ]);

    if (freshPackages.length > 0) {
      packages = freshPackages;
    }

    if (freshUsageHeatmap.services.length > 0) {
      usageHeatmap = freshUsageHeatmap;
    }

    payments = freshPayments;
  } catch {
    // Learned profile evidence is safe to return if live analytics evidence is unavailable.
  }

  const latestUsageDate =
    packages
      .map((row) => row.latestUsageDate)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

  return {
    targetCustomer: {
      customerKey: profile.customerKey,
      customerName: profile.customerName,
      customerPhoneMasked: profile.customerPhoneMasked,
    },
    evidenceType: params.evidenceType,
    title: buildTitle(params.evidenceType, profile),
    insight: buildInsight(params.evidenceType, profile, packages),
    metrics: buildMetrics(profile),
    packages,
    payments,
    usageHeatmap,
    journey: buildJourney({
      profile,
      evidenceType: params.evidenceType,
      packagePurchaseDate: profile.lastPackagePurchaseDate,
      latestUsageDate,
    }),
  };
}
