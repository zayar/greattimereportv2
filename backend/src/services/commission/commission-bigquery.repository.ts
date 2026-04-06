import { analyticsTables } from "../../config/bigquery.js"
import { runAnalyticsQuery } from "../bigquery.service.js"
import type {
  CommissionBigQueryScope,
  CommissionEventType,
  CommissionSourceOptions,
  CommissionSourceRow,
} from "./commission.types.js"
import {
  buildStaffId,
  dedupeStrings,
  normalizeLower,
  normalizeText,
  parseNumber,
  roundMoney,
} from "./commission.utils.js"

type PaymentLineRow = {
  sourceId: string
  branchId: string
  branchCode: string
  businessName: string
  invoiceNumber: string
  customerName: string
  customerPhone: string
  memberId: string
  orderCreatedDate: string
  paymentStatus: string
  sellerName: string
  sellerId: string
  serviceName: string
  servicePackageName: string
  itemQuantity: number
  itemPrice: number
  itemTotal: number
  invoiceGrossAmount: number
  invoiceNetTotal: number
  invoiceDiscount: number
  orderBalance: number
  orderCreditBalance: number
  invoiceTax: number
  categoryName: string
  itemType: string
  invoiceLineCount: number
  invoiceItemTotal: number
  invoiceCollectedAmount: number
}

type TreatmentRow = {
  sourceId: string
  branchCode: string
  businessName: string
  sourceDate: string
  customerId: string
  customerName: string
  practitionerName: string
  serviceName: string
  price: number
  packageCount: number
  remainingPackageCount: number
  categoryName: string
}

function buildServiceCategoryExpression(serviceField: string, packageField: string) {
  return `
    CASE
      WHEN REGEXP_CONTAINS(
        LOWER(CONCAT(COALESCE(${serviceField}, ''), ' ', COALESCE(${packageField}, ''))),
        r'laser|fractional|ipl|hifu|ultraformer|hair removal|lhr|co2|revlite'
      ) THEN 'Laser'
      WHEN REGEXP_CONTAINS(
        LOWER(CONCAT(COALESCE(${serviceField}, ''), ' ', COALESCE(${packageField}, ''))),
        r'facial|hydra|hydro|skin|peel|aqua|bright|rejuv|glow|oxygen|cleanup|whitening|micro'
      ) THEN 'Facial'
      WHEN REGEXP_CONTAINS(
        LOWER(CONCAT(COALESCE(${serviceField}, ''), ' ', COALESCE(${packageField}, ''))),
        r'botox|filler|meso|inject|toxin|thread|prp|rejuran|profhilo|collagen stim'
      ) THEN 'Injectables'
      WHEN REGEXP_CONTAINS(
        LOWER(CONCAT(COALESCE(${serviceField}, ''), ' ', COALESCE(${packageField}, ''))),
        r'body|slim|fat|contour|cellulite|cool|emsculpt|shape|underarm|bikini|thigh'
      ) THEN 'Body'
      WHEN REGEXP_CONTAINS(
        LOWER(CONCAT(COALESCE(${serviceField}, ''), ' ', COALESCE(${packageField}, ''))),
        r'hair|scalp'
      ) THEN 'Hair'
      WHEN REGEXP_CONTAINS(
        LOWER(CONCAT(COALESCE(${serviceField}, ''), ' ', COALESCE(${packageField}, ''))),
        r'wellness|vitamin|therapy|drip|massage|lymph'
      ) THEN 'Wellness'
      ELSE 'Other'
    END
  `
}

