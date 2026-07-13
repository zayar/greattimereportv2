import {
  getServicePortalOverview,
  resolveServicePortalCandidates,
} from "../reports/service-portal.service.js";
import { extractExplicitServiceSearchText } from "./service-query.js";
import { resolveEntityCandidates } from "./entity-candidate-resolver.js";
import { limitRows, maskPhone, nowIso } from "./safety.js";
import type {
  AgentDataStatus,
  AgentSourceScope,
  AgentToolInput,
  AgentToolResult,
  GreatTimeAgentSource,
  GreatTimeAgentWarning,
  Service360FactPack,
} from "./types.js";

type Service360Language = AgentToolInput["request"]["aiLanguage"];
type ServiceCandidate = Awaited<ReturnType<typeof resolveServicePortalCandidates>>[number];

type ServiceIdentityResolution =
  | { status: "resolved"; candidate: ServiceCandidate; sources: GreatTimeAgentSource[] }
  | { status: "ambiguous"; searchText: string; candidates: ServiceCandidate[]; sources: GreatTimeAgentSource[] }
  | { status: "not_found" | "not_ready" | "unavailable"; searchText: string; sources: GreatTimeAgentSource[]; warnings: GreatTimeAgentWarning[] };

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

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

function isMyanmarLanguage(language: Service360Language) {
  return language === "my-MM" || language === "my";
}

function source(params: {
  tool: string;
  sourceName: string;
  checkedAt?: string;
  period?: string;
  dataStatus: AgentDataStatus;
  scope: AgentSourceScope;
  live?: boolean;
}): GreatTimeAgentSource {
  return {
    tool: params.tool,
    sourceName: params.sourceName,
    checkedAt: params.checkedAt ?? nowIso(),
    period: params.period,
    dataStatus: params.dataStatus,
    live: params.live ?? params.scope === "live",
    scope: params.scope,
  };
}

function serviceKey(serviceName: string) {
  return normalizeText(serviceName);
}

function serviceDetailPath(params: { serviceName: string; fromDate: string; toDate: string }) {
  const slug =
    params.serviceName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "service";
  const search = new URLSearchParams({
    serviceName: params.serviceName,
    fromDate: params.fromDate,
    toDate: params.toDate,
  });

  return `/analytics/services/${slug}?${search.toString()}`;
}

function candidateRows(candidates: ServiceCandidate[]) {
  return limitRows(candidates, 10).map((candidate, index) => ({
    rank: index + 1,
    serviceKey: candidate.serviceKey,
    serviceName: candidate.serviceName,
    serviceCategory: candidate.serviceCategory,
    completedBookingCount: candidate.completedBookingCount,
    revenue: candidate.revenue,
    lastActivityDate: candidate.lastActivityDate ?? "",
  }));
}

async function resolveServiceIdentity(input: AgentToolInput): Promise<ServiceIdentityResolution> {
  const checkedAt = nowIso();
  const explicit = input.entityContext?.entityType === "service" ? input.entityContext : undefined;
  const searchText = explicit?.serviceName ?? explicit?.displayName ?? extractExplicitServiceSearchText(input.request.message);
  const sources: GreatTimeAgentSource[] = [];

  if (!searchText) {
    return {
      status: "not_ready",
      searchText: "",
      sources,
      warnings: [
        {
          type: "missing_service_name",
          title: "Service name needed",
          message: "Ask about a named service or choose a service row first.",
        },
      ],
    };
  }

  try {
    const candidates = await resolveServicePortalCandidates({
      clinicCode: input.clinic.clinicCode,
      search: searchText,
      limit: 10,
    });
    sources.push(
      source({
        tool: "resolve_service_identity",
        sourceName: "BigQuery service identity candidates",
        checkedAt,
        dataStatus: candidates.length ? "ok" : "not_found",
        scope: "historical",
      }),
    );

    const resolution = resolveEntityCandidates({
      query: searchText,
      candidates: candidates.map((candidate) => ({
        id: candidate.serviceKey || serviceKey(candidate.serviceName),
        name: candidate.serviceName,
        aliases: [candidate.serviceCategory],
        value: candidate,
      })),
    });

    if (resolution.status === "ambiguous" || resolution.status === "suggestions") {
      return {
        status: "ambiguous",
        searchText,
        candidates: resolution.candidates.map((candidate) => candidate.value),
        sources,
      };
    }

    if (resolution.status === "resolved") {
      return {
        status: "resolved",
        candidate: resolution.candidate.value,
        sources,
      };
    }
  } catch {
    sources.push(
      source({
        tool: "resolve_service_identity",
        sourceName: "BigQuery service identity candidates",
        checkedAt,
        dataStatus: "unavailable",
        scope: "historical",
      }),
    );
  }

  return {
    status: "not_found",
    searchText,
    sources,
    warnings: [
      {
        type: "service_not_found",
        title: "Service not found",
        message: `No bounded service match was found for "${searchText}".`,
      },
    ],
  };
}

