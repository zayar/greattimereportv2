import { useState } from "react";
import { isAxiosError } from "axios";
import {
  recordAiRevenue,
  syncAiRevenue,
} from "../../../../api/aiRevenueAgent";
import { EmptyState } from "../../../../components/StatusViews";
import type {
  AiRevenueAction,
  AiRevenueAttributionType,
  AiRevenueSummary,
} from "../../../../types/domain";

type Props = {
  clinicId: string;
  clinicCode: string;
  actions: AiRevenueAction[];
  summary: AiRevenueSummary | null;
  loading: boolean;
  onWorkflowChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
  onOpenAction: (action: AiRevenueAction) => void;
};

type RevenueDraft = {
  actualRevenue: string;
  influencedRevenue: string;
  packageSessionsRecovered: string;
  orderId: string;
  invoiceNumber: string;
  attributionType: AiRevenueAttributionType;
  revenueNote: string;
};

const REVENUE_CANDIDATE_STATUSES = new Set([
  "sent",
  "customer_replied",
  "appointment_requested",
  "appointment_created",
  "appointment_confirmed",
  "reminder_sent",
  "customer_came",
  "completed",
  "revenue_attributed",
]);

function getApiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    const apiMessage = typeof error.response?.data?.error === "string" ? error.response.data.error : null;
    return apiMessage || error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function formatMoney(value: number | null | undefined) {
  return `${Math.round(value ?? 0).toLocaleString("en-US")} MMK`;
}

function formatNumber(value: number | null | undefined) {
  return Math.round(value ?? 0).toLocaleString("en-US");
}

