import assert from "node:assert/strict";
import test from "node:test";
import type { ApicoreBookingDetailsRow } from "../src/services/apicore.service.ts";
import type { TodayAppointmentReportSummary } from "../src/services/telegram/types.ts";

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql";
process.env.GT_GROWTH_AI_FEATURE_STORE_ENABLED ??= "false";

const {
  __test: appointmentReportTest,
  formatTodayAppointmentTelegramMessage,
  summarizeTherapistLoad,
} = await import("../src/services/telegram/report.service.ts");

function buildAppointment(index: number, practitionerName: string): ApicoreBookingDetailsRow {
  return {
    bookingid: `booking-${index}`,
    FromTime: `2026-07-24T${String(index).padStart(2, "0")}:00:00.000Z`,
    ToTime: `2026-07-24T${String(index).padStart(2, "0")}:30:00.000Z`,
    ServiceName: `Service ${index}`,
    MemberName: `Customer ${index}`,
    MemberPhoneNumber: `95900000${index}`,
    PractitionerName: practitionerName,
    ClinicName: "GreatTime Test Clinic",
    ClinicCode: "GT-TEST",
    ClinicID: "clinic-test",
    status: "BOOKED",
  };
}

function buildReport(
  appointments: TodayAppointmentReportSummary["appointments"],
  therapistLoad: TodayAppointmentReportSummary["therapistLoad"],
): TodayAppointmentReportSummary {
  return {
    clinicName: "GreatTime Test Clinic",
    dateKey: "2026-07-24",
    timezone: "Asia/Yangon",
    totalAppointments: appointments.length,
    upcomingCount: appointments.length,
    completedCount: 0,
    cancelledCount: 0,
    noShowCount: 0,
    cancellationRatePercent: 0,
    noShowRatePercent: 0,
    appointments,
    topServices: [],
    therapistLoad,
    busyHours: [],
    underutilizedHours: [],
    completedCustomersWithoutFutureBookingCount: null,
    premium: {
      feature: "gt_growth_ai",
      enabled: false,
    },
  };
}

test("daily Telegram appointment report includes every appointment instead of a 12-row preview", () => {
  const rows = Array.from({ length: 17 }, (_, index) =>
    buildAppointment(index + 1, `Practitioner ${index + 1}`),
  );
  const appointments = appointmentReportTest.mapAppointments(rows, "Asia/Yangon");
  const message = formatTodayAppointmentTelegramMessage(buildReport(appointments, []));

  assert.equal(appointments.length, 17);
  assert.match(message, /Customer 1/);
  assert.match(message, /Customer 17/);
  assert.doesNotMatch(message, /more appointments/i);
});

test("daily Telegram therapist load includes every practitioner", () => {
  const practitionerNames = [
    "Nyein Ei Thu",
    "Dr Su Wadi",
    "Su Myat Yandar",
    "Practitioner 4",
    "Practitioner 5",
    "Practitioner 6",
    "Practitioner 7",
  ];
  const rows = practitionerNames.map((name, index) => buildAppointment(index + 1, name));
  rows.push(buildAppointment(8, "Nyein Ei Thu"));

  const therapistLoad = summarizeTherapistLoad(rows);
  const message = formatTodayAppointmentTelegramMessage(buildReport([], therapistLoad));

  assert.equal(therapistLoad.length, 7);
  assert.deepEqual(therapistLoad[0], { therapistName: "Nyein Ei Thu", count: 2 });
  practitionerNames.forEach((name) => {
    assert.match(message, new RegExp(name));
  });
});

test("complete appointment reports are split within Telegram's message limit", () => {
  const rows = Array.from({ length: 100 }, (_, index) =>
    buildAppointment((index % 23) + 1, `Practitioner ${index + 1}`),
  );
  const appointments = appointmentReportTest.mapAppointments(rows, "Asia/Yangon");
  const therapistLoad = summarizeTherapistLoad(rows);
  const message = formatTodayAppointmentTelegramMessage(buildReport(appointments, therapistLoad));
  const chunks = appointmentReportTest.splitTelegramMessage(message);

  assert.ok(message.length > 3900);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 3900));
  assert.equal(chunks.join("\n"), message);
});
