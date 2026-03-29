import { apiClient } from "./http";
import type {
  AiCustomerInsightResponse,
  AiExecutiveSummaryResponse,
  AiLanguage,
  AiServiceInsightResponse,
} from "../types/domain";

type BaseAiRequest = {
  clinicId: string;
  clinicCode: string;
  fromDate: string;
  toDate: string;
  aiLanguage?: AiLanguage;
};

export async function fetchAiExecutiveSummary(
  params: BaseAiRequest & { filters?: Record<string, unknown> },
) {
  const response = await apiClient.post<{ success: true; data: AiExecutiveSummaryResponse }>(
    "/ai/executive-summary",
    params,
  );

  return response.data.data;
}

export async function fetchAiCustomerInsight(
  params: BaseAiRequest & {
    customerName: string;
    customerPhone: string;
  },
) {
  const response = await apiClient.post<{ success: true; data: AiCustomerInsightResponse }>(
    "/ai/customer-insight",
    params,
  );

  return response.data.data;
}

export async function fetchAiServiceInsight(
  params: BaseAiRequest & {
    serviceName: string;
  },
) {
  const response = await apiClient.post<{ success: true; data: AiServiceInsightResponse }>(
    "/ai/service-insight",
    params,
  );

  return response.data.data;
}