function buildPaymentItemsCte() {
  return `
    WITH RawPayments AS (
      SELECT
        COALESCE(ClinicID, '') AS branchId,
        COALESCE(ClinicCode, '') AS branchCode,
        COALESCE(BusinessName, '') AS businessName,
        COALESCE(InvoiceNumber, '') AS invoiceNumber,
        COALESCE(CustomerName, '') AS customerName,
        COALESCE(CustomerPhoneNumber, '') AS customerPhone,
        COALESCE(MemberID, '') AS memberId,
        OrderCreatedDate AS orderCreatedDate,
        COALESCE(ServiceName, '') AS serviceName,
        COALESCE(ServicePackageName, '') AS servicePackageName,
        COALESCE(PaymentMethod, 'Unknown') AS paymentMethod,
        COALESCE(PaymentStatus, '') AS paymentStatus,
        COALESCE(SellerName, 'Unassigned') AS sellerName,
        COALESCE(SellerId, '') AS sellerId,
        COALESCE(PaymentType, '') AS paymentType,
        COALESCE(PaymentNote, '') AS paymentNote,
        CAST(COALESCE(PaymentAmount, 0) AS FLOAT64) AS paymentAmount,
        CAST(COALESCE(ItemQuantity, 1) AS FLOAT64) AS itemQuantity,
        CAST(COALESCE(ItemPrice, 0) AS FLOAT64) AS itemPrice,
        CAST(COALESCE(ItemTotal, NetTotal, 0) AS FLOAT64) AS itemTotal,
        CAST(COALESCE(Total, 0) AS FLOAT64) AS invoiceGrossAmount,
        CAST(COALESCE(NetTotal, 0) AS FLOAT64) AS invoiceNetTotal,
        CAST(COALESCE(Discount, 0) AS FLOAT64) AS invoiceDiscount,
        CAST(COALESCE(OrderBalance, 0) AS FLOAT64) AS orderBalance,
        CAST(COALESCE(OrderCreditBalance, 0) AS FLOAT64) AS orderCreditBalance,
        CAST(COALESCE(Tax, 0) AS FLOAT64) AS invoiceTax
      FROM ${analyticsTables.mainPaymentView}
      WHERE DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate
        AND LOWER(ClinicCode) IN UNNEST(@clinicCodes)
        AND COALESCE(ServiceName, '') != ''
        AND NOT STARTS_WITH(COALESCE(InvoiceNumber, ''), 'CO-')
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
            COALESCE(paymentNote, ''),
            '|',
            COALESCE(paymentType, '')
          )
        ) AS paymentRecordCount
      FROM RawPayments
      GROUP BY invoiceNumber
    ),
    DistinctInvoicePayments AS (
      SELECT
        invoiceNumber,
        COALESCE(SUM(paymentAmount), 0) AS invoiceCollectedAmount
      FROM (
        SELECT DISTINCT
          invoiceNumber,
          paymentMethod,
          paymentAmount,
          paymentNote,
          paymentType
        FROM RawPayments
      )
      GROUP BY invoiceNumber
    ),
    ItemGroups AS (
      SELECT
        branchId,
        branchCode,
        ANY_VALUE(businessName) AS businessName,
        invoiceNumber,
        customerName,
        customerPhone,
        MAX(memberId) AS memberId,
        MAX(orderCreatedDate) AS orderCreatedDate,
        ANY_VALUE(paymentStatus) AS paymentStatus,
        ANY_VALUE(sellerName) AS sellerName,
        ANY_VALUE(sellerId) AS sellerId,
        serviceName,
        servicePackageName,
        itemQuantity,
        itemPrice,
        itemTotal,
        MAX(invoiceGrossAmount) AS invoiceGrossAmount,
        MAX(invoiceNetTotal) AS invoiceNetTotal,
        MAX(invoiceDiscount) AS invoiceDiscount,
        MAX(orderBalance) AS orderBalance,
        MAX(orderCreditBalance) AS orderCreditBalance,
        MAX(invoiceTax) AS invoiceTax,
        COUNT(*) AS rawCount
      FROM RawPayments
      GROUP BY
        branchId,
        branchCode,
        invoiceNumber,
        customerName,
        customerPhone,
        serviceName,
        servicePackageName,
        itemQuantity,
        itemPrice,
        itemTotal
    ),
    ExpandedItems AS (
      SELECT
        itemGroup.*,
        instanceNum
      FROM ItemGroups AS itemGroup
      LEFT JOIN PaymentsPerInvoice AS payments USING (invoiceNumber),
      UNNEST(
        GENERATE_ARRAY(
          1,
          GREATEST(1, CAST(ROUND(SAFE_DIVIDE(itemGroup.rawCount, IFNULL(payments.paymentRecordCount, 1))) AS INT64))
        )
      ) AS instanceNum
    ),
    ServicePaymentItems AS (
      SELECT
        CONCAT(invoiceNumber, '|', serviceName, '|', servicePackageName, '|', CAST(itemTotal AS STRING), '|', CAST(instanceNum AS STRING)) AS sourceId,
        branchId,
        branchCode,
        businessName,
        invoiceNumber,
        customerName,
        customerPhone,
        memberId,
        orderCreatedDate,
        paymentStatus,
        sellerName,
        sellerId,
        serviceName,
        servicePackageName,
        itemQuantity,
        itemPrice,
        itemTotal,
        invoiceGrossAmount,
        invoiceNetTotal,
        invoiceDiscount,
        orderBalance,
        orderCreditBalance,
        invoiceTax,
        ${buildServiceCategoryExpression("serviceName", "servicePackageName")} AS categoryName,
        CASE
          WHEN COALESCE(servicePackageName, '') != '' THEN 'package'
          ELSE 'service'
        END AS itemType,
        COUNT(*) OVER (PARTITION BY invoiceNumber) AS invoiceLineCount,
        SUM(itemTotal) OVER (PARTITION BY invoiceNumber) AS invoiceItemTotal,
        COALESCE(invoicePayments.invoiceCollectedAmount, 0) AS invoiceCollectedAmount
      FROM ExpandedItems
      LEFT JOIN DistinctInvoicePayments AS invoicePayments USING (invoiceNumber)
    )
  `
}

