import { fetchApicorePaymentReport, type ApicorePaymentReportRow } from "../apicore.service.js";
import {
  buildBankingSummaryFromPaymentReportRows,
  type BankingSummaryWalletTopupFilter,
} from "./banking-summary.transform.js";

const PAYMENT_REPORT_BATCH_SIZE = 5000;

function toUtcBoundaryIso(date: string, boundary: "start" | "end") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) {
    return new Date(date).toISOString();
  }

  const [, year, month, day] = match;
  const hour = boundary === "start" ? 0 : 23;
  const minute = boundary === "start" ? 0 : 59;
  const second = boundary === "start" ? 0 : 59;
  const millisecond = boundary === "start" ? 0 : 999;

  return new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), hour, minute, second, millisecond),
  ).toISOString();
}

async function fetchAllLegacyPaymentRows(params: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  authorizationHeader?: string;
}) {
  const rows: ApicorePaymentReportRow[] = [];
  let totalCount = Number.POSITIVE_INFINITY;
  let skip = 0;

  while (rows.length < totalCount) {
    const batch = await fetchApicorePaymentReport({
      clinicCode: params.clinicCode,
      startDate: toUtcBoundaryIso(params.fromDate, "start"),
      endDate: toUtcBoundaryIso(params.toDate, "end"),
      skip,
      take: PAYMENT_REPORT_BATCH_SIZE,
      authorizationHeader: params.authorizationHeader,
    });

    rows.push(...batch.data);
    totalCount = batch.totalCount;

    if (batch.data.length < PAYMENT_REPORT_BATCH_SIZE) {
      break;
    }

    skip += batch.data.length;
  }

  return rows;
}

export async function getBankingSummary(params: {
  clinicCode: string;
  fromDate: string;
  toDate: string;
  search: string;
  paymentMethod: string;
  walletTopupFilter: BankingSummaryWalletTopupFilter;
  limit: number;
  offset: number;
  authorizationHeader?: string;
}) {
  const legacyRows = await fetchAllLegacyPaymentRows({
    clinicCode: params.clinicCode,
    fromDate: params.fromDate,
    toDate: params.toDate,
    authorizationHeader: params.authorizationHeader,
  });

  return buildBankingSummaryFromPaymentReportRows(legacyRows, {
    search: params.search,
    paymentMethod: params.paymentMethod,
    walletTopupFilter: params.walletTopupFilter,
    limit: params.limit,
    offset: params.offset,
  });
}
