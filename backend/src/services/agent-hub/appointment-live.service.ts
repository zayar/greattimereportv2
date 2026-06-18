import {
  fetchApicoreBookingDetails,
  fetchApicoreCheckIns,
  type ApicoreBookingDetailsRow,
  type ApicoreCheckInRow,
} from "../apicore.service.js";
import { buildUtcDayRangeForDateKeyInTimeZone } from "../telegram/time.js";
import { normalizeAppointmentLifecycle, type AppointmentLifecycleState } from "./appointment-lifecycle.js";
import { maskPhone } from "./safety.js";
import type { AgentDataStatus, GreatTimeAgentEntityContext } from "./types.js";

export type LiveAppointmentRow = {
  appointmentId: string;
  customerName: string;
  customerPhoneMasked: string;
  customerPhone?: string;
  memberId?: string | null;
  serviceName: string;
  practitionerName: string;
  scheduledFrom?: string | null;
  scheduledTo?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  rawStatus: string;
  lifecycleState: AppointmentLifecycleState;
  stateConfidence: "confirmed" | "inferred" | "unknown";
  sourceType: "booking" | "check_in";
};

function normalizeText(value: string | null | undefined, fallback = "Unknown") {
  const text = value?.trim();
  return text || fallback;
}

function normalizeRawStatus(value?: string | null) {
  return value?.trim().toUpperCase().replace(/[\s-]+/g, "_") ?? "";
}

export function isMerchantCancelledAppointment(row: Pick<LiveAppointmentRow, "rawStatus">) {
  return normalizeRawStatus(row.rawStatus) === "MERCHANT_CANCEL";
}

export function isActiveCheckedInAppointment(
  row: Pick<LiveAppointmentRow, "checkInTime" | "checkOutTime" | "lifecycleState" | "rawStatus">,
) {
  return (
    Boolean(row.checkInTime) &&
    !row.checkOutTime &&
    !isMerchantCancelledAppointment(row) &&
    row.lifecycleState !== "checked_out" &&
    row.lifecycleState !== "cancelled" &&
    row.lifecycleState !== "no_show"
  );
}

export function isCountableTodayAppointment(row: Pick<LiveAppointmentRow, "rawStatus">) {
  return !isMerchantCancelledAppointment(row);
}

function bookingToLiveRow(row: ApicoreBookingDetailsRow): LiveAppointmentRow {
  const lifecycle = normalizeAppointmentLifecycle({ rawStatus: row.status });

  return {
    appointmentId: row.bookingid,
    customerName: normalizeText(row.MemberName),
    customerPhoneMasked: maskPhone(row.MemberPhoneNumber),
    customerPhone: row.MemberPhoneNumber,
    serviceName: normalizeText(row.ServiceName),
    practitionerName: normalizeText(row.PractitionerName),
    scheduledFrom: row.FromTime,
    scheduledTo: row.ToTime,
    rawStatus: row.status,
    lifecycleState: lifecycle.state,
    stateConfidence: lifecycle.stateConfidence,
    sourceType: "booking",
  };
}

function checkInToLiveRow(row: ApicoreCheckInRow): LiveAppointmentRow {
  const lifecycle = normalizeAppointmentLifecycle({
    rawStatus: row.status,
    inTime: row.in_time,
    outTime: row.out_time,
  });
  const clinicMember = row.member?.clinic_members?.[0];

  return {
    appointmentId: row.id,
    customerName: normalizeText(clinicMember?.name ?? row.member?.name),
    customerPhoneMasked: maskPhone(clinicMember?.phonenumber ?? row.member?.phonenumber),
    customerPhone: clinicMember?.phonenumber ?? row.member?.phonenumber ?? undefined,
    memberId: null,
    serviceName: normalizeText(row.service?.name),
    practitionerName: normalizeText(row.practitioner?.name),
    checkInTime: row.in_time,
    checkOutTime: row.out_time ?? null,
    rawStatus: row.status,
    lifecycleState: lifecycle.state,
    stateConfidence: lifecycle.stateConfidence,
    sourceType: "check_in",
  };
}

function countBy<T extends string>(rows: LiveAppointmentRow[], key: (row: LiveAppointmentRow) => T) {
  return rows.reduce<Record<T, number>>(
    (acc, row) => {
      const value = key(row);
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    },
    {} as Record<T, number>,
  );
}

export async function fetchLiveAppointmentSnapshot(params: {
  clinicId: string;
  clinicCode: string;
  dateKey: string;
  timezone: string;
  authorizationHeader?: string;
  rowLimit?: number;
}) {
  const checkedAt = new Date().toISOString();
  const range = buildUtcDayRangeForDateKeyInTimeZone(params.dateKey, params.timezone);
  const warnings: Array<{ type: string; title: string; message: string }> = [];
  let bookingRows: LiveAppointmentRow[] = [];
  let checkInRows: LiveAppointmentRow[] = [];
  let dataStatus: AgentDataStatus = "ok";

  try {
    const bookings = await fetchApicoreBookingDetails({
      clinicCode: params.clinicCode,
      startDate: range.startIso,
      endDate: range.endIso,
      take: params.rowLimit ?? 200,
      authorizationHeader: params.authorizationHeader,
    });
    const mismatched = bookings.data.filter(
      (row) =>
        row.ClinicID !== params.clinicId ||
        row.ClinicCode.toLowerCase() !== params.clinicCode.toLowerCase(),
    );

    if (mismatched.length > 0) {
      warnings.push({
        type: "clinic_context_mismatch",
        title: "Clinic context mismatch",
        message: "Some booking rows did not match the authorized clinic and were excluded.",
      });
    }

    bookingRows = bookings.data
      .filter(
        (row) =>
          row.ClinicID === params.clinicId &&
          row.ClinicCode.toLowerCase() === params.clinicCode.toLowerCase(),
      )
      .map(bookingToLiveRow);
  } catch {
    dataStatus = "partial";
    warnings.push({
      type: "booking_source_unavailable",
      title: "Booking source unavailable",
      message: "Live booking details could not be loaded. Check-in data is still shown when available.",
    });
  }

  try {
    const checkIns = await fetchApicoreCheckIns({
      clinicId: params.clinicId,
      startDate: range.startIso,
      endDate: range.endIso,
      take: params.rowLimit ?? 200,
      authorizationHeader: params.authorizationHeader,
    });
    checkInRows = checkIns.data.map(checkInToLiveRow);
  } catch {
    dataStatus = bookingRows.length ? "partial" : "unavailable";
    warnings.push({
      type: "check_in_source_unavailable",
      title: "Check-in source unavailable",
      message: "Live check-in/out data could not be loaded.",
    });
  }

  const rows = [...checkInRows, ...bookingRows].slice(0, params.rowLimit ?? 200);
  if (rows.length === 0 && dataStatus === "ok") {
    dataStatus = "no_activity";
  }

  return {
    checkedAt,
    dataStatus,
    rows,
    countsByLifecycle: countBy(rows, (row) => row.lifecycleState),
    countsByService: countBy(rows, (row) => row.serviceName),
    countsByPractitioner: countBy(rows, (row) => row.practitionerName),
    warnings,
  };
}

export function liveAppointmentEntityRef(row: LiveAppointmentRow, rank: number): GreatTimeAgentEntityContext {
  return {
    entityType: "appointment",
    entityId: row.appointmentId,
    appointmentId: row.appointmentId,
    displayName: row.customerName,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    serviceName: row.serviceName,
    practitionerName: row.practitionerName,
    rank,
  };
}
