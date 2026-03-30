import { apiClient } from "./http";
import type { TelegramIntegrationStatus, TelegramReportType } from "../types/domain";

type ApiEnvelope<T> = {
  success: true;
  data: T;
};

type ClinicScopedInput = {
  clinicId: string;
  clinicCode?: string;
  clinicName?: string;
};

export async function fetchTelegramIntegrationStatus(params: ClinicScopedInput) {
  const response = await apiClient.get<ApiEnvelope<TelegramIntegrationStatus>>("/integrations/telegram/status", {
    params,
  });

  return response.data.data;
}

export async function generateTelegramLinkCode(payload: ClinicScopedInput) {
  const response = await apiClient.post<ApiEnvelope<TelegramIntegrationStatus>>("/integrations/telegram/link-code", payload);
  return response.data.data;
}

export async function saveTelegramSettings(payload: ClinicScopedInput & {
  chatId: string;
  isTodayAppointmentReportEnabled: boolean;
  reportTime: string;
  isTodayPaymentReportEnabled: boolean;
  paymentReportTime: string;
  timezone: string;
}) {
  const response = await apiClient.post<ApiEnvelope<TelegramIntegrationStatus>>("/integrations/telegram/settings", payload);
  return response.data.data;
}

export async function unlinkTelegramIntegration(payload: { clinicId: string; chatId: string }) {
  const response = await apiClient.post<ApiEnvelope<TelegramIntegrationStatus>>("/integrations/telegram/unlink", payload);
  return response.data.data;
}

export async function sendTelegramTestReport(
  payload: ClinicScopedInput & { chatId: string; timezone?: string; reportType?: TelegramReportType },
) {
  const response = await apiClient.post<
    ApiEnvelope<{
      sentAt: string;
      reportType: TelegramReportType;
      appointmentCount?: number;
      paymentCount?: number;
      totalPaymentAmount?: number;
    }>
  >(
    "/integrations/telegram/send-test",
    payload,
  );
  return response.data.data;
}
