import { useCallback, useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { PageHeader } from "../../../../components/PageHeader";
import { Panel } from "../../../../components/Panel";
import { EmptyState, ErrorState } from "../../../../components/StatusViews";
import { CustomerUsageHeatmap } from "../../../../components/CustomerUsageHeatmap";
import { fetchCustomerPortalPackages, fetchCustomerPortalUsage } from "../../../../api/analytics";
import {
  approveAiRevenueMessage,
  generateAiRevenueActions,
  generateAiRevenueMessage,
  getAiRevenueAuditLogs,
  getAiRevenueActions,
  getAiRevenueFollowUpAttempts,
  getAiRevenueOutcomeLinks,
  getAiRevenueSummary,
  markAiRevenueMessageSent,
  type AiRevenueActionQuery,
  type AiRevenueSummaryQuery,
} from "../../../../api/aiRevenueAgent";
import type {
  AiRevenueAction,
  AiRevenueAuditLog,
  AiRevenueActionSource,
  AiRevenueActionStatus,
  AiRevenueActionType,
  AiRevenuePriority,
  AiRevenueContactAttempt,
  AiRevenueContactChannel,
  AiRevenueContactResult,
  AiRevenueOutcomeLink,
  AiRevenueOutcomeType,
  AiRevenueServiceUsageSnapshot,
  AiRevenueSummary,
  CustomerPortalPackagesResponse,
  CustomerPortalUsageResponse,
} from "../../../../types/domain";
import { useAccess } from "../../../access/AccessProvider";
import { AiRevenueAuditTab } from "./AiRevenueAuditTab";
import { AiRevenueAppointmentsTab } from "./AiRevenueAppointmentsTab";
import { AiRevenueConversationTab } from "./AiRevenueConversationTab";
import { AiRevenueDashboardTab } from "./AiRevenueDashboardTab";
import { AiStaffFollowUpSnapshot, isSameCustomerAction } from "./AiRevenueFollowUpInsights";
import { AiRevenueFollowUpAttemptModal, AiRevenueFollowUpTab } from "./AiRevenueFollowUpTab";
import { AiRevenueOpportunitiesTab } from "./AiRevenueOpportunitiesTab";
import { AiRevenueRevenueTab } from "./AiRevenueRevenueTab";
import { AiRevenueTimeline } from "./AiRevenueTimeline";

type RevenueAgentTab =
  | "dashboard"
  | "opportunities"
  | "follow_up"
  | "conversations"
  | "appointments"
  | "revenue"
  | "audit_log"
  | "settings";

type FilterState = {
  dateKey: string;
  source: "" | AiRevenueActionSource;
  actionType: "" | AiRevenueActionType;
  status: "" | AiRevenueActionStatus;
  priority: "" | AiRevenuePriority;
};

type DetailFollowUpModalState = {
  channel: AiRevenueContactChannel;
  result?: AiRevenueContactResult;
  scheduleOption?: "none" | "tomorrow" | "three_days" | "one_week" | "next_month" | "custom";
};

const TABS: Array<{ value: RevenueAgentTab; label: string; detail: string }> = [
  {
    value: "dashboard",
    label: "Dashboard",
    detail: "Revenue funnel, conversion rates, generated revenue, influenced revenue, and recovered package sessions.",
  },
  {
    value: "opportunities",
    label: "Opportunities",
    detail: "Customer follow-up recommendations with reason, purchase context, remaining balance, and chance-to-return score.",
  },
  {
    value: "follow_up",
    label: "Follow Up",
    detail: "AI finds customers to follow up. Staff can call, send manual Viber, record result, schedule next follow-up, or close.",
  },
  {
    value: "conversations",
    label: "Conversations",
    detail: "Customer replies, detected intent, and next staff action.",
  },
  {
    value: "appointments",
    label: "Appointments",
    detail: "AI-assisted bookings, reminders, came/cancelled/no-show outcomes, and completed visits.",
  },
  {
    value: "revenue",
    label: "Revenue",
    detail: "Checkout/order/payment attribution and package session recovery tracking.",
  },
  {
    value: "audit_log",
    label: "Audit Log",
    detail: "Transparent event history for AI, staff, customer, and system actions.",
  },
  {
    value: "settings",
    label: "Settings",
    detail: "Agent rules, approval policy, messaging provider mode, attribution windows, and source configuration.",
  },
];

const SOURCE_OPTIONS: Array<{ value: AiRevenueActionSource; label: string }> = [
  { value: "bigquery", label: "BigQuery" },
  { value: "apicore", label: "APICORE" },
  { value: "firestore", label: "Firestore" },
  { value: "service_reminder", label: "Service reminder" },
  { value: "package_portal", label: "Package portal" },
  { value: "appointment_report", label: "Appointment report" },
  { value: "payment_report", label: "Payment report" },
  { value: "manual", label: "Manual" },
];

const ACTION_TYPE_OPTIONS: Array<{ value: AiRevenueActionType; label: string }> = [
  { value: "service_reminder_follow_up", label: "Service reminder follow-up" },
  { value: "service_reminder_overdue", label: "Service reminder overdue" },
  { value: "unused_package_follow_up", label: "Unused package follow-up" },
  { value: "appointment_confirmation_reminder", label: "Appointment reminder" },
  { value: "no_show_recovery", label: "No-show recovery" },
  { value: "cancelled_appointment_recovery", label: "Cancelled recovery" },
  { value: "inactive_vip_recovery", label: "Inactive VIP recovery" },
  { value: "birthday_follow_up", label: "Birthday follow-up" },
  { value: "package_upsell_opportunity", label: "Package upsell" },
  { value: "payment_follow_up", label: "Payment follow-up" },
];

const STATUS_OPTIONS: Array<{ value: AiRevenueActionStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "draft_ready", label: "Draft ready" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
  { value: "customer_replied", label: "Customer replied" },
  { value: "appointment_requested", label: "Appointment requested" },
  { value: "appointment_created", label: "Appointment created" },
  { value: "appointment_confirmed", label: "Appointment confirmed" },
  { value: "reminder_sent", label: "Reminder sent" },
  { value: "customer_came", label: "Customer came" },
  { value: "completed", label: "Completed" },
  { value: "revenue_attributed", label: "Revenue attributed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No-show" },
  { value: "not_interested", label: "Not interested" },
  { value: "human_takeover", label: "Human takeover" },
  { value: "skipped", label: "Skipped" },
  { value: "closed", label: "Closed" },
];

const PRIORITY_OPTIONS: Array<{ value: AiRevenuePriority; label: string }> = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

function todayDateKey() {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    const apiMessage = typeof error.response?.data?.error === "string" ? error.response.data.error : null;
    return apiMessage || error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function titleForTab(tab: RevenueAgentTab) {
  return TABS.find((item) => item.value === tab)?.label ?? "Dashboard";
}

function detailForTab(tab: RevenueAgentTab) {
  return TABS.find((item) => item.value === tab)?.detail ?? "";
}

function buildActionParams(clinicId: string, filters: FilterState): AiRevenueActionQuery {
  return {
    clinicId,
    dateKey: filters.dateKey,
    source: filters.source || undefined,
    actionType: filters.actionType || undefined,
    status: filters.status || undefined,
    priority: filters.priority || undefined,
    limit: 100,
    includeResolved: Boolean(filters.status),
  };
}

function buildSummaryParams(clinicId: string, filters: FilterState): AiRevenueSummaryQuery {
  return {
    clinicId,
    startDateKey: filters.dateKey,
    endDateKey: filters.dateKey,
    source: filters.source || undefined,
    actionType: filters.actionType || undefined,
    status: filters.status || undefined,
    priority: filters.priority || undefined,
  };
}

function formatLabel(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "Not set";
}

function formatNumber(value: number | null | undefined) {
  return Math.round(value ?? 0).toLocaleString("en-US");
}

function formatMoney(value: number | null | undefined) {
  return `${Math.round(value ?? 0).toLocaleString("en-US")} MMK`;
}

function actorName(actor: { name?: string | null; email?: string | null; userId?: string | null } | null | undefined) {
  return actor?.name || actor?.email || actor?.userId || "Not recorded";
}

function attemptActorName(attempt: AiRevenueContactAttempt) {
  return attempt.agentName || actorName(attempt.createdBy);
}

function formatDateTime(value: string | null | undefined) {
  return value ? value.replace("T", " ").slice(0, 16) : "Not set";
}

const OUTCOME_TYPES: Array<{ type: AiRevenueOutcomeType; label: string }> = [
  { type: "appointment_booked", label: "Appointment booked" },
  { type: "customer_came", label: "Customer came" },
  { type: "treatment_completed", label: "Treatment completed" },
  { type: "package_session_used", label: "Package session used" },
  { type: "repurchase", label: "Repurchase" },
  { type: "revenue_attributed", label: "Revenue attributed" },
];

function outcomePrimaryDetail(outcomeLink: AiRevenueOutcomeLink) {
  const details = [
    outcomeLink.bookingId ? `Booking ${outcomeLink.bookingId}` : null,
    outcomeLink.treatmentId ? `Treatment ${outcomeLink.treatmentId}` : null,
    outcomeLink.invoiceNumber ? `Invoice ${outcomeLink.invoiceNumber}` : null,
    outcomeLink.orderId ? `Order ${outcomeLink.orderId}` : null,
    outcomeLink.serviceName ? outcomeLink.serviceName : null,
  ].filter(Boolean);

  return details.length > 0 ? details.join(" · ") : "No external source record linked yet";
}

function outcomeMetricDetail(outcomeLink: AiRevenueOutcomeLink) {
  const details = [
    outcomeLink.revenueAmount != null ? formatMoney(outcomeLink.revenueAmount) : null,
    outcomeLink.packageSessionsRecovered != null
      ? `${formatNumber(outcomeLink.packageSessionsRecovered)} package sessions`
      : null,
    formatLabel(outcomeLink.attributionType),
  ].filter(Boolean);

  return details.join(" · ");
}

function isWorkflowLocked(action: AiRevenueAction) {
  return Boolean(action.resolution || ["closed", "skipped", "sent"].includes(action.status));
}

function areStaffActionsLocked(action: AiRevenueAction) {
  return Boolean(action.resolution || ["closed", "skipped"].includes(action.status));
}

function messageDraftText(action: AiRevenueAction) {
  return action.message.approvedText ?? action.message.draftText ?? "";
}

async function copyMessageText(text: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function yearFromDateText(value: string | null | undefined) {
  const match = value?.match(/^(\d{4})-/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

function defaultUsageYear(action: AiRevenueAction) {
  const focusUsage = action.serviceUsage?.find((item) => item.isFocusService) ?? action.serviceUsage?.[0];
  const year =
    yearFromDateText(focusUsage?.latestUsageDate) ??
    yearFromDateText(action.service.lastVisitDate) ??
    yearFromDateText(action.packageInfo.lastUsedAt) ??
    yearFromDateText(action.dateKey);

  return year ?? new Date().getFullYear();
}

function usageYearOptions(defaultYear: number) {
  const currentYear = new Date().getFullYear();
  const newestYear = Math.max(currentYear, defaultYear);
  const years = new Set(Array.from({ length: 6 }, (_, index) => newestYear - index));
  years.add(defaultYear);
  return [...years].sort((left, right) => right - left);
}

function customerUsageIdentity(action: AiRevenueAction) {
  return {
    name: action.customer.customerName ?? "",
    phone: action.customer.phoneNumber ?? action.customer.phoneMasked ?? "",
  };
}

function customerPackageServiceUsage(
  packages: CustomerPortalPackagesResponse["packages"] | null | undefined,
  action: AiRevenueAction,
): AiRevenueServiceUsageSnapshot[] {
  const focusName = action.service.serviceName || action.packageInfo.packageName || "";

  return (packages ?? []).map((item) => ({
    serviceId: null,
    serviceName: item.serviceName || item.packageName || "Package balance",
    packageId: item.id,
    packageName: item.packageName,
    packageTotal: item.packageTotal,
    used: item.usedCount,
    remaining: item.remainingCount,
    latestUsageDate: item.latestUsageDate,
    latestTherapist: item.latestTherapist,
    status:
      item.remainingCount <= 0
        ? "completed"
        : item.remainingCount <= 3 || item.status.toLowerCase().includes("low")
          ? "low_remaining"
          : "active",
    isFocusService:
      Boolean(focusName) &&
      (item.serviceName.toLowerCase() === focusName.toLowerCase() ||
        item.serviceName.toLowerCase().includes(focusName.toLowerCase()) ||
        focusName.toLowerCase().includes(item.serviceName.toLowerCase())),
    note: item.serviceCategory || item.status || null,
  }));
}

function AiRevenueServiceUsageOverTime({
  action,
  clinicId,
  clinicCode,
}: {
  action: AiRevenueAction;
  clinicId: string;
  clinicCode: string;
}) {
  const initialYear = defaultUsageYear(action);
  const [usageYear, setUsageYear] = useState(initialYear);
  const [usageCategory, setUsageCategory] = useState("");
  const [usageState, setUsageState] = useState<{
    data: CustomerPortalUsageResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });
  const identity = customerUsageIdentity(action);
  const canLoadUsage = Boolean(identity.name || identity.phone);
  const categoryOptions = usageState.data?.categories ?? [];

  useEffect(() => {
    setUsageYear(initialYear);
    setUsageCategory("");
  }, [action.id, initialYear]);

  useEffect(() => {
    if (!canLoadUsage) {
      setUsageState({
        data: null,
        loading: false,
        error: null,
      });
      return;
    }

    let active = true;
    setUsageState((current) => ({ ...current, loading: true, error: null }));

    fetchCustomerPortalUsage({
      clinicId,
      clinicCode,
      fromDate: `${usageYear}-01-01`,
      toDate: `${usageYear}-12-31`,
      customerName: identity.name,
      customerPhone: identity.phone,
      year: usageYear,
      serviceCategory: usageCategory,
    })
      .then((data) => {
        if (active) {
          setUsageState({ data, loading: false, error: null });
        }
      })
      .catch((error) => {
        if (active) {
          setUsageState({
            data: null,
            loading: false,
            error: getApiErrorMessage(error, "Service usage history could not be loaded."),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [canLoadUsage, clinicCode, clinicId, identity.name, identity.phone, usageCategory, usageYear]);

  return (
    <div className="ai-revenue-detail__section ai-revenue-usage-over-time">
      <div className="ai-revenue-usage-over-time__header">
        <div>
          <strong>Service usage over time</strong>
          <p>A month-by-month heat map of this customer's treatment pattern.</p>
        </div>
        <div className="customer-detail__table-tools">
          <label className="field field--compact">
            <span>Year</span>
            <select value={usageYear} onChange={(event) => setUsageYear(Number(event.target.value))}>
              {usageYearOptions(initialYear).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--compact">
            <span>Category</span>
            <select value={usageCategory} onChange={(event) => setUsageCategory(event.target.value)}>
              <option value="">All categories</option>
              {usageCategory && !categoryOptions.includes(usageCategory) ? <option value={usageCategory}>{usageCategory}</option> : null}
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {!canLoadUsage ? (
        <EmptyState label="No customer usage identity" detail="This action does not have enough customer identity to load usage history." />
      ) : usageState.loading ? (
        <div className="inline-note inline-note--loading">Loading usage heat map...</div>
      ) : usageState.error ? (
        <ErrorState label="Usage history could not be loaded" detail={usageState.error} />
      ) : usageState.data ? (
        <CustomerUsageHeatmap data={usageState.data} />
      ) : null}
    </div>
  );
}

function ActionDetailPanel({
  action,
  actions,
  clinicId,
  clinicCode,
  onWorkflowChanged,
  onError,
  onDraftMessage,
  draftingActionId,
  onActionUpdated,
  onClose,
}: {
  action: AiRevenueAction;
  actions: AiRevenueAction[];
  clinicId: string;
  clinicCode: string;
  onWorkflowChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
  onDraftMessage: (action: AiRevenueAction) => Promise<void>;
  draftingActionId?: string | null;
  onActionUpdated: (action: AiRevenueAction) => void;
  onClose: () => void;
}) {
  const [auditLogs, setAuditLogs] = useState<AiRevenueAuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [followUpAttempts, setFollowUpAttempts] = useState<AiRevenueContactAttempt[]>([]);
  const [followUpLoading, setFollowUpLoading] = useState(true);
  const [outcomeLinks, setOutcomeLinks] = useState<AiRevenueOutcomeLink[]>([]);
  const [outcomeLoading, setOutcomeLoading] = useState(true);
  const [packageState, setPackageState] = useState<{
    data: CustomerPortalPackagesResponse | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });
  const [followUpModal, setFollowUpModal] = useState<DetailFollowUpModalState | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [draftEditorText, setDraftEditorText] = useState(messageDraftText(action));
  const relatedActions = actions.filter((item) => item.id !== action.id && isSameCustomerAction(item, action));
  const customerIdentity = customerUsageIdentity(action);
  const canLoadCustomerPackages = Boolean(customerIdentity.name || customerIdentity.phone);
  const supplementalServiceUsage = customerPackageServiceUsage(packageState.data?.packages, action);
  const draftText = action.message.draftText ?? action.message.approvedText ?? "";
  const approvedText = action.message.approvedText ?? "";
  const locked = isWorkflowLocked(action);
  const staffActionsLocked = areStaffActionsLocked(action);
  const draftActionBusy = draftingActionId === action.id;
  const draftButtonDisabled = busyAction !== null || draftActionBusy || (locked && !draftText.trim());
  const editedDraftText = draftEditorText.trim();
  const hasDraftEdits = editedDraftText !== draftText.trim();
  const canApproveDraft = Boolean(editedDraftText) && !approvedText && !locked;
  const canMarkSent = action.status === "approved" && approvedText.trim().length > 0;
  const outcomeCounts = OUTCOME_TYPES.map((outcomeType) => ({
    ...outcomeType,
    count: outcomeLinks.filter((outcomeLink) => outcomeLink.outcomeType === outcomeType.type).length,
  }));

  const loadFollowUpAttempts = useCallback(async () => {
    setFollowUpLoading(true);
    try {
      const attempts = await getAiRevenueFollowUpAttempts(action.id, {
        clinicId,
        limit: 100,
      });
      setFollowUpAttempts(attempts);
    } catch {
      setFollowUpAttempts([]);
    } finally {
      setFollowUpLoading(false);
    }
  }, [action.id, clinicId]);

  const loadOutcomeLinks = useCallback(async () => {
    setOutcomeLoading(true);
    try {
      const links = await getAiRevenueOutcomeLinks({
        clinicId,
        actionId: action.id,
        limit: 100,
      });
      setOutcomeLinks(links);
    } catch {
      setOutcomeLinks([]);
    } finally {
      setOutcomeLoading(false);
    }
  }, [action.id, clinicId]);

  async function runDraftEditorAction(actionName: string, work: () => Promise<{ message: string; action?: AiRevenueAction }>) {
    setBusyAction(actionName);
    onError("");

    try {
      const { message, action: updatedAction } = await work();
      if (updatedAction) {
        onActionUpdated(updatedAction);
        setDraftEditorText(messageDraftText(updatedAction));
      }
      await onWorkflowChanged(message);
    } catch (error) {
      onError(getApiErrorMessage(error, "AI Revenue action could not be updated."));
    } finally {
      setBusyAction(null);
    }
  }

  function handleCopyDraft() {
    if (!editedDraftText) {
      onError("No draft message to copy.");
      return;
    }

    void copyMessageText(editedDraftText).then((copied) => {
      if (!copied) {
        onError("Draft message is ready, but the browser could not copy it automatically.");
      }
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function loadTimeline() {
      setAuditLoading(true);
      try {
        const logs = await getAiRevenueAuditLogs({
          clinicId,
          actionId: action.id,
          limit: 100,
        });
        if (!cancelled) {
          setAuditLogs(logs);
        }
      } catch {
        if (!cancelled) {
          setAuditLogs([]);
        }
      } finally {
        if (!cancelled) {
          setAuditLoading(false);
        }
      }
    }

    void loadTimeline();
    return () => {
      cancelled = true;
    };
  }, [action.id, clinicId]);

  useEffect(() => {
    void loadFollowUpAttempts();
  }, [loadFollowUpAttempts]);

  useEffect(() => {
    void loadOutcomeLinks();
  }, [loadOutcomeLinks]);

  useEffect(() => {
    if (!canLoadCustomerPackages) {
      setPackageState({ data: null, loading: false, error: null });
      return;
    }

    let active = true;
    const actionYear = Number(action.dateKey.slice(0, 4));
    const fromYear = Number.isFinite(actionYear) ? actionYear - 2 : new Date().getFullYear() - 2;

    setPackageState((current) => ({ ...current, loading: true, error: null }));

    fetchCustomerPortalPackages({
      clinicId,
      clinicCode,
      fromDate: `${fromYear}-01-01`,
      toDate: todayDateKey(),
      customerName: customerIdentity.name,
      customerPhone: customerIdentity.phone,
    })
      .then((data) => {
        if (active) {
          setPackageState({ data, loading: false, error: null });
        }
      })
      .catch((error) => {
        if (active) {
          setPackageState({
            data: null,
            loading: false,
            error: getApiErrorMessage(error, "Customer Intelligence package details could not be loaded."),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [action.dateKey, canLoadCustomerPackages, clinicCode, clinicId, customerIdentity.name, customerIdentity.phone]);

  useEffect(() => {
    setDraftEditorText(messageDraftText(action));
  }, [action.id, action.message.approvedText, action.message.draftText]);

  return (
    <Panel
      title="Action detail"
      subtitle="Why AI selected this customer, what staff approved, what happened next, and how revenue was counted."
      action={
        <button type="button" className="button telegram-settings__button telegram-settings__button--secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="ai-revenue-detail">
        <div className="ai-revenue-detail__header">
          <div>
            <h3>{action.customer.customerName ?? action.title}</h3>
            <span>{action.customer.phoneNumber || action.customer.phoneMasked || action.customer.memberId || "No contact detail"}</span>
          </div>
          <div>
            <span className={`status-pill status-pill--${action.priority}`}>{action.priority}</span>
            <strong>Score {action.priorityScore}</strong>
          </div>
        </div>

        <div className="ai-revenue-detail__quick-actions">
          <div>
            <strong>Staff follow-up actions</strong>
            <span>Record the human contact result, schedule the next touch, book, or close this customer follow-up.</span>
          </div>
          <div className="ai-revenue-action-card__controls">
            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--secondary"
              disabled={draftButtonDisabled}
              onClick={() => void onDraftMessage(action)}
            >
              {draftActionBusy ? "Drafting..." : "Draft Message"}
            </button>

            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--secondary"
              disabled={staffActionsLocked || busyAction !== null}
              onClick={() => setFollowUpModal({ channel: "phone", result: "no_answer" })}
            >
              Log Call
            </button>

            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--primary"
              disabled={staffActionsLocked || busyAction !== null}
              onClick={() => setFollowUpModal({ channel: "viber_manual", result: "message_sent" })}
            >
              Log Viber Sent
            </button>

            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--secondary"
              disabled={staffActionsLocked || busyAction !== null}
              onClick={() => setFollowUpModal({ channel: "phone", result: "call_later", scheduleOption: "tomorrow" })}
            >
              Schedule Follow-up
            </button>

            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--secondary"
              disabled={staffActionsLocked || busyAction !== null}
              onClick={() => setFollowUpModal({ channel: "phone", result: "appointment_booked" })}
            >
              Book Appointment
            </button>

            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--danger"
              disabled={staffActionsLocked || busyAction !== null}
              onClick={() => setFollowUpModal({ channel: "phone", result: "do_not_contact" })}
            >
              Close / Do Not Contact
            </button>
          </div>
        </div>

        <AiRevenueServiceUsageOverTime action={action} clinicId={clinicId} clinicCode={clinicCode} />

        <AiStaffFollowUpSnapshot
          action={action}
          relatedActions={relatedActions}
          supplementalServiceUsage={supplementalServiceUsage}
        />
        {packageState.loading ? (
          <div className="inline-note inline-note--loading">Checking Customer Intelligence package details...</div>
        ) : null}
        {packageState.error ? (
          <div className="inline-note">
            Package therapist details are using the AI snapshot because Customer Intelligence did not return package details.
          </div>
        ) : null}

        <div className="ai-revenue-detail__section ai-revenue-draft-editor">
          <div className="ai-revenue-draft-editor__header">
            <div>
              <strong>Draft message</strong>
              <span>Edit before copying, approving, or recording a manual Viber send.</span>
            </div>
            <span>{approvedText ? "Approved" : draftText ? "Draft ready" : "No draft yet"}</span>
          </div>
          <textarea
            value={draftEditorText}
            placeholder="Generate a draft or type a staff-approved message here."
            onChange={(event) => setDraftEditorText(event.target.value)}
          />
          <div className="ai-revenue-action-card__controls ai-revenue-draft-editor__actions">
            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--secondary"
              disabled={locked || busyAction !== null}
              onClick={() =>
                void runDraftEditorAction("draft", async () => {
                  const updatedAction = await generateAiRevenueMessage(action.id, { clinicId });
                  return {
                    action: updatedAction,
                    message: `Draft generated for ${action.customer.customerName ?? action.title}.`,
                  };
                })
              }
            >
              {busyAction === "draft" ? "Generating..." : "Generate Draft"}
            </button>

            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--secondary"
              disabled={!editedDraftText || !hasDraftEdits || locked || busyAction !== null}
              onClick={() =>
                void runDraftEditorAction("save-draft", async () => {
                  const updatedAction = await generateAiRevenueMessage(action.id, {
                    clinicId,
                    draftText: editedDraftText,
                  });
                  return {
                    action: updatedAction,
                    message: `Draft saved for ${action.customer.customerName ?? action.title}.`,
                  };
                })
              }
            >
              {busyAction === "save-draft" ? "Saving..." : "Save Draft"}
            </button>

            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--secondary"
              disabled={!editedDraftText || busyAction !== null}
              onClick={handleCopyDraft}
            >
              Copy
            </button>

            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--primary"
              disabled={!canApproveDraft || busyAction !== null}
              onClick={() =>
                void runDraftEditorAction("approve", async () => {
                  const updatedAction = await approveAiRevenueMessage(action.id, { clinicId, approvedText: editedDraftText });
                  return {
                    action: updatedAction,
                    message: `Draft approved for ${action.customer.customerName ?? action.title}.`,
                  };
                })
              }
            >
              {busyAction === "approve" ? "Approving..." : "Approve Draft"}
            </button>

            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--secondary"
              disabled={!canMarkSent || busyAction !== null}
              onClick={() =>
                void runDraftEditorAction("sent", async () => {
                  const result = await markAiRevenueMessageSent(action.id, {
                    clinicId,
                    channel: "manual",
                    messageText: approvedText || editedDraftText,
                  });
                  return {
                    action: result.action,
                    message: `Message marked sent for ${action.customer.customerName ?? action.title}.`,
                  };
                })
              }
            >
              {busyAction === "sent" ? "Marking..." : "Mark Sent"}
            </button>
          </div>
          <small>No automatic Viber message is sent from this MVP.</small>
        </div>

        <div className="ai-revenue-detail__section">
          <strong>Follow-up history</strong>
          {followUpLoading ? (
            <div className="inline-note inline-note--loading">Loading staff/customer contact history...</div>
          ) : followUpAttempts.length > 0 ? (
            <div className="ai-revenue-followup-history">
              {followUpAttempts.map((attempt) => (
                <div key={attempt.id} className="ai-revenue-followup-history__item">
                  <div>
                    <strong>{formatLabel(attempt.channel)} - {formatLabel(attempt.result)}</strong>
                    <span>
                      {formatDateTime(attempt.createdAt)} by {attemptActorName(attempt)}
                    </span>
                  </div>
                  {attempt.note ? <p>{attempt.note}</p> : <p>No note recorded.</p>}
                  <small>
                    Next follow-up: {formatDateTime(attempt.nextFollowUpAt ?? attempt.nextFollowUpDateKey)}
                    {attempt.messageText ? ` · Message: ${attempt.messageText}` : ""}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <small>No staff/customer contact history has been recorded for this action yet.</small>
          )}
        </div>

        <div className="ai-revenue-detail__section">
          <strong>Human follow-up</strong>
          <p>
            {formatLabel(action.followUp.status)} · Attempts {formatNumber(action.followUp.attemptCount)} · Channel{" "}
            {formatLabel(action.followUp.lastChannel)}
          </p>
          <small>
            Last note: {action.followUp.lastNote ?? "not recorded"} · Next:{" "}
            {action.followUp.nextFollowUpDate ?? "not scheduled"}
          </small>
        </div>

        <div className="ai-revenue-detail__section">
          <strong>Outcome history</strong>
          {outcomeLoading ? (
            <div className="inline-note inline-note--loading">Loading structured outcome links...</div>
          ) : (
            <>
              <div className="ai-revenue-outcome-summary">
                {outcomeCounts.map((outcomeType) => (
                  <div key={outcomeType.type} className="ai-revenue-outcome-summary__item">
                    <span>{outcomeType.label}</span>
                    <strong>{formatNumber(outcomeType.count)}</strong>
                  </div>
                ))}
              </div>

              {outcomeLinks.length > 0 ? (
                <div className="ai-revenue-outcome-history">
                  {outcomeLinks.map((outcomeLink) => (
                    <div key={outcomeLink.id} className="ai-revenue-outcome-history__item">
                      <div>
                        <strong>{formatLabel(outcomeLink.outcomeType)}</strong>
                        <span>{formatDateTime(outcomeLink.eventAt)}</span>
                      </div>
                      <p>{outcomePrimaryDetail(outcomeLink)}</p>
                      <small>{outcomeMetricDetail(outcomeLink)}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <small>No structured outcome links have been recorded for this action yet.</small>
              )}
            </>
          )}
        </div>

        <details className="ai-revenue-detail__disclosure">
          <summary>Source evidence used by AI</summary>
          <div className="ai-revenue-evidence-grid">
            {action.evidence.map((item) => (
              <div key={`${action.id}-detail-${item.label}`} className="ai-revenue-evidence-item">
                <span>{item.label}</span>
                <strong>
                  {item.value}
                  {item.comparison ? ` (${item.comparison})` : ""}
                </strong>
              </div>
            ))}
          </div>
        </details>

        {action.message.lastInboundText ? (
          <div className="ai-revenue-detail__section">
            <strong>Customer reply</strong>
            <p>{action.message.lastInboundText}</p>
            <small>
              Intent: {formatLabel(action.message.lastInboundIntent)}{action.message.lastInboundAt ? ` · ${action.message.lastInboundAt}` : ""}
            </small>
          </div>
        ) : null}

        {action.appointment.attributionNote ? (
          <div className="ai-revenue-detail__section">
            <strong>Appointment attribution</strong>
            <p>{action.appointment.attributionNote}</p>
          </div>
        ) : null}

        {action.revenue.revenueNote ? (
          <div className="ai-revenue-detail__section">
            <strong>Revenue attribution</strong>
            <p>{action.revenue.revenueNote}</p>
          </div>
        ) : null}

        <details className="ai-revenue-detail__disclosure">
          <summary>Audit trail for manager/admin</summary>
          {auditLoading ? (
            <div className="inline-note inline-note--loading">Loading action timeline...</div>
          ) : (
            <AiRevenueTimeline logs={auditLogs} emptyLabel="No audit events have been recorded for this action yet." />
          )}
        </details>

        {followUpModal ? (
          <AiRevenueFollowUpAttemptModal
            clinicId={clinicId}
            action={action}
            relatedActions={relatedActions}
            initialChannel={followUpModal.channel}
            initialResult={followUpModal.result}
            initialScheduleOption={followUpModal.scheduleOption}
            onClose={() => setFollowUpModal(null)}
            onSaved={async (message) => {
              await Promise.all([loadFollowUpAttempts(), loadOutcomeLinks()]);
              await onWorkflowChanged(message);
            }}
            onError={onError}
          />
        ) : null}
      </div>
    </Panel>
  );
}

export function AiRevenueAgentPage() {
  const { currentClinic } = useAccess();
  const clinic = currentClinic;
  const [activeTab, setActiveTab] = useState<RevenueAgentTab>("dashboard");
  const [filters, setFilters] = useState<FilterState>({
    dateKey: todayDateKey(),
    source: "",
    actionType: "",
    status: "",
    priority: "",
  });
  const [actions, setActions] = useState<AiRevenueAction[]>([]);
  const [followUpActions, setFollowUpActions] = useState<AiRevenueAction[]>([]);
  const [summary, setSummary] = useState<AiRevenueSummary | null>(null);
  const [selectedAction, setSelectedAction] = useState<AiRevenueAction | null>(null);
  const [busyAction, setBusyAction] = useState<"load" | "generate" | null>("load");
  const [draftingActionId, setDraftingActionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(
    async (showLoader = true, overrideFilters?: FilterState) => {
      if (!clinic) {
        setActions([]);
        setFollowUpActions([]);
        setSummary(null);
        setBusyAction(null);
        return;
      }

      const nextFilters = overrideFilters ?? filters;
      if (showLoader) {
        setBusyAction("load");
      }
      setErrorMessage(null);

      try {
        const [actionResponse, followUpResponse, summaryResponse] = await Promise.all([
          getAiRevenueActions(buildActionParams(clinic.id, nextFilters)),
          getAiRevenueActions({
            clinicId: clinic.id,
            limit: 500,
            includeResolved: true,
          }),
          getAiRevenueSummary(buildSummaryParams(clinic.id, nextFilters)),
        ]);
        setActions(actionResponse.actions);
        setFollowUpActions(followUpResponse.actions);
        setSummary(summaryResponse);
      } catch (error) {
        setErrorMessage(getApiErrorMessage(error, "AI Revenue Agent data could not be loaded."));
      } finally {
        setBusyAction((current) => (current === "load" ? null : current));
      }
    },
    [clinic, filters],
  );

  useEffect(() => {
    void loadData(true);
  }, [loadData]);

  async function handleGenerateToday() {
    if (!clinic) {
      return;
    }

    const nextFilters = {
      ...filters,
      dateKey: todayDateKey(),
    };

    setFilters(nextFilters);
    setBusyAction("generate");
    setNotice(null);
    setErrorMessage(null);

    try {
      const result = await generateAiRevenueActions({
        clinicId: clinic.id,
        clinicCode: clinic.code,
        dateKey: nextFilters.dateKey,
        forceRefresh: false,
      });
      setNotice(
        `Generated ${result.generatedCount.toLocaleString("en-US")} action(s), refreshed ${result.refreshedExistingCount.toLocaleString("en-US")} existing action(s), ${result.skippedExistingCount.toLocaleString("en-US")} already up to date.`,
      );
      await loadData(false, nextFilters);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "AI Revenue opportunities could not be generated."));
    } finally {
      setBusyAction(null);
    }
  }

  function updateFilters(patch: Partial<FilterState>) {
    setFilters((current) => ({
      ...current,
      ...patch,
    }));
  }

  async function handleDraftMessage(action: AiRevenueAction) {
    if (!clinic) {
      return;
    }

    const customerName = action.customer.customerName ?? action.title;

    setDraftingActionId(action.id);
    setNotice(null);
    setErrorMessage(null);

    try {
      let nextAction = action;
      let text = messageDraftText(action);
      let generated = false;

      if (!text.trim()) {
        nextAction = await generateAiRevenueMessage(action.id, { clinicId: clinic.id });
        text = messageDraftText(nextAction);
        generated = true;

        if (selectedAction?.id === action.id) {
          setSelectedAction(nextAction);
        }
      }

      const copied = text.trim() ? await copyMessageText(text) : false;

      if (generated) {
        await loadData(false);
      }

      if (text.trim() && copied) {
        setNotice(`${generated ? "Draft generated and copied" : "Draft copied"} for ${customerName}.`);
      } else if (text.trim()) {
        setNotice(`${generated ? "Draft generated" : "Draft ready"} for ${customerName}. Open action detail to copy it.`);
      } else {
        setNotice(`Draft requested for ${customerName}. Open action detail to review it.`);
      }
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Message draft could not be generated."));
    } finally {
      setDraftingActionId(null);
    }
  }

  if (!clinic) {
    return (
      <div className="page-stack page-stack--workspace analytics-report ai-revenue-agent-shell">
        <EmptyState label="No clinic selected" detail="Choose a clinic first to open AI Revenue Agent." />
      </div>
    );
  }

  const actionDetailModal = selectedAction ? (
    <div
      className="ai-revenue-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setSelectedAction(null);
        }
      }}
    >
      <section
        className="ai-revenue-modal ai-revenue-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label="AI Revenue action detail"
      >
        <ActionDetailPanel
          clinicId={clinic.id}
          clinicCode={clinic.code}
          actions={[
            ...actions,
            ...followUpActions.filter((followUpAction) => !actions.some((action) => action.id === followUpAction.id)),
          ]}
          action={selectedAction}
          onWorkflowChanged={async (message) => {
            setNotice(message);
            await loadData(false);
          }}
          onError={(message) => setErrorMessage(message || null)}
          onDraftMessage={handleDraftMessage}
          draftingActionId={draftingActionId}
          onActionUpdated={setSelectedAction}
          onClose={() => setSelectedAction(null)}
        />
      </section>
    </div>
  ) : null;

  return (
    <div className="page-stack page-stack--workspace analytics-report ai-revenue-agent-shell">
      <PageHeader
        eyebrow="AI Agent Portal"
        title="AI Revenue Agent"
        description="Find revenue opportunities, review evidence, approve outreach, and measure real revenue outcomes."
        actions={
          <div className="telegram-settings__header-actions">
            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => void loadData(true)}
              disabled={busyAction !== null}
            >
              Refresh
            </button>
            <Link className="button button--secondary" to="/ai/agent-portal">
              Back to Portal
            </Link>
          </div>
        }
      />

      <div className="telegram-settings__status-strip">
        <div>
          <strong>{clinic.name}</strong>
          <span>Clinic code: {clinic.code} · Human approval required before customer messaging</span>
        </div>
        {notice ? <span className="telegram-settings__notice telegram-settings__notice--success">{notice}</span> : null}
        {!notice && errorMessage ? (
          <span className="telegram-settings__notice telegram-settings__notice--danger">{errorMessage}</span>
        ) : null}
        {!notice && !errorMessage ? (
          <span className="telegram-settings__notice telegram-settings__notice--success">Live MVP</span>
        ) : null}
      </div>

      <Panel
        title="Agent controls"
        subtitle="Filter the manager dashboard and opportunity queue. Generate creates Firestore workflow actions from backend data sources."
      >
        <div className="ai-revenue-filter-grid">
          <label className="field">
            <span>Date</span>
            <input type="date" value={filters.dateKey} onChange={(event) => updateFilters({ dateKey: event.target.value })} />
          </label>

          <label className="field">
            <span>Source</span>
            <select value={filters.source} onChange={(event) => updateFilters({ source: event.target.value as FilterState["source"] })}>
              <option value="">All sources</option>
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Action type</span>
            <select
              value={filters.actionType}
              onChange={(event) => updateFilters({ actionType: event.target.value as FilterState["actionType"] })}
            >
              <option value="">All action types</option>
              {ACTION_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Status</span>
            <select value={filters.status} onChange={(event) => updateFilters({ status: event.target.value as FilterState["status"] })}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Priority</span>
            <select
              value={filters.priority}
              onChange={(event) => updateFilters({ priority: event.target.value as FilterState["priority"] })}
            >
              <option value="">All priorities</option>
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="ai-revenue-filter-grid__actions">
            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() => void loadData(true)}
              disabled={busyAction !== null}
            >
              Apply Filters
            </button>
            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={() =>
                setFilters({
                  dateKey: todayDateKey(),
                  source: "",
                  actionType: "",
                  status: "",
                  priority: "",
                })
              }
              disabled={busyAction !== null}
            >
              Reset
            </button>
          </div>
        </div>
      </Panel>

      {errorMessage ? <ErrorState label="AI Revenue Agent issue" detail={errorMessage} /> : null}

      <div className="ai-revenue-agent-shell__tabs" role="tablist" aria-label="AI Revenue Agent sections">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            className={
              activeTab === tab.value
                ? "ai-revenue-agent-shell__tab ai-revenue-agent-shell__tab--active"
                : "ai-revenue-agent-shell__tab"
            }
            onClick={() => setActiveTab(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "dashboard" ? (
        <AiRevenueDashboardTab
          summary={summary}
          actions={actions}
          loading={busyAction === "load"}
          generating={busyAction === "generate"}
          onGenerateToday={() => void handleGenerateToday()}
          onRefresh={() => void loadData(true)}
          onOpenAction={setSelectedAction}
        />
      ) : activeTab === "opportunities" ? (
        <Panel title="Customer follow-up opportunities" subtitle="See who to contact, why now, what they bought, and how likely they are to return.">
          <AiRevenueOpportunitiesTab
            clinicId={clinic.id}
            actions={actions}
            loading={busyAction === "load"}
            onWorkflowChanged={async (message) => {
              setNotice(message);
              await loadData(false);
            }}
            onError={(message) => setErrorMessage(message || null)}
            onOpenAction={setSelectedAction}
            onDraftMessage={handleDraftMessage}
            draftingActionId={draftingActionId}
          />
        </Panel>
      ) : activeTab === "follow_up" ? (
        <Panel
          title="Follow-up workbench"
          subtitle="AI finds customers to follow up. Staff can call, send manual Viber, record result, schedule next follow-up, or close."
        >
          <AiRevenueFollowUpTab
            clinicId={clinic.id}
            actions={followUpActions}
            loading={busyAction === "load"}
            onWorkflowChanged={async (message) => {
              setNotice(message);
              await loadData(false);
            }}
            onError={(message) => setErrorMessage(message || null)}
            onOpenAction={setSelectedAction}
          />
        </Panel>
      ) : activeTab === "conversations" ? (
        <Panel
          title="Conversation monitor"
          subtitle="Record manual customer replies, classify intent, and move positive replies toward booking action."
        >
          <AiRevenueConversationTab
            clinicId={clinic.id}
            actions={actions}
            loading={busyAction === "load"}
            onWorkflowChanged={async (message) => {
              setNotice(message);
              await loadData(false);
            }}
            onError={(message) => setErrorMessage(message || null)}
            onOpenAction={setSelectedAction}
          />
        </Panel>
      ) : activeTab === "appointments" ? (
        <Panel
          title="Appointment control"
          subtitle="Store appointment requests, link booking IDs, and track confirmed/came/cancelled/no-show/completed outcomes."
        >
          <AiRevenueAppointmentsTab
            clinicId={clinic.id}
            actions={actions}
            loading={busyAction === "load"}
            onWorkflowChanged={async (message) => {
              setNotice(message);
              await loadData(false);
            }}
            onError={(message) => setErrorMessage(message || null)}
            onOpenAction={setSelectedAction}
          />
        </Panel>
      ) : activeTab === "revenue" ? (
        <Panel
          title="Revenue attribution"
          subtitle="Record cash revenue, influenced revenue, and package session recovery without counting appointment creation as revenue."
        >
          <AiRevenueRevenueTab
            clinicId={clinic.id}
            clinicCode={clinic.code}
            actions={actions}
            summary={summary}
            loading={busyAction === "load"}
            onWorkflowChanged={async (message) => {
              setNotice(message);
              await loadData(false);
            }}
            onError={(message) => setErrorMessage(message || null)}
            onOpenAction={setSelectedAction}
          />
        </Panel>
      ) : activeTab === "audit_log" ? (
        <Panel
          title="Audit log"
          subtitle="Trace every AI, staff, customer, and system action from opportunity creation through revenue attribution."
        >
          <AiRevenueAuditTab
            clinicId={clinic.id}
            actions={actions}
            loading={busyAction === "load"}
            onOpenAction={setSelectedAction}
          />
        </Panel>
      ) : (
        <Panel title={titleForTab(activeTab)} subtitle={detailForTab(activeTab)}>
          <EmptyState
            label={`${titleForTab(activeTab)} will be connected in the next phases`}
            detail="The dashboard and opportunity generation are live first. Approval, conversations, appointment outcome tracking, revenue capture, audit timelines, and settings will use the same API client."
          />
        </Panel>
      )}

      {actionDetailModal ? (typeof document === "undefined" ? actionDetailModal : createPortal(actionDetailModal, document.body)) : null}
    </div>
  );
}
