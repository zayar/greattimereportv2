import { EmptyState } from "../../../../components/StatusViews";
import type { AiRevenueAction } from "../../../../types/domain";
import {
  AiFollowUpSnapshot,
  getReturnScore,
  isSameCustomerAction,
  quickAnswer,
  titleCase,
} from "./AiRevenueFollowUpInsights";
import { AiRevenueResolveControls } from "./AiRevenueResolveControls";

type Props = {
  clinicId: string;
  actions: AiRevenueAction[];
  loading: boolean;
  onWorkflowChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
  onOpenAction: (action: AiRevenueAction) => void;
  onDraftMessage: (action: AiRevenueAction) => Promise<void>;
  draftingActionId?: string | null;
};

function formatMoney(value: number | null | undefined) {
  if (!value || value <= 0) {
    return null;
  }

  return `${Math.round(value).toLocaleString("en-US")} MMK`;
}

function contactLabel(action: AiRevenueAction) {
  return action.customer.phoneNumber || action.customer.phoneMasked || action.customer.memberId || "No contact detail";
}

function packageBalanceLabel(action: AiRevenueAction) {
  const remaining = action.packageInfo.remainingUnits;
  const purchased = action.packageInfo.purchasedUnits;

  if (remaining == null && purchased == null) {
    return null;
  }

  return `${remaining ?? 0}${purchased != null ? ` / ${purchased}` : ""} sessions remaining`;
}

export function AiRevenueOpportunitiesTab({
  clinicId,
  actions,
  loading,
  onWorkflowChanged,
  onError,
  onOpenAction,
  onDraftMessage,
  draftingActionId,
}: Props) {
  if (loading && actions.length === 0) {
    return <div className="inline-note inline-note--loading">Loading AI Revenue opportunities...</div>;
  }

  if (actions.length === 0) {
    return (
      <EmptyState
        label="No opportunities matched these filters"
        detail="Generate today's opportunities or widen the filters to see package, appointment, service reminder, and VIP recovery actions."
      />
    );
  }

  return (
    <div className="ai-revenue-action-list">
      {actions.map((action) => {
        const relatedActions = actions.filter((item) => item.id !== action.id && isSameCustomerAction(item, action));
        const packageBalance = packageBalanceLabel(action);
        const estimatedRevenue = formatMoney(action.revenue.actualRevenue ?? action.revenue.influencedRevenue);
        const score = getReturnScore(action, relatedActions);

        return (
          <article key={action.id} className="ai-revenue-action-card">
            <div className="ai-revenue-action-card__top">
              <div>
                <span className={`status-pill status-pill--${action.priority}`}>{action.priority}</span>
                <span className="ai-revenue-action-card__source">{titleCase(action.source)}</span>
              </div>
              <strong>{score.label}</strong>
            </div>

            <div className="ai-revenue-action-card__main">
              <div>
                <h3>{action.customer.customerName ?? "Customer"}</h3>
                <span>{contactLabel(action)}</span>
              </div>
              <span className="telegram-settings__badge telegram-settings__badge--idle">{titleCase(action.status)}</span>
            </div>

            <div className="ai-revenue-action-card__body">
              <div>
                <strong>{quickAnswer(action, relatedActions)}</strong>
                <p>{action.summary}</p>
              </div>

              <AiFollowUpSnapshot action={action} relatedActions={relatedActions} />
            </div>

            <div className="ai-revenue-action-card__meta">
              <span>{titleCase(action.actionType)}</span>
              {action.service.serviceName ? <span>Service: {action.service.serviceName}</span> : null}
              {action.packageInfo.packageName ? <span>Package: {action.packageInfo.packageName}</span> : null}
              {packageBalance ? <span>{packageBalance}</span> : null}
              {action.appointment.appointmentDateTime ? <span>Appointment: {action.appointment.appointmentDateTime}</span> : null}
              {estimatedRevenue ? <span>Revenue: {estimatedRevenue}</span> : null}
            </div>

            <div className="ai-revenue-action-card__footer">
              <span>{action.recommendedAction}</span>
              <div className="ai-revenue-action-card__controls">
                <button
                  type="button"
                  className="button telegram-settings__button telegram-settings__button--secondary"
                  disabled={draftingActionId === action.id}
                  onClick={() => void onDraftMessage(action)}
                >
                  {draftingActionId === action.id ? "Drafting..." : "Draft Message"}
                </button>
                <button
                  type="button"
                  className="button telegram-settings__button telegram-settings__button--secondary"
                  onClick={() => onOpenAction(action)}
                >
                  Open Action Detail
                </button>
                <AiRevenueResolveControls
                  clinicId={clinicId}
                  action={action}
                  onResolved={onWorkflowChanged}
                  onError={onError}
                />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
