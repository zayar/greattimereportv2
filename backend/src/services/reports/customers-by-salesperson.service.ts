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

function escapeForLike(value: string) {
  return value.replace(/[%_]/g, "\\$&");
}

export async function getCustomersBySalespersonReport(params: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  sellerName: string;
  search: string;
  limit: number;
  offset: number;
}) {
  const sellerRows = await runAnalyticsQuery<{ sellerName: string }>(
    `
      SELECT DISTINCT COALESCE(SellerName, 'Unknown') AS sellerName
      FROM ${analyticsTables.mainPaymentView}
      WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
        AND PaymentStatus = 'PAID'
        AND NOT STARTS_WITH(InvoiceNumber, 'CO-')
        AND LOWER(ClinicCode) = LOWER(@clinicCode)
        AND COALESCE(SellerName, '') != ''
      ORDER BY sellerName ASC
    `,
    params,
  );

  if (!params.sellerName) {
    return {
      sellers: sellerRows.map((row) => row.sellerName),
      summary: {
        customerCount: 0,
        totalSpend: 0,
        averageSpend: 0,
      },
      customers: [],
      totalCount: 0,
    };
  }

  const search = escapeForLike(params.search);
  const queryParams = { ...params, search };

  const customerCte = `
    WITH CustomersFromSalesperson AS (
      SELECT DISTINCT
        CustomerName AS customerName,
        CustomerPhoneNumber AS phoneNumber
      FROM ${analyticsTables.mainPaymentView}
      WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
        AND COALESCE(SellerName, 'Unknown') = @sellerName
        AND PaymentStatus = 'PAID'
        AND NOT STARTS_WITH(InvoiceNumber, 'CO-')
        AND LOWER(ClinicCode) = LOWER(@clinicCode)
    ),
    AllCustomerInvoices AS (
      SELECT
        payment.CustomerName AS customerName,
        payment.CustomerPhoneNumber AS phoneNumber,
        payment.InvoiceNumber AS invoiceNumber,
        payment.OrderCreatedDate AS orderCreatedDate,
        MAX(COALESCE(payment.MemberId, '')) AS memberId,
        MAX(CAST(payment.NetTotal AS FLOAT64)) AS invoiceNetTotal
      FROM ${analyticsTables.mainPaymentView} AS payment
      INNER JOIN CustomersFromSalesperson AS scoped
        ON payment.CustomerName = scoped.customerName
        AND payment.CustomerPhoneNumber = scoped.phoneNumber
      WHERE DATE(payment.OrderCreatedDate) BETWEEN @fromDate AND @toDate
        AND payment.PaymentStatus = 'PAID'
        AND NOT STARTS_WITH(payment.InvoiceNumber, 'CO-')
        AND COALESCE(payment.PaymentMethod, '') != 'PASS'
        AND LOWER(payment.ClinicCode) = LOWER(@clinicCode)
      GROUP BY
        payment.CustomerName,
        payment.CustomerPhoneNumber,
        payment.InvoiceNumber,
        payment.OrderCreatedDate
    ),
    CustomerPurchasesRanked AS (
      SELECT
        customerName,
        phoneNumber,
        invoiceNumber,
        orderCreatedDate,
        memberId,
        invoiceNetTotal,
        ROW_NUMBER() OVER (
          PARTITION BY customerName, phoneNumber
          ORDER BY orderCreatedDate DESC
        ) AS purchaseRank
      FROM AllCustomerInvoices
    ),
    CustomerSummary AS (
      SELECT
        customerName,
        phoneNumber,
        MAX(memberId) AS memberId,
        SUM(invoiceNetTotal) AS totalSpend,
        MAX(CASE WHEN purchaseRank = 1 THEN invoiceNumber END) AS lastInvoiceNumber,
        MAX(CASE WHEN purchaseRank = 1 THEN FORMAT_DATE('%Y-%m-%d', DATE(orderCreatedDate)) END) AS lastPurchaseDate
      FROM CustomerPurchasesRanked
      GROUP BY customerName, phoneNumber
    ),
    FilteredCustomers AS (
      SELECT *
      FROM CustomerSummary
      WHERE (
        @search = ''
        OR LOWER(customerName) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(phoneNumber) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(memberId, '')) LIKE LOWER(CONCAT('%', @search, '%'))
      )
    )
  `;

  const [summaryRows, customerRows, totalRows] = await Promise.all([
    runAnalyticsQuery<{
      customerCount: number;
      totalSpend: number;
      averageSpend: number;
    }>(
      `
        ${customerCte}
        SELECT
          COUNT(*) AS customerCount,
          COALESCE(SUM(totalSpend), 0) AS totalSpend,
          COALESCE(AVG(totalSpend), 0) AS averageSpend
        FROM FilteredCustomers
      `,
      queryParams,
    ),
    runAnalyticsQuery<{
      name: string;
      phoneNumber: string;
      memberId: string;
      totalSpend: number;
      lastInvoiceNumber: string;
      lastPurchaseDate: string;
    }>(
      `
        ${customerCte}
        SELECT
          customerName AS name,
          phoneNumber,
          COALESCE(memberId, '') AS memberId,
          totalSpend,
          lastInvoiceNumber,
          lastPurchaseDate
        FROM FilteredCustomers
        ORDER BY totalSpend DESC, name ASC
        LIMIT @limit
        OFFSET @offset
      `,
      queryParams,
    ),
    runAnalyticsQuery<{
      totalCount: number;
    }>(
      `
        ${customerCte}
        SELECT COUNT(*) AS totalCount
        FROM FilteredCustomers
      `,
      queryParams,
    ),
  ]);

  const summary = summaryRows[0];
  const total = totalRows[0];

  return {
    sellers: sellerRows.map((row) => row.sellerName),
    summary: {
      customerCount: parseNumber(summary?.customerCount),
      totalSpend: parseNumber(summary?.totalSpend),
      averageSpend: parseNumber(summary?.averageSpend),
    },
    customers: customerRows.map((row) => ({
      name: row.name,
      phoneNumber: row.phoneNumber,
      memberId: row.memberId,
      totalSpend: parseNumber(row.totalSpend),
      lastInvoiceNumber: row.lastInvoiceNumber,
      lastPurchaseDate: row.lastPurchaseDate,
    })),
    totalCount: parseNumber(total?.totalCount),
  };
}
