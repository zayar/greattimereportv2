import { useEffect, useState } from "react";
import { fetchBankingSummary } from "../../../api/analytics";
import { BarChart } from "../../../components/BarChart";
import { DataTable } from "../../../components/DataTable";
import { DateRangeControls } from "../../../components/DateRangeControls";
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
    <div className="page-stack">
      <PageHeader
        eyebrow="Analytics"
        title="Banking summary"
        description="Payment-method and collection analysis from BigQuery, shaped for finance review instead of free-form SQL."
        actions={<DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />}
      />

      {error ? <ErrorState label="Banking summary could not be loaded" detail={error} /> : null}

      <div className="panel-grid panel-grid--quad">
        <Panel title="Collected revenue" subtitle="Paid revenue in the selected range">
          <strong className="panel-stat">{formatCurrency(data?.summary.totalRevenue ?? 0, currency)}</strong>
        </Panel>
        <Panel title="Transactions" subtitle="Count of paid rows included">
          <strong className="panel-stat">{(data?.summary.transactionCount ?? 0).toLocaleString("en-US")}</strong>
        </Panel>
        <Panel title="Payment methods" subtitle="Distinct payment methods used">
          <strong className="panel-stat">{(data?.summary.methodsCount ?? 0).toLocaleString("en-US")}</strong>
        </Panel>
        <Panel title="Average ticket" subtitle="Average paid amount per transaction">
          <strong className="panel-stat">{formatCurrency(data?.summary.averageTicket ?? 0, currency)}</strong>
        </Panel>
      </div>

      <div className="panel-grid panel-grid--split">
        <Panel title="Payment method mix" subtitle="Revenue and volume by payment method">
          {loading ? (
            <div className="inline-note">Loading payment method summary...</div>
          ) : !data || data.methods.length === 0 ? (
            <EmptyState label="No payment methods found" />
          ) : (
            <DataTable
              rows={data.methods}
              rowKey={(row) => row.paymentMethod}
              columns={[
                { key: "method", header: "Method", render: (row) => row.paymentMethod },
                {
                  key: "transactions",
                  header: "Transactions",
                  render: (row) => row.transactionCount.toLocaleString("en-US"),
                },
                {
                  key: "average",
                  header: "Average ticket",
                  render: (row) => formatCurrency(row.averageTicket, currency),
                },
                {
                  key: "amount",
                  header: "Total amount",
                  render: (row) => formatCurrency(row.totalAmount, currency),
                },
              ]}
            />
          )}
        </Panel>

        <Panel title="Daily collections" subtitle="Paid collection totals by day">
          {loading ? (
            <div className="inline-note">Loading daily collections...</div>
          ) : !data || data.dailyCollections.length === 0 ? (
            <EmptyState label="No collection trend data found" />
          ) : (
            <BarChart
              items={data.dailyCollections.map((row) => ({
                label: row.dateLabel.slice(5),
                value: row.totalAmount,
                meta: `${row.transactionCount.toLocaleString("en-US")} txns`,
              }))}
            />
          )}
        </Panel>
      </div>

      <Panel
        title="Recent settlements"
        subtitle={`${(data?.recentRows.length ?? 0).toLocaleString("en-US")} latest paid rows from the same date range`}
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