function formatMoney(value: number | undefined) {
  return value == null ? "unknown" : `${value.toLocaleString("en-US")} MMK`;
}

function buildServiceRecommendation(factPack: Service360FactPack, language?: Service360Language): Service360FactPack["recommendation"] {
  const myanmar = isMyanmarLanguage(language);
  const performance = factPack.performance;
  const topBundle = factPack.affinities.boughtTogether[0] as
    | { serviceName?: string; coPurchaseInvoiceCount?: number; invoiceSharePct?: number }
    | undefined;

  if ((performance.revenueGrowthPct <= -12 || performance.completedBookingGrowthPct <= -12) && performance.repeatRatePct <= 20) {
    return {
      title: myanmar ? "Service positioning နဲ့ retention ကို ပြန်စစ်ပါ" : "Review positioning and retention",
      reasonCodes: ["declining_performance", "weak_repeat_rate"],
      evidence: [
        `Revenue growth ${performance.revenueGrowthPct.toFixed(1)}%; completed booking growth ${performance.completedBookingGrowthPct.toFixed(1)}%.`,
        `Repeat customer rate ${performance.repeatRatePct.toFixed(1)}% across ${performance.customersServed.toLocaleString("en-US")} served customers.`,
      ],
    };
  }

  if (factPack.commercial.averageDiscountRate >= 18) {
    return {
      title: myanmar ? "Discount structure ကို စစ်ပါ" : "Audit the discount structure",
      reasonCodes: ["high_discount_rate"],
      evidence: [`Average discount rate is ${factPack.commercial.averageDiscountRate.toFixed(1)}%.`],
    };
  }

  if (factPack.therapists.topAttributedTherapistSharePct >= 60) {
    return {
      title: myanmar ? "Therapist readiness ကို ချဲ့ပါ" : "Broaden therapist readiness",
      reasonCodes: ["therapist_concentration"],
      evidence: [
        `${factPack.therapists.topAttributedTherapist ?? "Top therapist"} carries ${factPack.therapists.topAttributedTherapistSharePct.toFixed(
          1,
        )}% of attributed completed bookings.`,
      ],
    };
  }

  if (factPack.therapists.unattributedBookingSharePct >= 20) {
    return {
      title: myanmar ? "Practitioner attribution ကို ပိုသေချာထည့်ပါ" : "Improve practitioner attribution",
      reasonCodes: ["high_unattributed_share"],
      evidence: [
        `${factPack.therapists.unattributedBookingCount.toLocaleString("en-US")} completed bookings (${factPack.therapists.unattributedBookingSharePct.toFixed(
          1,
        )}%) are unattributed.`,
      ],
    };
  }

  if (topBundle?.serviceName && (topBundle.invoiceSharePct ?? 0) >= 10) {
    return {
      title: myanmar ? "Bundle / cross-sell opportunity ကို သုံးပါ" : "Use the bundle and cross-sell opportunity",
      reasonCodes: ["same_invoice_copurchase"],
      evidence: [
        `${topBundle.serviceName} appears with this service on ${(topBundle.coPurchaseInvoiceCount ?? 0).toLocaleString(
          "en-US",
        )} same-invoice purchase${topBundle.coPurchaseInvoiceCount === 1 ? "" : "s"} (${(topBundle.invoiceSharePct ?? 0).toFixed(1)}%).`,
      ],
    };
  }

  if (performance.revenueGrowthPct >= 18 || performance.completedBookingGrowthPct >= 18) {
    return {
      title: myanmar ? "Momentum ကို promotion နဲ့ capacity planning မှာ သုံးပါ" : "Lean into momentum with capacity planning",
      reasonCodes: ["strong_growth"],
      evidence: [
        `Revenue growth ${performance.revenueGrowthPct.toFixed(1)}%; completed booking growth ${performance.completedBookingGrowthPct.toFixed(1)}%.`,
      ],
    };
  }

  return {
    title: myanmar ? "Stable monitoring ဆက်လုပ်ပါ" : "Keep stable monitoring",
    reasonCodes: ["stable_service_profile"],
    evidence: [
      `${performance.completedBookingCount.toLocaleString("en-US")} completed bookings and ${performance.repeatRatePct.toFixed(1)}% repeat rate in the selected range.`,
    ],
  };
}

