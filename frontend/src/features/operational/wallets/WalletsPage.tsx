import { Fragment, useDeferredValue, useEffect, useMemo, useState } from "react";
import { queryPassGraphql } from "../../../api/pass";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { useAccess } from "../../access/AccessProvider";
import type { WalletAccountSummaryRow, WalletTransactionRow } from "../../../types/domain";
import { downloadExcelWorkbook } from "../../../utils/exportExcel";
import {
  buildWalletAccountKey,
  buildWalletAccountsExportRows,
  formatWalletValue,
  getWalletCounterpartyLabel,
  getWalletDirectionLabel,
  getWalletDirectionTone,
} from "./walletHelpers";
import {
  buildPassAccountsCountVariables,
  buildPassAccountsVariables,
  buildPassAccountTransactionsVariables,
  GET_PASS_ACCOUNTS,
  GET_PASS_ACCOUNTS_COUNT,
  GET_PASS_ACCOUNT_TRANSACTIONS,
  type PassAccountsCountResponse,
  type PassAccountsQueryResponse,
  type PassTransactionsQueryResponse,
} from "./queries";
import { getClinicPassConfig, mapPassAccountRow, mapPassTransactionRow, type ClinicPassConfig } from "./walletData";

const PAGE_SIZE = 25;
const DETAIL_PAGE_SIZE = 10;
const EXPORT_BATCH_SIZE = 200;

type AccountDetailState = {
  loading: boolean;
  error: string | null;
  rows: WalletTransactionRow[];
  totalCount: number;
  page: number;
};

async function loadAllWalletAccounts(
  passConfig: ClinicPassConfig,
  searchText: string,
) {
  const countResult = await queryPassGraphql<PassAccountsCountResponse>({
    query: GET_PASS_ACCOUNTS_COUNT,
    variables: buildPassAccountsCountVariables(passConfig.id, searchText),
    passConfig,
  });

  const totalCount = Number(countResult.aggregateAccount?._count?.id ?? 0);
  const rows: WalletAccountSummaryRow[] = [];
  let skip = 0;

  while (rows.length < totalCount) {
    const result = await queryPassGraphql<PassAccountsQueryResponse>({
      query: GET_PASS_ACCOUNTS,
      variables: buildPassAccountsVariables({
        passCode: passConfig.id,
        searchText,
        take: EXPORT_BATCH_SIZE,
        skip,
      }),
      passConfig,
    });

    const mappedRows = (result.accounts ?? []).map(mapPassAccountRow);
    rows.push(...mappedRows);

    if (mappedRows.length < EXPORT_BATCH_SIZE) {
      break;
    }

    skip += EXPORT_BATCH_SIZE;
  }

  return rows;
}

