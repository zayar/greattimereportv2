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
  sellerName: string;
  search: string;
  limit: number;
  offset: number;
}) {
  const summaryWhere = `
    DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
      AND PaymentStatus = 'PAID'
      AND PaymentMethod != 'PASS'
      AND NOT STARTS_WITH(InvoiceNumber, 'CO-')
      AND LOWER(ClinicCode) = LOWER(@clinicCode)
  `;

  const detailWhere = `
    ${summaryWhere}
      AND (
        @sellerName = ''
        OR LOWER(COALESCE(SellerName, 'Unknown')) = LOWER(@sellerName)
      )
      AND (
        @search = ''
        OR LOWER(COALESCE(CustomerName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(InvoiceNumber, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(ServiceName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(ServicePackageName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(SellerName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
      )
  `;

  const [sellerRows, transactionRows, totalRows] = await Promise.all([
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
        WHERE ${summaryWhere}
        GROUP BY sellerName
        ORDER BY totalAmount DESC, sellerName ASC
      `,
      params,
    ),
    runAnalyticsQuery<{
      dateLabel: string;
      invoiceNumber: string;
      customerName: string;
      serviceName: string;
      servicePackageName: string | null;
      sellerName: string;
      paymentMethod: string;
      paymentStatus: string;
      totalAmount: number;
    }>(
      `
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(OrderCreatedDate)) AS dateLabel,
          InvoiceNumber AS invoiceNumber,
          CustomerName AS customerName,
          COALESCE(ServiceName, '') AS serviceName,
          ServicePackageName AS servicePackageName,
          COALESCE(SellerName, 'Unknown') AS sellerName,
          COALESCE(PaymentMethod, 'Unknown') AS paymentMethod,
          COALESCE(PaymentStatus, '') AS paymentStatus,
          CAST(NetTotal AS FLOAT64) AS totalAmount
        FROM ${analyticsTables.mainPaymentView}
        WHERE ${detailWhere}
        ORDER BY OrderCreatedDate DESC, InvoiceNumber DESC
        LIMIT @limit
        OFFSET @offset
      `,
      params,
    ),
    runAnalyticsQuery<{
      totalCount: number;
    }>(
      `
        SELECT COUNT(*) AS totalCount
        FROM ${analyticsTables.mainPaymentView}
        WHERE ${detailWhere}
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
      servicePackageName: row.servicePackageName,
      sellerName: row.sellerName,
      paymentMethod: row.paymentMethod,
      paymentStatus: row.paymentStatus,
      totalAmount: parseNumber(row.totalAmount),
    })),
    totalCount: parseNumber(totalRows[0]?.totalCount),
  };
}
