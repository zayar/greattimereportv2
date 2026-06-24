import { z } from "zod";
import { getDashboardOverview } from "../../reports/dashboard.service.js";
import { getDailyTreatmentReport } from "../../reports/daily-treatment.service.js";
import { getServiceBehaviorReport } from "../../reports/service-behavior.service.js";
import { getServicePortalList, getServicePortalOverview } from "../../reports/service-portal.service.js";
import { getTherapistPortalReport } from "../../reports/therapist-portal.service.js";
import { buildService360ToolResult } from "../service-360.service.js";
import { limitRows, nowIso } from "../safety.js";
import type { AgentToolDefinition, AgentToolInput, AgentToolResult } from "../types.js";

const toolInputSchema = z.custom<AgentToolInput>(() => true);

function periodLabel(input: AgentToolInput) {
  return `${input.period.fromDate} to ${input.period.toDate}`;
}

async function getBusinessHealthSnapshot(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await getDashboardOverview({
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
  });

  return {
    toolName: "get_business_health_snapshot",
    sourceName: "BigQuery dashboard overview",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: "ok",
    live: false,
    summary: `Business health for ${input.period.label}: revenue ${data.summary.revenue.value.toLocaleString("en-US")}, appointments ${data.summary.appointments.value.toLocaleString("en-US")}.`,
    metrics: [
      { label: "Revenue", value: data.summary.revenue.value, unit: "amount", helperText: `${data.summary.revenue.change}% vs previous` },
      { label: "Invoices", value: data.summary.invoices.value, helperText: `${data.summary.invoices.change}% vs previous` },
      { label: "Customers", value: data.summary.customers.value, helperText: `${data.summary.customers.change}% vs previous` },
      { label: "Appointments", value: data.summary.appointments.value, helperText: `${data.summary.appointments.change}% vs previous` },
      { label: "Services delivered", value: data.summary.servicesDelivered.value },
    ],
    tables: [
      {
        title: "Top services",
        columns: [
          { key: "serviceName", title: "Service" },
          { key: "revenue", title: "Revenue" },
          { key: "bookings", title: "Bookings" },
          { key: "contributionPct", title: "Contribution %" },
        ],
        rows: limitRows(data.topServices, 8),
      },
    ],
    recommendations: data.insights.map((insight) => ({
      title: insight.title,
      message: insight.detail,
      sourceTools: ["get_business_health_snapshot"],
    })),
  };
}

async function getServiceBehavior(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await getServiceBehaviorReport({
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    granularity: "month",
  });

  return {
    toolName: "get_service_behavior",
    sourceName: "BigQuery service behavior report",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: data.summary.totalBookings > 0 ? "ok" : "no_activity",
    live: false,
    metrics: [
      { label: "Total bookings", value: data.summary.totalBookings },
      { label: "Distinct services", value: data.summary.distinctServices },
      { label: "Avg bookings/service", value: data.summary.avgBookingsPerService },
    ],
    tables: [
      {
        title: "Top services by bookings",
        columns: [
          { key: "serviceName", title: "Service" },
          { key: "bookingCount", title: "Bookings" },
        ],
        rows: limitRows(data.topServices, 20),
      },
      {
        title: "Practitioner service mix",
        columns: [
          { key: "practitionerName", title: "Practitioner" },
          { key: "serviceName", title: "Service" },
          { key: "bookingCount", title: "Bookings" },
        ],
        rows: limitRows(data.practitionerServices, 20),
      },
    ],
    entityRefs: data.topServices.map((row, index) => ({
      entityType: "service",
      entityId: row.serviceName,
      displayName: row.serviceName,
      serviceName: row.serviceName,
      rank: index + 1,
    })),
  };
}

async function getServiceOverview(input: AgentToolInput): Promise<AgentToolResult> {
  const serviceName = input.entityContext?.serviceName ?? input.entityContext?.displayName;

  if (serviceName) {
    const data = await getServicePortalOverview({
      clinicCode: input.clinic.clinicCode,
      fromDate: input.period.fromDate,
      toDate: input.period.toDate,
      serviceName,
    });

    return {
      toolName: "get_service_overview",
      sourceName: "BigQuery service portal",
      checkedAt: nowIso(),
      period: periodLabel(input),
      dataStatus: "ok",
      live: false,
      summary: `${data.service.serviceName} is ${data.service.status.toLowerCase()} with ${data.service.bookingCount.toLocaleString("en-US")} bookings.`,
      metrics: [
        { label: "Revenue", value: data.service.totalRevenue, unit: "amount" },
        { label: "Bookings", value: data.service.bookingCount },
        { label: "Customers", value: data.service.customerCount },
        { label: "Growth", value: data.service.growthRate, unit: "%" },
      ],
    };
  }

  const list = await getServicePortalList({
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    search: "",
    serviceCategory: "",
    sortBy: "totalRevenue",
    sortDirection: "desc",
  });

  return {
    toolName: "get_service_overview",
    sourceName: "BigQuery service portal",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: list.rows.length ? "ok" : "no_activity",
    live: false,
    metrics: [
      { label: "Services", value: list.summary.serviceCount },
      { label: "Revenue", value: list.summary.totalRevenue, unit: "amount" },
      { label: "Bookings", value: list.summary.totalBookings },
      { label: "Customers", value: list.summary.totalCustomers },
    ],
    tables: [
      {
        title: "Service performance",
        columns: [
          { key: "serviceName", title: "Service" },
          { key: "totalRevenue", title: "Revenue" },
          { key: "bookingCount", title: "Bookings" },
          { key: "growthRate", title: "Growth %" },
        ],
        rows: limitRows(list.rows, 20),
      },
    ],
    entityRefs: list.rows.map((row, index) => ({
      entityType: "service",
      entityId: row.serviceName,
      displayName: row.serviceName,
      serviceName: row.serviceName,
      rank: index + 1,
    })),
  };
}

