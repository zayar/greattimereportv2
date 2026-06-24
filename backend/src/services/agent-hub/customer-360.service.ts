import {
  getCustomerPortalAgentVisitSnapshot,
  resolveCustomerPortalCandidates,
} from "../reports/customer-portal.service.js";
import {
  searchCustomerRelationshipProfilesBounded,
  type CustomerRelationshipProfileSearchInput,
} from "../reports/customer-relationship-profile.repository.js";
import { extractExplicitCustomerSearchText } from "./customer-query.js";
import { limitRows, maskPhone, nowIso, sanitizeError } from "./safety.js";
import type {
  AgentDataStatus,
  AgentSourceScope,
  AgentToolInput,
  AgentToolResult,
  Customer360FactPack,
  Customer360PackageStatus,
  GreatTimeAgentSource,
  GreatTimeAgentWarning,
} from "./types.js";

type Customer360Language = AgentToolInput["request"]["aiLanguage"];

type ResolvedCustomerIdentity = {
  customerKey: string;
  customerName: string;
  customerPhone: string;
  phoneMasked: string;
  memberId?: string;
  joinedDate?: string | null;
  sourceScope: AgentSourceScope;
};

type CandidateRow = {
  customerKey: string;
  customerName: string;
  phoneNumber?: string;
  phoneMasked?: string;
  memberId?: string | null;
  joinedDate?: string | null;
  lastVisitDate?: string | null;
  totalVisits?: number;
  lifetimeSpend?: number;
};

type IdentityResolution =
  | { status: "resolved"; identity: ResolvedCustomerIdentity; sources: GreatTimeAgentSource[] }
  | { status: "ambiguous"; searchText: string; candidates: CandidateRow[]; sources: GreatTimeAgentSource[] }
  | { status: "not_found" | "not_ready" | "unavailable"; searchText: string; sources: GreatTimeAgentSource[]; warnings: GreatTimeAgentWarning[] };

function withSectionTimeout<T>(promise: Promise<T>, sectionName: string, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${sectionName} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    }),
  ]);
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
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

