import { useState } from "react";
import { isAxiosError } from "axios";
import {
  recordAiRevenueReply,
  rejectAiRevenueAction,
  requestAiRevenueBooking,
} from "../../../../api/aiRevenueAgent";
import { EmptyState } from "../../../../components/StatusViews";
import type { AiRevenueAction } from "../../../../types/domain";

type Props = {
  clinicId: string;
  actions: AiRevenueAction[];
  loading: boolean;
  onWorkflowChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
  onOpenAction: (action: AiRevenueAction) => void;
};

const BOOKING_INTENTS = new Set(["interested", "wants_appointment", "selected_time", "confirm"]);
const HUMAN_TAKEOVER_INTENTS = new Set(["price_question", "call_request", "complaint", "unclear", "cancel", "reschedule"]);

function titleCase(value: string | null | undefined) {
  return (value || "not set")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    const apiMessage = typeof error.response?.data?.error === "string" ? error.response.data.error : null;
    return apiMessage || error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function contactLabel(action: AiRevenueAction) {
  return action.customer.phoneNumber || action.customer.phoneMasked || action.customer.memberId || "No contact detail";
}

function latestOutbound(action: AiRevenueAction) {
  return action.message.approvedText || action.message.draftText || "No outbound message recorded.";
}

function nextRecommendedAction(action: AiRevenueAction) {
  const intent = action.message.lastInboundIntent;

  if (!intent) {
    return "Record Reply";
  }

  if (BOOKING_INTENTS.has(intent)) {
    return "Request Booking";
  }

  if (intent === "not_interested") {
    return "Record Not Interested";
  }

  if (HUMAN_TAKEOVER_INTENTS.has(intent)) {
    return "Human Takeover";
  }

  return "Human Takeover";
}

export function AiRevenueConversationTab({
  clinicId,
  actions,
  loading,
  onWorkflowChanged,
  onError,
  onOpenAction,
}: Props) {
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  const conversationActions = actions.filter(
    (action) =>
      Boolean(action.message.sentAt || action.message.lastInboundText) ||
      [
        "sent",
        "customer_replied",
        "human_takeover",
        "not_interested",
        "appointment_requested",
        "appointment_created",
        "appointment_confirmed",
        "reminder_sent",
      ].includes(action.status),
  );

  async function runConversationWorkflow(action: AiRevenueAction, work: () => Promise<string>) {
    setBusyActionId(action.id);
    onError("");

    try {
      const message = await work();
      await onWorkflowChanged(message);
    } catch (error) {
      onError(getApiErrorMessage(error, "Conversation workflow could not be updated."));
    } finally {
      setBusyActionId(null);
    }
  }

  function updateReplyDraft(actionId: string, value: string) {
    setReplyDrafts((current) => ({
      ...current,
      [actionId]: value,
    }));
  }

  if (loading && actions.length === 0) {
    return <div className="inline-note inline-note--loading">Loading conversation monitor...</div>;
  }

  if (conversationActions.length === 0) {
    return (
      <EmptyState
        label="No sent conversations yet"
        detail="Approve and mark a message as sent first. Replies can then be recorded manually here until Viber webhook integration is ready."
      />
    );
  }

  return (
    <div className="ai-revenue-action-list">
      {conversationActions.map((action) => {
        const replyText = replyDrafts[action.id] ?? "";
        const busy = busyActionId === action.id;
        const latestIntent = action.message.lastInboundIntent;
        const nextAction = nextRecommendedAction(action);

        return (
          <article key={action.id} className="ai-revenue-action-card ai-revenue-conversation-card">
            <div className="ai-revenue-action-card__top">
              <div>
                <span className={`status-pill status-pill--${action.priority}`}>{action.priority}</span>
                <span className="ai-revenue-action-card__source">{titleCase(action.status)}</span>
              </div>
              <strong>{nextAction}</strong>
            </div>

            <div className="ai-revenue-action-card__main">
              <div>
                <h3>{action.customer.customerName ?? "Customer"}</h3>
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

            <div className="ai-revenue-message-thread">
              <div className="ai-revenue-message-box">
                <div>
                  <strong>Latest outbound</strong>
                  <span>{action.message.sentAt ? `Sent at ${action.message.sentAt}` : "Not marked sent"}</span>
                </div>
                <p>{latestOutbound(action)}</p>
              </div>

              <div className="ai-revenue-message-box ai-revenue-message-box--inbound">
                <div>
                  <strong>Latest inbound reply</strong>
                  <span>{action.message.lastInboundAt ? `Received at ${action.message.lastInboundAt}` : "Waiting for reply"}</span>
                </div>
                <p>{action.message.lastInboundText || "No customer reply recorded yet."}</p>
              </div>
            </div>

            <div className="ai-revenue-evidence-grid">
              <div className="ai-revenue-evidence-item">
                <span>Detected intent</span>
                <strong>{titleCase(latestIntent)}</strong>
              </div>
              <div className="ai-revenue-evidence-item">
                <span>Next recommended action</span>
                <strong>{nextAction}</strong>
              </div>
              <div className="ai-revenue-evidence-item">
                <span>Action type</span>
                <strong>{titleCase(action.actionType)}</strong>
              </div>
              <div className="ai-revenue-evidence-item">
                <span>Service</span>
                <strong>{action.service.serviceName ?? "Not set"}</strong>
              </div>
            </div>

            <div className="ai-revenue-reply-box">
              <label className="field">
                <span>Record customer reply</span>
                <textarea
                  className="telegram-settings__textarea"
                  rows={3}
                  maxLength={1200}
                  value={replyText}
                  onChange={(event) => updateReplyDraft(action.id, event.target.value)}
                  placeholder="Example: yes, tomorrow 2pm, how much, call me, not interested"
                />
              </label>
              <div className="ai-revenue-action-card__footer ai-revenue-approval-card__actions">
                <button
                  type="button"
                  className="button telegram-settings__button telegram-settings__button--primary"
                  onClick={() =>
                    void runConversationWorkflow(action, async () => {
                      const result = await recordAiRevenueReply(action.id, {
                        clinicId,
                        channel: "manual",
                        replyText,
                      });
                      updateReplyDraft(action.id, "");
                      return `Reply recorded for ${action.customer.customerName ?? action.title}: ${titleCase(result.intent)}.`;
                    })
                  }
                  disabled={busy || !replyText.trim()}
                >
                  Record Reply
                </button>

                <button
                  type="button"
                  className="button telegram-settings__button telegram-settings__button--secondary"
                  onClick={() =>
                    void runConversationWorkflow(action, async () => {
                      await requestAiRevenueBooking(action.id, {
                        clinicId,
                        requestedDateTime: action.appointment.appointmentDateTime ?? null,
                        serviceId: action.service.serviceId ?? action.appointment.serviceId ?? null,
                        serviceName: action.service.serviceName ?? action.appointment.serviceName ?? null,
                        note: "Requested from AI Revenue conversation monitor.",
                        mode: "booking_request",
                      });
                      return `Booking requested for ${action.customer.customerName ?? action.title}.`;
                    })
                  }
                  disabled={busy || !BOOKING_INTENTS.has(latestIntent ?? "")}
                >
                  Request Booking
                </button>

                <button
                  type="button"
                  className="button telegram-settings__button telegram-settings__button--secondary"
                  onClick={() =>
                    void runConversationWorkflow(action, async () => {
                      await recordAiRevenueReply(action.id, {
                        clinicId,
                        channel: "manual",
                        replyText: "not interested",
                      });
                      return `${action.customer.customerName ?? action.title} recorded as not interested.`;
                    })
                  }
                  disabled={busy || action.status === "not_interested"}
                >
                  Record Not Interested
                </button>

                <button
                  type="button"
                  className="button telegram-settings__button telegram-settings__button--danger"
                  onClick={() =>
                    void runConversationWorkflow(action, async () => {
                      await rejectAiRevenueAction(action.id, { clinicId, note: "Closed from conversation monitor." });
                      return `Conversation closed for ${action.customer.customerName ?? action.title}.`;
                    })
                  }
                  disabled={busy || action.status === "closed"}
                >
                  Close
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
