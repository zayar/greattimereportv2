import { useEffect, useMemo, useState } from "react";
import { askGreatTimeAgentHub, recordGreatTimeAgentFeedback } from "../../../api/ai";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { ErrorState, EmptyState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { AI_LANGUAGE_OPTIONS, useAiPreferences } from "../AiPreferencesProvider";
import { daysAgo, today } from "../../../utils/date";
import type {
  GreatTimeAgentChatResponse,
  GreatTimeAgentEntityContext,
  GreatTimeAgentId,
  GreatTimeAgentTable,
  GreatTimeRequestedAgentId,
} from "../../../types/domain";
import { agentHubStatusClass, contextFromAgentHubRow } from "./agentHubViewModel";

type ChatTurn = {
  id: string;
  question: string;
  response?: GreatTimeAgentChatResponse;
  error?: string;
};

const AGENT_OPTIONS: Array<{ value: GreatTimeRequestedAgentId; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "finance", label: "Finance" },
  { value: "customer_relationship", label: "Customer Relationship" },
  { value: "business", label: "Business" },
  { value: "appointment", label: "Appointment" },
];

const SUGGESTIONS: Record<GreatTimeRequestedAgentId, string[]> = {
  auto: [
    "How much did we collect today by payment method?",
    "Which customers have unused package balance and have not visited recently?",
    "How many appointments are checked in right now?",
  ],
  finance: [
    "How much did we collect today by payment method?",
    "Compare this week sales with last week.",
    "Show today invoice detail.",
  ],
  customer_relationship: [
    "Which customers have unused package balance and have not visited recently?",
    "Which customers are at risk of churn?",
    "Who should we follow up today?",
  ],
  business: [
    "Which service is declining in the last 90 days?",
    "Which practitioners handled the most treatments?",
    "Show business health this week.",
  ],
  appointment: [
    "How many appointments are checked in right now?",
    "Who are the checked-in customers?",
    "Which customers have not started treatment?",
  ],
};

function agentLabel(agent: GreatTimeAgentId | GreatTimeRequestedAgentId) {
  return AGENT_OPTIONS.find((option) => option.value === agent)?.label ?? agent;
}

function formatCell(value: unknown) {
  if (value == null || value === "") {
    return "-";
  }

  if (typeof value === "number") {
    return value.toLocaleString("en-US");
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value);
}