function allocationRatio(input: { itemTotal: number; invoiceItemTotal: number; invoiceLineCount: number }) {
  const invoiceItemTotal = parseNumber(input.invoiceItemTotal)
  if (invoiceItemTotal > 0) {
    return parseNumber(input.itemTotal) / invoiceItemTotal
  }

  const lineCount = Math.max(1, parseNumber(input.invoiceLineCount))
  return 1 / lineCount
}

function toIsoDate(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 10)
  }

  return parsed.toISOString().slice(0, 10)
}

function mapPaymentLineToSourceRows(row: PaymentLineRow, merchantId: string): CommissionSourceRow[] {
  const ratio = allocationRatio({
    itemTotal: parseNumber(row.itemTotal),
    invoiceItemTotal: parseNumber(row.invoiceItemTotal),
    invoiceLineCount: parseNumber(row.invoiceLineCount),
  })

  const grossAmount = roundMoney(row.itemTotal)
  const discountAmount = roundMoney(parseNumber(row.invoiceDiscount) * ratio)
  const netAmount = roundMoney(parseNumber(row.invoiceNetTotal) * ratio)
  const collectedAmount = roundMoney(parseNumber(row.invoiceCollectedAmount) * ratio)
  const sourceDate = toIsoDate(row.orderCreatedDate)
  const staffId = buildStaffId("seller", row.sellerId, row.sellerName)
  const customerId = normalizeText(row.memberId) || normalizeText(row.customerPhone) || null
  const customerName = normalizeText(row.customerName) || null
  const serviceName = normalizeText(row.serviceName) || null
  const itemType = normalizeText(row.itemType) === "package" ? "package" : "service"

  const common = {
    merchantId,
    merchantName: normalizeText(row.businessName),
    branchId: normalizeText(row.branchId) || normalizeText(row.branchCode),
    branchCode: normalizeText(row.branchCode),
    eventDate: sourceDate,
    sourceRef: normalizeText(row.invoiceNumber),
    customerId,
    customerName,
    staffId,
    staffName: normalizeText(row.sellerName) || "Unassigned",
    staffRole: "salesperson",
    itemType,
    categoryName: normalizeText(row.categoryName) || null,
    serviceName,
    grossAmount,
    discountAmount,
    netAmount,
    availableBaseFields: ["grossAmount", "netAmount", "collectedAmount"],
    quantity: Math.max(1, roundMoney(row.itemQuantity)),
    completedTreatmentCount: 0,
    paymentStatus: normalizeText(row.paymentStatus) || null,
    packageUsageCount: itemType === "package" ? 1 : 0,
  } satisfies Omit<CommissionSourceRow, "eventType" | "sourceId" | "collectedAmount">

  return [
    {
      ...common,
      eventType: "sale_based",
      sourceId: `sale:${row.sourceId}`,
      collectedAmount: collectedAmount,
    },
    {
      ...common,
      eventType: "payment_based",
      sourceId: `payment:${row.sourceId}`,
      collectedAmount,
    },
  ]
}

