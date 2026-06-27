import { z } from "zod";
import { env } from "../../../config/env.js";
import { shiftRange } from "../../../utils/date-range.js";
import { runWithAnalyticsQueryContext } from "../../analytics-query-context.js";
import { getCustomerPortalPayments } from "../../reports/customer-portal.service.js";
import { getPaymentReport } from "../../reports/payment-report.service.js";
import { getSalesReport } from "../../reports/sales-report.service.js";
import type { GtAgentFactSnapshot } from "../memory/memory-types.js";
import { limitRows, nowIso } from "../safety.js";
import {
  factSnapshotToAgentSource,
  getFactSnapshotForPeriod,
  isCompletedHistoricalDay,
} from "../snapshot-cache.service.js";
import type { AgentToolDefinition, AgentToolInput, AgentToolResult } from "../types.js";

const toolInputSchema = z.custom<AgentToolInput>(() => true);

type FinanceToolDeps = {
  getCompletedDayFinanceSnapshot: typeof getCompletedDayFinanceSnapshot;
  getSalesReport: typeof getSalesReport;
  getPaymentReport: typeof getPaymentReport;
};

function runFinanceBigQueryOperation<T>(params: {
  toolName: string;
  operationName: string;
  callback: () => Promise<T>;
}) {
  return runWithAnalyticsQueryContext(
    {
      queryNamePrefix: `agent.finance.${params.toolName}.${params.operationName}`,
      labels: {
        app: "greattime",
        feature: "agent_hub",
        agent: "finance",
        tool: params.toolName,
        operation: params.operationName,
      },
      timeoutMs: env.AGENT_BIGQUERY_TIMEOUT_MS,
      ttlMs: env.BQ_QUERY_DEFAULT_TTL_MS,
      readOnly: true,
    },
    params.callback,
  );
}

