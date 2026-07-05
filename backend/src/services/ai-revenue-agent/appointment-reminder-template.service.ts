import type { AiRevenueAction } from "../../types/ai-revenue-agent.js";

export type AiAppointmentReminderTemplateType =
  | "immediate_confirmation"
  | "one_day_before"
  | "same_day"
  | "no_show_recovery";

function parseAppointmentDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value?: string | null) {
  const date = parseAppointmentDate(value);
  if (!date) {
    return value || "the selected time";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatTime(value?: string | null) {
  const date = parseAppointmentDate(value);
  if (!date) {
    return "the selected time";
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function inferAiAppointmentReminderTemplateType(action: AiRevenueAction): AiAppointmentReminderTemplateType {
  if (action.status === "no_show") {
    return "no_show_recovery";
  }

  const appointment = parseAppointmentDate(action.appointment.appointmentDateTime);
  if (!appointment) {
    return "immediate_confirmation";
  }

  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const tomorrow = new Date(`${todayKey}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const appointmentKey = appointment.toISOString().slice(0, 10);

  if (appointmentKey === todayKey) {
    return "same_day";
  }

  if (appointmentKey === tomorrow.toISOString().slice(0, 10)) {
    return "one_day_before";
  }

  return "immediate_confirmation";
}

export function buildAiAppointmentReminderMessage(
  action: AiRevenueAction,
  templateType = inferAiAppointmentReminderTemplateType(action),
) {
  const dateTime = formatDateTime(action.appointment.appointmentDateTime);
  const time = formatTime(action.appointment.appointmentDateTime);

  switch (templateType) {
    case "one_day_before":
      return `Reminder: your appointment is tomorrow at ${time}. Please reply to confirm, reschedule, or cancel.`;
    case "same_day":
      return `Reminder: your appointment is today at ${time}. We look forward to seeing you.`;
    case "no_show_recovery":
      return "We missed you at your appointment. Would you like us to help reschedule?";
    case "immediate_confirmation":
    default:
      return `Your appointment is booked for ${dateTime}. Thank you.`;
  }
}
