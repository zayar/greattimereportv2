import {
  fetchApicoreBookingDetails,
  type ApicoreBookingDetailsRow,
} from "../apicore.service.js";
import {
  getCustomerPortalBookings,
  getCustomerPortalOverview,
  getCustomerPortalPayments,
  getCustomerPortalUsage,
  resolveCustomerPortalCandidates,
} from "../reports/customer-portal.service.js";
import { getPackagePortalCustomerHoldings } from "../reports/package-portal.service.js";
import {
  searchCustomerRelationshipProfilesBounded,
  type CustomerRelationshipProfileSearchInput,
} from "../reports/customer-relationship-profile.repository.js";
import { buildUtcDayRangeForDateKeyInTimeZone } from "../telegram/time.js";
import { normalizeAppointmentLifecycle } from "./appointment-lifecycle.js";
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

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function dateFromUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateFromUtc(date);
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

function matchesCustomer(row: ApicoreBookingDetailsRow, identity: ResolvedCustomerIdentity) {
  const identityDigits = normalizeDigits(identity.customerPhone);
  const rowDigits = normalizeDigits(row.MemberPhoneNumber);

  if (identityDigits && rowDigits) {
    return identityDigits === rowDigits;
  }

  return normalizeText(row.MemberName) === normalizeText(identity.customerName);
}

async function fetchLiveCustomerAppointments(input: AgentToolInput, identity: ResolvedCustomerIdentity) {
  const timezone = input.request.timezone ?? "";
  const startDateKey = input.period.toDate;
  const endDateKey = addDays(startDateKey, 30);
  const startRange = buildUtcDayRangeForDateKeyInTimeZone(startDateKey, timezone);
  const endRange = buildUtcDayRangeForDateKeyInTimeZone(endDateKey, timezone);
  const checkedAt = nowIso();
  const result = await fetchApicoreBookingDetails({
    clinicCode: input.clinic.clinicCode,
    startDate: startRange.startIso,
    endDate: endRange.endIso,
    take: 200,
    authorizationHeader: input.requestContext.authorizationHeader,
  });
  const now = Date.now();
  const rows = result.data
    .filter(
      (row) =>
        row.ClinicID === input.clinic.clinicId &&
        row.ClinicCode.toLowerCase() === input.clinic.clinicCode.toLowerCase() &&
        matchesCustomer(row, identity),
    )
    .map((row) => {
      const lifecycle = normalizeAppointmentLifecycle({ rawStatus: row.status });

      return {
        appointmentId: row.bookingid,
        scheduledFrom: row.FromTime,
        scheduledTo: row.ToTime,
        customerName: row.MemberName,
        customerPhoneMasked: maskPhone(row.MemberPhoneNumber),
        serviceName: row.ServiceName,
        practitionerName: row.PractitionerName,
        rawStatus: row.status,
        lifecycleState: lifecycle.state,
        stateConfidence: lifecycle.stateConfidence,
      };
    });
  const terminalStates = new Set(["checked_out", "cancelled", "no_show"]);
  const current = rows.filter((row) => {
    const from = new Date(String(row.scheduledFrom)).getTime();
    const to = new Date(String(row.scheduledTo)).getTime();

    return !terminalStates.has(String(row.lifecycleState)) && Number.isFinite(from) && from <= now && (!Number.isFinite(to) || to >= now);
  });
  const upcoming = rows.filter((row) => {
    const from = new Date(String(row.scheduledFrom)).getTime();

    return !terminalStates.has(String(row.lifecycleState)) && Number.isFinite(from) && from > now;
  });

  return {
    checkedAt,
    current: limitRows(current, 8),
    upcoming: limitRows(upcoming, 12),
    period: `${startDateKey} to ${endDateKey}`,
  };
}

function packageStatus(remaining: number): Customer360PackageStatus {
  if (remaining > 3) {
    return "active";
  }
  if (remaining > 0) {
    return "low_remaining";
  }
  if (remaining === 0) {
    return "completed";
  }
  return "unknown";
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

function topPaymentMethod(rows: Array<Record<string, unknown>>) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const method = typeof row.paymentMethod === "string" ? row.paymentMethod : "";
    if (method) {
      counts.set(method, (counts.get(method) ?? 0) + 1);
    }
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}

