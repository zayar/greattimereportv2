import { useEffect, useMemo, useState } from "react";
import { fetchDashboardOverview } from "../../api/analytics";
import { BarChart } from "../../components/BarChart";
import { DateRangeControls } from "../../components/DateRangeControls";
import { DataTable } from "../../components/DataTable";
import { HorizontalBarList } from "../../components/HorizontalBarList";
import { Panel } from "../../components/Panel";
import { PageHeader } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
import { EmptyState, ErrorState } from "../../components/StatusViews";
import { useAccess } from "../access/AccessProvider";
import { daysAgo, today } from "../../utils/date";
import { formatCurrency } from "../../utils/format";
import type { DashboardResponse } from "../../types/domain";

export function DashboardPage() {
  const { currentClinic } = useAccess();
  const [range, setRange] = useState({
    fromDate: daysAgo(30),
    toDate: today(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardResponse | null>(null);

  const currency = currentClinic?.currency || "MMK";

  const paymentMixSorted = useMemo(() => {
    if (!data?.paymentMix.length) {
      return [];
    }
    return [...data.paymentMix].sort((a, b) => b.totalAmount - a.totalAmount);
  }, [data?.paymentMix]);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchDashboardOverview({
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
          setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard.");
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

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Operational snapshot with the same MainDataView / payment views as GT_NewReport, delivered through parameterized BigQuery — not browser-built SQL."
        actions={<DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />}
      />

      {error ? <ErrorState label="Dashboard could not be loaded" detail={error} /> : null}

      {data ? (
        <>
          <div className="stats-grid">
            <StatCard
              label="Revenue"
              value={formatCurrency(data.summary.revenue, currency)}
              change={data.summary.revenueChange}
            />
            <StatCard label="Invoices" value={data.summary.invoices.toLocaleString("en-US")} change={data.summary.invoicesChange} />
            <StatCard label="Customers" value={data.summary.customers.toLocaleString("en-US")} change={data.summary.customersChange} />
            <StatCard
              label="Appointments"
              value={data.summary.appointments.toLocaleString("en-US")}
              change={data.summary.appointmentsChange}
            />
            <StatCard
              label="Active services"
              value={data.summary.activeServices.toLocaleString("en-US")}
              change={data.summary.activeServicesChange}
            />
          </div>

          <div className="panel-grid panel-grid--split">
            <Panel className="panel--tall" title="Revenue trend" subtitle="Daily paid revenue — bar height follows share of the strongest day in range.">
              {loading ? (
                <div className="inline-note">Loading revenue trend...</div>
              ) : data.revenueTrend.length === 0 ? (
                <EmptyState label="No paid revenue in this range" />
              ) : (
                <BarChart
                  items={data.revenueTrend.map((row) => ({
                    label: row.dateLabel.slice(5),
                    value: row.revenue,
                    valueLabel: formatCurrency(row.revenue, currency),
                  }))}
                />
              )}
            </Panel>

            <Panel className="panel--tall" title="Payment mix" subtitle="Paid revenue by method — ranked with proportional bars.">
              {loading ? (
                <div className="inline-note">Loading payment mix...</div>
              ) : paymentMixSorted.length === 0 ? (
                <EmptyState label="No payment methods in this range" />
              ) : (
                <HorizontalBarList
                  items={paymentMixSorted.map((item) => ({
                    label: item.paymentMethod,
                    value: item.totalAmount,
                    valueDisplay: formatCurrency(item.totalAmount, currency),
                  }))}
                />
              )}
            </Panel>
          </div>

          <Panel title="Top services" subtitle="Highest-revenue services in the selected window">
            <DataTable
              rows={data.topServices}
              rowKey={(row) => row.serviceName}
              columns={[
                { key: "service", header: "Service", render: (row) => row.serviceName },
                {
                  key: "revenue",
                  header: "Revenue",
                  render: (row) => formatCurrency(row.revenue, currency),
                },
                { key: "invoices", header: "Invoices", render: (row) => row.invoices.toLocaleString("en-US") },
              ]}
            />
          </Panel>
        </>
      ) : loading ? (
        <Panel title="Dashboard data">
          <div className="inline-note">Loading dashboard metrics...</div>
        </Panel>
      ) : (
        <EmptyState label="No dashboard data yet" detail="Try another clinic or widen the selected time range." />
      )}
    </div>
  );
}
