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

const walletTopupExpression = `
  (
    STARTS_WITH(COALESCE(InvoiceNumber, ''), 'TO')
    OR LOWER(COALESCE(CAST(WalletTopUp AS STRING), '')) LIKE '%point%'
    OR LOWER(COALESCE(CAST(WalletTopUp AS STRING), '')) LIKE '%topup%'
  )
`;

export async function getBankingSummary(params: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  search: string;
  paymentMethod: string;
  walletTopupFilter: "all" | "hide" | "only";
  limit: number;
  offset: number;
}) {
  const commonWhere = `
    DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
      AND PaymentStatus = 'PAID'
      AND NOT STARTS_WITH(InvoiceNumber, 'CO-')
      AND LOWER(ClinicCode) = LOWER(@clinicCode)
      AND (
        @search = ''
        OR LOWER(COALESCE(InvoiceNumber, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(CustomerName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(CustomerPhoneNumber, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(MemberId, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(SellerName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(ServiceName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(ServicePackageName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
      )
      AND (
        @walletTopupFilter = 'all'
        OR (@walletTopupFilter = 'hide' AND NOT ${walletTopupExpression})
        OR (@walletTopupFilter = 'only' AND ${walletTopupExpression})
      )
  `;

  const detailWhere = `
    ${commonWhere}
      AND (
        @paymentMethod = ''
        OR LOWER(COALESCE(PaymentMethod, 'Unknown')) = LOWER(@paymentMethod)
      )
  `;

  const [summaryRows, methodRows, detailRows, totalRows] = await Promise.all([
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
        WHERE ${detailWhere}
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
        WHERE ${commonWhere}
        GROUP BY paymentMethod
        ORDER BY totalAmount DESC, paymentMethod ASC
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
      paymentMethod: string;
      paymentStatus: string;
      walletTopUp: string | number | null;
      invoiceNetTotal: number;
    }>(
      `
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(OrderCreatedDate)) AS dateLabel,
          InvoiceNumber AS invoiceNumber,
          CustomerName AS customerName,
          COALESCE(MemberId, '') AS memberId,
          COALESCE(SellerName, 'Unknown') AS salePerson,
          COALESCE(ServiceName, '') AS serviceName,
          ServicePackageName AS servicePackageName,
          COALESCE(PaymentMethod, 'Unknown') AS paymentMethod,
          COALESCE(PaymentStatus, '') AS paymentStatus,
          WalletTopUp AS walletTopUp,
          CAST(NetTotal AS FLOAT64) AS invoiceNetTotal
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

  const summary = summaryRows[0];
  const total = totalRows[0];

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
    rows: detailRows.map((row) => ({
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
    totalCount: parseNumber(total?.totalCount),
  };
}
