import { useEffect, useMemo, useState } from "react";
import { createSearchParams, useSearchParams } from "react-router-dom";
import { fetchDashboardOverview } from "../../api/analytics";
import { DataTable } from "../../components/DataTable";
import { DateRangeControls } from "../../components/DateRangeControls";
import { DonutChart } from "../../components/DonutChart";
import { Panel } from "../../components/Panel";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState, ErrorState } from "../../components/StatusViews";
import { TrendAreaChart } from "../../components/TrendAreaChart";
import { useAccess } from "../access/AccessProvider";
import type { DashboardResponse } from "../../types/domain";
import { daysAgo, startOfCurrentMonth, today } from "../../utils/date";
import { formatCurrency, formatDate, formatPercent } from "../../utils/format";

type DashboardQueryState = {
  clinicId: string;
  clinicCode: string;
  fromDate: string;
  toDate: string;
};

function getDefaultRange() {
  return {
    fromDate: startOfCurrentMonth(),
    toDate: today(),
  };
}

function readDashboardQuery(searchParams: URLSearchParams): DashboardQueryState | null {
  const clinicId = searchParams.get("clinicId");
  const clinicCode = searchParams.get("clinicCode");
  const fromDate = searchParams.get("fromDate");
  const toDate = searchParams.get("toDate");

  if (!clinicId || !clinicCode || !fromDate || !toDate) {
    return null;
  }

  return {
    clinicId,
    clinicCode,
    fromDate,
    toDate,
  };
}

