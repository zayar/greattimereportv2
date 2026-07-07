export const aiRevenueActionSources = [
  "bigquery",
  "apicore",
  "firestore",
  "service_reminder",
  "package_portal",
  "appointment_report",
  "payment_report",
  "manual",
] as const;

export type AiRevenueActionSource = (typeof aiRevenueActionSources)[number];

export const aiRevenueActionTypes = [
  "service_reminder_follow_up",
  "service_reminder_overdue",
  "unused_package_follow_up",
  "appointment_confirmation_reminder",
  "no_show_recovery",
  "cancelled_appointment_recovery",
  "inactive_vip_recovery",
  "package_upsell_opportunity",
  "payment_follow_up",
] as const;

export type AiRevenueActionType = (typeof aiRevenueActionTypes)[number];

export const aiRevenueActionStatuses = [
  "new",
  "draft_ready",
  "pending_approval",
  "approved",
  "sent",
  "customer_replied",
  "appointment_suggested",
  "appointment_requested",
  "appointment_created",
  "appointment_confirmed",
  "reminder_sent",
  "customer_came",
  "completed",
  "revenue_attributed",
  "cancelled",
  "no_show",
  "not_interested",
  "human_takeover",
  "skipped",
  "closed",
] as const;

export type AiRevenueActionStatus = (typeof aiRevenueActionStatuses)[number];

export const aiRevenueWorkflowStates = [
  "new",
  "assigned",
  "contacted",
  "scheduled_follow_up",
  "waiting_customer",
  "appointment_booked",
  "watching_outcome",
  "completed",
  "closed",
] as const;

export type AiRevenueWorkflowState = (typeof aiRevenueWorkflowStates)[number];

export const aiRevenueVisibilityStates = [
  "active",
  "scheduled",
  "completed",
  "suppressed",
  "hidden",
] as const;

export type AiRevenueVisibilityState = (typeof aiRevenueVisibilityStates)[number];

export const aiRevenueAttributionTypes = [
  "exact_booking",
  "same_customer_window",
  "manual",
  "package_recovery",
  "unknown",
] as const;

export type AiRevenueAttributionType = (typeof aiRevenueAttributionTypes)[number];

export const aiRevenueResolutionReasons = [
  "already_contacted",
  "already_booked",
  "not_interested",
  "moved_overseas",
  "deceased",
  "wrong_number",
  "duplicate_customer",
  "do_not_contact",
  "staff_decision",
  "other",
] as const;

export type AiRevenueResolutionReason = (typeof aiRevenueResolutionReasons)[number];

export const aiRevenueSuppressionScopes = [
  "customer",
  "service",
  "phone_only",
  "channel",
  "opportunity_type",
] as const;

export type AiRevenueSuppressionScope = (typeof aiRevenueSuppressionScopes)[number];

export type AiRevenuePriority = "high" | "medium" | "low";

export const aiRevenueContactChannels = [
  "phone",
  "viber_manual",
  "viber_auto",
  "in_person",
  "other",
] as const;

export type AiRevenueContactChannel = (typeof aiRevenueContactChannels)[number];

export const aiRevenueContactResults = [
  "no_answer",
  "call_later",
  "message_sent",
  "customer_replied",
  "interested",
  "appointment_booked",
  "already_booked",
  "already_visited",
  "not_interested",
  "wrong_number",
  "do_not_contact",
  "completed",
  "other",
] as const;

export type AiRevenueContactResult = (typeof aiRevenueContactResults)[number];

export const aiRevenueOutcomeTypes = [
  "appointment_booked",
  "customer_came",
  "treatment_completed",
  "package_session_used",
  "repurchase",
  "revenue_attributed",
] as const;

export type AiRevenueOutcomeType = (typeof aiRevenueOutcomeTypes)[number];

export const aiRevenueFollowUpChannels = [
  "phone_call",
  "manual_viber",
  "in_person",
  "other",
] as const;

export type AiRevenueFollowUpChannel = (typeof aiRevenueFollowUpChannels)[number];

export const aiRevenueFollowUpResults = [
  "no_answer",
  "call_later",
  "interested",
  "appointment_booked",
  "already_booked",
  "already_visited",
  "not_interested",
  "wrong_number",
  "do_not_contact",
  "completed",
  "other",
] as const;

export type AiRevenueFollowUpResult = (typeof aiRevenueFollowUpResults)[number];

