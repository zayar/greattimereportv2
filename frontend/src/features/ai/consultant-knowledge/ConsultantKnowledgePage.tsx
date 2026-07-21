import { useCallback, useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { Link } from "react-router-dom";
import {
  fetchConsultantServiceKnowledge,
  fetchConsultantServices,
  publishConsultantServiceKnowledge,
  saveConsultantServiceKnowledgeDraft,
} from "../../../api/ai";
import { EmptyState, ErrorState } from "../../../components/StatusViews";
import type {
  ConsultantKnowledgeContent,
  ConsultantKnowledgeLocale,
  ConsultantServiceKnowledge,
  ConsultantServiceKnowledgeListResponse,
  ConsultantServiceKnowledgeRow,
} from "../../../types/domain";
import { useAccess } from "../../access/AccessProvider";
import { useSession } from "../../auth/SessionProvider";
import { canAccessAiControlPanel } from "../adminAccess";

type KnowledgeLanguage = "en" | "my";
type ListField = Exclude<keyof ConsultantKnowledgeLocale, "overview">;

const QUEEN_CLINIC_CODE = "GTTHEQUEEN";

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
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
        <Link className="button button--secondary" to="/ai/agent-hub">Test in Agent workspace</Link>
      </header>

      {list ? (
        <section className="consultant-knowledge-summary" aria-label="Knowledge coverage">
          <div><span>Active services</span><strong>{list.summary.activeServiceCount}</strong></div>
          <div><span>Published</span><strong>{list.summary.publishedKnowledgeCount}</strong></div>
          <div><span>Draft changes</span><strong>{list.summary.draftKnowledgeCount}</strong></div>
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
                  setSelectedServiceId(service.serviceId);
                }}
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
                </div>
                <dl>
                  <div><dt>Current price</dt><dd>{formatPrice(selectedService.price)}</dd></div>
                  <div><dt>Duration</dt><dd>{selectedService.durationMinutes} minutes</dd></div>
                  <div><dt>Knowledge</dt><dd>{knowledge ? `v${knowledge.version}` : "Not created"}</dd></div>
                  <div><dt>Published</dt><dd>{knowledge?.publishedVersion ? `v${knowledge.publishedVersion}` : "No"}</dd></div>
                </dl>
              </div>

              <div className="consultant-language-tabs" role="tablist" aria-label="Knowledge language">
                <button type="button" className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>English</button>
                <button type="button" className={language === "my" ? "active" : ""} onClick={() => setLanguage("my")}>Myanmar</button>
              </div>

              <section className="consultant-knowledge-fields">
                <label className="field consultant-knowledge-field--wide">
                  <span>Customer-friendly overview</span>
                  <small>Approved explanation of what the service is and what it is intended to do.</small>
                  <textarea
                    rows={4}
                    value={content[language].overview}
                    onChange={(event) => updateLocale({ overview: event.target.value })}
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
                    />
                  </label>
                ))}
              </section>

              <footer className="consultant-knowledge-actions">
                <p>
                  {dirty ? "Unsaved changes" : knowledge?.publishedVersion === knowledge?.version ? "Published version is current" : "Draft is not published"}
                </p>
                <button type="button" className="button button--secondary" onClick={() => void saveDraft()} disabled={saving || !dirty}>
                  {saving ? "Saving..." : "Save draft"}
                </button>
                <button type="button" className="button" onClick={() => void publish()} disabled={saving || dirty || !knowledge || knowledge.publishedVersion === knowledge.version}>
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
