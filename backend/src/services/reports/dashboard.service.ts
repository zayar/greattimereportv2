import { analyticsTables } from "../../config/bigquery.js";
import { runAnalyticsQuery } from "../bigquery.service.js";
import { shiftRange } from "../../utils/date-range.js";

type MetricRow = {
  revenue: number;
  invoices: number;
  customers: number;
  appointments: number;
  services: number;
};

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

function metricRow(row?: Partial<MetricRow>): MetricRow {
  return {
    revenue: parseNumber(row?.revenue),
    invoices: parseNumber(row?.invoices),
    customers: parseNumber(row?.customers),
    appointments: parseNumber(row?.appointments),
    services: parseNumber(row?.services),
  };
}

function percentageChange(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }

  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export async function getDashboardOverview(params: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
}) {
  const { clinicCode, fromDate, toDate } = params;
  const { previousFromDate, previousToDate } = shiftRange(fromDate, toDate);

  const currentMetricsQuery = `
    WITH payment_metrics AS (
      SELECT
        COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS revenue,
        COUNT(DISTINCT InvoiceNumber) AS invoices,
        COUNT(DISTINCT CustomerPhoneNumber) AS customers
      FROM ${analyticsTables.mainPaymentView}
      WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
        AND PaymentStatus = 'PAID'
        AND PaymentMethod != 'PASS'
        AND LOWER(ClinicCode) = LOWER(@clinicCode)
    ),
    activity_metrics AS (
      SELECT
        COUNT(*) AS appointments,
        COUNT(DISTINCT ServiceName) AS services
      FROM ${analyticsTables.mainDataView}
      WHERE DATE(CheckInTime) BETWEEN @fromDate AND @toDate
        AND LOWER(ClinicCode) = LOWER(@clinicCode)
    )
    SELECT
      payment_metrics.revenue,
      payment_metrics.invoices,
      payment_metrics.customers,
      activity_metrics.appointments,
      activity_metrics.services
    FROM payment_metrics, activity_metrics
  `;

  const [currentMetricsRows, previousMetricsRows, revenueTrendRows, paymentMixRows, topServicesRows] =
    await Promise.all([
      runAnalyticsQuery<MetricRow>(currentMetricsQuery, {
        clinicCode,
        fromDate,
        toDate,
      }),
      runAnalyticsQuery<MetricRow>(currentMetricsQuery, {
        clinicCode,
        fromDate: previousFromDate,
        toDate: previousToDate,
      }),
      runAnalyticsQuery<{
        dateLabel: string;
        revenue: number;
      }>(
        `
          SELECT
            FORMAT_DATE('%Y-%m-%d', DATE(OrderCreatedDate)) AS dateLabel,
            COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS revenue
          FROM ${analyticsTables.mainPaymentView}
          WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
            AND PaymentStatus = 'PAID'
            AND PaymentMethod != 'PASS'
            AND LOWER(ClinicCode) = LOWER(@clinicCode)
          GROUP BY dateLabel
          ORDER BY dateLabel ASC
        `,
        { clinicCode, fromDate, toDate },
      ),
      runAnalyticsQuery<{
        paymentMethod: string;
        totalAmount: number;
      }>(
        `
          SELECT
            COALESCE(PaymentMethod, 'UNKNOWN') AS paymentMethod,
            COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS totalAmount
          FROM ${analyticsTables.mainPaymentView}
          WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
            AND PaymentStatus = 'PAID'
            AND LOWER(ClinicCode) = LOWER(@clinicCode)
          GROUP BY paymentMethod
          ORDER BY totalAmount DESC
        `,
        { clinicCode, fromDate, toDate },
      ),
      runAnalyticsQuery<{
        serviceName: string;
        revenue: number;
        invoices: number;
      }>(
        `
          SELECT
            ServiceName AS serviceName,
            COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS revenue,
            COUNT(DISTINCT InvoiceNumber) AS invoices
          FROM ${analyticsTables.mainPaymentView}
          WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
            AND PaymentStatus = 'PAID'
            AND PaymentMethod != 'PASS'
            AND ServiceName IS NOT NULL
            AND LOWER(ClinicCode) = LOWER(@clinicCode)
          GROUP BY serviceName
          ORDER BY revenue DESC
          LIMIT 6
        `,
        { clinicCode, fromDate, toDate },
      ),
    ]);

  const current = metricRow(currentMetricsRows[0]);
  const previous = metricRow(previousMetricsRows[0]);

  return {
    summary: {
      revenue: current.revenue,
      revenueChange: percentageChange(current.revenue, previous.revenue),
      invoices: current.invoices,
      invoicesChange: percentageChange(current.invoices, previous.invoices),
      customers: current.customers,
      customersChange: percentageChange(current.customers, previous.customers),
      appointments: current.appointments,
      appointmentsChange: percentageChange(current.appointments, previous.appointments),
      activeServices: current.services,
      activeServicesChange: percentageChange(current.services, previous.services),
    },
    revenueTrend: revenueTrendRows.map((row) => ({
      dateLabel: row.dateLabel,
      revenue: parseNumber(row.revenue),
    })),
    paymentMix: paymentMixRows.map((row) => ({
      paymentMethod: row.paymentMethod,
      totalAmount: parseNumber(row.totalAmount),
    })),
    topServices: topServicesRows.map((row) => ({
      serviceName: row.serviceName,
      revenue: parseNumber(row.revenue),
      invoices: parseNumber(row.invoices),
    })),
  };
}
