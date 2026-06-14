import type { ReportAiPayload } from "../types/domain";

type Props = {
  payload: ReportAiPayload;
};

function formatEvidenceValue(value: string | number) {
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}

function priorityLabel(priority: string) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

export function ReportAiSections({ payload }: Props) {
  const hasInsights = payload.insights.length > 0;
  const hasActions = payload.nextActions.length > 0;

  if (!payload.summary && !hasInsights && !hasActions && !payload.businessOpportunity) {
    return null;
  }

  return (
    <section className="report-ai-sections" aria-label="GT Growth AI report insights">
      <div className="report-ai-sections__header">
        <div>
          <span className="report-ai-sections__eyebrow">GT Growth AI</span>
          <h2>AI Insights</h2>
        </div>
        <span className="report-ai-sections__feature-key">{payload.featureGate}</span>
      </div>

      {payload.summary ? <p className="report-ai-sections__summary">{payload.summary}</p> : null}

      {payload.businessOpportunity ? (
        <div className="report-ai-sections__opportunity">
          <span>Business Opportunity</span>
          <strong>{payload.businessOpportunity}</strong>
        </div>
      ) : null}

      {hasInsights ? (
        <div className="report-ai-sections__grid">
          {payload.insights.map((insight) => (
            <article key={insight.id} className={`report-ai-card report-ai-card--${insight.severity}`}>
              <div className="report-ai-card__topline">
                <span>{insight.category}</span>
                <span>{insight.confidence} confidence</span>
              </div>
              <h3>{insight.title}</h3>
              <p>{insight.summary}</p>
              <div className="report-ai-card__evidence">
                <span>Why AI recommends this</span>
                <dl>
                  {insight.evidence.map((item) => (
                    <div key={`${insight.id}-${item.label}`}>
                      <dt>{item.label}</dt>
                      <dd>
                        {formatEvidenceValue(item.value)}
                        {item.comparison ? <small>{item.comparison}</small> : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="report-ai-card__action">
                <span>Recommended action</span>
                <strong>{insight.recommendedAction}</strong>
              </div>
              {insight.estimatedImpact ? <small className="report-ai-card__impact">{insight.estimatedImpact}</small> : null}
            </article>
          ))}
        </div>
      ) : null}

      {hasActions ? (
        <div className="report-ai-actions">
          <h3>Recommended Actions</h3>
          <ol>
            {payload.nextActions.map((action) => (
              <li key={action.id}>
                <div>
                  <strong>{action.title}</strong>
                  <span>{action.description}</span>
                  <small>{action.reason}</small>
                </div>
                <span className={`report-ai-actions__priority report-ai-actions__priority--${action.priority}`}>
                  {priorityLabel(action.priority)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
