import { analyticsTables } from "../../config/bigquery.js";
import { runAnalyticsQuery } from "../bigquery.service.js";
import { shiftRange } from "../../utils/date-range.js";

type MetricRow = {
  revenue: number;
  invoices: number;
  customers: number;
  appointments: number;
  servicesDelivered: number;
  newCustomers: number;
  returningCustomers: number;
};

type TrendGranularity = "day" | "week" | "month";

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

function normalizeText(value: unknown, fallback = "Unknown") {
  if (typeof value === "string") {
    return value.trim() || fallback;
  }

  if (value && typeof value === "object" && "value" in value) {
    return normalizeText((value as { value: unknown }).value, fallback);
  }

  return fallback;
}

function metricRow(row?: Partial<MetricRow>): MetricRow {
  return {
    revenue: parseNumber(row?.revenue),
    invoices: parseNumber(row?.invoices),
    customers: parseNumber(row?.customers),
    appointments: parseNumber(row?.appointments),
    servicesDelivered: parseNumber(row?.servicesDelivered),
    newCustomers: parseNumber(row?.newCustomers),
    returningCustomers: parseNumber(row?.returningCustomers),
  };
}

function percentageChange(current: number, previous: number) {
  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }

  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function averageValue(total: number, count: number) {
  if (count <= 0) {
    return 0;
  }

  return Number((total / count).toFixed(0));
}

function spanDays(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1);
}

function chooseTrendGranularity(fromDate: string, toDate: string): TrendGranularity {
  const days = spanDays(fromDate, toDate);

  if (days <= 45) {
    return "day";
  }

  if (days <= 180) {
    return "week";
  }

  return "month";
}

function trendBucketExpression(granularity: TrendGranularity) {
  if (granularity === "week") {
    return "DATE_TRUNC(DATE(OrderCreatedDate), WEEK(MONDAY))";
  }

  if (granularity === "month") {
    return "DATE_TRUNC(DATE(OrderCreatedDate), MONTH)";
  }

  return "DATE(OrderCreatedDate)";
}

function buildInsights(params: {
  totalRevenue: number;
  appointments: number;
  topServices: Array<{ serviceName: string; contributionPct: number; revenue: number }>;
  paymentMix: Array<{ paymentMethod: string; contributionPct: number; totalAmount: number }>;
  topTherapists: Array<{ therapistName: string; completedServices: number }>;
  trend: Array<{ bucketLabel: string; revenue: number }>;
  appointmentsChange: number;
  customersChange: number;
}) {
  const insights: Array<{
    title: string;
    detail: string;
    tone: "positive" | "watch" | "neutral";
  }> = [];

  const strongestDay = [...params.trend].sort((left, right) => right.revenue - left.revenue)[0];
  if (strongestDay && strongestDay.revenue > 0) {
    insights.push({
      title: "Strongest revenue period",
      detail: `${strongestDay.bucketLabel} produced the highest revenue in the selected range.`,
      tone: "positive",
    });
  }

  const topService = params.topServices[0];
  if (topService && topService.contributionPct > 0) {
    insights.push({
      title:
        topService.contributionPct >= 35
          ? "Service concentration to watch"
          : "Top service driver",
      detail: `${topService.serviceName} contributed ${topService.contributionPct.toFixed(1)}% of revenue.`,
      tone: topService.contributionPct >= 35 ? "watch" : "neutral",
    });
  }

  const topTherapist = params.topTherapists[0];
  if (topTherapist) {
    insights.push({
      title: "Therapist leading volume",
      detail: `${topTherapist.therapistName} handled ${topTherapist.completedServices.toLocaleString("en-US")} treatments in this period.`,
      tone: "neutral",
    });
  }

  const topMethod = params.paymentMix[0];
  if (topMethod && topMethod.contributionPct >= 55) {
    insights.push({
      title: "Payment concentration risk",
      detail: `${topMethod.paymentMethod} accounted for ${topMethod.contributionPct.toFixed(1)}% of collected revenue.`,
      tone: "watch",
    });
  }

  if (params.appointmentsChange < 0) {
    insights.push({
      title: "Appointments are softening",
      detail: `Booking volume is down ${Math.abs(params.appointmentsChange).toFixed(1)}% versus the previous period.`,
      tone: "watch",
    });
  }

  if (params.customersChange > 0 && params.totalRevenue > 0) {
    insights.push({
      title: "Customer momentum improved",
      detail: `Customer activity is up ${params.customersChange.toFixed(1)}% while revenue remained productive in this period.`,
      tone: "positive",
    });
  }

  return insights.slice(0, 3);
}

