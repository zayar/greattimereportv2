import { ApolloClient, useApolloClient } from "@apollo/client";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { useAccess } from "../../access/AccessProvider";
import type { WalletTransactionRow, WalletTransactionsResponse } from "../../../types/domain";
import { buildDatedExportFileName, downloadExcelWorkbook } from "../../../utils/exportExcel";
import { daysAgo, startOfCurrentMonth, today } from "../../../utils/date";
import {
  buildWalletTransactionsExportRows,
  formatWalletValue,
  getWalletDirectionLabel,
  getWalletDirectionTone,
  walletTransactionExportHeaders,
} from "./walletHelpers";
import {
  buildWalletSummaryVariables,
  buildWalletTransactionsVariables,
  GET_WALLET_SUMMARY,
  GET_WALLET_TRANSACTIONS_BY_CLINIC,
  type WalletSummaryQueryResponse,
  type WalletTransactionsByClinicResponse,
} from "./queries";
import { getClinicPassCode, mapLegacyWalletTransaction, matchesWalletTransactionSearch, summarizeWalletTransactions } from "./walletData";

const PAGE_SIZE = 25;
const EXPORT_BATCH_SIZE = 250;

async function loadAllWalletTransactions(
  client: ApolloClient<object>,
  clinicCode: string,
  fromDate: string,
  toDate: string,
) {
  const rows: WalletTransactionRow[] = [];
  let totalCount = Number.POSITIVE_INFINITY;
  let skip = 0;

  while (rows.length < totalCount) {
    const result = await client.query<WalletTransactionsByClinicResponse>({
      query: GET_WALLET_TRANSACTIONS_BY_CLINIC,
      variables: buildWalletTransactionsVariables({
        clinicCode,
        fromDate,
        toDate,
        take: EXPORT_BATCH_SIZE,
        skip,
      }),
      fetchPolicy: "network-only",
    });

    const response = result.data.getWalletTransactionsByClinic;
    const mappedRows = (response?.data ?? []).map(mapLegacyWalletTransaction);

    rows.push(...mappedRows);
    totalCount = Number(response?.totalCount ?? 0);

    if (mappedRows.length < EXPORT_BATCH_SIZE) {
      break;
    }

    skip += EXPORT_BATCH_SIZE;
  }

  return rows;
}

function renderIdentity(name: string, phone: string) {
  return (
    <div className="wallet-workspace__identity wallet-workspace__identity--compact">
      <strong>{name || "—"}</strong>
      <span>{phone || "No phone"}</span>
    </div>
  );
}