function buildRecommendation(factPack: Customer360FactPack): Customer360FactPack["recommendation"] {
  const remaining = factPack.packages.totalRemainingSessions ?? 0;
  const hasUpcoming = (factPack.appointments.upcoming?.length ?? 0) > 0 || (factPack.appointments.current?.length ?? 0) > 0;

  if (remaining > 0 && !hasUpcoming) {
    return {
      title: "Rebook unused package care",
      reasonCodes: ["unused_package_balance", "no_live_upcoming_booking"],
      evidence: [
        `${remaining.toLocaleString("en-US")} remaining package session${remaining === 1 ? "" : "s"}`,
        "No current or upcoming APICORE booking was found in the next 30 days.",
      ],
    };
  }

  if (factPack.visitPattern.momentum === "declining") {
    return {
      title: "Retention check-in",
      reasonCodes: ["declining_visit_frequency"],
      evidence: [
        `${factPack.visitPattern.recentWindowVisits ?? 0} recent-window visits versus ${
          factPack.visitPattern.previousWindowVisits ?? 0
        } in the previous comparison window.`,
      ],
    };
  }

  if ((factPack.latestActivity.daysSinceLastVisit ?? 0) > 45 && (factPack.value.lifetimeSpend ?? 0) > 0) {
    return {
      title: "Warm relationship follow-up",
      reasonCodes: ["inactive_existing_customer"],
      evidence: [`Last completed visit was ${factPack.latestActivity.daysSinceLastVisit} days ago.`],
    };
  }

  return {
    title: "Keep in regular care cadence",
    reasonCodes: ["steady_relationship"],
    evidence: ["No high-priority package, booking, or visit-frequency trigger is visible in the current fact pack."],
  };
}

