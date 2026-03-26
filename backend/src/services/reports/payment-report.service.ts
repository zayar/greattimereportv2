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

  const [rows, totalRows] = await Promise.all([
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
