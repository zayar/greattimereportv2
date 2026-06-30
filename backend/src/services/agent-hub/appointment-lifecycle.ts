export type AppointmentLifecycleState =
  | "requested"
  | "booked"
  | "arrived_start_unknown"
  | "waiting_for_treatment"
  | "treatment_in_progress"
  | "checked_out"
  | "cancelled"
  | "no_show"
  | "unknown";

export type AppointmentStateConfidence = "confirmed" | "inferred" | "unknown";

export type AppointmentLifecycleInput = {
  rawStatus?: string | null;
  inTime?: string | null;
  outTime?: string | null;
  treatmentStartedAt?: string | null;
  treatmentCompletedAt?: string | null;
  treatmentStartKnown?: boolean;
};

function normalizeRawStatus(value?: string | null) {
  return value?.trim().toUpperCase().replace(/[\s-]+/g, "_") ?? "";
}

export function normalizeAppointmentLifecycle(input: AppointmentLifecycleInput): {
  state: AppointmentLifecycleState;
  stateConfidence: AppointmentStateConfidence;
} {
  const rawStatus = normalizeRawStatus(input.rawStatus);

  if (input.outTime || input.treatmentCompletedAt || rawStatus === "CHECKOUT" || rawStatus === "CHECKED_OUT") {
    return { state: "checked_out", stateConfidence: "confirmed" };
  }

  if (rawStatus === "MERCHANT_CANCEL" || rawStatus === "MEMBER_CANCEL" || rawStatus === "CANCEL" || rawStatus === "CANCELLED") {
    return { state: "cancelled", stateConfidence: "confirmed" };
  }

  if (rawStatus === "NO_SHOW" || rawStatus === "NOSHOW") {
    return { state: "no_show", stateConfidence: "confirmed" };
  }

  if (input.treatmentStartedAt) {
    return { state: "treatment_in_progress", stateConfidence: "confirmed" };
  }

  if (rawStatus === "CHECKIN" || rawStatus === "CHECK_IN" || input.inTime) {
    if (input.treatmentStartKnown) {
      return { state: "waiting_for_treatment", stateConfidence: "confirmed" };
    }

    return { state: "arrived_start_unknown", stateConfidence: "inferred" };
  }

  if (rawStatus === "REQUEST" || rawStatus === "REQUESTED") {
    return { state: "requested", stateConfidence: "confirmed" };
  }

  if (rawStatus === "BOOKED" || rawStatus === "BOOKING") {
    return { state: "booked", stateConfidence: "confirmed" };
  }

  return { state: "unknown", stateConfidence: "unknown" };
}

export function isTreatmentStartUnsupportedIntent(intent: string) {
  return intent === "waiting_customers" || intent === "treatment_in_progress";
}
