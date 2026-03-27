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

export async function getServiceBehaviorReport(params: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  granularity: "month" | "quarter" | "year";
}) {
  const bucketExpression = getBucketExpression(params.granularity);

  const [trendRows, topServiceRows, practitionerRows, summaryRows] = await Promise.all([
    runAnalyticsQuery<{
      bucket: string;
      totalBookings: number;
    }>(
      `
        SELECT
          ${bucketExpression} AS bucket,
          COUNT(*) AS totalBookings
        FROM ${analyticsTables.mainDataView}
        WHERE DATE(CheckInTime) BETWEEN @fromDate AND @toDate
          AND ServiceName IS NOT NULL
          AND LOWER(ClinicCode) = LOWER(@clinicCode)
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      params,
    ),
    runAnalyticsQuery<{
      serviceName: string;
      bookingCount: number;
    }>(
      `
        SELECT
          ServiceName AS serviceName,
          COUNT(*) AS bookingCount
        FROM ${analyticsTables.mainDataView}
        WHERE DATE(CheckInTime) BETWEEN @fromDate AND @toDate
          AND ServiceName IS NOT NULL
          AND LOWER(ClinicCode) = LOWER(@clinicCode)
        GROUP BY serviceName
        ORDER BY bookingCount DESC, serviceName ASC
        LIMIT 20
      `,
      params,
    ),
    runAnalyticsQuery<{
      practitionerName: string;
      serviceName: string;
      bookingCount: number;
    }>(
      `
        SELECT
          PractitionerName AS practitionerName,
          ServiceName AS serviceName,
          COUNT(*) AS bookingCount
        FROM ${analyticsTables.mainDataView}
        WHERE DATE(CheckInTime) BETWEEN @fromDate AND @toDate
          AND ServiceName IS NOT NULL
          AND PractitionerName IS NOT NULL
          AND LOWER(ClinicCode) = LOWER(@clinicCode)
        GROUP BY practitionerName, serviceName
        ORDER BY bookingCount DESC
        LIMIT 24
      `,
      params,
    ),
    runAnalyticsQuery<{
      totalBookings: number;
      distinctServices: number;
    }>(
      `
        SELECT
          COUNT(*) AS totalBookings,
          COUNT(DISTINCT ServiceName) AS distinctServices
        FROM ${analyticsTables.mainDataView}
        WHERE DATE(CheckInTime) BETWEEN @fromDate AND @toDate
          AND ServiceName IS NOT NULL
          AND LOWER(ClinicCode) = LOWER(@clinicCode)
      `,
      params,
    ),
  ]);

  const summaryRow = summaryRows[0];
  const totalBookings = parseNumber(summaryRow?.totalBookings);
  const distinctServices = parseNumber(summaryRow?.distinctServices);

  return {
    summary: {
      totalBookings,
      distinctServices,
      avgBookingsPerService: distinctServices > 0 ? Number((totalBookings / distinctServices).toFixed(2)) : 0,
    },
    trend: trendRows.map((row) => ({
      bucket: row.bucket,
      totalBookings: parseNumber(row.totalBookings),
    })),
    topServices: topServiceRows.map((row) => ({
      serviceName: row.serviceName,
      bookingCount: parseNumber(row.bookingCount),
    })),
    practitionerServices: practitionerRows.map((row) => ({
      practitionerName: row.practitionerName,
      serviceName: row.serviceName,
      bookingCount: parseNumber(row.bookingCount),
    })),
  };
}
