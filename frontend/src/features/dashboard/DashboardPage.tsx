import { useEffect, useState } from "react";
import { fetchDashboardOverview } from "../../api/analytics";
import { BarChart } from "../../components/BarChart";
import { DateRangeControls } from "../../components/DateRangeControls";
import { DataTable } from "../../components/DataTable";
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
        description="A modern default home that blends GT_NewReport’s cleaner presentation with secured server-side analytics."
        actions={<DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />}
      />

      {error ? <ErrorState label="Dashboard could not be loaded" detail={error} /> : null}

      {data ? (
        <>
          <div className="stats-grid">
            <StatCard
              label="Revenue"
              value={formatCurrency(data.summary.revenue, currentClinic?.currency || "MMK")}
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
            <Panel title="Revenue trend" subtitle="Daily paid revenue over the selected period">
              {loading ? (
                <div className="inline-note">Loading revenue trend...</div>
              ) : data.revenueTrend.length === 0 ? (
                <EmptyState label="No paid revenue in this range" />
              ) : (
                <BarChart items={data.revenueTrend.map((row) => ({ label: row.dateLabel.slice(5), value: row.revenue }))} />
              )}
            </Panel>

            <Panel title="Payment mix" subtitle="Paid revenue split by payment method">
              <div className="metric-list">
                {data.paymentMix.map((item) => (
                  <div className="metric-list__item" key={item.paymentMethod}>
                    <strong>{item.paymentMethod}</strong>
                    <span>{formatCurrency(item.totalAmount, currentClinic?.currency || "MMK")}</span>
                  </div>
                ))}
              </div>
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
                  render: (row) => formatCurrency(row.revenue, currentClinic?.currency || "MMK"),
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