export function TransactionsPage() {
  const client = useApolloClient();
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WalletTransactionsResponse | null>(null);
  const [exporting, setExporting] = useState(false);
  const [range, setRange] = useState({
    fromDate: startOfCurrentMonth(),
    toDate: today(),
  });

  const passCode = getClinicPassCode(currentClinic);

  useEffect(() => {
    setPage(1);
  }, [currentClinic?.id, deferredSearch, range.fromDate, range.toDate]);

  useEffect(() => {
    if (!currentClinic || !passCode) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    const loadSummary = () =>
      client
        .query<WalletSummaryQueryResponse>({
          query: GET_WALLET_SUMMARY,
          variables: buildWalletSummaryVariables({
            clinicCode: passCode,
            fromDate: range.fromDate,
            toDate: range.toDate,
          }),
          fetchPolicy: "network-only",
        })
        .then((summaryResult) => summaryResult.data.getWalletSummary)
        .catch(() => null);

    if (!deferredSearch) {
      Promise.all([
        client.query<WalletTransactionsByClinicResponse>({
          query: GET_WALLET_TRANSACTIONS_BY_CLINIC,
          variables: buildWalletTransactionsVariables({
            clinicCode: passCode,
            fromDate: range.fromDate,
            toDate: range.toDate,
            take: PAGE_SIZE,
            skip: (page - 1) * PAGE_SIZE,
          }),
          fetchPolicy: "network-only",
        }),
        loadSummary(),
      ])
        .then(([rowsResult, summaryResult]) => {
          if (!active) {
            return;
          }

          const response = rowsResult.data.getWalletTransactionsByClinic;
          const mappedRows = (response?.data ?? []).map(mapLegacyWalletTransaction);
          const fallbackSummary = summarizeWalletTransactions(mappedRows);

          setData({
            summary: {
              totalIn: Number(summaryResult?.totalIn ?? fallbackSummary.totalIn),
              totalOut: Number(summaryResult?.totalOut ?? fallbackSummary.totalOut),
              transactionCount: Number(summaryResult?.transactionCount ?? fallbackSummary.transactionCount),
              netMovement: Number(summaryResult?.balance ?? fallbackSummary.netMovement),
            },
            rows: mappedRows,
            totalCount: Number(response?.totalCount ?? 0),
          });
        })
        .catch((loadError) => {
          if (!active) {
            return;
          }

          setData(null);
          setError(loadError instanceof Error ? loadError.message : "Failed to load wallet transactions.");
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });

      return () => {
        active = false;
      };
    }

    loadAllWalletTransactions(client, passCode, range.fromDate, range.toDate)
      .then((loadedRows) => {
        if (!active) {
          return;
        }

        const filteredRows = loadedRows.filter((row) => matchesWalletTransactionSearch(row, deferredSearch));
        const fallbackSummary = summarizeWalletTransactions(filteredRows);
        const pagedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

        setData({
          summary: fallbackSummary,
          rows: pagedRows,
          totalCount: filteredRows.length,
        });
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }

        setData(null);
        setError(loadError instanceof Error ? loadError.message : "Failed to load wallet transactions.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [client, currentClinic, deferredSearch, page, passCode, range.fromDate, range.toDate]);

  const rows = data?.rows ?? [];
  const summary = data?.summary;
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const visibleAccounts = useMemo(
    () => new Set(rows.map((row) => row.accountName).filter(Boolean)).size,
    [rows],
  );

  function applyPreset(type: "today" | "7d" | "30d" | "month") {
    if (type === "today") {
      setRange({
        fromDate: today(),
        toDate: today(),
      });
      return;
    }

    if (type === "7d") {
      setRange({
        fromDate: daysAgo(6),
        toDate: today(),
      });
      return;
    }

    if (type === "30d") {
      setRange({
        fromDate: daysAgo(29),
        toDate: today(),
      });
      return;
    }

    setRange({
      fromDate: startOfCurrentMonth(),
      toDate: today(),
    });
  }

  async function handleExport() {
    if (!passCode) {
      return;
    }

    setExporting(true);

    try {
      const exportRows = await loadAllWalletTransactions(client, passCode, range.fromDate, range.toDate);
      const filteredRows = deferredSearch
        ? exportRows.filter((row) => matchesWalletTransactionSearch(row, deferredSearch))
        : exportRows;

      await downloadExcelWorkbook({
        fileName: buildDatedExportFileName("wallet-transactions", range.fromDate, range.toDate),
        sheetName: "Transactions",
        headers: walletTransactionExportHeaders,
        rows: buildWalletTransactionsExportRows(filteredRows),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report internal-workspace internal-workspace--soft wallet-workspace wallet-workspace--transactions">
      <PageHeader title="Transactions" />

      {!passCode ? (
        <Panel
          className="internal-workspace__panel wallet-workspace__panel"
          title="Wallet transactions"
          subtitle="PASS transaction data is only available for clinics with PASS configured."
        >
          <EmptyState
            label="No PASS configuration found for this clinic"
            detail="Add the clinic PASS configuration first, then reload this page to inspect wallet transfers."
          />
        </Panel>
      ) : (
        <>
          <section className="wallet-workspace__toolbar">
            <div className="wallet-workspace__toolbar-group wallet-workspace__toolbar-group--filters">
              <div className="wallet-workspace__preset-row">
                <button className="button button--secondary" onClick={() => applyPreset("today")}>
                  Today
                </button>
                <button className="button button--secondary" onClick={() => applyPreset("7d")}>
                  7D
                </button>
                <button className="button button--secondary" onClick={() => applyPreset("30d")}>
                  30D
                </button>
                <button className="button button--secondary" onClick={() => applyPreset("month")}>
                  Month
                </button>
              </div>

              <DateRangeControls
                fromDate={range.fromDate}
                toDate={range.toDate}
                onChange={(next) => setRange(next)}
              />
            </div>

            <div className="wallet-workspace__toolbar-group wallet-workspace__toolbar-group--actions">
              <label className="field field--compact field--search wallet-workspace__search">
                <span>Search</span>
                <input
                  type="text"
                  value={search}
                  placeholder="Transaction no, sender, recipient, comment"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <button
                className="button button--secondary"
                disabled={loading || exporting || totalCount === 0}
                onClick={() => void handleExport()}
              >
                {exporting ? "Exporting..." : "Export Excel"}
              </button>
            </div>
          </section>

          {error ? <ErrorState label="Wallet transactions could not be loaded" detail={error} /> : null}

          <div className="report-kpi-strip">
            <article className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Points In</span>
              <strong className="report-kpi-strip__value">{formatWalletValue(summary?.totalIn ?? 0)}</strong>
              <span className="report-kpi-strip__hint">Inbound wallet movement in the selected date window.</span>
            </article>
            <article className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Points Out</span>
              <strong className="report-kpi-strip__value">{formatWalletValue(summary?.totalOut ?? 0)}</strong>
              <span className="report-kpi-strip__hint">Outbound wallet movement in the selected date window.</span>
            </article>
            <article className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Visible rows</span>
              <strong className="report-kpi-strip__value">{(summary?.transactionCount ?? 0).toLocaleString("en-US")}</strong>
              <span className="report-kpi-strip__hint">Ledger rows matched to the clinic, range, and search.</span>
            </article>
            <article className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Net movement</span>
              <strong className="report-kpi-strip__value">{formatWalletValue(summary?.netMovement ?? 0)}</strong>
              <span className="report-kpi-strip__hint">
                Wallet accounts represented on this page: {visibleAccounts.toLocaleString("en-US")}
              </span>
            </article>
          </div>

          <Panel
            className="internal-workspace__panel wallet-workspace__panel"
            title={`${currentClinic?.name ?? "Clinic"} wallet transactions`}
            subtitle={`${totalCount.toLocaleString("en-US")} wallet ledger rows in the selected range`}
            action={
              <div className="pagination-controls">
                <button className="button button--secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                  Previous
                </button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <button
                  className="button button--secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </button>
              </div>
            }
          >
            {loading ? <div className="inline-note inline-note--loading">Loading wallet transactions...</div> : null}
            {!loading && !error && rows.length === 0 ? (
              <EmptyState
                label="No wallet transactions matched these filters"
                detail="Try widening the date range or clearing the search."
              />
            ) : null}
            {rows.length > 0 ? (
              <DataTable
                rows={rows}
                rowKey={(row) => `${row.dateLabel}-${row.transactionNumber}-${row.status}-${row.accountName}`}
                columns={[
                  { key: "date", header: "Date", render: (row) => row.dateLabel || "—" },
                  {
                    key: "transaction",
                    header: "Transaction",
                    render: (row) => <span className="wallet-workspace__transaction-id">{row.transactionNumber || "—"}</span>,
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (row) => (
                      <span className={`status-pill status-pill--${getWalletDirectionTone(row.status)}`}>
                        {getWalletDirectionLabel(row.status)}
                      </span>
                    ),
                  },
                  { key: "amount", header: "Amount", render: (row) => formatWalletValue(row.amount) },
                  { key: "balance", header: "Balance", render: (row) => formatWalletValue(row.balance) },
                  {
                    key: "wallet",
                    header: "Wallet",
                    render: (row) => (
                      <div className="wallet-workspace__identity wallet-workspace__identity--compact">
                        <strong>{row.accountName || "—"}</strong>
                        <span>{row.type || "Transfer"}</span>
                      </div>
                    ),
                  },
                  {
                    key: "sender",
                    header: "Sender",
                    render: (row) => renderIdentity(row.senderName, row.senderPhone),
                  },
                  {
                    key: "recipient",
                    header: "Recipient",
                    render: (row) => renderIdentity(row.recipientName, row.recipientPhone),
                  },
                  {
                    key: "comment",
                    header: "Comment",
                    render: (row) => <span className="wallet-workspace__comment">{row.comment || "—"}</span>,
                  },
                ]}
              />
            ) : null}
          </Panel>
        </>
      )}
    </div>
  );
}
