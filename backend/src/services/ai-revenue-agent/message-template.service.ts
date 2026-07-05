import type { AiRevenueAction } from "../../types/ai-revenue-agent.js";

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function customerName(action: AiRevenueAction) {
  return cleanText(action.customer.customerName, "Customer");
}

function serviceName(action: AiRevenueAction) {
  return cleanText(action.service.serviceName, "your service");
}

function packageOrServiceName(action: AiRevenueAction) {
  return cleanText(action.packageInfo.packageName) || cleanText(action.service.serviceName) || "your service package";
}

function remainingUnits(action: AiRevenueAction) {
  const value = Number(action.packageInfo.remainingUnits);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function appointmentDateTime(action: AiRevenueAction) {
  return cleanText(action.appointment.appointmentDateTime, "your scheduled appointment time");
}

export function buildAiRevenueMessageDraft(action: AiRevenueAction) {
  switch (action.actionType) {
    case "service_reminder_overdue":
      return `Mingalar par ${customerName(action)}, your ${serviceName(action)} service reminder is overdue. Would you like us to help arrange an appointment this week?`;

    case "service_reminder_follow_up":
      return `Mingalar par ${customerName(action)}, your ${serviceName(action)} service reminder is due. Would you like to book a convenient appointment time?`;

    case "unused_package_follow_up":
      return `Mingalar par ${customerName(action)}, you still have ${remainingUnits(action)} remaining session(s) for ${packageOrServiceName(action)}. Would you like us to help book your next appointment?`;

    case "appointment_confirmation_reminder":
      return `Reminder: your appointment is on ${appointmentDateTime(action)}. Please reply to confirm, reschedule, or cancel.`;

    case "no_show_recovery":
      return "We missed you at your appointment. Would you like us to help reschedule a convenient time?";

    case "cancelled_appointment_recovery":
      return `Mingalar par ${customerName(action)}, we noticed your ${serviceName(action)} appointment was cancelled. Would you like us to help arrange another convenient time?`;

    default:
      return `Mingalar par ${customerName(action)}, ${action.recommendedAction}`;
  }
}
