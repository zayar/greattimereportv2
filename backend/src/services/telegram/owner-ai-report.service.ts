import { generateOwnerAiReport, type OwnerAiReportFacts } from "../ai/insights.service.js";
import type { AiLanguage } from "../ai/language.js";
import { sendTelegramMessage } from "./bot.service.js";
import { buildTodayPaymentReport } from "./payment-report.service.js";
import { buildTodayAppointmentReport } from "./report.service.js";
import { normalizeTimeZone } from "./time.js";
import {
  DEFAULT_OWNER_AI_FOCUS_AREAS,
  DEFAULT_OWNER_AI_LANGUAGE,
  DEFAULT_OWNER_AI_TONE,
  type OwnerAiReportFocusArea,
  type OwnerAiReportTone,
  type TodayOwnerAiReportSummary,
} from "./types.js";

function buildOwnerFacts(input: {
  clinicName: string;
  appointmentReport: Awaited<ReturnType<typeof buildTodayAppointmentReport>>;
  paymentReport: Awaited<ReturnType<typeof buildTodayPaymentReport>>;
}): OwnerAiReportFacts {
  return {
    clinic: {
      clinicName: input.clinicName,
    },
    date: {
      dateKey: input.appointmentReport.dateKey,
      timezone: input.appointmentReport.timezone,
    },
    appointments: {
      totalAppointments: input.appointmentReport.totalAppointments,
      upcomingCount: input.appointmentReport.upcomingCount,
      completedCount: input.appointmentReport.completedCount,
      cancelledCount: input.appointmentReport.cancelledCount,
      noShowCount: input.appointmentReport.noShowCount,
      topServices: input.appointmentReport.topServices,
      therapistLoad: input.appointmentReport.therapistLoad,
    },
    payments: {
      totalPaymentAmount: input.paymentReport.totalPaymentAmount,
      paidInvoiceCount: input.paymentReport.paidInvoiceCount,
      paymentCount: input.paymentReport.paymentCount,
      paymentMethods: input.paymentReport.paymentMethods,
      sellerTotals: input.paymentReport.sellerTotals,
    },
    dataQuality: {
      appointmentDateKey: input.appointmentReport.dateKey,
      paymentDateKey: input.paymentReport.dateKey,
      dateKeysMatch: input.appointmentReport.dateKey === input.paymentReport.dateKey,
      omittedPrivateFields: ["appointment customer names", "payment customer names", "customer phone numbers", "invoice numbers"],
    },
  };
}

function appendList(lines: string[], label: string, items: string[]) {
  if (items.length === 0) {
    return;
  }

  lines.push("", label);
  items.forEach((item) => {
    lines.push(`- ${item}`);
  });
}

export function formatTodayOwnerAiTelegramMessage(report: TodayOwnerAiReportSummary) {
  const lines = [
    report.aiReport.reportTitle,
    `Clinic: ${report.clinicName}`,
    `Date: ${report.dateKey}`,
    `Timezone: ${report.timezone}`,
    `Status: ${report.aiReport.overallStatus}`,
    "",
    report.aiReport.summaryText,
  ];

  appendList(lines, "Key findings", report.aiReport.keyFindings);
  appendList(lines, "Risks to watch", report.aiReport.risksToWatch);
  appendList(lines, "Recommended actions", report.aiReport.recommendedActions);

  if (report.aiReport.tomorrowFocus) {
    lines.push("", `Tomorrow focus: ${report.aiReport.tomorrowFocus}`);
  }

  if (report.aiReport.dataQualityNote) {
    lines.push("", `Data quality: ${report.aiReport.dataQualityNote}`);
  }

  return lines.join("\n");
}

export async function buildTodayOwnerAiReport(input: {
  clinicId: string;
  clinicCode: string;
  clinicName?: string;
  timezone?: string;
  aiLanguage?: AiLanguage;
  tone?: OwnerAiReportTone;
  focusAreas?: OwnerAiReportFocusArea[];
  customInstruction?: string | null;
  authorizationHeader?: string;
  referenceDate?: Date;
}) {
  const timezone = normalizeTimeZone(input.timezone);
  const [appointmentReport, paymentReport] = await Promise.all([
    buildTodayAppointmentReport({
      clinicCode: input.clinicCode,
      clinicName: input.clinicName,
      timezone,
      authorizationHeader: input.authorizationHeader,
      referenceDate: input.referenceDate,
    }),
    buildTodayPaymentReport({
      clinicId: input.clinicId,
      clinicName: input.clinicName,
      timezone,
      authorizationHeader: input.authorizationHeader,
      referenceDate: input.referenceDate,
    }),
  ]);

  const clinicName = input.clinicName || appointmentReport.clinicName || paymentReport.clinicName;
  const facts = buildOwnerFacts({
    clinicName,
    appointmentReport,
    paymentReport,
  });
  const aiReport = await generateOwnerAiReport({
    clinicId: input.clinicId,
    aiLanguage: input.aiLanguage ?? DEFAULT_OWNER_AI_LANGUAGE,
    tone: input.tone ?? DEFAULT_OWNER_AI_TONE,
    focusAreas: input.focusAreas?.length ? input.focusAreas : DEFAULT_OWNER_AI_FOCUS_AREAS,
    customInstruction: input.customInstruction ?? null,
    facts,
  });
  const { appointments: _appointments, ...appointmentFacts } = appointmentReport;
  const { payments: _payments, ...paymentFacts } = paymentReport;

  return {
    clinicName,
    dateKey: appointmentReport.dateKey,
    timezone,
    appointmentReport: appointmentFacts,
    paymentReport: paymentFacts,
    aiReport,
  } satisfies TodayOwnerAiReportSummary;
}

export async function sendTodayOwnerAiReport(input: {
  chatId: string;
  clinicId: string;
  clinicCode: string;
  clinicName?: string;
  timezone?: string;
  aiLanguage?: AiLanguage;
  tone?: OwnerAiReportTone;
  focusAreas?: OwnerAiReportFocusArea[];
  customInstruction?: string | null;
  authorizationHeader?: string;
  referenceDate?: Date;
}) {
  const report = await buildTodayOwnerAiReport(input);
  const message = formatTodayOwnerAiTelegramMessage(report);
  await sendTelegramMessage(input.chatId, message);

  return {
    sentAt: new Date().toISOString(),
    report,
    message,
  };
}
