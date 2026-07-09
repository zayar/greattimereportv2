import { z } from "zod";
import { env } from "../../../config/env.js";
import {
  getCustomerPortalBookings,
  getCustomerPortalOverview,
  getCustomerPortalPackages,
  getCustomerPortalPayments,
  getCustomerQuickView,
  getCustomerPortalPriorityCustomers,
  getCustomerPortalTopCustomersByRevenue,
  resolveCustomerPortalPhonesByNames,
  getCustomerPortalUsage,
} from "../../reports/customer-portal.service.js";
import {
  getLatestCustomerRelationshipLearningRun,
  searchCustomerRelationshipProfilesBounded,
} from "../../reports/customer-relationship-profile.repository.js";
import { buildCustomer360ToolResult } from "../customer-360.service.js";
import { extractExplicitCustomerSearchText, extractLikelyCustomerSearchText } from "../customer-query.js";
import { limitRows, nowIso } from "../safety.js";
import type { AgentToolDefinition, AgentToolInput, AgentToolResult } from "../types.js";

const toolInputSchema = z.custom<AgentToolInput>(() => true);

function periodLabel(input: AgentToolInput) {
  return `${input.period.fromDate} to ${input.period.toDate}`;
}

function profilePlan(intent: string, message: string) {
  if (intent === "follow_up_today") {
    return { intent: "follow_up_today" as const, sortBy: "priorityScore" as const };
  }
  if (intent === "top_customers") {
    return { sortBy: "lifetimeSpend" as const };
  }
  if (intent === "top_customers_by_visits") {
    return { sortBy: "totalVisits" as const };
  }
  if (intent === "unactivated_purchase") {
    return { intent: "unactivated_purchase" as const, segment: "unactivated_purchase" as const, sortBy: "priorityScore" as const };
  }
  if (intent === "dormant_with_active_balance_90d") {
    return { intent: "dormant_with_active_balance_90d" as const, segment: "dormant_with_active_balance_90d" as const, sortBy: "priorityScore" as const };
  }
  if (intent === "lapsed_customer_90d") {
    return { intent: "lapsed_customer_90d" as const, segment: "lapsed_customer_90d" as const, sortBy: "priorityScore" as const };
  }
  if (intent === "reactivated_customer") {
    return { intent: "reactivated_customer" as const, segment: "reactivated_customer" as const, sortBy: "priorityScore" as const };
  }
  if (intent === "unused_package_balance") {
    return { segment: "unused_package_balance" as const, sortBy: "remainingPackageSessions" as const };
  }
  if (intent === "package_bought_never_came" || intent === "package_bought_never_used") {
    return {
      intent: "package_bought_never_came" as const,
      segment: env.CUSTOMER_RELATIONSHIP_DAILY_MEMORY_V2_ENABLED ? "unactivated_purchase" as const : "package_bought_never_came" as const,
      sortBy: "priorityScore" as const,
    };
  }
  if (intent === "package_bought_not_used") {
    return {
      intent: "package_bought_not_used" as const,
      segment: env.CUSTOMER_RELATIONSHIP_DAILY_MEMORY_V2_ENABLED ? "unactivated_purchase" as const : "package_bought_not_used" as const,
      sortBy: "priorityScore" as const,
    };
  }
  if (intent === "treatment_due") {
    return { segment: "treatment_due" as const, sortBy: "priorityScore" as const };
  }
  if (intent === "churn_risk") {
    return { riskLevel: "high" as const, sortBy: "priorityScore" as const };
  }

  const explicitSearch = extractLikelyCustomerSearchText(message);
  if (!explicitSearch) {
    return { sortBy: "priorityScore" as const };
  }

  const search = explicitSearch
    .replace(/customer|member|first|second|third/gi, "")
    .replace(/[?.!]+$/g, "")
    .trim();

  return { search, sortBy: "priorityScore" as const };
}

function isMyanmarLanguage(value: AgentToolInput["request"]["aiLanguage"]) {
  return value === "my-MM" || value === "my";
}

function shouldUseBigQueryPriorityFallback(input: AgentToolInput, matchedCount: number) {
  if (env.CUSTOMER_RELATIONSHIP_DAILY_MEMORY_V2_ENABLED) {
    return false;
  }

  if (matchedCount > 0) {
    return false;
  }

  if (input.intent === "customer_search") {
    return !extractExplicitCustomerSearchText(input.request.message);
  }

  return ["follow_up_today", "top_customers_by_visits"].includes(input.intent);
}

