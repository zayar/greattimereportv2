import { Fragment, useDeferredValue, useEffect, useMemo, useState } from "react";
import { fetchWalletAccountTransactions, fetchWalletAccounts } from "../../../api/analytics";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { useAccess } from "../../access/AccessProvider";
import type { WalletAccountsResponse, WalletTransactionRow } from "../../../types/domain";
import { downloadExcelWorkbook } from "../../../utils/exportExcel";
import {
  buildWalletAccountKey,
  buildWalletAccountsExportRows,
  formatWalletValue,
  getWalletCounterpartyLabel,
  getWalletDirectionLabel,
  getWalletDirectionTone,
} from "./walletHelpers";

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

async function loadAllWalletAccounts(params: {
  clinicId: string;
  clinicCode: string;
  search: string;
}) {
  const rows: WalletAccountsResponse["rows"] = [];
  let totalCount = Number.POSITIVE_INFINITY;
  let page = 1;

  while (rows.length < totalCount) {
    const result = await fetchWalletAccounts({
      clinicId: params.clinicId,
      clinicCode: params.clinicCode,
      search: params.search,
      page,
      pageSize: EXPORT_BATCH_SIZE,
    });

    rows.push(...result.rows);
    totalCount = result.totalCount;

    if (result.rows.length < EXPORT_BATCH_SIZE) {
      break;
    }

    page += 1;
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
  const [data, setData] = useState<WalletAccountsResponse | null>(null);
  const [exporting, setExporting] = useState(false);
  const [expandedAccountKey, setExpandedAccountKey] = useState<string | null>(null);
  const [detailPages, setDetailPages] = useState<Record<string, number>>({});
  const [detailByKey, setDetailByKey] = useState<Record<string, AccountDetailState>>({});

  useEffect(() => {
    setPage(1);
  }, [currentClinic?.id, deferredSearch]);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchWalletAccounts({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      search: deferredSearch,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
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
  }, [currentClinic, deferredSearch, page]);

  const rows = data?.rows ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const summary = data?.summary;

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
    if (!currentClinic || !expandedAccount || !expandedAccountKey) {
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

    fetchWalletAccountTransactions({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      accountName: expandedAccount.name,
      accountPhone: expandedAccount.phoneNumber,
      search: "",
      page: expandedPage,
      pageSize: DETAIL_PAGE_SIZE,
    })
      .then((result) => {
        if (active) {
          setDetailByKey((previous) => ({
            ...previous,
            [expandedAccountKey]: {
              loading: false,
              error: null,
              rows: result.rows,
              totalCount: result.totalCount,
              page: expandedPage,
            },
          }));
        }
      })
      .catch((loadError) => {
        if (active) {
          setDetailByKey((previous) => ({
            ...previous,
            [expandedAccountKey]: {
              loading: false,
              error:
                loadError instanceof Error ? loadError.message : "Failed to load wallet transactions.",
              rows: previous[expandedAccountKey]?.rows ?? [],
              totalCount: previous[expandedAccountKey]?.totalCount ?? 0,
              page: expandedPage,
            },
          }));
        }
      });

    return () => {
      active = false;
    };
  }, [
    currentClinic,
    expandedAccount,
    expandedAccountKey,
    expandedPage,
  ]);

  async function handleExport() {
    if (!currentClinic) {
      return;
    }

    setExporting(true);

    try {
      const exportRows = await loadAllWalletAccounts({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        search: deferredSearch,
      });

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
                placeholder={`Search ${summary?.accountCount ?? totalCount} wallet account(s)`}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button
              className="button button--secondary"
              disabled={loading || exporting || !currentClinic || totalCount === 0}
              onClick={() => void handleExport()}
            >
              {exporting ? "Exporting..." : "Export Excel"}
            </button>
          </div>
        }
      />

      {error ? <ErrorState label="Wallets could not be loaded" detail={error} /> : null}

      <div className="report-kpi-strip">
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Visible wallets</span>
          <strong className="report-kpi-strip__value">{(summary?.accountCount ?? 0).toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Wallet accounts matched to the selected clinic and search.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Combined balance</span>
          <strong className="report-kpi-strip__value">{formatWalletValue(summary?.totalBalance ?? 0)}</strong>
          <span className="report-kpi-strip__hint">Latest known point balance across the visible wallet set.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Tracked transfers</span>
          <strong className="report-kpi-strip__value">
            {(summary?.totalTransactionCount ?? 0).toLocaleString("en-US")}
          </strong>
          <span className="report-kpi-strip__hint">Distinct wallet transaction numbers tied to these accounts.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Average balance</span>
          <strong className="report-kpi-strip__value">{formatWalletValue(summary?.averageBalance ?? 0)}</strong>
          <span className="report-kpi-strip__hint">
            Highest visible balance: {formatWalletValue(summary?.highestBalance ?? 0)}
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
                    Math.ceil((detailState?.totalCount ?? 0) / DETAIL_PAGE_SIZE),
                  );

                  return (
                    <Fragment key={rowKey}>
                      <tr className={expanded ? "wallet-workspace__account-row wallet-workspace__account-row--expanded" : "wallet-workspace__account-row"}>
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
    </div>
  );
}
