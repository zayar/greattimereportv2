import type { AiRevenueAuditLog } from "../../../../types/domain";

type Props = {
  logs: AiRevenueAuditLog[];
  emptyLabel?: string;
};

type AuditRecord = Record<string, unknown>;

type AuditHighlight =
  | {
      type: "value";
      label: string;
      value: string;
    }
  | {
      type: "change";
      label: string;
      before: string;
      after: string;
    };

const FIELD_LABELS: Record<string, string> = {
  appointmentDateTime: "Appointment time",
  attemptCount: "Attempts",
  bookingId: "Booking",
  channel: "Channel",
  closedReason: "Closed reason",
  contactAttemptId: "Contact attempt",
  dueDateKey: "Due date",
  lastContactResult: "Last result",
  lastFollowUpNote: "Last note",
  nextFollowUpAt: "Next follow-up",
  nextFollowUpDateKey: "Next date",
  note: "Note",
  outcomeLinkId: "Outcome link",
  outcomeType: "Outcome",
  packageSessionsRecovered: "Sessions recovered",
  result: "Result",
  revenueAmount: "Revenue",
  serviceName: "Service",
  status: "Status",
  suppressionScope: "Suppression",
  suppressionUntil: "Suppress until",
  visibilityState: "Queue",
  workflowState: "Workflow",
};

const PRIORITY_FIELDS = [
  "result",
  "channel",
  "status",
  "workflowState",
  "visibilityState",
  "dueDateKey",
  "nextFollowUpDateKey",
  "nextFollowUpAt",
  "note",
  "lastContactResult",
  "lastFollowUpNote",
  "closedReason",
  "serviceName",
  "bookingId",
  "appointmentDateTime",
  "outcomeType",
  "revenueAmount",
  "packageSessionsRecovered",
  "suppressionScope",
  "suppressionUntil",
  "contactAttemptId",
  "outcomeLinkId",
  "attemptCount",
] as const;

const NOISY_CHANGE_FIELDS = new Set(["createdAt", "updatedAt", "lastStatusAt", "lastStatusBy"]);

