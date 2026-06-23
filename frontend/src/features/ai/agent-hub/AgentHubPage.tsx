import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { askGreatTimeAgentHub, recordGreatTimeAgentFeedback } from "../../../api/ai";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { ErrorState, EmptyState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { AI_LANGUAGE_OPTIONS, useAiPreferences } from "../AiPreferencesProvider";
import { daysAgo, today } from "../../../utils/date";
import autoAgentAvatar from "../../../../CFO_agent.jpg";
import financeAgentAvatar from "../../../../Finance_agent.jpg";
import appointmentAgentAvatar from "../../../../Inventory_agent.jpg";
import relationshipAgentAvatar from "../../../../relationship_agent.jpg";
import businessAgentAvatar from "../../../../Sales_agent.jpg";
import type {
  GreatTimeAgentChatResponse,
  GreatTimeAgentEntityContext,
  GreatTimeAgentId,
  GreatTimeAgentSource,
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

type AgentIconName = "auto" | "finance" | "relationship" | "business" | "appointment";

type AgentOption = {
  value: GreatTimeRequestedAgentId;
  label: string;
  description: string;
  icon: AgentIconName;
  avatar: string;
  avatarAlt: string;
};

const AGENT_OPTIONS: AgentOption[] = [
  {
    value: "auto",
    label: "Auto",
    description: "Selects the right specialization for each question.",
    icon: "auto",
    avatar: autoAgentAvatar,
    avatarAlt: "Auto specialization portrait",
  },
  {
    value: "finance",
    label: "Finance",
    description: "Payments, revenue, invoices, and settlement details.",
    icon: "finance",
    avatar: financeAgentAvatar,
    avatarAlt: "Finance specialization portrait",
  },
  {
    value: "customer_relationship",
    label: "Customer relationship",
    description: "Retention, follow-up priorities, packages, and churn risk.",
    icon: "relationship",
    avatar: relationshipAgentAvatar,
    avatarAlt: "Customer relationship specialization portrait",
  },
  {
    value: "business",
    label: "Business",
    description: "Clinic health, services, staff load, and trend signals.",
    icon: "business",
    avatar: businessAgentAvatar,
    avatarAlt: "Business specialization portrait",
  },
  {
    value: "appointment",
    label: "Appointment",
    description: "Live schedule, check-in flow, and treatment readiness.",
    icon: "appointment",
    avatar: appointmentAgentAvatar,
    avatarAlt: "Appointment specialization portrait",
  },
];

const SUGGESTIONS: Record<GreatTimeRequestedAgentId, string[]> = {
  auto: [
    "What needs attention in the clinic today?",
    "How much did we collect today by payment method?",
    "Which customers should we follow up first?",
    "How many appointments are checked in right now?",
  ],
  finance: [
    "How much did we collect today by payment method?",
    "Compare this week sales with last week.",
    "Show today invoice detail.",
    "Which payment method needs reconciliation?",
  ],
  customer_relationship: [
    "Which customers have unused package balance and have not visited recently?",
    "Which customers are at risk of churn?",
    "Who should we follow up today?",
    "Draft owner-safe follow-up priorities for this week.",
  ],
  business: [
    "Which service is declining in the last 90 days?",
    "Which practitioners handled the most treatments?",
    "Show business health this week.",
    "Where are the strongest revenue opportunities?",
  ],
  appointment: [
    "How many appointments are checked in right now?",
    "Who are the checked-in customers?",
    "Which customers have not started treatment?",
    "What schedule risks should front desk handle now?",
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

function formatCheckedAt(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFreshness(source: GreatTimeAgentSource) {
  if (source.freshnessSeconds == null) {
    return source.checkedAt ? `Checked ${formatCheckedAt(source.checkedAt)}` : "Freshness not reported";
  }

  if (source.freshnessSeconds < 60) {
    return "Checked just now";
  }

  if (source.freshnessSeconds < 3600) {
    return `${Math.round(source.freshnessSeconds / 60)} min fresh`;
  }

  return `${Math.round(source.freshnessSeconds / 3600)} hr fresh`;
}

function getAgentHubErrorMessage(error: unknown) {
  if (isAxiosError(error)) {
    const data = error.response?.data as { error?: unknown; details?: unknown } | undefined;
    if (typeof data?.error === "string" && data.error.trim()) {
      return data.error;
    }
  }

  return error instanceof Error ? error.message : "Agent workspace could not answer.";
}

function AgentModeIcon({ name }: { name: AgentIconName }) {
  switch (name) {
    case "finance":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18M8 15h3M14 15h2" />
        </svg>
      );
    case "relationship":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
          <circle cx="9.5" cy="7" r="4" />
          <path d="M18 8v6M21 11h-6" />
        </svg>
      );
    case "business":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <path d="M8 16l3-4 3 2 4-7" />
        </svg>
      );
    case "appointment":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-4" />
        </svg>
      );
    case "auto":
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" />
          <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z" />
        </svg>
      );
  }
}

