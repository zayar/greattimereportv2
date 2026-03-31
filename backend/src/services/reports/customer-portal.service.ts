import { analyticsTables } from "../../config/bigquery.js";
import { runAnalyticsQuery } from "../bigquery.service.js";
import { calculateCustomerRiskSignals } from "../ai/customer-risk.service.js";

type CustomerIdentity = {
  customerName: string;
  customerPhone: string;
};

type CustomerListParams = {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  search: string;
  status: string;
  spendTier: string;
  therapist: string;
  serviceCategory: string;
  sortBy: "lifetimeSpend" | "lastVisitDate" | "visitCount" | "averageSpend";
  sortDirection: "asc" | "desc";
  limit: number;
  offset: number;
};

type DetailBaseParams = {
  clinicCode: string;
  fromDate: string;
  toDate: string;
} & CustomerIdentity;

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

  if (typeof value === "object") {
    if ("value" in value) {
      return parseText((value as { value: unknown }).value, fallback);
    }

    if ("preferredService" in value) {
      return parseText((value as { preferredService: unknown }).preferredService, fallback);
    }

    if ("preferredTherapist" in value) {
      return parseText((value as { preferredTherapist: unknown }).preferredTherapist, fallback);
    }

    if ("preferredServiceCategory" in value) {
      return parseText((value as { preferredServiceCategory: unknown }).preferredServiceCategory, fallback);
    }
  }

  return fallback;
}

