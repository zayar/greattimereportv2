import { useEffect, useMemo, useState } from "react";
import { fetchDailyTreatment } from "../../../api/analytics";
import { DataTable } from "../../../components/DataTable";
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
    <div className="page-stack">
      <PageHeader
        eyebrow="Analytics"
        title="Daily treatment"
        description="A secured BigQuery treatment matrix by therapist and service for the selected clinic and date."
        actions={
          <label className="field field--compact">
            <span>Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        }
      />

      {error ? <ErrorState label="Daily treatment report could not be loaded" detail={error} /> : null}

      <div className="panel-grid panel-grid--triple">
        <Panel title="Treatments" subtitle="Total treatment rows for the selected day">
          <strong className="panel-stat">{(data?.summary.totalTreatments ?? 0).toLocaleString("en-US")}</strong>
        </Panel>
        <Panel title="Therapists" subtitle="Distinct practitioners with at least one treatment">
          <strong className="panel-stat">{(data?.summary.therapists ?? 0).toLocaleString("en-US")}</strong>
        </Panel>
        <Panel title="Services" subtitle="Unique services delivered on the selected day">
          <strong className="panel-stat">{(data?.summary.uniqueServices ?? 0).toLocaleString("en-US")}</strong>
        </Panel>
      </div>

      <div className="panel-grid panel-grid--split">
        <Panel
          title="Treatment matrix"
          subtitle={`Service distribution by therapist for ${currentClinic?.name ?? "the selected clinic"}`}
        >
          {loading ? <div className="inline-note">Loading treatment matrix...</div> : null}
          {!loading && !error && (!data || data.matrix.length === 0) ? (
            <EmptyState label="No treatment data found for this date" detail="Try another day or verify that the clinic code maps to analytics data." />
          ) : null}
          {data && data.matrix.length > 0 ? (
            <DataTable
              rows={data.matrix}
              rowKey={(row) => row.therapistName}
              columns={matrixColumns}
            />
          ) : null}
        </Panel>

        <Panel title="Service totals" subtitle="Total completed treatments by service">
          {loading ? (
            <div className="inline-note">Loading service totals...</div>
          ) : !data || data.serviceTotals.length === 0 ? (
            <EmptyState label="No service totals available" />
          ) : (
            <div className="metric-list">
              {data.serviceTotals.map((row) => (
                <div key={row.serviceName} className="metric-list__item">
                  <span>{row.serviceName}</span>
                  <strong>{row.totalServices.toLocaleString("en-US")}</strong>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel
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
