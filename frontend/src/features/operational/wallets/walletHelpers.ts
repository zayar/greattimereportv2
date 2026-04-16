import type { WalletAccountSummaryRow, WalletTransactionRow } from "../../../types/domain";

export const walletTransactionExportHeaders = [
  "Date",
  "Transaction Number",
  "Type",
  "Status",
  "Amount",
  "Balance",
  "Comment",
  "Wallet",
  "Sender Name",
  "Sender Phone",
  "Recipient Name",
  "Recipient Phone",
];

export function buildWalletAccountKey(account: Pick<WalletAccountSummaryRow, "name" | "phoneNumber">) {
  return `${account.name}::${account.phoneNumber}`;
}

export function formatWalletValue(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

export function getWalletDirectionLabel(status: string | null | undefined) {
  const normalized = (status ?? "").toUpperCase();

  if (normalized === "IN") {
    return "IN";
  }

  if (normalized === "OUT") {
    return "OUT";
  }

  return normalized || "—";
}

export function getWalletDirectionTone(status: string | null | undefined) {
  const normalized = (status ?? "").toUpperCase();

  if (normalized === "IN") {
    return "positive";
  }

  if (normalized === "OUT") {
    return "attention";
  }

  return "neutral";
}

export function getWalletCounterpartyLabel(row: Pick<WalletTransactionRow, "status" | "senderName" | "senderPhone" | "recipientName" | "recipientPhone">) {
  const normalized = (row.status ?? "").toUpperCase();
  const sender = row.senderName || row.senderPhone || "Unknown sender";
  const recipient = row.recipientName || row.recipientPhone || "Unknown recipient";

  if (normalized === "IN") {
    return `From ${sender}`;
  }

  if (normalized === "OUT") {
    return `To ${recipient}`;
  }

  return sender !== "Unknown sender" ? sender : recipient;
}

export function buildWalletAccountsExportRows(rows: WalletAccountSummaryRow[]) {
  return rows.map((row) => [
    row.name,
    row.phoneNumber || "",
    Number(row.balance ?? 0),
    Number(row.transactionCount ?? 0),
  ]);
}

export function buildWalletTransactionsExportRows(rows: WalletTransactionRow[]) {
  return rows.map((row) => [
    row.dateLabel,
    row.transactionNumber,
    row.type,
    row.status,
    Number(row.amount ?? 0),
    Number(row.balance ?? 0),
    row.comment || "",
    row.accountName || "",
    row.senderName || "",
    row.senderPhone || "",
    row.recipientName || "",
    row.recipientPhone || "",
  ]);
}