function AgentTable({
  table,
  onPickContext,
}: {
  table: GreatTimeAgentTable;
  onPickContext: (context: GreatTimeAgentEntityContext) => void;
}) {
  return (
    <section className="agent-hub-answer-section">
      <h3>{table.title}</h3>
      <div className="agent-hub-table-wrap">
        <table className="agent-hub-table">
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th key={column.key}>{column.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => {
              const context = contextFromAgentHubRow(row);
              return (
                <tr
                  key={`${table.title}-${rowIndex}`}
                  className={context ? "agent-hub-table__clickable-row" : undefined}
                  onClick={() => {
                    if (context) {
                      onPickContext(context);
                    }
                  }}
                >
                  {table.columns.map((column) => (
                    <td key={column.key}>{formatCell(row[column.key])}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AgentHubPage() {
  const { currentClinic, loading: accessLoading, error: accessError } = useAccess();
  const { aiLanguage, setAiLanguage } = useAiPreferences();
  const [agent, setAgent] = useState<GreatTimeRequestedAgentId>("auto");
  const [range, setRange] = useState({ fromDate: daysAgo(29), toDate: today() });
  const [message, setMessage] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeContext, setActiveContext] = useState<GreatTimeAgentEntityContext | undefined>();
  const [feedbackSent, setFeedbackSent] = useState<Record<string, string>>({});

  useEffect(() => {
    setSessionId(undefined);
    setTurns([]);
    setActiveContext(undefined);
  }, [currentClinic?.id]);

  const suggestions = SUGGESTIONS[agent];
  const latestResponse = useMemo(() => [...turns].reverse().find((turn) => turn.response)?.response, [turns]);

  const submitQuestion = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || !currentClinic) {
      return;
    }

    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setTurns((current) => [...current, { id: turnId, question: trimmed }]);
    setMessage("");
    setLoading(true);

    try {
      const response = await askGreatTimeAgentHub({
        sessionId,
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        agent,
        message: trimmed,
        aiLanguage,
        fromDate: range.fromDate,
        toDate: range.toDate,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        entityContext: activeContext,
      });

      setSessionId(response.sessionId);
      if (response.entityContext) {
        setActiveContext(response.entityContext);
      }
      setTurns((current) =>
        current.map((turn) => (turn.id === turnId ? { ...turn, response } : turn)),
      );
    } catch (submitError) {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                error: submitError instanceof Error ? submitError.message : "Agent Hub could not answer.",
              }
            : turn,
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const sendFeedback = async (response: GreatTimeAgentChatResponse, rating: "helpful" | "not_helpful") => {
    if (!currentClinic || feedbackSent[response.responseId]) {
      return;
    }

    await recordGreatTimeAgentFeedback({
      clinicId: currentClinic.id,
      sessionId: response.sessionId,
      responseId: response.responseId,
      rating,
    });
    setFeedbackSent((current) => ({ ...current, [response.responseId]: rating }));
  };

  if (accessLoading) {
    return <EmptyState label="Loading clinic access" />;
  }

  if (accessError || !currentClinic) {
    return <ErrorState label="Agent Hub unavailable" detail={accessError ?? "Choose a clinic to continue."} />;
  }

  return (
    <div className="agent-hub-page">
      <div className="agent-hub-toolbar">
        <div>
          <p className="agent-hub-eyebrow">GT Growth AI</p>
          <h1>GreatTime AI Agent</h1>
        </div>
        <div className="agent-hub-controls">
          <label className="field">
            <span>Agent</span>
            <select value={agent} onChange={(event) => setAgent(event.target.value as GreatTimeRequestedAgentId)}>
              {AGENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Language</span>
            <select value={aiLanguage} onChange={(event) => setAiLanguage(event.target.value as typeof aiLanguage)}>
              {AI_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />
        </div>
      </div>

      <div className="agent-hub-layout">
        <main className="agent-hub-chat">
          <div className="agent-hub-suggestions">
            {suggestions.map((suggestion) => (
              <button key={suggestion} type="button" onClick={() => void submitQuestion(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>

          <div className="agent-hub-turns">
            {turns.length === 0 ? (
              <EmptyState label="Ask GreatTime Agent Hub" detail="Choose an agent or keep Auto selected." />
            ) : null}

            {turns.map((turn) => (
              <article key={turn.id} className="agent-hub-turn">
                <div className="agent-hub-question">{turn.question}</div>
                {turn.error ? <ErrorState label="Agent issue" detail={turn.error} /> : null}
                {turn.response ? (
                  <div className="agent-hub-answer">
                    <div className="agent-hub-answer-header">
                      <div>
                        <span className={agentHubStatusClass(turn.response.dataStatus)}>{turn.response.dataStatus}</span>
                        <span className="agent-hub-chip">{agentLabel(turn.response.resolvedAgent)}</span>
                      </div>
                      <div className="agent-hub-feedback">
                        {feedbackSent[turn.response.responseId] ? (
                          <span>Feedback saved</span>
                        ) : (
                          <>
                            <button type="button" onClick={() => void sendFeedback(turn.response!, "helpful")}>
                              Helpful
                            </button>
                            <button type="button" onClick={() => void sendFeedback(turn.response!, "not_helpful")}>
                              Not helpful
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <p className="agent-hub-summary">{turn.response.assistantMessage}</p>

                    {turn.response.warnings?.length ? (
                      <div className="agent-hub-warning">
                        {turn.response.warnings.map((warning) => (
                          <p key={`${turn.response?.responseId}-${warning.type}`}>
                            <strong>{warning.title}:</strong> {warning.message}
                          </p>
                        ))}
                      </div>
                    ) : null}

                    {turn.response.metrics?.length ? (
                      <div className="agent-hub-metrics">
                        {turn.response.metrics.map((metric) => (
                          <div key={`${metric.label}-${metric.value}`} className="agent-hub-metric">
                            <span>{metric.label}</span>
                            <strong>{formatCell(metric.value)}</strong>
                            {metric.helperText ? <small>{metric.helperText}</small> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {turn.response.tables?.map((table) => (
                      <AgentTable
                        key={`${turn.response?.responseId}-${table.title}`}
                        table={table}
                        onPickContext={(context) => setActiveContext(context)}
                      />
                    ))}

                    {turn.response.recommendations?.length ? (
                      <section className="agent-hub-answer-section">
                        <h3>Recommendations</h3>
                        <div className="agent-hub-recommendations">
                          {turn.response.recommendations.map((recommendation, index) => (
                            <div key={`${recommendation.title ?? "recommendation"}-${index}`}>
                              {recommendation.title ? <strong>{recommendation.title}</strong> : null}
                              <p>{recommendation.message}</p>
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}

                    <section className="agent-hub-sources">
                      {turn.response.sources.map((source) => (
                        <span key={`${turn.response?.responseId}-${source.tool}`} className={agentHubStatusClass(source.dataStatus)}>
                          {source.live ? "Live" : "Historical"} · {source.sourceName} · {source.dataStatus}
                        </span>
                      ))}
                    </section>
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <form
            className="agent-hub-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void submitQuestion(message);
            }}
          >
            <textarea
              value={message}
              placeholder="Ask about sales, customers, business trends, or live appointments"
              onChange={(event) => setMessage(event.target.value)}
            />
            <button type="submit" disabled={loading || !message.trim()}>
              {loading ? "Asking..." : "Ask"}
            </button>
          </form>
        </main>

        <aside className="agent-hub-side">
          <section>
            <h2>Context</h2>
            <p>{currentClinic.name}</p>
            <p>
              {range.fromDate} to {range.toDate}
            </p>
            {activeContext ? (
              <div className="agent-hub-context-card">
                <span className="agent-hub-chip">{activeContext.entityType}</span>
                <strong>{activeContext.displayName ?? activeContext.entityId}</strong>
                <small>{activeContext.serviceName ?? activeContext.practitionerName ?? activeContext.invoiceNumber ?? ""}</small>
              </div>
            ) : (
              <p className="agent-hub-muted">Click a result row to use it as follow-up context.</p>
            )}
          </section>

          {latestResponse?.followUpQuestions?.length ? (
            <section>
              <h2>Follow-ups</h2>
              <div className="agent-hub-followups">
                {latestResponse.followUpQuestions.map((question) => (
                  <button key={question} type="button" onClick={() => void submitQuestion(question)}>
                    {question}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
