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
  paymentMethod: string;
  includeZeroValues: boolean;
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
        OR LOWER(COALESCE(ServiceName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(ServicePackageName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
      )
      AND (
        @paymentMethod = ''
        OR LOWER(COALESCE(PaymentMethod, 'Unknown')) = LOWER(@paymentMethod)
      )
      AND (
        @includeZeroValues
        OR COALESCE(CAST(NetTotal AS FLOAT64), 0) != 0
      )
  `;

  const methodWhere = `
    DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
      AND PaymentStatus = 'PAID'
      AND LOWER(ClinicCode) = LOWER(@clinicCode)
      AND (
        @search = ''
        OR LOWER(CustomerName) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(InvoiceNumber) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(SellerName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(ServiceName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(COALESCE(ServicePackageName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
      )
      AND (
        @includeZeroValues
        OR COALESCE(CAST(NetTotal AS FLOAT64), 0) != 0
      )
  `;

  const detailCte = `
    WITH RawData AS (
      SELECT
        FORMAT_DATE('%Y-%m-%d', DATE(OrderCreatedDate)) AS dateLabel,
        InvoiceNumber AS invoiceNumber,
        CustomerName AS customerName,
        MemberId AS memberId,
        COALESCE(SellerName, 'Unknown') AS salePerson,
        ServiceName AS serviceName,
        ServicePackageName AS servicePackageName,
        WalletTopUp AS walletTopUp,
        PaymentStatus AS paymentStatus,
        COALESCE(PaymentMethod, 'Unknown') AS paymentMethod,
        PaymentType AS paymentType,
        CAST(PaymentAmount AS FLOAT64) AS paymentAmount,
        PaymentNote AS paymentNote,
        CAST(NetTotal AS FLOAT64) AS invoiceNetTotal,
        CAST(ItemQuantity AS FLOAT64) AS itemQuantity,
        CAST(ItemPrice AS FLOAT64) AS itemPrice,
        CAST(ItemTotal AS FLOAT64) AS itemTotal,
        CAST(SubTotal AS FLOAT64) AS subTotal,
        CAST(Total AS FLOAT64) AS total,
        CAST(NetTotal AS FLOAT64) AS netTotal,
        CAST(OrderBalance AS FLOAT64) AS orderBalance,
        CAST(OrderCreditBalance AS FLOAT64) AS orderCreditBalance,
        CAST(Discount AS FLOAT64) AS discount,
        CAST(Tax AS FLOAT64) AS tax,
        OrderCreatedDate AS orderCreatedDate
      FROM ${analyticsTables.mainPaymentView}
      WHERE ${baseWhere}
    ),
    PaymentsPerInvoice AS (
      SELECT
        invoiceNumber,
        COUNT(
          DISTINCT CONCAT(
            COALESCE(paymentMethod, ''),
            '|',
            COALESCE(CAST(paymentAmount AS STRING), ''),
            '|',
            COALESCE(paymentNote, '')
          )
        ) AS paymentsCount
      FROM RawData
      WHERE paymentAmount IS NOT NULL AND paymentAmount > 0
      GROUP BY invoiceNumber
    ),
    ItemGroups AS (
      SELECT
        invoiceNumber,
        serviceName,
        servicePackageName,
        itemQuantity,
        itemPrice,
        itemTotal,
        subTotal,
        MIN(orderCreatedDate) AS itemSortKey,
        COUNT(*) AS rawCount
      FROM RawData
      GROUP BY invoiceNumber, serviceName, servicePackageName, itemQuantity, itemPrice, itemTotal, subTotal
    ),
    ExpandedItems AS (
      SELECT
        itemGroup.invoiceNumber,
        itemGroup.serviceName,
        itemGroup.servicePackageName,
        itemGroup.itemQuantity,
        itemGroup.itemPrice,
        itemGroup.itemTotal,
        itemGroup.subTotal,
        itemGroup.itemSortKey,
        instanceNum
      FROM ItemGroups AS itemGroup
      LEFT JOIN PaymentsPerInvoice AS payments USING (invoiceNumber),
      UNNEST(
        GENERATE_ARRAY(
          1,
          GREATEST(1, CAST(ROUND(SAFE_DIVIDE(itemGroup.rawCount, IFNULL(payments.paymentsCount, 1))) AS INT64))
        )
      ) AS instanceNum
    ),
    UniqueServices AS (
      SELECT
        row.dateLabel,
        row.invoiceNumber,
        row.customerName,
        row.memberId,
        row.salePerson,
        item.serviceName,
        item.servicePackageName,
        row.walletTopUp,
        row.invoiceNetTotal,
        item.itemQuantity,
        item.itemPrice,
        item.itemTotal,
        item.subTotal,
        row.total,
        row.netTotal,
        row.orderBalance,
        row.orderCreditBalance,
        row.discount,
        row.tax,
        item.itemSortKey,
        item.instanceNum
      FROM ExpandedItems AS item
      JOIN RawData AS row
        ON row.invoiceNumber = item.invoiceNumber
      GROUP BY
        row.dateLabel,
        row.invoiceNumber,
        row.customerName,
        row.memberId,
        row.salePerson,
        item.serviceName,
        item.servicePackageName,
        row.walletTopUp,
        row.invoiceNetTotal,
        item.itemQuantity,
        item.itemPrice,
        item.itemTotal,
        item.subTotal,
        row.total,
        row.netTotal,
        row.orderBalance,
        row.orderCreditBalance,
        row.discount,
        row.tax,
        item.itemSortKey,
        item.instanceNum
    ),
    DedupPayments AS (
      SELECT DISTINCT
        invoiceNumber,
        paymentMethod,
        paymentType,
        paymentAmount,
        paymentNote,
        paymentStatus
      FROM RawData
      WHERE paymentAmount IS NOT NULL AND paymentAmount > 0
    ),
    UniquePayments AS (
      SELECT
        invoiceNumber,
        paymentMethod,
        paymentType,
        paymentAmount,
        paymentNote,
        paymentStatus,
        ROW_NUMBER() OVER (
          PARTITION BY invoiceNumber
          ORDER BY paymentAmount DESC, paymentMethod
        ) AS paymentRank
      FROM DedupPayments
    ),
    ServiceWithNames AS (
      SELECT
        *,
        CASE
          WHEN instanceNum > 1 THEN CONCAT(COALESCE(serviceName, 'Item'), ' #', CAST(instanceNum AS STRING))
          ELSE serviceName
        END AS displayServiceName,
        ROW_NUMBER() OVER (
          PARTITION BY invoiceNumber
          ORDER BY itemSortKey, serviceName, servicePackageName, instanceNum
        ) AS itemRank
      FROM UniqueServices
    ),
    InvoiceData AS (
      SELECT DISTINCT
        invoiceNumber,
        dateLabel,
        customerName,
        memberId,
        salePerson,
        walletTopUp,
        invoiceNetTotal,
        total,
        netTotal,
        orderBalance,
        orderCreditBalance,
        discount,
        tax
      FROM RawData
    )
  `;

  const detailSelect = `
    SELECT
      invoice.dateLabel,
      invoice.invoiceNumber,
      invoice.customerName,
      invoice.memberId,
      invoice.salePerson,
      service.displayServiceName AS serviceName,
      service.servicePackageName,
      invoice.walletTopUp,
      service.itemQuantity,
      service.itemPrice,
      service.itemTotal,
      service.subTotal,
      invoice.total,
      invoice.discount,
      invoice.netTotal,
      invoice.orderBalance,
      invoice.orderCreditBalance,
      invoice.tax,
      invoice.invoiceNetTotal,
      payment.paymentStatus,
      payment.paymentMethod,
      payment.paymentType,
      payment.paymentAmount,
      payment.paymentNote
    FROM ServiceWithNames AS service
    JOIN InvoiceData AS invoice
      ON service.invoiceNumber = invoice.invoiceNumber
    LEFT JOIN UniquePayments AS payment
      ON service.invoiceNumber = payment.invoiceNumber
      AND service.itemRank = payment.paymentRank
  `;

  const [summaryRows, methodRows, rows, totalRows] = await Promise.all([
    runAnalyticsQuery<{
      totalAmount: number;
      invoiceCount: number;
      methodsCount: number;
      averageInvoice: number;
    }>(
      `
        WITH RawData AS (
          SELECT
            InvoiceNumber AS invoiceNumber,
            CAST(NetTotal AS FLOAT64) AS invoiceNetTotal,
            COALESCE(PaymentMethod, 'Unknown') AS paymentMethod
          FROM ${analyticsTables.mainPaymentView}
          WHERE ${baseWhere}
        ),
        InvoiceSummary AS (
          SELECT
            invoiceNumber,
            MAX(invoiceNetTotal) AS invoiceNetTotal
          FROM RawData
          GROUP BY invoiceNumber
        )
        SELECT
          COALESCE(SUM(invoiceNetTotal), 0) AS totalAmount,
          COUNT(*) AS invoiceCount,
          (SELECT COUNT(DISTINCT paymentMethod) FROM RawData) AS methodsCount,
          COALESCE(AVG(invoiceNetTotal), 0) AS averageInvoice
        FROM InvoiceSummary
      `,
      params,
    ),
    runAnalyticsQuery<{
      paymentMethod: string;
      totalAmount: number;
      transactionCount: number;
    }>(
      `
        WITH RawData AS (
          SELECT
            COALESCE(PaymentMethod, 'Unknown') AS paymentMethod,
            CAST(COALESCE(PaymentAmount, NetTotal) AS FLOAT64) AS paymentAmount
          FROM ${analyticsTables.mainPaymentView}
          WHERE ${methodWhere}
        )
        SELECT
          paymentMethod,
          COALESCE(SUM(paymentAmount), 0) AS totalAmount,
          COUNT(*) AS transactionCount
        FROM RawData
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
      itemQuantity: number | null;
      itemPrice: number | null;
      itemTotal: number | null;
      subTotal: number | null;
      total: number | null;
      discount: number | null;
      netTotal: number | null;
      orderBalance: number | null;
      orderCreditBalance: number | null;
      tax: number | null;
      paymentMethod: string | null;
      paymentStatus: string | null;
      paymentType: string | null;
      paymentAmount: number | null;
      paymentNote: string | null;
      walletTopUp: string | number | null;
      invoiceNetTotal: number;
    }>(
      `
        ${detailCte}
        ${detailSelect}
        ORDER BY dateLabel DESC, invoiceNumber, serviceName
        LIMIT @limit
        OFFSET @offset
      `,
      params,
    ),
    runAnalyticsQuery<{ totalCount: number }>(
      `
        ${detailCte}
        SELECT COUNT(*) AS totalCount
        FROM (${detailSelect})
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
      itemQuantity: row.itemQuantity == null ? null : parseNumber(row.itemQuantity),
      itemPrice: row.itemPrice == null ? null : parseNumber(row.itemPrice),
      itemTotal: row.itemTotal == null ? null : parseNumber(row.itemTotal),
      subTotal: row.subTotal == null ? null : parseNumber(row.subTotal),
      total: row.total == null ? null : parseNumber(row.total),
      discount: row.discount == null ? null : parseNumber(row.discount),
      netTotal: row.netTotal == null ? null : parseNumber(row.netTotal),
      orderBalance: row.orderBalance == null ? null : parseNumber(row.orderBalance),
      orderCreditBalance: row.orderCreditBalance == null ? null : parseNumber(row.orderCreditBalance),
      tax: row.tax == null ? null : parseNumber(row.tax),
      paymentMethod: row.paymentMethod,
      paymentStatus: row.paymentStatus,
      paymentType: row.paymentType,
      paymentAmount: row.paymentAmount == null ? null : parseNumber(row.paymentAmount),
      paymentNote: row.paymentNote,
      walletTopUp: row.walletTopUp,
      invoiceNetTotal: parseNumber(row.invoiceNetTotal),
    })),
    totalCount: parseNumber(totalRows[0]?.totalCount),
  };
}