export async function getDashboardOverview(params: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
}) {
  const { clinicCode, fromDate, toDate } = params;
  const { previousFromDate, previousToDate } = shiftRange(fromDate, toDate);
  const granularity = chooseTrendGranularity(fromDate, toDate);
  const bucketExpression = trendBucketExpression(granularity);

  const metricsQuery = `
    WITH PaymentMetrics AS (
      SELECT
        COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS revenue,
        COUNT(DISTINCT InvoiceNumber) AS invoices
      FROM ${analyticsTables.mainPaymentView}
      WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
        AND PaymentStatus = 'PAID'
        AND COALESCE(PaymentMethod, '') != 'PASS'
        AND NOT STARTS_WITH(InvoiceNumber, 'CO-')
        AND LOWER(ClinicCode) = LOWER(@clinicCode)
    ),
    VisitScope AS (
      SELECT
        CustomerPhoneNumber AS phoneNumber,
        DATE(CheckInTime) AS visitDate,
        COALESCE(
          CAST(BookingID AS STRING),
          CONCAT(
            FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', CheckInTime),
            '-',
            COALESCE(ServiceName, ''),
            '-',
            COALESCE(CustomerPhoneNumber, '')
          )
        ) AS bookingKey
      FROM ${analyticsTables.mainDataView}
      WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
        AND CustomerPhoneNumber IS NOT NULL
        AND CheckInTime IS NOT NULL
    ),
    CustomerHistory AS (
      SELECT
        phoneNumber,
        MIN(visitDate) AS firstVisitDate
      FROM VisitScope
      GROUP BY phoneNumber
    ),
    CurrentVisits AS (
      SELECT *
      FROM VisitScope
      WHERE visitDate BETWEEN @fromDate AND @toDate
    ),
    VisitMetrics AS (
      SELECT
        COUNT(DISTINCT CurrentVisits.phoneNumber) AS customers,
        COUNT(DISTINCT CurrentVisits.bookingKey) AS appointments,
        COUNT(*) AS servicesDelivered,
        COUNT(
          DISTINCT IF(CustomerHistory.firstVisitDate BETWEEN @fromDate AND @toDate, CurrentVisits.phoneNumber, NULL)
        ) AS newCustomers,
        COUNT(
          DISTINCT IF(CustomerHistory.firstVisitDate < @fromDate, CurrentVisits.phoneNumber, NULL)
        ) AS returningCustomers
      FROM CurrentVisits
      LEFT JOIN CustomerHistory USING (phoneNumber)
    )
    SELECT
      PaymentMetrics.revenue,
      PaymentMetrics.invoices,
      VisitMetrics.customers,
      VisitMetrics.appointments,
      VisitMetrics.servicesDelivered,
      VisitMetrics.newCustomers,
      VisitMetrics.returningCustomers
    FROM PaymentMetrics, VisitMetrics
  `;

  const [currentMetricRows, previousMetricRows, currentTrendRows, previousTrendRows, topServicesRows, paymentMixRows, topTherapistRows] =
    await Promise.all([
      runAnalyticsQuery<MetricRow>(metricsQuery, {
        clinicCode,
        fromDate,
        toDate,
      }),
      runAnalyticsQuery<MetricRow>(metricsQuery, {
        clinicCode,
        fromDate: previousFromDate,
        toDate: previousToDate,
      }),
      runAnalyticsQuery<{
        bucketLabel: string;
        revenue: number;
      }>(
        `
          SELECT
            FORMAT_DATE('%Y-%m-%d', ${bucketExpression}) AS bucketLabel,
            COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS revenue
          FROM ${analyticsTables.mainPaymentView}
          WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
            AND PaymentStatus = 'PAID'
            AND COALESCE(PaymentMethod, '') != 'PASS'
            AND NOT STARTS_WITH(InvoiceNumber, 'CO-')
            AND LOWER(ClinicCode) = LOWER(@clinicCode)
          GROUP BY bucketLabel
          ORDER BY bucketLabel ASC
        `,
        { clinicCode, fromDate, toDate },
      ),
      runAnalyticsQuery<{
        bucketLabel: string;
        revenue: number;
      }>(
        `
          SELECT
            FORMAT_DATE('%Y-%m-%d', ${bucketExpression}) AS bucketLabel,
            COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS revenue
          FROM ${analyticsTables.mainPaymentView}
          WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
            AND PaymentStatus = 'PAID'
            AND COALESCE(PaymentMethod, '') != 'PASS'
            AND NOT STARTS_WITH(InvoiceNumber, 'CO-')
            AND LOWER(ClinicCode) = LOWER(@clinicCode)
          GROUP BY bucketLabel
          ORDER BY bucketLabel ASC
        `,
        { clinicCode, fromDate: previousFromDate, toDate: previousToDate },
      ),
      runAnalyticsQuery<{
        serviceName: string;
        revenue: number;
        bookings: number;
      }>(
        `
          SELECT
            COALESCE(ServiceName, 'Unknown') AS serviceName,
            COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS revenue,
            COUNT(*) AS bookings
          FROM ${analyticsTables.mainPaymentView}
          WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
            AND PaymentStatus = 'PAID'
            AND COALESCE(PaymentMethod, '') != 'PASS'
            AND NOT STARTS_WITH(InvoiceNumber, 'CO-')
            AND COALESCE(ServiceName, '') != ''
            AND LOWER(ClinicCode) = LOWER(@clinicCode)
          GROUP BY serviceName
          ORDER BY revenue DESC, bookings DESC, serviceName ASC
          LIMIT 6
        `,
        { clinicCode, fromDate, toDate },
      ),
      runAnalyticsQuery<{
        paymentMethod: string;
        totalAmount: number;
        transactionCount: number;
      }>(
        `
          SELECT
            COALESCE(PaymentMethod, 'Unknown') AS paymentMethod,
            COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS totalAmount,
            COUNT(*) AS transactionCount
          FROM ${analyticsTables.mainPaymentView}
          WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
            AND PaymentStatus = 'PAID'
            AND COALESCE(PaymentMethod, '') != 'PASS'
            AND NOT STARTS_WITH(InvoiceNumber, 'CO-')
            AND LOWER(ClinicCode) = LOWER(@clinicCode)
          GROUP BY paymentMethod
          ORDER BY totalAmount DESC, transactionCount DESC, paymentMethod ASC
        `,
        { clinicCode, fromDate, toDate },
      ),
      runAnalyticsQuery<{
        therapistName: string;
        completedServices: number;
        serviceValue: number;
        lastVisitDate: string;
      }>(
        `
          SELECT
            COALESCE(PractitionerName, 'Unknown') AS therapistName,
            COUNT(*) AS completedServices,
            COALESCE(SUM(CAST(COALESCE(Price, 0) AS FLOAT64)), 0) AS serviceValue,
            FORMAT_DATE('%Y-%m-%d', MAX(DATE(CheckInTime))) AS lastVisitDate
          FROM ${analyticsTables.mainDataView}
          WHERE DATE(CheckInTime) BETWEEN @fromDate AND @toDate
            AND COALESCE(PractitionerName, '') != ''
            AND LOWER(ClinicCode) = LOWER(@clinicCode)
          GROUP BY therapistName
          ORDER BY completedServices DESC, serviceValue DESC, therapistName ASC
          LIMIT 6
        `,
        { clinicCode, fromDate, toDate },
      ),
    ]);

  const current = metricRow(currentMetricRows[0]);
  const previous = metricRow(previousMetricRows[0]);
  const currentAverageInvoice = averageValue(current.revenue, current.invoices);
  const previousAverageInvoice = averageValue(previous.revenue, previous.invoices);
  const revenueTotal = current.revenue || 1;

  const trendPointCount = Math.max(currentTrendRows.length, previousTrendRows.length);
  const trendPoints = Array.from({ length: trendPointCount }, (_, index) => ({
    bucketLabel:
      normalizeText(currentTrendRows[index]?.bucketLabel, normalizeText(previousTrendRows[index]?.bucketLabel, "")),
    revenue: parseNumber(currentTrendRows[index]?.revenue),
    previousRevenue: parseNumber(previousTrendRows[index]?.revenue),
  })).filter((row) => row.bucketLabel !== "");

  const topServices = topServicesRows.map((row) => {
    const revenue = parseNumber(row.revenue);
    return {
      serviceName: normalizeText(row.serviceName),
      revenue,
      bookings: parseNumber(row.bookings),
      contributionPct: Number(((revenue / revenueTotal) * 100).toFixed(1)),
    };
  });

  const paymentMix = paymentMixRows.map((row) => {
    const totalAmount = parseNumber(row.totalAmount);
    return {
      paymentMethod: normalizeText(row.paymentMethod),
      totalAmount,
      transactionCount: parseNumber(row.transactionCount),
      contributionPct: Number(((totalAmount / revenueTotal) * 100).toFixed(1)),
    };
  });

  const topTherapists = topTherapistRows.map((row) => ({
    therapistName: normalizeText(row.therapistName),
    completedServices: parseNumber(row.completedServices),
    serviceValue: parseNumber(row.serviceValue),
    lastVisitDate: normalizeText(row.lastVisitDate, ""),
  }));

  const appointmentsPerDay = current.appointments / Math.max(1, spanDays(fromDate, toDate));
  const repeatRate = current.customers === 0 ? 0 : (current.returningCustomers / current.customers) * 100;

  return {
    summary: {
      revenue: {
        value: current.revenue,
        previousValue: previous.revenue,
        change: percentageChange(current.revenue, previous.revenue),
      },
      invoices: {
        value: current.invoices,
        previousValue: previous.invoices,
        change: percentageChange(current.invoices, previous.invoices),
      },
      customers: {
        value: current.customers,
        previousValue: previous.customers,
        change: percentageChange(current.customers, previous.customers),
      },
      appointments: {
        value: current.appointments,
        previousValue: previous.appointments,
        change: percentageChange(current.appointments, previous.appointments),
      },
      servicesDelivered: {
        value: current.servicesDelivered,
        previousValue: previous.servicesDelivered,
        change: percentageChange(current.servicesDelivered, previous.servicesDelivered),
      },
      averageInvoice: {
        value: currentAverageInvoice,
        previousValue: previousAverageInvoice,
        change: percentageChange(currentAverageInvoice, previousAverageInvoice),
      },
    },
    trend: {
      granularity,
      points: trendPoints,
    },
    spotlights: [
      {
        title: "Active customers",
        value: current.customers,
        change: percentageChange(current.customers, previous.customers),
        detail: `${current.newCustomers.toLocaleString("en-US")} new profiles entered care in this range.`,
      },
      {
        title: "Appointment pace",
        value: current.appointments,
        change: percentageChange(current.appointments, previous.appointments),
        detail: `${appointmentsPerDay.toFixed(1)} appointments per active day.`,
      },
      {
        title: "Returning customers",
        value: current.returningCustomers,
        change: percentageChange(current.returningCustomers, previous.returningCustomers),
        detail: `${repeatRate.toFixed(1)}% of active customers came back for repeat care.`,
      },
    ],
    topServices,
    paymentMix,
    topTherapists,
    insights: buildInsights({
      totalRevenue: current.revenue,
      appointments: current.appointments,
      topServices,
      paymentMix,
      topTherapists,
      trend: trendPoints,
      appointmentsChange: percentageChange(current.appointments, previous.appointments),
      customersChange: percentageChange(current.customers, previous.customers),
    }),
  };
}
