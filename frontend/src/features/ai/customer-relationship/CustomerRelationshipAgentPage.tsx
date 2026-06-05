import { useCallback, useEffect, useMemo, useState } from "react";
import {
  askCustomerRelationshipAgent,
  fetchCustomerRelationshipProfiles,
  generateCustomerFollowUpMessage,
  recordCustomerRelationshipFeedback,
  runCustomerRelationshipLearning,
} from "../../../api/ai";
import { DataTable } from "../../../components/DataTable";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import type {
  CustomerRelationshipAgentResponse,
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

function profileToAgentRow(profile: CustomerRelationshipProfile) {
  return {
    customerKey: profile.customerKey,
    customerName: profile.customerName,
    customerPhoneMasked: profile.customerPhoneMasked,
    lastVisitDate: profile.lastVisitDate,
    daysSinceLastVisit: profile.daysSinceLastVisit,
    remainingPackageSessions: profile.remainingPackageSessions,
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

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.customerKey === selectedCustomerKey) ?? null,
    [profiles, selectedCustomerKey],
  );
  const displayRows = agentResponse?.rows.length ? agentResponse.rows : profiles.map(profileToAgentRow);
  const highRiskCount = profiles.filter((profile) => profile.riskLevel === "high").length;
  const packageNeverCameCount = profiles.filter((profile) => profile.segments.includes("package_bought_never_came")).length;
  const unusedBalanceCount = profiles.filter((profile) => profile.remainingPackageSessions > 0).length;

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
    if (!currentClinic || !question.trim()) {
      return;
    }

    setBusyAction("ask");
    setError(null);
    setNotice(null);

    try {
      const response = await askCustomerRelationshipAgent({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        question,
        aiLanguage,
        autoLearnIfStale: false,
      });
      setAgentResponse(response);
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

      <div className="report-kpi-strip">
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Last learned</span>
          <strong className="report-kpi-strip__value">{formatDate(lastLearnedAt)}</strong>
          <span className="report-kpi-strip__hint">
            {sourceLookbackDays ? `${sourceLookbackDays} day source lookback` : "Run learning to refresh profiles"}
          </span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Customers learned</span>
          <strong className="report-kpi-strip__value">{totalCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Profiles in learned memory</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">High risk</span>
          <strong className="report-kpi-strip__value">{highRiskCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Visible in current filter</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Package never came</span>
          <strong className="report-kpi-strip__value">{packageNeverCameCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Package purchase with no later visit</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Unused balance</span>
          <strong className="report-kpi-strip__value">{unusedBalanceCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Remaining package sessions</span>
        </article>
      </div>

      <Panel
        title="Ask Agent"
        subtitle="Questions are matched to safe supported intents and answered from learned customer profiles."
        action={
          <button className="button button--secondary" type="button" onClick={() => setQuestion(DEFAULT_QUESTION)}>
            Example
          </button>
        }
      >
        <div className="filter-row">
          <label className="field field--grow">
            <span>Question</span>
            <input
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask: Who bought package but never came?"
            />
          </label>
          <button className="button button--primary" type="button" onClick={() => void handleAsk()} disabled={busyAction !== null || !question.trim()}>
            {busyAction === "ask" ? "Asking..." : "Ask Agent"}
          </button>
        </div>

        {agentResponse ? (
          <div className="ai-panel">
            <p>{agentResponse.answerSummary}</p>
            <div className="customer-quick-panel__badges">
              <span className="status-pill status-pill--neutral">{agentResponse.detectedIntent.replace(/_/g, " ")}</span>
              <span className="status-pill status-pill--positive">{agentResponse.matchedCount.toLocaleString("en-US")} matches</span>
              {agentResponse.usedFallback ? <span className="status-pill status-pill--attention">Fallback summary</span> : null}
            </div>
            {agentResponse.recommendedActions.length ? (
              <ul>
                {agentResponse.recommendedActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            ) : null}
            <small>{agentResponse.dataFreshnessNote}</small>
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Priority Segments"
        subtitle="Switch between safe deterministic customer lists."
        action={
          <label className="field field--compact field--search">
            <span>Search</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, masked phone, member ID" />
          </label>
        }
      >
        <div className="filter-row">
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
      </Panel>

      <Panel title="Priority Customers" subtitle="Rows come from learned Firestore profiles, not raw free-form SQL.">
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
                    <button type="button" className="button button--secondary" onClick={() => setSelectedCustomerKey(row.customerKey)}>
                      View details
                    </button>
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

      {selectedProfile ? (
        <Panel
          title={`Customer details: ${selectedProfile.customerName}`}
          subtitle="Learned relationship profile and follow-up reasoning."
          action={
            <button type="button" className="button button--secondary" onClick={() => setSelectedCustomerKey(null)}>
              Close
            </button>
          }
        >
          <div className="report-kpi-strip">
            <article className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Health score</span>
              <strong className="report-kpi-strip__value">{selectedProfile.relationshipHealthScore}</strong>
              <span className="report-kpi-strip__hint">{selectedProfile.riskLevel} risk</span>
            </article>
            <article className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Preferred service</span>
              <strong className="report-kpi-strip__value">{selectedProfile.preferredService ?? "—"}</strong>
              <span className="report-kpi-strip__hint">{selectedProfile.preferredTherapist ?? "No preferred therapist"}</span>
            </article>
            <article className="report-kpi-strip__card">
              <span className="report-kpi-strip__label">Package sessions</span>
              <strong className="report-kpi-strip__value">{selectedProfile.remainingPackageSessions}</strong>
              <span className="report-kpi-strip__hint">{selectedProfile.usedPackageSessions} used</span>
            </article>
          </div>
          <div className="ai-panel">
            <strong>Why high priority</strong>
            <ul>
              {selectedProfile.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <strong>Next best action</strong>
            <p>{selectedProfile.nextBestAction}</p>
          </div>
        </Panel>
      ) : null}

      {followUpMessage ? (
        <Panel title={`Suggested message: ${followUpMessage.customerName}`} subtitle={followUpMessage.reason}>
          <div className="ai-panel">
            <p>{followUpMessage.message}</p>
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
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