function formatTrendLabel(value: string, granularity: DashboardResponse["trend"]["granularity"]) {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  if (granularity === "month") {
    return new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
  }

  if (granularity === "week") {
    const end = new Date(date);
    end.setUTCDate(end.getUTCDate() + 6);
    return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date)} - ${new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(end)}`;
  }

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

const metricCards = [
  { key: "invoices", label: "Invoices", hint: "Unique paid invoices in range." },
  { key: "customers", label: "Customers", hint: "Customers with activity in the selected period." },
  { key: "appointments", label: "Appointments", hint: "Distinct booking records captured in care flow." },
  { key: "servicesDelivered", label: "Treatments delivered", hint: "Service rows completed in the selected period." },
  { key: "averageInvoice", label: "Average invoice", hint: "Average paid invoice value." },
] as const;

export function ExecutiveDashboardPage() {
  const { currentBusiness, currentClinic, selectClinic } = useAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedQuery = useMemo(() => readDashboardQuery(searchParams), [searchParams]);
  const [range, setRange] = useState(getDefaultRange());
  const [compareEnabled, setCompareEnabled] = useState(true);
  const [loading, setLoading] = useState(Boolean(appliedQuery));
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loadedState, setLoadedState] = useState<DashboardQueryState | null>(appliedQuery);

  useEffect(() => {
    if (appliedQuery) {
      setRange({
        fromDate: appliedQuery.fromDate,
        toDate: appliedQuery.toDate,
      });
    }
  }, [appliedQuery?.fromDate, appliedQuery?.toDate]);

  useEffect(() => {
    if (appliedQuery || !currentClinic) {
      return;
    }

    const defaultRange = getDefaultRange();
    setSearchParams(
      createSearchParams({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        fromDate: defaultRange.fromDate,
        toDate: defaultRange.toDate,
      }),
      { replace: true },
    );
  }, [appliedQuery, currentClinic, setSearchParams]);

  useEffect(() => {
    if (!appliedQuery) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchDashboardOverview(appliedQuery)
      .then((result) => {
        if (active) {
          setData(result);
          setLoadedState(appliedQuery);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load executive dashboard.");
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
  }, [appliedQuery]);

  const isDirty =
    !loadedState ||
    !currentClinic ||
    loadedState.clinicId !== currentClinic.id ||
    loadedState.fromDate !== range.fromDate ||
    loadedState.toDate !== range.toDate;

  function applyRange(preset: "today" | "7d" | "30d" | "month") {
    if (preset === "today") {
      setRange({
        fromDate: today(),
        toDate: today(),
      });
      return;
    }

    if (preset === "7d") {
      setRange({
        fromDate: daysAgo(6),
        toDate: today(),
      });
      return;
    }

    if (preset === "30d") {
      setRange({
        fromDate: daysAgo(29),
        toDate: today(),
      });
      return;
    }

    setRange(getDefaultRange());
  }

  function loadOverview() {
    if (!currentClinic) {
      return;
    }

    setSearchParams(
      createSearchParams({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        fromDate: range.fromDate,
        toDate: range.toDate,
      }),
    );
  }

  const trendItems = useMemo(
    () =>
      data?.trend.points.map((point) => ({
        label: formatTrendLabel(point.bucketLabel, data.trend.granularity),
        value: point.revenue,
        compareValue: point.previousRevenue,
      })) ?? [],
    [data],
  );

  const monthRange = useMemo(() => getDefaultRange(), []);
  const currentDay = useMemo(() => today(), []);

  const activePreset = useMemo(() => {
    if (range.fromDate === currentDay && range.toDate === currentDay) {
      return "today";
    }

    if (range.fromDate === daysAgo(6) && range.toDate === currentDay) {
      return "7d";
    }

    if (range.fromDate === daysAgo(29) && range.toDate === currentDay) {
      return "30d";
    }

    if (range.fromDate === monthRange.fromDate && range.toDate === monthRange.toDate) {
      return "month";
    }

    return null;
  }, [currentDay, monthRange.fromDate, monthRange.toDate, range.fromDate, range.toDate]);

  return (
    <div className="page-stack page-stack--workspace executive-dashboard analytics-report">
      <PageHeader
        eyebrow="Executive overview"
        title="Clinic performance dashboard"
        description="A focused clinic overview for revenue, bookings, payment mix, and therapist performance."
        actions={
          <div className="executive-dashboard__header-status">
            {loading ? "Refreshing overview…" : isDirty ? "Filters changed" : "Live overview ready"}
          </div>
        }
      />

      <section className="executive-dashboard__control-bar">
        <div className="executive-dashboard__control-top">
          <div className="executive-dashboard__control-copy">
            <span className="executive-dashboard__eyebrow">Filters</span>
            <strong>This month by default</strong>
          </div>

          <div className="executive-dashboard__control-actions">
            <label className="sales-details-report__toggle executive-dashboard__toggle">
              <input
                type="checkbox"
                checked={compareEnabled}
                onChange={(event) => setCompareEnabled(event.target.checked)}
              />
              Compare vs previous period
            </label>

            <button className="dashboard-home__primary-action" onClick={loadOverview}>
              {loadedState ? "Refresh dashboard" : "Load dashboard"}
            </button>
          </div>
        </div>

        <div className="executive-dashboard__control-grid">
          <label className="field field--compact">
            <span>Clinic</span>
            <select value={currentClinic?.id ?? ""} onChange={(event) => selectClinic(event.target.value)}>
              {(currentBusiness?.clinics ?? []).map((clinic) => (
                <option key={clinic.id} value={clinic.id}>
                  {clinic.name}
                </option>
              ))}
            </select>
          </label>

          <div className="executive-dashboard__range">
            <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />
          </div>
        </div>

        <div className="executive-dashboard__preset-row">
          {[
            { id: "today", label: "Today" },
            { id: "7d", label: "7D" },
            { id: "30d", label: "30D" },
            { id: "month", label: "Month" },
          ].map((preset) => (
            <button
              key={preset.id}
              className={`dashboard-home__preset-chip ${
                activePreset === preset.id ? "dashboard-home__preset-chip--active" : ""
              }`.trim()}
              onClick={() => applyRange(preset.id as "today" | "7d" | "30d" | "month")}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      {!appliedQuery && !loading ? (
        <Panel
          className="executive-dashboard__empty"
          title="Dashboard is ready"
          subtitle="Choose a date range and clinic, then load the overview when you want live metrics."
        >
          <EmptyState label="No analytics loaded yet" detail="Nothing loads until you confirm the dashboard filters." />
        </Panel>
      ) : null}

      {error ? <ErrorState label="Dashboard could not be loaded" detail={error} /> : null}

      {data && !error ? (
        <>
          <section className="executive-dashboard__metrics">
            {metricCards.map((card) => {
              const metric = data.summary[card.key];
              return (
                <article key={card.key} className="executive-dashboard__metric-card">
                  <span className="executive-dashboard__metric-label">{card.label}</span>
                  <strong>
                    {card.key === "averageInvoice"
                      ? formatCurrency(metric.value, currentClinic?.currency || "MMK")
                      : metric.value.toLocaleString("en-US")}
                  </strong>
                  <div className="executive-dashboard__metric-meta">
                    {compareEnabled ? (
                      <span
                        className={`executive-dashboard__metric-change ${
                          metric.change < 0 ? "executive-dashboard__metric-change--negative" : ""
                        }`.trim()}
                      >
                        {formatPercent(metric.change)}
                      </span>
                    ) : null}
                    <small>{card.hint}</small>
                  </div>
                </article>
              );
            })}
          </section>

          <section className="executive-dashboard__hero-grid">
            <Panel
              className="executive-dashboard__trend-panel"
              title="Revenue trend"
              subtitle={`Tracked by ${data.trend.granularity} in the selected date range.`}
            >
              <TrendAreaChart
                points={trendItems}
                showComparison={compareEnabled}
                valueFormatter={(value) => formatCurrency(value, currentClinic?.currency || "MMK")}
              />
            </Panel>

            <Panel
              className="executive-dashboard__insights-panel"
              title="What to watch"
              subtitle="Rule-based observations grounded in current dashboard metrics."
            >
              <div className="executive-dashboard__insights-list">
                {data.insights.map((insight) => (
                  <article key={insight.title} className={`executive-dashboard__insight executive-dashboard__insight--${insight.tone}`}>
                    <strong>{insight.title}</strong>
                    <p>{insight.detail}</p>
                  </article>
                ))}
              </div>
            </Panel>
          </section>

          <section className="executive-dashboard__spotlights">
            {data.spotlights.map((spotlight) => (
              <article key={spotlight.title} className="executive-dashboard__spotlight-card">
                <span className="executive-dashboard__spotlight-label">{spotlight.title}</span>
                <strong>{spotlight.value.toLocaleString("en-US")}</strong>
                <span
                  className={`executive-dashboard__spotlight-change ${
                    spotlight.change < 0 ? "executive-dashboard__spotlight-change--negative" : ""
                  }`.trim()}
                >
                  {compareEnabled ? formatPercent(spotlight.change) : "Current period"}
                </span>
                <p>{spotlight.detail}</p>
              </article>
            ))}
          </section>

          <section className="executive-dashboard__lower-grid">
            <Panel
              title="Top services"
              subtitle="Revenue contribution and service demand."
              className="executive-dashboard__panel"
            >
              <DataTable
                rows={data.topServices}
                rowKey={(row) => row.serviceName}
                columns={[
                  { key: "serviceName", header: "Service", render: (row) => row.serviceName },
                  {
                    key: "bookings",
                    header: "Bookings",
                    render: (row) => row.bookings.toLocaleString("en-US"),
                  },
                  {
                    key: "revenue",
                    header: "Revenue",
                    render: (row) => formatCurrency(row.revenue, currentClinic?.currency || "MMK"),
                  },
                  {
                    key: "share",
                    header: "Share",
                    render: (row) => `${row.contributionPct.toFixed(1)}%`,
                  },
                ]}
              />
            </Panel>

            <Panel
              title="Payment mix"
              subtitle="Revenue concentration by payment method."
              className="executive-dashboard__panel"
            >
              <DonutChart
                items={data.paymentMix.map((row) => ({
                  label: row.paymentMethod,
                  value: row.totalAmount,
                }))}
                totalLabel="Collected"
                centerLabel={formatCurrency(
                  data.paymentMix.reduce((sum, row) => sum + row.totalAmount, 0),
                  currentClinic?.currency || "MMK",
                )}
              />
            </Panel>

            <Panel
              title="Top therapists"
              subtitle="Treatment volume and attributed service value."
              className="executive-dashboard__panel"
            >
              <DataTable
                rows={data.topTherapists}
                rowKey={(row) => `${row.therapistName}-${row.lastVisitDate}`}
                columns={[
                  { key: "therapistName", header: "Therapist", render: (row) => row.therapistName },
                  {
                    key: "completedServices",
                    header: "Treatments",
                    render: (row) => row.completedServices.toLocaleString("en-US"),
                  },
                  {
                    key: "serviceValue",
                    header: "Service value",
                    render: (row) => formatCurrency(row.serviceValue, currentClinic?.currency || "MMK"),
                  },
                  {
                    key: "lastVisitDate",
                    header: "Latest",
                    render: (row) => (row.lastVisitDate ? formatDate(row.lastVisitDate) : "—"),
                  },
                ]}
              />
            </Panel>
          </section>
        </>
      ) : null}
    </div>
  );
}
