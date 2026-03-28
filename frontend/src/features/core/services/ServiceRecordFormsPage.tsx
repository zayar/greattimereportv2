import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { useAccess } from "../../access/AccessProvider";
import type { ServiceFormRow } from "../../../types/domain";
import { buildServiceFormVariables, GET_SERVICE_FORM_TYPES } from "./queries";

type ServiceFormsResponse = {
  serviceFormTypes: ServiceFormRow[];
};

function excerpt(value: string | null | undefined, limit = 120) {
  if (!value) {
    return "—";
  }

  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

export function ServiceRecordFormsPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.toLowerCase());

  const { data, loading, error } = useQuery<ServiceFormsResponse>(GET_SERVICE_FORM_TYPES, {
    variables: currentClinic ? buildServiceFormVariables(currentClinic.id, ["RECORD"]) : undefined,
    skip: !currentClinic,
  });

  const rows = useMemo(() => {
    const source = data?.serviceFormTypes ?? [];
    if (!deferredSearch.trim()) {
      return source;
    }

    return source.filter((row) => {
      const labels = (row.terms ?? []).map((term) => term.term).join(" ");
      return [row.name, row.description ?? "", row.legal_desc ?? "", labels].join(" ").toLowerCase().includes(deferredSearch.trim());
    });
  }, [data?.serviceFormTypes, deferredSearch]);

  const activeCount = useMemo(() => rows.filter((row) => row.status === "ACTIVE").length, [rows]);

  return (
    <div className="page-stack page-stack--workspace analytics-report core-catalog-page">
      <PageHeader
        eyebrow="Core"
        title="Service record form"
        description="Record-form templates from core, including legal text and dynamic term sets."
        actions={
          <div className="filter-row core-catalog-page__filters">
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Form name or term"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
        }
      />

      <div className="report-kpi-strip">
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Loaded forms</span>
          <strong className="report-kpi-strip__value">{rows.length.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Record templates visible to this clinic.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Active forms</span>
          <strong className="report-kpi-strip__value">{activeCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Templates currently active for operational use.</span>
        </article>
      </div>

      <Panel
        className="core-catalog-page__panel core-catalog-page__wide-table"
        title="Record form library"
        subtitle="A read-only operational audit of record forms, their term blocks, and their current publishing state."
      >
        {loading ? <div className="inline-note">Loading record forms...</div> : null}
        {error ? <ErrorState label="Record forms could not be loaded" detail={error.message} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No record forms matched this search" detail="Try clearing the search to see all record templates." />
        ) : null}
        {!error && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: "name", header: "Form", render: (row) => <strong>{row.name}</strong> },
              { key: "status", header: "Status", render: (row) => <span className="chip">{row.status}</span> },
              {
                key: "terms",
                header: "Fields",
                render: (row) => `${(row.terms ?? []).filter((term) => term.type === "LABEL").length} labels / ${(row.terms ?? []).filter((term) => term.type === "UNIT").length} units`,
              },
              { key: "description", header: "Description", render: (row) => excerpt(row.description) },
              { key: "legal", header: "Legal text", render: (row) => excerpt(row.legal_desc) },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
