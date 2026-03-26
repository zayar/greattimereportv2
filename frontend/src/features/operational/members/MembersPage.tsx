import { useState } from "react";
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

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operational"
        title="Members"
        description="This page uses the newer gt.apicore member resolver path so clinic-specific member names and search behavior remain aligned with the GT domain model."
        actions={
          <label className="field field--compact field--search">
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

      <Panel
        title={`${currentClinic?.name ?? "Clinic"} members`}
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

