import { apiClient } from "./http";
import type {
  AiRevenueAction,
  AiRevenueActionSource,
  AiRevenueActionStatus,
  AiRevenueActionType,
  AiRevenueActionsResponse,
  AiRevenueAuditActorType,
  AiRevenueAuditLog,
  AiRevenueAttributionType,
  AiRevenueCustomerSuppression,
  AiRevenueMessageEvent,
  AiRevenuePriority,
  AiRevenueResolutionReason,
  AiRevenueSettings,
  AiRevenueSummary,
  AiRevenueSuppressionScope,
} from "../types/domain";

type ApiEnvelope<T> = {
  success: true;
  data: T;
};

export type AiRevenueActionQuery = {
  clinicId: string;
  dateKey?: string;
  source?: AiRevenueActionSource;
  actionType?: AiRevenueActionType;
  status?: AiRevenueActionStatus;
  priority?: AiRevenuePriority;
  limit?: number;
  includeResolved?: boolean;
};

export type AiRevenueSummaryQuery = {
  clinicId: string;
  startDateKey?: string;
  endDateKey?: string;
  source?: AiRevenueActionSource;
  actionType?: AiRevenueActionType;
  status?: AiRevenueActionStatus;
  priority?: AiRevenuePriority;
};

export type AiRevenueGeneratePayload = {
  clinicId: string;
  clinicCode: string;
  dateKey?: string;
  forceRefresh?: boolean;
};

export async function getAiRevenueActions(params: AiRevenueActionQuery) {
  const response = await apiClient.get<ApiEnvelope<AiRevenueActionsResponse>>(
    "/ai-revenue-agent/actions",
    { params },
  );

  return response.data.data;
}

export async function generateAiRevenueActions(payload: AiRevenueGeneratePayload) {
  const response = await apiClient.post<ApiEnvelope<{
    dateKey: string;
    generatedCount: number;
    skippedExistingCount: number;
    refreshedExistingCount: number;
    actions: AiRevenueAction[];
    sourceStatus: Record<string, string>;
    summary: AiRevenueSummary;
  }>>("/ai-revenue-agent/generate", payload);

  return response.data.data;
}

export async function getAiRevenueSummary(params: AiRevenueSummaryQuery) {
  const response = await apiClient.get<ApiEnvelope<{ summary: AiRevenueSummary }>>(
    "/ai-revenue-agent/summary",
    { params },
  );

  return response.data.data.summary;
}

export async function getAiRevenueAuditLogs(params: {
  clinicId: string;
  actionId?: string;
  actorType?: AiRevenueAuditActorType;
  limit?: number;
}) {
  const response = await apiClient.get<ApiEnvelope<{ auditLogs: AiRevenueAuditLog[] }>>(
    "/ai-revenue-agent/audit-logs",
    { params },
  );

  return response.data.data.auditLogs;
}

export async function getAiRevenueSettings(params: { clinicId: string }) {
  const response = await apiClient.get<ApiEnvelope<{ settings: AiRevenueSettings }>>(
    "/ai-revenue-agent/settings",
    { params },
  );

  return response.data.data.settings;
}

export async function saveAiRevenueSettings(payload: {
  clinicId: string;
  language?: AiRevenueSettings["language"];
  messagingMode?: AiRevenueSettings["messagingMode"];
  approvalRequired?: boolean;
  attributionWindowDays?: number;
  maxActionsPerRun?: number;
}) {
  const response = await apiClient.post<ApiEnvelope<{ settings: AiRevenueSettings }>>(
    "/ai-revenue-agent/settings",
    payload,
  );

  return response.data.data.settings;
}

export async function generateAiRevenueMessage(actionId: string, payload: {
  clinicId: string;
  draftText?: string | null;
}) {
  const response = await apiClient.post<ApiEnvelope<{ action: AiRevenueAction }>>(
    `/ai-revenue-agent/actions/${encodeURIComponent(actionId)}/generate-message`,
    payload,
  );

  return response.data.data.action;
}

export async function approveAiRevenueMessage(actionId: string, payload: {
  clinicId: string;
  approvedText: string;
}) {
  const response = await apiClient.post<ApiEnvelope<{ action: AiRevenueAction }>>(
    `/ai-revenue-agent/actions/${encodeURIComponent(actionId)}/approve-message`,
    payload,
  );

  return response.data.data.action;
}

export async function rejectAiRevenueAction(actionId: string, payload: {
  clinicId: string;
  note?: string;
}) {
  const response = await apiClient.post<ApiEnvelope<{ action: AiRevenueAction }>>(
    `/ai-revenue-agent/actions/${encodeURIComponent(actionId)}/reject`,
    payload,
  );

  return response.data.data.action;
}