function mapTreatmentRowToSourceRow(row: TreatmentRow, merchantId: string): CommissionSourceRow {
  const packageCount = parseNumber(row.packageCount)
  const remainingPackageCount = parseNumber(row.remainingPackageCount)
  const itemType = packageCount > 0 || remainingPackageCount > 0 ? "package" : "service"

  return {
    eventType: "treatment_completed_based",
    merchantId,
    merchantName: normalizeText(row.businessName),
    branchId: normalizeText(row.branchCode),
    branchCode: normalizeText(row.branchCode),
    eventDate: normalizeText(row.sourceDate),
    sourceId: `treatment:${normalizeText(row.sourceId)}`,
    sourceRef: normalizeText(row.sourceId),
    customerId: normalizeText(row.customerId) || null,
    customerName: normalizeText(row.customerName) || null,
    staffId: buildStaffId("practitioner", null, row.practitionerName),
    staffName: normalizeText(row.practitionerName) || "Unassigned",
    staffRole: "practitioner",
    itemType,
    categoryName: normalizeText(row.categoryName) || null,
    serviceName: normalizeText(row.serviceName) || null,
    grossAmount: roundMoney(row.price),
    discountAmount: 0,
    netAmount: roundMoney(row.price),
    collectedAmount: 0,
    availableBaseFields: ["grossAmount", "netAmount"],
    quantity: 1,
    completedTreatmentCount: 1,
    paymentStatus: null,
    packageUsageCount: itemType === "package" ? 1 : 0,
  }
}