function isMyanmarLanguage(language: Customer360Language) {
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

function customerDetailPath(params: {
  customerName: string;
  customerPhone: string;
  fromDate: string;
  toDate: string;
}) {
  const slug =
    params.customerName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "customer";
  const search = new URLSearchParams({
    name: params.customerName,
    phone: params.customerPhone,
    fromDate: params.fromDate,
    toDate: params.toDate,
  });

  return `/analytics/customers/${slug}?${search.toString()}`;
}

function isExactCandidate(searchText: string, candidate: CandidateRow) {
  const search = normalizeText(searchText);
  const searchDigits = normalizeDigits(searchText);
  const phoneDigits = normalizeDigits(candidate.phoneNumber);

  return (
    (search && normalizeText(candidate.customerName) === search) ||
    (search && normalizeText(candidate.memberId ?? "") === search) ||
    (searchDigits && phoneDigits && searchDigits === phoneDigits)
  );
}

function candidateRows(candidates: CandidateRow[]) {
  return limitRows(candidates, 10).map((candidate, index) => ({
    rank: index + 1,
    customerKey: candidate.customerKey,
    customerName: candidate.customerName,
    customerPhoneMasked: candidate.phoneMasked ?? maskPhone(candidate.phoneNumber),
    memberId: candidate.memberId ?? "",
    lastVisitDate: candidate.lastVisitDate ?? "",
    totalVisits: candidate.totalVisits ?? "",
  }));
}

async function searchLearnedProfiles(input: CustomerRelationshipProfileSearchInput) {
  return searchCustomerRelationshipProfilesBounded({
    ...input,
    limit: Math.min(Math.max(input.limit ?? 25, 1), 50),
    offset: 0,
    sortBy: input.sortBy ?? "lastVisitDate",
    sortDirection: input.sortDirection ?? "desc",
  });
}

async function resolveCustomerIdentity(input: AgentToolInput): Promise<IdentityResolution> {
  const checkedAt = nowIso();
  const explicit = input.entityContext?.entityType === "customer" ? input.entityContext : undefined;
  const searchText =
    explicit?.memberId ??
    explicit?.customerPhone ??
    explicit?.customerName ??
    explicit?.displayName ??
    extractExplicitCustomerSearchText(input.request.message);
  const sources: GreatTimeAgentSource[] = [];

  if (!searchText) {
    return {
      status: "not_ready",
      searchText: "",
      sources,
      warnings: [
        {
          type: "missing_customer_name",
          title: "Customer name needed",
          message: "Ask about a named customer or choose a customer row first.",
        },
      ],
    };
  }

  try {
    const candidates = await resolveCustomerPortalCandidates({
      clinicCode: input.clinic.clinicCode,
      search: searchText,
      limit: 10,
    });
    sources.push(
      source({
        tool: "resolve_customer_identity",
        sourceName: "BigQuery customer identity candidates",
        checkedAt,
        dataStatus: candidates.length ? "ok" : "not_found",
        scope: "historical",
      }),
    );

    const exactCandidates = candidates.filter((candidate) => isExactCandidate(searchText, candidate));
    const selected = exactCandidates.length === 1 ? exactCandidates[0] : candidates.length === 1 ? candidates[0] : null;

    if (exactCandidates.length > 1 || (!selected && candidates.length > 1)) {
      return {
        status: "ambiguous",
        searchText,
        candidates,
        sources,
      };
    }

    if (selected) {
      return {
        status: "resolved",
        identity: {
          customerKey: selected.customerKey,
          customerName: selected.customerName,
          customerPhone: selected.phoneNumber ?? "",
          phoneMasked: selected.phoneMasked ?? maskPhone(selected.phoneNumber),
          memberId: selected.memberId ?? undefined,
          joinedDate: selected.joinedDate,
          sourceScope: "historical",
        },
        sources,
      };
    }
  } catch (error) {
    sources.push(
      source({
        tool: "resolve_customer_identity",
        sourceName: "BigQuery customer identity candidates",
        checkedAt,
        dataStatus: "unavailable",
        scope: "historical",
      }),
    );
  }

  try {
    const learned = await searchLearnedProfiles({
      clinicId: input.clinic.clinicId,
      search: searchText,
      limit: 25,
    });
    const candidates = learned.rows.map((profile) => ({
      customerKey: profile.customerKey,
      customerName: profile.customerName,
      phoneMasked: profile.customerPhoneMasked,
      memberId: profile.memberId,
      joinedDate: profile.firstSeenDate,
      lastVisitDate: profile.lastVisitDate,
      totalVisits: profile.totalVisits,
      lifetimeSpend: profile.lifetimeSpend,
    }));
    sources.push(
      source({
        tool: "resolve_customer_identity_from_learned_profile",
        sourceName: "Firestore customer relationship profiles",
        dataStatus: candidates.length ? "ok" : "not_found",
        scope: "learned",
      }),
    );

    const exactCandidates = candidates.filter((candidate) => isExactCandidate(searchText, candidate));
    const selected = exactCandidates.length === 1 ? exactCandidates[0] : candidates.length === 1 ? candidates[0] : null;

    if (exactCandidates.length > 1 || (!selected && candidates.length > 1)) {
      return {
        status: "ambiguous",
        searchText,
        candidates,
        sources,
      };
    }

    if (selected) {
      return {
        status: "resolved",
        identity: {
          customerKey: selected.customerKey,
          customerName: selected.customerName,
          customerPhone: "",
          phoneMasked: selected.phoneMasked ?? "",
          memberId: selected.memberId ?? undefined,
          joinedDate: selected.joinedDate,
          sourceScope: "learned",
        },
        sources,
      };
    }
  } catch (error) {
    sources.push(
      source({
        tool: "resolve_customer_identity_from_learned_profile",
        sourceName: "Firestore customer relationship profiles",
        dataStatus: "unavailable",
        scope: "learned",
      }),
    );
  }

  return {
    status: "not_found",
    searchText,
    sources,
    warnings: [
      {
        type: "customer_not_found",
        title: "Customer not found",
        message: `No bounded customer match was found for "${searchText}".`,
      },
    ],
  };
}

function momentum(recent?: number, previous?: number): Customer360FactPack["visitPattern"]["momentum"] {
  if (recent == null || previous == null || previous === 0) {
    return "unknown";
  }

  if (recent > previous * 1.1) {
    return "increasing";
  }

  if (recent < previous * 0.9) {
    return "declining";
  }

  return "stable";
}

function formatMoney(value: number | undefined) {
  return value == null ? "unknown" : `${value.toLocaleString("en-US")} MMK`;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function buildRecommendation(factPack: Customer360FactPack, language?: Customer360Language): Customer360FactPack["recommendation"] {
  const myanmar = isMyanmarLanguage(language);
  const remaining = factPack.packages.totalRemainingSessions ?? 0;
  const hasUpcoming = (factPack.appointments.upcoming?.length ?? 0) > 0 || (factPack.appointments.current?.length ?? 0) > 0;

  if (factPack.packages.dataStatus !== "not_ready" && remaining > 0 && !hasUpcoming) {
    return {
      title: myanmar ? "Package လက်ကျန်အတွက် follow-up လုပ်ပါ" : "Follow up on package balance",
      reasonCodes: ["unused_package_balance", "no_live_upcoming_booking"],
      evidence: [
        myanmar
          ? `Package session ${remaining.toLocaleString("en-US")} ခု ကျန်နေပါတယ်။`
          : `${remaining.toLocaleString("en-US")} remaining package session${remaining === 1 ? "" : "s"}`,
        myanmar
          ? "လက်ကျန်များတဲ့ service ကိုအခြေခံပြီး ပြန်လာမည့်ရက်ချိန်းအတွက် စကားစနိုင်ပါတယ်။"
          : "Use the highest-balance service as a natural rebooking conversation.",
      ],
    };
  }

  if (factPack.visitPattern.momentum === "declining") {
    return {
      title: myanmar ? "ပြန်လာဖို့ check-in လုပ်ပါ" : "Retention check-in",
      reasonCodes: ["declining_visit_frequency"],
      evidence: [
        myanmar
          ? `နောက်ဆုံး window တွင် visit ${factPack.visitPattern.recentWindowVisits ?? 0} ကြိမ်၊ ယခင် window တွင် ${
              factPack.visitPattern.previousWindowVisits ?? 0
            } ကြိမ်ရှိပါတယ်။`
          : `${factPack.visitPattern.recentWindowVisits ?? 0} recent-window visits versus ${
              factPack.visitPattern.previousWindowVisits ?? 0
            } in the previous comparison window.`,
      ],
    };
  }

  if ((factPack.latestActivity.daysSinceLastVisit ?? 0) > 45) {
    return {
      title: myanmar ? "Return visit အတွက် ဆက်သွယ်ပါ" : "Return-visit check-in",
      reasonCodes: ["inactive_visit_cadence"],
      evidence: [
        myanmar
          ? `နောက်ဆုံး visit ပြီးတာ ${factPack.latestActivity.daysSinceLastVisit} ရက်ရှိပါပြီ။`
          : `Last completed visit was ${factPack.latestActivity.daysSinceLastVisit} days ago.`,
      ],
    };
  }

  return {
    title: myanmar ? "ပုံမှန် care cadence ထိန်းထားပါ" : "Keep in regular care cadence",
    reasonCodes: ["steady_relationship"],
    evidence: [
      myanmar
        ? "အခုမြင်ရတဲ့ visit pattern အရ အရေးပေါ် risk ကြီးမားတာ မတွေ့ရသေးပါ။"
        : "No high-priority visit-frequency trigger is visible in the Customer 360 snapshot.",
    ],
  };
}

function packageHoldingSummary(row: Customer360FactPack["packages"]["holdings"][number], language?: Customer360Language) {
  const remaining = row.remainingSessions ?? 0;
  const total = row.totalSessions ?? 0;
  const latest = formatDate(row.latestUsageDate);
  const therapist = row.latestTherapist ? `, ${row.latestTherapist}` : "";

  if (isMyanmarLanguage(language)) {
    return `${row.serviceName} - ကျန် ${remaining.toLocaleString("en-US")}/${total.toLocaleString("en-US")}${
      latest ? `, နောက်ဆုံး ${latest}${therapist}` : therapist
    }`;
  }

  return `${row.serviceName} (${remaining.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} remaining${
    latest ? `, last used ${latest}${therapist}` : therapist
  })`;
}

function composeCustomer360MyanmarSummary(factPack: Customer360FactPack) {
  const name = factPack.identity.displayName;
  const year = factPack.usage.selectedYear;
  const visits = factPack.value.totalVisits;
  const lastVisit = formatDate(factPack.latestActivity.lastVisitAt);
  const packages = factPack.packages.holdings.filter((row) => (row.remainingSessions ?? 0) > 0).slice(0, 4);
  const remaining = factPack.packages.totalRemainingSessions ?? 0;
  const service = factPack.preferences.preferredService ?? factPack.latestActivity.lastService;
  const therapist = factPack.preferences.preferredTherapist ?? factPack.latestActivity.lastTherapist;
  const lines: string[] = [];

  lines.push(`${name} အကျဉ်းချုပ်`);

  if (visits != null) {
    lines.push(`- ${year ?? "ဒီနှစ်"} visit ${visits.toLocaleString("en-US")} ကြိမ်ရှိပါတယ်။`);
  }

  if (lastVisit) {
    lines.push(
      `- နောက်ဆုံးလာခဲ့တာ ${lastVisit}${factPack.latestActivity.lastService ? ` (${factPack.latestActivity.lastService})` : ""}${
        factPack.latestActivity.lastTherapist ? ` - ${factPack.latestActivity.lastTherapist}` : ""
      } ဖြစ်ပါတယ်။`,
    );
  }

  if (service || therapist) {
    lines.push(
      `- အဓိကစိတ်ဝင်စားတဲ့ service က ${service ?? "-"}${therapist ? `၊ therapist ဆက်ဆံရေးက ${therapist}` : ""} ဖြစ်ပါတယ်။`,
    );
  }

  if (packages.length > 0) {
    lines.push(`- Package/service လက်ကျန် ${packages.length} ခု၊ session စုစုပေါင်း ${remaining.toLocaleString("en-US")} ခု ကျန်နေပါတယ်။`);
    lines.push(`  ${packages.map((row) => packageHoldingSummary(row, "my-MM")).join(" | ")}`);
  } else if (factPack.packages.dataStatus === "no_activity") {
    lines.push("- Active package လက်ကျန် မတွေ့ပါ။");
  }

  if (factPack.visitPattern.momentum && factPack.visitPattern.momentum !== "unknown") {
    const trend = factPack.visitPattern.momentum === "declining" ? "လျော့နေ" : factPack.visitPattern.momentum === "increasing" ? "တက်နေ" : "တည်ငြိမ်";
    lines.push(
      `- Visit frequency က ${trend}ပါတယ် (${factPack.visitPattern.recentWindowVisits ?? 0} ကြိမ် vs ယခင် ${
        factPack.visitPattern.previousWindowVisits ?? 0
      } ကြိမ်)။`,
    );
  }

  if (factPack.recommendation) {
    lines.push(`အကြံပြုချက်: ${factPack.recommendation.title}။ ${factPack.recommendation.evidence[0] ?? ""}`.trim());
  }

  return lines.join("\n");
}

export function composeCustomer360Summary(factPack: Customer360FactPack, language?: Customer360Language) {
  if (isMyanmarLanguage(language)) {
    return composeCustomer360MyanmarSummary(factPack);
  }

  const name = factPack.identity.displayName;
  const sentences: string[] = [];
  const joined = formatDate(factPack.identity.joinedDate);
  const visits = factPack.value.totalVisits;
  const spend = factPack.value.lifetimeSpend;
  const lastVisit = formatDate(factPack.latestActivity.lastVisitAt);
  const packageRemaining = factPack.packages.totalRemainingSessions;
  const currentCount = factPack.appointments.current?.length ?? 0;
  const upcomingCount = factPack.appointments.upcoming?.length ?? 0;
  const appointmentSourceChecked = factPack.sources.some((item) => item.tool === "get_customer_live_appointments");

  sentences.push(joined ? `${name} joined on ${joined}.` : `${name} is the resolved customer for this Customer 360 briefing.`);

  if (visits != null) {
    const year = factPack.usage.selectedYear;
    sentences.push(
      `${name} has completed ${visits.toLocaleString("en-US")} visit${visits === 1 ? "" : "s"}${year ? ` in ${year}` : ""}.`,
    );
  }

  if (spend != null) {
    sentences.push(`${name} has ${formatMoney(spend)} in lifetime spend.`);
  }

  if (lastVisit) {
    const detail = [
      `latest completed visit was ${lastVisit}`,
      factPack.latestActivity.lastService ? `for ${factPack.latestActivity.lastService}` : "",
      factPack.latestActivity.lastTherapist ? `with ${factPack.latestActivity.lastTherapist}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    sentences.push(`The ${detail}.`);
  }

  if (factPack.preferences.preferredService || factPack.preferences.preferredTherapist) {
    sentences.push(
      [
        factPack.preferences.preferredService ? `Most-used service is ${factPack.preferences.preferredService}` : "",
        factPack.preferences.preferredTherapist ? `preferred therapist is ${factPack.preferences.preferredTherapist}` : "",
      ]
        .filter(Boolean)
        .join(", ") + ".",
    );
  }

  if (factPack.packages.holdings.length > 0) {
    const activeHoldings = factPack.packages.holdings.filter((row) => (row.remainingSessions ?? 0) > 0);
    const topHoldings = activeHoldings.slice(0, 3).map((row) => packageHoldingSummary(row)).join("; ");
    sentences.push(
      `Purchased package services show ${activeHoldings.length.toLocaleString("en-US")} active holding${
        activeHoldings.length === 1 ? "" : "s"
      } with ${(packageRemaining ?? 0).toLocaleString("en-US")} remaining session${
        packageRemaining === 1 ? "" : "s"
      }${topHoldings ? `: ${topHoldings}.` : "."}`,
    );
  } else if (factPack.packages.dataStatus === "unavailable" || factPack.packages.dataStatus === "partial") {
    sentences.push("Package balances are not presented as an exact combined total because the package source is partial or unavailable.");
  }

  if (appointmentSourceChecked) {
    sentences.push(
      currentCount || upcomingCount
        ? `APICORE shows ${currentCount} current and ${upcomingCount} upcoming booking${upcomingCount === 1 ? "" : "s"} in the next 30 days.`
        : "APICORE shows no current or upcoming booking in the next 30 days.",
    );
  }

  if (factPack.visitPattern.momentum && factPack.visitPattern.momentum !== "unknown") {
    sentences.push(
      `Visit momentum is ${factPack.visitPattern.momentum}: ${factPack.visitPattern.recentWindowVisits ?? 0} visits versus ${
        factPack.visitPattern.previousWindowVisits ?? 0
      } in the previous comparison window.`,
    );
  }

  if (factPack.payments.invoiceCount != null) {
    sentences.push(
      `In the selected period, payments show ${factPack.payments.invoiceCount.toLocaleString("en-US")} invoice${
        factPack.payments.invoiceCount === 1 ? "" : "s"
      } totaling ${formatMoney(factPack.payments.selectedPeriodTotal)}.`,
    );
  }

  if (factPack.recommendation) {
    sentences.push(`Recommended action: ${factPack.recommendation.title}.`);
  }

  return sentences.join(" ");
}

function buildOverallStatus(statuses: AgentDataStatus[]) {
  if (statuses.some((status) => status === "ok") && statuses.some((status) => ["partial", "unavailable", "not_ready"].includes(status))) {
    return "partial" as const;
  }

  if (statuses.every((status) => status === "no_activity")) {
    return "no_activity" as const;
  }

  if (statuses.some((status) => status === "unavailable")) {
    return "unavailable" as const;
  }

  if (statuses.some((status) => status === "partial")) {
    return "partial" as const;
  }

  return statuses.some((status) => status === "ok") ? ("ok" as const) : ("not_ready" as const);
}

export async function buildCustomer360ToolResult(input: AgentToolInput): Promise<AgentToolResult> {
  const resolved = await resolveCustomerIdentity(input);

  if (resolved.status === "ambiguous") {
    return {
      toolName: "get_customer_360",
      sourceName: "Customer 360 identity resolver",
      checkedAt: nowIso(),
      period: input.period.label,
      dataStatus: "not_ready",
      live: false,
      sources: resolved.sources,
      summary: `I found multiple possible matches for "${resolved.searchText}". Choose one before I build a Customer 360 briefing.`,
      tables: [
        {
          title: "Possible customer matches",
          columns: [
            { key: "rank", title: "#" },
            { key: "customerName", title: "Customer" },
            { key: "customerPhoneMasked", title: "Phone" },
            { key: "memberId", title: "Member ID" },
            { key: "lastVisitDate", title: "Last visit" },
          ],
          rows: candidateRows(resolved.candidates),
        },
      ],
      warnings: [
        {
          type: "ambiguous_customer_identity",
          title: "Customer match is ambiguous",
          message: "Multiple customers matched this name. The agent will not silently choose between them.",
        },
      ],
      entityRefs: candidateRows(resolved.candidates).map((candidate) => ({
        entityType: "customer",
        entityId: String(candidate.customerKey),
        customerKey: String(candidate.customerKey),
        displayName: String(candidate.customerName),
        customerName: String(candidate.customerName),
        memberId: String(candidate.memberId || "") || undefined,
        rank: Number(candidate.rank),
      })),
    };
  }

  if (resolved.status !== "resolved") {
    return {
      toolName: "get_customer_360",
      sourceName: "Customer 360 identity resolver",
      checkedAt: nowIso(),
      period: input.period.label,
      dataStatus: resolved.status,
      live: false,
      sources: resolved.sources,
      summary: resolved.warnings[0]?.message ?? "Customer identity could not be resolved.",
      warnings: resolved.warnings,
    };
  }

  const identity = resolved.identity;
  const usageYear = new Date(`${input.period.toDate}T00:00:00.000Z`).getUTCFullYear();
  const identityParams = {
    customerName: identity.customerName,
    customerPhone: identity.customerPhone,
    memberId: identity.memberId,
  };
  const sources = [...resolved.sources];
  const dataQuality: Customer360FactPack["dataQuality"] = [];
  const warnings: GreatTimeAgentWarning[] = [];

  let snapshot: Awaited<ReturnType<typeof getCustomerPortalAgentVisitSnapshot>> | null = null;
  let snapshotError: unknown;
  try {
    snapshot = await withSectionTimeout(
      getCustomerPortalAgentVisitSnapshot({
        clinicCode: input.clinic.clinicCode,
        fromDate: `${usageYear}-01-01`,
        toDate: input.period.toDate,
        year: usageYear,
        ...identityParams,
      }),
      "Customer visit snapshot",
      8_000,
    );
  } catch (error) {
    snapshotError = error;
  }

  sources.push(
    source({
      tool: "get_customer_visit_snapshot",
      sourceName: "BigQuery customer visits",
      period: `${usageYear}-01-01 to ${input.period.toDate}`,
      dataStatus: snapshot ? (snapshot.customer.visitsThisYear > 0 ? "ok" : "no_activity") : "unavailable",
      scope: "historical",
    }),
  );
  if (!snapshot) {
    dataQuality.push({
      code: "visit_snapshot_unavailable",
      severity: "warning",
      message: `Customer visit snapshot could not be loaded: ${sanitizeError(snapshotError)}`,
    });
  }

  dataQuality.push(
    {
      code: "live_appointments_skipped_for_performance",
      severity: "info",
      message: "Live appointment checks are skipped in this lean Customer 360 path.",
    },
    {
      code: "lifetime_spend_skipped_for_performance",
      severity: "info",
      message: "Lifetime spend and payment invoices are skipped to avoid the expensive payment-view scan.",
    },
  );

  const snapshotCustomer = snapshot?.customer;
  const recentCompleted = snapshot?.recentCompleted ?? [];
  const packageHoldings = (snapshot?.packageHoldings ?? []).map((row, index) => {
    const remainingSessions = parseNumber(row.remainingCount);
    const totalSessions = parseNumber(row.packageTotal);

    return {
      packageId: `${parseText(row.serviceName, "package")}-${index}`,
      packageName: null,
      serviceName: parseText(row.serviceName, "Package service"),
      totalSessions,
      usedSessions: parseNumber(row.usedCount),
      remainingSessions,
      latestUsageDate: parseText(row.latestUsageDate) || null,
      latestTherapist: parseText(row.latestTherapist) || null,
      status: parseText(row.status, remainingSessions > 0 ? "active" : "completed") as Customer360PackageStatus,
    };
  });
  const activePackageHoldings = packageHoldings.filter((row) => (row.remainingSessions ?? 0) > 0);
  const totalRemainingSessions = packageHoldings.reduce((sum, row) => sum + Math.max(0, row.remainingSessions ?? 0), 0);
  const preferredTherapist = snapshotCustomer?.preferredTherapist ?? null;
  const phoneNumber = snapshotCustomer?.phoneNumber || identity.customerPhone;
  const customerName = snapshotCustomer?.customerName || identity.customerName;
  const factPack: Customer360FactPack = {
    identity: {
      customerKey: identity.customerKey,
      memberId: snapshotCustomer?.memberId || identity.memberId,
      displayName: customerName,
      joinedDate: identity.joinedDate ?? snapshotCustomer?.firstVisitThisYear ?? null,
      maskedPhone: phoneNumber ? maskPhone(phoneNumber) : identity.phoneMasked,
      detailPath: customerDetailPath({
        customerName,
        customerPhone: phoneNumber,
        fromDate: `${usageYear}-01-01`,
        toDate: input.period.toDate,
      }),
    },
    value: {
      totalVisits: snapshotCustomer?.visitsThisYear,
    },
    latestActivity: {
      lastVisitAt: snapshotCustomer?.lastVisitDate ?? null,
      lastService: snapshotCustomer?.lastService ?? null,
      lastTherapist: snapshotCustomer?.lastTherapist ?? preferredTherapist,
      daysSinceLastVisit: snapshotCustomer?.daysSinceLastVisit ?? null,
    },
    preferences: {
      preferredService: snapshotCustomer?.preferredService ?? null,
      preferredServiceCategory: snapshotCustomer?.preferredServiceCategory ?? null,
      preferredTherapist,
      preferredTherapistVisits: snapshotCustomer?.preferredTherapistVisits || undefined,
    },
    visitPattern: {
      averageVisitIntervalDays: snapshotCustomer?.avgVisitIntervalDays ?? null,
      recentWindowVisits: snapshotCustomer?.recent3MonthVisits,
      previousWindowVisits: snapshotCustomer?.previous3MonthVisits,
      momentum: momentum(snapshotCustomer?.recent3MonthVisits, snapshotCustomer?.previous3MonthVisits),
    },
    packages: {
      purchaseCount: packageHoldings.length,
      activeHoldingCount: activePackageHoldings.length,
      totalRemainingSessions,
      dataStatus: snapshot ? (packageHoldings.length ? "ok" : "no_activity") : "unavailable",
      holdings: packageHoldings,
    },
    appointments: {
      current: [],
      upcoming: [],
      recentCompleted: limitRows(recentCompleted, 8),
    },
    payments: {
      recentInvoices: [],
    },
    usage: {
      selectedYear: usageYear,
      distinctServices: snapshot?.topServices.length,
      topServices: limitRows(snapshot?.topServices ?? [], 8),
      monthlyServiceUsage: [],
    },
    dataQuality,
    sources,
  };
  factPack.recommendation = buildRecommendation(factPack, input.request.aiLanguage);

  for (const note of dataQuality.filter((item) => item.severity !== "info")) {
    warnings.push({
      type: note.code,
      title: note.severity === "blocking" ? "Customer 360 blocked" : "Customer 360 partial",
      message: note.message,
    });
  }

  const summary = composeCustomer360Summary(factPack, input.request.aiLanguage);
  const statuses = sources.map((item) => item.dataStatus);
  const dataStatus = buildOverallStatus(statuses);

  return {
    toolName: "get_customer_360",
    sourceName: "Customer 360 fact pack",
    checkedAt: nowIso(),
    period: `${usageYear}-01-01 to ${input.period.toDate}`,
    dataStatus,
    live: false,
    sources,
    summary,
    customer360: factPack,
    metrics: [
      { label: `${usageYear} visits`, value: factPack.value.totalVisits ?? 0 },
      { label: "Package remaining", value: factPack.packages.totalRemainingSessions ?? 0 },
      { label: "Recent treatments", value: factPack.appointments.recentCompleted?.length ?? 0 },
      { label: "Top services", value: factPack.usage.topServices.length },
    ],
    tables: [
      ...(factPack.packages.holdings.length
        ? [
            {
              title: "Customer 360 package holdings",
              columns: [
                { key: "serviceName", title: "Service" },
                { key: "totalSessions", title: "Package total" },
                { key: "usedSessions", title: "Used" },
                { key: "remainingSessions", title: "Remaining" },
                { key: "latestUsageDate", title: "Latest usage" },
                { key: "latestTherapist", title: "Therapist" },
              ],
              rows: factPack.packages.holdings,
            },
          ]
        : []),
      ...(factPack.appointments.recentCompleted?.length
        ? [
            {
              title: "Customer 360 recent completed visits",
              columns: [
                { key: "checkInTime", title: "Visit time" },
                { key: "serviceName", title: "Service" },
                { key: "therapistName", title: "Therapist" },
                { key: "status", title: "Status" },
              ],
              rows: factPack.appointments.recentCompleted,
            },
          ]
        : []),
    ],
    recommendations: factPack.recommendation
      ? [
          {
            recommendationType: "customer_360_next_action",
            targetCustomerKey: factPack.identity.customerKey,
            title: factPack.recommendation.title,
            message: factPack.recommendation.evidence.join(" "),
            sourceTools: factPack.sources.map((item) => item.tool),
          },
        ]
      : undefined,
    warnings: warnings.length ? warnings : undefined,
    entityRefs: [
      {
        entityType: "customer",
        entityId: factPack.identity.customerKey,
        customerKey: factPack.identity.customerKey,
        displayName: factPack.identity.displayName,
        customerName: factPack.identity.displayName,
        customerPhone: phoneNumber,
        memberId: factPack.identity.memberId,
        rank: 1,
      },
    ],
  };
}