function normalizePhoneDigits(value: string) {
  return value.replace(/\D/g, "");
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

function buildCustomerIdentityCondition(phoneField: string, nameField: string) {
  return `
    (
      (
        @customerPhoneDigits != ''
        AND REGEXP_REPLACE(COALESCE(${phoneField}, ''), r'[^0-9]', '') = @customerPhoneDigits
        AND (@customerName = '' OR LOWER(COALESCE(${nameField}, '')) = LOWER(@customerName))
      )
      OR (
        @customerPhoneDigits = ''
        AND @customerName != ''
        AND LOWER(COALESCE(${nameField}, '')) = LOWER(@customerName)
      )
    )
  `;
}

function buildInvoiceLevelPaymentsCte(extraWhere = "1 = 1") {
  return `
    InvoiceLevelPayments AS (
      SELECT
        CustomerName AS customerName,
        CustomerPhoneNumber AS phoneNumber,
        InvoiceNumber AS invoiceNumber,
        MAX(OrderCreatedDate) AS orderCreatedDate,
        MAX(COALESCE(MemberID, '')) AS memberId,
        MAX(COALESCE(PaymentMethod, 'Unknown')) AS paymentMethod,
        MAX(COALESCE(PaymentStatus, '')) AS paymentStatus,
        MAX(COALESCE(SellerName, 'Unknown')) AS salePerson,
        MAX(CAST(COALESCE(NetTotal, 0) AS FLOAT64)) AS invoiceNetTotal,
        MAX(CAST(COALESCE(Total, 0) AS FLOAT64)) AS invoiceTotal,
        MAX(CAST(COALESCE(Discount, 0) AS FLOAT64)) AS discount,
        MAX(CAST(COALESCE(Tax, 0) AS FLOAT64)) AS tax,
        MAX(CAST(COALESCE(OrderBalance, 0) AS FLOAT64)) AS orderBalance,
        MAX(CAST(COALESCE(OrderCreditBalance, 0) AS FLOAT64)) AS orderCreditBalance,
        ARRAY_AGG(COALESCE(ServiceName, '') IGNORE NULLS ORDER BY ServiceName ASC LIMIT 1)[SAFE_OFFSET(0)] AS serviceName,
        ARRAY_AGG(ServicePackageName IGNORE NULLS ORDER BY ServicePackageName ASC LIMIT 1)[SAFE_OFFSET(0)] AS servicePackageName,
        ARRAY_AGG(
          ${buildServiceCategoryExpression("ServiceName", "ServicePackageName")}
          ORDER BY ServiceName ASC
          LIMIT 1
        )[SAFE_OFFSET(0)] AS serviceCategory
      FROM ${analyticsTables.mainPaymentView}
      WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
        AND CustomerName IS NOT NULL
        AND CustomerPhoneNumber IS NOT NULL
        AND PaymentStatus = 'PAID'
        AND NOT STARTS_WITH(InvoiceNumber, 'CO-')
        AND COALESCE(PaymentMethod, '') != 'PASS'
        AND ${extraWhere}
      GROUP BY customerName, phoneNumber, invoiceNumber
    )
  `;
}

function buildDistinctVisitsCte(extraWhere = "1 = 1") {
  return `
    DistinctVisits AS (
      SELECT
        CustomerName AS customerName,
        CustomerPhoneNumber AS phoneNumber,
        COALESCE(
          CAST(BookingID AS STRING),
          CONCAT(FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', CheckInTime), '-', COALESCE(ServiceName, ''))
        ) AS visitKey,
        MAX(CheckInTime) AS checkInTime,
        MAX(CheckOutTime) AS checkOutTime,
        MAX(COALESCE(CustomerID, '')) AS memberId,
        MAX(DateOfBirth) AS dateOfBirth,
        ARRAY_AGG(COALESCE(ServiceName, '') IGNORE NULLS ORDER BY CheckInTime DESC LIMIT 1)[SAFE_OFFSET(0)] AS serviceName,
        CAST(NULL AS STRING) AS servicePackageName,
        ARRAY_AGG(COALESCE(PractitionerName, 'Unknown') IGNORE NULLS ORDER BY CheckInTime DESC LIMIT 1)[SAFE_OFFSET(0)] AS practitionerName,
        MAX(CAST(COALESCE(Price, 0) AS FLOAT64)) AS price,
        MAX(CAST(COALESCE(PackageCount, 0) AS INT64)) AS packageCount,
        MAX(CAST(COALESCE(RemainingPackageCount, 0) AS INT64)) AS remainingPackageCount,
        ARRAY_AGG(
          ${buildServiceCategoryExpression("ServiceName", "CAST(NULL AS STRING)")}
          ORDER BY CheckInTime DESC
          LIMIT 1
        )[SAFE_OFFSET(0)] AS serviceCategory
      FROM ${analyticsTables.mainDataView}
      WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
        AND CustomerName IS NOT NULL
        AND CustomerPhoneNumber IS NOT NULL
        AND CheckInTime IS NOT NULL
        AND ${extraWhere}
      GROUP BY customerName, phoneNumber, visitKey
    )
  `;
}

function buildCustomerListCtes() {
  return `
    WITH
      ${buildInvoiceLevelPaymentsCte()}
      ,
      PaymentLifetime AS (
        SELECT
          customerName,
          phoneNumber,
          MAX(memberId) AS memberId,
          SUM(invoiceNetTotal) AS lifetimeSpend,
          SAFE_DIVIDE(SUM(invoiceNetTotal), COUNT(*)) AS averageSpend,
          ARRAY_AGG(paymentMethod ORDER BY orderCreatedDate DESC LIMIT 1)[SAFE_OFFSET(0)] AS lastPaymentMethod
        FROM InvoiceLevelPayments
        GROUP BY customerName, phoneNumber
      ),
      PaymentInRange AS (
        SELECT
          customerName,
          phoneNumber,
          SUM(invoiceNetTotal) AS revenueInRange,
          COUNT(*) AS invoicesInRange
        FROM InvoiceLevelPayments
        WHERE DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate
        GROUP BY customerName, phoneNumber
      ),
      ${buildDistinctVisitsCte()}
      ,
      VisitLifetime AS (
        SELECT
          customerName,
          phoneNumber,
          MAX(memberId) AS memberIdFromVisit,
          MIN(DATE(checkInTime)) AS joinedDate,
          MAX(DATE(COALESCE(checkOutTime, checkInTime))) AS lastVisitDate,
          COUNT(*) AS totalVisits,
          ARRAY_AGG(serviceName ORDER BY COALESCE(checkOutTime, checkInTime) DESC LIMIT 1)[SAFE_OFFSET(0)] AS lastService,
          COUNTIF(DATE(checkInTime) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) AND CURRENT_DATE()) AS visitsLast90Days,
          COUNTIF(DATE(checkInTime) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 91 DAY)) AS visitsPrev90Days
        FROM DistinctVisits
        GROUP BY customerName, phoneNumber
      ),
      VisitInRange AS (
        SELECT
          customerName,
          phoneNumber,
          COUNT(*) AS visitCountInRange,
          ARRAY_AGG(serviceName ORDER BY checkInTime DESC LIMIT 1)[SAFE_OFFSET(0)] AS lastServiceInRange
        FROM DistinctVisits
        WHERE DATE(checkInTime) BETWEEN @fromDate AND @toDate
        GROUP BY customerName, phoneNumber
      ),
      PreferredTherapistBase AS (
        SELECT
          customerName,
          phoneNumber,
          practitionerName,
          COUNT(*) AS visitCount,
          MAX(checkInTime) AS latestVisitDate
        FROM DistinctVisits
        WHERE COALESCE(practitionerName, '') != ''
        GROUP BY customerName, phoneNumber, practitionerName
      ),
      PreferredTherapist AS (
        SELECT
          customerName,
          phoneNumber,
          practitionerName AS primaryTherapist
        FROM (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY customerName, phoneNumber
              ORDER BY visitCount DESC, latestVisitDate DESC, practitionerName ASC
            ) AS rowNum
          FROM PreferredTherapistBase
        )
        WHERE rowNum = 1
      ),
      PreferredServiceBase AS (
        SELECT
          customerName,
          phoneNumber,
          serviceName,
          servicePackageName,
          serviceCategory,
          COUNT(*) AS usageCount,
          MAX(checkInTime) AS latestVisitDate
        FROM DistinctVisits
        WHERE COALESCE(serviceName, '') != ''
        GROUP BY customerName, phoneNumber, serviceName, servicePackageName, serviceCategory
      ),
      PreferredService AS (
        SELECT
          customerName,
          phoneNumber,
          serviceName AS preferredService,
          serviceCategory AS topCategory
        FROM (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY customerName, phoneNumber
              ORDER BY usageCount DESC, latestVisitDate DESC, serviceName ASC
            ) AS rowNum
          FROM PreferredServiceBase
        )
        WHERE rowNum = 1
      ),
      PackageHealth AS (
        SELECT
          customerName,
          phoneNumber,
          SUM(GREATEST(remainingPackageCount, 0)) AS remainingSessions
        FROM DistinctVisits
        GROUP BY customerName, phoneNumber
      ),
      ScopedCustomers AS (
        SELECT
          COALESCE(v.customerName, p.customerName) AS customerName,
          COALESCE(v.phoneNumber, p.phoneNumber) AS phoneNumber
        FROM VisitInRange v
        FULL OUTER JOIN PaymentInRange p
          USING (customerName, phoneNumber)
      ),
      CustomerListBase AS (
        SELECT
          scoped.customerName,
          scoped.phoneNumber,
          COALESCE(pay.memberId, visit.memberIdFromVisit, '') AS memberId,
          COALESCE(pay.lifetimeSpend, 0) AS lifetimeSpend,
          COALESCE(pay.averageSpend, 0) AS averageSpend,
          COALESCE(pay.lastPaymentMethod, 'Unknown') AS lastPaymentMethod,
          visit.joinedDate,
          visit.lastVisitDate,
          CASE
            WHEN visit.lastVisitDate IS NULL THEN NULL
            ELSE DATE_DIFF(CURRENT_DATE(), visit.lastVisitDate, DAY)
          END AS daysSinceLastVisit,
          COALESCE(visit.totalVisits, 0) AS totalVisits,
          COALESCE(rangeVisit.visitCountInRange, 0) AS visitCountInRange,
          COALESCE(rangePay.revenueInRange, 0) AS revenueInRange,
          COALESCE(rangePay.invoicesInRange, 0) AS invoicesInRange,
          COALESCE(rangeVisit.lastServiceInRange, visit.lastService, preferredService.preferredService, '') AS lastService,
          COALESCE(preferredTherapist.primaryTherapist, 'Unknown') AS primaryTherapist,
          COALESCE(preferredService.topCategory, 'Other') AS topCategory,
          COALESCE(packageHealth.remainingSessions, 0) AS remainingSessions,
          COALESCE(visit.visitsLast90Days, 0) AS visitsLast90Days,
          COALESCE(visit.visitsPrev90Days, 0) AS visitsPrev90Days,
          CASE
            WHEN visit.lastVisitDate IS NULL THEN 'New'
            WHEN DATE_DIFF(CURRENT_DATE(), visit.lastVisitDate, DAY) <= 30 AND COALESCE(visit.totalVisits, 0) <= 2 THEN 'New'
            WHEN DATE_DIFF(CURRENT_DATE(), visit.lastVisitDate, DAY) <= 45 AND COALESCE(visit.totalVisits, 0) >= 3 THEN 'Returning'
            WHEN DATE_DIFF(CURRENT_DATE(), visit.lastVisitDate, DAY) <= 45 THEN 'Active'
            WHEN DATE_DIFF(CURRENT_DATE(), visit.lastVisitDate, DAY) <= 90 THEN 'At risk'
            ELSE 'Dormant'
          END AS status,
          CASE
            WHEN COALESCE(packageHealth.remainingSessions, 0) > 3 THEN 'Healthy'
            WHEN COALESCE(packageHealth.remainingSessions, 0) BETWEEN 1 AND 3 THEN 'Low balance'
            ELSE 'No active package'
          END AS packageStatus
        FROM ScopedCustomers scoped
        LEFT JOIN PaymentLifetime pay USING (customerName, phoneNumber)
        LEFT JOIN PaymentInRange rangePay USING (customerName, phoneNumber)
        LEFT JOIN VisitLifetime visit USING (customerName, phoneNumber)
        LEFT JOIN VisitInRange rangeVisit USING (customerName, phoneNumber)
        LEFT JOIN PreferredTherapist preferredTherapist USING (customerName, phoneNumber)
        LEFT JOIN PreferredService preferredService USING (customerName, phoneNumber)
        LEFT JOIN PackageHealth packageHealth USING (customerName, phoneNumber)
      ),
      CustomerListRanked AS (
        SELECT
          *,
          CASE NTILE(4) OVER (ORDER BY lifetimeSpend DESC, customerName ASC)
            WHEN 1 THEN 'VIP'
            WHEN 2 THEN 'High'
            WHEN 3 THEN 'Core'
            ELSE 'Emerging'
          END AS spendTier
        FROM CustomerListBase
      ),
      FilteredCustomers AS (
        SELECT *
        FROM CustomerListRanked
        WHERE (
          @search = ''
          OR LOWER(customerName) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(phoneNumber) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(COALESCE(memberId, '')) LIKE LOWER(CONCAT('%', @search, '%'))
        )
          AND (@status = '' OR LOWER(status) = LOWER(@status))
          AND (@spendTier = '' OR LOWER(spendTier) = LOWER(@spendTier))
          AND (@therapist = '' OR LOWER(primaryTherapist) = LOWER(@therapist))
          AND (@serviceCategory = '' OR LOWER(topCategory) = LOWER(@serviceCategory))
      )
  `;
}

function buildCustomerScopedCtes(identity: CustomerIdentity) {
  const identityParams = {
    customerName: identity.customerName.trim(),
    customerPhoneDigits: normalizePhoneDigits(identity.customerPhone),
  };

  const invoiceScope = buildCustomerIdentityCondition("CustomerPhoneNumber", "CustomerName");
  const visitScope = buildCustomerIdentityCondition("CustomerPhoneNumber", "CustomerName");

  return {
    queryParams: identityParams,
    ctes: `
      WITH
        ${buildInvoiceLevelPaymentsCte(invoiceScope)}
        ,
        ${buildDistinctVisitsCte(visitScope)}
    `,
  };
}

function buildInsightSet(input: {
  customerName: string;
  lifetimeSpend: number;
  totalVisits: number;
  daysSinceLastVisit: number | null;
  preferredService: string;
  preferredServiceCategory: string;
  preferredTherapist: string;
  lastPaymentMethod: string;
  averageSpendPerVisit: number;
  remainingSessions: number;
  recent3MonthVisits: number;
  previous3MonthVisits: number;
  avgVisitIntervalDays: number | null;
  categoryBreadth: number;
  spendTier: string;
}) {
  const insights: Array<{
    id: string;
    tone: "positive" | "attention" | "neutral";
    title: string;
    detail: string;
  }> = [];

  if (input.spendTier === "VIP" && (input.daysSinceLastVisit ?? 0) > 45) {
    insights.push({
      id: "vip-lapsed",
      tone: "attention",
      title: "High-value customer is cooling off",
      detail: `${input.customerName} is in the top spend tier but has not visited in ${input.daysSinceLastVisit} days.`,
    });
  }

  if (input.remainingSessions > 0) {
    insights.push({
      id: "package-balance",
      tone: "positive",
      title: "Package balance is still active",
      detail: `${input.remainingSessions} session${input.remainingSessions === 1 ? "" : "s"} remain, which is a good rebooking trigger.`,
    });
  }

  if (input.preferredTherapist && input.preferredTherapist !== "Unknown") {
    insights.push({
      id: "therapist-bond",
      tone: "neutral",
      title: "Strong therapist relationship",
      detail: `Most visits are handled by ${input.preferredTherapist}, which is useful for continuity and retention.`,
    });
  }

  if (input.recent3MonthVisits < input.previous3MonthVisits && input.previous3MonthVisits > 0) {
    insights.push({
      id: "declining-frequency",
      tone: "attention",
      title: "Visit frequency is declining",
      detail: `Visits dropped from ${input.previous3MonthVisits} to ${input.recent3MonthVisits} compared with the previous 3-month window.`,
    });
  }

  if (input.categoryBreadth <= 1 && input.preferredServiceCategory !== "Other") {
    insights.push({
      id: "cross-sell",
      tone: "neutral",
      title: "Cross-category expansion opportunity",
      detail: `This customer is concentrated in ${input.preferredServiceCategory.toLowerCase()} services, which suggests room for a broader care plan.`,
    });
  }

  if (input.lastPaymentMethod && input.lastPaymentMethod !== "Unknown") {
    insights.push({
      id: "payment-preference",
      tone: "neutral",
      title: "Payment preference is consistent",
      detail: `${input.customerName} most recently paid by ${input.lastPaymentMethod}.`,
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "steady-profile",
      tone: "neutral",
      title: "Stable customer profile",
      detail: "No major retention or package issues are visible in the current rule set.",
    });
  }

  return insights.slice(0, 5);
}

function buildRecommendedAction(input: {
  spendTier: string;
  daysSinceLastVisit: number | null;
  remainingSessions: number;
  preferredServiceCategory: string;
  recent3MonthVisits: number;
  previous3MonthVisits: number;
}) {
  if (input.remainingSessions > 0 && (input.daysSinceLastVisit ?? 0) > 21) {
    return "Reach out with a package continuation reminder and offer the next booking slot.";
  }

  if (input.spendTier === "VIP" && (input.daysSinceLastVisit ?? 0) > 45) {
    return "Treat this record as a VIP retention case and schedule a follow-up from the clinic team.";
  }

  if (input.recent3MonthVisits < input.previous3MonthVisits && input.previous3MonthVisits > 0) {
    return "Offer a return-visit check-in with a service recommendation based on recent treatment history.";
  }

  if (input.preferredServiceCategory !== "Other") {
    return `Review cross-category upsell options around ${input.preferredServiceCategory.toLowerCase()} care.`;
  }

  return "Keep this customer in the regular retention cadence and monitor the next visit interval.";
}

export async function getCustomerPortalList(params: CustomerListParams) {
  const sortColumns: Record<CustomerListParams["sortBy"], string> = {
    lifetimeSpend: "lifetimeSpend",
    lastVisitDate: "lastVisitDate",
    visitCount: "totalVisits",
    averageSpend: "averageSpend",
  };

  const orderBy = sortColumns[params.sortBy] ?? "lifetimeSpend";
  const direction = params.sortDirection === "asc" ? "ASC" : "DESC";
  const customerListCtes = buildCustomerListCtes();

  const [summaryRows, filterTherapistRows, filterCategoryRows, totalRows, dataRows] = await Promise.all([
    runAnalyticsQuery<{
      totalCustomers: number;
      activeCustomers: number;
      returningCustomers: number;
      atRiskCustomers: number;
      dormantCustomers: number;
      totalRevenue: number;
      averageSpend: number;
      averageVisits: number;
    }>(
      `
        ${customerListCtes}
        SELECT
          COUNT(*) AS totalCustomers,
          COUNTIF(status IN ('Active', 'Returning', 'New')) AS activeCustomers,
          COUNTIF(status = 'Returning') AS returningCustomers,
          COUNTIF(status = 'At risk') AS atRiskCustomers,
          COUNTIF(status = 'Dormant') AS dormantCustomers,
          COALESCE(SUM(lifetimeSpend), 0) AS totalRevenue,
          COALESCE(AVG(lifetimeSpend), 0) AS averageSpend,
          COALESCE(AVG(totalVisits), 0) AS averageVisits
        FROM FilteredCustomers
      `,
      params,
    ),
    runAnalyticsQuery<{ primaryTherapist: string }>(
      `
        ${customerListCtes}
        SELECT DISTINCT primaryTherapist
        FROM CustomerListRanked
        WHERE COALESCE(primaryTherapist, '') != ''
        ORDER BY primaryTherapist ASC
      `,
      params,
    ),
    runAnalyticsQuery<{ topCategory: string }>(
      `
        ${customerListCtes}
        SELECT DISTINCT topCategory
        FROM CustomerListRanked
        WHERE COALESCE(topCategory, '') != ''
        ORDER BY topCategory ASC
      `,
      params,
    ),
    runAnalyticsQuery<{ totalCount: number }>(
      `
        ${customerListCtes}
        SELECT COUNT(*) AS totalCount
        FROM FilteredCustomers
      `,
      params,
    ),
    runAnalyticsQuery<{
      customerName: string;
      phoneNumber: string;
      memberId: string;
      lifetimeSpend: number;
      averageSpend: number;
      joinedDate: string | null;
      lastVisitDate: string | null;
      daysSinceLastVisit: number | null;
      totalVisits: number;
      lastService: string;
      primaryTherapist: string;
      lastPaymentMethod: string;
      status: string;
      spendTier: string;
      packageStatus: string;
      remainingSessions: number;
      topCategory: string;
      visitsLast90Days: number;
      visitsPrev90Days: number;
    }>(
      `
        ${customerListCtes}
        SELECT
          customerName,
          phoneNumber,
          COALESCE(memberId, '') AS memberId,
          lifetimeSpend,
          averageSpend,
          FORMAT_DATE('%Y-%m-%d', joinedDate) AS joinedDate,
          FORMAT_DATE('%Y-%m-%d', lastVisitDate) AS lastVisitDate,
          daysSinceLastVisit,
          totalVisits,
          COALESCE(lastService, '') AS lastService,
          COALESCE(primaryTherapist, 'Unknown') AS primaryTherapist,
          COALESCE(lastPaymentMethod, 'Unknown') AS lastPaymentMethod,
          status,
          spendTier,
          packageStatus,
          remainingSessions,
          COALESCE(topCategory, 'Other') AS topCategory,
          visitsLast90Days,
          visitsPrev90Days
        FROM FilteredCustomers
        ORDER BY ${orderBy} ${direction}, customerName ASC
        LIMIT @limit
        OFFSET @offset
      `,
      params,
    ),
  ]);

  const summary = summaryRows[0];
  const total = totalRows[0];

  return {
    summary: {
      totalCustomers: parseNumber(summary?.totalCustomers),
      activeCustomers: parseNumber(summary?.activeCustomers),
      returningCustomers: parseNumber(summary?.returningCustomers),
      atRiskCustomers: parseNumber(summary?.atRiskCustomers),
      dormantCustomers: parseNumber(summary?.dormantCustomers),
      totalRevenue: parseNumber(summary?.totalRevenue),
      averageSpend: parseNumber(summary?.averageSpend),
      averageVisits: Number(parseNumber(summary?.averageVisits).toFixed(2)),
    },
    filterOptions: {
      therapists: filterTherapistRows.map((row) => row.primaryTherapist).filter(Boolean),
      serviceCategories: filterCategoryRows.map((row) => row.topCategory).filter(Boolean),
      spendTiers: ["VIP", "High", "Core", "Emerging"],
      statuses: ["New", "Active", "Returning", "At risk", "Dormant"],
    },
    rows: dataRows.map((row) => ({
      ...(() => {
        const riskSignals = calculateCustomerRiskSignals({
          totalVisits: parseNumber(row.totalVisits),
          daysSinceLastVisit: row.daysSinceLastVisit == null ? null : parseNumber(row.daysSinceLastVisit),
          avgVisitGapDays: null,
          remainingSessions: parseNumber(row.remainingSessions),
          recent3MonthVisits: parseNumber(row.visitsLast90Days),
          previous3MonthVisits: parseNumber(row.visitsPrev90Days),
        });

        return {
          churnRiskLevel: riskSignals.churnRiskLevel,
          rebookingStatus: riskSignals.rebookingStatus,
          healthScore: riskSignals.healthScore,
        };
      })(),
      customerName: row.customerName,
      phoneNumber: row.phoneNumber,
      memberId: row.memberId,
      lifetimeSpend: parseNumber(row.lifetimeSpend),
      averageSpend: parseNumber(row.averageSpend),
      joinedDate: row.joinedDate,
      lastVisitDate: row.lastVisitDate,
      daysSinceLastVisit: row.daysSinceLastVisit == null ? null : parseNumber(row.daysSinceLastVisit),
      visitCount: parseNumber(row.totalVisits),
      lastService: row.lastService,
      primaryTherapist: row.primaryTherapist,
      lastPaymentMethod: row.lastPaymentMethod,
      status: row.status,
      spendTier: row.spendTier,
      packageStatus: row.packageStatus,
      remainingSessions: parseNumber(row.remainingSessions),
      serviceCategory: row.topCategory,
    })),
    totalCount: parseNumber(total?.totalCount),
  };
}

export async function getCustomerPortalOverview(params: DetailBaseParams) {
  const scoped = buildCustomerScopedCtes(params);
  const queryParams = {
    clinicCode: params.clinicCode,
    fromDate: params.fromDate,
    toDate: params.toDate,
    ...scoped.queryParams,
  };

  const [summaryRows, spendTierRows, trendRows, therapistRows, serviceMixRows, recentServiceRows] = await Promise.all([
    runAnalyticsQuery<{
      customerName: string;
      phoneNumber: string;
      memberId: string;
      joinedDate: string | null;
      dateOfBirth: string | null;
      lastVisitDate: string | null;
      lifetimeSpend: number;
      totalVisits: number;
      preferredService: string | null;
      preferredServiceCategory: string | null;
      preferredTherapist: string | null;
      lastPaymentMethod: string | null;
      daysSinceLastVisit: number | null;
      remainingSessions: number;
      recent3MonthVisits: number;
      previous3MonthVisits: number;
      avgVisitIntervalDays: number | null;
      categoryBreadth: number;
    }>(
      `
        ${scoped.ctes}
        ,
        VisitSummary AS (
          SELECT
            ANY_VALUE(customerName) AS customerName,
            ANY_VALUE(phoneNumber) AS phoneNumber,
            MAX(memberId) AS memberId,
            MAX(dateOfBirth) AS dateOfBirth,
            MIN(DATE(checkInTime)) AS joinedDate,
            MAX(DATE(COALESCE(checkOutTime, checkInTime))) AS lastVisitDate,
            COUNT(*) AS totalVisits,
            COUNTIF(DATE(checkInTime) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY) AND CURRENT_DATE()) AS recent3MonthVisits,
            COUNTIF(DATE(checkInTime) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY) AND DATE_SUB(CURRENT_DATE(), INTERVAL 91 DAY)) AS previous3MonthVisits
          FROM DistinctVisits
        ),
        VisitIntervals AS (
          SELECT
            DATE_DIFF(DATE(checkInTime), DATE(previousCheckInTime), DAY) AS gapDays
          FROM (
            SELECT
              checkInTime,
              LAG(checkInTime) OVER (ORDER BY checkInTime) AS previousCheckInTime
            FROM DistinctVisits
          )
          WHERE previousCheckInTime IS NOT NULL
        ),
        IntervalSummary AS (
          SELECT COALESCE(AVG(gapDays), 0) AS avgVisitIntervalDays
          FROM VisitIntervals
        ),
        InvoiceSummary AS (
          SELECT
            MAX(memberId) AS memberId,
            COALESCE(SUM(invoiceNetTotal), 0) AS lifetimeSpend,
            ARRAY_AGG(paymentMethod ORDER BY orderCreatedDate DESC LIMIT 1)[SAFE_OFFSET(0)] AS lastPaymentMethod
          FROM InvoiceLevelPayments
        ),
        PreferredTherapistBase AS (
          SELECT
            practitionerName,
            COUNT(*) AS visitCount,
            MAX(checkInTime) AS latestVisitDate
          FROM DistinctVisits
          WHERE COALESCE(practitionerName, '') != ''
          GROUP BY practitionerName
        ),
        PreferredTherapist AS (
          SELECT practitionerName AS preferredTherapist
          FROM (
            SELECT
              *,
              ROW_NUMBER() OVER (ORDER BY visitCount DESC, latestVisitDate DESC, practitionerName ASC) AS rowNum
            FROM PreferredTherapistBase
          )
          WHERE rowNum = 1
        ),
        PreferredServiceBase AS (
          SELECT
            serviceName,
            servicePackageName,
            serviceCategory,
            COUNT(*) AS usageCount,
            MAX(checkInTime) AS latestVisitDate
          FROM DistinctVisits
          WHERE COALESCE(serviceName, '') != ''
          GROUP BY serviceName, servicePackageName, serviceCategory
        ),
        PreferredService AS (
          SELECT
            serviceName AS preferredService,
            serviceCategory AS preferredServiceCategory
          FROM (
            SELECT
              *,
              ROW_NUMBER() OVER (ORDER BY usageCount DESC, latestVisitDate DESC, serviceName ASC) AS rowNum
            FROM PreferredServiceBase
          )
          WHERE rowNum = 1
        ),
        PackageSummary AS (
          SELECT
            SUM(GREATEST(remainingPackageCount, 0)) AS remainingSessions
          FROM DistinctVisits
        ),
        CategorySummary AS (
          SELECT COUNT(DISTINCT serviceCategory) AS categoryBreadth
          FROM DistinctVisits
        )
        SELECT
          COALESCE((SELECT customerName FROM VisitSummary), (SELECT ANY_VALUE(customerName) FROM InvoiceLevelPayments), @customerName) AS customerName,
          COALESCE((SELECT phoneNumber FROM VisitSummary), (SELECT ANY_VALUE(phoneNumber) FROM InvoiceLevelPayments), '') AS phoneNumber,
          COALESCE((SELECT memberId FROM InvoiceSummary), (SELECT memberId FROM VisitSummary), '') AS memberId,
          FORMAT_DATE('%Y-%m-%d', (SELECT joinedDate FROM VisitSummary)) AS joinedDate,
          CAST((SELECT dateOfBirth FROM VisitSummary) AS STRING) AS dateOfBirth,
          FORMAT_DATE('%Y-%m-%d', (SELECT lastVisitDate FROM VisitSummary)) AS lastVisitDate,
          COALESCE((SELECT lifetimeSpend FROM InvoiceSummary), 0) AS lifetimeSpend,
          COALESCE((SELECT totalVisits FROM VisitSummary), 0) AS totalVisits,
          (SELECT ps.preferredService FROM PreferredService ps LIMIT 1) AS preferredService,
          (SELECT ps.preferredServiceCategory FROM PreferredService ps LIMIT 1) AS preferredServiceCategory,
          (SELECT pt.preferredTherapist FROM PreferredTherapist pt LIMIT 1) AS preferredTherapist,
          COALESCE((SELECT lastPaymentMethod FROM InvoiceSummary), 'Unknown') AS lastPaymentMethod,
          CASE
            WHEN (SELECT lastVisitDate FROM VisitSummary) IS NULL THEN NULL
            ELSE DATE_DIFF(CURRENT_DATE(), (SELECT lastVisitDate FROM VisitSummary), DAY)
          END AS daysSinceLastVisit,
          COALESCE((SELECT remainingSessions FROM PackageSummary), 0) AS remainingSessions,
          COALESCE((SELECT recent3MonthVisits FROM VisitSummary), 0) AS recent3MonthVisits,
          COALESCE((SELECT previous3MonthVisits FROM VisitSummary), 0) AS previous3MonthVisits,
          ROUND(COALESCE((SELECT avgVisitIntervalDays FROM IntervalSummary), 0), 1) AS avgVisitIntervalDays,
          COALESCE((SELECT categoryBreadth FROM CategorySummary), 0) AS categoryBreadth
      `,
      queryParams,
    ),
    runAnalyticsQuery<{ spendTier: string }>(
      `
        WITH
          ${buildInvoiceLevelPaymentsCte()}
          ,
          CustomerRevenueDistribution AS (
            SELECT
              customerName,
              phoneNumber,
              SUM(invoiceNetTotal) AS lifetimeSpend
            FROM InvoiceLevelPayments
            GROUP BY customerName, phoneNumber
          ),
          RankedCustomers AS (
            SELECT
              customerName,
              phoneNumber,
              CASE NTILE(4) OVER (ORDER BY lifetimeSpend DESC, customerName ASC)
                WHEN 1 THEN 'VIP'
                WHEN 2 THEN 'High'
                WHEN 3 THEN 'Core'
                ELSE 'Emerging'
              END AS spendTier
            FROM CustomerRevenueDistribution
          )
        SELECT spendTier
        FROM RankedCustomers
        WHERE ${buildCustomerIdentityCondition("phoneNumber", "customerName")}
        LIMIT 1
      `,
      {
        clinicCode: params.clinicCode,
        ...scoped.queryParams,
      },
    ),
    runAnalyticsQuery<{
      bucket: string;
      revenue: number;
      visits: number;
    }>(
      `
        ${scoped.ctes}
        ,
        RevenueTrend AS (
          SELECT
            FORMAT_DATE('%Y-%m', DATE(orderCreatedDate)) AS bucket,
            SUM(invoiceNetTotal) AS revenue
          FROM InvoiceLevelPayments
          WHERE DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate
          GROUP BY bucket
        ),
        VisitTrend AS (
          SELECT
            FORMAT_DATE('%Y-%m', DATE(checkInTime)) AS bucket,
            COUNT(*) AS visits
          FROM DistinctVisits
          WHERE DATE(checkInTime) BETWEEN @fromDate AND @toDate
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
          COALESCE((SELECT visits FROM VisitTrend WHERE VisitTrend.bucket = Buckets.bucket), 0) AS visits
        FROM Buckets
        ORDER BY bucket ASC
      `,
      queryParams,
    ),
    runAnalyticsQuery<{
      therapistName: string;
      visitCount: number;
      serviceValue: number;
      latestVisitDate: string;
    }>(
      `
        ${scoped.ctes}
        SELECT
          COALESCE(practitionerName, 'Unknown') AS therapistName,
          COUNT(*) AS visitCount,
          COALESCE(SUM(price), 0) AS serviceValue,
          FORMAT_DATE('%Y-%m-%d', MAX(DATE(checkInTime))) AS latestVisitDate
        FROM DistinctVisits
        GROUP BY therapistName
        ORDER BY visitCount DESC, serviceValue DESC, therapistName ASC
        LIMIT 8
      `,
      queryParams,
    ),
    runAnalyticsQuery<{
      serviceCategory: string;
      visitCount: number;
      serviceValue: number;
    }>(
      `
        ${scoped.ctes}
        SELECT
          COALESCE(serviceCategory, 'Other') AS serviceCategory,
          COUNT(*) AS visitCount,
          COALESCE(SUM(price), 0) AS serviceValue
        FROM DistinctVisits
        GROUP BY serviceCategory
        ORDER BY visitCount DESC, serviceValue DESC, serviceCategory ASC
      `,
      queryParams,
    ),
    runAnalyticsQuery<{
      serviceName: string;
      lastUsedDate: string;
      visitCount: number;
    }>(
      `
        ${scoped.ctes}
        SELECT
          serviceName,
          FORMAT_DATE('%Y-%m-%d', MAX(DATE(checkInTime))) AS lastUsedDate,
          COUNT(*) AS visitCount
        FROM DistinctVisits
        WHERE COALESCE(serviceName, '') != ''
        GROUP BY serviceName
        ORDER BY lastUsedDate DESC, visitCount DESC, serviceName ASC
        LIMIT 3
      `,
      queryParams,
    ),
  ]);

  const summary = summaryRows[0];
  const spendTier = spendTierRows[0]?.spendTier ?? "Emerging";
  const preferredService = parseText(summary?.preferredService);
  const preferredServiceCategory = parseText(summary?.preferredServiceCategory, "Other");
  const preferredTherapist = parseText(summary?.preferredTherapist, "Unknown");
  const daysSinceLastVisit =
    summary?.daysSinceLastVisit == null ? null : parseNumber(summary.daysSinceLastVisit);
  const lifetimeSpend = parseNumber(summary?.lifetimeSpend);
  const totalVisits = parseNumber(summary?.totalVisits);
  const averageSpendPerVisit = totalVisits > 0 ? Number((lifetimeSpend / totalVisits).toFixed(2)) : 0;

  const status =
    daysSinceLastVisit == null
      ? "New"
      : daysSinceLastVisit <= 30 && totalVisits <= 2
        ? "New"
        : daysSinceLastVisit <= 45 && totalVisits >= 3
          ? "Returning"
          : daysSinceLastVisit <= 45
            ? "Active"
            : daysSinceLastVisit <= 90
              ? "At risk"
              : "Dormant";

  const insights = buildInsightSet({
    customerName: summary?.customerName ?? params.customerName,
    lifetimeSpend,
    totalVisits,
    daysSinceLastVisit,
    preferredService,
    preferredServiceCategory,
    preferredTherapist,
    lastPaymentMethod: parseText(summary?.lastPaymentMethod, "Unknown"),
    averageSpendPerVisit,
    remainingSessions: parseNumber(summary?.remainingSessions),
    recent3MonthVisits: parseNumber(summary?.recent3MonthVisits),
    previous3MonthVisits: parseNumber(summary?.previous3MonthVisits),
    avgVisitIntervalDays: summary?.avgVisitIntervalDays == null ? null : parseNumber(summary.avgVisitIntervalDays),
    categoryBreadth: parseNumber(summary?.categoryBreadth),
    spendTier,
  });

  const badges = [spendTier, status];
  if (parseNumber(summary?.remainingSessions) > 0) {
    badges.push("Package active");
  }

  return {
    customer: {
      customerName: summary?.customerName ?? params.customerName,
      phoneNumber: summary?.phoneNumber ?? params.customerPhone,
      memberId: parseText(summary?.memberId),
      joinedDate: summary?.joinedDate ?? null,
      dateOfBirth: parseText(summary?.dateOfBirth) || null,
      lastVisitDate: summary?.lastVisitDate ?? null,
      lifetimeSpend,
      totalVisits,
      averageSpendPerVisit,
      preferredService,
      preferredServiceCategory,
      preferredTherapist,
      lastPaymentMethod: parseText(summary?.lastPaymentMethod, "Unknown"),
      daysSinceLastVisit,
      remainingSessions: parseNumber(summary?.remainingSessions),
      recent3MonthVisits: parseNumber(summary?.recent3MonthVisits),
      previous3MonthVisits: parseNumber(summary?.previous3MonthVisits),
      avgVisitIntervalDays:
        summary?.avgVisitIntervalDays == null ? null : parseNumber(summary.avgVisitIntervalDays),
      categoryBreadth: parseNumber(summary?.categoryBreadth),
      spendTier,
      status,
      badges,
    },
    trend: trendRows.map((row) => ({
      bucket: row.bucket,
      revenue: parseNumber(row.revenue),
      visits: parseNumber(row.visits),
    })),
    therapistRelationship: therapistRows.map((row) => ({
      therapistName: row.therapistName,
      visitCount: parseNumber(row.visitCount),
      serviceValue: parseNumber(row.serviceValue),
      latestVisitDate: row.latestVisitDate,
    })),
    serviceMix: serviceMixRows.map((row) => ({
      serviceCategory: row.serviceCategory,
      visitCount: parseNumber(row.visitCount),
      serviceValue: parseNumber(row.serviceValue),
    })),
    recentServices: recentServiceRows.map((row) => ({
      serviceName: row.serviceName,
      lastUsedDate: row.lastUsedDate,
      visitCount: parseNumber(row.visitCount),
    })),
    insights,
    recommendedAction: buildRecommendedAction({
      spendTier,
      daysSinceLastVisit,
      remainingSessions: parseNumber(summary?.remainingSessions),
      preferredServiceCategory,
      recent3MonthVisits: parseNumber(summary?.recent3MonthVisits),
      previous3MonthVisits: parseNumber(summary?.previous3MonthVisits),
    }),
    assumptions: [
      "Therapist service value is estimated from MainDataView price fields because invoice-level therapist attribution is not available in the payment view.",
      "Service categories are derived from service and package naming patterns for filterability and may need refinement with a clinic-owned taxonomy later.",
    ],
  };
}

export async function getCustomerQuickView(params: DetailBaseParams) {
  const [overview, packages, bookings] = await Promise.all([
    getCustomerPortalOverview(params),
    getCustomerPortalPackages(params),
    getCustomerPortalBookings({
      ...params,
      search: "",
      page: 1,
      pageSize: 5,
    }),
  ]);

  const activePackages = packages.packages.filter((entry) => entry.remainingCount > 0);
  const lowBalancePackages = activePackages.filter((entry) => entry.remainingCount <= 3);

  return {
    customer: overview.customer,
    insights: overview.insights.slice(0, 3),
    recommendedAction: overview.recommendedAction,
    recentServices: overview.recentServices.slice(0, 4),
    therapistRelationship: overview.therapistRelationship.slice(0, 4),
    serviceMix: overview.serviceMix.slice(0, 4),
    packageSummary: {
      activePackages: activePackages.length,
      remainingSessions: overview.customer.remainingSessions,
      lowBalancePackages: lowBalancePackages.length,
    },
    packages: activePackages.slice(0, 4),
    recentBookings: bookings.rows.slice(0, 5),
    assumptions: overview.assumptions,
  };
}

export async function getCustomerPortalPackages(params: DetailBaseParams) {
  const queryParams = {
    clinicCode: params.clinicCode,
    customerName: params.customerName.trim(),
    customerPhoneDigits: normalizePhoneDigits(params.customerPhone),
  };

  const rows = await runAnalyticsQuery<{
    serviceName: string;
    servicePackageName: string | null;
    serviceCategory: string;
    packageTotal: number;
    usedCount: number;
    remainingCount: number;
    latestUsageDate: string;
    latestTherapist: string;
  }>(
    `
      SELECT
        COALESCE(ServiceName, '') AS serviceName,
        CAST(NULL AS STRING) AS servicePackageName,
        ${buildServiceCategoryExpression("ServiceName", "CAST(NULL AS STRING)")} AS serviceCategory,
        MAX(CAST(COALESCE(PackageCount, 0) AS INT64)) AS packageTotal,
        GREATEST(
          MAX(CAST(COALESCE(PackageCount, 0) AS INT64)) - MAX(CAST(COALESCE(RemainingPackageCount, 0) AS INT64)),
          0
        ) AS usedCount,
        GREATEST(MAX(CAST(COALESCE(RemainingPackageCount, 0) AS INT64)), 0) AS remainingCount,
        FORMAT_DATE('%Y-%m-%d', MAX(DATE(CheckInTime))) AS latestUsageDate,
        ARRAY_AGG(COALESCE(PractitionerName, 'Unknown') ORDER BY CheckInTime DESC LIMIT 1)[SAFE_OFFSET(0)] AS latestTherapist
      FROM ${analyticsTables.mainDataView}
      WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
        AND CustomerName IS NOT NULL
        AND CustomerPhoneNumber IS NOT NULL
        AND CheckInTime IS NOT NULL
        AND ${buildCustomerIdentityCondition("CustomerPhoneNumber", "CustomerName")}
        AND (
          CAST(COALESCE(PackageCount, 0) AS INT64) > 0
          OR CAST(COALESCE(RemainingPackageCount, 0) AS INT64) > 0
        )
      GROUP BY serviceName, serviceCategory
      ORDER BY remainingCount DESC, latestUsageDate DESC, serviceName ASC
    `,
    queryParams,
  );

  return {
    packages: rows.map((row, index) => {
      const remainingCount = parseNumber(row.remainingCount);
      return {
        id: `${row.serviceName}-${row.servicePackageName ?? "single"}-${index}`,
        serviceName: row.serviceName,
        packageName: row.servicePackageName ?? null,
        serviceCategory: row.serviceCategory,
        packageTotal: parseNumber(row.packageTotal),
        usedCount: parseNumber(row.usedCount),
        remainingCount,
        latestUsageDate: row.latestUsageDate,
        latestTherapist: row.latestTherapist,
        status: remainingCount > 3 ? "Active" : remainingCount > 0 ? "Low remaining" : "Completed",
        expiryDate: null,
      };
    }),
  };
}

export async function getCustomerPortalBookings(params: DetailBaseParams & {
  search: string;
  page: number;
  pageSize: number;
}) {
  const scoped = buildCustomerScopedCtes(params);
  const queryParams = {
    clinicCode: params.clinicCode,
    fromDate: params.fromDate,
    toDate: params.toDate,
    search: params.search,
    limit: params.pageSize,
    offset: (params.page - 1) * params.pageSize,
    ...scoped.queryParams,
  };

  const [rows, totalRows] = await Promise.all([
    runAnalyticsQuery<{
      bookingId: string;
      checkInTime: string;
      serviceName: string;
      therapistName: string;
      serviceCategory: string;
    }>(
      `
        ${scoped.ctes}
        SELECT
          visitKey AS bookingId,
          FORMAT_TIMESTAMP('%Y-%m-%d %I:%M %p', checkInTime) AS checkInTime,
          COALESCE(serviceName, '') AS serviceName,
          COALESCE(practitionerName, 'Unknown') AS therapistName,
          COALESCE(serviceCategory, 'Other') AS serviceCategory
        FROM DistinctVisits
        WHERE DATE(checkInTime) BETWEEN @fromDate AND @toDate
          AND (
            @search = ''
            OR LOWER(COALESCE(serviceName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(COALESCE(servicePackageName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(COALESCE(practitionerName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
          )
        ORDER BY checkInTime DESC
        LIMIT @limit
        OFFSET @offset
      `,
      queryParams,
    ),
    runAnalyticsQuery<{ totalCount: number }>(
      `
        ${scoped.ctes}
        SELECT COUNT(*) AS totalCount
        FROM DistinctVisits
        WHERE DATE(checkInTime) BETWEEN @fromDate AND @toDate
          AND (
            @search = ''
            OR LOWER(COALESCE(serviceName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(COALESCE(servicePackageName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(COALESCE(practitionerName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
          )
      `,
      queryParams,
    ),
  ]);

  return {
    rows: rows.map((row) => ({
      bookingId: row.bookingId,
      checkInTime: row.checkInTime,
      serviceName: row.serviceName,
      therapistName: row.therapistName,
      serviceCategory: row.serviceCategory,
      clinicCode: params.clinicCode,
      status: "Completed",
      notes: null,
    })),
    totalCount: parseNumber(totalRows[0]?.totalCount),
  };
}

export async function getCustomerPortalPayments(params: DetailBaseParams & {
  search: string;
  page: number;
  pageSize: number;
}) {
  const scoped = buildCustomerScopedCtes(params);
  const queryParams = {
    clinicCode: params.clinicCode,
    fromDate: params.fromDate,
    toDate: params.toDate,
    search: params.search,
    limit: params.pageSize,
    offset: (params.page - 1) * params.pageSize,
    ...scoped.queryParams,
  };

  const [summaryRows, rows, totalRows] = await Promise.all([
    runAnalyticsQuery<{
      totalSpent: number;
      invoiceCount: number;
      avgInvoice: number;
      outstandingAmount: number;
    }>(
      `
        ${scoped.ctes}
        SELECT
          COALESCE(SUM(invoiceNetTotal), 0) AS totalSpent,
          COUNT(*) AS invoiceCount,
          COALESCE(AVG(invoiceNetTotal), 0) AS avgInvoice,
          COALESCE(SUM(orderBalance), 0) AS outstandingAmount
        FROM InvoiceLevelPayments
        WHERE DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate
      `,
      queryParams,
    ),
    runAnalyticsQuery<{
      dateLabel: string;
      invoiceNumber: string;
      serviceName: string;
      servicePackageName: string | null;
      paymentMethod: string;
      salePerson: string;
      invoiceTotal: number;
      discount: number;
      netAmount: number;
      outstandingAmount: number;
      paymentStatus: string;
    }>(
      `
        ${scoped.ctes}
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(orderCreatedDate)) AS dateLabel,
          invoiceNumber,
          COALESCE(serviceName, '') AS serviceName,
          servicePackageName,
          COALESCE(paymentMethod, 'Unknown') AS paymentMethod,
          COALESCE(salePerson, 'Unknown') AS salePerson,
          invoiceTotal,
          discount,
          invoiceNetTotal AS netAmount,
          orderBalance AS outstandingAmount,
          COALESCE(paymentStatus, '') AS paymentStatus
        FROM InvoiceLevelPayments
        WHERE DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate
          AND (
            @search = ''
            OR LOWER(COALESCE(invoiceNumber, '')) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(COALESCE(serviceName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(COALESCE(servicePackageName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(COALESCE(paymentMethod, '')) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(COALESCE(salePerson, '')) LIKE LOWER(CONCAT('%', @search, '%'))
          )
        ORDER BY orderCreatedDate DESC, invoiceNumber DESC
        LIMIT @limit
        OFFSET @offset
      `,
      queryParams,
    ),
    runAnalyticsQuery<{ totalCount: number }>(
      `
        ${scoped.ctes}
        SELECT COUNT(*) AS totalCount
        FROM InvoiceLevelPayments
        WHERE DATE(orderCreatedDate) BETWEEN @fromDate AND @toDate
          AND (
            @search = ''
            OR LOWER(COALESCE(invoiceNumber, '')) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(COALESCE(serviceName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(COALESCE(servicePackageName, '')) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(COALESCE(paymentMethod, '')) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(COALESCE(salePerson, '')) LIKE LOWER(CONCAT('%', @search, '%'))
          )
      `,
      queryParams,
    ),
  ]);

  const summary = summaryRows[0];

  return {
    summary: {
      totalSpent: parseNumber(summary?.totalSpent),
      invoiceCount: parseNumber(summary?.invoiceCount),
      averageInvoice: parseNumber(summary?.avgInvoice),
      outstandingAmount: parseNumber(summary?.outstandingAmount),
    },
    rows: rows.map((row) => ({
      dateLabel: row.dateLabel,
      invoiceNumber: row.invoiceNumber,
      serviceName: row.serviceName,
      servicePackageName: row.servicePackageName,
      paymentMethod: row.paymentMethod,
      salePerson: row.salePerson,
      invoiceTotal: parseNumber(row.invoiceTotal),
      discount: parseNumber(row.discount),
      netAmount: parseNumber(row.netAmount),
      outstandingAmount: parseNumber(row.outstandingAmount),
      paymentStatus: row.paymentStatus,
    })),
    totalCount: parseNumber(totalRows[0]?.totalCount),
  };
}

export async function getCustomerPortalUsage(params: DetailBaseParams & {
  year: number;
  serviceCategory: string;
}) {
  const scoped = buildCustomerScopedCtes(params);
  const queryParams = {
    clinicCode: params.clinicCode,
    usageYear: params.year,
    serviceCategory: params.serviceCategory,
    ...scoped.queryParams,
  };

  const rows = await runAnalyticsQuery<{
    serviceName: string;
    serviceCategory: string;
    monthNumber: number;
    usageCount: number;
    totalUsage: number;
  }>(
    `
      ${scoped.ctes}
      ,
      MonthlyUsage AS (
        SELECT
          serviceName,
          COALESCE(serviceCategory, 'Other') AS serviceCategory,
          EXTRACT(MONTH FROM DATE(checkInTime)) AS monthNumber,
          COUNT(*) AS usageCount
        FROM DistinctVisits
        WHERE EXTRACT(YEAR FROM DATE(checkInTime)) = @usageYear
          AND (@serviceCategory = '' OR LOWER(serviceCategory) = LOWER(@serviceCategory))
        GROUP BY serviceName, serviceCategory, monthNumber
      ),
      RankedServices AS (
        SELECT
          serviceName,
          serviceCategory,
          SUM(usageCount) AS totalUsage
        FROM MonthlyUsage
        GROUP BY serviceName, serviceCategory
      )
      SELECT
        monthly.serviceName,
        monthly.serviceCategory,
        monthly.monthNumber,
        monthly.usageCount,
        ranked.totalUsage
      FROM MonthlyUsage monthly
      INNER JOIN (
        SELECT *
        FROM RankedServices
        ORDER BY totalUsage DESC, serviceName ASC
        LIMIT 12
      ) ranked
        ON monthly.serviceName = ranked.serviceName
        AND monthly.serviceCategory = ranked.serviceCategory
      ORDER BY ranked.totalUsage DESC, monthly.serviceName ASC, monthly.monthNumber ASC
    `,
    queryParams,
  );

  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const grouped = new Map<
    string,
    {
      serviceName: string;
      serviceCategory: string;
      counts: number[];
      totalUsage: number;
    }
  >();

  rows.forEach((row) => {
    const key = `${row.serviceName}::${row.serviceCategory}`;
    const existing =
      grouped.get(key) ??
      {
        serviceName: row.serviceName,
        serviceCategory: row.serviceCategory,
        counts: new Array(12).fill(0),
        totalUsage: parseNumber(row.totalUsage),
      };

    existing.counts[Math.max(0, parseNumber(row.monthNumber) - 1)] = parseNumber(row.usageCount);
    existing.totalUsage = parseNumber(row.totalUsage);
    grouped.set(key, existing);
  });

  const allCategories = [...new Set(rows.map((row) => row.serviceCategory).filter(Boolean))].sort();

  return {
    year: params.year,
    months: monthLabels,
    categories: allCategories,
    summary: {
      totalUsage: rows.reduce((sum, row) => sum + parseNumber(row.usageCount), 0),
      distinctServices: grouped.size,
    },
    services: [...grouped.values()].sort((left, right) => right.totalUsage - left.totalUsage),
  };
}