export function composeService360Summary(factPack: Service360FactPack, language?: Service360Language) {
  const service = factPack.identity.displayName;
  const period = `${factPack.identity.fromDate} to ${factPack.identity.toDate}`;

  if (isMyanmarLanguage(language)) {
    const lines = [
      `${service} Service 360`,
      `- Period: ${period}`,
      `- Revenue ${formatMoney(factPack.performance.revenue)}၊ completed bookings ${factPack.performance.completedBookingCount.toLocaleString(
        "en-US",
      )} ကြိမ်၊ served customers ${factPack.performance.customersServed.toLocaleString("en-US")} ယောက်။`,
      `- Repeat rate ${factPack.performance.repeatRatePct.toFixed(1)}%၊ revenue growth ${factPack.performance.revenueGrowthPct.toFixed(
        1,
      )}%၊ booking growth ${factPack.performance.completedBookingGrowthPct.toFixed(1)}%။`,
    ];

    if (factPack.therapists.topAttributedTherapist) {
      lines.push(
        `- Top therapist: ${factPack.therapists.topAttributedTherapist} (${factPack.therapists.topAttributedTherapistSharePct.toFixed(
          1,
        )}% of attributed completed bookings)။`,
      );
    }

    if (factPack.affinities.boughtTogether.length > 0) {
      const top = factPack.affinities.boughtTogether[0] as { serviceName?: string; coPurchaseInvoiceCount?: number };
      lines.push(`- Bought together: ${top.serviceName} (${(top.coPurchaseInvoiceCount ?? 0).toLocaleString("en-US")} invoices)။`);
    }

    if (factPack.recommendation) {
      lines.push(`အကြံပြုချက်: ${factPack.recommendation.title}။ ${factPack.recommendation.evidence[0] ?? ""}`);
    }

    return lines.join("\n");
  }

  const parts = [
    `${service} Service 360 covers ${period}.`,
    `Historical BigQuery data shows ${formatMoney(factPack.performance.revenue)} revenue, ${factPack.performance.completedBookingCount.toLocaleString(
      "en-US",
    )} completed bookings, and ${factPack.performance.customersServed.toLocaleString("en-US")} served customers.`,
    `Repeat customer rate is ${factPack.performance.repeatRatePct.toFixed(1)}%, with revenue growth ${factPack.performance.revenueGrowthPct.toFixed(
      1,
    )}% and completed booking growth ${factPack.performance.completedBookingGrowthPct.toFixed(1)}% versus the previous matching window.`,
  ];

  if (factPack.therapists.topAttributedTherapist) {
    parts.push(
      `${factPack.therapists.topAttributedTherapist} is the top attributed therapist at ${factPack.therapists.topAttributedTherapistSharePct.toFixed(
        1,
      )}% of attributed completed bookings.`,
    );
  }

  if (factPack.commercial.averageDiscountRate > 0) {
    parts.push(`Average discount rate is ${factPack.commercial.averageDiscountRate.toFixed(1)}%.`);
  }

  if (factPack.affinities.boughtTogether.length > 0) {
    const top = factPack.affinities.boughtTogether[0] as { serviceName?: string; coPurchaseInvoiceCount?: number };
    parts.push(
      `Top same-invoice co-purchase is ${top.serviceName} across ${(top.coPurchaseInvoiceCount ?? 0).toLocaleString("en-US")} invoice${
        top.coPurchaseInvoiceCount === 1 ? "" : "s"
      }.`,
    );
  }

  if (factPack.recommendation) {
    parts.push(`Recommended action: ${factPack.recommendation.title}.`);
  }

  return parts.join(" ");
}

function buildOverallStatus(sources: GreatTimeAgentSource[]) {
  if (sources.some((item) => item.dataStatus === "ok")) {
    return "ok" as const;
  }
  if (sources.some((item) => item.dataStatus === "unavailable")) {
    return "unavailable" as const;
  }
  return "no_activity" as const;
}

