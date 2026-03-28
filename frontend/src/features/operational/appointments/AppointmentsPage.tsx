import { useMemo, useState } from "react";
import { useQuery } from "@apollo/client";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { DataTable } from "../../../components/DataTable";
import { Panel } from "../../../components/Panel";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { daysAgo, daysAhead } from "../../../utils/date";
import { formatDateTime } from "../../../utils/format";
import type { AppointmentRow } from "../../../types/domain";
import { GET_BOOKING_DETAILS } from "./queries";

type BookingDetailsResponse = {
  getBookingDetails: {
    data: AppointmentRow[];
    totalCount: number;
  };
};

const PAGE_SIZE = 20;

export function AppointmentsPage() {
  const { currentClinic } = useAccess();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({
    fromDate: daysAgo(7),
    toDate: daysAhead(7),
  });

  const { data, loading, error } = useQuery<BookingDetailsResponse>(GET_BOOKING_DETAILS, {
    variables: {
      clinicCode: currentClinic?.code,
      startDate: new Date(`${range.fromDate}T00:00:00.000Z`).toISOString(),
      endDate: new Date(`${range.toDate}T23:59:59.999Z`).toISOString(),
      status: status || undefined,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    },
    skip: !currentClinic?.code,
  });

  const rows = data?.getBookingDetails.data ?? [];
  const totalCount = data?.getBookingDetails.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const checkedOutCount = useMemo(
    () => rows.filter((row) => row.status === "CHECKOUT" || row.status === "CHECKED_OUT").length,
    [rows],
  );
  const noShowCount = useMemo(() => rows.filter((row) => row.status === "NO_SHOW").length, [rows]);

  return (
    <div className="page-stack page-stack--workspace analytics-report internal-workspace internal-workspace--soft appointments-report appointments-report--luxe">
      <PageHeader
        eyebrow="Operational"
        title="Appointments"
        description="Operational booking visibility for the currently selected clinic, rebuilt into the shared V2 workspace layout."
        actions={
          <div className="filter-row internal-workspace__filters appointments-report__filters">
            <DateRangeControls
              fromDate={range.fromDate}
              toDate={range.toDate}
              onChange={(next) => {
                setPage(1);
                setRange(next);
              }}
            />
            <label className="field field--compact">
              <span>Status</span>
              <select
                value={status}
                onChange={(event) => {
                  setPage(1);
                  setStatus(event.target.value);
                }}
              >
                <option value="">All</option>
                <option value="REQUEST">Request</option>
                <option value="BOOKED">Booked</option>
                <option value="CHECKIN">Check In</option>
                <option value="CHECKOUT">Check Out</option>
                <option value="NO_SHOW">No show</option>
              </select>
            </label>
          </div>
        }
      />

      <div className="report-kpi-strip">
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Appointments in range</span>
          <strong className="report-kpi-strip__value">{totalCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Booking records matched to the current clinic and date window.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Checked out on page</span>
          <strong className="report-kpi-strip__value">{checkedOutCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Visible rows already completed in the current result set.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">No-shows on page</span>
          <strong className="report-kpi-strip__value">{noShowCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Visible bookings that were marked as missed.</span>
        </article>
      </div>

      <Panel
        className="internal-workspace__panel"
        title="Appointment ledger"
        subtitle={`${totalCount.toLocaleString("en-US")} records in the selected date window`}
        action={
          <div className="pagination-controls">
            <button className="button button--secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              className="button button--secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        }
      >
        {loading ? <div className="inline-note">Loading appointments...</div> : null}
        {error ? <ErrorState label="Appointments could not be loaded" detail={error.message} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState label="No appointments matched these filters" detail="Try widening the date window or clearing the status filter." />
        ) : null}
        {!error && rows.length > 0 ? (
          <DataTable
            rows={rows}
            rowKey={(row) => row.bookingid}
            columns={[
              { key: "time", header: "Time", render: (row) => formatDateTime(row.FromTime) },
              { key: "member", header: "Member", render: (row) => row.MemberName },
              { key: "phone", header: "Phone", render: (row) => row.MemberPhoneNumber },
              { key: "service", header: "Service", render: (row) => row.ServiceName },
              { key: "practitioner", header: "Practitioner", render: (row) => row.PractitionerName },
              { key: "status", header: "Status", render: (row) => <span className="chip">{row.status}</span> },
              { key: "helper", header: "Helper", render: (row) => row.HelperName || "—" },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  );
}