export async function resolveAiRevenueAction(actionId: string, payload: {
  clinicId: string;
  reason: AiRevenueResolutionReason;
  note?: string | null;
  suppressCustomer?: boolean;
  permanentSuppression?: boolean;
  suppressUntil?: string | null;
  snoozeDays?: number;
  scope?: AiRevenueSuppressionScope;
}) {
  const response = await apiClient.post<ApiEnvelope<{ action: AiRevenueAction }>>(
    `/ai-revenue-agent/actions/${encodeURIComponent(actionId)}/resolve`,
    payload,
  );

  return response.data.data.action;
}

export async function getAiRevenueSuppressions(params: {
  clinicId: string;
  includeInactive?: boolean;
  limit?: number;
}) {
  const response = await apiClient.get<ApiEnvelope<{ suppressions: AiRevenueCustomerSuppression[] }>>(
    "/ai-revenue-agent/suppressions",
    { params },
  );

  return response.data.data.suppressions;
}

export async function liftAiRevenueSuppression(suppressionId: string, payload: {
  clinicId: string;
}) {
  const response = await apiClient.post<ApiEnvelope<{ suppression: AiRevenueCustomerSuppression }>>(
    `/ai-revenue-agent/suppressions/${encodeURIComponent(suppressionId)}/lift`,
    payload,
  );

  return response.data.data.suppression;
}

export async function markAiRevenueMessageSent(actionId: string, payload: {
  clinicId: string;
  channel?: string;
  messageText?: string;
  providerMessageId?: string | null;
  sentAt?: string;
}) {
  const response = await apiClient.post<ApiEnvelope<{
    action: AiRevenueAction;
    event: AiRevenueMessageEvent | null;
  }>>(`/ai-revenue-agent/actions/${encodeURIComponent(actionId)}/mark-sent`, payload);

  return response.data.data;
}

export async function recordAiRevenueReply(actionId: string, payload: {
  clinicId: string;
  channel?: string;
  replyText: string;
  providerMessageId?: string | null;
  receivedAt?: string;
}) {
  const response = await apiClient.post<ApiEnvelope<{
    action: AiRevenueAction;
    event: AiRevenueMessageEvent;
    intent: string;
    confidence: number;
  }>>(`/ai-revenue-agent/actions/${encodeURIComponent(actionId)}/record-reply`, payload);

  return response.data.data;
}

export async function requestAiRevenueBooking(actionId: string, payload: {
  clinicId: string;
  requestedDateTime?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  practitionerId?: string | null;
  practitionerName?: string | null;
  note?: string | null;
  mode?: "direct_booking" | "booking_request";
}) {
  const response = await apiClient.post<ApiEnvelope<{ action: AiRevenueAction }>>(
    `/ai-revenue-agent/actions/${encodeURIComponent(actionId)}/request-booking`,
    payload,
  );

  return response.data.data.action;
}

export async function updateAiRevenueAppointment(actionId: string, payload: {
  clinicId: string;
  updateType?:
    | "appointment_confirmed"
    | "reminder_sent"
    | "customer_came"
    | "cancelled"
    | "no_show"
    | "completed"
    | "sync_outcome";
  syncOutcome?: boolean;
  bookingId?: string | null;
  appointmentDateTime?: string | null;
  bookingStatus?: string | null;
  reminderSentAt?: string | null;
  cameAt?: string | null;
  cancelledAt?: string | null;
  noShowAt?: string | null;
  completedAt?: string | null;
  reminderTemplateType?: "immediate_confirmation" | "one_day_before" | "same_day" | "no_show_recovery";
  status?: AiRevenueActionStatus;
}) {
  const response = await apiClient.post<ApiEnvelope<{ action: AiRevenueAction }>>(
    `/ai-revenue-agent/actions/${encodeURIComponent(actionId)}/update-appointment`,
    payload,
  );

  return response.data.data.action;
}

export async function recordAiRevenue(actionId: string, payload: {
  clinicId: string;
  actualRevenue?: number | null;
  influencedRevenue?: number | null;
  packageSessionsRecovered?: number | null;
  orderId?: string | null;
  invoiceNumber?: string | null;
  attributionType?: AiRevenueAttributionType;
  revenueAt?: string | null;
  revenueNote?: string | null;
}) {
  const response = await apiClient.post<ApiEnvelope<{ action: AiRevenueAction }>>(
    `/ai-revenue-agent/actions/${encodeURIComponent(actionId)}/record-revenue`,
    payload,
  );

  return response.data.data.action;
}

export async function syncAiRevenue(actionId: string, payload: {
  clinicId: string;
  clinicCode?: string | null;
  attributionWindowDays?: number;
}) {
  const response = await apiClient.post<ApiEnvelope<{ action: AiRevenueAction }>>(
    `/ai-revenue-agent/actions/${encodeURIComponent(actionId)}/sync-revenue`,
    payload,
  );

  return response.data.data.action;
}
