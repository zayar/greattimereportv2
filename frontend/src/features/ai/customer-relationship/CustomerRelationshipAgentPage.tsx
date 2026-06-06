import { useCallback, useEffect, useState } from "react";
import {
  askCustomerRelationshipAgent,
  fetchCustomerRelationshipProfiles,
  generateCustomerFollowUpMessage,
  recordCustomerRelationshipFeedback,
  runCustomerRelationshipLearning,
} from "../../../api/ai";
import { DataTable } from "../../../components/DataTable";
import { CustomerPackageEvidenceTable } from "../../../components/CustomerPackageEvidenceTable";
import { CustomerUsageHeatmap } from "../../../components/CustomerUsageHeatmap";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import type {
  CustomerRelationshipAgentResponse,
  CustomerRelationshipEvidenceMetric,
  CustomerRelationshipFeedbackOutcome,
  CustomerRelationshipFollowUpMessage,
  CustomerRelationshipProfile,
  CustomerRelationshipRiskLevel,
  CustomerRelationshipSegment,
} from "../../../types/domain";
import { useAccess } from "../../access/AccessProvider";
import { AI_LANGUAGE_OPTIONS, useAiPreferences } from "../AiPreferencesProvider";

type BusyAction = "learn" | "profiles" | "ask" | "message" | "feedback" | null;

type SegmentFilter = {
  id: string;
  label: string;
  segment?: CustomerRelationshipSegment;
  riskLevel?: CustomerRelationshipRiskLevel;
};

const SEGMENT_FILTERS: SegmentFilter[] = [
  { id: "follow_up_today", label: "Follow up today" },
  { id: "package_bought_never_came", label: "Package bought never came", segment: "package_bought_never_came" },
  { id: "unused_package_balance", label: "Unused package balance", segment: "unused_package_balance" },
  { id: "inactive_vip", label: "Inactive VIP", segment: "inactive_vip" },
  { id: "treatment_due", label: "Treatment due", segment: "treatment_due" },
  { id: "high_risk", label: "High risk", riskLevel: "high" },
];

const FEEDBACK_OPTIONS: Array<{ value: CustomerRelationshipFeedbackOutcome; label: string }> = [
  { value: "messaged", label: "Messaged" },
  { value: "replied", label: "Replied" },
  { value: "booked", label: "Booked" },
  { value: "no_reply", label: "No reply" },
  { value: "not_interested", label: "Not interested" },
];

