import { analyticsTables } from "../../config/bigquery.js";
import { GT_GROWTH_AI_FEATURE_GATE } from "../../types/report-ai.js";
import { runAnalyticsQuery } from "../bigquery.service.js";
import { hasFeatureAccess } from "../feature-access.service.js";
import { getDailyPaymentGrowthEvidence } from "./gt-growth-ai-evidence.service.js";
import { buildPaymentReportAiPayload } from "./report-ai-insights.service.js";

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

const PAYMENT_METHOD_FILTER_ALIASES: Record<string, string[]> = {
  YOMA: ["YOMA", "YOMA BANK", "YOMABANK", "YOMA PAY"],
  KPAY: ["KPAY", "K PAY", "KPAYE", "KBZPAY", "KBZ PAY"],
  KBZ: ["KBZ", "KBZ BANK"],
  AYAPAY: ["AYAPAY", "AYA PAY"],
  AYA: ["AYA", "AYA BANK"],
  CBPAY: ["CBPAY", "CB PAY"],
  CB: ["CB", "CB BANK"],
  UAB: ["UAB", "UAB BANK"],
  MOB: ["MOB", "MOB BANK"],
  WAVEPAY: ["WAVEPAY", "WAVE PAY", "WAVE"],
  CASH: ["CASH"],
  MMQR: ["MMQR", "MM QR", "MYANMAR QR", "QR"],
  BANK: ["BANK", "BANK TRANSFER"],
  MPU: ["MPU"],
  VISA: ["VISA"],
  MASTERCARD: ["MASTERCARD", "MASTER CARD"],
};

