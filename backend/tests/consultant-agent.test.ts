import assert from "node:assert/strict";
import test from "node:test";
import type { ConsultantServiceKnowledge } from "../src/services/consultant-agent/service-knowledge.schemas.js";

process.env.APICORE_GRAPHQL_URL ??= "https://example.com/graphql";

const { planAgentRequest } = await import("../src/services/agent-hub/intent-planner.js");
const { getAgentToolAllowlist } = await import("../src/services/agent-hub/tool-registry.js");
const { containsUrgentConsultantConcern, rankConsultantKnowledge } = await import(
  "../src/services/agent-hub/tools/consultant.tools.js"
);
const { __test: catalogTest } = await import("../src/services/consultant-agent/service-catalog.service.js");
const { emptyConsultantKnowledgeContent, isConsultantKnowledgePublishable } = await import(
  "../src/services/consultant-agent/service-knowledge.schemas.js"
);
const {
  ConsultantKnowledgeSuggestionUnavailableError,
  __test: suggestionTest,
  consultantSafetyIdentifier,
  consultantSuggestionJobToken,
  generateConsultantKnowledgeSuggestion,
  pollConsultantKnowledgeSuggestion,
  startConsultantKnowledgeSuggestion,
} = await import("../src/services/consultant-agent/service-knowledge-suggestion.service.js");

function publishedDrySkinKnowledge(): ConsultantServiceKnowledge {
  const content = emptyConsultantKnowledgeContent();
  content.en = {
    ...content.en,
    overview: "A hydration-focused facial service.",
    serviceAliases: ["hydrating facial"],
    concerns: ["dry skin", "dehydrated skin"],
    suitableFor: ["Customers seeking additional skin hydration"],
    notSuitableFor: ["Active infection or open wounds"],
    benefits: ["May support a more hydrated appearance"],
    limitations: ["Results vary and are not guaranteed"],
    consultationQuestions: ["How long has the dryness been present?"],
    escalationRules: ["Refer painful or infected skin to a medical professional"],
  };

  return {
    id: "knowledge-1",
    clinicId: "queen-clinic",
    clinicCode: "GTTHEQUEEN",
    serviceId: "service-1",
    serviceName: "Hydration Facial",
    content,
    publishedContent: content,
    status: "published",
    version: 2,
    publishedVersion: 2,
    createdAt: "2026-07-21T00:00:00.000Z",
    createdBy: "admin-1",
    createdByEmail: "admin@example.com",
    updatedAt: "2026-07-21T00:00:00.000Z",
    updatedBy: "admin-1",
    updatedByEmail: "admin@example.com",
    publishedAt: "2026-07-21T00:00:00.000Z",
    publishedBy: "admin-1",
    publishedByEmail: "admin@example.com",
  };
}

test("Consultant stays explicit-selection only and uses fixed tools", () => {
  const advice = planAgentRequest({
    request: {
      clinicId: "queen-clinic",
      clinicCode: "GTTHEQUEEN",
      agent: "consultant",
      message: "I have dry skin. Which service may be suitable?",
    },
    now: new Date("2026-07-21T00:00:00.000Z"),
  });
  assert.equal(advice.resolvedAgent, "consultant");
  assert.equal(advice.intent, "consultant_service_advice");
  assert.deepEqual(advice.toolNames, ["get_consultant_service_advice"]);

  const trends = planAgentRequest({
    request: {
      clinicId: "queen-clinic",
      clinicCode: "GTTHEQUEEN",
      agent: "consultant",
      message: "Which services are trending this month?",
    },
    now: new Date("2026-07-21T00:00:00.000Z"),
  });
  assert.equal(trends.intent, "consultant_trending_services");
  assert.deepEqual(trends.toolNames, ["get_consultant_trending_services"]);

  const allowlist = getAgentToolAllowlist("consultant");
  assert.deepEqual(allowlist.sort(), [
    "get_consultant_service_advice",
    "get_consultant_trending_services",
  ]);
});

test("published concern tags match customer wording", () => {
  const match = rankConsultantKnowledge({
    question: "My skin feels very dry. What can I ask about?",
    knowledge: publishedDrySkinKnowledge(),
    language: "en",
  });
  assert.ok(match.score >= 20);

  const unrelated = rankConsultantKnowledge({
    question: "I want a service for unwanted facial hair",
    knowledge: publishedDrySkinKnowledge(),
    language: "en",
  });
  assert.equal(unrelated.score, 0);
});