export function composeCustomer360Summary(factPack: Customer360FactPack) {
  const name = factPack.identity.displayName;
  const sentences: string[] = [];
  const joined = formatDate(factPack.identity.joinedDate);
  const visits = factPack.value.totalVisits;
  const spend = factPack.value.lifetimeSpend;
  const lastVisit = formatDate(factPack.latestActivity.lastVisitAt);
  const packageRemaining = factPack.packages.totalRemainingSessions;
  const currentCount = factPack.appointments.current?.length ?? 0;
  const upcomingCount = factPack.appointments.upcoming?.length ?? 0;

  sentences.push(joined ? `${name} joined on ${joined}.` : `${name} is the resolved customer for this Customer 360 briefing.`);

  if (visits != null || spend != null) {
    sentences.push(
      `${name} has completed ${visits?.toLocaleString("en-US") ?? "unknown"} visits and has ${formatMoney(spend)} in lifetime spend.`,
    );
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

  if (packageRemaining != null) {
    sentences.push(
      `APICORE package holdings show ${factPack.packages.activeHoldingCount ?? 0} active holding${
        factPack.packages.activeHoldingCount === 1 ? "" : "s"
      } with ${packageRemaining.toLocaleString("en-US")} remaining session${packageRemaining === 1 ? "" : "s"}.`,
    );
  } else if (factPack.packages.dataStatus === "unavailable" || factPack.packages.dataStatus === "partial") {
    sentences.push("Package balances are not presented as an exact combined total because the package source is partial or unavailable.");
  }

  sentences.push(
    currentCount || upcomingCount
      ? `APICORE shows ${currentCount} current and ${upcomingCount} upcoming booking${upcomingCount === 1 ? "" : "s"} in the next 30 days.`
      : "APICORE shows no current or upcoming booking in the next 30 days.",
  );

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
  const identityParams = {
    customerName: identity.customerName,
    customerPhone: identity.customerPhone,
    memberId: identity.memberId,
  };
  const usageYear = new Date(`${input.period.toDate}T00:00:00.000Z`).getUTCFullYear();
  const [
    overviewResult,
    packagesResult,
    bookingsResult,
    paymentsResult,
    usageResult,
    appointmentsResult,
    learnedResult,
  ] = await Promise.allSettled([
    getCustomerPortalOverview({
      clinicCode: input.clinic.clinicCode,
      fromDate: input.period.fromDate,
      toDate: input.period.toDate,
      ...identityParams,
    }),
    getPackagePortalCustomerHoldings({
      clinicId: input.clinic.clinicId,
      customerName: identity.customerName,
      customerPhone: identity.customerPhone,
      memberId: identity.memberId,
      throughDate: input.period.toDate,
      authorizationHeader: input.requestContext.authorizationHeader,
    }),
    getCustomerPortalBookings({
      clinicCode: input.clinic.clinicCode,
      fromDate: input.period.fromDate,
      toDate: input.period.toDate,
      ...identityParams,
      search: "",
      page: 1,
      pageSize: 20,
    }),
    getCustomerPortalPayments({
      clinicCode: input.clinic.clinicCode,
      fromDate: input.period.fromDate,
      toDate: input.period.toDate,
      ...identityParams,
      search: "",
      page: 1,
      pageSize: 20,
    }),
    getCustomerPortalUsage({
      clinicCode: input.clinic.clinicCode,
      fromDate: input.period.fromDate,
      toDate: input.period.toDate,
      ...identityParams,
      year: usageYear,
      serviceCategory: "",
    }),
    fetchLiveCustomerAppointments(input, identity),
    searchLearnedProfiles({
      clinicId: input.clinic.clinicId,
      search: identity.memberId || identity.customerName,
      limit: 10,
    }),
  ]);
  const sources = [...resolved.sources];
  const dataQuality: Customer360FactPack["dataQuality"] = [];
  const warnings: GreatTimeAgentWarning[] = [];

  const overview = overviewResult.status === "fulfilled" ? overviewResult.value : null;
  sources.push(
    source({
      tool: "get_customer_overview",
      sourceName: "BigQuery customer portal",
      period: "lifetime facts plus selected-period trends",
      dataStatus: overview ? "ok" : "unavailable",
      scope: "historical",
    }),
  );
  if (!overview) {
    dataQuality.push({
      code: "overview_unavailable",
      severity: "warning",
      message: `Customer overview could not be loaded: ${sanitizeError(overviewResult.status === "rejected" ? overviewResult.reason : undefined)}`,
    });
  }

  const packageData = packagesResult.status === "fulfilled" ? packagesResult.value : null;
  const packageHoldings = packageData?.holdings ?? [];
  const packageSourceStatus: AgentDataStatus = packageData ? (packageHoldings.length ? "ok" : "no_activity") : "unavailable";
  sources.push(
    source({
      tool: "get_customer_package_holdings",
      sourceName: "APICORE package holdings",
      period: `through ${input.period.toDate}`,
      dataStatus: packageSourceStatus,
      scope: "live",
      live: true,
    }),
  );
  if (!packageData) {
    dataQuality.push({
      code: "package_holdings_unavailable",
      severity: "warning",
      message:
        "APICORE package holdings were unavailable, so the combined remaining-session total is not shown as an exact figure.",
    });
  }

  const historicalBookings = bookingsResult.status === "fulfilled" ? bookingsResult.value : null;
  sources.push(
    source({
      tool: "get_customer_treatment_history",
      sourceName: "BigQuery historical completed treatments",
      period: `${input.period.fromDate} to ${input.period.toDate}`,
      dataStatus: historicalBookings ? (historicalBookings.rows.length ? "ok" : "no_activity") : "unavailable",
      scope: "historical",
    }),
  );

  const payments = paymentsResult.status === "fulfilled" ? paymentsResult.value : null;
  sources.push(
    source({
      tool: "get_customer_payments",
      sourceName: "BigQuery customer payment portal",
      period: `${input.period.fromDate} to ${input.period.toDate}`,
      dataStatus: payments ? (payments.rows.length ? "ok" : "no_activity") : "unavailable",
      scope: "historical",
    }),
  );

  const usage = usageResult.status === "fulfilled" ? usageResult.value : null;
  sources.push(
    source({
      tool: "get_customer_usage",
      sourceName: "BigQuery customer usage portal",
      period: String(usageYear),
      dataStatus: usage ? (usage.services.length ? "ok" : "no_activity") : "unavailable",
      scope: "historical",
    }),
  );

  const appointments = appointmentsResult.status === "fulfilled" ? appointmentsResult.value : null;
  sources.push(
    source({
      tool: "get_customer_live_appointments",
      sourceName: "APICORE booking ledger",
      period: appointments?.period ?? `${input.period.toDate} to ${addDays(input.period.toDate, 30)}`,
      dataStatus: appointments
        ? appointments.current.length || appointments.upcoming.length
          ? "ok"
          : "no_activity"
        : "unavailable",
      scope: "live",
      live: true,
    }),
  );
  if (!appointments) {
    dataQuality.push({
      code: "live_appointments_unavailable",
      severity: "warning",
      message: "Current and upcoming appointment state could not be checked from APICORE.",
    });
  }

  const learnedRows = learnedResult.status === "fulfilled" ? learnedResult.value.rows : [];
  const learnedProfile =
    learnedRows.find((profile) => normalizeText(profile.memberId ?? "") === normalizeText(identity.memberId ?? "")) ??
    learnedRows.find((profile) => normalizeText(profile.customerName) === normalizeText(identity.customerName)) ??
    null;
  sources.push(
    source({
      tool: "get_customer_learned_profile",
      sourceName: "Firestore customer relationship profiles",
      period: learnedProfile?.sourceLookbackDays ? `lookback ${learnedProfile.sourceLookbackDays} days` : undefined,
      dataStatus: learnedProfile ? "ok" : "no_activity",
      scope: "learned",
    }),
  );
  if (learnedProfile) {
    dataQuality.push({
      code: "learned_profile_lookback_scoped",
      severity: "info",
      message:
        "Learned profile fields are used only for segments and recommendation support; current source facts come from BigQuery and APICORE.",
    });
  }

  const recentCompleted = historicalBookings?.rows ?? [];
  const latestCompleted = recentCompleted[0] as Record<string, unknown> | undefined;
  const therapistRelationship = overview?.therapistRelationship ?? [];
  const preferredTherapist = overview?.customer.preferredTherapist || therapistRelationship[0]?.therapistName || null;
  const activePackageRows = packageHoldings.filter((row) => Number(row.remainingUnits ?? 0) > 0);
  const totalRemaining = packageData
    ? packageHoldings.reduce((sum, row) => sum + Math.max(0, Number(row.remainingUnits ?? 0)), 0)
    : undefined;
  const paymentRows = payments?.rows ?? [];
  const usageRows = usage?.services ?? [];
  const factPack: Customer360FactPack = {
    identity: {
      customerKey: identity.customerKey,
      memberId: identity.memberId,
      displayName: overview?.customer.customerName ?? identity.customerName,
      joinedDate: overview?.customer.joinedDate ?? identity.joinedDate ?? null,
      maskedPhone: overview?.customer.phoneNumber ? maskPhone(overview.customer.phoneNumber) : identity.phoneMasked,
      detailPath: customerDetailPath({
        customerName: overview?.customer.customerName ?? identity.customerName,
        customerPhone: overview?.customer.phoneNumber ?? identity.customerPhone,
        fromDate: input.period.fromDate,
        toDate: input.period.toDate,
      }),
    },
    value: {
      lifetimeSpend: overview?.customer.lifetimeSpend,
      totalVisits: overview?.customer.totalVisits,
      averageVisitSpend: overview?.customer.averageSpendPerVisit,
    },
    latestActivity: {
      lastVisitAt: overview?.customer.lastVisitDate ?? null,
      lastService:
        typeof latestCompleted?.serviceName === "string"
          ? latestCompleted.serviceName
          : overview?.recentServices[0]?.serviceName ?? overview?.customer.preferredService ?? null,
      lastTherapist: typeof latestCompleted?.therapistName === "string" ? latestCompleted.therapistName : preferredTherapist,
      daysSinceLastVisit: overview?.customer.daysSinceLastVisit ?? null,
    },
    preferences: {
      preferredService: overview?.customer.preferredService ?? null,
      preferredServiceCategory: overview?.customer.preferredServiceCategory ?? null,
      preferredTherapist,
      preferredTherapistVisits: therapistRelationship[0]?.visitCount,
    },
    visitPattern: {
      averageVisitIntervalDays: overview?.customer.avgVisitIntervalDays ?? null,
      recentWindowVisits: overview?.customer.recent3MonthVisits,
      previousWindowVisits: overview?.customer.previous3MonthVisits,
      momentum: momentum(overview?.customer.recent3MonthVisits, overview?.customer.previous3MonthVisits),
    },
    packages: {
      purchaseCount: packageData ? packageHoldings.reduce((sum, row) => sum + Number(row.purchaseCount ?? 0), 0) : undefined,
      activeHoldingCount: packageData ? activePackageRows.length : undefined,
      totalRemainingSessions: totalRemaining,
      dataStatus: packageSourceStatus,
      holdings: limitRows(
        packageHoldings.map((row) => ({
          packageId: String(row.packageId ?? row.id ?? ""),
          packageName: typeof row.packageName === "string" ? row.packageName : null,
          serviceName: Array.isArray(row.serviceNames) && row.serviceNames.length ? row.serviceNames.join(", ") : String(row.category ?? "Package service"),
          totalSessions: Number(row.purchasedUnits ?? 0),
          usedSessions: Number(row.usedUnits ?? 0),
          remainingSessions: Number(row.remainingUnits ?? 0),
          latestUsageDate: typeof row.lastVisitDate === "string" ? row.lastVisitDate : null,
          latestTherapist: typeof row.therapist === "string" ? row.therapist : null,
          status: packageStatus(Number(row.remainingUnits ?? -1)),
        })),
        12,
      ),
    },
    appointments: {
      current: appointments?.current ?? [],
      upcoming: appointments?.upcoming ?? [],
      recentCompleted: limitRows(recentCompleted, 8),
    },
    payments: {
      selectedPeriodTotal: payments?.summary.totalSpent,
      invoiceCount: payments?.summary.invoiceCount,
      averageInvoice: payments?.summary.averageInvoice,
      outstanding: payments?.summary.outstandingAmount,
      preferredMethod: topPaymentMethod(paymentRows),
      recentInvoices: limitRows(paymentRows, 8),
    },
    usage: {
      selectedYear: usage?.year ?? usageYear,
      distinctServices: usage?.summary.distinctServices,
      topServices: limitRows(
        usageRows.map((row) => ({
          serviceName: row.serviceName,
          serviceCategory: row.serviceCategory,
          totalUsage: row.totalUsage,
        })),
        8,
      ),
      monthlyServiceUsage: limitRows(
        usageRows.flatMap((row) =>
          row.counts.map((count, index) => ({
            serviceName: row.serviceName,
            month: usage?.months[index] ?? String(index + 1),
            usageCount: count,
          })),
        ),
        24,
      ),
    },
    dataQuality,
    sources,
  };
  factPack.recommendation = buildRecommendation(factPack);

  for (const note of dataQuality.filter((item) => item.severity !== "info")) {
    warnings.push({
      type: note.code,
      title: note.severity === "blocking" ? "Customer 360 blocked" : "Customer 360 partial",
      message: note.message,
    });
  }

  const summary = composeCustomer360Summary(factPack);
  const statuses = sources.map((item) => item.dataStatus);
  const dataStatus = buildOverallStatus(statuses);

  return {
    toolName: "get_customer_360",
    sourceName: "Customer 360 fact pack",
    checkedAt: nowIso(),
    period: `${input.period.fromDate} to ${input.period.toDate}`,
    dataStatus,
    live: true,
    sources,
    summary,
    customer360: factPack,
    metrics: [
      { label: "Lifetime visits", value: factPack.value.totalVisits ?? "unknown" },
      { label: "Lifetime spend", value: factPack.value.lifetimeSpend ?? "unknown", unit: "MMK" },
      { label: "Active package holdings", value: factPack.packages.activeHoldingCount ?? "unknown" },
      { label: "Upcoming bookings", value: factPack.appointments.upcoming?.length ?? 0 },
    ],
    tables: [
      ...(factPack.packages.holdings.length
        ? [
            {
              title: "Customer 360 package holdings",
              columns: [
                { key: "serviceName", title: "Service" },
                { key: "packageName", title: "Package" },
                { key: "remainingSessions", title: "Remaining" },
                { key: "latestUsageDate", title: "Latest usage" },
                { key: "status", title: "Status" },
              ],
              rows: factPack.packages.holdings,
            },
          ]
        : []),
      ...(factPack.payments.recentInvoices.length
        ? [
            {
              title: "Customer 360 recent invoices",
              columns: [
                { key: "dateLabel", title: "Date" },
                { key: "invoiceNumber", title: "Invoice" },
                { key: "serviceName", title: "Service" },
                { key: "paymentMethod", title: "Method" },
                { key: "netAmount", title: "Amount" },
              ],
              rows: factPack.payments.recentInvoices,
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
        customerPhone: overview?.customer.phoneNumber ?? identity.customerPhone,
        memberId: factPack.identity.memberId,
        rank: 1,
      },
    ],
  };
}
