import { useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { recordAiRevenueFollowUpAttempt } from "../../../../api/aiRevenueAgent";
import { EmptyState } from "../../../../components/StatusViews";
import type {
  AiRevenueAction,
  AiRevenueContactChannel,
  AiRevenueContactResult,
  AiRevenueOutcomeType,
  AiRevenueSuppressionScope,
  AiRevenueVisibilityState,
} from "../../../../types/domain";
import {
  AiStaffFollowUpSnapshot,
  daysSinceLastVisit as insightDaysSinceLastVisit,
  isSameCustomerAction,
  myanmarReason,
  quickAnswer,
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

type ScheduleOption = "none" | "tomorrow" | "three_days" | "one_week" | "next_month" | "custom";

type AttemptDraft = {
  channel: AiRevenueContactChannel;
  result: AiRevenueContactResult;
  scheduleOption: ScheduleOption;
  customDate: string;
  note: string;
  messageText: string;
  bookingId: string;
  appointmentDateTime: string;
  suppressCustomer: boolean;
  suppressionScope: "customer" | "phone_only";
  permanentSuppression: boolean;
  suppressionUntil: string;
};

type ModalState = {
  action: AiRevenueAction;
  channel: AiRevenueContactChannel;
};

type FollowUpAttemptPayload = Parameters<typeof recordAiRevenueFollowUpAttempt>[1];

const QUEUES: Array<{ value: QueueKey; label: string }> = [
  { value: "today", label: "Today" },
  { value: "overdue", label: "Overdue" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "next_7_days", label: "Next 7 Days" },
  { value: "all_open", label: "All Open" },
  { value: "completed", label: "Completed" },
  { value: "suppressed", label: "Suppressed" },
];

const SUMMARY_CARDS: Array<{ key: SummaryKey; label: string }> = [
  { key: "dueToday", label: "Due Today" },
  { key: "overdue", label: "Overdue" },
  { key: "contactedToday", label: "Contacted Today" },
  { key: "scheduled", label: "Scheduled" },
  { key: "completed", label: "Completed" },
  { key: "suppressed", label: "Suppressed" },
];

const CHANNEL_OPTIONS: Array<{ value: AiRevenueContactChannel; label: string }> = [
  { value: "phone", label: "Phone" },
  { value: "viber_manual", label: "Manual Viber" },
  { value: "in_person", label: "In person" },
  { value: "other", label: "Other" },
];

const RESULT_OPTIONS: Array<{ value: AiRevenueContactResult; label: string }> = [
  { value: "no_answer", label: "No answer" },
  { value: "call_later", label: "Call later" },
  { value: "message_sent", label: "Message sent" },
  { value: "customer_replied", label: "Customer replied" },
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

const SCHEDULE_OPTIONS: Array<{ value: ScheduleOption; label: string }> = [
  { value: "none", label: "None" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "three_days", label: "3 days" },
  { value: "one_week", label: "1 week" },
  { value: "next_month", label: "Next month" },
  { value: "custom", label: "Custom" },
];

const TERMINAL_RESULTS = new Set<AiRevenueContactResult>([
  "appointment_booked",
  "already_booked",
  "already_visited",
  "not_interested",
  "wrong_number",
  "do_not_contact",
  "completed",
]);

const NOTE_REQUIRED_RESULTS = new Set<AiRevenueContactResult>([
  "call_later",
  "appointment_booked",
  "not_interested",
  "wrong_number",
  "do_not_contact",
]);

type SummaryKey = "dueToday" | "overdue" | "contactedToday" | "scheduled" | "completed" | "suppressed";

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

function addMonths(dateKey: string, months: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function formatNumber(value: number | null | undefined) {
  return Math.round(value ?? 0).toLocaleString("en-US");
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    const apiMessage = typeof error.response?.data?.error === "string" ? error.response.data.error : null;
    return apiMessage || error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function evidenceValue(action: AiRevenueAction, labels: string[]) {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  return action.evidence.find((item) => normalizedLabels.includes(item.label.toLowerCase()))?.value;
}

function focusUsage(action: AiRevenueAction) {
  return action.serviceUsage?.find((item) => item.isFocusService) ?? action.serviceUsage?.[0] ?? null;
}

function serviceLabel(action: AiRevenueAction) {
  const usage = focusUsage(action);
  return (
    action.service.serviceName ||
    usage?.serviceName ||
    action.appointment.serviceName ||
    String(evidenceValue(action, ["Focused treatment", "Last service", "Service", "Service(s)"]) ?? "") ||
    "Not set"
  );
}

function phoneLabel(action: AiRevenueAction) {
  return action.customer.phoneNumber || action.customer.phoneMasked || "No phone";
}

function lastVisitDate(action: AiRevenueAction) {
  return (
    action.service.lastVisitDate ||
    focusUsage(action)?.latestUsageDate ||
    action.packageInfo.lastUsedAt ||
    String(evidenceValue(action, ["Last visit date", "Last usage date", "Focused treatment last usage"]) ?? "") ||
    null
  );
}

function daysSinceLastVisit(action: AiRevenueAction) {
  if (typeof action.service.lastVisitSinceDays === "number" && Number.isFinite(action.service.lastVisitSinceDays)) {
    return Math.max(0, Math.round(action.service.lastVisitSinceDays));
  }

  return insightDaysSinceLastVisit(action);
}

function therapistLabel(action: AiRevenueAction) {
  return (
    action.service.lastTreatmentTherapist ||
    action.service.preferredTherapist ||
    action.appointment.practitionerName ||
    String(evidenceValue(action, ["Primary therapist", "Practitioner", "Therapist"]) ?? "") ||
    "Not set"
  );
}

function dueDateKey(action: AiRevenueAction) {
  return action.dueDateKey || action.dateKey;
}

function dateKeyFromValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function visibilityState(action: AiRevenueAction): AiRevenueVisibilityState {
  if (action.visibilityState) {
    return action.visibilityState;
  }
  if (action.followUp.status === "suppressed" || action.resolution?.suppressCustomer) {
    return "suppressed";
  }
  if (action.followUp.status === "completed" || action.resolution || ["closed", "skipped", "not_interested"].includes(action.status)) {
    return "completed";
  }
  return action.followUp.nextFollowUpDate || action.nextFollowUpAt ? "scheduled" : "active";
}

function isOpenVisibility(visibility: AiRevenueVisibilityState) {
  return visibility === "active" || visibility === "scheduled";
}

function isActionInQueue(action: AiRevenueAction, queue: QueueKey, today: string) {
  const visibility = visibilityState(action);
  const due = dueDateKey(action);
  const tomorrow = addDays(today, 1);
  const nextWeek = addDays(today, 7);

  if (queue === "completed") {
    return visibility === "completed";
  }
  if (queue === "suppressed") {
    return visibility === "suppressed";
  }
  if (visibility === "completed" || visibility === "suppressed" || visibility === "hidden") {
    return false;
  }
  if (queue === "all_open") {
    return isOpenVisibility(visibility);
  }
  if (queue === "today") {
    return visibility === "active" && due <= today;
  }
  if (queue === "overdue") {
    return visibility === "active" && due < today;
  }
  if (queue === "tomorrow") {
    return isOpenVisibility(visibility) && due === tomorrow;
  }
  return isOpenVisibility(visibility) && due >= tomorrow && due <= nextWeek;
}

function lastContactDateKey(action: AiRevenueAction) {
  return dateKeyFromValue(action.lastContactAt ?? action.followUp.lastContactedAt);
}

function lastFollowUpAt(action: AiRevenueAction) {
  const value = action.lastContactAt ?? action.followUp.lastContactedAt;
  return value ? value.replace("T", " ").slice(0, 16) : "Not recorded";
}

function lastResult(action: AiRevenueAction) {
  return action.lastContactResult ?? action.followUp.lastResult ?? null;
}

function lastNote(action: AiRevenueAction) {
  return action.lastFollowUpNote || action.followUp.lastNote || "No note";
}

function displayReason(action: AiRevenueAction, relatedActions: AiRevenueAction[]) {
  return action.displayReason || action.reason || myanmarReason(action, relatedActions);
}

function aiSuggestion(action: AiRevenueAction, relatedActions: AiRevenueAction[]) {
  return action.aiSuggestion || action.recommendedAction || quickAnswer(action, relatedActions);
}

function toDatetimeLocalValue(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 16);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIsoFromDatetimeLocal(value: string) {
  if (!value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function toIsoFromDateKey(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = new Date(`${value}T09:00:00`);
  return Number.isNaN(parsed.getTime()) ? `${value}T09:00:00` : parsed.toISOString();
}

function nextFollowUpDateKey(draft: AttemptDraft, today: string) {
  if (draft.scheduleOption === "none") {
    return null;
  }
  if (draft.scheduleOption === "custom") {
    return draft.customDate || null;
  }
  if (draft.scheduleOption === "tomorrow") {
    return addDays(today, 1);
  }
  if (draft.scheduleOption === "three_days") {
    return addDays(today, 3);
  }
  if (draft.scheduleOption === "one_week") {
    return addDays(today, 7);
  }
  return addMonths(today, 1);
}

function defaultDraft(
  action: AiRevenueAction,
  channel: AiRevenueContactChannel,
  initialResult?: AiRevenueContactResult,
  initialScheduleOption?: ScheduleOption,
): AttemptDraft {
  const result = initialResult ?? (channel === "viber_manual" ? "message_sent" : "no_answer");
  const isSuppressionResult = result === "wrong_number" || result === "do_not_contact";

  return {
    channel,
    result,
    scheduleOption: initialScheduleOption ?? (result === "call_later" ? "tomorrow" : "none"),
    customDate: "",
    note: "",
    messageText: action.message.approvedText ?? action.message.draftText ?? "",
    bookingId: action.appointment.bookingId ?? "",
    appointmentDateTime: toDatetimeLocalValue(action.appointment.appointmentDateTime),
    suppressCustomer: isSuppressionResult,
    suppressionScope: suppressionScopeForResult(result),
    permanentSuppression: true,
    suppressionUntil: "",
  };
}

function suppressionScopeForResult(result: AiRevenueContactResult): "customer" | "phone_only" {
  return result === "wrong_number" ? "phone_only" : "customer";
}

function outcomeTypeForResult(result: AiRevenueContactResult): AiRevenueOutcomeType | null {
  if (result === "appointment_booked") {
    return "appointment_booked";
  }
  if (result === "already_visited") {
    return "customer_came";
  }
  if (result === "completed") {
    return "treatment_completed";
  }
  return null;
}

function buildAppointment(action: AiRevenueAction, draft: AttemptDraft): FollowUpAttemptPayload["appointment"] {
  if (draft.result !== "appointment_booked") {
    return undefined;
  }

  return {
    bookingId: draft.bookingId.trim() || action.appointment.bookingId || null,
    appointmentDateTime: toIsoFromDatetimeLocal(draft.appointmentDateTime),
    serviceId: action.service.serviceId ?? action.appointment.serviceId ?? null,
    serviceName: serviceLabel(action),
    practitionerId: action.appointment.practitionerId ?? null,
    practitionerName: action.service.preferredTherapist ?? action.appointment.practitionerName ?? null,
    note: draft.note.trim() || null,
  };
}

function buildOutcome(action: AiRevenueAction, draft: AttemptDraft): FollowUpAttemptPayload["outcome"] {
  const outcomeType = outcomeTypeForResult(draft.result);
  if (!outcomeType) {
    return undefined;
  }

  const appointmentDateTime = toIsoFromDatetimeLocal(draft.appointmentDateTime);
  return {
    outcomeType,
    bookingId: draft.bookingId.trim() || action.appointment.bookingId || null,
    serviceId: action.service.serviceId ?? action.appointment.serviceId ?? null,
    serviceName: serviceLabel(action),
    attributionType: "manual",
    eventAt: appointmentDateTime ?? new Date().toISOString(),
  };
}

function validateDraft(draft: AttemptDraft, today: string) {
  const nextDate = nextFollowUpDateKey(draft, today);
  if (draft.result === "call_later" && !nextDate) {
    return "Choose a next follow-up date for call later.";
  }
  if (NOTE_REQUIRED_RESULTS.has(draft.result) && !draft.note.trim()) {
    return "Add a note before saving this result.";
  }
  if ((draft.result === "wrong_number" || draft.result === "do_not_contact") && draft.suppressCustomer && !draft.permanentSuppression && !draft.suppressionUntil) {
    return "Choose a suppression end date or mark the suppression permanent.";
  }
  return null;
}

function emptyStateForQueue(queue: QueueKey) {
  if (queue === "today") {
    return "No follow-ups due today. Great job.";
  }
  if (queue === "overdue") {
    return "No overdue follow-ups.";
  }
  if (queue === "completed") {
    return "No completed follow-ups for this filter.";
  }
  if (queue === "suppressed") {
    return "No suppressed follow-ups for this filter.";
  }
  return "No follow-ups for this queue.";
}

function relatedActionsFor(actions: AiRevenueAction[], action: AiRevenueAction) {
  return actions.filter((item) => item.id !== action.id && isSameCustomerAction(item, action));
}

function computeSummary(actions: AiRevenueAction[], today: string): Record<SummaryKey, number> {
  return actions.reduce<Record<SummaryKey, number>>(
    (summary, action) => {
      const visibility = visibilityState(action);
      const due = dueDateKey(action);
      if (visibility === "active" && due === today) {
        summary.dueToday += 1;
      }
      if (visibility === "active" && due < today) {
        summary.overdue += 1;
      }
      if (lastContactDateKey(action) === today) {
        summary.contactedToday += 1;
      }
      if (visibility === "scheduled") {
        summary.scheduled += 1;
      }
      if (visibility === "completed") {
        summary.completed += 1;
      }
      if (visibility === "suppressed") {
        summary.suppressed += 1;
      }
      return summary;
    },
    {
      dueToday: 0,
      overdue: 0,
      contactedToday: 0,
      scheduled: 0,
      completed: 0,
      suppressed: 0,
    },
  );
}

export function AiRevenueFollowUpAttemptModal({
  clinicId,
  action,
  relatedActions,
  initialChannel,
  initialResult,
  initialScheduleOption,
  onClose,
  onSaved,
  onError,
}: {
  clinicId: string;
  action: AiRevenueAction;
  relatedActions: AiRevenueAction[];
  initialChannel: AiRevenueContactChannel;
  initialResult?: AiRevenueContactResult;
  initialScheduleOption?: ScheduleOption;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const today = todayDateKey();
  const [draft, setDraft] = useState<AttemptDraft>(() =>
    defaultDraft(action, initialChannel, initialResult, initialScheduleOption),
  );
  const [saving, setSaving] = useState(false);
  const validationMessage = validateDraft(draft, today);
  const isSuppressionResult = draft.result === "wrong_number" || draft.result === "do_not_contact";
  const showMessageText = draft.channel === "viber_manual" || draft.result === "message_sent";
  const showAppointmentFields = draft.result === "appointment_booked";
  const nextDate = nextFollowUpDateKey(draft, today);

  function updateDraft(patch: Partial<AttemptDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function handleSave() {
    const validation = validateDraft(draft, today);
    if (validation) {
      onError(validation);
      return;
    }

    setSaving(true);
    onError("");

    try {
      await recordAiRevenueFollowUpAttempt(action.id, {
        clinicId,
        channel: draft.channel,
        result: draft.result,
        note: draft.note.trim() || null,
        messageText: showMessageText ? draft.messageText.trim() || null : null,
        nextFollowUpDateKey: nextDate,
        nextFollowUpAt: toIsoFromDateKey(nextDate),
        suppressCustomer: isSuppressionResult ? draft.suppressCustomer : undefined,
        suppressionScope: isSuppressionResult && draft.suppressCustomer ? draft.suppressionScope : undefined,
        suppressionUntil:
          isSuppressionResult && draft.suppressCustomer && !draft.permanentSuppression
            ? draft.suppressionUntil || null
            : null,
        permanentSuppression: isSuppressionResult && draft.suppressCustomer ? draft.permanentSuppression : undefined,
        appointment: buildAppointment(action, draft),
        outcome: buildOutcome(action, draft),
      });
      onClose();
      await onSaved(`Follow-up recorded for ${action.customer.customerName ?? action.title}.`);
    } catch (error) {
      onError(getApiErrorMessage(error, "Follow-up attempt could not be recorded."));
      setSaving(false);
    }
  }

  return (
    <div className="ai-revenue-modal-backdrop" role="presentation">
      <section className="ai-revenue-modal ai-revenue-modal--compact ai-revenue-followup-modal" role="dialog" aria-modal="true" aria-labelledby="follow-up-modal-title">
        <div className="ai-revenue-modal__header">
          <div>
            <strong id="follow-up-modal-title">Record follow-up</strong>
            <span>{action.customer.customerName ?? action.title} - {phoneLabel(action)} - {serviceLabel(action)}</span>
          </div>
          <button
            type="button"
            className="button telegram-settings__button telegram-settings__button--secondary telegram-settings__button--compact"
            onClick={onClose}
            disabled={saving}
          >
            Close
          </button>
        </div>

        <div className="ai-revenue-followup-modal__snapshot">
          <AiStaffFollowUpSnapshot action={action} relatedActions={relatedActions} />
        </div>

        <div className="ai-revenue-followup-form ai-revenue-followup-modal__form">
          <label className="field">
            <span>Contact method</span>
            <select
              value={draft.channel}
              onChange={(event) => updateDraft({ channel: event.target.value as AiRevenueContactChannel })}
              disabled={saving}
            >
              {CHANNEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <span>Result</span>
            <div className="ai-revenue-followup-choice-grid">
              {RESULT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    draft.result === option.value
                      ? "ai-revenue-followup-choice ai-revenue-followup-choice--active"
                      : "ai-revenue-followup-choice"
                  }
                  onClick={() => {
                    const result = option.value;
                    updateDraft({
                      result,
                      scheduleOption:
                        TERMINAL_RESULTS.has(result)
                          ? "none"
                          : result === "call_later" && draft.scheduleOption === "none"
                            ? "tomorrow"
                            : draft.scheduleOption,
                      suppressCustomer: result === "wrong_number" || result === "do_not_contact" ? true : draft.suppressCustomer,
                      suppressionScope: suppressionScopeForResult(result),
                    });
                  }}
                  disabled={saving}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>Next follow-up</span>
            <div className="ai-revenue-followup-choice-grid ai-revenue-followup-choice-grid--schedule">
              {SCHEDULE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    draft.scheduleOption === option.value
                      ? "ai-revenue-followup-choice ai-revenue-followup-choice--active"
                      : "ai-revenue-followup-choice"
                  }
                  onClick={() => updateDraft({ scheduleOption: option.value })}
                  disabled={saving || TERMINAL_RESULTS.has(draft.result)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {draft.scheduleOption === "custom" ? (
            <label className="field">
              <span>Custom date</span>
              <input
                type="date"
                value={draft.customDate}
                onChange={(event) => updateDraft({ customDate: event.target.value })}
                disabled={saving}
              />
            </label>
          ) : null}

          {showMessageText ? (
            <label className="field">
              <span>Manual message text</span>
              <textarea
                className="telegram-settings__textarea"
                rows={3}
                maxLength={1200}
                value={draft.messageText}
                onChange={(event) => updateDraft({ messageText: event.target.value })}
                disabled={saving}
              />
            </label>
          ) : null}

          {showAppointmentFields ? (
            <div className="ai-revenue-followup-form__grid">
              <label className="field">
                <span>Booking ID</span>
                <input
                  type="text"
                  value={draft.bookingId}
                  onChange={(event) => updateDraft({ bookingId: event.target.value })}
                  disabled={saving}
                />
              </label>
              <label className="field">
                <span>Appointment date</span>
                <input
                  type="datetime-local"
                  value={draft.appointmentDateTime}
                  onChange={(event) => updateDraft({ appointmentDateTime: event.target.value })}
                  disabled={saving}
                />
              </label>
            </div>
          ) : null}

          {isSuppressionResult ? (
            <div className="ai-revenue-followup-suppression">
              <label className="ai-revenue-followup-check">
                <input
                  type="checkbox"
                  checked={draft.suppressCustomer}
                  onChange={(event) => updateDraft({ suppressCustomer: event.target.checked })}
                  disabled={saving}
                />
                <span>Suppress future follow-ups</span>
              </label>
              <div className="ai-revenue-followup-form__grid">
                <label className="field">
                  <span>Suppression scope</span>
                  <select
                    value={draft.suppressionScope}
                    onChange={(event) => updateDraft({ suppressionScope: event.target.value as "customer" | "phone_only" })}
                    disabled={saving || !draft.suppressCustomer}
                  >
                    <option value="customer">Suppress customer</option>
                    <option value="phone_only">Suppress phone only</option>
                  </select>
                </label>
                <label className="field">
                  <span>Duration</span>
                  <select
                    value={draft.permanentSuppression ? "permanent" : "until"}
                    onChange={(event) => updateDraft({ permanentSuppression: event.target.value === "permanent" })}
                    disabled={saving || !draft.suppressCustomer}
                  >
                    <option value="permanent">Permanent</option>
                    <option value="until">Until date</option>
                  </select>
                </label>
                {!draft.permanentSuppression ? (
                  <label className="field">
                    <span>Suppress until</span>
                    <input
                      type="date"
                      value={draft.suppressionUntil}
                      onChange={(event) => updateDraft({ suppressionUntil: event.target.value })}
                      disabled={saving || !draft.suppressCustomer}
                    />
                  </label>
                ) : null}
              </div>
            </div>
          ) : null}

          <label className="field">
            <span>Note</span>
            <textarea
              className="telegram-settings__textarea"
              rows={4}
              maxLength={2000}
              value={draft.note}
              onChange={(event) => updateDraft({ note: event.target.value })}
              placeholder="Record the staff comment, customer response, preference, or next step."
              disabled={saving}
            />
          </label>

          {validationMessage ? <p className="inline-note inline-note--warning">{validationMessage}</p> : null}

          <div className="ai-revenue-followup-modal__actions">
            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--primary"
              onClick={() => void handleSave()}
              disabled={saving || Boolean(validationMessage)}
            >
              {saving ? "Saving..." : "Save Follow-up"}
            </button>
            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function AiRevenueFollowUpTab({
  clinicId,
  actions,
  loading,
  onWorkflowChanged,
  onError,
  onOpenAction,
}: Props) {
  const today = todayDateKey();
  const [activeQueue, setActiveQueue] = useState<QueueKey>("today");
  const [modalState, setModalState] = useState<ModalState | null>(null);

  const summary = useMemo(() => computeSummary(actions, today), [actions, today]);
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
          const leftDue = dueDateKey(left);
          const rightDue = dueDateKey(right);
          return leftDue.localeCompare(rightDue) || right.priorityScore - left.priorityScore;
        }),
    [actions, activeQueue, today],
  );

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
      <div className="ai-revenue-followup-summary" aria-label="Follow-up summary">
        {SUMMARY_CARDS.map((card) => (
          <div key={card.key} className="ai-revenue-followup-summary__card">
            <span>{card.label}</span>
            <strong>{formatNumber(summary[card.key])}</strong>
          </div>
        ))}
      </div>

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
          label={emptyStateForQueue(activeQueue)}
          detail="Switch queues or generate opportunities to find more staff follow-up work."
        />
      ) : (
        <div className="ai-revenue-followup-table-wrap">
          <table className="ai-revenue-followup-table">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Follow-up Service</th>
                <th>Last Visit</th>
                <th>Last Visit Since</th>
                <th>Last Treatment Therapist</th>
                <th>Reason</th>
                <th>AI Suggestion</th>
                <th>Last Follow-up</th>
                <th>Last Result</th>
                <th>Note</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {queueActions.map((action) => {
                const relatedActions = relatedActionsFor(actions, action);
                const lastVisitSinceDays = daysSinceLastVisit(action);
                const result = lastResult(action);

                return (
                  <tr key={action.id}>
                    <td>
                      <span className={`status-pill status-pill--${action.priority}`}>{titleCase(action.priority)}</span>
                    </td>
                    <td>
                      <strong>{action.customer.customerName ?? "Customer"}</strong>
                      <span>{action.customer.memberId || action.customer.customerKey || action.id}</span>
                    </td>
                    <td>{phoneLabel(action)}</td>
                    <td>
                      <strong>{serviceLabel(action)}</strong>
                      <span>{titleCase(action.actionType)}</span>
                    </td>
                    <td>{lastVisitDate(action) ?? "Not set"}</td>
                    <td>{lastVisitSinceDays == null ? "Not set" : `${formatNumber(lastVisitSinceDays)} days`}</td>
                    <td>{therapistLabel(action)}</td>
                    <td>
                      <strong>{displayReason(action, relatedActions)}</strong>
                      <span>{myanmarReason(action, relatedActions)}</span>
                    </td>
                    <td>{aiSuggestion(action, relatedActions)}</td>
                    <td>
                      <strong>{lastFollowUpAt(action)}</strong>
                      <span>Due {dueDateKey(action)}</span>
                    </td>
                    <td>{result ? titleCase(result) : "No result"}</td>
                    <td>{lastNote(action)}</td>
                    <td>
                      <div className="ai-revenue-followup-row-actions">
                        <button
                          type="button"
                          className="button telegram-settings__button telegram-settings__button--secondary telegram-settings__button--compact"
                          onClick={() => setModalState({ action, channel: "phone" })}
                        >
                          Log Call
                        </button>
                        <button
                          type="button"
                          className="button telegram-settings__button telegram-settings__button--secondary telegram-settings__button--compact"
                          onClick={() => setModalState({ action, channel: "viber_manual" })}
                        >
                          Log Viber
                        </button>
                        <button
                          type="button"
                          className="button telegram-settings__button telegram-settings__button--secondary telegram-settings__button--compact"
                          onClick={() => onOpenAction(action)}
                        >
                          Open Detail
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalState ? (
        <AiRevenueFollowUpAttemptModal
          clinicId={clinicId}
          action={modalState.action}
          relatedActions={relatedActionsFor(actions, modalState.action)}
          initialChannel={modalState.channel}
          onClose={() => setModalState(null)}
          onSaved={onWorkflowChanged}
          onError={onError}
        />
      ) : null}
    </div>
  );
}
