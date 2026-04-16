import type { Clinic, WalletAccountSummaryRow, WalletTransactionRow, WalletTransactionsResponse } from "../../../types/domain";
import type { LegacyWalletTransactionRow, PassAccountQueryRow, PassTransactionQueryRow } from "./queries";

export type ClinicPassConfig = {
  id: string;
  refresh_token?: string | null;
  refresh_token_url?: string | null;
};

export function getClinicPassConfig(clinic: Pick<Clinic, "pass"> | null | undefined): ClinicPassConfig | null {
  const raw = clinic?.pass?.trim();

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      id?: string | null;
      refresh_token?: string | null;
      refresh_token_url?: string | null;
    };
    const id = parsed?.id?.trim();

    if (!id) {
      return null;
    }

    return {
      id,
      refresh_token: parsed.refresh_token?.trim() || null,
      refresh_token_url: parsed.refresh_token_url?.trim() || null,
    };
  } catch {
    return {
      id: raw,
      refresh_token: null,
      refresh_token_url: null,
    };
  }
}

export function getClinicPassCode(clinic: Pick<Clinic, "pass"> | null | undefined) {
  return getClinicPassConfig(clinic)?.id ?? "";
}

export function mapPassAccountRow(row: PassAccountQueryRow): WalletAccountSummaryRow {
  return {
    id: row.id,
    name: row.customer?.name?.trim() || "—",
    phoneNumber: row.customer?.phone_number?.trim() || "",
    balance: Number(row.balance ?? 0),
    transactionCount: Number(row._count?.transactions ?? 0),
  };
}

export function mapLegacyWalletTransaction(row: LegacyWalletTransactionRow): WalletTransactionRow {
  return {
    dateLabel: row.createddate_myanmar?.trim() || "",
    transactionNumber: row.transactionNumber?.trim() || "",
    type: row.type?.trim() || "Transfer",
    status: row.status?.trim() || "",
    amount: Number(row.balance ?? 0),
    balance: Number(row.accountbalance ?? 0),
    comment: row.comment?.trim() || "",
    accountName: row.mainAccountName?.trim() || "",
    senderName: row.senderName?.trim() || "",
    senderPhone: row.senderPhone?.trim() || "",
    recipientName: row.recipientName?.trim() || "",
    recipientPhone: row.recipientPhone?.trim() || "",
  };
}

export function mapPassTransactionRow(
  row: PassTransactionQueryRow,
  account: Pick<WalletAccountSummaryRow, "name" | "phoneNumber">,
): WalletTransactionRow {
  const senderName = row.transaction_detail?.sender?.customer?.name?.trim() || "";
  const recipientName = row.transaction_detail?.recipient?.customer?.name?.trim() || "";

  return {
    dateLabel: row.created_at,
    transactionNumber: row.transaction_number?.trim() || "",
    type: row.transaction_type?.trim() || "Transfer",
    status: row.transaction_status?.trim() || "",
    amount: Number(row.balance ?? 0),
    balance: Number(row.balance ?? 0),
    comment: row.comment?.trim() || "",
    accountName: account.name,
    senderName,
    senderPhone: "",
    recipientName,
    recipientPhone: "",
  };
}

export function matchesWalletTransactionSearch(row: WalletTransactionRow, search: string) {
  const trimmed = search.trim().toLowerCase();

  if (!trimmed) {
    return true;
  }

  const haystack = [
    row.transactionNumber,
    row.type,
    row.status,
    row.comment,
    row.accountName,
    row.senderName,
    row.senderPhone,
    row.recipientName,
    row.recipientPhone,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(trimmed);
}

export function summarizeWalletTransactions(rows: WalletTransactionRow[]): WalletTransactionsResponse["summary"] {
  return rows.reduce(
    (summary, row) => {
      const amount = Number(row.amount ?? 0);
      const direction = row.status.toUpperCase();

      if (direction === "IN") {
        summary.totalIn += amount;
      } else if (direction === "OUT") {
        summary.totalOut += amount;
      }

      summary.transactionCount += 1;
      summary.netMovement = summary.totalIn - summary.totalOut;
      return summary;
    },
    {
      totalIn: 0,
      totalOut: 0,
      transactionCount: 0,
      netMovement: 0,
    },
  );
}
