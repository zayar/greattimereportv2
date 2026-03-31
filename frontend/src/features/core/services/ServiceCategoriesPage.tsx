import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { useAccess } from "../../access/AccessProvider";
import type { ServiceTypeCategoryRow } from "../../../types/domain";
import { formatDate } from "../../../utils/format";
import { buildServiceTypeCategoryVariables, GET_SERVICE_TYPE_CATEGORIES } from "./queries";

type ServiceTypeCategoriesResponse = {
  serviceTypeCategories: ServiceTypeCategoryRow[];
};

function previewChannels(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  return value.split(",").map((entry) => entry.trim()).filter(Boolean).slice(0, 3).join(", ") || value;
}

function excerpt(value: string | null | undefined, limit = 120) {
  if (!value) {
    return "—";
  }

  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

export function ServiceCategoriesPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.toLowerCase());

  const { data, loading, error } = useQuery<ServiceTypeCategoriesResponse>(GET_SERVICE_TYPE_CATEGORIES, {
    variables: currentClinic ? buildServiceTypeCategoryVariables(currentClinic.id) : undefined,
    skip: !currentClinic,
  });

  const rows = useMemo(() => {
    const source = data?.serviceTypeCategories ?? [];
    if (!deferredSearch.trim()) {
      return source;
    }

    return source.filter((row) => {
      const haystack = [row.name, row.description ?? "", row.sale_channel ?? ""].join(" ").toLowerCase();
      return haystack.includes(deferredSearch.trim());
    });
  }, [data?.serviceTypeCategories, deferredSearch]);

  const privateCount = useMemo(() => rows.filter((row) => row.is_private).length, [rows]);

  return (
    <div className="page-stack page-stack--workspace analytics-report internal-workspace core-catalog-page">
      <PageHeader
        eyebrow="Core"
        title="Service type category"
        description="Service category definitions, privacy state, and sale-channel mapping from core."
        actions={
          <div className="filter-row internal-workspace__filters core-catalog-page__filters">
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Name, description, channel"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
        }
      />

      <div className="report-kpi-strip">
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Loaded categories</span>
          <strong className="report-kpi-strip__value">{rows.length.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Category records available for this clinic.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Private categories</span>
          <strong className="report-kpi-strip__value">{privateCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Categories currently marked as private in core.</span>
        </article>
      </div>

      <Panel
        className="internal-workspace__panel core-catalog-page__panel"
        title="Service category registry"
        subtitle="Use this view to audit category visibility, ordering, and linked sale channels."
      >
        {loading ? <div className="inline-note inline-note--loading">Loading service categories...</div> : null}
        {error ? <ErrorState label="Service categories could not be loaded" detail={error.message} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No service categories matched this search" detail="Try clearing the search to see all categories." />
        ) : null}
        {!error && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: "name", header: "Category", render: (row) => <strong>{row.name}</strong> },
              { key: "status", header: "Status", render: (row) => <span className="chip">{row.status}</span> },
              { key: "visibility", header: "Visibility", render: (row) => <span className="chip">{row.is_private ? "Private" : "Public"}</span> },
              { key: "order", header: "Order", render: (row) => `${row.order ?? 0}` },
              { key: "channels", header: "Sale channels", render: (row) => previewChannels(row.sale_channel) },
              { key: "description", header: "Description", render: (row) => excerpt(row.description) },
              { key: "created", header: "Created", render: (row) => formatDate(row.created_at) },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