const DEFAULT_QUESTION = "Who bought package but never came?";
const SUGGESTED_QUESTIONS = [
  { label: "Package bought never came", question: "Who bought package but never came?" },
  { label: "Unused package balance", question: "Which customers have unused package balance?" },
  { label: "Inactive VIP", question: "Which VIP customers are inactive?" },
  { label: "Treatment due", question: "Which customers are treatment due?" },
  { label: "High risk", question: "Which customers are at risk?" },
  { label: "Likely renewal", question: "Which customers are likely renewal opportunities?" },
];

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString("en-US")} MMK`;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-GB", {
    dateStyle: "medium",
  });
}

function formatSegment(segment: string) {
  return segment
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function riskTone(riskLevel: CustomerRelationshipRiskLevel) {
  if (riskLevel === "high") {
    return "attention";
  }
  if (riskLevel === "medium") {
    return "neutral";
  }
  return "positive";
}

function metricTone(tone: CustomerRelationshipEvidenceMetric["tone"] | undefined) {
  return tone === "attention" ? "attention" : tone === "positive" ? "positive" : "neutral";
}

function metricValue(metrics: CustomerRelationshipEvidenceMetric[], label: string) {
  return metrics.find((metric) => metric.label.toLowerCase() === label.toLowerCase())?.value ?? "—";
}

function profileToAgentRow(profile: CustomerRelationshipProfile) {
  return {
    customerKey: profile.customerKey,
    customerName: profile.customerName,
    customerPhoneMasked: profile.customerPhoneMasked,
    lastVisitDate: profile.lastVisitDate,
    daysSinceLastVisit: profile.daysSinceLastVisit,
    lastService: profile.lastService,
    lastPackageServiceName: profile.lastPackageServiceName,
    lastPackageName: profile.lastPackageName,
    remainingPackageSessions: profile.remainingPackageSessions,
    packageHoldings: profile.packageHoldings,
    packagePurchases: profile.packagePurchases,
    lifetimeSpend: profile.lifetimeSpend,
    riskLevel: profile.riskLevel,
    segments: profile.segments,
    reasons: profile.reasons,
    nextBestAction: profile.nextBestAction,
    priorityScore: profile.priorityScore,
    lastFollowUpAt: profile.lastFollowUpAt,
    lastFollowUpOutcome: profile.lastFollowUpOutcome,
    followUpCount: profile.followUpCount,
  };
}

export function CustomerRelationshipAgentPage() {
  const { currentClinic } = useAccess();
  const { aiLanguage, setAiLanguage } = useAiPreferences();
  const [busyAction, setBusyAction] = useState<BusyAction>("profiles");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<CustomerRelationshipProfile[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [lastLearnedAt, setLastLearnedAt] = useState<string | null>(null);
  const [sourceLookbackDays, setSourceLookbackDays] = useState<number | null>(null);
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [lastAskedQuestion, setLastAskedQuestion] = useState(DEFAULT_QUESTION);
  const [agentResponse, setAgentResponse] = useState<CustomerRelationshipAgentResponse | null>(null);
  const [activeFilterId, setActiveFilterId] = useState(SEGMENT_FILTERS[0].id);
  const [search, setSearch] = useState("");
  const [selectedCustomerKey, setSelectedCustomerKey] = useState<string | null>(null);
  const [followUpMessage, setFollowUpMessage] = useState<CustomerRelationshipFollowUpMessage | null>(null);

  const activeFilter = SEGMENT_FILTERS.find((filter) => filter.id === activeFilterId) ?? SEGMENT_FILTERS[0];

  const loadProfiles = useCallback(async () => {
    if (!currentClinic) {
      return;
    }

    setBusyAction((current) => current ?? "profiles");
    setError(null);

    try {
      const result = await fetchCustomerRelationshipProfiles({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        segment: activeFilter.segment ?? "",
        riskLevel: activeFilter.riskLevel ?? "",
        search,
        sortBy: activeFilter.id === "unused_package_balance" ? "remainingPackageSessions" : "priorityScore",
        sortDirection: "desc",
        limit: 50,
        offset: 0,
      });
      setProfiles(result.rows);
      setTotalCount(result.totalCount);
      setLastLearnedAt(result.lastLearnedAt);
      setSourceLookbackDays(result.sourceLookbackDays);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Customer relationship profiles could not be loaded.");
    } finally {
      setBusyAction((current) => (current === "profiles" ? null : current));
    }
  }, [activeFilter.id, activeFilter.riskLevel, activeFilter.segment, currentClinic, search]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const displayRows = agentResponse?.rows.length ? agentResponse.rows : profiles.map(profileToAgentRow);
  const selectedCustomerName =
    followUpMessage?.customerName ??
    agentResponse?.evidence?.targetCustomer.customerName ??
    displayRows.find((row) => row.customerKey === selectedCustomerKey)?.customerName ??
    null;

  async function handleLearn() {
    if (!currentClinic) {
      return;
    }

    setBusyAction("learn");
    setError(null);
    setNotice(null);

    try {
      const summary = await runCustomerRelationshipLearning({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        aiLanguage,
        lookbackDays: 365,
      });
      setLastLearnedAt(summary.learnedAt);
      setNotice(`Learned ${summary.profilesSaved.toLocaleString("en-US")} customer behavior profiles.`);
      await loadProfiles();
    } catch (learnError) {
      setError(learnError instanceof Error ? learnError.message : "Customer behavior learning failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleAsk() {
    const submittedQuestion = question.trim();
    if (!currentClinic || !submittedQuestion) {
      return;
    }

    setBusyAction("ask");
    setError(null);
    setNotice(null);

    try {
      const response = await askCustomerRelationshipAgent({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        question: submittedQuestion,
        aiLanguage,
        autoLearnIfStale: false,
      });
      setLastAskedQuestion(submittedQuestion);
      setAgentResponse(response);
      setSelectedCustomerKey(response.evidence?.targetCustomer.customerKey ?? response.rows[0]?.customerKey ?? null);
      setNotice(`Agent found ${response.matchedCount.toLocaleString("en-US")} matching customer profiles.`);
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : "Customer Relationship Agent could not answer.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGenerateMessage(customerKey: string) {
    if (!currentClinic) {
      return;
    }

    setSelectedCustomerKey(customerKey);
    setBusyAction("message");
    setError(null);
    setNotice(null);
    setFollowUpMessage(null);

    try {
      const message = await generateCustomerFollowUpMessage({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        customerKey,
        aiLanguage,
        tone: "friendly",
      });
      setFollowUpMessage(message);
    } catch (messageError) {
      setError(messageError instanceof Error ? messageError.message : "Follow-up message could not be generated.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleFeedback(outcome: CustomerRelationshipFeedbackOutcome) {
    if (!currentClinic || !selectedCustomerKey) {
      return;
    }

    setBusyAction("feedback");
    setError(null);
    setNotice(null);

    try {
      await recordCustomerRelationshipFeedback({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        customerKey: selectedCustomerKey,
        outcome,
      });
      setNotice(`Recorded follow-up outcome: ${outcome.replace(/_/g, " ")}.`);
      await loadProfiles();
    } catch (feedbackError) {
      setError(feedbackError instanceof Error ? feedbackError.message : "Follow-up feedback could not be recorded.");
    } finally {
      setBusyAction(null);
    }
  }

  if (!currentClinic) {
    return (
      <div className="page-stack page-stack--workspace analytics-report customer-relationship-agent">
        <EmptyState label="No clinic selected" detail="Choose a clinic first to learn customer relationship profiles." />
      </div>
    );
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report customer-relationship-agent">
      <PageHeader
        eyebrow="AI Agent Portal"
        title="Customer Relationship Agent"
        description="Learn customer behavior and find customers who need follow-up."
        actions={
          <div className="filter-row">
            <label className="field field--compact">
              <span>AI language</span>
              <select value={aiLanguage} onChange={(event) => setAiLanguage(event.target.value as typeof aiLanguage)}>
                {AI_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="button button--primary" type="button" onClick={() => void handleLearn()} disabled={busyAction !== null}>
              {busyAction === "learn" ? "Learning..." : "Learn / Refresh Customer Behavior"}
            </button>
          </div>
        }
      />

      {error ? <ErrorState label="Customer Relationship Agent issue" detail={error} /> : null}
      {notice ? <div className="inline-note inline-note--success">{notice}</div> : null}

      <Panel
        title="Ask anything about customers"
        subtitle={`${totalCount.toLocaleString("en-US")} learned profiles · Last learned ${formatDate(lastLearnedAt)}${
          sourceLookbackDays ? ` · ${sourceLookbackDays} day lookback` : ""
        }`}
        action={<span className="status-pill status-pill--positive">Read-only agent</span>}
      >
        <div className="customer-agent-ask">
          <div className="customer-agent-ask__composer">
            <input
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && question.trim() && busyAction === null) {
                  void handleAsk();
                }
              }}
              placeholder="Ask anything about customers..."
            />
            <button className="button button--primary" type="button" onClick={() => void handleAsk()} disabled={busyAction !== null || !question.trim()}>
              {busyAction === "ask" ? "Asking..." : "Ask"}
            </button>
          </div>
          <div className="customer-agent-ask__suggestions" aria-label="Suggested questions">
            <strong>Suggested questions:</strong>
            <div>
              {SUGGESTED_QUESTIONS.map((suggestion) => (
                <button key={suggestion.label} type="button" onClick={() => setQuestion(suggestion.question)}>
                  {suggestion.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {agentResponse ? (
        <Panel
          title="AI Answer"
          subtitle={`Asked: ${lastAskedQuestion}`}
          action={
            <div className="customer-agent-answer__badges">
              <span className="status-pill status-pill--neutral">{agentResponse.detectedIntent.replace(/_/g, " ")}</span>
              <span className="status-pill status-pill--positive">{agentResponse.matchedCount.toLocaleString("en-US")} matches</span>
              {agentResponse.usedFallback ? <span className="status-pill status-pill--attention">Fallback summary</span> : null}
            </div>
          }
        >
          <div className="customer-agent-answer">
            <p className="customer-agent-answer__summary">{agentResponse.answerSummary}</p>
            {agentResponse.reasonBullets.length ? (
              <div className="customer-agent-answer__block">
                <strong>Why these customers need attention</strong>
                <ul>
                  {agentResponse.reasonBullets.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {agentResponse.evidenceNarrative ? (
              <div className="customer-agent-answer__block">
                <strong>Evidence narrative</strong>
                <p>{agentResponse.evidenceNarrative}</p>
              </div>
            ) : null}
            {agentResponse.recommendedActions.length ? (
              <div className="customer-agent-answer__block">
                <strong>Recommended actions</strong>
                <ol>
                  {agentResponse.recommendedActions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ol>
              </div>
            ) : null}
            {(agentResponse.nextQuestionSuggestions ?? agentResponse.suggestions ?? []).length ? (
              <div className="customer-agent-ask__suggestions customer-agent-ask__suggestions--inline">
                <strong>Next questions:</strong>
                <div>
                  {(agentResponse.nextQuestionSuggestions ?? agentResponse.suggestions ?? []).map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => setQuestion(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <small>{agentResponse.dataFreshnessNote}</small>
          </div>
        </Panel>
      ) : null}

      {agentResponse?.evidence ? (
        <Panel title="Why this answer" subtitle={agentResponse.evidence.insight}>
          <div className="customer-agent-why">
            <article>
              <span>Customer</span>
              <strong>{agentResponse.evidence.targetCustomer.customerName}</strong>
              <small>{agentResponse.evidence.targetCustomer.customerPhoneMasked || "Masked phone unavailable"}</small>
            </article>
            <article>
              <span>Health score</span>
              <strong>{metricValue(agentResponse.evidence.metrics, "Health score")}</strong>
            </article>
            <article>
              <span>Risk</span>
              <strong>{metricValue(agentResponse.evidence.metrics, "Risk level")}</strong>
            </article>
            <article>
              <span>Remaining sessions</span>
              <strong>{metricValue(agentResponse.evidence.metrics, "Remaining sessions")}</strong>
            </article>
            <article>
              <span>Days since last visit</span>
              <strong>{metricValue(agentResponse.evidence.metrics, "Days since visit")}</strong>
            </article>
          </div>
        </Panel>
      ) : null}

      {agentResponse?.evidence?.packages.length ? (
        <Panel title="Package Evidence" subtitle="Package total, used, remaining, latest usage, therapist, and status for the top matched customer.">
          <CustomerPackageEvidenceTable packages={agentResponse.evidence.packages} formatDate={formatDate} />
        </Panel>
      ) : null}

      {agentResponse?.evidence?.usageHeatmap && agentResponse.evidence.usageHeatmap.services.length > 0 ? (
        <Panel title="Service Usage Over Time" subtitle={`${agentResponse.evidence.usageHeatmap.year} service usage heatmap for the top matched customer.`}>
          <CustomerUsageHeatmap data={agentResponse.evidence.usageHeatmap} />
        </Panel>
      ) : null}

      <Panel
        title="Priority Customers"
        subtitle="Rows come from learned Firestore profiles, not raw free-form SQL."
        action={
          <label className="field field--compact field--search">
            <span>Search</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, masked phone, member ID" />
          </label>
        }
      >
        <div className="customer-agent-priority-controls">
          {SEGMENT_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`button ${activeFilterId === filter.id ? "button--primary" : "button--secondary"}`}
              onClick={() => {
                setActiveFilterId(filter.id);
                setAgentResponse(null);
              }}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {busyAction === "profiles" ? (
          <div className="inline-note inline-note--loading">Loading learned customer profiles...</div>
        ) : displayRows.length === 0 ? (
          <EmptyState label="No learned profiles found" detail="Run learning, change the segment, or try a different search." />
        ) : (
          <DataTable
            rows={displayRows}
            rowKey={(row) => row.customerKey}
            columns={[
              {
                key: "customer",
                header: "Customer",
                render: (row) => (
                  <button type="button" className="entity-link-button entity-link-button--strong" onClick={() => setSelectedCustomerKey(row.customerKey)}>
                    {row.customerName}
                    {row.customerPhoneMasked ? ` · ${row.customerPhoneMasked}` : ""}
                  </button>
                ),
              },
              { key: "lastVisit", header: "Last visit", render: (row) => formatDate(row.lastVisitDate) },
              {
                key: "days",
                header: "Days since",
                render: (row) => (row.daysSinceLastVisit == null ? "—" : row.daysSinceLastVisit.toLocaleString("en-US")),
              },
              {
                key: "balance",
                header: "Package balance",
                render: (row) => row.remainingPackageSessions.toLocaleString("en-US"),
              },
              { key: "spend", header: "Lifetime spend", render: (row) => formatMoney(row.lifetimeSpend) },
              {
                key: "risk",
                header: "Risk",
                render: (row) => <span className={`status-pill status-pill--${riskTone(row.riskLevel)}`}>{row.riskLevel}</span>,
              },
              {
                key: "segments",
                header: "Segments",
                render: (row) => row.segments.slice(0, 2).map(formatSegment).join(", "),
              },
              { key: "action", header: "Next best action", render: (row) => row.nextBestAction },
              {
                key: "followUp",
                header: "Follow-up",
                render: (row) => row.lastFollowUpOutcome?.replace(/_/g, " ") ?? "Not recorded",
              },
              {
                key: "tools",
                header: "Actions",
                render: (row) => (
                  <div className="button-row">
                    <button type="button" className="button button--primary" onClick={() => void handleGenerateMessage(row.customerKey)}>
                      Message
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Panel>

      {selectedCustomerKey || agentResponse?.evidence ? (
        <Panel
          title="Suggested Message"
          subtitle={
            followUpMessage?.reason ??
            (selectedCustomerName ? `Generate a safe follow-up draft for ${selectedCustomerName}.` : "Select a customer or ask the agent first.")
          }
          action={
            <button
              type="button"
              className="button button--primary"
              onClick={() => void handleGenerateMessage(selectedCustomerKey ?? agentResponse?.evidence?.targetCustomer.customerKey ?? "")}
              disabled={busyAction !== null || !(selectedCustomerKey ?? agentResponse?.evidence?.targetCustomer.customerKey)}
            >
              {busyAction === "message" ? "Generating..." : "Generate Message"}
            </button>
          }
        >
          <div className="customer-agent-message">
            {followUpMessage ? (
              <p>{followUpMessage.message}</p>
            ) : (
              <EmptyState label="No suggested message generated yet" detail="Generate a draft after choosing a priority customer." />
            )}
            {followUpMessage ? (
              <div className="filter-row">
              <button
                className="button button--secondary"
                type="button"
                onClick={() => void navigator.clipboard.writeText(followUpMessage.message)}
              >
                Copy
              </button>
              {FEEDBACK_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className="button button--secondary"
                  type="button"
                  onClick={() => void handleFeedback(option.value)}
                  disabled={busyAction !== null}
                >
                  {option.label}
                </button>
              ))}
            </div>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