function periodLabel(input: AgentToolInput) {
  return `${input.period.fromDate} to ${input.period.toDate}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nestedRecord(value: unknown, key: string) {
  if (!isRecord(value)) {
    return {};
  }

  const child = value[key];
  if (!isRecord(child)) {
    return {};
  }

  return isRecord(child.summary) ? child.summary : child;
}

function numberFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value && typeof value === "object" && "value" in value) {
    return Number((value as { value: unknown }).value);
  }

  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metric(label: string, value: number | null, unit?: string): NonNullable<AgentToolResult["metrics"]>[number] | null {
  return value == null ? null : { label, value, unit };
}

function compactMetrics(metrics: Array<NonNullable<AgentToolResult["metrics"]>[number] | null>) {
  return metrics.filter((item): item is NonNullable<AgentToolResult["metrics"]>[number] => Boolean(item));
}

function formatSnapshotAmount(value: number | null) {
  return value == null ? "not available" : value.toLocaleString("en-US");
}

function snapshotStatus(snapshot: GtAgentFactSnapshot, knownMetricCount: number) {
  if (knownMetricCount === 0) {
    return "partial" as const;
  }

  return snapshot.dataStatus ?? "ok";
}

function missingSnapshotFieldWarning(kind: "sales" | "payments") {
  return {
    type: "finance_snapshot_partial",
    title: "Finance snapshot is partial",
    message: `The finance daily snapshot did not include every ${kind} summary field expected by the Agent Hub response.`,
  };
}

function hasFinanceSnapshotSummary(snapshot: GtAgentFactSnapshot, kind: "sales" | "payments") {
  const summary = nestedRecord(snapshot.summary, kind);
  const primaryKeys = kind === "sales" ? ["totalRevenue", "invoiceCount"] : ["totalAmount", "invoiceCount"];
  return primaryKeys.some((key) => numberFromRecord(summary, key) != null);
}

async function getCompletedDayFinanceSnapshot(input: AgentToolInput) {
  if (!env.AGENT_SNAPSHOT_CACHE_ENABLED || !env.AGENT_COMPLETED_DAY_SNAPSHOT_ENABLED) {
    return null;
  }

  if (
    !isCompletedHistoricalDay({
      fromDate: input.period.fromDate,
      toDate: input.period.toDate,
      timezone: input.request.timezone,
    })
  ) {
    return null;
  }

  return getFactSnapshotForPeriod({
    clinicId: input.clinic.clinicId,
    snapshotType: "finance_daily_snapshot",
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    maxAgeMs: env.AGENT_SNAPSHOT_MAX_AGE_MINUTES * 60_000,
  }).catch(() => null);
}

const defaultFinanceToolDeps: FinanceToolDeps = {
  getCompletedDayFinanceSnapshot,
  getSalesReport,
  getPaymentReport,
};

export function buildFinanceSnapshotSummaryResult(params: {
  input: AgentToolInput;
  snapshot: GtAgentFactSnapshot;
  kind: "sales" | "payments";
}): AgentToolResult {
  const source = factSnapshotToAgentSource({
    snapshot: params.snapshot,
    toolName: params.kind === "sales" ? "get_sales_summary" : "get_payment_summary",
    sourceName: "GreatTime learned finance daily snapshot",
    scope: "historical",
    live: false,
  });
  const summary = params.snapshot.summary;
  const sales = nestedRecord(summary, "sales");
  const payments = nestedRecord(summary, "payments");

  if (params.kind === "sales") {
    const totalRevenue = numberFromRecord(sales, "totalRevenue");
    const invoiceCount = numberFromRecord(sales, "invoiceCount");
    const customerCount = numberFromRecord(sales, "customerCount");
    const averageInvoice = numberFromRecord(sales, "averageInvoice");
    const metrics = compactMetrics([
      metric("Total sales", totalRevenue, "amount"),
      metric("Invoices", invoiceCount),
      metric("Customers", customerCount),
      metric("Average invoice", averageInvoice, "amount"),
    ]);

    return {
      toolName: "get_sales_summary",
      sourceName: "GreatTime learned finance daily snapshot",
      checkedAt: params.snapshot.checkedAt,
      period: periodLabel(params.input),
      dataStatus: snapshotStatus(params.snapshot, metrics.length),
      live: false,
      freshnessSeconds: source.freshnessSeconds,
      summary: `Sales for ${params.input.period.label}: ${formatSnapshotAmount(totalRevenue)} from ${formatSnapshotAmount(invoiceCount)} invoices.`,
      metrics,
      sources: [source],
      warnings: metrics.length < 4 ? [missingSnapshotFieldWarning("sales")] : undefined,
    };
  }

  const totalAmount = numberFromRecord(payments, "totalAmount");
  const invoiceCount = numberFromRecord(payments, "invoiceCount");
  const methodsCount = numberFromRecord(payments, "methodsCount") ?? numberFromRecord(summary, "paymentMethodCount");
  const averageInvoice = numberFromRecord(payments, "averageInvoice");
  const metrics = compactMetrics([
    metric("Collected", totalAmount, "amount"),
    metric("Paid invoices", invoiceCount),
    metric("Payment methods", methodsCount),
    metric("Average invoice", averageInvoice, "amount"),
  ]);

  return {
    toolName: "get_payment_summary",
    sourceName: "GreatTime learned finance daily snapshot",
    checkedAt: params.snapshot.checkedAt,
    period: periodLabel(params.input),
    dataStatus: snapshotStatus(params.snapshot, metrics.length),
    live: false,
    freshnessSeconds: source.freshnessSeconds,
    summary: `Collections for ${params.input.period.label}: ${formatSnapshotAmount(totalAmount)} across ${formatSnapshotAmount(invoiceCount)} invoices.`,
    metrics,
    sources: [source],
    warnings: metrics.length < 4 ? [missingSnapshotFieldWarning("payments")] : undefined,
  };
}

function paymentReportParams(input: AgentToolInput, search = "") {
  return {
    clinicId: input.clinic.clinicId,
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    search,
    paymentMethod: "",
    includeZeroValues: false,
    limit: 25,
    offset: 0,
  };
}

export function extractInvoiceSearch(message: string) {
  const invoiceNumber = message.match(/\b[A-Z]{1,5}[-_/]?\d{3,}\b/i)?.[0];
  if (invoiceNumber) {
    return invoiceNumber;
  }

  const cleaned = message
    .replace(
      /\b(?:show|list|get|give|please|today|now|right\s+now|invoice|invoices|detail|details|voucher|vouchers|payment|payments|for|the|a|an)\b/gi,
      " ",
    )
    .replace(/(?:ဒီနေ့|ယခု|အခု|ဘောက်ချာ)/gi, " ")
    .replace(/[?.!,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length >= 2 ? cleaned.slice(0, 80) : "";
}

async function getSalesSummary(input: AgentToolInput, deps: FinanceToolDeps = defaultFinanceToolDeps): Promise<AgentToolResult> {
  const snapshot = await deps.getCompletedDayFinanceSnapshot(input);
  if (snapshot && hasFinanceSnapshotSummary(snapshot, "sales")) {
    return buildFinanceSnapshotSummaryResult({ input, snapshot, kind: "sales" });
  }

  const report = await runFinanceBigQueryOperation({
    toolName: "get_sales_summary",
    operationName: "snapshot_fallback",
    callback: () =>
      deps.getSalesReport({
        clinicCode: input.clinic.clinicCode,
        fromDate: input.period.fromDate,
        toDate: input.period.toDate,
        search: "",
        limit: 10,
        offset: 0,
      }),
  });

  return {
    toolName: "get_sales_summary",
    sourceName: "BigQuery sales report",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: report.summary.invoiceCount > 0 ? "ok" : "no_activity",
    live: false,
    summary: `Sales for ${input.period.label}: ${report.summary.totalRevenue.toLocaleString("en-US")} from ${report.summary.invoiceCount.toLocaleString("en-US")} invoices.`,
    metrics: [
      { label: "Total sales", value: report.summary.totalRevenue, unit: "amount" },
      { label: "Invoices", value: report.summary.invoiceCount },
      { label: "Customers", value: report.summary.customerCount },
      { label: "Average invoice", value: report.summary.averageInvoice, unit: "amount" },
    ],
    tables: [
      {
        title: "Top services by sales",
        columns: [
          { key: "serviceName", title: "Service" },
          { key: "totalRevenue", title: "Revenue" },
          { key: "invoiceCount", title: "Invoices" },
        ],
        rows: report.topServices,
      },
    ],
  };
}

async function getPaymentSummary(input: AgentToolInput, deps: FinanceToolDeps = defaultFinanceToolDeps): Promise<AgentToolResult> {
  const snapshot = await deps.getCompletedDayFinanceSnapshot(input);
  if (snapshot && hasFinanceSnapshotSummary(snapshot, "payments")) {
    return buildFinanceSnapshotSummaryResult({ input, snapshot, kind: "payments" });
  }

  const report = await runFinanceBigQueryOperation({
    toolName: "get_payment_summary",
    operationName: "snapshot_fallback",
    callback: () => deps.getPaymentReport(paymentReportParams(input)),
  });

  return {
    toolName: "get_payment_summary",
    sourceName: "BigQuery payment report",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: report.summary.invoiceCount > 0 ? "ok" : "no_activity",
    live: false,
    summary: `Collections for ${input.period.label}: ${report.summary.totalAmount.toLocaleString("en-US")} across ${report.summary.invoiceCount.toLocaleString("en-US")} invoices.`,
    metrics: [
      { label: "Collected", value: report.summary.totalAmount, unit: "amount" },
      { label: "Paid invoices", value: report.summary.invoiceCount },
      { label: "Payment methods", value: report.summary.methodsCount },
      { label: "Average invoice", value: report.summary.averageInvoice, unit: "amount" },
    ],
  };
}

async function getPaymentMethodBreakdown(input: AgentToolInput): Promise<AgentToolResult> {
  const report = await getPaymentReport(paymentReportParams(input));

  return {
    toolName: "get_payment_method_breakdown",
    sourceName: "BigQuery payment method report",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: report.methods.length > 0 ? "ok" : "no_activity",
    live: false,
    tables: [
      {
        title: "Payment methods",
        columns: [
          { key: "paymentMethod", title: "Method" },
          { key: "totalAmount", title: "Amount" },
          { key: "transactionCount", title: "Transactions" },
        ],
        rows: report.methods,
      },
    ],
  };
}

async function compareSalesPeriods(input: AgentToolInput): Promise<AgentToolResult> {
  const previous =
    input.period.previousFromDate && input.period.previousToDate
      ? { previousFromDate: input.period.previousFromDate, previousToDate: input.period.previousToDate }
      : shiftRange(input.period.fromDate, input.period.toDate);
  const [currentReport, previousReport] = await Promise.all([
    getSalesReport({
      clinicCode: input.clinic.clinicCode,
      fromDate: input.period.fromDate,
      toDate: input.period.toDate,
      search: "",
      limit: 5,
      offset: 0,
    }),
    getSalesReport({
      clinicCode: input.clinic.clinicCode,
      fromDate: previous.previousFromDate,
      toDate: previous.previousToDate,
      search: "",
      limit: 5,
      offset: 0,
    }),
  ]);
  const change = currentReport.summary.totalRevenue - previousReport.summary.totalRevenue;
  const changePct =
    previousReport.summary.totalRevenue === 0
      ? currentReport.summary.totalRevenue === 0
        ? 0
        : 100
      : Number(((change / previousReport.summary.totalRevenue) * 100).toFixed(1));

  return {
    toolName: "compare_sales_periods",
    sourceName: "BigQuery sales comparison",
    checkedAt: nowIso(),
    period: `${periodLabel(input)} vs ${previous.previousFromDate} to ${previous.previousToDate}`,
    dataStatus: currentReport.summary.invoiceCount > 0 || previousReport.summary.invoiceCount > 0 ? "ok" : "no_activity",
    live: false,
    summary: `Sales changed by ${change.toLocaleString("en-US")} (${changePct}%).`,
    metrics: [
      { label: "Current sales", value: currentReport.summary.totalRevenue, unit: "amount" },
      { label: "Previous sales", value: previousReport.summary.totalRevenue, unit: "amount" },
      { label: "Change", value: change, unit: "amount" },
      { label: "Change %", value: changePct, unit: "%" },
    ],
    tables: [
      {
        title: "Period comparison",
        columns: [
          { key: "period", title: "Period" },
          { key: "fromDate", title: "From" },
          { key: "toDate", title: "To" },
          { key: "revenue", title: "Revenue" },
          { key: "invoices", title: "Invoices" },
        ],
        rows: [
          {
            period: "Current",
            fromDate: input.period.fromDate,
            toDate: input.period.toDate,
            revenue: currentReport.summary.totalRevenue,
            invoices: currentReport.summary.invoiceCount,
          },
          {
            period: "Previous",
            fromDate: previous.previousFromDate,
            toDate: previous.previousToDate,
            revenue: previousReport.summary.totalRevenue,
            invoices: previousReport.summary.invoiceCount,
          },
        ],
      },
    ],
  };
}

async function getCustomerPaymentHistory(input: AgentToolInput): Promise<AgentToolResult> {
  const customerName = input.entityContext?.customerName ?? input.entityContext?.displayName ?? "";
  const customerPhone = input.entityContext?.customerPhone ?? "";

  if (!customerName && !customerPhone) {
    return {
      toolName: "get_customer_payment_history",
      sourceName: "BigQuery customer payment portal",
      checkedAt: nowIso(),
      period: periodLabel(input),
      dataStatus: "not_ready",
      live: false,
      warnings: [
        {
          type: "missing_customer_context",
          title: "Customer context needed",
          message: "Ask about a specific customer from a prior result or provide a customer name/phone.",
        },
      ],
    };
  }

  const report = await getCustomerPortalPayments({
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    customerName,
    customerPhone,
    search: "",
    page: 1,
    pageSize: 20,
  });

  return {
    toolName: "get_customer_payment_history",
    sourceName: "BigQuery customer payment portal",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: report.rows.length > 0 ? "ok" : "no_activity",
    live: false,
    tables: [
      {
        title: "Customer payment history",
        columns: [
          { key: "dateLabel", title: "Date" },
          { key: "invoiceNumber", title: "Invoice" },
          { key: "serviceName", title: "Service" },
          { key: "paymentMethod", title: "Method" },
          { key: "invoiceNetTotal", title: "Amount" },
        ],
        rows: limitRows(report.rows, 20),
      },
    ],
  };
}

async function getInvoiceDetail(input: AgentToolInput): Promise<AgentToolResult> {
  const search = input.entityContext?.invoiceNumber ?? extractInvoiceSearch(input.request.message);
  const report = await getPaymentReport(paymentReportParams(input, search));
  const rows = limitRows(report.rows, 20);
  const dataStatus = rows.length > 0 ? "ok" : search ? "not_found" : "no_activity";

  return {
    toolName: "get_invoice_detail",
    sourceName: "BigQuery payment report",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus,
    live: false,
    summary:
      rows.length > 0
        ? undefined
        : search
          ? `No invoice detail rows matched "${search}" for ${input.period.label}.`
          : `No invoice detail rows were found for ${input.period.label}.`,
    tables: rows.length
      ? [
          {
            title: "Invoice detail",
            columns: [
              { key: "dateLabel", title: "Date" },
              { key: "invoiceNumber", title: "Invoice" },
              { key: "customerName", title: "Customer" },
              { key: "serviceName", title: "Service" },
              { key: "paymentMethod", title: "Method" },
              { key: "invoiceNetTotal", title: "Invoice total" },
            ],
            rows,
          },
        ]
      : undefined,
    entityRefs: report.rows.slice(0, 10).map((row, index) => ({
      entityType: "invoice",
      entityId: row.invoiceNumber,
      invoiceNumber: row.invoiceNumber,
      displayName: row.invoiceNumber,
      customerName: row.customerName,
      memberId: row.memberId,
      rank: index + 1,
    })),
  };
}

export function createFinanceTools(overrides: Partial<FinanceToolDeps> = {}): AgentToolDefinition[] {
  const deps = { ...defaultFinanceToolDeps, ...overrides };

  const tools: AgentToolDefinition[] = [
    {
      name: "get_sales_summary",
      agentId: "finance",
      description: "Get sourced sales summary for a date period.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery sales report",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: (input) => getSalesSummary(input, deps),
    },
    {
      name: "get_payment_summary",
      agentId: "finance",
      description: "Get sourced payment collection summary.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery payment report",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: (input) => getPaymentSummary(input, deps),
    },
    {
      name: "get_payment_method_breakdown",
      agentId: "finance",
      description: "Get sourced payment method totals.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery payment report",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getPaymentMethodBreakdown,
    },
    {
      name: "compare_sales_periods",
      agentId: "finance",
      description: "Compare sales with the previous period.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery sales report",
      live: false,
      maxRows: 25,
      timeoutMs: 20_000,
      execute: compareSalesPeriods,
    },
    {
      name: "get_customer_purchase_history",
      agentId: "finance",
      description: "Get customer purchase history from sourced payment rows.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery customer payment portal",
      live: false,
      maxRows: 20,
      timeoutMs: 15_000,
      execute: (input) => getCustomerPaymentHistory(input),
    },
    {
      name: "get_customer_payment_history",
      agentId: "finance",
      description: "Get customer payment history from sourced payment rows.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery customer payment portal",
      live: false,
      maxRows: 20,
      timeoutMs: 15_000,
      execute: getCustomerPaymentHistory,
    },
    {
      name: "get_invoice_detail",
      agentId: "finance",
      description: "Get invoice details from payment report rows.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery payment report",
      live: false,
      maxRows: 20,
      timeoutMs: 15_000,
      execute: getInvoiceDetail,
    },
  ];

  return tools.map((tool) => ({ ...tool, capability: "read_only" }));
}
