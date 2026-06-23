import { useCallback, useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import QRCode from "qrcode";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import {
  fetchTelegramIntegrationStatus,
  generateTelegramLinkCode,
  resendTelegramReport,
  saveTelegramSettings,
  sendTelegramTestReport,
  unlinkTelegramIntegration,
} from "../../../api/telegram";
import { sendSalesAssistantTasks } from "../../../api/gtGrowthAi";
import { fetchGtGrowthAiFeatureAccess } from "../../../api/features";
import type {
  AiLanguage,
  ClinicFeatureAccessStatus,
  GtGrowthAiTelegramTargetPurpose,
  TelegramDeliveryLogEntry,
  TelegramIntegrationStatus,
  TelegramOwnerAiFocusArea,
  TelegramOwnerAiTone,
  TelegramReportType,
  TelegramTargetStatus,
  TelegramWeeklySummaryDayOfWeek,
  TelegramWeeklySummarySection,
} from "../../../types/domain";
import { useAccess } from "../../access/AccessProvider";

type BusyAction = "load" | "link" | "save" | "unlink" | "test" | "resend" | "sales_test" | null;

type TargetDraft = {
  targetPurpose: GtGrowthAiTelegramTargetPurpose;
  salesAssistantEnabled: boolean;
  salesAssistantTime: string;
  ownerProgressEnabled: boolean;
  ownerProgressTime: string;
  appointmentEnabled: boolean;
  appointmentTime: string;
  paymentEnabled: boolean;
  paymentTime: string;
  ownerAiEnabled: boolean;
  ownerAiTime: string;
  ownerAiLanguage: AiLanguage;
  ownerAiTone: TelegramOwnerAiTone;
  ownerAiFocusAreas: TelegramOwnerAiFocusArea[];
  ownerAiCustomInstruction: string;
  weeklySummaryEnabled: boolean;
  weeklySummaryTime: string;
  weeklySummaryDayOfWeek: TelegramWeeklySummaryDayOfWeek;
  weeklySummarySections: TelegramWeeklySummarySection[];
  timezone: string;
};

const DEFAULT_OWNER_AI_FOCUS_AREAS: TelegramOwnerAiFocusArea[] = ["appointments", "payments", "risks", "actions"];
const DEFAULT_WEEKLY_SUMMARY_SECTIONS: TelegramWeeklySummarySection[] = [
  "appointment_summary",
  "service_summary",
  "therapist_summary",
  "payment_summary",
  "top_services",
  "busy_hours",
];

const OWNER_AI_LANGUAGE_OPTIONS: Array<{ value: AiLanguage; label: string }> = [
  { value: "my-MM", label: "Myanmar" },
  { value: "en-US", label: "English" },
];

const OWNER_AI_TONE_OPTIONS: Array<{ value: TelegramOwnerAiTone; label: string }> = [
  { value: "simple", label: "Simple" },
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
];

const OWNER_AI_FOCUS_OPTIONS: Array<{ value: TelegramOwnerAiFocusArea; label: string }> = [
  { value: "appointments", label: "Appointments" },
  { value: "payments", label: "Payments" },
  { value: "risks", label: "Risks" },
  { value: "actions", label: "Actions" },
  { value: "tomorrow", label: "Tomorrow" },
];

const WEEKLY_SUMMARY_DAY_OPTIONS: Array<{ value: TelegramWeeklySummaryDayOfWeek; label: string }> = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

const WEEKLY_SUMMARY_SECTION_OPTIONS: Array<{ value: TelegramWeeklySummarySection; label: string }> = [
  { value: "appointment_summary", label: "Appointment Summary" },
  { value: "service_summary", label: "Service Summary" },
  { value: "therapist_summary", label: "Therapist Summary" },
  { value: "payment_summary", label: "Payment Summary" },
  { value: "top_services", label: "Top Services" },
  { value: "busy_hours", label: "Busy Hours" },
];

const TELEGRAM_TARGET_PURPOSE_OPTIONS: Array<{ value: GtGrowthAiTelegramTargetPurpose; label: string }> = [
  { value: "general_reports", label: "General reports" },
  { value: "owner_group", label: "Owner group" },
  { value: "sales_lead", label: "Sales lead" },
  { value: "reception", label: "Reception" },
  { value: "finance", label: "Finance" },
  { value: "manager", label: "Manager" },
  { value: "other", label: "Other" },
];

const REPORT_ROUTING_COLUMNS = [
  { key: "appointment", label: "Appointment" },
  { key: "payment", label: "Payment" },
  { key: "weekly", label: "Weekly" },
  { key: "owner_ai", label: "AI Owner" },
  { key: "sales_assistant", label: "AI tasks" },
  { key: "owner_progress", label: "Owner Progress" },
] as const;

const COMMON_TIMEZONES = [
  "Asia/Yangon",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Tokyo",
  "Asia/Dubai",
  "Europe/London",
  "UTC",
];

function getTimezoneOptions() {
  const currentZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set([currentZone, ...COMMON_TIMEZONES].filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function formatStatusLabel(status: TelegramIntegrationStatus | null) {
  if (!status) {
    return "Loading";
  }

  switch (status.connectionStatus) {
    case "linked":
      return status.linkedTargetCount > 1 ? `${status.linkedTargetCount} targets connected` : "Connected";
    case "pending":
      return "Waiting for link";
    default:
      return "Not connected";
  }
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return parsed.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function hasActivePendingCode(status: TelegramIntegrationStatus | null) {
  if (!status?.pendingLinkCode || !status.pendingLinkCodeExpiresAt) {
    return false;
  }

  return new Date(status.pendingLinkCodeExpiresAt).getTime() > Date.now();
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    const apiMessage = typeof error.response?.data?.error === "string" ? error.response.data.error : null;
    return apiMessage || error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function normalizeOwnerAiFocusAreas(value: TelegramOwnerAiFocusArea[] | undefined) {
  return value?.length ? value : DEFAULT_OWNER_AI_FOCUS_AREAS;
}

function normalizeWeeklySummarySections(value: TelegramWeeklySummarySection[] | undefined) {
  return value?.length ? value : DEFAULT_WEEKLY_SUMMARY_SECTIONS;
}

function sameFocusAreas(left: TelegramOwnerAiFocusArea[], right: TelegramOwnerAiFocusArea[]) {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.length === rightSorted.length && leftSorted.every((value, index) => value === rightSorted[index]);
}

function sameWeeklySummarySections(
  left: TelegramWeeklySummarySection[],
  right: TelegramWeeklySummarySection[],
) {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.length === rightSorted.length && leftSorted.every((value, index) => value === rightSorted[index]);
}

function buildTargetDraft(target: TelegramTargetStatus): TargetDraft {
  return {
    targetPurpose: target.targetPurpose,
    salesAssistantEnabled: target.isGtGrowthAiSalesAssistantEnabled,
    salesAssistantTime: target.gtGrowthAiSalesAssistantTime,
    ownerProgressEnabled: target.isGtGrowthAiOwnerProgressSummaryEnabled,
    ownerProgressTime: target.gtGrowthAiOwnerProgressSummaryTime,
    appointmentEnabled: target.isTodayAppointmentReportEnabled,
    appointmentTime: target.reportTime,
    paymentEnabled: target.isTodayPaymentReportEnabled,
    paymentTime: target.paymentReportTime,
    ownerAiEnabled: target.isOwnerAiReportEnabled,
    ownerAiTime: target.ownerAiReportTime,
    ownerAiLanguage: target.ownerAiLanguage,
    ownerAiTone: target.ownerAiTone,
    ownerAiFocusAreas: normalizeOwnerAiFocusAreas(target.ownerAiFocusAreas),
    ownerAiCustomInstruction: target.ownerAiCustomInstruction ?? "",
    weeklySummaryEnabled: target.isWeeklySummaryReportEnabled,
    weeklySummaryTime: target.weeklySummaryReportTime,
    weeklySummaryDayOfWeek: target.weeklySummaryDayOfWeek,
    weeklySummarySections: normalizeWeeklySummarySections(target.weeklySummarySections),
    timezone: target.timezone,
  };
}

function getReportHistory(target: TelegramTargetStatus | null, reportType: TelegramReportType) {
  return (target?.deliveryHistory ?? []).filter((entry) => entry.reportType === reportType);
}

function formatTriggerLabel(trigger: TelegramDeliveryLogEntry["trigger"]) {
  switch (trigger) {
    case "scheduled":
      return "Scheduled";
    case "resend":
      return "Resend";
    default:
      return "Manual test";
  }
}

function formatOutcomeLabel(outcome: TelegramDeliveryLogEntry["outcome"]) {
  return outcome === "sent" ? "Sent" : "Failed";
}

function formatDeliverySummary(entry: TelegramDeliveryLogEntry) {
  if (entry.outcome === "failed") {
    return entry.errorMessage || "Delivery failed.";
  }

  if (entry.reportType === "payment") {
    const amount = Math.round(entry.totalPaymentAmount ?? 0).toLocaleString("en-US");
    return `${entry.paymentCount ?? 0} payment records · ${amount} MMK`;
  }

  if (entry.reportType === "owner_ai") {
    const amount = Math.round(entry.totalPaymentAmount ?? 0).toLocaleString("en-US");
    return `${entry.appointmentCount ?? 0} appointments · ${entry.paymentCount ?? 0} payment records · ${amount} MMK`;
  }

  if (entry.reportType === "weekly_summary") {
    const amount = Math.round(entry.totalPaymentAmount ?? 0).toLocaleString("en-US");
    return `${entry.appointmentCount ?? 0} appointments · ${entry.paymentCount ?? 0} payment records · ${amount} MMK`;
  }

  return `${entry.appointmentCount ?? 0} appointments`;
}

function formatReportTitle(reportType: TelegramReportType) {
  switch (reportType) {
    case "payment":
      return "Today Payment Report";
    case "owner_ai":
      return "AI Owner Report";
    case "weekly_summary":
      return "Weekly Summary Report";
    default:
      return "Today Appointment Report";
  }
}

function formatTargetPurposeLabel(value: GtGrowthAiTelegramTargetPurpose) {
  return TELEGRAM_TARGET_PURPOSE_OPTIONS.find((option) => option.value === value)?.label ?? "Other";
}

function getRoutingCell(target: TelegramTargetStatus, key: (typeof REPORT_ROUTING_COLUMNS)[number]["key"]) {
  switch (key) {
    case "appointment":
      return { enabled: target.isTodayAppointmentReportEnabled, time: target.reportTime };
    case "payment":
      return { enabled: target.isTodayPaymentReportEnabled, time: target.paymentReportTime };
    case "weekly":
      return {
        enabled: target.isWeeklySummaryReportEnabled,
        time: `${target.weeklySummaryDayOfWeek.slice(0, 3)} ${target.weeklySummaryReportTime}`,
      };
    case "owner_ai":
      return { enabled: target.isOwnerAiReportEnabled, time: target.ownerAiReportTime };
    case "sales_assistant":
      return { enabled: target.isGtGrowthAiSalesAssistantEnabled, time: target.gtGrowthAiSalesAssistantTime };
    case "owner_progress":
      return {
        enabled: target.isGtGrowthAiOwnerProgressSummaryEnabled,
        time: target.gtGrowthAiOwnerProgressSummaryTime,
      };
    default:
      return { enabled: false, time: "" };
  }
}

function formatFeatureAccessSource(source: ClinicFeatureAccessStatus["source"] | undefined) {
  switch (source) {
    case "environment":
      return "Enabled by Cloud Run env";
    case "clinic_setting":
      return "Clinic setting";
    case "default_locked":
      return "Locked by default";
    default:
      return "Loading";
  }
}

function buildUnavailableGtGrowthAiAccess(clinicId: string): ClinicFeatureAccessStatus {
  return {
    clinicId,
    feature: "gt_growth_ai",
    enabled: false,
    source: "default_locked",
    title: "Unlock GT Growth AI",
    message: "AI insights and recommended actions are available with GT Growth AI.",
    upgradeMessage: "Upgrade to see AI recommendations.",
    lockedReason: "GT Growth AI access could not be checked.",
    updatedAt: null,
    updatedByUserId: null,
    updatedByEmail: null,
  };
}

export function TelegramSettingsPage() {
  const { currentClinic } = useAccess();
  const clinic = currentClinic;
  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);
  const [status, setStatus] = useState<TelegramIntegrationStatus | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>("load");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [draftsByChatId, setDraftsByChatId] = useState<Record<string, TargetDraft>>({});
  const [gtGrowthAiAccess, setGtGrowthAiAccess] = useState<ClinicFeatureAccessStatus | null>(null);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  const loadStatus = useCallback(
    async (showLoader = true) => {
      if (!clinic) {
        setStatus(null);
        setBusyAction(null);
        return;
      }

      if (showLoader) {
        setBusyAction("load");
      }

      try {
        setErrorMessage(null);
        const [nextStatus, nextFeatureAccess] = await Promise.all([
          fetchTelegramIntegrationStatus({
            clinicId: clinic.id,
            clinicCode: clinic.code,
            clinicName: clinic.name,
          }),
          fetchGtGrowthAiFeatureAccess({
            clinicId: clinic.id,
          }).catch(() => ({
            gtGrowthAi: buildUnavailableGtGrowthAiAccess(clinic.id),
          })),
        ]);
        setStatus(nextStatus);
        setGtGrowthAiAccess(nextFeatureAccess.gtGrowthAi);
      } catch (error) {
        setErrorMessage(getApiErrorMessage(error, "Telegram settings could not be loaded."));
      } finally {
        setBusyAction((current) => (current === "load" ? null : current));
      }
    },
    [clinic],
  );

  useEffect(() => {
    void loadStatus(true);
  }, [loadStatus]);

  useEffect(() => {
    if (!status) {
      setDraftsByChatId({});
      setSelectedChatId(null);
      return;
    }

    setDraftsByChatId((current) => {
      const next: Record<string, TargetDraft> = {};
      status.linkedTargets.forEach((target) => {
        if (target.telegramChatId) {
          next[target.telegramChatId] = current[target.telegramChatId] ?? buildTargetDraft(target);
        }
      });
      return next;
    });

    setSelectedChatId((current) => {
      if (current && status.linkedTargets.some((target) => target.telegramChatId === current)) {
        return current;
      }
      return status.linkedTargets[0]?.telegramChatId ?? null;
    });
  }, [status]);

  useEffect(() => {
    if (!hasActivePendingCode(status)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadStatus(false);
    }, 8_000);

    return () => window.clearInterval(intervalId);
  }, [loadStatus, status]);

  const selectedTarget =
    status?.linkedTargets.find((target) => target.telegramChatId === selectedChatId) ?? status?.linkedTargets[0] ?? null;
  const selectedDraft =
    selectedTarget?.telegramChatId ? draftsByChatId[selectedTarget.telegramChatId] ?? buildTargetDraft(selectedTarget) : null;
  const appointmentHistory = getReportHistory(selectedTarget, "appointment");
  const paymentHistory = getReportHistory(selectedTarget, "payment");
  const ownerAiHistory = getReportHistory(selectedTarget, "owner_ai");
  const weeklySummaryHistory = getReportHistory(selectedTarget, "weekly_summary");
  const latestAppointmentDelivery = appointmentHistory[0] ?? null;
  const latestPaymentDelivery = paymentHistory[0] ?? null;
  const latestOwnerAiDelivery = ownerAiHistory[0] ?? null;
  const latestWeeklySummaryDelivery = weeklySummaryHistory[0] ?? null;
  const hasChanges = Boolean(
    selectedTarget &&
      selectedDraft &&
      (selectedDraft.targetPurpose !== selectedTarget.targetPurpose ||
        selectedDraft.salesAssistantEnabled !== selectedTarget.isGtGrowthAiSalesAssistantEnabled ||
        selectedDraft.salesAssistantTime !== selectedTarget.gtGrowthAiSalesAssistantTime ||
        selectedDraft.ownerProgressEnabled !== selectedTarget.isGtGrowthAiOwnerProgressSummaryEnabled ||
        selectedDraft.ownerProgressTime !== selectedTarget.gtGrowthAiOwnerProgressSummaryTime ||
        selectedDraft.appointmentEnabled !== selectedTarget.isTodayAppointmentReportEnabled ||
        selectedDraft.appointmentTime !== selectedTarget.reportTime ||
        selectedDraft.paymentEnabled !== selectedTarget.isTodayPaymentReportEnabled ||
        selectedDraft.paymentTime !== selectedTarget.paymentReportTime ||
        selectedDraft.ownerAiEnabled !== selectedTarget.isOwnerAiReportEnabled ||
        selectedDraft.ownerAiTime !== selectedTarget.ownerAiReportTime ||
        selectedDraft.ownerAiLanguage !== selectedTarget.ownerAiLanguage ||
        selectedDraft.ownerAiTone !== selectedTarget.ownerAiTone ||
        !sameFocusAreas(selectedDraft.ownerAiFocusAreas, normalizeOwnerAiFocusAreas(selectedTarget.ownerAiFocusAreas)) ||
        selectedDraft.ownerAiCustomInstruction.trim() !== (selectedTarget.ownerAiCustomInstruction ?? "") ||
        selectedDraft.weeklySummaryEnabled !== selectedTarget.isWeeklySummaryReportEnabled ||
        selectedDraft.weeklySummaryTime !== selectedTarget.weeklySummaryReportTime ||
        selectedDraft.weeklySummaryDayOfWeek !== selectedTarget.weeklySummaryDayOfWeek ||
        !sameWeeklySummarySections(
          selectedDraft.weeklySummarySections,
          normalizeWeeklySummarySections(selectedTarget.weeklySummarySections),
        ) ||
        selectedDraft.timezone !== selectedTarget.timezone),
  );
  const isLinked = (status?.linkedTargetCount ?? 0) > 0;
  const pendingCodeActive = hasActivePendingCode(status);
  const saveButtonLabel = busyAction === "save" ? "Saving..." : "Save target settings";
  const appointmentResendLabel =
    latestAppointmentDelivery?.outcome === "failed" ? "Retry appointment send" : "Resend appointment report";
  const paymentResendLabel =
    latestPaymentDelivery?.outcome === "failed" ? "Retry payment send" : "Resend payment report";
  const ownerAiResendLabel =
    latestOwnerAiDelivery?.outcome === "failed" ? "Retry AI Owner send" : "Resend AI Owner Report";
  const weeklySummaryResendLabel =
    latestWeeklySummaryDelivery?.outcome === "failed" ? "Retry weekly summary send" : "Resend Weekly Report";
  const botTargetUrl = useMemo(() => {
    if (status?.botDeepLink) {
      return status.botDeepLink;
    }

    if (status?.botUrl) {
      return status.botUrl;
    }

    if (status?.botUsername) {
      return `https://t.me/${status.botUsername}`;
    }

    return null;
  }, [status?.botDeepLink, status?.botUrl, status?.botUsername]);
  const qrBotUrl = useMemo(() => {
    if (status?.botDeepLink) {
      return status.botDeepLink;
    }

    if (status?.botUrl) {
      return status.botUrl;
    }

    if (status?.botUsername) {
      return `https://t.me/${status.botUsername}`;
    }

    return null;
  }, [status?.botDeepLink, status?.botUrl, status?.botUsername]);
  const botGroupTargetUrl = status?.botGroupDeepLink ?? null;
  const botDisplayUsername = status?.botUsername ? `@${status.botUsername.toUpperCase()}` : "Telegram bot";

  useEffect(() => {
    if (!isQrOpen || !qrBotUrl) {
      setQrCodeDataUrl(null);
      setQrError(null);
      return;
    }

    let active = true;
    setQrCodeDataUrl(null);
    setQrError(null);

    void QRCode.toDataURL(qrBotUrl, {
      width: 320,
      margin: 2,
      color: {
        dark: "#5f8d4e",
        light: "#ffffffff",
      },
    })
      .then((dataUrl: string) => {
        if (active) {
          setQrCodeDataUrl(dataUrl);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setQrError(error instanceof Error ? error.message : "QR code could not be generated.");
        }
      });

    return () => {
      active = false;
    };
  }, [qrBotUrl, isQrOpen]);

  useEffect(() => {
    if (!isQrOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsQrOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isQrOpen]);

  if (!clinic) {
    return (
      <div className="page-stack page-stack--workspace analytics-report telegram-settings">
        <EmptyState label="No clinic selected" detail="Choose a clinic first so Telegram can be linked to the right owner target." />
      </div>
    );
  }

  const activeClinic = clinic;

  function updateSelectedDraft(patch: Partial<TargetDraft>) {
    if (!selectedTarget?.telegramChatId || !selectedDraft) {
      return;
    }

    setDraftsByChatId((current) => ({
      ...current,
      [selectedTarget.telegramChatId!]: {
        ...selectedDraft,
        ...patch,
      },
    }));
  }

  function toggleOwnerAiFocusArea(focusArea: TelegramOwnerAiFocusArea, checked: boolean) {
    if (!selectedDraft) {
      return;
    }

    const nextFocusAreas = checked
      ? [...new Set([...selectedDraft.ownerAiFocusAreas, focusArea])]
      : selectedDraft.ownerAiFocusAreas.filter((item) => item !== focusArea);

    updateSelectedDraft({
      ownerAiFocusAreas: nextFocusAreas.length > 0 ? nextFocusAreas : selectedDraft.ownerAiFocusAreas,
    });
  }

  function toggleWeeklySummarySection(section: TelegramWeeklySummarySection, checked: boolean) {
    if (!selectedDraft) {
      return;
    }

    const nextSections = checked
      ? [...new Set([...selectedDraft.weeklySummarySections, section])]
      : selectedDraft.weeklySummarySections.filter((item) => item !== section);

    updateSelectedDraft({
      weeklySummarySections: nextSections.length > 0 ? nextSections : selectedDraft.weeklySummarySections,
    });
  }

  async function handleGenerateLinkCode() {
    setBusyAction("link");
    setNotice(null);
    setErrorMessage(null);

    try {
      const nextStatus = await generateTelegramLinkCode({
        clinicId: activeClinic.id,
        clinicCode: activeClinic.code,
        clinicName: activeClinic.name,
      });
      setStatus(nextStatus);
      setNotice("New Telegram link code generated for this clinic. Connect it to another owner chat or group if needed.");
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Link code could not be generated."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveSettings() {
    if (!selectedTarget?.telegramChatId || !selectedDraft) {
      return;
    }

    setBusyAction("save");
    setNotice(null);
    setErrorMessage(null);

    try {
      const nextStatus = await saveTelegramSettings({
        clinicId: activeClinic.id,
        clinicCode: activeClinic.code,
        clinicName: activeClinic.name,
        chatId: selectedTarget.telegramChatId,
        targetPurpose: selectedDraft.targetPurpose,
        isGtGrowthAiSalesAssistantEnabled: selectedDraft.salesAssistantEnabled,
        gtGrowthAiSalesAssistantTime: selectedDraft.salesAssistantTime,
        isGtGrowthAiOwnerProgressSummaryEnabled: selectedDraft.ownerProgressEnabled,
        gtGrowthAiOwnerProgressSummaryTime: selectedDraft.ownerProgressTime,
        isTodayAppointmentReportEnabled: selectedDraft.appointmentEnabled,
        reportTime: selectedDraft.appointmentTime,
        isTodayPaymentReportEnabled: selectedDraft.paymentEnabled,
        paymentReportTime: selectedDraft.paymentTime,
        isOwnerAiReportEnabled: selectedDraft.ownerAiEnabled,
        ownerAiReportTime: selectedDraft.ownerAiTime,
        ownerAiLanguage: selectedDraft.ownerAiLanguage,
        ownerAiTone: selectedDraft.ownerAiTone,
        ownerAiFocusAreas: selectedDraft.ownerAiFocusAreas,
        ownerAiCustomInstruction: selectedDraft.ownerAiCustomInstruction.trim() || null,
        isWeeklySummaryReportEnabled: selectedDraft.weeklySummaryEnabled,
        weeklySummaryReportTime: selectedDraft.weeklySummaryTime,
        weeklySummaryDayOfWeek: selectedDraft.weeklySummaryDayOfWeek,
        weeklySummarySections: selectedDraft.weeklySummarySections,
        timezone: selectedDraft.timezone,
      });
      setStatus(nextStatus);
      setNotice(`Saved Telegram settings for ${selectedTarget.targetLabel}.`);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Telegram settings could not be saved."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUnlink() {
    if (!selectedTarget?.telegramChatId) {
      return;
    }

    if (!window.confirm(`Disconnect ${selectedTarget.targetLabel} from this clinic?`)) {
      return;
    }

    setBusyAction("unlink");
    setNotice(null);
    setErrorMessage(null);

    try {
      const nextStatus = await unlinkTelegramIntegration({
        clinicId: activeClinic.id,
        chatId: selectedTarget.telegramChatId,
      });
      setStatus(nextStatus);
      setNotice(`${selectedTarget.targetLabel} was disconnected from this clinic.`);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Telegram target could not be unlinked."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSendTest(reportType: TelegramReportType) {
    if (!selectedTarget?.telegramChatId || !selectedDraft) {
      return;
    }

    setBusyAction("test");
    setNotice(null);
    setErrorMessage(null);

    try {
      const result = await sendTelegramTestReport({
        clinicId: activeClinic.id,
        clinicCode: activeClinic.code,
        clinicName: activeClinic.name,
        chatId: selectedTarget.telegramChatId,
        timezone: selectedDraft.timezone,
        reportType,
        ownerAiLanguage: selectedDraft.ownerAiLanguage,
        ownerAiTone: selectedDraft.ownerAiTone,
        ownerAiFocusAreas: selectedDraft.ownerAiFocusAreas,
        ownerAiCustomInstruction: selectedDraft.ownerAiCustomInstruction.trim() || null,
        weeklySummarySections: selectedDraft.weeklySummarySections,
      });

      if (reportType === "owner_ai") {
        setNotice(
          `AI Owner test sent to ${selectedTarget.targetLabel} (${result.ownerAiOverallStatus ?? "sent"}, ${result.appointmentCount ?? 0} appointments, ${result.paymentCount ?? 0} payment records).`,
        );
      } else if (reportType === "weekly_summary") {
        setNotice(
          `Weekly Summary test sent to ${selectedTarget.targetLabel} (${result.appointmentCount ?? 0} appointments, ${result.paymentCount ?? 0} payment records, ${Math.round(result.totalPaymentAmount ?? 0).toLocaleString("en-US")} MMK).`,
        );
      } else if (reportType === "payment") {
        setNotice(
          `Payment test sent to ${selectedTarget.targetLabel} (${result.paymentCount ?? 0} payment records, ${Math.round(result.totalPaymentAmount ?? 0).toLocaleString("en-US")} MMK).`,
        );
      } else {
        setNotice(`Appointment test sent to ${selectedTarget.targetLabel} (${result.appointmentCount ?? 0} appointments).`);
      }
      await loadStatus(false);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Test report could not be sent."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleResend(reportType: TelegramReportType) {
    if (!selectedTarget?.telegramChatId || !selectedDraft) {
      return;
    }

    setBusyAction("resend");
    setNotice(null);
    setErrorMessage(null);

    try {
      const result = await resendTelegramReport({
        clinicId: activeClinic.id,
        clinicCode: activeClinic.code,
        clinicName: activeClinic.name,
        chatId: selectedTarget.telegramChatId,
        timezone: selectedDraft.timezone,
        reportType,
        ownerAiLanguage: selectedDraft.ownerAiLanguage,
        ownerAiTone: selectedDraft.ownerAiTone,
        ownerAiFocusAreas: selectedDraft.ownerAiFocusAreas,
        ownerAiCustomInstruction: selectedDraft.ownerAiCustomInstruction.trim() || null,
        weeklySummarySections: selectedDraft.weeklySummarySections,
      });

      if (reportType === "owner_ai") {
        setNotice(
          `AI Owner Report resent to ${selectedTarget.targetLabel} (${result.ownerAiOverallStatus ?? "sent"}, ${result.appointmentCount ?? 0} appointments, ${result.paymentCount ?? 0} payment records).`,
        );
      } else if (reportType === "weekly_summary") {
        setNotice(
          `Weekly Summary Report resent to ${selectedTarget.targetLabel} (${result.appointmentCount ?? 0} appointments, ${result.paymentCount ?? 0} payment records, ${Math.round(result.totalPaymentAmount ?? 0).toLocaleString("en-US")} MMK).`,
        );
      } else if (reportType === "payment") {
        setNotice(
          `Payment report resent to ${selectedTarget.targetLabel} (${result.paymentCount ?? 0} payment records, ${Math.round(result.totalPaymentAmount ?? 0).toLocaleString("en-US")} MMK).`,
        );
      } else {
        setNotice(`Appointment report resent to ${selectedTarget.targetLabel} (${result.appointmentCount ?? 0} appointments).`);
      }
      await loadStatus(false);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Report could not be resent."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSendSalesAssistantTest() {
    if (!selectedTarget?.telegramChatId || !selectedDraft) {
      return;
    }

    setBusyAction("sales_test");
    setNotice(null);
    setErrorMessage(null);

    try {
      const result = await sendSalesAssistantTasks({
        clinicId: activeClinic.id,
        clinicCode: activeClinic.code,
        clinicName: activeClinic.name,
        targetPurpose: selectedDraft.targetPurpose,
        targetChatId: selectedTarget.telegramChatId,
      });
      setNotice(
        `GT Growth AI sent ${result.actionCount} task${result.actionCount === 1 ? "" : "s"} to ${result.salesTargetLabel}. Check that Telegram chat, or send /tasks there to refresh.`,
      );
      await loadStatus(false);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "GT Growth AI task test could not be sent."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCopyCode() {
    if (!status?.pendingLinkCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(status.pendingLinkCode);
      setNotice("Telegram link code copied.");
    } catch {
      setNotice("Telegram link code is visible below if clipboard access is blocked.");
    }
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report telegram-settings">
      <PageHeader
        title="Telegram"
        hideContext
        actions={
          <div className="telegram-settings__header-actions">
            <button
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => void loadStatus(true)}
              disabled={busyAction === "load"}
            >
              Refresh status
            </button>
            <button
              className="button telegram-settings__button telegram-settings__button--primary"
              onClick={() => void handleSaveSettings()}
              disabled={busyAction !== null || !hasChanges || !selectedTarget}
            >
              {saveButtonLabel}
            </button>
          </div>
        }
      />

      <div className="telegram-settings__status-strip">
        <div>
          <strong>{activeClinic.name}</strong>
          <span>Clinic code: {activeClinic.code}</span>
        </div>
        {notice ? <span className="telegram-settings__notice telegram-settings__notice--success">{notice}</span> : null}
        {!notice && errorMessage ? (
          <span className="telegram-settings__notice telegram-settings__notice--danger">{errorMessage}</span>
        ) : null}
      </div>

      {errorMessage && !status && busyAction !== "load" ? (
        <ErrorState label="Telegram settings could not be loaded" detail={errorMessage} />
      ) : null}

      <div className="telegram-settings__layout">
        <Panel
          className="telegram-settings__card"
          title="Connection"
          subtitle="Link one or more Telegram owner chats or groups to this clinic with a short-lived code."
          action={<span className={`telegram-settings__badge telegram-settings__badge--${status?.connectionStatus ?? "idle"}`}>{formatStatusLabel(status)}</span>}
        >
          {busyAction === "load" && !status ? <div className="inline-note inline-note--loading">Loading Telegram connection...</div> : null}

          <div className="telegram-settings__meta-grid">
            <article className="telegram-settings__meta-card">
              <span>Linked targets</span>
              <strong>{status?.linkedTargetLabel ?? "Not linked yet"}</strong>
              <small>
                {status?.linkedTargetCount
                  ? `${status.linkedTargetCount} Telegram target${status.linkedTargetCount > 1 ? "s" : ""} can receive clinic reports.`
                  : "Generate a code to start the bot link flow."}
              </small>
            </article>

            <article className="telegram-settings__meta-card">
              <span>Bot</span>
              <strong>{status?.botUsername ? `@${status.botUsername}` : "Bot username not configured"}</strong>
              <small>Use the GT bot to redeem this clinic’s link code.</small>
            </article>
          </div>

          <div className="telegram-settings__callout">
            <strong>
              {pendingCodeActive
                ? "Next step: send the code in Telegram"
                : isLinked
                  ? "Telegram is connected to this clinic"
                  : "Start by generating a link code"}
            </strong>
            <span>
              {pendingCodeActive
                ? "Open the bot, paste the code, and this clinic will add a new Telegram target automatically."
                : isLinked
                  ? "You can manage each linked target below, or generate another code to add an owner, manager, or group."
                  : "Generate a short-lived code first, then open the bot and paste the code there."}
            </span>
          </div>

          {pendingCodeActive ? (
            <div className="telegram-settings__code-card">
              <span>Current link code</span>
              <strong>{status?.pendingLinkCode}</strong>
              <small>Expires {formatTimestamp(status?.pendingLinkCodeExpiresAt)}</small>
            </div>
          ) : null}

          <div className="telegram-settings__button-row">
            <button
              className="button telegram-settings__button telegram-settings__button--primary"
              onClick={() => void handleGenerateLinkCode()}
              disabled={busyAction !== null}
            >
              {busyAction === "link" ? "Generating..." : pendingCodeActive ? "Regenerate code" : "Generate link code"}
            </button>

            <button
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => {
                if (botTargetUrl) {
                  window.open(botTargetUrl, "_blank", "noopener,noreferrer");
                }
              }}
              disabled={!botTargetUrl}
            >
              Open Telegram bot
            </button>

            <button
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => {
                if (botGroupTargetUrl) {
                  window.open(botGroupTargetUrl, "_blank", "noopener,noreferrer");
                }
              }}
              disabled={!botGroupTargetUrl}
            >
              Add bot to group
            </button>

            <button
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => setIsQrOpen(true)}
              disabled={!qrBotUrl}
            >
              Show Telegram QR
            </button>

            {pendingCodeActive ? (
              <button className="button telegram-settings__button telegram-settings__button--secondary" onClick={() => void handleCopyCode()}>
                Copy code
              </button>
            ) : null}
          </div>

          {status?.linkedTargets.length ? (
            <label className="field">
              <span>Manage linked target</span>
              <select value={selectedTarget?.telegramChatId ?? ""} onChange={(event) => setSelectedChatId(event.target.value)}>
                {status.linkedTargets.map((target) => (
                  <option key={target.telegramChatId ?? target.targetLabel} value={target.telegramChatId ?? ""}>
                    {target.targetLabel}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {selectedTarget ? (
            <div className="telegram-settings__meta-grid">
              <article className="telegram-settings__meta-card">
                <span>Selected target</span>
                <strong>{selectedTarget.targetLabel}</strong>
                <small>
                  {selectedTarget.telegramChatType ? `${selectedTarget.telegramChatType} chat` : "Telegram target"} · Linked{" "}
                  {formatTimestamp(selectedTarget.telegramLinkedAt)}
                </small>
              </article>
              <article className="telegram-settings__meta-card">
                <span>Target coverage</span>
                <strong>
                  {selectedDraft?.appointmentEnabled ? "Appointment on" : "Appointment off"} ·{" "}
                  {selectedDraft?.paymentEnabled ? "Payment on" : "Payment off"} ·{" "}
                  {selectedDraft?.ownerAiEnabled ? "AI Owner on" : "AI Owner off"} ·{" "}
                  {selectedDraft?.weeklySummaryEnabled ? "Weekly on" : "Weekly off"}
                </strong>
                <small>Each linked target can receive its own report mix and send time.</small>
              </article>
            </div>
          ) : null}

          {status?.linkedTargets.length ? (
            <div className="telegram-routing-matrix">
              <div className="telegram-routing-matrix__header">
                <div>
                  <strong>Report routing</strong>
                  <span>Choose a target, then enable which reports that target should receive below.</span>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table telegram-routing-matrix__table">
                  <thead>
                    <tr>
                      <th>Target</th>
                      <th>Purpose</th>
                      {REPORT_ROUTING_COLUMNS.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                      <th>Manage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.linkedTargets.map((target) => (
                      <tr
                        key={target.telegramChatId ?? target.targetLabel}
                        className={target.telegramChatId === selectedTarget?.telegramChatId ? "telegram-routing-matrix__row--selected" : ""}
                      >
                        <td>
                          <strong>{target.targetLabel}</strong>
                          <small>{target.telegramChatType ?? "chat"}</small>
                        </td>
                        <td>{formatTargetPurposeLabel(target.targetPurpose)}</td>
                        {REPORT_ROUTING_COLUMNS.map((column) => {
                          const cell = getRoutingCell(target, column.key);
                          return (
                            <td key={`${target.telegramChatId}-${column.key}`}>
                              <span
                                className={`telegram-routing-matrix__pill ${
                                  cell.enabled ? "telegram-routing-matrix__pill--on" : "telegram-routing-matrix__pill--off"
                                }`}
                              >
                                {cell.enabled ? cell.time : "Off"}
                              </span>
                            </td>
                          );
                        })}
                        <td>
                          <button
                            className="button telegram-settings__button telegram-settings__button--secondary"
                            onClick={() => setSelectedChatId(target.telegramChatId)}
                            disabled={!target.telegramChatId}
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="telegram-settings__steps">
            <div>
              <strong>1. Generate code</strong>
              <span>Create a short-lived code from GT Settings.</span>
            </div>
            <div>
              <strong>2. Open the bot</strong>
              <span>Start the Telegram bot, or add it to a group if the owner wants group delivery.</span>
            </div>
            <div>
              <strong>3. Send the code</strong>
              <span>Paste the code in Telegram. Each redeemed code adds one new linked target for this clinic.</span>
            </div>
          </div>
        </Panel>

        <Panel
          className="telegram-settings__card telegram-settings__card--wide"
          title="GT Growth AI"
          subtitle="Paid feature status for AI insights, task delivery, business opportunities, and Myanmar Telegram recommendations."
          action={
            <span
              className={`telegram-settings__badge telegram-settings__badge--${
                gtGrowthAiAccess?.enabled ? "linked" : "idle"
              }`}
            >
              {gtGrowthAiAccess?.enabled ? "Enabled" : "Locked"}
            </span>
          }
        >
          <div className="telegram-settings__meta-grid">
            <article className="telegram-settings__meta-card">
              <span>Access source</span>
              <strong>{formatFeatureAccessSource(gtGrowthAiAccess?.source)}</strong>
              <small>
                {gtGrowthAiAccess?.source === "environment"
                  ? "Cloud Run env enables this clinic, so the setting cannot be changed here."
                  : "Paid entitlement is managed by GreatTime admin or billing, not by merchant settings."}
              </small>
            </article>

            <article className="telegram-settings__meta-card">
              <span>Last updated</span>
              <strong>{formatTimestamp(gtGrowthAiAccess?.updatedAt)}</strong>
              <small>{gtGrowthAiAccess?.updatedByEmail ?? "No saved clinic-level feature change yet."}</small>
            </article>
          </div>

          <div className="telegram-settings__callout">
            <strong>{gtGrowthAiAccess?.enabled ? "Premium GT Growth AI is active" : "Unlock GT Growth AI task delivery"}</strong>
            <span>
              {gtGrowthAiAccess?.enabled
                ? "Paid clinics can receive AI report sections and daily money-making task lists for the sales team."
                : "Basic reports remain free. Upgrade to send daily rebooking, package, VIP, and payment follow-up tasks to your team."}
            </span>
          </div>

          <p className="telegram-settings__hint">
            TODO(gt_growth_ai): connect this status to the production billing/admin entitlement source. Normal merchant users
            cannot self-enable paid access from this settings page.
          </p>
        </Panel>

        <Panel
          className="telegram-settings__card telegram-settings__card--wide"
          title="GT Growth AI task delivery"
          subtitle={
            gtGrowthAiAccess?.enabled
              ? "Send daily money-making follow-up tasks to the sales lead and progress summaries to the owner."
              : "Upgrade to send AI-generated customer follow-up tasks to your sales team."
          }
          action={
            <span
              className={`telegram-settings__badge telegram-settings__badge--${
                gtGrowthAiAccess?.enabled ? "linked" : "idle"
              }`}
            >
              {gtGrowthAiAccess?.enabled ? "Available" : "Locked"}
            </span>
          }
        >
          {!gtGrowthAiAccess?.enabled ? (
            <div className="telegram-settings__callout">
              <strong>Unlock GT Growth AI task delivery</strong>
              <span>
                GreatTime AI finds customers to rebook, package customers to follow up, VIP customers to recover, and
                payments to follow up. Upgrade to send daily task lists to your sales team.
              </span>
            </div>
          ) : !selectedTarget || !selectedDraft ? (
            <div className="inline-note">Link and select a Telegram target before configuring AI task delivery.</div>
          ) : (
            <>
              <div className="telegram-settings__two-up">
                <label className="field">
                  <span>Target purpose</span>
                  <select
                    value={selectedDraft.targetPurpose}
                    onChange={(event) =>
                      updateSelectedDraft({ targetPurpose: event.target.value as GtGrowthAiTelegramTargetPurpose })
                    }
                  >
                    {TELEGRAM_TARGET_PURPOSE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <article className="telegram-settings__meta-card telegram-settings__meta-card--inline">
                  <span>Selected target</span>
                  <strong>{selectedTarget.targetLabel}</strong>
                  <small>
                    Customer-level task lists should go to a private sales lead target when possible.
                  </small>
                </article>
              </div>

              <label className="telegram-settings__toggle">
                <input
                  type="checkbox"
                  checked={selectedDraft.salesAssistantEnabled}
                  onChange={(event) => updateSelectedDraft({ salesAssistantEnabled: event.target.checked })}
                />
                <span className={`telegram-settings__switch ${selectedDraft.salesAssistantEnabled ? "telegram-settings__switch--on" : ""}`} aria-hidden="true">
                  <span className="telegram-settings__switch-handle" />
                </span>
                <div className="telegram-settings__toggle-copy">
                  <strong>Enable daily AI tasks</strong>
                  <span>Send the task list to the linked sales lead target at the selected time.</span>
                </div>
              </label>

              <div className="telegram-settings__two-up">
                <label className="field">
                  <span>Sales task send time</span>
                  <input
                    type="time"
                    value={selectedDraft.salesAssistantTime || envDefaultTime()}
                    onChange={(event) => updateSelectedDraft({ salesAssistantTime: event.target.value })}
                  />
                </label>

                <label className="field">
                  <span>Owner progress time</span>
                  <input
                    type="time"
                    value={selectedDraft.ownerProgressTime || envDefaultTime()}
                    onChange={(event) => updateSelectedDraft({ ownerProgressTime: event.target.value })}
                  />
                </label>
              </div>

              <label className="telegram-settings__toggle">
                <input
                  type="checkbox"
                  checked={selectedDraft.ownerProgressEnabled}
                  onChange={(event) => updateSelectedDraft({ ownerProgressEnabled: event.target.checked })}
                />
                <span className={`telegram-settings__switch ${selectedDraft.ownerProgressEnabled ? "telegram-settings__switch--on" : ""}`} aria-hidden="true">
                  <span className="telegram-settings__switch-handle" />
                </span>
                <div className="telegram-settings__toggle-copy">
                  <strong>Enable owner progress summary</strong>
                  <span>Send a concise contacted/booked/purchased progress summary to owner or manager targets.</span>
                </div>
              </label>

              <div className="telegram-settings__button-row">
                <button
                  className="button telegram-settings__button telegram-settings__button--primary"
                  onClick={() => void handleSaveSettings()}
                  disabled={busyAction !== null || !hasChanges}
                >
                  {busyAction === "save" ? "Saving..." : "Save AI task settings"}
                </button>
                <button
                  className="button telegram-settings__button telegram-settings__button--secondary"
                  onClick={() => void handleSendSalesAssistantTest()}
                  disabled={busyAction !== null}
                >
                  {busyAction === "sales_test" ? "Sending..." : "Send AI task test"}
                </button>
                <button
                  className="button telegram-settings__button telegram-settings__button--secondary"
                  onClick={() => {
                    window.location.href = "/ai/agent-hub";
                  }}
                >
                  Open Agent workspace
                </button>
              </div>
            </>
          )}
        </Panel>

        <Panel
          className="telegram-settings__card"
          title="Today Appointment Report"
          subtitle={
            selectedTarget
              ? `Owner-facing operational report for ${selectedTarget.targetLabel}.`
              : "Link a Telegram target first, then configure its daily appointment report."
          }
        >
          <label className={`telegram-settings__toggle ${!selectedTarget ? "telegram-settings__toggle--disabled" : ""}`}>
            <input
              type="checkbox"
              checked={selectedDraft?.appointmentEnabled ?? false}
              onChange={(event) => updateSelectedDraft({ appointmentEnabled: event.target.checked })}
              disabled={!selectedTarget}
            />
            <span className={`telegram-settings__switch ${selectedDraft?.appointmentEnabled ? "telegram-settings__switch--on" : ""}`} aria-hidden="true">
              <span className="telegram-settings__switch-handle" />
            </span>
            <div className="telegram-settings__toggle-copy">
              <strong>Enable daily Today Appointment Report</strong>
              <span>
                {selectedTarget
                  ? "This target will receive the daily today-appointment report at the selected time."
                  : "Link Telegram first to enable scheduled delivery."}
              </span>
            </div>
          </label>

          <div className="telegram-settings__two-up">
            <label className="field">
              <span>Daily send time</span>
              <input
                type="time"
                value={selectedDraft?.appointmentTime ?? envDefaultTime()}
                onChange={(event) => updateSelectedDraft({ appointmentTime: event.target.value })}
                disabled={!selectedTarget}
              />
            </label>

            <label className="field">
              <span>Timezone</span>
              <select
                value={selectedDraft?.timezone ?? timezoneOptions[0]}
                onChange={(event) => updateSelectedDraft({ timezone: event.target.value })}
                disabled={!selectedTarget}
              >
                {timezoneOptions.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="telegram-settings__meta-grid">
            <article className="telegram-settings__meta-card">
              <span>Last appointment test</span>
              <strong>{formatTimestamp(selectedTarget?.lastTestSentAt)}</strong>
              <small>Manual test sends use the same report format as the daily schedule.</small>
            </article>

            <article className="telegram-settings__meta-card">
              <span>Last appointment daily send</span>
              <strong>{formatTimestamp(selectedTarget?.lastScheduledSentAt)}</strong>
              <small>
                {selectedTarget?.lastScheduledDateKey
                  ? `Last scheduled appointment report date: ${selectedTarget.lastScheduledDateKey}`
                  : "No scheduled appointment send recorded yet."}
              </small>
            </article>
          </div>

          {selectedTarget?.lastAppointmentFailureReason ? (
            <div className="telegram-settings__failure-note">
              <strong>Last appointment delivery issue</strong>
              <span>{selectedTarget.lastAppointmentFailureReason}</span>
              <small>Recorded {formatTimestamp(selectedTarget.lastAppointmentFailureAt)}</small>
            </div>
          ) : null}

          <div className="telegram-settings__button-row">
            <button
              className="button telegram-settings__button telegram-settings__button--primary"
              onClick={() => void handleSaveSettings()}
              disabled={busyAction !== null || !hasChanges || !selectedTarget}
            >
              {busyAction === "save" ? "Saving..." : "Save appointment schedule"}
            </button>
            <button
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => void handleSendTest("appointment")}
              disabled={!selectedTarget || busyAction !== null}
            >
              {busyAction === "test" ? "Sending..." : "Send appointment test"}
            </button>
            <button
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => void handleResend("appointment")}
              disabled={!selectedTarget || busyAction !== null || appointmentHistory.length === 0}
            >
              {busyAction === "resend" ? "Resending..." : appointmentResendLabel}
            </button>
          </div>
        </Panel>

        <Panel
          className="telegram-settings__card telegram-settings__card--wide"
          title="Today Payment Report"
          subtitle={
            selectedTarget
              ? `Live payment activity report for ${selectedTarget.targetLabel}.`
              : "Link a Telegram target first, then configure its payment report."
          }
        >
          <label className={`telegram-settings__toggle ${!selectedTarget ? "telegram-settings__toggle--disabled" : ""}`}>
            <input
              type="checkbox"
              checked={selectedDraft?.paymentEnabled ?? false}
              onChange={(event) => updateSelectedDraft({ paymentEnabled: event.target.checked })}
              disabled={!selectedTarget}
            />
            <span className={`telegram-settings__switch ${selectedDraft?.paymentEnabled ? "telegram-settings__switch--on" : ""}`} aria-hidden="true">
              <span className="telegram-settings__switch-handle" />
            </span>
            <div className="telegram-settings__toggle-copy">
              <strong>Enable daily Today Payment Report</strong>
              <span>
                {selectedTarget
                  ? "This target will receive the live same-day payment summary at the selected time."
                  : "Link Telegram first to enable scheduled delivery."}
              </span>
            </div>
          </label>

          <div className="telegram-settings__two-up">
            <label className="field">
              <span>Daily send time</span>
              <input
                type="time"
                value={selectedDraft?.paymentTime ?? envDefaultTime()}
                onChange={(event) => updateSelectedDraft({ paymentTime: event.target.value })}
                disabled={!selectedTarget}
              />
            </label>

            <article className="telegram-settings__meta-card telegram-settings__meta-card--inline">
              <span>Selected target</span>
              <strong>{selectedTarget?.targetLabel ?? "No target selected"}</strong>
              <small>Use the target selector above to switch between owner chats or groups.</small>
            </article>
          </div>

          <div className="telegram-settings__meta-grid">
            <article className="telegram-settings__meta-card">
              <span>Last payment test</span>
              <strong>{formatTimestamp(selectedTarget?.lastPaymentTestSentAt)}</strong>
              <small>Manual tests send the same payment message owners will receive daily.</small>
            </article>

            <article className="telegram-settings__meta-card">
              <span>Last payment daily send</span>
              <strong>{formatTimestamp(selectedTarget?.lastPaymentScheduledSentAt)}</strong>
              <small>
                {selectedTarget?.lastPaymentScheduledDateKey
                  ? `Last scheduled payment report date: ${selectedTarget.lastPaymentScheduledDateKey}`
                  : "No scheduled payment send recorded yet."}
              </small>
            </article>
          </div>

          {selectedTarget?.lastPaymentFailureReason ? (
            <div className="telegram-settings__failure-note">
              <strong>Last payment delivery issue</strong>
              <span>{selectedTarget.lastPaymentFailureReason}</span>
              <small>Recorded {formatTimestamp(selectedTarget.lastPaymentFailureAt)}</small>
            </div>
          ) : null}

          <div className="telegram-settings__button-row">
            <button
              className="button telegram-settings__button telegram-settings__button--primary"
              onClick={() => void handleSaveSettings()}
              disabled={busyAction !== null || !hasChanges || !selectedTarget}
            >
              {busyAction === "save" ? "Saving..." : "Save payment schedule"}
            </button>
            <button
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => void handleSendTest("payment")}
              disabled={!selectedTarget || busyAction !== null}
            >
              {busyAction === "test" ? "Sending..." : "Send payment test"}
            </button>
            <button
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => void handleResend("payment")}
              disabled={!selectedTarget || busyAction !== null || paymentHistory.length === 0}
            >
              {busyAction === "resend" ? "Resending..." : paymentResendLabel}
            </button>
            <button
              className="button telegram-settings__button telegram-settings__button--danger"
              onClick={() => void handleUnlink()}
              disabled={!selectedTarget || busyAction !== null}
            >
              {busyAction === "unlink" ? "Disconnecting..." : "Disconnect selected target"}
            </button>
          </div>

          <p className="telegram-settings__hint">
            Each linked Telegram target has its own report toggles, times, and timezone, so one clinic can send owners and management groups different schedules without reconnecting.
          </p>
        </Panel>

        <Panel
          className="telegram-settings__card telegram-settings__card--wide"
          title="Weekly Summary Report"
          subtitle={
            selectedTarget
              ? `Weekly operational summary for ${selectedTarget.targetLabel}.`
              : "Link a Telegram target first, then configure its Weekly Summary Report."
          }
        >
          <label className={`telegram-settings__toggle ${!selectedTarget ? "telegram-settings__toggle--disabled" : ""}`}>
            <input
              type="checkbox"
              checked={selectedDraft?.weeklySummaryEnabled ?? false}
              onChange={(event) => updateSelectedDraft({ weeklySummaryEnabled: event.target.checked })}
              disabled={!selectedTarget}
            />
            <span className={`telegram-settings__switch ${selectedDraft?.weeklySummaryEnabled ? "telegram-settings__switch--on" : ""}`} aria-hidden="true">
              <span className="telegram-settings__switch-handle" />
            </span>
            <div className="telegram-settings__toggle-copy">
              <strong>Enable Weekly Summary Report</strong>
              <span>
                {selectedTarget
                  ? "This target will receive the selected weekly summary sections on the chosen day and time."
                  : "Link Telegram first to enable scheduled weekly delivery."}
              </span>
            </div>
          </label>

          <div className="telegram-settings__two-up">
            <label className="field">
              <span>Weekly send day</span>
              <select
                value={selectedDraft?.weeklySummaryDayOfWeek ?? "monday"}
                onChange={(event) =>
                  updateSelectedDraft({
                    weeklySummaryDayOfWeek: event.target.value as TelegramWeeklySummaryDayOfWeek,
                  })
                }
                disabled={!selectedTarget}
              >
                {WEEKLY_SUMMARY_DAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Weekly send time</span>
              <input
                type="time"
                value={selectedDraft?.weeklySummaryTime ?? envDefaultTime()}
                onChange={(event) => updateSelectedDraft({ weeklySummaryTime: event.target.value })}
                disabled={!selectedTarget}
              />
            </label>
          </div>

          <div className="telegram-settings__two-up">
            <label className="field">
              <span>Timezone</span>
              <select
                value={selectedDraft?.timezone ?? timezoneOptions[0]}
                onChange={(event) => updateSelectedDraft({ timezone: event.target.value })}
                disabled={!selectedTarget}
              >
                {timezoneOptions.map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone}
                  </option>
                ))}
              </select>
            </label>

            <article className="telegram-settings__meta-card telegram-settings__meta-card--inline">
              <span>Selected target</span>
              <strong>{selectedTarget?.targetLabel ?? "No target selected"}</strong>
              <small>Weekly delivery uses the target timezone and selected weekday.</small>
            </article>
          </div>

          <div className="field">
            <span>Report sections</span>
            <div className="telegram-settings__checkbox-grid">
              {WEEKLY_SUMMARY_SECTION_OPTIONS.map((option) => (
                <label key={option.value} className="telegram-settings__checkbox">
                  <input
                    type="checkbox"
                    checked={selectedDraft?.weeklySummarySections.includes(option.value) ?? false}
                    onChange={(event) => toggleWeeklySummarySection(option.value, event.target.checked)}
                    disabled={!selectedTarget}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="telegram-settings__meta-grid">
            <article className="telegram-settings__meta-card">
              <span>Last Weekly test</span>
              <strong>{formatTimestamp(selectedTarget?.lastWeeklySummaryTestSentAt)}</strong>
              <small>Manual tests use the current selected weekly sections.</small>
            </article>

            <article className="telegram-settings__meta-card">
              <span>Last Weekly scheduled send</span>
              <strong>{formatTimestamp(selectedTarget?.lastWeeklySummaryScheduledSentAt)}</strong>
              <small>
                {selectedTarget?.lastWeeklySummaryScheduledDateKey
                  ? `Last scheduled Weekly Summary report date: ${selectedTarget.lastWeeklySummaryScheduledDateKey}`
                  : "No scheduled Weekly Summary send recorded yet."}
              </small>
            </article>
          </div>

          {selectedTarget?.lastWeeklySummaryFailureReason ? (
            <div className="telegram-settings__failure-note">
              <strong>Last Weekly Summary delivery issue</strong>
              <span>{selectedTarget.lastWeeklySummaryFailureReason}</span>
              <small>Recorded {formatTimestamp(selectedTarget.lastWeeklySummaryFailureAt)}</small>
            </div>
          ) : null}

          <div className="telegram-settings__button-row">
            <button
              className="button telegram-settings__button telegram-settings__button--primary"
              onClick={() => void handleSaveSettings()}
              disabled={busyAction !== null || !hasChanges || !selectedTarget}
            >
              {busyAction === "save" ? "Saving..." : "Save Weekly Schedule"}
            </button>
            <button
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => void handleSendTest("weekly_summary")}
              disabled={!selectedTarget || busyAction !== null}
            >
              {busyAction === "test" ? "Sending..." : "Send Weekly Test"}
            </button>
            <button
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => void handleResend("weekly_summary")}
              disabled={!selectedTarget || busyAction !== null || weeklySummaryHistory.length === 0}
            >
              {busyAction === "resend" ? "Resending..." : weeklySummaryResendLabel}
            </button>
          </div>
        </Panel>

        <Panel
          className="telegram-settings__card telegram-settings__card--wide"
          title="AI Owner Report"
          subtitle={
            selectedTarget
              ? `AI business-owner summary for ${selectedTarget.targetLabel}.`
              : "Link a Telegram target first, then configure its AI Owner Report."
          }
        >
          <label className={`telegram-settings__toggle ${!selectedTarget ? "telegram-settings__toggle--disabled" : ""}`}>
            <input
              type="checkbox"
              checked={selectedDraft?.ownerAiEnabled ?? false}
              onChange={(event) => updateSelectedDraft({ ownerAiEnabled: event.target.checked })}
              disabled={!selectedTarget}
            />
            <span className={`telegram-settings__switch ${selectedDraft?.ownerAiEnabled ? "telegram-settings__switch--on" : ""}`} aria-hidden="true">
              <span className="telegram-settings__switch-handle" />
            </span>
            <div className="telegram-settings__toggle-copy">
              <strong>Enable daily AI Owner Report</strong>
              <span>
                {selectedTarget
                  ? "This target will receive a short AI summary generated from appointment and payment facts."
                  : "Link Telegram first to enable scheduled delivery."}
              </span>
            </div>
          </label>

          <div className="telegram-settings__two-up">
            <label className="field">
              <span>Daily send time</span>
              <input
                type="time"
                value={selectedDraft?.ownerAiTime ?? envDefaultTime()}
                onChange={(event) => updateSelectedDraft({ ownerAiTime: event.target.value })}
                disabled={!selectedTarget}
              />
            </label>

            <label className="field">
              <span>Language</span>
              <select
                value={selectedDraft?.ownerAiLanguage ?? "my-MM"}
                onChange={(event) => updateSelectedDraft({ ownerAiLanguage: event.target.value as AiLanguage })}
                disabled={!selectedTarget}
              >
                {OWNER_AI_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="telegram-settings__two-up">
            <label className="field">
              <span>Tone</span>
              <select
                value={selectedDraft?.ownerAiTone ?? "simple"}
                onChange={(event) => updateSelectedDraft({ ownerAiTone: event.target.value as TelegramOwnerAiTone })}
                disabled={!selectedTarget}
              >
                {OWNER_AI_TONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <article className="telegram-settings__meta-card telegram-settings__meta-card--inline">
              <span>Selected target</span>
              <strong>{selectedTarget?.targetLabel ?? "No target selected"}</strong>
              <small>AI output is validated as strict JSON before Telegram delivery.</small>
            </article>
          </div>

          <div className="field">
            <span>Focus areas</span>
            <div className="telegram-settings__checkbox-grid">
              {OWNER_AI_FOCUS_OPTIONS.map((option) => (
                <label key={option.value} className="telegram-settings__checkbox">
                  <input
                    type="checkbox"
                    checked={selectedDraft?.ownerAiFocusAreas.includes(option.value) ?? false}
                    onChange={(event) => toggleOwnerAiFocusArea(option.value, event.target.checked)}
                    disabled={!selectedTarget}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="field">
            <span>Custom instruction</span>
            <textarea
              className="telegram-settings__textarea"
              value={selectedDraft?.ownerAiCustomInstruction ?? ""}
              onChange={(event) => updateSelectedDraft({ ownerAiCustomInstruction: event.target.value })}
              maxLength={240}
              rows={3}
              disabled={!selectedTarget}
            />
          </label>

          <div className="telegram-settings__meta-grid">
            <article className="telegram-settings__meta-card">
              <span>Last AI Owner test</span>
              <strong>{formatTimestamp(selectedTarget?.lastOwnerAiTestSentAt)}</strong>
              <small>Manual tests use the current draft language, tone, focus, and instruction.</small>
            </article>

            <article className="telegram-settings__meta-card">
              <span>Last AI Owner daily send</span>
              <strong>{formatTimestamp(selectedTarget?.lastOwnerAiScheduledSentAt)}</strong>
              <small>
                {selectedTarget?.lastOwnerAiScheduledDateKey
                  ? `Last scheduled AI Owner report date: ${selectedTarget.lastOwnerAiScheduledDateKey}`
                  : "No scheduled AI Owner send recorded yet."}
              </small>
            </article>
          </div>

          {selectedTarget?.lastOwnerAiFailureReason ? (
            <div className="telegram-settings__failure-note">
              <strong>Last AI Owner delivery issue</strong>
              <span>{selectedTarget.lastOwnerAiFailureReason}</span>
              <small>Recorded {formatTimestamp(selectedTarget.lastOwnerAiFailureAt)}</small>
            </div>
          ) : null}

          <div className="telegram-settings__button-row">
            <button
              className="button telegram-settings__button telegram-settings__button--primary"
              onClick={() => void handleSaveSettings()}
              disabled={busyAction !== null || !hasChanges || !selectedTarget}
            >
              {busyAction === "save" ? "Saving..." : "Save AI Owner schedule"}
            </button>
            <button
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => void handleSendTest("owner_ai")}
              disabled={!selectedTarget || busyAction !== null}
            >
              {busyAction === "test" ? "Sending..." : "Send AI Owner test"}
            </button>
            <button
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => void handleResend("owner_ai")}
              disabled={!selectedTarget || busyAction !== null || ownerAiHistory.length === 0}
            >
              {busyAction === "resend" ? "Resending..." : ownerAiResendLabel}
            </button>
          </div>
        </Panel>

        <Panel
          className="telegram-settings__card telegram-settings__card--wide"
          title="Recent delivery activity"
          subtitle={
            selectedTarget
              ? `Latest Telegram sends and failures for ${selectedTarget.targetLabel}.`
              : "Link and select a Telegram target to see recent delivery history."
          }
        >
          {!selectedTarget ? (
            <div className="inline-note">Choose a Telegram target first.</div>
          ) : selectedTarget.deliveryHistory.length === 0 ? (
            <div className="inline-note">No delivery activity recorded for this target yet.</div>
          ) : (
            <div className="telegram-settings__delivery-list">
              {selectedTarget.deliveryHistory.map((entry) => (
                <article
                  key={entry.id}
                  className={`telegram-settings__delivery-item telegram-settings__delivery-item--${entry.outcome}`}
                >
                  <div className="telegram-settings__delivery-header">
                    <strong>{formatReportTitle(entry.reportType)}</strong>
                    <span className={`telegram-settings__delivery-badge telegram-settings__delivery-badge--${entry.outcome}`}>
                      {formatOutcomeLabel(entry.outcome)}
                    </span>
                  </div>
                  <div className="telegram-settings__delivery-meta">
                    <span>{formatTriggerLabel(entry.trigger)}</span>
                    <span>{formatTimestamp(entry.attemptedAt)}</span>
                    <span>{entry.timezone}</span>
                  </div>
                  <p>{formatDeliverySummary(entry)}</p>
                </article>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {isQrOpen ? (
        <div className="telegram-settings__qr-modal-shell" role="dialog" aria-modal="true" aria-labelledby="telegram-qr-title">
          <button className="telegram-settings__qr-backdrop" type="button" aria-label="Close Telegram QR" onClick={() => setIsQrOpen(false)} />
          <div className="telegram-settings__qr-modal">
            <div className="telegram-settings__qr-header">
              <div>
                <span className="telegram-settings__qr-eyebrow">Telegram quick access</span>
                <h3 id="telegram-qr-title">Show Telegram QR</h3>
                <p>
                  {pendingCodeActive
                    ? `Scan with your phone to open ${botDisplayUsername} with this clinic's current link code.`
                    : `Scan with your phone to open ${botDisplayUsername} quickly in Telegram.`}
                </p>
              </div>
              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--secondary"
                onClick={() => setIsQrOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="telegram-settings__qr-body">
              <div className="telegram-settings__qr-card">
                <div className="telegram-settings__qr-logo">GT</div>
                <div className="telegram-settings__qr-frame">
                  {qrCodeDataUrl ? (
                    <img src={qrCodeDataUrl} alt="Telegram bot QR code" className="telegram-settings__qr-image" />
                  ) : qrError ? (
                    <div className="telegram-settings__qr-empty">
                      <strong>QR could not be generated</strong>
                      <span>{qrError}</span>
                    </div>
                  ) : (
                    <div className="telegram-settings__qr-empty">
                      <strong>Generating QR…</strong>
                      <span>Preparing a scannable Telegram link.</span>
                    </div>
                  )}
                </div>
                <strong className="telegram-settings__qr-username">{botDisplayUsername}</strong>
              </div>

              <div className="telegram-settings__qr-copy">
                <strong>{botDisplayUsername}</strong>
                <p>
                  {pendingCodeActive
                    ? "Open Telegram and scan this QR to redeem the active clinic link code in a private chat."
                    : "Open Telegram and scan this QR to jump into the GT bot without typing the username manually."}
                </p>
                <div className="telegram-settings__code-card">
                  <span>{pendingCodeActive ? "Bot link with code" : "Bot link"}</span>
                  <strong>{qrBotUrl ?? "Telegram bot not configured"}</strong>
                  <small>
                    {pendingCodeActive
                      ? "QR includes the current code, so the chat can connect to this clinic automatically."
                      : "Generate a link code first when this QR should connect a new Telegram target."}
                  </small>
                </div>
                {botGroupTargetUrl ? (
                  <button
                    type="button"
                    className="button telegram-settings__button telegram-settings__button--secondary"
                    onClick={() => window.open(botGroupTargetUrl, "_blank", "noopener,noreferrer")}
                  >
                    Add bot to group
                  </button>
                ) : null}
                {botTargetUrl ? (
                  <button
                    type="button"
                    className="button telegram-settings__button telegram-settings__button--primary"
                    onClick={() => window.open(botTargetUrl, "_blank", "noopener,noreferrer")}
                  >
                    Open Telegram bot
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function envDefaultTime() {
  return "08:00";
}
