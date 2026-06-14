import { analyticsTables } from "../../config/bigquery.js";
import { runAnalyticsQuery } from "../bigquery.service.js";
import { percentageChange } from "./report-ai-insights.service.js";

export type GrowthRevenueEvidenceItem = {
  name: string;
  count: number;
  amount: number;
  sharePercent: number | null;
  averageRevenue: number | null;
};

export type PaymentMethodRevenueEvidenceItem = {
  paymentMethod: string;
  count: number;
  amount: number;
  sharePercent: number | null;
};

export type DailyPaymentGrowthEvidence = {
  serviceRevenue: GrowthRevenueEvidenceItem[];
  packageRevenue: {
    totalAmount: number;
    count: number;
    sharePercent: number | null;
    topPackages: GrowthRevenueEvidenceItem[];
  } | null;
  sellerRevenue: {
    sellers: GrowthRevenueEvidenceItem[];
    topSeller: GrowthRevenueEvidenceItem | null;
    lowestSeller: GrowthRevenueEvidenceItem | null;
    revenueGap: number | null;
  };
  paymentMethodRevenue: PaymentMethodRevenueEvidenceItem[];
  outstanding: {
    outstandingAmount: number;
    partialPaymentAmount: number | null;
    affectedInvoiceCount: number;
  } | null;
  dataQualityNotes: string[];
};

export type WeeklySummaryGrowthEvidence = {
  packageSales: {
    totalAmount: number;
    count: number;
    sharePercent: number | null;
    weekOverWeekChangePercent: number | null;
    topPackages: GrowthRevenueEvidenceItem[];
  } | null;
  customerRebookingOpportunity: {
    completedCustomers: number;
    customersWithoutFutureBooking: number;
    estimatedValue: number | null;
    estimatedValueLabel: string | null;
  } | null;
  serviceRevenue: GrowthRevenueEvidenceItem[];
  dataQualityNotes: string[];
};

type AggregateItem = {
  name?: string | null;
  paymentMethod?: string | null;
  count?: unknown;
  amount?: unknown;
};

type AmountCountAggregate = {
  totalAmount?: unknown;
  count?: unknown;
  previousTotalAmount?: unknown;
};

type OutstandingAggregate = {
  outstandingAmount?: unknown;
  partialPaymentAmount?: unknown;
  affectedInvoiceCount?: unknown;
};

type RebookingAggregate = {
  completedCustomers?: unknown;
  customersWithoutFutureBooking?: unknown;
};

function parseNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (value && typeof value === "object" && "value" in value) {
    return parseNumber((value as { value: unknown }).value);
  }

  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundOne(value: number) {
  return Number(value.toFixed(1));
}

function sharePercent(amount: number, totalAmount: number) {
  if (totalAmount <= 0) {
    return null;
  }

  return roundOne((amount / totalAmount) * 100);
}

function averageRevenue(amount: number, count: number) {
  if (count <= 0) {
    return null;
  }

  return amount / count;
}

function normalizeNamedRevenueRows(rows: AggregateItem[] | null | undefined, totalAmount: number) {
  return (rows ?? [])
    .map((row) => {
      const name = (row.name ?? "").trim() || "Unknown";
      const count = parseNumber(row.count);
      const amount = parseNumber(row.amount);

      return {
        name,
        count,
        amount,
        sharePercent: sharePercent(amount, totalAmount),
        averageRevenue: averageRevenue(amount, count),
      };
    })
    .filter((row) => row.amount > 0 || row.count > 0)
    .sort((left, right) => right.amount - left.amount || right.count - left.count || left.name.localeCompare(right.name));
}

function normalizeMethodRevenueRows(rows: AggregateItem[] | null | undefined, totalAmount: number) {
  return (rows ?? [])
    .map((row) => {
      const paymentMethod = (row.paymentMethod ?? row.name ?? "").trim() || "Unknown";
      const count = parseNumber(row.count);
      const amount = parseNumber(row.amount);

      return {
        paymentMethod,
        count,
        amount,
        sharePercent: sharePercent(amount, totalAmount),
      };
    })
    .filter((row) => row.amount > 0 || row.count > 0)
    .sort(
      (left, right) =>
        right.amount - left.amount ||
        right.count - left.count ||
        left.paymentMethod.localeCompare(right.paymentMethod),
    );
}

