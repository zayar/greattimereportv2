import { apiClient } from "./http";
import type { ClinicFeatureAccessResponse } from "../types/domain";

type ApiEnvelope<T> = {
  success: true;
  data: T;
};

export async function fetchGtGrowthAiFeatureAccess(params: { clinicId: string }) {
  const response = await apiClient.get<ApiEnvelope<ClinicFeatureAccessResponse>>("/features/gt-growth-ai", {
    params,
  });

  return response.data.data;
}

export async function saveGtGrowthAiFeatureAccess(payload: { clinicId: string; enabled: boolean }) {
  const response = await apiClient.post<ApiEnvelope<ClinicFeatureAccessResponse>>("/features/gt-growth-ai", payload);

  return response.data.data;
}