test("publishing requires recommendation evidence and safety boundaries", () => {
  const empty = emptyConsultantKnowledgeContent();
  assert.equal(isConsultantKnowledgePublishable(empty), false);

  const complete = publishedDrySkinKnowledge().content;
  assert.equal(isConsultantKnowledgePublishable(complete), true);
});

test("urgent symptom wording suppresses cosmetic service matching", () => {
  assert.equal(containsUrgentConsultantConcern("I have severe swelling around my eyes"), true);
  assert.equal(containsUrgentConsultantConcern("I have ordinary dry skin"), false);
});

test("API Core catalog query is fixed, scoped, and read-only", () => {
  assert.match(catalogTest.CONSULTANT_SERVICE_CATALOG_QUERY, /^\s*query\b/i);
  assert.match(catalogTest.CONSULTANT_SERVICE_CATALOG_QUERY, /clinic_id:\s*\{\s*equals:\s*\$clinicId/);
  assert.match(catalogTest.CONSULTANT_SERVICE_CATALOG_QUERY, /status:\s*\{\s*equals:\s*ACTIVE/);
  assert.doesNotMatch(catalogTest.CONSULTANT_SERVICE_CATALOG_QUERY, /\bmutation\b/i);
});

test("GPT-5.6 suggestion request is stateless, structured, and excludes live price", async () => {
  const content = emptyConsultantKnowledgeContent();
  content.en.overview = "A cautious staff-review draft.";
  content.my.overview = "ဝန်ထမ်းများ ပြန်လည်စစ်ဆေးရန် မူကြမ်း။";
  const suggestion = {
    content,
    confidence: "low" as const,
    warnings: ["Confirm the treatment protocol with trained clinic staff."],
    missingInformation: ["Clinic-approved contraindications were not supplied."],
    reviewNotes: ["Review both languages before publishing."],
  };
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> = {};
  let capturedAuthorization = "";

  const result = await generateConsultantKnowledgeSuggestion(
    {
      service: {
        serviceId: "service-1",
        serviceName: "Hair Removal Underarm",
        description: "Laser hair removal service.",
        status: "ACTIVE",
        price: "100000.00",
        originalPrice: "100000.00",
        durationMinutes: 15,
        sortOrder: 1,
        updatedAt: null,
      },
      currentContent: emptyConsultantKnowledgeContent(),
      actorId: "admin-user-1",
    },
    {
      apiKey: "test-key",
      apiBaseUrl: "https://api.openai.test/v1",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      timeoutMs: 1_000,
      maxOutputTokens: 8_000,
      now: () => new Date("2026-07-21T08:00:00.000Z"),
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        capturedAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
        return new Response(JSON.stringify({
          id: "resp-test",
          model: "gpt-5.6-sol",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(suggestion) }],
          }],
          usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    },
  );

  assert.equal(capturedUrl, "https://api.openai.test/v1/responses");
  assert.equal(capturedAuthorization, "Bearer test-key");
  assert.equal(capturedBody.model, "gpt-5.6-sol");
  assert.equal(capturedBody.background, false);
  assert.equal(capturedBody.store, false);
  assert.deepEqual(capturedBody.reasoning, { effort: "medium" });
  assert.equal((capturedBody.text as { format: { strict: boolean } }).format.strict, true);
  assert.notEqual(capturedBody.safety_identifier, "admin-user-1");
  const modelInput = JSON.parse(String(capturedBody.input)) as { service: Record<string, unknown> };
  assert.equal(modelInput.service.name, "Hair Removal Underarm");
  assert.equal("price" in modelInput.service, false);
  assert.equal(result.confidence, "low");
  assert.equal(result.generation.responseId, "resp-test");
  assert.equal(result.generation.usage.totalTokens, 300);
});

test("GPT-5.6 background draft returns promptly and completes through protected polling", async () => {
  const content = emptyConsultantKnowledgeContent();
  content.en.overview = "A staff-reviewed laser hair removal draft.";
  content.my.overview = "ဝန်ထမ်းများ စစ်ဆေးရန် လေဆာအမွှေးဖယ်ရှားမှု မူကြမ်း။";
  const suggestion = {
    content,
    confidence: "medium" as const,
    warnings: [],
    missingInformation: ["Confirm clinic-approved contraindications."],
    reviewNotes: ["Review both languages before publishing."],
  };
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null,
    });
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        id: "resp_background_1",
        model: "gpt-5.6-sol",
        status: "in_progress",
        output: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "resp_background_1",
      model: "gpt-5.6-sol",
      status: "completed",
      output: [{
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(suggestion) }],
      }],
      usage: { input_tokens: 120, output_tokens: 240, total_tokens: 360 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const service = {
    serviceId: "service-1",
    serviceName: "Hair Removal Underarm",
    description: "Laser hair removal service.",
    status: "ACTIVE" as const,
    price: "100000.00",
    originalPrice: "100000.00",
    durationMinutes: 15,
    sortOrder: 1,
    updatedAt: null,
  };
  const dependencies = {
    apiKey: "test-key",
    apiBaseUrl: "https://api.openai.test/v1",
    model: "gpt-5.6-sol",
    reasoningEffort: "medium" as const,
    timeoutMs: 1_000,
    maxOutputTokens: 8_000,
    now: () => new Date("2026-07-21T08:00:00.000Z"),
    fetchImpl,
  };

  const started = await startConsultantKnowledgeSuggestion({
    service,
    actorId: "admin-user-1",
  }, dependencies);
  assert.equal(started.status, "in_progress");
  if (started.status === "completed") {
    assert.fail("Expected a background job.");
  }
  assert.equal(requests[0]?.body?.background, true);
  assert.equal(requests[0]?.body?.store, false);
  assert.equal(started.job.responseId, "resp_background_1");
  assert.equal(
    started.job.jobToken,
    consultantSuggestionJobToken({
      apiKey: "test-key",
      actorId: "admin-user-1",
      serviceId: "service-1",
      responseId: "resp_background_1",
    }),
  );

  const completed = await pollConsultantKnowledgeSuggestion({
    serviceId: "service-1",
    responseId: started.job.responseId,
    jobToken: started.job.jobToken,
    actorId: "admin-user-1",
  }, dependencies);
  assert.equal(requests[1]?.url, "https://api.openai.test/v1/responses/resp_background_1");
  assert.equal(requests[1]?.method, "GET");
  assert.equal(requests[1]?.body, null);
  assert.equal(completed.status, "completed");
  if (completed.status !== "completed") {
    assert.fail("Expected a completed suggestion.");
  }
  assert.equal(completed.suggestion.content.en.overview, content.en.overview);
  assert.equal(completed.suggestion.generation.usage.totalTokens, 360);

  await assert.rejects(
    () => pollConsultantKnowledgeSuggestion({
      serviceId: "service-1",
      responseId: started.job.responseId,
      jobToken: `${started.job.jobToken}invalid`,
      actorId: "admin-user-1",
    }, dependencies),
    ConsultantKnowledgeSuggestionUnavailableError,
  );
  assert.equal(requests.length, 2);
});

test("GPT-5.6 suggestion prompt enforces review and safety boundaries", () => {
  assert.match(suggestionTest.CONSULTANT_KNOWLEDGE_INSTRUCTIONS, /only clinic-supplied context/i);
  assert.match(suggestionTest.CONSULTANT_KNOWLEDGE_INSTRUCTIONS, /Never diagnose/i);
  assert.match(suggestionTest.CONSULTANT_KNOWLEDGE_INSTRUCTIONS, /never imply.*clinically approved/i);
  assert.match(consultantSafetyIdentifier("admin-user-1"), /^gtv2_[a-f0-9]{32}$/);
});

test("GPT-5.6 suggestion fails safely when the API key is unavailable", async () => {
  await assert.rejects(
    () => generateConsultantKnowledgeSuggestion(
      {
        service: {
          serviceId: "service-1",
          serviceName: "Test service",
          description: null,
          status: "ACTIVE",
          price: "0.00",
          originalPrice: "0.00",
          durationMinutes: 0,
          sortOrder: 0,
          updatedAt: null,
        },
        actorId: "admin-user-1",
      },
      { apiKey: "" },
    ),
    ConsultantKnowledgeSuggestionUnavailableError,
  );
});