function normalizePaymentMethodForFilter(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function buildPaymentMethodFilterAliases(paymentMethod: string) {
  const normalized = normalizePaymentMethodForFilter(paymentMethod);
  const aliases = PAYMENT_METHOD_FILTER_ALIASES[normalized] ?? [paymentMethod];
  const values = new Set(
    [paymentMethod, normalized, ...aliases]
      .map((value) => normalizePaymentMethodForFilter(value))
      .filter(Boolean),
  );

  return values.size ? [...values] : [""];
}

export async function getPaymentReport(params: {
  clinicId: string;
  clinicCode: string;
  fromDate: string;
  toDate: string;
  search: string;
  paymentMethod: string;
  includeZeroValues: boolean;
  limit: number;
  offset: number;
}) {
  const queryParams = {
    ...params,
    paymentMethodAliases: params.paymentMethod ? buildPaymentMethodFilterAliases(params.paymentMethod) : [""],
  };
  const baseWhere = `
    DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
      AND PaymentMethod != 'PASS'
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
        OR UPPER(REGEXP_REPLACE(COALESCE(PaymentMethod, 'Unknown'), r'[^a-zA-Z0-9]', '')) IN UNNEST(@paymentMethodAliases)
      )
      AND (
        @includeZeroValues
        OR COALESCE(CAST(NetTotal AS FLOAT64), 0) != 0
      )
  `;

  const methodWhere = `
    DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
      AND PaymentMethod != 'PASS'
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
      queryParams,
    ),
    runAnalyticsQuery<{
      paymentMethod: string;
      totalAmount: number;
      transactionCount: number;
    }>(
      `
        WITH RawData AS (
          SELECT
            InvoiceNumber AS invoiceNumber,
            COALESCE(PaymentMethod, 'Unknown') AS paymentMethod,
            PaymentType AS paymentType,
            PaymentNote AS paymentNote,
            CAST(PaymentAmount AS FLOAT64) AS paymentAmount,
            CAST(NetTotal AS FLOAT64) AS invoiceNetTotal
          FROM ${analyticsTables.mainPaymentView}
          WHERE ${methodWhere}
        ),
        DedupPaymentAmounts AS (
          SELECT
            invoiceNumber,
            paymentMethod,
            paymentType,
            paymentNote,
            paymentAmount
          FROM RawData
          WHERE paymentAmount IS NOT NULL AND paymentAmount > 0
          GROUP BY invoiceNumber, paymentMethod, paymentType, paymentNote, paymentAmount
        ),
        MethodPayments AS (
          SELECT
            invoiceNumber,
            paymentMethod,
            SUM(paymentAmount) AS paymentAmount
          FROM DedupPaymentAmounts
          GROUP BY invoiceNumber, paymentMethod
        ),
        InvoiceMethods AS (
          SELECT
            invoiceNumber,
            paymentMethod,
            MAX(invoiceNetTotal) AS invoiceNetTotal
          FROM RawData
          GROUP BY invoiceNumber, paymentMethod
        ),
        InvoiceMethodAmounts AS (
          SELECT
            invoice.invoiceNumber,
            invoice.paymentMethod,
            COALESCE(payment.paymentAmount, invoice.invoiceNetTotal, 0) AS totalAmount
          FROM InvoiceMethods AS invoice
          LEFT JOIN MethodPayments AS payment
            ON invoice.invoiceNumber = payment.invoiceNumber
            AND invoice.paymentMethod = payment.paymentMethod
        )
        SELECT
          paymentMethod,
          COALESCE(SUM(totalAmount), 0) AS totalAmount,
          COUNT(*) AS transactionCount
        FROM InvoiceMethodAmounts
        WHERE @includeZeroValues OR totalAmount != 0
        GROUP BY paymentMethod
        ORDER BY totalAmount DESC
      `,
      queryParams,
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
        ORDER BY invoice.dateLabel DESC, invoice.invoiceNumber, service.itemRank
        LIMIT @limit
        OFFSET @offset
      `,
      queryParams,
    ),
    runAnalyticsQuery<{ totalCount: number }>(
      `
        ${detailCte}
        SELECT COUNT(*) AS totalCount
        FROM (${detailSelect})
      `,
      queryParams,
    ),
  ]);

  const report = {
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

  const premium = await hasFeatureAccess({
    clinicId: params.clinicId,
    feature: GT_GROWTH_AI_FEATURE_GATE,
    teaser: {
      insightCount: report.summary.totalAmount > 0 ? 1 : 0,
    },
  });
  const isSingleDayReport = params.fromDate === params.toDate;
  const growthEvidence =
    premium.enabled && isSingleDayReport
      ? await getDailyPaymentGrowthEvidence({
          clinicCode: params.clinicCode,
          dateKey: params.fromDate,
          totalRevenue: report.summary.totalAmount,
        })
      : null;
  const paymentMethods = report.methods.map((method) => ({
    paymentMethod: method.paymentMethod,
    count: method.transactionCount,
    amount: method.totalAmount,
  }));
  const gtGrowthAi =
    premium.enabled && isSingleDayReport
      ? buildPaymentReportAiPayload({
          dateKey: params.fromDate,
          totalPaymentAmount: report.summary.totalAmount,
          paymentCount: paymentMethods.reduce((total, method) => total + method.count, 0),
          paidInvoiceCount: report.summary.invoiceCount,
          averageInvoiceValue: report.summary.averageInvoice,
          paymentMethods,
          sellerTotals: (growthEvidence?.sellerRevenue.sellers ?? []).map((seller) => ({
            sellerName: seller.name,
            count: seller.count,
            amount: seller.amount,
          })),
          outstandingAmount: growthEvidence?.outstanding?.outstandingAmount ?? 0,
          partialPaymentInvoiceCount: growthEvidence?.outstanding?.affectedInvoiceCount ?? 0,
          previousDayTotalPaymentAmount: null,
          previousDayPaymentCount: null,
          revenueByServiceOrPackage: (growthEvidence?.serviceRevenue ?? []).map((row) => ({
            name: row.name,
            count: row.count,
            amount: row.amount,
          })),
          serviceRevenueEvidence: growthEvidence?.serviceRevenue,
          packageRevenueEvidence: growthEvidence?.packageRevenue,
          paymentMethodRevenueEvidence: growthEvidence?.paymentMethodRevenue,
          refundVoidDiscountAmount: null,
        })
      : undefined;

  return {
    ...report,
    premium,
    ...(gtGrowthAi ? { gtGrowthAi } : {}),
  };
}
