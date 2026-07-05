import { useState } from "react";
import { isAxiosError } from "axios";
import {
  requestAiRevenueBooking,
  updateAiRevenueAppointment,
} from "../../../../api/aiRevenueAgent";
import { EmptyState } from "../../../../components/StatusViews";
import type { AiRevenueAction, AiRevenueActionStatus } from "../../../../types/domain";

type Props = {
  clinicId: string;
  actions: AiRevenueAction[];
  loading: boolean;
  onWorkflowChanged: (message: string) => Promise<void>;
  onError: (message: string) => void;
  onOpenAction: (action: AiRevenueAction) => void;
};

type AppointmentDraft = {
  requestedDateTime: string;
  serviceName: string;
  practitionerName: string;
  note: string;
  bookingId: string;
};

type AppointmentUpdateType =
  | "appointment_confirmed"
  | "reminder_sent"
  | "customer_came"
  | "cancelled"
  | "no_show"
  | "completed";

const APPOINTMENT_STATUSES = new Set<AiRevenueActionStatus>([
  "customer_replied",
  "human_takeover",
  "appointment_requested",
  "appointment_created",
  "appointment_confirmed",
  "reminder_sent",
  "customer_came",
  "cancelled",
  "no_show",
  "completed",
  "revenue_attributed",
]);

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

function defaultDraft(action: AiRevenueAction): AppointmentDraft {
  return {
    requestedDateTime: action.appointment.appointmentDateTime ?? "",
    serviceName: action.appointment.serviceName ?? action.service.serviceName ?? "",
    practitionerName: action.appointment.practitionerName ?? "",
    note: action.appointment.note ?? "",
    bookingId: action.appointment.bookingId ?? "",
  };
}

function canRequestBooking(action: AiRevenueAction) {
  return ["customer_replied", "human_takeover", "sent", "appointment_requested"].includes(action.status);
}

function reminderStatus(action: AiRevenueAction) {
  return action.appointment.reminderSentAt ? `Sent ${action.appointment.reminderSentAt}` : "Not sent";
}

function revenueStatus(action: AiRevenueAction) {
  const cashRevenue = Number(action.revenue.actualRevenue ?? 0);
  const packageSessions = Number(action.revenue.packageSessionsRecovered ?? 0);
  if (cashRevenue > 0) {
    return `${cashRevenue.toLocaleString("en-US")} MMK`;
  }
  if (packageSessions > 0) {
    return `${packageSessions.toLocaleString("en-US")} package session(s)`;
  }
  return action.revenue.revenueAt ? "Recorded" : "Not recorded";
}

