import { useMemo, useEffect, useState } from "react";
import { fetchSalesBySeller } from "../../../api/analytics";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { HorizontalBarList } from "../../../components/HorizontalBarList";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { daysAgo, today } from "../../../utils/date";
import { formatCurrency } from "../../../utils/format";
import type { SalesBySellerResponse } from "../../../types/domain";

export function SalesBySellerPage() {
  const { currentClinic } = useAccess();
  const [range, setRange] = useState({
    fromDate: daysAgo(30),
    toDate: today(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SalesBySellerResponse | null>(null);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchSalesBySeller({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
    })
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load seller analytics.");
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
  }, [currentClinic, range.fromDate, range.toDate]);

  const currency = currentClinic?.currency || "MMK";
  const summary = useMemo(() => {
    const sellers = data?.sellers ?? [];
    const sellerCount = sellers.length;
    const invoiceCount = sellers.reduce((sum, row) => sum + row.invoiceCount, 0);
    const totalAmount = sellers.reduce((sum, row) => sum + row.totalAmount, 0);
    const averagePerSeller = sellerCount > 0 ? totalAmount / sellerCount : 0;

    return {
      sellerCount,
      invoiceCount,
      totalAmount,
      averagePerSeller,
    };
  }, [data?.sellers]);

  return (
    <div className="page-stack analytics-report">
      <PageHeader
        eyebrow="Revenue"
        title="Sales by sales person"
        description="Sales-person ranking, attributed revenue, and recent invoice rows."
        actions={
          <div className="filter-row analytics-report__filters">
            <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />
          </div>
        }
      />

      {error ? <ErrorState label="Sales by sales person could not be loaded" detail={error} /> : null}

      <div className="report-kpi-strip analytics-report__kpis">
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Sellers</span>
          <span className="report-kpi-strip__value">{summary.sellerCount.toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Active sellers in range</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Invoices</span>
          <span className="report-kpi-strip__value">{summary.invoiceCount.toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Paid invoices attributed</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Revenue</span>
          <span className="report-kpi-strip__value">{formatCurrency(summary.totalAmount, currency)}</span>
          <span className="report-kpi-strip__hint">Total value by seller</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Average / seller</span>
          <span className="report-kpi-strip__value">{formatCurrency(summary.averagePerSeller, currency)}</span>
          <span className="report-kpi-strip__hint">Average revenue contribution</span>
        </div>
      </div>

      <div className="panel-grid panel-grid--split analytics-report__grid">
        <Panel className="analytics-report__panel" title="Seller ranking" subtitle="Revenue contribution by seller.">
          {loading ? (
            <div className="inline-note">Loading seller totals...</div>
          ) : !data || data.sellers.length === 0 ? (
            <EmptyState label="No seller data found" />
          ) : (
            <HorizontalBarList
              items={data.sellers.map((row) => ({
                label: row.sellerName,
                value: row.totalAmount,
                valueDisplay: `${formatCurrency(row.totalAmount, currency)} · ${row.invoiceCount.toLocaleString("en-US")} invoices`,
              }))}
            />
          )}
        </Panel>

        <Panel className="analytics-report__panel" title="Seller summary" subtitle="Revenue and invoice totals by seller.">
          {loading ? (
            <div className="inline-note">Loading seller summary...</div>
          ) : !data || data.sellers.length === 0 ? (
            <EmptyState label="No seller summary found" />
          ) : (
            <DataTable
              rows={data.sellers}
              rowKey={(row) => row.sellerName}
              columns={[
                { key: "seller", header: "Seller", render: (row) => row.sellerName },
                { key: "invoices", header: "Invoices", render: (row) => row.invoiceCount.toLocaleString("en-US") },
                {
                  key: "amount",
                  header: "Amount",
                  render: (row) => formatCurrency(row.totalAmount, currency),
                },
              ]}
            />
          )}
        </Panel>
      </div>

      <Panel className="analytics-report__panel" title="Recent transactions" subtitle="Latest paid invoice rows in the same date range.">
        {loading ? <div className="inline-note">Loading recent transactions...</div> : null}
        {!loading && !error && (!data || data.recentTransactions.length === 0) ? (
          <EmptyState label="No transactions found" />
        ) : null}
        {data && data.recentTransactions.length > 0 ? (
          <DataTable
            rows={data.recentTransactions}
            rowKey={(row) => `${row.invoiceNumber}-${row.dateLabel}`}
            columns={[
              { key: "date", header: "Date", render: (row) => row.dateLabel },
              { key: "invoice", header: "Invoice", render: (row) => row.invoiceNumber },
              { key: "customer", header: "Customer", render: (row) => row.customerName },
              { key: "service", header: "Service", render: (row) => row.serviceName },
              { key: "seller", header: "Seller", render: (row) => row.sellerName },
              {
                key: "amount",
                header: "Amount",
                render: (row) => formatCurrency(row.totalAmount, currency),
              },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
