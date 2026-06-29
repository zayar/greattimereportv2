import { useCallback, useEffect, useMemo, useState } from "react";
import { AxiosError } from "axios";
import { PageHeader } from "../../../components/PageHeader";
import { Panel } from "../../../components/Panel";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import {
  fetchAiAgentMonitoringLive,
  fetchAiAgentMonitoringRunDetail,
  fetchAiAgentMonitoringRuns,
  fetchAiAgentMonitoringSummary,
} from "../../../api/ai";
import type {
  AiAgentMonitoringFilters,
  AiAgentMonitoringLiveResponse,
  AiAgentMonitoringRange,
  AiAgentMonitoringRunDetail,
  AiAgentMonitoringRunRow,
  AiAgentMonitoringRunsResponse,
  AiAgentMonitoringStatus,
  AiAgentMonitoringSummary,
} from "../../../types/domain";
import { useAccess } from "../../access/AccessProvider";
import { useSession } from "../../auth/SessionProvider";
import { canAccessAiAgentMonitoring } from "../../ai/adminAccess";

const AGENT_OPTIONS = [
  { value: "", label: "All agents" },
  { value: "supervisor", label: "Supervisor" },
  { value: "appointment_agent", label: "Appointment Agent" },
  { value: "customer_relationship_agent", label: "Customer Relationship Agent" },
  { value: "customer_360_agent", label: "Customer 360 Agent" },
  { value: "service_360_agent", label: "Service 360 Agent" },
  { value: "finance_agent", label: "Finance Agent" },
  { value: "growth_ai_sales_assistant", label: "Growth AI Sales Assistant" },
  { value: "report_ai_agent", label: "Report AI Agent" },
  { value: "telegram_agent", label: "Telegram Agent" },
  { value: "unknown", label: "Unknown" },
];

const STATUS_OPTIONS = [
  "",
  "running",
  "planning",
  "calling_tools",
  "generating_response",
  "sending_response",
  "completed",
  "failed",
  "timeout",
  "stuck",
  "cancelled",
] as const;

function getApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof AxiosError) {
    return (error.response?.data as { message?: string } | undefined)?.message ?? error.message ?? fallback;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function formatNumber(value: number | null | undefined) {
  return (value ?? 0).toLocaleString("en-US");
}

function formatPercent(value: number | null | undefined) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function formatLatency(value: number | null | undefined) {
  if (!value) {
    return "-";
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}s`;
  }
  return `${Math.round(value)}ms`;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function elapsedFrom(value?: string | null) {
  if (!value) {
    return "-";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1_000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h`;
}

function statusClass(status?: AiAgentMonitoringStatus | string | null) {
  if (status === "completed") {
    return "ai-agent-monitoring__badge ai-agent-monitoring__badge--success";
  }
  if (status === "failed" || status === "timeout") {
    return "ai-agent-monitoring__badge ai-agent-monitoring__badge--danger";
  }
  if (status === "stuck") {
    return "ai-agent-monitoring__badge ai-agent-monitoring__badge--warning";
  }
  if (status === "running" || status === "planning" || status === "calling_tools" || status === "generating_response" || status === "sending_response") {
    return "ai-agent-monitoring__badge ai-agent-monitoring__badge--info";
  }
  return "ai-agent-monitoring__badge ai-agent-monitoring__badge--muted";
}

function healthClass(health?: string | null) {
  if (health === "healthy") {
    return "ai-agent-monitoring__badge ai-agent-monitoring__badge--success";
  }
  if (health === "critical") {
    return "ai-agent-monitoring__badge ai-agent-monitoring__badge--danger";
  }
  if (health === "degraded") {
    return "ai-agent-monitoring__badge ai-agent-monitoring__badge--warning";
  }
  return "ai-agent-monitoring__badge ai-agent-monitoring__badge--muted";
}

function alertClass(severity: string) {
  if (severity === "critical") {
    return "ai-agent-monitoring__alert ai-agent-monitoring__alert--critical";
  }
  if (severity === "warning") {
    return "ai-agent-monitoring__alert ai-agent-monitoring__alert--warning";
  }
  return "ai-agent-monitoring__alert ai-agent-monitoring__alert--info";
}

function RunTable({
  rows,
  emptyLabel,
  onSelect,
}: {
  rows: AiAgentMonitoringRunRow[];
  emptyLabel: string;
  onSelect: (runId: string) => void;
}) {
  if (rows.length === 0) {
    return <EmptyState label={emptyLabel} detail="Try changing filters or refreshing the page." />;
  }

  return (
    <div className="table-scroll ai-agent-monitoring__table-wrap">
      <table className="data-table ai-agent-monitoring__table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Agent</th>
            <th>Clinic</th>
            <th>Channel</th>
            <th>User</th>
            <th>Question</th>
            <th>Current step</th>
            <th>Tools</th>
            <th>Started</th>
            <th>Elapsed</th>
            <th>Latency</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.runId}
              className="data-table__row--interactive"
              tabIndex={0}
              onClick={() => onSelect(row.runId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(row.runId);
                }
              }}
            >
              <td><span className={statusClass(row.status)}>{row.status}</span></td>
              <td>{row.agentLabel}</td>
              <td>{row.clinicName || row.clinicCode || row.clinicId || "-"}</td>
              <td>{row.channel}</td>
              <td>{row.userEmail || "-"}</td>
              <td className="ai-agent-monitoring__preview">{row.questionPreview || "-"}</td>
              <td>{row.currentStep || "-"}</td>
              <td>{row.toolNames.length ? row.toolNames.join(", ") : "-"}</td>
              <td>{formatDateTime(row.createdAt)}</td>
              <td>{row.completedAt ? formatLatency((new Date(row.completedAt).getTime() - new Date(row.createdAt).getTime())) : elapsedFrom(row.createdAt)}</td>
              <td>{formatLatency(row.totalLatencyMs)}</td>
              <td className="ai-agent-monitoring__preview">{row.sanitizedError || row.answerPreview || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunDetailDrawer({
  detail,
  loading,
  error,
  onClose,
}: {
  detail: AiAgentMonitoringRunDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  if (!detail && !loading && !error) {
    return null;
  }

  return (
    <div className="ai-agent-monitoring__drawer-shell" role="dialog" aria-modal="true" aria-label="Agent run detail">
      <button className="ai-agent-monitoring__drawer-backdrop" type="button" onClick={onClose} aria-label="Close run detail" />
      <aside className="ai-agent-monitoring__drawer">
        <header className="ai-agent-monitoring__drawer-header">
          <div>
            <span className="ai-agent-monitoring__eyebrow">Run detail</span>
            <h2>{detail?.run.agentLabel ?? "Loading run"}</h2>
          </div>
          <button type="button" className="button ai-agent-monitoring__button" onClick={onClose}>Close</button>
        </header>
        {loading ? <EmptyState label="Loading run detail" /> : null}
        {error ? <ErrorState label="Run detail unavailable" detail={error} /> : null}
        {detail ? (
          <div className="ai-agent-monitoring__drawer-body">
            <section className="ai-agent-monitoring__detail-grid">
              <div><span>Status</span><strong className={statusClass(detail.run.status)}>{detail.run.status}</strong></div>
              <div><span>Clinic</span><strong>{detail.run.clinicName || detail.run.clinicCode || detail.run.clinicId || "-"}</strong></div>
              <div><span>Channel</span><strong>{detail.run.channel}</strong></div>
              <div><span>Latency</span><strong>{formatLatency(detail.run.totalLatencyMs)}</strong></div>
              <div><span>Created</span><strong>{formatDateTime(detail.run.createdAt)}</strong></div>
              <div><span>Completed</span><strong>{formatDateTime(detail.run.completedAt)}</strong></div>
            </section>

            <section>
              <h3>User question</h3>
              <p className="ai-agent-monitoring__copy">{detail.run.questionPreview || "-"}</p>
            </section>
            <section>
              <h3>AI answer</h3>
              <p className="ai-agent-monitoring__copy">{detail.run.answerPreview || "-"}</p>
            </section>

            <section>
              <h3>Timeline</h3>
              <ol className="ai-agent-monitoring__timeline">
                {detail.timeline.map((item, index) => (
                  <li key={`${item.label}-${item.at}-${index}`}>
                    <span>{formatDateTime(item.at)}</span>
                    <strong>{item.label}</strong>
                    <small>{item.status}{item.detail ? ` · ${item.detail}` : ""}</small>
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <h3>Tools</h3>
              <div className="ai-agent-monitoring__mini-table">
                {detail.run.tools.length === 0 ? <p>No tool calls recorded.</p> : detail.run.tools.map((tool) => (
                  <div key={`${tool.toolName}-${tool.completedAt ?? ""}`}>
                    <strong>{tool.toolName}</strong>
                    <span className={statusClass(tool.status)}>{tool.status}</span>
                    <span>{formatLatency(tool.latencyMs)}</span>
                    <span>{tool.dataStatus || "-"}</span>
                    <small>{tool.errorMessage || tool.errorCategory || ""}</small>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3>Telegram</h3>
              <div className="ai-agent-monitoring__detail-grid">
                <div><span>Delivery</span><strong>{detail.run.telegramDeliveryStatus || "-"}</strong></div>
                <div><span>Callback</span><strong>{detail.run.telegramCallbackDataType || "-"}</strong></div>
                <div><span>Buttons</span><strong>{formatNumber(detail.run.buttonCount)}</strong></div>
                <div><span>Message length</span><strong>{formatNumber(detail.run.messageLength)}</strong></div>
              </div>
            </section>

            {detail.run.sanitizedError || detail.run.warnings.length ? (
              <section>
                <h3>Warnings and errors</h3>
                {detail.run.sanitizedError ? <p className="ai-agent-monitoring__copy ai-agent-monitoring__copy--danger">{detail.run.sanitizedError}</p> : null}
                {detail.run.warnings.map((warning) => <p key={warning} className="ai-agent-monitoring__copy">{warning}</p>)}
              </section>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

export function AiAgentMonitoringPage() {
  const { gtUser } = useSession();
  const { clinics, currentClinic } = useAccess();
  const canUseMonitoring = canAccessAiAgentMonitoring(gtUser?.email);
  const [filters, setFilters] = useState<AiAgentMonitoringFilters>({
    range: "24h",
    clinicId: "",
    channel: "",
    agent: "",
    status: "",
    search: "",
  });
  const [summary, setSummary] = useState<AiAgentMonitoringSummary | null>(null);
  const [runs, setRuns] = useState<AiAgentMonitoringRunsResponse>({ rows: [], nextCursor: null });
  const [live, setLive] = useState<AiAgentMonitoringLiveResponse>({ rows: [], generatedAt: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AiAgentMonitoringRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const requestFilters = useMemo(
    () => ({
      ...filters,
      clinicId: filters.clinicId || undefined,
      channel: filters.channel || undefined,
      agent: filters.agent || undefined,
      status: filters.status || undefined,
      search: filters.search?.trim() || undefined,
    }),
    [filters],
  );

  const loadDashboard = useCallback(async () => {
    if (!canUseMonitoring) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [summaryData, runsData, liveData] = await Promise.all([
        fetchAiAgentMonitoringSummary(requestFilters),
        fetchAiAgentMonitoringRuns({ ...requestFilters, limit: 50 }),
        fetchAiAgentMonitoringLive(requestFilters),
      ]);
      setSummary(summaryData);
      setRuns(runsData);
      setLive(liveData);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, "AI Agent Monitoring could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [canUseMonitoring, requestFilters]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!autoRefresh || !canUseMonitoring) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void loadDashboard();
    }, 10_000);

    return () => window.clearInterval(timer);
  }, [autoRefresh, canUseMonitoring, loadDashboard]);

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null);
      setDetailError(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    fetchAiAgentMonitoringRunDetail(selectedRunId)
      .then((data) => {
        if (!cancelled) {
          setDetail(data);
        }
      })
      .catch((detailLoadError) => {
        if (!cancelled) {
          setDetailError(getApiErrorMessage(detailLoadError, "Run detail could not be loaded."));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  const metricCards = [
    ["Active now", summary?.summary.activeNow],
    ["Stuck", summary?.summary.stuckRuns],
    ["Completed", summary?.summary.completedRuns],
    ["Failed", summary?.summary.failedRuns],
    ["Average latency", formatLatency(summary?.summary.averageLatencyMs)],
    ["P95 latency", formatLatency(summary?.summary.p95LatencyMs)],
    ["Tool failure rate", formatPercent(summary?.summary.toolFailureRate)],
    ["Wrong-data feedback", summary?.summary.wrongDataFeedbackCount],
    ["Telegram delivery failed", summary?.summary.telegramDeliveryFailureCount],
  ] as const;

  if (!canUseMonitoring) {
    return (
      <div className="page-stack page-stack--workspace analytics-report ai-agent-monitoring">
        <ErrorState
          label="AI Agent Monitoring restricted"
          detail="Only the configured monitoring owner can view AI agent operations."
        />
      </div>
    );
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report ai-agent-monitoring">
      <PageHeader
        title="AI Agent Monitoring"
        description="Read-only view of live AI agent activity, health, tool calls, and feedback."
        actions={
          <div className="ai-agent-monitoring__actions">
            <label className="ai-agent-monitoring__toggle">
              <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
              Auto refresh
            </label>
            <button type="button" className="button ai-agent-monitoring__button" onClick={() => void loadDashboard()} disabled={loading}>
              Refresh
            </button>
          </div>
        }
      />

      <Panel className="ai-agent-monitoring__panel">
        <div className="ai-agent-monitoring__filters">
          <label>
            <span>Range</span>
            <select value={filters.range} onChange={(event) => setFilters((current) => ({ ...current, range: event.target.value as AiAgentMonitoringRange }))}>
              <option value="1h">1h</option>
              <option value="24h">24h</option>
              <option value="7d">7d</option>
              <option value="30d">30d</option>
            </select>
          </label>
          <label>
            <span>Clinic</span>
            <select value={filters.clinicId} onChange={(event) => setFilters((current) => ({ ...current, clinicId: event.target.value }))}>
              <option value="">All clinics</option>
              {clinics.map((clinic) => (
                <option value={clinic.id} key={clinic.id}>{clinic.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Agent</span>
            <select value={filters.agent} onChange={(event) => setFilters((current) => ({ ...current, agent: event.target.value }))}>
              {AGENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>Channel</span>
            <select value={filters.channel} onChange={(event) => setFilters((current) => ({ ...current, channel: event.target.value as AiAgentMonitoringFilters["channel"] }))}>
              <option value="">All channels</option>
              <option value="telegram">Telegram</option>
              <option value="web">Web</option>
              <option value="system">System</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              {STATUS_OPTIONS.map((status) => <option key={status || "all"} value={status}>{status || "All statuses"}</option>)}
            </select>
          </label>
          <label className="ai-agent-monitoring__search">
            <span>Search</span>
            <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Question, tool, clinic, error" />
          </label>
        </div>
      </Panel>

      {error ? <ErrorState label="Monitoring unavailable" detail={error} /> : null}

      <div className="ai-agent-monitoring__status-strip">
        <div>
          <strong>{currentClinic?.company.name ?? "GreatTime"} AI operations</strong>
          <span>{summary?.generatedAt ? `Generated ${formatDateTime(summary.generatedAt)}` : loading ? "Loading live state" : "No monitoring data loaded yet"}</span>
        </div>
        <span className={healthClass(summary?.health)}>{summary?.health ?? "unknown"}</span>
      </div>

      <div className="ai-agent-monitoring__metric-grid" aria-busy={loading}>
        {metricCards.map(([label, value]) => (
          <article className="ai-agent-monitoring__metric" key={label}>
            <span>{label}</span>
            <strong>{typeof value === "number" ? formatNumber(value) : value ?? "-"}</strong>
          </article>
        ))}
      </div>

      <Panel title="Live agent runs" subtitle={`Active, stuck, and runs finished in the last 5 minutes${live.generatedAt ? ` · ${formatDateTime(live.generatedAt)}` : ""}`}>
        <RunTable rows={live.rows} emptyLabel="No live agent runs right now" onSelect={setSelectedRunId} />
      </Panel>

      <Panel title="Recent runs" subtitle="Completed, failed, stuck, and active work in the selected range">
        <RunTable rows={runs.rows} emptyLabel="No agent runs matched these filters" onSelect={setSelectedRunId} />
      </Panel>

      <div className="ai-agent-monitoring__two-column">
        <Panel title="Alerts">
          {summary?.alerts.length ? (
            <div className="ai-agent-monitoring__alert-list">
              {summary.alerts.map((alert) => (
                <div className={alertClass(alert.severity)} key={`${alert.code}-${alert.message}`}>
                  <strong>{alert.code.replace(/_/g, " ")}</strong>
                  <span>{alert.message}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState label="No active alerts" />}
        </Panel>

        <Panel title="By agent">
          <div className="ai-agent-monitoring__mini-table">
            {(summary?.byAgent ?? []).map((agent) => (
              <div key={agent.agentId}>
                <strong>{agent.agentLabel}</strong>
                <span>{formatNumber(agent.totalRuns)} runs</span>
                <span>{formatNumber(agent.activeRuns)} active</span>
                <span>{formatLatency(agent.p95LatencyMs)} p95</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="ai-agent-monitoring__two-column">
        <Panel title="Slowest tools">
          <div className="ai-agent-monitoring__mini-table">
            {(summary?.slowestTools ?? []).map((tool) => (
              <div key={tool.toolName}>
                <strong>{tool.toolName}</strong>
                <span>{formatNumber(tool.count)} calls</span>
                <span>{formatLatency(tool.averageLatencyMs)} avg</span>
                <span>{formatLatency(tool.p95LatencyMs)} p95</span>
                <small>{formatNumber(tool.timeoutCount)} timeouts · {formatNumber(tool.failureCount)} failures</small>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Failed tools">
          <div className="ai-agent-monitoring__mini-table">
            {(summary?.failingTools ?? []).map((tool) => (
              <div key={tool.toolName}>
                <strong>{tool.toolName}</strong>
                <span>{formatNumber(tool.failureCount)} failed</span>
                <span>{formatNumber(tool.timeoutCount)} timeout</span>
                <small>{tool.latestError || ""}</small>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Learning and memory" subtitle="Latest snapshot, profile, insight, and memory jobs">
        <div className="table-scroll ai-agent-monitoring__table-wrap">
          <table className="data-table ai-agent-monitoring__table">
            <thead>
              <tr>
                <th>Job type</th>
                <th>Clinic</th>
                <th>Latest run</th>
                <th>Status</th>
                <th>Rows</th>
                <th>Next expected</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.learning.rows ?? []).map((job) => (
                <tr key={`${job.clinicId}-${job.jobType}`}>
                  <td>{job.jobType}</td>
                  <td>{job.clinicCode || job.clinicId}</td>
                  <td>{formatDateTime(job.latestRunAt)}</td>
                  <td><span className={statusClass(job.status)}>{job.status}</span></td>
                  <td>{formatNumber(job.rowCount)}</td>
                  <td>{formatDateTime(job.nextExpectedRunAt)}</td>
                  <td className="ai-agent-monitoring__preview">{job.error || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Feedback" subtitle="Wrong-data feedback is shown as an operational risk">
        {(summary?.feedback.length ?? 0) === 0 ? <EmptyState label="No feedback in this range" /> : (
          <div className="table-scroll ai-agent-monitoring__table-wrap">
            <table className="data-table ai-agent-monitoring__table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Clinic</th>
                  <th>Agent</th>
                  <th>Feedback</th>
                  <th>Note</th>
                  <th>Question preview</th>
                </tr>
              </thead>
              <tbody>
                {summary?.feedback.map((feedback) => (
                  <tr key={feedback.id}>
                    <td>{formatDateTime(feedback.createdAt)}</td>
                    <td>{feedback.clinicId}</td>
                    <td>{feedback.agent || "-"}</td>
                    <td><span className={feedback.feedbackType === "wrong_data" ? statusClass("failed") : statusClass("completed")}>{feedback.feedbackType}</span></td>
                    <td className="ai-agent-monitoring__preview">{feedback.note || "-"}</td>
                    <td className="ai-agent-monitoring__preview">{feedback.questionPreview || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <RunDetailDrawer
        detail={detail}
        loading={detailLoading}
        error={detailError}
        onClose={() => setSelectedRunId(null)}
      />
    </div>
  );
}
