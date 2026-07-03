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

type MatrixRow = {
  therapistName: string;
  serviceDetails: Array<{
    serviceName: string;
    serviceCount: number;
  }>;
  totalServices: number;
};

type RecordRow = {
  checkInTime: string;
  therapistName: string;
  serviceName: string;
  customerName: string;
  customerPhone?: string | null;
};

type SummaryRow = {
  totalTreatments: number;
  therapists: number;
  uniqueServices: number;
  distinctCustomers: number;
};

export async function getTreatmentReportRange(params: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  serviceName?: string;
  practitionerName?: string;
}) {
  const queryParams = {
    clinicCode: params.clinicCode,
    fromDate: params.fromDate,
    toDate: params.toDate,
    serviceName: params.serviceName ?? "",
    practitionerName: params.practitionerName ?? "",
  };

  const [matrixRows, recordRows, summaryRows] = await Promise.all([
    runAnalyticsQuery<MatrixRow>(
      `
        WITH service_matrix AS (
          SELECT
            COALESCE(PractitionerName, 'Unknown') AS therapistName,
            ServiceName AS serviceName,
            COUNT(*) AS serviceCount
          FROM ${analyticsTables.mainDataView}
          WHERE DATE(CheckInTime) BETWEEN @fromDate AND @toDate
            AND ServiceName IS NOT NULL
            AND LOWER(ClinicCode) = LOWER(@clinicCode)
            AND (@serviceName = '' OR LOWER(ServiceName) LIKE CONCAT('%', LOWER(@serviceName), '%'))
            AND (@practitionerName = '' OR LOWER(COALESCE(PractitionerName, '')) LIKE CONCAT('%', LOWER(@practitionerName), '%'))
          GROUP BY therapistName, serviceName
        )
        SELECT
          therapistName,
          ARRAY_AGG(STRUCT(serviceName, serviceCount) ORDER BY serviceName) AS serviceDetails,
          SUM(serviceCount) AS totalServices
        FROM service_matrix
        GROUP BY therapistName
        ORDER BY therapistName ASC
      `,
      queryParams,
    ),
    runAnalyticsQuery<RecordRow>(
      `
        SELECT
          FORMAT_TIMESTAMP('%Y-%m-%d %I:%M %p', CheckInTime) AS checkInTime,
          COALESCE(PractitionerName, 'Unknown') AS therapistName,
          ServiceName AS serviceName,
          CustomerName AS customerName,
          CustomerPhoneNumber AS customerPhone
        FROM ${analyticsTables.mainDataView}
        WHERE DATE(CheckInTime) BETWEEN @fromDate AND @toDate
          AND ServiceName IS NOT NULL
          AND LOWER(ClinicCode) = LOWER(@clinicCode)
          AND (@serviceName = '' OR LOWER(ServiceName) LIKE CONCAT('%', LOWER(@serviceName), '%'))
          AND (@practitionerName = '' OR LOWER(COALESCE(PractitionerName, '')) LIKE CONCAT('%', LOWER(@practitionerName), '%'))
        ORDER BY CheckInTime DESC
        LIMIT 500
      `,
      queryParams,
    ),
    runAnalyticsQuery<SummaryRow>(
      `
        SELECT
          COUNT(*) AS totalTreatments,
          COUNT(DISTINCT COALESCE(PractitionerName, 'Unknown')) AS therapists,
          COUNT(DISTINCT ServiceName) AS uniqueServices,
          COUNT(DISTINCT CONCAT(COALESCE(CustomerPhoneNumber, ''), '|', COALESCE(CustomerName, ''))) AS distinctCustomers
        FROM ${analyticsTables.mainDataView}
        WHERE DATE(CheckInTime) BETWEEN @fromDate AND @toDate
          AND ServiceName IS NOT NULL
          AND LOWER(ClinicCode) = LOWER(@clinicCode)
          AND (@serviceName = '' OR LOWER(ServiceName) LIKE CONCAT('%', LOWER(@serviceName), '%'))
          AND (@practitionerName = '' OR LOWER(COALESCE(PractitionerName, '')) LIKE CONCAT('%', LOWER(@practitionerName), '%'))
      `,
      queryParams,
    ),
  ]);

  const serviceTotals = new Map<string, number>();
  const matrix = matrixRows.map((row) => {
    const services = Object.fromEntries(
      (row.serviceDetails ?? []).map((detail) => {
        const count = parseNumber(detail.serviceCount);
        serviceTotals.set(detail.serviceName, (serviceTotals.get(detail.serviceName) ?? 0) + count);
        return [detail.serviceName, count];
      }),
    );

    return {
      therapistName: row.therapistName,
      services,
      totalServices: parseNumber(row.totalServices),
    };
  });

  const uniqueServices = [...serviceTotals.keys()].sort((left, right) => left.localeCompare(right));
  const summary = summaryRows[0];
  const matrixTotalTreatments = matrix.reduce((sum, row) => sum + row.totalServices, 0);

  return {
    selectedDate: params.toDate,
    selectedFromDate: params.fromDate,
    selectedToDate: params.toDate,
    summary: {
      totalTreatments: summary ? parseNumber(summary.totalTreatments) : matrixTotalTreatments,
      therapists: summary ? parseNumber(summary.therapists) : matrix.length,
      uniqueServices: summary ? parseNumber(summary.uniqueServices) : uniqueServices.length,
      distinctCustomers: summary ? parseNumber(summary.distinctCustomers) : 0,
    },
    uniqueServices,
    serviceTotals: uniqueServices.map((serviceName) => ({
      serviceName,
      totalServices: serviceTotals.get(serviceName) ?? 0,
    })),
    matrix,
    records: recordRows.map((row) => ({
      checkInTime: row.checkInTime,
      therapistName: row.therapistName,
      serviceName: row.serviceName,
      customerName: row.customerName,
      customerPhone: row.customerPhone ?? null,
    })),
  };
}

export async function getDailyTreatmentReport(params: {
  clinicCode: string;
  date: string;
}) {
  const report = await getTreatmentReportRange({
    clinicCode: params.clinicCode,
    fromDate: params.date,
    toDate: params.date,
  });

  return {
    ...report,
    selectedDate: params.date,
  };
}
