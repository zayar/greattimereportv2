import { formatCurrency } from "../../../utils/format";
import type { PaymentReportResponse } from "../../../types/domain";

export type SalesDetailRow = PaymentReportResponse["rows"][number] & {
  rowId: string;
  showInvoiceValues: boolean;
  walletLabel: string;
};

export function formatSalesDetailWalletLabel(value: string | number | null | undefined) {
  if (value == null || value === "") {
    return "—";
  }

  if (typeof value === "number") {
    return value > 0 ? "Topup" : "—";
  }

  return value.includes("*Point") ? "Topup" : value;
}

export function buildSalesDetailRows(rows: PaymentReportResponse["rows"]): SalesDetailRow[] {
  let previousInvoice = "";

  return rows.map((row, index) => {
    const showInvoiceValues = row.invoiceNumber !== previousInvoice;
    previousInvoice = row.invoiceNumber;

    return {
      ...row,
      rowId: `${row.invoiceNumber}-${row.serviceName ?? "item"}-${index}`,
      showInvoiceValues,
      walletLabel: formatSalesDetailWalletLabel(row.walletTopUp),
    };
  });
}

export function getGroupedInvoiceValue<T>(row: Pick<SalesDetailRow, "showInvoiceValues">, value: T | null | undefined) {
  return row.showInvoiceValues ? (value ?? null) : null;
}

function formatCsvCurrency(value: number | null | undefined, currency: string) {
  return value == null ? "" : formatCurrency(value, currency);
}

export function buildSalesDetailsCsvRows(rows: SalesDetailRow[], currency: string) {
  return rows.map((row) => [
    row.dateLabel,
    row.invoiceNumber,
    row.customerName,
    row.memberId || "",
    row.salePerson || "",
    row.serviceName || "",
    row.servicePackageName || "",
    row.walletLabel,
    row.itemQuantity ?? "",
    formatCsvCurrency(row.itemPrice, currency),
    formatCsvCurrency(row.itemTotal, currency),
    formatCsvCurrency(row.subTotal, currency),
    formatCsvCurrency(getGroupedInvoiceValue(row, row.total), currency),
    formatCsvCurrency(getGroupedInvoiceValue(row, row.discount), currency),
    formatCsvCurrency(getGroupedInvoiceValue(row, row.netTotal), currency),
    formatCsvCurrency(getGroupedInvoiceValue(row, row.orderBalance), currency),
    formatCsvCurrency(getGroupedInvoiceValue(row, row.orderCreditBalance), currency),
    formatCsvCurrency(getGroupedInvoiceValue(row, row.tax), currency),
    formatCsvCurrency(getGroupedInvoiceValue(row, row.invoiceNetTotal), currency),
    row.paymentStatus || "",
    row.paymentMethod || "",
    row.paymentType || "",
  ]);
}
