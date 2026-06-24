import { z } from "zod";
import {
  getCustomerPortalBookings,
  getCustomerPortalOverview,
  getCustomerPortalPackages,
  getCustomerPortalPayments,
  getCustomerQuickView,
  getCustomerPortalUsage,
} from "../../reports/customer-portal.service.js";
import {
  getLatestCustomerRelationshipLearningRun,
  searchCustomerRelationshipProfilesBounded,
} from "../../reports/customer-relationship-profile.repository.js";
import { buildCustomer360ToolResult } from "../customer-360.service.js";
import { extractExplicitCustomerSearchText } from "../customer-query.js";
import { limitRows, nowIso } from "../safety.js";
import type { AgentToolDefinition, AgentToolInput, AgentToolResult } from "../types.js";

const toolInputSchema = z.custom<AgentToolInput>(() => true);

function periodLabel(input: AgentToolInput) {
  return `${input.period.fromDate} to ${input.period.toDate}`;
}

function profilePlan(intent: string, message: string) {
  if (intent === "unused_package_balance") {
    return { segment: "unused_package_balance" as const, sortBy: "remainingPackageSessions" as const };
  }
  if (intent === "package_bought_never_used") {
    return { segment: "package_bought_not_used" as const, sortBy: "priorityScore" as const };
  }
  if (intent === "treatment_due") {
    return { segment: "treatment_due" as const, sortBy: "priorityScore" as const };
  }
  if (intent === "churn_risk") {
    return { riskLevel: "high" as const, sortBy: "priorityScore" as const };
  }

  const explicitSearch = extractExplicitCustomerSearchText(message);
  const search = (explicitSearch || message)
    .replace(/customer|member|first|second|third/gi, "")
    .replace(/[?.!]+$/g, "")
    .trim();

  return { search, sortBy: "priorityScore" as const };
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

  return {
    toolName: "search_customer_profiles",
    sourceName: "Firestore customer relationship profiles",
    checkedAt: nowIso(),
    period: latestRun?.learnedAt ? `learned at ${latestRun.learnedAt}` : periodLabel(input),
    dataStatus: latestRun ? (result.rows.length > 0 ? "ok" : "no_activity") : "not_ready",
    live: false,
    summary: latestRun
      ? `${result.rows.length.toLocaleString("en-US")} customer profile${result.rows.length === 1 ? "" : "s"} matched.`
      : "Customer relationship learning has not run yet.",
    metrics: [
      { label: "Matched customers", value: result.rows.length },
      { label: "Source lookback days", value: latestRun?.sourceLookbackDays ?? "not learned" },
    ],
    tables: [
      {
        title: "Customer relationship matches",
        columns: [
          { key: "customerName", title: "Customer" },
          { key: "customerPhoneMasked", title: "Phone" },
          { key: "lastVisitDate", title: "Last visit" },
          { key: "remainingPackageSessions", title: "Package balance" },
          { key: "riskLevel", title: "Risk" },
          { key: "nextBestAction", title: "Next action" },
        ],
        rows: result.rows.map((profile) => ({
          customerKey: profile.customerKey,
          customerName: profile.customerName,
          customerPhoneMasked: profile.customerPhoneMasked,
          lastVisitDate: profile.lastVisitDate,
          daysSinceLastVisit: profile.daysSinceLastVisit,
          remainingPackageSessions: profile.remainingPackageSessions,
          lifetimeSpend: profile.lifetimeSpend,
          riskLevel: profile.riskLevel,
          segments: profile.segments.join(", "),
          nextBestAction: profile.nextBestAction,
        })),
      },
    ],
    recommendations: result.rows.slice(0, 3).map((profile) => ({
      title: profile.customerName,
      message: profile.nextBestAction,
      sourceTools: ["search_customer_profiles"],
    })),
    warnings: latestRun
      ? undefined
      : [
          {
            type: "learning_not_ready",
            title: "Customer learning not ready",
            message: "Run customer relationship learning before relying on profile segments.",
          },
        ],
    entityRefs: result.rows.map((profile, index) => ({
      entityType: "customer",
      entityId: profile.customerKey,
      customerKey: profile.customerKey,
      memberId: profile.memberId ?? undefined,
      displayName: profile.customerName,
      customerName: profile.customerName,
      rank: index + 1,
    })),
  };
}

function customerIdentity(input: AgentToolInput) {
  return {
    customerName: input.entityContext?.customerName ?? input.entityContext?.displayName ?? "",
    customerPhone: input.entityContext?.customerPhone ?? "",
    memberId: input.entityContext?.memberId ?? "",
  };
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
  };
}

export function createCustomerTools(): AgentToolDefinition[] {
  return [
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
}
