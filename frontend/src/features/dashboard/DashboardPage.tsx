import { useEffect, useMemo, useState } from "react";
import { createSearchParams, useNavigate } from "react-router-dom";
import { fetchDashboardOverview } from "../../api/analytics";
import { BarChart } from "../../components/BarChart";
import { DataTable } from "../../components/DataTable";
import { DateRangeControls } from "../../components/DateRangeControls";
import { HorizontalBarList } from "../../components/HorizontalBarList";
import { Panel } from "../../components/Panel";
import { StatCard } from "../../components/StatCard";
import { ErrorState } from "../../components/StatusViews";
import { useAccess } from "../access/AccessProvider";
import { daysAgo, today } from "../../utils/date";
import { formatCurrency } from "../../utils/format";
import type { DashboardResponse } from "../../types/domain";

type ReportKind = "Executive" | "Operational" | "Analytics";
type ReportFilter = "All" | ReportKind;
type LoadState = "idle" | "loading" | "success" | "error";

type ReportOption = {
  id: string;
  label: string;
  description: string;
  kind: ReportKind;
  route: string;
  actionLabel: string;
};

type Preset = {
  id: string;
  label: string;
  description: string;
  reportId: string;
  days: number;
};

const reportOptions: ReportOption[] = [
  {
    id: "overview",
    label: "Clinic performance dashboard",
    description: "Executive overview for revenue, patient volume, appointments, and payment mix.",
    kind: "Executive",
    route: "/dashboard",
    actionLabel: "Load dashboard",
  },
  {
    id: "sales-report",
    label: "Revenue overview",
    description: "Paid sales performance, top services, and invoice-level detail.",
    kind: "Analytics",
    route: "/analytics/sales-report",
    actionLabel: "Open report",
  },
  {
    id: "appointments",
    label: "Appointments",
    description: "Operational schedule review for bookings, timing, and practitioner flow.",
    kind: "Operational",
    route: "/operational/appointments",
    actionLabel: "Open report",
  },
  {
    id: "customer-behavior",
    label: "Customer behavior",
    description: "Visit activity, unique member counts, and top active members.",
    kind: "Analytics",
    route: "/analytics/customer-behavior",
    actionLabel: "Open report",
  },
  {
    id: "service-behavior",
    label: "Service performance",
    description: "Service demand, practitioner mix, and top-performing treatments.",
    kind: "Analytics",
    route: "/analytics/service-behavior",
    actionLabel: "Open report",
  },
  {
    id: "payment-report",
    label: "Payment report",
    description: "Transaction-level payment review across service sales and checkout activity.",
    kind: "Analytics",
    route: "/analytics/payment-report",
    actionLabel: "Open report",
  },
];

const presets: Preset[] = [
  {
    id: "preset-executive-month",
    label: "Monthly executive review",
    description: "Last 30 days, built for owner-level revenue and clinic performance review.",
    reportId: "overview",
    days: 30,
  },
  {
    id: "preset-customer-quarter",
    label: "Customer retention lens",
    description: "Last 90 days with customer behavior selected and ready to open.",
    reportId: "customer-behavior",
    days: 90,
  },
  {
    id: "preset-service-half",
    label: "Service demand pulse",
    description: "Last 180 days with service performance preselected for trend review.",
    reportId: "service-behavior",
    days: 180,
  },
];

const placeholderCards = [
  {
    label: "Revenue outlook",
    title: "Ready when you are",
    detail: "Load the executive dashboard only when you need a live revenue snapshot.",
  },
  {
    label: "Patient activity",
    title: "No preloaded member data",
    detail: "Choose customer behavior or appointments when you are ready to inspect activity.",
  },
  {
    label: "Operational flow",
    title: "Intentionally quiet",
    detail: "The workspace stays light until you confirm the clinic, range, and report view.",
  },
];

