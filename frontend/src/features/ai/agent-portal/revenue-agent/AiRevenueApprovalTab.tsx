import { useState } from "react";
import { isAxiosError } from "axios";
import {
  approveAiRevenueMessage,
  generateAiRevenueMessage,
  markAiRevenueMessageSent,
  rejectAiRevenueAction,
} from "../../../../api/aiRevenueAgent";
import { EmptyState } from "../../../../components/StatusViews";
import type { AiRevenueAction } from "../../../../types/domain";
import {
  AiFollowUpSnapshot,
  isSameCustomerAction,
  titleCase,
} from "./AiRevenueFollowUpInsights";

type Props = {
  clinicId: string;
  actions: AiRevenueAction[];
  loading: boolean;
  onWorkflowChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
  onOpenAction: (action: AiRevenueAction) => void;
};

function contactLabel(action: AiRevenueAction) {
  return action.customer.phoneNumber || action.customer.phoneMasked || action.customer.memberId || "No contact detail";
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    const apiMessage = typeof error.response?.data?.error === "string" ? error.response.data.error : null;
    return apiMessage || error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function canApprove(action: AiRevenueAction, draftText: string | undefined) {
  return Boolean((draftText ?? action.message.draftText ?? action.message.approvedText ?? "").trim());
}

export function AiRevenueApprovalTab({
  clinicId,
  actions,
  loading,
  onWorkflowChanged,
  onError,
  onOpenAction,
}: Props) {
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});

  const approvalActions = actions.filter((action) =>
    ["new", "draft_ready", "pending_approval", "approved", "closed", "sent"].includes(action.status),
  );

  async function runWorkflow(action: AiRevenueAction, work: () => Promise<string>) {
    setBusyActionId(action.id);
    onError("");

    try {
      const message = await work();
      setEditingActionId(null);
      await onWorkflowChanged(message);
    } catch (error) {
      onError(getApiErrorMessage(error, "AI Revenue message workflow could not be updated."));
    } finally {
      setBusyActionId(null);
    }
  }

  function draftTextFor(action: AiRevenueAction) {
    return draftEdits[action.id] ?? action.message.draftText ?? action.message.approvedText ?? "";
  }

  if (loading && actions.length === 0) {
    return <div className="inline-note inline-note--loading">Loading message approval queue...</div>;
  }

  if (approvalActions.length === 0) {
    return (
      <EmptyState
        label="No message approval actions yet"
        detail="Generate AI Revenue opportunities first, then prepare drafts for manager or reception approval."
      />
    );
  }

  return (
    <div className="ai-revenue-action-list">
      {approvalActions.map((action) => {
        const isEditing = editingActionId === action.id;
        const draftText = draftTextFor(action);
        const busy = busyActionId === action.id;
        const approvedText = action.message.approvedText ?? "";
        const locked = action.status === "closed" || action.status === "sent";
        const canMarkSent = action.status === "approved" && approvedText.trim().length > 0;
        const relatedActions = actions.filter((item) => item.id !== action.id && isSameCustomerAction(item, action));

        return (
          <article key={action.id} className="ai-revenue-action-card ai-revenue-approval-card">
            <div className="ai-revenue-action-card__top">
              <div>
                <span className={`status-pill status-pill--${action.priority}`}>{action.priority}</span>
                <span className="ai-revenue-action-card__source">{titleCase(action.actionType)}</span>
              </div>
              <strong>{titleCase(action.status)}</strong>
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

            <AiFollowUpSnapshot action={action} relatedActions={relatedActions} />

            <div className="ai-revenue-message-box">
              <div>
                <strong>Myanmar draft message</strong>
                <span>Ready to send after staff approval. Edit only if needed.</span>
              </div>
              {isEditing ? (
                <textarea
                  className="telegram-settings__textarea"
                  rows={4}
                  maxLength={1200}
                  value={draftText}
                  onChange={(event) =>
                    setDraftEdits((current) => ({
                      ...current,
                      [action.id]: event.target.value,
                    }))
                  }
                />
              ) : (
                <p>{action.message.draftText || "No draft generated yet."}</p>
              )}
            </div>

            <div className="ai-revenue-message-box ai-revenue-message-box--approved">
              <div>
                <strong>Approved message</strong>
                <span>{action.message.approvedAt ? `Approved at ${action.message.approvedAt}` : "Waiting for approval"}</span>
              </div>
              <p>{approvedText || "No approved message yet."}</p>
            </div>

            <div className="ai-revenue-action-card__footer ai-revenue-approval-card__actions">
              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--secondary"
                onClick={() =>
                  void runWorkflow(action, async () => {
                    await generateAiRevenueMessage(action.id, { clinicId });
                    return `Draft generated for ${action.customer.customerName ?? action.title}.`;
                  })
                }
                disabled={busy || locked}
              >
                Generate Draft
              </button>

              {isEditing ? (
                <button
                  type="button"
                  className="button telegram-settings__button telegram-settings__button--secondary"
                  onClick={() =>
                    void runWorkflow(action, async () => {
                      await generateAiRevenueMessage(action.id, { clinicId, draftText });
                      return `Draft edited for ${action.customer.customerName ?? action.title}.`;
                    })
                  }
                  disabled={busy || locked || !draftText.trim()}
                >
                  Save Edit
                </button>
              ) : (
                <button
                  type="button"
                  className="button telegram-settings__button telegram-settings__button--secondary"
                  onClick={() => {
                    setDraftEdits((current) => ({
                      ...current,
                      [action.id]: draftText,
                    }));
                    setEditingActionId(action.id);
                  }}
                  disabled={busy || locked}
                >
                  Edit
                </button>
              )}

              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--primary"
                onClick={() =>
                  void runWorkflow(action, async () => {
                    if (isEditing && draftText.trim() !== (action.message.draftText ?? "").trim()) {
                      await generateAiRevenueMessage(action.id, { clinicId, draftText });
                    }
                    await approveAiRevenueMessage(action.id, { clinicId, approvedText: draftText });
                    return `Message approved for ${action.customer.customerName ?? action.title}.`;
                  })
                }
                disabled={busy || locked || !canApprove(action, draftText)}
              >
                Approve
              </button>

              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--danger"
                onClick={() =>
                  void runWorkflow(action, async () => {
                    await rejectAiRevenueAction(action.id, { clinicId, note: "Rejected from GT V2 approval queue." });
                    return `Action rejected for ${action.customer.customerName ?? action.title}.`;
                  })
                }
                disabled={busy || locked}
              >
                Reject
              </button>

              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--secondary"
                onClick={() =>
                  void runWorkflow(action, async () => {
                    await markAiRevenueMessageSent(action.id, {
                      clinicId,
                      channel: "manual",
                      messageText: approvedText,
                    });
                    return `Message marked sent for ${action.customer.customerName ?? action.title}.`;
                  })
                }
                disabled={busy || !canMarkSent}
              >
                Mark Sent
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
