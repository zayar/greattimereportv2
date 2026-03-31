import { analyticsTables } from "../../config/bigquery.js";
import { runAnalyticsQuery } from "../bigquery.service.js";

type TherapistListParams = {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  search: string;
  serviceCategory: string;
  sortBy:
    | "treatmentsCompleted"
    | "customersServed"
    | "estimatedTreatmentValue"
    | "repeatCustomerRate"
    | "growthRate"
    | "utilizationScore";
  sortDirection: "asc" | "desc";
};

type TherapistIdentity = {
  therapistName: string;
};

type TherapistDetailParams = {
  clinicCode: string;
  fromDate: string;
  toDate: string;
} & TherapistIdentity;

type TherapistPagedDetailParams = TherapistDetailParams & {
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

function parseText(value: unknown, fallback = "") {
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

function formatDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getDaySpan(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / dayMs) + 1);
}

function getPreviousWindow(fromDate: string, toDate: string) {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const dayMs = 24 * 60 * 60 * 1000;
  const spanDays = getDaySpan(fromDate, toDate);
  const previousTo = new Date(from.getTime() - dayMs);
  const previousFrom = new Date(previousTo.getTime() - (spanDays - 1) * dayMs);

  return {
    previousFromDate: formatDateOnly(previousFrom),
    previousToDate: formatDateOnly(previousTo),
    spanDays,
  };
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

function buildTrendBucketExpression(fromDate: string, toDate: string) {
  const spanDays = getDaySpan(fromDate, toDate);

  if (spanDays <= 45) {
    return "FORMAT_DATE('%m-%d', DATE(checkInTime))";
  }

  if (spanDays <= 180) {
    return "FORMAT_DATE('%Y-%m-%d', DATE_TRUNC(DATE(checkInTime), WEEK(MONDAY)))";
  }

  return "FORMAT_DATE('%Y-%m', DATE(checkInTime))";
}

function buildDistinctTherapistVisitsCte(extraWhere = "1 = 1") {
  return `
    WITH DistinctTherapistVisits AS (
      SELECT
        COALESCE(PractitionerName, 'Unknown') AS therapistName,
        COALESCE(ServiceName, '') AS serviceName,
        COALESCE(CustomerName, '') AS customerName,
        COALESCE(CustomerPhoneNumber, '') AS phoneNumber,
        CASE
          WHEN COALESCE(CustomerPhoneNumber, '') != '' THEN CustomerPhoneNumber
          WHEN COALESCE(CustomerName, '') != '' THEN CONCAT('name:', CustomerName)
          ELSE NULL
        END AS customerKey,
        COALESCE(CustomerID, '') AS memberId,
        CheckInTime AS checkInTime,
        CAST(COALESCE(Price, 0) AS FLOAT64) AS price,
        ${buildServiceCategoryExpression("ServiceName", "CAST(NULL AS STRING)")} AS serviceCategory,
        COALESCE(
          CAST(BookingID AS STRING),
          CONCAT(
            FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', CheckInTime),
            '-',
            COALESCE(PractitionerName, ''),
            '-',
            COALESCE(ServiceName, ''),
            '-',
            COALESCE(CustomerPhoneNumber, '')
          )
        ) AS bookingKey
      FROM ${analyticsTables.mainDataView}
      WHERE LOWER(ClinicCode) = LOWER(@clinicCode)
        AND CheckInTime IS NOT NULL
        AND COALESCE(PractitionerName, '') != ''
        AND ${extraWhere}
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY
          COALESCE(PractitionerName, ''),
          COALESCE(ServiceName, ''),
          COALESCE(
            CAST(BookingID AS STRING),
            CONCAT(
              FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', CheckInTime),
              '-',
              COALESCE(PractitionerName, ''),
              '-',
              COALESCE(ServiceName, ''),
              '-',
              COALESCE(CustomerPhoneNumber, '')
            )
          )
        ORDER BY CheckInTime DESC
      ) = 1
    )
  `;
}

function buildUtilizationScore(input: {
  treatmentsCompleted: number;
  activeDays: number;
  periodDays: number;
}) {
  if (input.treatmentsCompleted <= 0 || input.activeDays <= 0 || input.periodDays <= 0) {
    return 0;
  }

  const avgTreatmentsPerActiveDay = input.treatmentsCompleted / input.activeDays;
  const densityScore = Math.min(1, avgTreatmentsPerActiveDay / 8);
  const coverageScore = Math.min(1, input.activeDays / input.periodDays);

  return Math.round((densityScore * 0.65 + coverageScore * 0.35) * 100);
}

function workloadLabel(score: number) {
  if (score >= 78) {
    return "High load";
  }

  if (score <= 42) {
    return "Light load";
  }

  return "Balanced";
}

function buildGrowthRate(currentValue: number, previousValue: number) {
  if (previousValue > 0) {
    return Number((((currentValue - previousValue) / previousValue) * 100).toFixed(1));
  }

  return currentValue > 0 ? 100 : 0;
}

function buildPortalInsights(input: {
  totalTreatments: number;
  repeatCustomerContribution: number;
  averageUtilizationScore: number;
  topTherapistName: string;
  topTherapistShare: number;
  overloadedTherapists: number;
  decliningTherapists: number;
  therapistCount: number;
}) {
  const insights: Array<{
    id: string;
    tone: "positive" | "attention" | "neutral";
    title: string;
    detail: string;
  }> = [];

  if (input.repeatCustomerContribution >= 38) {
    insights.push({
      id: "repeat-strength",
      tone: "positive",
      title: "Repeat customers are supporting therapist demand",
      detail: `${input.repeatCustomerContribution.toFixed(1)}% of visible therapist-customer relationships came from repeat visits in this period.`,
    });
  }

  if (input.topTherapistName && input.topTherapistShare >= 28) {
    insights.push({
      id: "leader-concentration",
      tone: "neutral",
      title: "One therapist carries a large share of treatment flow",
      detail: `${input.topTherapistName} accounts for ${input.topTherapistShare.toFixed(1)}% of visible treatments.`,
    });
  }

  if (input.overloadedTherapists >= Math.max(2, Math.ceil(input.therapistCount * 0.25))) {
    insights.push({
      id: "capacity-pressure",
      tone: "attention",
      title: "Several therapists are operating at a high load",
      detail: `${input.overloadedTherapists.toLocaleString("en-US")} therapists are in the high-load band. Review coverage before demand narrows further.`,
    });
  } else if (input.averageUtilizationScore <= 42 && input.totalTreatments > 0) {
    insights.push({
      id: "light-utilization",
      tone: "neutral",
      title: "Therapist capacity looks underused overall",
      detail: "The current date window shows light coverage compared with a typical working cadence. Review scheduling density and promotion timing.",
    });
  }

  if (input.decliningTherapists >= Math.max(2, Math.ceil(input.therapistCount * 0.4))) {
    insights.push({
      id: "momentum-softening",
      tone: "attention",
      title: "A meaningful part of the therapist team is slowing",
      detail: `${input.decliningTherapists.toLocaleString("en-US")} therapists are below the previous comparison window. Review demand and therapist allocation.`,
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "steady-mix",
      tone: "neutral",
      title: "Therapist workload looks balanced",
      detail: "The current period shows a stable mix of therapist activity, repeat support, and treatment contribution.",
    });
  }

  return insights.slice(0, 4);
}

function buildTherapistInsights(input: {
  therapistName: string;
  growthRate: number;
  repeatCustomerRate: number;
  topService: string;
  topServiceShare: number;
  serviceBreadth: number;
  utilizationScore: number;
  activeDays: number;
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
      title: "Therapist demand is growing",
      detail: `${input.therapistName} handled ${input.growthRate.toFixed(1)}% more treatments than the previous comparison window.`,
    });
  } else if (input.growthRate <= -12) {
    insights.push({
      id: "decline",
      tone: "attention",
      title: "Treatment flow is softer than the previous window",
      detail: `${input.therapistName}'s treatment volume is down ${Math.abs(input.growthRate).toFixed(1)}% versus the previous comparison window.`,
    });
  }

  if (input.repeatCustomerRate >= 40) {
    insights.push({
      id: "repeat-affinity",
      tone: "positive",
      title: "Repeat-customer affinity is strong",
      detail: `${input.repeatCustomerRate.toFixed(1)}% of customers returned to this therapist more than once in the selected period.`,
    });
  } else if (input.repeatCustomerRate <= 14 && input.activeDays >= 4) {
    insights.push({
      id: "repeat-thin",
      tone: "attention",
      title: "Continuity is still thin",
      detail: "This therapist is active, but repeat visits are still light. Consider continuity scripting or follow-up ownership.",
    });
  }

  if (input.topService && input.topService !== "Unknown" && input.topServiceShare >= 55) {
    insights.push({
      id: "specialization",
      tone: "neutral",
      title: "A clear service specialization is visible",
      detail: `${input.topService} accounts for ${input.topServiceShare.toFixed(1)}% of visible treatments for this therapist.`,
    });
  } else if (input.serviceBreadth >= 5) {
    insights.push({
      id: "breadth",
      tone: "neutral",
      title: "This therapist works across a broad service mix",
      detail: `${input.therapistName} touched ${input.serviceBreadth.toLocaleString("en-US")} different services in the selected period.`,
    });
  }

  if (input.utilizationScore >= 82) {
    insights.push({
      id: "load",
      tone: "attention",
      title: "Workload is running hot",
      detail: "Schedule density and coverage are both elevated. Watch over-reliance and recovery time if growth continues.",
    });
  } else if (input.utilizationScore <= 38 && input.activeDays >= 2) {
    insights.push({
      id: "light-load",
      tone: "neutral",
      title: "There may be room to grow this therapist's book",
      detail: "This therapist has visible activity, but the current load suggests there is still capacity to absorb more demand.",
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "steady",
      tone: "neutral",
      title: "Balanced therapist profile",
      detail: "The current period shows a steady mix of demand, relationship depth, and service breadth.",
    });
  }

  return insights.slice(0, 5);
}