function ownerCustomerSummary(params: {
  count: number;
  intent: string;
  source: "learned" | "bigquery";
  language: AgentToolInput["request"]["aiLanguage"];
}) {
  const count = params.count.toLocaleString("en-US");

  if (isMyanmarLanguage(params.language)) {
    if (params.count === 0) {
      return "ဒီမေးခွန်းအတွက် customer match မတွေ့ပါ။";
    }

    if (params.intent === "package_bought_never_came" || params.intent === "package_bought_never_used") {
      return `Package ဝယ်ပြီးနောက် လာမသုံးသေးတဲ့ customer ${count} ယောက်ကို တွေ့ပါတယ်။`;
    }

    if (params.intent === "unactivated_purchase") {
      return `ဝယ်ထားပြီး မစသေးတဲ့ customer ${count} ယောက်ကို တွေ့ပါတယ်။`;
    }

    if (params.intent === "dormant_with_active_balance_90d") {
      return `Package လက်ကျန်ရှိပြီး 90 ရက်ကျော် မလာသေးတဲ့ customer ${count} ယောက်ကို တွေ့ပါတယ်။`;
    }

    if (params.intent === "lapsed_customer_90d") {
      return `နောက်ဆုံးလာပြီး 90 ရက်ကျော်တဲ့ customer ${count} ယောက်ကို တွေ့ပါတယ်။`;
    }

    if (params.intent === "package_bought_not_used") {
      return `Package ဝယ်ထားပြီး အသုံးမပြုသေးတဲ့ customer ${count} ယောက်ကို တွေ့ပါတယ်။`;
    }

    if (params.intent === "top_customers" || params.intent === "top_customers_by_revenue") {
      return `Spending အမြင့်ဆုံး customer ${count} ယောက်ကို paid sales data အရ တွေ့ပါတယ်။`;
    }

    if (params.intent === "top_customers_by_visits") {
      return `လာရောက်မှုအများဆုံး customer ${count} ယောက်ကို visit data အရ တွေ့ပါတယ်။`;
    }

    return `Follow-up လုပ်သင့်တဲ့ customer ${count} ယောက်ကို တွေ့ပါတယ်။`;
  }

  if (params.count === 0) {
    return "No customer matches were found for this question.";
  }

  if (params.intent === "package_bought_never_came" || params.intent === "package_bought_never_used") {
    return `${count} customer${params.count === 1 ? "" : "s"} bought a package and have no visit after that purchase.`;
  }

  if (params.intent === "unactivated_purchase") {
    return `${count} customer${params.count === 1 ? "" : "s"} bought a package or service but have not started using it.`;
  }

  if (params.intent === "dormant_with_active_balance_90d") {
    return `${count} dormant package customer${params.count === 1 ? "" : "s"} have confirmed remaining sessions and no matching usage for at least 90 days.`;
  }

  if (params.intent === "lapsed_customer_90d") {
    return `${count} lapsed customer${params.count === 1 ? "" : "s"} have not visited for at least 90 days and have no confirmed active balance.`;
  }

  if (params.intent === "package_bought_not_used") {
    return `${count} customer${params.count === 1 ? "" : "s"} bought a package and have no confirmed package usage.`;
  }

  if (params.intent === "top_customers" || params.intent === "top_customers_by_revenue") {
    return `${count} top customer${params.count === 1 ? "" : "s"} ranked by paid sales revenue.`;
  }

  if (params.intent === "top_customers_by_visits") {
    return `${count} top customer${params.count === 1 ? "" : "s"} ranked by visit count.`;
  }

  return `${count} customer${params.count === 1 ? "" : "s"} matched for follow-up review.`;
}

function fallbackActionFromRow(row: Awaited<ReturnType<typeof getCustomerPortalPriorityCustomers>>["rows"][number], language: AgentToolInput["request"]["aiLanguage"]) {
  if (!isMyanmarLanguage(language)) {
    return row.nextBestAction;
  }

  if (row.remainingPackageSessions > 0 && (row.daysSinceLastVisit ?? 0) >= 14) {
    return `Package session ${row.remainingPackageSessions.toLocaleString("en-US")} ခုကျန်နေပါတယ်။ နောက် session အတွက် ပြန်ချိန်းပေးပါ။`;
  }

  if ((row.daysSinceLastVisit ?? 0) >= 45) {
    return `နောက်ဆုံးလာခဲ့တာ ${row.daysSinceLastVisit} ရက်ရှိပါပြီ။ Return visit အတွက် ဆက်သွယ်ပါ။`;
  }

  if (row.recent90DayVisits < row.previous90DayVisits && row.previous90DayVisits > 0) {
    return "Visit frequency လျော့နေပါတယ်။ မကြာသေးခင် service ကိုအခြေခံပြီး ပြန်လာဖို့ recommend လုပ်ပါ။";
  }

  return "Relationship က active ဖြစ်ပါတယ်။ Regular care cadence ထဲ ဆက်ထားပါ။";
}

