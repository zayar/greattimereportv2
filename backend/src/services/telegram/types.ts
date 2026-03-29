export type TelegramChatType = "private" | "group" | "supergroup" | "channel";

export type TelegramConnectionStatus = "not_linked" | "pending" | "linked";

export interface TelegramIntegrationRecord {
  clinicId: string;
  clinicCode: string;
  clinicName: string;
  telegramChatId: string | null;
  telegramChatType: TelegramChatType | null;
  telegramChatTitle: string | null;
  telegramLinkedAt: string | null;
  isTodayAppointmentReportEnabled: boolean;
  reportTime: string;
  timezone: string;
  lastTestSentAt: string | null;
  lastScheduledSentAt: string | null;
  lastScheduledDateKey: string | null;
  pendingLinkCode: string | null;
  pendingLinkCodeExpiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TelegramIntegrationStatus extends TelegramIntegrationRecord {
  connectionStatus: TelegramConnectionStatus;
  linkedTargetLabel: string | null;
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
