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
  AiRevenueContactAttempt,
  AiRevenueContactChannel,
  AiRevenueContactResult,
  AiRevenueCustomerTimelineEvent,
  AiRevenueCustomerSuppression,
  AiRevenueFollowUpAttempt,
  AiRevenueFollowUpChannel,
  AiRevenueFollowUpResult,
  AiRevenueFollowUpScheduleOption,
  AiRevenueGenerationStatus,
  AiRevenueMessageEvent,
  AiRevenueOutcomeLink,
  AiRevenueOutcomeType,
  AiRevenuePriority,
  AiRevenueResolutionReason,
  AiRevenueSettings,
  AiRevenueSummary,
  AiRevenueSuppressionScope,
  AiRevenueVisibilityState,
  AiRevenueWorkflowState,
} from "../types/domain";

type ApiEnvelope<T> = {
  success: true;
  data: T;
};

export type AiRevenueActionQuery = {
  clinicId: string;
  dateKey?: string;
  dueDateKey?: string;
  dueStartDateKey?: string;
  dueEndDateKey?: string;
  source?: AiRevenueActionSource;
  actionType?: AiRevenueActionType;
  status?: AiRevenueActionStatus;
  workflowState?: AiRevenueWorkflowState;
  visibilityState?: AiRevenueVisibilityState;
  assignedToUserId?: string;
  lastContactResult?: AiRevenueContactResult;
  queueView?: "today" | "overdue" | "tomorrow" | "next_7_days" | "all_open" | "completed" | "suppressed";
  priority?: AiRevenuePriority;
  limit?: number;
  includeResolved?: boolean;
  includeHidden?: boolean;
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
    suppressedSkippedCount: number;
    actions: AiRevenueAction[];
    sourceStatus: Record<string, string>;
    summary: AiRevenueSummary;
    generationStatus: "completed";
    alreadyCompleted: boolean;
  }>>("/ai-revenue-agent/generate", payload);

  return response.data.data;
}

export async function getAiRevenueGenerationStatus(params: {
  clinicId: string;
  dateKey: string;
}) {
  const response = await apiClient.get<ApiEnvelope<{ generation: AiRevenueGenerationStatus }>>(
    "/ai-revenue-agent/generation-status",
    { params },
  );

  return response.data.data.generation;
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
  clinicCode?: string | null;
  clinicName?: string | null;
  aiRevenueAgentEnabled?: boolean;
  autoGenerateTodayOpportunities?: boolean;
  timezone?: string;
  dailyGenerateTime?: string;
  runOrder?: number;
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

export async function recordAiRevenueFollowUp(actionId: string, payload: {
  clinicId: string;
  channel: AiRevenueFollowUpChannel;
  result: AiRevenueFollowUpResult;
  note?: string | null;
  contactedAt?: string | null;
  scheduleOption?: AiRevenueFollowUpScheduleOption;
  nextFollowUpDate?: string | null;
  suppressionScope?: AiRevenueSuppressionScope | null;
  bookingId?: string | null;
  appointmentDateTime?: string | null;
  treatmentCompletedAt?: string | null;
  packageSessionUsedAt?: string | null;
  packageSessionsRecovered?: number | null;
  repurchaseInvoiceNumber?: string | null;
  repurchaseRevenue?: number | null;
  revenueAttributedAt?: string | null;
}) {
  const response = await apiClient.post<ApiEnvelope<{
    action: AiRevenueAction;
    attempt: AiRevenueFollowUpAttempt;
  }>>(`/ai-revenue-agent/actions/${encodeURIComponent(actionId)}/record-follow-up`, payload);

  return response.data.data;
}

export async function recordAiRevenueFollowUpAttempt(actionId: string, payload: {
  clinicId: string;
  channel: AiRevenueContactChannel;
  result: AiRevenueContactResult;
  note?: string | null;
  messageText?: string | null;
  nextFollowUpAt?: string | null;
  nextFollowUpDateKey?: string | null;
  suppressCustomer?: boolean;
  suppressionScope?: AiRevenueSuppressionScope;
  suppressionUntil?: string | null;
  permanentSuppression?: boolean;
  appointment?: {
    bookingId?: string | null;
    appointmentDateTime?: string | null;
    serviceId?: string | null;
    serviceName?: string | null;
    practitionerId?: string | null;
    practitionerName?: string | null;
    note?: string | null;
  };
  outcome?: {
    outcomeType?: AiRevenueOutcomeType;
    bookingId?: string | null;
    treatmentId?: string | null;
    orderId?: string | null;
    invoiceNumber?: string | null;
    serviceId?: string | null;
    serviceName?: string | null;
    revenueAmount?: number | null;
    packageSessionsRecovered?: number | null;
    attributionType?: AiRevenueAttributionType;
    eventAt?: string | null;
  };
}) {
  const response = await apiClient.post<ApiEnvelope<{
    action: AiRevenueAction;
    attempt: AiRevenueContactAttempt;
    timelineEvent: AiRevenueCustomerTimelineEvent;
    suppression: AiRevenueCustomerSuppression | null;
    outcomeLink: AiRevenueOutcomeLink | null;
  }>>(`/ai-revenue-agent/actions/${encodeURIComponent(actionId)}/follow-up-attempt`, payload);

  return response.data.data;
}

export async function getAiRevenueFollowUpAttempts(actionId: string, params: {
  clinicId: string;
  limit?: number;
}) {
  const response = await apiClient.get<ApiEnvelope<{ attempts: AiRevenueContactAttempt[] }>>(
    `/ai-revenue-agent/actions/${encodeURIComponent(actionId)}/follow-up-attempts`,
    { params },
  );

  return response.data.data.attempts;
}

export async function getAiRevenueOutcomeLinks(params: {
  clinicId: string;
  actionId?: string;
  outcomeType?: AiRevenueOutcomeType;
  startDateKey?: string;
  endDateKey?: string;
  limit?: number;
}) {
  const response = await apiClient.get<ApiEnvelope<{ outcomeLinks: AiRevenueOutcomeLink[] }>>(
    "/ai-revenue-agent/outcome-links",
    { params },
  );

  return response.data.data.outcomeLinks;
}

export async function createAiRevenueOutcomeLink(payload: {
  clinicId: string;
  actionId: string;
  outcomeType: AiRevenueOutcomeType;
  contactAttemptId?: string | null;
  bookingId?: string | null;
  treatmentId?: string | null;
  orderId?: string | null;
  invoiceNumber?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  revenueAmount?: number | null;
  packageSessionsRecovered?: number | null;
  attributionType?: AiRevenueAttributionType | null;
  attributionWindowDays?: number | null;
  confidence?: number | null;
  eventAt?: string | null;
}) {
  const response = await apiClient.post<ApiEnvelope<{ outcomeLink: AiRevenueOutcomeLink }>>(
    "/ai-revenue-agent/outcome-links",
    payload,
  );

  return response.data.data.outcomeLink;
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