function latestLearningDataStatus(learnedAt: string | null | undefined, hasRows: boolean): AgentToolResult["dataStatus"] {
  if (!learnedAt) {
    return "not_ready";
  }

  const ageMs = Date.now() - new Date(learnedAt).getTime();
  if (!Number.isFinite(ageMs)) {
    return hasRows ? "partial" : "not_ready";
  }

  if (ageMs > 48 * 60 * 60_000) {
    return "stale";
  }

  return hasRows ? "ok" : "no_activity";
}

function normalizeLookupText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function phoneSuffix(value: string | null | undefined) {
  return (value ?? "").match(/(\d+)$/)?.[1] ?? "";
}

function phoneDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

type CustomerProfileToolRow = {
  customerKey: string;
  customerName: string;
  customerPhoneMasked: string;
  customerPhone?: string;
  memberId?: string | null;
  lastVisitDate?: string | null;
  daysSinceLastVisit?: number | null;
  remainingPackageSessions: number;
  lifetimeSpend?: number;
  totalVisits?: number;
  riskLevel?: string;
  segments?: string[];
  nextBestAction: string;
};

type CustomerPhoneCandidate = Awaited<ReturnType<typeof resolveCustomerPortalPhonesByNames>>[number];

function choosePhoneCandidate(profile: CustomerProfileToolRow, candidates: CustomerPhoneCandidate[]) {
  const memberId = normalizeLookupText(profile.memberId);
  if (memberId) {
    const memberMatch = candidates.find((candidate) => normalizeLookupText(candidate.memberId) === memberId);
    if (memberMatch) {
      return memberMatch;
    }
  }

  const suffix = phoneSuffix(profile.customerPhoneMasked);
  if (suffix) {
    const suffixMatches = candidates.filter((candidate) => phoneDigits(candidate.phoneNumber).endsWith(suffix));
    if (suffixMatches.length === 1) {
      return suffixMatches[0];
    }
  }

  return candidates.length === 1 ? candidates[0] : null;
}

async function attachFullCustomerPhones(input: AgentToolInput, rows: CustomerProfileToolRow[], usedFallback: boolean) {
  if (rows.length === 0) {
    return rows;
  }

  if (usedFallback) {
    return rows;
  }

  const candidates = await resolveCustomerPortalPhonesByNames({
    clinicCode: input.clinic.clinicCode,
    customerNames: rows.map((row) => row.customerName),
    limit: Math.min(rows.length * 5, 100),
  }).catch(() => []);

  if (candidates.length === 0) {
    return rows;
  }

  const candidatesByName = new Map<string, CustomerPhoneCandidate[]>();
  candidates.forEach((candidate) => {
    const key = normalizeLookupText(candidate.customerName);
    candidatesByName.set(key, [...(candidatesByName.get(key) ?? []), candidate]);
  });

  return rows.map((row) => {
    const candidate = choosePhoneCandidate(row, candidatesByName.get(normalizeLookupText(row.customerName)) ?? []);
    return candidate?.phoneNumber ? { ...row, customerPhone: candidate.phoneNumber } : row;
  });
}

function selectLifecycleForTool(profile: Record<string, unknown>) {
  const lifecycles = Array.isArray(profile.packageLifecycles)
    ? profile.packageLifecycles as Array<Record<string, unknown>>
    : [];
  const primarySegment = typeof profile.primarySegment === "string" ? profile.primarySegment : "";
  const preferredStatus =
    primarySegment === "dormant_with_active_balance_90d"
      ? "activated"
      : primarySegment === "purchase_pending_activation"
        ? "purchase_pending_activation"
        : "unactivated_purchase";

  return (
    lifecycles.find((row) => row.activationStatus === preferredStatus) ??
    lifecycles.find((row) => row.balanceStatus === "confirmed" && Number(row.remainingSessions ?? 0) > 0) ??
    lifecycles[0] ??
    null
  );
}

