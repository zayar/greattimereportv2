import { analyticsTables } from "../../config/bigquery.js";
import { runAnalyticsQuery } from "../bigquery.service.js";

type ServiceListParams = {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  search: string;
  serviceCategory: string;
  sortBy:
    | "totalRevenue"
    | "bookingCount"
    | "customerCount"
    | "averageSellingPrice"
    | "repeatPurchaseRate"
    | "growthRate";
  sortDirection: "asc" | "desc";
};

type ServiceIdentity = {
  serviceName: string;
};

type DetailBaseParams = {
  clinicCode: string;
  fromDate: string;
  toDate: string;
} & ServiceIdentity;

type PagedDetailParams = DetailBaseParams & {
  search: string;
  page: number;
  pageSize: number;
};

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

function parseText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return fallback;
  }

  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }

  if (value && typeof value === "object" && "value" in value) {
    return parseText((value as { value: unknown }).value, fallback);
  }

  return fallback;
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
  `;
}

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getPreviousWindow(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  const dayMs = 24 * 60 * 60 * 1000;
  const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / dayMs) + 1);
  const previousTo = new Date(from.getTime() - dayMs);
  const previousFrom = new Date(previousTo.getTime() - (spanDays - 1) * dayMs);

  return {
    previousFromDate: formatDateOnly(previousFrom),
    previousToDate: formatDateOnly(previousTo),
  };
}

function buildServicePaymentItemsCte(extraWhere = "1 = 1") {
  return `
    WITH RawPayments AS (
      SELECT
        InvoiceNumber AS invoiceNumber,
        CustomerName AS customerName,
        CustomerPhoneNumber AS phoneNumber,
        COALESCE(MemberID, '') AS memberId,
        OrderCreatedDate AS orderCreatedDate,
        COALESCE(ServiceName, '') AS serviceName,
        COALESCE(ServicePackageName, '') AS packageName,
        COALESCE(PaymentMethod, 'Unknown') AS paymentMethod,
        COALESCE(SellerName, 'Unknown') AS sellerName,
        PaymentType AS paymentType,
        PaymentNote AS paymentNote,
        CAST(PaymentAmount AS FLOAT64) AS paymentAmount,
        CAST(COALESCE(ItemQuantity, 1) AS FLOAT64) AS itemQuantity,
        CAST(COALESCE(ItemPrice, 0) AS FLOAT64) AS itemPrice,
        CAST(COALESCE(ItemTotal, NetTotal, 0) AS FLOAT64) AS itemTotal,
        CAST(COALESCE(NetTotal, 0) AS FLOAT64) AS invoiceNetTotal,
        CAST(COALESCE(Discount, 0) AS FLOAT64) AS invoiceDiscount,
        CAST(COALESCE(Tax, 0) AS FLOAT64) AS invoiceTax,
        CAST(COALESCE(OrderBalance, 0) AS FLOAT64) AS outstandingAmount
      FROM ${analyticsTables.mainPaymentView}
      WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
        AND PaymentStatus = 'PAID'
        AND COALESCE(ServiceName, '') != ''
        AND ${extraWhere}
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
        ) AS paymentsCount
      FROM RawPayments
      GROUP BY invoiceNumber
    ),
    ItemGroups AS (
      SELECT
        invoiceNumber,
        customerName,
        phoneNumber,
        MAX(memberId) AS memberId,
        MAX(orderCreatedDate) AS orderCreatedDate,
        ARRAY_AGG(paymentMethod ORDER BY orderCreatedDate DESC LIMIT 1)[SAFE_OFFSET(0)] AS paymentMethod,
        ARRAY_AGG(sellerName ORDER BY orderCreatedDate DESC LIMIT 1)[SAFE_OFFSET(0)] AS sellerName,
        serviceName,
        packageName,
        itemQuantity,
        itemPrice,
        itemTotal,
        MAX(invoiceNetTotal) AS invoiceNetTotal,
        MAX(invoiceDiscount) AS invoiceDiscount,
        MAX(invoiceTax) AS invoiceTax,
        MAX(outstandingAmount) AS outstandingAmount,
        COUNT(*) AS rawCount
      FROM RawPayments
      GROUP BY
        invoiceNumber,
        customerName,
        phoneNumber,
        serviceName,
        packageName,
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
          GREATEST(1, CAST(ROUND(SAFE_DIVIDE(itemGroup.rawCount, IFNULL(payments.paymentsCount, 1))) AS INT64))
        )
      ) AS instanceNum
    ),
    ServicePaymentItems AS (
      SELECT
        CONCAT(invoiceNumber, '|', serviceName, '|', packageName, '|', CAST(itemTotal AS STRING), '|', CAST(instanceNum AS STRING)) AS rowId,
        invoiceNumber,
        customerName,
        phoneNumber,
        memberId,
        orderCreatedDate,
        serviceName,
        packageName,
        paymentMethod,
        sellerName,
        itemQuantity,
        itemPrice,
        itemTotal,
        invoiceNetTotal,
        invoiceDiscount,
        invoiceTax,
        outstandingAmount,
        ${buildServiceCategoryExpression("serviceName", "packageName")} AS serviceCategory,
        CASE
          WHEN COALESCE(packageName, '') != '' THEN 'Package'
          ELSE 'One-off'
        END AS purchaseMode
      FROM ExpandedItems
    )
  `;
}

function buildDistinctServiceVisitsCte(extraWhere = "1 = 1") {
  return `
    WITH DistinctServiceVisits AS (
      SELECT
        COALESCE(ServiceName, '') AS serviceName,
        COALESCE(CustomerName, '') AS customerName,
        COALESCE(CustomerPhoneNumber, '') AS phoneNumber,
        COALESCE(CustomerID, '') AS memberId,
        COALESCE(PractitionerName, 'Unknown') AS therapistName,
        COALESCE(
          CAST(BookingID AS STRING),
          CONCAT(FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', CheckInTime), '-', COALESCE(ServiceName, ''), '-', COALESCE(CustomerPhoneNumber, ''))
        ) AS bookingKey,
        CheckInTime AS checkInTime,
        CheckOutTime AS checkOutTime,
        CAST(COALESCE(Price, 0) AS FLOAT64) AS price,
        CAST(COALESCE(PackageCount, 0) AS INT64) AS packageCount,
        CAST(COALESCE(RemainingPackageCount, 0) AS INT64) AS remainingPackageCount,
        ${buildServiceCategoryExpression("ServiceName", "CAST(NULL AS STRING)")} AS serviceCategory
      FROM ${analyticsTables.mainDataView}
      WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
        AND COALESCE(ServiceName, '') != ''
        AND COALESCE(CustomerName, '') != ''
        AND COALESCE(CustomerPhoneNumber, '') != ''
        AND CheckInTime IS NOT NULL
        AND ${extraWhere}
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY COALESCE(ServiceName, ''), COALESCE(CustomerPhoneNumber, ''), COALESCE(CAST(BookingID AS STRING), CONCAT(FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', CheckInTime), '-', COALESCE(ServiceName, ''), '-', COALESCE(CustomerPhoneNumber, '')))
        ORDER BY CheckInTime DESC
      ) = 1
    )
  `;
}

function buildServiceInsights(input: {
  serviceName: string;
  totalRevenue: number;
  bookingCount: number;
  customerCount: number;
  repeatPurchaseRate: number;
  growthRate: number;
  packageMixPct: number;
  topTherapist: string;
  topTherapistShare: number;
  averageDiscountRate: number;
  lastBookedDate: string | null;
}) {
  const insights: Array<{
    id: string;
    tone: "positive" | "attention" | "neutral";
    title: string;
    detail: string;
  }> = [];

  if (input.growthRate >= 18) {
    insights.push({
      id: "growth",
      tone: "positive",
      title: "Demand is accelerating",
      detail: `${input.serviceName} is growing ${input.growthRate.toFixed(1)}% against the previous comparison window.`,
    });
  } else if (input.growthRate <= -12) {
    insights.push({
      id: "decline",
      tone: "attention",
      title: "Demand is softening",
      detail: `${input.serviceName} is down ${Math.abs(input.growthRate).toFixed(1)}% versus the previous comparison window.`,
    });
  }

  if (input.repeatPurchaseRate >= 45) {
    insights.push({
      id: "repeat",
      tone: "positive",
      title: "Strong repeat behavior",
      detail: `${input.repeatPurchaseRate.toFixed(1)}% of customers returned for this service more than once in the selected period.`,
    });
  } else if (input.customerCount >= 8 && input.repeatPurchaseRate <= 18) {
    insights.push({
      id: "repeat-risk",
      tone: "attention",
      title: "Repeat depth is thin",
      detail: "This service is bringing customers in, but few are returning for a second round yet.",
    });
  }

  if (input.packageMixPct >= 55) {
    insights.push({
      id: "package-led",
      tone: "neutral",
      title: "Package-led service",
      detail: `${input.packageMixPct.toFixed(1)}% of paid service lines are package-based, which suggests planned continuity.`,
    });
  }

  if (input.averageDiscountRate >= 18) {
    insights.push({
      id: "discount-pressure",
      tone: "attention",
      title: "Discount pressure is high",
      detail: `Average invoice discount load is ${input.averageDiscountRate.toFixed(1)}%, which may be compressing margin.`,
    });
  }

  if (input.topTherapist && input.topTherapist !== "Unknown" && input.topTherapistShare >= 55) {
    insights.push({
      id: "therapist-dependence",
      tone: "neutral",
      title: "Performance leans on one therapist",
      detail: `${input.topTherapist} handles ${input.topTherapistShare.toFixed(1)}% of visible bookings for this service.`,
    });
  }

  if (!input.lastBookedDate) {
    insights.push({
      id: "recent-gap",
      tone: "attention",
      title: "No recent activity found",
      detail: "The selected period did not include a recent completed booking for this service.",
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "steady",
      tone: "neutral",
      title: "Balanced service profile",
      detail: "This service looks stable across demand, customer depth, and package behavior in the current window.",
    });
  }

  return insights.slice(0, 5);
}

function buildServiceRecommendedAction(input: {
  growthRate: number;
  repeatPurchaseRate: number;
  averageDiscountRate: number;
  topTherapistShare: number;
  packageMixPct: number;
}) {
  if (input.growthRate <= -12 && input.repeatPurchaseRate <= 20) {
    return "Review positioning, follow-up messaging, and aftercare to improve both first-time conversion and return visits.";
  }

  if (input.averageDiscountRate >= 18) {
    return "Audit discounting and consider a cleaner offer structure so the service is not over-reliant on price cuts.";
  }

  if (input.topTherapistShare >= 60) {
    return "Protect delivery quality by broadening therapist readiness for this service before growth depends on one operator.";
  }

  if (input.packageMixPct <= 20 && input.repeatPurchaseRate >= 30) {
    return "This service shows repeat potential. Consider a package or maintenance plan to formalize the revisit cadence.";
  }

  if (input.growthRate >= 18) {
    return "Lean into momentum with stronger promotion, tighter scheduling, and therapist capacity planning.";
  }

  return "Keep monitoring pricing, therapist performance, and repeat behavior while maintaining a clean premium presentation.";
}

export async function getServicePortalList(params: ServiceListParams) {
  const { previousFromDate, previousToDate } = getPreviousWindow(params.fromDate, params.toDate);
  const sortColumns: Record<ServiceListParams["sortBy"], string> = {
    totalRevenue: "totalRevenue",
    bookingCount: "bookingCount",
    customerCount: "customerCount",
    averageSellingPrice: "averageSellingPrice",
    repeatPurchaseRate: "repeatPurchaseRate",
    growthRate: "growthRate",
  };
  const orderBy = sortColumns[params.sortBy] ?? "totalRevenue";
  const direction = params.sortDirection === "asc" ? "ASC" : "DESC";
  const queryParams = {
    ...params,
    previousFromDate,
    previousToDate,
  };

  const [paymentRows, visitRows, therapistRows] = await Promise.all([
    runAnalyticsQuery<{
      serviceName: string;
      serviceCategory: string;
      totalRevenue: number;
      saleCount: number;
      payingCustomers: number;
      averageSellingPrice: number;
      packageMixPct: number;
      oneOffMixPct: number;
      previousRevenue: number;
    }>(
      `
        ${buildServicePaymentItemsCte("DATE(OrderCreatedDate) BETWEEN @previousFromDate AND @toDate")}
        ,
        ServicePeriods AS (
          SELECT
            serviceName,
            serviceCategory,
            SUM(CASE WHEN DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate THEN itemTotal ELSE 0 END) AS totalRevenue,
            COUNTIF(DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate) AS saleCount,
            COUNT(DISTINCT CASE WHEN DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate THEN phoneNumber ELSE NULL END) AS payingCustomers,
            SAFE_DIVIDE(
              SUM(CASE WHEN DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate THEN itemTotal ELSE 0 END),
              NULLIF(COUNTIF(DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate), 0)
            ) AS averageSellingPrice,
            SAFE_DIVIDE(
              COUNTIF(DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate AND purchaseMode = 'Package'),
              NULLIF(COUNTIF(DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate), 0)
            ) * 100 AS packageMixPct,
            SAFE_DIVIDE(
              COUNTIF(DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate AND purchaseMode = 'One-off'),
              NULLIF(COUNTIF(DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate), 0)
            ) * 100 AS oneOffMixPct,
            SUM(CASE WHEN DATE(orderCreatedDate) BETWEEN @previousFromDate AND @previousToDate THEN itemTotal ELSE 0 END) AS previousRevenue
          FROM ServicePaymentItems
          GROUP BY serviceName, serviceCategory
        )
        SELECT
          serviceName,
          serviceCategory,
          totalRevenue,
          saleCount,
          payingCustomers,
          averageSellingPrice,
          packageMixPct,
          oneOffMixPct,
          previousRevenue
        FROM ServicePeriods
        WHERE saleCount > 0
          AND (
            @search = ''
            OR LOWER(serviceName) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(serviceCategory) LIKE LOWER(CONCAT('%', @search, '%'))
          )
          AND (@serviceCategory = '' OR LOWER(serviceCategory) = LOWER(@serviceCategory))
      `,
      queryParams,
    ),
    runAnalyticsQuery<{
      serviceName: string;
      serviceCategory: string;
      bookingCount: number;
      customerCount: number;
      repeatCustomers: number;
      lastBookedDate: string | null;
      previousBookingCount: number;
      highValueCustomers: number;
    }>(
      `
        ${buildDistinctServiceVisitsCte("DATE(CheckInTime) BETWEEN @previousFromDate AND @toDate")}
        ,
        PeriodVisits AS (
          SELECT
            *
          FROM DistinctServiceVisits
          WHERE DATE(checkInTime) BETWEEN @fromDate AND @toDate
        ),
        PreviousVisits AS (
          SELECT
            *
          FROM DistinctServiceVisits
          WHERE DATE(checkInTime) BETWEEN @previousFromDate AND @previousToDate
        ),
        CustomerVisitCounts AS (
          SELECT
            serviceName,
            phoneNumber,
            COUNT(*) AS visitCount
          FROM PeriodVisits
          GROUP BY serviceName, phoneNumber
        ),
        CustomerSpendTier AS (
          SELECT
            serviceName,
            phoneNumber,
            COUNT(*) AS visitCount
          FROM DistinctServiceVisits
          GROUP BY serviceName, phoneNumber
        ),
        PreviousServiceBookings AS (
          SELECT
            serviceName,
            COUNT(*) AS previousBookingCount
          FROM PreviousVisits
          GROUP BY serviceName
        )
        SELECT
          visits.serviceName,
          ANY_VALUE(visits.serviceCategory) AS serviceCategory,
          COUNT(*) AS bookingCount,
          COUNT(DISTINCT visits.phoneNumber) AS customerCount,
          COUNTIF(customerCounts.visitCount > 1) AS repeatCustomers,
          FORMAT_DATE('%Y-%m-%d', MAX(DATE(visits.checkInTime))) AS lastBookedDate,
          COALESCE(previous.previousBookingCount, 0) AS previousBookingCount,
          COUNTIF(spend.visitCount >= 3) AS highValueCustomers
        FROM PeriodVisits AS visits
        LEFT JOIN CustomerVisitCounts AS customerCounts
          USING (serviceName, phoneNumber)
        LEFT JOIN CustomerSpendTier AS spend
          USING (serviceName, phoneNumber)
        LEFT JOIN PreviousServiceBookings AS previous
          USING (serviceName)
        WHERE (
          @search = ''
          OR LOWER(visits.serviceName) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(visits.serviceCategory) LIKE LOWER(CONCAT('%', @search, '%'))
        )
          AND (@serviceCategory = '' OR LOWER(visits.serviceCategory) = LOWER(@serviceCategory))
        GROUP BY visits.serviceName, previous.previousBookingCount
      `,
      queryParams,
    ),
    runAnalyticsQuery<{
      serviceName: string;
      topTherapist: string;
    }>(
      `
        ${buildDistinctServiceVisitsCte("DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
        ,
        TherapistServiceCounts AS (
          SELECT
            serviceName,
            therapistName,
            COUNT(*) AS bookingCount,
            MAX(checkInTime) AS latestVisitDate
          FROM DistinctServiceVisits
          GROUP BY serviceName, therapistName
        )
        SELECT
          serviceName,
          therapistName AS topTherapist
        FROM (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY serviceName
              ORDER BY bookingCount DESC, latestVisitDate DESC, therapistName ASC
            ) AS rowNum
          FROM TherapistServiceCounts
        )
        WHERE rowNum = 1
      `,
      params,
    ),
  ]);

  const visitMap = new Map(
    visitRows.map((row) => [
      row.serviceName.toLowerCase(),
      {
        serviceName: row.serviceName,
        serviceCategory: row.serviceCategory,
        bookingCount: parseNumber(row.bookingCount),
        customerCount: parseNumber(row.customerCount),
        repeatCustomers: parseNumber(row.repeatCustomers),
        lastBookedDate: row.lastBookedDate,
        previousBookingCount: parseNumber(row.previousBookingCount),
        highValueCustomers: parseNumber(row.highValueCustomers),
      },
    ]),
  );
  const therapistMap = new Map(
    therapistRows.map((row) => [row.serviceName.toLowerCase(), row.topTherapist]),
  );

  type ServicePortalRow = {
    serviceName: string;
    serviceCategory: string;
    totalRevenue: number;
    bookingCount: number;
    customerCount: number;
    averageSellingPrice: number;
    repeatPurchaseRate: number;
    lastBookedDate: string | null;
    topTherapist: string;
    packageMixPct: number;
    oneOffMixPct: number;
    growthRate: number;
    highValueCustomers: number;
  };

  const paymentMap = new Map(
    paymentRows.map((row) => [
      row.serviceName.toLowerCase(),
      {
        serviceName: row.serviceName,
        serviceCategory: row.serviceCategory,
        totalRevenue: parseNumber(row.totalRevenue),
        averageSellingPrice: Number(parseNumber(row.averageSellingPrice).toFixed(0)),
        packageMixPct: Number(parseNumber(row.packageMixPct).toFixed(1)),
        oneOffMixPct: Number(parseNumber(row.oneOffMixPct).toFixed(1)),
        previousRevenue: parseNumber(row.previousRevenue),
        payingCustomers: parseNumber(row.payingCustomers),
      },
    ]),
  );

  const serviceKeys = [...new Set([...paymentMap.keys(), ...visitMap.keys()])];

  const rows: ServicePortalRow[] = serviceKeys
    .map((serviceKey) => {
      const paymentMetrics = paymentMap.get(serviceKey);
      const visitMetrics = visitMap.get(serviceKey);
      const totalRevenue = paymentMetrics?.totalRevenue ?? 0;
      const previousRevenue = paymentMetrics?.previousRevenue ?? 0;
      const bookingCount = visitMetrics?.bookingCount ?? 0;
      const customerCount = visitMetrics?.customerCount ?? paymentMetrics?.payingCustomers ?? 0;
      const repeatCustomers = visitMetrics?.repeatCustomers ?? 0;
      const repeatPurchaseRate =
        customerCount > 0 ? Number(((repeatCustomers / customerCount) * 100).toFixed(1)) : 0;
      const growthBase = previousRevenue > 0 ? previousRevenue : visitMetrics?.previousBookingCount ?? 0;
      const growthNumerator =
        previousRevenue > 0 ? totalRevenue - previousRevenue : bookingCount - (visitMetrics?.previousBookingCount ?? 0);
      const growthRate =
        growthBase > 0 ? Number(((growthNumerator / growthBase) * 100).toFixed(1)) : totalRevenue > 0 || bookingCount > 0 ? 100 : 0;

      return {
        serviceName: paymentMetrics?.serviceName ?? visitMetrics?.serviceName ?? serviceKey,
        serviceCategory: paymentMetrics?.serviceCategory || visitMetrics?.serviceCategory || "Other",
        totalRevenue,
        bookingCount,
        customerCount,
        averageSellingPrice: paymentMetrics?.averageSellingPrice ?? 0,
        repeatPurchaseRate,
        lastBookedDate: visitMetrics?.lastBookedDate ?? null,
        topTherapist: therapistMap.get(serviceKey) ?? "Unknown",
        packageMixPct: paymentMetrics?.packageMixPct ?? 0,
        oneOffMixPct: paymentMetrics?.oneOffMixPct ?? 0,
        growthRate,
        highValueCustomers: visitMetrics?.highValueCustomers ?? 0,
      };
    })
    .sort((left, right) => {
      const getSortValue = (row: ServicePortalRow) => {
        switch (orderBy) {
          case "bookingCount":
            return row.bookingCount;
          case "customerCount":
            return row.customerCount;
          case "averageSellingPrice":
            return row.averageSellingPrice;
          case "repeatPurchaseRate":
            return row.repeatPurchaseRate;
          case "growthRate":
            return row.growthRate;
          case "totalRevenue":
          default:
            return row.totalRevenue;
        }
      };

      const leftValue = getSortValue(left);
      const rightValue = getSortValue(right);
      const leftComparable = typeof leftValue === "number" ? leftValue : String(leftValue ?? "").toLowerCase();
      const rightComparable = typeof rightValue === "number" ? rightValue : String(rightValue ?? "").toLowerCase();

      if (leftComparable < rightComparable) {
        return direction === "ASC" ? -1 : 1;
      }
      if (leftComparable > rightComparable) {
        return direction === "ASC" ? 1 : -1;
      }
      return left.serviceName.localeCompare(right.serviceName);
    });

  const serviceCount = rows.length;
  const totalRevenue = rows.reduce((sum, row) => sum + row.totalRevenue, 0);
  const totalBookings = rows.reduce((sum, row) => sum + row.bookingCount, 0);
  const totalCustomers = rows.reduce((sum, row) => sum + row.customerCount, 0);
  const averageRepeatRate =
    serviceCount > 0
      ? Number((rows.reduce((sum, row) => sum + row.repeatPurchaseRate, 0) / serviceCount).toFixed(1))
      : 0;
  const averagePrice =
    serviceCount > 0
      ? Number((rows.reduce((sum, row) => sum + row.averageSellingPrice, 0) / serviceCount).toFixed(0))
      : 0;
  const packageRevenueShare =
    serviceCount > 0
      ? Number((rows.reduce((sum, row) => sum + row.packageMixPct, 0) / serviceCount).toFixed(1))
      : 0;

  return {
    summary: {
      serviceCount,
      totalRevenue,
      totalBookings,
      totalCustomers,
      averageRepeatRate,
      averagePrice,
      packageRevenueShare,
    },
    filterOptions: {
      serviceCategories: [...new Set(rows.map((row) => row.serviceCategory).filter(Boolean))].sort((left, right) =>
        left.localeCompare(right),
      ),
    },
    rows,
  };
}

export async function getServicePortalOverview(params: DetailBaseParams) {
  const { previousFromDate, previousToDate } = getPreviousWindow(params.fromDate, params.toDate);
  const queryParams = {
    ...params,
    previousFromDate,
    previousToDate,
  };

  const [paymentRows, visitRows, trendRows, therapistRows, paymentMixRows, customerRows, relatedRows, weekdayRows, hourRows] =
    await Promise.all([
      runAnalyticsQuery<{
        totalRevenue: number;
        saleCount: number;
        paymentCustomerCount: number;
        averageSellingPrice: number;
        packageMixPct: number;
        oneOffMixPct: number;
        averageDiscountRate: number;
        previousRevenue: number;
      }>(
        `
          ${buildServicePaymentItemsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(OrderCreatedDate) BETWEEN @previousFromDate AND @toDate")}
          SELECT
            SUM(CASE WHEN DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate THEN itemTotal ELSE 0 END) AS totalRevenue,
            COUNTIF(DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate) AS saleCount,
            COUNT(DISTINCT CASE WHEN DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate THEN phoneNumber ELSE NULL END) AS paymentCustomerCount,
            SAFE_DIVIDE(
              SUM(CASE WHEN DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate THEN itemTotal ELSE 0 END),
              NULLIF(COUNTIF(DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate), 0)
            ) AS averageSellingPrice,
            SAFE_DIVIDE(
              COUNTIF(DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate AND purchaseMode = 'Package'),
              NULLIF(COUNTIF(DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate), 0)
            ) * 100 AS packageMixPct,
            SAFE_DIVIDE(
              COUNTIF(DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate AND purchaseMode = 'One-off'),
              NULLIF(COUNTIF(DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate), 0)
            ) * 100 AS oneOffMixPct,
            AVG(
              CASE
                WHEN invoiceNetTotal = 0 THEN 0
                ELSE SAFE_DIVIDE(invoiceDiscount, invoiceNetTotal) * 100
              END
            ) AS averageDiscountRate,
            SUM(CASE WHEN DATE(orderCreatedDate) BETWEEN @previousFromDate AND @previousToDate THEN itemTotal ELSE 0 END) AS previousRevenue
          FROM ServicePaymentItems
        `,
        queryParams,
      ),
      runAnalyticsQuery<{
        serviceCategory: string;
        bookingCount: number;
        customerCount: number;
        repeatCustomers: number;
        lastBookedDate: string | null;
        packageRemainingUsage: number;
        topTherapist: string;
        topTherapistBookings: number;
        previousBookingCount: number;
      }>(
        `
          ${buildDistinctServiceVisitsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(CheckInTime) BETWEEN @previousFromDate AND @toDate")}
          ,
          PeriodVisits AS (
            SELECT *
            FROM DistinctServiceVisits
            WHERE DATE(checkInTime) BETWEEN @fromDate AND @toDate
          ),
          PreviousVisits AS (
            SELECT *
            FROM DistinctServiceVisits
            WHERE DATE(checkInTime) BETWEEN @previousFromDate AND @previousToDate
          ),
          CustomerVisitCounts AS (
            SELECT
              phoneNumber,
              COUNT(*) AS visitCount
            FROM PeriodVisits
            GROUP BY phoneNumber
          ),
          TherapistCounts AS (
            SELECT
              therapistName,
              COUNT(*) AS bookingCount,
              MAX(checkInTime) AS latestVisitDate
            FROM PeriodVisits
            GROUP BY therapistName
          ),
          TopTherapist AS (
            SELECT
              therapistName AS topTherapist,
              bookingCount AS topTherapistBookings
            FROM (
              SELECT
                *,
                ROW_NUMBER() OVER (ORDER BY bookingCount DESC, latestVisitDate DESC, therapistName ASC) AS rowNum
              FROM TherapistCounts
            )
            WHERE rowNum = 1
          )
          SELECT
            ANY_VALUE(serviceCategory) AS serviceCategory,
            COUNT(*) AS bookingCount,
            COUNT(DISTINCT phoneNumber) AS customerCount,
            COUNTIF(customerCounts.visitCount > 1) AS repeatCustomers,
            FORMAT_DATE('%Y-%m-%d', MAX(DATE(checkInTime))) AS lastBookedDate,
            SUM(GREATEST(remainingPackageCount, 0)) AS packageRemainingUsage,
            (SELECT topTherapist FROM TopTherapist) AS topTherapist,
            COALESCE((SELECT topTherapistBookings FROM TopTherapist), 0) AS topTherapistBookings,
            (SELECT COUNT(*) FROM PreviousVisits) AS previousBookingCount
          FROM PeriodVisits
          LEFT JOIN CustomerVisitCounts AS customerCounts USING (phoneNumber)
        `,
        queryParams,
      ),
      runAnalyticsQuery<{
        bucket: string;
        revenue: number;
        bookings: number;
        customers: number;
        averagePrice: number;
        discountRate: number;
      }>(
        `
          ${buildServicePaymentItemsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate")}
          ,
          RevenueTrend AS (
            SELECT
              FORMAT_DATE('%Y-%m', DATE(orderCreatedDate)) AS bucket,
              SUM(itemTotal) AS revenue,
              SAFE_DIVIDE(SUM(itemTotal), NULLIF(COUNT(*), 0)) AS averagePrice,
              AVG(
                CASE
                  WHEN invoiceNetTotal = 0 THEN 0
                  ELSE SAFE_DIVIDE(invoiceDiscount, invoiceNetTotal) * 100
                END
              ) AS discountRate
            FROM ServicePaymentItems
            GROUP BY bucket
          )
          ${buildDistinctServiceVisitsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate").replace("WITH DistinctServiceVisits AS", ", DistinctServiceVisits AS")}
          ,
          VisitTrend AS (
            SELECT
              FORMAT_DATE('%Y-%m', DATE(checkInTime)) AS bucket,
              COUNT(*) AS bookings,
              COUNT(DISTINCT phoneNumber) AS customers
            FROM DistinctServiceVisits
            GROUP BY bucket
          ),
          Buckets AS (
            SELECT bucket FROM RevenueTrend
            UNION DISTINCT
            SELECT bucket FROM VisitTrend
          )
          SELECT
            bucket,
            COALESCE((SELECT revenue FROM RevenueTrend WHERE RevenueTrend.bucket = Buckets.bucket), 0) AS revenue,
            COALESCE((SELECT bookings FROM VisitTrend WHERE VisitTrend.bucket = Buckets.bucket), 0) AS bookings,
            COALESCE((SELECT customers FROM VisitTrend WHERE VisitTrend.bucket = Buckets.bucket), 0) AS customers,
            COALESCE((SELECT averagePrice FROM RevenueTrend WHERE RevenueTrend.bucket = Buckets.bucket), 0) AS averagePrice,
            COALESCE((SELECT discountRate FROM RevenueTrend WHERE RevenueTrend.bucket = Buckets.bucket), 0) AS discountRate
          FROM Buckets
          ORDER BY bucket ASC
        `,
        queryParams,
      ),
      runAnalyticsQuery<{
        therapistName: string;
        bookingCount: number;
        customerCount: number;
        serviceValue: number;
        latestVisitDate: string | null;
      }>(
        `
          ${buildDistinctServiceVisitsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
          SELECT
            therapistName,
            COUNT(*) AS bookingCount,
            COUNT(DISTINCT phoneNumber) AS customerCount,
            SUM(price) AS serviceValue,
            FORMAT_DATE('%Y-%m-%d', MAX(DATE(checkInTime))) AS latestVisitDate
          FROM DistinctServiceVisits
          GROUP BY therapistName
          ORDER BY bookingCount DESC, serviceValue DESC, therapistName ASC
          LIMIT 8
        `,
        queryParams,
      ),
      runAnalyticsQuery<{
        paymentMethod: string;
        totalAmount: number;
        transactionCount: number;
      }>(
        `
          ${buildServicePaymentItemsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate")}
          SELECT
            paymentMethod,
            SUM(itemTotal) AS totalAmount,
            COUNT(*) AS transactionCount
          FROM ServicePaymentItems
          GROUP BY paymentMethod
          ORDER BY totalAmount DESC, paymentMethod ASC
        `,
        queryParams,
      ),
      runAnalyticsQuery<{
        customerName: string;
        phoneNumber: string;
        memberId: string;
        totalRevenue: number;
        visitCount: number;
        lastVisitDate: string | null;
      }>(
        `
          ${buildServicePaymentItemsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate")}
          ${buildDistinctServiceVisitsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate").replace("WITH DistinctServiceVisits AS", ", DistinctServiceVisits AS")}
          ,
          PaymentCustomers AS (
            SELECT
              customerName,
              phoneNumber,
              MAX(memberId) AS memberId,
              SUM(itemTotal) AS totalRevenue
            FROM ServicePaymentItems
            GROUP BY customerName, phoneNumber
          ),
          VisitCustomers AS (
            SELECT
              customerName,
              phoneNumber,
              COUNT(*) AS visitCount,
              FORMAT_DATE('%Y-%m-%d', MAX(DATE(checkInTime))) AS lastVisitDate
            FROM DistinctServiceVisits
            GROUP BY customerName, phoneNumber
          )
          SELECT
            COALESCE(pay.customerName, visits.customerName) AS customerName,
            COALESCE(pay.phoneNumber, visits.phoneNumber) AS phoneNumber,
            COALESCE(pay.memberId, '') AS memberId,
            COALESCE(pay.totalRevenue, 0) AS totalRevenue,
            COALESCE(visits.visitCount, 0) AS visitCount,
            visits.lastVisitDate
          FROM PaymentCustomers AS pay
          FULL OUTER JOIN VisitCustomers AS visits
            USING (customerName, phoneNumber)
          ORDER BY totalRevenue DESC, visitCount DESC, customerName ASC
          LIMIT 6
        `,
        queryParams,
      ),
      runAnalyticsQuery<{
        serviceName: string;
        sharedCustomerCount: number;
        pairCount: number;
        serviceCategory: string;
      }>(
        `
          ${buildDistinctServiceVisitsCte("DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
          ,
          TargetCustomers AS (
            SELECT DISTINCT customerName, phoneNumber
            FROM DistinctServiceVisits
            WHERE LOWER(serviceName) = LOWER(@serviceName)
          )
          SELECT
            other.serviceName AS serviceName,
            ANY_VALUE(other.serviceCategory) AS serviceCategory,
            COUNT(DISTINCT other.phoneNumber) AS sharedCustomerCount,
            COUNT(*) AS pairCount
          FROM DistinctServiceVisits AS other
          JOIN TargetCustomers AS target
            USING (customerName, phoneNumber)
          WHERE LOWER(other.serviceName) != LOWER(@serviceName)
          GROUP BY other.serviceName
          ORDER BY sharedCustomerCount DESC, pairCount DESC, other.serviceName ASC
          LIMIT 8
        `,
        queryParams,
      ),
      runAnalyticsQuery<{
        label: string;
        bookingCount: number;
      }>(
        `
          ${buildDistinctServiceVisitsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
          SELECT
            FORMAT_DATE('%A', DATE(checkInTime)) AS label,
            COUNT(*) AS bookingCount
          FROM DistinctServiceVisits
          GROUP BY label
          ORDER BY bookingCount DESC, label ASC
          LIMIT 4
        `,
        queryParams,
      ),
      runAnalyticsQuery<{
        label: string;
        bookingCount: number;
      }>(
        `
          ${buildDistinctServiceVisitsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
          SELECT
            CONCAT(CAST(EXTRACT(HOUR FROM checkInTime) AS STRING), ':00') AS label,
            COUNT(*) AS bookingCount
          FROM DistinctServiceVisits
          GROUP BY label
          ORDER BY bookingCount DESC, label ASC
          LIMIT 4
        `,
        queryParams,
      ),
    ]);

  const paymentSummary = paymentRows[0];
  const visitSummary = visitRows[0];
  const totalRevenue = parseNumber(paymentSummary?.totalRevenue);
  const bookingCount = parseNumber(visitSummary?.bookingCount);
  const customerCount = parseNumber(visitSummary?.customerCount || paymentSummary?.paymentCustomerCount);
  const repeatCustomers = parseNumber(visitSummary?.repeatCustomers);
  const repeatPurchaseRate =
    customerCount > 0 ? Number(((repeatCustomers / customerCount) * 100).toFixed(1)) : 0;
  const previousRevenue = parseNumber(paymentSummary?.previousRevenue);
  const previousBookingCount = parseNumber(visitSummary?.previousBookingCount);
  const growthBase = previousRevenue > 0 ? previousRevenue : previousBookingCount;
  const growthNumerator = previousRevenue > 0 ? totalRevenue - previousRevenue : bookingCount - previousBookingCount;
  const growthRate =
    growthBase > 0 ? Number(((growthNumerator / growthBase) * 100).toFixed(1)) : totalRevenue > 0 || bookingCount > 0 ? 100 : 0;
  const topTherapistBookings = parseNumber(visitSummary?.topTherapistBookings);
  const topTherapistShare =
    bookingCount > 0 ? Number(((topTherapistBookings / bookingCount) * 100).toFixed(1)) : 0;
  const averageDiscountRate = Number(parseNumber(paymentSummary?.averageDiscountRate).toFixed(1));

  const insights = buildServiceInsights({
    serviceName: params.serviceName,
    totalRevenue,
    bookingCount,
    customerCount,
    repeatPurchaseRate,
    growthRate,
    packageMixPct: Number(parseNumber(paymentSummary?.packageMixPct).toFixed(1)),
    topTherapist: parseText(visitSummary?.topTherapist, "Unknown"),
    topTherapistShare,
    averageDiscountRate,
    lastBookedDate: visitSummary?.lastBookedDate ?? null,
  });

  return {
    service: {
      serviceName: params.serviceName,
      serviceCategory: parseText(visitSummary?.serviceCategory, "Other"),
      totalRevenue,
      bookingCount,
      customerCount,
      averageSellingPrice: Number(parseNumber(paymentSummary?.averageSellingPrice).toFixed(0)),
      repeatPurchaseRate,
      lastBookedDate: visitSummary?.lastBookedDate ?? null,
      topTherapist: parseText(visitSummary?.topTherapist, "Unknown"),
      topTherapistShare,
      packageMixPct: Number(parseNumber(paymentSummary?.packageMixPct).toFixed(1)),
      oneOffMixPct: Number(parseNumber(paymentSummary?.oneOffMixPct).toFixed(1)),
      growthRate,
      averageDiscountRate,
      packageRemainingUsage: parseNumber(visitSummary?.packageRemainingUsage),
      revenuePerCustomer:
        customerCount > 0 ? Number((totalRevenue / customerCount).toFixed(0)) : 0,
      status:
        growthRate >= 18
          ? "Growing"
          : growthRate <= -12
            ? "Needs attention"
            : repeatPurchaseRate >= 35
              ? "Retention-led"
              : "Stable",
    },
    trend: trendRows.map((row) => ({
      bucket: row.bucket,
      revenue: parseNumber(row.revenue),
      bookings: parseNumber(row.bookings),
      customers: parseNumber(row.customers),
      averagePrice: Number(parseNumber(row.averagePrice).toFixed(0)),
      discountRate: Number(parseNumber(row.discountRate).toFixed(1)),
    })),
    therapistPerformance: therapistRows.map((row) => ({
      therapistName: row.therapistName,
      bookingCount: parseNumber(row.bookingCount),
      customerCount: parseNumber(row.customerCount),
      revenue: parseNumber(row.serviceValue),
      averagePrice:
        parseNumber(row.bookingCount) > 0
          ? Number((parseNumber(row.serviceValue) / parseNumber(row.bookingCount)).toFixed(0))
          : 0,
      latestVisitDate: row.latestVisitDate,
    })),
    paymentMix: paymentMixRows.map((row) => ({
      paymentMethod: row.paymentMethod,
      totalAmount: parseNumber(row.totalAmount),
      transactionCount: parseNumber(row.transactionCount),
      contributionPct:
        totalRevenue > 0
          ? Number(((parseNumber(row.totalAmount) / totalRevenue) * 100).toFixed(1))
          : 0,
    })),
    topCustomers: customerRows.map((row, index) => ({
      customerName: row.customerName,
      phoneNumber: row.phoneNumber,
      memberId: row.memberId,
      totalRevenue: parseNumber(row.totalRevenue),
      visitCount: parseNumber(row.visitCount),
      lastVisitDate: row.lastVisitDate,
      relationship:
        parseNumber(row.visitCount) >= 4 ? "Core" : parseNumber(row.visitCount) >= 2 ? "Returning" : "New",
      rank: index + 1,
    })),
    relatedServices: relatedRows.map((row) => ({
      serviceName: row.serviceName,
      serviceCategory: row.serviceCategory,
      sharedCustomerCount: parseNumber(row.sharedCustomerCount),
      pairCount: parseNumber(row.pairCount),
    })),
    peakPeriods: {
      weekdays: weekdayRows.map((row) => ({
        label: row.label,
        bookingCount: parseNumber(row.bookingCount),
      })),
      hours: hourRows.map((row) => ({
        label: row.label,
        bookingCount: parseNumber(row.bookingCount),
      })),
    },
    insights,
    recommendedAction: buildServiceRecommendedAction({
      growthRate,
      repeatPurchaseRate,
      averageDiscountRate,
      topTherapistShare,
      packageMixPct: Number(parseNumber(paymentSummary?.packageMixPct).toFixed(1)),
    }),
    assumptions: [
      "Revenue uses paid service-line amounts from the analytics payment view.",
      "Therapist performance uses completed treatment records and service price as the operational value proxy.",
      "Related services are based on shared customers within the selected date range.",
    ],
  };
}

export async function getServicePortalCustomers(params: PagedDetailParams) {
  const queryParams = {
    ...params,
    offset: (params.page - 1) * params.pageSize,
  };

  const [summaryRows, totalRows, rows] = await Promise.all([
    runAnalyticsQuery<{
      customerCount: number;
      repeatCustomers: number;
      averageRevenuePerCustomer: number;
    }>(
      `
        ${buildServicePaymentItemsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate")}
        ${buildDistinctServiceVisitsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate").replace("WITH DistinctServiceVisits AS", ", DistinctServiceVisits AS")}
        ,
        PaymentCustomers AS (
          SELECT
            customerName,
            phoneNumber,
            SUM(itemTotal) AS totalRevenue
          FROM ServicePaymentItems
          GROUP BY customerName, phoneNumber
        ),
        VisitCustomers AS (
          SELECT
            customerName,
            phoneNumber,
            COUNT(*) AS visitCount
          FROM DistinctServiceVisits
          GROUP BY customerName, phoneNumber
        ),
        CombinedCustomers AS (
          SELECT
            COALESCE(pay.customerName, visits.customerName) AS customerName,
            COALESCE(pay.phoneNumber, visits.phoneNumber) AS phoneNumber,
            COALESCE(pay.totalRevenue, 0) AS totalRevenue,
            COALESCE(visits.visitCount, 0) AS visitCount
          FROM PaymentCustomers AS pay
          FULL OUTER JOIN VisitCustomers AS visits
            USING (customerName, phoneNumber)
        )
        SELECT
          COUNT(*) AS customerCount,
          COUNTIF(visitCount > 1) AS repeatCustomers,
          AVG(totalRevenue) AS averageRevenuePerCustomer
        FROM CombinedCustomers
      `,
      queryParams,
    ),
    runAnalyticsQuery<{ totalCount: number }>(
      `
        ${buildServicePaymentItemsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate")}
        ${buildDistinctServiceVisitsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate").replace("WITH DistinctServiceVisits AS", ", DistinctServiceVisits AS")}
        ,
        PaymentCustomers AS (
          SELECT
            customerName,
            phoneNumber,
            MAX(memberId) AS memberId,
            SUM(itemTotal) AS totalRevenue
          FROM ServicePaymentItems
          GROUP BY customerName, phoneNumber
        ),
        VisitCustomers AS (
          SELECT
            customerName,
            phoneNumber,
            COUNT(*) AS visitCount,
            FORMAT_DATE('%Y-%m-%d', MAX(DATE(checkInTime))) AS lastVisitDate
          FROM DistinctServiceVisits
          GROUP BY customerName, phoneNumber
        ),
        CombinedCustomers AS (
          SELECT
            COALESCE(pay.customerName, visits.customerName) AS customerName,
            COALESCE(pay.phoneNumber, visits.phoneNumber) AS phoneNumber,
            COALESCE(pay.memberId, '') AS memberId,
            COALESCE(pay.totalRevenue, 0) AS totalRevenue,
            COALESCE(visits.visitCount, 0) AS visitCount,
            visits.lastVisitDate
          FROM PaymentCustomers AS pay
          FULL OUTER JOIN VisitCustomers AS visits
            USING (customerName, phoneNumber)
        )
        SELECT COUNT(*) AS totalCount
        FROM CombinedCustomers
        WHERE
          @search = ''
          OR LOWER(customerName) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(phoneNumber) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(memberId) LIKE LOWER(CONCAT('%', @search, '%'))
      `,
      queryParams,
    ),
    runAnalyticsQuery<{
      customerName: string;
      phoneNumber: string;
      memberId: string;
      totalRevenue: number;
      visitCount: number;
      lastVisitDate: string | null;
    }>(
      `
        ${buildServicePaymentItemsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate")}
        ${buildDistinctServiceVisitsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate").replace("WITH DistinctServiceVisits AS", ", DistinctServiceVisits AS")}
        ,
        PaymentCustomers AS (
          SELECT
            customerName,
            phoneNumber,
            MAX(memberId) AS memberId,
            SUM(itemTotal) AS totalRevenue
          FROM ServicePaymentItems
          GROUP BY customerName, phoneNumber
        ),
        VisitCustomers AS (
          SELECT
            customerName,
            phoneNumber,
            COUNT(*) AS visitCount,
            FORMAT_DATE('%Y-%m-%d', MAX(DATE(checkInTime))) AS lastVisitDate
          FROM DistinctServiceVisits
          GROUP BY customerName, phoneNumber
        ),
        CombinedCustomers AS (
          SELECT
            COALESCE(pay.customerName, visits.customerName) AS customerName,
            COALESCE(pay.phoneNumber, visits.phoneNumber) AS phoneNumber,
            COALESCE(pay.memberId, '') AS memberId,
            COALESCE(pay.totalRevenue, 0) AS totalRevenue,
            COALESCE(visits.visitCount, 0) AS visitCount,
            visits.lastVisitDate
          FROM PaymentCustomers AS pay
          FULL OUTER JOIN VisitCustomers AS visits
            USING (customerName, phoneNumber)
        )
        SELECT
          customerName,
          phoneNumber,
          memberId,
          totalRevenue,
          visitCount,
          lastVisitDate
        FROM CombinedCustomers
        WHERE
          @search = ''
          OR LOWER(customerName) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(phoneNumber) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(memberId) LIKE LOWER(CONCAT('%', @search, '%'))
        ORDER BY totalRevenue DESC, visitCount DESC, customerName ASC
        LIMIT @pageSize
        OFFSET @offset
      `,
      queryParams,
    ),
  ]);

  const summary = summaryRows[0];
  const total = totalRows[0];

  return {
    summary: {
      customerCount: parseNumber(summary?.customerCount),
      repeatCustomers: parseNumber(summary?.repeatCustomers),
      averageRevenuePerCustomer: Number(parseNumber(summary?.averageRevenuePerCustomer).toFixed(0)),
    },
    rows: rows.map((row) => ({
      customerName: row.customerName,
      phoneNumber: row.phoneNumber,
      memberId: row.memberId,
      totalRevenue: parseNumber(row.totalRevenue),
      visitCount: parseNumber(row.visitCount),
      lastVisitDate: row.lastVisitDate,
      relationship:
        parseNumber(row.visitCount) >= 4 ? "Core" : parseNumber(row.visitCount) >= 2 ? "Returning" : "New",
    })),
    totalCount: parseNumber(total?.totalCount),
  };
}

export async function getServicePortalPayments(params: PagedDetailParams) {
  const queryParams = {
    ...params,
    offset: (params.page - 1) * params.pageSize,
  };

  const [summaryRows, totalRows, rows] = await Promise.all([
    runAnalyticsQuery<{
      totalRevenue: number;
      invoiceCount: number;
      averageLineValue: number;
      averageDiscountRate: number;
    }>(
      `
        ${buildServicePaymentItemsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate")}
        SELECT
          SUM(itemTotal) AS totalRevenue,
          COUNT(DISTINCT invoiceNumber) AS invoiceCount,
          AVG(itemTotal) AS averageLineValue,
          AVG(
            CASE
              WHEN invoiceNetTotal = 0 THEN 0
              ELSE SAFE_DIVIDE(invoiceDiscount, invoiceNetTotal) * 100
            END
          ) AS averageDiscountRate
        FROM ServicePaymentItems
      `,
      queryParams,
    ),
    runAnalyticsQuery<{ totalCount: number }>(
      `
        ${buildServicePaymentItemsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate")}
        SELECT COUNT(*) AS totalCount
        FROM ServicePaymentItems
        WHERE
          @search = ''
          OR LOWER(invoiceNumber) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(customerName) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(phoneNumber) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(paymentMethod) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(COALESCE(packageName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
      `,
      queryParams,
    ),
    runAnalyticsQuery<{
      orderDate: string;
      invoiceNumber: string;
      customerName: string;
      phoneNumber: string;
      memberId: string;
      packageName: string;
      paymentMethod: string;
      sellerName: string;
      itemQuantity: number;
      itemPrice: number;
      itemTotal: number;
      invoiceDiscount: number;
      outstandingAmount: number;
    }>(
      `
        ${buildServicePaymentItemsCte("LOWER(COALESCE(ServiceName, '')) = LOWER(@serviceName) AND DATE(OrderCreatedDate) BETWEEN @fromDate AND @toDate")}
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(orderCreatedDate)) AS orderDate,
          invoiceNumber,
          customerName,
          phoneNumber,
          memberId,
          packageName,
          paymentMethod,
          sellerName,
          itemQuantity,
          itemPrice,
          itemTotal,
          invoiceDiscount,
          outstandingAmount
        FROM ServicePaymentItems
        WHERE
          @search = ''
          OR LOWER(invoiceNumber) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(customerName) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(phoneNumber) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(paymentMethod) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(COALESCE(packageName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        ORDER BY orderCreatedDate DESC, invoiceNumber DESC
        LIMIT @pageSize
        OFFSET @offset
      `,
      queryParams,
    ),
  ]);

  const summary = summaryRows[0];
  const total = totalRows[0];

  return {
    summary: {
      totalRevenue: parseNumber(summary?.totalRevenue),
      invoiceCount: parseNumber(summary?.invoiceCount),
      averageLineValue: Number(parseNumber(summary?.averageLineValue).toFixed(0)),
      averageDiscountRate: Number(parseNumber(summary?.averageDiscountRate).toFixed(1)),
    },
    rows: rows.map((row) => ({
      dateLabel: row.orderDate,
      invoiceNumber: row.invoiceNumber,
      customerName: row.customerName,
      phoneNumber: row.phoneNumber,
      memberId: row.memberId,
      servicePackageName: row.packageName || null,
      paymentMethod: row.paymentMethod,
      salePerson: row.sellerName,
      itemQuantity: parseNumber(row.itemQuantity),
      unitPrice: parseNumber(row.itemPrice),
      lineTotal: parseNumber(row.itemTotal),
      discountAmount: parseNumber(row.invoiceDiscount),
      outstandingAmount: parseNumber(row.outstandingAmount),
    })),
    totalCount: parseNumber(total?.totalCount),
  };
}