export async function fetchCommissionSourceRows(scope: CommissionBigQueryScope) {
  const clinicCodes = scope.branchCodes.map((code) => normalizeLower(code)).filter(Boolean)

  const [paymentLineRows, treatmentRows] = await Promise.all([
    runAnalyticsQuery<PaymentLineRow>(
      `
        ${buildPaymentItemsCte()}
        SELECT
          sourceId,
          branchId,
          branchCode,
          businessName,
          invoiceNumber,
          customerName,
          customerPhone,
          memberId,
          CAST(orderCreatedDate AS STRING) AS orderCreatedDate,
          paymentStatus,
          sellerName,
          sellerId,
          serviceName,
          servicePackageName,
          itemQuantity,
          itemPrice,
          itemTotal,
          invoiceGrossAmount,
          invoiceNetTotal,
          invoiceDiscount,
          orderBalance,
          orderCreditBalance,
          invoiceTax,
          categoryName,
          itemType,
          invoiceLineCount,
          invoiceItemTotal,
          invoiceCollectedAmount
        FROM ServicePaymentItems
        ORDER BY orderCreatedDate DESC, invoiceNumber DESC
      `,
      {
        fromDate: scope.fromDate,
        toDate: scope.toDate,
        clinicCodes,
      },
    ),
    runAnalyticsQuery<TreatmentRow>(
      `
        WITH DistinctTreatments AS (
          SELECT
            COALESCE(
              CAST(BookingID AS STRING),
              CONCAT(
                FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', COALESCE(CheckOutTime, CheckInTime)),
                '|',
                COALESCE(ServiceName, ''),
                '|',
                COALESCE(PractitionerName, '')
              )
            ) AS sourceId,
            COALESCE(ClinicCode, '') AS branchCode,
            COALESCE(BusinessName, '') AS businessName,
            FORMAT_DATE('%Y-%m-%d', DATE(COALESCE(CheckOutTime, CheckInTime))) AS sourceDate,
            COALESCE(CustomerID, '') AS customerId,
            COALESCE(CustomerName, '') AS customerName,
            COALESCE(PractitionerName, 'Unassigned') AS practitionerName,
            COALESCE(ServiceName, '') AS serviceName,
            CAST(COALESCE(Price, 0) AS FLOAT64) AS price,
            CAST(COALESCE(PackageCount, 0) AS INT64) AS packageCount,
            CAST(COALESCE(RemainingPackageCount, 0) AS INT64) AS remainingPackageCount,
            ${buildServiceCategoryExpression("ServiceName", "CAST(NULL AS STRING)")} AS categoryName
          FROM ${analyticsTables.mainDataView}
          WHERE DATE(COALESCE(CheckOutTime, CheckInTime)) BETWEEN @fromDate AND @toDate
            AND LOWER(ClinicCode) IN UNNEST(@clinicCodes)
            AND COALESCE(ServiceName, '') != ''
            AND (
              CheckOutTime IS NOT NULL
              OR UPPER(COALESCE(Status, '')) = 'CHECKOUT'
            )
          QUALIFY ROW_NUMBER() OVER (
            PARTITION BY
              COALESCE(CAST(BookingID AS STRING), CONCAT(FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', COALESCE(CheckOutTime, CheckInTime)), '|', COALESCE(ServiceName, ''), '|', COALESCE(PractitionerName, ''))),
              COALESCE(ServiceName, ''),
              COALESCE(PractitionerName, '')
            ORDER BY COALESCE(CheckOutTime, CheckInTime) DESC
          ) = 1
        )
        SELECT
          sourceId,
          branchCode,
          businessName,
          sourceDate,
          customerId,
          customerName,
          practitionerName,
          serviceName,
          price,
          packageCount,
          remainingPackageCount,
          categoryName
        FROM DistinctTreatments
        ORDER BY sourceDate DESC, sourceId DESC
      `,
      {
        fromDate: scope.fromDate,
        toDate: scope.toDate,
        clinicCodes,
      },
    ),
  ])

  return [
    ...paymentLineRows.flatMap((row) => mapPaymentLineToSourceRows(row, scope.merchantId)),
    ...treatmentRows.map((row) => mapTreatmentRowToSourceRow(row, scope.merchantId)),
  ]
}