async function searchCustomerProfiles(input: AgentToolInput): Promise<AgentToolResult> {
  const latestRun = await getLatestCustomerRelationshipLearningRun(input.clinic.clinicId);
  const plan = profilePlan(input.intent, input.request.message);
  const result = await searchCustomerRelationshipProfilesBounded({
    clinicId: input.clinic.clinicId,
    ...plan,
    sortDirection: "desc",
    limit: 25,
    offset: 0,
  });
  const fallback =
    shouldUseBigQueryPriorityFallback(input, result.rows.length)
      ? await getCustomerPortalPriorityCustomers({
          clinicCode: input.clinic.clinicCode,
          toDate: input.period.toDate,
          mode: input.intent === "top_customers_by_visits" ? "top_customers" : "follow_up",
          lookbackDays: latestRun?.sourceLookbackDays ?? 365,
          limit: 25,
        })
      : null;
  const fallbackRows = fallback?.rows ?? [];
  const learnedRows = result.rows;
  const usedFallback = fallback !== null;
  const hasFallback = fallbackRows.length > 0;
  const rawRows: CustomerProfileToolRow[] = hasFallback
    ? fallbackRows.map((row) => ({
        customerKey: row.customerKey,
        customerName: row.customerName,
        customerPhoneMasked: row.customerPhoneMasked,
        customerPhone: row.phoneNumber,
        memberId: row.memberId,
        lastVisitDate: row.lastVisitDate,
        daysSinceLastVisit: row.daysSinceLastVisit,
        remainingPackageSessions: row.remainingPackageSessions,
        lifetimeSpend: 0,
        totalVisits: row.totalVisits,
        riskLevel: row.riskLevel,
        segments: row.remainingPackageSessions > 0 ? ["unused_package_balance"] : [],
        nextBestAction: fallbackActionFromRow(row, input.request.aiLanguage),
      }))
    : learnedRows;
  const rows = await attachFullCustomerPhones(input, rawRows, usedFallback);
  const sourceName = usedFallback ? "Customer visit and package signals" : "Learned customer relationship memory";
  const dataStatus = usedFallback
    ? rows.length > 0 ? "ok" : "no_activity"
    : latestLearningDataStatus(latestRun?.learnedAt, rows.length > 0);
  const packageNeverCameIntent = input.intent === "package_bought_never_came" || input.intent === "package_bought_never_used";
  const packageNotUsedIntent = input.intent === "package_bought_not_used" || input.intent === "unactivated_purchase";
  const packageLifecycleIntent =
    packageNeverCameIntent ||
    packageNotUsedIntent ||
    input.intent === "dormant_with_active_balance_90d" ||
    input.intent === "lapsed_customer_90d";
  const profileColumns =
    packageLifecycleIntent
      ? [
          { key: "customerName", title: "Customer" },
          { key: "customerPhone", title: "Phone" },
          { key: "packageOrServiceName", title: "Package/service" },
          { key: "purchaseDate", title: "Purchase date" },
          { key: "lastMatchingUsageDate", title: "Usage date" },
          { key: "remainingSessionsDisplay", title: "Remaining" },
          { key: "daysInactive", title: "Days inactive" },
          { key: "segmentLabel", title: "Segment" },
          { key: "priorityScore", title: "Priority" },
          { key: "evidenceReason", title: "Evidence" },
          { key: "nextBestAction", title: "Next action" },
        ]
      : [
          { key: "customerName", title: "Customer" },
          { key: "customerPhone", title: "Phone" },
          { key: "lastVisitDate", title: "Last visit" },
          { key: "remainingPackageSessions", title: "Package balance" },
          { key: "riskLevel", title: "Risk" },
          { key: "nextBestAction", title: "Next action" },
        ];

  return {
    toolName: "search_customer_profiles",
    sourceName,
    checkedAt: nowIso(),
    period: usedFallback
      ? `lookback ${fallback?.lookbackDays ?? 365} days through ${input.period.toDate}`
      : latestRun?.learnedAt
        ? `learned at ${latestRun.learnedAt}`
        : periodLabel(input),
    dataStatus,
    live: false,
    summary: rows.length
      ? ownerCustomerSummary({
          count: rows.length,
          intent: input.intent,
          source: usedFallback ? "bigquery" : "learned",
          language: input.request.aiLanguage,
        })
      : latestRun || usedFallback
        ? ownerCustomerSummary({
            count: 0,
            intent: input.intent,
            source: usedFallback ? "bigquery" : "learned",
            language: input.request.aiLanguage,
          })
        : "Customer relationship learning has not run yet.",
    metrics: [
      { label: "Matched customers", value: rows.length },
      { label: "Source lookback days", value: usedFallback ? fallback?.lookbackDays ?? 365 : latestRun?.sourceLookbackDays ?? "not learned" },
    ],
    tables: [
      {
        title: "Customer relationship matches",
        columns: profileColumns,
        rows: rows.map((profile) => {
          const record = profile as Record<string, unknown>;
          const lifecycle = selectLifecycleForTool(record);
          const packageOrServiceName =
            typeof lifecycle?.packageName === "string" && lifecycle.packageName
              ? `${String(lifecycle.serviceName ?? "")} / ${lifecycle.packageName}`
              : String(lifecycle?.serviceName ?? ("lastPackageServiceName" in profile ? profile.lastPackageServiceName : "") ?? "");
          const remainingSessions = lifecycle?.remainingSessions;

          return {
            customerKey: profile.customerKey,
            customerName: profile.customerName,
            customerPhone: profile.customerPhone ?? profile.customerPhoneMasked,
            customerPhoneMasked: profile.customerPhoneMasked,
            lastVisitDate: profile.lastVisitDate,
            daysSinceLastVisit: profile.daysSinceLastVisit,
            packageOrServiceName: packageOrServiceName || null,
            purchaseDate: lifecycle?.purchaseDate ?? ("lastPackagePurchaseDate" in profile ? profile.lastPackagePurchaseDate : null),
            lastMatchingUsageDate: lifecycle?.lastMatchingUsageDate ?? null,
            firstMatchingUsageDate: lifecycle?.firstMatchingUsageDate ?? null,
            remainingSessionsDisplay:
              lifecycle?.balanceStatus === "confirmed" && remainingSessions != null
                ? Number(remainingSessions).toLocaleString("en-US")
                : "Unknown",
            daysInactive: lifecycle?.daysSinceMatchingUsage ?? profile.daysSinceLastVisit,
            segmentLabel:
              typeof record.primarySegment === "string"
                ? record.primarySegment.replace(/_/g, " ")
                : Array.isArray(profile.segments)
                  ? profile.segments[0]?.replace(/_/g, " ") ?? null
                  : null,
            evidenceReason: lifecycle?.evidenceReason ?? ("reasons" in profile && Array.isArray(profile.reasons) ? profile.reasons[0] : null),
            lastPackagePurchaseDate: "lastPackagePurchaseDate" in profile ? profile.lastPackagePurchaseDate : null,
            lastPackageServiceName: "lastPackageServiceName" in profile ? profile.lastPackageServiceName : null,
            lastPackageName: "lastPackageName" in profile ? profile.lastPackageName : null,
            packageBoughtNeverCame: "packageBoughtNeverCame" in profile ? profile.packageBoughtNeverCame : false,
            packageBoughtButNoUsage: "packageBoughtButNoUsage" in profile ? profile.packageBoughtButNoUsage : false,
            remainingPackageSessions: profile.remainingPackageSessions,
            lifetimeSpend: profile.lifetimeSpend,
            riskLevel: profile.riskLevel,
            segments: Array.isArray(profile.segments) ? profile.segments.join(", ") : "",
            priorityScore: "priorityScore" in profile ? profile.priorityScore : null,
            nextBestAction: profile.nextBestAction,
          };
        }),
      },
    ],
    recommendations: rows.slice(0, 3).map((profile) => ({
      title: profile.customerName,
      message: profile.nextBestAction,
      sourceTools: ["search_customer_profiles"],
    })),
    warnings:
      dataStatus === "stale"
        ? [
            {
              type: "learning_stale",
              title: "Customer learning is stale",
              message: "The latest completed customer relationship memory is more than 48 hours old. Use it as historical context only.",
            },
          ]
        : latestRun || usedFallback
          ? undefined
          : [
              {
                type: "learning_not_ready",
                title: "Customer learning not ready",
                message: "Run customer relationship learning before relying on profile segments.",
              },
            ],
    entityRefs: rows.map((profile, index) => ({
      entityType: "customer",
      entityId: profile.customerKey,
      customerKey: profile.customerKey,
      memberId: profile.memberId ?? undefined,
      displayName: profile.customerName,
      customerName: profile.customerName,
      customerPhone: profile.customerPhone,
      rank: index + 1,
    })),
  };
}