function titleCase(value: string | null | undefined) {
  return (value || "not set")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function revenueTotal(action: AiRevenueAction) {
  return Number(action.revenue.actualRevenue ?? 0) + Number(action.revenue.influencedRevenue ?? 0);
}

function hasAnyRevenue(action: AiRevenueAction) {
  return revenueTotal(action) > 0 || Number(action.revenue.packageSessionsRecovered ?? 0) > 0;
}

function contactLabel(action: AiRevenueAction) {
  return action.customer.phoneNumber || action.customer.phoneMasked || action.customer.memberId || "No contact detail";
}

function defaultDraft(action: AiRevenueAction): RevenueDraft {
  return {
    actualRevenue: action.revenue.actualRevenue ? String(action.revenue.actualRevenue) : "",
    influencedRevenue: action.revenue.influencedRevenue ? String(action.revenue.influencedRevenue) : "",
    packageSessionsRecovered: action.revenue.packageSessionsRecovered ? String(action.revenue.packageSessionsRecovered) : "",
    orderId: action.revenue.orderId ?? "",
    invoiceNumber: action.revenue.invoiceNumber ?? "",
    attributionType: action.revenue.attributionType ?? "manual",
    revenueNote: action.revenue.revenueNote ?? "",
  };
}

function parseDraftNumber(value: string) {
  if (!value.trim()) {
    return 0;
  }
  return Math.max(0, Number(value));
}

function statusLine(action: AiRevenueAction) {
  const attribution = action.revenue.attributionType ? titleCase(action.revenue.attributionType) : "Not attributed";
  const invoice = action.revenue.invoiceNumber ? ` · Invoice ${action.revenue.invoiceNumber}` : "";
  return `${attribution}${invoice}`;
}

export function AiRevenueRevenueTab({
  clinicId,
  clinicCode,
  actions,
  summary,
  loading,
  onWorkflowChanged,
  onError,
  onOpenAction,
}: Props) {
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RevenueDraft>>({});
  const candidateActions = actions.filter((action) => REVENUE_CANDIDATE_STATUSES.has(action.status));
  const topRevenueActions = [...actions]
    .filter(hasAnyRevenue)
    .sort((left, right) => {
      const cashDelta = revenueTotal(right) - revenueTotal(left);
      if (cashDelta !== 0) {
        return cashDelta;
      }
      return Number(right.revenue.packageSessionsRecovered ?? 0) - Number(left.revenue.packageSessionsRecovered ?? 0);
    })
    .slice(0, 5);
  const customersWithRevenue = actions.filter((action) => revenueTotal(action) > 0);
  const cameWithoutPayment = actions.filter(
    (action) =>
      ["customer_came", "completed"].includes(action.status) &&
      revenueTotal(action) === 0 &&
      Number(action.revenue.packageSessionsRecovered ?? 0) === 0,
  );
  const packageOnlyRecoveries = actions.filter(
    (action) => revenueTotal(action) === 0 && Number(action.revenue.packageSessionsRecovered ?? 0) > 0,
  );

  function draftFor(action: AiRevenueAction) {
    return drafts[action.id] ?? defaultDraft(action);
  }

  function updateDraft(action: AiRevenueAction, patch: Partial<RevenueDraft>) {
    setDrafts((current) => ({
      ...current,
      [action.id]: {
        ...draftFor(action),
        ...patch,
      },
    }));
  }

  async function runRevenueWorkflow(action: AiRevenueAction, work: () => Promise<string>) {
    setBusyActionId(action.id);
    onError("");

    try {
      const message = await work();
      await onWorkflowChanged(message);
    } catch (error) {
      onError(getApiErrorMessage(error, "Revenue attribution could not be updated."));
    } finally {
      setBusyActionId(null);
    }
  }

  if (loading && actions.length === 0) {
    return <div className="inline-note inline-note--loading">Loading revenue attribution...</div>;
  }

  if (actions.length === 0) {
    return (
      <EmptyState
        label="No AI Revenue actions yet"
        detail="Generate opportunities first, then approve messages and track appointments before recording revenue."
      />
    );
  }

  return (
    <div className="ai-revenue-action-list">
      <div className="ai-revenue-conversion-grid">
        <div className="ai-revenue-conversion-card">
          <span>AI-generated revenue</span>
          <strong>{formatMoney(summary?.aiGeneratedRevenue)}</strong>
        </div>
        <div className="ai-revenue-conversion-card">
          <span>AI-influenced revenue</span>
          <strong>{formatMoney(summary?.aiInfluencedRevenue)}</strong>
        </div>
        <div className="ai-revenue-conversion-card">
          <span>Package sessions recovered</span>
          <strong>{formatNumber(summary?.packageSessionsRecovered)}</strong>
        </div>
        <div className="ai-revenue-conversion-card">
          <span>Revenue per message</span>
          <strong>
            {formatMoney((summary?.messagesSent ?? 0) > 0 ? (summary?.aiGeneratedRevenue ?? 0) / (summary?.messagesSent ?? 1) : 0)}
          </strong>
        </div>
        <div className="ai-revenue-conversion-card">
          <span>Revenue per appointment</span>
          <strong>
            {formatMoney(
              (summary?.appointmentsCreated ?? 0) > 0
                ? (summary?.aiGeneratedRevenue ?? 0) / (summary?.appointmentsCreated ?? 1)
                : 0,
            )}
          </strong>
        </div>
      </div>

      <div className="ai-revenue-evidence-grid">
        <div className="ai-revenue-evidence-item">
          <span>Top revenue actions</span>
          <strong>{topRevenueActions.length}</strong>
        </div>
        <div className="ai-revenue-evidence-item">
          <span>Customers who generated revenue</span>
          <strong>{customersWithRevenue.length}</strong>
        </div>
        <div className="ai-revenue-evidence-item">
          <span>Came but no payment yet</span>
          <strong>{cameWithoutPayment.length}</strong>
        </div>
        <div className="ai-revenue-evidence-item">
          <span>Package-only recoveries</span>
          <strong>{packageOnlyRecoveries.length}</strong>
        </div>
      </div>

      <section className="ai-revenue-detail__section">
        <strong>Top revenue actions</strong>
        {topRevenueActions.length === 0 ? (
          <p>No revenue has been attributed yet.</p>
        ) : (
          <div className="ai-revenue-action-list">
            {topRevenueActions.map((action) => (
              <article key={`top-${action.id}`} className="ai-revenue-action-card ai-revenue-action-card--compact">
                <div className="ai-revenue-action-card__main">
                  <div>
                    <h3>{action.customer.customerName ?? action.title}</h3>
                    <span>{statusLine(action)}</span>
                  </div>
                  <strong>{formatMoney(revenueTotal(action))}</strong>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {cameWithoutPayment.length > 0 ? (
        <div className="telegram-settings__callout ai-revenue-mode-note">
          <strong>Customers came but no payment yet</strong>
          <span>
            {cameWithoutPayment
              .slice(0, 5)
              .map((action) => action.customer.customerName ?? action.title)
              .join(", ")}
          </span>
        </div>
      ) : null}

      {packageOnlyRecoveries.length > 0 ? (
        <div className="telegram-settings__callout ai-revenue-mode-note">
          <strong>Package-only recovered sessions</strong>
          <span>
            These are counted separately from cash revenue:{" "}
            {packageOnlyRecoveries
              .slice(0, 5)
              .map((action) => `${action.customer.customerName ?? action.title} (${formatNumber(action.revenue.packageSessionsRecovered)})`)
              .join(", ")}
          </span>
        </div>
      ) : null}

      <section className="ai-revenue-detail__section">
        <strong>Revenue attribution workbench</strong>
        <p>Sync tries exact booking/payment first, then same-customer payment window, then package session recovery. Manual entry remains available for MVP.</p>
      </section>

      {candidateActions.map((action) => {
        const draft = draftFor(action);
        const busy = busyActionId === action.id;

        return (
          <article key={action.id} className="ai-revenue-action-card ai-revenue-appointment-card">
            <div className="ai-revenue-action-card__top">
              <div>
                <span className={`status-pill status-pill--${action.priority}`}>{action.priority}</span>
                <span className="ai-revenue-action-card__source">{titleCase(action.status)}</span>
              </div>
              <strong>{statusLine(action)}</strong>
            </div>

            <div className="ai-revenue-action-card__main">
              <div>
                <h3>{action.customer.customerName ?? action.title}</h3>
                <span>{contactLabel(action)}</span>
              </div>
              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--secondary"
                onClick={() => onOpenAction(action)}
              >
                Open Action Detail
              </button>
            </div>

            <div className="ai-revenue-evidence-grid">
              <div className="ai-revenue-evidence-item">
                <span>Generated revenue</span>
                <strong>{formatMoney(action.revenue.actualRevenue)}</strong>
              </div>
              <div className="ai-revenue-evidence-item">
                <span>Influenced revenue</span>
                <strong>{formatMoney(action.revenue.influencedRevenue)}</strong>
              </div>
              <div className="ai-revenue-evidence-item">
                <span>Package sessions</span>
                <strong>{formatNumber(action.revenue.packageSessionsRecovered)}</strong>
              </div>
              <div className="ai-revenue-evidence-item">
                <span>Revenue date</span>
                <strong>{action.revenue.revenueAt ?? "Not recorded"}</strong>
              </div>
            </div>

            {action.revenue.revenueNote ? (
              <div className="ai-revenue-message-box">
                <div>
                  <strong>Revenue note</strong>
                  <span>{titleCase(action.revenue.attributionType)}</span>
                </div>
                <p>{action.revenue.revenueNote}</p>
              </div>
            ) : null}

            <div className="ai-revenue-appointment-form">
              <label className="field">
                <span>Generated cash revenue</span>
                <input
                  type="number"
                  min="0"
                  value={draft.actualRevenue}
                  onChange={(event) => updateDraft(action, { actualRevenue: event.target.value })}
                  placeholder="0"
                />
              </label>
              <label className="field">
                <span>Influenced revenue</span>
                <input
                  type="number"
                  min="0"
                  value={draft.influencedRevenue}
                  onChange={(event) => updateDraft(action, { influencedRevenue: event.target.value })}
                  placeholder="0"
                />
              </label>
              <label className="field">
                <span>Package sessions used</span>
                <input
                  type="number"
                  min="0"
                  value={draft.packageSessionsRecovered}
                  onChange={(event) => updateDraft(action, { packageSessionsRecovered: event.target.value })}
                  placeholder="0"
                />
              </label>
              <label className="field">
                <span>Attribution type</span>
                <select
                  value={draft.attributionType}
                  onChange={(event) => updateDraft(action, { attributionType: event.target.value as AiRevenueAttributionType })}
                >
                  <option value="manual">Manual</option>
                  <option value="exact_booking">Exact booking</option>
                  <option value="same_customer_window">Same customer window</option>
                  <option value="package_recovery">Package recovery</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label className="field">
                <span>Order ID</span>
                <input
                  type="text"
                  value={draft.orderId}
                  onChange={(event) => updateDraft(action, { orderId: event.target.value })}
                  placeholder="Optional"
                />
              </label>
              <label className="field">
                <span>Invoice number</span>
                <input
                  type="text"
                  value={draft.invoiceNumber}
                  onChange={(event) => updateDraft(action, { invoiceNumber: event.target.value })}
                  placeholder="Optional"
                />
              </label>
              <label className="field ai-revenue-appointment-form__wide">
                <span>Revenue note</span>
                <textarea
                  className="telegram-settings__textarea"
                  rows={2}
                  maxLength={1200}
                  value={draft.revenueNote}
                  onChange={(event) => updateDraft(action, { revenueNote: event.target.value })}
                  placeholder="Checkout note, package-only recovery reason, or staff confirmation"
                />
              </label>
            </div>

            <div className="ai-revenue-action-card__footer ai-revenue-approval-card__actions">
              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--primary"
                onClick={() =>
                  void runRevenueWorkflow(action, async () => {
                    await recordAiRevenue(action.id, {
                      clinicId,
                      actualRevenue: parseDraftNumber(draft.actualRevenue),
                      influencedRevenue: parseDraftNumber(draft.influencedRevenue),
                      packageSessionsRecovered: parseDraftNumber(draft.packageSessionsRecovered),
                      orderId: draft.orderId || null,
                      invoiceNumber: draft.invoiceNumber || null,
                      attributionType: draft.attributionType,
                      revenueNote: draft.revenueNote || null,
                    });
                    return `Revenue recorded for ${action.customer.customerName ?? action.title}.`;
                  })
                }
                disabled={busy}
              >
                Record Manual Revenue
              </button>

              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--secondary"
                onClick={() =>
                  void runRevenueWorkflow(action, async () => {
                    await syncAiRevenue(action.id, {
                      clinicId,
                      clinicCode,
                      attributionWindowDays: 14,
                    });
                    return `Revenue sync completed for ${action.customer.customerName ?? action.title}.`;
                  })
                }
                disabled={busy}
              >
                Sync Revenue
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
