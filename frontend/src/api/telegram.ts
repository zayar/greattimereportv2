import { apiClient } from "./http";
import type {
  AiLanguage,
  TelegramAgentChatAccessMode,
  GtGrowthAiTelegramTargetPurpose,
  TelegramIntegrationStatus,
  TelegramOwnerAiFocusArea,
  TelegramOwnerAiTone,
  TelegramReportType,
  TelegramWeeklySummaryDayOfWeek,
  TelegramWeeklySummarySection,
} from "../types/domain";

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
  isAgentChatEnabled?: boolean;
  agentChatAccessMode?: TelegramAgentChatAccessMode;
  agentChatAllowedUserIds?: string[];
  isTodayAppointmentReportEnabled: boolean;
  reportTime: string;
  isTodayPaymentReportEnabled: boolean;
  paymentReportTime: string;
  targetPurpose?: GtGrowthAiTelegramTargetPurpose;
  isGtGrowthAiSalesAssistantEnabled?: boolean;
  gtGrowthAiSalesAssistantTime?: string;
  isGtGrowthAiOwnerProgressSummaryEnabled?: boolean;
  gtGrowthAiOwnerProgressSummaryTime?: string;
  isOwnerAiReportEnabled?: boolean;
  ownerAiReportTime?: string;
  ownerAiLanguage?: AiLanguage;
  ownerAiTone?: TelegramOwnerAiTone;
  ownerAiFocusAreas?: TelegramOwnerAiFocusArea[];
  ownerAiCustomInstruction?: string | null;
  isWeeklySummaryReportEnabled?: boolean;
  weeklySummaryReportTime?: string;
  weeklySummaryDayOfWeek?: TelegramWeeklySummaryDayOfWeek;
  weeklySummarySections?: TelegramWeeklySummarySection[];
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
  payload: ClinicScopedInput & {
    chatId: string;
    timezone?: string;
    reportType?: TelegramReportType;
    dateKey?: string;
    ownerAiLanguage?: AiLanguage;
    ownerAiTone?: TelegramOwnerAiTone;
    ownerAiFocusAreas?: TelegramOwnerAiFocusArea[];
    ownerAiCustomInstruction?: string | null;
    weeklySummarySections?: TelegramWeeklySummarySection[];
  },
) {
  const response = await apiClient.post<
    ApiEnvelope<{
      sentAt: string;
      reportType: TelegramReportType;
      dateKey?: string;
      appointmentCount?: number;
      paymentCount?: number;
      totalPaymentAmount?: number;
      ownerAiOverallStatus?: string;
    }>
  >(
    "/integrations/telegram/send-test",
    payload,
  );
  return response.data.data;
}

export async function resendTelegramReport(
  payload: ClinicScopedInput & {
    chatId: string;
    timezone?: string;
    reportType?: TelegramReportType;
    dateKey?: string;
    ownerAiLanguage?: AiLanguage;
    ownerAiTone?: TelegramOwnerAiTone;
    ownerAiFocusAreas?: TelegramOwnerAiFocusArea[];
    ownerAiCustomInstruction?: string | null;
    weeklySummarySections?: TelegramWeeklySummarySection[];
  },
) {
  const response = await apiClient.post<
    ApiEnvelope<{
      sentAt: string;
      reportType: TelegramReportType;
      dateKey?: string;
      appointmentCount?: number;
      paymentCount?: number;
      totalPaymentAmount?: number;
      ownerAiOverallStatus?: string;
    }>
  >(
    "/integrations/telegram/resend",
    payload,
  );
  return response.data.data;
}
