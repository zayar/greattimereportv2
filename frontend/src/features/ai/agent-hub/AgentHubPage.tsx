import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { Link } from "react-router-dom";
import { askGreatTimeAgentHub, recordGreatTimeAgentFeedback } from "../../../api/ai";
import { DateRangeControls } from "../../../components/DateRangeControls";
import { ErrorState, EmptyState } from "../../../components/StatusViews";
import { useAccess } from "../../access/AccessProvider";
import { AI_LANGUAGE_OPTIONS, useAiPreferences } from "../AiPreferencesProvider";
import { startOfCurrentMonth, today } from "../../../utils/date";
import autoAgentAvatar from "../../../../CFO_agent.jpg";
import financeAgentAvatar from "../../../../Finance_agent.jpg";
import appointmentAgentAvatar from "../../../../Inventory_agent.jpg";
import relationshipAgentAvatar from "../../../../relationship_agent.jpg";
import businessAgentAvatar from "../../../../Sales_agent.jpg";
import type {
  Customer360FactPack,
  GreatTimeAgentChatResponse,
  GreatTimeAgentEntityContext,
  GreatTimeAgentId,
  GreatTimeAgentRecommendation,
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

type AgentFeedbackType =
  | "helpful"
  | "not_helpful"
  | "wrong_data"
  | "too_long"
  | "too_short"
  | "remember_this"
  | "correction";

type FeedbackDraft = {
  feedbackType: AgentFeedbackType;
  note: string;
};

const FEEDBACK_REASONS: Array<{ value: AgentFeedbackType; label: string; rating: "helpful" | "not_helpful" }> = [
  { value: "helpful", label: "Helpful", rating: "helpful" },
  { value: "not_helpful", label: "Not helpful", rating: "not_helpful" },
  { value: "wrong_data", label: "Wrong data", rating: "not_helpful" },
  { value: "too_long", label: "Too long", rating: "not_helpful" },
  { value: "too_short", label: "Too short", rating: "not_helpful" },
  { value: "remember_this", label: "Remember this", rating: "helpful" },
  { value: "correction", label: "Correction", rating: "not_helpful" },
];

const RECOMMENDATION_OUTCOMES: Array<{
  value: "accepted" | "dismissed" | "contacted" | "no_reply" | "not_interested" | "remind_later";
  label: string;
  rating: "helpful" | "not_helpful";
}> = [
  { value: "accepted", label: "Accept", rating: "helpful" },
  { value: "contacted", label: "Contacted", rating: "helpful" },
  { value: "dismissed", label: "Dismiss", rating: "not_helpful" },
  { value: "remind_later", label: "Later", rating: "not_helpful" },
];

const AGENT_OPTIONS: AgentOption[] = [
  {
    value: "auto",
    label: "GT Brain",
    description: "Routes each question to the right specialist.",
    icon: "auto",
    avatar: autoAgentAvatar,
    avatarAlt: "GT Brain specialization portrait",
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
    "What should we focus on this month?",
    "Which service is declining this month?",
    "Who are the top customers this month?",
    "How many appointments are scheduled today?",
  ],
  finance: [
    "Show this month collection by payment method.",
    "Compare this month sales with the same days last month.",
    "Show today's invoice detail.",
    "Which payment method needs reconciliation this month?",
  ],
  customer_relationship: [
    "Who are the top customers this month?",
    "Which customers have unused package balance and have not visited recently?",
    "Which customers are at risk of churn this month?",
    "Draft owner-safe follow-up priorities for this month.",
  ],
  business: [
    "Which service is declining this month?",
    "Which practitioners handled the most treatments this month?",
    "Show top services this month.",
    "Where are the strongest revenue opportunities this month?",
  ],
  appointment: [
    "Show all appointments today.",
    "How many appointments are scheduled today?",
    "How many appointments are checked in right now?",
    "Which customers may not have started treatment?",
  ],
};

function agentLabel(agent: GreatTimeAgentId | GreatTimeRequestedAgentId) {
  return AGENT_OPTIONS.find((option) => option.value === agent)?.label ?? agent;
}

function specialistAgentLabel(agent: GreatTimeAgentId) {
  switch (agent) {
    case "finance":
      return "Finance Agent";
    case "customer_relationship":
      return "Customer Relationship Agent";
    case "business":
      return "Business Agent";
    case "appointment":
      return "Appointment Agent";
    default:
      return "GreatTime Agent";
  }
}

function agentAnswerLabel(response: GreatTimeAgentChatResponse) {
  const specialist = specialistAgentLabel(response.resolvedAgent);
  return response.autoMode ? `GT Brain -> ${specialist}` : specialist;
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

function formatOptionalNumber(value: number | undefined, suffix = "") {
  if (value == null) {
    return "-";
  }

  return `${value.toLocaleString("en-US")}${suffix}`;
}

function formatOptionalMoney(value: number | undefined) {
  if (value == null) {
    return "-";
  }

  return `${value.toLocaleString("en-US")} MMK`;
}

function formatDateValue(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatResponsePeriod(response: GreatTimeAgentChatResponse) {
  const { period } = response;
  if (period.fromDate === period.toDate) {
    return `${period.label} (${formatDateValue(period.toDate)})`;
  }

  return `${period.label} (${formatDateValue(period.fromDate)} - ${formatDateValue(period.toDate)})`;
}

function feedbackRatingForType(feedbackType: AgentFeedbackType) {
  return FEEDBACK_REASONS.find((reason) => reason.value === feedbackType)?.rating ?? "not_helpful";
}

function responseSourceTools(response: GreatTimeAgentChatResponse) {
  return [...new Set(response.sources.map((source) => source.tool).filter(Boolean))];
}

function defaultFeedbackDraft(): FeedbackDraft {
  return { feedbackType: "helpful", note: "" };
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

function AgentCustomer360Card({ factPack }: { factPack: Customer360FactPack }) {
  const topServices = factPack.usage.topServices.slice(0, 3);
  const packageRows = factPack.packages.holdings.slice(0, 4);
  const appointmentRows = [...(factPack.appointments.current ?? []), ...(factPack.appointments.upcoming ?? [])].slice(0, 3);
  const recentTreatmentRows = (factPack.appointments.recentCompleted ?? []).slice(0, 4);
  const hasLifetimeSpend = factPack.value.lifetimeSpend != null;
  const hasPackageSection =
    packageRows.length > 0 || factPack.packages.totalRemainingSessions != null || factPack.packages.dataStatus !== "not_ready";
  const hasPaymentSection = factPack.payments.invoiceCount != null || factPack.payments.recentInvoices.length > 0;
  const hasLiveAppointmentSection =
    appointmentRows.length > 0 || factPack.sources.some((source) => source.tool === "get_customer_live_appointments");
  const visitMetricLabel = factPack.usage.selectedYear ? `${factPack.usage.selectedYear} visits` : "Visits";
  const visibleQuality = factPack.dataQuality.filter((item) => item.severity !== "info");

  return (
    <section className="agent-customer360">
      <div className="agent-customer360__header">
        <div>
          <span className="agent-customer360__eyebrow">Customer 360</span>
          <h3>{factPack.identity.displayName}</h3>
          <div className="agent-customer360__badges">
            {factPack.identity.memberId ? <span>Member {factPack.identity.memberId}</span> : null}
            {factPack.identity.maskedPhone ? <span>{factPack.identity.maskedPhone}</span> : null}
          </div>
        </div>
        {factPack.identity.detailPath ? (
          <Link className="button button--secondary agent-customer360__link" to={factPack.identity.detailPath}>
            Open detail
          </Link>
        ) : null}
      </div>

      <div className="agent-customer360__metrics">
        <div>
          <span>Joined</span>
          <strong>{formatDateValue(factPack.identity.joinedDate)}</strong>
        </div>
        <div>
          <span>{visitMetricLabel}</span>
          <strong>{formatOptionalNumber(factPack.value.totalVisits)}</strong>
        </div>
        {hasLifetimeSpend ? (
          <div>
            <span>Lifetime spend</span>
            <strong>{formatOptionalMoney(factPack.value.lifetimeSpend)}</strong>
          </div>
        ) : null}
        <div>
          <span>Last visit</span>
          <strong>{formatDateValue(factPack.latestActivity.lastVisitAt)}</strong>
          {factPack.latestActivity.lastService ? <small>{factPack.latestActivity.lastService}</small> : null}
        </div>
        {hasPackageSection ? (
          <div>
            <span>Package balance</span>
            <strong>{formatOptionalNumber(factPack.packages.totalRemainingSessions)}</strong>
            <small>{factPack.packages.dataStatus}</small>
          </div>
        ) : null}
        {hasLiveAppointmentSection ? (
          <div>
            <span>Upcoming</span>
            <strong>{formatOptionalNumber(factPack.appointments.upcoming?.length ?? 0)}</strong>
            <small>APICORE</small>
          </div>
        ) : null}
      </div>

      <div className="agent-customer360__grid">
        <div>
          <h4>Relationship</h4>
          <p>
            {factPack.preferences.preferredService || "-"}
            {factPack.preferences.preferredTherapist ? ` with ${factPack.preferences.preferredTherapist}` : ""}
          </p>
          <small>
            Momentum {factPack.visitPattern.momentum ?? "unknown"}
            {factPack.visitPattern.averageVisitIntervalDays != null
              ? ` · ${factPack.visitPattern.averageVisitIntervalDays} days average interval`
              : ""}
          </small>
        </div>
        {hasPackageSection ? (
          <div>
            <h4>Packages</h4>
            {packageRows.length ? (
              <ul>
                {packageRows.map((row) => (
                  <li key={`${row.packageId ?? row.serviceName}-${row.serviceName}`}>
                    {row.serviceName}: {formatOptionalNumber(row.remainingSessions)} remaining
                    {row.totalSessions != null ? ` / ${formatOptionalNumber(row.totalSessions)} total` : ""}
                    {row.latestTherapist ? ` · ${row.latestTherapist}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No package holdings returned.</p>
            )}
          </div>
        ) : null}
        {recentTreatmentRows.length ? (
          <div>
            <h4>Recent treatments</h4>
            <ul>
              {recentTreatmentRows.map((row, index) => (
                <li key={`${String(row.checkInTime ?? index)}-${index}`}>
                  {formatDateValue(String(row.checkInTime ?? ""))} · {String(row.serviceName ?? "Service")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {hasLiveAppointmentSection ? (
          <div>
            <h4>Appointments</h4>
            {appointmentRows.length ? (
              <ul>
                {appointmentRows.map((row, index) => (
                  <li key={`${String(row.appointmentId ?? index)}-${index}`}>
                    {formatDateValue(String(row.scheduledFrom ?? ""))} · {String(row.serviceName ?? "Service")}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No current or upcoming APICORE booking.</p>
            )}
          </div>
        ) : null}
        {hasPaymentSection ? (
          <div>
            <h4>Payments</h4>
            <p>
              {formatOptionalNumber(factPack.payments.invoiceCount)} invoice
              {factPack.payments.invoiceCount === 1 ? "" : "s"} · {formatOptionalMoney(factPack.payments.selectedPeriodTotal)}
            </p>
            {factPack.payments.preferredMethod ? <small>{factPack.payments.preferredMethod}</small> : null}
          </div>
        ) : null}
        <div>
          <h4>Usage</h4>
          {topServices.length ? (
            <ul>
              {topServices.map((row) => (
                <li key={String(row.serviceName)}>
                  {String(row.serviceName)} · {formatCell(row.totalUsage)}
                </li>
              ))}
            </ul>
          ) : (
            <p>No usage rows returned.</p>
          )}
        </div>
        <div>
          <h4>Recommended action</h4>
          <p>{factPack.recommendation?.title ?? "Review source sections."}</p>
          {factPack.recommendation?.evidence.length ? (
            <small>{factPack.recommendation.evidence.slice(0, 2).join(" ")}</small>
          ) : null}
        </div>
      </div>

      {visibleQuality.length ? (
        <div className="agent-customer360__quality">
          {visibleQuality.map((item) => (
            <span key={item.code} className={item.severity === "info" ? "agent-hub-chip" : "agent-hub-chip agent-hub-chip--warn"}>
              {item.severity}: {item.message}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function AgentHubPage() {
  const { currentClinic, loading: accessLoading, error: accessError } = useAccess();
  const { aiLanguage, setAiLanguage } = useAiPreferences();
  const [agent, setAgent] = useState<GreatTimeRequestedAgentId>("auto");
  const [range, setRange] = useState({ fromDate: startOfCurrentMonth(), toDate: today() });
  const [rangeTouched, setRangeTouched] = useState(false);
  const [message, setMessage] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeContext, setActiveContext] = useState<GreatTimeAgentEntityContext | undefined>();
  const [feedbackSent, setFeedbackSent] = useState<Record<string, string>>({});
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, FeedbackDraft>>({});
  const [recommendationFeedbackSent, setRecommendationFeedbackSent] = useState<Record<string, string>>({});
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSessionId(undefined);
    setTurns([]);
    setActiveContext(undefined);
    setFeedbackSent({});
    setFeedbackDrafts({});
    setRecommendationFeedbackSent({});
    setRangeTouched(false);
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
        fromDate: rangeTouched ? range.fromDate : undefined,
        toDate: rangeTouched ? range.toDate : undefined,
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

  const sendFeedback = async (response: GreatTimeAgentChatResponse, draft: FeedbackDraft) => {
    if (!currentClinic || feedbackSent[response.responseId]) {
      return;
    }

    await recordGreatTimeAgentFeedback({
      clinicId: currentClinic.id,
      sessionId: response.sessionId,
      responseId: response.responseId,
      requestId: response.requestId,
      feedbackType: draft.feedbackType,
      rating: feedbackRatingForType(draft.feedbackType),
      note: draft.note.trim() || null,
      resolvedAgent: response.resolvedAgent,
      intent: response.intent,
      sourceTools: responseSourceTools(response),
      usedMemoryIds: response.usedMemoryIds ?? [],
    });
    setFeedbackSent((current) => ({ ...current, [response.responseId]: draft.feedbackType }));
  };

  const sendRecommendationOutcome = async (
    response: GreatTimeAgentChatResponse,
    recommendation: GreatTimeAgentRecommendation,
    outcome: (typeof RECOMMENDATION_OUTCOMES)[number],
  ) => {
    if (!currentClinic || !recommendation.recommendationId || recommendationFeedbackSent[recommendation.recommendationId]) {
      return;
    }

    await recordGreatTimeAgentFeedback({
      clinicId: currentClinic.id,
      sessionId: response.sessionId,
      responseId: response.responseId,
      requestId: response.requestId,
      recommendationId: recommendation.recommendationId,
      recommendationType: recommendation.recommendationType ?? response.intent,
      opportunityKey: recommendation.opportunityKey ?? null,
      targetCustomerKey: recommendation.targetCustomerKey ?? null,
      feedbackType: outcome.rating === "helpful" ? "helpful" : "not_helpful",
      rating: outcome.rating,
      outcome: outcome.value,
      resolvedAgent: response.resolvedAgent,
      intent: response.intent,
      sourceTools: recommendation.sourceTools.length ? recommendation.sourceTools : responseSourceTools(response),
      usedMemoryIds: response.usedMemoryIds ?? [],
    });
    setRecommendationFeedbackSent((current) => ({
      ...current,
      [recommendation.recommendationId!]: outcome.value,
    }));
  };

  const startNewConversation = () => {
    setSessionId(undefined);
    setTurns([]);
    setMessage("");
    setActiveContext(undefined);
    setFeedbackSent({});
    setFeedbackDrafts({});
    setRecommendationFeedbackSent({});
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
                        <span className="agent-chip">Answered by {agentAnswerLabel(turn.response)}</span>
                        <span className="agent-chip">Period: {formatResponsePeriod(turn.response)}</span>
                      </div>
                      <div className="agent-feedback">
                        {feedbackSent[turn.response.responseId] ? (
                          <span>Feedback saved</span>
                        ) : (
                          <>
                            <select
                              value={feedbackDrafts[turn.response.responseId]?.feedbackType ?? "helpful"}
                              onChange={(event) =>
                                setFeedbackDrafts((current) => ({
                                  ...current,
                                  [turn.response!.responseId]: {
                                    ...(current[turn.response!.responseId] ?? defaultFeedbackDraft()),
                                    feedbackType: event.target.value as AgentFeedbackType,
                                  },
                                }))
                              }
                              aria-label="Feedback reason"
                            >
                              {FEEDBACK_REASONS.map((reason) => (
                                <option key={reason.value} value={reason.value}>
                                  {reason.label}
                                </option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={feedbackDrafts[turn.response.responseId]?.note ?? ""}
                              placeholder="Optional note"
                              onChange={(event) =>
                                setFeedbackDrafts((current) => ({
                                  ...current,
                                  [turn.response!.responseId]: {
                                    ...(current[turn.response!.responseId] ?? defaultFeedbackDraft()),
                                    note: event.target.value,
                                  },
                                }))
                              }
                            />
                            <button
                              type="button"
                              onClick={() => void sendFeedback(turn.response!, feedbackDrafts[turn.response!.responseId] ?? defaultFeedbackDraft())}
                            >
                              Save
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

                    {turn.response.customer360 ? <AgentCustomer360Card factPack={turn.response.customer360} /> : null}

                    {!turn.response.customer360 && turn.response.metrics?.length ? (
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

                    {!turn.response.customer360
                      ? turn.response.tables?.map((table) => (
                          <AgentTable
                            key={`${turn.response?.responseId}-${table.title}`}
                            table={table}
                            onPickContext={(context) => setActiveContext(context)}
                          />
                        ))
                      : null}

                    {!turn.response.customer360 && turn.response.recommendations?.length ? (
                      <section className="agent-answer-section">
                        <h3>Recommendations</h3>
                        <div className="agent-recommendations">
                          {turn.response.recommendations.map((recommendation, index) => (
                            <div key={`${recommendation.recommendationId ?? recommendation.title ?? "recommendation"}-${index}`}>
                              {recommendation.title ? <strong>{recommendation.title}</strong> : null}
                              <p>{recommendation.message}</p>
                              {recommendation.recommendationId ? (
                                <div className="agent-recommendation-actions">
                                  {recommendationFeedbackSent[recommendation.recommendationId] ? (
                                    <small>Outcome saved: {recommendationFeedbackSent[recommendation.recommendationId]}</small>
                                  ) : (
                                    RECOMMENDATION_OUTCOMES.map((outcome) => (
                                      <button
                                        key={outcome.value}
                                        type="button"
                                        onClick={() => void sendRecommendationOutcome(turn.response!, recommendation, outcome)}
                                      >
                                        {outcome.label}
                                      </button>
                                    ))
                                  )}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}
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
            <DateRangeControls
              fromDate={range.fromDate}
              toDate={range.toDate}
              onChange={(nextRange) => {
                setRange(nextRange);
                setRangeTouched(true);
              }}
            />
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
