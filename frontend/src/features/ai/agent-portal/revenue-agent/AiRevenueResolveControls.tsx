import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { resolveAiRevenueAction } from "../../../../api/aiRevenueAgent";
import type {
  AiRevenueAction,
  AiRevenueResolutionReason,
  AiRevenueSuppressionScope,
} from "../../../../types/domain";
import { titleCase } from "./AiRevenueFollowUpInsights";

type Props = {
  clinicId: string;
  action: AiRevenueAction;
  disabled?: boolean;
  onResolved: (message: string) => Promise<void>;
  onError: (message: string) => void;
};

const REASON_OPTIONS: Array<{ value: AiRevenueResolutionReason; label: string; helper: string }> = [
  { value: "already_contacted", label: "Already contacted", helper: "Close this opportunity only." },
  { value: "already_booked", label: "Already booked", helper: "Close because staff already arranged booking." },
  { value: "not_interested", label: "Not interested", helper: "Default: snooze future recommendations temporarily." },
  { value: "moved_overseas", label: "Moved overseas", helper: "Default: suppress future recommendations." },
  { value: "deceased", label: "Deceased / do not contact", helper: "Default: permanently suppress future recommendations." },
  { value: "wrong_number", label: "Wrong number", helper: "Default: suppress this phone hash." },
  { value: "duplicate_customer", label: "Duplicate customer", helper: "Default: suppress duplicate record." },
  { value: "do_not_contact", label: "Do not contact", helper: "Default: permanently suppress future recommendations." },
  { value: "staff_decision", label: "Staff decision", helper: "Close or suppress based on staff judgement." },
  { value: "other", label: "Other", helper: "Use note for context." },
];

function getApiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    const apiMessage = typeof error.response?.data?.error === "string" ? error.response.data.error : null;
    return apiMessage || error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function defaultSuppress(reason: AiRevenueResolutionReason) {
  return ["not_interested", "moved_overseas", "deceased", "wrong_number", "duplicate_customer", "do_not_contact"].includes(reason);
}

function defaultPermanent(reason: AiRevenueResolutionReason) {
  return ["moved_overseas", "deceased", "wrong_number", "duplicate_customer", "do_not_contact"].includes(reason);
}

function defaultScope(reason: AiRevenueResolutionReason): AiRevenueSuppressionScope {
  return reason === "wrong_number" ? "phone_only" : "customer";
}

function isResolved(action: AiRevenueAction) {
  return Boolean(action.resolution || ["closed", "skipped", "not_interested"].includes(action.status));
}

export function AiRevenueResolveControls({
  clinicId,
  action,
  disabled,
  onResolved,
  onError,
}: Props) {
  const [reason, setReason] = useState<AiRevenueResolutionReason>("already_contacted");
  const [note, setNote] = useState("");
  const [suppressCustomer, setSuppressCustomer] = useState(defaultSuppress(reason));
  const [permanentSuppression, setPermanentSuppression] = useState(defaultPermanent(reason));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const resolved = isResolved(action);
  const selectedReason = REASON_OPTIONS.find((item) => item.value === reason);

  useEffect(() => {
    setSuppressCustomer(defaultSuppress(reason));
    setPermanentSuppression(defaultPermanent(reason));
  }, [reason]);

  if (resolved) {
    return (
      <div className="ai-revenue-resolve-status">
        <strong>Resolved</strong>
        <span>
          {action.resolution?.reason ? titleCase(action.resolution.reason) : titleCase(action.status)}
          {action.resolution?.suppressCustomer ? " · Future AI recommendations suppressed/snoozed" : ""}
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="button telegram-settings__button telegram-settings__button--secondary"
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
      >
        Resolve
      </button>

      {open ? (
        <div
          className="ai-revenue-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setOpen(false);
            }
          }}
        >
          <section
            className="ai-revenue-modal ai-revenue-modal--compact"
            role="dialog"
            aria-modal="true"
            aria-label="Resolve AI Revenue opportunity"
          >
            <div className="ai-revenue-modal__header">
              <div>
                <strong>Resolve this opportunity</strong>
                <span>{action.customer.customerName ?? action.title}</span>
              </div>
              <button
                type="button"
                className="button telegram-settings__button telegram-settings__button--secondary"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="ai-revenue-resolve-controls">
              <p>Close it without deleting history. Suppression stops future AI recommendations for matching customers.</p>

              <div className="ai-revenue-resolve-controls__grid">
                <label className="field">
                  <span>Reason</span>
                  <select
                    value={reason}
                    onChange={(event) => setReason(event.target.value as AiRevenueResolutionReason)}
                    disabled={disabled || busy}
                  >
                    {REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <small>{selectedReason?.helper}</small>
                </label>

                <label className="field">
                  <span>Note</span>
                  <input
                    type="text"
                    maxLength={1000}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Optional staff note"
                    disabled={disabled || busy}
                  />
                </label>
              </div>

              <div className="ai-revenue-resolve-controls__checks">
                <label>
                  <input
                    type="checkbox"
                    checked={suppressCustomer}
                    onChange={(event) => setSuppressCustomer(event.target.checked)}
                    disabled={disabled || busy}
                  />
                  <span>Hide this customer from future AI Revenue opportunities</span>
                </label>

                {suppressCustomer ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={permanentSuppression}
                      onChange={(event) => setPermanentSuppression(event.target.checked)}
                      disabled={disabled || busy || defaultPermanent(reason)}
                    />
                    <span>{permanentSuppression ? "Permanent suppression" : "Snooze for 30 days"}</span>
                  </label>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              className="button telegram-settings__button telegram-settings__button--primary ai-revenue-modal__primary-action"
              disabled={disabled || busy}
              onClick={() => {
                setBusy(true);
                onError("");
                void resolveAiRevenueAction(action.id, {
                  clinicId,
                  reason,
                  note: note.trim() || null,
                  suppressCustomer,
                  permanentSuppression,
                  snoozeDays: permanentSuppression ? undefined : 30,
                  scope: defaultScope(reason),
                })
                  .then(() => {
                    setOpen(false);
                    return onResolved(
                      suppressCustomer
                        ? `${action.customer.customerName ?? action.title} resolved and hidden from future AI recommendations.`
                        : `${action.customer.customerName ?? action.title} resolved.`,
                    );
                  })
                  .catch((error) => onError(getApiErrorMessage(error, "AI Revenue opportunity could not be resolved.")))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Resolving..." : "Resolve Opportunity"}
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