export function buildDailyPaymentGrowthEvidenceFromAggregates(input: {
  totalRevenue: number;
  serviceRevenue?: AggregateItem[] | null;
  topPackages?: AggregateItem[] | null;
  packageSummary?: AmountCountAggregate | null;
  sellerRevenue?: AggregateItem[] | null;
  paymentMethods?: AggregateItem[] | null;
  outstanding?: OutstandingAggregate | null;
  dataQualityNotes?: string[];
}): DailyPaymentGrowthEvidence {
  const serviceRevenue = normalizeNamedRevenueRows(input.serviceRevenue, input.totalRevenue).slice(0, 5);
  const topPackages = normalizeNamedRevenueRows(input.topPackages, input.totalRevenue).slice(0, 5);
  const packageTotalAmount =
    input.packageSummary == null
      ? topPackages.reduce((total, row) => total + row.amount, 0)
      : parseNumber(input.packageSummary.totalAmount);
  const packageCount =
    input.packageSummary == null
      ? topPackages.reduce((total, row) => total + row.count, 0)
      : parseNumber(input.packageSummary.count);
  const sellers = normalizeNamedRevenueRows(input.sellerRevenue, input.totalRevenue).slice(0, 8);
  const topSeller = sellers[0] ?? null;
  const lowestSeller = sellers.length > 0 ? sellers[sellers.length - 1] : null;
  const outstandingAmount = parseNumber(input.outstanding?.outstandingAmount);
  const partialPaymentAmount = input.outstanding?.partialPaymentAmount == null ? null : parseNumber(input.outstanding.partialPaymentAmount);
  const affectedInvoiceCount = parseNumber(input.outstanding?.affectedInvoiceCount);

  return {
    serviceRevenue,
    packageRevenue:
      packageTotalAmount > 0 || packageCount > 0 || topPackages.length > 0
        ? {
            totalAmount: packageTotalAmount,
            count: packageCount,
            sharePercent: sharePercent(packageTotalAmount, input.totalRevenue),
            topPackages,
          }
        : null,
    sellerRevenue: {
      sellers,
      topSeller,
      lowestSeller,
      revenueGap: topSeller && lowestSeller ? Math.max(0, topSeller.amount - lowestSeller.amount) : null,
    },
    paymentMethodRevenue: normalizeMethodRevenueRows(input.paymentMethods, input.totalRevenue).slice(0, 8),
    outstanding:
      outstandingAmount > 0 || partialPaymentAmount != null || affectedInvoiceCount > 0
        ? {
            outstandingAmount,
            partialPaymentAmount,
            affectedInvoiceCount,
          }
        : null,
    dataQualityNotes: input.dataQualityNotes ?? [],
  };
}

export function buildWeeklySummaryGrowthEvidenceFromAggregates(input: {
  totalWeeklyRevenue: number;
  averageRevenuePerCompletedCustomer: number | null;
  packageSummary?: AmountCountAggregate | null;
  topPackages?: AggregateItem[] | null;
  serviceRevenue?: AggregateItem[] | null;
  rebooking?: RebookingAggregate | null;
  dataQualityNotes?: string[];
}): WeeklySummaryGrowthEvidence {
  const topPackages = normalizeNamedRevenueRows(input.topPackages, input.totalWeeklyRevenue).slice(0, 5);
  const packageTotalAmount =
    input.packageSummary == null
      ? topPackages.reduce((total, row) => total + row.amount, 0)
      : parseNumber(input.packageSummary.totalAmount);
  const packageCount =
    input.packageSummary == null
      ? topPackages.reduce((total, row) => total + row.count, 0)
      : parseNumber(input.packageSummary.count);
  const previousPackageAmount =
    input.packageSummary?.previousTotalAmount == null ? null : parseNumber(input.packageSummary.previousTotalAmount);
  const completedCustomers = parseNumber(input.rebooking?.completedCustomers);
  const customersWithoutFutureBooking = parseNumber(input.rebooking?.customersWithoutFutureBooking);
  const estimatedValue =
    input.averageRevenuePerCompletedCustomer != null && customersWithoutFutureBooking > 0
      ? customersWithoutFutureBooking * input.averageRevenuePerCompletedCustomer
      : null;

  return {
    packageSales:
      packageTotalAmount > 0 || packageCount > 0 || topPackages.length > 0
        ? {
            totalAmount: packageTotalAmount,
            count: packageCount,
            sharePercent: sharePercent(packageTotalAmount, input.totalWeeklyRevenue),
            weekOverWeekChangePercent: percentageChange(packageTotalAmount, previousPackageAmount),
            topPackages,
          }
        : null,
    customerRebookingOpportunity:
      completedCustomers > 0 || customersWithoutFutureBooking > 0
        ? {
            completedCustomers,
            customersWithoutFutureBooking,
            estimatedValue,
            estimatedValueLabel: estimatedValue == null ? "Estimated value unavailable without reliable average revenue." : null,
          }
        : null,
    serviceRevenue: normalizeNamedRevenueRows(input.serviceRevenue, input.totalWeeklyRevenue).slice(0, 5),
    dataQualityNotes: input.dataQualityNotes ?? [],
  };
}

