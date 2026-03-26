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

const paidBankingWhere = `
  DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
    AND PaymentStatus = 'PAID'
    AND PaymentMethod != 'PASS'
    AND LOWER(ClinicCode) = LOWER(@clinicCode)
`;

export async function getBankingSummary(params: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
}) {
  const [summaryRows, methodRows, collectionRows, recentRows] = await Promise.all([
    runAnalyticsQuery<{
      totalRevenue: number;
      transactionCount: number;
      methodsCount: number;
      averageTicket: number;
    }>(
      `
        SELECT
          COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS totalRevenue,
          COUNT(*) AS transactionCount,
          COUNT(DISTINCT COALESCE(PaymentMethod, 'Unknown')) AS methodsCount,
          COALESCE(AVG(CAST(NetTotal AS FLOAT64)), 0) AS averageTicket
        FROM ${analyticsTables.mainPaymentView}
        WHERE ${paidBankingWhere}
      `,
      params,
    ),
    runAnalyticsQuery<{
      paymentMethod: string;
      totalAmount: number;
      transactionCount: number;
      averageTicket: number;
    }>(
      `
        SELECT
          COALESCE(PaymentMethod, 'Unknown') AS paymentMethod,
          COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS totalAmount,
          COUNT(*) AS transactionCount,
          COALESCE(AVG(CAST(NetTotal AS FLOAT64)), 0) AS averageTicket
        FROM ${analyticsTables.mainPaymentView}
        WHERE ${paidBankingWhere}
        GROUP BY paymentMethod
        ORDER BY totalAmount DESC
      `,
      params,
    ),
    runAnalyticsQuery<{
      dateLabel: string;
      totalAmount: number;
      transactionCount: number;
    }>(
      `
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(OrderCreatedDate)) AS dateLabel,
          COALESCE(SUM(CAST(NetTotal AS FLOAT64)), 0) AS totalAmount,
          COUNT(*) AS transactionCount
        FROM ${analyticsTables.mainPaymentView}
        WHERE ${paidBankingWhere}
        GROUP BY dateLabel
        ORDER BY dateLabel ASC
      `,
      params,
    ),
    runAnalyticsQuery<{
      dateLabel: string;
      invoiceNumber: string;
      customerName: string;
      salePerson: string;
      paymentMethod: string;
      totalAmount: number;
    }>(
      `
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(OrderCreatedDate)) AS dateLabel,
          InvoiceNumber AS invoiceNumber,
          CustomerName AS customerName,
          COALESCE(SellerName, 'Unknown') AS salePerson,
          COALESCE(PaymentMethod, 'Unknown') AS paymentMethod,
          CAST(NetTotal AS FLOAT64) AS totalAmount
        FROM ${analyticsTables.mainPaymentView}
        WHERE ${paidBankingWhere}
        ORDER BY OrderCreatedDate DESC
        LIMIT 80
      `,
      params,
    ),
  ]);

  const summary = summaryRows[0];

  return {
    summary: {
      totalRevenue: parseNumber(summary?.totalRevenue),
      transactionCount: parseNumber(summary?.transactionCount),
      methodsCount: parseNumber(summary?.methodsCount),
      averageTicket: parseNumber(summary?.averageTicket),
    },
    methods: methodRows.map((row) => ({
      paymentMethod: row.paymentMethod,
      totalAmount: parseNumber(row.totalAmount),
      transactionCount: parseNumber(row.transactionCount),
      averageTicket: parseNumber(row.averageTicket),
    })),
    dailyCollections: collectionRows.map((row) => ({
      dateLabel: row.dateLabel,
      totalAmount: parseNumber(row.totalAmount),
      transactionCount: parseNumber(row.transactionCount),
    })),
    recentRows: recentRows.map((row) => ({
      dateLabel: row.dateLabel,
      invoiceNumber: row.invoiceNumber,
      customerName: row.customerName,
      salePerson: row.salePerson,
      paymentMethod: row.paymentMethod,
      totalAmount: parseNumber(row.totalAmount),
    })),
  };
}
