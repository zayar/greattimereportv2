import { formatCurrency } from "../../../utils/format";
import type { PaymentReportResponse } from "../../../types/domain";

export type SalesDetailRow = PaymentReportResponse["rows"][number] & {
  rowId: string;
  showInvoiceValues: boolean;
  walletLabel: string;
};

export const SALES_DETAILS_HEADERS = [
  "Date",
  "Invoice Number",
  "Customer Name",
  "Member ID",
  "Sale Person",
  "Service Name",
  "Service Package",
  "Wallet",
  "Qty",
  "Item Price",
  "Item Total",
  "Sub Total",
  "Total",
  "Discount",
  "Net Total",
  "Order Balance",
  "Order Credit",
  "Tax",
  "Invoice Total",
  "Payment Status",
  "Payment Method",
  "Payment Type",
];

const EMPTY_VIEW_VALUE = "—";

export function formatSalesDetailWalletLabel(value: string | number | null | undefined) {
  if (value == null || value === "") {
    return EMPTY_VIEW_VALUE;
  }

  if (typeof value === "number") {
    return value > 0 ? "Topup" : EMPTY_VIEW_VALUE;
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
  return value == null ? EMPTY_VIEW_VALUE : formatCurrency(value, currency);
}

function formatCsvText(value: string | number | null | undefined) {
  return value == null || value === "" ? EMPTY_VIEW_VALUE : value;
}

export function buildSalesDetailsCsvRows(rows: SalesDetailRow[], currency: string) {
  return rows.map((row) => [
    row.dateLabel,
    row.invoiceNumber,
    row.customerName,
    formatCsvText(row.memberId),
    formatCsvText(row.salePerson),
    formatCsvText(row.serviceName),
    formatCsvText(row.servicePackageName),
    row.walletLabel,
    row.itemQuantity ?? EMPTY_VIEW_VALUE,
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
    formatCsvText(row.paymentStatus),
    formatCsvText(row.paymentMethod),
    formatCsvText(row.paymentType),
  ]);
}
