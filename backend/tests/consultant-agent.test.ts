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
