import { formatCurrency } from "../../../utils/format";
import type { PaymentReportResponse } from "../../../types/domain";

export type SalesDetailRow = PaymentReportResponse["rows"][number] & {
  rowId: string;
  showInvoiceValues: boolean;
  walletLabel: string;
};

export type SalesSummaryRow = {
  rowId: string;
  dateLabel: string;
  invoiceNumber: string;
  customerName: string;
  memberId: string;
  salePerson: string;
  serviceNames: string;
  servicePackageNames: string;
  walletLabel: string;
  itemRows: number;
  total: number | null;
  discount: number | null;
  netTotal: number | null;
  orderBalance: number | null;
  orderCreditBalance: number | null;
  tax: number | null;
  invoiceNetTotal: number | null;
  paymentStatus: string;
  paymentMethod: string;
  paymentType: string;
  paymentAmount: number | null;
  paymentNote: string;
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
  "Item Quantity",
  "Item Price",
  "Item Total",
  "Sub Total",
  "Total",
  "Discount",
  "Net Total",
  "Order Balance",
  "Order Credit Balance",
  "Tax",
  "Invoice Total",
  "Payment Status",
  "Payment Method",
  "Payment Type",
  "Payment Amount",
  "Payment Note",
];

export const SALES_SUMMARY_HEADERS = [
  "Date",
  "Invoice Number",
  "Customer Name",
  "Member ID",
  "Sale Person",
  "Services",
  "Service Packages",
  "Wallet",
  "Item Rows",
  "Total",
  "Discount",
  "Net Total",
  "Order Balance",
  "Order Credit Balance",
  "Tax",
  "Invoice Total",
  "Payment Status",
  "Payment Method",
  "Payment Type",
  "Payment Amount",
  "Payment Note",
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

function appendUnique(values: string[], value: string | number | null | undefined) {
  const text = String(value ?? "").trim();
  if (text !== "" && !values.includes(text)) {
    values.push(text);
  }
}

export function buildSalesSummaryRows(rows: SalesDetailRow[]): SalesSummaryRow[] {
  const byInvoice = new Map<
    string,
    SalesSummaryRow & {
      hasPaymentAmount: boolean;
      paymentStatuses: string[];
      paymentMethods: string[];
      paymentTypes: string[];
      paymentNotes: string[];
      serviceNameValues: string[];
      servicePackageValues: string[];
      walletValues: string[];
    }
  >();

  rows.forEach((row) => {
    const existing =
      byInvoice.get(row.invoiceNumber) ??
      ({
        rowId: row.invoiceNumber,
        dateLabel: row.dateLabel,
        invoiceNumber: row.invoiceNumber,
        customerName: row.customerName,
        memberId: row.memberId,
        salePerson: row.salePerson,
        serviceNames: EMPTY_VIEW_VALUE,
        servicePackageNames: EMPTY_VIEW_VALUE,
        walletLabel: EMPTY_VIEW_VALUE,
        itemRows: 0,
        total: row.total ?? null,
        discount: row.discount ?? null,
        netTotal: row.netTotal ?? null,
        orderBalance: row.orderBalance ?? null,
        orderCreditBalance: row.orderCreditBalance ?? null,
        tax: row.tax ?? null,
        invoiceNetTotal: row.invoiceNetTotal ?? null,
        paymentStatus: EMPTY_VIEW_VALUE,
        paymentMethod: EMPTY_VIEW_VALUE,
        paymentType: EMPTY_VIEW_VALUE,
        paymentAmount: null,
        paymentNote: EMPTY_VIEW_VALUE,
        hasPaymentAmount: false,
        paymentStatuses: [],
        paymentMethods: [],
        paymentTypes: [],
        paymentNotes: [],
        serviceNameValues: [],
        servicePackageValues: [],
        walletValues: [],
      } satisfies SalesSummaryRow & {
        hasPaymentAmount: boolean;
        paymentStatuses: string[];
        paymentMethods: string[];
        paymentTypes: string[];
        paymentNotes: string[];
        serviceNameValues: string[];
        servicePackageValues: string[];
        walletValues: string[];
      });

    existing.itemRows += 1;
    appendUnique(existing.serviceNameValues, row.serviceName);
    appendUnique(existing.servicePackageValues, row.servicePackageName);
    appendUnique(existing.walletValues, row.walletLabel === EMPTY_VIEW_VALUE ? "" : row.walletLabel);
    appendUnique(existing.paymentStatuses, row.paymentStatus);
    appendUnique(existing.paymentMethods, row.paymentMethod);
    appendUnique(existing.paymentTypes, row.paymentType);
    appendUnique(existing.paymentNotes, row.paymentNote);

    if (row.paymentAmount != null) {
      existing.paymentAmount = (existing.paymentAmount ?? 0) + row.paymentAmount;
      existing.hasPaymentAmount = true;
    }

    byInvoice.set(row.invoiceNumber, existing);
  });

  return Array.from(byInvoice.values()).map((row) => ({
    rowId: row.rowId,
    dateLabel: row.dateLabel,
    invoiceNumber: row.invoiceNumber,
    customerName: row.customerName,
    memberId: row.memberId,
    salePerson: row.salePerson,
    serviceNames: row.serviceNameValues.length > 0 ? row.serviceNameValues.join(", ") : EMPTY_VIEW_VALUE,
    servicePackageNames: row.servicePackageValues.length > 0 ? row.servicePackageValues.join(", ") : EMPTY_VIEW_VALUE,
    walletLabel: row.walletValues.length > 0 ? row.walletValues.join(", ") : EMPTY_VIEW_VALUE,
    itemRows: row.itemRows,
    total: row.total,
    discount: row.discount,
    netTotal: row.netTotal,
    orderBalance: row.orderBalance,
    orderCreditBalance: row.orderCreditBalance,
    tax: row.tax,
    invoiceNetTotal: row.invoiceNetTotal,
    paymentStatus: row.paymentStatuses.length > 0 ? row.paymentStatuses.join(", ") : EMPTY_VIEW_VALUE,
    paymentMethod: row.paymentMethods.length > 0 ? row.paymentMethods.join(", ") : EMPTY_VIEW_VALUE,
    paymentType: row.paymentTypes.length > 0 ? row.paymentTypes.join(", ") : EMPTY_VIEW_VALUE,
    paymentAmount: row.hasPaymentAmount ? row.paymentAmount : null,
    paymentNote: row.paymentNotes.length > 0 ? row.paymentNotes.join(" | ") : EMPTY_VIEW_VALUE,
  }));
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
    formatCsvCurrency(row.paymentAmount, currency),
    formatCsvText(row.paymentNote),
  ]);
}

export function buildSalesSummaryCsvRows(rows: SalesSummaryRow[], currency: string) {
  return rows.map((row) => [
    row.dateLabel,
    row.invoiceNumber,
    row.customerName,
    formatCsvText(row.memberId),
    formatCsvText(row.salePerson),
    row.serviceNames,
    row.servicePackageNames,
    row.walletLabel,
    row.itemRows,
    formatCsvCurrency(row.total, currency),
    formatCsvCurrency(row.discount, currency),
    formatCsvCurrency(row.netTotal, currency),
    formatCsvCurrency(row.orderBalance, currency),
    formatCsvCurrency(row.orderCreditBalance, currency),
    formatCsvCurrency(row.tax, currency),
    formatCsvCurrency(row.invoiceNetTotal, currency),
    row.paymentStatus,
    row.paymentMethod,
    row.paymentType,
    formatCsvCurrency(row.paymentAmount, currency),
    row.paymentNote,
  ]);
}
