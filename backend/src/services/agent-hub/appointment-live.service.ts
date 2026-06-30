import {
  fetchApicoreBookingDetails,
  fetchApicoreCheckIns,
  type ApicoreBookingDetailsRow,
  type ApicoreCheckInRow,
} from "../apicore.service.js";
import {
  buildApicoreBookingDetailsDateRange,
  isApicoreBookingWallClockDateInRange,
} from "../apicore-booking-details-range.js";
import { buildUtcDayRangeForDateKeyInTimeZone } from "../telegram/time.js";
import { normalizeAppointmentLifecycle, type AppointmentLifecycleState } from "./appointment-lifecycle.js";
import { buildCustomerKey } from "./customer-identity.js";
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

export type LiveAppointmentSnapshot = {
  checkedAt: string;
  dataStatus: AgentDataStatus;
  rows: LiveAppointmentRow[];
  countsByLifecycle: Record<string, number>;
  countsByService: Record<string, number>;
  countsByPractitioner: Record<string, number>;
  warnings: Array<{ type: string; title: string; message: string }>;
};

const LIVE_APPOINTMENT_SNAPSHOT_CACHE_TTL_MS = 15_000;
type LiveAppointmentSourceDeps = {
  fetchBookingDetails: typeof fetchApicoreBookingDetails;
  fetchCheckIns: typeof fetchApicoreCheckIns;
};
const defaultLiveAppointmentSourceDeps: LiveAppointmentSourceDeps = {
  fetchBookingDetails: fetchApicoreBookingDetails,
  fetchCheckIns: fetchApicoreCheckIns,
};
const liveAppointmentSnapshotCache = new Map<
  string,
  {
    expiresAt: number;
    promise?: Promise<LiveAppointmentSnapshot>;
    value?: LiveAppointmentSnapshot;
  }
>();

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

function snapshotCacheKey(params: {
  clinicId: string;
  clinicCode: string;
  dateKey: string;
  timezone: string;
  rowLimit?: number;
  includeCheckIns?: boolean;
}) {
  return [
    params.clinicId,
    params.clinicCode.toLowerCase(),
    params.dateKey,
    params.timezone,
    String(params.rowLimit ?? 200),
    params.includeCheckIns === false ? "bookings_only" : "bookings_and_checkins",
  ].join("|");
}

async function loadLiveAppointmentSnapshot(params: {
  clinicId: string;
  clinicCode: string;
  dateKey: string;
  timezone: string;
  authorizationHeader?: string;
  rowLimit?: number;
  includeCheckIns?: boolean;
}, deps: LiveAppointmentSourceDeps = defaultLiveAppointmentSourceDeps): Promise<LiveAppointmentSnapshot> {
  const checkedAt = new Date().toISOString();
  const bookingRange = buildApicoreBookingDetailsDateRange({
    fromDate: params.dateKey,
    toDate: params.dateKey,
    timezone: params.timezone,
  });
  const checkInRange = buildUtcDayRangeForDateKeyInTimeZone(params.dateKey, params.timezone);
  const warnings: Array<{ type: string; title: string; message: string }> = [];
  let bookingRows: LiveAppointmentRow[] = [];
  let checkInRows: LiveAppointmentRow[] = [];
  let dataStatus: AgentDataStatus = "ok";

  try {
    const bookings = await deps.fetchBookingDetails({
      clinicCode: params.clinicCode,
      startDate: bookingRange.startIso,
      endDate: bookingRange.endIso,
      take: params.rowLimit ?? 200,
      authorizationHeader: params.authorizationHeader,
      readOnly: true,
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
          row.ClinicCode.toLowerCase() === params.clinicCode.toLowerCase() &&
          isApicoreBookingWallClockDateInRange(row.FromTime, params.dateKey, params.dateKey),
      )
      .map(bookingToLiveRow);
  } catch {
    dataStatus = params.includeCheckIns === false ? "unavailable" : "partial";
    warnings.push({
      type: "booking_source_unavailable",
      title: "Booking source unavailable",
      message:
        params.includeCheckIns === false
          ? "Live booking details could not be loaded."
          : "Live booking details could not be loaded. Check-in data is still shown when available.",
    });
  }

  if (params.includeCheckIns !== false) {
    try {
      const checkIns = await deps.fetchCheckIns({
        clinicId: params.clinicId,
        startDate: checkInRange.startIso,
        endDate: checkInRange.endIso,
        take: params.rowLimit ?? 200,
        authorizationHeader: params.authorizationHeader,
        readOnly: true,
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

export async function fetchLiveAppointmentSnapshot(params: {
  clinicId: string;
  clinicCode: string;
  dateKey: string;
  timezone: string;
  authorizationHeader?: string;
  rowLimit?: number;
  includeCheckIns?: boolean;
}) {
  const key = snapshotCacheKey(params);
  const now = Date.now();
  const cached = liveAppointmentSnapshotCache.get(key);

  if (cached && cached.expiresAt > now) {
    if (cached.value) {
      return cached.value;
    }
    if (cached.promise) {
      return cached.promise;
    }
  }

  const promise = loadLiveAppointmentSnapshot(params).then(
    (value) => {
      if (value.dataStatus === "unavailable") {
        liveAppointmentSnapshotCache.delete(key);
      } else {
        liveAppointmentSnapshotCache.set(key, {
          expiresAt: Date.now() + LIVE_APPOINTMENT_SNAPSHOT_CACHE_TTL_MS,
          value,
        });
      }
      return value;
    },
    (error) => {
      liveAppointmentSnapshotCache.delete(key);
      throw error;
    },
  );

  liveAppointmentSnapshotCache.set(key, {
    expiresAt: now + LIVE_APPOINTMENT_SNAPSHOT_CACHE_TTL_MS,
    promise,
  });

  return promise;
}

export function liveAppointmentEntityRef(row: LiveAppointmentRow, rank: number, clinicCode?: string): GreatTimeAgentEntityContext {
  return {
    entityType: "appointment",
    entityId: row.appointmentId,
    appointmentId: row.appointmentId,
    appointmentTime: row.scheduledFrom ?? row.checkInTime ?? undefined,
    appointmentStatus: row.rawStatus,
    customerKey: clinicCode
      ? buildCustomerKey({
          clinicCode,
          phoneNumber: row.customerPhone,
          customerName: row.customerName,
        })
      : undefined,
    displayName: row.customerName,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerPhoneMasked: row.customerPhoneMasked,
    serviceName: row.serviceName,
    practitionerName: row.practitionerName,
    rank,
  };
}

export const __test = {
  loadLiveAppointmentSnapshot,
  clearLiveAppointmentSnapshotCache: () => liveAppointmentSnapshotCache.clear(),
};
