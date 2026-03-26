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

export async function getSalesBySellerReport(params: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
}) {
  const [sellerRows, transactionRows] = await Promise.all([
    runAnalyticsQuery<{
      sellerName: string;
      invoiceCount: number;
      totalAmount: number;
    }>(
      `
        SELECT
          COALESCE(SellerName, 'Unknown') AS sellerName,
          COUNT(DISTINCT InvoiceNumber) AS invoiceCount,
          COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS totalAmount
        FROM ${analyticsTables.mainPaymentView}
        WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
          AND PaymentStatus = 'PAID'
          AND PaymentMethod != 'PASS'
          AND LOWER(ClinicCode) = LOWER(@clinicCode)
        GROUP BY sellerName
        ORDER BY totalAmount DESC
      `,
      params,
    ),
    runAnalyticsQuery<{
      dateLabel: string;
      invoiceNumber: string;
      customerName: string;
      serviceName: string;
      sellerName: string;
      totalAmount: number;
    }>(
      `
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(OrderCreatedDate)) AS dateLabel,
          InvoiceNumber AS invoiceNumber,
          CustomerName AS customerName,
          ServiceName AS serviceName,
          COALESCE(SellerName, 'Unknown') AS sellerName,
          CAST(NetTotal AS FLOAT64) AS totalAmount
        FROM ${analyticsTables.mainPaymentView}
        WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
          AND PaymentStatus = 'PAID'
          AND PaymentMethod != 'PASS'
          AND LOWER(ClinicCode) = LOWER(@clinicCode)
        ORDER BY OrderCreatedDate DESC
        LIMIT 50
      `,
      params,
    ),
  ]);

  return {
    sellers: sellerRows.map((row) => ({
      sellerName: row.sellerName,
      invoiceCount: parseNumber(row.invoiceCount),
      totalAmount: parseNumber(row.totalAmount),
    })),
    recentTransactions: transactionRows.map((row) => ({
      dateLabel: row.dateLabel,
      invoiceNumber: row.invoiceNumber,
      customerName: row.customerName,
      serviceName: row.serviceName,
      sellerName: row.sellerName,
      totalAmount: parseNumber(row.totalAmount),
    })),
  };
}
