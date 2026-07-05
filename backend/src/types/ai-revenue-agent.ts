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
] as const;

export type AiRevenueSuppressionScope = (typeof aiRevenueSuppressionScopes)[number];

export type AiRevenuePriority = "high" | "medium" | "low";

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
  reminderDate?: string | null;
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
  source: AiRevenueActionSource;
  sourceRefId?: string | null;
  actionType: AiRevenueActionType;
  priority: AiRevenuePriority;
  priorityScore: number;
  title: string;
  summary: string;
  reason: string;
  evidence: AiRevenueEvidenceItem[];
  recommendedAction: string;
  customer: AiRevenueCustomer;
  service: AiRevenueServiceInfo;
  packageInfo: AiRevenuePackageInfo;
  appointment: AiRevenueAppointmentInfo;
  message: AiRevenueMessageInfo;
  revenue: AiRevenueRevenueInfo;
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
  reason: AiRevenueResolutionReason;
  scope: AiRevenueSuppressionScope;
  sourceActionId?: string | null;
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
  language: "my-MM" | "en-US";
  messagingMode: "manual" | "mock" | "provider";
  approvalRequired: boolean;
  attributionWindowDays: number;
  maxActionsPerRun: number;
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