function AgentAvatar({ agent, size = "small" }: { agent: AgentOption; size?: "small" | "large" }) {
  return (
    <span className={`agent-avatar agent-avatar--${size}`.trim()}>
      <img src={agent.avatar} alt={agent.avatarAlt} loading="lazy" />
      <span className="agent-avatar__badge" aria-hidden="true">
        <AgentModeIcon name={agent.icon} />
      </span>
    </span>
  );
}

function AgentTable({
  table,
  onPickContext,
}: {
  table: GreatTimeAgentTable;
  onPickContext: (context: GreatTimeAgentEntityContext) => void;
}) {
  return (
    <section className="agent-answer-section">
      <h3>{table.title}</h3>
      <div className="agent-table-wrap">
        <table className="agent-table">
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
                  className={context ? "agent-table__clickable-row" : undefined}
                  onClick={() => {
                    if (context) {
                      onPickContext(context);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!context || (event.key !== "Enter" && event.key !== " ")) {
                      return;
                    }

                    event.preventDefault();
                    onPickContext(context);
                  }}
                  role={context ? "button" : undefined}
                  tabIndex={context ? 0 : undefined}
                >
                  {table.columns.map((column) => {
                    const value = formatCell(row[column.key]);
                    return (
                      <td key={column.key} title={value}>
                        {value}
                      </td>
                    );
                  })}
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
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSessionId(undefined);
    setTurns([]);
    setActiveContext(undefined);
    setFeedbackSent({});
  }, [currentClinic?.id]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, loading]);

  const activeAgent = AGENT_OPTIONS.find((option) => option.value === agent) ?? AGENT_OPTIONS[0];
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
      setTurns((current) => current.map((turn) => (turn.id === turnId ? { ...turn, response } : turn)));
    } catch (submitError) {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                error: getAgentHubErrorMessage(submitError),
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

  const startNewConversation = () => {
    setSessionId(undefined);
    setTurns([]);
    setMessage("");
    setActiveContext(undefined);
    setFeedbackSent({});
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    if (!loading && message.trim()) {
      void submitQuestion(message);
    }
  };

  if (accessLoading) {
    return <EmptyState label="Loading clinic access" />;
  }

  if (accessError || !currentClinic) {
    return <ErrorState label="Agent workspace unavailable" detail={accessError ?? "Choose a clinic to continue."} />;
  }

  return (
    <div className="agent-workspace-page">
      <header className="agent-workspace-header">
        <div>
          <h1>Agent workspace</h1>
          <p>Ask questions across clinic operations, revenue, customers, services, and live appointments.</p>
          <div className="agent-workspace-header__meta">
            <span>{currentClinic.name}</span>
            {currentClinic.code ? <span>{currentClinic.code}</span> : null}
          </div>
        </div>
        <button type="button" className="button button--secondary" onClick={startNewConversation}>
          New conversation
        </button>
      </header>

      <div className="agent-workspace-layout">
        <aside className="agent-selector-panel" aria-label="Agent specializations">
          <div className="agent-selector-panel__header">
            <span>Specializations</span>
            <strong>{activeAgent.label}</strong>
          </div>
          <div className="agent-mode-list">
            {AGENT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`agent-mode ${agent === option.value ? "agent-mode--active" : ""}`.trim()}
                onClick={() => setAgent(option.value)}
                aria-pressed={agent === option.value}
              >
                <AgentAvatar agent={option} />
                <span className="agent-mode__copy">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="agent-conversation" aria-label="Agent conversation">
          <div className="agent-conversation__scroll">
            {turns.length === 0 ? (
              <section className="agent-welcome">
                <div className="agent-welcome__intro">
                  <AgentAvatar agent={activeAgent} size="large" />
                  <div>
                    <p className="agent-welcome__eyebrow">{activeAgent.label} active</p>
                    <h2>Start with a clinic question.</h2>
                    <p>
                      Ask in plain language. GreatTime will keep the answer grounded in the selected clinic,
                      date range, and available source freshness.
                    </p>
                  </div>
                </div>
                <div className="agent-suggestion-grid" aria-label="Suggested questions">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void submitQuestion(suggestion)}
                      disabled={loading}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {turns.map((turn) => (
              <article key={turn.id} className="agent-turn">
                <div className="agent-message agent-message--user">
                  <span className="agent-message__speaker">You</span>
                  <p>{turn.question}</p>
                </div>

                {turn.error ? <ErrorState label="Agent issue" detail={turn.error} /> : null}

                {!turn.response && !turn.error ? (
                  <div className="agent-message agent-message--assistant agent-message--loading" aria-live="polite">
                    <span className="agent-message__speaker">GreatTime</span>
                    <p>Thinking through the latest clinic data...</p>
                  </div>
                ) : null}

                {turn.response ? (
                  <div className="agent-message agent-message--assistant">
                    <div className="agent-answer-header">
                      <div className="agent-answer-header__status">
                        <span className={agentHubStatusClass(turn.response.dataStatus)}>{turn.response.dataStatus}</span>
                        <span className="agent-chip">{agentLabel(turn.response.resolvedAgent)}</span>
                      </div>
                      <div className="agent-feedback">
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

                    <p className="agent-answer-summary">{turn.response.assistantMessage}</p>
                    {turn.response.summary && turn.response.summary !== turn.response.assistantMessage ? (
                      <p className="agent-answer-detail">{turn.response.summary}</p>
                    ) : null}

                    {turn.response.warnings?.length ? (
                      <div className="agent-warning">
                        {turn.response.warnings.map((warning) => (
                          <p key={`${turn.response?.responseId}-${warning.type}`}>
                            <strong>{warning.title}:</strong> {warning.message}
                          </p>
                        ))}
                      </div>
                    ) : null}

                    {turn.response.metrics?.length ? (
                      <div className="agent-metrics">
                        {turn.response.metrics.map((metric) => (
                          <div key={`${metric.label}-${metric.value}`} className="agent-metric">
                            <span>{metric.label}</span>
                            <strong>
                              {formatCell(metric.value)}
                              {metric.unit ? <small>{metric.unit}</small> : null}
                            </strong>
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
                      <section className="agent-answer-section">
                        <h3>Recommendations</h3>
                        <div className="agent-recommendations">
                          {turn.response.recommendations.map((recommendation, index) => (
                            <div key={`${recommendation.title ?? "recommendation"}-${index}`}>
                              {recommendation.title ? <strong>{recommendation.title}</strong> : null}
                              <p>{recommendation.message}</p>
                              {recommendation.sourceTools.length ? (
                                <small>Sources: {recommendation.sourceTools.join(", ")}</small>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}

                    <section className="agent-sources" aria-label="Sources and freshness">
                      {turn.response.sources.map((source) => (
                        <span
                          key={`${turn.response?.responseId}-${source.tool}-${source.checkedAt}`}
                          className={agentHubStatusClass(source.dataStatus)}
                        >
                          {source.live ? "Live" : "Historical"} · {source.sourceName} · {source.dataStatus} ·{" "}
                          {formatFreshness(source)}
                        </span>
                      ))}
                    </section>
                  </div>
                ) : null}
              </article>
            ))}
            <div ref={scrollAnchorRef} />
          </div>

          <form
            className="agent-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void submitQuestion(message);
            }}
          >
            <label className="agent-composer__field">
              <span>Ask GreatTime</span>
              <textarea
                value={message}
                rows={3}
                placeholder="Ask about sales, customers, business trends, or live appointments"
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                disabled={loading}
              />
            </label>
            <div className="agent-composer__actions">
              <small>Enter to send · Shift+Enter for a new line</small>
              <button type="submit" disabled={loading || !message.trim()}>
                {loading ? "Asking..." : "Send"}
              </button>
            </div>
          </form>
        </main>

        <aside className="agent-context-panel" aria-label="Agent context and settings">
          <section className="agent-context-section">
            <h2>Settings</h2>
            <label className="field">
              <span>AI language</span>
              <select value={aiLanguage} onChange={(event) => setAiLanguage(event.target.value as typeof aiLanguage)}>
                {AI_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <DateRangeControls fromDate={range.fromDate} toDate={range.toDate} onChange={setRange} />
          </section>

          <section className="agent-context-section">
            <div className="agent-context-section__header">
              <h2>Context</h2>
              <button type="button" onClick={() => setActiveContext(undefined)} disabled={!activeContext}>
                Clear
              </button>
            </div>
            <p className="agent-context-panel__muted">{currentClinic.name}</p>
            {activeContext ? (
              <div className="agent-context-card">
                <span className="agent-chip">{activeContext.entityType}</span>
                <strong>{activeContext.displayName ?? activeContext.entityId}</strong>
                <small>{activeContext.serviceName ?? activeContext.practitionerName ?? activeContext.invoiceNumber ?? ""}</small>
              </div>
            ) : (
              <p className="agent-context-panel__muted">Click an eligible table row to use it as follow-up context.</p>
            )}
          </section>

          {latestResponse?.sources.length ? (
            <section className="agent-context-section">
              <h2>Freshness</h2>
              <div className="agent-source-list">
                {latestResponse.sources.map((source) => (
                  <div key={`${source.tool}-${source.checkedAt}-${source.sourceName}`}>
                    <strong>{source.sourceName}</strong>
                    <span>
                      {source.live ? "Live" : "Historical"} · {source.dataStatus}
                    </span>
                    <small>{formatFreshness(source)}</small>
                    {source.period ? <small>{source.period}</small> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {latestResponse?.followUpQuestions?.length ? (
            <section className="agent-context-section">
              <h2>Follow-ups</h2>
              <div className="agent-followups">
                {latestResponse.followUpQuestions.map((question) => (
                  <button key={question} type="button" onClick={() => void submitQuestion(question)} disabled={loading}>
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