export async function fetchCommissionSourceOptions(scope: CommissionBigQueryScope): Promise<CommissionSourceOptions> {
  const clinicCodes = scope.branchCodes.map((code) => normalizeLower(code)).filter(Boolean)

  const [sellerRows, practitionerRows, serviceRows, paymentStatusRows] = await Promise.all([
    runAnalyticsQuery<{
      sellerId: string
      sellerName: string
    }>(
      `
        SELECT DISTINCT
          COALESCE(SellerId, '') AS sellerId,
          COALESCE(SellerName, 'Unassigned') AS sellerName
        FROM ${analyticsTables.mainPaymentView}
        WHERE LOWER(ClinicCode) IN UNNEST(@clinicCodes)
          AND COALESCE(SellerName, '') != ''
        ORDER BY sellerName ASC
      `,
      { clinicCodes },
    ),
    runAnalyticsQuery<{
      practitionerName: string
    }>(
      `
        SELECT DISTINCT
          COALESCE(PractitionerName, 'Unassigned') AS practitionerName
        FROM ${analyticsTables.mainDataView}
        WHERE LOWER(ClinicCode) IN UNNEST(@clinicCodes)
          AND COALESCE(PractitionerName, '') != ''
        ORDER BY practitionerName ASC
      `,
      { clinicCodes },
    ),
    runAnalyticsQuery<{
      serviceName: string
      categoryName: string
      sourceType: string
    }>(
      `
        WITH Services AS (
          SELECT DISTINCT
            COALESCE(ServiceName, '') AS serviceName,
            ${buildServiceCategoryExpression("ServiceName", "ServicePackageName")} AS categoryName,
            'payment' AS sourceType
          FROM ${analyticsTables.mainPaymentView}
          WHERE LOWER(ClinicCode) IN UNNEST(@clinicCodes)
            AND COALESCE(ServiceName, '') != ''
          UNION DISTINCT
          SELECT DISTINCT
            COALESCE(ServiceName, '') AS serviceName,
            ${buildServiceCategoryExpression("ServiceName", "CAST(NULL AS STRING)")} AS categoryName,
            'treatment' AS sourceType
          FROM ${analyticsTables.mainDataView}
          WHERE LOWER(ClinicCode) IN UNNEST(@clinicCodes)
            AND COALESCE(ServiceName, '') != ''
        )
        SELECT
          serviceName,
          categoryName,
          sourceType
        FROM Services
        ORDER BY serviceName ASC
      `,
      { clinicCodes },
    ),
    runAnalyticsQuery<{
      paymentStatus: string
    }>(
      `
        SELECT DISTINCT
          COALESCE(PaymentStatus, '') AS paymentStatus
        FROM ${analyticsTables.mainPaymentView}
        WHERE LOWER(ClinicCode) IN UNNEST(@clinicCodes)
          AND COALESCE(PaymentStatus, '') != ''
        ORDER BY paymentStatus ASC
      `,
      { clinicCodes },
    ),
  ])

  const servicesMap = new Map<
    string,
    {
      name: string
      categories: Set<string>
      eventTypes: Set<CommissionEventType>
    }
  >()

  serviceRows.forEach((row) => {
    const serviceName = normalizeText(row.serviceName)
    if (!serviceName) {
      return
    }

    const key = normalizeLower(serviceName)
    const existing =
      servicesMap.get(key) ??
      {
        name: serviceName,
        categories: new Set<string>(),
        eventTypes: new Set<CommissionEventType>(),
      }

    existing.categories.add(normalizeText(row.categoryName) || "Other")

    if (normalizeLower(row.sourceType) === "treatment") {
      existing.eventTypes.add("treatment_completed_based")
    } else {
      existing.eventTypes.add("sale_based")
      existing.eventTypes.add("payment_based")
    }

    servicesMap.set(key, existing)
  })

  const services = [...servicesMap.values()].map((service) => ({
    name: service.name,
    categoryName:
      service.categories.size === 1
        ? [...service.categories][0]
        : [...service.categories].sort((left, right) => left.localeCompare(right)).join(" / "),
    eventTypes: [...service.eventTypes].sort((left, right) => left.localeCompare(right)),
  }))

  return {
    paymentStatuses: dedupeStrings(paymentStatusRows.map((row) => row.paymentStatus)),
    itemTypes: serviceRows.some((row) => normalizeLower(row.sourceType) === "payment") ? ["service", "package"] : ["service"],
    categories: dedupeStrings(
      services.flatMap((service) => service.categoryName.split("/").map((category) => normalizeText(category) || "Other")),
    ).sort((left, right) => left.localeCompare(right)),
    services: services.sort((left, right) => left.name.localeCompare(right.name)),
    staff: [
      ...sellerRows.map((row) => ({
        id: buildStaffId("seller", row.sellerId, row.sellerName),
        name: normalizeText(row.sellerName) || "Unassigned",
        role: "salesperson",
        eventTypes: ["sale_based", "payment_based"] as CommissionEventType[],
      })),
      ...practitionerRows.map((row) => ({
        id: buildStaffId("practitioner", null, row.practitionerName),
        name: normalizeText(row.practitionerName) || "Unassigned",
        role: "practitioner",
        eventTypes: ["treatment_completed_based"] as CommissionEventType[],
      })),
    ],
  }
}
