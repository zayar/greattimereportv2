import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import {
  fetchTelegramIntegrationStatus,
  generateTelegramLinkCode,
  saveTelegramSettings,
  sendTelegramTestReport,
  unlinkTelegramIntegration,
} from "../../../api/telegram";
import type { TelegramIntegrationStatus } from "../../../types/domain";
import { useAccess } from "../../access/AccessProvider";

type BusyAction = "load" | "link" | "save" | "unlink" | "test" | null;

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
      return "Connected";
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

export function TelegramSettingsPage() {
  const { currentClinic } = useAccess();
  const clinic = currentClinic;
  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);
  const [status, setStatus] = useState<TelegramIntegrationStatus | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>("load");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftTime, setDraftTime] = useState("08:00");
  const [draftTimezone, setDraftTimezone] = useState("Asia/Yangon");

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
        setErrorMessage(error instanceof Error ? error.message : "Telegram settings could not be loaded.");
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
      return;
    }

    setDraftEnabled(status.isTodayAppointmentReportEnabled);
    setDraftTime(status.reportTime);
    setDraftTimezone(status.timezone);
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

  const hasChanges = Boolean(
    status &&
      (draftEnabled !== status.isTodayAppointmentReportEnabled ||
        draftTime !== status.reportTime ||
        draftTimezone !== status.timezone),
  );
  const isLinked = status?.connectionStatus === "linked";
  const pendingCodeActive = hasActivePendingCode(status);

  if (!clinic) {
    return (
      <div className="page-stack page-stack--workspace analytics-report telegram-settings">
        <EmptyState label="No clinic selected" detail="Choose a clinic first so Telegram can be linked to the right owner target." />
      </div>
    );
  }

  const activeClinic = clinic;

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
      setNotice("New Telegram link code generated for this clinic.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Link code could not be generated.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveSettings() {
    setBusyAction("save");
    setNotice(null);
    setErrorMessage(null);

    try {
      const nextStatus = await saveTelegramSettings({
        clinicId: activeClinic.id,
        clinicCode: activeClinic.code,
        clinicName: activeClinic.name,
        isTodayAppointmentReportEnabled: draftEnabled,
        reportTime: draftTime,
        timezone: draftTimezone,
      });
      setStatus(nextStatus);
      setNotice("Telegram report settings saved.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Telegram settings could not be saved.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUnlink() {
    if (!window.confirm("Disconnect this clinic from the current Telegram target?")) {
      return;
    }

    setBusyAction("unlink");
    setNotice(null);
    setErrorMessage(null);

    try {
      const nextStatus = await unlinkTelegramIntegration({
        clinicId: activeClinic.id,
      });
      setStatus(nextStatus);
      setNotice("Telegram target unlinked for this clinic.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Telegram target could not be unlinked.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSendTest() {
    setBusyAction("test");
    setNotice(null);
    setErrorMessage(null);

    try {
      const result = await sendTelegramTestReport({
        clinicId: activeClinic.id,
        clinicCode: activeClinic.code,
        clinicName: activeClinic.name,
        timezone: draftTimezone,
      });

      setNotice(`Test report sent (${result.appointmentCount} appointments).`);
      await loadStatus(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Test report could not be sent.");
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
            <button className="button button--ghost" onClick={() => void loadStatus(true)} disabled={busyAction === "load"}>
              Refresh status
            </button>
            <button
              className="button button--secondary"
              onClick={() => void handleSaveSettings()}
              disabled={busyAction !== null || !hasChanges}
            >
              {busyAction === "save" ? "Saving..." : "Save settings"}
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
          subtitle="Link one Telegram owner chat or group to this clinic with a short-lived code."
          action={<span className={`telegram-settings__badge telegram-settings__badge--${status?.connectionStatus ?? "idle"}`}>{formatStatusLabel(status)}</span>}
        >
          {busyAction === "load" && !status ? <div className="inline-note">Loading Telegram connection...</div> : null}

          <div className="telegram-settings__meta-grid">
            <article className="telegram-settings__meta-card">
              <span>Linked target</span>
              <strong>{status?.linkedTargetLabel ?? "Not linked yet"}</strong>
              <small>{status?.telegramLinkedAt ? `Linked ${formatTimestamp(status.telegramLinkedAt)}` : "Generate a code to start the bot link flow."}</small>
            </article>

            <article className="telegram-settings__meta-card">
              <span>Bot</span>
              <strong>{status?.botUsername ? `@${status.botUsername}` : "Bot username not configured"}</strong>
              <small>Use the GT bot to redeem this clinic’s link code.</small>
            </article>
          </div>

          {pendingCodeActive ? (
            <div className="telegram-settings__code-card">
              <span>Current link code</span>
              <strong>{status?.pendingLinkCode}</strong>
              <small>Expires {formatTimestamp(status?.pendingLinkCodeExpiresAt)}</small>
            </div>
          ) : null}

          <div className="telegram-settings__button-row">
            <button className="button button--secondary" onClick={() => void handleGenerateLinkCode()} disabled={busyAction !== null}>
              {busyAction === "link" ? "Generating..." : pendingCodeActive ? "Regenerate code" : "Generate link code"}
            </button>

            <button
              className="button button--ghost"
              onClick={() => {
                const target = status?.botDeepLink ?? status?.botUrl;
                if (target) {
                  window.open(target, "_blank", "noopener,noreferrer");
                }
              }}
              disabled={!status?.botUrl}
            >
              Open Telegram bot
            </button>

            {pendingCodeActive ? (
              <button className="button button--ghost" onClick={() => void handleCopyCode()}>
                Copy code
              </button>
            ) : null}

            {isLinked ? (
              <button className="button button--ghost" onClick={() => void handleUnlink()} disabled={busyAction !== null}>
                {busyAction === "unlink" ? "Unlinking..." : "Unlink"}
              </button>
            ) : null}
          </div>

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
              <span>Paste the code in Telegram. This clinic will refresh to connected once the bot redeems it.</span>
            </div>
          </div>
        </Panel>

        <Panel
          className="telegram-settings__card"
          title="Today Appointment Report"
          subtitle="Owner-facing operational report with today’s appointment counts, list, therapist load, and top services."
        >
          <label className="telegram-settings__toggle">
            <input
              type="checkbox"
              checked={draftEnabled}
              onChange={(event) => setDraftEnabled(event.target.checked)}
              disabled={!isLinked}
            />
            <div>
              <strong>Enable daily Today Appointment Report</strong>
              <span>{isLinked ? "Once enabled, the backend scheduler will send this report once per day." : "Link Telegram first to enable scheduled delivery."}</span>
            </div>
          </label>

          <div className="telegram-settings__two-up">
            <label className="field">
              <span>Daily send time</span>
              <input type="time" value={draftTime} onChange={(event) => setDraftTime(event.target.value)} />
            </label>

            <label className="field">
              <span>Timezone</span>
              <select value={draftTimezone} onChange={(event) => setDraftTimezone(event.target.value)}>
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
              <span>Last test send</span>
              <strong>{formatTimestamp(status?.lastTestSentAt)}</strong>
              <small>Manual test sends use the same report format as the daily schedule.</small>
            </article>

            <article className="telegram-settings__meta-card">
              <span>Last daily send</span>
              <strong>{formatTimestamp(status?.lastScheduledSentAt)}</strong>
              <small>{status?.lastScheduledDateKey ? `Last scheduled report date: ${status.lastScheduledDateKey}` : "No scheduled send recorded yet."}</small>
            </article>
          </div>

          <div className="telegram-settings__button-row">
            <button className="button button--secondary" onClick={() => void handleSendTest()} disabled={!isLinked || busyAction !== null}>
              {busyAction === "test" ? "Sending..." : "Send test report"}
            </button>
          </div>

          <p className="telegram-settings__hint">
            V1 uses the live operational appointment source for today’s report. If a chat is unlinked, scheduled sending is automatically disabled for safety.
          </p>
        </Panel>
      </div>
    </div>
  );
}