function topCustomersNoDataSummary(language: AgentToolInput["request"]["aiLanguage"]) {
  if (isMyanmarLanguage(language)) {
    return "ဒီကာလအတွက် paid customer spending data မတွေ့သေးပါ။ Appointment/treatment records မဟုတ်ဘဲ payment/sales data အပေါ်မူတည်ပြီး စစ်ထားပါတယ်။";
  }

  return "No paid customer spending data was found for this period. I checked payment/sales data, not appointment or treatment records.";
}

async function getTopCustomersByRevenue(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await getCustomerPortalTopCustomersByRevenue({
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    limit: 50,
  });
  const rows = limitRows(data.rows, 50);
  const tableRows = rows.map((row) => ({
    customerName: row.customerName,
    phoneNumber: row.phoneNumber,
    memberId: row.memberId,
    totalSpent: row.totalSpent,
    invoiceCount: row.invoiceCount,
    visitCount: row.visitCount,
    lastVisitDate: row.lastVisitDate,
    topServiceName: row.topServiceName,
    topPackageName: row.topPackageName,
    paymentMethods: row.paymentMethods,
    lastInvoiceDate: row.lastInvoiceDate,
  }));
  const totalSpent = rows.reduce((sum, row) => sum + row.totalSpent, 0);
  const invoiceCount = rows.reduce((sum, row) => sum + row.invoiceCount, 0);
  const summary = rows.length
    ? isMyanmarLanguage(input.request.aiLanguage)
      ? `Spending အမြင့်ဆုံး customer ${rows.length.toLocaleString("en-US")} ယောက်ကို paid sales data အရ တွေ့ပါတယ်။`
      : `${rows.length.toLocaleString("en-US")} top customer${rows.length === 1 ? "" : "s"} ranked by paid sales revenue.`
    : topCustomersNoDataSummary(input.request.aiLanguage);

  return {
    toolName: "get_top_customers_by_revenue",
    sourceName: "BigQuery paid sales and customer visit data",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: rows.length ? "ok" : "no_activity",
    live: false,
    summary,
    metrics: [
      { label: "Top customers", value: rows.length },
      { label: "Top customers total revenue", value: totalSpent, unit: "amount" },
      { label: "Invoice count", value: invoiceCount },
    ],
    tables: [
      {
        title: "Top customers by revenue",
        columns: [
          { key: "customerName", title: "Customer Name" },
          { key: "phoneNumber", title: "Phone", pii: "phone", exportable: true },
          { key: "memberId", title: "Member ID", pii: "id", exportable: true },
          { key: "totalSpent", title: "Total Spent", unit: "amount" },
          { key: "invoiceCount", title: "Invoice Count", unit: "count" },
          { key: "visitCount", title: "Visit Count", unit: "count" },
          { key: "lastVisitDate", title: "Last Visit" },
          { key: "topServiceName", title: "Top Service" },
          { key: "topPackageName", title: "Top Package" },
          { key: "paymentMethods", title: "Payment Methods" },
          { key: "lastInvoiceDate", title: "Last Invoice", exportable: false },
        ],
        rows: tableRows,
      },
    ],
    entityRefs: rows.map((row, index) => ({
      entityType: "customer",
      entityId: row.customerKey,
      customerKey: row.customerKey,
      memberId: row.memberId || undefined,
      displayName: row.customerName,
      customerName: row.customerName,
      customerPhone: row.phoneNumber || undefined,
      rank: index + 1,
    })),
  };
}

