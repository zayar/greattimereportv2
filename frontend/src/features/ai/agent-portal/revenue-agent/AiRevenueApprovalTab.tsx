import { useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import {
  approveAiRevenueMessage,
  generateAiRevenueMessage,
  markAiRevenueMessageSent,
  recordAiRevenueFollowUp,
} from "../../../../api/aiRevenueAgent";
import { EmptyState } from "../../../../components/StatusViews";
import type {
  AiRevenueAction,
  AiRevenueFollowUpChannel,
  AiRevenueFollowUpResult,
  AiRevenueFollowUpScheduleOption,
  AiRevenueSuppressionScope,
} from "../../../../types/domain";
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

type QueueKey = "today" | "overdue" | "tomorrow" | "next_7_days" | "all_open" | "completed" | "suppressed";

type FollowUpDraft = {
  channel: AiRevenueFollowUpChannel;
  result: AiRevenueFollowUpResult;
  note: string;
  scheduleOption: AiRevenueFollowUpScheduleOption;
  customDate: string;
  suppressionScope: AiRevenueSuppressionScope;
  bookingId: string;
  appointmentDateTime: string;
  treatmentCompletedAt: string;
  packageSessionUsedAt: string;
  packageSessionsRecovered: string;
  repurchaseInvoiceNumber: string;
  repurchaseRevenue: string;
};

const QUEUES: Array<{ value: QueueKey; label: string }> = [
  { value: "today", label: "Today" },
  { value: "overdue", label: "Overdue" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "next_7_days", label: "Next 7 Days" },
  { value: "all_open", label: "All Open" },
  { value: "completed", label: "Completed" },
  { value: "suppressed", label: "Suppressed" },
];

const CHANNEL_OPTIONS: Array<{ value: AiRevenueFollowUpChannel; label: string }> = [
  { value: "phone_call", label: "Phone call" },
  { value: "manual_viber", label: "Manual Viber" },
  { value: "in_person", label: "In person" },
  { value: "other", label: "Other" },
];

const RESULT_OPTIONS: Array<{ value: AiRevenueFollowUpResult; label: string }> = [
  { value: "no_answer", label: "No answer" },
  { value: "call_later", label: "Call later" },
  { value: "interested", label: "Interested" },
  { value: "appointment_booked", label: "Appointment booked" },
  { value: "already_booked", label: "Already booked" },
  { value: "already_visited", label: "Already visited" },
  { value: "not_interested", label: "Not interested" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "do_not_contact", label: "Do not contact" },
  { value: "completed", label: "Completed" },
  { value: "other", label: "Other" },
];

const SCHEDULE_OPTIONS: Array<{ value: AiRevenueFollowUpScheduleOption; label: string }> = [
  { value: "tomorrow", label: "Tomorrow" },
  { value: "three_days", label: "3 days" },
  { value: "one_week", label: "1 week" },
  { value: "next_month", label: "Next month" },
  { value: "custom", label: "Custom date" },
  { value: "none", label: "No next follow-up" },
];

const SUPPRESSION_OPTIONS: Array<{ value: AiRevenueSuppressionScope; label: string }> = [
  { value: "customer", label: "Customer" },
  { value: "service", label: "Service" },
  { value: "phone_only", label: "Phone" },
  { value: "channel", label: "Channel" },
];

const TERMINAL_RESULTS = new Set<AiRevenueFollowUpResult>([
  "appointment_booked",
  "already_booked",
  "already_visited",
  "not_interested",
  "wrong_number",
  "do_not_contact",
  "completed",
]);

function todayDateKey() {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function evidenceValue(action: AiRevenueAction, labels: string[]) {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  return action.evidence.find((item) => normalizedLabels.includes(item.label.toLowerCase()))?.value;
}

function serviceLabel(action: AiRevenueAction) {
  return (
    action.service.serviceName ||
    action.appointment.serviceName ||
    String(evidenceValue(action, ["Focused treatment", "Last service", "Service", "Service(s)"]) ?? "") ||
    "Not set"
  );
}

function therapistLabel(action: AiRevenueAction) {
  return (
    action.appointment.practitionerName ||
    String(evidenceValue(action, ["Primary therapist", "Practitioner", "Therapist"]) ?? "") ||
    "Not set"
  );
}

function lastVisitDate(action: AiRevenueAction) {
  return (
    action.service.lastVisitDate ||
    action.packageInfo.lastUsedAt ||
    String(evidenceValue(action, ["Last visit date", "Last usage date", "Focused treatment last usage"]) ?? "") ||
    null
  );
}

function daysSinceLastVisit(action: AiRevenueAction) {
  const directValue = evidenceValue(action, ["Days since last visit", "Days since activity", "Days since last usage"]);
  const numeric = Number(directValue);
  if (Number.isFinite(numeric)) {
    return Math.round(numeric);
  }

  const lastVisit = lastVisitDate(action);
  if (!lastVisit) {
    return null;
  }

  const parsed = new Date(`${lastVisit.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return Math.max(0, Math.round((Date.now() - parsed.getTime()) / 86_400_000));
}

function dueDate(action: AiRevenueAction) {
  return action.followUp.nextFollowUpDate || action.followUp.dueDate || action.service.reminderDate || action.dateKey;
}

function followUpStatus(action: AiRevenueAction) {
  if (action.followUp.status) {
    return action.followUp.status;
  }
  if (action.resolution?.suppressCustomer) {
    return "suppressed";
  }
  if (action.resolution || ["closed", "skipped", "not_interested"].includes(action.status)) {
    return "completed";
  }
  return "open";
}

function isActionInQueue(action: AiRevenueAction, queue: QueueKey, today: string) {
  const status = followUpStatus(action);
  const due = dueDate(action);
  const tomorrow = addDays(today, 1);
  const nextWeek = addDays(today, 7);

  if (queue === "completed") {
    return status === "completed";
  }
  if (queue === "suppressed") {
    return status === "suppressed";
  }
  if (status !== "open") {
    return false;
  }
  if (queue === "all_open") {
    return true;
  }
  if (queue === "today") {
    return !due || due === today;
  }
  if (queue === "overdue") {
    return Boolean(due && due < today);
  }
  if (queue === "tomorrow") {
    return due === tomorrow;
  }
  return Boolean(due && due > tomorrow && due <= nextWeek);
}

function defaultDraft(action: AiRevenueAction): FollowUpDraft {
  return {
    channel: action.followUp.lastChannel ?? "phone_call",
    result: "no_answer",
    note: "",
    scheduleOption: "tomorrow",
    customDate: "",
    suppressionScope: "customer",
    bookingId: action.appointment.bookingId ?? "",
    appointmentDateTime: action.appointment.appointmentDateTime ?? "",
    treatmentCompletedAt: "",
    packageSessionUsedAt: "",
    packageSessionsRecovered: "",
    repurchaseInvoiceNumber: "",
    repurchaseRevenue: "",
  };
}

function nextSuppressionScope(result: AiRevenueFollowUpResult): AiRevenueSuppressionScope {
  return result === "wrong_number" ? "phone_only" : "customer";
}

function numericOrNull(value: string) {
  if (!value.trim()) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function lastFollowUpText(action: AiRevenueAction) {
  if (!action.followUp.lastContactedAt && !action.followUp.lastResult) {
    return "No follow-up yet";
  }

  return [
    action.followUp.lastContactedAt ?? "Date not recorded",
    action.followUp.lastResult ? titleCase(action.followUp.lastResult) : null,
    action.followUp.lastChannel ? titleCase(action.followUp.lastChannel) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function AiRevenueApprovalTab({
  clinicId,
  actions,
  loading,
  onWorkflowChanged,
  onError,
  onOpenAction,
}: Props) {
  const today = todayDateKey();
  const [activeQueue, setActiveQueue] = useState<QueueKey>("today");
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FollowUpDraft>>({});
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});

  const queueCounts = useMemo(
    () =>
      Object.fromEntries(
        QUEUES.map((queue) => [
          queue.value,
          actions.filter((action) => isActionInQueue(action, queue.value, today)).length,
        ]),
      ) as Record<QueueKey, number>,
    [actions, today],
  );

  const queueActions = useMemo(
    () =>
      actions
        .filter((action) => isActionInQueue(action, activeQueue, today))
        .sort((left, right) => {
          const leftDue = dueDate(left) || "9999-12-31";
          const rightDue = dueDate(right) || "9999-12-31";
          return leftDue.localeCompare(rightDue) || right.priorityScore - left.priorityScore;
        }),
    [actions, activeQueue, today],
  );

  const selectedAction =
    queueActions.find((action) => action.id === selectedActionId) ?? queueActions[0] ?? null;
  const selectedDraft = selectedAction ? drafts[selectedAction.id] ?? defaultDraft(selectedAction) : null;
  const relatedActions = selectedAction
    ? actions.filter((item) => item.id !== selectedAction.id && isSameCustomerAction(item, selectedAction))
    : [];
  const editableMessage = selectedAction
    ? messageDrafts[selectedAction.id] ?? selectedAction.message.draftText ?? selectedAction.message.approvedText ?? ""
    : "";

  useEffect(() => {
    if (!selectedAction && queueActions[0]) {
      setSelectedActionId(queueActions[0].id);
    }
    if (selectedAction && !queueActions.some((action) => action.id === selectedAction.id)) {
      setSelectedActionId(queueActions[0]?.id ?? null);
    }
  }, [queueActions, selectedAction]);

  function updateDraft(action: AiRevenueAction, patch: Partial<FollowUpDraft>) {
    setDrafts((current) => ({
      ...current,
      [action.id]: {
        ...(current[action.id] ?? defaultDraft(action)),
        ...patch,
      },
    }));
  }

  async function runWorkflow(action: AiRevenueAction, fallback: string, work: () => Promise<string>) {
    setBusyActionId(action.id);
    onError("");

    try {
      const message = await work();
      await onWorkflowChanged(message);
    } catch (error) {
      onError(getApiErrorMessage(error, fallback));
    } finally {
      setBusyActionId(null);
    }
  }

  if (loading && actions.length === 0) {
    return <div className="inline-note inline-note--loading">Loading follow-up workbench...</div>;
  }

  if (actions.length === 0) {
    return (
      <EmptyState
        label="No follow-up opportunities yet"
        detail="Generate AI Revenue opportunities first. Staff follow-up attempts and outcomes will be stored in Firestore workflow records."
      />
    );
  }

  return (
    <div className="ai-revenue-followup-workbench">
      <div className="ai-revenue-followup-queues" role="tablist" aria-label="Follow-up queues">
        {QUEUES.map((queue) => (
          <button
            key={queue.value}
            type="button"
            role="tab"
            aria-selected={activeQueue === queue.value}
            className={
              activeQueue === queue.value
                ? "ai-revenue-followup-queue ai-revenue-followup-queue--active"
                : "ai-revenue-followup-queue"
            }
            onClick={() => setActiveQueue(queue.value)}
          >
            <span>{queue.label}</span>
            <strong>{queueCounts[queue.value].toLocaleString("en-US")}</strong>
          </button>
        ))}
      </div>

      {queueActions.length === 0 ? (
        <EmptyState
          label={`No ${QUEUES.find((queue) => queue.value === activeQueue)?.label.toLowerCase()} follow-ups`}
          detail="Switch queues or generate opportunities to find more staff follow-up work."
        />
      ) : (
        <div className="ai-revenue-followup-layout">
          <div className="ai-revenue-followup-table-wrap">
            <table className="ai-revenue-followup-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Service</th>
                  <th>Visit / Therapist</th>
                  <th>Reason</th>
                  <th>AI Suggestion</th>
                  <th>Last Follow-up</th>
                  <th>Due</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {queueActions.map((action) => {
                  const selected = selectedAction?.id === action.id;
                  const daysSince = daysSinceLastVisit(action);

                  return (
                    <tr key={action.id} className={selected ? "ai-revenue-followup-table__selected-row" : undefined}>
                      <td>
                        <strong>{action.customer.customerName ?? "Customer"}</strong>
                        <span>{contactLabel(action)}</span>
                      </td>
                      <td>
                        <strong>{serviceLabel(action)}</strong>
                        <span>{titleCase(action.actionType)}</span>
                      </td>
                      <td>
                        <strong>{lastVisitDate(action) ?? "Not set"}</strong>
                        <span>
                          {daysSince == null ? "Days not set" : `${daysSince.toLocaleString("en-US")} days`} · {therapistLabel(action)}
                        </span>
                      </td>
                      <td>
                        <strong>{action.reason}</strong>
                        <span>{titleCase(action.priority)} priority · Score {action.priorityScore}</span>
                      </td>
                      <td>{action.recommendedAction}</td>
                      <td>
                        <strong>{lastFollowUpText(action)}</strong>
                        <span>{action.followUp.lastNote || "No note"}</span>
                      </td>
                      <td>
                        <strong>{dueDate(action) || "Not scheduled"}</strong>
                        <span>{titleCase(followUpStatus(action))}</span>
                      </td>
                      <td>
                        <div className="ai-revenue-followup-row-actions">
                          <button
                            type="button"
                            className="button telegram-settings__button telegram-settings__button--secondary telegram-settings__button--compact"
                            onClick={() => setSelectedActionId(action.id)}
                          >
                            Log
                          </button>
                          <button
                            type="button"
                            className="button telegram-settings__button telegram-settings__button--secondary telegram-settings__button--compact"
                            onClick={() => onOpenAction(action)}
                          >
                            Open
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedAction && selectedDraft ? (
            <aside className="ai-revenue-followup-panel">
              <div className="ai-revenue-followup-panel__header">
                <div>
                  <span>{titleCase(followUpStatus(selectedAction))}</span>
                  <h3>{selectedAction.customer.customerName ?? selectedAction.title}</h3>
                  <p>{contactLabel(selectedAction)} · {serviceLabel(selectedAction)}</p>
                </div>
                <span className={`status-pill status-pill--${selectedAction.priority}`}>{selectedAction.priority}</span>
              </div>

              <AiFollowUpSnapshot action={selectedAction} relatedActions={relatedActions} />

              <form
                className="ai-revenue-followup-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runWorkflow(selectedAction, "Human follow-up could not be recorded.", async () => {
                    const result = await recordAiRevenueFollowUp(selectedAction.id, {
                      clinicId,
                      channel: selectedDraft.channel,
                      result: selectedDraft.result,
                      note: selectedDraft.note.trim() || null,
                      scheduleOption: selectedDraft.scheduleOption,
                      nextFollowUpDate: selectedDraft.scheduleOption === "custom" ? selectedDraft.customDate || null : null,
                      suppressionScope:
                        selectedDraft.result === "wrong_number" || selectedDraft.result === "do_not_contact"
                          ? selectedDraft.suppressionScope
                          : null,
                      bookingId: selectedDraft.bookingId.trim() || null,
                      appointmentDateTime: selectedDraft.appointmentDateTime || null,
                      treatmentCompletedAt: selectedDraft.treatmentCompletedAt || null,
                      packageSessionUsedAt: selectedDraft.packageSessionUsedAt || null,
                      packageSessionsRecovered: numericOrNull(selectedDraft.packageSessionsRecovered),
                      repurchaseInvoiceNumber: selectedDraft.repurchaseInvoiceNumber.trim() || null,
                      repurchaseRevenue: numericOrNull(selectedDraft.repurchaseRevenue),
                      revenueAttributedAt:
                        selectedDraft.repurchaseRevenue.trim() || selectedDraft.repurchaseInvoiceNumber.trim()
                          ? new Date().toISOString()
                          : null,
                    });
                    setDrafts((current) => ({
                      ...current,
                      [selectedAction.id]: defaultDraft(result.action),
                    }));
                    return `${titleCase(selectedDraft.result)} recorded for ${selectedAction.customer.customerName ?? selectedAction.title}.`;
                  });
                }}
              >
                <div className="ai-revenue-followup-form__grid">
                  <label className="field">
                    <span>Contact type</span>
                    <select
                      value={selectedDraft.channel}
                      onChange={(event) => updateDraft(selectedAction, { channel: event.target.value as AiRevenueFollowUpChannel })}
                      disabled={busyActionId === selectedAction.id}
                    >
                      {CHANNEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Result</span>
                    <select
                      value={selectedDraft.result}
                      onChange={(event) => {
                        const result = event.target.value as AiRevenueFollowUpResult;
                        updateDraft(selectedAction, {
                          result,
                          scheduleOption: TERMINAL_RESULTS.has(result) ? "none" : selectedDraft.scheduleOption,
                          suppressionScope: nextSuppressionScope(result),
                        });
                      }}
                      disabled={busyActionId === selectedAction.id}
                    >
                      {RESULT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Next follow-up</span>
                    <select
                      value={selectedDraft.scheduleOption}
                      onChange={(event) => updateDraft(selectedAction, { scheduleOption: event.target.value as AiRevenueFollowUpScheduleOption })}
                      disabled={busyActionId === selectedAction.id || TERMINAL_RESULTS.has(selectedDraft.result)}
                    >
                      {SCHEDULE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedDraft.scheduleOption === "custom" ? (
                    <label className="field">
                      <span>Custom date</span>
                      <input
                        type="date"
                        value={selectedDraft.customDate}
                        onChange={(event) => updateDraft(selectedAction, { customDate: event.target.value })}
                        disabled={busyActionId === selectedAction.id}
                        required
                      />
                    </label>
                  ) : null}
                </div>

                {(selectedDraft.result === "wrong_number" || selectedDraft.result === "do_not_contact") ? (
                  <label className="field">
                    <span>Suppress future recommendations by</span>
                    <select
                      value={selectedDraft.suppressionScope}
                      onChange={(event) => updateDraft(selectedAction, { suppressionScope: event.target.value as AiRevenueSuppressionScope })}
                      disabled={busyActionId === selectedAction.id}
                    >
                      {SUPPRESSION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {["appointment_booked", "already_booked", "already_visited", "completed"].includes(selectedDraft.result) ? (
                  <div className="ai-revenue-followup-form__grid">
                    <label className="field">
                      <span>Booking ID</span>
                      <input
                        type="text"
                        value={selectedDraft.bookingId}
                        onChange={(event) => updateDraft(selectedAction, { bookingId: event.target.value })}
                        placeholder="Optional GT Business booking ID"
                        disabled={busyActionId === selectedAction.id}
                      />
                    </label>
                    <label className="field">
                      <span>Appointment time</span>
                      <input
                        type="datetime-local"
                        value={selectedDraft.appointmentDateTime}
                        onChange={(event) => updateDraft(selectedAction, { appointmentDateTime: event.target.value })}
                        disabled={busyActionId === selectedAction.id}
                      />
                    </label>
                    <label className="field">
                      <span>Treatment completed at</span>
                      <input
                        type="datetime-local"
                        value={selectedDraft.treatmentCompletedAt}
                        onChange={(event) => updateDraft(selectedAction, { treatmentCompletedAt: event.target.value })}
                        disabled={busyActionId === selectedAction.id}
                      />
                    </label>
                  </div>
                ) : null}

                <div className="ai-revenue-followup-form__grid">
                  <label className="field">
                    <span>Package sessions used</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={selectedDraft.packageSessionsRecovered}
                      onChange={(event) => updateDraft(selectedAction, { packageSessionsRecovered: event.target.value })}
                      disabled={busyActionId === selectedAction.id}
                    />
                  </label>
                  <label className="field">
                    <span>Repurchase invoice</span>
                    <input
                      type="text"
                      value={selectedDraft.repurchaseInvoiceNumber}
                      onChange={(event) => updateDraft(selectedAction, { repurchaseInvoiceNumber: event.target.value })}
                      disabled={busyActionId === selectedAction.id}
                    />
                  </label>
                  <label className="field">
                    <span>Repurchase revenue</span>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={selectedDraft.repurchaseRevenue}
                      onChange={(event) => updateDraft(selectedAction, { repurchaseRevenue: event.target.value })}
                      disabled={busyActionId === selectedAction.id}
                    />
                  </label>
                </div>

                <label className="field">
                  <span>Staff note</span>
                  <textarea
                    className="telegram-settings__textarea"
                    rows={4}
                    maxLength={2000}
                    value={selectedDraft.note}
                    onChange={(event) => updateDraft(selectedAction, { note: event.target.value })}
                    placeholder="Record call comment, Viber/manual message summary, customer preference, or next step."
                    disabled={busyActionId === selectedAction.id}
                  />
                </label>

                <div className="ai-revenue-followup-panel__actions">
                  <button
                    type="submit"
                    className="button telegram-settings__button telegram-settings__button--primary"
                    disabled={
                      busyActionId === selectedAction.id ||
                      (selectedDraft.scheduleOption === "custom" && !selectedDraft.customDate)
                    }
                  >
                    {busyActionId === selectedAction.id ? "Recording..." : "Record Follow-up"}
                  </button>
                  <button
                    type="button"
                    className="button telegram-settings__button telegram-settings__button--secondary"
                    onClick={() => onOpenAction(selectedAction)}
                    disabled={busyActionId === selectedAction.id}
                  >
                    Open Action Detail
                  </button>
                </div>
              </form>

              <details className="ai-revenue-detail__disclosure">
                <summary>Draft / approval tools</summary>
                <div className="ai-revenue-message-box">
                  <div>
                    <strong>Manual outreach text</strong>
                    <span>
                      {selectedAction.message.approvedAt ? `Approved at ${selectedAction.message.approvedAt}` : "Optional"}
                    </span>
                  </div>
                  <textarea
                    className="telegram-settings__textarea"
                    rows={4}
                    maxLength={1200}
                    value={editableMessage}
                    onChange={(event) =>
                      setMessageDrafts((current) => ({
                        ...current,
                        [selectedAction.id]: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="ai-revenue-followup-panel__actions">
                  <button
                    type="button"
                    className="button telegram-settings__button telegram-settings__button--secondary"
                    disabled={busyActionId === selectedAction.id}
                    onClick={() =>
                      void runWorkflow(selectedAction, "Draft could not be generated.", async () => {
                        const action = await generateAiRevenueMessage(selectedAction.id, { clinicId });
                        setMessageDrafts((current) => ({
                          ...current,
                          [selectedAction.id]: action.message.draftText ?? "",
                        }));
                        return `Draft generated for ${selectedAction.customer.customerName ?? selectedAction.title}.`;
                      })
                    }
                  >
                    Generate Draft
                  </button>
                  <button
                    type="button"
                    className="button telegram-settings__button telegram-settings__button--primary"
                    disabled={busyActionId === selectedAction.id || !editableMessage.trim()}
                    onClick={() =>
                      void runWorkflow(selectedAction, "Message could not be approved.", async () => {
                        await generateAiRevenueMessage(selectedAction.id, { clinicId, draftText: editableMessage });
                        await approveAiRevenueMessage(selectedAction.id, { clinicId, approvedText: editableMessage });
                        return `Message approved for ${selectedAction.customer.customerName ?? selectedAction.title}.`;
                      })
                    }
                  >
                    Approve Text
                  </button>
                  <button
                    type="button"
                    className="button telegram-settings__button telegram-settings__button--secondary"
                    disabled={
                      busyActionId === selectedAction.id ||
                      selectedAction.status !== "approved" ||
                      !(selectedAction.message.approvedText ?? "").trim()
                    }
                    onClick={() =>
                      void runWorkflow(selectedAction, "Manual outreach could not be marked sent.", async () => {
                        await markAiRevenueMessageSent(selectedAction.id, {
                          clinicId,
                          channel: "manual_viber",
                          messageText: selectedAction.message.approvedText ?? "",
                        });
                        return `Approved manual outreach marked sent for ${selectedAction.customer.customerName ?? selectedAction.title}.`;
                      })
                    }
                  >
                    Mark Manual Viber Sent
                  </button>
                </div>
              </details>
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}