export function WalletsPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allRows, setAllRows] = useState<WalletAccountSummaryRow[]>([]);
  const [exporting, setExporting] = useState(false);
  const [expandedAccountKey, setExpandedAccountKey] = useState<string | null>(null);
  const [detailPages, setDetailPages] = useState<Record<string, number>>({});
  const [detailByKey, setDetailByKey] = useState<Record<string, AccountDetailState>>({});

  const passConfig = useMemo(
    () => getClinicPassConfig(currentClinic),
    [currentClinic?.id, currentClinic?.pass],
  );
  const passCode = passConfig?.id ?? "";

  useEffect(() => {
    setPage(1);
  }, [currentClinic?.id, deferredSearch]);

  useEffect(() => {
    if (!currentClinic || !passConfig) {
      setAllRows([]);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    loadAllWalletAccounts(passConfig, deferredSearch)
      .then((rows) => {
        if (active) {
          setAllRows(rows);
        }
      })
      .catch((loadError) => {
        if (active) {
          setAllRows([]);
          setError(loadError instanceof Error ? loadError.message : "Failed to load wallets.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [currentClinic, deferredSearch, passConfig]);

  const totalCount = allRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const rows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return allRows.slice(start, start + PAGE_SIZE);
  }, [allRows, page]);

  const summary = useMemo(() => {
    const totalBalance = allRows.reduce((sum, row) => sum + Number(row.balance ?? 0), 0);
    const totalTransactionCount = allRows.reduce((sum, row) => sum + Number(row.transactionCount ?? 0), 0);
    const highestBalance = allRows.reduce((highest, row) => Math.max(highest, Number(row.balance ?? 0)), 0);

    return {
      accountCount: allRows.length,
      totalBalance,
      totalTransactionCount,
      averageBalance: allRows.length > 0 ? totalBalance / allRows.length : 0,
      highestBalance,
    };
  }, [allRows]);

  useEffect(() => {
    if (!expandedAccountKey) {
      return;
    }

    const isVisible = rows.some((row) => buildWalletAccountKey(row) === expandedAccountKey);
    if (!isVisible) {
      setExpandedAccountKey(null);
    }
  }, [expandedAccountKey, rows]);

  const expandedAccount = useMemo(
    () => (expandedAccountKey ? rows.find((row) => buildWalletAccountKey(row) === expandedAccountKey) ?? null : null),
    [expandedAccountKey, rows],
  );
  const expandedPage = expandedAccountKey ? detailPages[expandedAccountKey] ?? 1 : 1;

  useEffect(() => {
    if (!expandedAccount || !expandedAccountKey) {
      return;
    }

    const cached = detailByKey[expandedAccountKey];
    if (
      cached &&
      cached.page === expandedPage &&
      !cached.error &&
      (cached.rows.length > 0 || cached.totalCount === 0)
    ) {
      return;
    }

    let active = true;
    setDetailByKey((previous) => ({
      ...previous,
      [expandedAccountKey]: {
        loading: true,
        error: null,
        rows: previous[expandedAccountKey]?.rows ?? [],
        totalCount: previous[expandedAccountKey]?.totalCount ?? 0,
        page: expandedPage,
      },
    }));

    queryPassGraphql<PassTransactionsQueryResponse>({
        query: GET_PASS_ACCOUNT_TRANSACTIONS,
        variables: buildPassAccountTransactionsVariables({
          accountId: expandedAccount.id ?? "",
          take: DETAIL_PAGE_SIZE,
          skip: (expandedPage - 1) * DETAIL_PAGE_SIZE,
        }),
        passConfig: passConfig ?? { id: passCode },
      })
      .then((result) => {
        if (!active) {
          return;
        }

        setDetailByKey((previous) => ({
          ...previous,
          [expandedAccountKey]: {
            loading: false,
            error: null,
            rows: (result.transactions ?? []).map((row) => mapPassTransactionRow(row, expandedAccount)),
            totalCount: expandedAccount.transactionCount,
            page: expandedPage,
          },
        }));
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }

        setDetailByKey((previous) => ({
          ...previous,
          [expandedAccountKey]: {
            loading: false,
            error:
              loadError instanceof Error ? loadError.message : "Failed to load wallet transactions.",
            rows: previous[expandedAccountKey]?.rows ?? [],
            totalCount: expandedAccount.transactionCount,
            page: expandedPage,
          },
        }));
      });

    return () => {
      active = false;
    };
  }, [detailByKey, expandedAccount, expandedAccountKey, expandedPage, passCode, passConfig]);

  async function handleExport() {
    if (!currentClinic || !passConfig) {
      return;
    }

    setExporting(true);

    try {
      const exportRows = allRows.length > 0 ? allRows : await loadAllWalletAccounts(passConfig, deferredSearch);

      await downloadExcelWorkbook({
        fileName: `wallets-${currentClinic.code}-${new Date().toISOString().slice(0, 10)}`,
        sheetName: "Wallets",
        headers: ["Wallet Name", "Phone Number", "Balance", "Transaction Count"],
        rows: buildWalletAccountsExportRows(exportRows),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report internal-workspace internal-workspace--soft wallet-workspace wallet-workspace--accounts">
      <PageHeader
        title="Wallets"
        actions={
          <div className="filter-row internal-workspace__filters wallet-workspace__filters">
            <label className="field field--compact field--search wallet-workspace__search">
              <span>Search</span>
              <input
                type="text"
                value={search}
                placeholder={`Search ${summary.accountCount || totalCount} wallet account(s)`}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button
              className="button button--secondary"
              disabled={loading || exporting || !currentClinic || totalCount === 0 || !passCode}
              onClick={() => void handleExport()}
            >
              {exporting ? "Exporting..." : "Export Excel"}
            </button>
          </div>
        }
      />

      {!passCode ? (
        <Panel
          className="internal-workspace__panel wallet-workspace__panel"
          title="Wallet ledger"
          subtitle="PASS account data is only available for clinics with PASS configured."
        >
          <EmptyState
            label="No PASS configuration found for this clinic"
            detail="Add the clinic PASS configuration first, then reload this page to inspect wallet balances and transfers."
          />
        </Panel>
      ) : (
        <>
          {error ? <ErrorState label="Wallets could not be loaded" detail={error} /> : null}

          <div className="report-kpi-strip">
            <article className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Visible wallets</span>
              <strong className="report-kpi-strip__value">{summary.accountCount.toLocaleString("en-US")}</strong>
              <span className="report-kpi-strip__hint">Wallet accounts matched to the selected clinic and search.</span>
            </article>
            <article className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Combined balance</span>
              <strong className="report-kpi-strip__value">{formatWalletValue(summary.totalBalance)}</strong>
              <span className="report-kpi-strip__hint">Latest known point balance across the visible wallet set.</span>
            </article>
            <article className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Tracked transfers</span>
              <strong className="report-kpi-strip__value">
                {summary.totalTransactionCount.toLocaleString("en-US")}
              </strong>
              <span className="report-kpi-strip__hint">Distinct wallet transaction numbers tied to these accounts.</span>
            </article>
            <article className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Average balance</span>
              <strong className="report-kpi-strip__value">{formatWalletValue(summary.averageBalance)}</strong>
              <span className="report-kpi-strip__hint">
                Highest visible balance: {formatWalletValue(summary.highestBalance)}
              </span>
            </article>
          </div>

          <Panel
            className="internal-workspace__panel wallet-workspace__panel"
            title="Wallet ledger"
            subtitle={`${totalCount.toLocaleString("en-US")} wallet accounts ranked by latest visible balance`}
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
            {loading ? <div className="inline-note inline-note--loading">Loading wallet accounts...</div> : null}
            {!loading && !error && rows.length === 0 ? (
              <EmptyState
                label="No wallet accounts matched these filters"
                detail="Try clearing the search or switch to another clinic."
              />
            ) : null}
            {rows.length > 0 ? (
              <div className="table-wrap wallet-workspace__accounts-wrap">
                <table className="data-table wallet-workspace__accounts-table">
                  <thead>
                    <tr>
                      <th aria-label="Expand wallet rows" className="wallet-workspace__expand-column" />
                      <th>Wallet</th>
                      <th>Phone</th>
                      <th>Balance</th>
                      <th>Transaction Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const rowKey = buildWalletAccountKey(row);
                      const expanded = rowKey === expandedAccountKey;
                      const detailState = detailByKey[rowKey];
                      const detailPage = detailPages[rowKey] ?? 1;
                      const accountDetailPages = Math.max(
                        1,
                        Math.ceil((detailState?.totalCount ?? row.transactionCount) / DETAIL_PAGE_SIZE),
                      );

                      return (
                        <Fragment key={rowKey}>
                          <tr
                            className={
                              expanded
                                ? "wallet-workspace__account-row wallet-workspace__account-row--expanded"
                                : "wallet-workspace__account-row"
                            }
                          >
                            <td className="wallet-workspace__expand-cell">
                              <button
                                type="button"
                                className="wallet-workspace__expand-button"
                                aria-expanded={expanded}
                                onClick={() => {
                                  setDetailPages((previous) => ({
                                    ...previous,
                                    [rowKey]: previous[rowKey] ?? 1,
                                  }));
                                  setExpandedAccountKey((previous) => (previous === rowKey ? null : rowKey));
                                }}
                              >
                                {expanded ? "−" : "+"}
                              </button>
                            </td>
                            <td>
                              <div className="wallet-workspace__identity">
                                <strong>{row.name || "Unnamed wallet"}</strong>
                                <span>{expanded ? "Recent ledger visible below" : "Expand to inspect transaction history"}</span>
                              </div>
                            </td>
                            <td>{row.phoneNumber || "—"}</td>
                            <td>
                              <span className="wallet-workspace__amount">{formatWalletValue(row.balance)}</span>
                            </td>
                            <td>{row.transactionCount.toLocaleString("en-US")}</td>
                          </tr>
                          {expanded ? (
                            <tr className="wallet-workspace__expanded-row">
                              <td colSpan={5}>
                                <div className="wallet-workspace__expanded-panel">
                                  <div className="wallet-workspace__expanded-header">
                                    <div>
                                      <strong>{row.name}</strong>
                                      <p>{row.phoneNumber || "Phone unavailable"}</p>
                                    </div>
                                    <div className="pagination-controls">
                                      <button
                                        className="button button--secondary"
                                        disabled={detailPage <= 1}
                                        onClick={() =>
                                          setDetailPages((previous) => ({
                                            ...previous,
                                            [rowKey]: Math.max(1, detailPage - 1),
                                          }))
                                        }
                                      >
                                        Previous
                                      </button>
                                      <span>
                                        Page {detailPage} of {accountDetailPages}
                                      </span>
                                      <button
                                        className="button button--secondary"
                                        disabled={detailPage >= accountDetailPages}
                                        onClick={() =>
                                          setDetailPages((previous) => ({
                                            ...previous,
                                            [rowKey]: Math.min(accountDetailPages, detailPage + 1),
                                          }))
                                        }
                                      >
                                        Next
                                      </button>
                                    </div>
                                  </div>

                                  {detailState?.loading ? (
                                    <div className="inline-note inline-note--loading">Loading wallet history...</div>
                                  ) : null}
                                  {detailState?.error ? (
                                    <ErrorState label="Wallet history could not be loaded" detail={detailState.error} />
                                  ) : null}
                                  {!detailState?.loading && !detailState?.error && (detailState?.rows.length ?? 0) === 0 ? (
                                    <EmptyState label="No wallet transactions found for this account" />
                                  ) : null}
                                  {(detailState?.rows.length ?? 0) > 0 ? (
                                    <div className="table-wrap wallet-workspace__nested-wrap">
                                      <table className="data-table wallet-workspace__nested-table">
                                        <thead>
                                          <tr>
                                            <th>Date</th>
                                            <th>Transaction</th>
                                            <th>Direction</th>
                                            <th>Amount</th>
                                            <th>Counterparty</th>
                                            <th>Comment</th>
                                            <th>Balance</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {detailState?.rows.map((detailRow) => (
                                            <tr key={`${rowKey}-${detailRow.transactionNumber}-${detailRow.status}-${detailRow.dateLabel}`}>
                                              <td>{detailRow.dateLabel || "—"}</td>
                                              <td>
                                                <span className="wallet-workspace__transaction-id">
                                                  {detailRow.transactionNumber || "—"}
                                                </span>
                                              </td>
                                              <td>
                                                <span className={`status-pill status-pill--${getWalletDirectionTone(detailRow.status)}`}>
                                                  {getWalletDirectionLabel(detailRow.status)}
                                                </span>
                                              </td>
                                              <td>{formatWalletValue(detailRow.amount)}</td>
                                              <td>{getWalletCounterpartyLabel(detailRow)}</td>
                                              <td>{detailRow.comment || "—"}</td>
                                              <td>{formatWalletValue(detailRow.balance)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Panel>
        </>
      )}
    </div>
  );
}
