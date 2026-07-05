import { useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { getAiRevenueAuditLogs } from "../../../../api/aiRevenueAgent";
import { EmptyState, ErrorState } from "../../../../components/StatusViews";
import type {
  AiRevenueAction,
  AiRevenueAuditActorType,
  AiRevenueAuditLog,
} from "../../../../types/domain";
import { AiRevenueTimeline } from "./AiRevenueTimeline";

type Props = {
  clinicId: string;
  actions: AiRevenueAction[];
  loading: boolean;
  onOpenAction: (action: AiRevenueAction) => void;
};

function getApiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error)) {
    const apiMessage = typeof error.response?.data?.error === "string" ? error.response.data.error : null;
    return apiMessage || error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function titleCase(value: string | null | undefined) {
  return (value || "not set")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function customerLabel(action: AiRevenueAction | undefined, actionId?: string | null) {
  if (!action) {
    return actionId || "Unknown action";
  }

  return action.customer.customerName ?? action.title;
}

function actionMatchesCustomer(action: AiRevenueAction | undefined, search: string) {
  if (!search.trim()) {
    return true;
  }
  if (!action) {
    return false;
  }

  const needle = search.trim().toLowerCase();
  return [
    action.customer.customerName,
    action.customer.phoneNumber,
    action.customer.phoneMasked,
    action.customer.memberId,
    action.title,
  ].some((value) => (value ?? "").toLowerCase().includes(needle));
}

export function AiRevenueAuditTab({ clinicId, actions, loading, onOpenAction }: Props) {
  const [auditLogs, setAuditLogs] = useState<AiRevenueAuditLog[]>([]);
  const [busy, setBusy] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dateKey, setDateKey] = useState("");
  const [selectedActionId, setSelectedActionId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [status, setStatus] = useState("");
  const [actorType, setActorType] = useState<"" | AiRevenueAuditActorType>("");
  const actionMap = useMemo(() => new Map(actions.map((action) => [action.id, action])), [actions]);
  const statusOptions = useMemo(
    () => [...new Set(actions.map((action) => action.status))].sort(),
    [actions],
  );

  async function loadAuditLogs(showLoader = true) {
    if (showLoader) {
      setBusy(true);
    }
    setErrorMessage(null);

    try {
      const logs = await getAiRevenueAuditLogs({
        clinicId,
        actionId: selectedActionId || undefined,
        actorType: actorType || undefined,
        limit: 300,
      });
      setAuditLogs(logs);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "AI Revenue audit logs could not be loaded."));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadAuditLogs(true);
  }, [clinicId, selectedActionId, actorType]);

  const filteredLogs = auditLogs.filter((log) => {
    const action = log.actionId ? actionMap.get(log.actionId) : undefined;
    if (dateKey && !log.createdAt.startsWith(dateKey)) {
      return false;
    }
    if (status && action?.status !== status) {
      return false;
    }
    if (!actionMatchesCustomer(action, customerSearch)) {
      return false;
    }
    return true;
  });

  return (
    <div className="ai-revenue-audit">
      <div className="ai-revenue-filter-grid">
        <label className="field">
          <span>Date</span>
          <input type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} />
        </label>
        <label className="field">
          <span>Action</span>
          <select value={selectedActionId} onChange={(event) => setSelectedActionId(event.target.value)}>
            <option value="">All actions</option>
            {actions.map((action) => (
              <option key={action.id} value={action.id}>
                {customerLabel(action)} · {titleCase(action.status)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Customer</span>
          <input
            type="search"
            value={customerSearch}
            onChange={(event) => setCustomerSearch(event.target.value)}
            placeholder="Name, phone, member ID"
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {titleCase(option)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Actor</span>
          <select value={actorType} onChange={(event) => setActorType(event.target.value as "" | AiRevenueAuditActorType)}>
            <option value="">All actors</option>
            <option value="ai">AI</option>
            <option value="staff">Staff</option>
            <option value="customer">Customer</option>
            <option value="system">System</option>
          </select>
        </label>
        <div className="ai-revenue-filter-grid__actions">
          <button
            type="button"
            className="button telegram-settings__button telegram-settings__button--secondary"
            onClick={() => void loadAuditLogs(true)}
            disabled={busy || loading}
          >
            {busy ? "Loading..." : "Refresh"}
          </button>
          <button
            type="button"
            className="button telegram-settings__button telegram-settings__button--secondary"
            onClick={() => {
              setDateKey("");
              setSelectedActionId("");
              setCustomerSearch("");
              setStatus("");
              setActorType("");
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {errorMessage ? <ErrorState label="Audit log issue" detail={errorMessage} /> : null}

      <div className="ai-revenue-audit__summary">
        <strong>{filteredLogs.length.toLocaleString("en-US")} event(s)</strong>
        <span>Showing latest traceable AI, staff, customer, and system actions.</span>
      </div>

      {busy && auditLogs.length === 0 ? (
        <div className="inline-note inline-note--loading">Loading audit events...</div>
      ) : filteredLogs.length === 0 ? (
        <EmptyState label="No audit events match these filters" detail="Try clearing filters or refreshing the audit log." />
      ) : (
        <div className="ai-revenue-audit__events">
          {filteredLogs.map((log) => {
            const action = log.actionId ? actionMap.get(log.actionId) : undefined;

            return (
              <article key={log.id} className="ai-revenue-audit-card">
                <div className="ai-revenue-audit-card__header">
                  <div>
                    <strong>{customerLabel(action, log.actionId)}</strong>
                    <span>
                      {titleCase(log.action)} · {log.createdAt}
                    </span>
                  </div>
                  {action ? (
                    <button
                      type="button"
                      className="button telegram-settings__button telegram-settings__button--secondary"
                      onClick={() => onOpenAction(action)}
                    >
                      View Timeline
                    </button>
                  ) : null}
                </div>
                <AiRevenueTimeline logs={[log]} />
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
