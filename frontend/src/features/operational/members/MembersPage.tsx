import { useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { DataTable } from "../../../components/DataTable";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { formatDate } from "../../../utils/format";
import type { MemberRow } from "../../../types/domain";
import { GET_MEMBERS } from "./queries";

type MembersResponse = {
  getMembers: MemberRow[];
};

const PAGE_SIZE = 20;

export function MembersPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, loading, error } = useQuery<MembersResponse>(GET_MEMBERS, {
    variables: {
      clinicId: currentClinic?.id,
      version: "v3",
      search: search.trim() || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    },
    skip: !currentClinic?.id,
  });

  const rows = data?.getMembers ?? [];
  const hasNextPage = rows.length === PAGE_SIZE;
  const activeCount = useMemo(() => rows.filter((row) => row.status === "ACTIVE").length, [rows]);
  const withMemberIdCount = useMemo(() => rows.filter((row) => row.member_id).length, [rows]);

  return (
    <div className="page-stack page-stack--workspace analytics-report internal-workspace">
      <PageHeader
        eyebrow="Operational"
        title="Members"
        description="Clinic member browsing built on the GT resolver path, now aligned to the shared V2 internal workspace system."
        actions={
          <label className="field field--compact field--search internal-workspace__search-field">
            <span>Search</span>
            <input
              type="text"
              value={search}
              placeholder="Member name, phone, member id"
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          </label>
        }
      />

      <div className="report-kpi-strip">
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Visible members</span>
          <strong className="report-kpi-strip__value">{rows.length.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Rows currently loaded into the member directory.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Active on page</span>
          <strong className="report-kpi-strip__value">{activeCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Visible members marked as active in the current page.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">With member ID</span>
          <strong className="report-kpi-strip__value">{withMemberIdCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Visible rows that already have an assigned member identifier.</span>
        </article>
      </div>

      <Panel
        className="internal-workspace__panel"
        title="Member directory"
        subtitle="Operational member browsing built on the GT resolver rather than fallback local data."
        action={
          <div className="pagination-controls">
            <button className="button button--secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              Previous
            </button>
            <span>Page {page}</span>
            <button
              className="button button--secondary"
              disabled={!hasNextPage}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        }
      >
        {loading ? <div className="inline-note">Loading members...</div> : null}
        {error ? <ErrorState label="Members could not be loaded" detail={error.message} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No members found" detail="Try a different search term or switch to another clinic." />
        ) : null}
        {!error && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: "name", header: "Name", render: (row) => row.name },
              { key: "phone", header: "Phone", render: (row) => row.phonenumber },
              { key: "memberId", header: "Member ID", render: (row) => row.member_id || "—" },
              { key: "status", header: "Status", render: (row) => <span className="chip">{row.status}</span> },
              { key: "joined", header: "Created", render: (row) => formatDate(row.created_at) },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