function customerIdentity(input: AgentToolInput) {
  const customerSearchText = extractExplicitCustomerSearchText(input.request.message);

  return {
    customerName: input.entityContext?.customerName ?? input.entityContext?.displayName ?? customerSearchText ?? "",
    customerPhone: input.entityContext?.customerPhone ?? "",
    memberId: input.entityContext?.memberId ?? "",
  };
}

function customerEntityRefFromIdentity(identity: ReturnType<typeof customerIdentity>) {
  const entityId = identity.memberId || identity.customerPhone || identity.customerName;

  return entityId
    ? [
        {
          entityType: "customer" as const,
          entityId,
          displayName: identity.customerName || identity.customerPhone || identity.memberId,
          customerName: identity.customerName || undefined,
          customerPhone: identity.customerPhone || undefined,
          memberId: identity.memberId || undefined,
          rank: 1,
        },
      ]
    : undefined;
}

function notReadyCustomerTool(toolName: string, input: AgentToolInput): AgentToolResult {
  return {
    toolName,
    sourceName: "BigQuery customer portal",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: "not_ready",
    live: false,
    warnings: [
      {
        type: "missing_customer_context",
        title: "Customer context needed",
        message: "Select a customer row or ask a follow-up such as 'tell me about the first customer'.",
      },
    ],
  };
}

