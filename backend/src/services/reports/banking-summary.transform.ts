import type { ApicorePaymentReportRow } from "../apicore.service.js";

export type BankingSummaryWalletTopupFilter = "all" | "hide" | "only";

export type BankingSummaryRow = {
  dateLabel: string;
  invoiceNumber: string;
  customerName: string;
  memberId: string;
  salePerson: string;
  serviceName: string;
  servicePackageName: string | null;
  paymentMethod: string;
  paymentStatus: string;
  walletTopUp: string | number | null;
  invoiceNetTotal: number;
};

export type BankingSummaryBuildParams = {
  search: string;
  paymentMethod: string;
  walletTopupFilter: BankingSummaryWalletTopupFilter;
  limit: number;
  offset: number;
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

function normalizeText(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function includesSearch(row: BankingSummaryRow, search: string) {
  const normalizedSearch = search.trim().toLowerCase();

  if (!normalizedSearch) {
    return true;
  }

  return [
    row.invoiceNumber,
    row.customerName,
    row.memberId,
    row.salePerson,
    row.serviceName,
    row.servicePackageName,
  ].some((value) => normalizeText(value).includes(normalizedSearch));
}

export function isWalletTopupRow(row: Pick<BankingSummaryRow, "invoiceNumber" | "walletTopUp">) {
  const walletValue = normalizeText(row.walletTopUp);

  return (
    row.invoiceNumber.startsWith("TO") ||
    walletValue.includes("point") ||
    walletValue.includes("topup")
  );
}

function isPaymentSummaryRow(row: BankingSummaryRow) {
  return row.paymentMethod !== "" && row.invoiceNetTotal !== 0;
}

function matchesWalletFilter(row: BankingSummaryRow, filter: BankingSummaryWalletTopupFilter) {
  if (filter === "all") {
    return true;
  }

  const isTopup = isWalletTopupRow(row);
  return filter === "only" ? isTopup : !isTopup;
}

function mapPaymentReportRow(row: ApicorePaymentReportRow): BankingSummaryRow {
  return {
    dateLabel: String(row.Date ?? ""),
    invoiceNumber: row.InvoiceNumber ?? "",
    customerName: row.CustomerName ?? "",
    memberId: row.MemberId ?? "",
    salePerson: row.SalePerson ?? "",
    serviceName: row.ServiceName ?? "",
    servicePackageName: row.ServicePackageName ?? null,
    paymentMethod: row.PaymentMethod ?? "",
    paymentStatus: row.PaymentStatus ?? "",
    walletTopUp: row.WalletTopUp ?? null,
    invoiceNetTotal: parseNumber(row.InvoiceNetTotal),
  };
}

function summarizeRows(rows: BankingSummaryRow[]) {
  const totalRevenue = rows.reduce((total, row) => total + row.invoiceNetTotal, 0);
  const transactionCount = rows.length;
  const methodsCount = new Set(rows.map((row) => row.paymentMethod)).size;

  return {
    totalRevenue,
    transactionCount,
    methodsCount,
    averageTicket: transactionCount === 0 ? 0 : totalRevenue / transactionCount,
  };
}

function summarizeMethods(rows: BankingSummaryRow[]) {
  const grouped = new Map<
    string,
    { paymentMethod: string; totalAmount: number; transactionCount: number; averageTicket: number }
  >();

  for (const row of rows) {
    const existing =
      grouped.get(row.paymentMethod) ??
      {
        paymentMethod: row.paymentMethod,
        totalAmount: 0,
        transactionCount: 0,
        averageTicket: 0,
      };

    existing.totalAmount += row.invoiceNetTotal;
    existing.transactionCount += 1;
    grouped.set(row.paymentMethod, existing);
  }

  return [...grouped.values()]
    .map((row) => ({
      ...row,
      averageTicket: row.transactionCount === 0 ? 0 : row.totalAmount / row.transactionCount,
    }))
    .sort((left, right) => right.totalAmount - left.totalAmount || left.paymentMethod.localeCompare(right.paymentMethod));
}

export function buildBankingSummaryFromPaymentReportRows(
  paymentRows: ApicorePaymentReportRow[],
  params: BankingSummaryBuildParams,
) {
  const filteredRows = paymentRows
    .map(mapPaymentReportRow)
    .filter((row) => includesSearch(row, params.search))
    .filter((row) => matchesWalletFilter(row, params.walletTopupFilter));

  const methodSummaryRows = filteredRows.filter(isPaymentSummaryRow);
  const detailRows = params.paymentMethod
    ? filteredRows.filter((row) => row.paymentMethod.toLowerCase() === params.paymentMethod.toLowerCase())
    : filteredRows;
  const selectedSummaryRows = detailRows.filter(isPaymentSummaryRow);
  const pagedRows = detailRows.slice(params.offset, params.offset + params.limit);

  return {
    summary: summarizeRows(selectedSummaryRows),
    methods: summarizeMethods(methodSummaryRows),
    rows: pagedRows,
    totalCount: detailRows.length,
  };
}