export const aiRevenueFollowUpScheduleOptions = [
  "tomorrow",
  "three_days",
  "one_week",
  "next_month",
  "custom",
  "none",
] as const;

export type AiRevenueFollowUpScheduleOption = (typeof aiRevenueFollowUpScheduleOptions)[number];

export const aiRevenueFollowUpStatuses = [
  "open",
  "completed",
  "suppressed",
] as const;

export type AiRevenueFollowUpStatus = (typeof aiRevenueFollowUpStatuses)[number];

export interface AiRevenueActor {
  userId: string | null;
  email: string | null;
  name?: string | null;
}

export interface AiRevenueEvidenceItem {
  label: string;
  value: string | number;
  comparison?: string | null;
}

export interface AiRevenueCustomer {
  customerKey?: string | null;
  memberId?: string | null;
  customerName?: string | null;
  phoneNumber?: string | null;
  phoneMasked?: string | null;
}

export interface AiRevenueServiceInfo {
  serviceId?: string | null;
  serviceName?: string | null;
  lastVisitDate?: string | null;
  lastVisitSinceDays?: number | null;
  lastTreatmentTherapist?: string | null;
  preferredTherapist?: string | null;
  reminderDate?: string | null;
}

export interface AiRevenueServiceUsageSnapshot {
  serviceId?: string | null;
  serviceName: string;
  packageId?: string | null;
  packageName?: string | null;
  packageTotal?: number | null;
  used?: number | null;
  remaining?: number | null;
  latestUsageDate?: string | null;
  latestTherapist?: string | null;
  status?: "active" | "low_remaining" | "completed" | "unknown";
  isFocusService: boolean;
  note?: string | null;
}

export interface AiRevenuePackageInfo {
  packageId?: string | null;
  packageName?: string | null;
  remainingUnits?: number | null;
  purchasedUnits?: number | null;
  usedUnits?: number | null;
  lastUsedAt?: string | null;
}

export interface AiRevenueAppointmentInfo {
  bookingId?: string | null;
  appointmentDateTime?: string | null;
  bookingStatus?: string | null;
  requestMode?: "booking_request" | "direct_booking" | null;
  serviceId?: string | null;
  serviceName?: string | null;
  practitionerId?: string | null;
  practitionerName?: string | null;
  note?: string | null;
  attributionNote?: string | null;
  requestedAt?: string | null;
  reminderSentAt?: string | null;
  cameAt?: string | null;
  cancelledAt?: string | null;
  noShowAt?: string | null;
  completedAt?: string | null;
}

export interface AiRevenueMessageInfo {
  channel?: string | null;
  draftText?: string | null;
  approvedText?: string | null;
  approvedBy?: AiRevenueActor | null;
  approvedAt?: string | null;
  sentAt?: string | null;
  providerMessageId?: string | null;
  lastInboundText?: string | null;
  lastInboundIntent?: string | null;
  lastInboundAt?: string | null;
}

export interface AiRevenueRevenueInfo {
  actualRevenue?: number | null;
  influencedRevenue?: number | null;
  packageSessionsRecovered?: number | null;
  orderId?: string | null;
  invoiceNumber?: string | null;
  attributionType?: AiRevenueAttributionType | null;
  revenueAt?: string | null;
  revenueNote?: string | null;
}

export interface AiRevenueFollowUpOutcomeInfo {
  appointmentBookingId?: string | null;
  appointmentBookedAt?: string | null;
  appointmentDateTime?: string | null;
  customerCameAt?: string | null;
  treatmentCompletedAt?: string | null;
  packageSessionUsedAt?: string | null;
  packageSessionsRecovered?: number | null;
  repurchaseInvoiceNumber?: string | null;
  repurchaseRevenue?: number | null;
  revenueAttributedAt?: string | null;
  attributionType?: AiRevenueAttributionType | null;
}

export interface AiRevenueFollowUpInfo {
  status: AiRevenueFollowUpStatus;
  dueDate?: string | null;
  nextFollowUpDate?: string | null;
  lastAttemptId?: string | null;
  lastContactedAt?: string | null;
  lastChannel?: AiRevenueFollowUpChannel | null;
  lastResult?: AiRevenueFollowUpResult | null;
  lastNote?: string | null;
  lastHandledBy?: AiRevenueActor | null;
  attemptCount: number;
  completedAt?: string | null;
  completedBy?: AiRevenueActor | null;
  suppressedAt?: string | null;
  suppressionId?: string | null;
  outcome: AiRevenueFollowUpOutcomeInfo;
}

