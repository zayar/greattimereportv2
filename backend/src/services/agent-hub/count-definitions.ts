export type AgentCountDefinition = {
  grain: string;
  label: string;
  ownerMyanmarLabel: string;
  source: string;
  dateField: string;
  explanation: string;
};

export const APPOINTMENT_BOOKING_COUNT_DEFINITION = {
  grain: "appointment_booking",
  label: "appointment bookings",
  ownerMyanmarLabel: "appointment booking",
  source: "APICORE booking ledger",
  dateField: "FromTime / scheduled appointment time",
  explanation: "Counts scheduled appointment/booking rows. One appointment may later produce multiple treatment/service records.",
} satisfies AgentCountDefinition;

export const TREATMENT_SERVICE_RECORD_COUNT_DEFINITION = {
  grain: "treatment_service_record",
  label: "treatment/service records",
  ownerMyanmarLabel: "treatment/service records",
  source: "BigQuery daily treatment report",
  dateField: "CheckInTime",
  explanation: "Counts service/treatment rows. One appointment can have multiple treatment/service records.",
} satisfies AgentCountDefinition;
