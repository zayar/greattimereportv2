import { useCallback, useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { Link } from "react-router-dom";
import {
  fetchConsultantServiceKnowledge,
  fetchConsultantServices,
  generateConsultantServiceKnowledgeDraft,
  pollConsultantServiceKnowledgeDraft,
  publishConsultantServiceKnowledge,
  saveConsultantServiceKnowledgeDraft,
} from "../../../api/ai";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import type {
  ConsultantKnowledgeContent,
  ConsultantKnowledgeLocale,
  ConsultantKnowledgeSuggestion,
  ConsultantKnowledgeSuggestionProgress,
  ConsultantServiceKnowledge,
  ConsultantServiceKnowledgeListResponse,
  ConsultantServiceKnowledgeRow,
} from "../../../types/domain";
import { useAccess } from "../../access/AccessProvider";
import { useSession } from "../../auth/SessionProvider";
import { canAccessAiControlPanel } from "../adminAccess";
import { runBoundedTasks, selectUnpublishedConsultantServices } from "./bulkKnowledge";

type KnowledgeLanguage = "en" | "my";
type ListField = Exclude<keyof ConsultantKnowledgeLocale, "overview">;

const QUEEN_CLINIC_CODE = "GTTHEQUEEN";
const AI_DRAFT_POLL_INTERVAL_MS = 2_000;
const AI_DRAFT_MAX_WAIT_MS = 4 * 60_000;
const BULK_PUBLISH_CONCURRENCY = 2;

interface BulkKnowledgeFailure {
  serviceId: string;
  serviceName: string;
  message: string;
}

interface BulkKnowledgeProgress {
  status: "running" | "completed";
  total: number;
  completed: number;
  published: number;
  failed: number;
  active: Array<{ serviceId: string; serviceName: string }>;
  failures: BulkKnowledgeFailure[];
}

const KNOWLEDGE_FIELDS: Array<{
  key: ListField;
  label: string;
  help: string;
}> = [
  { key: "serviceAliases", label: "Service aliases", help: "Alternative names customers may use." },
  { key: "concerns", label: "Customer concerns", help: "Examples: dry skin, facial hair, pigmentation. One phrase per line." },
  { key: "suitableFor", label: "May be suitable for", help: "Approved suitability guidance; avoid diagnosis or guarantees." },
  { key: "notSuitableFor", label: "Not suitable for", help: "Conditions or situations where staff should not recommend this service." },
  { key: "benefits", label: "Benefits", help: "Approved, realistic benefits without promising outcomes." },
  { key: "limitations", label: "Limitations", help: "What the service cannot promise or address." },
  { key: "preparation", label: "Preparation", help: "What a customer should do before the appointment." },
  { key: "aftercare", label: "Aftercare", help: "Approved care guidance after the service." },
  { key: "expectedResults", label: "Expected results", help: "Conservative expectations and timing." },
  { key: "consultationQuestions", label: "Consultation questions", help: "Questions the Consultant should ask before suggesting this service." },
  { key: "escalationRules", label: "Escalation rules", help: "When to stop and refer to trained staff or a medical professional." },
];

function emptyLocale(): ConsultantKnowledgeLocale {
  return {
    overview: "",
    serviceAliases: [],
    concerns: [],
    suitableFor: [],
    notSuitableFor: [],
    benefits: [],
    limitations: [],
    preparation: [],
    aftercare: [],
    expectedResults: [],
    consultationQuestions: [],
    escalationRules: [],
  };
}

function emptyContent(): ConsultantKnowledgeContent {
  return { en: emptyLocale(), my: emptyLocale() };
}

function linesToList(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatPrice(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString("en-US")} MMK` : "Unavailable";
}

function errorMessage(error: unknown) {
  if (isAxiosError(error)) {
    const data = error.response?.data as { error?: unknown } | undefined;
    if (typeof data?.error === "string" && data.error.trim()) {
      return data.error;
    }
  }
  return error instanceof Error ? error.message : "The Consultant knowledge request failed.";
}

function knowledgeStatus(row: ConsultantServiceKnowledgeRow) {
  if (row.knowledgeStatus === "missing") {
    return "Missing";
  }
  if (row.hasUnpublishedChanges) {
    return row.publishedVersion ? "Draft changes" : "Draft";
  }
  return row.knowledgeStatus === "published" ? "Published" : row.knowledgeStatus;
}

function hasKnowledgeContent(content: ConsultantKnowledgeContent) {
  return Object.values(content).some((locale) =>
    Boolean(locale.overview.trim()) ||
    Object.entries(locale).some(([key, value]) => key !== "overview" && Array.isArray(value) && value.length > 0),
  );
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export function ConsultantKnowledgePage() {
  const { currentClinic, loading: accessLoading, error: accessError } = useAccess();
  const { gtUser } = useSession();
  const [list, setList] = useState<ConsultantServiceKnowledgeListResponse | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [knowledge, setKnowledge] = useState<ConsultantServiceKnowledge | null>(null);
  const [content, setContent] = useState<ConsultantKnowledgeContent>(emptyContent);
  const [language, setLanguage] = useState<KnowledgeLanguage>("en");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<ConsultantKnowledgeSuggestion | null>(null);
  const [generationFeedback, setGenerationFeedback] = useState<{
    tone: "progress" | "error";
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<BulkKnowledgeProgress | null>(null);

  const isQueen = currentClinic?.code?.trim().toUpperCase() === QUEEN_CLINIC_CODE;
  const isAdmin = canAccessAiControlPanel(gtUser?.email);

  const loadServices = useCallback(async (keepSelection = true) => {
    if (!currentClinic || !isQueen) {
      return;
    }

    const data = await fetchConsultantServices({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
    });
    setList(data);
    setSelectedServiceId((current) => {
      if (keepSelection && current && data.rows.some((row) => row.serviceId === current)) {
        return current;
      }
      return data.rows[0]?.serviceId ?? null;
    });
  }, [currentClinic, isQueen]);

  useEffect(() => {
    setList(null);
    setSelectedServiceId(null);
    setKnowledge(null);
    setContent(emptyContent());
    setDirty(false);
    setAiSuggestion(null);
    setGenerationFeedback(null);
    setBulkProgress(null);
    setNotice(null);
    setError(null);

    if (!currentClinic || !isQueen || !isAdmin) {
      return;
    }

    setLoading(true);
    loadServices(false).catch((loadError) => setError(errorMessage(loadError))).finally(() => setLoading(false));
  }, [currentClinic?.id, isAdmin, isQueen, loadServices]);

  useEffect(() => {
    if (!currentClinic || !selectedServiceId || !isQueen || !isAdmin) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    setNotice(null);
    fetchConsultantServiceKnowledge({
      clinicId: currentClinic.id,
      clinicCode: currentClinic.code,
      serviceId: selectedServiceId,
    })
      .then((data) => {
        if (!active) {
          return;
        }
        setKnowledge(data.knowledge);
        setContent(data.knowledge?.content ?? emptyContent());
        setDirty(false);
        setAiSuggestion(null);
      })
      .catch((loadError) => active && setError(errorMessage(loadError)))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [currentClinic, isAdmin, isQueen, selectedServiceId]);

  const selectedService = list?.rows.find((row) => row.serviceId === selectedServiceId) ?? null;
  const filteredServices = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) {
      return list?.rows ?? [];
    }
    return (list?.rows ?? []).filter((row) => row.serviceName.toLocaleLowerCase().includes(query));
  }, [list?.rows, search]);
  const unpublishedServices = useMemo(
    () => selectUnpublishedConsultantServices(list?.rows ?? []),
    [list?.rows],
  );
  const bulkRunning = bulkProgress?.status === "running";

  useEffect(() => {
    if (!bulkRunning) {
      return;
    }

    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [bulkRunning]);

  const updateLocale = (update: Partial<ConsultantKnowledgeLocale>) => {
    setContent((current) => ({
      ...current,
      [language]: { ...current[language], ...update },
    }));
    setDirty(true);
    setNotice(null);
  };

  const saveDraft = async () => {
    if (!currentClinic || !selectedServiceId) {
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const data = await saveConsultantServiceKnowledgeDraft({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        serviceId: selectedServiceId,
        content,
        expectedVersion: knowledge?.version ?? null,
      });
      setKnowledge(data.knowledge);
      setContent(data.knowledge.content);
      setDirty(false);
      setNotice("Draft saved. The Consultant will continue using the last published version.");
      await loadServices();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const generateAiDraft = async () => {
    if (!currentClinic || !selectedServiceId || !selectedService) {
      return;
    }

    if (
      hasKnowledgeContent(content) &&
      !window.confirm(
        "Generate a new AI-assisted draft using the current form as context? Review every field before saving because the form content will be replaced.",
      )
    ) {
      return;
    }

    setGenerating(true);
    setError(null);
    setNotice(null);
    setGenerationFeedback({ tone: "progress", message: "Starting a secure GPT-5.6 draft job..." });
    try {
      const startedAt = Date.now();
      let result: ConsultantKnowledgeSuggestionProgress = await generateConsultantServiceKnowledgeDraft({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        serviceId: selectedServiceId,
        currentContent: content,
      });

      while (result.status === "queued" || result.status === "in_progress") {
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1_000));
        setGenerationFeedback({
          tone: "progress",
          message: result.status === "queued"
            ? `GPT-5.6 is queued (${elapsedSeconds}s). This page will update automatically.`
            : `GPT-5.6 is preparing English and Myanmar guidance (${elapsedSeconds}s). This page will update automatically.`,
        });

        if (Date.now() - startedAt >= AI_DRAFT_MAX_WAIT_MS) {
          throw new Error("GPT-5.6 is still processing after four minutes. No knowledge was changed; try again shortly.");
        }

        await wait(AI_DRAFT_POLL_INTERVAL_MS);
        result = await pollConsultantServiceKnowledgeDraft({
          clinicId: currentClinic.id,
          clinicCode: currentClinic.code,
          serviceId: selectedServiceId,
          responseId: result.job.responseId,
          jobToken: result.job.jobToken,
        });
      }

      if (result.status !== "completed") {
        throw new Error("GPT-5.6 did not return a completed draft. No knowledge was changed.");
      }

      setContent(result.suggestion.content);
      setAiSuggestion(result.suggestion);
      setLanguage("en");
      setDirty(true);
      setGenerationFeedback(null);
      setNotice("AI-assisted draft generated. It has not been saved or published; review every field first.");
    } catch (suggestionError) {
      const message = errorMessage(suggestionError);
      setError(message);
      setGenerationFeedback({ tone: "error", message });
    } finally {
      setGenerating(false);
    }
  };

  const generateAndPublishAll = async () => {
    if (!currentClinic || !list || bulkRunning || unpublishedServices.length === 0) {
      return;
    }

    if (dirty) {
      setError("Save or discard the selected service's unsaved changes before starting the bulk rollout.");
      return;
    }

    const count = unpublishedServices.length;
    if (!window.confirm(
      `Generate and immediately publish ${count} services with no published knowledge? ` +
      "Existing published services will not be changed. Existing unpublished drafts will be published as saved. " +
      "New drafts will be generated by GPT-5.6 Sol and checked by the current publishing rules, but they will not receive individual human review. " +
      "Keep this page open until the run finishes. Continue?",
    )) {
      return;
    }

    setError(null);
    setNotice(null);
    setGenerationFeedback(null);
    setBulkProgress({
      status: "running",
      total: count,
      completed: 0,
      published: 0,
      failed: 0,
      active: [],
      failures: [],
    });

    const processService = async (service: ConsultantServiceKnowledgeRow) => {
      const current = await fetchConsultantServiceKnowledge({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        serviceId: service.serviceId,
      });

      if (current.knowledge?.publishedVersion !== null && current.knowledge?.publishedVersion !== undefined) {
        return "already-published" as const;
      }

      if (current.knowledge && hasKnowledgeContent(current.knowledge.content)) {
        await publishConsultantServiceKnowledge({
          clinicId: currentClinic.id,
          clinicCode: currentClinic.code,
          serviceId: service.serviceId,
          expectedVersion: current.knowledge.version,
        });
        return "existing-draft" as const;
      }

      const startedAt = Date.now();
      let result: ConsultantKnowledgeSuggestionProgress = await generateConsultantServiceKnowledgeDraft({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        serviceId: service.serviceId,
        currentContent: current.knowledge?.content ?? emptyContent(),
      });

      while (result.status === "queued" || result.status === "in_progress") {
        if (Date.now() - startedAt >= AI_DRAFT_MAX_WAIT_MS) {
          throw new Error("GPT-5.6 was still processing after four minutes.");
        }
        await wait(AI_DRAFT_POLL_INTERVAL_MS);
        result = await pollConsultantServiceKnowledgeDraft({
          clinicId: currentClinic.id,
          clinicCode: currentClinic.code,
          serviceId: service.serviceId,
          responseId: result.job.responseId,
          jobToken: result.job.jobToken,
        });
      }

      if (result.status !== "completed") {
        throw new Error("GPT-5.6 did not return a completed draft.");
      }

      const saved = await saveConsultantServiceKnowledgeDraft({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        serviceId: service.serviceId,
        content: result.suggestion.content,
        expectedVersion: current.knowledge?.version ?? null,
      });
      await publishConsultantServiceKnowledge({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        serviceId: service.serviceId,
        expectedVersion: saved.knowledge.version,
      });
      return "generated" as const;
    };

    const results = await runBoundedTasks(
      unpublishedServices,
      BULK_PUBLISH_CONCURRENCY,
      processService,
      {
        onStart: (service) => {
          setBulkProgress((current) => current ? {
            ...current,
            active: [...current.active, { serviceId: service.serviceId, serviceName: service.serviceName }],
          } : current);
        },
        onSettled: (service, taskError) => {
          setBulkProgress((current) => current ? {
            ...current,
            completed: current.completed + 1,
            published: current.published + (taskError ? 0 : 1),
            failed: current.failed + (taskError ? 1 : 0),
            active: current.active.filter((item) => item.serviceId !== service.serviceId),
            failures: taskError ? [
              ...current.failures,
              { serviceId: service.serviceId, serviceName: service.serviceName, message: errorMessage(taskError) },
            ] : current.failures,
          } : current);
        },
      },
    );

    const failures = results.flatMap((result) => result.status === "rejected" ? [{
      serviceId: result.item.serviceId,
      serviceName: result.item.serviceName,
      message: errorMessage(result.error),
    }] : []);
    const publishedCount = results.length - failures.length;
    setBulkProgress({
      status: "completed",
      total: results.length,
      completed: results.length,
      published: publishedCount,
      failed: failures.length,
      active: [],
      failures,
    });

    try {
      await loadServices();
      if (selectedServiceId) {
        const refreshed = await fetchConsultantServiceKnowledge({
          clinicId: currentClinic.id,
          clinicCode: currentClinic.code,
          serviceId: selectedServiceId,
        });
        setKnowledge(refreshed.knowledge);
        setContent(refreshed.knowledge?.content ?? emptyContent());
        setDirty(false);
        setAiSuggestion(null);
      }
      setNotice(
        failures.length === 0
          ? `${publishedCount} services generated or reused, validated, and published for the Consultant.`
          : `${publishedCount} services published. ${failures.length} failed and can be retried with the bulk button.`,
      );
    } catch (refreshError) {
      setError(`The batch finished, but the page could not refresh: ${errorMessage(refreshError)}`);
    }
  };

  const publish = async () => {
    if (!currentClinic || !selectedServiceId || !knowledge || dirty) {
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const data = await publishConsultantServiceKnowledge({
        clinicId: currentClinic.id,
        clinicCode: currentClinic.code,
        serviceId: selectedServiceId,
        expectedVersion: knowledge.version,
      });
      setKnowledge(data.knowledge);
      setContent(data.knowledge.content);
      setNotice(`Version ${data.knowledge.publishedVersion} published and available to the Consultant.`);
      await loadServices();
    } catch (publishError) {
      setError(errorMessage(publishError));
    } finally {
      setSaving(false);
    }
  };

  if (accessLoading) {
    return <EmptyState label="Loading clinic access" />;
  }
  if (accessError || !currentClinic) {
    return <ErrorState label="Consultant knowledge unavailable" detail={accessError ?? "Choose a clinic to continue."} />;
  }
  if (!isAdmin) {
    return <ErrorState label="Consultant knowledge restricted" detail="Only AI Control Panel admins can edit and publish service knowledge." />;
  }
  if (!isQueen) {
    return <ErrorState label="Queen preview only" detail="Select The Queen clinic to manage Consultant service knowledge." />;
  }

  return (
    <div className="consultant-knowledge-page">
      <header className="consultant-knowledge-header">
        <div>
          <p className="consultant-knowledge-eyebrow">Consultant Agent · Queen preview</p>
          <h1>Service knowledge</h1>
          <p>
            Add approved consultation guidance to active API Core services. Prices and durations remain read-only and live.
          </p>
        </div>
        <div className="consultant-knowledge-header__actions">
          <button
            type="button"
            className="button"
            onClick={() => void generateAndPublishAll()}
            disabled={bulkRunning || generating || saving || loading || unpublishedServices.length === 0}
          >
            {bulkRunning
              ? `Publishing ${bulkProgress.completed}/${bulkProgress.total}...`
              : !list
                ? "Loading services..."
                : unpublishedServices.length > 0
                ? `✦ Generate & publish ${unpublishedServices.length}`
                : "All services published"}
          </button>
          <Link
            className="button button--secondary"
            to="/ai/agent-hub"
            aria-disabled={bulkRunning}
            onClick={(event) => {
              if (bulkRunning) {
                event.preventDefault();
              }
            }}
          >
            Test in Agent workspace
          </Link>
        </div>
      </header>

      {list ? (
        <section className="consultant-knowledge-summary" aria-label="Knowledge coverage">
          <div><span>Active services</span><strong>{list.summary.activeServiceCount}</strong></div>
          <div><span>Published</span><strong>{list.summary.publishedKnowledgeCount}</strong></div>
          <div><span>Draft changes</span><strong>{list.summary.draftKnowledgeCount}</strong></div>
        </section>
      ) : null}

      {bulkProgress ? (
        <section className="consultant-bulk-progress" data-status={bulkProgress.status} aria-live="polite">
          <div className="consultant-bulk-progress__heading">
            <div>
              <span>{bulkProgress.status === "running" ? "Bulk rollout in progress" : "Bulk rollout finished"}</span>
              <strong>
                {bulkProgress.completed} of {bulkProgress.total} processed · {bulkProgress.published} published
                {bulkProgress.failed > 0 ? ` · ${bulkProgress.failed} failed` : ""}
              </strong>
            </div>
            {bulkProgress.active.length > 0 ? (
              <small>Working on {bulkProgress.active.map((item) => item.serviceName).join(" and ")}</small>
            ) : null}
          </div>
          <progress value={bulkProgress.completed} max={bulkProgress.total}>
            {bulkProgress.completed} of {bulkProgress.total}
          </progress>
          {bulkProgress.status === "running" ? (
            <p>Keep this page open. Two services run at a time to control API load; completed services are saved immediately, so the rollout is resumable.</p>
          ) : null}
          {bulkProgress.failures.length > 0 ? (
            <details>
              <summary>Review {bulkProgress.failures.length} failed services</summary>
              <ul>
                {bulkProgress.failures.map((failure) => (
                  <li key={failure.serviceId}><strong>{failure.serviceName}</strong>: {failure.message}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      {error ? <ErrorState label="Consultant knowledge issue" detail={error} /> : null}
      {notice ? <p className="consultant-knowledge-notice" role="status">{notice}</p> : null}

      <div className="consultant-knowledge-layout">
        <aside className="consultant-service-list">
          <label className="field">
            <span>Find a service</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search active services" />
          </label>
          <div className="consultant-service-list__rows">
            {filteredServices.map((service) => (
              <button
                key={service.serviceId}
                type="button"
                className={service.serviceId === selectedServiceId ? "consultant-service-row consultant-service-row--active" : "consultant-service-row"}
                onClick={() => {
                  if (dirty && !window.confirm("Discard unsaved knowledge changes?")) {
                    return;
                  }
                  setAiSuggestion(null);
                  setGenerationFeedback(null);
                  setSelectedServiceId(service.serviceId);
                }}
                disabled={generating || bulkRunning}
              >
                <span><strong>{service.serviceName}</strong><small>{formatPrice(service.price)} · {service.durationMinutes} min</small></span>
                <em data-status={service.knowledgeStatus}>{knowledgeStatus(service)}</em>
              </button>
            ))}
            {!loading && filteredServices.length === 0 ? <p>No active services found.</p> : null}
          </div>
        </aside>

        <main className="consultant-knowledge-editor">
          {loading && !selectedService ? <EmptyState label="Loading service knowledge" /> : null}
          {selectedService ? (
            <>
              <div className="consultant-knowledge-editor__service">
                <div>
                  <span>API Core service</span>
                  <h2>{selectedService.serviceName}</h2>
                  <p>{selectedService.description || "No API Core service description."}</p>
                  <div className="consultant-ai-draft-action">
                    <button
                      type="button"
                      className="button"
                      onClick={() => void generateAiDraft()}
                      disabled={generating || saving || loading || bulkRunning}
                    >
                      {generating ? "Generating with GPT-5.6..." : "✦ Generate AI draft"}
                    </button>
                    <small>Uses GPT-5.6 Sol. Single-service suggestions stay editable; the confirmed bulk rollout publishes after validation.</small>
                    {generationFeedback ? (
                      <p
                        className="consultant-ai-generation-feedback"
                        data-tone={generationFeedback.tone}
                        role={generationFeedback.tone === "error" ? "alert" : "status"}
                      >
                        {generationFeedback.tone === "progress" ? <span aria-hidden="true" /> : null}
                        {generationFeedback.message}
                      </p>
                    ) : null}
                  </div>
                </div>
                <dl>
                  <div><dt>Current price</dt><dd>{formatPrice(selectedService.price)}</dd></div>
                  <div><dt>Duration</dt><dd>{selectedService.durationMinutes} minutes</dd></div>
                  <div><dt>Knowledge</dt><dd>{knowledge ? `v${knowledge.version}` : "Not created"}</dd></div>
                  <div><dt>Published</dt><dd>{knowledge?.publishedVersion ? `v${knowledge.publishedVersion}` : "No"}</dd></div>
                </dl>
              </div>

              {aiSuggestion ? (
                <section className="consultant-ai-review" aria-label="AI draft review notes">
                  <header>
                    <div>
                      <span>AI-assisted draft</span>
                      <strong>{aiSuggestion.generation.model}</strong>
                    </div>
                    <em data-confidence={aiSuggestion.confidence}>{aiSuggestion.confidence} confidence</em>
                  </header>
                  <p>Generated content is not clinic-approved. Confirm safety guidance, contraindications and service-specific claims before saving.</p>
                  <div className="consultant-ai-review__groups">
                    {aiSuggestion.warnings.length > 0 ? (
                      <div><strong>Warnings</strong><ul>{aiSuggestion.warnings.map((item, index) => <li key={`warning-${index}-${item}`}>{item}</li>)}</ul></div>
                    ) : null}
                    {aiSuggestion.missingInformation.length > 0 ? (
                      <div><strong>Missing information</strong><ul>{aiSuggestion.missingInformation.map((item, index) => <li key={`missing-${index}-${item}`}>{item}</li>)}</ul></div>
                    ) : null}
                    {aiSuggestion.reviewNotes.length > 0 ? (
                      <div><strong>Review notes</strong><ul>{aiSuggestion.reviewNotes.map((item, index) => <li key={`review-${index}-${item}`}>{item}</li>)}</ul></div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <div className="consultant-language-tabs" role="tablist" aria-label="Knowledge language">
                <button type="button" className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")} disabled={bulkRunning}>English</button>
                <button type="button" className={language === "my" ? "active" : ""} onClick={() => setLanguage("my")} disabled={bulkRunning}>Myanmar</button>
              </div>

              <section className="consultant-knowledge-fields">
                <label className="field consultant-knowledge-field--wide">
                  <span>Customer-friendly overview</span>
                  <small>Approved explanation of what the service is and what it is intended to do.</small>
                  <textarea
                    rows={4}
                    value={content[language].overview}
                    onChange={(event) => updateLocale({ overview: event.target.value })}
                    disabled={bulkRunning}
                  />
                </label>
                {KNOWLEDGE_FIELDS.map((field) => (
                  <label className="field" key={`${language}-${field.key}`}>
                    <span>{field.label}</span>
                    <small>{field.help}</small>
                    <textarea
                      rows={5}
                      value={content[language][field.key].join("\n")}
                      onChange={(event) => updateLocale({ [field.key]: linesToList(event.target.value) })}
                      disabled={bulkRunning}
                    />
                  </label>
                ))}
              </section>

              <footer className="consultant-knowledge-actions">
                <p>
                  {dirty ? "Unsaved changes" : knowledge?.publishedVersion === knowledge?.version ? "Published version is current" : "Draft is not published"}
                </p>
                <button type="button" className="button button--secondary" onClick={() => void saveDraft()} disabled={saving || generating || bulkRunning || !dirty}>
                  {saving ? "Saving..." : "Save draft"}
                </button>
                <button type="button" className="button" onClick={() => void publish()} disabled={saving || generating || bulkRunning || dirty || !knowledge || knowledge.publishedVersion === knowledge.version}>
                  Publish for Consultant
                </button>
              </footer>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
