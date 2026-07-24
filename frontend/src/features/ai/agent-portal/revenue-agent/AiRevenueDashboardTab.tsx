import { EmptyState } from "../../../../components/StatusViews";
import type {
  AiRevenueAction,
  AiRevenueGenerationStatus,
  AiRevenueSummary,
} from "../../../../types/domain";

type Props = {
  summary: AiRevenueSummary | null;
  actions: AiRevenueAction[];
  generationStatus: AiRevenueGenerationStatus | null;
  loading: boolean;
  generating: boolean;
  onGenerateToday: () => void;
  onRefresh: () => void;
  onOpenAction: (action: AiRevenueAction) => void;
};

function numberLabel(value: number | null | undefined) {
  return Math.round(value ?? 0).toLocaleString("en-US");
}

function moneyLabel(value: number | null | undefined) {
  return `${Math.round(value ?? 0).toLocaleString("en-US")} MMK`;
}

function rateLabel(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return "0%";
  }

  return `${Math.round((numerator / denominator) * 100)}%`;
}

function perUnitLabel(amount: number, denominator: number) {
  if (denominator <= 0) {
    return "0 MMK";
  }

  return moneyLabel(amount / denominator);
}

function actionTypeLabel(value: AiRevenueAction["actionType"]) {
  return value.replace(/_/g, " ");
}

function sourceBreakdownLabel(action: AiRevenueAction) {
  switch (action.actionType) {
    case "service_reminder_follow_up":
    case "service_reminder_overdue":
      return "Service Reminder";
    case "unused_package_follow_up":
    case "package_upsell_opportunity":
      return "Unused Package";
    case "appointment_confirmation_reminder":
      return "Appointment Reminder";
    case "no_show_recovery":
      return "No-show Recovery";
    case "cancelled_appointment_recovery":
      return "Cancelled Recovery";
    case "inactive_vip_recovery":
      return "Inactive VIP";
    case "birthday_follow_up":
      return "Birthday Follow-up";
    default:
      return "Other";
  }
}

function messageStatus(action: AiRevenueAction) {
  if (action.message.sentAt || action.status === "sent") {
    return "Sent";
  }
  if (action.message.approvedAt || action.status === "approved") {
    return "Approved";
  }
  if (action.message.draftText || action.status === "draft_ready") {
    return "Draft ready";
  }
  return "Not started";
}

function appointmentStatus(action: AiRevenueAction) {
  if (action.status === "revenue_attributed") {
    return "Revenue attributed";
  }
  if (action.appointment.completedAt || action.status === "completed") {
    return "Completed";
  }
  if (action.appointment.noShowAt || action.status === "no_show") {
    return "No-show";
  }
  if (action.appointment.cancelledAt || action.status === "cancelled") {
    return "Cancelled";
  }
  if (action.appointment.cameAt || action.status === "customer_came") {
    return "Came";
  }
  if (action.appointment.reminderSentAt || action.status === "reminder_sent") {
    return "Reminder sent";
  }
  if (action.appointment.bookingId || action.status === "appointment_created") {
    return "Created";
  }
  if (action.appointment.requestedAt || action.status === "appointment_requested") {
    return "Requested";
  }
  return "Not booked";
}

function revenueLabel(action: AiRevenueAction) {
  const cash = Number(action.revenue.actualRevenue ?? 0);
  const influenced = Number(action.revenue.influencedRevenue ?? 0);
  const sessions = Number(action.revenue.packageSessionsRecovered ?? 0);
  if (cash > 0) {
    return moneyLabel(cash);
  }
  if (influenced > 0) {
    return `${moneyLabel(influenced)} influenced`;
  }
  if (sessions > 0) {
    return `${numberLabel(sessions)} package session(s)`;
  }
  return "0 MMK";
}

