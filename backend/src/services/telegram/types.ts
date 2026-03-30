export type TelegramChatType = "private" | "group" | "supergroup" | "channel";

export type TelegramConnectionStatus = "not_linked" | "pending" | "linked";
export type TelegramReportType = "appointment" | "payment";
export type TelegramDeliveryTrigger = "manual_test" | "scheduled" | "resend";
export type TelegramDeliveryOutcome = "sent" | "failed";

export interface TelegramReportSettingsRecord {
  telegramChatId: string | null;
  telegramChatType: TelegramChatType | null;
  telegramChatTitle: string | null;
  telegramLinkedAt: string | null;
  isTodayAppointmentReportEnabled: boolean;
  reportTime: string;
  isTodayPaymentReportEnabled: boolean;
  paymentReportTime: string;
  timezone: string;
  lastTestSentAt: string | null;
  lastScheduledSentAt: string | null;
  lastScheduledDateKey: string | null;
  lastPaymentTestSentAt: string | null;
  lastPaymentScheduledSentAt: string | null;
  lastPaymentScheduledDateKey: string | null;
  lastAppointmentFailureAt: string | null;
  lastAppointmentFailureReason: string | null;
  lastPaymentFailureAt: string | null;
  lastPaymentFailureReason: string | null;
}

export interface TelegramTargetRecord extends TelegramReportSettingsRecord {
  clinicId: string;
  clinicCode: string;
  clinicName: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TelegramIntegrationRecord extends TelegramReportSettingsRecord {
  clinicId: string;
  clinicCode: string;
  clinicName: string;
  pendingLinkCode: string | null;
  pendingLinkCodeExpiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TelegramTargetStatus extends TelegramTargetRecord {
  targetLabel: string;
  deliveryHistory: TelegramDeliveryLogEntry[];
}

export interface TelegramIntegrationStatus extends TelegramIntegrationRecord {
  connectionStatus: TelegramConnectionStatus;
  linkedTargetLabel: string | null;
  linkedTargetCount: number;
  linkedTargets: TelegramTargetStatus[];
  botUsername: string | null;
  botUrl: string | null;
  botDeepLink: string | null;
}

export interface TelegramLinkCodeRecord {
  code: string;
  clinicId: string;
  clinicCode: string;
  clinicName: string;
  createdAt: string;
  expiresAt: string;
  createdByUserId: string | null;
  createdByEmail: string | null;
  redeemedAt: string | null;
  telegramChatId: string | null;
  telegramChatType: TelegramChatType | null;
  telegramChatTitle: string | null;
}

export interface TelegramChatTarget {
  id: string;
  type: TelegramChatType;
  title: string | null;
}

export interface TelegramDeliveryLogRecord {
  clinicId: string;
  clinicCode: string;
  clinicName: string;
  telegramChatId: string;
  reportType: TelegramReportType;
  trigger: TelegramDeliveryTrigger;
  outcome: TelegramDeliveryOutcome;
  attemptedAt: string;
  dateKey: string | null;
  timezone: string;
  appointmentCount: number | null;
  paymentCount: number | null;
  totalPaymentAmount: number | null;
  errorMessage: string | null;
}

export interface TelegramDeliveryLogEntry extends TelegramDeliveryLogRecord {
  id: string;
}

export interface TodayAppointmentReportItem {
  time: string;
  customerName: string;
  serviceName: string;
  therapistName: string;
  status: string;
}

export interface TodayAppointmentReportSummary {
  clinicName: string;
  dateKey: string;
  timezone: string;
  totalAppointments: number;
  upcomingCount: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  appointments: TodayAppointmentReportItem[];
  topServices: Array<{ serviceName: string; count: number }>;
  therapistLoad: Array<{ therapistName: string; count: number }>;
}

export interface TodayPaymentReportItem {
  time: string;
  customerName: string;
  invoiceNumber: string;
  paymentMethod: string;
  amount: number;
  sellerName: string;
}

export interface TodayPaymentReportSummary {
  clinicName: string;
  dateKey: string;
  timezone: string;
  totalPaymentAmount: number;
  paidInvoiceCount: number;
  paymentCount: number;
  payments: TodayPaymentReportItem[];
  paymentMethods: Array<{ paymentMethod: string; count: number; amount: number }>;
  sellerTotals: Array<{ sellerName: string; count: number; amount: number }>;
}
