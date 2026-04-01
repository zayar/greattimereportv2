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
import type {
  TelegramDeliveryLogEntry,
  TelegramIntegrationStatus,
  TelegramReportType,
  TelegramTargetStatus,
} from "../../../types/domain";
import { useAccess } from "../../access/AccessProvider";

type BusyAction = "load" | "link" | "save" | "unlink" | "test" | "resend" | null;

type TargetDraft = {
  appointmentEnabled: boolean;
  appointmentTime: string;
  paymentEnabled: boolean;
  paymentTime: string;
  timezone: string;
};

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

function buildTargetDraft(target: TelegramTargetStatus): TargetDraft {
  return {
    appointmentEnabled: target.isTodayAppointmentReportEnabled,
    appointmentTime: target.reportTime,
    paymentEnabled: target.isTodayPaymentReportEnabled,
    paymentTime: target.paymentReportTime,
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

  return `${entry.appointmentCount ?? 0} appointments`;
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
        const nextStatus = await fetchTelegramIntegrationStatus({
          clinicId: clinic.id,
          clinicCode: clinic.code,
          clinicName: clinic.name,
        });
        setStatus(nextStatus);
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
  const latestAppointmentDelivery = appointmentHistory[0] ?? null;
  const latestPaymentDelivery = paymentHistory[0] ?? null;
  const hasChanges = Boolean(
    selectedTarget &&
      selectedDraft &&
      (selectedDraft.appointmentEnabled !== selectedTarget.isTodayAppointmentReportEnabled ||
        selectedDraft.appointmentTime !== selectedTarget.reportTime ||
        selectedDraft.paymentEnabled !== selectedTarget.isTodayPaymentReportEnabled ||
        selectedDraft.paymentTime !== selectedTarget.paymentReportTime ||
        selectedDraft.timezone !== selectedTarget.timezone),
  );
  const isLinked = (status?.linkedTargetCount ?? 0) > 0;
  const pendingCodeActive = hasActivePendingCode(status);
  const saveButtonLabel = busyAction === "save" ? "Saving..." : "Save target settings";
  const appointmentResendLabel =
    latestAppointmentDelivery?.outcome === "failed" ? "Retry appointment send" : "Resend appointment report";
  const paymentResendLabel =
    latestPaymentDelivery?.outcome === "failed" ? "Retry payment send" : "Resend payment report";
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
    if (status?.botUrl) {
      return status.botUrl;
    }

    if (status?.botUsername) {
      return `https://t.me/${status.botUsername}`;
    }

    return null;
  }, [status?.botUrl, status?.botUsername]);
  const botDisplayUsername = status?.botUsername ? `@${status.botUsername.toUpperCase()}` : "Telegram bot";

  if (!clinic) {
    return (
      <div className="page-stack page-stack--workspace analytics-report telegram-settings">
        <EmptyState label="No clinic selected" detail="Choose a clinic first so Telegram can be linked to the right owner target." />
      </div>
    );
  }

  const activeClinic = clinic;

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
        isTodayAppointmentReportEnabled: selectedDraft.appointmentEnabled,
        reportTime: selectedDraft.appointmentTime,
        isTodayPaymentReportEnabled: selectedDraft.paymentEnabled,
        paymentReportTime: selectedDraft.paymentTime,
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

  async function handleSendTest(reportType: "appointment" | "payment") {
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
      });

      if (reportType === "payment") {
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

  async function handleResend(reportType: "appointment" | "payment") {
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
      });

      if (reportType === "payment") {
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
                  {selectedDraft?.paymentEnabled ? "Payment on" : "Payment off"}
                </strong>
                <small>Each linked target can receive its own report mix and send time.</small>
              </article>
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
                    <strong>{entry.reportType === "appointment" ? "Today Appointment Report" : "Today Payment Report"}</strong>
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
                <p>Scan with your phone to open {botDisplayUsername} quickly in Telegram.</p>
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
                <p>Open Telegram and scan this QR to jump into the GT bot without typing the username manually.</p>
                <div className="telegram-settings__code-card">
                  <span>Bot link</span>
                  <strong>{qrBotUrl ?? "Telegram bot not configured"}</strong>
                  <small>QR is intentionally generated from the direct bot link so it opens the official GT bot cleanly.</small>
                </div>
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
