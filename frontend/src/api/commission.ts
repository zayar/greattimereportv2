import { apiClient } from "./http"
import type {
  CommissionAdjustment,
  CommissionAdjustmentPayload,
  CommissionGeneratePayload,
  CommissionGenerateResponse,
  CommissionRule,
  CommissionRulePayload,
  CommissionRun,
  CommissionRunDetail,
  CommissionSourceOptions,
} from "../features/commission/types"

type MerchantScopedParams = {
  clinicId: string
  merchantId: string
  merchantName: string
  branchIds: string[]
  branchCodes: string[]
}

function buildQueryParams(params: MerchantScopedParams & { monthKey?: string }) {
  return {
    clinicId: params.clinicId,
    merchantId: params.merchantId,
    merchantName: params.merchantName,
    branchIds: params.branchIds.join(","),
    branchCodes: params.branchCodes.join(","),
    monthKey: params.monthKey,
  }
}

export async function fetchCommissionOptions(params: MerchantScopedParams) {
  const response = await apiClient.get<{ success: true; data: CommissionSourceOptions }>("/commission/options", {
    params: buildQueryParams(params),
  })
  return response.data.data
}

export async function fetchCommissionRules(params: MerchantScopedParams) {
  const response = await apiClient.get<{ success: true; data: CommissionRule[] }>("/commission/rules", {
    params: buildQueryParams(params),
  })
  return response.data.data
}

export async function createCommissionRule(payload: CommissionRulePayload) {
  const response = await apiClient.post<{ success: true; data: CommissionRule }>("/commission/rules", payload)
  return response.data.data
}

export async function updateCommissionRule(ruleId: string, payload: CommissionRulePayload) {
  const response = await apiClient.put<{ success: true; data: CommissionRule }>(`/commission/rules/${ruleId}`, payload)
  return response.data.data
}

export async function duplicateCommissionRule(ruleId: string, clinicId: string) {
  const response = await apiClient.post<{ success: true; data: CommissionRule }>(
    `/commission/rules/${ruleId}/duplicate`,
    { clinicId },
  )
  return response.data.data
}

export async function archiveCommissionRule(ruleId: string, clinicId: string) {
  const response = await apiClient.post<{ success: true; data: CommissionRule }>(
    `/commission/rules/${ruleId}/archive`,
    { clinicId },
  )
  return response.data.data
}

export async function deleteCommissionRule(ruleId: string, clinicId: string) {
  const response = await apiClient.post<{ success: true; data: { ruleId: string } }>(
    `/commission/rules/${ruleId}/delete`,
    { clinicId },
  )
  return response.data.data
}

export async function fetchCommissionRuns(params: MerchantScopedParams & { monthKey?: string }) {
  const response = await apiClient.get<{ success: true; data: CommissionRun[] }>("/commission/runs", {
    params: buildQueryParams(params),
  })
  return response.data.data
}

export async function fetchCommissionRunDetail(runId: string, clinicId: string) {
  const response = await apiClient.get<{ success: true; data: CommissionRunDetail }>(`/commission/runs/${runId}`, {
    params: {
      clinicId,
    },
  })
  return response.data.data
}

export async function generateCommissionReport(payload: CommissionGeneratePayload) {
  const response = await apiClient.post<{ success: true; data: CommissionGenerateResponse }>(
    "/commission/reports/generate",
    payload,
  )
  return response.data.data
}

export async function createCommissionAdjustment(payload: CommissionAdjustmentPayload) {
  const response = await apiClient.post<{ success: true; data: CommissionAdjustment }>(
    "/commission/adjustments",
    payload,
  )
  return response.data.data
}
