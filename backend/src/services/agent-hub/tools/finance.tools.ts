import { z } from "zod";
import { shiftRange } from "../../../utils/date-range.js";
import { getCustomerPortalPayments } from "../../reports/customer-portal.service.js";
import { getPaymentReport } from "../../reports/payment-report.service.js";
import { getSalesReport } from "../../reports/sales-report.service.js";
import { limitRows, nowIso } from "../safety.js";
import type { AgentToolDefinition, AgentToolInput, AgentToolResult } from "../types.js";

const toolInputSchema = z.custom<AgentToolInput>(() => true);

function periodLabel(input: AgentToolInput) {
  return `${input.period.fromDate} to ${input.period.toDate}`;
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

function extractInvoiceSearch(message: string) {
  return message.match(/\b[A-Z]{1,5}[-_/]?\d{3,}\b/i)?.[0] ?? message.replace(/invoice|detail|voucher/gi, "").trim().slice(0, 80);
}

async function getSalesSummary(input: AgentToolInput): Promise<AgentToolResult> {
  const report = await getSalesReport({
    clinicCode: input.clinic.clinicCode,
    fromDate: input.period.fromDate,
    toDate: input.period.toDate,
    search: "",
    limit: 10,
    offset: 0,
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

async function getPaymentSummary(input: AgentToolInput): Promise<AgentToolResult> {
  const report = await getPaymentReport(paymentReportParams(input));

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

  return {
    toolName: "get_invoice_detail",
    sourceName: "BigQuery payment report",
    checkedAt: nowIso(),
    period: periodLabel(input),
    dataStatus: report.rows.length > 0 ? "ok" : "not_found",
    live: false,
    tables: [
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
        rows: limitRows(report.rows, 20),
      },
    ],
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

export function createFinanceTools(): AgentToolDefinition[] {
  return [
    {
      name: "get_sales_summary",
      agentId: "finance",
      description: "Get sourced sales summary for a date period.",
      inputSchema: toolInputSchema,
      sourceName: "BigQuery sales report",
      live: false,
      maxRows: 25,
      timeoutMs: 15_000,
      execute: getSalesSummary,
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
      execute: getPaymentSummary,
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
}