async function getCustomerOverview(input: AgentToolInput): Promise<AgentToolResult> {
  const identity = customerIdentity(input);
  if (!identity.customerName && !identity.customerPhone && !identity.memberId) {
    return notReadyCustomerTool("get_customer_overview", input);
  }

  const [overview, quickView] = await Promise.all([
    getCustomerPortalOverview({
      clinicCode: input.clinic.clinicCode,
      fromDate: input.period.fromDate,
      toDate: input.period.toDate,
      ...identity,
    }),
    getCustomerQuickView({
      clinicCode: input.clinic.clinicCode,
      fromDate: input.period.fromDate,
      toDate: input.period.toDate,
      ...identity,
    }),
  ]);

  return {
    toolName: "get_customer_overview",
    sourceName: "BigQuery customer portal",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: "ok",
    live: false,
    summary: `${quickView.customer.customerName} has ${overview.customer.totalVisits.toLocaleString("en-US")} visits and ${overview.customer.lifetimeSpend.toLocaleString("en-US")} lifetime spend.`,
    metrics: [
      { label: "Total visits", value: overview.customer.totalVisits },
      { label: "Lifetime spend", value: overview.customer.lifetimeSpend, unit: "amount" },
      { label: "Active packages", value: quickView.packageSummary.activePackages },
      { label: "Low balance packages", value: quickView.packageSummary.lowBalancePackages },
    ],
    entityRefs: [
      {
        entityType: "customer",
        entityId: input.entityContext?.customerKey ?? quickView.customer.customerName,
        displayName: quickView.customer.customerName,
        customerName: quickView.customer.customerName,
        customerPhone: quickView.customer.phoneNumber,
        memberId: quickView.customer.memberId ?? undefined,
        rank: 1,
      },
    ],
  };
}

async function getCustomerPackages(input: AgentToolInput): Promise<AgentToolResult> {
  const identity = customerIdentity(input);
  if (!identity.customerName && !identity.customerPhone && !identity.memberId) {
    return notReadyCustomerTool("get_customer_packages", input);
  }

  const data = await getCustomerPortalPackages({
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    ...identity,
  });

  return {
    toolName: "get_customer_packages",
    sourceName: "BigQuery customer package portal",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: data.packages.length ? "ok" : "no_activity",
    live: false,
    tables: [
      {
        title: "Customer packages",
        columns: [
          { key: "serviceName", title: "Service" },
          { key: "packageName", title: "Package" },
          { key: "totalSessions", title: "Total" },
          { key: "usedSessions", title: "Used" },
          { key: "remainingSessions", title: "Remaining" },
          { key: "latestUsageDate", title: "Latest usage" },
        ],
        rows: limitRows(
          data.packages.map((row) => ({
            serviceName: row.serviceName,
            packageName: row.packageName,
            totalSessions: row.packageTotal,
            usedSessions: row.usedCount,
            remainingSessions: row.remainingCount,
            latestUsageDate: row.latestUsageDate,
            latestTherapist: row.latestTherapist,
          })),
          20,
        ),
      },
    ],
    entityRefs: customerEntityRefFromIdentity(identity),
  };
}

async function getCustomerBookings(input: AgentToolInput): Promise<AgentToolResult> {
  const identity = customerIdentity(input);
  if (!identity.customerName && !identity.customerPhone && !identity.memberId) {
    return notReadyCustomerTool("get_customer_bookings", input);
  }

  const data = await getCustomerPortalBookings({
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    ...identity,
    search: "",
    page: 1,
    pageSize: 20,
  });

  return {
    toolName: "get_customer_bookings",
    sourceName: "BigQuery customer booking portal",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: data.rows.length ? "ok" : "no_activity",
    live: false,
    tables: [
      {
        title: "Customer treatments and bookings",
        columns: [
          { key: "checkInTime", title: "Check-in" },
          { key: "serviceName", title: "Service" },
          { key: "therapistName", title: "Practitioner" },
          { key: "status", title: "Status" },
        ],
        rows: limitRows(data.rows, 20),
      },
    ],
    entityRefs: customerEntityRefFromIdentity(identity),
  };
}

async function getCustomerPayments(input: AgentToolInput): Promise<AgentToolResult> {
  const identity = customerIdentity(input);
  if (!identity.customerName && !identity.customerPhone && !identity.memberId) {
    return notReadyCustomerTool("get_customer_payments", input);
  }

  const data = await getCustomerPortalPayments({
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    ...identity,
    search: "",
    page: 1,
    pageSize: 20,
  });

  return {
    toolName: "get_customer_payments",
    sourceName: "BigQuery customer payment portal",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: data.rows.length ? "ok" : "no_activity",
    live: false,
    tables: [
      {
        title: "Customer recent purchases",
        columns: [
          { key: "dateLabel", title: "Date" },
          { key: "invoiceNumber", title: "Invoice" },
          { key: "serviceName", title: "Service" },
          { key: "paymentMethod", title: "Method" },
          { key: "netAmount", title: "Amount" },
        ],
        rows: limitRows(data.rows, 20),
      },
    ],
    entityRefs: customerEntityRefFromIdentity(identity),
  };
}