export function DashboardPage() {
  const navigate = useNavigate();
  const {
    businesses,
    currentBusiness,
    currentClinic,
    selectBusiness,
    selectClinic,
  } = useAccess();
  const [range, setRange] = useState({
    fromDate: daysAgo(30),
    toDate: today(),
  });
  const [selectedFilter, setSelectedFilter] = useState<ReportFilter>("All");
  const [selectedReportId, setSelectedReportId] = useState("overview");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loadedSnapshot, setLoadedSnapshot] = useState<{
    clinicName: string;
    fromDate: string;
    toDate: string;
  } | null>(null);

  const selectedReport = useMemo(
    () => reportOptions.find((report) => report.id === selectedReportId) ?? reportOptions[0],
    [selectedReportId],
  );

  const visibleReports = useMemo(() => {
    if (selectedFilter === "All") {
      return reportOptions;
    }
    return reportOptions.filter((report) => report.kind === selectedFilter);
  }, [selectedFilter]);

  const paymentMixSorted = useMemo(() => {
    if (!data?.paymentMix.length) {
      return [];
    }
    return [...data.paymentMix].sort((left, right) => right.totalAmount - left.totalAmount);
  }, [data?.paymentMix]);

  const currency = currentClinic?.currency || "MMK";

  useEffect(() => {
    setLoadState("idle");
    setError(null);
    setData(null);
    setLoadedSnapshot(null);
  }, [currentBusiness?.id, currentClinic?.id, range.fromDate, range.toDate]);

  function buildReportSearch() {
    if (!currentClinic) {
      return "";
    }

    const params = createSearchParams({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
    });

    return `?${params.toString()}`;
  }

  async function loadDashboard() {
    if (!currentClinic) {
      return;
    }

    setLoadState("loading");
    setError(null);

    try {
      const result = await fetchDashboardOverview({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        fromDate: range.fromDate,
        toDate: range.toDate,
      });

      setData(result);
      setLoadedSnapshot({
        clinicName: currentClinic.name,
        fromDate: range.fromDate,
        toDate: range.toDate,
      });
      setLoadState("success");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard.");
      setLoadState("error");
    }
  }

  function openReport(report: ReportOption) {
    setSelectedReportId(report.id);

    if (report.route === "/dashboard") {
      void loadDashboard();
      return;
    }

    navigate({
      pathname: report.route,
      search: buildReportSearch(),
    });
  }

  function applyPreset(preset: Preset) {
    setSelectedReportId(preset.reportId);
    setSelectedFilter("All");
    setRange({
      fromDate: daysAgo(preset.days),
      toDate: today(),
    });
  }

  async function handlePrimaryAction() {
    if (selectedReport.route === "/dashboard") {
      await loadDashboard();
      return;
    }

    navigate({
      pathname: selectedReport.route,
      search: buildReportSearch(),
    });
  }

  return (
    <div className="page-stack dashboard-home">
      <section className="dashboard-home__hero">
        <div className="dashboard-home__hero-copy">
          <span className="page-header__eyebrow">Report workspace</span>
          <h1>Clinic Performance Dashboard</h1>
          <p>
            Choose business, clinic, date range, and report type to load performance insights.
            Nothing heavy loads until you ask for it.
          </p>

          <div className="dashboard-home__promise-list">
            <div className="dashboard-home__promise">
              <strong>Faster first load</strong>
              <span>Enter a clean control center instead of a fully queried analytics screen.</span>
            </div>
            <div className="dashboard-home__promise">
              <strong>Intentional query cost</strong>
              <span>BigQuery and report requests only run after you confirm the view you want.</span>
            </div>
            <div className="dashboard-home__promise">
              <strong>Executive-ready structure</strong>
              <span>Start with decisions first, then reveal live insight only when it matters.</span>
            </div>
          </div>
        </div>

        <aside className="dashboard-home__hero-aside">
          <span className="dashboard-home__hero-label">
            {loadState === "success" ? "Live view loaded" : "No live data preloaded"}
          </span>
          <h2>{selectedReport.label}</h2>
          <p>
            {loadState === "success" && loadedSnapshot
              ? `${loadedSnapshot.clinicName} · ${loadedSnapshot.fromDate} to ${loadedSnapshot.toDate}`
              : "Use this workspace to pick the clinic, range, and report before the platform pulls any analytics."}
          </p>
          <div className="dashboard-home__hero-meta">
            <div>
              <span>Business</span>
              <strong>{currentBusiness?.name ?? "Select business"}</strong>
            </div>
            <div>
              <span>Clinic</span>
              <strong>{currentClinic?.name ?? "Select clinic"}</strong>
            </div>
            <div>
              <span>Report type</span>
              <strong>{selectedReport.kind}</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="dashboard-home__setup">
        <div className="dashboard-home__setup-header">
          <div>
            <span className="dashboard-home__section-eyebrow">Setup</span>
            <h2>Select your report view</h2>
            <p>Confirm the workspace context first, then load the dashboard or open a focused report.</p>
          </div>

          <button className="dashboard-home__primary-action" onClick={() => void handlePrimaryAction()}>
            {selectedReport.route === "/dashboard"
              ? loadState === "loading"
                ? "Loading dashboard..."
                : "Load Dashboard"
              : `Open ${selectedReport.label}`}
          </button>
        </div>

        <div className="dashboard-home__setup-grid">
          <label className="field field--compact">
            <span>Business</span>
            <select value={currentBusiness?.id ?? ""} onChange={(event) => selectBusiness(event.target.value)}>
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
          </label>

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

          <div className="dashboard-home__date-range">
            <DateRangeControls
              fromDate={range.fromDate}
              toDate={range.toDate}
              onChange={setRange}
            />
          </div>
        </div>

        <div className="dashboard-home__selection-strip">
          <div className="dashboard-home__selection-card">
            <span>Selected report</span>
            <strong>{selectedReport.label}</strong>
            <p>{selectedReport.description}</p>
          </div>

          <div className="dashboard-home__selection-card">
            <span>Interaction flow</span>
            <strong>Choose, then load</strong>
            <p>Filters stay lightweight until you confirm the report you want to view.</p>
          </div>
        </div>
      </section>

      <section className="dashboard-home__reports">
        <div className="dashboard-home__section-header">
          <div>
            <span className="dashboard-home__section-eyebrow">Reports</span>
            <h2>Choose a report workspace</h2>
          </div>

          <div className="dashboard-home__tabs">
            {(["All", "Executive", "Operational", "Analytics"] as ReportFilter[]).map((filter) => (
              <button
                key={filter}
                className={`dashboard-home__tab ${selectedFilter === filter ? "dashboard-home__tab--active" : ""}`.trim()}
                onClick={() => setSelectedFilter(filter)}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        <div className="dashboard-home__report-grid">
          {visibleReports.map((report) => (
            <article
              key={report.id}
              className={`dashboard-home__report-card ${selectedReportId === report.id ? "dashboard-home__report-card--selected" : ""}`.trim()}
            >
              <div className="dashboard-home__report-copy">
                <span className="dashboard-home__report-kind">{report.kind}</span>
                <h3>{report.label}</h3>
                <p>{report.description}</p>
              </div>

              <div className="dashboard-home__report-footer">
                <button
                  className="button button--secondary"
                  onClick={() => setSelectedReportId(report.id)}
                >
                  {selectedReportId === report.id ? "Selected" : "Select"}
                </button>
                <button className="dashboard-home__report-link" onClick={() => openReport(report)}>
                  {report.actionLabel}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="dashboard-home__lower-grid">
        <section className="dashboard-home__surface">
          <div className="dashboard-home__section-header">
            <div>
              <span className="dashboard-home__section-eyebrow">Presets</span>
              <h2>Quick start presets</h2>
            </div>
          </div>

          <div className="dashboard-home__preset-list">
            {presets.map((preset) => (
              <article key={preset.id} className="dashboard-home__preset-card">
                <div>
                  <strong>{preset.label}</strong>
                  <p>{preset.description}</p>
                </div>
                <button className="dashboard-home__preset-link" onClick={() => applyPreset(preset)}>
                  Use preset
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="dashboard-home__surface">
          <div className="dashboard-home__section-header">
            <div>
              <span className="dashboard-home__section-eyebrow">Preview</span>
              <h2>Placeholder summary</h2>
            </div>
          </div>

          <div className="dashboard-home__placeholder-grid">
            {placeholderCards.map((card) => (
              <article key={card.label} className="dashboard-home__placeholder-card">
                <span>{card.label}</span>
                <strong>{card.title}</strong>
                <p>{card.detail}</p>
                <div className="dashboard-home__ghost-lines" aria-hidden>
                  <i />
                  <i />
                  <i />
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      {loadState === "error" && error ? (
        <ErrorState label="Dashboard could not be loaded" detail={error} />
      ) : null}

      {loadState === "loading" && selectedReport.route === "/dashboard" ? (
        <section className="dashboard-home__loading">
          <div className="dashboard-home__section-header">
            <div>
              <span className="dashboard-home__section-eyebrow">Loading</span>
              <h2>Preparing dashboard view</h2>
            </div>
          </div>

          <div className="dashboard-home__loading-grid">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="dashboard-home__loading-card" />
            ))}
          </div>
          <div className="dashboard-home__loading-panel" />
        </section>
      ) : null}

      {loadState === "success" && data ? (
        <section className="dashboard-home__live">
          <div className="dashboard-home__section-header">
            <div>
              <span className="dashboard-home__section-eyebrow">Live dashboard</span>
              <h2>Loaded performance view</h2>
              <p>
                Active for {loadedSnapshot?.clinicName} from {loadedSnapshot?.fromDate} to {loadedSnapshot?.toDate}.
              </p>
            </div>

            <button className="button button--secondary" onClick={() => void loadDashboard()}>
              Refresh
            </button>
          </div>

          <div className="stats-grid">
            <StatCard
              label="Revenue"
              value={formatCurrency(data.summary.revenue, currency)}
              change={data.summary.revenueChange}
            />
            <StatCard
              label="Invoices"
              value={data.summary.invoices.toLocaleString("en-US")}
              change={data.summary.invoicesChange}
            />
            <StatCard
              label="Customers"
              value={data.summary.customers.toLocaleString("en-US")}
              change={data.summary.customersChange}
            />
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
            <Panel
              className="panel--tall"
              title="Revenue trend"
              subtitle="Daily paid revenue, loaded only after explicit user action."
            >
              {data.revenueTrend.length === 0 ? (
                <div className="inline-note">No paid revenue in this range.</div>
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

            <Panel
              className="panel--tall"
              title="Payment mix"
              subtitle="Ranked paid revenue by payment method."
            >
              {paymentMixSorted.length === 0 ? (
                <div className="inline-note">No payment methods in this range.</div>
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
                {
                  key: "invoices",
                  header: "Invoices",
                  render: (row) => row.invoices.toLocaleString("en-US"),
                },
              ]}
            />
          </Panel>
        </section>
      ) : null}
    </div>
  );
}
