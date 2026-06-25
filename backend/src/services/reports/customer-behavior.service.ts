import { analyticsTables } from "../../config/bigquery.js";
import { runAnalyticsQuery } from "../bigquery.service.js";

function parseNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value && typeof value === "object" && "value" in value) {
    return Number((value as { value: unknown }).value);
  }
  return Number(value ?? 0);
}

function parseText(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return fallback;
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object" && "value" in value) {
    return parseText((value as { value: unknown }).value, fallback);
  }
  return fallback;
}

function normalizePhoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeSearchText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function maskPhone(value: string | null | undefined) {
  const digits = normalizePhoneDigits(value ?? "");

  if (digits.length < 5) {
    return digits ? "***" : "";
  }

  return `${digits.slice(0, 2)}***${digits.slice(-3)}`;
}

function getBucketExpression(granularity: "month" | "quarter" | "year") {
  if (granularity === "quarter") {
    return "CONCAT(EXTRACT(YEAR FROM DATE(CheckInTime)), '-Q', EXTRACT(QUARTER FROM DATE(CheckInTime)))";
  }
  if (granularity === "year") {
    return "CAST(EXTRACT(YEAR FROM DATE(CheckInTime)) AS STRING)";
  }
  return "FORMAT_DATE('%Y-%m', DATE(CheckInTime))";
}