function titleCase(value: string | null | undefined) {
  return (value || "not set")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fieldLabel(field: string) {
  return FIELD_LABELS[field] ?? titleCase(field);
}

function isRecord(value: unknown): value is AuditRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPrimitive(value: unknown) {
  return value == null || ["string", "number", "boolean"].includes(typeof value);
}

function isEmptyValue(value: unknown) {
  return value == null || (typeof value === "string" && value.trim().length === 0);
}

function comparableValue(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isIsoTimestamp(value: string) {
  return /^\d{4}-\d{2}-\d{2}T/.test(value);
}

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function truncateValue(value: string, maxLength = 96) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

function formatAuditFieldValue(field: string, value: unknown) {
  if (value == null || value === "") {
    return "Not set";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    if (field === "revenueAmount") {
      return `${value.toLocaleString("en-US")} MMK`;
    }

    return value.toLocaleString("en-US");
  }

  if (typeof value === "string") {
    if (isIsoTimestamp(value)) {
      return formatTimestamp(value);
    }

    if (["note", "lastFollowUpNote", "reason", "displayReason", "aiSuggestion"].includes(field)) {
      return truncateValue(value);
    }

    if (/^[a-z0-9_:-]+$/i.test(value) && value.includes("_")) {
      return titleCase(value);
    }

    return truncateValue(value);
  }

  if (Array.isArray(value)) {
    return `${value.length.toLocaleString("en-US")} item${value.length === 1 ? "" : "s"}`;
  }

  if (isRecord(value)) {
    const count = Object.keys(value).length;
    return `${count.toLocaleString("en-US")} field${count === 1 ? "" : "s"}`;
  }

  return truncateValue(String(value));
}

function formatJsonValue(value: unknown) {
  if (value == null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shortIdentifier(value: string) {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function actorLabel(log: AiRevenueAuditLog) {
  return log.actorId ? `${titleCase(log.actorType)} · ${shortIdentifier(log.actorId)}` : titleCase(log.actorType);
}

function addValueHighlight(highlights: AuditHighlight[], usedFields: Set<string>, field: string, value: unknown) {
  if (isEmptyValue(value) || usedFields.has(field)) {
    return;
  }

  highlights.push({
    type: "value",
    label: fieldLabel(field),
    value: formatAuditFieldValue(field, value),
  });
  usedFields.add(field);
}

function addChangeHighlight(highlights: AuditHighlight[], usedFields: Set<string>, field: string, before: unknown, after: unknown) {
  if (usedFields.has(field) || NOISY_CHANGE_FIELDS.has(field) || comparableValue(before) === comparableValue(after)) {
    return;
  }

  highlights.push({
    type: "change",
    label: fieldLabel(field),
    before: formatAuditFieldValue(field, before),
    after: formatAuditFieldValue(field, after),
  });
  usedFields.add(field);
}

function buildAuditHighlights(log: AiRevenueAuditLog) {
  const beforeRecord = isRecord(log.beforeValue) ? log.beforeValue : null;
  const afterRecord = isRecord(log.afterValue) ? log.afterValue : null;
  const highlights: AuditHighlight[] = [];
  const usedFields = new Set<string>();

  if (afterRecord) {
    for (const field of PRIORITY_FIELDS) {
      if (field in afterRecord) {
        addValueHighlight(highlights, usedFields, field, afterRecord[field]);
      }

      if (highlights.length >= 8) {
        return highlights;
      }
    }
  }

  if (beforeRecord && afterRecord) {
    const fields = [...new Set([...PRIORITY_FIELDS, ...Object.keys(beforeRecord), ...Object.keys(afterRecord)])];

    for (const field of fields) {
      if (NOISY_CHANGE_FIELDS.has(field)) {
        continue;
      }

      const before = beforeRecord[field];
      const after = afterRecord[field];

      if (!isPrimitive(before) || !isPrimitive(after)) {
        if (comparableValue(before) !== comparableValue(after)) {
          addValueHighlight(highlights, usedFields, field, after);
        }
      } else {
        addChangeHighlight(highlights, usedFields, field, before, after);
      }

      if (highlights.length >= 8) {
        return highlights;
      }
    }
  }

  if (!afterRecord && !isEmptyValue(log.afterValue)) {
    addValueHighlight(highlights, usedFields, "after", log.afterValue);
  }

  return highlights;
}

export function AiRevenueTimeline({ logs, emptyLabel = "No timeline events yet." }: Props) {
  if (logs.length === 0) {
    return <p className="ai-revenue-timeline__empty">{emptyLabel}</p>;
  }

  return (
    <ol className="ai-revenue-timeline">
      {logs.map((log) => {
        const beforeValue = formatJsonValue(log.beforeValue);
        const afterValue = formatJsonValue(log.afterValue);
        const highlights = buildAuditHighlights(log);

        return (
          <li key={log.id} className="ai-revenue-timeline__item">
            <div className="ai-revenue-timeline__dot" aria-hidden="true" />
            <div className="ai-revenue-timeline__body">
              <div className="ai-revenue-timeline__header">
                <div>
                  <strong>{titleCase(log.action)}</strong>
                  <span title={log.createdAt}>{formatTimestamp(log.createdAt)}</span>
                </div>
                <small>{actorLabel(log)}</small>
              </div>
              <p>{log.description}</p>
              {beforeValue || afterValue ? (
                <>
                  {highlights.length > 0 ? (
                    <div className="ai-revenue-timeline__highlights">
                      {highlights.map((highlight) =>
                        highlight.type === "change" ? (
                          <span key={`${log.id}-${highlight.label}`} className="ai-revenue-timeline__change">
                            <strong>{highlight.label}</strong>
                            <span>{highlight.before}</span>
                            <em aria-hidden="true">to</em>
                            <span>{highlight.after}</span>
                          </span>
                        ) : (
                          <span key={`${log.id}-${highlight.label}`} className="ai-revenue-timeline__value">
                            <strong>{highlight.label}</strong>
                            <span>{highlight.value}</span>
                          </span>
                        ),
                      )}
                    </div>
                  ) : null}

                  <details className="ai-revenue-timeline__technical">
                    <summary>Technical details</summary>
                    <div className="ai-revenue-timeline__values">
                      {beforeValue ? (
                        <div>
                          <span>Before</span>
                          <pre>{beforeValue}</pre>
                        </div>
                      ) : null}
                      {afterValue ? (
                        <div>
                          <span>After</span>
                          <pre>{afterValue}</pre>
                        </div>
                      ) : null}
                    </div>
                  </details>
                </>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
