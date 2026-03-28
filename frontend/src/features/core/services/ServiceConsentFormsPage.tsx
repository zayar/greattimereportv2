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

export function ServiceConsentFormsPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.toLowerCase());

  const { data, loading, error } = useQuery<ServiceFormsResponse>(GET_SERVICE_FORM_TYPES, {
    variables: currentClinic ? buildServiceFormVariables(currentClinic.id, ["CONSENT"]) : undefined,
    skip: !currentClinic,
  });

  const rows = useMemo(() => {
    const source = data?.serviceFormTypes ?? [];
    if (!deferredSearch.trim()) {
      return source;
    }

    return source.filter((row) =>
      [row.name, row.description ?? "", row.legal_desc ?? ""].join(" ").toLowerCase().includes(deferredSearch.trim()),
    );
  }, [data?.serviceFormTypes, deferredSearch]);

  const imageCount = useMemo(() => rows.filter((row) => row.consent_image).length, [rows]);

  return (
    <div className="page-stack page-stack--workspace analytics-report core-catalog-page">
      <PageHeader
        eyebrow="Core"
        title="Service consent form"
        description="Consent-form templates, legal copy, and signing assets from core."
        actions={
          <div className="filter-row core-catalog-page__filters">
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Consent form name"
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
          <span className="report-kpi-strip__hint">Consent forms available in the clinic scope.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">With consent image</span>
          <strong className="report-kpi-strip__value">{imageCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Templates that include an uploaded consent image.</span>
        </article>
      </div>

      <Panel
        className="core-catalog-page__panel core-catalog-page__wide-table"
        title="Consent form library"
        subtitle="Read-only visibility into consent templates, media readiness, and signature alignment."
      >
        {loading ? <div className="inline-note">Loading consent forms...</div> : null}
        {error ? <ErrorState label="Consent forms could not be loaded" detail={error.message} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No consent forms matched this search" detail="Try clearing the search to see all consent templates." />
        ) : null}
        {!error && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: "name", header: "Form", render: (row) => <strong>{row.name}</strong> },
              { key: "status", header: "Status", render: (row) => <span className="chip">{row.status}</span> },
              { key: "image", header: "Image", render: (row) => <span className="chip">{row.consent_image ? "Available" : "Missing"}</span> },
              { key: "align", header: "Sign align", render: (row) => row.consent_sign_align || "—" },
              { key: "description", header: "Description", render: (row) => excerpt(row.description) },
              { key: "legal", header: "Legal text", render: (row) => excerpt(row.legal_desc) },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
