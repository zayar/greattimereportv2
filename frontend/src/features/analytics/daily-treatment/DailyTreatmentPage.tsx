import { useEffect, useMemo, useState } from "react";
import { fetchDailyTreatment } from "../../../api/analytics";
import { DataTable } from "../../../components/DataTable";
import { HorizontalBarList } from "../../../components/HorizontalBarList";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import type { DailyTreatmentResponse } from "../../../types/domain";
import { today } from "../../../utils/date";

export function DailyTreatmentPage() {
  const { currentClinic } = useAccess();
  const [date, setDate] = useState(today());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DailyTreatmentResponse | null>(null);

  useEffect(() => {
    if (!currentClinic) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetchDailyTreatment({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      date,
    })
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load daily treatment report.");
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
  }, [currentClinic, date]);

  const matrixColumns = useMemo(
    () => [
      { key: "therapist", header: "Therapist", render: (row: DailyTreatmentResponse["matrix"][number]) => row.therapistName },
      ...(data?.uniqueServices ?? []).map((serviceName) => ({
        key: serviceName,
        header: serviceName,
        render: (row: DailyTreatmentResponse["matrix"][number]) => (row.services[serviceName] ?? 0).toLocaleString("en-US"),
      })),
      {
        key: "total",
        header: "Total",
        render: (row: DailyTreatmentResponse["matrix"][number]) => row.totalServices.toLocaleString("en-US"),
      },
    ],
    [data?.uniqueServices],
  );

  return (
    <div className="page-stack analytics-report">
      <PageHeader
        eyebrow="Analytics"
        title="Daily treatment"
        description="Therapist activity, service totals, and detailed treatment rows for one clinic day."
        actions={
          <div className="filter-row analytics-report__filters">
            <label className="field field--compact">
              <span>Date</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
          </div>
        }
      />

      {error ? <ErrorState label="Daily treatment report could not be loaded" detail={error} /> : null}

      <div className="report-kpi-strip analytics-report__kpis">
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Treatments</span>
          <span className="report-kpi-strip__value">{(data?.summary.totalTreatments ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Rows returned for the selected date</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Therapists</span>
          <span className="report-kpi-strip__value">{(data?.summary.therapists ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Practitioners with activity</span>
        </div>
        <div className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Services</span>
          <span className="report-kpi-strip__value">{(data?.summary.uniqueServices ?? 0).toLocaleString("en-US")}</span>
          <span className="report-kpi-strip__hint">Unique services delivered</span>
        </div>
      </div>

      <div className="panel-grid panel-grid--split analytics-report__grid">
        <Panel
          className="analytics-report__panel analytics-report__panel--tall"
          title="Treatment matrix"
          subtitle={`Service distribution by therapist for ${currentClinic?.name ?? "the selected clinic"}.`}
        >
          {loading ? <div className="inline-note">Loading treatment matrix...</div> : null}
          {!loading && !error && (!data || data.matrix.length === 0) ? (
            <EmptyState label="No treatment data found for this date" detail="Try another day or verify clinic mapping." />
          ) : null}
          {data && data.matrix.length > 0 ? (
            <DataTable rows={data.matrix} rowKey={(row) => row.therapistName} columns={matrixColumns} />
          ) : null}
        </Panel>

        <Panel className="analytics-report__panel" title="Service totals" subtitle="Completed treatments by service.">
          {loading ? (
            <div className="inline-note">Loading service totals...</div>
          ) : !data || data.serviceTotals.length === 0 ? (
            <EmptyState label="No service totals available" />
          ) : (
            <HorizontalBarList
              items={data.serviceTotals.map((row) => ({
                label: row.serviceName,
                value: row.totalServices,
                valueDisplay: `${row.totalServices.toLocaleString("en-US")} treatments`,
              }))}
            />
          )}
        </Panel>
      </div>

      <Panel
        className="analytics-report__panel"
        title="Treatment records"
        subtitle={`${(data?.records.length ?? 0).toLocaleString("en-US")} detailed rows returned from BigQuery`}
      >
        {loading ? <div className="inline-note">Loading treatment records...</div> : null}
        {!loading && !error && (!data || data.records.length === 0) ? (
          <EmptyState label="No treatment records matched this date" />
        ) : null}
        {data && data.records.length > 0 ? (
          <DataTable
            rows={data.records}
            rowKey={(row) => `${row.checkInTime}-${row.therapistName}-${row.customerName}-${row.serviceName}`}
            columns={[
              { key: "time", header: "Check-in", render: (row) => row.checkInTime },
              { key: "therapist", header: "Therapist", render: (row) => row.therapistName },
              { key: "service", header: "Service", render: (row) => row.serviceName },
              { key: "customer", header: "Customer", render: (row) => row.customerName },
              { key: "phone", header: "Phone", render: (row) => row.customerPhone || "—" },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