export function AiRevenueDashboardTab({
  summary,
  actions,
  generationStatus,
  loading,
  generating,
  onGenerateToday,
  onRefresh,
  onOpenAction,
}: Props) {
  const empty = !summary || summary.opportunitiesFound === 0;
  const rejectedSources = Object.entries(generationStatus?.sourceStatus ?? {})
    .filter(([source, status]) => source !== "packageFallback" && status === "rejected")
    .map(([source]) => source.replace(/([A-Z])/g, " $1").toLowerCase());
  const emptyState =
    generationStatus?.status === "running"
      ? {
          label: "Generating AI Revenue opportunities",
          detail: "Source checks are still running. You can safely reload or leave this page; progress is saved.",
        }
      : generationStatus?.status === "failed"
        ? {
            label: "Opportunity generation failed",
            detail: generationStatus.errorMessage || "The source checks did not complete. Retry generation or contact support.",
          }
        : generationStatus?.status === "completed"
          ? generationStatus.actionCount > 0
            ? {
                label: "No opportunities match this view",
                detail: "Generation completed and found opportunities, but none match the current dashboard filters.",
              }
            : {
                label: "No opportunities matched today",
                detail: "Generation completed successfully, but no customers met the current opportunity rules for this date.",
              }
          : {
              label: "No AI Revenue activity yet",
              detail: "Generate today's opportunities from package balances, customer patterns, and appointment signals.",
            };
  const topActions = actions.slice(0, 3);
  const messagesSent = summary?.messagesSent ?? 0;
  const appointmentsCreated = summary?.appointmentsCreated ?? 0;
  const appointmentsRequested = summary?.appointmentsRequested ?? 0;
  const aiGeneratedRevenue = summary?.aiGeneratedRevenue ?? 0;
  const appointmentsHelped = appointmentsCreated + appointmentsRequested;
  const sortedActions = [...actions].sort((left, right) => {
    const priorityDelta = right.priorityScore - left.priorityScore;
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  const sourceBreakdown = [
    { label: "Service Reminder", count: summary?.sourceBreakdown?.serviceReminder ?? actions.filter((action) => sourceBreakdownLabel(action) === "Service Reminder").length },
    { label: "Unused Package", count: summary?.sourceBreakdown?.unusedPackage ?? actions.filter((action) => sourceBreakdownLabel(action) === "Unused Package").length },
    { label: "Appointment Reminder", count: summary?.sourceBreakdown?.appointmentReminder ?? actions.filter((action) => sourceBreakdownLabel(action) === "Appointment Reminder").length },
    { label: "No-show Recovery", count: summary?.sourceBreakdown?.noShowRecovery ?? actions.filter((action) => sourceBreakdownLabel(action) === "No-show Recovery").length },
    { label: "Cancelled Recovery", count: summary?.sourceBreakdown?.cancelledRecovery ?? actions.filter((action) => sourceBreakdownLabel(action) === "Cancelled Recovery").length },
    { label: "Inactive VIP", count: summary?.sourceBreakdown?.inactiveVip ?? actions.filter((action) => sourceBreakdownLabel(action) === "Inactive VIP").length },
    { label: "Birthday Follow-up", count: summary?.sourceBreakdown?.birthdayFollowUp ?? actions.filter((action) => sourceBreakdownLabel(action) === "Birthday Follow-up").length },
  ];

  const metrics = [
    { label: "Active Opportunities", value: numberLabel(summary?.activeOpportunities ?? summary?.opportunitiesFound), hint: "Visible actionable queue" },
    { label: "Resolved Actions", value: numberLabel(summary?.resolvedActions), hint: "Closed with full audit history" },
    { label: "Suppressed Customers", value: numberLabel(summary?.suppressedActions), hint: "Hidden from future AI generation" },
    { label: "Follow-ups Contacted", value: numberLabel(summary?.followUpAttempts), hint: "Staff-recorded calls, manual messages, and visits" },
    {
      label: "Bookings from Follow-up",
      value: numberLabel(summary?.appointmentBookedFromFollowUp ?? summary?.followUpBooked),
      hint: "Appointments linked to staff follow-up",
    },
    { label: "Repurchases", value: numberLabel(summary?.repurchasesAttributed ?? summary?.followUpRepurchased), hint: "Repurchase outcomes recorded" },
    {
      label: "Revenue Attributed",
      value: moneyLabel((summary?.aiGeneratedRevenue ?? 0) + (summary?.aiInfluencedRevenue ?? 0)),
      hint: "Generated plus influenced revenue",
    },
    { label: "High Priority", value: numberLabel(summary?.highPriority), hint: "Needs manager attention first" },
    { label: "Drafts Ready", value: numberLabel(summary?.draftsReady), hint: "Messages prepared for approval" },
    { label: "Approved Messages", value: numberLabel(summary?.approvedMessages), hint: "Human-approved outreach" },
    { label: "Messages Sent", value: numberLabel(summary?.messagesSent), hint: "Manual/mock/provider sends" },
    { label: "Customer Replies", value: numberLabel(summary?.customersReplied), hint: "Measured inbound response" },
    { label: "Appointments Requested", value: numberLabel(summary?.appointmentsRequested), hint: "Staff booking request stage" },
    { label: "Appointments Created", value: numberLabel(summary?.appointmentsCreated), hint: "Bookings linked to AI actions" },
    { label: "Appointment Reminders Sent", value: numberLabel(summary?.remindersSent), hint: "Follow-up reminders after booking" },
    { label: "Customers Came", value: numberLabel(summary?.customersCame), hint: "Showed up or completed" },
    { label: "Cancelled", value: numberLabel(summary?.cancelled), hint: "AI-linked cancellation outcome" },
    { label: "No-show", value: numberLabel(summary?.noShow), hint: "AI-linked missed appointment" },
    { label: "Completed", value: numberLabel(summary?.completed), hint: "Checkout/revenue-ready outcomes" },
    { label: "AI-generated Revenue", value: moneyLabel(summary?.aiGeneratedRevenue), hint: "Cash revenue attributed to AI" },
    { label: "AI-influenced Revenue", value: moneyLabel(summary?.aiInfluencedRevenue), hint: "Same-customer attribution window" },
    { label: "Package Sessions Recovered", value: numberLabel(summary?.packageSessionsRecovered), hint: "Prepaid usage, not cash revenue" },
  ];

  const conversions = [
    {
      label: "Message reply rate",
      value: rateLabel(summary?.customersReplied ?? 0, messagesSent),
      detail: `${numberLabel(summary?.customersReplied)} replies / ${numberLabel(messagesSent)} sent`,
    },
    {
      label: "Appointment conversion",
      value: rateLabel(appointmentsCreated, messagesSent),
      detail: `${numberLabel(appointmentsCreated)} appointments / ${numberLabel(messagesSent)} sent`,
    },
    {
      label: "Show-up rate",
      value: rateLabel(summary?.customersCame ?? 0, appointmentsCreated),
      detail: `${numberLabel(summary?.customersCame)} came / ${numberLabel(appointmentsCreated)} booked`,
    },
    {
      label: "Revenue per message",
      value: perUnitLabel(aiGeneratedRevenue, messagesSent),
      detail: `${moneyLabel(aiGeneratedRevenue)} / ${numberLabel(messagesSent)} sent`,
    },
    {
      label: "Revenue per appointment",
      value: perUnitLabel(aiGeneratedRevenue, appointmentsCreated),
      detail: `${moneyLabel(aiGeneratedRevenue)} / ${numberLabel(appointmentsCreated)} appointments`,
    },
  ];

  const funnel = [
    { label: "Opportunities", value: summary?.opportunitiesFound ?? 0 },
    { label: "Approved", value: summary?.approvedMessages ?? 0 },
    { label: "Sent", value: summary?.messagesSent ?? 0 },
    { label: "Replied", value: summary?.customersReplied ?? 0 },
    { label: "Booked", value: summary?.appointmentsCreated ?? 0 },
    { label: "Came", value: summary?.customersCame ?? 0 },
    { label: "Revenue", value: aiGeneratedRevenue, displayValue: moneyLabel(aiGeneratedRevenue), isMoney: true },
  ];
  const maxFunnelValue = Math.max(1, ...funnel.filter((item) => !item.isMoney).map((item) => item.value));

  return (
    <div className="ai-revenue-dashboard">
      <div className="ai-revenue-owner-summary">
        <strong>
          AI Revenue Agent found {numberLabel(summary?.opportunitiesFound)} opportunities, helped create {numberLabel(appointmentsHelped)} appointments,
          brought back {numberLabel(summary?.customersCame)} customers, and generated {numberLabel(summary?.aiGeneratedRevenue)} MMK in tracked revenue.
        </strong>
        <span>
          Package sessions recovered are shown separately so prepaid usage is not mixed with new cash revenue.
        </span>
      </div>

      <div className="telegram-settings__button-row ai-revenue-dashboard__actions">
        <button
          type="button"
          className="button telegram-settings__button telegram-settings__button--primary"
          onClick={onGenerateToday}
          disabled={generating || loading}
        >
          {generating ? "Generating..." : "Generate Today's Opportunities"}
        </button>
        <button
          type="button"
          className="button telegram-settings__button telegram-settings__button--secondary"
          onClick={onRefresh}
          disabled={loading || generating}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {generationStatus?.status === "running" ? (
        <div className="inline-note inline-note--loading">
          Generation is running in the background. This dashboard refreshes every five seconds and is safe to reload.
        </div>
      ) : null}

      {generationStatus?.status === "completed" && rejectedSources.length > 0 ? (
        <div className="inline-note">
          Generation completed with partial source coverage. Unavailable: {rejectedSources.join(", ")}.
        </div>
      ) : null}

      {empty ? (
        <EmptyState
          label={emptyState.label}
          detail={emptyState.detail}
        />
      ) : null}

      <div className="ai-revenue-funnel" aria-label="AI Revenue funnel">
        <header>
          <div>
            <h3>Revenue funnel</h3>
            <p>{"Opportunities -> Approved -> Sent -> Replied -> Booked -> Came -> Revenue"}</p>
          </div>
          <strong>{moneyLabel(summary?.aiGeneratedRevenue)}</strong>
        </header>
        <div className="ai-revenue-funnel__rows">
          {funnel.map((item) => (
            <div key={item.label} className="ai-revenue-funnel__row">
              <span>{item.label}</span>
              <div className="ai-revenue-funnel__bar-track">
                <div
                  className="ai-revenue-funnel__bar"
                  style={{
                    width: `${Math.max(4, ((item.isMoney ? (item.value > 0 ? maxFunnelValue : 0) : item.value) / maxFunnelValue) * 100)}%`,
                  }}
                />
              </div>
              <strong>{item.displayValue ?? numberLabel(item.value)}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="report-kpi-strip">
        {metrics.map((item) => (
          <article key={item.label} className="report-kpi-strip__card">
            <span className="report-kpi-strip__label">{item.label}</span>
            <strong className="report-kpi-strip__value">{item.value}</strong>
            <span className="report-kpi-strip__hint">{item.hint}</span>
          </article>
        ))}
      </div>

      <div className="ai-revenue-conversion-grid">
        {conversions.map((item) => (
          <article key={item.label} className="ai-revenue-conversion-card">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </article>
        ))}
      </div>

      <section className="ai-revenue-source-breakdown">
        <div className="ai-revenue-section-heading">
          <h3>Source breakdown</h3>
          <span>Where AI found the opportunity.</span>
        </div>
        <div className="ai-revenue-evidence-grid">
          {sourceBreakdown.map((item) => (
            <div key={item.label} className="ai-revenue-evidence-item">
              <span>{item.label}</span>
              <strong>{numberLabel(item.count)}</strong>
            </div>
          ))}
        </div>
      </section>

      {topActions.length ? (
        <section className="ai-revenue-top-actions">
          <div className="ai-revenue-section-heading">
            <h3>Highest priority actions</h3>
            <span>Open an action to review full evidence before staff works it.</span>
          </div>
          <div className="ai-revenue-action-grid">
            {topActions.map((action) => (
              <article key={action.id} className="ai-revenue-action-card ai-revenue-action-card--compact">
                <div className="ai-revenue-action-card__top">
                  <span className={`status-pill status-pill--${action.priority}`}>{action.priority}</span>
                  <strong>Score {action.priorityScore}</strong>
                </div>
                <h4>{action.customer.customerName ?? action.title}</h4>
                <p>{action.summary}</p>
                <small>{actionTypeLabel(action.actionType)}</small>
                <button
                  type="button"
                  className="button telegram-settings__button telegram-settings__button--secondary"
                  onClick={() => onOpenAction(action)}
                >
                  Open Action Detail
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {sortedActions.length ? (
        <section className="ai-revenue-action-table-section">
          <div className="ai-revenue-section-heading">
            <h3>Action table</h3>
            <span>Current workflow state and tracked value by customer.</span>
          </div>
          <div className="ai-revenue-table-wrap">
            <table className="ai-revenue-action-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Source</th>
                  <th>Reason</th>
                  <th>Priority</th>
                  <th>Message Status</th>
                  <th>Appointment Status</th>
                  <th>Revenue</th>
                  <th>Last Update</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedActions.slice(0, 25).map((action) => (
                  <tr key={action.id}>
                    <td>
                      <strong>{action.customer.customerName ?? action.title}</strong>
                      <span>{action.customer.phoneMasked ?? action.customer.memberId ?? ""}</span>
                    </td>
                    <td>{sourceBreakdownLabel(action)}</td>
                    <td>{action.reason}</td>
                    <td>
                      <span className={`status-pill status-pill--${action.priority}`}>{action.priority}</span>
                    </td>
                    <td>{messageStatus(action)}</td>
                    <td>{appointmentStatus(action)}</td>
                    <td>{revenueLabel(action)}</td>
                    <td>{action.updatedAt}</td>
                    <td>
                      <button
                        type="button"
                        className="button telegram-settings__button telegram-settings__button--secondary"
                        onClick={() => onOpenAction(action)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
