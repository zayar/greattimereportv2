import { apiClient } from "./http";
import type { TelegramIntegrationStatus } from "../types/domain";

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
  isTodayAppointmentReportEnabled: boolean;
  reportTime: string;
  timezone: string;
}) {
  const response = await apiClient.post<ApiEnvelope<TelegramIntegrationStatus>>("/integrations/telegram/settings", payload);
  return response.data.data;
}

export async function unlinkTelegramIntegration(payload: { clinicId: string }) {
  const response = await apiClient.post<ApiEnvelope<TelegramIntegrationStatus>>("/integrations/telegram/unlink", payload);
  return response.data.data;
}

export async function sendTelegramTestReport(payload: ClinicScopedInput & { timezone?: string }) {
  const response = await apiClient.post<ApiEnvelope<{ sentAt: string; appointmentCount: number }>>(
    "/integrations/telegram/send-test",
    payload,
  );
  return response.data.data;
}
