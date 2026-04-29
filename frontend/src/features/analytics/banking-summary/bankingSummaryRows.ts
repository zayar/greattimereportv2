import type { BankingSummaryResponse } from "../../../types/domain";
import { formatCurrency } from "../../../utils/format";

const EMPTY_VIEW_VALUE = "—";

export const BANKING_DETAILS_HEADERS = [
  "Date",
  "Invoice Number",
  "Customer Name",
  "Member ID",
  "Sale Person",
  "Service Name",
  "Service Package",
  "Payment Method",
  "Payment Status",
  "Wallet Top Up",
  "Invoice Net Total",
];

export type BankingDetailRow = BankingSummaryResponse["rows"][number] & {
  rowId: string;
  walletLabel: string;
};

export function formatBankingWalletLabel(value: string | number | null | undefined) {
  if (value == null || value === "") {
    return EMPTY_VIEW_VALUE;
  }

  if (typeof value === "number") {
    return value > 0 ? "Topup" : EMPTY_VIEW_VALUE;
  }

  const normalized = value.toLowerCase();
  if (normalized.includes("point") || normalized.includes("topup")) {
    return "Topup";
  }

  return value;
}

function formatCsvText(value: string | number | null | undefined) {
  return value == null || value === "" ? EMPTY_VIEW_VALUE : value;
}

export function buildBankingDetailRows(rows: BankingSummaryResponse["rows"]): BankingDetailRow[] {
  return rows.map((row, index) => ({
    ...row,
    rowId: `${row.invoiceNumber}-${row.paymentMethod}-${index}`,
    walletLabel: formatBankingWalletLabel(row.walletTopUp),
  }));
}

export function buildBankingDetailsCsvRows(rows: BankingDetailRow[], currency: string) {
  return rows.map((row) => [
    row.dateLabel,
    row.invoiceNumber,
    row.customerName,
    formatCsvText(row.memberId),
    formatCsvText(row.salePerson),
    formatCsvText(row.serviceName),
    formatCsvText(row.servicePackageName),
    formatCsvText(row.paymentMethod),
    formatCsvText(row.paymentStatus),
    row.walletLabel,
    formatCurrency(row.invoiceNetTotal, currency),
  ]);
}
