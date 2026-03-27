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
      visitCount: number;
      lastVisitDate: string;
    }>(
      `
        SELECT
          CustomerName AS customerName,
          COUNT(*) AS visitCount,
          FORMAT_DATE('%Y-%m-%d', MAX(DATE(CheckInTime))) AS lastVisitDate
        FROM ${analyticsTables.mainDataView}
        WHERE DATE(CheckInTime) BETWEEN @fromDate AND @toDate
          AND CustomerName IS NOT NULL
          AND LOWER(ClinicCode) = LOWER(@clinicCode)
        GROUP BY customerName
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
      customerName: row.customerName,
      visitCount: parseNumber(row.visitCount),
      lastVisitDate: row.lastVisitDate,
    })),
  };
}