function buildTherapistRecommendedAction(input: {
  growthRate: number;
  repeatCustomerRate: number;
  utilizationScore: number;
  topService: string;
  topServiceShare: number;
}) {
  if (input.utilizationScore >= 82) {
    return "Protect capacity by reviewing schedule density and cross-training more coverage around this therapist's strongest services.";
  }

  if (input.growthRate <= -12 && input.repeatCustomerRate <= 18) {
    return "Review how the team rebooks this therapist's customers and tighten continuity follow-up after treatment completion.";
  }

  if (input.topService && input.topServiceShare >= 55) {
    return `Use ${input.topService} as this therapist's signature service while building a second service pillar to reduce concentration risk.`;
  }

  if (input.repeatCustomerRate >= 40) {
    return "Lean into this therapist's continuity strength with premium package renewals and consistent revisit planning.";
  }

  return "Maintain current performance and keep monitoring demand, repeat customers, and schedule balance across the team.";
}

export async function getTherapistPortalReport(params: TherapistListParams) {
  const { previousFromDate, previousToDate, spanDays } = getPreviousWindow(params.fromDate, params.toDate);
  const queryParams = {
    ...params,
    previousFromDate,
    previousToDate,
  };
  const bucketExpression = buildTrendBucketExpression(params.fromDate, params.toDate);

  const [summaryRows, therapistRows, trendRows, topServiceRows, categoryRows] = await Promise.all([
    runAnalyticsQuery<{
      totalTreatments: number;
      uniqueCustomers: number;
      activeTherapists: number;
      therapistCustomerPairs: number;
      repeatCustomerPairs: number;
    }>(
      `
        ${buildDistinctTherapistVisitsCte("DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
        ,
        PeriodVisits AS (
          SELECT *
          FROM DistinctTherapistVisits
          WHERE (@serviceCategory = '' OR LOWER(serviceCategory) = LOWER(@serviceCategory))
            AND (
              @search = ''
              OR LOWER(therapistName) LIKE LOWER(CONCAT('%', @search, '%'))
              OR LOWER(serviceName) LIKE LOWER(CONCAT('%', @search, '%'))
              OR LOWER(serviceCategory) LIKE LOWER(CONCAT('%', @search, '%'))
            )
        ),
        RepeatPairs AS (
          SELECT therapistName, customerKey
          FROM PeriodVisits
          WHERE customerKey IS NOT NULL
          GROUP BY therapistName, customerKey
          HAVING COUNT(*) > 1
        )
        SELECT
          COUNT(*) AS totalTreatments,
          COUNT(DISTINCT customerKey) AS uniqueCustomers,
          COUNT(DISTINCT therapistName) AS activeTherapists,
          COUNT(DISTINCT CONCAT(therapistName, '|', customerKey)) AS therapistCustomerPairs,
          (SELECT COUNT(*) FROM RepeatPairs) AS repeatCustomerPairs
        FROM PeriodVisits
      `,
      queryParams,
    ),
    runAnalyticsQuery<{
      therapistName: string;
      treatmentsCompleted: number;
      customersServed: number;
      repeatCustomers: number;
      estimatedTreatmentValue: number;
      averageTreatmentValue: number;
      activeDays: number;
      lastTreatmentDate: string | null;
      previousTreatmentCount: number;
      topService: string;
      topServiceCount: number;
      topCategory: string;
      topCategoryCount: number;
    }>(
      `
        ${buildDistinctTherapistVisitsCte("DATE(CheckInTime) BETWEEN @previousFromDate AND @toDate")}
        ,
        PeriodVisits AS (
          SELECT *
          FROM DistinctTherapistVisits
          WHERE DATE(checkInTime) BETWEEN @fromDate AND @toDate
            AND (@serviceCategory = '' OR LOWER(serviceCategory) = LOWER(@serviceCategory))
            AND (
              @search = ''
              OR LOWER(therapistName) LIKE LOWER(CONCAT('%', @search, '%'))
              OR LOWER(serviceName) LIKE LOWER(CONCAT('%', @search, '%'))
              OR LOWER(serviceCategory) LIKE LOWER(CONCAT('%', @search, '%'))
            )
        ),
        PreviousVisits AS (
          SELECT *
          FROM DistinctTherapistVisits
          WHERE DATE(checkInTime) BETWEEN @previousFromDate AND @previousToDate
            AND (@serviceCategory = '' OR LOWER(serviceCategory) = LOWER(@serviceCategory))
            AND (
              @search = ''
              OR LOWER(therapistName) LIKE LOWER(CONCAT('%', @search, '%'))
              OR LOWER(serviceName) LIKE LOWER(CONCAT('%', @search, '%'))
              OR LOWER(serviceCategory) LIKE LOWER(CONCAT('%', @search, '%'))
            )
        ),
        TherapistCustomerCounts AS (
          SELECT therapistName, customerKey, COUNT(*) AS visitCount
          FROM PeriodVisits
          WHERE customerKey IS NOT NULL
          GROUP BY therapistName, customerKey
        ),
        TherapistTopService AS (
          SELECT therapistName, serviceName AS topService, treatmentCount AS topServiceCount
          FROM (
            SELECT
              grouped.therapistName,
              grouped.serviceName,
              grouped.treatmentCount,
              grouped.latestVisitDate,
              ROW_NUMBER() OVER (
                PARTITION BY grouped.therapistName
                ORDER BY grouped.treatmentCount DESC, grouped.latestVisitDate DESC, grouped.serviceName ASC
              ) AS rowNum
            FROM (
              SELECT
                therapistName,
                serviceName,
                COUNT(*) AS treatmentCount,
                MAX(checkInTime) AS latestVisitDate
              FROM PeriodVisits
              WHERE COALESCE(serviceName, '') != ''
              GROUP BY therapistName, serviceName
            ) AS grouped
          )
          WHERE rowNum = 1
        ),
        TherapistTopCategory AS (
          SELECT therapistName, serviceCategory AS topCategory, treatmentCount AS topCategoryCount
          FROM (
            SELECT
              grouped.therapistName,
              grouped.serviceCategory,
              grouped.treatmentCount,
              grouped.latestVisitDate,
              ROW_NUMBER() OVER (
                PARTITION BY grouped.therapistName
                ORDER BY grouped.treatmentCount DESC, grouped.latestVisitDate DESC, grouped.serviceCategory ASC
              ) AS rowNum
            FROM (
              SELECT
                therapistName,
                serviceCategory,
                COUNT(*) AS treatmentCount,
                MAX(checkInTime) AS latestVisitDate
              FROM PeriodVisits
              GROUP BY therapistName, serviceCategory
            ) AS grouped
          )
          WHERE rowNum = 1
        ),
        ActiveDayStats AS (
          SELECT
            therapistName,
            COUNT(DISTINCT DATE(checkInTime)) AS activeDays,
            FORMAT_DATE('%Y-%m-%d', MAX(DATE(checkInTime))) AS lastTreatmentDate
          FROM PeriodVisits
          GROUP BY therapistName
        ),
        PreviousVisitCounts AS (
          SELECT therapistName, COUNT(*) AS previousTreatmentCount
          FROM PreviousVisits
          GROUP BY therapistName
        )
        SELECT
          visits.therapistName,
          COUNT(*) AS treatmentsCompleted,
          COUNT(DISTINCT visits.customerKey) AS customersServed,
          COUNT(DISTINCT IF(customerCounts.visitCount > 1, visits.customerKey, NULL)) AS repeatCustomers,
          COALESCE(SUM(visits.price), 0) AS estimatedTreatmentValue,
          COALESCE(AVG(visits.price), 0) AS averageTreatmentValue,
          COALESCE(activeDayStats.activeDays, 0) AS activeDays,
          activeDayStats.lastTreatmentDate,
          COALESCE(previousVisitCounts.previousTreatmentCount, 0) AS previousTreatmentCount,
          COALESCE(therapistTopService.topService, 'Unknown') AS topService,
          COALESCE(therapistTopService.topServiceCount, 0) AS topServiceCount,
          COALESCE(therapistTopCategory.topCategory, 'Other') AS topCategory,
          COALESCE(therapistTopCategory.topCategoryCount, 0) AS topCategoryCount
        FROM PeriodVisits AS visits
        LEFT JOIN TherapistCustomerCounts AS customerCounts
          USING (therapistName, customerKey)
        LEFT JOIN ActiveDayStats AS activeDayStats
          USING (therapistName)
        LEFT JOIN PreviousVisitCounts AS previousVisitCounts
          USING (therapistName)
        LEFT JOIN TherapistTopService AS therapistTopService
          USING (therapistName)
        LEFT JOIN TherapistTopCategory AS therapistTopCategory
          USING (therapistName)
        GROUP BY
          visits.therapistName,
          activeDayStats.activeDays,
          activeDayStats.lastTreatmentDate,
          previousVisitCounts.previousTreatmentCount,
          therapistTopService.topService,
          therapistTopService.topServiceCount,
          therapistTopCategory.topCategory,
          therapistTopCategory.topCategoryCount
        ORDER BY treatmentsCompleted DESC, estimatedTreatmentValue DESC, visits.therapistName ASC
      `,
      queryParams,
    ),
    runAnalyticsQuery<{
      bucket: string;
      treatmentsCompleted: number;
      customersServed: number;
      estimatedTreatmentValue: number;
    }>(
      `
        ${buildDistinctTherapistVisitsCte("DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
        SELECT
          ${bucketExpression} AS bucket,
          COUNT(*) AS treatmentsCompleted,
          COUNT(DISTINCT customerKey) AS customersServed,
          COALESCE(SUM(price), 0) AS estimatedTreatmentValue
        FROM DistinctTherapistVisits
        WHERE (@serviceCategory = '' OR LOWER(serviceCategory) = LOWER(@serviceCategory))
          AND (
            @search = ''
            OR LOWER(therapistName) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(serviceName) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(serviceCategory) LIKE LOWER(CONCAT('%', @search, '%'))
          )
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      queryParams,
    ),
    runAnalyticsQuery<{
      serviceName: string;
      treatmentsCompleted: number;
      therapistCount: number;
      estimatedTreatmentValue: number;
    }>(
      `
        ${buildDistinctTherapistVisitsCte("DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
        SELECT
          serviceName,
          COUNT(*) AS treatmentsCompleted,
          COUNT(DISTINCT therapistName) AS therapistCount,
          COALESCE(SUM(price), 0) AS estimatedTreatmentValue
        FROM DistinctTherapistVisits
        WHERE COALESCE(serviceName, '') != ''
          AND (@serviceCategory = '' OR LOWER(serviceCategory) = LOWER(@serviceCategory))
          AND (
            @search = ''
            OR LOWER(therapistName) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(serviceName) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(serviceCategory) LIKE LOWER(CONCAT('%', @search, '%'))
          )
        GROUP BY serviceName
        ORDER BY treatmentsCompleted DESC, estimatedTreatmentValue DESC, serviceName ASC
        LIMIT 8
      `,
      queryParams,
    ),
    runAnalyticsQuery<{
      serviceCategory: string;
      treatmentsCompleted: number;
      estimatedTreatmentValue: number;
    }>(
      `
        ${buildDistinctTherapistVisitsCte("DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
        SELECT
          serviceCategory,
          COUNT(*) AS treatmentsCompleted,
          COALESCE(SUM(price), 0) AS estimatedTreatmentValue
        FROM DistinctTherapistVisits
        WHERE (@serviceCategory = '' OR LOWER(serviceCategory) = LOWER(@serviceCategory))
          AND (
            @search = ''
            OR LOWER(therapistName) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(serviceName) LIKE LOWER(CONCAT('%', @search, '%'))
            OR LOWER(serviceCategory) LIKE LOWER(CONCAT('%', @search, '%'))
          )
        GROUP BY serviceCategory
        ORDER BY treatmentsCompleted DESC, estimatedTreatmentValue DESC, serviceCategory ASC
      `,
      queryParams,
    ),
  ]);

  const summaryRow = summaryRows[0];
  const leaderboard = therapistRows.map((row) => {
    const treatmentsCompleted = parseNumber(row.treatmentsCompleted);
    const customersServed = parseNumber(row.customersServed);
    const repeatCustomers = parseNumber(row.repeatCustomers);
    const estimatedTreatmentValue = parseNumber(row.estimatedTreatmentValue);
    const activeDays = parseNumber(row.activeDays);
    const previousTreatmentCount = parseNumber(row.previousTreatmentCount);
    const topServiceCount = parseNumber(row.topServiceCount);
    const repeatCustomerRate =
      customersServed > 0 ? Number(((repeatCustomers / customersServed) * 100).toFixed(1)) : 0;
    const topServiceShare =
      treatmentsCompleted > 0 ? Number(((topServiceCount / treatmentsCompleted) * 100).toFixed(1)) : 0;
    const growthRate = buildGrowthRate(treatmentsCompleted, previousTreatmentCount);
    const utilizationScore = buildUtilizationScore({
      treatmentsCompleted,
      activeDays,
      periodDays: spanDays,
    });

    return {
      therapistName: row.therapistName,
      treatmentsCompleted,
      customersServed,
      repeatCustomers,
      repeatCustomerRate,
      estimatedTreatmentValue,
      averageTreatmentValue: Number(parseNumber(row.averageTreatmentValue).toFixed(0)),
      activeDays,
      lastTreatmentDate: row.lastTreatmentDate,
      topService: row.topService,
      topServiceShare,
      topCategory: row.topCategory,
      growthRate,
      utilizationScore,
      workloadBand: workloadLabel(utilizationScore),
    };
  });

  const sortDirection = params.sortDirection === "asc" ? 1 : -1;
  leaderboard.sort((left, right) => {
    const leftValue =
      params.sortBy === "treatmentsCompleted"
        ? left.treatmentsCompleted
        : params.sortBy === "customersServed"
          ? left.customersServed
          : params.sortBy === "estimatedTreatmentValue"
            ? left.estimatedTreatmentValue
            : params.sortBy === "repeatCustomerRate"
              ? left.repeatCustomerRate
              : params.sortBy === "growthRate"
                ? left.growthRate
                : left.utilizationScore;
    const rightValue =
      params.sortBy === "treatmentsCompleted"
        ? right.treatmentsCompleted
        : params.sortBy === "customersServed"
          ? right.customersServed
          : params.sortBy === "estimatedTreatmentValue"
            ? right.estimatedTreatmentValue
            : params.sortBy === "repeatCustomerRate"
              ? right.repeatCustomerRate
              : params.sortBy === "growthRate"
                ? right.growthRate
                : right.utilizationScore;

    if (leftValue < rightValue) {
      return -1 * sortDirection;
    }

    if (leftValue > rightValue) {
      return 1 * sortDirection;
    }

    return left.therapistName.localeCompare(right.therapistName);
  });

  const totalTreatments = parseNumber(summaryRow?.totalTreatments);
  const activeTherapists = parseNumber(summaryRow?.activeTherapists);
  const uniqueCustomers = parseNumber(summaryRow?.uniqueCustomers);
  const therapistCustomerPairs = parseNumber(summaryRow?.therapistCustomerPairs);
  const repeatCustomerPairs = parseNumber(summaryRow?.repeatCustomerPairs);
  const repeatCustomerContribution =
    therapistCustomerPairs > 0 ? Number(((repeatCustomerPairs / therapistCustomerPairs) * 100).toFixed(1)) : 0;
  const averageUtilizationScore =
    leaderboard.length > 0
      ? Number((leaderboard.reduce((sum, row) => sum + row.utilizationScore, 0) / leaderboard.length).toFixed(1))
      : 0;
  const highlight = leaderboard[0] ?? null;
  const topTherapistShare =
    highlight && totalTreatments > 0 ? Number(((highlight.treatmentsCompleted / totalTreatments) * 100).toFixed(1)) : 0;
  const insights = buildPortalInsights({
    totalTreatments,
    repeatCustomerContribution,
    averageUtilizationScore,
    topTherapistName: highlight?.therapistName ?? "",
    topTherapistShare,
    overloadedTherapists: leaderboard.filter((row) => row.utilizationScore >= 78).length,
    decliningTherapists: leaderboard.filter((row) => row.growthRate <= -12).length,
    therapistCount: leaderboard.length,
  });

  return {
    summary: {
      totalTherapists: leaderboard.length,
      activeTherapists,
      totalTreatments,
      customersServed: uniqueCustomers,
      averageTreatmentsPerTherapist:
        leaderboard.length > 0 ? Number((totalTreatments / leaderboard.length).toFixed(1)) : 0,
      repeatCustomerContribution,
      averageUtilizationScore,
    },
    highlight: highlight
      ? {
          therapistName: highlight.therapistName,
          treatmentsCompleted: highlight.treatmentsCompleted,
          customersServed: highlight.customersServed,
          repeatCustomerRate: highlight.repeatCustomerRate,
          estimatedTreatmentValue: highlight.estimatedTreatmentValue,
          topService: highlight.topService,
          growthRate: highlight.growthRate,
          utilizationScore: highlight.utilizationScore,
          topTherapistShare,
        }
      : null,
    trend: trendRows.map((row) => ({
      bucket: row.bucket,
      treatmentsCompleted: parseNumber(row.treatmentsCompleted),
      customersServed: parseNumber(row.customersServed),
      estimatedTreatmentValue: parseNumber(row.estimatedTreatmentValue),
    })),
    leaderboard,
    topServices: topServiceRows.map((row) => ({
      serviceName: row.serviceName,
      treatmentsCompleted: parseNumber(row.treatmentsCompleted),
      therapistCount: parseNumber(row.therapistCount),
      estimatedTreatmentValue: parseNumber(row.estimatedTreatmentValue),
    })),
    serviceMix: categoryRows.map((row) => ({
      serviceCategory: row.serviceCategory,
      treatmentsCompleted: parseNumber(row.treatmentsCompleted),
      estimatedTreatmentValue: parseNumber(row.estimatedTreatmentValue),
    })),
    filterOptions: {
      serviceCategories: categoryRows.map((row) => row.serviceCategory),
    },
    insights,
    assumptions: [
      "Treatment value is estimated from MainDataView price fields because invoice-level payment attribution is not directly mapped to therapists.",
      "Customer matching falls back to customer name when phone number is missing in treatment records.",
    ],
  };
}

export async function getTherapistPortalOverview(params: TherapistDetailParams) {
  const { previousFromDate, previousToDate, spanDays } = getPreviousWindow(params.fromDate, params.toDate);
  const queryParams = {
    ...params,
    previousFromDate,
    previousToDate,
  };
  const bucketExpression = buildTrendBucketExpression(params.fromDate, params.toDate);

  const [summaryRows, trendRows, topServiceRows, serviceMixRows, recentCustomerRows, weekdayRows, hourRows] =
    await Promise.all([
      runAnalyticsQuery<{
        treatmentsCompleted: number;
        customersServed: number;
        repeatCustomers: number;
        estimatedTreatmentValue: number;
        averageTreatmentValue: number;
        activeDays: number;
        lastTreatmentDate: string | null;
        previousTreatmentCount: number;
        topService: string;
        topServiceCount: number;
        topCategory: string;
        topCategoryCount: number;
        serviceBreadth: number;
      }>(
        `
          ${buildDistinctTherapistVisitsCte("DATE(CheckInTime) BETWEEN @previousFromDate AND @toDate")}
          ,
          TherapistCurrent AS (
            SELECT *
            FROM DistinctTherapistVisits
            WHERE LOWER(therapistName) = LOWER(@therapistName)
              AND DATE(checkInTime) BETWEEN @fromDate AND @toDate
          ),
          TherapistPrevious AS (
            SELECT *
            FROM DistinctTherapistVisits
            WHERE LOWER(therapistName) = LOWER(@therapistName)
              AND DATE(checkInTime) BETWEEN @previousFromDate AND @previousToDate
          ),
          CustomerCounts AS (
            SELECT customerKey, COUNT(*) AS visitCount
            FROM TherapistCurrent
            WHERE customerKey IS NOT NULL
            GROUP BY customerKey
          ),
          TopService AS (
            SELECT serviceName AS topService, treatmentCount AS topServiceCount
            FROM (
              SELECT
                grouped.serviceName,
                grouped.treatmentCount,
                grouped.latestVisitDate,
                ROW_NUMBER() OVER (
                  ORDER BY grouped.treatmentCount DESC, grouped.latestVisitDate DESC, grouped.serviceName ASC
                ) AS rowNum
              FROM (
                SELECT
                  serviceName,
                  COUNT(*) AS treatmentCount,
                  MAX(checkInTime) AS latestVisitDate
                FROM TherapistCurrent
                WHERE COALESCE(serviceName, '') != ''
                GROUP BY serviceName
              ) AS grouped
            )
            WHERE rowNum = 1
          ),
          TopCategory AS (
            SELECT serviceCategory AS topCategory, treatmentCount AS topCategoryCount
            FROM (
              SELECT
                grouped.serviceCategory,
                grouped.treatmentCount,
                grouped.latestVisitDate,
                ROW_NUMBER() OVER (
                  ORDER BY grouped.treatmentCount DESC, grouped.latestVisitDate DESC, grouped.serviceCategory ASC
                ) AS rowNum
              FROM (
                SELECT
                  serviceCategory,
                  COUNT(*) AS treatmentCount,
                  MAX(checkInTime) AS latestVisitDate
                FROM TherapistCurrent
                GROUP BY serviceCategory
              ) AS grouped
            )
            WHERE rowNum = 1
          )
          SELECT
            COUNT(*) AS treatmentsCompleted,
            COUNT(DISTINCT customerKey) AS customersServed,
            COUNT(DISTINCT IF(customerCounts.visitCount > 1, therapistCurrent.customerKey, NULL)) AS repeatCustomers,
            COALESCE(SUM(price), 0) AS estimatedTreatmentValue,
            COALESCE(AVG(price), 0) AS averageTreatmentValue,
            COUNT(DISTINCT DATE(checkInTime)) AS activeDays,
            FORMAT_DATE('%Y-%m-%d', MAX(DATE(checkInTime))) AS lastTreatmentDate,
            (SELECT COUNT(*) FROM TherapistPrevious) AS previousTreatmentCount,
            (SELECT topService FROM TopService) AS topService,
            COALESCE((SELECT topServiceCount FROM TopService), 0) AS topServiceCount,
            (SELECT topCategory FROM TopCategory) AS topCategory,
            COALESCE((SELECT topCategoryCount FROM TopCategory), 0) AS topCategoryCount,
            COUNT(DISTINCT serviceName) AS serviceBreadth
          FROM TherapistCurrent AS therapistCurrent
          LEFT JOIN CustomerCounts AS customerCounts
            USING (customerKey)
        `,
        queryParams,
      ),
      runAnalyticsQuery<{
        bucket: string;
        treatmentsCompleted: number;
        customersServed: number;
        estimatedTreatmentValue: number;
      }>(
        `
          ${buildDistinctTherapistVisitsCte("LOWER(PractitionerName) = LOWER(@therapistName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
          SELECT
            ${bucketExpression} AS bucket,
            COUNT(*) AS treatmentsCompleted,
            COUNT(DISTINCT customerKey) AS customersServed,
            COALESCE(SUM(price), 0) AS estimatedTreatmentValue
          FROM DistinctTherapistVisits
          GROUP BY bucket
          ORDER BY bucket ASC
        `,
        queryParams,
      ),
      runAnalyticsQuery<{
        serviceName: string;
        serviceCategory: string;
        treatmentsCompleted: number;
        customersServed: number;
        repeatCustomers: number;
        estimatedTreatmentValue: number;
      }>(
        `
          ${buildDistinctTherapistVisitsCte("LOWER(PractitionerName) = LOWER(@therapistName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
          ,
          ServiceCustomerCounts AS (
            SELECT serviceName, customerKey, COUNT(*) AS visitCount
            FROM DistinctTherapistVisits
            WHERE customerKey IS NOT NULL
            GROUP BY serviceName, customerKey
          )
          SELECT
            visits.serviceName,
            ANY_VALUE(visits.serviceCategory) AS serviceCategory,
            COUNT(*) AS treatmentsCompleted,
            COUNT(DISTINCT visits.customerKey) AS customersServed,
            COUNT(DISTINCT IF(customerCounts.visitCount > 1, visits.customerKey, NULL)) AS repeatCustomers,
            COALESCE(SUM(visits.price), 0) AS estimatedTreatmentValue
          FROM DistinctTherapistVisits AS visits
          LEFT JOIN ServiceCustomerCounts AS customerCounts
            USING (serviceName, customerKey)
          WHERE COALESCE(visits.serviceName, '') != ''
          GROUP BY visits.serviceName
          ORDER BY treatmentsCompleted DESC, estimatedTreatmentValue DESC, visits.serviceName ASC
          LIMIT 10
        `,
        queryParams,
      ),
      runAnalyticsQuery<{
        serviceCategory: string;
        treatmentsCompleted: number;
        estimatedTreatmentValue: number;
      }>(
        `
          ${buildDistinctTherapistVisitsCte("LOWER(PractitionerName) = LOWER(@therapistName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
          SELECT
            serviceCategory,
            COUNT(*) AS treatmentsCompleted,
            COALESCE(SUM(price), 0) AS estimatedTreatmentValue
          FROM DistinctTherapistVisits
          GROUP BY serviceCategory
          ORDER BY treatmentsCompleted DESC, estimatedTreatmentValue DESC, serviceCategory ASC
        `,
        queryParams,
      ),
      runAnalyticsQuery<{
        customerName: string;
        phoneNumber: string;
        memberId: string;
        visitCount: number;
        estimatedTreatmentValue: number;
        lastVisitDate: string | null;
        lastService: string;
      }>(
        `
          ${buildDistinctTherapistVisitsCte("LOWER(PractitionerName) = LOWER(@therapistName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
          SELECT
            customerName,
            phoneNumber,
            MAX(memberId) AS memberId,
            COUNT(*) AS visitCount,
            COALESCE(SUM(price), 0) AS estimatedTreatmentValue,
            FORMAT_DATE('%Y-%m-%d', MAX(DATE(checkInTime))) AS lastVisitDate,
            ARRAY_AGG(COALESCE(serviceName, '') ORDER BY checkInTime DESC LIMIT 1)[SAFE_OFFSET(0)] AS lastService
          FROM DistinctTherapistVisits
          WHERE customerKey IS NOT NULL
          GROUP BY customerName, phoneNumber
          ORDER BY lastVisitDate DESC, visitCount DESC, customerName ASC
          LIMIT 8
        `,
        queryParams,
      ),
      runAnalyticsQuery<{
        label: string;
        treatmentCount: number;
      }>(
        `
          ${buildDistinctTherapistVisitsCte("LOWER(PractitionerName) = LOWER(@therapistName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
          SELECT
            FORMAT_DATE('%A', DATE(checkInTime)) AS label,
            COUNT(*) AS treatmentCount
          FROM DistinctTherapistVisits
          GROUP BY label
          ORDER BY treatmentCount DESC, label ASC
          LIMIT 3
        `,
        queryParams,
      ),
      runAnalyticsQuery<{
        label: string;
        treatmentCount: number;
      }>(
        `
          ${buildDistinctTherapistVisitsCte("LOWER(PractitionerName) = LOWER(@therapistName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
          SELECT
            FORMAT_TIMESTAMP('%I %p', checkInTime) AS label,
            COUNT(*) AS treatmentCount
          FROM DistinctTherapistVisits
          GROUP BY label
          ORDER BY treatmentCount DESC, label ASC
          LIMIT 3
        `,
        queryParams,
      ),
    ]);

  const summary = summaryRows[0];
  const treatmentsCompleted = parseNumber(summary?.treatmentsCompleted);
  const customersServed = parseNumber(summary?.customersServed);
  const repeatCustomers = parseNumber(summary?.repeatCustomers);
  const activeDays = parseNumber(summary?.activeDays);
  const previousTreatmentCount = parseNumber(summary?.previousTreatmentCount);
  const topServiceCount = parseNumber(summary?.topServiceCount);
  const repeatCustomerRate =
    customersServed > 0 ? Number(((repeatCustomers / customersServed) * 100).toFixed(1)) : 0;
  const topServiceShare =
    treatmentsCompleted > 0 ? Number(((topServiceCount / treatmentsCompleted) * 100).toFixed(1)) : 0;
  const primaryServiceName = parseText(summary?.topService) || parseText(topServiceRows[0]?.serviceName, "Unknown");
  const primaryCategory =
    parseText(summary?.topCategory) || parseText(serviceMixRows[0]?.serviceCategory, "Other");
  const growthRate = buildGrowthRate(treatmentsCompleted, previousTreatmentCount);
  const utilizationScore = buildUtilizationScore({
    treatmentsCompleted,
    activeDays,
    periodDays: spanDays,
  });

  const insights = buildTherapistInsights({
    therapistName: params.therapistName,
    growthRate,
    repeatCustomerRate,
    topService: primaryServiceName,
    topServiceShare,
    serviceBreadth: parseNumber(summary?.serviceBreadth),
    utilizationScore,
    activeDays,
  });

  return {
    therapist: {
      therapistName: params.therapistName,
      treatmentsCompleted,
      customersServed,
      repeatCustomers,
      repeatCustomerRate,
      estimatedTreatmentValue: parseNumber(summary?.estimatedTreatmentValue),
      averageTreatmentValue: Number(parseNumber(summary?.averageTreatmentValue).toFixed(0)),
      activeDays,
      averageTreatmentsPerActiveDay:
        activeDays > 0 ? Number((treatmentsCompleted / activeDays).toFixed(1)) : 0,
      topService: primaryServiceName,
      topServiceShare,
      topCategory: primaryCategory,
      serviceBreadth: parseNumber(summary?.serviceBreadth),
      lastTreatmentDate: summary?.lastTreatmentDate ?? null,
      growthRate,
      utilizationScore,
      workloadBand: workloadLabel(utilizationScore),
    },
    trend: trendRows.map((row) => ({
      bucket: row.bucket,
      treatmentsCompleted: parseNumber(row.treatmentsCompleted),
      customersServed: parseNumber(row.customersServed),
      estimatedTreatmentValue: parseNumber(row.estimatedTreatmentValue),
    })),
    topServices: topServiceRows.map((row) => {
      const serviceCustomers = parseNumber(row.customersServed);
      return {
        serviceName: row.serviceName,
        serviceCategory: row.serviceCategory,
        treatmentsCompleted: parseNumber(row.treatmentsCompleted),
        customersServed: serviceCustomers,
        repeatCustomers: parseNumber(row.repeatCustomers),
        repeatCustomerRate:
          serviceCustomers > 0 ? Number(((parseNumber(row.repeatCustomers) / serviceCustomers) * 100).toFixed(1)) : 0,
        estimatedTreatmentValue: parseNumber(row.estimatedTreatmentValue),
      };
    }),
    serviceMix: serviceMixRows.map((row) => ({
      serviceCategory: row.serviceCategory,
      treatmentsCompleted: parseNumber(row.treatmentsCompleted),
      estimatedTreatmentValue: parseNumber(row.estimatedTreatmentValue),
    })),
    recentCustomers: recentCustomerRows.map((row) => ({
      customerName: row.customerName,
      phoneNumber: row.phoneNumber,
      memberId: row.memberId,
      visitCount: parseNumber(row.visitCount),
      estimatedTreatmentValue: parseNumber(row.estimatedTreatmentValue),
      lastVisitDate: row.lastVisitDate,
      lastService: row.lastService,
      relationship: parseNumber(row.visitCount) > 1 ? "Repeat" : "New",
    })),
    busiestPeriods: {
      weekdays: weekdayRows.map((row) => ({
        label: row.label,
        treatmentCount: parseNumber(row.treatmentCount),
      })),
      hours: hourRows.map((row) => ({
        label: row.label,
        treatmentCount: parseNumber(row.treatmentCount),
      })),
    },
    insights,
    recommendedAction: buildTherapistRecommendedAction({
      growthRate,
      repeatCustomerRate,
      utilizationScore,
      topService: parseText(summary?.topService, "Unknown"),
      topServiceShare,
    }),
    assumptions: [
      "Treatment value is estimated from MainDataView price fields because invoice-level payment attribution is not directly mapped to therapists.",
      "Customer matching falls back to customer name when phone number is missing in treatment records.",
    ],
  };
}

export async function getTherapistPortalCustomers(params: TherapistPagedDetailParams) {
  const offset = (params.page - 1) * params.pageSize;
  const queryParams = {
    ...params,
    offset,
  };

  const rows = await runAnalyticsQuery<{
    customerName: string;
    phoneNumber: string;
    memberId: string;
    visitCount: number;
    estimatedTreatmentValue: number;
    lastVisitDate: string | null;
    lastService: string;
    totalCount: number;
  }>(
    `
      ${buildDistinctTherapistVisitsCte("LOWER(PractitionerName) = LOWER(@therapistName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
      SELECT
        customerName,
        phoneNumber,
        MAX(memberId) AS memberId,
        COUNT(*) AS visitCount,
        COALESCE(SUM(price), 0) AS estimatedTreatmentValue,
        FORMAT_DATE('%Y-%m-%d', MAX(DATE(checkInTime))) AS lastVisitDate,
        ARRAY_AGG(COALESCE(serviceName, '') ORDER BY checkInTime DESC LIMIT 1)[SAFE_OFFSET(0)] AS lastService,
        COUNT(*) OVER() AS totalCount
      FROM DistinctTherapistVisits
      WHERE customerKey IS NOT NULL
        AND (
          @search = ''
          OR LOWER(customerName) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(phoneNumber) LIKE LOWER(CONCAT('%', @search, '%'))
          OR LOWER(serviceName) LIKE LOWER(CONCAT('%', @search, '%'))
        )
      GROUP BY customerName, phoneNumber
      ORDER BY lastVisitDate DESC, visitCount DESC, customerName ASC
      LIMIT @pageSize
      OFFSET @offset
    `,
    queryParams,
  );

  const totalCount = rows.length > 0 ? parseNumber(rows[0].totalCount) : 0;
  const repeatCustomers = rows.filter((row) => parseNumber(row.visitCount) > 1).length;
  const totalValue = rows.reduce((sum, row) => sum + parseNumber(row.estimatedTreatmentValue), 0);

  return {
    summary: {
      customersServed: totalCount,
      repeatCustomers,
      averageTreatmentValuePerCustomer:
        totalCount > 0 ? Number((totalValue / totalCount).toFixed(0)) : 0,
    },
    rows: rows.map((row) => ({
      customerName: row.customerName,
      phoneNumber: row.phoneNumber,
      memberId: row.memberId,
      visitCount: parseNumber(row.visitCount),
      estimatedTreatmentValue: parseNumber(row.estimatedTreatmentValue),
      lastVisitDate: row.lastVisitDate,
      lastService: row.lastService,
      relationship: parseNumber(row.visitCount) > 1 ? "Repeat" : "New",
    })),
    totalCount,
  };
}

export async function getTherapistPortalTreatments(params: TherapistPagedDetailParams) {
  const offset = (params.page - 1) * params.pageSize;
  const queryParams = {
    ...params,
    offset,
  };

  const rows = await runAnalyticsQuery<{
    checkInTime: string;
    customerName: string;
    phoneNumber: string;
    memberId: string;
    serviceName: string;
    serviceCategory: string;
    estimatedTreatmentValue: number;
    totalCount: number;
  }>(
    `
      ${buildDistinctTherapistVisitsCte("LOWER(PractitionerName) = LOWER(@therapistName) AND DATE(CheckInTime) BETWEEN @fromDate AND @toDate")}
      SELECT
        FORMAT_TIMESTAMP('%Y-%m-%d %I:%M %p', checkInTime) AS checkInTime,
        customerName,
        phoneNumber,
        memberId,
        serviceName,
        serviceCategory,
        price AS estimatedTreatmentValue,
        COUNT(*) OVER() AS totalCount
      FROM DistinctTherapistVisits
      WHERE (
        @search = ''
        OR LOWER(customerName) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(phoneNumber) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(serviceName) LIKE LOWER(CONCAT('%', @search, '%'))
        OR LOWER(serviceCategory) LIKE LOWER(CONCAT('%', @search, '%'))
      )
      ORDER BY checkInTime DESC
      LIMIT @pageSize
      OFFSET @offset
    `,
    queryParams,
  );

  const totalCount = rows.length > 0 ? parseNumber(rows[0].totalCount) : 0;

  return {
    rows: rows.map((row) => ({
      checkInTime: row.checkInTime,
      customerName: row.customerName,
      phoneNumber: row.phoneNumber,
      memberId: row.memberId,
      serviceName: row.serviceName,
      serviceCategory: row.serviceCategory,
      estimatedTreatmentValue: parseNumber(row.estimatedTreatmentValue),
    })),
    totalCount,
  };
}
