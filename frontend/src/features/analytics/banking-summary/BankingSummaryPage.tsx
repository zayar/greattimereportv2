import { useEffect, useState } from "react";
import { fetchBankingSummary } from "../../../api/analytics";
import { BarChart } from "../../../components/BarChart";
import { DataTable } from "../../../components/DataTable";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { HorizontalBarList } from "../../../components/HorizontalBarList";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { useAccess } from "../../access/AccessProvider";
import type { BankingSummaryResponse } from "../../../types/domain";
import { daysAgo, today } from "../../../utils/date";
import { formatCurrency } from "../../../utils/format";

export function BankingSummaryPage() {
  const { currentClinic } = useAccess();
  const [range, setRange] = useState({
    fromDate: daysAgo(30),
    toDate: today(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BankingSummaryResponse | null>(null);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchBankingSummary({
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
          setError(loadError instanceof Error ? loadError.message : "Failed to load banking summary.");
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

  return (
    <div className="page-stack analytics-report">
      <PageHeader
        eyebrow="Analytics"
        title="Banking summary"
        description="Collections, payment mix, and recent settlement rows for the selected clinic."
        actions={
          <div className="filter-row analytics-report__filters">
            <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />
          </div>
        }
      />

      {error ? <ErrorState label="Banking summary could not be loaded" detail={error} /> : null}

      <div className="report-kpi-strip analytics-report__kpis">
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Collected</span>
          <span className="report-kpi-strip__value">{formatCurrency(data?.summary.totalRevenue ?? 0, currency)}</span>
          <span className="report-kpi-strip__hint">Paid value in range</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Transactions</span>
          <span className="report-kpi-strip__value">{(data?.summary.transactionCount ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Rows included</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Methods</span>
          <span className="report-kpi-strip__value">{(data?.summary.methodsCount ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Payment methods used</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Average ticket</span>
          <span className="report-kpi-strip__value">{formatCurrency(data?.summary.averageTicket ?? 0, currency)}</span>
          <span className="report-kpi-strip__hint">Average paid amount</span>
        </div>
      </div>

      <div className="panel-grid panel-grid--split analytics-report__grid">
        <Panel className="analytics-report__panel" title="Payment mix" subtitle="Value and volume by payment method.">
          {loading ? (
            <div className="inline-note">Loading payment methods...</div>
          ) : !data || data.methods.length === 0 ? (
            <EmptyState label="No payment methods found" />
          ) : (
            <HorizontalBarList
              items={data.methods.map((row) => ({
                label: row.paymentMethod,
                value: row.totalAmount,
                valueDisplay: `${formatCurrency(row.totalAmount, currency)} · ${row.transactionCount.toLocaleString("en-US")} txns`,
              }))}
            />
          )}
        </Panel>

        <Panel className="analytics-report__panel analytics-report__panel--tall" title="Daily collections" subtitle="Paid collection totals by day.">
          {loading ? (
            <div className="inline-note">Loading daily collections...</div>
          ) : !data || data.dailyCollections.length === 0 ? (
            <EmptyState label="No collection trend data found" />
          ) : (
            <BarChart
              items={data.dailyCollections.map((row) => ({
                label: row.dateLabel.slice(5),
                value: row.totalAmount,
                valueLabel: formatCurrency(row.totalAmount, currency),
                meta: `${row.transactionCount.toLocaleString("en-US")} txns`,
              }))}
            />
          )}
        </Panel>
      </div>

      <Panel
        className="analytics-report__panel"
        title="Recent settlements"
        subtitle={`${(data?.recentRows.length ?? 0).toLocaleString("en-US")} latest paid rows in the same date range`}
      >
        {loading ? <div className="inline-note">Loading recent settlements...</div> : null}
        {!loading && !error && (!data || data.recentRows.length === 0) ? (
          <EmptyState label="No banking rows found for this range" />
        ) : null}
        {data && data.recentRows.length > 0 ? (
          <DataTable
            rows={data.recentRows}
            rowKey={(row) => `${row.invoiceNumber}-${row.dateLabel}-${row.paymentMethod}`}
            columns={[
              { key: "date", header: "Date", render: (row) => row.dateLabel },
              { key: "invoice", header: "Invoice", render: (row) => row.invoiceNumber },
              { key: "customer", header: "Customer", render: (row) => row.customerName },
              { key: "seller", header: "Seller", render: (row) => row.salePerson },
              { key: "method", header: "Method", render: (row) => row.paymentMethod },
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