async function getPractitionerOverview(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await getTherapistPortalReport({
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    search: input.entityContext?.practitionerName ?? input.entityContext?.displayName ?? "",
    serviceCategory: "",
    sortBy: "treatmentsCompleted",
    sortDirection: "desc",
  });

  return {
    toolName: "get_practitioner_overview",
    sourceName: "BigQuery practitioner portal",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: data.leaderboard.length ? "ok" : "no_activity",
    live: false,
    summary: data.highlight
      ? `${data.highlight.therapistName} leads volume with ${data.highlight.treatmentsCompleted.toLocaleString("en-US")} treatments.`
      : "No practitioner activity was found for this period.",
    metrics: [
      { label: "Active practitioners", value: data.summary.activeTherapists },
      { label: "Treatments", value: data.summary.totalTreatments },
      { label: "Customers served", value: data.summary.customersServed },
      { label: "Average utilization", value: data.summary.averageUtilizationScore },
    ],
    tables: [
      {
        title: "Practitioner performance",
        columns: [
          { key: "therapistName", title: "Practitioner" },
          { key: "treatmentsCompleted", title: "Treatments" },
          { key: "customersServed", title: "Customers" },
          { key: "topService", title: "Top service" },
          { key: "utilizationScore", title: "Utilization" },
        ],
        rows: limitRows(data.leaderboard, 20),
      },
    ],
    entityRefs: data.leaderboard.map((row, index) => ({
      entityType: "practitioner",
      entityId: row.therapistName,
      displayName: row.therapistName,
      practitionerName: row.therapistName,
      rank: index + 1,
    })),
  };
}

async function getDailyTreatments(input: AgentToolInput): Promise<AgentToolResult> {
  const data = await getDailyTreatmentReport({
    clinicCode: input.clinic.clinicCode,
    date: input.period.toDate,
  });

  return {
    toolName: "get_daily_treatments",
    sourceName: "BigQuery daily treatment report",
    checkedAt: nowIso(),
    period: data.selectedDate,
    dataStatus: data.summary.totalTreatments > 0 ? "ok" : "no_activity",
    live: false,
    metrics: [
      { label: "Treatments", value: data.summary.totalTreatments },
      { label: "Practitioners", value: data.summary.therapists },
      { label: "Services", value: data.summary.uniqueServices },
    ],
    tables: [
      {
        title: "Daily treatment records",
        columns: [
          { key: "checkInTime", title: "Time" },
          { key: "therapistName", title: "Practitioner" },
          { key: "serviceName", title: "Service" },
          { key: "customerName", title: "Customer" },
        ],
        rows: limitRows(data.records, 25),
      },
    ],
  };
}

export function createBusinessTools(): AgentToolDefinition[] {
  return [
    {
      name: "get_service_360",
      agentId: "business",
      description: "Build a one-shot Service 360 fact pack for a named service.",
      inputSchema: toolInputSchema,
      sourceName: "Service 360 fact pack",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: buildService360ToolResult,
    },
    {
      name: "get_service_behavior",
      agentId: "business",
      description: "Get historical service behavior.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery service behavior report",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getServiceBehavior,
    },
    {
      name: "get_service_overview",
      agentId: "business",
      description: "Get service portal overview or ranked services.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery service portal",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getServiceOverview,
    },
    {
      name: "get_service_customers",
      agentId: "business",
      description: "Get customers for a service.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery service portal",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getServiceOverview,
    },
    {
      name: "get_service_payments",
      agentId: "business",
      description: "Get payments for a service.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery service portal",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getServiceOverview,
    },
    {
      name: "get_practitioner_overview",
      agentId: "business",
      description: "Get practitioner performance overview.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery practitioner portal",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getPractitionerOverview,
    },
    {
      name: "get_practitioner_customers",
      agentId: "business",
      description: "Get practitioner customer relationships.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery practitioner portal",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getPractitionerOverview,
    },
    {
      name: "get_practitioner_treatments",
      agentId: "business",
      description: "Get practitioner treatments.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery practitioner portal",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getPractitionerOverview,
    },
    {
      name: "get_daily_treatments",
      agentId: "business",
      description: "Get daily treatment activity.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery daily treatment report",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getDailyTreatments,
    },
    {
      name: "compare_service_periods",
      agentId: "business",
      description: "Compare service periods.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery service portal",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getServiceOverview,
    },
    {
      name: "get_business_health_snapshot",
      agentId: "business",
      description: "Get overall clinic trends.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery dashboard overview",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getBusinessHealthSnapshot,
    },
  ];
}
