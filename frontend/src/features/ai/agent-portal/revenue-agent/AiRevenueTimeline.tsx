import type { AiRevenueAuditLog } from "../../../../types/domain";

type Props = {
  logs: AiRevenueAuditLog[];
  emptyLabel?: string;
};

function titleCase(value: string | null | undefined) {
  return (value || "not set")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function actorLabel(log: AiRevenueAuditLog) {
  return log.actorId ? `${log.actorType} · ${log.actorId}` : log.actorType;
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

        return (
          <li key={log.id} className="ai-revenue-timeline__item">
            <div className="ai-revenue-timeline__dot" aria-hidden="true" />
            <div className="ai-revenue-timeline__body">
              <div className="ai-revenue-timeline__header">
                <div>
                  <strong>{titleCase(log.action)}</strong>
                  <span>{log.createdAt}</span>
                </div>
                <small>{actorLabel(log)}</small>
              </div>
              <p>{log.description}</p>
              {beforeValue || afterValue ? (
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
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