export interface AiRevenueActionResolution {
  reason: AiRevenueResolutionReason;
  note?: string | null;
  suppressCustomer?: boolean;
  suppressionId?: string | null;
  resolvedAt: string;
  resolvedBy: AiRevenueActor | null;
}

export interface AiRevenueAction {
  id: string;
  clinicId: string;
  clinicCode?: string | null;
  dateKey: string;
  opportunityKey?: string | null;
  originalDateKey?: string | null;
  dueDateKey?: string | null;
  nextFollowUpAt?: string | null;
  source: AiRevenueActionSource;
  sourceRefId?: string | null;
  actionType: AiRevenueActionType;
  workflowState?: AiRevenueWorkflowState;
  visibilityState?: AiRevenueVisibilityState;
  assignedToUserId?: string | null;
  assignedToName?: string | null;
  attemptCount?: number;
  lastContactAt?: string | null;
  lastContactChannel?: AiRevenueContactChannel | null;
  lastContactResult?: AiRevenueContactResult | null;
  lastFollowUpNote?: string | null;
  lastFollowUpAttemptId?: string | null;
  completedAt?: string | null;
  closedAt?: string | null;
  closedReason?: string | null;
  priority: AiRevenuePriority;
  priorityScore: number;
  title: string;
  summary: string;
  reason: string;
  displayReason?: string | null;
  evidence: AiRevenueEvidenceItem[];
  recommendedAction: string;
  aiSuggestion?: string | null;
  customer: AiRevenueCustomer;
  service: AiRevenueServiceInfo;
  serviceUsage?: AiRevenueServiceUsageSnapshot[];
  packageInfo: AiRevenuePackageInfo;
  appointment: AiRevenueAppointmentInfo;
  message: AiRevenueMessageInfo;
  revenue: AiRevenueRevenueInfo;
  followUp: AiRevenueFollowUpInfo;
  status: AiRevenueActionStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: AiRevenueActor | null;
  lastStatusAt: string | null;
  lastStatusBy: AiRevenueActor | null;
  resolution?: AiRevenueActionResolution | null;
}

export interface AiRevenueCustomerSuppression {
  id: string;
  clinicId: string;
  customerKey?: string | null;
  memberId?: string | null;
  phoneHash?: string | null;
  customerName?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  channel?: AiRevenueContactChannel | AiRevenueFollowUpChannel | string | null;
  permanent?: boolean;
  reason: AiRevenueResolutionReason;
  scope: AiRevenueSuppressionScope;
  sourceActionId?: string | null;
  sourceAttemptId?: string | null;
  active: boolean;
  suppressUntil?: string | null;
  note?: string | null;
  createdAt: string;
  createdBy: AiRevenueActor | null;
  liftedAt?: string | null;
  liftedBy?: AiRevenueActor | null;
}

export interface AiRevenueMessageEvent {
  id: string;
  actionId: string;
  clinicId: string;
  memberId?: string | null;
  channel: string;
  direction: "outbound" | "inbound";
  messageText: string;
  intent?: string | null;
  confidence?: number | null;
  providerMessageId?: string | null;
  createdAt: string;
  createdBy?: AiRevenueActor | null;
}

export interface AiRevenueContactAttempt {
  id: string;
  clinicId: string;
  actionId: string;
  opportunityKey?: string | null;
  customerKey?: string | null;
  memberId?: string | null;
  phoneHash?: string | null;
  customerName?: string | null;
  agentUserId?: string | null;
  agentName?: string | null;
  channel: AiRevenueContactChannel;
  result: AiRevenueContactResult;
  note?: string | null;
  messageText?: string | null;
  nextFollowUpAt?: string | null;
  nextFollowUpDateKey?: string | null;
  createdAt: string;
  createdBy: AiRevenueActor | null;
}

export interface AiRevenueCustomerTimelineEvent {
  id: string;
  clinicId: string;
  actionId: string;
  contactAttemptId: string;
  customerKey?: string | null;
  memberId?: string | null;
  phoneHash?: string | null;
  customerName?: string | null;
  eventType: "service_follow_up";
  serviceName?: string | null;
  result: AiRevenueContactResult;
  channel: AiRevenueContactChannel;
  note?: string | null;
  nextFollowUpAt?: string | null;
  createdAt: string;
  createdBy: AiRevenueActor | null;
  externalTimelineId?: string | null;
}