export async function buildService360ToolResult(input: AgentToolInput): Promise<AgentToolResult> {
  const resolved = await resolveServiceIdentity(input);

  if (resolved.status === "ambiguous") {
    const rows = candidateRows(resolved.candidates);

    return {
      toolName: "get_service_360",
      sourceName: "Service 360 identity resolver",
      checkedAt: nowIso(),
      period: input.period.label,
      dataStatus: "not_ready",
      live: false,
      sources: resolved.sources,
      summary: `I found multiple possible service matches for "${resolved.searchText}". Choose one before I build a Service 360 briefing.`,
      tables: [
        {
          title: "Possible service matches",
          columns: [
            { key: "rank", title: "#" },
            { key: "serviceName", title: "Service" },
            { key: "serviceCategory", title: "Category" },
            { key: "completedBookingCount", title: "Completed bookings" },
            { key: "revenue", title: "Revenue" },
            { key: "lastActivityDate", title: "Last activity" },
          ],
          rows,
        },
      ],
      warnings: [
        {
          type: "ambiguous_service_identity",
          title: "Please choose a service",
          message: "I found more than one service with that name. Please choose one.",
        },
      ],
      clarification: {
        type: "entity_selection",
        entityType: "service",
        query: resolved.searchText,
        optionCount: rows.length,
      },
      entityRefs: rows.map((row) => ({
        entityType: "service",
        entityId: String(row.serviceKey),
        displayName: String(row.serviceName),
        serviceName: String(row.serviceName),
        rank: Number(row.rank),
      })),
    };
  }

  if (resolved.status !== "resolved") {
    return {
      toolName: "get_service_360",
      sourceName: "Service 360 identity resolver",
      checkedAt: nowIso(),
      period: input.period.label,
      dataStatus: resolved.status,
      live: false,
      sources: resolved.sources,
      summary: resolved.warnings[0]?.message ?? "Service identity could not be resolved.",
      warnings: resolved.warnings,
    };
  }

  const overview = await getServicePortalOverview({
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    serviceName: resolved.candidate.serviceName,
  });
  const sources = [
    ...resolved.sources,
    source({
      tool: "get_service_360_fact_pack",
      sourceName: "BigQuery service portal",
      period: `${input.period.fromDate} to ${input.period.toDate}`,
      dataStatus: overview.service.completedBookingCount > 0 || overview.service.totalRevenue > 0 ? "ok" : "no_activity",
      scope: "historical",
    }),
  ];
  const selectedYear =
    input.period.fromDate.slice(0, 4) === input.period.toDate.slice(0, 4) ? Number(input.period.toDate.slice(0, 4)) : undefined;
  const topCustomers = overview.topCustomers.map((row) => ({
    customerName: row.customerName,
    customerPhoneMasked: maskPhone(row.phoneNumber),
    memberId: row.memberId,
    revenue: row.totalRevenue,
    completedVisits: row.visitCount,
    lastVisitDate: row.lastVisitDate,
    relationship: row.relationship,
    rank: row.rank,
  }));
  const factPack: Service360FactPack = {
    identity: {
      serviceKey: serviceKey(overview.service.serviceName),
      displayName: overview.service.serviceName,
      category: overview.service.serviceCategory,
      detailPath: serviceDetailPath({
        serviceName: overview.service.serviceName,
        fromDate: input.period.fromDate,
        toDate: input.period.toDate,
      }),
      fromDate: input.period.fromDate,
      toDate: input.period.toDate,
      selectedYear,
      lastCompletedAt: overview.service.lastBookedDate,
    },
    performance: {
      revenue: overview.service.totalRevenue,
      paidLineCount: parseNumber(overview.service.paidLineCount),
      invoiceCount: parseNumber(overview.service.invoiceCount),
      completedBookingCount: parseNumber(overview.service.completedBookingCount ?? overview.service.bookingCount),
      customersServed: parseNumber(overview.service.customersServed ?? overview.service.customerCount),
      payingCustomers: parseNumber(overview.service.payingCustomers),
      customersTouched: parseNumber(overview.service.customersTouched ?? overview.service.customerCount),
      repeatCustomerCount: parseNumber(overview.service.repeatCustomerCount),
      repeatRatePct: parseNumber(overview.service.repeatRatePct ?? overview.service.repeatPurchaseRate),
      averageSellingPrice: overview.service.averageSellingPrice,
      revenuePerCustomer: overview.service.revenuePerCustomer,
      revenueGrowthPct: parseNumber(overview.service.revenueGrowthPct ?? overview.service.growthRate),
      completedBookingGrowthPct: parseNumber(overview.service.completedBookingGrowthPct ?? overview.service.growthRate),
    },
    demandPattern: {
      trend: limitRows(overview.trend, 12),
      peakWeekdays: overview.peakPeriods.weekdays,
      peakHours: overview.peakPeriods.hours,
    },
    therapists: {
      topAttributedTherapist: overview.service.topAttributedTherapist ?? overview.service.topTherapist,
      topAttributedTherapistSharePct: parseNumber(overview.service.topAttributedTherapistSharePct ?? overview.service.topTherapistShare),
      unattributedBookingCount: parseNumber(overview.service.unattributedBookingCount),
      unattributedBookingSharePct: parseNumber(overview.service.unattributedBookingSharePct),
      performanceRows: limitRows(overview.therapistPerformance, 8),
    },
    customers: {
      topRows: topCustomers,
    },
    affinities: {
      boughtTogether: limitRows(overview.boughtTogether ?? [], 8),
      alsoUsedBySameCustomers: limitRows(overview.relatedServices, 8),
    },
    commercial: {
      packageMixPct: overview.service.packageMixPct,
      oneOffMixPct: overview.service.oneOffMixPct,
      averageDiscountRate: overview.service.averageDiscountRate,
      paymentMethodMix: limitRows(overview.paymentMix, 8),
      packageBalanceStatus: "partial",
    },
    dataQuality: [
      {
        code: "completed_history_not_live_schedule",
        severity: "info",
        message: "Completed booking metrics come from historical BigQuery treatment rows, not APICORE live/upcoming appointment state.",
      },
      {
        code: "package_balance_not_reported",
        severity: "info",
        message: "Service-level remaining package balance is not shown as an exact total because visit rows can repeat balance snapshots.",
      },
    ],
    sources,
  };
  factPack.recommendation = buildServiceRecommendation(factPack, input.request.aiLanguage);

  const summary = composeService360Summary(factPack, input.request.aiLanguage);

  return {
    toolName: "get_service_360",
    sourceName: "Service 360 fact pack",
    checkedAt: nowIso(),
    period: `${input.period.fromDate} to ${input.period.toDate}`,
    dataStatus: buildOverallStatus(sources),
    live: false,
    sources,
    summary,
    service360: factPack,
    metrics: [
      { label: "Revenue", value: factPack.performance.revenue, unit: "amount" },
      { label: "Completed bookings", value: factPack.performance.completedBookingCount },
      { label: "Customers served", value: factPack.performance.customersServed },
      { label: "Repeat rate", value: factPack.performance.repeatRatePct, unit: "%" },
    ],
    tables: [
      {
        title: "Service 360 therapist performance",
        columns: [
          { key: "therapistName", title: "Therapist" },
          { key: "bookingCount", title: "Completed bookings" },
          { key: "customerCount", title: "Customers" },
          { key: "revenue", title: "Value proxy" },
          { key: "latestVisitDate", title: "Latest visit" },
        ],
        rows: factPack.therapists.performanceRows,
      },
      {
        title: "Service 360 top customers",
        columns: [
          { key: "customerName", title: "Customer" },
          { key: "customerPhoneMasked", title: "Phone" },
          { key: "revenue", title: "Revenue" },
          { key: "completedVisits", title: "Completed visits" },
          { key: "lastVisitDate", title: "Last visit" },
          { key: "relationship", title: "Relationship" },
        ],
        rows: factPack.customers.topRows,
      },
      {
        title: "Service 360 bought together",
        columns: [
          { key: "serviceName", title: "Service" },
          { key: "serviceCategory", title: "Category" },
          { key: "coPurchaseInvoiceCount", title: "Same-invoice purchases" },
          { key: "sharedCustomerCount", title: "Customers" },
          { key: "invoiceSharePct", title: "Invoice share %" },
        ],
        rows: factPack.affinities.boughtTogether,
      },
    ].filter((table) => table.rows.length > 0),
    recommendations: factPack.recommendation
      ? [
          {
            recommendationType: "service_360_next_action",
            title: factPack.recommendation.title,
            message: factPack.recommendation.evidence.join(" "),
            sourceTools: factPack.sources.map((item) => item.tool),
          },
        ]
      : undefined,
    entityRefs: [
      {
        entityType: "service",
        entityId: factPack.identity.serviceKey,
        displayName: factPack.identity.displayName,
        serviceName: factPack.identity.displayName,
        rank: 1,
      },
    ],
  };
}