export async function getDailyPaymentGrowthEvidence(input: {
  clinicCode: string;
  dateKey: string;
  totalRevenue: number;
}) {
  try {
    const rows = await runAnalyticsQuery<{
      serviceRevenue: AggregateItem[] | null;
      topPackages: AggregateItem[] | null;
      packageSummary: AmountCountAggregate | null;
      sellerRevenue: AggregateItem[] | null;
      paymentMethods: AggregateItem[] | null;
      outstanding: OutstandingAggregate | null;
    }>(
      `
        WITH RawData AS (
          SELECT
            InvoiceNumber AS invoiceNumber,
            COALESCE(NULLIF(TRIM(ServiceName), ''), 'Unknown service') AS serviceName,
            COALESCE(NULLIF(TRIM(ServicePackageName), ''), '') AS packageName,
            COALESCE(NULLIF(TRIM(SellerName), ''), 'Unknown seller') AS sellerName,
            COALESCE(NULLIF(TRIM(PaymentMethod), ''), 'Unknown') AS paymentMethod,
            COALESCE(NULLIF(TRIM(PaymentStatus), ''), '') AS paymentStatus,
            CAST(COALESCE(ItemTotal, SubTotal, NetTotal, PaymentAmount, 0) AS FLOAT64) AS itemAmount,
            CAST(COALESCE(PaymentAmount, NetTotal, 0) AS FLOAT64) AS paymentAmount,
            CAST(COALESCE(NetTotal, 0) AS FLOAT64) AS netTotal,
            CAST(COALESCE(OrderBalance, 0) AS FLOAT64) AS orderBalance,
            PaymentNote AS paymentNote
          FROM ${analyticsTables.mainPaymentView}
          WHERE DATE(OrderCreatedDate) = @dateKey
            AND LOWER(ClinicCode) = LOWER(@clinicCode)
        ),
        UniqueItems AS (
          SELECT DISTINCT
            invoiceNumber,
            serviceName,
            packageName,
            itemAmount
          FROM RawData
          WHERE itemAmount > 0
        ),
        ServiceRevenue AS (
          SELECT
            serviceName AS name,
            COUNT(*) AS count,
            SUM(itemAmount) AS amount
          FROM UniqueItems
          GROUP BY name
        ),
        PackageRevenue AS (
          SELECT
            packageName AS name,
            COUNT(*) AS count,
            SUM(itemAmount) AS amount
          FROM UniqueItems
          WHERE packageName != ''
          GROUP BY name
        ),
        UniquePayments AS (
          SELECT DISTINCT
            invoiceNumber,
            paymentMethod,
            paymentAmount,
            paymentNote
          FROM RawData
          WHERE paymentAmount > 0
        ),
        PaymentMethods AS (
          SELECT
            paymentMethod,
            COUNT(*) AS count,
            SUM(paymentAmount) AS amount
          FROM UniquePayments
          GROUP BY paymentMethod
        ),
        InvoiceData AS (
          SELECT
            invoiceNumber,
            ARRAY_AGG(sellerName ORDER BY sellerName LIMIT 1)[SAFE_OFFSET(0)] AS sellerName,
            MAX(netTotal) AS invoiceAmount,
            MAX(orderBalance) AS orderBalance,
            ARRAY_AGG(paymentStatus ORDER BY paymentStatus LIMIT 1)[SAFE_OFFSET(0)] AS paymentStatus
          FROM RawData
          GROUP BY invoiceNumber
        ),
        SellerRevenue AS (
          SELECT
            sellerName AS name,
            COUNT(*) AS count,
            SUM(invoiceAmount) AS amount
          FROM InvoiceData
          WHERE invoiceAmount > 0
          GROUP BY name
        )
        SELECT
          ARRAY(SELECT AS STRUCT name, count, amount FROM ServiceRevenue ORDER BY amount DESC LIMIT 5) AS serviceRevenue,
          ARRAY(SELECT AS STRUCT name, count, amount FROM PackageRevenue ORDER BY amount DESC LIMIT 5) AS topPackages,
          (
            SELECT AS STRUCT
              COALESCE(SUM(amount), 0) AS totalAmount,
              COALESCE(SUM(count), 0) AS count
            FROM PackageRevenue
          ) AS packageSummary,
          ARRAY(SELECT AS STRUCT name, count, amount FROM SellerRevenue ORDER BY amount DESC LIMIT 8) AS sellerRevenue,
          ARRAY(SELECT AS STRUCT paymentMethod, count, amount FROM PaymentMethods ORDER BY amount DESC LIMIT 8) AS paymentMethods,
          (
            SELECT AS STRUCT
              COALESCE(SUM(IF(orderBalance > 0, orderBalance, 0)), 0) AS outstandingAmount,
              CAST(NULL AS FLOAT64) AS partialPaymentAmount,
              COUNTIF(orderBalance > 0 OR UPPER(paymentStatus) LIKE '%PARTIAL%') AS affectedInvoiceCount
            FROM InvoiceData
          ) AS outstanding
      `,
      {
        clinicCode: input.clinicCode,
        dateKey: input.dateKey,
      },
    );

    const row = rows[0];
    return buildDailyPaymentGrowthEvidenceFromAggregates({
      totalRevenue: input.totalRevenue,
      serviceRevenue: row?.serviceRevenue,
      topPackages: row?.topPackages,
      packageSummary: row?.packageSummary,
      sellerRevenue: row?.sellerRevenue,
      paymentMethods: row?.paymentMethods,
      outstanding: row?.outstanding,
    });
  } catch (error) {
    console.warn("[GT_V2Report][GT Growth AI] daily payment evidence query failed", {
      clinicCode: input.clinicCode,
      dateKey: input.dateKey,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return buildDailyPaymentGrowthEvidenceFromAggregates({
      totalRevenue: input.totalRevenue,
      dataQualityNotes: ["Service, package, seller, or method revenue evidence was unavailable from BigQuery."],
    });
  }
}

export async function getWeeklySummaryGrowthEvidence(input: {
  clinicCode: string;
  weekStartDateKey: string;
  weekEndDateKey: string;
  previousWeekStartDateKey: string;
  previousWeekEndDateKey: string;
  totalWeeklyRevenue: number;
  averageRevenuePerCompletedCustomer: number | null;
}) {
  const dataQualityNotes: string[] = [];
  let paymentEvidence: {
    packageSummary: AmountCountAggregate | null;
    topPackages: AggregateItem[] | null;
    serviceRevenue: AggregateItem[] | null;
  } | null = null;
  let rebookingEvidence: RebookingAggregate | null = null;

  try {
    const rows = await runAnalyticsQuery<{
      packageSummary: AmountCountAggregate | null;
      topPackages: AggregateItem[] | null;
      serviceRevenue: AggregateItem[] | null;
    }>(
      `
        WITH RawData AS (
          SELECT
            InvoiceNumber AS invoiceNumber,
            DATE(OrderCreatedDate) AS orderDate,
            COALESCE(NULLIF(TRIM(ServiceName), ''), 'Unknown service') AS serviceName,
            COALESCE(NULLIF(TRIM(ServicePackageName), ''), '') AS packageName,
            CAST(COALESCE(ItemTotal, SubTotal, NetTotal, PaymentAmount, 0) AS FLOAT64) AS itemAmount
          FROM ${analyticsTables.mainPaymentView}
          WHERE DATE(OrderCreatedDate) BETWEEN @previousWeekStartDateKey AND @weekEndDateKey
            AND LOWER(ClinicCode) = LOWER(@clinicCode)
        ),
        UniqueItems AS (
          SELECT DISTINCT
            invoiceNumber,
            orderDate,
            serviceName,
            packageName,
            itemAmount
          FROM RawData
          WHERE itemAmount > 0
        ),
        CurrentItems AS (
          SELECT * FROM UniqueItems
          WHERE orderDate BETWEEN @weekStartDateKey AND @weekEndDateKey
        ),
        PreviousItems AS (
          SELECT * FROM UniqueItems
          WHERE orderDate BETWEEN @previousWeekStartDateKey AND @previousWeekEndDateKey
        ),
        CurrentPackages AS (
          SELECT
            packageName AS name,
            COUNT(*) AS count,
            SUM(itemAmount) AS amount
          FROM CurrentItems
          WHERE packageName != ''
          GROUP BY name
        ),
        CurrentServices AS (
          SELECT
            serviceName AS name,
            COUNT(*) AS count,
            SUM(itemAmount) AS amount
          FROM CurrentItems
          GROUP BY name
        ),
        PreviousPackageSummary AS (
          SELECT COALESCE(SUM(itemAmount), 0) AS previousTotalAmount
          FROM PreviousItems
          WHERE packageName != ''
        )
        SELECT
          (
            SELECT AS STRUCT
              COALESCE(SUM(amount), 0) AS totalAmount,
              COALESCE(SUM(count), 0) AS count,
              (SELECT previousTotalAmount FROM PreviousPackageSummary) AS previousTotalAmount
            FROM CurrentPackages
          ) AS packageSummary,
          ARRAY(SELECT AS STRUCT name, count, amount FROM CurrentPackages ORDER BY amount DESC LIMIT 5) AS topPackages,
          ARRAY(SELECT AS STRUCT name, count, amount FROM CurrentServices ORDER BY amount DESC LIMIT 5) AS serviceRevenue
      `,
      {
        clinicCode: input.clinicCode,
        weekStartDateKey: input.weekStartDateKey,
        weekEndDateKey: input.weekEndDateKey,
        previousWeekStartDateKey: input.previousWeekStartDateKey,
        previousWeekEndDateKey: input.previousWeekEndDateKey,
      },
    );
    paymentEvidence = rows[0] ?? null;
  } catch (error) {
    console.warn("[GT_V2Report][GT Growth AI] weekly payment evidence query failed", {
      clinicCode: input.clinicCode,
      weekStartDateKey: input.weekStartDateKey,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    dataQualityNotes.push("Weekly package and service revenue evidence was unavailable from BigQuery.");
  }

  try {
    const rows = await runAnalyticsQuery<RebookingAggregate>(
      `
        WITH CompletedCustomers AS (
          SELECT
            CASE
              WHEN REGEXP_REPLACE(COALESCE(CustomerPhoneNumber, ''), r'[^0-9]', '') != ''
                THEN CONCAT('phone:', REGEXP_REPLACE(COALESCE(CustomerPhoneNumber, ''), r'[^0-9]', ''))
              ELSE CONCAT('name:', LOWER(TRIM(COALESCE(CustomerName, ''))))
            END AS customerKey
          FROM ${analyticsTables.mainDataView}
          WHERE DATE(CheckInTime) BETWEEN @weekStartDateKey AND @weekEndDateKey
            AND LOWER(ClinicCode) = LOWER(@clinicCode)
            AND CheckInTime IS NOT NULL
            AND COALESCE(CustomerName, '') != ''
          GROUP BY customerKey
        ),
        FutureCustomers AS (
          SELECT
            CASE
              WHEN REGEXP_REPLACE(COALESCE(CustomerPhoneNumber, ''), r'[^0-9]', '') != ''
                THEN CONCAT('phone:', REGEXP_REPLACE(COALESCE(CustomerPhoneNumber, ''), r'[^0-9]', ''))
              ELSE CONCAT('name:', LOWER(TRIM(COALESCE(CustomerName, ''))))
            END AS customerKey
          FROM ${analyticsTables.mainDataView}
          WHERE DATE(CheckInTime) > @weekEndDateKey
            AND DATE(CheckInTime) <= DATE_ADD(DATE(@weekEndDateKey), INTERVAL 60 DAY)
            AND LOWER(ClinicCode) = LOWER(@clinicCode)
            AND CheckInTime IS NOT NULL
            AND COALESCE(CustomerName, '') != ''
          GROUP BY customerKey
        )
        SELECT
          COUNT(*) AS completedCustomers,
          COUNTIF(future.customerKey IS NULL) AS customersWithoutFutureBooking
        FROM CompletedCustomers AS completed
        LEFT JOIN FutureCustomers AS future
          ON completed.customerKey = future.customerKey
      `,
      {
        clinicCode: input.clinicCode,
        weekStartDateKey: input.weekStartDateKey,
        weekEndDateKey: input.weekEndDateKey,
      },
    );
    rebookingEvidence = rows[0] ?? null;
  } catch (error) {
    console.warn("[GT_V2Report][GT Growth AI] weekly rebooking evidence query failed", {
      clinicCode: input.clinicCode,
      weekStartDateKey: input.weekStartDateKey,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    dataQualityNotes.push("Weekly customer rebooking opportunity evidence was unavailable from BigQuery.");
  }

  return buildWeeklySummaryGrowthEvidenceFromAggregates({
    totalWeeklyRevenue: input.totalWeeklyRevenue,
    averageRevenuePerCompletedCustomer: input.averageRevenuePerCompletedCustomer,
    packageSummary: paymentEvidence?.packageSummary,
    topPackages: paymentEvidence?.topPackages,
    serviceRevenue: paymentEvidence?.serviceRevenue,
    rebooking: rebookingEvidence,
    dataQualityNotes,
  });
}
