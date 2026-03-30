import { sendTodayPaymentReport } from "./payment-report.service.js";
import { sendTodayAppointmentReport } from "./report.service.js";
import { markTelegramDeliveryFailed, markTelegramDeliverySent } from "./storage.service.js";
import { formatDateKeyInTimeZone, normalizeTimeZone } from "./time.js";
import type { TelegramDeliveryTrigger, TelegramReportType } from "./types.js";

function getDeliveryErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Telegram delivery failed.";
}

export async function sendTrackedTelegramReport(input: {
  clinicId: string;
  clinicCode?: string;
  clinicName?: string;
  chatId: string;
  reportType: TelegramReportType;
  trigger: TelegramDeliveryTrigger;
  timezone?: string;
  authorizationHeader?: string;
  referenceDate?: Date;
}) {
  const timezone = normalizeTimeZone(input.timezone);
  const attemptedAt = new Date().toISOString();
  const dateKey = formatDateKeyInTimeZone(input.referenceDate ?? new Date(), timezone);

  try {
    if (input.reportType === "payment") {
      const sent = await sendTodayPaymentReport({
        chatId: input.chatId,
        clinicId: input.clinicId,
        clinicName: input.clinicName,
        timezone,
        authorizationHeader: input.authorizationHeader,
        referenceDate: input.referenceDate,
      });

      await markTelegramDeliverySent({
        clinicId: input.clinicId,
        clinicCode: input.clinicCode,
        clinicName: input.clinicName,
        chatId: input.chatId,
        reportType: input.reportType,
        trigger: input.trigger,
        sentAt: sent.sentAt,
        dateKey: sent.report.dateKey,
        timezone,
        paymentCount: sent.report.paymentCount,
        totalPaymentAmount: sent.report.totalPaymentAmount,
      });

      return sent;
    }

    if (!input.clinicCode) {
      throw new Error("Clinic code is required for appointment delivery.");
    }

    const sent = await sendTodayAppointmentReport({
      chatId: input.chatId,
      clinicCode: input.clinicCode,
      clinicName: input.clinicName,
      timezone,
      authorizationHeader: input.authorizationHeader,
      referenceDate: input.referenceDate,
    });

    await markTelegramDeliverySent({
      clinicId: input.clinicId,
      clinicCode: input.clinicCode,
      clinicName: input.clinicName,
      chatId: input.chatId,
      reportType: input.reportType,
      trigger: input.trigger,
      sentAt: sent.sentAt,
      dateKey: sent.report.dateKey,
      timezone,
      appointmentCount: sent.report.totalAppointments,
    });

    return sent;
  } catch (error) {
    await markTelegramDeliveryFailed({
      clinicId: input.clinicId,
      clinicCode: input.clinicCode,
      clinicName: input.clinicName,
      chatId: input.chatId,
      reportType: input.reportType,
      trigger: input.trigger,
      attemptedAt,
      dateKey,
      timezone,
      errorMessage: getDeliveryErrorMessage(error),
    });

    throw error;
  }
}
