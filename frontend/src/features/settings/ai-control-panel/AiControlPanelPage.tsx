import { useCallback, useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { fetchGtGrowthAiFeatureAccess, saveGtGrowthAiFeatureAccess } from "../../../api/features";
import type { Clinic, ClinicFeatureAccessStatus } from "../../../types/domain";
import { useAccess } from "../../access/AccessProvider";
import { useSession } from "../../auth/SessionProvider";
import { canAccessAiControlPanel } from "../../ai/adminAccess";

type BusyState = "load" | "save";

function getApiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    const apiMessage = typeof error.response?.data?.error === "string" ? error.response.data.error : null;
    return apiMessage || error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function formatAccessSource(source: ClinicFeatureAccessStatus["source"] | undefined) {
  switch (source) {
    case "environment":
      return "Environment";
    case "clinic_setting":
      return "Clinic setting";
    default:
      return "Default locked";
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not updated yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getStatusBadgeClass(status: ClinicFeatureAccessStatus | null | undefined) {
  if (!status) {
    return "ai-control-panel__badge ai-control-panel__badge--idle";
  }

  return `ai-control-panel__badge ai-control-panel__badge--${status.enabled ? "enabled" : "disabled"}`;
}

function getRowSummary(clinic: Clinic, status: ClinicFeatureAccessStatus | null | undefined) {
  if (!status) {
    return `${clinic.name} access status has not loaded yet.`;
  }

  if (status.source === "environment") {
    return "Enabled by backend environment configuration.";
  }

  return status.message;
}

export function AiControlPanelPage() {
  const { gtUser } = useSession();
  const { clinics, currentClinic } = useAccess();
  const canUsePanel = canAccessAiControlPanel(gtUser?.email);
  const [accessByClinicId, setAccessByClinicId] = useState<Record<string, ClinicFeatureAccessStatus | null>>({});
  const [errorsByClinicId, setErrorsByClinicId] = useState<Record<string, string | null>>({});
  const [busyByClinicId, setBusyByClinicId] = useState<Record<string, BusyState | null>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const sortedClinics = useMemo(
    () =>
      [...clinics].sort((left, right) => {
        const companyCompare = left.company.name.localeCompare(right.company.name);
        if (companyCompare !== 0) {
          return companyCompare;
        }

        return left.name.localeCompare(right.name);
      }),
    [clinics],
  );

  const enabledCount = useMemo(
    () => sortedClinics.filter((clinic) => accessByClinicId[clinic.id]?.enabled).length,
    [accessByClinicId, sortedClinics],
  );

  const setClinicBusy = useCallback((clinicId: string, state: BusyState | null) => {
    setBusyByClinicId((current) => ({
      ...current,
      [clinicId]: state,
    }));
  }, []);

  const loadClinicAccess = useCallback(
    async (clinicId: string) => {
      setClinicBusy(clinicId, "load");
      setErrorsByClinicId((current) => ({
        ...current,
        [clinicId]: null,
      }));

      try {
        const response = await fetchGtGrowthAiFeatureAccess({ clinicId });
        setAccessByClinicId((current) => ({
          ...current,
          [clinicId]: response.gtGrowthAi,
        }));
      } catch (error) {
        const message = getApiErrorMessage(error, "AI access status could not be loaded.");
        setErrorsByClinicId((current) => ({
          ...current,
          [clinicId]: message,
        }));
      } finally {
        setClinicBusy(clinicId, null);
      }
    },
    [setClinicBusy],
  );

  const loadAllAccess = useCallback(
    async (showNotice: boolean) => {
      if (!canUsePanel || sortedClinics.length === 0) {
        return;
      }

      setPageError(null);
      if (showNotice) {
        setNotice(null);
      }

      await Promise.all(sortedClinics.map((clinic) => loadClinicAccess(clinic.id)));

      if (showNotice) {
        setNotice("AI access status refreshed.");
      }
    },
    [canUsePanel, loadClinicAccess, sortedClinics],
  );

  useEffect(() => {
    void loadAllAccess(false);
  }, [loadAllAccess]);

  async function handleToggle(clinic: Clinic, enabled: boolean) {
    setClinicBusy(clinic.id, "save");
    setNotice(null);
    setPageError(null);
    setErrorsByClinicId((current) => ({
      ...current,
      [clinic.id]: null,
    }));

    try {
      const response = await saveGtGrowthAiFeatureAccess({
        clinicId: clinic.id,
        enabled,
      });
      setAccessByClinicId((current) => ({
        ...current,
        [clinic.id]: response.gtGrowthAi,
      }));
      setNotice(`${clinic.name} GT Growth AI is now ${response.gtGrowthAi.enabled ? "enabled" : "disabled"}.`);
    } catch (error) {
      const message = getApiErrorMessage(error, "AI access could not be saved.");
      setErrorsByClinicId((current) => ({
        ...current,
        [clinic.id]: message,
      }));
      setPageError(message);
    } finally {
      setClinicBusy(clinic.id, null);
    }
  }

  if (!canUsePanel) {
    return (
      <div className="page-stack page-stack--workspace analytics-report ai-control-panel">
        <ErrorState
          label="AI Control Panel restricted"
          detail="Only authorized GreatTime admins can manage GT Growth AI access."
        />
      </div>
    );
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report ai-control-panel">
      <PageHeader
        title="AI Control Panel"
        hideContext
        actions={
          <div className="ai-control-panel__actions">
            <button
              className="button ai-control-panel__button ai-control-panel__button--secondary"
              onClick={() => void loadAllAccess(true)}
              disabled={Object.values(busyByClinicId).some(Boolean)}
            >
              Refresh status
            </button>
          </div>
        }
      />

      <div className="ai-control-panel__status-strip">
        <div>
          <strong>{currentClinic?.company.name ?? "GreatTime"} AI controls</strong>
          <span>
            {enabledCount.toLocaleString("en-US")} of {sortedClinics.length.toLocaleString("en-US")} visible clinics have GT Growth AI enabled.
          </span>
        </div>
        {notice ? <span className="ai-control-panel__notice ai-control-panel__notice--success">{notice}</span> : null}
        {!notice && pageError ? <span className="ai-control-panel__notice ai-control-panel__notice--danger">{pageError}</span> : null}
      </div>

      <Panel
        className="ai-control-panel__panel"
        title="GT Growth AI clinic access"
        subtitle="Enable the Agent Hub, AI report recommendations, and GT Growth AI assistant features for selected clinics."
      >
        {sortedClinics.length === 0 ? (
          <EmptyState label="No clinic access assigned" detail="This admin account does not currently have any visible clinics." />
        ) : (
          <div className="ai-control-panel__clinic-list">
            {sortedClinics.map((clinic) => {
              const status = accessByClinicId[clinic.id] ?? null;
              const busy = busyByClinicId[clinic.id] ?? null;
              const rowError = errorsByClinicId[clinic.id] ?? null;
              const isEnvironmentManaged = status?.source === "environment";
              const canToggle = Boolean(status) && !isEnvironmentManaged && busy === null;

              return (
                <article key={clinic.id} className="ai-control-panel__clinic-row">
                  <div className="ai-control-panel__clinic-main">
                    <div className="ai-control-panel__clinic-heading">
                      <div>
                        <strong>{clinic.name}</strong>
                        <span>{clinic.code ? `${clinic.code} - ${clinic.company.name}` : clinic.company.name}</span>
                      </div>
                      <span className={getStatusBadgeClass(status)}>{status?.enabled ? "Enabled" : "Disabled"}</span>
                    </div>

                    <p>{busy === "load" && !status ? "Loading AI access status..." : getRowSummary(clinic, status)}</p>

                    <div className="ai-control-panel__meta-grid">
                      <span>
                        <strong>Source</strong>
                        {formatAccessSource(status?.source)}
                      </span>
                      <span>
                        <strong>Updated</strong>
                        {formatDateTime(status?.updatedAt)}
                      </span>
                      <span>
                        <strong>Updated by</strong>
                        {status?.updatedByEmail ?? "Not recorded"}
                      </span>
                    </div>

                    {isEnvironmentManaged ? (
                      <div className="ai-control-panel__callout">
                        This clinic is enabled by backend environment configuration. Remove it from the environment list to manage it here.
                      </div>
                    ) : null}

                    {rowError ? <div className="ai-control-panel__row-error">{rowError}</div> : null}
                  </div>

                  <div className="ai-control-panel__row-actions">
                    <button
                      className="button ai-control-panel__button ai-control-panel__button--secondary"
                      onClick={() => void loadClinicAccess(clinic.id)}
                      disabled={busy !== null}
                    >
                      {busy === "load" ? "Refreshing..." : "Refresh"}
                    </button>
                    <button
                      className={`button ai-control-panel__button ${
                        status?.enabled ? "ai-control-panel__button--danger" : "ai-control-panel__button--primary"
                      }`.trim()}
                      onClick={() => void handleToggle(clinic, !status?.enabled)}
                      disabled={!canToggle}
                    >
                      {busy === "save"
                        ? "Saving..."
                        : isEnvironmentManaged
                          ? "Managed by env"
                          : status?.enabled
                            ? "Disable"
                            : "Enable"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