export interface AiRevenueOutcomeLink {
  id: string;
  clinicId: string;
  actionId: string;
  opportunityKey?: string | null;
  contactAttemptId?: string | null;
  customerKey?: string | null;
  memberId?: string | null;
  phoneHash?: string | null;
  outcomeType: AiRevenueOutcomeType;
  bookingId?: string | null;
  treatmentId?: string | null;
  orderId?: string | null;
  invoiceNumber?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  revenueAmount?: number | null;
  packageSessionsRecovered?: number | null;
  attributionType: AiRevenueAttributionType;
  attributionWindowDays?: number | null;
  confidence?: number | null;
  eventAt: string;
  createdAt: string;
}

export interface AiRevenueFollowUpAttempt {
  id: string;
  actionId: string;
  clinicId: string;
  memberId?: string | null;
  customerKey?: string | null;
  channel: AiRevenueFollowUpChannel;
  result: AiRevenueFollowUpResult;
  note?: string | null;
  contactedAt: string;
  scheduleOption: AiRevenueFollowUpScheduleOption;
  nextFollowUpDate?: string | null;
  suppressionScope?: AiRevenueSuppressionScope | null;
  suppressionId?: string | null;
  outcome: AiRevenueFollowUpOutcomeInfo;
  createdAt: string;
  createdBy: AiRevenueActor | null;
}

export interface AiRevenueAppointmentOutcome {
  id: string;
  actionId: string;
  clinicId: string;
  memberId?: string | null;
  bookingId?: string | null;
  appointmentDateTime?: string | null;
  bookingStatus?: string | null;
  checkedInAt?: string | null;
  checkoutAt?: string | null;
  cancelledAt?: string | null;
  noShowAt?: string | null;
  orderId?: string | null;
  revenueAmount?: number | null;
  packageSessionsRecovered?: number | null;
  updatedAt: string;
}

export type AiRevenueAuditActorType = "ai" | "staff" | "customer" | "system";

export interface AiRevenueAuditLog {
  id: string;
  actionId?: string | null;
  clinicId: string;
  actorType: AiRevenueAuditActorType;
  actorId?: string | null;
  action: string;
  description: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  createdAt: string;
}

export interface AiRevenueSettings {
  clinicId: string;
  clinicCode?: string | null;
  clinicName?: string | null;
  aiRevenueAgentEnabled: boolean;
  autoGenerateTodayOpportunities: boolean;
  timezone: string;
  dailyGenerateTime: string;
  runOrder: number;
  language: "my-MM" | "en-US";
  messagingMode: "manual" | "mock" | "provider";
  approvalRequired: boolean;
  attributionWindowDays: number;
  maxActionsPerRun: number;
  lastAutoGeneratedAt?: string | null;
  lastAutoGenerateStatus?: string | null;
  updatedAt: string | null;
  updatedBy: AiRevenueActor | null;
}

export interface AiRevenueSummary {
  totalActions: number;
  opportunitiesFound: number;
  activeOpportunities: number;
  resolvedActions: number;
  suppressedActions: number;
  highPriority: number;
  draftsReady: number;
  pendingApproval: number;
  approvedMessages: number;
  messagesSent: number;
  customersReplied: number;
  appointmentsRequested: number;
  appointmentsCreated: number;
  remindersSent: number;
  customersCame: number;
  completed: number;
  cancelled: number;
  noShow: number;
  followUpOpen: number;
  followUpCompleted: number;
  followUpSuppressed: number;
  followUpAttempts: number;
  followUpInterested: number;
  followUpBooked: number;
  followUpRepurchased: number;
  followUpsDueToday?: number;
  followUpsOverdue?: number;
  contactedToday?: number;
  completedToday?: number;
  scheduledFollowUps?: number;
  appointmentBookedFromFollowUp?: number;
  repurchasesAttributed?: number;
  aiGeneratedRevenue: number;
  aiInfluencedRevenue: number;
  packageSessionsRecovered: number;
  sourceBreakdown: {
    serviceReminder: number;
    unusedPackage: number;
    appointmentReminder: number;
    noShowRecovery: number;
    cancelledRecovery: number;
    inactiveVip: number;
    other: number;
  };
  currency: "MMK";
}
