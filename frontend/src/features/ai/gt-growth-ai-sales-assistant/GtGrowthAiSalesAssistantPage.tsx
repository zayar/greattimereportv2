import { useCallback, useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import {
  generateSalesAssistantActions,
  getSalesAssistantActions,
  sendSalesAssistantTasks,
  updateSalesAssistantActionStatus,
} from "../../../api/gtGrowthAi";
import type {
  GtGrowthAiSalesAction,
  GtGrowthAiSalesActionStatus,
  GtGrowthAiSalesActionUpdateStatus,
  GtGrowthAiSalesAssistantResponse,
} from "../../../types/domain";
import { useAccess } from "../../access/AccessProvider";

const STATUS_OPTIONS: GtGrowthAiSalesActionUpdateStatus[] = [
  "contacted",
  "replied",
  "booked",
  "purchased",
  "skipped",
  "closed",
];

function getApiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    const apiMessage = typeof error.response?.data?.error === "string" ? error.response.data.error : null;
    return apiMessage || error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function formatMoney(value: number | undefined, label?: string) {
  if (value != null && value > 0) {
    return `${Math.round(value).toLocaleString("en-US")} MMK`;
  }

  return label || "Not estimated";
}

function formatActionType(type: GtGrowthAiSalesAction["actionType"]) {
  switch (type) {
    case "rebooking_opportunity":
      return "Rebooking";
    case "package_usage_follow_up":
      return "Package follow-up";
    case "package_upsell_opportunity":
      return "Package upsell";
    case "inactive_vip_follow_up":
      return "VIP follow-up";
    default:
      return "Payment follow-up";
  }
}

function formatStatus(status: GtGrowthAiSalesActionStatus) {
  return status.replace(/_/g, " ");
}

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

export function GtGrowthAiSalesAssistantPage() {
  const { currentClinic } = useAccess();
  const clinic = currentClinic;
  const [dateKey, setDateKey] = useState(todayDateKey());
  const [data, setData] = useState<GtGrowthAiSalesAssistantResponse | null>(null);
  const [busyAction, setBusyAction] = useState<"load" | "generate" | "send" | "status" | null>("load");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const actions = data?.actions ?? [];
  const summary = data?.summary ?? null;
  const isLocked = data?.premium?.enabled === false;

  const loadActions = useCallback(
    async (showLoader = true) => {
      if (!clinic) {
        setData(null);
        setBusyAction(null);
        return;
      }

      if (showLoader) {
        setBusyAction("load");
      }
      setErrorMessage(null);

      try {
        const nextData = await getSalesAssistantActions({
          clinicId: clinic.id,
          clinicCode: clinic.code,
          clinicName: clinic.name,
          dateKey,
        });
        setData(nextData);
      } catch (error) {
        setErrorMessage(getApiErrorMessage(error, "GT Growth AI Sales Assistant could not be loaded."));
      } finally {
        setBusyAction((current) => (current === "load" ? null : current));
      }
    },
    [clinic, dateKey],
  );

  useEffect(() => {
    void loadActions(true);
  }, [loadActions]);

  const counts = useMemo(
    () => [
      { label: "Total actions", value: summary?.totalActions ?? 0 },
      { label: "High priority", value: summary?.highPriorityCount ?? 0 },
      { label: "Rebooking", value: summary?.rebookingCount ?? 0 },
      { label: "Package tasks", value: (summary?.packageUsageCount ?? 0) + (summary?.packageUpsellCount ?? 0) },
      { label: "VIP recovery", value: summary?.inactiveVipCount ?? 0 },
      { label: "Payment follow-up", value: summary?.paymentFollowUpCount ?? 0 },
    ],
    [summary],
  );

  async function handleGenerate(forceRefresh = false) {
    if (!clinic) {
      return;
    }

    setBusyAction("generate");
    setNotice(null);
    setErrorMessage(null);

    try {
      const nextData = await generateSalesAssistantActions({
        clinicId: clinic.id,
        clinicCode: clinic.code,
        clinicName: clinic.name,
        dateKey,
        forceRefresh,
      });
      setData(nextData);
      setNotice(`Generated ${nextData.generatedCount ?? nextData.summary?.totalActions ?? 0} sales actions.`);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Sales actions could not be generated."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSend() {
    if (!clinic) {
      return;
    }

    setBusyAction("send");
    setNotice(null);
    setErrorMessage(null);

    try {
      const result = await sendSalesAssistantTasks({
        clinicId: clinic.id,
        clinicCode: clinic.code,
        clinicName: clinic.name,
        dateKey,
        targetPurpose: "sales_lead",
      });
      setNotice(
        `Sent ${result.actionCount} Sales Assistant tasks to ${result.salesTargetLabel}. Owner summary ${
          result.sentOwnerSummary ? `sent to ${result.ownerTargetLabel ?? "owner target"}` : "not sent"
        }.`,
      );
      await loadActions(false);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Sales Assistant task list could not be sent."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleStatus(action: GtGrowthAiSalesAction, status: GtGrowthAiSalesActionUpdateStatus) {
    if (!clinic) {
      return;
    }

    setBusyAction("status");
    setNotice(null);
    setErrorMessage(null);

    try {
      const updated = await updateSalesAssistantActionStatus(action.id, {
        clinicId: clinic.id,
        status,
      });
      setData((current) =>
        current
          ? {
              ...current,
              actions: (current.actions ?? []).map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      );
      setNotice(`${action.customer?.customerName ?? action.title} marked ${formatStatus(status)}.`);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Task status could not be updated."));
    } finally {
      setBusyAction(null);
    }
  }

  if (!clinic) {
    return (
      <div className="page-stack page-stack--workspace analytics-report">
        <EmptyState label="No clinic selected" detail="Choose a clinic first to view GT Growth AI Sales Assistant." />
      </div>
    );
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report">
      <PageHeader
        title="GT Growth AI Sales Assistant"
        hideContext
        actions={
          <div className="telegram-settings__header-actions">
            <button
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => void loadActions(true)}
              disabled={busyAction === "load"}
            >
              Refresh
            </button>
            <button
              className="button telegram-settings__button telegram-settings__button--primary"
              onClick={() => void handleGenerate(false)}
              disabled={busyAction !== null || isLocked}
            >
              {busyAction === "generate" ? "Generating..." : "Generate actions"}
            </button>
          </div>
        }
      />

      <div className="telegram-settings__status-strip">
        <div>
          <strong>{clinic.name}</strong>
          <span>Clinic code: {clinic.code}</span>
        </div>
        {notice ? <span className="telegram-settings__notice telegram-settings__notice--success">{notice}</span> : null}
        {!notice && errorMessage ? (
          <span className="telegram-settings__notice telegram-settings__notice--danger">{errorMessage}</span>
        ) : null}
      </div>

      <Panel
        title="Sales Assistant controls"
        subtitle="Generate deterministic actions from report data, then send the task list to the Telegram sales lead target."
        action={
          <span className={`telegram-settings__badge telegram-settings__badge--${data?.premium?.enabled ? "linked" : "idle"}`}>
            {data?.premium?.enabled ? "Premium active" : "Locked"}
          </span>
        }
      >
        <div className="telegram-settings__two-up">
          <label className="field">
            <span>Action date</span>
            <input type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} />
          </label>

          <article className="telegram-settings__meta-card telegram-settings__meta-card--inline">
            <span>Estimated opportunity</span>
            <strong>{formatMoney(summary?.estimatedTotalValue, summary?.estimatedTotalValueLabel)}</strong>
            <small>Only calculated source amounts are shown. Unknown values stay labeled, not guessed.</small>
          </article>
        </div>

        {isLocked ? (
          <div className="telegram-settings__callout">
            <strong>{data?.lockedPreview?.title ?? "Unlock GT Growth AI Sales Assistant"}</strong>
            <span>
              {data?.lockedPreview?.message ??
                "GreatTime AI finds customers to rebook, package customers to follow up, VIP customers to recover, and payments to follow up."}
            </span>
            {data?.lockedPreview?.teaserBullets?.length ? (
              <ul>
                {data.lockedPreview.teaserBullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {!isLocked ? (
          <div className="telegram-settings__button-row">
            <button
              className="button telegram-settings__button telegram-settings__button--primary"
              onClick={() => void handleSend()}
              disabled={busyAction !== null}
            >
              {busyAction === "send" ? "Sending..." : "Send to sales lead"}
            </button>
            <button
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => void handleGenerate(true)}
              disabled={busyAction !== null}
            >
              Refresh source evidence
            </button>
          </div>
        ) : null}
      </Panel>

      {errorMessage && !data && busyAction !== "load" ? (
        <ErrorState label="Sales Assistant could not be loaded" detail={errorMessage} />
      ) : null}

      {!isLocked ? (
        <>
          <div className="report-kpi-strip">
            {counts.map((item) => (
              <article key={item.label} className="report-kpi-strip__card">
                <span className="report-kpi-strip__label">{item.label}</span>
                <strong className="report-kpi-strip__value">{item.value.toLocaleString("en-US")}</strong>
              </article>
            ))}
          </div>

          <Panel title="Action queue" subtitle="Customer details are shown only after backend premium access is confirmed.">
            {busyAction === "load" && !data ? <div className="inline-note inline-note--loading">Loading actions...</div> : null}
            {actions.length === 0 ? (
              <EmptyState
                label="No sales actions yet"
                detail="Generate actions to build today's rebooking, package, VIP, and payment follow-up queue."
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Priority</th>
                      <th>Customer</th>
                      <th>Action</th>
                      <th>Evidence</th>
                      <th>Value</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actions.map((action) => (
                      <tr key={action.id}>
                        <td>
                          <span className={`status-pill status-pill--${action.priority}`}>{action.priority}</span>
                          <small>Score {action.priorityScore}</small>
                        </td>
                        <td>
                          <strong>{action.customer?.customerName ?? "Customer"}</strong>
                          <small>{action.customer?.phoneMasked ?? action.customer?.memberId ?? "Masked details"}</small>
                        </td>
                        <td>
                          <strong>{formatActionType(action.actionType)}</strong>
                          <span>{action.recommendedAction}</span>
                          {action.suggestedMessage?.text ? <small>{action.suggestedMessage.text}</small> : null}
                        </td>
                        <td>
                          {action.evidence.slice(0, 3).map((item) => (
                            <small key={`${action.id}-${item.label}`}>
                              {item.label}: {item.value}
                              {item.comparison ? ` (${item.comparison})` : ""}
                            </small>
                          ))}
                        </td>
                        <td>{formatMoney(action.estimatedValue, action.estimatedValueLabel)}</td>
                        <td>
                          <label className="field">
                            <span>{formatStatus(action.status)}</span>
                            <select
                              value={action.status}
                              onChange={(event) =>
                                void handleStatus(action, event.target.value as GtGrowthAiSalesActionUpdateStatus)
                              }
                              disabled={busyAction !== null}
                            >
                              {action.status === "new" || action.status === "assigned" ? (
                                <option value={action.status}>{formatStatus(action.status)}</option>
                              ) : null}
                              {STATUS_OPTIONS.map((status) => (
                                <option key={status} value={status}>
                                  {formatStatus(status)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
