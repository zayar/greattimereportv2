import { useCallback, useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { Link } from "react-router-dom";
import { PageHeader } from "../../../../components/PageHeader";
import { Panel } from "../../../../components/Panel";
import { EmptyState, ErrorState } from "../../../../components/StatusViews";
import {
  generateAiRevenueActions,
  getAiRevenueAuditLogs,
  getAiRevenueActions,
  getAiRevenueSummary,
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
  AiRevenueSummary,
} from "../../../../types/domain";
import { useAccess } from "../../../access/AccessProvider";
import { AiRevenueAuditTab } from "./AiRevenueAuditTab";
import { AiRevenueApprovalTab } from "./AiRevenueApprovalTab";
import { AiRevenueAppointmentsTab } from "./AiRevenueAppointmentsTab";
import { AiRevenueConversationTab } from "./AiRevenueConversationTab";
import { AiRevenueDashboardTab } from "./AiRevenueDashboardTab";
import { AiFollowUpSnapshot, isSameCustomerAction, myanmarReason } from "./AiRevenueFollowUpInsights";
import { AiRevenueOpportunitiesTab } from "./AiRevenueOpportunitiesTab";
import { AiRevenueRevenueTab } from "./AiRevenueRevenueTab";
import { AiRevenueTimeline } from "./AiRevenueTimeline";

type RevenueAgentTab =
  | "dashboard"
  | "opportunities"
  | "message_approval"
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
    value: "message_approval",
    label: "Message Approval",
    detail: "Myanmar follow-up drafts with customer context. Staff can edit and approve before anything is sent.",
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

function ActionDetailPanel({
  action,
  actions,
  clinicId,
  onClose,
}: {
  action: AiRevenueAction;
  actions: AiRevenueAction[];
  clinicId: string;
  onClose: () => void;
}) {
  const [auditLogs, setAuditLogs] = useState<AiRevenueAuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const relatedActions = actions.filter((item) => item.id !== action.id && isSameCustomerAction(item, action));

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

        <div className="ai-revenue-detail__grid">
          <div>
            <span>Type</span>
            <strong>{formatLabel(action.actionType)}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{formatLabel(action.status)}</strong>
          </div>
          <div>
            <span>Source</span>
            <strong>{formatLabel(action.source)}</strong>
          </div>
          <div>
            <span>Date</span>
            <strong>{action.dateKey}</strong>
          </div>
          <div>
            <span>Service</span>
            <strong>{action.service.serviceName ?? "Not set"}</strong>
          </div>
          <div>
            <span>Package balance</span>
            <strong>
              {action.packageInfo.remainingUnits == null
                ? "Not set"
                : `${formatNumber(action.packageInfo.remainingUnits)} remaining`}
            </strong>
          </div>
          <div>
            <span>AI-generated revenue</span>
            <strong>{formatMoney(action.revenue.actualRevenue)}</strong>
          </div>
          <div>
            <span>Booking ID</span>
            <strong>{action.appointment.bookingId ?? "Not linked"}</strong>
          </div>
          <div>
            <span>Appointment time</span>
            <strong>{action.appointment.appointmentDateTime ?? "Not requested"}</strong>
          </div>
          <div>
            <span>Practitioner</span>
            <strong>{action.appointment.practitionerName ?? "Not set"}</strong>
          </div>
          <div>
            <span>Package sessions recovered</span>
            <strong>{formatNumber(action.revenue.packageSessionsRecovered)}</strong>
          </div>
        </div>

        <AiFollowUpSnapshot action={action} relatedActions={relatedActions} />

        <div className="ai-revenue-detail__section">
          <strong>AI reason (Myanmar)</strong>
          <p>{myanmarReason(action, relatedActions)}</p>
          <small>Source reason: {action.reason}</small>
        </div>

        <div className="ai-revenue-detail__section">
          <strong>Recommended action</strong>
          <p>{action.recommendedAction}</p>
        </div>

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

        <div className="ai-revenue-detail__section">
          <strong>Message draft</strong>
          <p>{action.message.draftText ?? "No draft generated yet."}</p>
        </div>

        {action.message.approvedText ? (
          <div className="ai-revenue-detail__section">
            <strong>Approved message</strong>
            <p>{action.message.approvedText}</p>
            <small>
              Approved by {actorName(action.message.approvedBy)}{action.message.approvedAt ? ` at ${action.message.approvedAt}` : ""}
            </small>
          </div>
        ) : null}

        {action.message.sentAt ? (
          <div className="ai-revenue-detail__section">
            <strong>Sent message</strong>
            <p>{action.message.approvedText || action.message.draftText || "Message text not recorded."}</p>
            <small>
              Channel: {action.message.channel ?? "manual"} · Sent at {action.message.sentAt}
            </small>
          </div>
        ) : null}

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

        <div className="ai-revenue-detail__section">
          <strong>Appointment status</strong>
          <p>
            {formatLabel(action.status)} · Booking {action.appointment.bookingId ?? "not linked"} ·{" "}
            {action.appointment.appointmentDateTime ?? "time not requested"}
          </p>
          <small>
            Came: {action.appointment.cameAt ?? "not marked"} · Cancelled: {action.appointment.cancelledAt ?? "not marked"} · No-show:{" "}
            {action.appointment.noShowAt ?? "not marked"} · Completed: {action.appointment.completedAt ?? "not marked"}
          </small>
        </div>

        {action.revenue.revenueNote ? (
          <div className="ai-revenue-detail__section">
            <strong>Revenue attribution</strong>
            <p>{action.revenue.revenueNote}</p>
          </div>
        ) : null}

        <div className="ai-revenue-detail__section">
          <strong>Revenue result</strong>
          <p>
            Generated {formatMoney(action.revenue.actualRevenue)} · Influenced {formatMoney(action.revenue.influencedRevenue)} · Package sessions{" "}
            {formatNumber(action.revenue.packageSessionsRecovered)}
          </p>
          <small>
            Attribution: {formatLabel(action.revenue.attributionType)} · Invoice {action.revenue.invoiceNumber ?? "not linked"}
          </small>
        </div>

        <div className="ai-revenue-detail__section">
          <strong>Full timeline</strong>
          {auditLoading ? (
            <div className="inline-note inline-note--loading">Loading action timeline...</div>
          ) : (
            <AiRevenueTimeline logs={auditLogs} emptyLabel="No audit events have been recorded for this action yet." />
          )}
        </div>
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
  const [summary, setSummary] = useState<AiRevenueSummary | null>(null);
  const [selectedAction, setSelectedAction] = useState<AiRevenueAction | null>(null);
  const [busyAction, setBusyAction] = useState<"load" | "generate" | null>("load");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(
    async (showLoader = true, overrideFilters?: FilterState) => {
      if (!clinic) {
        setActions([]);
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
        const [actionResponse, summaryResponse] = await Promise.all([
          getAiRevenueActions(buildActionParams(clinic.id, nextFilters)),
          getAiRevenueSummary(buildSummaryParams(clinic.id, nextFilters)),
        ]);
        setActions(actionResponse.actions);
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

  if (!clinic) {
    return (
      <div className="page-stack page-stack--workspace analytics-report ai-revenue-agent-shell">
        <EmptyState label="No clinic selected" detail="Choose a clinic first to open AI Revenue Agent." />
      </div>
    );
  }

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
          />
        </Panel>
      ) : activeTab === "message_approval" ? (
        <Panel
          title="Customer follow-up message queue"
          subtitle="Generate Myanmar drafts, review customer purchase context, approve messages, or mark approved outreach as sent."
        >
          <AiRevenueApprovalTab
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

      {selectedAction ? (
        <ActionDetailPanel
          clinicId={clinic.id}
          actions={actions}
          action={selectedAction}
          onClose={() => setSelectedAction(null)}
        />
      ) : null}
    </div>
  );
}
