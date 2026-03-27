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

export async function getPaymentReport(params: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  search: string;
  limit: number;
  offset: number;
}) {
  const baseWhere = `
    DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
      AND PaymentStatus = 'PAID'
      AND LOWER(ClinicCode) = LOWER(@clinicCode)
      AND (
        @search = ''
        OR LOWER(CustomerName) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(InvoiceNumber) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(SellerName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
      )
  `;

  const [summaryRows, methodRows, rows, totalRows] = await Promise.all([
    runAnalyticsQuery<{
      totalAmount: number;
      invoiceCount: number;
      methodsCount: number;
      averageInvoice: number;
    }>(
      `
        SELECT
          COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS totalAmount,
          COUNT(DISTINCT InvoiceNumber) AS invoiceCount,
          COUNT(DISTINCT COALESCE(PaymentMethod, 'Unknown')) AS methodsCount,
          COALESCE(AVG(CAST(NetTotal AS FLOAT64)), 0) AS averageInvoice
        FROM ${analyticsTables.mainPaymentView}
        WHERE ${baseWhere}
      `,
      params,
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
        WHERE ${baseWhere}
        GROUP BY paymentMethod
        ORDER BY totalAmount DESC
      `,
      params,
    ),
    runAnalyticsQuery<{
      dateLabel: string;
      invoiceNumber: string;
      customerName: string;
      memberId: string;
      salePerson: string;
      serviceName: string;
      servicePackageName: string | null;
      paymentMethod: string | null;
      paymentStatus: string | null;
      walletTopUp: string | null;
      invoiceNetTotal: number;
    }>(
      `
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(OrderCreatedDate)) AS dateLabel,
          InvoiceNumber AS invoiceNumber,
          CustomerName AS customerName,
          MemberId AS memberId,
          COALESCE(SellerName, 'Unknown') AS salePerson,
          ServiceName AS serviceName,
          ServicePackageName AS servicePackageName,
          PaymentMethod AS paymentMethod,
          PaymentStatus AS paymentStatus,
          WalletTopUp AS walletTopUp,
          CAST(NetTotal AS FLOAT64) AS invoiceNetTotal
        FROM ${analyticsTables.mainPaymentView}
        WHERE ${baseWhere}
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
        WHERE ${baseWhere}
      `,
      params,
    ),
  ]);

  return {
    summary: {
      totalAmount: parseNumber(summaryRows[0]?.totalAmount),
      invoiceCount: parseNumber(summaryRows[0]?.invoiceCount),
      methodsCount: parseNumber(summaryRows[0]?.methodsCount),
      averageInvoice: parseNumber(summaryRows[0]?.averageInvoice),
    },
    methods: methodRows.map((row) => ({
      paymentMethod: row.paymentMethod,
      totalAmount: parseNumber(row.totalAmount),
      transactionCount: parseNumber(row.transactionCount),
    })),
    rows: rows.map((row) => ({
      dateLabel: row.dateLabel,
      invoiceNumber: row.invoiceNumber,
      customerName: row.customerName,
      memberId: row.memberId,
      salePerson: row.salePerson,
      serviceName: row.serviceName,
      servicePackageName: row.servicePackageName,
      paymentMethod: row.paymentMethod,
      paymentStatus: row.paymentStatus,
      walletTopUp: row.walletTopUp,
      invoiceNetTotal: parseNumber(row.invoiceNetTotal),
    })),
    totalCount: parseNumber(totalRows[0]?.totalCount),
  };
}
