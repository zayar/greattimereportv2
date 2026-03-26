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

const paidSalesWhere = `
  DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
    AND PaymentStatus = 'PAID'
    AND PaymentMethod != 'PASS'
    AND LOWER(ClinicCode) = LOWER(@clinicCode)
`;

export async function getSalesReport(params: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  search: string;
  limit: number;
  offset: number;
}) {
  const rowsWhere = `
    ${paidSalesWhere}
      AND (
        @search = ''
        OR LOWER(CustomerName) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(InvoiceNumber) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(SellerName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(ServiceName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
      )
  `;

  const [summaryRows, trendRows, topServiceRows, rows, totalRows] = await Promise.all([
    runAnalyticsQuery<{
      totalRevenue: number;
      invoiceCount: number;
      customerCount: number;
      averageInvoice: number;
    }>(
      `
        SELECT
          COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS totalRevenue,
          COUNT(DISTINCT InvoiceNumber) AS invoiceCount,
          COUNT(DISTINCT CustomerPhoneNumber) AS customerCount,
          COALESCE(AVG(CAST(NetTotal AS FLOAT64)), 0) AS averageInvoice
        FROM ${analyticsTables.mainPaymentView}
        WHERE ${paidSalesWhere}
      `,
      params,
    ),
    runAnalyticsQuery<{
      dateLabel: string;
      totalRevenue: number;
      invoiceCount: number;
    }>(
      `
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(OrderCreatedDate)) AS dateLabel,
          COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS totalRevenue,
          COUNT(DISTINCT InvoiceNumber) AS invoiceCount
        FROM ${analyticsTables.mainPaymentView}
        WHERE ${paidSalesWhere}
        GROUP BY dateLabel
        ORDER BY dateLabel ASC
      `,
      params,
    ),
    runAnalyticsQuery<{
      serviceName: string;
      totalRevenue: number;
      invoiceCount: number;
    }>(
      `
        SELECT
          COALESCE(ServiceName, 'Unknown') AS serviceName,
          COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS totalRevenue,
          COUNT(DISTINCT InvoiceNumber) AS invoiceCount
        FROM ${analyticsTables.mainPaymentView}
        WHERE ${paidSalesWhere}
        GROUP BY serviceName
        ORDER BY totalRevenue DESC
        LIMIT 8
      `,
      params,
    ),
    runAnalyticsQuery<{
      dateLabel: string;
      invoiceNumber: string;
      customerName: string;
      salePerson: string;
      serviceName: string;
      paymentMethod: string;
      totalAmount: number;
    }>(
      `
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(OrderCreatedDate)) AS dateLabel,
          InvoiceNumber AS invoiceNumber,
          CustomerName AS customerName,
          COALESCE(SellerName, 'Unknown') AS salePerson,
          COALESCE(ServiceName, 'Unknown') AS serviceName,
          COALESCE(PaymentMethod, 'Unknown') AS paymentMethod,
          CAST(NetTotal AS FLOAT64) AS totalAmount
        FROM ${analyticsTables.mainPaymentView}
        WHERE ${rowsWhere}
        ORDER BY OrderCreatedDate DESC
        LIMIT @limit
        OFFSET @offset
      `,
      params,
    ),
    runAnalyticsQuery<{ totalCount: number }>(
      `
        SELECT COUNT(*) AS totalCount
        FROM ${analyticsTables.mainPaymentView}
        WHERE ${rowsWhere}
      `,
      params,
    ),
  ]);

  const summary = summaryRows[0];

  return {
    summary: {
      totalRevenue: parseNumber(summary?.totalRevenue),
      invoiceCount: parseNumber(summary?.invoiceCount),
      customerCount: parseNumber(summary?.customerCount),
      averageInvoice: parseNumber(summary?.averageInvoice),
    },
    trend: trendRows.map((row) => ({
      dateLabel: row.dateLabel,
      totalRevenue: parseNumber(row.totalRevenue),
      invoiceCount: parseNumber(row.invoiceCount),
    })),
    topServices: topServiceRows.map((row) => ({
      serviceName: row.serviceName,
      totalRevenue: parseNumber(row.totalRevenue),
      invoiceCount: parseNumber(row.invoiceCount),
    })),
    rows: rows.map((row) => ({
      dateLabel: row.dateLabel,
      invoiceNumber: row.invoiceNumber,
      customerName: row.customerName,
      salePerson: row.salePerson,
      serviceName: row.serviceName,
      paymentMethod: row.paymentMethod,
      totalAmount: parseNumber(row.totalAmount),
    })),
    totalCount: parseNumber(totalRows[0]?.totalCount),
  };
}
