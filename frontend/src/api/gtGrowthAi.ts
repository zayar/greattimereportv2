import { apiClient } from "./http";
import type {
  GtGrowthAiActionPriority,
  GtGrowthAiSalesAction,
  GtGrowthAiSalesActionStatus,
  GtGrowthAiSalesActionType,
  GtGrowthAiSalesActionUpdateStatus,
  GtGrowthAiSalesAssistantProgress,
  GtGrowthAiSalesAssistantResponse,
  GtGrowthAiSalesAssistantSummary,
  GtGrowthAiTelegramTargetPurpose,
} from "../types/domain";

type ApiEnvelope<T> = {
  success: true;
  data: T;
};

type SalesAssistantClinicInput = {
  clinicId: string;
  clinicCode?: string;
  clinicName?: string;
  dateKey?: string;
};

export async function getSalesAssistantActions(params: SalesAssistantClinicInput & {
  status?: GtGrowthAiSalesActionStatus;
  actionType?: GtGrowthAiSalesActionType;
  priority?: GtGrowthAiActionPriority;
}) {
  const response = await apiClient.get<ApiEnvelope<GtGrowthAiSalesAssistantResponse>>(
    "/gt-growth-ai/sales-assistant/actions",
    { params },
  );

  return response.data.data;
}

export async function generateSalesAssistantActions(payload: SalesAssistantClinicInput & {
  forceRefresh?: boolean;
}) {
  const response = await apiClient.post<ApiEnvelope<GtGrowthAiSalesAssistantResponse & { generatedCount: number }>>(
    "/gt-growth-ai/sales-assistant/generate",
    payload,
  );

  return response.data.data;
}

export async function sendSalesAssistantTasks(payload: SalesAssistantClinicInput & {
  targetPurpose?: GtGrowthAiTelegramTargetPurpose;
}) {
  const response = await apiClient.post<ApiEnvelope<{
    dateKey: string;
    sentToSalesLead: boolean;
    salesTargetLabel: string;
    sentOwnerSummary: boolean;
    ownerTargetLabel: string | null;
    summary: GtGrowthAiSalesAssistantSummary;
    actionCount: number;
  }>>("/gt-growth-ai/sales-assistant/send", payload);

  return response.data.data;
}

export async function updateSalesAssistantActionStatus(actionId: string, payload: {
  clinicId: string;
  status: GtGrowthAiSalesActionUpdateStatus;
  note?: string;
}) {
  const response = await apiClient.post<ApiEnvelope<{
    action: GtGrowthAiSalesAction;
  }>>(`/gt-growth-ai/sales-assistant/actions/${encodeURIComponent(actionId)}/status`, payload);

  return response.data.data.action;
}

export async function getSalesAssistantProgress(params: SalesAssistantClinicInput) {
  const response = await apiClient.get<ApiEnvelope<{
    summary: GtGrowthAiSalesAssistantSummary;
    progress: GtGrowthAiSalesAssistantProgress;
  }>>("/gt-growth-ai/sales-assistant/progress", { params });

  return response.data.data;
}