export async function getCustomerBehaviorReport(params: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  granularity: "month" | "quarter" | "year";
}) {
  const bucketExpression = getBucketExpression(params.granularity);

  const [trendRows, topCustomerRows, summaryRows] = await Promise.all([
    runAnalyticsQuery<{
      bucket: string;
      uniqueCustomers: number;
      visits: number;
    }>(
      `
        SELECT
          ${bucketExpression} AS bucket,
          COUNT(DISTINCT CustomerName) AS uniqueCustomers,
          COUNT(*) AS visits
        FROM ${analyticsTables.mainDataView}
        WHERE DATE(CheckInTime) BETWEEN @fromDate AND @toDate
          AND CustomerName IS NOT NULL
          AND LOWER(ClinicCode) = LOWER(@clinicCode)
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      params,
    ),
    runAnalyticsQuery<{
      customerName: string;
      phoneNumber: string;
      memberId: string | null;
      visitCount: number;
      lastVisitDate: string;
    }>(
      `
        SELECT
          CustomerName AS customerName,
          COALESCE(CustomerPhoneNumber, '') AS phoneNumber,
          ARRAY_AGG(COALESCE(CAST(CustomerID AS STRING), '') ORDER BY CheckInTime DESC LIMIT 1)[SAFE_OFFSET(0)] AS memberId,
          COUNT(*) AS visitCount,
          FORMAT_DATE('%Y-%m-%d', MAX(DATE(CheckInTime))) AS lastVisitDate
        FROM ${analyticsTables.mainDataView}
        WHERE DATE(CheckInTime) BETWEEN @fromDate AND @toDate
          AND CustomerName IS NOT NULL
          AND LOWER(ClinicCode) = LOWER(@clinicCode)
        GROUP BY customerName, phoneNumber
        ORDER BY visitCount DESC, customerName ASC
        LIMIT 20
      `,
      params,
    ),
    runAnalyticsQuery<{
      uniqueCustomers: number;
      visits: number;
    }>(
      `
        SELECT
          COUNT(DISTINCT CustomerName) AS uniqueCustomers,
          COUNT(*) AS visits
        FROM ${analyticsTables.mainDataView}
        WHERE DATE(CheckInTime) BETWEEN @fromDate AND @toDate
          AND CustomerName IS NOT NULL
          AND LOWER(ClinicCode) = LOWER(@clinicCode)
      `,
      params,
    ),
  ]);

  const summaryRow = summaryRows[0];
  const uniqueCustomers = parseNumber(summaryRow?.uniqueCustomers);
  const visits = parseNumber(summaryRow?.visits);

  return {
    summary: {
      uniqueCustomers,
      visits,
      avgVisitsPerCustomer: uniqueCustomers > 0 ? Number((visits / uniqueCustomers).toFixed(2)) : 0,
    },
    trend: trendRows.map((row) => ({
      bucket: row.bucket,
      uniqueCustomers: parseNumber(row.uniqueCustomers),
      visits: parseNumber(row.visits),
    })),
    topCustomers: topCustomerRows.map((row) => ({
      customerName: parseText(row.customerName),
      phoneNumber: parseText(row.phoneNumber),
      phoneMasked: maskPhone(row.phoneNumber),
      memberId: parseText(row.memberId) || null,
      visitCount: parseNumber(row.visitCount),
      lastVisitDate: row.lastVisitDate,
      lastActivityDate: row.lastVisitDate,
    })),
  };
}

export async function searchCustomerBehaviorCustomers(params: {
  clinicCode: string;
  search: string;
  limit: number;
}) {
  const search = normalizeSearchText(params.search);
  const searchLower = search.toLowerCase();
  const searchDigits = normalizePhoneDigits(search);
  const limit = Math.min(Math.max(params.limit, 1), 50);

  if (!search) {
    return {
      query: "",
      rows: [],
    };
  }

  const rows = await runAnalyticsQuery<{
    customerName: string;
    phoneNumber: string;
    memberId: string | null;
    visitCount: number;
    firstActivityDate: string | null;
    lastVisitDate: string | null;
    lastActivityDate: string | null;
  }>(
    `
      WITH CustomerSources AS (
        SELECT
          CustomerName AS customerName,
          COALESCE(CustomerPhoneNumber, '') AS phoneNumber,
          COALESCE(CAST(CustomerID AS STRING), '') AS memberId,
          DATE(CheckInTime) AS activityDate,
          DATE(CheckInTime) AS visitDate,
          COALESCE(
            CAST(BookingID AS STRING),
            CONCAT(FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', CheckInTime), '-', COALESCE(ServiceName, ''))
          ) AS visitKey
        FROM ${analyticsTables.mainDataView}
        WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
          AND CustomerName IS NOT NULL
          AND CheckInTime IS NOT NULL
          AND (
            STRPOS(LOWER(CustomerName), @searchLower) > 0
            OR STRPOS(LOWER(COALESCE(CAST(CustomerID AS STRING), '')), @searchLower) > 0
            OR STRPOS(LOWER(COALESCE(CustomerPhoneNumber, '')), @searchLower) > 0
            OR (
              @searchDigits != ''
              AND STRPOS(REGEXP_REPLACE(COALESCE(CustomerPhoneNumber, ''), r'[^0-9]', ''), @searchDigits) > 0
            )
          )

        UNION ALL

        SELECT
          CustomerName AS customerName,
          COALESCE(CustomerPhoneNumber, '') AS phoneNumber,
          COALESCE(CAST(MemberID AS STRING), '') AS memberId,
          DATE(OrderCreatedDate) AS activityDate,
          CAST(NULL AS DATE) AS visitDate,
          CAST(NULL AS STRING) AS visitKey
        FROM ${analyticsTables.mainPaymentView}
        WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
          AND CustomerName IS NOT NULL
          AND OrderCreatedDate IS NOT NULL
          AND (
            STRPOS(LOWER(CustomerName), @searchLower) > 0
            OR STRPOS(LOWER(COALESCE(CAST(MemberID AS STRING), '')), @searchLower) > 0
            OR STRPOS(LOWER(COALESCE(CustomerPhoneNumber, '')), @searchLower) > 0
            OR (
              @searchDigits != ''
              AND STRPOS(REGEXP_REPLACE(COALESCE(CustomerPhoneNumber, ''), r'[^0-9]', ''), @searchDigits) > 0
            )
          )
      ),
      CustomerSummary AS (
        SELECT
          customerName,
          phoneNumber,
          ARRAY_AGG(NULLIF(memberId, '') IGNORE NULLS ORDER BY activityDate DESC LIMIT 1)[SAFE_OFFSET(0)] AS memberId,
          COUNT(DISTINCT visitKey) AS visitCount,
          FORMAT_DATE('%Y-%m-%d', MIN(activityDate)) AS firstActivityDate,
          FORMAT_DATE('%Y-%m-%d', MAX(visitDate)) AS lastVisitDate,
          FORMAT_DATE('%Y-%m-%d', MAX(activityDate)) AS lastActivityDate,
          REGEXP_REPLACE(COALESCE(phoneNumber, ''), r'[^0-9]', '') AS phoneDigits
        FROM CustomerSources
        GROUP BY customerName, phoneNumber
      )
      SELECT
        customerName,
        phoneNumber,
        memberId,
        visitCount,
        firstActivityDate,
        lastVisitDate,
        lastActivityDate
      FROM CustomerSummary
      ORDER BY
        CASE
          WHEN @searchDigits != '' AND phoneDigits = @searchDigits THEN 0
          WHEN LOWER(customerName) = @searchLower THEN 1
          WHEN @searchDigits != '' AND STARTS_WITH(phoneDigits, @searchDigits) THEN 2
          WHEN STARTS_WITH(LOWER(customerName), @searchLower) THEN 3
          WHEN STARTS_WITH(LOWER(COALESCE(memberId, '')), @searchLower) THEN 4
          ELSE 5
        END ASC,
        lastActivityDate DESC,
        visitCount DESC,
        customerName ASC
      LIMIT @limit
    `,
    {
      clinicCode: params.clinicCode,
      searchLower,
      searchDigits,
      limit,
    },
  );

  return {
    query: search,
    rows: rows.map((row) => ({
      customerName: parseText(row.customerName),
      phoneNumber: parseText(row.phoneNumber),
      phoneMasked: maskPhone(row.phoneNumber),
      memberId: parseText(row.memberId) || null,
      visitCount: parseNumber(row.visitCount),
      firstActivityDate: row.firstActivityDate,
      lastVisitDate: row.lastVisitDate,
      lastActivityDate: row.lastActivityDate,
    })),
  };
}
