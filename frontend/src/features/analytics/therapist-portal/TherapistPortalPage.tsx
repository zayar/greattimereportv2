import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchTherapistPortal } from "../../../api/analytics";
import { DataTable } from "../../../components/DataTable";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { HorizontalBarList } from "../../../components/HorizontalBarList";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import type { TherapistPortalResponse } from "../../../types/domain";
import { startOfCurrentYear, today } from "../../../utils/date";
import { formatCurrency, formatDate, formatPercent } from "../../../utils/format";
import { useAccess } from "../../access/AccessProvider";
import { buildTherapistPortalDetailPath } from "./therapistPortalLink";

type SortBy =
  | "treatmentsCompleted"
  | "customersServed"
  | "estimatedTreatmentValue"
  | "repeatCustomerRate"
  | "growthRate"
  | "utilizationScore";
type SortDirection = "asc" | "desc";

export function TherapistPortalPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentClinic } = useAccess();
  const [range, setRange] = useState(() => ({
    fromDate: searchParams.get("fromDate") ?? startOfCurrentYear(),
    toDate: searchParams.get("toDate") ?? today(),
  }));
  const [search, setSearch] = useState("");
  const [serviceCategory, setServiceCategory] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("treatmentsCompleted");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const deferredSearch = useDeferredValue(search.trim());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TherapistPortalResponse | null>(null);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchTherapistPortal({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      fromDate: range.fromDate,
      toDate: range.toDate,
      search: deferredSearch,
      serviceCategory,
      sortBy,
      sortDirection,
    })
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load therapist portal.");
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
  }, [currentClinic, deferredSearch, range.fromDate, range.toDate, serviceCategory, sortBy, sortDirection]);

  const currency = currentClinic?.currency || "MMK";
  const summary = data?.summary;
  const highlight = data?.highlight;
  const contributionItems = useMemo(
    () =>
      (data?.leaderboard ?? []).slice(0, 8).map((row) => ({
        label: row.therapistName,
        value: row.treatmentsCompleted,
        valueDisplay: `${row.treatmentsCompleted.toLocaleString("en-US")} treatments • ${formatCurrency(row.estimatedTreatmentValue, currency)}`,
      })),
    [currency, data?.leaderboard],
  );
  const topServiceItems = useMemo(
    () =>
      (data?.topServices ?? []).map((row) => ({
        label: row.serviceName,
        value: row.treatmentsCompleted,
        valueDisplay: `${row.treatmentsCompleted.toLocaleString("en-US")} treatments • ${row.therapistCount.toLocaleString("en-US")} therapists`,
      })),
    [data?.topServices],
  );
  const categoryItems = useMemo(
    () =>
      (data?.serviceMix ?? []).map((row) => ({
        label: row.serviceCategory,
        value: row.treatmentsCompleted,
        valueDisplay: `${row.treatmentsCompleted.toLocaleString("en-US")} treatments • ${formatCurrency(row.estimatedTreatmentValue, currency)}`,
      })),
    [currency, data?.serviceMix],
  );

  const kpiCards = [
    {
      label: "Therapists in view",
      value: (summary?.totalTherapists ?? 0).toLocaleString("en-US"),
      hint: "Therapists with completed treatment activity in the selected window.",
    },
    {
      label: "Active therapists",
      value: (summary?.activeTherapists ?? 0).toLocaleString("en-US"),
      hint: "Distinct practitioners actively represented in visible treatment rows.",
    },
    {
      label: "Treatments",
      value: (summary?.totalTreatments ?? 0).toLocaleString("en-US"),
      hint: "Completed treatment rows mapped to therapists.",
    },
    {
      label: "Customers touched",
      value: (summary?.customersServed ?? 0).toLocaleString("en-US"),
      hint: "Distinct customers served across the visible therapist set.",
    },
  ];

  return (
    <div className="page-stack page-stack--workspace analytics-report therapist-portal">
      <PageHeader
        eyebrow="Therapists"
        title="Therapist portal"
        description="See which therapists drive demand, handle repeat customers well, and need capacity attention."
      />

      {error ? <ErrorState label="Therapist portal could not be loaded" detail={error} /> : null}

      <Panel
        className="analytics-report__panel therapist-portal__filter-panel"
        title="Therapist analytics filters"
        subtitle="Refine the therapist view by date, search, service category, and ranking priority."
      >
        <div className="service-portal__filter-grid">
          <label className="field field--search service-portal__search">
            <span>Search</span>
            <input
              type="search"
              placeholder="Therapist, service, or category"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />

          <label className="field field--compact">
            <span>Service category</span>
            <select value={serviceCategory} onChange={(event) => setServiceCategory(event.target.value)}>
              <option value="">All categories</option>
              {(data?.filterOptions.serviceCategories ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--compact">
            <span>Sort by</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortBy)}>
              <option value="treatmentsCompleted">Treatments</option>
              <option value="customersServed">Customers served</option>
              <option value="estimatedTreatmentValue">Treatment value</option>
              <option value="repeatCustomerRate">Repeat affinity</option>
              <option value="growthRate">Growth</option>
              <option value="utilizationScore">Utilization</option>
            </select>
          </label>

          <label className="field field--compact">
            <span>Direction</span>
            <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as SortDirection)}>
              <option value="desc">Highest first</option>
              <option value="asc">Lowest first</option>
            </select>
          </label>
        </div>
      </Panel>

      <div className="report-kpi-strip therapist-portal__kpis">
        {kpiCards.map((card) => (
          <div key={card.label} className="report-kpi-strip__card">
            <span className="report-kpi-strip__label">{card.label}</span>
            <span className="report-kpi-strip__value">{card.value}</span>
            <span className="report-kpi-strip__hint">{card.hint}</span>
          </div>
        ))}
      </div>

      <div className="panel-grid panel-grid--split therapist-portal__hero-grid">
        <Panel
          className="analytics-report__panel therapist-portal__panel"
          title="Top therapist this period"
          subtitle="A quick owner-facing read on who is currently carrying demand."
        >
          {loading ? (
            <div className="inline-note">Loading therapist highlight...</div>
          ) : !highlight ? (
            <EmptyState label="No therapist highlight available" />
          ) : (
            <button
              type="button"
              className="therapist-portal__highlight-card"
              onClick={() =>
                navigate(
                  buildTherapistPortalDetailPath({
                    therapistName: highlight.therapistName,
                    fromDate: range.fromDate,
                    toDate: range.toDate,
                  }),
                )
              }
            >
              <div className="therapist-portal__highlight-header">
                <strong>{highlight.therapistName}</strong>
                <span className="status-pill status-pill--premium">{highlight.topTherapistShare.toFixed(1)}% share</span>
              </div>
              <p>
                {highlight.topService || "Signature service not identified"} • {highlight.treatmentsCompleted.toLocaleString("en-US")} treatments
              </p>
              <div className="therapist-portal__highlight-metrics">
                <span>{formatCurrency(highlight.estimatedTreatmentValue, currency)}</span>
                <span>{highlight.repeatCustomerRate.toFixed(1)}% repeat</span>
                <span>{formatPercent(highlight.growthRate)} growth</span>
                <span>{highlight.utilizationScore}/100 utilization</span>
              </div>
            </button>
          )}
        </Panel>

        <Panel
          className="analytics-report__panel therapist-portal__panel"
          title="Therapist contribution share"
          subtitle="Who currently carries the largest share of visible treatment demand."
        >
          {loading ? (
            <div className="inline-note">Loading therapist contribution...</div>
          ) : contributionItems.length === 0 ? (
            <EmptyState label="No therapist contribution found" />
          ) : (
            <HorizontalBarList items={contributionItems} />
          )}
        </Panel>
      </div>

      <Panel
        className="analytics-report__panel therapist-portal__list-panel"
        title="Therapist leaderboard"
        subtitle={`${(data?.leaderboard.length ?? 0).toLocaleString("en-US")} therapists matched the current filters`}
      >
        {loading ? <div className="inline-note">Loading therapist leaderboard...</div> : null}
        {!loading && !error && (!data || data.leaderboard.length === 0) ? (
          <EmptyState label="No therapists matched these filters" detail="Try widening the date range or clearing the service category filter." />
        ) : null}
        {data && data.leaderboard.length > 0 ? (
          <DataTable
            rows={data.leaderboard}
            rowKey={(row) => row.therapistName}
            rowClassName={(row) =>
              row.workloadBand === "High load"
                ? "therapist-portal__row therapist-portal__row--high-load"
                : row.growthRate <= -12
                  ? "therapist-portal__row therapist-portal__row--attention"
                  : "therapist-portal__row"
            }
            onRowClick={(row) =>
              navigate(
                buildTherapistPortalDetailPath({
                  therapistName: row.therapistName,
                  fromDate: range.fromDate,
                  toDate: range.toDate,
                }),
              )
            }
            columns={[
              {
                key: "therapist",
                header: "Therapist",
                render: (row) => (
                  <div className="customer-portal__metric-cell">
                    <strong>{row.therapistName}</strong>
                    <span>
                      {row.topCategory} • {row.workloadBand}
                    </span>
                  </div>
                ),
              },
              {
                key: "demand",
                header: "Demand",
                render: (row) => (
                  <div className="customer-portal__metric-cell">
                    <strong>{row.treatmentsCompleted.toLocaleString("en-US")} treatments</strong>
                    <span>{formatCurrency(row.estimatedTreatmentValue, currency)}</span>
                  </div>
                ),
              },
              {
                key: "customers",
                header: "Customers",
                render: (row) => (
                  <div className="customer-portal__metric-cell">
                    <strong>{row.customersServed.toLocaleString("en-US")} served</strong>
                    <span>{row.repeatCustomerRate.toFixed(1)}% repeat affinity</span>
                  </div>
                ),
              },
              {
                key: "specialization",
                header: "Specialization",
                render: (row) => (
                  <div className="customer-portal__metric-cell">
                    <strong>{row.topService || "Unknown"}</strong>
                    <span>{row.topServiceShare.toFixed(1)}% of treatments</span>
                  </div>
                ),
              },
              {
                key: "momentum",
                header: "Momentum",
                render: (row) => (
                  <div className="customer-portal__metric-cell">
                    <strong>{formatPercent(row.growthRate)}</strong>
                    <span>{row.lastTreatmentDate ? `Last active ${formatDate(row.lastTreatmentDate)}` : "No recent activity"}</span>
                  </div>
                ),
              },
              {
                key: "utilization",
                header: "Utilization",
                render: (row) => (
                  <div className="customer-portal__metric-cell">
                    <strong>{row.utilizationScore}/100</strong>
                    <span>{row.activeDays.toLocaleString("en-US")} active days</span>
                  </div>
                ),
              },
            ]}
          />
        ) : null}
      </Panel>

      {data?.assumptions.length ? (
        <div className="customer-detail__assumptions therapist-portal__assumptions">
          {data.assumptions.map((assumption) => (
            <p key={assumption}>{assumption}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