export function AiRevenueAppointmentsTab({
  clinicId,
  actions,
  loading,
  onWorkflowChanged,
  onError,
  onOpenAction,
}: Props) {
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, AppointmentDraft>>({});

  const appointmentActions = actions.filter((action) => APPOINTMENT_STATUSES.has(action.status));

  function draftFor(action: AiRevenueAction) {
    return drafts[action.id] ?? defaultDraft(action);
  }

  function updateDraft(action: AiRevenueAction, patch: Partial<AppointmentDraft>) {
    setDrafts((current) => ({
      ...current,
      [action.id]: {
        ...draftFor(action),
        ...patch,
      },
    }));
  }

  async function runAppointmentWorkflow(action: AiRevenueAction, work: () => Promise<string>) {
    setBusyActionId(action.id);
    onError("");

    try {
      const message = await work();
      await onWorkflowChanged(message);
    } catch (error) {
      onError(getApiErrorMessage(error, "Appointment workflow could not be updated."));
    } finally {
      setBusyActionId(null);
    }
  }

  async function markStatus(action: AiRevenueAction, status: AppointmentUpdateType) {
    const patch = {
      clinicId,
      updateType: status,
      bookingId: action.appointment.bookingId ?? null,
      appointmentDateTime: action.appointment.appointmentDateTime ?? null,
    };

    await updateAiRevenueAppointment(action.id, patch);
  }

  if (loading && actions.length === 0) {
    return <div className="inline-note inline-note--loading">Loading appointment controls...</div>;
  }

  if (appointmentActions.length === 0) {
    return (
      <EmptyState
        label="No AI Revenue appointment actions yet"
        detail="Record a positive customer reply first, then request a booking from the Conversations or Appointments tab."
      />
    );
  }

  return (
    <div className="ai-revenue-action-list">
      <div className="telegram-settings__callout ai-revenue-mode-note">
        <strong>Appointment Request MVP</strong>
        <span>
          Direct APICORE booking creation is not enabled in GT V2 yet. This tab stores appointment requests and linked booking IDs for staff processing.
        </span>
      </div>

      {appointmentActions.map((action) => {
        const draft = draftFor(action);
        const busy = busyActionId === action.id;

        return (
          <article key={action.id} className="ai-revenue-action-card ai-revenue-appointment-card">
            <div className="ai-revenue-action-card__top">
              <div>
                <span className={`status-pill status-pill--${action.priority}`}>{action.priority}</span>
                <span className="ai-revenue-action-card__source">{titleCase(action.status)}</span>
              </div>
              <strong>{action.appointment.bookingStatus || "No booking status"}</strong>
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

            <div className="ai-revenue-evidence-grid">
              <div className="ai-revenue-evidence-item">
                <span>Requested time</span>
                <strong>{action.appointment.appointmentDateTime || "Not requested"}</strong>
              </div>
              <div className="ai-revenue-evidence-item">
                <span>Booking ID</span>
                <strong>{action.appointment.bookingId || "Not linked"}</strong>
              </div>
              <div className="ai-revenue-evidence-item">
                <span>Status</span>
                <strong>{titleCase(action.status)}</strong>
              </div>
              <div className="ai-revenue-evidence-item">
                <span>Reminder status</span>
                <strong>{reminderStatus(action)}</strong>
              </div>
              <div className="ai-revenue-evidence-item">
                <span>Service</span>
                <strong>{action.appointment.serviceName || action.service.serviceName || "Not set"}</strong>
              </div>
              <div className="ai-revenue-evidence-item">
                <span>Practitioner</span>
                <strong>{action.appointment.practitionerName || "Any available"}</strong>
              </div>
              <div className="ai-revenue-evidence-item">
                <span>Revenue status</span>
                <strong>{revenueStatus(action)}</strong>
              </div>
            </div>

            <div className="ai-revenue-appointment-form">
              <label className="field">
                <span>Requested date/time</span>
                <input
                  type="datetime-local"
                  value={draft.requestedDateTime}
                  onChange={(event) => updateDraft(action, { requestedDateTime: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Service</span>
                <input
                  type="text"
                  value={draft.serviceName}
                  onChange={(event) => updateDraft(action, { serviceName: event.target.value })}
                  placeholder="Service name"
                />
              </label>
              <label className="field">
                <span>Practitioner</span>
                <input
                  type="text"
                  value={draft.practitionerName}
                  onChange={(event) => updateDraft(action, { practitionerName: event.target.value })}
                  placeholder="Optional"
                />
              </label>
              <label className="field ai-revenue-appointment-form__wide">
                <span>Request note</span>
                <textarea
                  className="telegram-settings__textarea"
                  rows={2}
                  maxLength={1200}
                  value={draft.note}
                  onChange={(event) => updateDraft(action, { note: event.target.value })}
                  placeholder="Customer preferred time, staff notes, or manual processing instructions"
                />
              </label>
              <label className="field">
                <span>Link booking ID</span>
                <input
                  type="text"
                  value={draft.bookingId}
                  onChange={(event) => updateDraft(action, { bookingId: event.target.value })}
                  placeholder="Booking ID from GT Business/APICORE"
                />
              </label>
            </div>

            {action.appointment.attributionNote ? (
              <div className="ai-revenue-message-box">
                <div>
                  <strong>AI attribution note</strong>
                  <span>{action.appointment.requestMode || "booking_request"}</span>
                </div>
                <p>{action.appointment.attributionNote}</p>
              </div>
            ) : null}

            <div className="ai-revenue-action-card__footer ai-revenue-approval-card__actions">
              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--primary"
                onClick={() =>
                  void runAppointmentWorkflow(action, async () => {
                    await requestAiRevenueBooking(action.id, {
                      clinicId,
                      requestedDateTime: draft.requestedDateTime || null,
                      serviceName: draft.serviceName || null,
                      practitionerName: draft.practitionerName || null,
                      note: draft.note || null,
                      mode: "booking_request",
                    });
                    return `Appointment requested for ${action.customer.customerName ?? action.title}.`;
                  })
                }
                disabled={busy || !canRequestBooking(action)}
              >
                Request Booking
              </button>

              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--secondary"
                onClick={() =>
                  void runAppointmentWorkflow(action, async () => {
                    await updateAiRevenueAppointment(action.id, {
                      clinicId,
                      bookingId: draft.bookingId,
                      appointmentDateTime: draft.requestedDateTime || action.appointment.appointmentDateTime || null,
                      bookingStatus: "BOOKED",
                      status: "appointment_created",
                    });
                    return `Booking linked for ${action.customer.customerName ?? action.title}.`;
                  })
                }
                disabled={busy || !draft.bookingId.trim()}
              >
                Link Booking ID
              </button>

              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--secondary"
                onClick={() =>
                  void runAppointmentWorkflow(action, async () => {
                    await markStatus(action, "appointment_confirmed");
                    return `Appointment confirmed for ${action.customer.customerName ?? action.title}.`;
                  })
                }
                disabled={busy}
              >
                Mark Confirmed
              </button>

              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--secondary"
                onClick={() =>
                  void runAppointmentWorkflow(action, async () => {
                    await markStatus(action, "reminder_sent");
                    return `Reminder marked sent for ${action.customer.customerName ?? action.title}.`;
                  })
                }
                disabled={busy}
              >
                Mark Reminder Sent
              </button>

              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--secondary"
                onClick={() =>
                  void runAppointmentWorkflow(action, async () => {
                    await updateAiRevenueAppointment(action.id, {
                      clinicId,
                      updateType: "sync_outcome",
                      syncOutcome: true,
                    });
                    return `Outcome synced for ${action.customer.customerName ?? action.title}.`;
                  })
                }
                disabled={busy || !action.appointment.bookingId}
              >
                Sync Outcome
              </button>

              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--secondary"
                onClick={() =>
                  void runAppointmentWorkflow(action, async () => {
                    await markStatus(action, "customer_came");
                    return `${action.customer.customerName ?? action.title} marked came.`;
                  })
                }
                disabled={busy}
              >
                Mark Came
              </button>

              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--danger"
                onClick={() =>
                  void runAppointmentWorkflow(action, async () => {
                    await markStatus(action, "cancelled");
                    return `Appointment cancelled for ${action.customer.customerName ?? action.title}.`;
                  })
                }
                disabled={busy}
              >
                Mark Cancelled
              </button>

              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--danger"
                onClick={() =>
                  void runAppointmentWorkflow(action, async () => {
                    await markStatus(action, "no_show");
                    return `${action.customer.customerName ?? action.title} marked no-show.`;
                  })
                }
                disabled={busy}
              >
                Mark No-show
              </button>

              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--secondary"
                onClick={() =>
                  void runAppointmentWorkflow(action, async () => {
                    await markStatus(action, "completed");
                    return `Appointment completed for ${action.customer.customerName ?? action.title}.`;
                  })
                }
                disabled={busy}
              >
                Mark Completed
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