async function getCustomerUsage(input: AgentToolInput): Promise<AgentToolResult> {
  const identity = customerIdentity(input);
  if (!identity.customerName && !identity.customerPhone && !identity.memberId) {
    return notReadyCustomerTool("get_customer_usage", input);
  }

  const data = await getCustomerPortalUsage({
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    ...identity,
    year: new Date(`${input.period.toDate}T00:00:00.000Z`).getUTCFullYear(),
    serviceCategory: "",
  });

  return {
    toolName: "get_customer_usage",
    sourceName: "BigQuery customer usage portal",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: data.services.length ? "ok" : "no_activity",
    live: false,
    tables: [
      {
        title: "Customer usage",
        columns: [
          { key: "serviceName", title: "Service" },
          { key: "serviceCategory", title: "Category" },
          { key: "totalUsage", title: "Usage" },
        ],
        rows: limitRows(data.services, 20),
      },
    ],
    entityRefs: customerEntityRefFromIdentity(identity),
  };
}

export function createCustomerTools(): AgentToolDefinition[] {
  const tools: AgentToolDefinition[] = [
    {
      name: "get_customer_360",
      agentId: "customer_relationship",
      description: "Build a source-grounded Customer 360 fact pack from identity, historical, live, package, payment, and usage sources.",
      inputSchema: toolInputSchema,
      sourceName: "Customer 360 fact pack",
      live: true,
      maxRows: 50,
      timeoutMs: 30_000,
      execute: buildCustomer360ToolResult,
    },
    {
      name: "search_customer_profiles",
      agentId: "customer_relationship",
      description: "Search bounded learned customer relationship profiles.",
      inputSchema: toolInputSchema,
      sourceName: "Firestore customer relationship profiles",
      live: false,
      maxRows: 25,
      timeoutMs: 10_000,
      execute: searchCustomerProfiles,
    },
    {
      name: "get_top_customers_by_revenue",
      agentId: "customer_relationship",
      description: "Get top customers ranked by total spending/revenue for the selected period.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery paid sales and customer visit data",
      live: false,
      maxRows: 50,
      timeoutMs: 20_000,
      execute: getTopCustomersByRevenue,
    },
    {
      name: "get_customer_overview",
      agentId: "customer_relationship",
      description: "Get customer overview and quick view.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery customer portal",
      live: false,
      maxRows: 20,
      timeoutMs: 15_000,
      execute: getCustomerOverview,
    },
    {
      name: "get_customer_quick_view",
      agentId: "customer_relationship",
      description: "Get customer quick view.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery customer portal",
      live: false,
      maxRows: 20,
      timeoutMs: 15_000,
      execute: getCustomerOverview,
    },
    {
      name: "get_customer_packages",
      agentId: "customer_relationship",
      description: "Get customer packages.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery customer package portal",
      live: false,
      maxRows: 20,
      timeoutMs: 15_000,
      execute: getCustomerPackages,
    },
    {
      name: "get_customer_bookings",
      agentId: "customer_relationship",
      description: "Get customer bookings and treatment history.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery customer booking portal",
      live: false,
      maxRows: 20,
      timeoutMs: 15_000,
      execute: getCustomerBookings,
    },
    {
      name: "get_customer_payments",
      agentId: "customer_relationship",
      description: "Get customer payments and purchases.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery customer payment portal",
      live: false,
      maxRows: 20,
      timeoutMs: 15_000,
      execute: getCustomerPayments,
    },
    {
      name: "get_customer_usage",
      agentId: "customer_relationship",
      description: "Get customer usage history.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery customer usage portal",
      live: false,
      maxRows: 20,
      timeoutMs: 15_000,
      execute: getCustomerUsage,
    },
    {
      name: "get_customer_treatment_history",
      agentId: "customer_relationship",
      description: "Get customer treatment history.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery customer booking portal",
      live: false,
      maxRows: 20,
      timeoutMs: 15_000,
      execute: getCustomerBookings,
    },
    {
      name: "get_follow_up_candidates",
      agentId: "customer_relationship",
      description: "Get follow-up candidates from learned profiles.",
      inputSchema: toolInputSchema,
      sourceName: "Firestore customer relationship profiles",
      live: false,
      maxRows: 25,
      timeoutMs: 10_000,
      execute: searchCustomerProfiles,
    },
  ];

  return tools.map((tool) => ({ ...tool, capability: "read_only" }));
}
