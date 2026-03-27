import { useMemo, useState } from "react";
import { createSearchParams, useNavigate } from "react-router-dom";
import { DateRangeControls } from "../../components/DateRangeControls";
import { useAccess } from "../access/AccessProvider";
import { daysAgo, today } from "../../utils/date";

type ReportKind = "Operational" | "Analytics";
type ReportFilter = "All" | ReportKind;

type ReportOption = {
  id: string;
  label: string;
  description: string;
  kind: ReportKind;
  route: string;
};

type Preset = {
  id: string;
  label: string;
  reportId: string;
  days: number;
};

const reportOptions: ReportOption[] = [
  {
    id: "banking-summary",
    label: "Payment report",
    description: "Payment-method drilldown with detailed transaction rows.",
    kind: "Analytics",
    route: "/analytics/banking-summary",
  },
  {
    id: "customer-behavior",
    label: "Customer behavior",
    description: "Visit frequency, active members, and customer trends.",
    kind: "Analytics",
    route: "/analytics/customer-behavior",
  },
  {
    id: "service-behavior",
    label: "Service behavior",
    description: "Service demand, rankings, and treatment mix.",
    kind: "Analytics",
    route: "/analytics/service-behavior",
  },
  {
    id: "payment-report",
    label: "Sales details",
    description: "Detailed invoice rows, payment method tracking, and line-item review.",
    kind: "Analytics",
    route: "/analytics/payment-report",
  },
  {
    id: "sales-by-seller",
    label: "Sales by sales person",
    description: "Attributed revenue ranking and recent invoice flow by seller.",
    kind: "Analytics",
    route: "/analytics/sales-by-seller",
  },
  {
    id: "customers-by-salesperson",
    label: "Customer by salesperson",
    description: "Customers sourced by a selected sales person, ranked by spend.",
    kind: "Analytics",
    route: "/analytics/customers-by-salesperson",
  },
  {
    id: "appointments",
    label: "Appointments",
    description: "Operational booking flow and schedule visibility.",
    kind: "Operational",
    route: "/operational/appointments",
  },
];

const presets: Preset[] = [
  { id: "preset-30", label: "Last 30 days", reportId: "payment-report", days: 30 },
  { id: "preset-90", label: "Last 90 days", reportId: "customer-behavior", days: 90 },
  { id: "preset-180", label: "Last 180 days", reportId: "service-behavior", days: 180 },
];

export function DashboardPage() {
  const navigate = useNavigate();
  const { businesses, currentBusiness, currentClinic, selectBusiness, selectClinic } = useAccess();
  const [range, setRange] = useState({
    fromDate: daysAgo(30),
    toDate: today(),
  });
  const [selectedFilter, setSelectedFilter] = useState<ReportFilter>("All");
  const [selectedReportId, setSelectedReportId] = useState("banking-summary");

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

  function openReport(report: ReportOption) {
    setSelectedReportId(report.id);
    navigate({
      pathname: report.route,
      search: buildReportSearch(),
    });
  }

  function applyPreset(preset: Preset) {
    setSelectedReportId(preset.reportId);
    setRange({
      fromDate: daysAgo(preset.days),
      toDate: today(),
    });
  }

  function handleFilterChange(filter: ReportFilter) {
    setSelectedFilter(filter);

    if (filter === "All" || selectedReport.kind === filter) {
      return;
    }

    const nextReport = reportOptions.find((report) => report.kind === filter);
    if (nextReport) {
      setSelectedReportId(nextReport.id);
    }
  }

  return (
    <div className="page-stack dashboard-home">
      <section className="dashboard-home__intro">
        <div className="dashboard-home__intro-copy">
          <span className="page-header__eyebrow">Workspace</span>
          <h1>Select a report</h1>
          <p>Choose clinic, dates, and the report you want to open.</p>
        </div>

        <div className="dashboard-home__status">Reports load only after you open one.</div>
      </section>

      <section className="dashboard-home__setup">
        <div className="dashboard-home__setup-top">
          <div>
            <span className="dashboard-home__section-eyebrow">Filters</span>
            <h2>Report setup</h2>
          </div>

          <button className="dashboard-home__primary-action" onClick={() => openReport(selectedReport)}>
            View report
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
            <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />
          </div>
        </div>

        <div className="dashboard-home__preset-row">
          {presets.map((preset) => {
            const active = selectedReportId === preset.reportId;

            return (
              <button
                key={preset.id}
                className={`dashboard-home__preset-chip ${active ? "dashboard-home__preset-chip--active" : ""}`.trim()}
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="dashboard-home__reports">
        <div className="dashboard-home__section-header">
          <div>
            <span className="dashboard-home__section-eyebrow">Reports</span>
            <h2>Choose a workspace</h2>
          </div>

          <div className="dashboard-home__tabs">
            {(["All", "Operational", "Analytics"] as ReportFilter[]).map((filter) => (
              <button
                key={filter}
                className={`dashboard-home__tab ${selectedFilter === filter ? "dashboard-home__tab--active" : ""}`.trim()}
                onClick={() => handleFilterChange(filter)}
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
                <button className="button button--secondary" onClick={() => setSelectedReportId(report.id)}>
                  {selectedReportId === report.id ? "Selected" : "Select"}
                </button>
                <button className="dashboard-home__report-link" onClick={() => openReport(report)}>
                  Open report
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
